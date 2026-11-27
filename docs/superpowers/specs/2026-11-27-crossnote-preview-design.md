# Design: 增强 DSH Markdown 预览 —— crossnote 语法渲染 + 全量导出 + 工具链配置

- 日期：2026-11-27
- 状态：待用户复核（brainstorming 阶段产出，未获批准前禁止写实现代码）
- 关联：`docs/PRD.md`、`research/05-dsh-preview-extension.md`、`research/06-crossnote-exports.md`

## 1. 背景与目标

用户原始诉求（`m00001`）：AI 编辑适合把单文件控制在约 500 行，但文档一多就产生碎片文件；希望有一个「总纲」文件用 `@import` 之类语法把多个碎片的章节包含进来，支持改写目录名、导入后标题降级、图片/相对链接，导出成单个纯 `.md` 给 Typora 打开并导出 PDF。技术选型一度倾向 Rust，后（`m00351`）明确改为：**不要 Rust，基于 crossnote（Markdown Preview Enhanced 底层）二次开发，做成 DSH 插件**。

本次新需求（`m00704`）：**增强 DSH 内置 Markdown 预览**，使其能直接预览 crossnote 的新语法（`@import` 等），并支持 crossnote 的全部导出能力（Markdown / PDF 等）；如有必要，设计配置页来检测/配置导出所需的底层工具。

目标拆解：
1. 在 DSH 预览里直接渲染 `@import` 展开后的内容（不是显示原始指令文本）。
2. 提供 Markdown / HTML / PDF 等导出入口（agent 工具 + 预览按钮/命令）。
3. 提供工具链检测 + 路径配置 + 安装引导（不自动下载大文件）。

## 2. 关键调研结论（设计依据）

### 2.1 DSH 预览扩展点（`research/05-dsh-preview-extension.md`）
- 预览正文在 Web 前端 `@deepseek-ai/dsh-client-ui-sidebar-documentpreview`；渲染内核是 **micromark + mdast**，扩展硬编码在 bundle 内，**无 markdown-it 注入点**。`MarkdownDelegateProvider` 是内部 React Context，仅管代码块，非公共扩展点。
- 存在强扩展点：`ctx.documentPreviews.register()`，支持 `priority:'extension'`，排序恒在 `builtin` 之前（`registry.ts:41-54`，rank extension=1 / builtin=0）；配 `loading:'renderer'` 可完全自管内容。
- 加按钮落点：Slot `sidebar.right.tab.document.actions`（owner `{absolutePath}`）、`.action`、`.unpreviewable`；命令 `ctx.commandUi.register/decorate`、右键 `ctx.contextMenus.register`、快捷键 `ctx.shortcuts.register`。
- 无文档预览级 PDF/Markdown 导出；现有导出是会话级（`dsh-session-log-export`）与原文件级（`dsh-client-ui-file-actions`）。
- Host↔Client：`ctx.remote.*` RPC、`ctx.remote.$on` 事件、`webserver/index-inject` 注入全局配置。一个操作应实现为 Host service，UI 与 agent 工具共用（`references/user-actions.md`）。

### 2.2 crossnote 导出能力（`research/06-crossnote-exports.md`）
| API | 产物 | 外部依赖 | 分期 |
|---|---|---|---|
| `markdownExport` | 纯 `.md`（返回路径） | 无（但 Mermaid/WaveDrom 会 `npx` 自动下载、数学转在线图，需隔离） | ① |
| `htmlExport({offline:true})` | `.html`（返回路径） | 无，offline 断 CDN | ① |
| `htmlExportDocument` | HTML 字符串 | 无 | ①（预览渲染用） |
| `chromeExport` | PDF/PNG/JPEG | 本机 Chrome（puppeteer-core 随包不下载浏览器） | ① |
| `pandocExport` | PDF/DOCX/RTF | pandoc + pdflatex | ② |
| `princeExport` | PDF | PrinceXML（硬编码 `prince`，必须 PATH，无路径键） | ② |
| `eBookExport` | epub/mobi/... | Calibre `ebook-convert`（必须 PATH） | ② |
- 5 个配置键（`chromePath`/`pandocPath`/`imageMagickPath`/`enableScriptExecution`/`markdownYoBinaryPath`）在 `.crossnote/config.js` 会被忽略，**必须从 `Notebook.init({config})` 传**。
- 默认 `mathRenderingOption:'KaTeX'`；设为 `'None'` 可关数学转图。`markdownFileExtensions` 已含 `.mdx`。

