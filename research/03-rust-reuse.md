# 现成 Rust 工具能否直接用 / 二次开发？—— 复用可行性深挖

> 调研任务（只读调查，未写任何实现代码，未修改项目文件，仅生成本报告）。所有事实以一手来源为准：crates.io API、docs.rs 源码页、GitHub README / 源码树 / 提交记录、Cargo.toml `license` 字段、mdBook 官方文档。版本、日期、下载量均为 **2026-11-25** 观测值。前序调研见 `E:\Project\rust-md\research\02-rust-typora.md`。

---

## 结论先行

1. **直接用现成工具：不可行。** 六个目标能力（整文件 include / 按标题取章节 / 标题降级 / 相对图片+链接重写 / 章节改名 / 输出单 `.md`）没有任何一个工具全部覆盖；最接近的 `mdbook-mdinclude 0.2.0` 也只覆盖 4 项，且二进制是纯 mdBook preprocessor（stdin/stdout JSON），没有独立文件→文件模式。
2. **基于现成工具二次开发：技术上可行，但只有 `mdbook-mdinclude` 值得考虑**——MIT、有 lib target、核心逻辑自包含在一个 `src/lib.rs`、已实现标题降级和相对链接重写；代价是核心函数全部私有、绑 `mdbook` 依赖、用正则而非 Markdown 解析器，且缺失的三项恰好是用户的核心诉求。
3. **`mdbook-mdinclude` 值得"借鉴算法"，不值得"fork 整个库"**：把 `adjust_heading_levels`（`src/lib.rs:498-548`）和 `update_relative_links`（`src/lib.rs:368-444`）的设计思路在新 CLI 里重写约 100–150 行，比剥离 mdBook 耦合、公开私有 API、继承 regex 解析盲区更划算。
4. **基于库（`pulldown-cmark 0.13.6`）从零写 CLI 仍然是最优或至少并列最优路线**：它给出 `(Event, Range<usize>)` 字节偏移，能在保留 Typora 数学公式 / Mermaid / `[TOC]` 原文的前提下做外科手术式拼接；MIT、极活跃、2.2 亿+下载；预计约 500 行 CLI、1–2 周。
5. 其余候选（`md-include`、`markdown-includes`、`md-inc`、`liaison`、mdBook 内置 `{{#include}}`）抽象不匹配、已停更或许可证有风险，均不适合作基础；详见下表。

**需求对照符号**：✅ 已实现 ｜ ⚠️ 部分/需手工 ｜ ❌ 不具备 ｜ 🔧 需自行实现（库可支撑）

---

## 各工具深挖表

### 总览：基本信息与许可证

