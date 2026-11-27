// DSH Client 插件：.mdx 预览 + 导出按钮/菜单 + toast + 检测命令 + 配置表。
// 只注册 .mdx（priority:'extension'），普通 .md 零侵入（AC-1/3）。
// React 从宿主模块表 require，保持单一身份；所有注册进 ctx.effect 回收（AC-12）。

(function () {
  const MODULE_ID = '@local/dsh-crossnote';
  const BODY_ID = 'crossnote-mdx';
  const FORMATS = ['markdown', 'html', 'pdf', 'pdf-prince', 'epub'];
  const FORMAT_LABEL = {
    markdown: 'Markdown (.md)', html: 'HTML (.html)', pdf: 'PDF (Chrome/Pandoc)',
    'pdf-prince': 'PDF (PrinceXML)', epub: 'EPUB (.epub)',
  };

  window.__ModuleLoader__.load({
    id: MODULE_ID,
    factory(require) {
      const React = require('react');
      const h = React.createElement;
      const { useState, useEffect, useRef, useCallback } = React;

      // ---- 设计令牌（DESIGN.md §1.2，回退 HEX）----
      const styleEl = typeof document !== 'undefined' ? document.createElement('style') : null;
      if (styleEl) {
        styleEl.setAttribute('data-crossnote', '1');
        styleEl.textContent = `
          .cnx-btn{height:28px;display:inline-flex;align-items:center;gap:6px;padding:0 10px;
            border:1px solid var(--cn-border,#475569);border-radius:var(--cn-r-sm,4px);
            background:transparent;color:var(--cn-text,#F8FAFC);font:600 12px/1 var(--cn-font-ui,system-ui);
            cursor:pointer;transition:background .12s ease-out,box-shadow .12s ease-out}
          .cnx-btn:hover{background:var(--cn-surface-raised,#272F42)}
          .cnx-btn:active{box-shadow:inset 0 0 0 18px rgba(59,130,246,.18)}
          .cnx-btn:focus-visible{outline:2px solid var(--cn-focus,#fff);outline-offset:2px}
          .cnx-btn[aria-disabled="true"]{opacity:.45;cursor:not-allowed}
          .cnx-menu{display:flex;flex-direction:column;gap:8px;padding:8px;max-height:240px;overflow:auto;
            background:var(--cn-surface,#1B2336);border:1px solid var(--cn-border,#475569);
            border-radius:var(--cn-r-md,8px);box-shadow:var(--cn-shadow,0 4px 12px rgba(0,0,0,.32));position:absolute;z-index:20}
          .cnx-menu-item{height:32px;display:flex;align-items:center;gap:8px;padding:0 10px;border:0;border-radius:var(--cn-r-sm,4px);
            background:transparent;color:var(--cn-text,#F8FAFC);font:13px/1 var(--cn-font-ui,system-ui);cursor:pointer;text-align:left}
          .cnx-menu-item:hover,.cnx-menu-item:focus-visible{box-shadow:inset 2px 0 0 var(--cn-accent,#3B82F6);background:var(--cn-surface-raised,#272F42);outline:none}
          .cnx-menu-item .cnx-suffix{margin-left:auto;font:11px/1 var(--cn-font-mono,monospace);color:var(--cn-text-muted,#94A3B8)}
          .cnx-pill{height:24px;display:inline-flex;align-items:center;gap:4px;padding:0 8px;border-radius:999px;
            font:500 12px/1 var(--cn-font-ui,system-ui)}
          .cnx-dot{width:8px;height:8px;border-radius:50%;background:currentColor}
          .cnx-toast{width:320px;min-width:280px;max-width:360px;min-height:76px;padding:12px 14px;
            background:var(--cn-surface,#1B2336);border:1px solid var(--cn-border,#475569);
            border-radius:var(--cn-r-md,8px);box-shadow:var(--cn-shadow,0 4px 12px rgba(0,0,0,.32));
            color:var(--cn-text,#F8FAFC);font:12px/1.4 var(--cn-font-ui,system-ui);
            animation:cnx-in .2s ease-out;position:fixed;right:16px;bottom:16px;z-index:40}
          .cnx-toast[data-tone="success"]{color:var(--cn-success,#22C55E)}
          .cnx-toast[data-tone="fail"]{color:var(--cn-danger,#EF4444)}
          .cnx-toast[data-tone="warn"]{color:var(--cn-warning,#F59E0B)}
          .cnx-prog{display:flex;align-items:center;gap:12px}
          .cnx-track{flex:1;height:4px;background:var(--cn-surface-raised,#272F42);border-radius:2px;overflow:hidden}
          .cnx-fill{height:100%;background:var(--cn-accent,#3B82F6);border-radius:2px;transition:width .12s linear}
          .cnx-num{width:40px;text-align:right;font-variant-numeric:tabular-nums;font:11px/1 var(--cn-font-mono,monospace);color:var(--cn-text-muted,#94A3B8)}
          .cnx-err{padding:12px 14px;border:1px solid var(--cn-danger,#EF4444);border-radius:var(--cn-r-md,8px);color:var(--cn-danger,#EF4444)}
          @keyframes cnx-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
          @media (prefers-reduced-motion:reduce){.cnx-toast{animation:none}.cnx-fill,.cnx-btn{transition:none}}
        `;
      }

      function useThemeStyle() {
        useEffect(() => {
          if (styleEl && document && !document.head.querySelector('style[data-crossnote]')) {
            document.head.appendChild(styleEl);
          }
          return () => { if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl); };
        }, []);
      }

      function DownloadIcon() {
        return h('svg', { width: 16, height: 16, viewBox: '0 0 256 256', 'aria-hidden': 'true', fill: 'currentColor' },
          h('path', { d: 'M224,144v64a8,8,0,0,1-8,8H40a8,8,0,0,1-8-8V144a8,8,0,0,1,16,0v56H208V144a8,8,0,0,1,16,0Zm-101.66,5.66a8,8,0,0,0,11.32,0l40-40a8,8,0,0,0-11.32-11.32L136,120.69V40a8,8,0,0,0-16,0v80.69l-26.34-26.35a8,8,0,0,0-11.32,11.32Z' }));
      }

      // ---- M1: .mdx 预览 body ----
      function MdxBody({ ctx, absolutePath }) {
        const [state, setState] = useState({ status: 'loading', html: '', version: '' });
        const [nonce, setNonce] = useState(0);
        useThemeStyle();
        useEffect(() => {
          let alive = true;
          setState({ status: 'loading', html: '', version: '' });
          if (!ctx.remote || !ctx.remote.crossnote || !absolutePath) return;
          ctx.remote.crossnote.render(absolutePath).then((res) => {
            if (!alive) return;
            setState({ status: 'ready', html: res.html, version: res.version });
          }).catch((err) => {
            if (!alive) return;
            setState({ status: 'error', html: '', version: '', message: err?.message || String(err) });
          });
          return () => { alive = false; };
        }, [ctx, absolutePath, nonce]);

        useEffect(() => {
          if (state.status === 'ready' && typeof ctx.content?.loaded === 'function') {
            ctx.content.loaded(state.version);
          }
        }, [state.status, state.version]);

        if (state.status === 'loading') {
          return h('div', { 'aria-busy': 'true', style: { padding: 16, color: 'var(--cn-text-muted,#94A3B8)' } }, '正在渲染 .mdx 预览…');
        }
        if (state.status === 'error') {
          return h('div', { className: 'cnx-err', role: 'alert' },
            h('div', null, `渲染失败：${state.message}`),
            h('button', { className: 'cnx-btn', style: { marginTop: 8 }, onClick: () => setNonce((n) => n + 1) }, '重试'));
        }
        return h('div', { className: 'cnx-mdx-body', dangerouslySetInnerHTML: { __html: state.html } });
      }

      // ---- M3: toast（进度条与数字并排）----
      function ExportToast({ task, onDismiss }) {
        const [seconds, setSeconds] = useState(0);
        useEffect(() => {
          if (!task || task.status !== 'running') return;
          const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
          return () => clearInterval(timer);
        }, [task && task.status]);
        useEffect(() => {
          if (task && (task.status === 'success' || task.status === 'fail')) {
            const timer = setTimeout(onDismiss, 5000);
            return () => clearTimeout(timer);
          }
        }, [task && task.status]);
        if (!task) return null;
        const tone = task.status === 'success' ? 'success' : task.status === 'fail' ? 'fail' : task.status === 'warn' ? 'warn' : '';
        const long = seconds >= 60 && task.status === 'running';
        return h('div', { className: 'cnx-toast', 'data-tone': tone, role: 'status' },
          h('div', { style: { marginBottom: 8 } }, task.message || (task.status === 'running' ? '导出中…' : '')),
          task.status === 'running'
            ? h('div', { className: 'cnx-prog' },
                h('div', { className: 'cnx-track' }, h('div', { className: 'cnx-fill', style: { width: `${task.progress || 5}%` } })),
                h('span', { className: 'cnx-num' }, `${task.progress || 5}%`))
            : null,
          long ? h('div', { style: { marginTop: 6, color: 'var(--cn-warning,#F59E0B)' } }, '导出耗时较长，可取消或继续等待') : null);
      }

      // ---- M2: 导出按钮 + 格式菜单 ----
      function ExportActions({ ctx, absolutePath }) {
        const [open, setOpen] = useState(false);
        const [task, setTask] = useState(null);
        const ref = useRef(null);
        useThemeStyle();
        useEffect(() => {
          if (!open) return;
          const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
          document.addEventListener('mousedown', close);
          return () => document.removeEventListener('mousedown', close);
        }, [open]);

        const doExport = useCallback(async (format) => {
          setOpen(false);
          setTask({ status: 'running', progress: 5, message: `正在导出 ${FORMAT_LABEL[format] || format}…` });
          try {
            const res = await ctx.remote.crossnote.export({ source: absolutePath, format });
            if (res && res.warnings && res.warnings.length) {
              setTask({ status: 'warn', message: res.warnings.join('；') || '导出完成（有警告）' });
            } else {
              setTask({ status: 'success', message: `已导出：${res?.outputPath || '完成'}` });
            }
          } catch (err) {
            setTask({ status: 'fail', message: `导出失败：${err?.message || err}` });
          }
        }, [ctx, absolutePath]);

        const busy = task && task.status === 'running';
        return h('div', { ref, style: { position: 'relative', display: 'inline-block' } },
          h('button', {
            className: 'cnx-btn', 'aria-busy': busy ? 'true' : 'false',
            'aria-disabled': busy ? 'true' : 'false', disabled: !!busy,
            onClick: () => { if (!busy) setOpen((v) => !v); },
          }, h(DownloadIcon), busy ? '导出中…' : '导出'),
          open ? h('div', { className: 'cnx-menu', role: 'menu' },
            FORMATS.map((fmt) => h('button', {
              key: fmt, className: 'cnx-menu-item', role: 'menuitem',
              onClick: () => doExport(fmt),
            }, h('span', null, FORMAT_LABEL[fmt]), h('span', { className: 'cnx-suffix' }, fmt)))) : null,
          h(ExportToast, { task, onDismiss: () => setTask(null) }));
      }

      // ---- M5: 工具检测面板（configForms 探测，不可用则命令降级）----
      function ToolDetectPanel({ ctx }) {
        const [rows, setRows] = useState([]);
        const [loading, setLoading] = useState(false);
        const [chromePath, setChromePath] = useState('');
        const [saved, setSaved] = useState(false);
        useThemeStyle();
        const refresh = useCallback(async () => {
          setLoading(true);
          try {
            const data = await ctx.remote.crossnote.detectTools();
            setRows(Array.isArray(data) ? data : []);
          } catch {
            setRows([]);
          } finally {
            setLoading(false);
          }
        }, [ctx]);
        useEffect(() => {
          refresh();
          // 读取已保存的 chromePath（持久化链路 AC-7）。
          try {
            const remote = ctx.remote && ctx.remote.crossnote;
            if (remote && typeof remote.getConfig === 'function') {
              Promise.resolve(remote.getConfig()).then((cfg) => {
                if (cfg && typeof cfg.chromePath === 'string') setChromePath(cfg.chromePath);
              }).catch(() => {});
            }
          } catch { /* 无 remote 时保留空值 */ }
        }, [ctx, refresh]);
        // 保存路径：写回 Host service，再检测一次让表格反映新配置（AC-7 / AC-8）。
        const onSave = useCallback(async () => {
          try {
            const remote = ctx.remote && ctx.remote.crossnote;
            if (remote && typeof remote.updateConfig === 'function') {
              await remote.updateConfig({ chromePath });
            }
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
            await refresh();
          } catch { /* 保存失败保留输入，用户可重试 */ }
        }, [ctx, chromePath, refresh]);
        return h('div', { className: 'cnx-config-table', style: { font: '12px/1.5 var(--cn-font-ui,system-ui)', color: 'var(--cn-text,#F8FAFC)' } },
          h('div', { style: { marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 } },
            h('strong', null, '导出工具检测'),
            h('button', { className: 'cnx-btn', onClick: refresh, 'aria-busy': loading ? 'true' : 'false' }, '重新检测')),
          h('div', { className: 'cnx-config-path', style: { marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
            h('label', { htmlFor: 'cnx-chrome-path' }, 'Chrome/Chromium 路径：'),
            h('input', {
              id: 'cnx-chrome-path',
              type: 'text',
              value: chromePath,
              placeholder: '留空则自动检测，如 C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
              onChange: (e) => setChromePath(e.target.value),
              style: { flex: '1 1 240px', minWidth: 180, padding: '4px 6px', background: 'var(--cn-bg-subtle,#1E293B)', color: 'inherit', border: '1px solid var(--cn-border,#475569)', borderRadius: 4 },
            }),
            h('button', { className: 'cnx-btn', onClick: onSave }, saved ? '已保存' : '保存')),
          rows.length ? h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
            h('thead', null, h('tr', null,
              ['工具', '状态', '版本', '路径/提示'].map((s) => h('th', { key: s, style: { textAlign: 'left', borderBottom: '1px solid var(--cn-border,#475569)', padding: '4px 8px' } }, s)))),
            h('tbody', null, rows.map((r) => h('tr', { key: r.name },
              h('td', { style: { padding: '4px 8px' } }, r.name),
              h('td', { style: { padding: '4px 8px' } },
                h('span', { className: 'cnx-pill', style: { color: r.found ? 'var(--cn-success,#22C55E)' : 'var(--cn-warning,#F59E0B)' } },
                  h('span', { className: 'cnx-dot' }), r.found ? '就绪' : '缺失')),
              h('td', { style: { padding: '4px 8px' } }, r.version || '—'),
              h('td', { style: { padding: '4px 8px', color: 'var(--cn-text-muted,#94A3B8)' } }, r.path || r.hint || '—')))))
            : h('div', { style: { color: 'var(--cn-text-muted,#94A3B8)' } }, loading ? '检测中…' : '未检测到工具，请检查安装或配置路径。'));
      }

      function detectTableText(rows) {
        const head = ['工具', '状态', '版本', '路径/提示'].join(' | ');
        const lines = (rows || []).map((r) => [r.name, r.found ? '就绪' : '缺失', r.version || '—', r.path || r.hint || '—'].join(' | '));
        return [head, ...lines].join('\n');
      }

      function contributeToast() {
        // 全局 toast 由 ExportActions 内部渲染（自带 ExportToast），无需额外全局挂载点。
      }

      return {
        inject: ['slots', 'documentPreviews', 'commandUi', 'remote'],
        apply(ctx) {
          const disposes = [];

          disposes.push(ctx.effect(() => ctx.documentPreviews.register({
            id: BODY_ID,
            extensions: ['mdx'],
            priority: 'extension',
            loading: 'renderer',
            title: () => 'Crossnote .mdx',
          })));

          disposes.push(ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register(
            { name: 'sidebar.right.tab.document', key: BODY_ID, id: BODY_ID },
            (props) => h(MdxBody, { ctx, absolutePath: props?.absolutePath })))));

          disposes.push(ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document.actions', () => ctx.slots.register(
            { name: 'sidebar.right.tab.document.actions', id: MODULE_ID, order: 10 },
            (props) => h(ExportActions, { ctx, absolutePath: props?.absolutePath })))));

          // 命令降级通道（AC-8）：configForms 不可用时仍可检测工具。
          if (ctx.commandUi && typeof ctx.commandUi.register === 'function') {
            disposes.push(ctx.effect(() => ctx.commandUi.register({
              id: 'crossnote.detect',
              label: 'Crossnote: 检测导出工具',
              async run() {
                const rows = ctx.remote?.crossnote?.detectTools ? await ctx.remote.crossnote.detectTools() : [];
                return detectTableText(rows);
              },
            })));
            for (const fmt of FORMATS) {
              disposes.push(ctx.effect(() => ctx.commandUi.register({
                id: `crossnote.export.${fmt}`,
                label: `Crossnote: 导出为 ${FORMAT_LABEL[fmt]}`,
                async run(owner) {
                  const source = owner?.absolutePath;
                  if (!source) return '当前没有可导出的文件。';
                  const res = await ctx.remote?.crossnote?.export({ source, format: fmt });
                  return res?.warnings?.length ? res.warnings.join('；') : `已导出：${res?.outputPath || '完成'}`;
                },
              })));
            }
          }

          // configForms 探测式接入（F1）：有则注册面板，无则命令降级已覆盖。
          if (ctx.configForms && typeof ctx.configForms.register === 'function') {
            try {
              disposes.push(ctx.effect(() => ctx.configForms.register({
                id: `${MODULE_ID}.tools`,
                title: 'Crossnote 导出工具',
                component: () => h(ToolDetectPanel, { ctx }),
              })));
            } catch { /* API 形状不符时静默降级到命令 */ }
          }

          contributeToast();
          return () => disposes.forEach((fn) => { try { typeof fn === 'function' ? fn() : fn?.dispose?.(); } catch {} });
        },
      };
    },
  });
})();