### 2.3 Spike 实测：`TextPreview.tsx` 的选择逻辑（本设计的关键修正）
读 `TextPreview.tsx:81-90` 确认：
```
const candidates = matchingDocumentPreviews(definitions, file.path)  // 仅按后缀匹配
const selected = candidates.find(c => c.id === state?.rendererId) ?? candidates[0]
```
`registry.ts:41-54` 的排序使 `priority:'extension'` 恒在 builtin 前。
**结论：渲染器注册表没有 per-file "decline" 回调。** 若注册 `extensions:['md'], priority:'extension'`，**所有 `.md` 都会被默认接管**，违背「普通 .md 走原生」。头部虽有 viewer 下拉（`TextPreview.tsx:300-317`）可手动切回内置，但默认行为不可接受。

因此采用后缀分流：总纲文件用 `.mdx` 后缀，只注册 `extensions:['mdx']` 的 extension renderer。普通 `.md` 完全不受影响。这与用户原始需求里"这个也是 mdx 之类的后缀"一致。

## 3. 已确认的决策
| # | 决策 | 来源 |
|---|---|---|
| D1 | 改造 DSH 内置预览（非独立面板） | 用户澄清 |
| D2 | 工具配置页 = 检测 + 路径配置 + 安装引导，不自动下载大文件 | 用户澄清 |
| D3 | 导出范围 = 全部但分阶段（① Markdown+HTML+Chrome PDF；② pandoc/Prince/eBook） | 用户澄清 |
| D4 | 预览触发 = 只在显式命令/按钮触发（普通 .md 走原生） | 用户澄清 |
| D5 | 技术路线 = 方案 A：extension 渲染器 + Slot 按钮 | 用户确认 |
| D6 | bundle 形态 = Host + Client 双端 | 用户确认 |
| D7 | 显式触发实现 = 总纲用 `.mdx` 后缀，只接管 `.mdx` | Spike 后用户确认 |
| D8 | 配置页入口 = DSH 设置里的插件配置表单（configForms） | 用户确认 |

## 4. 架构设计

### 4.1 Bundle 形态（Host + Client 双端）
- `package.json`：`exports` 增 `"./client": "./client.js"`；`dsh` 增 `"client": {"platform":"web","deploy":"web","inject":[]}`；`files` 纳入 `client.js`。
- `cordis.patch.yml`：保持单条 `insert` 行（id `@local/dsh-crossnote`）。
- **Host** `index.js`：注册 agent 工具 `crossnote_merge`（已有）+ `crossnote_export`；以 `ctx.reflect.provide` 暴露 `crossnote` Host service（render/export/detectTools）；用 `ctx.on('webserver/index-inject')` 注入必要全局配置。
- **Client** `client.js`：`window.__ModuleLoader__.load({id, factory(require){...}})`，在 `apply(ctx)` 内：
  - `ctx.documentPreviews.register({id:'crossnote-mdx', extensions:['mdx'], priority:'extension', title, loading:'renderer'})`；
  - `ctx.slots.inject('sidebar.right.tab.document', ...)` 以**同 id** 注册 body 组件；
  - `ctx.slots.inject('sidebar.right.tab.document.actions', ...)` 加「Crossnote 导出」按钮；
  - `ctx.commandUi.register` 加 `crossnote.preview` / `crossnote.export` 命令。

### 4.2 预览链路（`.mdx` 总纲）
```
用户打开总纲.mdx
  → extension renderer（crossnote-mdx）自动成为默认 viewer（因 priority=extension 且 .md 不匹配）
  → body 组件拿到 DocumentContent{kind:'renderer', loaded(), failed(), reload()}
  → ctx.remote.crossnote.render(absolutePath)
      Host: preprocess(.mdx 降级/改名/切片) → stashDiagrams → htmlExportDocument({offline:true}) → HTML 字符串
  → body 渲染 HTML（dangerouslySetInnerHTML，需 DOMPurify 清洗，preview 包已内联 dompurify）
  → content.loaded(version) 上报版本；reload() 触发重新渲染
```
- 普通 `.md` 不匹配该 renderer → 走 builtin Markdown 原生渲染，行为不变。
- 图片/相对链接：host 渲染前需把相对路径改写为可访问 URL（webserver 资源地址）或 base64 内联（HTML 字符串场景优先 data URI，见 §5 风险 R2）。

### 4.3 导出链路
- 统一入口 Host service `crossnote.export({source, format, options})`：
  1. `preprocess(source)` → staging 副本（复用 `src/preprocess.js`）；
  2. `stashDiagrams` 隔离 Mermaid/WaveDrom，`mathRenderingOption:'None'`；
  3. `Notebook.init({notebookPath, config: {...pluginConfig, ...defaults}})`；
  4. 按 format 调 `markdownExport` / `htmlExport` / `chromeExport` / `pandocExport` / `princeExport` / `eBookExport`；
  5. 恢复 diagrams，读产物返回 `{path, bytes, warnings}`。
