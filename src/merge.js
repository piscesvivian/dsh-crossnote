// 顶层合并逻辑：复用 withNotebook 的共享装配，避免与 render/export 三处漂移。
// preprocess → stash → Notebook.init → markdownExport → 还原副作用 → 写目标文件。

import fs from 'node:fs/promises';
import path from 'node:path';
import { withNotebook } from './notebook.js';
import { restoreDiagrams } from './sideeffects.js';

/**
 * @param {object} opts
 * @param {string} opts.source  master .md 路径
 * @param {string} opts.output  输出 .md 路径
 * @param {object} [opts.crossnoteOptions] 传给 Notebook.init 的 config（可覆盖）
 * @returns {Promise<{outputPath:string, bytes:number, warnings:string[]}>}
 */
export async function merge({ source, output, crossnoteOptions = {} }) {
  if (!source || !output) throw new Error('source 与 output 均为必填');

  const outputAbs = path.resolve(output);
  const warnings = [];

  return await withNotebook(source, { config: { crossnoteOptions } }, async (engine, ctx) => {
    if (ctx.stash.length) {
      warnings.push(`已临时占位 ${ctx.stash.length} 个图表块以避免栅格化副作用`);
    }
    const produced = await engine.markdownExport({ runAllCodeChunks: false });
    const content = restoreDiagrams(await fs.readFile(produced, 'utf8'), ctx.stash);
    await fs.mkdir(path.dirname(outputAbs), { recursive: true });
    await fs.writeFile(outputAbs, content, 'utf8');
    return {
      outputPath: outputAbs,
      bytes: Buffer.byteLength(content, 'utf8'),
      warnings,
    };
  });
}
