// 单一 Host service：crossnote.render / export / detectTools / getConfig / updateConfig。
// 按钮、命令、agent 三入口共用此处实现（AC-4 / AC-7）。

import { renderMdx } from './render.js';
import { exportDocument } from './export.js';
import { detectTools } from './detect.js';
import { DEFAULT_CONFIG } from './config.js';

/**
 * @param {any} ctx cordis 上下文（用于读取配置；不在此处访问未注入服务）
 * @returns {{render:(p:string)=>Promise<any>, export:(r:any)=>Promise<any>, detectTools:()=>Promise<any[]>, getConfig:()=>Record<string,unknown>, updateConfig:(patch:Record<string,unknown>)=>Record<string,unknown>}}
 */
export function createCrossnoteService(ctx) {
  // 可变配置镜像：updateConfig 后，render/export 均读到最新值并最终注入 Notebook.init({config})（AC-7）。
  let overrides = { ...DEFAULT_CONFIG, ...(ctx && ctx.config && ctx.config.crossnote ? ctx.config.crossnote : {}) };

  const getConfig = () => ({ ...overrides });

  return {
    getConfig,
    updateConfig(patch) {
      if (patch && typeof patch === 'object' && !Array.isArray(patch)) {
        overrides = { ...overrides, ...patch };
      }
      return getConfig();
    },
    render(absolutePath) {
      return renderMdx(absolutePath, { config: getConfig() });
    },
    export(request) {
      return exportDocument({
        ...request,
        options: { ...(request?.options || {}), config: getConfig() },
      });
    },
    detectTools() {
      return detectTools();
    },
  };
}