- agent 工具、预览按钮、命令三者都调这一个 service（user-actions.md 原则：一个操作实现一次）。
- 分期：D3 ① 先实现 Markdown/HTML/Chrome PDF；② 加 pandoc/Prince/eBook。

### 4.4 工具检测与配置页
- Host service `detectTools()`：探测 `chrome`/`pandoc`/`pdflatex`/`prince`/`ebook-convert`（Windows 查 PATH + 常见安装路径；macOS/Linux 用 PATH），返回 `{name, found, version, path}`。
- 插件配置（schemastery `Config`）：`chromePath`、`pandocPath`、`latexEngine`、`imageFolderPath`、`mathRenderingOption` 等；在 `Notebook.init({config})` 时注入（绕开 `.crossnote/config.js` 忽略问题）。
- 配置页：DSH 设置面板的插件配置表单。检测表（工具/状态/版本/路径）+ 路径输入框 + 各平台安装命令/官网链接。保存用 `ctx.fiber.entry` + `ctx.get('configEditor').edit(entry, ...)`（configuration.md）。
- `configForms` 具体 API 未在 dsh-doc references 详述（仅在预览包 inject 列表出现）——**实现 spike 阶段用 `cordis_inspect_query` 或包源码核实**。若不可用，退化为 Host 服务 + 命令输出检测结果。

## 5. 风险与退路
| ID | 风险 | 缓解 |
|---|---|---|
| R1 | extension renderer 顶替契约（keyed slot 同 id、body 生命周期）虽经源码推理确认，但未运行时实测 | 实现 spike 先搭最小 client bundle 验证 `.mdx` 默认走 crossnote、body 收到 renderer content；失败退回「只加导出按钮」（方案 B） |
| R2 | crossnote HTML 中相对图片路径在预览面板不可解析 | 渲染时改写为工作区资源 URL 或 data URI；spike 验证 |
| R3 | `npx` 自动下载 Mermaid/WaveDrom 导致挂起（已实测踩坑） | stashDiagrams 占位 + 导出后还原；`mathRenderingOption:'None'` |
| R4 | PrinceXML/Calibre 无路径配置键，只能靠 PATH | 检测页明确提示需加入 PATH；安装引导给命令 |
| R5 | `configForms` API 未文档化 | 实现前用 `cordis_inspect_query`/源码核实；不可用则退化方案 |
| R6 | 双端 bundle 增加安装/升级复杂度 | 严格按 decoration 模板，`inject` 只列必要项；files 列全资源 |

## 6. 复用现有实现
- `src/directive.js` / `src/preprocess.js` / `src/sideeffects.js` / `src/merge.js` 已实现并端到端实测通过（改名 ✅、降级 ✅、图片路径 ✅）。导出子系统直接复用其 preprocess+sideeffects 管线，仅把"调 markdownExport"扩展为"按 format 调多个 API"。
- `src/merge.js` 的 `Notebook.init` 参数需扩展为合并插件配置（当前仅 `mathRenderingOption:'None'`）。

## 7. 里程碑
- M1（spike）：最小 client bundle 验证 `.mdx` renderer 顶替 + 图片路径；验证 configForms API。（本设计批准后第一步）
- M2：Host service `render`/`export`/`detectTools` + 配置 schemastery；扩展 `src/merge.js`。
- M3：Client renderer + body + actions 按钮 + 命令。
- M4：设置面板配置表单（检测表 + 路径 + 安装引导）。
- M5：分期②导出（pandoc/Prince/eBook）+ 文档/测试。

## 8. 验收标准
- 普通 `.md` 预览行为与改动前一致（原生渲染）。
- 打开含 `@import` 的 `.mdx`，预览直接显示展开内容（标题已降级/改名、图片/相对链接可用）。
- 通过按钮/命令/agent 工具均可导出 Markdown（纯 `.md` 给 Typora）、HTML、Chrome PDF。
- 设置面板能检测工具状态，路径配置可保存并在导出时生效。
- 含 Mermaid/数学的总纲导出不触发 `npx` 下载、不挂起。

## 9. 明确的非目标
- 不注入 markdown-it / micromark 语法插件（无此扩展点）。
- 不自动下载外部大文件（Chrome/pandoc/Prince/Calibre 由用户自行安装）。
- 不改变普通 `.md` 的渲染路径。
- 不 fork crossnote 上游；以 npm 依赖方式使用其导出 API，二次开发集中在 preprocess/副作用隔离层。

## 10. 待用户复核的问题
- 是否确认 `.mdx` 后缀作为总纲文件的约定（D7）？这会影响用户如何组织文件。
- 分期②（pandoc/Prince/eBook）是否接受"先搭框架、后续实现"，还是希望第一期一并完成？
