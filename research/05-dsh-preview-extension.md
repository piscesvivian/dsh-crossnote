# DSH Markdown 预览扩展点调研报告

> 调研对象：DeepSeek Harness（DSH）Markdown 预览功能，以及第三方 bundle 插件能否/如何增强它（渲染新语法如 MPE `@import`、新增自定义导出按钮/命令）。
> 调研方式：直接读取本机安装包的 ASAR 归档与 ships 源码（`src/*.ts(x)`），并反查已构建的 Web 前端 bundle。仅陈述核实过的事实，不确定处明确标注。
> 版本：`@deepseek-ai/dsh` 0.2.2-rc.5、cordis 4.1.0、schemastery 3.19.0。
> 约定：下文 `INSTALL` = `C:\Users\VivianPC\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\`。

---

## 摘要（TL;DR）

1. **预览在 Web 前端，不在 Host 核心。** Markdown 文档预览由 `@deepseek-ai/dsh-client-ui-sidebar-documentpreview` 提供，正文组件调用 primitives 包的 `MarkdownText`。
2. **渲染器是 micromark + mdast 管线，不是 markdown-it / marked / comrak。** 解析器扩展硬编码在前端 bundle 里；**没有** markdown-it plugin 注入点。
3. **但预览框架本身是可扩展的，且扩展点相当强：**
   - `ctx.documentPreviews.register()` 可注册新渲染器，且 **extension 优先级高于 builtin** —— 可以注册一个处理 `.md` 的渲染器顶替内置 Markdown 预览，用 `loading: 'renderer'` 完全自管字节与渲染。这是直接支持新语法的最强路径。
   - 预览头部/空态/渲染器内部各有 Slot（`sidebar.right.tab.document.actions` / `.unpreviewable` / `.action`），可加自定义按钮。
   - 斜杠命令 `ctx.commandUi.register/decorate`、右键菜单 `ctx.contextMenus.register`、快捷键 `ctx.shortcuts.register` 均可加动作。
4. **没有文档预览专用的「导出 PDF / 导出 Markdown」按钮。** 现有导出是**会话日志级**的（`dsh-session-log-export`：`Copy Session as Markdown` + ZIP 下载 + `/export`），以及**原文件级**的下载/另存（`dsh-client-ui-file-actions`）、原生应用打开（`ui-open-in-app`）。
5. **client-plugin 与 Host 有成熟通信通道**：Host 通过 `webserver/index-inject` 注入全局配置，Client 通过 `ctx.remote.*` 进行 RPC / `$on` 监听事件。

**一句话结论**：预览渲染内核封闭（无 markdown-it 注入），但**预览框架与周边 UI 高度可扩展**；用「注册 extension 级 `.md` 渲染器 + 自定义 body」即可原生渲染新语法，用 Slot/命令/右键菜单即可加导出按钮，无需 fork 前端。

---

## 0. 环境与取证方法

- ASAR 归档内路径：`read`/`grep` 工具可直接穿透已知路径读取；批量枚举/正则扫描使用 `ELECTRON_RUN_AS_NODE=1` + `DeepSeek Harness.exe`（`&` 不等待，改用 `System.Diagnostics.ProcessStartInfo`）。
- 版本核实：`INSTALL/dsh/package.json` 的 `"version": "0.2.2-rc.5"`。
- 参考文档基线：`INSTALL/dsh-agent-preset/skills/dsh-doc/references/`（`ui-plugin.md`、`host-plugin.md`、`user-actions.md`、`practices.md`、`locate-docs.md`）。

---

## 1. Markdown 预览在哪里渲染？用什么渲染器？

### 1.1 归属：Web Client，不是 Host 核心

- 预览包：`INSTALL/dsh-client-ui-sidebar-documentpreview/`（v0.2.2-rc.5）。
  - `package.json` 描述：`"Extensible Sidebar previews for Office documents, spreadsheets, Markdown, code, images, PDF, HTML, and plain text"`。
  - `dsh.client.inject` 列出 `dsh-api-gateway`、`dsh-api-workspace-files`、`dsh-client-resources`、`dsh-client-ui-sidebar-right`、`dsh-client-ui-session`、`dsh-api-remotes`、`dsh-client-locale`、`dsh-client-ui-settings`、`dsh-client-ui-file-drag`、`dsh-client-ui-context-menu`；`"platform": "web"`。
  - 运行时依赖只有 `schemastery ~3.19.0`；`dompurify`、`pdfjs-dist`、`exceljs`、`yaml` 都是 devDependencies（构建期内联）。
- Preview 面板注册：`src/client/index.ts:33`（README）说明通过 `ctx.sidebarRightTabs.register(...)` 注册 id 为 `@deepseek-ai/dsh-client-ui-sidebar-documentpreview` 的 tab，kind `text`、band `fallback`、`canOpen` 仅 Session 地址。
- **Host 半只有一小段**：`INSTALL/dsh-client-ui-sidebar-documentpreview/src/index.ts:6-11`：
  > `export function apply(ctx: Context, config: Config): void { ctx.on('webserver/index-inject', (table) => { table.push({ kind: 'global', name: '__DSH_DOCUMENT_PREVIEW_CONFIG__', value: config }) }) }`

  即 Host 只把配置注入 Web 页面，渲染全在浏览器。

### 1.2 Markdown 正文组件

`INSTALL/dsh-client-ui-sidebar-documentpreview/src/client/markdown/MarkdownBody.tsx`（71 行）：

- `:4` `import { MarkdownText, type MarkdownLabels, type MarkdownPathImages } from '@deepseek-ai/dsh-client-ui-primitives'`
- `:34` `export function MarkdownBody({ content, resourceAddress, useResource, t }: MarkdownBodyProps): ReactNode`
- `:35-38` 通过 `useResource<'file'>(resourceAddress).value?.absolutePath` + `markdownImageUrl(document.baseURI, absolutePath, value)` 解析相对图片路径。
- `:49` `splitFrontmatter(text)` 拆出 frontmatter。
- `:54` `<MarkdownText text={split?.body ?? text} streaming={!content.eof} labels={labels} pathImages={pathImages} />`

**结论**：Markdown 解析/渲染的具体实现封装在 `@deepseek-ai/dsh-client-ui-primitives` 的 `MarkdownText`。该包在本机 `node_modules` 中**不存在**（仅构建期依赖，源码未随安装发布），因此只能从构建产物取证。

### 1.3 渲染器身份：micromark / mdast，非 markdown-it / marked / comrak

对 `INSTALL/dsh-web-frontend/dist/assets/` 的构建产物做关键字扫描：

- `index-Ciz7DZxv.js`（1041 KB）：命中 `micromark`、`mdast`、`katex`、`shiki`。
- `vendor-BUMdD3V7.js`（721 KB）：命中 `mdast`、`KaTeX`、`katex`、`shiki`。
- `dist/assets/fonts/` 下有 KaTeX 字体资源。
- **未命中** `markdown-it`、`marked`（普通英文单词 "marked" 为误报）、`comrak`、`unified`、`remark-parse` 等字符串。

构建 bundle 关键片段（字符偏移，非源码行号）：

- `@956198`：`micromark CommonMark attention markers are unavailable`（micromark 的 attention 构造错误）。
- `@960853`：
  ```
  function Vb(e){return Pb(u9(e,{extensions:[d9(Fb),Ab()],mdastExtensions:[f9(),Ub()]}),e)}
  function EW(e){return Pb(u9(e,{extensions:[d9(Fb),Ab(),zW(),iC()],mdastExtensions:[f9(),dC(),Ub()]}),e)}
  ```
  即自定义 micromark 扩展（`Ab`、`zW`、`iC`、`dC`、`Ub`、`d9`、`f9`）与 mdast 扩展，**全部硬编码在 bundle 内**。
- `@982946`：`const Bp = x.memo(function({ text:t, streaming:r=!1, labels:i, fileMentions:n, pathImages:o, variant:l="body", omitHtml:c=!1, ... }){ ... })` —— 这就是 `MarkdownText`。
- `@981176`：`function fK(e,t,r,i,n){const o=EW(e),...}` 为非流式解析；`var pK=class{labels;omitHtml;parser=new hW(Vb);...}` 为流式解析器。
- `@1004354` 导出表：`MarkdownDelegateProvider:BW, MarkdownText:Bp`。
- `@1005835`：`useMarkdownDelegate:Is`。

**关键判断**：`MarkdownText` 的解析器与扩展列表是**编译期固化**的，没有暴露成 Cordis service 或可注入的插件注册表。外部 client 插件无法注册 markdown-it 风格的语法插件。

### 1.4 一个「看似扩展点」但不可用的东西：MarkdownDelegateProvider

bundle `@968870`：
```
const qb = x.createContext({});
function BW({ children:e, openExternalLink:t, openFile:r, fileImages:i, getTriggerProps:n, renderCode:o }) {
  const l = x.useMemo(() => ({ openExternalLink:t, openFile:r, fileImages:i, getTriggerProps:n, renderCode:o }), [...]);
  return m.jsx(qb.Provider, { value:l, children:e })
}
function Is(){ return x.useContext(qb) }
```
`@974558` 显示 `renderCode` 用于覆盖代码块渲染：
```
function eK({lang,meta,code,streaming,labels}){const{renderCode:o}=Is();
  return o!==void 0 ? m.jsx("div",{className:Lt.fenceSeat,children:o({lang:e.toLowerCase(),code:r,streaming:i,meta:t})}) : ...}
