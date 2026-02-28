const fs = require('fs');
const pako = require('./pako.min.js');
const AutomationParser = require('./automation-parser.js');
const BaseFileParser = require('./base-file-parser.js');

// Mock pako
global.pako = pako;

const filePath = './成品布管理系统-0131 (1).base';
const content = fs.readFileSync(filePath, 'utf8');
const data = JSON.parse(content);

// 1. Prepare maps
const snapshot = BaseFileParser.decompressContent(data.gzipSnapshot);
const { tableMap, fieldMap, allTables } = BaseFileParser.buildNameRegistry(snapshot);
const optionMap = AutomationParser.buildOptionMap(allTables);
const blockMap = AutomationParser.buildBlockMap(snapshot);

// 2. Decompress automation
let automations = [];
if (data.gzipAutomation) {
    automations = AutomationParser.decompressAutomation(data.gzipAutomation);
}

// 3. Find the specific workflow
const targetId = '7600673279171710141';
const wf = automations.find(w => String(w.id) === targetId);

if (wf) {
    console.log(`\nFound target workflow: ${wf.name || 'Untitled'} (${wf.id})`);

    // Call the Parser
    try {
        const lines = AutomationParser.parseWorkflow(
            wf,
            Object.assign({}, tableMap), // Clone to avoid side effects if any
            fieldMap,
            optionMap,
            blockMap
        );

        const output = lines.join('\n');
        fs.writeFileSync('./debug_output.txt', output, 'utf8');
        console.log("Output written to debug_output.txt");
    } catch (e) {
        console.error("Parsing failed:", e);
    }

} else {
    console.log(`Workflow ${targetId} not found.`);
}
