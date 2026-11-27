# crossnote 导出能力全面盘点（v0.9.44）

> 调研任务：全面盘点 crossnote 支持的所有导出 API、每种导出需要的底层外部工具、以及如何在 Node 里独立调用。
> 观测日期 **2026-11-27**。本报告只陈述核实过的事实；不确定处显式标注「⚠️不确定」。
> **一手来源**：① 本机安装的 npm 包 `crossnote@0.9.44`（`E:\Project\rust-md\verify\node_modules\crossnote`）的类型定义 `out\types\src\` 与运行时 bundle `out\cjs\index.cjs`（minified，行号即 bundle 行号）；② GitHub 仓库 `shd101wyy/crossnote` 的 `master` 分支源码（`src/markdown-engine/index.ts`、`src/notebook/types.ts`，均为 HTTP 200 抓取）。
>
> ⚠️**版本差异提醒**：`master` 源码与已发布 v0.9.44 的 bundle/`.d.ts` 存在少量差异（例：`master` 把 `htmlExport` 与 `htmlExportDocument` 合并为单一 `htmlExport`；`master` 的 `FrontMatterRenderingOption` 少了 'code block'/'vertical table'）。**描述 v0.9.44 行为时以本机 bundle + `.d.ts` 为准**，`master` 源码行号仅作交叉印证。

---

## 0. 结论速览

crossnote 的导出能力集中在 `MarkdownEngine` 类（`out\types\src\markdown-engine\index.d.ts:110-144`），全部返回 `Promise<string>`，返回值语义分两类：

- **返回「产物文件路径」**：`htmlExport` / `chromeExport` / `princeExport` / `eBookExport` / `pandocExport` / `markdownExport` / `openInBrowser`(void)。
- **返回「HTML 字符串内容」**：`htmlExportDocument` / `generateHTMLTemplateForExport`。

底层外部工具依赖概览：

| 导出 API | 产物 | 外部依赖 | 主要副作用 / 联网点 |
| --- | --- | --- | --- |
| `markdownExport` | 纯 `.md` | 数学→在线图片服务；图表→`npx @mermaid-js/mermaid-cli`、`npx wavedrom-cli`、可选 ImageMagick | ⚠️**高危**：自动 `npx` 拉包+下载无头浏览器会挂起；数学公式联网取图 |
| `htmlExport` | `.html` | 无（纯本地渲染；非 offline 时前端脚本走 CDN） | 写文件；非 offline 时复制 reveal.js 演讲者备注依赖；浏览器端脚本依赖 CDN（可 offline 规避） |
| `htmlExportDocument` | HTML 字符串 | 无 | 纯内存渲染不落盘；CDN 同上 |
| `chromeExport` | PDF / PNG / JPEG | **Chrome/Chromium**（`chromePath`）+ `puppeteer-core`（包内已带） | 写文件；**不自动下载浏览器**（用 puppeteer-core）；需本机有 Chrome；可选 `openFileAfterGeneration` |
| `princeExport` | PDF | **PrinceXML**（二进制 `prince`，⚠️无 `princePath` 配置键，硬编码） | 写文件；演示模式直接返回 URL 不调用 prince；可选打开文件 |
| `eBookExport` | EPUB / MOBI / PDF / HTML | **Calibre `ebook-convert`** | 写文件；远程图片会 `fetch()` 下载；PDF 需要 ebook front-matter；emoji→SVG |
| `pandocExport` | PDF / DOCX / RTF / 自定义 | **Pandoc**（`pandocPath`，默认 `pandoc`） | 写文件；可选打开文件；PDF 等格式间接依赖 LaTeX（`latexEngine`） |
| `openInBrowser` | 无（打开系统浏览器） | 系统默认浏览器 | 仅打开预览 |
| `generateHTMLTemplateForExport` | HTML 字符串（完整模板） | 无 | 纯内存 |

**另类的非 `MarkdownEngine` 导出**：`buildWiki`（顶层导出，`out\types\src\index.d.ts:18`）把整个 notebook 构建为单文件 `index.html` 的浏览器 wiki；`exportOnSave`（private）是按保存时 front-matter 自动触发上述导出的内部机制。

---

## 1. 逐 API 详解（签名 / 参数 / 返回值 / 证据）

类型定义统一出处：`E:\Project\rust-md\verify\node_modules\crossnote\out\types\src\markdown-engine\index.d.ts:110-144`（v0.9.44）。GitHub 对应 `src/markdown-engine/index.ts`，链接中的 `L` 为 `master` 源码行号（bundle 行号另注）。

### 1.1 `markdownExport` —— 导出纯 Markdown

- 签名：`markdownExport({ runAllCodeChunks? }?: { runAllCodeChunks?: boolean }): Promise<string>`
- 返回：**产物 `.md` 文件路径**（不是内容）。
- 关键逻辑（`out\cjs\index.cjs` L677-681）：
  - 先剥离 front matter；读取 front matter 里的 `markdown` 配置块：`path`、`image_dir`、`use_absolute_image_path`、`ignore_from_front_matter`。
  - `image_dir` 默认取 `config.imageFolderPath`（默认 `/assets`）；输出 `path` 默认规则：`.src.` → `.`，否则加 `_` 前缀扩展名。
  - 调用 `markdownConvert(text, {...}, config)`（`converters\markdown-convert.d.ts:3-17`）以 `forMarkdownExport:true` 展开所有 import、重写路径，写盘（bundle 的 `Mk` 写文件函数）。
  - 数学公式：以 `mathRenderingOnlineService`（默认 `https://latex.codecogs.com/gif.latex`）转成在线图片 URL → **联网**。
  - 图表：Mermaid 走 `npx -p @mermaid-js/mermaid-cli mmdc`（bundle L245 的 `K2 mermaidToPNG`，`cross-spawn sync`）；WaveDrom 走 `npx wavedrom-cli`（bundle L246-248 的 `Q2`）。
