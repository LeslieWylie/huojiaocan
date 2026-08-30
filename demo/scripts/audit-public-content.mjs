#!/usr/bin/env node
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const demoRoot = path.resolve(scriptDir, '..');
const textExtensions = new Set([
  '.css', '.cjs', '.html', '.js', '.jsx', '.json', '.md', '.mjs', '.py',
  '.sql', '.svg', '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml',
]);

const checks = [
  ['competition_notice', /比赛通知|人工智能应用创新大赛|competition-notice|20260722/g],
  ['google_fonts', /fonts\.googleapis\.com|fonts\.gstatic\.com/gi],
  // 小写 ocr 允许作为内部枚举；禁止公开可见的大写术语和中文技术宣传。
  ['public_ocr_wording', /\bOCR\b|光学字符识别|OCR识别|OCR解析/g],
  // 安全输出只包含文件路径和命中数，绝不输出匹配值。
  ['hardcoded_secret', /sk-[A-Za-z0-9_-]{16,}|(?:api[_-]?key|access[_-]?token|secret)\s*[:=]\s*["'][^"'\s]{12,}["']/gi],
];

const sourceRoots = [
  'src', 'public', 'api', 'server', 'serverless', path.join('data', 'index'),
];

function isTestFile(filePath) {
  return /(?:^|\/)(?:__tests__|test|tests)(?:\/|$)/.test(filePath)
    || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(filePath);
}

async function walk(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function countMatches(text, pattern) {
  pattern.lastIndex = 0;
  let count = 0;
  while (pattern.exec(text)) count += 1;
  pattern.lastIndex = 0;
  return count;
}

async function inspectFiles(files, scope) {
  const findings = [];
  for (const filePath of files.sort()) {
    const relativePath = path.relative(demoRoot, filePath).split(path.sep).join('/');
    if (scope === 'source' && isTestFile(relativePath)) continue;

    const loweredName = path.basename(filePath).toLowerCase();
    if (/competition|notice|20260722|比赛/.test(loweredName)) {
      findings.push({ scope, check: 'competition_notice_filename', file: relativePath, count: 1 });
    }

    const extension = path.extname(filePath).toLowerCase();
    if (!textExtensions.has(extension) && path.basename(filePath) !== 'robots.txt') continue;
    const info = await stat(filePath);
    if (info.size > 8 * 1024 * 1024) continue;

    let text;
    try {
      text = await readFile(filePath, 'utf8');
    } catch {
      continue;
    }
    for (const [check, pattern] of checks) {
      const count = countMatches(text, pattern);
      if (count > 0) findings.push({ scope, check, file: relativePath, count });
    }
  }
  return findings;
}

export async function auditPublicContent() {
  const sourceFiles = [];
  for (const relativeRoot of sourceRoots) {
    sourceFiles.push(...await walk(path.join(demoRoot, relativeRoot)));
  }
  const distFiles = await walk(path.join(demoRoot, 'dist'));
  return [
    ...await inspectFiles(sourceFiles, 'source'),
    ...await inspectFiles(distFiles, 'dist'),
  ];
}

async function main() {
  const findings = await auditPublicContent();
  if (findings.length === 0) {
    console.log('public-content-audit: PASS (source=clean, dist=clean)');
    return;
  }
  console.error(`public-content-audit: FAIL (${findings.length} finding groups)`);
  for (const finding of findings) {
    console.error(`${finding.scope}\t${finding.check}\t${finding.file}\tcount=${finding.count}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
