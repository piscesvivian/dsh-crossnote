// 构建脚本：产出 lib/index.js（宿主入口）与 lib/client.js（浏览器模块）。
// 无外部打包器依赖：纯文件复制 + 头部标记，保证离开构建机也能复现。
// 契约：build() -> {host, client}；产物 mtime 晚于源码（AC-16）。

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LIB = path.join(ROOT, 'lib');

/**
 * @returns {Promise<{host:string, client:string}>}
 */
export async function build() {
  await fs.mkdir(LIB, { recursive: true });

  // 宿主产物：转口到根入口（根 index.js + src/ 已在 files 白名单内），
  // 避免 lib/index.js 因 lib/src/ 未打包而在安装后找不到相对依赖。
  const hostSrc = path.join(ROOT, 'index.js');
  const hostDst = path.join(LIB, 'index.js');
  await fs.writeFile(hostDst, `/* built from index.js for @local/dsh-crossnote */\nexport * from '../index.js';\n`, 'utf8');

  // 浏览器产物：module loader 需要能直接执行的脚本；复制源码并加构建标记。
  const clientSrc = path.join(ROOT, 'client.js');
  const clientDst = path.join(LIB, 'client.js');
  let clientCode = await fs.readFile(clientSrc, 'utf8');
  const banner = `/* built from client.js for @local/dsh-crossnote — dsh.client platform=web */\n`;
  if (!clientCode.startsWith('/* built from')) {
    clientCode = banner + clientCode;
  }
  await fs.writeFile(clientDst, clientCode, 'utf8');

  // src/ 同步复制到 lib/src/，让 lib/index.js 的相对引用在打包后仍可解析。
  const srcDst = path.join(LIB, 'src');
  await fs.mkdir(srcDst, { recursive: true });
  for (const name of await fs.readdir(path.join(ROOT, 'src'))) {
    if (name.endsWith('.js')) await fs.copyFile(path.join(ROOT, 'src', name), path.join(srcDst, name));
  }

  // 确保产物 mtime 严格晚于任一源码文件（AC-16）。
  let newest = 0;
  for (const dir of [ROOT, path.join(ROOT, 'src')]) {
    for (const name of await fs.readdir(dir)) {
      if (!name.endsWith('.js') && name !== 'package.json') continue;
      const stat = await fs.stat(path.join(dir, name));
      if (stat.mtimeMs > newest) newest = stat.mtimeMs;
    }
  }
  const bump = new Date(newest + 1000);
  await fs.utimes(hostDst, bump, bump);
  await fs.utimes(clientDst, bump, bump);

  return { host: hostDst, client: clientDst };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  build().then((r) => {
    console.log(`built: ${r.host} + ${r.client}`);
  }).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
