// change-tracker.js - 变动记录管理

const ChangeTracker = {
    STORAGE_KEY: 'feishu_changes',
    changes: [],

    /**
     * 初始化，从存储加载变动记录
     */
    init: async function () {
        const result = await new Promise(resolve => {
            chrome.storage.local.get([this.STORAGE_KEY], resolve);
        });
        this.changes = result[this.STORAGE_KEY] || [];
        return this.changes;
    },

    /**
     * 添加变动记录
     * @param {Object} changeData - 来自 content.js 的变动数据
     */
    addChange: async function (changeData) {
        const change = {
            id: `change_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: changeData.changeType,
            description: changeData.changeDesc,
            url: changeData.url,
            method: changeData.method,
            requestBody: changeData.requestBody,
            responseData: changeData.responseData,
            timestamp: changeData.timestamp || new Date().toISOString(),
            applied: false,
            // 解析出的友好信息
            friendlyInfo: this.parseFriendlyInfo(changeData)
        };

        this.changes.unshift(change); // 最新的在前面

        // 限制最多保留 100 条
        if (this.changes.length > 100) {
            this.changes = this.changes.slice(0, 100);
        }

        await this.save();
        return change;
    },

    /**
     * 解析出用户友好的信息
     */
    parseFriendlyInfo: function (changeData) {
        const info = {
            table: '未知表',
            target: '未知目标',
            detail: ''
        };

        try {
            // 尝试从 URL 解析表 ID
            const tableMatch = changeData.url.match(/tables\/([^\/]+)/);
            if (tableMatch) {
                info.tableId = tableMatch[1];
            }

            // 尝试从响应数据解析字段名等
            const response = changeData.responseData;
            if (response && response.data) {
                if (response.data.field) {
                    info.target = response.data.field.field_name || response.data.field.name || '未知字段';
                    info.fieldType = response.data.field.type;
                }
                if (response.data.workflow) {
                    info.target = response.data.workflow.name || '未知工作流';
                }
            }

            // 从请求体解析变动详情
            const req = changeData.requestBody;
            if (req) {
                if (req.field_name) info.target = req.field_name;
                if (req.name) info.target = req.name;
                if (req.formula) info.detail = `公式: ${req.formula}`;
            }

        } catch (e) {
            console.error('ChangeTracker: Failed to parse friendly info', e);
        }

        return info;
    },

    /**
     * 获取所有未应用的变动
     */
    getPendingChanges: function () {
        return this.changes.filter(c => !c.applied);
    },

    /**
     * 获取所有变动
     */
    getAllChanges: function () {
        return this.changes;
    },

    /**
     * 标记变动为已应用
     * @param {string} changeId - 变动 ID
     */
    markApplied: async function (changeId) {
        const change = this.changes.find(c => c.id === changeId);
        if (change) {
            change.applied = true;
            await this.save();
        }
    },

    /**
     * 清除所有已应用的变动
     */
    clearApplied: async function () {
        this.changes = this.changes.filter(c => !c.applied);
        await this.save();
    },

    /**
     * 清除所有变动
     */
    clearAll: async function () {
        this.changes = [];
        await this.save();
    },

    /**
     * 保存到存储
     */
    save: async function () {
        await new Promise(resolve => {
            chrome.storage.local.set({ [this.STORAGE_KEY]: this.changes }, resolve);
        });
    },

    /**
     * 生成文档更新指令
     * @param {Object} change - 变动记录
     */
    generateUpdateInstruction: function (change) {
        // 根据变动类型生成对应的更新指令
        const instructions = [];

        switch (change.type) {
            case 'field_add':
                // 添加字段 → 在全量字段表的对应表末尾追加
                if (change.friendlyInfo && change.responseData?.data?.field) {
                    const field = change.responseData.data.field;
                    const fieldRow = `| **${field.field_name || '未知字段'}** | ${this.getFieldTypeName(field.type)} | 否 | | |`;
                    instructions.push({
                        doc: 'field_table',
                        action: 'append_to_section',
                        section: change.friendlyInfo.table || '未知表',
                        content: fieldRow
                    });
                }
                break;

            case 'field_modify':
                // 修改字段 → 用 search_and_replace 精确替换
                // 需要旧值，这里先留空
                break;

            case 'field_delete':
                // 删除字段 → 标记为 [已删除]
                break;

            case 'automation_add':
                // 添加自动化 → 追加到自动化地图
                break;

            // ... 其他类型
        }

        return instructions;
    },

    /**
     * 获取字段类型名称
     */
    getFieldTypeName: function (type) {
        const typeMap = {
            1: '文本',
            2: '数字',
            3: '单选',
            4: '多选',
            5: '日期',
            7: '复选框',
            11: '人员',
            13: '电话',
            15: '链接',
            17: '附件',
            18: '关联',
            19: '查找引用',
            20: '公式',
            21: '自动编号',
            22: '创建人',
            23: '创建时间',
            24: '修改人',
            25: '修改时间'
        };
        return typeMap[type] || `类型${type}`;
    }
};

// Export for module usage
if (typeof module !== 'undefined') {
    module.exports = ChangeTracker;
}
