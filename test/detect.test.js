// detectTools 契约：返回结构化 ToolStatus[]，带超时与 hint；不要求本机真的安装工具。
import assert from 'node:assert/strict';
import { detectTools } from '../src/detect.js';

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; }

const started = Date.now();
const list = await detectTools();
const elapsed = Date.now() - started;
ok(Array.isArray(list), '返回数组');
ok(list.length >= 5, `覆盖 chrome/pandoc/pdflatex/prince/ebook-convert，实际 ${list.length}`);
for (const t of list) {
  ok(typeof t.name === 'string' && t.name.length > 0, `${t.name}: name`);
  ok(typeof t.found === 'boolean', `${t.name}: found 布尔`);
  ok(t.path === null || typeof t.path === 'string', `${t.name}: path 字符串或 null`);
  ok(t.version === null || typeof t.version === 'string', `${t.name}: version 字符串或 null`);
  if (!t.found) ok(typeof t.hint === 'string' && t.hint.length > 0, `${t.name}: 缺失时 hint 非空`);
}
ok(list.some((t) => t.name === 'chrome'), '包含 chrome');
ok(list.some((t) => t.name === 'prince' && /PATH/i.test(t.hint)), 'prince 提示含 PATH');
ok(elapsed < 30000, `8s 超时约束内完成（实际 ${elapsed}ms）`);
ok(elapsed < 20000, `无工具时不应挂起（实际 ${elapsed}ms）`);

console.log(`detect.test.js: ${passed} asserts passed (${elapsed}ms)`);
