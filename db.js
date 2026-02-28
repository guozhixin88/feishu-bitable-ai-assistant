const DB_NAME = 'FeishuBotDB';
const DB_VERSION = 1;

const DB = {
    db: null,

    async init() {
        if (this.db) return this.db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = (event) => {
                console.error("IndexedDB error:", event.target.error);
                reject(event.target.error);
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                console.log("IndexedDB initialized");
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // 1. Projects Store: 项目元数据
                if (!db.objectStoreNames.contains('projects')) {
                    const store = db.createObjectStore('projects', { keyPath: 'id' }); // id = appToken
                    store.createIndex('updatedAt', 'updatedAt', { unique: false });
                }

                // 2. Versions Store: 版本历史
                if (!db.objectStoreNames.contains('versions')) {
                    const store = db.createObjectStore('versions', { keyPath: 'id' }); // id = uuid
                    store.createIndex('projectId', 'projectId', { unique: false });
                    store.createIndex('version', 'version', { unique: false });
                }

                // 3. Chats Store: 对话记录
                if (!db.objectStoreNames.contains('chats')) {
                    const store = db.createObjectStore('chats', { keyPath: 'id' });
                    store.createIndex('projectId', 'projectId', { unique: false });
                }
            };
        });
    },

    // 通用增删改查
    async put(storeName, data) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.put(data);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async delete(storeName, key) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(key);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    },

    async get(storeName, key) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(key);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async getAll(storeName, indexName, value) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            let request;

            if (indexName) {
                const index = store.index(indexName);
                if (value !== undefined) {
                    request = index.getAll(IDBKeyRange.only(value));
                } else {
                    request = index.getAll();
                }
            } else {
                request = store.getAll();
            }

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    // 特定业务方法
    async getProjectVersions(projectId) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['versions'], 'readonly');
            const store = transaction.objectStore('versions');
            const index = store.index('projectId');
            const request = index.getAll(IDBKeyRange.only(projectId));

            request.onsuccess = () => {
                // 按版本号倒序排列
                const versions = request.result.sort((a, b) => b.version - a.version);
                resolve(versions);
            };
            request.onerror = () => reject(request.error);
        });
    },

    async getLatestVersion(projectId) {
        const versions = await this.getProjectVersions(projectId);
        return versions.length > 0 ? versions[0] : null;
    },

    // Chat 相关方法
    async getChats(projectId) {
        return await this.getAll('chats', 'projectId', projectId);
    },

    async saveChat(projectId, session) {
        session.projectId = projectId;
        return await this.put('chats', session);
    },

    async deleteChat(sessionId) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chats'], 'readwrite');
            const store = transaction.objectStore('chats');
            const request = store.delete(sessionId);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    },

    // 清空指定项目的文档数据
    async clearProjectDocs(projectId) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['versions'], 'readwrite');
            const store = transaction.objectStore('versions');
            const index = store.index('projectId');
            const request = index.getAllKeys(IDBKeyRange.only(projectId));

            request.onsuccess = () => {
                const keys = request.result;
                let count = 0;
                if (keys.length === 0) return resolve();

                keys.forEach(key => {
                    store.delete(key).onsuccess = () => {
                        count++;
                        if (count === keys.length) resolve();
                    };
                });
            };
            request.onerror = () => reject(request.error);
        });
    },

    // 清空所有数据
    async clearAll() {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['projects', 'versions', 'chats'], 'readwrite');

            transaction.objectStore('projects').clear();
            transaction.objectStore('versions').clear();
            transaction.objectStore('chats').clear();

            transaction.oncomplete = () => {
                console.log('IndexedDB cleared');
                resolve();
            };
            transaction.onerror = () => reject(transaction.error);
        });
    }
};

// 导出供 module 使用 (如果在 content script 需考虑 export 方式，这里假设用于 sidepanel)
// window.DB = DB; // 通过 <script> 引入时挂载到 window
