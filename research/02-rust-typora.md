# Typora constraints & Rust ecosystem for a Markdown include/merge CLI

> Research task (read-only investigation). All claims cite primary sources (official Typora docs / Typora GitHub issues / crates.io / docs.rs / mdBook docs / upstream GitHub READMEs). Versions and dates are as observed on **2026-11-25**. Direct `web_fetch` of `support.typora.io` and `docs.typora.io` was blocked in this environment; official page content was recovered via the Exa/Bing search index and the `research` tool's fetched-document evidence, which is flagged in the Evidence notes where relevant.

---

## PART A — Typora constraints

### A1. Native include / import / transclusion, Markdown flavor, supported syntax

**No native include/transclusion.** Typora has no built-in syntax to embed or import another Markdown file. A feature request "Support for file transclusion / Content Block links" (typora/typora-issues#441) remains **open** — i.e., the capability is absent from the product, not merely undocumented ([typora/typora-issues#441](https://github.com/typora/typora-issues/issues/441)). Typora's docs describe the editor as working on *plain Markdown files on disk* with "no database or import step" ([Files and Folders](https://docs.typora.io/guide/files-and-folders)). Therefore a user-defined import directive must be resolved by an external tool before Typora ever opens the file.

**Markdown flavor.** Official docs: "Typora reads and writes standard Markdown (CommonMark and GitHub Flavored Markdown) plus a few widely used extensions. Some syntax is optional and switched in Settings ▸ Markdown ▸ Syntax and Math" ([Writing Markdown](https://docs.typora.io/guide/writing-markdown)). The older official support site likewise says "Typora use GitHub Flavored Markdown" ([Quick Start](http://support.typora.io/Quick-Start/)). A maintainer in the official issue tracker confirms Typora "is trying to follow Github Flavored Markdown ... and CommonMark" ([typora/typora-issues#369](https://github.com/typora/typora-issues/issues/369)). Note that Typora's dialect is GFM-*like*, not a strict CommonMark implementation — the same issue discusses deliberate deviations.

**Supported syntax (relevant to a merged document):**

| Feature | Supported? | Source |
| --- | --- | --- |
| YAML front matter | Yes — a YAML block at the very top between two `---` lines; added in 0.8.5; export-related front-matter keys documented | [Front Matter](https://docs.typora.io/guide/front-matter), [stable release channel changelog](https://typora.io/releases/stable) |
| Footnotes | Yes — two ways (reference-style footnotes); added in 0.8.5 era | [Markdown Reference](https://support.typora.io/Markdown-Reference/), [release changelog](https://typoraio.cn/releases/stable.html), [Markdown Reference PDF](https://support.typora.io/media/export/Markdown-Reference.pdf) |
| `[TOC]` | Yes — `[toc]` on its own line; "extracts all headings from the document, and contents are updated automatically"; added in 0.9.2; TOC level can be controlled | [TOC](http://support.typora.io/TOC/), [TOC levels](http://support.typora.io/TOC-levels/), [Writing Markdown](https://docs.typora.io/guide/writing-markdown), [release changelog](https://typoraio.cn/releases/stable.html) |
| Task lists | Yes — `- [ ]` / `- [x]` items | [Task List](https://support.typora.io/Task-List/), [Writing Markdown](https://docs.typora.io/guide/writing-markdown) |
| Tables | Yes — GFM-style tables with alignment via `:`; added in 0.9.9.8.8 | [Writing Markdown](https://docs.typora.io/guide/writing-markdown), [release changelog](https://typoraio.cn/releases/stable.html) |
| Math (LaTeX) | Yes — MathJax-based inline and block math; added in 0.8.7; some syntax toggled in Settings ▸ Markdown ▸ Syntax and Math | [Writing Markdown](https://docs.typora.io/guide/writing-markdown), [release changelog](https://typoraio.cn/releases/stable.html) |
| Diagrams | Yes — Mermaid etc.; must be enabled in Preferences ▸ Markdown; added in 0.9.9.7 | [Writing Markdown](https://docs.typora.io/guide/writing-markdown), [release changelog](https://typoraio.cn/releases/stable.html) |
| Strikethrough, fenced code with language identifier, inline HTML, emoji, sub/superscript, highlight, underline | Yes (some toggled in settings) | [Writing Markdown](https://docs.typora.io/guide/writing-markdown), [release changelog](https://typoraio.cn/releases/stable.html) |
| Definition lists | **Not** supported | [Typora markdown feature write-up](https://pdftomdconverter.app/blog/typora-markdown) (secondary; consistent with official Markdown Reference absence) |

**Implication for the merge tool:** the generated `.md` should stay inside this GFM+extensions subset. Emitting `[TOC]` at a chosen location is enough to get an auto-generated, always-current TOC in Typora — no need to synthesize a static TOC. Front matter must remain at the very top of the output file, before any imported content.

---

### A2. Relative image / markdown link resolution, "root folder", subdirectories

- **Relative paths:** Typora resolves links/images relative to the **current document's location** on disk ([Links](https://support.typora.io/Links/): "You can use a relative or absolute path as a link address pointing toward" a local file; [docs Links](https://docs.typora.io/guide/links): "A link can point to a file by relative or absolute path, or as a `file://` URL"). This is exactly why imported files' relative image/link paths must be rewritten when their text is spliced into a master file in a different directory — a `![](images/x.png)` in `chapter/img.md` would otherwise point at `images/x.png` next to the **merged** file and break.
- **`typora-root-url` (front matter) = the "root folder" mechanism.** Docs: "A document's `typora-root-url` in front matter sets the base for absolute paths such as `/assets/a.png`" ([docs Links](https://docs.typora.io/guide/links)). The changelog confirms `typora-root-url` support, including "typora-root-url now supports absolute image path on Windows" ([stable release channel](https://typoraio.cn/releases/stable.html)). This is a per-document setting (not a global app config), so it **can** be written into the generated master file to pin asset resolution — useful for portability if the tool also copies assets into a known folder.
- **`typora-copy-images-to` (front matter)** controls where pasted/inserted images are copied; default target is `./assets` unless settings or this key override it ([Files and Folders](https://docs.typora.io/guide/files-and-folders), [Images](https://docs.typora.io/guide/images)); "Settings ▸ Image ▸ Image Action" decides insert behavior ("No special action (default) refers to the image where it is") ([Images](https://docs.typora.io/guide/images)).
- **Images in subdirectories:** no special rewriting by Typora — a relative path is interpreted from the document, so subdirectory images work as long as the relative path is correct relative to the *merged* file ([Links](https://support.typora.io/Links/), [docs Links](https://docs.typora.io/guide/links)). External web links should keep their protocol ("we suggest you DO NOT omit URL protocols like `http://` ... it may be interpreted as a relative link"), including after export ([Links](https://support.typora.io/Links/)).
- **Portability caveat:** `typora-root-url` with absolute paths is machine-specific; relative paths plus co-located/copied assets are the portable option ([docs Links](https://docs.typora.io/guide/links), [typora/typora-issues#6022](https://github.com/typora/typora-issues/issues/6022)).

**Tool consequence:** rewrite relative link/image targets to be relative from the output directory (e.g. with `pathdiff`), or normalize to `typora-root-url`-relative absolute paths if assets are gathered into one tree. Preserve `http(s)://`, `mailto:`, `file://` and anchors unchanged.

---

### A3. File extensions, source mode, and "openability"

- Typora edits **plain `.md` files**; "There is no database or import step" ([Files and Folders](https://docs.typora.io/guide/files-and-folders)). The default extension is `.md` and Typora has a "default file extension" setting ([stable release channel](https://typoraio.cn/releases/stable.html)).
- A feature request to support non-MD extensions is **open** ([typora/typora-issues#6403](https://github.com/typora/typora-issues/issues/6403)), and there are open reports of Typora renaming files back to `.md` on save ([typora/typora-issues#6324](https://github.com/typora/typora-issues/issues/6324)) and to `.markdown` ([typora/typora-issues#6298](https://github.com/typora/typora-issues/issues/6298)). Conclusion: **treat `.md` as the only reliable output extension**; keep the user's `.mdx`-like master as a source file for the tool only.
- "Allow editing in source mode" / source view: Typora has **Source Code Mode** (`Mod+/`) that shows the raw Markdown ([Getting Started](https://docs.typora.io/guide/getting-started)); writing modes are documented in [Writing Modes](https://docs.typora.io/guide/writing-modes). This is a display/edit mode of an existing file, not a way to register new file extensions.
- **Verdict on `.mdx`:** Typora is not an MDX renderer/compiler — MDX (JSX-in-Markdown) is a different language. Do not feed `.mdx` to Typora; use a custom directive syntax in a source file (any extension) and let the Rust tool emit plain `.md`.

---

### A4. PDF export

- Typora exports from the **currently open document**, rendering it with the active theme/CSS into PDF (the release notes repeatedly mention "export to PDF" fixes such as "Fix PDF export contains page break div", "Header and footers now respect page margins when export to PDF", "Fix Outline missing for PDF export on macOS 27", and "Use local font, instead of remote font when exporting PDF") ([stable release channel](https://typoraio.cn/releases/stable.html), [Export](https://support.typora.io/Export/)).
- Typora can produce a **PDF with bookmarks/outline** (the vendor site advertises "导出带书签的 PDF" — PDF with bookmarks) ([typora-dt.com](https://typora-dt.com/)). The *Outline* panel is built from document headings ([Outline](https://support.typora.io/Outline/)); thus heading hierarchy in the merged file directly determines PDF bookmarks. Heading demotion of imported sections is what keeps those bookmarks nested correctly.
- Export profiles are configurable per format via Settings ▸ Export and Publish ([Export and Import](https://docs.typora.io/guide/export)); front matter can carry export-related keys that "apply to every export" ([Front Matter](https://docs.typora.io/guide/front-matter)).
- **Constraint relevant to merged docs:** PDF export renders the merged `.md` as-is — images must resolve relative to the merged file (or via `typora-root-url`), `[TOC]` will be rendered into the PDF, and relative *links to local files* inside the PDF are known to be problematic ([typora/typora-issues#5777](https://github.com/typora/typora-issues/issues/5777): "Export to PDF: relative links to local files are completely broken"). Consider converting local `.md` links in the output to anchors within the merged document (`#slug`) so they remain meaningful in both Typora and the PDF.

---

## PART B — Rust ecosystem

### B1. Markdown parsers/renderers

| Crate / version (as of 2026-11-25) | API model | Extensions / GFM | Source spans & raw source | Speed / maintenance | License | Source |
| --- | --- | --- | --- | --- | --- | --- |
| **pulldown-cmark 0.13.6** | Pull-parsing `Iterator<Item = Event>`; low memory | CommonMark + tables, task lists, strikethrough, footnotes, admonitions, LaTeX math, heading IDs/classes | `into_offset_iter()` yields `(Event, Range<usize>)` byte ranges into the source; `Event::Text` is a `Cow` that usually slices the source | "high-performance, low-memory"; 2,770 stars; latest release 2026-10-30; 220M+ downloads | MIT | [guide](https://pulldown-cmark.github.io/pulldown-cmark/), [OffsetIter docs](https://docs.rs/pulldown-cmark/latest/pulldown_cmark/struct.OffsetIter.html), [crates.io](https://crates.io/crates/pulldown-cmark), [GitHub](https://github.com/pulldown-cmark/pulldown-cmark) |
| **comrak 1.2.0** | Full AST (`Node`/`Ast`, arena via `Arena`); also renders HTML and back to Markdown | "100% CommonMark-compatible GFM parser and formatter": tables, footnotes, task lists, strikethrough, autolinks, etc. via `Options.extension` ([Extension](https://docs.rs/comrak/latest/comrak/options/struct.Extension.html)) | `Render.sourcepos` emits source-position attributes "reliable for core block items excluding lists and list items, all inlines, and most extensions"; AST nodes carry sourcepos; has a Markdown formatter that can rewrite sections while preserving much of the source | Latest 2026-11-23, 10.9M+ downloads | MIT (crate: "License: Other" on GitHub due to dual licensing — verify at [crates.io](https://crates.io/crates/comrak)) | [crates.io](https://crates.io/crates/comrak), [Options](https://docs.rs/comrak/latest/comrak/struct.Options.html), [Render.sourcepos](https://docs.rs/comrak/latest/comrak/options/struct.Render.html), [Ast](https://docs.rs/comrak/latest/comrak/nodes/struct.Ast.html) |
| **markdown 1.0.0 (wooorm/markdown-rs)** | State machine (`#![no_std]` + alloc), mdast-compatible AST with position info | CommonMark + extensions; GFM-ish | mdast nodes carry `Position` (line/column/offset); AST-first | 1,596 stars; the *crates.io* `markdown-rs` name is an **old 0.1.0 from 2023-07-02**; the current crate is named `markdown` 1.0.0 | MIT | [GitHub](https://github.com/wooorm/markdown-rs/), [crates.io `markdown`](https://crates.io/crates/markdown), [license](https://github.com/wooorm/markdown-rs/blob/main/license) |
| **markdown-it-rs 0.7.0** | Token stream port of markdown-it.js | markdown-it rules/plugins | Token map to source lines (inherited from markdown-it design) | Latest 2026-08-05; only ~137 downloads — effectively dormant fork | MIT (check upstream README) | [docs.rs](https://docs.rs/crate/markdown-it-rs/latest), [crates.io](https://crates.io/crates/markdown-it-rs) |
| **mdbook / mdbook-markdown 0.5.4** | mdBook pipeline; `mdbook-markdown` re-exports the `pulldown-cmark` mdBook uses; preprocessor protocol | GFM subset as configured by mdBook | Event API with source offsets via `into_offset_iter()` | Latest 2026-07-06; 13.1M downloads | MPL-2.0 | [crates.io mdbook](https://crates.io/crates/mdbook), [mdbook-markdown](https://crates.io/crates/mdbook-markdown), [mdBook intro](https://rust-lang.github.io/mdBook/) |

**Which best supports source spans / selective heading-section extraction / link rewriting?**

- For a **~500-line-file-friendly, surgical tool** that should preserve the author's raw Markdown (math, diagrams, tables, HTML) *byte-for-byte except for the edits*, **`pulldown-cmark` is the best fit**: it is a pull parser with `(Event, Range)` byte offsets ([guide](https://pulldown-cmark.github.io/pulldown-cmark/)), and with `pulldown-cmark-to-cmark` you can map events back to Markdown text ([pulldown-cmark-to-cmark](https://crates.io/crates/pulldown-cmark-to-cmark)). You detect heading events (`Event::Start(Tag::Heading { level, .. })`) + their offsets, compute section boundaries, then splice raw source slices, demote only heading markers, and rewrite only link/image destinations inside the slice. No full AST round-trip = no lossy reformatting of equations/diagrams.
- **`comrak`** is the choice if you prefer AST-level manipulation and its Markdown formatter; source positions exist but are noted as unreliable for lists and some extensions ([Render.sourcepos](https://docs.rs/comrak/latest/comrak/options/struct.Render.html)), so byte-faithful section extraction is harder.
- `markdown-rs`/`markdown` gives an mdast AST with positions but a smaller ecosystem and ambiguous crate naming; `markdown-it-rs` is nearly unused.

**Verdict:** use `pulldown-cmark` for event positions; optionally `comrak` only if AST rewriting proves necessary. Avoid full re-render from AST for Typora-specific syntax (`[TOC]`, math, Mermaid) unless you verify round-trip fidelity with `pulldown-cmark-to-cmark`.

---

### B2. mdBook preprocessor API

- A preprocessor runs after the book is loaded and before rendering; a documented use case is "Creating custom helpers like `{{#include /path/to/file.md}}`" ([mdBook Preprocessors](http://rust-lang.github.io/mdBook/for_developers/preprocessors.html)).
- Protocol: mdBook first calls the preprocessor with `supports <renderer>`; if supported, it passes the entire book as **JSON on stdin**, and expects the modified book as JSON on stdout ([mdBook Preprocessors](http://rust-lang.github.io/mdBook/for_developers/preprocessors.html), [Eli Bendersky's case study](https://eli.thegreenplace.net/2025/plugins-case-study-mdbook-preprocessors)). Using `mdbook-preprocessor` 0.5.4 ([crates.io](https://crates.io/crates/mdbook-preprocessor)) you can `parse_input()` and mutate `chapter.content` (just a `String`) with `Book::for_each_mut()`; the docs explicitly recommend parsing to events via `mdbook-markdown`'s `pulldown-cmark` and converting back via `pulldown-cmark-to-cmark` ([mdBook Preprocessors](http://rust-lang.github.io/mdBook/for_developers/preprocessors.html)). Existing `mdbook-mdinclude` proves heading demotion + relative-link rewriting are feasible in a preprocessor ([README](https://docs.rs/crate/mdbook-mdinclude/latest/source/README.md)).
- **Limits for a standalone `.md`:** a preprocessor is *not* a standalone CLI. It only mutates chapters of a `Book` inside the mdBook pipeline; output goes to mdBook's renderer (HTML by default). There is no supported "emit one merged `.md`" mode; you'd have to run mdBook, then post-process its in-memory/book files, or write your own renderer. mdBook also requires a `SUMMARY.md` book structure, which is orthogonal to a user's arbitrary source-file tree ([mdBook docs](https://rust-lang.github.io/mdBook/)). **Conclusion:** borrowing mdBook's preprocessor *library* is fine; using mdBook itself as the tool is unnecessary overhead.

---

### B3. Existing Rust crates / CLI tools for markdown merging / includes

| Crate / tool (version; last updated on crates.io) | What it does | Limitations for this task | Source |
| --- | --- | --- | --- |
| **mdbook-mdinclude 0.2.0** (2026-03-26) | mdBook preprocessor for "better markdown file inclusion"; automatically shifts included headings to nest under the including heading ("`## MacOS` becomes `### MacOS`"), rewrites relative links/images from subdirectories, supports `{{#include}}`-style directives | mdBook-only; outputs via mdBook renderer, not a standalone `.md` | [crates.io](https://crates.io/crates/mdbook-mdinclude), [README](https://docs.rs/crate/mdbook-mdinclude/latest/source/README.md), [GitHub](https://github.com/shawntabrizi/mdbook-mdinclude) |
| **md-include 0.1.0** (2023-10-09) | "A tool to include any file in markdown files" | Tiny/old; no documented heading demotion or link rewriting | [crates.io](https://crates.io/crates/md-include) |
| **markdown-includes 0.1.1** (2023-04-06) | "Include other documents, table of content, or rust-doc in Markdown using a simple template system" | Old; template-based, no documented heading demotion | [crates.io](https://crates.io/crates/markdown-includes) |
| **markdown 1.0.0** (crate name; wooorm/markdown-rs) | Parser only — AST + extensions | Not an include tool | [crates.io](https://crates.io/crates/markdown) |
| **markdown-merge 0.2.3** (2026-11-25) | "Markdown merge helpers for Structured Merge" — structured-3-way merge library | Merge/diff semantics, not import directives | [crates.io](https://crates.io/crates/markdown-merge) |
| **markdown-it-rs 0.7.0** (2026-08-05) | markdown-it.js port | Parser only; ~137 downloads | [docs.rs](https://docs.rs/crate/markdown-it-rs/latest) |
| **mdbook 0.5.4** (2026-07-06) / mdbook-markdown 0.5.4 | Book builder / Markdown processing; built-in `{{#include}}` via links preprocessor | Book-oriented, not a single-file emitter | [crates.io mdbook](https://crates.io/crates/mdbook), [mdbook-markdown](https://crates.io/crates/mdbook-markdown), [mdBook docs](http://rust-lang.github.io/mdBook/for_developers/preprocessors.html) |
| **mdbook-include-rs 0.1.0** | mdBook preprocessor that includes external **Rust source** files | Not general Markdown inclusion | [crates.io](https://crates.io/crates/mdbook-include-rs) |
| **mdbook-webinclude 0.1.0** | mdBook preprocessor that includes content from URLs | Network-based, mdBook-only | [crates.io](https://crates.io/crates/mdbook-webinclude) |
| **mdbook-embedify 0.3.2** (2026-02-04) | mdBook preprocessor to embed apps (YouTube, CodePen, giscus…) | Not a Markdown include/merge tool | [crates.io](https://crates.io/crates/mdbook-embedify) |
| **mdbook-combiner 0.1.17** | Combines several mdBooks' `SUMMARY.md` into one book | Book-level, not file-level | [crates.io](https://crates.io/crates/mdbook-combiner) |
| **MarkdownTools / `mdmerge`** (GitHub, 81 stars) | Markdown processing tools including `mdmerge` | GitHub project, not clearly published as a maintained crate with heading demotion | [GitHub](https://github.com/JeNeSuisPasDave/MarkdownTools) |

**Is there an established Rust-native include syntax with heading demotion?** **No single, widely-adopted standalone Rust CLI** exists with a general "import file + demote headings + rewrite relative links → one `.md`" pipeline. The closest implementations are mdBook preprocessors — notably `mdbook-mdinclude` (heading shifting + relative-link rewriting) — but they are locked to the mdBook pipeline and its `SUMMARY.md` book model. `md-include` and `markdown-includes` are small, old, and do not document the heading/link behavior. Hence a new ~500-line Rust CLI has a clear niche; its include syntax will be custom (a sensible choice: a line like `{{#include path/to/file.md}}` or `@import "path"`, mirroring mdBook's familiar `{{#include}}` spelling *without* depending on mdBook).

---

### B4. Path rewriting / glob / CLI support libraries (brief)

| Crate | Version (2026-11-25) | Use here | Source |
| --- | --- | --- | --- |
| `clap` | 4.6.10 | CLI args (`--input`, `--output`, `--root`, `--follow`, etc.) | [crates.io](https://crates.io/crates/clap) |
| `walkdir` | 2.5.1 | Recursive file discovery if directory-level merges are supported | [crates.io](https://crates.io/crates/walkdir) |
| `glob` | 0.3.4 | Glob patterns for import targets | [crates.io](https://crates.io/crates/glob) |
| `pathdiff` | 0.2.3 | Compute relative path from output dir to each asset target — the core of link rewriting | [crates.io](https://crates.io/crates/pathdiff) |
| `pulldown-cmark-to-cmark` | 23.0.3 | Convert `Event`s back to Markdown if an event-rewrite approach is chosen | [crates.io](https://crates.io/crates/pulldown-cmark-to-cmark) |

---

## Verdict — recommended Rust stack for a Typora-compatible merge CLI

**Goal:** a small (~500-line) Rust CLI: source master with a custom `.mdx`-like extension containing import directives → one plain `.md` openable by Typora, with images, relative links, `[TOC]`, and PDF export intact.

**Recommended stack:**

1. **CLI:** `clap` 4.x; source discovery with `walkdir`/`glob` if needed. ([clap](https://crates.io/crates/clap), [walkdir](https://crates.io/crates/walkdir), [glob](https://crates.io/crates/glob))
2. **Parsing:** `pulldown-cmark` 0.13.x for heading events **and byte offsets**; use `into_offset_iter()` to locate heading sections and link/image destinations, but **splice the original source text** rather than re-rendering the whole document — this preserves Typora math, Mermaid diagrams, tables, HTML and `[TOC]` verbatim. Use `pulldown-cmark-to-cmark` only for small rewritten fragments if needed. ([guide](https://pulldown-cmark.github.io/pulldown-cmark/), [OffsetIter](https://docs.rs/pulldown-cmark/latest/pulldown_cmark/struct.OffsetIter.html), [to-cmark](https://crates.io/crates/pulldown-cmark-to-cmark))
3. **Path rewriting:** `pathdiff` to recompute each relative image/link target from the output file's directory; leave `http(s)://`, `mailto:`, `file://`, and `#anchors` untouched; optionally copy assets and set `typora-root-url` in front matter for portability. ([pathdiff](https://crates.io/crates/pathdiff), [docs Links](https://docs.typora.io/guide/links), [Files and Folders](https://docs.typora.io/guide/files-and-folders))
4. **Heading demotion:** prepend `#` characters to imported ATX headings based on the current nesting depth; mdBook's preprocessor docs and `mdbook-mdinclude` validate this approach conceptually, but implement it directly in the CLI, not through mdBook. ([mdBook Preprocessors](http://rust-lang.github.io/mdBook/for_developers/preprocessors.html), [mdbook-mdinclude README](https://docs.rs/crate/mdbook-mdinclude/latest/source/README.md))
5. **Output:** plain `.md`, with YAML front matter (if any) kept at the very top and `[toc]` placed where the user wants the TOC; let Typora generate the TOC and PDF bookmarks from the merged heading tree. ([Front Matter](https://docs.typora.io/guide/front-matter), [TOC](http://support.typora.io/TOC/), [stable release channel](https://typoraio.cn/releases/stable.html))

**Do NOT** try to make Typora open `.mdx` directly ([typora/typora-issues#6403](https://github.com/typora/typora-issues/issues/6403)), do NOT rely on Typora for includes ([typora/typora-issues#441](https://github.com/typora/typora-issues/issues/441)), and do NOT use mdBook as a runtime dependency for a single-file emitter. This stack is Rust-native, fits in roughly 500 lines, and keeps the generated file strictly within Typora's GFM+extensions dialect.

---

### Evidence notes / caveats

- Typora support pages are dated by the search index (e.g. Markdown Reference published 2016-01-01, updated 2026-10-31) but their bodies could not be fetched directly in this environment; quotations above come from indexed snippets and fetched-document evidence, so prefer re-verifying against the live URLs when implementing.
- `web_search` (DeepSeek endpoint) was unavailable (HTTP 402). Search was performed with Exa/Bing via `advanced_search` and `domain_search` (crates.io vertical), which returned primary-source URLs and snippets. Crate versions/dates are from crates.io's own index as of 2026-11-25.
- `typora-dt.com` is a third-party Chinese mirror claiming to be an official site; it is used only for the "PDF with bookmarks" marketing claim, corroborated by the [stable release channel](https://typoraio.cn/releases/stable.html) changelog mentioning PDF outline fixes.
