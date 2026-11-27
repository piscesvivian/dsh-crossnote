// 导出前源码预处理：把带 as/demote 的 @import 改写为 crossnote 能直接展开的普通指令。
// 通过镜像目录结构到 staging 目录，保证图片/相对链接基准不变。

import fs from 'node:fs/promises';
import path from 'node:path';
import { parseDirectives } from './directive.js';

const FENCE_RE = /^\s*(```|~~~)/;

/** 把标题行 `#{1,6} ` 降级 n 级，clamp 到 1..6；跳过 fenced code。 */
export function demoteHeadings(lines, n) {
  if (!n) return lines.join('\n');
  let inFence = false;
  return lines
    .map((line) => {
      if (FENCE_RE.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      const m = line.match(/^(#{1,6})(\s+.*)$/);
      if (!m) return line;
      const level = Math.min(6, Math.max(1, m[1].length + n));
      return '#'.repeat(level) + m[2];
    })
    .join('\n');
}

/** 把主标题（第一个标题）改名；跳过 fenced code 与 YAML front matter。 */
export function renameMainHeading(text, name) {
  const lines = text.split('\n');
  let inFence = false;
  let seenFrontMatter = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && line.trim() === '---') {
      seenFrontMatter = true;
      continue;
    }
    if (seenFrontMatter && line.trim() === '---') {
      seenFrontMatter = false;
      continue;
    }
    if (seenFrontMatter) continue;
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = line.match(/^(#{1,6})(\s+.*)$/);
    if (m) {
      lines[i] = `${m[1]} ${name}`;
      break;
    }
  }
  return lines.join('\n');
}

/** 依据 #slug 粗切章节（回退：整个文件）。crossnote 自身会做精确切片，这里只为 demote/rename 定界。 */
export function sliceByHeading(text, hash) {
  if (!hash) return text;
  const lines = text.split('\n');
  const headings = [];
  let inFence = false;
  lines.forEach((line, i) => {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const m = line.match(/^(#{1,6})\s+(.+)$/);
    if (m) headings.push({ i, level: m[1].length, text: m[2].trim() });
  });
  const norm = (s) => s.toLowerCase().replace(/\s+/g, '-');
  const target = headings.find((h) => norm(h.text) === norm(hash));
  if (!target) return text; // 找不到就交给 crossnote 处理
  const end = headings.find((h) => h.i > target.i && h.level <= target.level);
  return lines.slice(target.i, end ? end.i : lines.length).join('\n');
}

/**
 * 预处理 master.md，把带扩展属性的指令改写成普通指令并改写被导入文件副本。
 * @returns {{masterContent:string, stagingDir:string, cleanup:()=>Promise<void>}}
 */
export async function preprocess(masterPath, { tmpRoot }) {
  const masterAbs = path.resolve(masterPath);
  const masterDir = path.dirname(masterAbs);
  const stagingDir = await fs.mkdtemp(path.join(tmpRoot, 'dsh-crossnote-'));
  // 镜像 master 所在目录到 staging
  const stagedMasterRel = path.basename(masterAbs);
  await copyDir(masterDir, stagingDir);
  const stagedMaster = path.join(stagingDir, stagedMasterRel);
  let content = await fs.readFile(stagedMaster, 'utf8');

  const directives = parseDirectives(content);
  let genIndex = 0;
  for (const d of directives) {
    if (!d.as && !d.demote) continue; // 无扩展属性：crossnote 原生处理
    const srcRel = d.path;
    const srcAbs = path.resolve(masterDir, srcRel);
    let imported;
    try {
      imported = await fs.readFile(srcAbs, 'utf8');
    } catch (err) {
      throw new Error(`无法读取导入文件 ${srcRel}: ${err.message}`);
    }
    // 章节切片已在本层完成，生成的副本里标题会被改名/降级，
    // 原始 #hash 在副本中不再可解析，因此必须去掉，避免 crossnote 二次切片。
    imported = sliceByHeading(imported, d.hash);
    if (d.as) imported = renameMainHeading(imported, d.as);
    if (d.demote) imported = demoteHeadings(imported.split('\n'), d.demote);
    // 写到源文件同目录的唯一文件，保持相对路径（图片/链接）基准深度不变
    const genRel = path.join(path.dirname(srcRel), `.dsh-gen-${genIndex++}.md`);
    const stagedTarget = path.join(stagingDir, genRel);
    await fs.mkdir(path.dirname(stagedTarget), { recursive: true });
    await fs.writeFile(stagedTarget, imported, 'utf8');
    // 指令指向生成副本：不带 #hash、不带扩展属性
    const target = genRel.replace(/\\/g, '/');
    const replacement = d.comment
      ? `<!-- @import "${target}" -->`
      : `@import "${target}"`;
    content = content.replace(d.raw, replacement);
  }
  await fs.writeFile(stagedMaster, content, 'utf8');

  return {
    masterContent: content,
    stagingDir,
    cleanup: () => fs.rm(stagingDir, { recursive: true, force: true }),
  };
}

async function copyDir(src, dst) {
  await fs.mkdir(dst, { recursive: true });
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else if (entry.isFile()) await fs.copyFile(s, d);
  }
}
