// 规避 crossnote 导出副作用：Mermaid/PlantUML 栅格化会触发 mermaid-cli 安装与无头浏览器下载导致挂起。
// 策略：导出前把图表围栏替换为等长占位文本，导出后原样还原。

const DIAGRAM_RE = /^(```|~~~)(mermaid|plantuml)\b([\s\S]*?)^\1\s*$/gm;

/** 导出前：把图表块替换为占位，返回 { text, stash }。 */
export function stashDiagrams(text) {
  const stash = [];
  const replaced = text.replace(DIAGRAM_RE, (block) => {
    const token = `CNXCDIAGRAM${stash.length}PLACEHOLDER`;
    stash.push(block);
    return token;
  });
  return { text: replaced, stash };
}

/** 导出后：把占位还原为原始图表块。 */
export function restoreDiagrams(text, stash) {
  let out = text;
  stash.forEach((block, i) => {
    out = out.replace(`CNXCDIAGRAM${i}PLACEHOLDER`, () => block);
  });
  return out;
}
