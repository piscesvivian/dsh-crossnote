// stashDiagrams / restoreDiagrams 契约：mermaid/plantuml 围栏占位与逐字还原。
import assert from 'node:assert/strict';
import { stashDiagrams, restoreDiagrams } from '../src/sideeffects.js';

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; }

const fence = [
  '# 总纲',
  '',
  '```mermaid',
  'graph TD',
  '  A --> B',
  '```',
  '',
  '~~~plantuml',
  'Bob -> Alice: hi',
  '~~~',
  '',
  '普通正文',
].join('\n');

const stashed = stashDiagrams(fence);
ok(stashed.stash.length === 2, `期望占位 2 块，实际 ${stashed.stash.length}`);
ok(!stashed.text.includes('mermaid') && !stashed.text.includes('plantuml'), '源码中图形围栏已被占位');
ok(!stashed.text.includes('A --> B'), '图形正文已移出');
ok(stashed.text.includes('普通正文'), '非图形正文保留');

const restored = restoreDiagrams(stashed.text, stashed.stash);
ok(restored === fence, '还原后逐字等于原始文本');

const none = stashDiagrams('# 只有标题\n普通段落');
ok(none.stash.length === 0 && none.text === '# 只有标题\n普通段落', '无图形块时不改动文本');

console.log(`sideeffects.test.js: ${passed} asserts passed`);
