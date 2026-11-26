// DSH Host-only bundle 入口：注册 crossnote_merge 工具。
// 参照 dsh-tool-present: defineTool + ctx.tools.register。

import { defineTool } from '@deepseek-ai/dsh-tools';
import { merge } from './src/merge.js';

export const inject = ['tools'];

export function apply(ctx) {
  ctx.effect(() => {
    const disposable = ctx.tools.register(
      defineTool({
        name: 'crossnote_merge',
        description:
          '把 MPE 风格的 @import 多文件 Markdown 合并导出为单个纯 .md。' +
          '支持 #heading 取章节、as="新标题" 改名、demote=N 标题降级；' +
          '规避数学/图表栅格化副作用。产物可直接用 Typora 打开。',
        parameters: {
          type: 'object',
          properties: {
            source: {
              type: 'string',
              description: '总纲 markdown 文件路径（绝对或相对当前工作目录）',
            },
            output: {
              type: 'string',
              description: '输出 .md 文件路径（绝对或相对当前工作目录）',
            },
            crossnoteOptions: {
              type: 'object',
              description: '可选：覆盖 crossnote Notebook config，如 imageFolderPath',
            },
          },
          required: ['source', 'output'],
        },
        async execute(args) {
          const result = await merge({
            source: args.source,
            output: args.output,
            crossnoteOptions: args.crossnoteOptions || {},
          });
          const lines = [
            `已合并导出到：${result.outputPath}`,
            `文件大小：${result.bytes} bytes`,
            ...result.warnings.map((w) => `注意：${w}`),
          ];
          return { content: [{ type: 'text', text: lines.join('\n') }] };
        },
      }),
    );
    return () => disposable?.dispose?.();
  });
}
