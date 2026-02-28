const ProjectManager = {
    currentProject: null,

    async init() {
        await DB.init();
        console.log('ProjectManager initialized');
    },

    // 关键：从 URL 自动识别项目 ID
    getAppTokenFromUrl(url) {
        if (!url) return null;
        // 匹配飞书多维表格 URL 格式: https://*.feishu.cn/base/(basc...)
        // 或者此时可能带参数，所以匹配 base/ 后面的各种字符直到遇到 ? 或 /
        const match = url.match(/\/base\/([a-zA-Z0-9]+)/);
        return match ? match[1] : null;
    },

    // 获取当前激活的项目 ID (通过查询当前 Tab)
    async getActiveProjectId() {
        return new Promise((resolve) => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs && tabs.length > 0) {
                    const url = tabs[0].url;
                    const token = this.getAppTokenFromUrl(url);
                    resolve(token);
                } else {
                    resolve(null);
                }
            });
        });
    },

    // 获取项目完整数据 (用于 UI 渲染)
    async getProjectData(appToken) {
        if (!appToken) return null;

        const project = await DB.get('projects', appToken);
        if (!project) return null;

        const version = await DB.getLatestVersion(appToken);
        return {
            info: project,
            version: version, // 包含 documents
            documents: version ? version.documents : {},
            rawData: version ? version.rawData : null
        };
    },

    // 快捷方法：获取当前项目的完整数据
    async getCurrentProjectData() {
        const projectId = await this.getActiveProjectId();
        if (!projectId) return null;
        return await this.getProjectData(projectId);
    },

    // 快捷方法：获取当前项目 ID (ai-chat.js 依赖)
    async getCurrentProjectId() {
        return await this.getActiveProjectId();
    },

    // 保存新版本
    async saveVersion(appToken, projectName, rawBaseContent, parsedDocuments, rawData, slices = null) {
        const timestamp = Date.now();

        // 1. 更新或创建项目信息
        let project = await DB.get('projects', appToken);
        if (!project) {
            project = {
                id: appToken,
                name: projectName || '未命名项目',
                createdAt: timestamp,
                updatedAt: timestamp,
                latestVersion: 1
            };
        } else {
            project.name = projectName || project.name; // 更新名称
            project.updatedAt = timestamp;
            project.latestVersion = (project.latestVersion || 0) + 1;
        }
        await DB.put('projects', project);

        // 2. 保存版本
        const versionData = {
            id: crypto.randomUUID(), // 需要浏览器支持 crypto API
            projectId: appToken,
            version: project.latestVersion,
            timestamp: timestamp,
            documents: parsedDocuments, // { fieldTableMd, relationshipMd... }
            rawData: rawData,
            rawContent: rawBaseContent,
            slices: slices // [Context Slicing] 存储预处理生成的片段
        };
        await DB.put('versions', versionData);

        // 3. 清理与版本管理 (仅保留最新版本的切片)
        try {
            const allVersions = await DB.getAll('versions');
            const projectVersions = allVersions
                .filter(v => v.projectId === appToken)
                .sort((a, b) => b.version - a.version); // 降序排列

            // 只保留最近 2 个版本及其物理数据
            if (projectVersions.length > 2) {
                const toDelete = projectVersions.slice(2);
                for (const v of toDelete) {
                    await DB.delete('versions', v.id);
                }
                console.log(`[ProjectManager] Cleaned up ${toDelete.length} old versions for project ${appToken}`);
            }

            // [Context Slicing] 强制版本同步：只有最新版本保留切片数据以节省空间
            // 重新获取最新的两个版本（即保留下的那些）
            const remainingVersions = (await DB.getAll('versions'))
                .filter(v => v.projectId === appToken)
                .sort((a, b) => b.version - a.version);

            for (let i = 1; i < remainingVersions.length; i++) {
                const oldV = remainingVersions[i];
                if (oldV.slices) {
                    oldV.slices = null;
                    await DB.put('versions', oldV);
                    console.log(`[ProjectManager] Stripped slices from older version ${oldV.version}`);
                }
            }
        } catch (e) {
            console.error('[ProjectManager] Cleanup failed:', e);
        }

        return { project, version: versionData };
    }
};

// window.ProjectManager = ProjectManager;
