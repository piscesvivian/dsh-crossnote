// 外部工具检测：child_process.execFile + timeout + 结构化缺失提示（AC-7/9）。

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 8000;

// Windows 下探测命令；POSIX 用 which。仅用于检测，不执行外部副作用。
const IS_WIN = process.platform === 'win32';
const PROBE = IS_WIN
  ? { cmd: 'cmd', args: (name) => ['/d', '/c', `where ${name}`] }
  : { cmd: 'which', args: (name) => [name] };

const TOOLS = [
  { name: 'chrome', bins: ['chrome', 'chrome.exe', 'msedge', 'msedge.exe'], hint: '请安装 Chrome/Chromium 或在配置页填写 chromePath。' },
  { name: 'pandoc', bins: ['pandoc'], hint: '请安装 pandoc 或在配置页填写 pandocPath。' },
  { name: 'pdflatex', bins: ['pdflatex'], hint: 'PDF(pandoc) 链需要 TeX 发行版（含 pdflatex）。' },
  { name: 'prince', bins: ['prince'], hint: 'pdf-prince 需要安装 PrinceXML，并确保 prince 在 PATH 中。' },
  { name: 'ebook-convert', bins: ['ebook-convert'], hint: 'epub 需要 Calibre 的 ebook-convert 在 PATH 中。' },
];

async function probeBin(bin) {
  try {
    const { stdout } = await execFileAsync(PROBE.cmd, PROBE.args(bin), { timeout: TIMEOUT_MS, windowsHide: true });
    const line = String(stdout || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    return line || null;
  } catch {
    return null;
  }
}

async function probeVersion(bin, filePath) {
  const versionFlags = ['--version', '-v'];
  for (const flag of versionFlags) {
    try {
      const { stdout, stderr } = await execFileAsync(filePath || bin, [flag], { timeout: TIMEOUT_MS, windowsHide: true });
      const text = String(stdout || stderr || '').trim().split(/\r?\n/)[0];
      if (text) return text.slice(0, 120);
    } catch {
      /* 尝试下一个 flag */
    }
  }
  return null;
}

/**
 * @returns {Promise<Array<{name:string,found:boolean,version:string|null,path:string|null,hint?:string}>>}
 */
export async function detectTools() {
  const results = [];
  for (const tool of TOOLS) {
    let foundPath = null;
    let usedBin = null;
    for (const bin of tool.bins) {
      const p = await probeBin(bin);
      if (p) {
        foundPath = p;
        usedBin = bin;
        break;
      }
    }
    if (foundPath) {
      const version = await probeVersion(usedBin, foundPath);
      results.push({ name: tool.name, found: true, version, path: foundPath });
    } else {
      results.push({ name: tool.name, found: false, version: null, path: null, hint: tool.hint });
    }
  }
  return results;
}
