// 导出格式分发：三入口（按钮/命令/agent）共用此处实现（AC-4）。
// AC-6：markdown/html 也先 stashDiagrams，产物 restoreDiagrams 还原围栏，绝不触发 npx 栅格化。
// AC-9：缺外部工具立即返回 { format, reason:'tool-missing', tool, ... } 结构化结果，不进 crossnote、不挂起、不抛。

import fs from 'node:fs/promises';
import path from 'node:path';
import { withNotebook } from './notebook.js';
import { restoreDiagrams } from './sideeffects.js';
import { detectTools } from './detect.js';

export const SUPPORTED_FORMATS = Object.freeze(['markdown', 'html', 'pdf', 'pdf-prince', 'epub']);

const TOOL_FOR_FORMAT = Object.freeze({
  pdf: ['pandoc', 'pdflatex'],
  'pdf-prince': ['prince'],
  epub: ['ebook-convert'],
});

const MISSING_HINT = Object.freeze({
  pandoc: 'pandoc 未找到：请安装或填写 pandocPath。',
  pdflatex: 'pdflatex 未找到：请安装 TeX 发行版。',
  prince: 'prince 未找到：请安装 PrinceXML 并确保 prince 在 PATH。',
  'ebook-convert': 'ebook-convert 未找到：请安装 Calibre 并确保其在 PATH。',
  chrome: 'Chrome 未找到：请安装或填写 chromePath。',
});

/**
 * AC-9：缺工具结构化结果，含 format/reason/tool 字段。
 */
function missingResult(format, missing) {
  const tools = TOOL_FOR_FORMAT[format] || [];
  const tool = (missing && missing.length ? missing : tools)[0] || '';
  const warnings = (missing && missing.length ? missing : tools)
    .map((t) => `[TOOL_MISSING] ${t}: ${MISSING_HINT[t] || '请确保已安装并在 PATH 中。'}`);
  return { format, reason: 'tool-missing', tool, outputPath: '', bytes: 0, warnings };
}

async function fileSize(p) {
  try {
    const stat = await fs.stat(p);
    return stat.size;
  } catch {
    return 0;
  }
}

async function hasHeader(p, header) {
  try {
    const fh = await fs.open(p, 'r');
    try {
      const buf = Buffer.alloc(header.length);
      await fh.read(buf, 0, header.length, 0);
      return buf.toString('latin1') === header;
    } finally {
      await fh.close();
    }
  } catch {
    return false;
  }
}

/**
 * @param {{source:string,format?:string,options?:{outputDir?:string,config?:Record<string,unknown>,tmpRoot?:string}}} request
 * @returns {Promise<{format:string,outputPath:string,bytes:number,warnings:string[],reason?:string,tool?:string}>}
 */
export async function exportDocument(request = {}) {
  const { source, format = 'markdown' } = request || {};
  const fmt = String(format).toLowerCase();
  if (typeof source !== 'string' || !source) throw new TypeError('source 必须是非空路径');
  if (!SUPPORTED_FORMATS.includes(fmt)) throw new TypeError(`不支持的导出格式：${fmt}`);

  const options = request.options || {};
  const warnings = [];

  // 外部工具前置校验：缺则立即返回结构化结果，不进 crossnote（AC-6/9）。
  if (TOOL_FOR_FORMAT[fmt]) {
    const statuses = await detectTools();
    const missing = TOOL_FOR_FORMAT[fmt].filter((name) => !statuses.some((s) => s.name === name && s.found));
    if (missing.length) return missingResult(fmt, missing);
    // pdf 的 chrome 优先路径；chrome 缺失但 pandoc/pdflatex 齐全仍可导出。
    if (fmt === 'pdf') {
      const chrome = statuses.find((s) => s.name === 'chrome' && s.found);
      if (chrome) options.useChrome = true;
    }
  }

  const outDir = typeof options.outputDir === 'string' && options.outputDir
    ? options.outputDir
    : (typeof options.config?.outputDir === 'string' && options.config.outputDir ? options.config.outputDir : path.dirname(path.resolve(source)));

  // 关键修复：不再传 keepDiagrams（默认 stash），markdown/html 都不触发 npx；产物 restoreDiagrams 还原围栏（D1/D2/D3）。
  return await withNotebook(source, { config: options.config || {} }, async (engine, ctx) => {
    let outputPath = '';
    let bytes = 0;

    switch (fmt) {
      case 'markdown': {
        const produced = await engine.markdownExport({ runAllCodeChunks: false });
        const content = restoreDiagrams(await fs.readFile(produced, 'utf8'), ctx.stash);
        await fs.mkdir(outDir, { recursive: true });
        outputPath = path.join(outDir, `${path.parse(path.basename(source)).name}.md`);
        await fs.writeFile(outputPath, content, 'utf8');
        bytes = Buffer.byteLength(content, 'utf8');
        break;
      }
      case 'html': {
        const html = await engine.htmlExportDocument({ offline: true, embedLocalImages: true, runAllCodeChunks: false });
        await fs.mkdir(outDir, { recursive: true });
        let content = String(html ?? '');
        if (ctx.stash && ctx.stash.length) content = restoreDiagrams(content, ctx.stash);
        outputPath = path.join(outDir, `${path.parse(path.basename(source)).name}.html`);
        await fs.writeFile(outputPath, content, 'utf8');
        bytes = Buffer.byteLength(content, 'utf8');
        if (/https?:\/\/(?:cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)/i.test(content)) {
          warnings.push('HTML 含外部 CDN 引用，离线模式可能不完整。');
        }
        break;
      }
      case 'pdf': {
        const produced = options.useChrome
          ? await engine.chromeExport({ fileType: 'pdf', runAllCodeChunks: false, openFileAfterGeneration: false })
          : await engine.pandocExport({ runAllCodeChunks: false, openFileAfterGeneration: false });
        outputPath = String(produced);
        bytes = await fileSize(outputPath);
        if (!await hasHeader(outputPath, '%PDF-')) warnings.push('产物缺少 PDF 头，请检查底层导出器。');
        break;
      }
      case 'pdf-prince': {
        const produced = await engine.princeExport({ runAllCodeChunks: false, openFileAfterGeneration: false });
        outputPath = String(produced);
        bytes = await fileSize(outputPath);
        if (!await hasHeader(outputPath, '%PDF-')) warnings.push('产物缺少 PDF 头，请检查 PrinceXML。');
        break;
      }
      case 'epub': {
        const produced = await engine.eBookExport({ fileType: 'epub', runAllCodeChunks: false, openFileAfterGeneration: false });
        outputPath = String(produced);
        bytes = await fileSize(outputPath);
        break;
      }
    }
    return { format: fmt, outputPath, bytes, warnings };
  });
}
