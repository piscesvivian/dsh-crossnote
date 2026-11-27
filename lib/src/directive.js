// 解析 MPE 风格 @import 指令，识别扩展属性 as / demote。
// 支持两种写法：
//   @import "path/file.md#slug" { as="新标题", demote=1 }
//   <!-- @import "path/file.md" { demote=2 } -->

const DIRECTIVE_RE = /<!--\s*@import\s+(.+?)\s*--\>|@import\s+(.+)$/gm;

/**
 * @returns {Array<{raw:string,start:number,end:number,path:string,hash:string|null,as:string|null,demote:number,comment:boolean}>}
 */
export function parseDirectives(text) {
  const out = [];
  for (const m of text.matchAll(DIRECTIVE_RE)) {
    const raw = m[0];
    const body = (m[1] ?? m[2] ?? '').trim();
    const parsed = parseBody(body);
    if (!parsed) continue;
    out.push({
      raw,
      start: m.index,
      end: m.index + raw.length,
      comment: m[0].startsWith('<!--'),
      ...parsed,
    });
  }
  return out;
}

function parseBody(body) {
  // body = "path" [#hash] [ { attrs } ]
  let rest = body;
  let attrs = {};
  const brace = rest.match(/\{([^}]*)\}\s*$/);
  if (brace) {
    attrs = parseAttrs(brace[1]);
    rest = rest.slice(0, brace.index).trim();
  }
  const quoted = rest.match(/["']([^"']+)["']/);
  if (!quoted) return null;
  const target = quoted[1];
  const hashIdx = target.indexOf('#');
  const path = hashIdx >= 0 ? target.slice(0, hashIdx) : target;
  const hash = hashIdx >= 0 ? target.slice(hashIdx + 1) : null;
  const as = typeof attrs.as === 'string' ? attrs.as : null;
  const demote = Number.isInteger(attrs.demote) ? attrs.demote : 0;
  return { path, hash, as, demote };
}

function parseAttrs(src) {
  const attrs = {};
  // 只解析 key=value（字符串或整数），容错未知键
  const re = /(\w+)\s*=\s*("([^"]*)"|'([^']*)'|(-?\d+))/g;
  for (const m of src.matchAll(re)) {
    const key = m[1];
    if (m[3] !== undefined) attrs[key] = m[3];
    else if (m[4] !== undefined) attrs[key] = m[4];
    else if (m[5] !== undefined) attrs[key] = parseInt(m[5], 10);
  }
  return attrs;
}