| 工具 | 版本 / 发布 | 源码位置 | 代码规模 | License（二次开发友好度） | 活跃度 |
| --- | --- | --- | --- | --- | --- |
| `mdbook-mdinclude` | 0.2.0 / 2026-03-26 | [GitHub](https://github.com/shawntabrizi/mdbook-mdinclude) · [docs.rs 源码](https://docs.rs/mdbook-mdinclude/0.2.0/src/mdbook_mdinclude/lib.rs.html) | `src/lib.rs` 1211 行 / 42.6 KB，`src/main.rs` ~35 行，`tests/integration.rs` 12 KB；crates.io 统计 Rust 978 代码行 + 48 注释行（2 文件） | **MIT** ✅ 可自由修改/再分发 | 仓库 3 stars / 0 forks / 未归档，最后 push 2026-03-26；当天一轮 audit 修复提交（含 Claude Opus 4.6 共同署名），此前 v0.1.0 停留在 2024-08。属于"近期一次集中打磨"，社区极小 |
| `md-include` | 0.1.0 / 2023-10-09 | [GitHub](https://github.com/Cobular/md-include) · [crates.io](https://crates.io/crates/md-include) | Rust 117 代码行 / 2 注释行 | **MIT** ✅ | 0 stars，最后 push 2023-10-09；近 30 天下载 2。基本停止维护 |
| `markdown-includes` | 0.1.1 / 2023-04-06 | [GitHub](https://github.com/akesson/markdown-includes) · [crates.io](https://crates.io/crates/markdown-includes) | Rust 3718 代码行 / 111 注释行（15 文件） | **MIT** ✅ | 1 star，最后 push 2023-04-06；近 30 天下载 124。停更 |
| mdBook 内置 `{{#include}}` | mdbook 0.5.4 / 2026-07-06 | [mdBook 文档](https://rust-lang.github.io/mdBook/format/mdbook.html#including-files) · [crates.io mdbook](https://crates.io/crates/mdbook) | mdbook 0.5.4 crate 仅 1124 Rust 代码行（0.4.52 为 9322 行）；`has_lib=false` | **MPL-2.0** ⚠️ 文件级 copyleft：复制/修改其源文件须保留 MPL 声明并以 MPL 发布被改动文件；仅调用其 CLI 不受影响 | 极活跃，0.5.x 约每月一版 |
| `pulldown-cmark` + `pulldown-cmark-to-cmark` | 0.13.6 / 2026-10-30；23.0.3 / 2026-11-17 | [crates.io](https://crates.io/crates/pulldown-cmark) · [crates.io](https://crates.io/crates/pulldown-cmark-to-cmark) | 12097 + 2426 Rust 代码行（作为依赖使用，不需要维护其源码） | **MIT** + **Apache-2.0** ✅✅ | 极活跃；前者 2.2 亿+总下载 / 近 30 天 7884 万，后者 1.03 亿+ / 近 30 天 4083 万 |
| `liaison`（补充发现） | 0.2.0 / 2026-01-17 | [GitHub](https://github.com/dnorman/liaison) · [crates.io](https://crates.io/crates/liaison) | Rust 1878 代码行（8 文件） | **MIT OR Apache-2.0** ✅ | 新项目，近 30 天下载 16；仍在演进（README 自述 Phase 1） |
| `md-inc`（补充发现） | 0.3.1 / 2020-06-10 | [GitHub](https://github.com/martypapa/md-inc) · [crates.io](https://crates.io/crates/md-inc) | Rust 1358 代码行 | **non-standard** ⚠️ crates.io `license` 字段明确写 `non-standard`，二次开发前必须逐条核对 LICENSE 文本 | 停更 6 年，近 30 天下载 5 |

### 六项需求覆盖矩阵

| 工具 | 整文件 include | 按标题取章节 | 标题降级 | 相对图片+链接重写 | 章节改名 | 输出单 `.md` |
| --- | --- | --- | --- | --- | --- | --- |
| `mdbook-mdinclude 0.2.0` | ✅ `{{#mdinclude path}}` | ❌ 仅行范围 `:2:10` 与 `ANCHOR:` 标记 | ✅ 自动嵌套到 include 点最近标题之下 | ✅ regex 重写（支持图片/尖括号/标题/reference 定义，跳过代码块）；**不支持** autolink、裸 URL、HTML `<a>/<img>`、嵌套方括号 | ❌ | ❌ 只跑在 mdBook 管线内 |
| `md-include 0.1.0` | ✅ `embed_file(path=...)` | ❌ | ❌ | ❌ | ❌ | ⚠️ 输出 stdout 或调 pandoc 出 PDF，非主文件合并场景 |
| `markdown-includes 0.1.1` | ✅ TOML fence | ❌ | ❌ | ❌ | ❌ | ⚠️ 库 API 写文件，但仅面向 crate README 生成 |
| mdBook 内置 include | ✅ `{{#include}}` | ⚠️ 需在被包含文件里手工插 `ANCHOR:` 注释 | ❌ | ❌ | ❌ | ❌ 需 mdBook 构建整站 |
| `pulldown-cmark` 组合 | 🔧 | 🔧 `into_offset_iter()` 提供标题偏移 | 🔧 | 🔧 | 🔧 | 🔧 |
| `liaison 0.2.0` | ✅ 按显式 `id` 块 | ⚠️ 按 id 标记抽取，非按标题名 | ❌ | ❌ | ❌ | ⚠️ 原地写回源文件（in-place），非生成单一 master `.md` |
| `md-inc 0.3.1` | ✅ 命令块 | ⚠️ 仅 `match:` 正则捕获 | ❌ | ❌ | ❌ | ⚠️ `out_dir` 可写生成文件，但面向项目内多文件插图 |

---

## 逐一分析

### 1. `mdbook-mdinclude` —— 重点：最适合"借鉴/二开"但绑死 mdBook

**源码与架构。** 仓库 [shawntabrizi/mdbook-mdinclude](https://github.com/shawntabrizi/mdbook-mdinclude)（HEAD sha `15b1a30f91b3d5f05e0a1f100453802f7a9babae`）：`src/lib.rs` 42,610 字节（docs.rs 显示 1211 行）、`src/main.rs` 1048 字节、`tests/integration.rs` 12,045 字节、`Cargo.toml` 582 字节、`LICENSE` 为 MIT。整个实现（含约 485 行单元测试）都在 `lib.rs` 一个文件里；`main.rs` 只是 mdBook preprocessor 协议壳：

```rust
// main.rs 逻辑（来自源码）
if supports_renderer { MdInclude::supports_renderer(...) }
else { CmdPreprocessor::parse_input(io::stdin()); MdInclude::new(&ctx); pre.run(&ctx, book);
       serde_json::to_writer(io::stdout(), &processed_book) }
```

即 **没有独立的文件→文件 CLI 模式**；要变成独立工具必须重写 `main.rs`。

**依赖与许可证。** `Cargo.toml`：`anyhow 1`、`clap 4`、`env_logger 0.11`、`log 0.4`、`mdbook 0.4.37`、`regex 1`、`serde_json 1`，dev 依赖 `tempfile 3`；`license = "MIT"`（[crates.io](https://crates.io/crates/mdbook-mdinclude)）。MIT 允许修改、fork、闭源再分发，法律层面无障碍。

**活跃度。** crates.io 0.2.0 发布于 2026-03-26，v0.1.0 为 2024-08-11；仓库最后 push 2026-03-26。当天提交包括 "Fix four bugs found during audit"（P1 `normalize_path` 保留前导 `..`、P1 用 `find_code_ranges` 跳过代码内链接、P2 标题重建使用 trimmed line、P2 拒绝所有 URI scheme）、"Fix greedy escaped includes, add angle-bracket link support"、"Fix mixed-fence tracking" 等，均带 `Co-Authored-By: Claude Opus 4.6`。结论：**近期被集中审查打磨过，代码质量比 0.1.0 明显提升，但属于一次性 burst，作者单人、社区极小（3 stars / 0 forks）**，长期维护不可依赖。

**核心逻辑定位（docs.rs 0.2.0 源码行号，[链接](https://docs.rs/mdbook-mdinclude/0.2.0/src/mdbook_mdinclude/lib.rs.html)）：**

| 功能 | 函数 / 位置 | 说明 |
| --- | --- | --- |
| include 指令发现 | `LINK_RE` `src/lib.rs:33-45`，`find_links` `src/lib.rs:722-724` | 正则匹配 `{{#mdinclude ...}}` 与转义形式 |
| 主流水线 | `replace_all` `src/lib.rs:153-211` | 读文件 → 去 frontmatter → 改链接 → 找父标题 → 降级 → 递归（最大深度 10，防环） |
| 整文件/范围读取 | `Link::render_with_path` `src/lib.rs:686-705` | `fs::read_to_string` + `mdbook::utils::take_lines` / `take_anchored_lines` |
| 去 frontmatter | `strip_frontmatter` `src/lib.rs:228-264` | 剥离开头 `---` 块（附带能力） |
| **相对链接重写** | `update_relative_links` `src/lib.rs:368-444` + `MARKDOWN_LINK_RE` `src/lib.rs:52-61` + `REF_LINK_DEF_RE` `src/lib.rs:66-73` + `is_relative_link` `src/lib.rs:81-102` + `normalize_path` `src/lib.rs:447-464` | 两遍处理：行内图片/链接（支持 `<path>`、`"title"`）、reference 定义；跳过 fenced code 与 inline code（`find_code_ranges` `src/lib.rs:315-361`）；URI scheme / 绝对路径 / `#fragment` 保持不动 |
| **标题降级** | `heading_level` `src/lib.rs:468-479`、`find_parent_heading_level` `src/lib.rs:483-496`、`adjust_heading_levels` `src/lib.rs:498-548` | 只识别 ATX（`# ` ~ `###### `）；计算被插入内容的最小 heading level，`offset = parent_level + 1 - min_level`，逐行重建并把级别 clamp 到 `[1,6]`；跳过代码块 |

**能否脱离 mdBook 当库用？** 部分能，但不是"改个 Cargo feature"那么简单：

- 好消息：`has_lib = true`，核心字符串处理函数都在 `lib.rs`，算法本身与 mdBook 无关。
- 障碍一：**所有核心函数均为私有（`fn` 而非 `pub fn`），没有公开 API**。要当库用必须先公开接口、设计入参（当前签名直接吃 `&Path` 与 `PreprocessorContext`）。
- 障碍二：`Preprocessor::run`（`src/lib.rs:130-146`）用 `ctx.root.join(&ctx.config.book.src)` 计算基准目录，并且 `render_with_path` 直接调用 `mdbook::utils::take_lines` / `take_anchored_lines`（`src/lib.rs:693-694`）。要脱离 mdBook，需去掉 `mdbook` 依赖并本地实现这两个工具函数（估计 ~40–60 行）。
- 障碍三：二进制入口只实现了 mdBook 协议，需重写为普通 CLI（`clap` 已在依赖里，约 ~80–120 行）。
- **关键判断：它根本没用 `pulldown-cmark`。** 全靠 regex + 手写逐行围栏扫描（`find_code_ranges`），README 明确列出不支持 autolink `<url>`、裸 URL、HTML `<a>/<img>` 和嵌套方括号链接文本。复用它 = 继承一个"够用但脆弱"的 Markdown 解析层；对 Typora 的 GFM+扩展（表格、脚注、数学、Mermaid、内联 HTML）没有结构性理解。

**如果基于它开发，需要改什么 / 难度：**

| 改动项 | 难度 | 说明 |
| --- | --- | --- |
| 去 `mdbook` 依赖、本地实现 `take_lines` / `take_anchored_lines` | 低（~50 行） | 纯字符串切分与锚点匹配 |
| 公开核心函数、设计 lib API | 中 | 当前全部私有，签名耦合 `Path`/上下文 |
| 重写 `main.rs` 为独立 CLI + 单文件输出 | 低（~100 行） | `clap` 现成 |
| 新增"按标题取章节" | **中高（~150–250 行）** | 现有只有行范围/ANCHOR，需新增标题解析（用 pulldown-cmark 偏移更稳）、处理章节边界与未闭合代码块 |
| 新增"章节改名" | 低（~40–60 行） | 在抽取后改写首个 heading 文本 |
| 链接重写升级为解析器驱动（可选但建议） | 中高 | 否则 autolink/HTML/嵌套括号等盲区仍在 |
| **合计** | **约 400–600 行改动，1–2 周** | 注意：改完已有相当比例是"重写"而非"小改" |

### 2. `md-include` —— 太小、太死，不适合

[README](https://raw.githubusercontent.com/Cobular/md-include/main/README.md) 语法是 `{{ embed_file(path="<FILE_NAME>") }}`；CLI 为 `md-include [OPTIONS] <ROOT_DIR> [CUSTOM_PANDOC_FLAGS]...`，`-o/--output-pdf` 调 pandoc；传 glob 时把多个文件按"路径深度→字母序"排序后用 `\n\n * * * \n\n` 拼接。crates.io 显示 `has_lib=false`、Rust 仅 117 代码行、2023-10-09 后再无提交、0 stars、近 30 天下载 2。**它只做纯文本插入**，标题降级、链接重写、按标题取章节、章节改名、单 `.md` 输出全无。作为基础约等于从零写，且没有可复用 API。

### 3. `markdown-includes` —— 3.7k 行但抽象错位

[README](https://raw.githubusercontent.com/akesson/markdown-includes/main/README.md)：模板文件 `README.tpl.md` 里用带名字的 TOML fence（```` ```toml toc ```` / ```` ```toml rustdoc source="lib.rs" ````）；通过 Rust 测试调用 `markdown_includes::update("src/README.tpl.md", "README.md")` 生成文件，CI 环境下若 README 需要更新则失败。rustdoc 部分源自改造的 cargo-rdme。`has_lib=true`、无 bin、MIT、Rust 3718 代码行，但最后更新 2023-04-06、1 star。**专注入 crate README 自动化**：生成 TOC、rustdoc、文件插入；无标题降级、无相对链接重写、无按标题取章节、无 CLI。3.7k 行里大部分是 rustdoc 抓取与 TOML 配置，对本项目几乎不可复用。

### 4. mdBook 内置 `{{#include}}` —— 能力边界清晰

[mdBook 官方文档](https://rust-lang.github.io/mdBook/format/mdbook.html#including-files)：`{{#include file.rs}}` 整文件；行范围 `:2` / `::10` / `:2:` / `:2:10`；锚点 `ANCHOR:\s*[\w_-]+` 与 `ANCHOR_END:` 成对（需手工写进被包含文件注释）；另有 `rustdoc_include`、`{{#playground}}`、`{{#title}}`。**不按标题名抽取、不自动降级、不重写被包含 Markdown 的相对链接**。mdBook crate 是 MPL-2.0、0.5.4 起 `has_lib=false`；若要复制其 preprocessor 源码做二次开发，需注意 MPL 文件级 copyleft 义务。作为"参考设计"可读，作为"基础库"不合适。

### 5. `pulldown-cmark` + `pulldown-cmark-to-cmark` —— 库级基础（推荐）

- [pulldown-cmark 0.13.6](https://crates.io/crates/pulldown-cmark)：MIT，`has_lib=true`，Rust 12097 代码行，2026-10-30 发布，rust-version 1.71.1。Pull parser，`Iterator<Item = Event>`；`into_offset_iter()` 返回 `(Event, Range<usize>)` 字节偏移（[OffsetIter 文档](https://docs.rs/pulldown-cmark/latest/pulldown_cmark/struct.OffsetIter.html)），可精确定位 `Event::Start(Tag::Heading { level, .. })`、链接/图片 Text 的源区间。
- [pulldown-cmark-to-cmark 23.0.3](https://crates.io/crates/pulldown-cmark-to-cmark)：Apache-2.0，2426 代码行，2026-11-17 发布；把 Event 序列还原成 Markdown。

**关键取舍**：前序调研已确认——对 Typora 场景应**用偏移做"原文切片 + 定点改写"，而不是把整篇文档 parse→render 往返**。这是因为它能原样保留 Typora 数学公式、Mermaid 代码块、`[TOC]`、内联 HTML 和 front matter；`pulldown-cmark-to-cmark` 更适合作为"确实需要生成新 Markdown 片段时"的辅助，而不是主渲染路径。六项需求都不是库自带，但库提供了实现它们的可靠构件（标题偏移→章节边界、链接 Event→相对路径改写、文本 Event→改名）。

### 6. 补充发现的候选（搜索 "transclude" / "markdown include" / GitHub）

- **`liaison 0.2.0`**（[GitHub](https://github.com/dnorman/liaison)，[crates.io](https://crates.io/crates/liaison)）：MIT OR Apache-2.0，1878 行，bin-only。内容transclusion 工具：源文件里用 `// liaison id=demo-code ... // liaison end` 标记块，文档里用 `<!-- liaison transclude="src/lib.rs#demo-code" --> ... <!-- liaison end -->` 引用，运行 `liaison README.md` **原地写回**。支持空白归一化、递归、环检测、原子写、远程 URL、HTML 转义、路径相对 git root 或文件所在目录、`--check` / `--reset`。**是按显式 id 标记抽取代码块，不是按标题名抽章节；没有标题降级、链接重写、章节改名、单 master `.md` 输出**。许可证友好、2026 年仍在更新，但抽象与需求不符。
- **`md-inc 0.3.1`**（[GitHub](https://github.com/martypapa/md-inc)，[crates.io](https://crates.io/crates/md-inc)）：`<!--{ "file.rs" | code: rust }--> ... <!--{ end }-->` 命令块 + `.md-inc.toml` 配置（`base_dir` / `files` / `out_dir` / 自定义标记），管道命令 `code` / `lines` / `line` / `line-numbers` / `wrap` / `wrap-lines` / `match:`（正则捕获）。**许可证字段是 `non-standard`**，且 2020 年后停更；有些底层能力（按行/正则取片段）与需求有交集，但无标题语义、无链接重写、无降级，且 license 风险需逐条核对。
- **更边缘的命中**：`franken_markdown::transclude`（docs.rs 中有 `{{#include relative/path.md}}` 递归拼接模块，未深挖）、[samchristywork/transclude](https://github.com/samchristywork/transclude)（递归文档包含，未深挖）、`include_md`（proc-macro 编译期 include，与运行时 CLI 无关）、`git2prompt`（仓库打成一个文本给 AI，非 Markdown 语义合并）。crates.io 关键词 `markdown include` 主要返回 C 代码宏 include 的 `include` crate，与需求无关。**结论：没有遗漏的"现成完全满足"工具。**

---

## 二次开发可行性对比表

| 路线 | 起点 | License | 复用哪些现成东西 | 必须新增/改造 | 估计工作量 | 主要风险 | 推荐度 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **A. 直接用现成工具** | 任一上述工具 | — | — | — | 0 | 六项需求无全覆盖；最接近者缺 3 项且无独立 CLI | ❌ 不可行 |
| **B. fork `mdbook-mdinclude`** | 1211 行 `lib.rs`，MIT | ✅ | 整文件 include、标题降级、相对链接重写（已验证算法）、frontmatter 剥离、防环递归 | 去 mdbook 依赖 + 公开 API + 重写 CLI + 按标题取章节 + 章节改名 + 单文件输出 | ~400–600 行改动，1–2 周 | 核心全私有；regex 解析盲区（autolink/HTML/嵌套括号）；单人 3-star 项目；"改完已近重写" | ⚠️ 有条件可行：只在其"降级+链接重写"恰好够用时最快 |
| **C. 借 `pulldown-cmark` 从零写 CLI** | 空项目 + 两个活跃库 | ✅ MIT + Apache-2.0 | CommonMark/GFM 事件流 + 精确字节偏移；需要时事件→Markdown | 全部六项业务逻辑（约 500 行 CLI） | ~500 行，1–2 周（与前序调研一致） | 需自行处理 Typora 方言细节（数学/Mermaid/`[TOC]` 靠原文切片规避） | ✅ **推荐** |
| **D. 以 `md-include` / `markdown-includes` / `md-inc` / `liaison` 为基础** | 117–3718 行 | MIT / MIT / ⚠️ non-standard / MIT+Apache | 少量"插入文件"逻辑 | 几乎全部业务能力 | 与从零写相当或更多 | 抽象错位、停更、license 风险 | ❌ 不推荐 |
| **E. 改 mdBook 内置 preprocessor** | mdBook 源码（MPL-2.0） | ⚠️ 文件级 copyleft | 行范围/ANCHOR include | 标题抽取、降级、链接重写、章节改名、脱离整站构建 | 高 | MPL 义务 + 体系耦合 | ❌ 不推荐 |

### 复用现有工具 vs 库级从零写：利弊表

| 维度 | 复用 `mdbook-mdinclude`（路线 B） | 库级从零写（路线 C） |
| --- | --- | --- |
| 首个可用版本速度 | **略快**：标题降级与链接重写已实现，可先跑通 4/6 需求 | 慢一点：六项都需实现，但每项逻辑本身不复杂 |
| 代码总量 |  fork 后仍需改 400–600 行，且背着 1211 行历史代码 | 约 500 行全新、按需设计 |
| 公开 API | **无**：核心函数全私有，需先设计 API | 自己定义，天然干净 |
| Markdown 解析正确性 | regex + 手写围栏扫描；已知不支持 autolink / 裸 URL / HTML 标签 / 嵌套括号 | CommonMark/GFM 事件流，边界情况由成熟解析器覆盖 |
| Typora 特有语法（数学 / Mermaid / `[TOC]` / front matter） | 无结构认知；靠"不误伤"运气 | 用 `(Event, Range)` 只改目标片段，其余字节原样保留 |
| License / 依赖负担 | MIT 友好，但引入 `mdbook 0.4.37`（传递依赖较重） | MIT + Apache-2.0，依赖轻 |
| 长期维护 | 上游单人项目，3 stars / 0 forks；fork 后需自己维护分叉 | 依赖活跃上游（月级发布），自有代码完全可控 |
| 与未来需求扩展的适配性 | 需持续与上游分叉同步或完全脱离 | 结构清晰，按需求加规则即可 |

---

## 最终推荐（明确回答用户的问题）

**Q1：已有别的 Rust 工具可以做到吗？——不能。** 深挖 7 个候选后，六项需求无一被全覆盖；`mdbook-mdinclude` 覆盖 4 项但缺"按标题取章节 / 章节改名 / 单 `.md` 输出"三项核心，且其可执行文件只是 mdBook 的 stdin/stdout preprocessor，不能独立对任意目录做文件→文件合并。

**Q2：能在某个工具基础上二次开发吗？——能，但推荐"借鉴算法"而非"fork 代码库"。**

- 唯一值得作为基础的是 **`mdbook-mdinclude 0.2.0`（MIT）**：它是唯一同时实现了"标题降级"和"相对链接重写"的工具，算法位置明确（`src/lib.rs:498-548`、`src/lib.rs:368-444`），可作为新 CLI 的直接参考。
- 但**不建议把它当作 crate 依赖或整体 fork**：①核心函数全部私有，无稳定公开 API；②唯一的 mdBook 耦合虽小但要剥离 `mdbook` 依赖与两个 utils 函数；③它的解析层是 regex 而非 Markdown parser，有明确盲区；④改完 400–600 行后，实际已接近重写。
- **特别判断**：若工期极紧且能接受 regex 的链接盲区，fork 它是最快拿到"能跑的 4/6 功能"的路径；但从产品质量与长期维护看，**不如用 `pulldown-cmark` 重新实现这两个算法（约 100–150 行），把设计思路抄过来、技术债留下**。

**Q3：基于库从零写 CLI 是否仍更优？——是（推荐路线 C）。** 技术栈沿用前序调研结论：`clap 4` + `pulldown-cmark 0.13.x` 的 `into_offset_iter()` + `pathdiff` + 原文切片拼接；用 heading 偏移确定章节边界、在切片内追加 `#` 做标题降级、只改链接/图片 destination、改首个 heading 实现章节改名、输出到单个 `.md`，从而原样保留 Typora 数学 / Mermaid / `[TOC]` / front matter。预计约 500 行、1–2 周，且无 MPL/non-standard 许可证顾虑、无上游分叉负担。

**一句话决策**：**不要找"能直接用的工具"了——没有；也不要真 fork `mdbook-mdinclude`——抄它的两个算法，用 `pulldown-cmark` 写自己的 ~500 行 CLI。**

---

## 来源链接

### crates.io / docs.rs（版本、许可证、代码规模、源码）
- [mdbook-mdinclude @ crates.io](https://crates.io/crates/mdbook-mdinclude) · [0.2.0 源码 @ docs.rs](https://docs.rs/mdbook-mdinclude/0.2.0/src/mdbook_mdinclude/lib.rs.html)
- [md-include @ crates.io](https://crates.io/crates/md-include)
- [markdown-includes @ crates.io](https://crates.io/crates/markdown-includes)
- [mdbook @ crates.io](https://crates.io/crates/mdbook)
- [pulldown-cmark @ crates.io](https://crates.io/crates/pulldown-cmark) · [OffsetIter @ docs.rs](https://docs.rs/pulldown-cmark/latest/pulldown_cmark/struct.OffsetIter.html)
- [pulldown-cmark-to-cmark @ crates.io](https://crates.io/crates/pulldown-cmark-to-cmark)
- [liaison @ crates.io](https://crates.io/crates/liaison) · [md-inc @ crates.io](https://crates.io/crates/md-inc)

### GitHub（README、源码树、提交、活跃度）
- [shawntabrizi/mdbook-mdinclude](https://github.com/shawntabrizi/mdbook-mdinclude) · [HEAD 提交树](https://github.com/shawntabrizi/mdbook-mdinclude/tree/15b1a30f91b3d5f05e0a1f100453802f7a9babae) · [README](https://raw.githubusercontent.com/shawntabrizi/mdbook-mdinclude/main/README.md)
- [Cobular/md-include README](https://raw.githubusercontent.com/Cobular/md-include/main/README.md)
- [akesson/markdown-includes README](https://raw.githubusercontent.com/akesson/markdown-includes/main/README.md)
- [dnorman/liaison README](https://raw.githubusercontent.com/dnorman/liaison/main/README.md)
- [martypapa/md-inc README](https://raw.githubusercontent.com/martypapa/md-inc/master/README.md)

### 官方文档
- [mdBook: Including files / portions of a file](https://rust-lang.github.io/mdBook/format/mdbook.html#including-files)
- [前序调研：02-rust-typora.md](E:/Project/rust-md/research/02-rust-typora.md)