```
这是 **primitives 包内部的 React Context**，只影响代码块。它是：
- 未在 Cordis 层 `ctx.reflect.provide` 成 service；
- 外部插件不能通过 `ctx` 拿到该 Provider 组件（它在 bundle 内部，不作为可注入 slot / service 暴露）；
- 即便能拿到，也只能改代码块，不能新增 block 级语法。

因此**不能**把它当成公共语法扩展点。标注：这是 bundle 反查推断，未找到任何公开文档或导出声明支持外部注册。

---

## 2. 可供插件注册/替换的扩展点

### 2.1 最强：DocumentPreviewRegistry（可顶替内置 Markdown 渲染器）

`INSTALL/dsh-client-ui-sidebar-documentpreview/src/client/document/registry.ts`（133 行）：

- `:6` `export type DocumentLoadMode = 'text-pages' | 'bytes-complete' | 'renderer'`
- `:9-33` `export interface DocumentPreviewDefinition { id, extensions, binaryExtensions?, priority?, title(), loading, wrap?, sourceLines? }`
  - `:20-21` 注释：`/** External implementations win over product implementations; defaults to extension. */ readonly priority?: 'builtin' | 'extension'`
- `:41-54` `matchingDocumentPreviews()`：
  ```
  rank: definition.priority === 'builtin' ? 0 : 1
  ...
  .sort((left, right) => right.rank - left.rank || right.length - left.length || left.order - right.order)
  ```
  即 **extension 排序永远在 builtin 之前**，然后按后缀长度、注册顺序。
- `:71-118` `export class DocumentPreviewRegistry`，`register(definition): () => void`；重复 id 抛 `documentPreviews: duplicate implementation "${definition.id}"`。
- `:125-127` `candidates(path)` 按上述顺序返回全部匹配实现（UI 会提供下拉切换）。

注册位置：`src/client/index.ts:91-93`（上一轮取证）：
```
const previews = new DocumentPreviewRegistry();
const disposePreviews = ctx.reflect.provide('documentPreviews', previews);
ctx.effect(() => disposePreviews)
```
README `:37` 明确对外部实现开放：
> `Document implementations register metadata with ctx.documentPreviews.register({ id, extensions, binaryExtensions?, priority, title, loading, wrap?, sourceLines? }) and a body under the same id in the keyed, Session-scoped sidebar.right.tab.document child slot`

内置 Markdown 就是这样注册的——`src/client/markdown/index.ts:16-30`：
```
:17 return { id: MARKDOWN_BODY_ID, extensions: ['md','markdown'], priority: 'builtin', title, loading: 'text-pages', wrap: false }
:27 ctx.effect(() => ctx.documentPreviews.register(markdownDefinition(() => t('viewer.label'))), ...)
:28-30 ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register(
       { name:'sidebar.right.tab.document', key: MARKDOWN_BODY_ID, locale:'documentMarkdown' }, MarkdownBody)), ...)
