// 共享装配：preprocess → lazy import crossnote → Notebook.init → engine → cleanup。
// merge / render / export 都走这里，消除三处重复链路导致的装配漂移。

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { preprocess } from './preprocess.js';
import { stashDiagrams } from './sideeffects.js';
import { toNotebookConfig, DEFAULT_CONFIG } from './config.js';

/**
 * 以 staging 镜像为一个 crossnote notebook 生命周期执行 fn。
 *
 * @param {string} source 总纲 .md/.mdx 的绝对路径
 * @param {{config?:Record<string,unknown>, keepDiagrams?:boolean, tmpRoot?:string}} options
 * @param {(engine:any, ctx:{stagingDir:string, masterContent:string, stash:any[], cleanup:()=>Promise<void>, notebook:any})=>Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withNotebook(source, options = {}, fn) {
  if (typeof source !== 'string' || !source) throw new TypeError('source 必须是非空文件路径');
  if (typeof fn !== 'function') throw new TypeError('withNotebook 需要 fn 回调');

  const masterAbs = path.resolve(source);
  const tmpRoot = options.tmpRoot || os.tmpdir();
  const pre = await preprocess(masterAbs, { tmpRoot });

  try {
    const stagedMaster = path.join(pre.stagingDir, path.basename(masterAbs));
    let masterContent = await fs.readFile(stagedMaster, 'utf8');

    // 默认暂存 mermaid/plantuml 围栏，避免 markdownExport 触发 npx 栅格化（AC-6）。
    let stash = [];
    if (!options.keepDiagrams) {
      const stashed = stashDiagrams(masterContent);
      stash = stashed.stash || [];
      if (stash.length) {
        masterContent = stashed.text;
        await fs.writeFile(stagedMaster, masterContent, 'utf8');
      }
    }

    // crossnote 只在需要时加载（D8 lazy import），避免普通 .md 预览付代价。
    const crossnote = await import('crossnote');
    const config = {
      ...toNotebookConfig(options.config || {}),
      ...(options.config?.crossnoteOptions || {}),
    };
    if (!config.mathRenderingOption) config.mathRenderingOption = DEFAULT_CONFIG.mathRenderingOption;

    const notebookPath = pathToFileURL(pre.stagingDir + path.sep).href;
    const notebook = await crossnote.Notebook.init({ notebookPath, config });
    const engine = await notebook.getNoteMarkdownEngine(path.basename(masterAbs));

    return await fn(engine, {
      stagingDir: pre.stagingDir,
      masterContent,
      stash,
      notebook,
      cleanup: pre.cleanup,
    });
  } finally {
    await pre.cleanup();
  }
}
