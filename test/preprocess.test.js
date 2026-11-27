// preprocess 契约：镜像总纲目录 + 展开 @import + as/demote/#hash + cleanup。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { preprocess, demoteHeadings, renameMainHeading, sliceByHeading } from '../src/preprocess.js';

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; }

ok(demoteHeadings(['# A', '## B'], 1) === '## A\n### B', 'demoteHeadings');
ok(renameMainHeading('# 旧标题\n正文', '新标题').startsWith('# 新标题'), 'renameMainHeading');
const sliced = sliceByHeading('# A\na1\n## B\nb1\n# C\nc1', 'B');
ok(sliced.includes('b1') && !sliced.includes('c1'), 'sliceByHeading 取章节');

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cnx-test-'));
try {
  await fs.writeFile(path.join(root, 'master.md'), '# 总纲\n@import "./child.md" { as="子章", demote=1 }\n');
  await fs.writeFile(path.join(root, 'child.md'), '# 子标题\n正文\n<img src="./pic.png">\n');
  await fs.writeFile(path.join(root, 'pic.png'), 'PNGDATA');
  const pre = await preprocess(path.join(root, 'master.md'), { tmpRoot: os.tmpdir() });
  ok(pre.stagingDir && pre.stagingDir.startsWith(os.tmpdir()), 'staging 目录创建');
  const stagedMaster = await fs.readFile(path.join(pre.stagingDir, 'master.md'), 'utf8');
  ok(!stagedMaster.includes('as="子章"') && !stagedMaster.includes('demote=1'), '入口扩展属性已被剥离');
  ok(stagedMaster.includes('.dsh-gen-0.md'), '入口 @import 已被改写为生成副本');
  const files = await fs.readdir(pre.stagingDir);
  const gen = files.find((f) => f.startsWith('.dsh-gen-'));
  ok(gen, '生成 .dsh-gen-N.md 副本');
  ok((await fs.readFile(path.join(pre.stagingDir, gen), 'utf8')).includes('子章'), 'as 改名生效于副本');
  ok(files.includes('pic.png'), '相对图片被镜像');
  await pre.cleanup();
  let gone = false;
  try { await fs.stat(pre.stagingDir); } catch { gone = true; }
  ok(gone, 'cleanup 删除 staging 目录');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

console.log(`preprocess.test.js: ${passed} asserts passed`);
