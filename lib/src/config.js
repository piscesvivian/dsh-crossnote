// 插件配置默认值与 schemastery schema。
// 配置真相在 Host；Client 通过 webserver/index-inject 拿到只读副本。

export const DEFAULT_CONFIG = Object.freeze({
  chromePath: '',
  pandocPath: '',
  imageMagickPath: '',
  markdownYoBinaryPath: '',
  enableScriptExecution: false,
  offline: true,
  mathRenderingOption: 'None',
  outputDir: '',
});

// 5 个路径键必须由 Notebook.init({config}) 注入，不能写 .crossnote/config.js（会被忽略）。
export const PATH_CONFIG_KEYS = Object.freeze([
  'chromePath',
  'pandocPath',
  'imageMagickPath',
  'markdownYoBinaryPath',
]);

/**
 * 生成 schemastery schema。schemastery 由宿主提供，这里只依赖传入的 Schema 构造器，
 * 便于在没有宿主环境下单测。
 * @param {any} Schema schemastery 的 Schema 构造器
 */
export function createConfigSchema(Schema) {
  return Schema.object({
    chromePath: Schema.string().default(DEFAULT_CONFIG.chromePath).description('Chrome/Chromium 可执行文件路径；留空则自动探测'),
    pandocPath: Schema.string().default(DEFAULT_CONFIG.pandocPath).description('pandoc 路径（PDF/pandoc 链）'),
    imageMagickPath: Schema.string().default(DEFAULT_CONFIG.imageMagickPath).description('ImageMagick 路径（可选）'),
    markdownYoBinaryPath: Schema.string().default(DEFAULT_CONFIG.markdownYoBinaryPath).description('markdown-yo 二进制路径（可选）'),
    enableScriptExecution: Schema.boolean().default(DEFAULT_CONFIG.enableScriptExecution).description('允许执行脚本（安全默认关闭）'),
    offline: Schema.boolean().default(DEFAULT_CONFIG.offline).description('预览 HTML 离线化，不引用 CDN'),
    mathRenderingOption: Schema.string().default(DEFAULT_CONFIG.mathRenderingOption).description('数学渲染方式；None 避免在线图片'),
    outputDir: Schema.string().default(DEFAULT_CONFIG.outputDir).description('导出产物目录；留空写源文件同目录'),
  });
}

// 把插件配置合并为 Notebook.init 的 config。只透传 crossnote 认识的键。
export function toNotebookConfig(config = {}) {
  const out = { mathRenderingOption: DEFAULT_CONFIG.mathRenderingOption };
  for (const key of PATH_CONFIG_KEYS) {
    if (typeof config[key] === 'string' && config[key]) out[key] = config[key];
  }
  if (typeof config.enableScriptExecution === 'boolean') {
    out.enableScriptExecution = config.enableScriptExecution;
  }
  if (typeof config.mathRenderingOption === 'string' && config.mathRenderingOption) {
    out.mathRenderingOption = config.mathRenderingOption;
  }
  if (config.crossnoteOptions && typeof config.crossnoteOptions === 'object') {
    Object.assign(out, config.crossnoteOptions);
  }
  return out;
}
