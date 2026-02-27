// parser.js
// 这是一个纯逻辑层，负责将飞书的 JSON 数据转换为 Markdown

const FeishuParser = {
    // 字段类型映射表 (参考飞书 API 文档)
    FieldTypeMap: {
        1: "多行文本",
        2: "数字",
        3: "单选",
        4: "多选",
        5: "日期",
        11: "人员",
        13: "电话",
        15: "超链接",
        18: "单向关联",
        19: "双向关联",
        20: "公式",
        21: "双向关联(链接)",
        1001: "创建时间",
        1002: "最后更新时间",
        1003: "创建人",
        1004: "修改人",
        1005: "自动编号"
    },

    /**
     * 将拦截到的 Meta 数据转换为 "全量字段表" Markdown
     * @param {Object} jsonData - 拦截到的 JSON 对象
     * @returns {string} Markdown 表格
     */
    parseFieldTable: function (jsonData) {
        if (!jsonData || !jsonData.data) return "数据格式错误";

        // 深度查找 fields 数组
        let fields = this.findFieldsArray(jsonData.data);

        if (!fields || fields.length === 0) {
            // 如果不是包含 fields 的数据包，可能是其他 metadata，忽略报错但提示
            const keys = jsonData.data ? Object.keys(jsonData.data).slice(0, 5).join(', ') : 'null';
            return `ℹ️ 收到数据包 (Keys: ${keys}...)，但未发现字段定义，等待下一个数据包...`;
        }

        let md = "## 全量字段表 (实时抓取)\n\n";
        md += "| 字段名 | 类型 | 属性/公式 | 字段ID |\n";
        md += "| :--- | :--- | :--- | :--- |\n";

        fields.forEach(field => {
            const typeName = this.FieldTypeMap[field.type] || `未知类型(${field.type})`;
            let extra = "-";

            // 解析特殊属性
            if (field.property) {
                // 公式
                if (field.type === 20 && field.property.formula_expression) {
                    extra = `\`${field.property.formula_expression}\``;
                }
                // 选项 (单选/多选)
                else if ((field.type === 3 || field.type === 4) && field.property.options) {
                    extra = field.property.options.map(o => o.name).join(", ");
                }
                // 关联
                else if (field.property.table_id) {
                    extra = `关联表ID: ${field.property.table_id}`;
                }
            }

            md += `| ${field.name} | ${typeName} | ${extra} | \`${field.fieldId || field.id}\` |\n`;
        });

        md += `\n> 数据生成时间: ${new Date().toLocaleTimeString()}`;
        return md;
    },

    /**
     * 生成关联关系图的 Mermaid 代码
     */
    parseRelationGraph: function (jsonData) {
        // TODO: 等待更多数据样本完善
        return "graph LR\n  A[当前表] --关联--> B[未知表]";
    },

    /**
     * 递归查找名为 'fields' 的数组
     */
    findFieldsArray: function (obj) {
        if (!obj || typeof obj !== 'object') return null;

        // 1. 直接命中
        if (Array.isArray(obj.fields)) return obj.fields;

        // 2. 遍历子对象 (只找一层或两层，防止性能问题)
        for (let key in obj) {
            if (obj[key] && typeof obj[key] === 'object') {
                if (Array.isArray(obj[key].fields)) {
                    return obj[key].fields;
                }
                // 特殊处理 data.view.fields
                if (key === 'view' && obj[key].fields) return obj[key].fields;
            }
        }
        return null;
    }
};

// 允许在 Node 环境测试 (如果需要)
if (typeof module !== 'undefined') {
    module.exports = FeishuParser;
}
