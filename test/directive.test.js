// parseDirectives 契约：@import / <!-- @import --> / as / demote / #hash / comment。
import assert from 'node:assert/strict';
import { parseDirectives } from '../src/directive.js';

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; }

const src = [
  '# 总纲',
  '@import "./a.md"',
  '@import "./b.md#章节" { as="B 章", demote=2 }',
  '<!-- @import "./c.md" { demote=1 } -->',
  '普通正文一行',
].join('\n');

const list = parseDirectives(src);
ok(list.length >= 3, `期望至少 3 条 directive，实际 ${list.length}`);
ok(list[0].path === './a.md', `a.md 路径解析：${list[0].path}`);
ok(list[1].path === './b.md', `b.md 路径解析：${list[1].path}`);
ok(list[1].hash === '章节', 'hash 解析');
ok(list[1].as === 'B 章', 'as 改名解析');
ok(list[1].demote === 2, 'demote 解析');
const commented = list.find((d) => d.comment === true);
ok(commented && commented.path === './c.md' && commented.demote === 1, 'HTML 注释形式被识别');

// 普通 .md 文本（无 @import）不得产生 directive —— 支撑 AC-1 零侵入。
ok(parseDirectives('# 标题\n普通正文\n- 列表').length === 0, '无 @import 时零 directive');

console.log(`directive.test.js: ${passed} asserts passed`);
