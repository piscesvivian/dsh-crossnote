# crossnote 深调研：能否作为「Markdown 多文件合并工具」的复用/二开基础

> 调研任务：只读一手来源（GitHub API、README、package.json、源码、CHANGELOG、测试），未写任何实现代码，未修改项目内除本报告外的任何文件。观测日期 **2026-11-26**。前序调研见 `01-include-tools.md`、`02-rust-typora.md`、`03-rust-reuse.md`。
>
> 用户需求回顾：一份总纲 + `import` 多个碎片 md；支持 `file.md#标题` 按标题取章节、章节标题降级、章节改名、图片/相对链接路径重写；最终导出**单一纯 `.md`** 给 Typora 打开并导出 PDF。

---

## 结论先行

1. **crossnote 底层确实有"展开 import → 写回纯 `.md`"的能力**：`src/converters/markdown-convert.ts` 的 `markdownConvert()` 以 `forMarkdownExport:true` 调用核心 `transformMarkdown()` 展开所有 import，再重写路径并 `fs.writeFile` 输出纯 markdown。**这推翻了此前在 MPE 插件层"没有导出纯 .md"的结论**——底层组件是有的。
2. **六项需求里它直接覆盖四项**：整文件 import、按标题取章节（`#heading-slug`）、按块取（`#^block-id`）、图片/相对链接path重写；**明确缺两项：章节标题降级、章节改名**——源码中未见任何相关实现。
3. **它能作为 Node 库独立运行，不强绑 VS Code/Electron**：npm 包名是 `crossnote`（**不是** `@shd101wyy/crossnote`），`require('crossnote')` / `import 'crossnote'` 均可，Node ≥18，自带纯 Node CLI（`crossnote serve` / `build-wiki`）；但核心 import 逻辑与 `Notebook`/markdown-it/cheerio 深度耦合（transformer 单文件 ~61KB），依赖树很重（含 puppeteer-core、sharp、react 等）。
4. **"纯 .md"有副作用需警惕**：其 markdown 导出会把数学公式转成在线图片 URL、把 Mermaid/PlantUML 等图表栅格化成图片文件、强制 `[TOC]` 展开——这些对 Typora 原文保真是**减分项**。
5. **推荐顺序**：`pulldown-cmark` 从零写（~500 行，原文保真最佳） ≥ crossnote 复用其 heading 片段解析（作为"按标题取章节"参考） > obsidian-export 二开；**不建议 fork crossnote 整体**，除非看重它成熟的 import 语法与路径处理且能接受重依赖与数学/图表副作用。

---

## 项目基本盘

