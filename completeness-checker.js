// completeness-checker.js
// 完整性校验器 (移植自 Python completeness_checker.py - 388 行完整逻辑)

const CompletenessChecker = {
    // 已知的、已被解析器处理的步骤字段
    KNOWN_STEP_KEYS: new Set([
        // 通用
        'type', 'id', 'data', 'stepTitle', 'next',
        // 触发器
        'tableId', 'fields', 'triggerControlList', 'watchedFieldId', 'rule', 'startTime',
        'buttonType',
        // 查找记录
        'recordInfo', 'fieldsMap', 'fieldIds', 'recordType', 'shouldProceedWithNoResults',
        // 修改/新增记录
        'recordList', 'updateFields', 'values', 'maxSetRecordNum',
        // 条件分支
        'condition', 'ifStepId', 'elseStepId', 'meetConditionStepId', 'notMeetConditionStepId',
        // 循环
        'loopType', 'loopData', 'loopStartStepId', 'maxLoopCount', 'maxLoopTimes', 'loopMode', 'startChildStepId',
        // CustomAction
        'packId', 'formData', 'version', 'endpointId', 'resultTypeInfo', 'packType',
        // 其他常见字段
        'filterInfo', 'isEnabled', 'stepNum', 'watchedCustomTableId'
    ]),

    KNOWN_WORKFLOW_KEYS: new Set([
        'id', 'base_id', 'trigger_name', 'creator', 'editor', 'status', 'delete_flag',
        'created_time', 'updated_time', 'source', 'access_mode', 'webhook_token',
        'biz_type', 'nodeSchema', 'WorkflowExtra'
    ]),

    KNOWN_DRAFT_KEYS: new Set(['title', 'steps', 'version']),

    /**
     * 分析数据中的未知键
     */
    analyzeUnknownKeys: function (data, knownKeys, context) {
        const unknown = {};
        if (typeof data === 'object' && data !== null) {
            for (const [k, v] of Object.entries(data)) {
                if (!knownKeys.has(k)) {
                    unknown[k] = {
                        context: context,
                        valueType: typeof v,
                        sample: String(v).substring(0, 200) || "[空]"
                    };
                }
            }
        }
        return unknown;
    },

    /**
     * ID 匹配模式
     */
    ID_PATTERNS: [
        { regex: /\[未知(?:字段|表|选项|引用)[^:\]]*:([^\]]+)\]/g, issueType: '显式未知项', category: '未解析' },
        { regex: /\[已删除的(?:字段|表)[^:\]]*:([^\]]+)\]/g, issueType: '已删除引用', category: '未解析' },
        { regex: /\[步骤\d+的(?:字段|formula|结果)\]/g, issueType: '模糊引用', category: '可读性差' },
        { regex: /\[步骤\d+的循环当前记录\]/g, issueType: '模糊循环', category: '可读性差' },
        { regex: /\b(is|isNot|contains|doesNotContain|isEmpty|isNotEmpty)\b/g, issueType: '未翻译操作符', category: '英文残留' }
    ],

    /**
     * 扫描生成的 Markdown 内容，检查未翻译的 ID
     */
    scanDocument: function (content, docName, validIds) {
        const untranslatedItems = [];

        for (const { regex, issueType, category } of this.ID_PATTERNS) {
            // 重置 regex 索引
            regex.lastIndex = 0;
            let match;

            while ((match = regex.exec(content)) !== null) {
                const matchText = match[0];
                const matchId = match[1] || matchText;
                const matchStart = match.index;

                // 找到行号
                const lineNum = content.substring(0, matchStart).split('\n').length;

                // 获取该行内容
                const lines = content.split('\n');
                const lineContent = lines[lineNum - 1] || '';

                // 尝试获取上下文信息
                let tableName = "未知表";
                const headerMatches = content.substring(0, matchStart).match(/^##\s+(.*?)$/gm);
                if (headerMatches && headerMatches.length > 0) {
                    tableName = headerMatches[headerMatches.length - 1].replace(/^##\s+/, '').trim();
                }

                // 尝试从当前行提取第一个单元格 (字段名)
                let fieldName = "未知行";
                const rowMatch = lineContent.match(/^\|?\s*\*{0,2}(.*?)\*{0,2}\s*\|/);
                if (rowMatch) {
                    fieldName = rowMatch[1].trim();
                }

                const contextStr = `表: ${tableName} / 行: ${fieldName}`;

                // 诊断原因
                let diagnosis = "";
                let action = "";
                let severity = "";
                let reason = "";

                if (category === '未解析') {
                    if (validIds.has(matchId)) {
                        reason = "解析器缺陷";
                        diagnosis = `ID \`${matchId}\` 存在于源数据中，但解析器未能识别。`;
                        action = "建议：请检查生成脚本的 ID 映射逻辑。";
                        severity = "🔴 高 (可能是 Bug)";
                    } else {
                        reason = "数据缺失";
                        diagnosis = `ID \`${matchId}\` 在源数据中不存在。`;
                        action = [
                            "请执行以下操作：",
                            "  1. 打开飞书多维表格",
                            `  2. 定位到 **${tableName}**`,
                            `  3. 找到 **${fieldName}** (或对应自动化流程)`,
                            "  4. 检查是否有显示为 **红色错误** 或 **已删除** 的字段引用",
                            "  5. 如果该字段确实存在且正常，请**截图**该字段的配置发送给 AI"
                        ].join('\n');
                        severity = "🟡 中 (可能是已删除字段)";
                    }
                } else {
                    reason = issueType;
                    diagnosis = `发现 ${issueType}: \`${matchText}\``;
                    action = "这是脚本生成逻辑不够完善导致的，请告知 AI 优化相关解析函数。";
                    severity = "🔵 低 (可读性问题)";
                }

                untranslatedItems.push({
                    doc: docName,
                    line: lineNum,
                    text: matchText,
                    id: matchId,
                    context: contextStr,
                    reason: reason,
                    diagnosis: diagnosis,
                    action: action,
                    severity: severity
                });
            }
        }

        return untranslatedItems;
    },

    /**
     * 分析自动化工作流中未解析的字段
     */
    analyzeWorkflows: function (workflows) {
        const allUnknown = {};
        const stepTypeFields = {};

        for (const wf of workflows) {
            // 检查工作流级别
            const wfUnknown = this.analyzeUnknownKeys(wf, this.KNOWN_WORKFLOW_KEYS, `工作流 ${wf.id || '?'}`);
            for (const [k, v] of Object.entries(wfUnknown)) {
                if (!allUnknown[`工作流级别.${k}`]) allUnknown[`工作流级别.${k}`] = [];
                allUnknown[`工作流级别.${k}`].push(v);
            }

            // 解析 Draft
            const extra = wf.WorkflowExtra || {};
            const draftStr = extra.Draft || '{}';
            let draft;
            try {
                draft = typeof draftStr === 'string' ? JSON.parse(draftStr) : draftStr;
            } catch {
                continue;
            }

            if (typeof draft !== 'object') continue;

            // 检查 Draft 级别
            const draftUnknown = this.analyzeUnknownKeys(draft, this.KNOWN_DRAFT_KEYS, 'Draft');
            for (const [k, v] of Object.entries(draftUnknown)) {
                if (!allUnknown[`Draft级别.${k}`]) allUnknown[`Draft级别.${k}`] = [];
                allUnknown[`Draft级别.${k}`].push(v);
            }

            // 检查每个步骤
            for (const step of (draft.steps || [])) {
                const stepType = step.type || 'Unknown';
                const stepData = step.data || {};

                // 记录步骤数据中的所有字段（用于统计）
                if (!stepTypeFields[stepType]) stepTypeFields[stepType] = {};
                for (const k of Object.keys(stepData)) {
                    stepTypeFields[stepType][k] = (stepTypeFields[stepType][k] || 0) + 1;
                }
            }
        }

        // 收集具体问题
        const problems = [];
        for (const [stepType, fields] of Object.entries(stepTypeFields)) {
            for (const field of Object.keys(fields)) {
                if (!this.KNOWN_STEP_KEYS.has(field)) {
                    problems.push({
                        type: '未解析的步骤字段',
                        location: `${stepType} 类型的步骤`,
                        detail: `字段 \`${field}\` 未被解析`,
                        suggestion: `告诉 AI："${stepType} 步骤中的 ${field} 字段没有被解析"`
                    });
                }
            }
        }

        return { allUnknown, stepTypeFields, problems };
    },

    /**
     * 提取源数据中的所有有效 ID
     */
    extractValidIds: function (allTables, tableMap, fieldMap) {
        const validIds = new Set();

        // 添加表 ID
        for (const tableId of Object.keys(tableMap)) {
            validIds.add(tableId);
        }

        // 添加字段 ID
        for (const key of Object.keys(fieldMap)) {
            const parts = key.split('_');
            if (parts.length >= 2) {
                validIds.add(parts[parts.length - 1]); // 字段 ID
            }
        }

        return validIds;
    },

    /**
     * 生成校验报告
     */
    generateReport: function (workflows, fieldTableMd, relationshipMd, automationMd, allTables, tableMap, fieldMap) {
        const lines = [];
        lines.push("# 完整性校验报告\n");
        lines.push(`> 生成时间: ${new Date().toLocaleString()}\n`);
        lines.push("---\n");

        // 分析工作流
        const { problems, stepTypeFields } = this.analyzeWorkflows(workflows);

        // 提取有效 ID
        const validIds = this.extractValidIds(allTables, tableMap, fieldMap);

        // 扫描生成的文档
        const untranslatedItems = [];

        if (fieldTableMd) {
            untranslatedItems.push(...this.scanDocument(fieldTableMd, '全量字段表.md', validIds));
        }
        if (relationshipMd) {
            untranslatedItems.push(...this.scanDocument(relationshipMd, '关联关系图.md', validIds));
        }
        if (automationMd) {
            untranslatedItems.push(...this.scanDocument(automationMd, '自动化地图.md', validIds));
        }

        // 统计数据
        const workflowCount = workflows.length;
        const totalStepFields = Object.values(stepTypeFields).reduce((sum, fields) => sum + Object.keys(fields).length, 0);
        const unknownCount = problems.length;

        // 校验结果摘要
        lines.push("## 📊 校验结果\n");
        lines.push("| 项目 | 结果 |");
        lines.push("|------|------|");
        lines.push(`| 工作流解析 | ✅ ${workflowCount} 个工作流已解析 |`);

        if (unknownCount === 0) {
            lines.push("| 字段覆盖率 | ✅ 100% 全部覆盖 |");
        } else {
            const coverage = 100 - (unknownCount / Math.max(1, totalStepFields) * 100);
            lines.push(`| 字段覆盖率 | ⚠️ ${coverage.toFixed(1)}% (有 ${unknownCount} 个字段未解析) |`);
        }

        if (untranslatedItems.length === 0) {
            lines.push("| ID翻译 | ✅ 100% 已翻译 |");
        } else {
            lines.push(`| ID翻译 | ⚠️ 发现 ${untranslatedItems.length} 个未翻译ID |`);
        }

        lines.push("");

        // 问题列表 (工作流解析问题)
        if (problems.length > 0) {
            lines.push("---\n");
            lines.push("## ⚠️ 自动化工作流解析问题\n");

            for (let i = 0; i < problems.length; i++) {
                const p = problems[i];
                lines.push(`### 问题 ${i + 1}: ${p.type}\n`);
                lines.push(`- **位置**: ${p.location}`);
                lines.push(`- **详情**: ${p.detail}`);
                lines.push(`- **如何修复**: ${p.suggestion}\n`);
            }
        }

        // 问题列表 (文档翻译问题)
        if (untranslatedItems.length > 0) {
            lines.push("---\n");
            lines.push("## ⚠️ 文档中的未翻译内容\n");

            for (let i = 0; i < untranslatedItems.length; i++) {
                const item = untranslatedItems[i];
                lines.push(`### 问题 ${i + 1}: ${item.reason}\n`);
                lines.push(`- **错误位置**: ${item.doc} 第 ${item.line} 行`);
                lines.push(`- **精确定位**: ${item.context}`);
                lines.push(`- **未解析内容**: \`${item.text}\``);
                lines.push(`- **诊断结果**: ${item.diagnosis}`);
                lines.push(`- **建议操作**: \n${item.action}\n`);
            }
        }

        // 如果没有问题
        if (problems.length === 0 && untranslatedItems.length === 0) {
            lines.push("---\n");
            lines.push("## ✅ 解析完成\n");
            lines.push("所有内容均已成功解析，无需额外处理。\n");
        }

        // 使用说明
        lines.push("---\n");
        lines.push("## 💬 如果您发现其他问题\n");
        lines.push("在阅读生成的文档时，如果看到以下情况：\n");
        lines.push("- 显示为 `fldXXX` 或 `tblXXX` 格式的内容");
        lines.push("- 显示为 `未知类型(数字)` 的字段类型");
        lines.push("- 显示为英文的操作或字段\n");
        lines.push("**请直接告诉 AI** 问题出现的位置，例如：\n");
        lines.push('> "自动化工作流第 XX 行有个字段显示为原始 ID，帮我翻译一下"\n');
        lines.push("AI 会自动修复并重新生成文档。\n");

        return {
            report: lines.join('\n'),
            problemCount: problems.length + untranslatedItems.length,
            isComplete: problems.length === 0 && untranslatedItems.length === 0
        };
    },

    /**
     * 主入口：运行完整性校验
     */
    check: function (workflows, fieldTableMd, relationshipMd, automationMd, allTables, tableMap, fieldMap) {
        return this.generateReport(workflows, fieldTableMd, relationshipMd, automationMd, allTables, tableMap, fieldMap);
    }
};

// Export for Node.js testing
if (typeof module !== 'undefined') {
    module.exports = CompletenessChecker;
}