```

**推论（基于上述排序规则，属设计上可推导、未做运行时验证）**：第三方插件注册 `extensions:['md']`、`priority:'extension'` 的渲染器，即可在 `.md` 上排到内置之前，成为默认 viewer；配合 `loading:'renderer'`（README `:39`：body handles its own bytes）可完全自管内容加载与渲染，从而在传给 `MarkdownText` 前预处理 `@import`，或完全用自己的 React 渲染。注意 `sidebar.right.tab.document` 是 keyed slot，body 必须以**同一个 id**注册（`registry.ts:10` 注释：`id` 同时作为 document slot key）。

### 2.2 预览 UI 的 Slot 扩展点

`INSTALL/dsh-client-ui-sidebar-documentpreview/src/client/document/contract.ts`（107 行）声明的 SlotMap：

| Slot 名 | kind / scope | owner | 用途 |
|---|---|---|---|
| `sidebar.right.tab.document` | keyed / session | `DocumentBodyOwner` | 渲染器 body（按 `DocumentPreviewDefinition.id` 取） |
| `sidebar.right.tab.document.actions` | list / session | `{ absolutePath: string }` | 头部工具栏贡献，"rendered after the preview's own controls once the file's Host path is known" |
| `sidebar.right.tab.document.unpreviewable` | list / 同上 | 同上 | 无法预览时的空态贡献 |
| `sidebar.right.tab.document.action` | keyed | `{ content: DocumentContent }` | 渲染器专属控件，位于 Reload 之前 |

现成范例：`dsh-client-ui-open-in-app/src/client/index.ts:127-138` 正是往 `.actions` 和 `.unpreviewable` 注册按钮：
```
ctx.slots.inject('sidebar.right.tab.document.actions', () => ctx.slots.register({
  name:'sidebar.right.tab.document.actions', id:'open-in-app', locale:NS, inject:pathInjected }, OpenPathAction))
