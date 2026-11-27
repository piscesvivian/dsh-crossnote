// .mdx 预览渲染：preprocess → stash → htmlExportDocument(offline) → DOMPurify → version。

import { withNotebook } from './notebook.js';

// DOMPurify 在 crossnote 的依赖树里；离线预览安全净化交给它，缺失时降级为轻量白名单清理。
async function sanitize(html) {
  try {
    const { default: createDOMPurify } = await import('dompurify');
    const purifier = createDOMPurify();
    if (purifier && typeof purifier.sanitize === 'function') {
      return purifier.sanitize(html, { ADD_ATTR: ['target'] });
    }
  } catch {
    /* 宿主未提供 DOMPurify 时走下方保守清理 */
  }
  return String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}

/**
 * @param {string} absolutePath 总纲 .md/.mdx 绝对路径
 * @param {{config?:Record<string,unknown>, offline?:boolean}} [options]
 * @returns {Promise<{html:string, version:string}>}
 */
export async function renderMdx(absolutePath, options = {}) {
  const version = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const html = await withNotebook(absolutePath, { config: options.config || {} }, async (engine) => {
      const result = await engine.htmlExportDocument({
        offline: options.offline !== false,
        embedLocalImages: true,
        embedSVG: true,
        runAllCodeChunks: false,
      });
      return await sanitize(typeof result === 'string' ? result : String(result ?? ''));
    });
    return { html, version };
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    return { html: `<pre>渲染失败：${escapeHtml(message)}</pre>`, version };
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
