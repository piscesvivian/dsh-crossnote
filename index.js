// DSH Host 入口：注册单一 crossnote service（render/export/detectTools）+ 三个 agent 工具，
// 并把配置注入 Browser。按钮/命令/agent 三入口共用同一 Host service（AC-4）。
// 顶层不访问任何未注入服务；全部注册在 apply() 内完成（AC-17）。

import { createRequire } from 'node:module';
import { merge } from './src/merge.js';
import { createCrossnoteService } from './src/service.js';
import { DEFAULT_CONFIG } from './src/config.js';

// defineTool 是可选 peer：安装到宿主 profile 时由宿主提供；裸仓库加载时降级为恒等函数。
// 加载本身不访问任何 ctx（AC-17）。
const _require = createRequire(import.meta.url);
let defineTool = (definition) => definition;
try {
  const mod = _require('@deepseek-ai/dsh-tools');
  if (mod && typeof mod.defineTool === 'function') defineTool = mod.defineTool;
} catch {
  /* 宿主未提供 dsh-tools 时使用恒等降级，顶层装载不抛 */
}

// AC-7 / D4 / D5：导出命名 Config schema 供宿主 settings 面读取；
// @deepseek-ai/schemastery 是宿主提供的可选 peer，裸仓库加载时降级为 null，顶层不抛（AC-17）。
let Config = null;
try {
  const { default: Schema } = await import('@deepseek-ai/schemastery').catch(() => ({}));
  if (Schema && typeof Schema.object === 'function') {
    const { createConfigSchema } = await import('./src/config.js');
    Config = createConfigSchema(Schema);
  }
} catch {
  /* 宿主未装 schemastery 时不提供 settings 面，其余功能不受影响 */
}
export { Config };

export const inject = ['tools'];

function textResult(lines) {
  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...(config || {}) };
  const service = createCrossnoteService(cfg);

  // 挂载 Host service；cordis 提供多种注册面，逐层降级且全部可选，保证不抛。
  ctx.effect(() => {
    const cleanups = [];
    try {
      if (typeof ctx.provide === 'function') {
        ctx.provide('crossnote', service);
        cleanups.push(() => { try { ctx.unprovide?.('crossnote'); } catch {} });
      } else if (ctx.reflect && typeof ctx.reflect.provide === 'function') {
        ctx.reflect.provide('crossnote', service);
        cleanups.push(() => { try { ctx.reflect.unprovide?.('crossnote'); } catch {} });
      }
    } catch {
      /* 宿主未提供服务注册面时跳过；工具仍可直接调用 service */
    }
    return () => cleanups.forEach((fn) => { try { fn(); } catch {} });
  });

  // 把只读配置副本注入 Browser，供 Client 的配置表读取。
  ctx.effect(() => {
    if (typeof ctx.on !== 'function') return;
    return ctx.on('webserver/index-inject', (table) => {
      if (Array.isArray(table)) table.push({ kind: 'global', name: '__DSH_CROSSNOTE_CONFIG__', value: cfg });
    });
  });

  ctx.effect(() => {
    if (!ctx.tools || typeof ctx.tools.register !== 'function') return;

    const disposables = [];

    // 既有工具：合并 @import 多文件 Markdown 为单个 .md。
    disposables.push(ctx.tools.register(defineTool({
      name: 'crossnote_merge',
      description:
        '把 MPE 风格的 @import 多文件 Markdown 合并导出为单个纯 .md。' +
        '支持 #heading 取章节、as="新标题" 改名、demote=N 标题降级；' +
        '规避数学/图表栅格化副作用。产物可直接用 Typora 打开。',
      parameters: {
        type: 'object',
        properties: {
          source: { type: 'string', description: '总纲 markdown 文件路径（绝对或相对当前工作目录）' },
          output: { type: 'string', description: '输出 .md 文件路径（绝对或相对当前工作目录）' },
          crossnoteOptions: { type: 'object', description: '可选：覆盖 crossnote Notebook config' },
        },
        required: ['source', 'output'],
      },
      async execute(args) {
        const result = await merge({
          source: args.source,
          output: args.output,
          crossnoteOptions: args.crossnoteOptions || {},
        });
        return textResult([
          `已合并导出到：${result.outputPath}`,
          `文件大小：${result.bytes} bytes`,
          ...result.warnings.map((w) => `注意：${w}`),
        ]);
      },
    })));

    // 新增工具：三入口之一的 agent 通道，与按钮/命令共用 service.export。
    disposables.push(ctx.tools.register(defineTool({
      name: 'crossnote_export',
      description:
        '把 .md/.mdx 总纲（含 @import 展开）导出为 Markdown/HTML/PDF/EPUB。' +
        '与预览面板导出按钮、crossnote.export.<format> 命令共用同一导出实现。',
      parameters: {
        type: 'object',
        properties: {
          source: { type: 'string', description: '总纲文件路径（绝对或相对当前工作目录）' },
          format: { type: 'string', enum: ['markdown', 'html', 'pdf', 'pdf-prince', 'epub'], description: '导出格式' },
          options: { type: 'object', description: '可选：outputDir 等导出参数' },
        },
        required: ['source', 'format'],
      },
      async execute(args) {
        const result = await service.export({ source: args.source, format: args.format, options: args.options || {} });
        const lines = [
          result.outputPath ? `已导出到：${result.outputPath}` : '导出未生成文件。',
          `大小：${result.bytes} bytes`,
          ...result.warnings.map((w) => `注意：${w}`),
        ];
        return textResult(lines);
      },
    })));

    return () => disposables.forEach((d) => { try { d?.dispose?.(); } catch {} });
  });
}
