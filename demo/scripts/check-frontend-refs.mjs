// check-frontend-refs.mjs
// 静态守卫：视图拆分/懒加载迁移后，页面模块里“用了但没导入”的名字会在
// 运行时炸成 ReferenceError（例如 ask 点击后 citationByRef is not defined）。
// 这里用词法近似扫描 src/ 下所有 .js/.jsx：
//   1) 独立函数调用 `name(`
//   2) JSX 组件 `<Name>` 与 `icon={Name}`
// 并排除 import、本文件声明（函数/const/解构/参数）、JS 关键字与浏览器/React 全局。
// 误报宁可少不可多：它更像“风险清单”而非终极裁判，但足以挡住迁移时丢 import。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..', 'src');
const GLOBALS = new Set(('document window location history localStorage sessionStorage fetch '
  + 'URL URLSearchParams File Blob FormData AbortController setTimeout clearTimeout '
  + 'setInterval clearInterval requestAnimationFrame crypto atob btoa navigator performance '
  + 'JSON Math Date String Number Boolean Array Object RegExp Error TypeError ArrayBuffer Symbol Map Set '
  + 'Promise Intl console TextEncoder TextDecoder Event MouseEvent CustomEvent EventTarget '
  + 'Request Response Headers DOMParser Image HTMLElement SVGElement ResizeObserver '
  + 'IntersectionObserver MutationObserver matchMedia FileReader getComputedStyle __DEV__ '
  + 'process Buffer structuredClone queueMicrotask isNaN isFinite parseInt parseFloat '
  + 'encodeURIComponent decodeURIComponent encodeURI XMLSerializer addEventListener '
  + 'removeEventListener dispatchEvent')
  .split(/\s+/u).filter(Boolean));
const KEYWORDS = new Set(('if for while do return throw try catch finally switch case default '
  + 'break continue new delete typeof instanceof in of yield await async function class extends '
  + 'super this void with import export from as')
  .split(/\s+/u).filter(Boolean));
const CLASS_METHODS = new Set(['constructor', 'componentDidCatch', 'getDerivedStateFromError',
  'render', 'componentDidMount', 'componentDidUpdate', 'componentWillUnmount',
  'shouldComponentUpdate', 'getSnapshotBeforeUpdate']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      walk(path, out);
    } else if (/\.(js|jsx)$/u.test(name) && !name.includes('.test.')) {
      out.push(path);
    }
  }
  return out;
}

function destructureNames(source) {
  const names = new Set();
  // 兼容逗号连写：const [a, setA] = useState(x), [b, setB] = useState(y);
  for (const match of source.matchAll(/\[([^\]]*)\]\s*=\s*use(?:State|Reducer|Ref|Memo)\(/g)) {
    for (const name of match[1].split(',')) {
      const clean = name.trim();
      if (clean) names.add(clean.split('=')[0].trim());
    }
  }
  for (const match of source.matchAll(/\{([^}]*)\}\s*=\s*use(?:State|Reducer)\(/g)) {
    for (const name of match[1].split(',')) {
      const clean = name.trim();
      if (clean) names.add(clean.split(':')[0].trim().split('=')[0].trim());
    }
  }
  return names;
}

