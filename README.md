# dsh-crossnote

基于 [crossnote](https://github.com/shd101wyy/crossnote)（Markdown Preview Enhanced 的底层引擎）二次开发的 DSH 插件：把多个 Markdown 碎片文件合并导出为**单个纯 `.md`**，可直接用 Typora 打开并由 Typora 导出 PDF。

## 为什么

- AI 写长文档时把单文件控制在 ~500 行更好，但需要"总纲 + 章节文件"的整体视角。
- Typora 没有原生 include，Markdown Extended 不可移植；最终产物必须是标准 `.md`。
- crossnote 原生已支持：整文件 `@import`、`#heading` 章节切片、图片/相对链接重写、纯 `.md` 导出。
- 但原生**不支持标题降级与章节改名**，且有数学/图表栅格化副作用。本插件补齐这两点。

## 语法

```md
@import "chapters/intro.md"
@import "chapters/design.md#架构设计"

<!-- @import "chapters/api.md#概述" { as="系统概览", demote=1 } -->
```

- `as="新标题"`：把导入章节的主标题改名。
- `demote=N`：导入内容所有标题下移 N 级（clamp 到 1..6）。

> ⚠️ crossnote 会剥离普通 HTML 注释，所以本插件在**导出前**改写源码副本实现 as/demote，不依赖导出后处理。

## DSH 使用

安装为 workspace bundle 后，Agent 可调用工具：

```
工具：crossnote_merge
参数：{ "source": "master.md", "output": "book.md" }
```

## 独立调用（Node）

```js
import { merge } from './src/merge.js';
await merge({ source: 'master.md', output: 'book.md' });
```

需先安装依赖：`npm install crossnote@^0.9.44`（Node >= 18.17）。

## 文档

- [PRD](docs/PRD.md)
- 调研报告见 `E:\Project\rust-md\research\`（本仓库不含调研原始资料）

## License

NCSA（与 crossnote 一致）——见 [LICENSE](LICENSE)。
