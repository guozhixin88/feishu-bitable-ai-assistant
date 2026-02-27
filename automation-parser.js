// automation-parser.js
// 自动化地图生成器 (移植自 Python generate_自动化地图.py - 1190 行完整逻辑)

const AutomationParser = {
    // 操作符翻译
    OPERATORS: {
        "is": "等于", "is_not": "不等于", "isNot": "不等于",
        "contains": "包含", "does_not_contain": "不包含", "doesNotContain": "不包含",
        "is_empty": "为空", "isEmpty": "为空", "is_not_empty": "不为空", "isNotEmpty": "不为空",
        "greater_than": "大于", "isGreater": "大于", "less_than": "小于", "isLess": "小于",
        "greater_than_or_equal": "大于等于", "isGreaterEqual": "大于等于",
        "less_than_or_equal": "小于等于", "isLessEqual": "小于等于",
        "is_before": "早于", "isBefore": "早于", "is_after": "晚于", "isAfter": "晚于",
        "is_on_or_before": "不晚于", "isOnOrBefore": "不晚于",
        "is_on_or_after": "不早于", "isOnOrAfter": "不早于",
        "isAnyOf": "是以下任一", "isNoneOf": "不是以下任一"
    },

    // 动作类型翻译
    ACTION_TYPES: {
        "AddRecordAction": "新增记录", "UpdateRecordAction": "修改记录",
        "FindRecordAction": "查找记录", "IfElseBranch": "条件判断（If/Else）",
        "CustomAction": "自定义动作", "SendNotification": "发送通知",
        "SendEmail": "发送邮件", "DeleteRecordAction": "删除记录",
        "UpdateRecord": "修改记录", "AddRecord": "新增记录", "FindRecord": "查找记录",
        "Loop": "循环"
    },

    // 触发器类型翻译
    TRIGGER_TYPES: {
        "AddRecordTrigger": "新增记录时触发", "SetRecordTrigger": "记录更新时触发",
        "TimerTrigger": "定时触发", "ButtonTrigger": "按钮点击触发",
        "FormSubmitTrigger": "表单提交时触发",
        "ChangeRecordTrigger": "新增/修改的记录满足条件时触发",
        "ChangeRecordNewSatisfyTrigger": "新增/修改的记录满足条件时触发"
    },

    /**
     * 将 JSON 字符串中的大数字转换为字符串，避免精度丢失
     */
    preserveBigIntegers: function (jsonString) {
        // 匹配 "id": 数字 或 "id":数字 格式，将大数字用引号包裹
        return jsonString.replace(/"(id|blockToken)":\s*(\d{15,})/g, '"$1":"$2"');
    },

    /**
     * 解压 gzip 数据 (支持 int数组 或 Base64字符串)
     */
    decompressAutomation: function (compressedContent) {
        if (!compressedContent) return null;

        try {
            // 情况1: List of integers
            if (Array.isArray(compressedContent)) {
                const bytes = new Uint8Array(compressedContent);
                let decompressed = pako.ungzip(bytes, { to: 'string' });
                // 保护大数字 ID
                decompressed = this.preserveBigIntegers(decompressed);
                return JSON.parse(decompressed);
            }

            // 情况2: Base64 String
            if (typeof compressedContent === 'string') {
                const binaryString = atob(compressedContent);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                let decompressed = pako.ungzip(bytes, { to: 'string' });
                // 保护大数字 ID
                decompressed = this.preserveBigIntegers(decompressed);
                return JSON.parse(decompressed);
            }
        } catch (e) {
            console.error("Automation 解压失败:", e);
        }
        return null;
    },

    /**
     * 构建选项映射 (option_id -> option_name)
     */
    buildOptionMap: function (allTables) {
        const optionMap = {};
        for (const table of allTables) {
            const fieldMapData = table.fieldMap || {};
            for (const [fieldId, fieldDef] of Object.entries(fieldMapData)) {
                const options = fieldDef.property?.options || [];
                for (const opt of options) {
                    if (opt.id) {
                        optionMap[opt.id] = opt.name || opt.id;
                    }
                }
            }
        }
        return optionMap;
    },

    /**
     * 构建 blockMap (automation ID -> sidebar name)
     */
    buildBlockMap: function (snapshot) {
        const blockMap = {};
        for (const item of snapshot) {
            if (item.schema?.base?.blockInfos) {
                const blockInfos = item.schema.base.blockInfos;
                for (const [bid, info] of Object.entries(blockInfos)) {
                    const token = info.blockToken;
                    const name = info.name;
                    if (token && name) {
                        blockMap[token] = name;
                    }
                }
            }
        }
        return blockMap;
    },

    /**
     * 解析表引用ID到实际表名
     */
    resolveTableId: function (refId, wfTableMap, globalTableMap) {
        if (!refId) return "未知表";

        if (typeof refId === 'string') {
            refId = refId.replace(/^"|"$/g, '');
        }

        // 先检查工作流的映射表
        if (wfTableMap && wfTableMap[refId]) {
            const realId = (wfTableMap[refId].TableID || '').replace(/^"|"$/g, '');
            if (realId && globalTableMap[realId]) {
                const name = globalTableMap[realId];
                // 确保返回的是真正的表名，而不是 ID
                if (name !== realId) {
                    return name;
                }
            }
            // 如果有 realId，继续在全局表中查找
            if (realId && realId !== refId) {
                if (globalTableMap[realId] && globalTableMap[realId] !== realId) {
                    return globalTableMap[realId];
                }
                return `[已删除的表:${realId}]`;
            }
        }

        // 再检查全局表
        if (globalTableMap[refId]) {
            const name = globalTableMap[refId];
            // 确保返回的是真正的表名，而不是 ID
            if (name !== refId) {
                return name;
            }
        }

        return `[已删除的表:${refId}]`;
    },

    /**
     * 解析字段引用ID到实际字段名
     */
    resolveFieldId: function (refFid, wfTableMap, fieldMap) {
        if (!refFid) return "未知字段";

        if (typeof refFid === 'string') {
            refFid = refFid.replace(/^"|"$/g, '');
        }

        // 处理 ref_ref_tblXXXX_fldYYYY 或 ref_tblXXXX_fldYYYY 格式
        if (typeof refFid === 'string' && (refFid.startsWith('ref_ref_tbl') || refFid.startsWith('ref_tbl'))) {
            const match = refFid.match(/(tbl[^_]+)_(fld.+)/);
            if (match) {
                const realTid = match[1];
                const realFid = match[2];

                // 1. 尝试从 wfTableMap 查找真实表ID
                const refKey = `ref_${realTid}`;
                if (wfTableMap && wfTableMap[refKey]) {
                    const mappedTid = (wfTableMap[refKey].TableID || '').replace(/^"|"$/g, '');
                    const fname = fieldMap[`${mappedTid}_${realFid}`];
                    if (fname) return fname;
                }

                // 2. 直接尝试全局查找
                const fname = fieldMap[`${realTid}_${realFid}`];
                if (fname) return fname;

                // 3. 忽略表ID，只匹配字段ID
                for (const [key, name] of Object.entries(fieldMap)) {
                    if (key.endsWith(`_${realFid}`)) return name;
                }
            }
        }

        // 尝试从映射表中解析
        if (wfTableMap) {
            for (const [refTid, info] of Object.entries(wfTableMap)) {
                const fieldMapping = info.FieldMap || {};
                if (fieldMapping[refFid]) {
                    const realFid = fieldMapping[refFid];
                    const realTid = (info.TableID || '').replace(/^"|"$/g, '');
                    const fname = fieldMap[`${realTid}_${realFid}`];
                    if (fname) return fname;
                }
            }
        }

        // 直接查找
        for (const [key, name] of Object.entries(fieldMap)) {
            if (key.endsWith(`_${refFid}`)) return name;
        }

        return `[已删除的字段:${refFid}]`;
    },

    /**
     * 格式化值
     */
    formatValue: function (value, optionMap, depth, wfTableMap, fieldMap) {
        if (value === "") return "[空值]";
        if (value === null || value === undefined) return "[空]";

        if (typeof value === 'string') {
            if (value.startsWith('opt') && optionMap) {
                return optionMap[value] || value;
            }
            return value;
        }

        if (Array.isArray(value)) {
            if (value.length === 0) return "[空列表]";
            const formatted = value.map(v => this.formatValue(v, optionMap, depth + 1, wfTableMap, fieldMap));
            if (formatted.every(item => !item.includes('\n') && item.length < 50)) {
                return formatted.join(", ");
            }
            return formatted.map(item => `\n${"  ".repeat(depth)}- ${item}`).join("");
        }

        if (typeof value === 'object') {
            if (!value || Object.keys(value).length === 0) return "{}";

            // 特殊结构处理
            if (value.type === 'ref') {
                const tag = value.tagType || '未知';
                const step = value.stepNum || '?';
                const fields = value.fields || [];

                let fieldNameDesc = "";
                if (fields.length > 0 && fields[0].fieldId) {
                    const fn = this.resolveFieldId(fields[0].fieldId, wfTableMap, fieldMap);
                    fieldNameDesc = `的「${fn}」`;
                }

                // 尝试从 path 中提取字段
                if (!fieldNameDesc && value.path) {
                    for (const p of value.path) {
                        if (p.type === 'Field' && p.value) {
                            const fn = this.resolveFieldId(p.value, wfTableMap, fieldMap);
                            fieldNameDesc = `的「${fn}」`;
                            break;
                        }
                        if (p.type === 'RecordAttr') {
                            const attrMap = { recordId: '记录ID', record: '记录' };
                            fieldNameDesc = `的${attrMap[p.value] || p.value}`;
                            break;
                        }
                    }
                }

                if (tag === 'formula') return `[公式计算: ${value.title || '未知'}]`;
                if (tag === 'system') {
                    const sysMap = { viewUrl: '视图链接', recordUrl: '记录链接' };
                    return `[系统变量:${sysMap[value.systemType] || value.systemType}]`;
                }
                if (tag === 'RecordAttribute') {
                    const attrMap = { recordNum: '记录数', recordId: '记录ID', record: '记录', value: '值' };
                    return `[步骤${step}的${attrMap[value.attribute] || value.attribute}]`;
                }

                const tagMap = { loop: '循环当前记录', step: '结果', trigger: '触发记录' };
                const tagDesc = tagMap[tag] || tag;

                if (tag === 'loop') {
                    return fieldNameDesc ? `[步骤${step}循环${fieldNameDesc}]` : `[步骤${step}的循环当前记录]`;
                }

                return fieldNameDesc ? `[步骤${step}${fieldNameDesc}]` : `[步骤${step}的${tagDesc}]`;
            }

            const items = Object.entries(value).map(([k, v]) =>
                `${k}: ${this.formatValue(v, optionMap, depth + 1, wfTableMap, fieldMap)}`
            );
            return `{ ${items.join(", ")} }`;
        }

        return String(value);
    },

    /**
     * 解析触发器筛选条件
     */
    parseTriggerFilterCondition: function (conditionObj, wfTableMap, fieldMap, optionMap) {
        if (!conditionObj) return "";

        const conjunction = conditionObj.conjunction || 'and';
        const conditions = conditionObj.conditions || [];

        if (conditions.length === 0) return "";

        const parsedParts = [];
        for (const cond of conditions) {
            if (cond.conditions) {
                // 嵌套条件
                const nested = this.parseTriggerFilterCondition(cond, wfTableMap, fieldMap, optionMap);
                if (nested) parsedParts.push(`(${nested})`);
            } else {
                const fieldId = cond.fieldId || '';
                const operator = cond.operator || '';
                const value = cond.value || [];

                const fieldName = this.resolveFieldId(fieldId, wfTableMap, fieldMap);
                const opName = this.OPERATORS[operator] || operator;

                // 处理值
                let valueStr;
                if (Array.isArray(value)) {
                    const translated = value.map(v => {
                        if (typeof v === 'string' && v.startsWith('opt')) {
                            return optionMap[v] || v;
                        }
                        return String(v);
                    });
                    valueStr = translated.length > 0 ? translated.join(', ') : "[空]";
                } else {
                    valueStr = value ? String(value) : "[空]";
                }

                if (['isEmpty', 'isNotEmpty', 'is_empty', 'is_not_empty'].includes(operator)) {
                    parsedParts.push(`「${fieldName}」${opName}`);
                } else {
                    parsedParts.push(`「${fieldName}」${opName} "${valueStr}"`);
                }
            }
        }

        const connector = conjunction === 'and' ? " 且 " : " 或 ";
        return parsedParts.join(connector);
    },

    /**
     * 解析条件列表
     */
    parseConditionsList: function (conditions, wfTableMap, tableMap, fieldMap, optionMap, conjunction) {
        if (!conditions || conditions.length === 0) return "无条件";

        const parsed = conditions.map(cond => {
            const fieldId = cond.fieldId || '';
            const operator = cond.operator || '';
            const value = cond.value || cond.matchValue?.value;

            const fieldName = this.resolveFieldId(fieldId, wfTableMap, fieldMap);
            const opName = this.OPERATORS[operator] || operator;
            const valueStr = this.formatValue(value, optionMap, 0, wfTableMap, fieldMap);

            if (['is_empty', 'is_not_empty'].includes(operator)) {
                return `「${fieldName}」${opName}`;
            }
            return `「${fieldName}」${opName} "${valueStr}"`;
        });

        const connector = conjunction === 'or' ? " 或 " : " 且 ";
        return parsed.join(connector);
    },

    /**
     * 解析字段值设置列表
     */
    parseFieldValues: function (values, wfTableMap, fieldMap, optionMap) {
        if (!values || values.length === 0) return [];

        const result = [];
        for (const v of values) {
            if (typeof v !== 'object') continue;

            const fieldId = v.fieldId || '';
            const fieldName = this.resolveFieldId(fieldId, wfTableMap, fieldMap);
            const value = v.value || '';

            const valueStr = this.formatValue(value, optionMap, 0, wfTableMap, fieldMap);
            result.push(`- 「${fieldName}」= ${valueStr}`);
        }
        return result;
    },

    /**
     * 解析 IfElseBranch 条件
     */
    parseIfElseCondition: function (conditionObj, wfTableMap, tableMap, fieldMap, optionMap) {
        if (!conditionObj) return "无条件";

        const conjunction = conditionObj.conjunction || 'And';
        const conditions = conditionObj.conditions || [];

        if (conditions.length === 0) return "无条件";

        const parsed = [];
        for (const cond of conditions) {
            if (cond.conditions) {
                const nested = this.parseIfElseCondition(cond, wfTableMap, tableMap, fieldMap, optionMap);
                parsed.push(`(${nested})`);
            } else {
                const left = cond.leftValue || {};
                const op = cond.operator || '';
                const right = cond.rightValue || [];

                const leftDesc = this.parseValueRef(left, wfTableMap, fieldMap);
                const opDesc = this.OPERATORS[op] || op;
                const rightDesc = this.parseRightValue(right, wfTableMap, fieldMap);

                if (['isEmpty', 'isNotEmpty'].includes(op)) {
                    parsed.push(`${leftDesc} ${opDesc}`);
                } else {
                    // [Optimization] 如果右值是引用，通常不需要双引号包裹，保持与左值一致的表现
                    const needsQuotes = !rightDesc.startsWith('[');
                    if (needsQuotes) {
                        parsed.push(`${leftDesc} ${opDesc} "${rightDesc}"`);
                    } else {
                        parsed.push(`${leftDesc} ${opDesc} ${rightDesc}`);
                    }
                }
            }
        }

        const connector = conjunction.toLowerCase() === 'or' ? " 或 " : " 且 ";
        return parsed.join(connector);
    },

    /**
     * 解析值引用
     */
    parseValueRef: function (valueObj, wfTableMap, fieldMap) {
        if (!valueObj) return "未知";
        if (typeof valueObj === 'string') return valueObj;

        // RecordAttribute 步骤引用
        if (valueObj.type === 'ref' && valueObj.tagType === 'RecordAttribute') {
            const stepNum = valueObj.stepNum || '?';
            const attribute = valueObj.attribute || '';
            const stepType = valueObj.stepType || '';

            const attrMap = { recordNum: '记录数', recordId: '记录ID', record: '记录', value: '值' };
            const stepTypeMap = { FindRecordAction: '查找记录', AddRecordAction: '新增记录' };

            return `[步骤${stepNum}(${stepTypeMap[stepType] || stepType})的${attrMap[attribute] || attribute}]`;
        }

        // 步骤引用
        if (valueObj.type === 'ref' && valueObj.tagType === 'step') {
            const stepNum = valueObj.stepNum || '?';
            const fields = valueObj.fields || [];
            if (fields.length > 0 && fields[0].fieldId) {
                const fieldName = this.resolveFieldId(fields[0].fieldId, wfTableMap, fieldMap);
                return `[步骤${stepNum}的「${fieldName}」]`;
            }
            return `[步骤${stepNum}的结果]`;
        }

        // 直接字段引用
        const fields = valueObj.fields || [];
        if (fields.length > 0 && fields[0].fieldId) {
            const fieldName = this.resolveFieldId(fields[0].fieldId, wfTableMap, fieldMap);
            return `「${fieldName}」`;
        }

        return String(valueObj);
    },


    /**
     * 解析右值
     */
    parseRightValue: function (rightValue, wfTableMap, fieldMap) {
        if (!rightValue) return "";

        if (Array.isArray(rightValue)) {
            const values = rightValue.map(item => {
                if (typeof item === 'object') {
                    // [Fix] 处理右值也是引用的情况 (避免显示 "step")
                    if (item.type === 'ref') {
                        return this.parseValueRef(item, wfTableMap, fieldMap);
                    }
                    return item.text || item.value || String(item);
                }
                return String(item);
            });
            return values.join(", ");
        }

        if (typeof rightValue === 'object' && rightValue.type === 'ref') {
            return this.parseValueRef(rightValue, wfTableMap, fieldMap);
        }

        return String(rightValue);
    },

    /**
     * 解析单个步骤
     */
    parseStep: function (step, wfTableMap, tableMap, fieldMap, optionMap, stepIdMap, stepIndex, depth) {
        const indent = "  ".repeat(depth);
        const lines = [];

        const stepType = step.type || '未知类型';
        const stepTitle = step.stepTitle || this.ACTION_TYPES[stepType] || stepType;
        const stepData = step.data || {};

        const idxStr = stepIndex > 0 ? ` ${stepIndex}` : "";
        lines.push(`${indent}- **步骤${idxStr}: ${stepTitle}**`);
        // 增加步骤ID用于变动检测
        if (step.stepId || step.id) {
            lines.push(`${indent}  - **步骤ID**: \`${step.stepId || step.id}\``);
        }

        // 涉及的表
        const tableId = stepData.tableId;
        if (tableId) {
            const tableName = this.resolveTableId(tableId, wfTableMap, tableMap);
            lines.push(`${indent}  - 涉及表: 「${tableName}」`);
        }

        // ChangeRecordTrigger
        if (stepType === 'ChangeRecordTrigger') {
            const fields = stepData.fields || [];
            if (fields.length > 0) {
                const condParts = fields.map(f => {
                    const fname = this.resolveFieldId(f.fieldId, wfTableMap, fieldMap);
                    const op = f.operator || '';
                    const value = f.value || [];
                    const opName = this.OPERATORS[op] || op;

                    if (['isEmpty', 'isNotEmpty'].includes(op)) {
                        return `「${fname}」${opName}`;
                    }

                    let valStr;
                    if (Array.isArray(value)) {
                        valStr = value.map(v => {
                            if (typeof v === 'string' && v.startsWith('opt')) {
                                return optionMap[v] || v;
                            }
                            return String(v);
                        }).join(', ');
                    } else {
                        valStr = optionMap[value] || String(value);
                    }
                    if (valStr === "") valStr = "[空值]";
                    return `「${fname}」${opName} "${valStr}"`;
                });
                lines.push(`${indent}  - 触发条件: ${condParts.join(' 且 ')}`);
            }

            const triggerList = stepData.triggerControlList || [];
            if (triggerList.length > 0) {
                const triggerMap = {
                    pasteUpdate: '粘贴更新', automationBatchUpdate: '自动化批量更新',
                    appendImport: '追加导入', openAPIBatchUpdate: 'API批量更新'
                };
                const triggers = triggerList.map(t => triggerMap[t] || t);
                lines.push(`${indent}  - 触发来源: ${triggers.join(', ')}`);
            }
        }

        // AddRecordTrigger
        if (stepType === 'AddRecordTrigger') {
            const watchedFid = stepData.watchedFieldId;
            if (watchedFid) {
                const fname = this.resolveFieldId(watchedFid, wfTableMap, fieldMap);
                lines.push(`${indent}  - 监听字段: 「${fname}」`);
            }
        }

        // 通用触发条件处理 (next.condition)
        const nextList = step.next || [];
        if (nextList.length > 0 && nextList[0]?.condition) {
            const condDesc = this.parseTriggerFilterCondition(nextList[0].condition, wfTableMap, fieldMap, optionMap);
            if (condDesc) {
                lines.push(`${indent}  - **触发筛选条件**: ${condDesc}`);
            }
        }

        // SetRecordTrigger
        if (stepType === 'SetRecordTrigger') {
            const fields = stepData.fields || [];
            if (fields.length > 0) {
                const fieldNames = fields.map(f => this.resolveFieldId(f.fieldId, wfTableMap, fieldMap));
                lines.push(`${indent}  - 监听字段: ${fieldNames.map(n => `「${n}」`).join(', ')}`);
            }
        }

        // TimerTrigger
        if (stepType === 'TimerTrigger') {
            const rule = stepData.rule || '';
            const startTime = stepData.startTime;
            if (startTime) {
                const dt = new Date(startTime);
                lines.push(`${indent}  - 开始时间: ${dt.toLocaleString()}`);
            }
            const ruleMap = { MONTHLY: '每月', WEEKLY: '每周', DAILY: '每天', HOURLY: '每小时' };
            lines.push(`${indent}  - 重复规则: ${ruleMap[rule] || rule}`);
        }

        // FindRecordAction
        if (['FindRecordAction', 'FindRecord'].includes(stepType)) {
            const recordInfo = stepData.recordInfo || {};
            const fieldIds = stepData.fieldIds;
            if (fieldIds && fieldIds.length > 0) {
                const fieldNames = fieldIds.map(fid => this.resolveFieldId(fid, wfTableMap, fieldMap));
                lines.push(`${indent}  - 返回字段: ${fieldNames.map(n => `「${n}」`).join(', ')}`);
            }

            const recordType = stepData.recordType;
            if (recordType === 'Ref' && recordInfo.stepId) {
                const refStepNum = stepIdMap[recordInfo.stepId] || '?';
                lines.push(`${indent}  - 查找方式: 基于步骤${refStepNum}返回的记录进行筛选`);
            } else if (recordInfo.conditions) {
                const condStr = this.parseConditionsList(recordInfo.conditions, wfTableMap, tableMap, fieldMap, optionMap);
                lines.push(`${indent}  - 查找条件: ${condStr}`);
            } else {
                lines.push(`${indent}  - 查找条件: 无（返回所有记录）`);
            }

            if (stepData.shouldProceedWithNoResults) {
                lines.push(`${indent}  - 无结果时: 继续执行`);
            }
        }

        // ButtonTrigger
        if (stepType === 'ButtonTrigger') {
            const buttonType = stepData.buttonType;
            const typeMap = { buttonField: '字段按钮触发', recordMenu: '记录菜单触发' };
            lines.push(`${indent}  - 按钮类型: ${typeMap[buttonType] || buttonType}`);
        }

        // AddRecordAction / AddRecord
        if (['AddRecordAction', 'AddRecord'].includes(stepType)) {
            const values = stepData.values || [];
            if (values.length > 0) {
                const fieldValues = this.parseFieldValues(values, wfTableMap, fieldMap, optionMap);
                if (fieldValues.length > 0) {
                    lines.push(`${indent}  - 设置字段:`);
                    for (const fv of fieldValues) {
                        lines.push(`${indent}    ${fv}`);
                    }
                }
            }
        }

        // UpdateRecordAction / UpdateRecord / SetRecordAction
        if (['SetRecordAction', 'UpdateRecordAction', 'UpdateRecord'].includes(stepType)) {
            const recordType = stepData.recordType || '';
            const recordInfo = stepData.recordInfo || {};

            if (recordType === 'stepRecord' || recordInfo.type === 'ref') {
                const stepNum = recordInfo.stepNum || '?';
                lines.push(`${indent}  - 修改对象: [步骤${stepNum}找到的记录]`);
            } else if (recordInfo.conditions) {
                const condStr = this.parseConditionsList(recordInfo.conditions, wfTableMap, tableMap, fieldMap, optionMap);
                lines.push(`${indent}  - 修改条件: ${condStr}`);
            }

            const values = stepData.values || [];
            if (values.length > 0) {
                const fieldValues = this.parseFieldValues(values, wfTableMap, fieldMap, optionMap);
                if (fieldValues.length > 0) {
                    lines.push(`${indent}  - 设置字段:`);
                    for (const fv of fieldValues) {
                        lines.push(`${indent}    ${fv}`);
                    }
                }
            }
        }

        // Loop
        if (stepType === 'Loop') {
            const loopType = stepData.loopType || '';
            const loopData = stepData.loopData || {};
            const maxTimes = stepData.maxLoopTimes || 0;

            const loopTypeMap = { forEach: '遍历每条记录', times: '固定次数' };
            lines.push(`${indent}  - 循环类型: ${loopTypeMap[loopType] || loopType}`);

            if (loopData.type === 'ref') {
                const stepNum = loopData.stepNum || '?';
                lines.push(`${indent}  - 循环数据: [步骤${stepNum}找到的记录]`);
            }

            if (maxTimes) {
                lines.push(`${indent}  - 最大循环次数: ${maxTimes}`);
            }
        }

        // IfElseBranch
        if (stepType === 'IfElseBranch') {
            const conditionObj = stepData.condition || {};
            const meetId = stepData.meetConditionStepId;
            const notMeetId = stepData.notMeetConditionStepId;

            if (Object.keys(conditionObj).length > 0) {
                const condDesc = this.parseIfElseCondition(conditionObj, wfTableMap, tableMap, fieldMap, optionMap);
                lines.push(`${indent}  - **判断条件**: ${condDesc}`);
            }

            if (meetId) {
                const meetNum = stepIdMap[meetId] || '?';
                lines.push(`${indent}  - ✅ 满足时: 跳转至步骤 ${meetNum}`);
            } else {
                lines.push(`${indent}  - ✅ 满足时: 继续执行`);
            }

            if (notMeetId) {
                const notMeetNum = stepIdMap[notMeetId] || '?';
                lines.push(`${indent}  - ❌ 不满足: 跳转至步骤 ${notMeetNum}`);
            } else {
                lines.push(`${indent}  - ❌ 不满足: (无动作)`);
            }
        }

        // CustomAction
        if (stepType === 'CustomAction') {
            const packId = stepData.packId || '';
            const formData = stepData.formData || {};

            lines.push(`${indent}  - 动作类型: 自定义动作 (packId: ${packId})`);
            if (formData && (Array.isArray(formData) ? formData.length > 0 : Object.keys(formData).length > 0)) {
                lines.push(`${indent}  - 配置详情:`);

                if (Array.isArray(formData)) {
                    for (const item of formData) {
                        if (typeof item !== 'object') continue;
                        const label = item.label || item.key || '配置项';
                        const val = item.value || '';

                        let valText = "";
                        if (Array.isArray(val)) {
                            const parts = val.map(v => {
                                if (typeof v === 'object') {
                                    if (v.text) return v.text;
                                    return this.formatValue(v, optionMap, 0, wfTableMap, fieldMap);
                                }
                                return String(v);
                            });
                            valText = parts.join("");
                        } else {
                            valText = this.formatValue(val, optionMap, 0, wfTableMap, fieldMap);
                        }

                        lines.push(`${indent}    - ${label}: ${valText}`);
                    }
                }
            }
        }

        return lines;
    },

    /**
     * 解析单个工作流
     */
    parseWorkflow: function (wfItem, tableMap, fieldMap, optionMap, blockMap) {
        const lines = [];

        const extra = wfItem.WorkflowExtra || {};

        // [New] 优先解析 FlowSchema (新版结构)

        const draftStr = extra.Draft || '{}';

        let draft;
        try {
            draft = typeof draftStr === 'string' ? JSON.parse(draftStr) : draftStr;
        } catch {
            draft = {};
        }

        if (typeof draft !== 'object') return lines;

        const wfTableMap = extra.Extra?.TableMap || {};

        // 工作流 ID (确保是字符串，避免大数字精度丢失)
        const wfId = String(wfItem.id || '未知');
        let title = draft.title;

        // 优先使用侧边栏名称 (blockMap)
        if (!title && blockMap) {
            title = blockMap[wfId];
            // 如果没找到，尝试去除可能的引号
            if (!title) {
                title = blockMap[wfId.replace(/^"|"$/g, '')];
            }
        }

        // 根据触发器生成描述性标题
        if (!title) {
            const steps = draft.steps || [];
            if (steps.length > 0) {
                const firstStep = steps[0];
                const stype = firstStep.type;
                const sdata = firstStep.data || {};

                const tid = sdata.tableId || sdata.watchedCustomTableId;
                const tname = tid ? this.resolveTableId(tid, wfTableMap, tableMap) : "未知表";

                const titleMap = {
                    ChangeRecordTrigger: `当「${tname}」记录变更时`,
                    AddRecordTrigger: `当「${tname}」新增记录时`,
                    SetRecordTrigger: `当「${tname}」记录满足条件时`,
                    TimerTrigger: `定时触发 (基于「${tname}」)`,
                    ButtonTrigger: `按钮触发 (「${tname}」)`
                };
                title = titleMap[stype] || `${this.ACTION_TYPES[stype] || stype} (「${tname}」)`;
            } else {
                title = "未命名工作流";
            }
        }

        const status = wfItem.status || 0;
        const statusStr = status === 1 ? "✅ 已启用" : "⚪ 已禁用";

        lines.push(`## ${title}`);
        lines.push(`- **工作流 ID**: \`${wfId}\``);
        lines.push(`- **状态**: ${statusStr}`);

        // 解析步骤
        const steps = draft.steps || [];
        if (steps.length > 0) {
            // 建立步骤ID到序号的映射
            const stepIdMap = {};
            for (let i = 0; i < steps.length; i++) {
                if (steps[i].id) {
                    stepIdMap[steps[i].id] = i + 1;
                }
            }

            lines.push("- **执行逻辑**:");
            for (let i = 0; i < steps.length; i++) {
                const stepLines = this.parseStep(steps[i], wfTableMap, tableMap, fieldMap, optionMap, stepIdMap, i + 1, 0);
                lines.push(...stepLines);
            }
        }

        lines.push("\n---\n");
        return lines;
    },

    /**
     * 生成自动化地图文档
     */
    generateDocument: function (workflows, tableMap, fieldMap, optionMap, blockMap, hiddenCount = 0) {
        const doc = [];
        doc.push("# 自动化地图\n");
        doc.push(`> 生成时间: ${new Date().toLocaleString()}\n`);
        doc.push(`> 工作流总数: ${workflows.length}\n\n`);

        const enabledCount = workflows.filter(wf => wf.status === 1).length;
        const disabledCount = workflows.length - enabledCount;
        doc.push(`- 已启用: ${enabledCount} 个\n`);
        doc.push(`- 已禁用: ${disabledCount} 个\n`);
        if (hiddenCount > 0) {
            doc.push(`- 已从界面移除: ${hiddenCount} 个 (不显示)\n`);
        }
        doc.push("\n---\n");

        doc.push("\n> **🔍 如何对应飞书界面？**");
        doc.push("> 1. **看名字**：文档已读取飞书侧边栏的真实名称，与界面完全一致。");
        doc.push("> 2. **看 ID**：如果需要精确排查，可参考自动化 ID。\n");

        const enabledWfs = [];
        const disabledWfs = [];

        for (const wf of workflows) {
            const wfLines = this.parseWorkflow(wf, tableMap, fieldMap, optionMap, blockMap);
            if (wf.status === 1) {
                enabledWfs.push(wfLines);
            } else {
                disabledWfs.push(wfLines);
            }
        }

        if (enabledWfs.length > 0) {
            doc.push(`### ✅ 已启用`);
            enabledWfs.forEach(wfLines => doc.push(...wfLines));
        }

        if (disabledWfs.length > 0) {
            doc.push(`### ⚪ 已禁用`);
            disabledWfs.forEach(wfLines => doc.push(...wfLines));
        }

        return doc.join("\n");
    },

    /**
     * 主入口：生成自动化地图
     */
    generate: function (gzipAutomation, snapshot, tableMap, fieldMap, allTables) {
        // 解压自动化数据
        const workflows = this.decompressAutomation(gzipAutomation);
        if (!workflows || !Array.isArray(workflows)) {
            return { success: false, error: "自动化数据解压失败或为空" };
        }

        // 构建选项映射
        const optionMap = this.buildOptionMap(allTables);

        // 构建 blockMap
        const blockMap = this.buildBlockMap(snapshot);

        // 过滤：只保留在 blockMap 中存在的工作流（即在界面上显示的）
        // 如果工作流 ID 不在 blockMap 中，说明已从飞书界面移除/隐藏
        const visibleWorkflows = workflows.filter(wf => {
            const wfId = String(wf.id || '');
            const hasBlockEntry = blockMap[wfId] !== undefined;

            // 如果工作流有标题（draft.title）也保留
            const extra = wf.WorkflowExtra || {};
            let draft;
            try {
                draft = typeof extra.Draft === 'string' ? JSON.parse(extra.Draft) : (extra.Draft || {});
            } catch { draft = {}; }
            const hasTitle = draft.title && draft.title.trim() !== '';

            return hasBlockEntry || hasTitle;
        });

        const hiddenCount = workflows.length - visibleWorkflows.length;

        // 生成文档
        const md = this.generateDocument(visibleWorkflows, tableMap, fieldMap, optionMap, blockMap, hiddenCount);

        return {
            success: true,
            workflowCount: visibleWorkflows.length,
            hiddenCount: hiddenCount,
            enabledCount: visibleWorkflows.filter(wf => wf.status === 1).length,
            automationMd: md
        };
    }
};

// Export for Node.js testing
if (typeof module !== 'undefined') {
    module.exports = AutomationParser;
}
