// 监听点击插件图标事件
chrome.runtime.onInstalled.addListener(() => {
    console.log("飞书实时助手插件已安装");
});

// 允许用户通过点击图标打开侧边栏 (Chrome 116+ 支持)
chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error(error));

// 暂存最新的数据 (改用 persistent storage)
// let latestContext = ... (Service Worker 会休眠，不能用全局变量)

// 监听来自 Content Script 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'DEBUG_LOG') {
        // 转发给 Sidepanel (如果打开着)
        chrome.runtime.sendMessage({
            action: 'UI_ADD_LOG',
            log: `[Detect] ${request.payload.url.split('?')[0].split('/').pop()}`
        }).catch(() => { });
    }

    if (request.action === 'CAPTURE_DATA') {
        const { url, data } = request.payload;

        // 宽松匹配
        if (url.includes('view') || url.includes('meta')) {
            console.log("Saving View Meta...");

            // 存入 Storage
            chrome.storage.local.set({ 'viewMeta': data });

            // 通知侧边栏
            chrome.runtime.sendMessage({
                action: 'DATA_UPDATED',
                dataType: 'fields',
                timestamp: new Date().toISOString()
            }).catch(e => { });
        }
    }

    // ===== 新增：处理变动检测 =====
    if (request.action === 'CHANGE_DETECTED') {
        const { changeType, requestBody, responseData, url } = request.payload;

        // 特殊处理 1：字段列表快照（tablesv3 GET 响应）
        if (changeType === 'fields_snapshot' && responseData) {
            console.log("=== [Background] 捕获到字段列表快照 (tablesv3) ===");
            console.log("[Background] URL:", url);

            try {
                // 从响应中提取表名和字段
                let tableName = '当前表';
                let fieldsData = null;

                // 尝试从 URL 获取表名
                const tableMatch = url?.match(/tablesv3\/([^/?]+)/);
                if (tableMatch) {
                    tableName = tableMatch[1];
                }

                // responseData.data 里应该包含字段信息
                if (responseData.data) {
                    const data = responseData.data;
                    console.log("[Background] responseData.data keys:", Object.keys(data));

                    // Case 1: 单个表结构 (table)
                    if (data.table && data.table.fields) {
                        fieldsData = data.table.fields;
                        tableName = data.table.name || data.table.table_name || tableName;
                        saveFields(tableName, fieldsData);
                    }
                    // Case 2: 字段列表 (fields)
                    else if (data.fields) {
                        fieldsData = data.fields;
                        saveFields(tableName, fieldsData);
                    }
                    // Case 3: 视图包含字段 (view)
                    else if (data.view && data.view.fields) {
                        fieldsData = data.view.fields;
                        saveFields(tableName, fieldsData);
                    }
                    // Case 4: 批量表数据 (tables 数组 - 来自 POST tablesv3)
                    else if (data.tables && Array.isArray(data.tables)) {
                        console.log(`[Background] 捕获到批量表数据 (数组): ${data.tables.length} 张表`);
                        data.tables.forEach(tbl => {
                            if (tbl.fields && tbl.fields.length > 0) {
                                const tName = tbl.name || tbl.table_name || '未知表';
                                saveFields(tName, tbl.fields);
                            }
                        });
                        return;
                    }
                    // Case 5: 批量表数据 (对象映射 - data[tableId]: {name, fields, ...} 或压缩字符串)
                    else {
                        // 检测是否是 {tableId: tableData, tableId2: tableData2, ...} 格式
                        const keys = Object.keys(data);
                        if (keys.length > 0 && keys[0].startsWith('tbl')) {
                            console.log(`[Background] 捕获到批量表数据 (对象映射): ${keys.length} 张表`);

                            // 1. 先收集所有需要保存的数据
                            const updates = {};
                            let savedCount = 0;

                            keys.forEach(tableId => {
                                const tableData = data[tableId];

                                // Case 5a: 数据已解压，有 fields 字段
                                if (tableData && typeof tableData === 'object' && tableData.fields) {
                                    const tName = tableData.name || tableData.table_name || tableId;
                                    updates[tName] = tableData.fields;
                                    savedCount++;
                                }
                                // Case 5b: 数据是压缩字符串 (GZip Base64)
                                else if (typeof tableData === 'string' && tableData.startsWith('H4s')) {
                                    // 保存原始压缩数据，让 change-detector.js 解压
                                    // 注意：这里必须用 tableId 作为 key，因为压缩数据里才包含真实表名
                                    updates[tableId] = tableData;
                                    savedCount++;
                                    console.log(`[Background] 表 ${tableId} 数据为压缩格式，稍后解压`);
                                }
                            });

                            if (savedCount > 0) {
                                // 2. 一次性读取并更新存储 (避免异步竞争)
                                chrome.storage.local.get(['feishu_live_fields'], (result) => {
                                    const liveFields = result.feishu_live_fields || {};

                                    // 合并新数据
                                    Object.assign(liveFields, updates);
                                    liveFields._lastUpdate = new Date().toISOString();

                                    chrome.storage.local.set({ feishu_live_fields: liveFields }, () => {
                                        console.log(`[Background] 批量保存成功: ${savedCount} 张表`);

                                        // 通知侧边栏
                                        chrome.runtime.sendMessage({
                                            action: 'FIELDS_CAPTURED',
                                            count: savedCount,
                                            timestamp: liveFields._lastUpdate
                                        }).catch(() => { });
                                    });
                                });
                            } else {
                                console.log("[Background] 表数据中未发现可用字段，检查表结构:", JSON.stringify(data[keys[0]]).substring(0, 300));
                            }
                            return;
                        }
                    }
                }

                function saveFields(tName, fData) {
                    if (fData) {
                        console.log(`[Background] 捕获到表 "${tName}" 的 ${fData.length || Object.keys(fData).length} 个字段`);

                        // 存储到专门的 key
                        chrome.storage.local.get(['feishu_live_fields'], (result) => {
                            const liveFields = result.feishu_live_fields || {};
                            liveFields[tName] = fData;
                            liveFields._lastUpdate = new Date().toISOString();

                            chrome.storage.local.set({ feishu_live_fields: liveFields }, () => {
                                console.log(`[Background] 表 "${tName}" 字段快照已保存`);

                                // 通知侧边栏
                                chrome.runtime.sendMessage({
                                    action: 'FIELDS_CAPTURED',
                                    tableName: tName,
                                    fieldCount: Array.isArray(fData) ? fData.length : Object.keys(fData).length
                                }).catch(() => { });
                            });
                        });
                    }
                }
            } catch (e) {
                console.error('[Background] 解析字段快照失败:', e);
            }
            return; // 不作为普通变动记录
        }

        // 特殊处理 2：架构快照 (从 recommend_fields 获取的 currentFields)
        if (changeType === 'schema_snapshot' && requestBody?.currentFields) {
            console.log("=== [Background] 捕获到字段列表快照 ===");
            try {
                // 解析 currentFields (它是 JSON 字符串)
                const fields = typeof requestBody.currentFields === 'string'
                    ? JSON.parse(requestBody.currentFields)
                    : requestBody.currentFields;

                const tableName = requestBody.tableName || '当前表';

                console.log(`[Background] 表"${tableName}"有 ${fields.length} 个字段`);

                // 将这个快照发送给 sidepanel 进行对比
                chrome.runtime.sendMessage({
                    action: 'SCHEMA_UPDATED',
                    fields: fields,
                    tableName: tableName,
                    timestamp: new Date().toISOString()
                }).catch(e => { });

            } catch (e) {
                console.error('[Background] 解析字段快照失败:', e);
            }
            return; // 不作为普通变动记录
        }

        console.log("=== [Background] 收到变动检测 ===");
        // ... 原有的变动记录逻辑 ...
        console.log("变动描述:", request.payload.changeDesc);
        console.log("URL:", request.payload.url);
        console.log("Method:", request.payload.method);
        console.log("请求体:", request.payload.requestBody);
        console.log("响应:", request.payload.responseData);

        // 存入变动记录
        chrome.storage.local.get(['feishu_changes'], (result) => {
            const changes = result.feishu_changes || [];
            const newChange = {
                id: `change_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                type: request.payload.changeType,
                description: request.payload.changeDesc,
                url: request.payload.url,
                method: request.payload.method,
                requestBody: request.payload.requestBody,
                responseData: request.payload.responseData,
                timestamp: request.payload.timestamp || new Date().toISOString(),
                applied: false
            };

            changes.push(newChange);
            chrome.storage.local.set({ feishu_changes: changes }, () => {
                console.log('[Background] 变动已保存,总数:', changes.length);

                // 通知侧边栏更新
                chrome.runtime.sendMessage({
                    action: 'CHANGE_ADDED',
                    change: newChange
                }).catch(e => {
                    console.log('[Background] 侧边栏未打开，无法通知');
                });
            });
        });
    }
});

// 响应侧边栏的“获取数据”请求
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'GET_LATEST_CONTEXT') {
        // 异步读取 Storage
        chrome.storage.local.get(['viewMeta'], (result) => {
            sendResponse(result);
        });
        return true; // 保持消息通道开启以进行异步响应
    }
});
