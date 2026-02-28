// relationship-parser.js
// 关联关系图生成器 (移植自 Python generate_关联关系图.py - 403 行完整逻辑)

const RelationshipParser = {
    /**
     * 获取表名，如果找不到则返回友好标记
     */
    getTableName: function (tableId, tableMap) {
        if (!tableId) return "未知表";
        const name = tableMap[tableId];
        if (name) return name;
        return `[已删除的表:${tableId}]`;
    },

    /**
     * 获取字段名，如果找不到则返回友好标记
     */
    getFieldName: function (tableId, fieldId, fieldMap) {
        if (!fieldId) return "未知字段";

        // 先尝试精确匹配
        const name = fieldMap[`${tableId}_${fieldId}`];
        if (name) return name;

        // 再尝试只用字段ID匹配（跨表引用场景）
        for (const [key, fname] of Object.entries(fieldMap)) {
            if (key.endsWith(`_${fieldId}`)) return fname;
        }

        return `[已删除的字段:${fieldId}]`;
    },

    /**
     * 将公式中的 ID 翻译为可读格式
     */
    translateFormula: function (formula, currentTableId, tableMap, fieldMap) {
        if (!formula) return "";

        // 替换表引用
        formula = formula.replace(/bitable::\$table\[(.*?)\]/g, (match, tid) => {
            return `「${this.getTableName(tid, tableMap)}」`;
        });

        // 替换字段引用
        formula = formula.replace(/\$(?:field|column)\[(.*?)\]/g, (match, fid) => {
            return `「${this.getFieldName(currentTableId, fid, fieldMap)}」`;
        });

        // 清理前缀
        formula = formula.replace("bitable::", "");

        return formula;
    },

    /**
     * 检查公式中是否引用了其他表，返回引用的表ID列表
     */
    findCrossTableReferences: function (formula, currentTableId) {
        if (!formula) return [];

        // 提取所有表引用
        const tableRefs = [];
        const regex = /bitable::\$table\[(.*?)\]/g;
        let match;
        while ((match = regex.exec(formula)) !== null) {
            tableRefs.push(match[1]);
        }

        // 过滤出外部表引用
        const externalRefs = tableRefs.filter(tid => tid !== currentTableId);

        return [...new Set(externalRefs)];
    },

    /**
     * 从公式中提取 FILTER 条件
     */
    extractFilterConditions: function (formula, currentTableId, tableMap, fieldMap) {
        if (!formula) return "";

        // 先翻译整个公式
        const translatedFormula = this.translateFormula(formula, currentTableId, tableMap, fieldMap);

        const conditions = [];

        // 提取 FILTER 内的条件表达式
        const filterRegex = /\.FILTER\((.*?)\)/gs;
        let filterMatch;
        while ((filterMatch = filterRegex.exec(translatedFormula)) !== null) {
            const filterExpr = filterMatch[1];

            // 等于条件: CurrentValue.「字段名」=...
            const eqRegex = /CurrentValue\.「([^」]+)」\s*=\s*([^&)]+)/g;
            let eqMatch;
            while ((eqMatch = eqRegex.exec(filterExpr)) !== null) {
                conditions.push(`「${eqMatch[1]}」= ${eqMatch[2].trim()}`);
            }

            // 不等于条件
            const neqRegex = /CurrentValue\.「([^」]+)」\s*!=\s*([^&)]+)/g;
            let neqMatch;
            while ((neqMatch = neqRegex.exec(filterExpr)) !== null) {
                conditions.push(`「${neqMatch[1]}」≠ ${neqMatch[2].trim()}`);
            }
        }

        if (conditions.length > 0) {
            return "筛选条件: " + conditions.join(" 且 ");
        }
        return "";
    },

    /**
     * 提取单个表中所有与外部表有关联的字段
     */
    extractRelationships: function (table, tableId, tableMap, fieldMap) {
        const relationships = [];
        const fieldMapData = table.fieldMap || {};

        for (const [fieldId, fieldDef] of Object.entries(fieldMapData)) {
            const fieldName = fieldDef.name || fieldId;
            const fieldType = fieldDef.type;
            const prop = fieldDef.property || {};

            // 1. 公式关联 (type=20)
            if (fieldType === 20) {
                const formula = prop.formula || "";
                const externalRefs = this.findCrossTableReferences(formula, tableId);

                if (externalRefs.length > 0) {
                    const targetTables = externalRefs.map(tid => this.getTableName(tid, tableMap));
                    const translatedFormula = this.translateFormula(formula, tableId, tableMap, fieldMap);
                    const filterConds = this.extractFilterConditions(formula, tableId, tableMap, fieldMap);

                    let logic = "通过公式计算引用外部表数据";
                    if (filterConds) logic += `<br>${filterConds}`;

                    relationships.push({
                        fieldName: fieldName,
                        relationType: '公式关联',
                        targetTable: targetTables.join(', '),
                        targetField: '-',
                        logic: logic,
                        formula: translatedFormula
                    });
                }
            }

            // 2. 查找引用 (type=19)
            else if (fieldType === 19) {
                const filterInfo = prop.filterInfo || {};
                const targetTid = filterInfo.targetTable;
                const targetFid = prop.targetField;

                if (targetTid) {
                    const targetTname = this.getTableName(targetTid, tableMap);
                    const targetFname = this.getFieldName(targetTid, targetFid, fieldMap);

                    // 提取完整的查找公式
                    const lookupFormula = prop.formula || "";
                    const translated = lookupFormula ? this.translateFormula(lookupFormula, tableId, tableMap, fieldMap) : "";
                    const filterConds = lookupFormula ? this.extractFilterConditions(lookupFormula, tableId, tableMap, fieldMap) : "";

                    let logic = `从「${targetTname}」的「${targetFname}」字段获取数据`;
                    if (filterConds) logic += `<br>${filterConds}`;

                    relationships.push({
                        fieldName: fieldName,
                        relationType: '查找引用',
                        targetTable: targetTname,
                        targetField: targetFname,
                        logic: logic,
                        formula: translated
                    });
                }
            }

            // 3. 关联/双向关联 (type=18, 21)
            else if (fieldType === 18 || fieldType === 21) {
                const targetTid = prop.tableId;
                if (targetTid) {
                    const targetTname = this.getTableName(targetTid, tableMap);
                    const relationType = fieldType === 21 ? '双向关联' : '单向关联';

                    relationships.push({
                        fieldName: fieldName,
                        relationType: relationType,
                        targetTable: targetTname,
                        targetField: '-',
                        logic: `与「${targetTname}」建立记录关联`,
                        formula: ''
                    });
                }
            }

            // 4. 选项同步 (单选/多选 type=3, 4 且有 optionsRule)
            else if (fieldType === 3 || fieldType === 4) {
                const optionsRule = prop.optionsRule || {};
                const targetTid = optionsRule.targetTable;
                const targetFid = optionsRule.targetField;

                if (targetTid) {
                    const targetTname = this.getTableName(targetTid, tableMap);
                    const targetFname = this.getFieldName(targetTid, targetFid, fieldMap);

                    relationships.push({
                        fieldName: fieldName,
                        relationType: '选项同步',
                        targetTable: targetTname,
                        targetField: targetFname,
                        logic: `下拉选项实时同步自「${targetTname}」的「${targetFname}」`,
                        formula: ''
                    });
                }
            }
        }

        return relationships;
    },

    /**
     * 生成关联关系图 Markdown 文档
     */
    generateDocument: function (allTables, tableMap, fieldMap) {
        let md = `# 关联关系图\n\n`;
        md += `> 生成时间: ${new Date().toLocaleString()}\n`;
        md += `> 数据表总数: ${allTables.length}\n\n`;

        md += `本文档列出了系统中所有具有 **跨表关联** 的字段，包括：\n`;
        md += `- **公式关联**: 通过公式引用其他表的数据进行计算\n`;
        md += `- **查找引用**: 从关联记录中获取特定字段的值\n`;
        md += `- **选项同步**: 下拉选项从其他表字段动态获取\n`;
        md += `- **记录关联**: 与其他表建立记录级别的关联\n\n`;

        let totalRelationships = 0;
        let tablesWithRelations = 0;

        // 按表名排序
        const sortedTables = allTables.sort((a, b) => {
            const nameA = tableMap[a.meta?.id] || "";
            const nameB = tableMap[b.meta?.id] || "";
            return nameA.localeCompare(nameB);
        });

        let tableContent = "";

        for (const table of sortedTables) {
            const tableId = table.meta?.id;
            const tableName = tableMap[tableId] || tableId;

            const relationships = this.extractRelationships(table, tableId, tableMap, fieldMap);

            if (relationships.length === 0) continue;

            tablesWithRelations++;
            totalRelationships += relationships.length;

            tableContent += `## 📊 ${tableName}\n`;
            tableContent += `- 表 ID: \`${tableId}\`\n`;
            tableContent += `- 对外关联字段数: ${relationships.length}\n\n`;

            tableContent += `| 字段名称 | 关联类型 | 目标表 | 目标字段 | 逻辑说明 |\n`;
            tableContent += `| :--- | :--- | :--- | :--- | :--- |\n`;

            // 按字段名排序
            relationships.sort((a, b) => a.fieldName.localeCompare(b.fieldName));

            for (const rel of relationships) {
                let logic = rel.logic;
                if (rel.formula) {
                    const formulaClean = rel.formula.replace(/\n/g, ' ').replace(/\|/g, '\\|');
                    logic += `<br>公式: \`${formulaClean}\``;
                }

                tableContent += `| **${rel.fieldName}** | ${rel.relationType} | ${rel.targetTable} | ${rel.targetField} | ${logic} |\n`;
            }

            tableContent += `\n---\n\n`;
        }

        // 添加统计摘要
        md += `**统计摘要**: 共 ${tablesWithRelations} 张表存在跨表关联，涉及 ${totalRelationships} 个关联字段。\n\n`;
        md += tableContent;

        return md;
    },

    /**
     * 主入口：生成关联关系图
     */
    generate: function (allTables, tableMap, fieldMap) {
        return this.generateDocument(allTables, tableMap, fieldMap);
    }
};

// Export for Node.js testing
if (typeof module !== 'undefined') {
    module.exports = RelationshipParser;
}
