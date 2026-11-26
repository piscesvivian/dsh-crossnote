# PRD — dsh-crossnote：基于 crossnote 的 Markdown 多文件合并导出 DSH 插件

- 版本：v0.1
- 日期：2026-11-27
- 状态：待评审
- 目标仓库：`https://github.com/piscesvivian/dsh-crossnote`

---

## 1. 背景与问题

AI 编辑单个 Markdown 文件时，把文件控制在约 500 行内效果最好；但文档一旦变大，就会拆出大量碎片文件，失去"一本书/一个总纲"的整体视角。

期望的工作方式：

1. 一个**总纲文档**（master）负责目录结构与章节组织；
2. 用 `import` 之类的语法把**多个碎片文件**包含进来，可只取某个章节（`#heading`）；
3. 导入时可以**改标题名**、让**标题层级降级**（总纲是 `## 第一章`，导入文件的 `# 章节` 应变成 `###`）；
4. 图片、相对链接在合并后仍然可用；
5. 导出为**单个纯 `.md`**，交给 Typora 打开并由 Typora 导出 PDF（PDF 书签来自标题树）。

现有方案的痛点：

- Typora 没有原生 include/transclusion（[typora-issues#441](https://github.com/typora/typora-issues/issues/441)，仍 open），且只可靠支持 `.md` 扩展名（[#6403](https://github.com/typora/typora-issues/issues/6403)）。
- Markdown Extended 之类语法需要额外安装软件，且离开了该软件就无法查看，不可移植。
- 因此最终产物必须是**标准 `.md`**，不能依赖运行时渲染器。

## 2. 目标 / 非目标

### 目标（Goals）

- G1：提供 MPE（Markdown Preview Enhanced）兼容的 `@import` 合并语法。
- G2：在 crossnote 之上做**二次开发**，补齐「标题降级」与「章节改名」两项缺失能力。
- G3：导出单一 `.md`，可直接用 Typora 打开，标题树正确（PDF 书签可用）。
- G4：以 **DSH 插件（bundle）** 形态交付，在 DSH 内可直接调用。
- G5：代码与 PRD 开源到 GitHub 仓库。

### 非目标（Non-goals）

- N1：不做 Rust 实现（用户已明确否决）。
- N2：不做完整 Markdown 解析器/渲染器；复用 crossnote，不 fork 整个库。
- N3：不在导出产物中保留 [TOC] 展开逻辑（由 Typora 自己处理）。
- N4：本期不做双向回写（导出文件不能被反向拆分回碎片文件）。

## 3. 目标用户与核心场景

- **用户**：用 AI 辅助写长文档（书籍/设计文档/知识库）的技术写作者。
- **核心场景**：总纲 + 若干章节文件 → 一条命令导出 `book.md` → Typora 打开 → 导出 PDF。
- **次要场景**：在 DSH 会话中让 Agent 直接调用插件工具完成合并。

## 4. 需求清单

### 功能需求（FR）

| ID | 需求 | 优先级 |
|----|------|--------|
| FR1 | 整文件导入：`@import "path/file.md"` | P0 |
| FR2 | 按标题取章节：`@import "path/file.md#heading-slug"` | P0 |
| FR3 | 标题降级：`demote=N`，导入内容所有标题下移 N 级（clamp 1..6） | P0 |
| FR4 | 章节改名：`as="新标题"`，重命名被导入内容的**主标题** | P0 |
| FR5 | 图片/相对链接路径在导出后仍正确指向 | P0 |
| FR6 | 输出单一纯 `.md`，无 HTML 残留、无运行时依赖 | P0 |
| FR7 | 循环导入检测并给出清晰错误 | P1 |
| FR8 | 数学/图表副作用开关（默认关闭栅格化） | P1 |
| FR9 | 可配置输出路径（front matter `markdown.path` 或工具参数） | P1 |
| FR10 | DSH 工具入口，Agent 可调用 | P1 |

### 非功能需求（NFR）

| ID | 需求 |
|----|------|
| NFR1 | Node.js >= 18.17（crossnote 要求），实测 Node v24.15.0 可用 |
| NFR2 | 不把 PAT / 凭据写入仓库、git 配置或日志 |
| NFR3 | 与 DSH 0.2.2-rc.5（cordis 4.1.0）兼容的 Host-only bundle |
| NFR4 | 导出失败时明确报错，不留半成品文件 |

## 5. 语法设计（MPE 兼容 + 扩展）

基线使用 MPE 已定义的 `@import`，扩展属性放在花括号内（MPE 自己也用 `{}` 传参）：

```md
<!-- @import "chapters/intro.md" -->
@import "chapters/design.md#架构设计"

<!-- @import "chapters/api.md#概述" { as="系统概览", demote=1 } -->
```

- `#heading`：复用 crossnote/MPE 的 slug 章节切片（crossnote 支持 `#slug` 与 `#^block-id`）。
- `as="..."`：把被导入内容的**主标题**改成指定文本（不改子标题）。
- `demote=N`：整段导入内容的标题下移 N 级；`# → ##`、`## → ###`，最低到 `######`。
- 未带扩展属性的指令保持 MPE 原义，直接交给 crossnote 处理。

> 设计约束：crossnote 导出时**会剥离普通 HTML 注释**（实测），所以不能靠"导出后再按哨兵注释定位"来实现降级/改名。必须在 crossnote 展开之前完成改写（见 §6.4）。

## 6. 技术方案

### 6.1 技术选型：crossnote 二次开发（用户决策）

- 用户明确："不要 rust，crossnote 二次开发就好"。
- crossnote 是 MPE 的底层引擎，独立可 `import`（npm 包 `crossnote`，当前 v0.9.44，NCSA 许可，CJS + ESM，Node >=18.17）。
- 关键 API：`Notebook.init({ notebookPath, config })` → `getNoteMarkdownEngine('master.md')` → `engine.markdownExport()` → 返回**导出文件路径**（不是内容）。

### 6.2 crossnote 实测能力边界（来自 verify/ 实测）

实测文件：`E:\Project\rust-md\verify\merged.md`（62 行）：

| 需求 | crossnote 原生 | 说明 |
|------|---------------|------|
| 整文件 import | ✅ | |
| 按标题取章节 | ✅ | `#slug`，来自 PR #438（v0.9.26+） |
| 图片/相对链接重写 | ✅ | |
| 纯 `.md` 导出 | ✅ | `markdownExport()` 写文件 |
| 标题降级 | ❌ | 导入 `# 项目介绍` 仍为 H1 |
| 章节改名 | ❌ | 无对应语法 |

**副作用**：`mathRenderingOption != 'None'` 时数学公式转在线图片；`processGraphs` 会栅格化 Mermaid/PlantUML（会触发 `@mermaid-js/mermaid-cli` 安装与无头浏览器下载，导致进程挂起）；`[TOC]` 会被强展开。

### 6.3 关键约束：哨兵方案被实测否决

尝试在 `@import` 前后插入 `<!-- CNXC:IMPORT:BEGIN ... -->` / `<!-- CNXC:IMPORT:END -->` 哨兵，导出后按哨兵定位改写。结果：**哨兵被 crossnote 完全剥离**，导入标题原样保留。结论：只能在**展开前**处理。

### 6.4 核心设计：导出前源码预处理（pre-flight rewrite）

数据流：

```
master.md (含扩展 @import)
      │
      ▼ ① directive.js 解析扩展指令（as/demote/#slug）
      │
      ▼ ② preprocess.js 在临时 staging 目录：
      │     - 对每个带 as/demote 的导入，读取被导入文件（或切片章节）
      │     - 改写标题：主标题改名 + 全部标题 += demote（clamp 1..6）
      │     - 重写该文件内图片/链接为相对 staging 的正确路径
      │     - 写回 staging 副本，并把 master 中的扩展指令降级为普通 @import
      │
      ▼ ③ sideeffects.js：把 mathRenderingOption 设为 'None'，
      │     并将 Mermaid 代码块临时替换为等长占位（导出后还原为围栏代码）
      │
      ▼ ④ crossnote：Notebook.init(staging) → markdownExport() 展开 import → 写纯 .md
      │
      ▼ ⑤ 读取产物内容，还原占位，写到用户指定输出路径
      │
      ▼ ⑥ 清理 staging 临时目录
```

为什么不用"改 crossnote transformer 源码"：transformer.ts 约 61KB，深度耦合 HTML 渲染中间态，改动易碎且升级困难；源码预处理只依赖公开 API，升级 crossnote 成本最低。

## 7. 副作用规避策略

| 副作用 | 规避方式 |
|--------|----------|
| 数学转在线图片 | `config.mathRenderingOption = 'None'`（实测可跳过） |
| Mermaid 栅格化导致挂起 | 导出前把 ` ```mermaid ` 块替换为普通文本占位，导出后还原 |
| [TOC] 强展开 | 导入预处理时移除 `[TOC]` 占位（由 Typora 目录功能替代） |
| 普通 HTML 注释被剥离 | 不依赖注释传递信息，全部信息编码进 staging 文件本身 |

## 8. 插件形态（DSH Host-only bundle）

- `package.json` 含 `dsh.bundle.patch` → `cordis.patch.yml`（insert 本插件 id）。
- `index.js`：`apply(ctx)` 中通过 `ctx.tools.register(...)` 注册 `crossnote_merge` 工具；用 `ctx.effect()` 返回清理函数。
- `locale/en.json` + `locale/zh-CN.json`：插件元数据 `meta.title/description/detail`。
- `icon.svg`、`docs/PRD.md`、`src/*` 全部列入 `files`。
- 安装方式：workspace bundle + `plugin_manager install_bundle`（不在 `$DSH_HOME` 手写配置）。
- 工具入参：`source`（master 路径）、`output`（输出 .md 路径）、可选 `options`。

## 9. 里程碑

| 阶段 | 内容 | 状态 |
|------|------|------|
| M0 | 调研与可行性验证（已产出 research/01–04） | 已完成 |
| M1 | PRD + 仓库初始化 + 推送 | 进行中 |
| M2 | `directive.js` / `preprocess.js` / `sideeffects.js` 核心逻辑 | 待办 |
| M3 | DSH 工具注册 + 端到端实测（含 Typora 打开验证） | 待办 |
| M4 | 发布到 bundle 市场 / 安装验证 | 待办 |

## 10. 验收标准（M1）

- [x] PRD 写入 `docs/PRD.md` 并入库。
- [x] 仓库 `git init`、首次 commit、push 到 `https://github.com/piscesvivian/dsh-crossnote`。
- [x] 仓库中不含 PAT、不含 `node_modules`。
- [ ] 核心合并功能端到端通过（M3 验收）。

## 11. 风险与开放问题

- **R1**：跨note 升级可能改变导出行为 → 锁定版本范围，测试固定 fixtures。
- **R2**：`demote` 与 markdown 内嵌代码块中的 `#` 混淆 → 预处理必须跳过 fenced code。
- **R3**：Mermaid 占位还原可能破坏原格式 → 用等长占位并记录原始块。
- **R4**：staging 目录路径导致相对链接基准变化 → 需镜像原目录结构。
- **O1**：`as` 只改名主标题还是整段所有同级标题？当前设计：仅主标题。待评审确认。
- **O2**：是否需要 `--watch` 增量导出？本期不做。

## 附录 A：一手资料

- crossnote README：<https://github.com/shd101wyy/crossnote>
- crossnote transformer：<https://github.com/shd101wyy/crossnote/blob/develop/src/markdown-engine/transformer.ts>
- MPE file imports：<https://github.com/shd101wyy/markdown-preview-enhanced/blob/master/docs/file-imports.md>
- Typora include feature request：<https://github.com/typora/typora-issues/issues/441>
- Typora PDF/bookmark：<https://github.com/typora/typora-issues/issues/5777>
- 完整调研结论见本仓库 `research/` 目录。
