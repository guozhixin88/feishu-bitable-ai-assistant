// change-detector.js - 结构化 JSON 对比 (v4.0)
const ChangeDetector = {
    /**
     * 对比两个项目数据 (JSON 结构)
     * @param {Object} oldData - { projectData, maps } from parseBaseFileStruct
     * @param {Object} newData - { projectData, maps } from parseBaseFileStruct
     */
    diff: function (oldData, newData) {
        if (!oldData || !newData) return null;

        const changes = {
            fields: [],      // 字段表变动
            automations: []  // 自动化变动
        };

        const oldP = oldData.projectData;
        const newP = newData.projectData;

        // 使用新的映射表来生成所有名称，确保显示的是最新状态
        // 但对于“删除”的项，可能需要回退到旧映射表 (TODO: 细化)
        const maps = newData.maps;
        const oldMaps = oldData.maps;

        // 1. 对比数据表
        this.diffTables(oldP.tables, newP.tables, changes, maps, oldMaps);

        // 2. 对比自动化
        this.diffAutomations(oldP.automation, newP.automation, changes, maps, oldMaps);

        return changes;
    },

    /**
     * 生成报告 (Markdown)
     * 此方法现在只负责渲染 changes 对象，不再负责逻辑
     */
    generateMarkdown: function (changes) {
        if (!changes) return '';
        const { fields, automations } = changes;
        const totalCount = fields.length + automations.length;

        if (totalCount === 0) {
            return '# 📊 变动报告\n\n> ✅ 未检测到变动\n\n文档内容保持一致。';
        }

        let md = `# 📊 变动报告\n\n> 检测到 ${totalCount} 处变动\n\n`;

        // 1. 字段表变动渲染
        if (fields.length > 0) {
            md += `## 📋 全量字段表变动\n\n`;

            // 分组
            const grouped = {};
            for (const item of fields) {
                if (item.type === 'table_add' || item.type === 'table_delete') {
                    if (!grouped['__ALL__']) grouped['__ALL__'] = [];
                    grouped['__ALL__'].push(item);
                } else {
                    if (!grouped[item.tableName]) grouped[item.tableName] = [];
                    grouped[item.tableName].push(item);
                }
            }

            // 表级变动
            if (grouped['__ALL__']) {
                grouped['__ALL__'].forEach(item => {
                    if (item.type === 'table_add') md += `- 🟢 **新增数据表**: ${item.name}\n`;
                    if (item.type === 'table_delete') md += `- 🔴 **删除数据表**: ${item.name}\n`;
                });
                md += '\n';
            }

            // 字段级变动
            for (const [tableName, items] of Object.entries(grouped)) {
                if (tableName === '__ALL__') continue;
                md += `### 「${tableName}」\n\n`;

                const tableHeader = `| 变更 | 字段名称 | 字段类型 | 业务描述 | 完整配置/公式 | 字段ID |\n| :--- | :--- | :--- | :--- | :--- | :--- |\n`;
                md += tableHeader;

                for (const item of items) {
                    const typeIcon = {
                        add: '🟢 新增',
                        delete: '🔴 删除',
                        modify: '🟡 修改'
                    }[item.type];

                    const row = (name, type, desc, config, id) => {
                        // 处理换行和竖线
                        const clean = (s) => (s || '').replace(/\n/g, ' ').replace(/\|/g, '\\|');
                        return `| ${typeIcon} | **${clean(name)}** | ${clean(type)} | ${clean(desc)} | ${clean(config)} | \`${id}\` |`;
                    };

                    if (item.type === 'add') {
                        md += row(item.name, item.fieldType, item.desc, item.config, item.id) + '\n';
                    } else if (item.type === 'delete') {
                        md += row(item.name, item.fieldType, item.desc, item.config, item.id) + '\n';
                    } else if (item.type === 'modify') {
                        // 修改显示两行: 旧 -> 新
                        // 第一行: 旧
                        md += `| 🔴 旧 | **${item.name}** | ${item.oldFieldType} | ${item.oldDesc} | ${item.oldConfig} | \`${item.id}\` |\n`;
                        // 第二行: 新 (高亮差异?)
                        md += `| 🟢 新 | **${item.newName}** | ${item.newFieldType} | ${item.newDesc} | ${item.newConfig} | \`${item.id}\` |\n`;

                        // 简要说明差异点
                        const diffs = [];
                        if (item.name !== item.newName) diffs.push(`重命名`);
                        if (item.oldFieldType !== item.newFieldType) diffs.push(`类型变更`);
                        if (item.oldConfig !== item.newConfig) diffs.push(`配置变更`);
                        if (diffs.length > 0) {
                            // md += `> 📝 ${diffs.join(', ')}\n`; // 表格里放不下，或者放上面？算了表格已经很清楚了
                        }
                    }
                }
                md += '\n';
            }
        }

        // 2. 自动化变动渲染
        if (automations.length > 0) {
            md += `## ⚡ 自动化地图变动\n\n`;

            const grouped = {};
            for (const item of automations) {
                if (['wf_add', 'wf_delete'].includes(item.type)) {
                    // 工作流级
                    if (!grouped['__ALL__']) grouped['__ALL__'] = [];
                    grouped['__ALL__'].push(item);
                } else {
                    // 步骤级
                    if (!grouped[item.wfName]) grouped[item.wfName] = [];
                    grouped[item.wfName].push(item);
                }
            }

            if (grouped['__ALL__']) {
                grouped['__ALL__'].forEach(item => {
                    if (item.type === 'wf_add') md += `- 🟢 **新增工作流**: ${item.name}\n`;
                    if (item.type === 'wf_delete') md += `- 🔴 **删除工作流**: ${item.name}\n`;
                });
                md += '\n';
            }

            for (const [wfName, items] of Object.entries(grouped)) {
                if (wfName === '__ALL__') continue;
                md += `### 工作流: 「${wfName}」\n`;

                for (const item of items) {
                    if (item.type === 'step_add') {
                        md += `- 🟢 **新增步骤**: ${item.stepTitle} (ID: \`${item.stepId}\`)\n`;
                    } else if (item.type === 'step_delete') {
                        md += `- 🔴 **删除步骤**: ${item.stepTitle} (ID: \`${item.stepId}\`)\n`;
                    } else if (item.type === 'step_modify') {
                        md += `- 🟡 **修改步骤**: ${item.newStepTitle} (ID: \`${item.stepId}\`)\n`;
                        // 渲染差异详情
                        if (item.nameChanged) {
                            md += `  - 🏷️ **标题变更**: "${item.oldStepTitle}" ➔ "${item.newStepTitle}"\n`;
                        }
                        if (item.contentChanged) {
                            md += `  - 📝 **内容/配置变更**:\n`;
                            // Side-by-side comparison logic is hard in markdown list
                            // Let's use formatted quote blocks
                            md += `    > 🔴 **旧配置**:\n`;
                            item.oldContentLines.forEach(l => md += `    > ${l.trim()}\n`);
                            md += `    >\n    > 🟢 **新配置**:\n`;
                            item.newContentLines.forEach(l => md += `    > ${l.trim()}\n`);
                        }
                    }
                }
                md += '\n';
            }
        }

        return md;
    },

    // ================= 内部对比逻辑 =================

    diffTables: function (oldTables, newTables, changes, maps, oldMaps) {
        const oldIds = new Set(Object.keys(oldTables));
        const newIds = new Set(Object.keys(newTables));

        // 1. Check Deleted
        for (const tid of oldIds) {
            if (!newIds.has(tid)) {
                changes.fields.push({
                    type: 'table_delete',
                    name: oldMaps.tableMap[tid] || oldTables[tid].name || tid
                });
            }
        }

        // 2. Check Added & Modified
        for (const tid of newIds) {
            if (!oldIds.has(tid)) {
                changes.fields.push({
                    type: 'table_add',
                    name: maps.tableMap[tid] || newTables[tid].name || tid
                });
            } else {
                // Table exists in both, diff fields
                this.diffFields(tid, oldTables[tid], newTables[tid], changes, maps, oldMaps);
            }
        }
    },

    diffFields: function (tid, oldTable, newTable, changes, maps, oldMaps) {
        const oldFields = oldTable.fields; // { fid: fieldDef }
        const newFields = newTable.fields;

        const oldFids = new Set(Object.keys(oldFields));
        const newFids = new Set(Object.keys(newFields));
        const tableName = maps.tableMap[tid] || newTable.name;

        // Helper to generate semantic config string using BaseFileParser
        const getConfig = (fdef, tableId, mapCtx) => {
            // Mock fieldDef structure for extractFieldConfig
            // struct: { name, type, property, description }
            // extractFieldConfig needs: { type, property, ext, exInfo... }
            // So we passed the mostly raw object in parseBaseFileStruct
            const { configText, description } = BaseFileParser.extractFieldConfig(fdef, tableId, mapCtx.tableMap, mapCtx.fieldMap);
            return {
                config: configText,
                desc: description,
                typeName: BaseFileParser.getFieldTypeName(fdef.type)
            };
        };

        // 1. Deleted Fields
        for (const fid of oldFids) {
            if (!newFids.has(fid)) {
                const f = oldFields[fid];
                const info = getConfig(f, tid, oldMaps);
                changes.fields.push({
                    type: 'delete',
                    tableName: tableName,
                    id: fid,
                    name: f.name,
                    fieldType: info.typeName,
                    desc: info.desc,
                    config: info.config
                });
            }
        }

        // 2. Added & Modified
        for (const fid of newFids) {
            const fNew = newFields[fid];
            const infoNew = getConfig(fNew, tid, maps);

            if (!oldFids.has(fid)) {
                changes.fields.push({
                    type: 'add',
                    tableName: tableName,
                    id: fid,
                    name: fNew.name,
                    fieldType: infoNew.typeName,
                    desc: infoNew.desc,
                    config: infoNew.config
                });
            } else {
                const fOld = oldFields[fid];
                const infoOld = getConfig(fOld, tid, oldMaps);

                // Compare semantic equality
                const isModified =
                    fNew.name !== fOld.name ||
                    fNew.type !== fOld.type ||
                    infoNew.config !== infoOld.config || // 核心：配置文本变了
                    infoNew.desc !== infoOld.desc;

                if (isModified) {
                    changes.fields.push({
                        type: 'modify',
                        tableName: tableName,
                        id: fid,
                        // Old Info
                        name: fOld.name,
                        oldFieldType: infoOld.typeName,
                        oldDesc: infoOld.desc,
                        oldConfig: infoOld.config,
                        // New Info
                        newName: fNew.name,
                        newFieldType: infoNew.typeName,
                        newDesc: infoNew.desc,
                        newConfig: infoNew.config
                    });
                }
            }
        }
    },

    diffAutomations: function (oldAuto, newAuto, changes, maps, oldMaps) {
        // Decompress raw automation data using AutomationParser
        // Note: AutomationParser is global
        const oldList = AutomationParser.decompressAutomation(oldAuto.gzip) || [];
        const newList = AutomationParser.decompressAutomation(newAuto.gzip) || [];

        // Build Map by Workflow ID
        const buildWfMap = (list) => {
            const m = new Map();
            list.forEach(w => m.set(String(w.id), w));
            return m;
        };
        const oldMap = buildWfMap(oldList);
        const newMap = buildWfMap(newList);

        const oldIds = new Set(oldMap.keys());
        const newIds = new Set(newMap.keys());

        // Helper to get workflow name
        const getWfName = (wf, blockInfos) => {
            // 简化的逻辑，尝试从 blockInfo 或 Title 获取
            const wfId = String(wf.id);
            let name = wf.WorkflowExtra?.Draft?.title;
            if (!name && blockInfos) {
                // Try to find name in blockInfos
                for (const info of Object.values(blockInfos)) {
                    if (info.blockToken === wfId) return info.name;
                }
            }
            return name || `未命名工作流(${wfId})`;
        };

        // 1. Deleted Workflows
        for (const wid of oldIds) {
            if (!newIds.has(wid)) {
                changes.automations.push({
                    type: 'wf_delete',
                    name: getWfName(oldMap.get(wid), oldAuto.blockInfos),
                    wfId: wid
                });
            }
        }

        // 2. Added & Modified
        for (const wid of newIds) {
            const wfNew = newMap.get(wid);
            const nameNew = getWfName(wfNew, newAuto.blockInfos);

            if (!oldIds.has(wid)) {
                changes.automations.push({
                    type: 'wf_add',
                    name: nameNew,
                    wfId: wid
                });
            } else {
                const wfOld = oldMap.get(wid);
                // Diff steps
                this.diffSteps(wid, nameNew, wfOld, wfNew, changes, maps, oldMaps);
            }
        }
    },

    diffSteps: function (wfId, wfName, oldWf, newWf, changes, maps, oldMaps) {
        // Steps are in wf.WorkflowExtra.Draft.steps
        const getSteps = (wf) => {
            const draft = typeof wf.WorkflowExtra?.Draft === 'string'
                ? JSON.parse(wf.WorkflowExtra.Draft)
                : (wf.WorkflowExtra?.Draft || {});
            return draft.steps || [];
        };

        const oldSteps = getSteps(oldWf);
        const newSteps = getSteps(newWf);

        // Build Map by Step ID
        // Note: steps structure usually has 'id' or 'stepId'? 
        // AutomationParser says "step.stepId || step.id"
        const buildStepMap = (steps) => {
            const m = new Map();
            steps.forEach(s => {
                const sid = String(s.id || s.stepId || 'unknown');
                m.set(sid, s);
            });
            return m;
        };

        const oldSMap = buildStepMap(oldSteps);
        const newSMap = buildStepMap(newSteps);

        const oldSIds = new Set(oldSMap.keys());
        const newSIds = new Set(newSMap.keys());

        // Helper: Generate Semantic Text for Step using AutomationParser
        // This is the "Semantic Diff" magic
        const getStepText = (step, mapCtx, index) => {
            // AutomationParser.parseStep returns Array of Strings
            // We need to construct a stepIdMap if needed? 
            // Parsing single step might be tricky if it depends on stepIndex context
            // But let's try our best.
            // Also it needs wfTableMap from the workflow.
            const wfExtra = oldWf.WorkflowExtra?.Extra || {}; // Approximate context
            const lines = AutomationParser.parseStep(
                step,
                wfExtra.TableMap, // Attempt to pass table map
                mapCtx.tableMap,
                mapCtx.fieldMap,
                {}, // optionMap (might be missing, acceptable)
                {}, // stepIdMap (for references, might be missing, acceptable)
                index, // step index
                0 // depth
            );
            return lines;
        };

        // We iterate steps in order of NEW workflow to look for modifications
        // But handling reorder is complex. Let's stick to ID matching.

        // 1. Deleted Steps
        for (const sid of oldSIds) {
            if (!newSIds.has(sid)) {
                // Get name from text
                const textLines = getStepText(oldSMap.get(sid), oldMaps, -1);
                const title = textLines[0].replace(/.*Steps\d+: /, '').replace(/\*\*/g, '').trim(); // Rough extraction
                changes.automations.push({
                    type: 'step_delete',
                    wfName: wfName,
                    stepId: sid,
                    stepTitle: title
                });
            }
        }

        // 2. Added & Modified
        newSteps.forEach((sNew, idx) => {
            const sid = String(sNew.id || sNew.stepId);
            const textLinesNew = getStepText(sNew, maps, idx + 1);
            // Title extraction logic relies on AutomationParser format: "- **步骤X: Title**"
            // Let's refine parsing or just use the whole first line
            let titleNew = textLinesNew[0] || '未知步骤';
            // Remove indentation and bullets
            titleNew = titleNew.replace(/^\s*-\s*\*\*(.*?)\*\*/, '$1');

            if (!oldSIds.has(sid)) {
                changes.automations.push({
                    type: 'step_add',
                    wfName: wfName,
                    stepId: sid,
                    stepTitle: titleNew
                });
            } else {
                const sOld = oldSMap.get(sid);
                const textLinesOld = getStepText(sOld, oldMaps, idx + 1); // Pass same index for fair comparison
                let titleOld = textLinesOld[0] || '未知步骤';
                titleOld = titleOld.replace(/^\s*-\s*\*\*(.*?)\*\*/, '$1');

                // Compare Body (Content)
                // Filter out Step ID lines to avoid noise
                const clean = lines => lines.filter(l => !l.includes('步骤ID'));
                const bodyOld = clean(textLinesOld).join('\n');
                const bodyNew = clean(textLinesNew).join('\n');

                if (bodyOld !== bodyNew) {
                    changes.automations.push({
                        type: 'step_modify',
                        wfName: wfName,
                        stepId: sid,
                        oldStepTitle: titleOld,
                        newStepTitle: titleNew,
                        nameChanged: titleOld !== titleNew,
                        contentChanged: bodyOld !== bodyNew,
                        oldContentLines: clean(textLinesOld),
                        newContentLines: clean(textLinesNew)
                    });
                }
            }
        });
    }
};

if (typeof module !== 'undefined') module.exports = ChangeDetector;