ctx.slots.inject('sidebar.right.tab.document.unpreviewable', () => ctx.slots.register(
  { name:'sidebar.right.tab.document.unpreviewable', id:'open-in-app', ... }, OpenPathEmptyAction))
```
**这是加自定义「导出」按钮最直接、最稳妥的落点。**

### 2.3 命令面板 / 右键菜单 / 快捷键

1. **斜杠命令**：`INSTALL/dsh-client-ui-commands/src/client/contract.ts`
   - `:101-114` `CommandContribution { name, label?(), description?(), icon?, available(session), ui: CommandUiSpec }`
   - `:64-89` `ui` 可为 `popupSelect`（options/onSelect）或 `action`（`run(session)`）
   - `:134-149` `CommandUiContract { register(contribution), decorate(decoration), dismiss(name), popupFor(actx) }`
   - 实现见 `src/client/service.ts:139-149`（`register`）、`:157-167`（`decorate`）、`:418-433`（`execute`，`ctx.remote.commands.execute(...)`）。
   - README `:28` 显示命令菜单已有 "Export" 分区（来自 `session-log-export`）。
2. **右键菜单**：`INSTALL/dsh-client-ui-context-menu/README.md:34-52`
   - `ctx.effect(() => ctx.contextMenus.register({ id, target, order, resolve }))`；`resolve` 返回带 `run` 回调的动作；支持 `observe(target)`、子菜单、`commandId` 关联快捷键、图标注册。
   - 可扩展 target 家族：声明合并 `ContextMenuTargetMap`（`:42`）。
3. **快捷键命令**：`dsh-client-ui-open-in-app/src/client/index.ts:84-102` 展示 `ctx.shortcuts.register({ id, label, defaults, regions, resolve })`。

### 2.4 Client-plugin 机制（承载上述注册）

- dsh-doc 模板 `templates/decoration/cordis.patch.yml`（3 行）：
  ```
  - insert:
      - id: my-decoration
        name: '@local/my-decoration'
  ```
- `templates/decoration/package.json`：含 `exports: { "./client": "./client.js" }`、`dsh.bundle.patch: "./cordis.patch.yml"`、`dsh.client: { platform: "web", immediately: true, inject: ["@deepseek-ai/dsh-client-ui-conversation"] }`。
- `templates/decoration/client.js`（22 行）：
  ```
  window.__ModuleLoader__.load({ id: '@local/my-decoration',
    factory(require) {
      const React = require('react');
      ...
      return { inject: ['slots'], apply(ctx) {
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({...}, Decoration));
      }};
    }});
  ```
- 规则（`references/ui-plugin.md:9-13`）：id 等于包名；React 来自浏览器模块表；factory 无副作用；资源在 `apply` 内用 `ctx.effect`/`ctx.on` 注册并回收；**不要替换 app root 或往 `document.body` 追加第二个应用**；不要读别的插件 DOM。

---

## 3. 预览里有没有「导出 PDF / 导出 Markdown」？

**结论：没有文档预览级别的 PDF/Markdown 导出按钮。** 已核实的导出能力如下：

| 能力 | 包 | 入口 | 粒度 |
|---|---|---|---|
| Copy Session as Markdown | `dsh-session-log-export` | Session Header more 菜单 | 整个会话日志 |
| Download session log（ZIP） | `dsh-session-log-export` | Session Header more 菜单 / `/export` | 会话 + 子会话 + 附件 |
| 下载/另存原文件 | `dsh-client-ui-file-actions` | 右键菜单 / 文件控件 | 原始文件字节 |
| 复制图片为 PNG | `dsh-client-ui-file-actions` | 右键菜单 | 图片 |
| 原生应用打开 / 显示文件位置 | `dsh-client-ui-open-in-app` | 预览头部按钮、右键菜单 | Host 路径 |

证据：

- `dsh-session-log-export/README.md:12`：
  > "The Session Header's more-actions menu offers `Copy Session as Markdown` and `Download session log`; an `/export` slash command also starts the ZIP download."
- 同文件 `:76`：`/export` → `api/session.export?sessionId=<id>&includeDescendants=true`（Host 路由 `/api/session.export`）；`:101` 说明 Host 半注册 `/api/session.export` 与 `/api/session.markdown`，浏览器半提供控制器与 UI；`:103` 明确"conversation package owns the Header trigger... This package contributes export and optional feedback rows that observe controller, availability, and locale sources"。
- `dsh-client-ui-file-actions/README.md:12,34,40`：Download/Save as/copy image，":40 ... contributes file and image copy, download, save-as, and localized feedback through `ctx.contextMenus`, independently of `ui-open-in-app`"。
- `dsh-client-ui-open-in-app/README.md:46`：`ui-file-actions` 拥有 copy、download、save-as；本包负责 open/reveal。
- `dsh-client-ui-sidebar-documentpreview/README.md:135,144`：预览"registers no tool, prompt section, or session event"、"Preview, not editing"；全文未提 PDF/Markdown 导出。

**能否新增导出按钮/命令？可以**——走 2.2 的 `.actions`/`.action` Slot 加按钮，走 2.3 的 `commandUi`/`contextMenus`/`shortcuts` 加命令；动作实现放在 Host service，Client 通过 `ctx.remote.*` 调用（见 §4 与 `references/user-actions.md`）。

---

## 4. client-plugin 生命周期与 Host 通信

### 4.1 Client plugin 生命周期

- 注册：`window.__ModuleLoader__.load({ id, factory(require) { return { inject?, apply(ctx) {} } } })`（`templates/decoration/client.js`）。
- `dsh.client.inject` **只控制激活顺序**，不是模块导入（`references/practices.md`）："do not require Harness Client packages as modules (`dsh.client.inject` only orders activation)"。
- React / React DOM / Cordis / ui-slots / ui-primitives 经 Web shell 的**静态模块表**保持单一浏览器身份（`dsh-client-ui-renderer/README.md:58`）："React, React DOM, Cordis, ui-slots, and ui-primitives retain one browser identity through the web shell's static module table; this package arrives as a dynamic client bundle." 因此 client 插件用 `require('react')` 拿到同一份 React。
- 挂载：`dsh-client-ui-renderer/README.md:12,32` —— 全部 client 插件 roster settle 后，boot kernel 调用 `ctx.uiRenderer.mount(container)`；renderer 执行唯一一次 `renderSlot('root')`。业务插件只注册 Slot 条目/Factory，不碰 React 内部。
- 资源清理：`ctx.effect()` / `ctx.on()` 返回的 disposer 随插件 fiber 生命周期回收（`references/ui-plugin.md:13`、`host-plugin.md:65`）。

### 4.2 Host ↔ Client 通信通道

1. **配置注入（Host → Client 全局）**：`ctx.on('webserver/index-inject', table => table.push({ kind:'global', name:'__DSH_..._CONFIG__', value: config }))`（`dsh-client-ui-sidebar-documentpreview/src/index.ts:6-11`）；Client 侧读 `globalThis.__DSH_DOCUMENT_PREVIEW_CONFIG__`（`src/client/index.ts:90`）。
2. **RPC（Client → Host）**：`ctx.remote.<service>.<method>(...)`，底层由 `dsh-client-connection` 承载（`README.md:34`）：浏览器 unary 调用走 HTTP POST；事件流走 API Gateway `/api/remote.mux` WebSocket；也有 exact Fetch routes（如 `api/session.export`）。示例：
   - `dsh-client-ui-open-in-app/src/client/open-path.ts:40-50` 定义 `OpenInAppPathRemote.session.canOpenWorkspacePath()/workspacePathApplications()/openWorkspacePath()`；`:98` 调用 `this.remote.session.openWorkspacePath(request)`。
   - `dsh-client-ui-commands/src/client/service.ts:108,423`：`ctx.remote.commands.list(sessionId)`、`ctx.remote.commands.execute(sessionId, line, attachments)`。
3. **事件（Host → Client）**：`ctx.remote.$on('commands/change', ...)`、`ctx.remote.$on('agent-preset/selected', ...)`（`service.ts:125,129`）。
4. **Host service 方法作为统一入口**：`references/user-actions.md:15` 的原则——一个操作只实现一次，作为 Host service 方法；UI action 通过 Client-callable Host 入口调用（典型就是 session command + `ctx.remote.commands.execute()`）；agent 工具也调同一方法；授权类操作保持 user-only。

---

## 5. 可行性排序与替代集成形态

> 所有条目均基于上文核实事实；「推论」字样表示依据设计规则推导、未做运行时实验。

**方案 A（推荐，推论）：注册 extension 级 `.md` 渲染器，自管渲染**
- 依据：§2.1 的排序规则（extension > builtin）+ `loading:'renderer'` + 同 id keyed body slot。
- 能力：可在 body 内预处理 MPE `@import`（先解析/展开，再交给 `MarkdownText`，或完全自绘 React）；切换下拉里内置 Markdown 仍保留，用户可选择。
- 风险：需正确实现 body 的加载/生命周期（`DocumentContent` 的 `renderer` 分支含 `loaded/failed/reload()`，见 `contract.ts`）；keyed slot 的 id 必须与 definition.id 一致。

**方案 B（稳妥）：保留内置预览，只加「增强」控件**
- 依据：§2.2 `.actions`/`.action` Slot、§2.3 命令/右键菜单/快捷键。
- 能力：新增「导出 HTML/PDF」「MPE 预览」按钮；点击后调用自定义命令/Host service。
- 适合不想接管整块 body 的场景。

**方案 C（保守替代）：agent 工具生成文件 + 原生应用打开**
- 依据：`dsh-client-ui-open-in-app/src/client/open-path.ts:94-105`（`session.openWorkspacePath`）、`dsh-session-log-export` 的 Host 路由模式、§4.2 RPC。
- 能力：插件提供 Host 工具把内容写成 HTML/PDF 到工作区，再复用 `session.openWorkspacePath` 或自带按钮让系统默认程序打开；不触碰预览内核。
- 注意：`user-actions.md` 提醒授权类操作须 user-only；路径须经 Host 组合文件系统校验（`ui-open-in-app/README.md:90`：`The Host verifies the path through the composed filesystem before opening or revealing it`）。

**方案 D（最重）：自带侧边栏 webview / 面板**
- 依据：`ctx.slots` + `sidebar.right.pane.tab`（document preview tab 本体所在位置，`README.md:34`）、`shell.overlay`、`references/practices.md` 的「UI 插件渲染 React 组件到 slot，不要 Host 提供 iframe HTML」。
- 能力：完全自定义渲染与交互；代价是要自行实现主题、locale、生命周期。
- 不推荐作为首选，除非 A/B 都不满足。

**不可行/无效路径**：
- 注册 markdown-it / micromark 语法插件 —— 无此扩展点（§1.3/§1.4）。
- 通过 `MarkdownDelegateProvider` 注入 block 语法 —— 内部 React Context，未 service 化，且仅影响代码块（§1.4）。
- 读/改其他插件 DOM 或替换 app root —— 明确禁止（`ui-plugin.md:13`）。

---

## 6. 关键文件路径索引（一手证据）

| 用途 | 路径（相对 `INSTALL`） |
|---|---|
| 预览包说明 | `dsh-client-ui-sidebar-documentpreview/README.md` |
| 预览 client 装配 | `dsh-client-ui-sidebar-documentpreview/src/client/index.ts` |
| 预览 Host 装配 | `dsh-client-ui-sidebar-documentpreview/src/index.ts` |
| 文档渲染器注册表 | `dsh-client-ui-sidebar-documentpreview/src/client/document/registry.ts` |
| Slot 契约 | `dsh-client-ui-sidebar-documentpreview/src/client/document/contract.ts` |
| Markdown 正文 | `dsh-client-ui-sidebar-documentpreview/src/client/markdown/MarkdownBody.tsx` |
| Markdown 内置注册 | `dsh-client-ui-sidebar-documentpreview/src/client/markdown/index.ts` |
| 按钮注册范例 | `dsh-client-ui-open-in-app/src/client/index.ts`、`open-path.ts` |
| 命令注册 API | `dsh-client-ui-commands/src/client/contract.ts`、`service.ts` |
| 右键菜单文档 | `dsh-client-ui-context-menu/README.md` |
| 会话导出 | `dsh-session-log-export/README.md`、`src/index.ts`、`src/client/index.ts` |
| 文件动作 | `dsh-client-ui-file-actions/README.md` |
| 前端 bundle（渲染器取证） | `dsh-web-frontend/dist/assets/index-Ciz7DZxv.js`、`vendor-BUMdD3V7.js` |
| 插件开发规范 | `dsh-agent-preset/skills/dsh-doc/references/{ui-plugin,host-plugin,user-actions,practices}.md` |
| client-plugin 模板 | `dsh-agent-preset/skills/dsh-doc/templates/decoration/{client.js,package.json,cordis.patch.yml}` |
| Host↔Client 通道 | `dsh-client-connection/README.md` |

---

## 7. 待验证项（诚实标注）

- 未做运行时实验验证「extension 级 `.md` 渲染器确实成为默认 viewer」——这是依据 `matchingDocumentPreviews()` 排序代码与 README 声明得出的推论。
- `@deepseek-ai/dsh-client-ui-primitives` 源码未随安装发布，`MarkdownText` 内部仅由 bundle 反查；`MarkdownDelegateProvider` 是否可被外部包通过静态模块表获取并包裹自己的 slot 组件，未验证（文档无记载）。
- 未检查 `dsh-crossnote` 当前 bundle 的具体 patch 内容（本任务聚焦 DSH 侧能力）。