function declaredNames(source) {
  const names = new Set();
  const importBlock = /import\s+(?:([\w$]+)\s*,?\s*)?\{([^}]*)\}\s*from/g;
  for (const match of source.matchAll(importBlock)) {
    if (match[1]) names.add(match[1]);
    for (const name of match[2].split(',')) {
      const clean = name.trim();
      if (!clean) continue;
      names.add(clean.split(' as ').pop().trim());
    }
  }
  for (const match of source.matchAll(/import\s+([\w$]+)\s*from\s/g)) names.add(match[1]);
  for (const match of source.matchAll(/\b(?:export\s+)?(?:async\s+)?function\s+([\w$]+)\b/g)) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/\b(?:export\s+)?(?:const|let|var)\s+([\w$]+)\b/g)) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/\bconst\s*\{([^}]*)\}\s*=/g)) {
    for (const name of match[1].split(',')) {
      const clean = name.trim();
      if (!clean) continue;
      names.add(clean.split(':')[0].trim().split(' as ').pop().trim());
    }
  }
  for (const match of source.matchAll(/\bconst\s*\[([^\]]*)\]\s*=/g)) {
    for (const name of match[1].split(',')) {
      const clean = name.trim();
      if (clean) names.add(clean.split('=')[0].trim());
    }
  }
  // 函数/箭头参数（含重命名解构如 { icon: Icon }），只在深度 0 处按逗号切分
  for (const match of source.matchAll(/\bfunction\s+[\w$]*\s*\(([^)]*)\)/g)) {
    const names2 = splitParams(match[1]);
    for (const name of names2) names.add(name);
  }
  for (const match of source.matchAll(/\(\s*([^)]*)\s*\)\s*=>/g)) {
    const names2 = splitParams(match[1]);
    for (const name of names2) names.add(name);
  }
  return names;
}

function splitParams(text) {
  const result = [];
  let normalized = text.trim().replace(/^\(\s*/u, '').replace(/\s*\)$/u, '');
  const segments = splitTopLevel(normalized, ',');
  for (const seg of segments) {
    const clean = seg.trim();
    if (!clean) continue;
    if (clean.startsWith('{') && clean.endsWith('}')) {
      for (const item of splitTopLevel(clean.slice(1, -1), ',')) {
        const inner = item.trim();
        if (!inner) continue;
        const rename = inner.match(/([\w$]+)\s*:\s*([\w$]+)/u);
        if (rename) { result.push(rename[2]); continue; }
        result.push(inner.split(/[\s=]/u).filter(x => /^[A-Za-z_$][\w$]*$/u.test(x)).pop());
      }
    } else if (clean.startsWith('[') && clean.endsWith(']')) {
      for (const item of splitTopLevel(clean.slice(1, -1), ',')) {
        const inner = item.trim();
        if (inner) result.push(inner.split('=')[0].trim());
      }
    } else {
      result.push(clean.split(/[\s=]/u).filter(x => /^[A-Za-z_$][\w$]*$/u.test(x)).pop() || clean);
    }
  }
  return result.filter(Boolean);
}

function splitTopLevel(text, separator) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if ('{[('.includes(ch)) depth += 1;
    else if ('}])'.includes(ch)) depth -= 1;
    if (ch === separator && depth === 0) { parts.push(current); current = ''; continue; }
    current += ch;
  }
  parts.push(current);
  return parts;
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/\/\/[^\n]*/gu, '');
}

const issues = [];
for (const path of walk(root)) {
  const original = readFileSync(path, 'utf8');
  const source = stripComments(original);
  const names = new Set([...declaredNames(original), ...destructureNames(source)]);
  const used = new Set();
  for (const match of source.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) used.add(match[1]);
  for (const match of source.matchAll(/<([A-Z][\w$]*)[\s>/]/g)) used.add(match[1]);
  for (const match of source.matchAll(/icon=\{\s*([A-Z][\w$]*)\s*\}/g)) used.add(match[1]);
  for (const match of source.matchAll(/(?<![.\w$])([A-Z][\w$]{2,})\s*\./g)) used.add(match[1]);
  const unknown = [...used].filter(name => name.length > 2 && !names.has(name)
    && !GLOBALS.has(name) && !KEYWORDS.has(name) && !CLASS_METHODS.has(name));
  if (unknown.length) issues.push(`${relative(root, path)} → ${unknown.sort().join(', ')}`);
}

if (issues.length) {
  console.error('未解析引用（可能缺失 import 或为迁移遗漏）：');
  for (const line of issues) console.error('  ' + line);
  console.error(`\n${issues.length} 个文件存在风险（若确为本文件参数/声明，请扩展本脚本的解析）。`);
  process.exit(1);
}
console.log('check-frontend-refs: 全部通过（未发现未解析的调用/组件引用）');
