// 顶层合并逻辑：preprocess → crossnote markdownExport → 还原副作用 → 写目标文件。

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { preprocess } from './preprocess.js';
import { stashDiagrams, restoreDiagrams } from './sideeffects.js';

/**
 * @param {object} opts
 * @param {string} opts.source  master .md 路径
 * @param {string} opts.output  输出 .md 路径
 * @param {object} [opts.crossnoteOptions] 传给 Notebook.init 的 config（可覆盖）
 * @returns {Promise<{outputPath:string, bytes:number, warnings:string[]}>}
 */
export async function merge({ source, output, crossnoteOptions = {} }) {
  if (!source || !output) throw new Error('source 与 output 均为必填');

  const masterAbs = path.resolve(source);
  const outputAbs = path.resolve(output);
  const warnings = [];

  // ① 预处理（staging 目录里改写被导入文件副本）
  const pre = await preprocess(masterAbs, { tmpRoot: os.tmpdir() });
  try {
    const stagedMaster = path.join(pre.stagingDir, path.basename(masterAbs));

    // ② 图表占位：只处理 master 源文件（子文件已被复制进 staging）
    const rawMaster = await fs.readFile(stagedMaster, 'utf8');
    const stashedMaster = stashDiagrams(rawMaster);
    if (stashedMaster.stash.length) {
      warnings.push(`已临时占位 ${stashedMaster.stash.length} 个图表块以避免栅格化副作用`);
      await fs.writeFile(stagedMaster, stashedMaster.text, 'utf8');
    }

    // ③ 加载 crossnote（运行时 require，避免插件启动即加载重型依赖）
    const crossnote = await import('crossnote');
    const config = {
      mathRenderingOption: 'None', // 跳过数学转在线图片
      ...crossnoteOptions,
    };
    const notebook = await crossnote.Notebook.init({
      notebookPath: pathToFileURL(pre.stagingDir + path.sep).href,
      config,
    });
    const engine = notebook.getNoteMarkdownEngine(path.basename(masterAbs));

    // ④ 导出：返回导出文件路径字符串
    const produced = await engine.markdownExport({ runAllCodeChunks: false });

    // ⑤ 读取产物内容、还原图表、写目标路径
    let content = await fs.readFile(produced, 'utf8');
    content = restoreDiagrams(content, stashedMaster.stash);
    await fs.mkdir(path.dirname(outputAbs), { recursive: true });
    await fs.writeFile(outputAbs, content, 'utf8');

    return {
      outputPath: outputAbs,
      bytes: Buffer.byteLength(content, 'utf8'),
      warnings,
    };
  } finally {
    await pre.cleanup();
  }
}
