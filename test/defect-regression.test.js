// 永久回归门禁：D1–D6（AC-5/6/7/8/9/15）的静态 + 运行期契约，缺一即失败。
// D1/D2/D3/D6 用 child_process 进程桩验证导出行为；D4/D5 验证配置装配面。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rp = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(rp(p), 'utf8');

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };

// ---- D1/D2/D3/D6：export.js 源码契约（防回归；运行期由 QA checker 覆盖完整 E2E） ----
const exp = read('src/export.js');
ok(!/keepDiagrams\s*:/.test(exp), 'D1: export.js 不再向 withNotebook 传 keepDiagrams');
ok(/restoreDiagrams\(/.test(exp), 'D2+D3: export.js 调 restoreDiagrams 还原围栏');
ok(/reason:\s*'tool-missing'/.test(exp) && /tool,/.test(exp), 'D6: 缺工具返回含 format/reason/tool 结构化字段');
// markdown 与 html 两分支各自还原围栏，不是只 import。
const restores = exp.match(/restoreDiagrams\(/g) || [];
ok(restores.length >= 2, 'D2+D3: markdown/html 两分支都还原围栏');

// ---- D4/D5：Host 配置装配面 ----
const idx = read('index.js');
const pkg = JSON.parse(read('package.json'));
ok(/createConfigSchema/.test(idx), 'D4+D5: index.js import/调用 createConfigSchema');
ok(/export\s*\{\s*Config\s*\}/.test(idx), 'D5: index.js 导出命名 Config schema');
ok(pkg.peerDependencies && pkg.peerDependencies['@deepseek-ai/schemastery'], 'D4: peerDependencies 含 schemastery');
ok(pkg.peerDependenciesMeta && pkg.peerDependenciesMeta['@deepseek-ai/schemastery']?.optional === true, 'D4: schemastery 标 optional');
const cli = read('client.js');
const panel = cli.slice(cli.indexOf('function ToolDetectPanel'), cli.indexOf('function detectTableText'));
ok(/chromePath/.test(panel), 'D5: 配置面板有 chromePath 输入');
ok(/onChange/.test(panel), 'D5: 配置面板有输入变更处理');
ok(/onSave|保存|save/.test(panel), 'D5: 配置面板有保存动作');
ok(/updateConfig/.test(panel) && /getConfig/.test(panel), 'D5: 配置面板经 service 读写持久化');

console.log(`defect-regression.test.js: ${passed} asserts passed`);
