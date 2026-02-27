// in-page-script.js
(function () {
    // ===== 变动类型定义 =====
    const CHANGE_PATTERNS = [
        // 字段操作
        { pattern: /\/bitable\/.*\/fields/, method: 'POST', type: 'field_add', desc: '添加字段' },
        { pattern: /\/bitable\/.*\/fields\//, method: 'PUT', type: 'field_modify', desc: '修改字段' },
        { pattern: /\/bitable\/.*\/fields\//, method: 'PATCH', type: 'field_modify', desc: '修改字段' },
        { pattern: /\/bitable\/.*\/fields\//, method: 'DELETE', type: 'field_delete', desc: '删除字段' },
        // 自动化操作
        { pattern: /\/bitable\/.*\/workflow/, method: 'POST', type: 'automation_add', desc: '添加自动化' },
        { pattern: /\/bitable\/.*\/workflow/, method: 'PUT', type: 'automation_modify', desc: '修改自动化' },
        { pattern: /\/bitable\/.*\/workflow/, method: 'DELETE', type: 'automation_delete', desc: '删除自动化' },
        // 记录操作 (可选)
        { pattern: /\/bitable\/.*\/records/, method: 'POST', type: 'record_add', desc: '添加记录' },
        { pattern: /\/bitable\/.*\/records/, method: 'PUT', type: 'record_modify', desc: '修改记录' },
        // 视图操作
        { pattern: /\/bitable\/.*\/views/, method: 'POST', type: 'view_add', desc: '添加视图' },
        { pattern: /\/bitable\/.*\/views/, method: 'PUT', type: 'view_modify', desc: '修改视图' },
    ];

    // 检测变动类型 - 更宽松的匹配，用于调试
    function detectChangeType(url, method, requestBody) {
        const upperMethod = method.toUpperCase();

        // 1. 特殊处理：推荐字段接口 (包含完整字段列表)
        if (url.includes('/field_center/recommend_fields') && requestBody) {
            return {
                type: 'schema_snapshot', // 标记为架构快照
                desc: '捕获字段列表',
                isSnapshot: true
            };
        }

        // 2. 捕获 tablesv3 相关请求（包含完整字段定义）
        // 飞书加载表格时可能使用 GET 或 POST (批量获取)
        if (url.includes('tablesv3')) {
            // 如果是 POST 且看似读取操作 (有 requestBody 但没有写操作特征)
            // 或者明确的 GET
            if (upperMethod === 'GET' || (upperMethod === 'POST' && !url.includes('/batch_delete'))) {
                return {
                    type: 'fields_snapshot',
                    desc: '捕获表结构',
                    isSnapshot: true
                };
            }
        }

        // 尝试捕获任何含 "fields" 的响应，如果它看起来像是在获取列表
        if (url.includes('/fields') && upperMethod === 'GET') {
            return {
                type: 'fields_snapshot',
                desc: '捕获字段列表',
                isSnapshot: true
            };
        }

        // 3. 只关注写操作 (POST, PUT, PATCH, DELETE) 用于变动检测
        if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(upperMethod)) {
            return null;
        }

        // 4. 排除噪音请求
        const noisePatterns = [
            'ping', 'heartbeat', 'track', 'analytics', 'log', 'telemetry',
            'get_novice_task_progress', 'cost/info', 'pack/extension_metas',
            'pack/replit/bind_list', 'datasource/list', 'event/collect',
            'fetch_calc_status'
        ];

        if (noisePatterns.some(p => url.includes(p))) {
            return null;
        }

        // 重点关注 tablesv3 和 fields 相关的写操作
        // if (url.includes('tablesv3') || url.includes('/fields')) {
        //     console.log(`[FeishuRealtime DEBUG] 🎯 捕获到核心操作: ${upperMethod} ${url}`);
        //     if (requestBody) {
        //         console.log('[FeishuRealtime DEBUG] 请求体:', requestBody);
        //     }

        //     // 暂时全部标记为 modify 类型以便在 UI 显示
        //     return { type: 'field_modify', desc: `调试: ${upperMethod} 表操作` };
        // }

        // 其他 bitable 写操作
        // if (url.includes('bitable') || url.includes('base')) {
        //     return { type: 'unknown', desc: `${upperMethod} 操作` };
        // }

        return null;
    }

    // ===== 状态控制 =====
    let isCaptureEnabled = false;

    // 监听来自 content scipt 的控制消息
    window.addEventListener('message', function (event) {
        if (event.data && event.data.type === 'FEISHU_TOGGLE_CAPTURE') {
            isCaptureEnabled = !!event.data.enabled;
            // console.log('[FeishuRealtime] Capture enabled:', isCaptureEnabled);
        }
    });

    // 发送日志到面板 (仅保留重要日志，或者完全屏蔽调试日志)
    function logToPanel(url, data = null) {
        // 性能优化：默认不通过 postMessage 发送所有请求日志
        // 除非显式开启了调试模式 (这里简化为关闭)
        return;
    }

    // 发送变动事件
    function emitChange(changeType, url, method, requestBody, responseData) {
        // 变动检测仍然保留，因为这是"实时监控"的核心
        // 但可以加个简单的防抖或限制
        window.postMessage({
            type: 'FEISHU_CHANGE_DETECTED',
            changeType: changeType.type,
            changeDesc: changeType.desc,
            url: url,
            method: method,
            requestBody: requestBody,
            responseData: responseData,
            timestamp: new Date().toISOString()
        }, '*');
    }

    // ===== Hook Fetch =====
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        const request = args[0];
        const options = args[1] || {};
        const url = request instanceof Request ? request.url : request;
        const method = (request instanceof Request ? request.method : options.method) || 'GET';

        // 移除所有请求的日志记录
        // logToPanel(url);

        // 获取请求体 (仅在必要时解析)
        // 移动到下面，只有检测到 changeType 时才处理? 
        // 不，detectChangeType 需要 requestBody
        let requestBody = null;
        // 简单判断：只有非 GET 请求才解析 body，减少开销
        if (method !== 'GET' && options.body) {
            try {
                requestBody = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
            } catch (e) {
                requestBody = options.body;
            }
        }

        const response = await originalFetch.apply(this, args);

        // 检测是否为变动操作 (轻量级检查)
        const changeType = detectChangeType(url, method, requestBody);
        if (changeType) {
            try {
                const clone = response.clone();
                clone.json().then(data => {
                    emitChange(changeType, url, method, requestBody, data);
                }).catch(e => { });
            } catch (e) { }
        }

        return response;
    };

    // ===== Hook XHR =====
    const XHR = XMLHttpRequest.prototype;
    const originalOpen = XHR.open;
    const originalSend = XHR.send;

    XHR.open = function (method, url) {
        this._url = url;
        this._method = method;
        return originalOpen.apply(this, arguments);
    };

    XHR.send = function (body) {
        const xhr = this;
        let requestBody = null;

        // 同样优化：只有非 GET 才解析
        if (this._method !== 'GET' && body) {
            try {
                requestBody = typeof body === 'string' ? JSON.parse(body) : body;
            } catch (e) {
                requestBody = body;
            }
        }

        this.addEventListener('load', function () {
            if (xhr._url) {
                // logToPanel(xhr._url); // 移除日志

                // 检测变动
                const changeType = detectChangeType(xhr._url, xhr._method, requestBody);
                if (changeType) {
                    try {
                        // 只有通过检测才尝试解析响应
                        if (xhr.responseText) {
                            const data = JSON.parse(xhr.responseText);
                            emitChange(changeType, xhr._url, xhr._method, requestBody, data);
                        }
                    } catch (e) { }
                }
            }
        });
        return originalSend.apply(this, arguments);
    };

    // ===== Hook Blob Downloads =====
    // 飞书导出通常会创建一个 Blob URL 并模拟点击 a 标签下载
    // 我们 Hook 两个点：URL.createObjectURL 和 a.click

    // 追踪已拦截的 Blob URL
    const interceptedUrls = new Set();

    // 1. Hook createObjectURL
    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = function (blob) {
        const url = originalCreateObjectURL.apply(this, arguments);

        // 性能优化：只有在明确开启捕获（同步中）时才读取 Blob
        if (isCaptureEnabled && blob instanceof Blob) {
            // console.log('FeishuRealtime: Blob created', blob.type, blob.size);

            if (blob.size > 100) {
                // 标记此 URL 需要被拦截下载
                interceptedUrls.add(url);

                // 设置超时自动清理，防止内存泄漏 (1分钟后清理)
                setTimeout(() => interceptedUrls.delete(url), 60000);

                const reader = new FileReader();
                reader.onload = function () {
                    const base64data = reader.result;

                    window.postMessage({
                        type: 'FEISHU_BLOB_INTERCEPTED',
                        blobUrl: url,
                        data: base64data,
                        size: blob.size,
                        mimeType: blob.type
                    }, '*');
                };
                reader.readAsDataURL(blob);
            }
        }

        return url;
    };

    // 2. 拦截点击事件 (阻止浏览器默认下载行为)
    window.addEventListener('click', function (event) {
        // 检查是否是链接点击
        const target = event.target.closest('a');
        if (target && target.href) {
            // 检查 href 是否在拦截列表中
            if (interceptedUrls.has(target.href)) {
                // console.log('FeishuRealtime: Blocked file download to disk', target.href);
                event.preventDefault(); // 阻止下载
                event.stopPropagation(); // 阻止冒泡

                // 拦截成功后移除，避免误伤（虽然后续点击也不太可能）
                interceptedUrls.delete(target.href);
            }
        }
    }, true); // 使用捕获阶段，确保最先处理

    console.log("FeishuRealtime: Interceptor with Optimized Performance & Silent Sync Active");
})();
