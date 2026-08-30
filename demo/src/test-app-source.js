// 测试安全网：把 src 下所有前端源码拼接成一个 appSource。
// 目的：源码守卫断言（match/doesNotMatch）从"绑定 App.jsx 文件位置"
// 变为"绑定前端源码整体"。这样 App.jsx 按页面拆分到 views/* 后，
// 守卫仍能找到代码；doesNotMatch 变成"任何前端文件都不允许出现"，
// 比原来更强、更正确。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = path.dirname(fileURLToPath(import.meta.url));

let files = [];
for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  if (!/\.(jsx?|css)$/.test(entry.name)) continue;
  if (/\.test\.(jsx?)$/.test(entry.name)) continue;
  files.push(entry.name);
}
const viewsDir = path.join(srcDir, 'views');
if (fs.existsSync(viewsDir)) {
  for (const entry of fs.readdirSync(viewsDir, { withFileTypes: true })) {
    if (entry.isFile() && /\.(jsx?)$/.test(entry.name) && !/\.test\./ .test(entry.name)) files.push(path.join('views', entry.name));
  }
}
files.sort();

export const appSource = files
  .map(name => {
    try {
      return `/* ===== src/${name} ===== */\n${fs.readFileSync(path.join(srcDir, name), 'utf8')}`;
    } catch {
      return '';
    }
  })
  .join('\n');

export const srcFileNames = files;
