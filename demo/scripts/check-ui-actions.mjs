// Static interaction contract for teacher-facing React views.
// It catches controls that look usable but have no action, anchors that do not
// navigate, and links to pages not present in the actual MPA route table.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const demoRoot = join(fileURLToPath(import.meta.url), '..', '..');
const srcRoot = join(demoRoot, 'src');
const routeSource = readFileSync(join(srcRoot, 'app-core.js'), 'utf8');
const routeBlock = routeSource.match(/export const ROUTES = \[([\s\S]*?)\n\];/u)?.[1] || '';
const routes = new Set([...routeBlock.matchAll(/\['[^']+',\s*'([^']+)'/gu)].map(match => match[1]));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, out);
    else if (/\.(js|jsx)$/u.test(name) && !name.includes('.test.')) out.push(path);
  }
  return out;
}

function openingTags(source, tagName) {
  const result = [];
  const needle = `<${tagName}`;
  let cursor = 0;
  while ((cursor = source.indexOf(needle, cursor)) >= 0) {
    const boundary = source[cursor + needle.length];
    if (boundary && /[\w:-]/u.test(boundary)) { cursor += needle.length; continue; }
    let quote = '';
    let escaped = false;
    let braces = 0;
    let end = cursor + needle.length;
    for (; end < source.length; end += 1) {
      const char = source[end];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === quote) quote = '';
        continue;
      }
      if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
      if (char === '{') { braces += 1; continue; }
      if (char === '}') { braces = Math.max(0, braces - 1); continue; }
      if (char === '>' && braces === 0) break;
    }
    if (end >= source.length) break;
    const close = source.indexOf(`</${tagName}>`, end + 1);
    result.push({ start: cursor, opening: source.slice(cursor, end + 1), body: close >= 0 ? source.slice(end + 1, close) : '' });
    cursor = end + 1;
  }
  return result;
}

function lineAt(source, offset) { return source.slice(0, offset).split('\n').length; }

function staticHref(opening) {
  const literal = opening.match(/\bhref\s*=\s*(["'])(.*?)\1/su);
  if (literal) return literal[2];
  const template = opening.match(/\bhref\s*=\s*\{`([^`]*)`\}/su);
  if (template) return template[1].replace(/\$\{[^}]+\}/gu, ':value');
  return null;
}

function routeFor(href) {
  if (!href?.startsWith('/')) return null;
  const pathname = href.split(/[?#]/u)[0].replace(/:value/gu, 'x');
  return pathname === '/' ? '/' : `/${pathname.split('/').filter(Boolean)[0]}/`;
}

function visibleButtonName(body) {
  // Component tags disappear, while dynamic expressions such as `{label}`
  // and `{busy ? '保存中' : '保存'}` still contribute an accessible name.
  return body.replace(/<[^>]+>/gsu, ' ').replace(/[{}]/gu, ' ').replace(/&\w+;/gu, ' ').replace(/\s+/gu, ' ').trim();
}

const failures = [];
let buttonCount = 0;
let linkCount = 0;
let internalRouteCount = 0;
let dynamicLinkCount = 0;
for (const path of walk(srcRoot)) {
  const source = readFileSync(path, 'utf8');
  const file = relative(demoRoot, path);
  for (const tag of openingTags(source, 'button')) {
    buttonCount += 1;
    const where = `${file}:${lineAt(source, tag.start)}`;
    const actionable = /\bonClick\s*=/u.test(tag.opening)
      || /\bformAction\s*=/u.test(tag.opening)
      || /\btype\s*=\s*["'](?:submit|reset)["']/u.test(tag.opening);
    if (!actionable) failures.push(`${where} button has no click, submit, reset, or form action`);
    if (/\bonClick\s*=\s*\{\s*\(?.*?\)?\s*=>\s*\{\s*\}\s*\}/su.test(tag.opening)) failures.push(`${where} button has an empty click handler`);
    const accessible = /\baria-label\s*=/u.test(tag.opening)
      || /\btitle\s*=/u.test(tag.opening)
      || visibleButtonName(tag.body).length > 0;
    if (!accessible) failures.push(`${where} button has no accessible name`);
  }
  for (const tag of openingTags(source, 'a')) {
    linkCount += 1;
    const where = `${file}:${lineAt(source, tag.start)}`;
    if (!/\bhref\s*=/u.test(tag.opening)) { failures.push(`${where} anchor has no href`); continue; }
    const href = staticHref(tag.opening);
    if (href == null) dynamicLinkCount += 1;
    if (href === '#' || /^javascript:/iu.test(href || '')) failures.push(`${where} anchor uses a non-navigation href (${href})`);
    const route = routeFor(href);
    if (route) internalRouteCount += 1;
    if (route && !routes.has(route)) failures.push(`${where} points to an undeclared page route ${route}`);
    if (route === '/cards/' && !/[?&]draftId=|:value/u.test(href || '')) failures.push(`${where} opens cards without binding a draftId`);
  }
}

if (failures.length) {
  console.error(`UI action contract failed (${failures.length}):\n${failures.map(item => `- ${item}`).join('\n')}`);
  process.exit(1);
}
console.log(`UI action contract passed: ${buttonCount} buttons, ${linkCount} links (${internalRouteCount} statically resolved internal routes, ${dynamicLinkCount} state-derived links), ${routes.size} declared pages.`);