| 项目 | 事实（一手来源） |
| --- | --- |
| 定位 | "Powerful markdown tool"，是 Markdown Preview Enhanced（VS Code 插件 `vscode-markdown-preview-enhanced`）的底层渲染/导出引擎，前身叫 `mume`。[GitHub 仓库](https://github.com/shd101wyy/crossnote) · [README](https://raw.githubusercontent.com/shd101wyy/crossnote/master/README.md) |
| 语言 / 架构 | **TypeScript**，默认分支 `develop`。模块划分：`src/notebook/`（配置、markdown-it、笔记管理）、`src/markdown-engine/`（transformer/parseMD）、`src/custom-markdown-it-features/`、`src/render-enhancers/`、`src/renderers/`、`src/webview/`（React 预览，跑在 VS Code webview/浏览器）、`src/converters/`（PDF/ebook/pandoc/markdown 导出）。[仓库树](https://github.com/shd101wyy/crossnote/tree/develop/src) |
| License | **NCSA（University of Illinois/NCSA Open Source License）**，GitHub API `license` 字段为 `NOASSERTION/Other`，README 与 package.json 均标 NCSA。属宽松许可，可修改/再分发（保留声明即可）。[package.json](https://raw.githubusercontent.com/shd101wyy/crossnote/develop/package.json) |
| 活跃度 | **非常活跃**：GitHub API `pushed_at = 2026-11-26T15:07:08Z`，`updated_at = 2026-11-25`；最近提交 `9c9c327`(2026-11-26, PDF 演示导出修复 #596)、`b223129`(2026-11-26, 导入文件 slides 修复 #586)、`9df3540`(2026-11-25, 保留导入文件 slides #580)。[提交记录](https://github.com/shd101wyy/crossnote/commits/develop) |
| star / fork / issue | 573 stars、162 forks、86 open issues（[GitHub API](https://api.github.com/repos/shd101wyy/crossnote)）。 |
| 版本 / release | 最新 release tag `0.9.44`（2026-11-21，修复 Windows 盘符 `Notebook.init` 问题）；[releases](https://github.com/shd101wyy/crossnote/releases)。注意 `develop` 分支 package.json 里 `version` 仍是 `0.9.31`（与 tag 不同步，属开发分支常态）。 |
| npm 包名 | **`crossnote`（无 scope）**——不是 `@shd101wyy/crossnote`。README 明确给出 `const { Notebook } = require('crossnote')` 与 `import { Notebook } from 'crossnote'`。[npm](https://www.npmjs.com/package/crossnote) |
| 作为库调用 | ✅ 可以。`package.json` 的 `exports["."]` 同时提供 `types`（`out/types/src/index.d.ts`）、`import`（`out/esm/index.mjs`）、`require`（`out/cjs/index.cjs`）；`engines.node >= 18`。`src/index.ts` 导出 `Notebook`、`transformMarkdown`、`markdownConvert` 所在模块等。[package.json](https://raw.githubusercontent.com/shd101wyy/crossnote/develop/package.json) · [src/index.ts](https://raw.githubusercontent.com/shd101wyy/crossnote/develop/src/index.ts) |
| 依赖强度 | **重**：`markdown-it 14.x`、`cheerio`、`puppeteer-core`、`sharp`、`react`、`less`、`papaparse`、`@shd101wyy/markdown-yo` 等。库构建把依赖标为 external，webview 构建打包进浏览器。AGENTS.md 说明 Node 锁 18（因 VS Code extension host）。[AGENTS.md](https://raw.githubusercontent.com/shd101wyy/crossnote/develop/AGENTS.md) |

**典型库用法（README 原文）**：`Notebook.init({notebookPath, config})` → `notebook.getNoteMarkdownEngine('README.md')` → 引擎提供 `htmlExport` / `chromeExport({fileType:'pdf'|'png'|'jpeg'})` / `princeExport` / `eBookExport` / `pandocExport` / `markdownExport({runAllCodeChunks:true})`。API 文档见 [shd101wyy.github.io/crossnote](https://shd101wyy.github.io/crossnote/)。

**CLI**：`src/cli/index.ts` 提供且仅提供两个子命令——`crossnote serve`（本地 HTTP 渲染预览服务）与 `crossnote build-wiki`（输出单文件 `index.html` 的浏览器 wiki）。**没有"import→纯 .md"的现成 CLI 子命令**；纯 .md 导出要走库 API（`engine.markdownExport` / `markdownConvert`）。[CLI 源码](https://raw.githubusercontent.com/shd101wyy/crossnote/develop/src/cli/index.ts)

---

## import 能力分析（带源码路径）

核心文件：**[`src/markdown-engine/transformer.ts`](https://raw.githubusercontent.com/shd101wyy/crossnote/develop/src/markdown-engine/transformer.ts)**（约 61KB），导出 `async function transformMarkdown(inputString, options): Promise<TransformMarkdownOutput>`。它是逐行迭代（非递归，避免栈溢出）的"预处理器"，把各种 import 展开成 markdown/HTML 片段，输出 `{outputString, slideConfigs, tocBracketEnabled, headings, frontMatterString, ...}`。

### 支持的 import 形式

| 形式 | 正则 / 位置（源码） | 说明 |
| --- | --- | --- |
| `@import "file"` | `line.match(/^(\s*)@import(\s+)"([^"]+)";?/)`，transformer.ts "Start: File import" | 经典 MPE 语法，可选 `{...}` 块属性配置。 |
| `![[note]]`（wikilink 嵌入） | `line.match(/^(\s*)!\[\[(.+?)\]\](?:{([^}]*)})?\s*$/)` | Obsidian 风格，经 `notebook.processWikilink()` 解析路径与 fragment。 |
| `![alt](file)`（mdlink 导入） | `lineImageMatch` + 排除 `data:` | 单行的图片语法也可指向 md 文件触发导入。 |
| HTML 注释形式 | `subject === '@import'`（`<!-- @import ... -->`） | [测试](https://raw.githubusercontent.com/shd101wyy/crossnote/develop/test/transclusion-paths.test.ts)确认 `<!-- @import "path#frag" -->` 可用。 |
| 按行切片 | `config['line_begin']` / `config['line_end']` | `fileContent.split(/\n/).slice(...)`，对应 MPE 的 line 范围能力。 |
| 按标题取章节 | fragment `#heading-slug`（见下） | ✅ 支持，见下节。 |
| 按块取 | fragment `#^block-id` | ✅ 只取含 `^id` 的连续非空段落并去掉标记。 |
| 多类型文件 | 同分支 | `.md`（递归 transformMarkdown）、图片、`.html`、`.csv`（转表格）、`.css/.js`、`.less`、`.pdf`（按页）、`.dot/.mermaid/.puml` 等各自处理；未知扩展名降级为代码块。 |
| 远程文件 | `loadFile()` | `https?://` 下载；`github.com/.../blob/` 自动转 `raw.githubusercontent.com`。 |

### 按标题取章节（关键能力，源码级确认）

- fragment 提取：`const hashIdx = filePath.lastIndexOf('#'); fileHash = filePath.substring(hashIdx);`（提取路径中的 `#...`，且特意在 `decodeURIComponent` **之前**做，避免目录名含 `#` 被误判）。
- 目标定位：`headings[].id` 匹配 `targetId`（`fileHash.slice(1)`）；若大小写/标点不匹配，用 `new HeadingIdGenerator().generateId(targetId)` 重新 slugify 后重试。
- 边界：找到下一个 `heading.level <= startHeading.level` 的标题作为结束，用 `outputString.split('\n').slice(startLineNo-1, endLineNo-1).join('\n')` 切出章节；到文末则切到末尾。找不到时输出 `<!-- crossnote: heading "xxx" not found -->`。
- 纯辅助函数：[`src/notebook/note-fragments.ts`](https://raw.githubusercontent.com/shd101wyy/crossnote/develop/src/notebook/note-fragments.ts) 提供 `extractBlockIds()` / `extractHeadings()` / `findFragmentTargetLine(text, fragment)`，均为纯函数（无 I/O、无 vscode 类型），注释明确写"从 vscode-markdown-preview-enhanced 搬过来，供 web build/CLI/未来集成共用"——**这对二开是利好，可单独复用解析规则**。
- 实测证据：[`test/transclusion-paths.test.ts`](https://raw.githubusercontent.com/shd101wyy/crossnote/develop/test/transclusion-paths.test.ts) 用 6 种语法 × 8 种路径 × {heading, block} 共 96 个用例验证按 `#colours` / `#^specimen` 取章节/块，断言"包含期望文本、不含章节外文本"。

### 图片/相对链接重写

- transformer 内 import 图片时按 `useRelativeFilePath` 计算 `path.relative(...)` 并 `escapeUrlPath`，`forMarkdownExport` 时不加 cache-buster。
- `absoluteImportPath()` 处理 `file://`、Windows 盘符与 UNC 路径；导入 markdown 时 `useRelativeFilePath:false`、每个文件用**新的** `HeadingIdGenerator`（避免跨文件 slug 状态串扰——这正是 fragment 切片能正确工作的基础）。

### 缺失：标题降级 / 章节改名

对 `transformer.ts` 与 `markdown-convert.ts` 全文检索 `demot` / `heading_level` / `headingLevel` / `rename` 等关键词，**只命中"按 level 找章节边界"的逻辑，没有任何修改导入章节标题级别或文本的代码**。import 选项（`line_begin/line_end/code_block/as/alt/title/cmd/page_no/...`）里也没有降级或改名参数。结论：**这两项需求 crossnote 不提供，二开必须自行补上**。

---

## 导出能力分析（重点：能否导出纯 `.md`）

核心文件：**[`src/converters/markdown-convert.ts`](https://raw.githubusercontent.com/shd101wyy/crossnote/develop/src/converters/markdown-convert.ts)**（文件头注释："Convert Crossnote markdown to Github Flavored Markdown"）。

### 答案：能——`markdownConvert()` 就是"展开 import → 写回纯 .md"

管线（源码逐步）：

1. 校验 `config['path']`（输出路径）与 `config['image_dir']`（图表图片目录）必须存在。
2. 可选执行 `notebook.config.parserConfig.onWillParseMarkdown(text)`。
3. 调 `transformMarkdown(text, {..., forPreview:false, markdownParser:'pandoc', forMarkdownExport:true, ...})` —— **`forMarkdownExport:true` 是关键开关**，import 在这里被展开（含按标题/按块切片）。
4. `text = data.outputString`；若 `[TOC]` 存在，用 `toc(headings, ...)` 生成 markdown 目录替换 `[CROSSNOTETOC]`。
5. `processPaths()`：把 `![](...)` / `[]()` 和 `<img>/<a>` 的 `src/href` 重写成项目根路径或相对路径（跳过代码块），即**相对链接重写**。
6. `processMath()`：**把行内/块级数学公式转成 `mathRenderingOnlineService` 的在线图片 URL**（除非 `mathRenderingOption === 'None'`）。
7. `processGraphs()`：把 Mermaid / PlantUML / graphviz 等**栅格化成图片写入 `imageDirectoryPath`**，替换原文 fence。
8. `outputString = data.frontMatterString + outputString`，`fs.writeFile(outputFilePath, outputString, {encoding:'utf-8'})` —— **写出的是纯 markdown 文件**。

引擎层入口：`engine.markdownExport(config)`（README 示例给出 `markdownExport({runAllCodeChunks:true})`），最终落到 `markdownConvert`。

### 判定

- ✅ **能导出单一纯 `.md`，且 import 已展开**——直接满足用户"给 Typora 打开"的核心诉求。此前在 MPE 插件层"只能出 HTML/PDF/eBook 等渲染格式"的判断，对 crossnote 底层**不成立**；底层是有 markdown export 的，只是 MPE 插件 UI 没把它作为一等导出项暴露。
- ⚠️ **副作用（对 Typora 原文保真是减分项）**：
  - 数学公式被转成**远程图片**（依赖网络 + 在线服务），Typora 里不再是可编辑的 `$...$`；
  - 图表被**栅格化为图片文件**，不再是源码 fence；
  - `[TOC]` 被强制展开；
  - 需要 `Notebook.init()` 与完整 config（含 `image_dir`），不是轻量`字符串进字符串出`。
- ⚠️ 递归 import 未见显式"环检测/访问集合"——`filesCache` 是按文件路径缓存内容的（可缓解重复读取），但源码未见循环引用保护逻辑；这一点与 obsidian-export 明确的递归检测不同，若碎片互相引用需自行验证。

---

## 二开可行性 + 与 Rust / obsidian-export 方案对比

### 是否强绑 VS Code/Electron？

**否。** 证据：
- npm 包同时导出 CJS/ESM，README 给出纯 Node `require('crossnote')` 用法；
- CLI（`src/cli/index.ts`）是 `#!/usr/bin/env node` 的纯 Node 程序（`bin/crossnote.js`），`serve` / `build-wiki` 都自带实现，不依赖 VS Code API；
- `note-fragments.ts` 注释明确说这些纯函数供 "web build, CLI, future integrations" 共用。
- 唯一的历史约束是 **Node 锁 18**（VS Code extension host 运行时），但这对独立 Node CLI 不是障碍（Node 18+ 都满足）。

因此"写一个 `import→纯.md` 的 Node CLI"在环境上完全可行：拿到 `Notebook` 实例后直接调 `engine.markdownExport({path, image_dir})` 即可，无需 VS Code/Electron。

### 工作量估算

| 路线 | 工作量 | 前置条件 |
| --- | --- | --- |
| **A. 直接用 crossnote 现成能力**（`markdownExport`） | 接近 0 代码：一个 ~50 行 Node 包装脚本，`Notebook.init` + `markdownExport` | 接受数学→在线图片、图表→图片的副作用；且需补标题降级/改名（若用户坚持）——后者要改 transformer 或后处理输出，约 100–200 行 |
| **B. fork crossnote，改 transformer 加降级/改名** | 高：transformer 单文件 ~61KB、与 Notebook/markdown-it/cheerio 深度耦合、依赖树重；改动 + 回归测试约 300–600 行 | 需理解其逐行迭代状态机；升级跟进成本高（项目活跃、频繁改动） |
| **C. 只借 crossnote 的片段解析思路**（`note-fragments.ts` 的 `extractHeadings` / `findFragmentTargetLine`） | 低：这些函数可单独复用或移植 ~100 行 | 仍需自建 import 展开与写出管线 |
| **D. 基于 `pulldown-cmark` 从零写 CLI**（前序推荐） | ~500 行，1–2 周 | 完全控制原文保真（数学/Mermaid/`[TOC]` 靠原文切片原样保留） |
| **E. obsidian-export 二开**（Rust） | 中：已有 `![[note#heading]]` + 链接重写 + 递归检测，缺标题降级/改名，加这两项约 150–300 行 | 需接受它的语法偏向 Obsidian、且此前判断"缺标题降级和章节改名" |

### 三方案利弊对照

| 维度 | crossnote（A/B/C） | obsidian-export 二开（E） | pulldown-cmark 从零（D） |
| --- | --- | --- | --- |
| 纯 `.md` 导出 | ✅ 现成（但有数学/图表副作用） | ⚠️ 需自行加写出（其输出偏 AI 提示词/清理后的 md） | 🔧 自行实现，完全可控 |
| 按标题取章节 | ✅ 成熟（`#slug` + 块引用，96 用例） | ✅ `![[note#heading]]` | 🔧 用 heading 字节偏移自行切片 |
| 标题降级 / 章节改名 | ❌ 需自行补 | ❌ 需自行补 | 🔧 自行实现（切片内加 `#` / 改首行） |
| 图片/链接重写 | ✅ 成熟（含 file://、UNC、URL 解码） | ✅ 已有 | 🔧 自行实现（pathdiff） |
| 递归/环检测 | ⚠️ 仅 `filesCache`，未见显式保护 | ✅ 明确支持 | 🔧 自行实现 |
| 原文保真（Typora 数学/Mermaid） | ❌ 数学转图片、图表栅格化 | ⚠️ 视实现 | ✅ 原文切片，最佳 |
| 依赖/体积 | ❌ 很重（puppeteer/sharp/react…） | ✅ Rust 单二进制 | ✅ 轻（两个 crate） |
| 语言栈 | TS/Node（与项目 Rust 主线不一致） | Rust | Rust |
| 许可证 | NCSA（宽松，保留声明） | MIT（需核实） | MIT + Apache-2.0 |

---

## 最终推荐

1. **明确结论**：crossnote **不能"原样"满足全部需求**——缺"标题降级 / 章节改名"，且纯 `.md` 导出会改写数学与图表；但它是本轮调研中**唯一确认具备"展开 import → 写纯 `.md`"底层能力的候选**，比 MPE 插件层前进了一大步。
2. **能否作为二开基础**：**可以，但不推荐整体 fork**。最合理的用法是"**借鉴**"——复用 `note-fragments.ts` 的标题/块片段解析规则与 transformer 的 fragment 切片思路（`heading.level <= start.level` 定边界、每文件独立 slug 生成器），而不是引入整套重依赖引擎。
3. **推荐顺序**：
   - 🥇 **`pulldown-cmark` 从零写 ~500 行 CLI**（沿用前序 `03-rust-reuse.md` 结论）：原文保真最好、依赖最轻、六项需求全部可控，仍是首选。
   - 🥈 **crossnote 作为"参考/局部借鉴"**：若团队更看重成熟的 import 语法体系与路径处理、且能接受 Node 重依赖与数学/图表副作用，可直接用 `engine.markdownExport` 快速跑通 4/6 需求，再补降级/改名；但长期维护成本高于自写。
   - 🥉 **obsidian-export 二开**：语法契合 Obsidian 用户，已有按标题取章节与递归检测，补两项即可；但同样缺降级/改名，且输出目标与"Typora 纯 md"略有偏差。
   - ❌ **不推荐 fork crossnote 整体做二开**：耦合重、依赖多、Node 锁 18、上游活跃改动频繁，性价比低于从零写。

**一句话决策**：**crossnote 证明了"底层完全能展开 import 回纯 .md"，但它的重依赖与数学/图表改写使其更适合当"算法参考"而非"运行底座"；要原文保真的 Typora 流水线，仍以 `pulldown-cmark` 自写 ~500 行 CLI 为首选。**

---

## 来源链接

- [crossnote GitHub 仓库](https://github.com/shd101wyy/crossnote) · [GitHub API 元数据](https://api.github.com/repos/shd101wyy/crossnote) · [提交记录](https://github.com/shd101wyy/crossnote/commits/develop) · [Releases](https://github.com/shd101wyy/crossnote/releases)
- [README](https://raw.githubusercontent.com/shd101wyy/crossnote/master/README.md) · [API 文档](https://shd101wyy.github.io/crossnote/) · [package.json](https://raw.githubusercontent.com/shd101wyy/crossnote/develop/package.json) · [AGENTS.md](https://raw.githubusercontent.com/shd101wyy/crossnote/develop/AGENTS.md) · [src/index.ts](https://raw.githubusercontent.com/shd101wyy/crossnote/develop/src/index.ts)
- [src/markdown-engine/transformer.ts（import 核心）](https://raw.githubusercontent.com/shd101wyy/crossnote/develop/src/markdown-engine/transformer.ts)
- [src/converters/markdown-convert.ts（纯 .md 导出核心）](https://raw.githubusercontent.com/shd101wyy/crossnote/develop/src/converters/markdown-convert.ts)
- [src/notebook/note-fragments.ts（按标题/块切片纯函数）](https://raw.githubusercontent.com/shd101wyy/crossnote/develop/src/notebook/note-fragments.ts)
- [src/cli/index.ts（CLI 子命令）](https://raw.githubusercontent.com/shd101wyy/crossnote/develop/src/cli/index.ts)
- [test/transclusion-paths.test.ts（96 例按标题/块取章节测试）](https://raw.githubusercontent.com/shd101wyy/crossnote/develop/test/transclusion-paths.test.ts)
- [CHANGELOG.md](https://raw.githubusercontent.com/shd101wyy/crossnote/develop/CHANGELOG.md)
- 前序调研：`01-include-tools.md`、`02-rust-typora.md`、`03-rust-reuse.md`（本仓库 `research/` 目录）