- 外部依赖 / 副作用：**⚠️最高风险**——`npx` 在包缺失时会触发 `@mermaid-js/mermaid-cli` 自动安装并拉 Puppeteer 无头 Chromium，网络差/无网时挂起（即任务背景里已确认的坑）；数学图片联网获取。
- 一手链接：[src/markdown-engine/index.ts#L2227（master）](https://github.com/shd101wyy/crossnote/blob/master/src/markdown-engine/index.ts#L2227) · [markdown-convert.d.ts（本机）](../verify/node_modules/crossnote/out/types/src/converters/markdown-convert.d.ts)

### 1.2 `htmlExport` —— 导出 HTML 文件

- 签名：`htmlExport({ offline?, runAllCodeChunks? }?: { offline?: boolean; runAllCodeChunks?: boolean }): Promise<string>`
- 返回：**产物 `.html` 文件路径**。
- 关键逻辑（v0.9.44 bundle `out\cjs\index.cjs` L657；master 源码 `L1516-1583`）：
  - `parseMD(inputString, {useRelativeFilePath:true, hideFrontMatter:true, isForPreview:false, runAllCodeChunks})`（spill L1528-1533）。
  - front matter 的 `html` 配置块可覆盖：`offline`、`embed_local_images`（默认 false）、`embed_svg`（默认 true）（spill L1534-1543）。
  - 输出路径：`dest = this.filePath` 把扩展名替换为 `.html`（spill L1545-1547）。
  - 调 `generateHTMLTemplateForExport(html, yamlConfig, {isForPrint:false, isForPrince:false, embedLocalImages, offline, embedSVG})`（spill L1549-1555）。
  - 若 `!offline` 且 HTML 含 reveal.js 演讲者备注依赖，复制 `revealjs_deps/notes.js` 与 `notes.html`（spill L1559-1579）。
  - `await this.fs.writeFile(dest, html)` 后 `return dest`（spill L1581-1582）。
- 外部依赖 / 副作用：**无本地外部工具**；会写文件。非 offline 模式下 HTML 里引用的 KaTeX 0.19.1 / fontawesome 6.4.2 / mermaid 12.3.0 / wavedrom 3.3.0 / reveal.js 4.6.0 / tikzjax 等脚本走 `https://${jsdelivrCdnHost}/npm/...` CDN（bundle L561），离线场景设 `offline:true` 可内嵌资源。
- 一手链接：[src/markdown-engine/index.ts#L1516（master）](https://github.com/shd101wyy/crossnote/blob/master/src/markdown-engine/index.ts#L1516)

### 1.3 `htmlExportDocument` —— 返回 HTML 字符串

- 签名：`htmlExportDocument({ offline?, embedLocalImages?, embedSVG?, runAllCodeChunks? }?: {...}): Promise<string>`
- 返回：**HTML 字符串内容**（不落盘）。
- 关键逻辑（bundle L657）：`parseMD(useRelativeFilePath:true, hideFrontMatter:true, isForPreview:false)` → front matter `html` 覆盖 offline/embed_local_images/embed_svg → `generateHTMLTemplateForExport` → 返回字符串。
- ⚠️**版本差异**：`master` 分支已把该方法合并进 `htmlExport`（通过 front matter `html` 块控制），但 v0.9.44 安装包的 `.d.ts` 与 bundle 中**两者并存**，独立调用请以本机 API 为准。
- 外部依赖 / 副作用：纯内存；CDN 同上。
- 一手链接：[index.d.ts:110-144（本机 .d.ts，含 htmlExportDocument 声明）](../verify/node_modules/crossnote/out/types/src/markdown-engine/index.d.ts)

### 1.4 `chromeExport` —— 用 Puppeteer + Chrome 生成 PDF/PNG/JPEG

- 签名：`chromeExport({ fileType?, runAllCodeChunks?, openFileAfterGeneration? }?: {fileType?: string; runAllCodeChunks?: boolean; openFileAfterGeneration?: boolean}): Promise<string>`
- 返回：**产物文件路径**。
- 关键逻辑（bundle L657；master 源码 spill L1588-1707 → `L1584-1703`）：
  - `fileType` 默认 `'pdf'`，输出路径把扩展名换成 `.${fileType}`。
  - Chrome 路径解析：`config.chromePath` 优先，否则用 `chrome-paths` 探测（`chrome` || `chromeCanary` || `chromium`）；都没有则报 **"Chrome executable path is not set."**
  - 动态 `await import("puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js")` 加载 Puppeteer，以 headless 启动并传入 `puppeteerArgs`。
  - 生成临时 HTML → `page.goto(fileURL)`，演示模式追加 `?print-pdf`。
  - `puppeteerConfig = {path:dest, margin:1cm×4, printBackground: config.printBackground, ...(yamlConfig.chrome || yamlConfig.puppeteer)}`；超时取 `chromeConfig.timeout || puppeteerConfig2.timeout || config.puppeteerWaitForTimeout`。
  - `fileType === 'pdf'` 走 `page.pdf()`，否则 `page.screenshot({fullPage:true})`（PNG/JPEG）。
  - `openFileAfterGeneration` 为真则 `utility.openFile(dest)`；最后 `return dest`。
- 外部依赖 / 副作用：需要**本机已装 Chrome/Chromium**；`puppeteer-core` 已随包安装，**不会自动下载浏览器**（无 Puppeteer 全量包的下载行为）；会写临时 HTML 与产物文件。
- 一手链接：[src/markdown-engine/index.ts#L1584（master）](https://github.com/shd101wyy/crossnote/blob/master/src/markdown-engine/index.ts#L1584)

### 1.5 `princeExport` —— 用 PrinceXML 生成 PDF

- 签名：`princeExport({ runAllCodeChunks?, openFileAfterGeneration? }?: {...}): Promise<string>`
- 返回：**PDF 文件路径**。
- 关键逻辑（bundle L657；master 源码 spill L1717-1759 → `L1713-1755`）：
  - 生成临时 HTML → `princeConvert(tempHtmlPath, destPdfPath)`（`converters\prince-convert.d.ts:1`：`princeConvert(src, dest): Promise<void>`）。
  - 底层 helper（bundle L298 的 `uL`）：`execFile("prince", [htmlPath, "--javascript", "-o", dest], {windowsHide:true})` —— **二进制名硬编码为 `prince`**。
  - ENOENT 时报错：`"princexml" is required to be installed.`
  - 演示模式（reveal.js）直接返回 `fileURL + "?print-pdf"`，**不调用 prince**。
  - `openFileAfterGeneration` 为真则打开产物；`return dest`。
- 外部依赖 / 副作用：需要 **PrinceXML**，且⚠️**没有 `princePath` 配置键**——必须让 `prince` 在 `PATH` 中（这点需特别告知使用方）；写文件。
- 一手链接：[src/markdown-engine/index.ts#L1713（master）](https://github.com/shd101wyy/crossnote/blob/master/src/markdown-engine/index.ts#L1713) · [prince-convert.d.ts（本机）](../verify/node_modules/crossnote/out/types/src/converters/prince-convert.d.ts)

### 1.6 `eBookExport` —— 用 Calibre `ebook-convert` 生成电子书

- 签名：`eBookExport({ fileType, runAllCodeChunks? }: {fileType: string; runAllCodeChunks?: boolean}): Promise<string>` —— 注意 `fileType` **必填**。
- 返回：**产物文件路径**。
- 关键逻辑（bundle L657；master 源码 spill L1810-2158 → `L1806-2154`）：
  - `fileType` 常见值 `epub` / `mobi` / `pdf` / `html`（默认 `epub`）。
  - 缺少 ebook front-matter 报错：`"eBook config not found. Please insert ebook front-matter to your markdown file."`
  - 从正文最后一个 `ul` 构建目录（TOC）；`.html` 类型会把图片内联。
  - `fileType === 'pdf'` 时对 emoji 做 `emojiToSvg`。
  - `eBookDownloadImages`（private）：仅 `.epub`/`.mobi` 时处理，⚠️bundle 里判断写成 `path.extname('dest') === ".mobi"`（字面量，疑似 bug），对 `http(s)` 远程图片用 `fetch()` 下载到 `fileDirectoryPath`，失败报 `Failed to download image from <url>` → **联网点**。
  - 最终调用 `ebookConvert(tempHtml, dest, ebookConfig)`（`converters\ebook-convert.d.ts:1`：`ebookConvert(src, dest, config?): Promise<void>`）= Calibre **`ebook-convert`** 二进制。
  - ebook front-matter 支持的键（bundle L116）：`--title`（默认 "No Title"）、`--authors`、`--cover`、`--comments`、`--publisher`、`--book-producer`、`--pubdate`、`--language`、`--isbn`、`--tags`、`--series`、`--rating`；排版类 `--asciiize`、`--base-font-size`、`--disable-font-rescaling`、`--line-height`、`--margin-top/right/bottom/left`（默认 72）、`--no-default-epub-cover` 等。
- 外部依赖 / 副作用：需要 **Calibre `ebook-convert`**（无专门 config 路径键，⚠️需放 `PATH`）；远程图片联网；写文件。
- 一手链接：[src/markdown-engine/index.ts#L1806（master）](https://github.com/shd101wyy/crossnote/blob/master/src/markdown-engine/index.ts#L1806) · [ebook-convert.d.ts（本机）](../verify/node_modules/crossnote/out/types/src/converters/ebook-convert.d.ts)

### 1.7 `pandocExport` —— 用 Pandoc 生成 PDF/DOCX/RTF 等

- 签名：`pandocExport({ runAllCodeChunks?, openFileAfterGeneration? }?: {...}): Promise<string>`
- 返回：**产物文件路径**（pandocConvert 产出的 `outputFilePath`）。
- 关键逻辑（bundle L677-681；master 源码 spill L2167-2222 → `L2163-2218`）：
  - 读取源文件 → 经 `parserConfig.onWillParseMarkdown` 钩子 → 可选 `parseMD`（为 code chunk 准备）→ front matter 转 config → `pandocConvert(text, {...}, config)`（`converters\pandoc-convert.d.ts:3-18`）。
  - `pandocConvert`（bundle L286/292 的 `lL`）：参数 `["-f", pandocMarkdownFlavor.replace(/-raw_tex/,""), ...]`，`-o output`；helper `uj()` 追加 `--toc`/`--toc-depth`/`--highlight-style`/`--reference-docx`/`--natbib`/`--biblatex`/`--number-sections`/`-V theme`；`execFile(config.pandocPath, V, {cwd:fileDirectoryPath, windowsHide:true})`。
  - 输出格式映射：`pdf_document`|`beamer_presentation` → `.pdf`，`word_document` → `.docx`，`rtf_document` → `.rtf`，`custom_document` → `*`。
  - pandoc 缺失时报错：`"pandoc" is required to be installed. Check "http://pandoc.org/installing.html" website.`（bundle L689/694-695 的 `pandocRender` 路径同样用 `config.pandocPath`）。
- 外部依赖 / 副作用：需要 **Pandoc**（`pandocPath`，默认 `pandoc`）；PDF 格式间接需要 LaTeX 引擎（`latexEngine`，默认 `pdflatex`）；写文件；可选打开文件。
- 一手链接：[src/markdown-engine/index.ts#L2163（master）](https://github.com/shd101wyy/crossnote/blob/master/src/markdown-engine/index.ts#L2163) · [pandoc-convert.d.ts（本机）](../verify/node_modules/crossnote/out/types/src/converters/pandoc-convert.d.ts)

### 1.8 `generateHTMLTemplateForExport` —— 生成导出用完整 HTML 模板

- 签名：`generateHTMLTemplateForExport(html: string, yamlConfig: Record<string, unknown> | undefined, options: HTMLTemplateOption): Promise<string>`
- `HTMLTemplateOption`（`out\types\src\markdown-engine\index.d.ts:25-33`）：`{isForPrint: boolean; isForPrince: boolean; offline: boolean; embedOfflineAssets?: boolean; embedLocalImages: boolean; embedSVG?: boolean; isForBrowser?: boolean}`。
- 返回：**HTML 字符串**（不落盘）。
- 关键逻辑（bundle L561；master 源码 spill L942 → `L938`）：`offline:true` 时内嵌本地资源；非 offline 时用 `https://${jsdelivrCdnHost}/npm/...` 引入 KaTeX 0.19.1、fontawesome 6.4.2、mermaid 12.3.0、wavedrom 3.3.0、reveal.js 4.6.0 及 tikzjax 脚本；`isForPrince:true` 时给 body 加 `"prince"` class 以适配 PrinceXML 打印样式。
- 外部依赖 / 副作用：无本地工具；CDN 联网点（可 offline 规避）。
- 一手链接：[src/markdown-engine/index.ts#L938（master）](https://github.com/shd101wyy/crossnote/blob/master/src/markdown-engine/index.ts#L938)

### 1.9 `openInBrowser` —— 浏览器预览

- 签名：`openInBrowser({ runAllCodeChunks? }?: {...}): Promise<void>`；返回 `void`。
- 关键逻辑（master 源码 spill L1484 → `L1480`）：渲染 HTML 后写临时文件并 `utility.openFile` 打开系统默认浏览器。
- 外部依赖：系统默认浏览器；无导出产物。

### 1.10 其他导出相关入口

- **`exportOnSave`（private，bundle L681）**：按 front matter 的键 `html` / `prince` / `puppeteer` / `chrome` / `pandoc` / `ebook` 在保存时自动触发对应导出；非 html 类型在 VS Code web 扩展里被禁用。属内部机制，不建议外部直接调用。
- **`buildWiki`（顶层导出，`out\types\src\index.d.ts:18`）**：把整个 notebook 构建成单文件 `index.html` 的浏览器 wiki；CLI 对应 `crossnote build-wiki` 子命令。⚠️本报告未逐行核对其实现细节，仅确认导出入口存在。
- **未发现 `imageExport` 方法**：类型定义 `index.d.ts:110-144` 中无独立 imageExport；图片类产物由 `chromeExport({fileType:'png'|'jpeg'})` 承担。
- **未发现 `saveAsHTML` 方法**：对应能力由 `htmlExport` 承担。

---

## 2. 底层外部工具依赖与检测方法

| 工具 | 被哪些导出使用 | 配置键 | 默认值 | 检测方法 / 报错 |
| --- | --- | --- | --- | --- |
| **Pandoc** | `pandocExport`、`pandocRender`、`markdownParser:'pandoc'` | `pandocPath` | `"pandoc"` | 执行 `pandoc --version`；缺失时报 `"pandoc" is required to be installed. Check "http://pandoc.org/installing.html" website.` |
| **PrinceXML** (`prince`) | `princeExport` | ⚠️**无配置键**，硬编码 `"prince"` | — | 执行 `prince --version`；ENOENT 报 `"princexml" is required to be installed.`；必须放 PATH |
| **Calibre `ebook-convert`** | `eBookExport` | ⚠️无专门 config 键 | — | 执行 `ebook-convert --version`；缺失时由子进程报错 |
| **Chrome / Chromium** | `chromeExport` | `chromePath` | `""`（空，走 chrome-paths 探测） | 探测 `chrome`/`chromeCanary`/`chromium`；都无则 `"Chrome executable path is not set."` |
| **Puppeteer** | `chromeExport` | 无（puppeteer-core 随包） | — | 包内 `puppeteer-core`，无需下载浏览器 |
| **@mermaid-js/mermaid-cli** (`mmdc`) | `markdownExport`（含 Mermaid 图） | 无 | — | `npx -p @mermaid-js/mermaid-cli mmdc ...`；⚠️自动安装+下载浏览器风险 |
| **wavedrom-cli** | `markdownExport`（含 WaveDrom 图） | 无 | — | `npx wavedrom-cli -i <js>`；同上风险 |
| **ImageMagick** | SVG→PNG（图表栅格化辅助） | `imageMagickPath` | `""` | `svgElementToPNGFile`（`tools\magick.d.ts:1`）；失败报 `sharp conversion failure: ... Please make sure you have libvips installed.` |
| **LaTeX** (`pdflatex` 等) | Pandoc→PDF、LaTeX 数学公式 | `latexEngine` | `"pdflatex"` | `spawn(latexEngine,[texFile],{cwd,windowsHide:true})`（bundle L204） |
| **markdown_yo** | `markdownParser:'markdown_yo'` | `markdownYoBinaryPath` | `""`（用 WASM） | 设了路径则 stdin/stdout 调 native binary |

**⚠️安全约束（bundle L321）**：以下 5 个键即使在 `.crossnote/config.js` 里设置也会被**忽略**并告警 `crossnote: ignoring "X" set in .crossnote/config.js — this setting can only be configured via trusted editor settings.`：`enableScriptExecution`、`chromePath`、`pandocPath`、`imageMagickPath`、`markdownYoBinaryPath`。也就是说在纯 Node 调用时，这些路径必须通过 `Notebook.init({config})` 的 `config` 参数传入，而不是靠 notebook 目录里的 config.js。

---

## 3. NotebookConfig 导出/预览相关键完整梳理（含默认值）

类型定义出处：`E:\Project\rust-md\verify\node_modules\crossnote\out\types\src\notebook\types.d.ts:44-111`（v0.9.44）。默认值出处：`out\cjs\index.cjs` L321 的 `Xd()` = `getDefaultNotebookConfig()`（与 master `src/notebook/types.ts` 的 `getDefaultNotebookConfig()` 一致，HTTP 200 抓取交叉印证）。

### 3.1 导出直接相关

| 键 | 类型 | 默认值 | 影响 |
| --- | --- | --- | --- |
| `imageFolderPath` | string | `"/assets"` | markdownExport 图片输出目录、图片链接前缀 |
| `printBackground` | boolean | `false` | chromeExport 的 `page.pdf()` 是否打印背景 |
| `chromePath` | string | `""` | Chrome/Chromium 可执行文件路径（⚠️受安全约束，只能从 config 传） |
| `imageMagickPath` | string | `""` | SVG→PNG（⚠️受安全约束） |
| `pandocPath` | string | `"pandoc"` | Pandoc 路径（⚠️受安全约束） |
| `pandocMarkdownFlavor` | string | `"markdown-raw_tex+tex_math_single_backslash"` | pandoc 输入 markdown 方言 |
| `pandocArguments` | string[] | `[]` | 额外 pandoc 参数 |
| `latexEngine` | string | `"pdflatex"` | LaTeX→PDF 引擎 |
| `puppeteerWaitForTimeout` | number | `0` | chromeExport 页面等待超时（0=不额外等待） |
| `puppeteerArgs` | string[] | `[]` | puppeteer 启动参数（如 `--no-sandbox`） |
| `mathRenderingOnlineService` | string | `"https://latex.codecogs.com/gif.latex"` | markdownExport 数学转图片的在线服务（联网点） |
| `mathjaxScriptSrc` | string | `"https://cdn.jsdelivr.net/npm/mathjax@4/tex-mml-chtml.js"` | MathJax 脚本源（CDN） |
| `exportColorScheme` | string | `"theme"` | 导出配色方案（v0.9.44 `.d.ts:75` 有此键） |
| `jsdelivrCdnHost` | string | `"cdn.jsdelivr.net"` | HTML 导出引入前端库的 CDN 主机 |

### 3.2 预览 / 渲染相关（间接影响导出质量）

| 键 | 默认值 | 键 | 默认值 |
| --- | --- | --- | --- |
| `markdownFileExtensions` | `[".md",".markdown",".mdown",".mkdn",".mkd",".rmd",".qmd",".mdx"]` | `globalCss` | `""` |
| `includeInHeader` | `""` | `mermaidConfig` | `{startOnLoad:false}` |
| `mathjaxConfig` | `{tex:{}, options:{enableEnrichment:false}, loader:{}}` | `katexConfig` | `{macros:{}}` |
| `markdownParser` | `"markdown-it"` | `markdownYoBinaryPath` | `""`（⚠️受安全约束） |
| `parserConfig` | 两个 identity hook 函数 | `enablePreviewZenMode` | `true` |
| `breakOnSingleNewLine` | `true` | `enableTypographer` | `false` |
| `enableWikiLinkSyntax` | `true` | `wikiLinkResolution` | `"relative"` |
| `wikiLinkTargetFileExtension` | `".md"` | `wikiLinkTargetFileNameChangeCase` | `"none"` |
| `enableLinkify` | `true` | `enableEmojiSyntax` | `true` |
| `enableExtendedTableSyntax` | `false` | `enableCriticMarkupSyntax` | `false` |
| `enableTagSyntax` | `true` | `useGitHubStylePipedLink` | `false` |
| `protocolsWhiteList` | `"http://, https://, atom://, file://, mailto:, tel:"` | `mathRenderingOption` | `"KaTeX"` |
| `mathInlineDelimiters` | `[["$","$"]]` | `mathBlockDelimiters` | `[["$$","$$"]]` |
| `codeBlockTheme` | `"auto.css"` | `previewTheme` | `"github-light.css"` |
| `revealjsTheme` | `"white.css"` | `mermaidTheme` | `"default"` |
| `frontMatterRenderingOption` | `"none"` | `enableScriptExecution` | `false` |
| `enableHTML5Embed` | `false` | `HTML5EmbedUseImageSyntax` | `true` |
| `HTML5EmbedUseLinkSyntax` | `false` | `HTML5EmbedIsAllowedHttp` | `false` |
| `HTML5EmbedAudioAttributes` | `'controls preload="metadata"'` | `HTML5EmbedVideoAttributes` | `'controls preload="metadata"'` |
| `plantumlServer` | `""` | `plantumlJarPath` | `""` |
| `krokiServer` | `"https://kroki.io"` | `webSequenceDiagramsServer` | `"https://www.websequencediagrams.com"` |
| `webSequenceDiagramsApiKey` | `""` | `d2Path` | `"d2"` |
| `d2Layout` | `"dagre"` | `d2Theme` | `0` |
| `d2Sketch` | `false` | `isVSCode` | `false` |
| `alwaysShowBacklinksInPreview` | `false` | `maxNoteFileSize` | `5*1024*1024` |
| `useVSCodeThemeForContextMenu` | `false` | `enablePreviewContextMenu` | `true` |

---

## 4. 联网 / 自动安装 / 副作用汇总（重点排雷）

| 风险点 | 触发条件 | 机制（bundle 行号） | 规避 |
| --- | --- | --- | --- |
| **mermaid-cli 自动安装+下载浏览器（挂起）** | `markdownExport` 且文档含 Mermaid 图 | L245 `cross-spawn sync npx -p @mermaid-js/mermaid-cli mmdc ...`（`K2 mermaidToPNG`） | 预先全局安装 `@mermaid-js/mermaid-cli` 并确保其 Chromium 已下载；或导出前把 Mermaid 块替换为静态图 |
| **wavedrom-cli 自动安装** | `markdownExport` 且含 WaveDrom 图 | L246-248 `npx wavedrom-cli -i <js>`（`Q2`） | 预装 wavedrom-cli |
| **数学公式联网取图** | `markdownExport` 且含公式 | `mathRenderingOnlineService` URL 请求 | 改用本地 latexEngine（配置/改写），或接受在线图片 |
| **CDN 脚本依赖** | htmlExport/htmlExportDocument 且 `offline:false` | `https://${jsdelivrCdnHost}/npm/...`（L561） | 设 `offline:true`（内嵌资源） |
| **eBook 远程图片下载** | `eBookExport` 且含 http 图片 | `fetch()`（bundle L657 的 `eBookDownloadImages`） | 提前把图片本地化 |
| **Chrome 下载** | `chromeExport` | **不会**——用 puppeteer-core，只要求本机已有 Chrome | 设置 `chromePath` 指向本机 Chrome |
| **写文件** | 除字符串返回类外所有导出 | `fs.writeFile` / `execFile -o` | 属预期副作用 |

---

## 5. Node 独立调用最小可行代码片段（伪代码，勿直接运行会下载的调用）

```js
// 统一入口：安装 npm 包 crossnote@0.9.44（CJS + ESM，Node>=18.17）
const { Notebook, getDefaultNotebookConfig } = require('crossnote');

const config = {
  ...getDefaultNotebookConfig(),
  // 外部工具路径必须在 config 里传（.crossnote/config.js 里传会被忽略！）
  chromePath: '/path/to/chrome',       // chromeExport
  pandocPath: '/path/to/pandoc',       // pandocExport
  imageMagickPath: '/path/to/magick',  // 可选
  puppeteerArgs: ['--no-sandbox'],     // Linux 容器常需要
};
const notebook = await Notebook.init({ notebookPath: '/abs/path/to/notes', config });
const engine = await notebook.getNoteMarkdownEngine('note.md');

// 1) markdownExport —— ⚠️含 mermaid/公式会联网/自动 npx，务必先备好工具
// const mdPath = await engine.markdownExport({ runAllCodeChunks: false }); // 返回 .md 路径

// 2) htmlExport —— 安全，纯本地（offline 可彻底断 CDN）
const htmlPath = await engine.htmlExport({ offline: true, runAllCodeChunks: false }); // 返回 .html 路径

// 3) htmlExportDocument —— 只拿 HTML 字符串，不落盘
const htmlString = await engine.htmlExportDocument({ offline: false });

// 4) chromeExport —— 需本机 Chrome；puppeteer-core 随包，不下载浏览器
const pdfPath = await engine.chromeExport({ fileType: 'pdf' });            // PDF
const pngPath = await engine.chromeExport({ fileType: 'png' });            // PNG 截图

// 5) princeExport —— 需 prince 在 PATH（无 princePath 键）
const princePdf = await engine.princeExport({ openFileAfterGeneration: false });

// 6) eBookExport —— 需 Calibre ebook-convert 在 PATH；fileType 必填
const epub = await engine.eBookExport({ fileType: 'epub' });
const mobi = await engine.eBookExport({ fileType: 'mobi' });

// 7) pandocExport —— 需 pandoc（PDF 还需 latexEngine）
const docx = await engine.pandocExport({ openFileAfterGeneration: false });

// 8) 完整 HTML 模板字符串（供自定义管道）
const tpl = await engine.generateHTMLTemplateForExport(htmlString, undefined, {
  isForPrint: false, isForPrince: false, offline: true, embedLocalImages: false, embedSVG: true,
});

// 9) 浏览器预览（void）
await engine.openInBrowser({ runAllCodeChunks: false });

// 10) 整库 wiki（顶层导出，⚠️未逐行核对实现细节）
// const { buildWiki } = require('crossnote'); await buildWiki({ notebookPath: '...' });
```

**说明**：所有 `Promise<string>` 导出（除 `htmlExportDocument`/`generateHTMLTemplateForExport` 返回内容字符串）返回的是**产物文件路径**，调用方需自行 `fs.readFile` 取内容。`Notebook.init` 在 Windows 盘符路径下 v0.9.44 已修复（release note）。若使用 ESM：`import { Notebook } from 'crossnote'`（`out/esm/index.mjs`）。

---

## 6. 推荐优先实现顺序（面向「单一 Markdown + 转 PDF」场景）

1. **`markdownExport`（优先，但需先隔离其副作用）**：这是唯一产出纯 `.md` 的 API，契合"给 Typora 打开"的目标；但必须先把 Mermaid/WaveDrom 的 `npx` 自动安装路径堵死（预装工具或在导出前替换图表块），并接受数学公式转在线图片——若要求原文保真，建议复用其 `markdownConvert` 时关闭数学转图片或改用本地渲染（⚠️具体开关需进一步核对 `markdown-convert.ts`）。
2. **`htmlExport({offline:true})`**：零外部工具、最稳；可作为中间格式，再用自有管道转 PDF。
3. **`pandocExport`**：若环境可装 Pandoc + LaTeX，是质量最高的文档式 PDF 路径（DOCX/RTF 也一并覆盖）。
4. **`chromeExport`**：若本机有 Chrome，是网页/演示风格 PDF 的好选择；无自动下载风险。
5. **`princeExport` / `eBookExport`**：依赖PrinceXML/Calibre 两个重型外部程序且无 config 路径键，优先级最低；仅当明确需要高精度印刷 PDF 或电子书时再上。

---

## 7. 一手来源链接清单

- [GitHub 仓库 shd101wyy/crossnote](https://github.com/shd101wyy/crossnote)
- [src/markdown-engine/index.ts（master）](https://github.com/shd101wyy/crossnote/blob/master/src/markdown-engine/index.ts) —— 导出方法实现
- [src/notebook/types.ts（master）](https://github.com/shd101wyy/crossnote/blob/master/src/notebook/types.ts) —— NotebookConfig 与默认值
- [README（master）](https://raw.githubusercontent.com/shd101wyy/crossnote/master/README.md) —— 库用法示例
- 本机安装文件（v0.9.44，权威）：
  - `E:\Project\rust-md\verify\node_modules\crossnote\out\types\src\markdown-engine\index.d.ts`（110-144 行：导出签名；25-33 行：HTMLTemplateOption）
  - `E:\Project\rust-md\verify\node_modules\crossnote\out\types\src\notebook\types.d.ts`（44-111 行：NotebookConfig）
  - `E:\Project\rust-md\verify\node_modules\crossnote\out\types\src\converters\{markdown,pandoc,prince,ebook-convert}.d.ts`（转换器签名）
  - `E:\Project\rust-md\verify\node_modules\crossnote\out\cjs\index.cjs`（minified bundle；L321 默认配置与安全约束、L245 mermaid、L286/292 pandoc、L298 prince、L561 HTML 模板、L657 各导出、L677-681 markdown/pandoc 导出）

> 边界声明：本报告基于已安装包与 master 源码静态分析，**未实际执行任何会下载工具/浏览器的导出**；"副作用/联网/自动安装"结论均来自源码中可见的 `npx`/`fetch`/`execFile`/`spawn` 调用与错误文案，未做运行时验证的部分已用「⚠️」标注。
