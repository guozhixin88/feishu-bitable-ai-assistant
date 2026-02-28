// ai-chat.js
// Chat 会话管理和文档修改逻辑

const AIChat = {
    currentSessionId: null,
    sessions: [],

    /**
     * 初始化 - 加载会话列表
     */
    init: async function () {
        // 等待 DB 初始化
        if (!ProjectManager.dbVerified) {
            await ProjectManager.init();
        }
        await this.loadSessions();
        return this.sessions;
    },

    /**
     * 加载当前项目的会话
     */
    loadSessions: async function () {
        this.sessions = [];
        const projectId = await ProjectManager.getCurrentProjectId();
        if (projectId) {
            let chats = await DB.getChats(projectId);
            // 过滤掉空会话 (没有消息的)，避免垃圾数据
            this.sessions = chats.filter(s => s.messages && s.messages.length > 0);

            // 按照更新时间倒序排列 (最新的在前)
            this.sessions.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
        }
        return this.sessions;
    },

    /**
     * 获取指定项目的会话（供导出使用）
     */
    getProjectSessions: async function (projectId) {
        return await DB.getChats(projectId);
    },

    /**
     * 保存会话列表 (只保存变化的 session)
     */
    saveSessions: async function () {
        const projectId = await ProjectManager.getCurrentProjectId();
        if (!projectId) return;

        // 保存所有 session 到 DB
        // TODO: 优化，只保存 dirty 的
        for (const session of this.sessions) {
            await DB.saveChat(projectId, session);
        }
    },

    /**
     * 创建新会话
     */
    createSession: async function (title = '新对话') {
        const session = {
            id: Date.now().toString(),
            title: title,
            messages: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        this.sessions.unshift(session);
        this.currentSessionId = session.id;
        await this.saveSessions();

        return session;
    },

    /**
     * 获取当前会话
     */
    getCurrentSession: function () {
        if (!this.currentSessionId) return null;
        return this.sessions.find(s => s.id === this.currentSessionId);
    },

    /**
     * 切换会话
     */
    switchSession: function (sessionId) {
        const session = this.sessions.find(s => s.id === sessionId);
        if (session) {
            this.currentSessionId = sessionId;
            return session;
        }
        return null;
    },

    /**
     * 删除会话
     */
    deleteSession: async function (sessionId) {
        this.sessions = this.sessions.filter(s => s.id !== sessionId);
        if (this.currentSessionId === sessionId) {
            this.currentSessionId = this.sessions[0]?.id || null;
        }

        await DB.deleteChat(sessionId);
    },

    /**
     * 获取当前文档内容
     */
    getDocuments: async function () {
        const data = await ProjectManager.getCurrentProjectData();

        if (!data || !data.documents) {
            return {
                fieldTable: null,
                automationMap: null,
                relationGraph: null
            };
        }

        const docs = data.documents;

        return {
            fieldTable: docs.fieldTableMd || null,
            automationMap: docs.automationMd || null,
            relationGraph: docs.relationshipMd || null // 注意：之前是 relationshipMd
        };
    },

    /**
     * 发送消息
     * @param {string} content - 消息内容
     * @param {string} imageBase64 - 可选的图片
     * @param {Object} customContext - 可选的自定义上下文 { fieldTable, automationMap, relationGraph }
     */
    sendMessage: async function (content, imageBase64 = null, customContext = null) {
        const session = this.getCurrentSession();
        if (!session) {
            throw new Error('请先创建或选择一个对话');
        }

        // 添加用户消息
        const userMessage = {
            role: 'user',
            content: content,
            image: imageBase64,
            timestamp: new Date().toISOString()
        };
        session.messages.push(userMessage);
        session.updatedAt = new Date().toISOString();

        // 获取文档内容 (如果有自定义上下文，则直接使用，否则获取全量)
        let documents;
        if (customContext) {
            documents = {
                fieldTable: customContext.fieldTable ?? null,
                automationMap: customContext.automationMap ?? null,
                relationGraph: customContext.relationGraph ?? null // 尽量保持完整，或也支持切片
            };
            console.log('[AIChat] Using custom context slice');
        } else {
            // documents = await this.getDocuments();
            // console.log('[AIChat] Using full project context');
            // 修改为：默认不加载全量文档，节省 Token
            documents = {
                fieldTable: null,
                automationMap: null,
                relationGraph: null
            };
            console.log('[AIChat] Using empty context (token optimization)');
        }

        // 调用 AI API
        try {
            const response = await AIApi.chat(session.messages, documents, imageBase64);

            // 添加 AI 回复
            const assistantMessage = {
                role: 'assistant',
                content: response.content,
                // updates: response.updates, // 已移除 updates
                timestamp: new Date().toISOString()
            };
            session.messages.push(assistantMessage);

            // 更新会话标题（如果是第一条消息）
            if (session.messages.length === 2 && session.title === '新对话') {
                session.title = content.slice(0, 30) + (content.length > 30 ? '...' : '');
            }

            await this.saveSessions();
            return assistantMessage;

        } catch (error) {
            // 移除失败的用户消息
            session.messages.pop();
            throw error;
        }
    },

    /**
     * 应用文档修改 (已禁用)
     * @param {Array} updates - 修改指令数组
     */
    /*
    applyUpdates: async function (updates) {
        if (!updates || updates.length === 0) return { success: false, error: '无修改内容' };

        // 获取当前文档
        const projectData = await ProjectManager.getCurrentProjectData();
        if (!projectData || !projectData.documents) {
            return { success: false, error: '未找到文档数据' };
        }

        const docs = projectData.documents;
        const results = [];
        let hasChanges = false;

        // 辅助函数：获取文档内容
        const getContent = (docKey) => {
            // 映射 key 名 (ai-chat 用的 key -> ProjectManager 用的 key)
            if (docKey === 'relationMd') return docs.relationshipMd || '';
            return docs[docKey] || '';
        };

        // 辅助函数：设置文档内容
        const setContent = (docKey, content) => {
            if (docKey === 'relationMd') {
                docs.relationshipMd = content;
            } else {
                docs[docKey] = content;
            }
            hasChanges = true;
        };

        for (const update of updates) {
            const docKey = this.getDocKey(update.doc);
            if (!docKey) {
                results.push({ doc: update.doc, success: false, error: '未知文档类型' });
                continue;
            }

            let content = getContent(docKey);

            try {
                switch (update.action) {
                    case 'search_and_replace':
                        if (content.includes(update.target)) {
                            content = content.replace(update.target, update.replacement);
                        } else {
                            throw new Error('未找到目标文本，无法替换');
                        }
                        break;
                    case 'append_to_section':
                        content = this.appendToSection(content, update.section, update.content);
                        break;
                    case 'replace_section':
                        content = this.replaceSection(content, update.section, update.content);
                        break;
                    case 'append_to_end':
                        content = content + '\\n\\n' + update.content;
                        break;
                    default:
                        results.push({ doc: update.doc, success: false, error: '未知操作类型' });
                        continue;
                }

                setContent(docKey, content);
                results.push({ doc: update.doc, success: true });

            } catch (e) {
                results.push({ doc: update.doc, success: false, error: e.message });
            }
        }

        // 保存更新后的文档
        if (hasChanges) {
            const projectId = await ProjectManager.getCurrentProjectId();
            // 注意：这里我们更新了内存中的 docs 对象，ProjectManager.saveVersion 会保存它
            // 但 ProjectManager 目前没有单独的 updateDocument 方法，我们需要创建一个新版本或覆盖当前版本
            // 为了简化，我们暂时创建一个新版本

            // 重新获取 rawData (可能很大，这也是为什么我们需要优化)
            // 临时方案：仅更新 DB 中的 documents 字段，不创建新版本，或者创建补丁版本
            // 由于 ProjectManager 没有暴露单独更新 documents 的接口，我们暂时不保存到历史记录，只更新 storage
            // TODO: 实现 ProjectManager.updateCurrentVersionDocuments

            // 紧急修复：目前先不持久化到 DB 的历史记录，只更新 ProjectManager.currentProjectData 缓存
            // 这样 UI 刷新时能看到，但刷新页面后可能会丢失修改（如果没保存新版本）
            // 理想做法是 ProjectManager.saveProjectData(..., createNewVersion=false)

            // 暂时手动更新 storage 以保持持久化
            await chrome.storage.local.set({
                [`project_docs_${projectId}`]: docs  // 假设 ProjectManager 使用这个 key 缓存文档
            });

            // 正确的做法是调用 ProjectManager 的方法。
            // 假设我们需要一个 saveWorkingCopy 方法。
            // 由于时间限制，我们先假设 ProjectManager 会处理 currentProjectData 的引用修改
            // 但我们需要通知 ProjectManager 保存。

            // 鉴于 ProjectManager.js 的实现，我们没有简单的方法只更新文档。
            // 我们先只返回 success，依靠内存状态更新（如果 ProjectManager 是单例且 docs 是引用）
        }

        // 标记所有成功的更新为已应用
        updates.forEach((u, index) => {
            if (results[index].success) {
                this.markUpdateAsApplied(u);
            }
        });

        return { success: true, results };
    },
    */


    /**
     * 标记更新为已应用 (已禁用)
     */
    /*
    markUpdateAsApplied: async function (updateObj) {
        const session = this.getCurrentSession();
        if (!session) return;

        // 在当前会话的消息中查找并标记
        let found = false;
        for (let i = session.messages.length - 1; i >= 0; i--) {
            const msg = session.messages[i];
            if (msg.updates) {
                const targetUpdate = msg.updates.find(u =>
                    u.doc === updateObj.doc &&
                    u.action === updateObj.action &&
                    u.content === updateObj.content
                );

                if (targetUpdate) {
                    targetUpdate.applied = true;
                    found = true;
                }
            }
        }

        if (found) {
            await this.saveSessions();
        }
    },
    */


    /**
     * 获取文档键名 (已禁用)
     */
    /*
    getDocKey: function (docName) {
        const map = {
            'field_table': 'fieldTableMd',
            '全量字段表': 'fieldTableMd',
            'automation_map': 'automationMd',
            '自动化地图': 'automationMd',
            'relation_graph': 'relationMd',
            '关联关系图': 'relationMd'
        };
        return map[docName] || null;
    },
    */


    /**
     * 在指定章节末尾添加内容 (已禁用)
     */
    /*
    appendToSection: function (content, sectionName, newContent) {
        // 查找章节（## 开头）
        const sectionRegex = new RegExp(`(## .*${sectionName}.*\\n[\\s\\S]*?)(\\n## |$)`, 'i');
        const match = content.match(sectionRegex);

        if (!match) {
            throw new Error(`未找到章节: ${sectionName}`);
        }

        // 在章节末尾（下一个 ## 之前）插入内容
        const insertPos = match.index + match[1].length;
        return content.slice(0, insertPos) + '\\n' + newContent + content.slice(insertPos);
    },
    */


    /**
     * 替换整个章节 (已禁用)
     */
    /*
    replaceSection: function (content, sectionName, newContent) {
        // 查找章节
        const sectionRegex = new RegExp(`(## .*${sectionName}.*\\n[\\s\\S]*?)(\\n## |$)`, 'i');
        const match = content.match(sectionRegex);

        if (!match) {
            throw new Error(`未找到章节: ${sectionName}`);
        }

        // 替换章节内容，保留章节标题
        const titleMatch = match[1].match(/## .*\\n/);
        const title = titleMatch ? titleMatch[0] : `## ${sectionName}\\n`;

        return content.slice(0, match.index) +
            title + newContent + '\\n' +
            content.slice(match.index + match[1].length);
    },
    */

    /**
     * 清除所有会话
     */
    clearAllSessions: async function () {
        this.sessions = [];
        this.currentSessionId = null;
        await this.saveSessions();
    }
};

// Export for module usage
if (typeof module !== 'undefined') {
    module.exports = AIChat;
}
