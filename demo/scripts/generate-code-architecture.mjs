// Generate architecture documentation from the actual page, build and server
// routing sources. The generated Markdown must never be edited by hand.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const checkOnly = process.argv.includes('--check');
const demoRoot = join(fileURLToPath(import.meta.url), '..', '..');
const repoRoot = join(demoRoot, '..');
const appCore = readFileSync(join(demoRoot, 'src/app-core.js'), 'utf8');
const app = readFileSync(join(demoRoot, 'src/App.jsx'), 'utf8');
const vite = readFileSync(join(demoRoot, 'vite.config.js'), 'utf8');
const server = readFileSync(join(demoRoot, 'server/index.js'), 'utf8');
const outputPath = join(repoRoot, 'docs/代码架构图.generated.md');

const routeBlock = appCore.match(/export const ROUTES = \[([\s\S]*?)\n\];/u)?.[1] || '';
const routes = [...routeBlock.matchAll(/\['([^']+)',\s*'([^']+)',\s*[^,]+,\s*'([^']+)'\]/gu)]
  .map(match => ({ id: match[1], path: match[2], title: match[3] }));
const entries = new Set([...vite.matchAll(/^\s*,?([a-z][a-z-]*):\s*page\(/gmu)].map(match => match[1]));
const lazyViews = [...app.matchAll(/const\s+(\w+)\s*=\s*lazy\(\(\)\s*=>\s*import\('([^']+)'\)/gu)]
  .map(match => ({ component: match[1], module: match[2].replace(/^\.\//u, 'src/') }));
const eagerViews = [...app.matchAll(/import\s+\{[^}]+\}\s+from\s+'(\.\/views\/[^']+)'/gsu)]
  .map(match => ({ module: match[1].replace(/^\.\//u, 'src/') }));
const serverImports = new Map([...server.matchAll(/import\s+(\w+)\s+from\s+'(\.\.\/[^']+)'/gu)]
  .map(match => [match[1], match[2].replace(/^\.\.\//u, '')]));
const mountedHandlers = new Map([...server.matchAll(/app\.(?:use|all|get|post|patch|delete)\('([^']+)'\s*,\s*(\w+)/gu)]
  .map(match => [match[1], serverImports.get(match[2]) || match[2]]));
const mounts = [...new Set([...server.matchAll(/app\.(?:use|all|get|post|patch|delete)\('([^']+)'/gu)].map(match => match[1]))]
  .filter(path => path.startsWith('/api/'))
  .map(path => ({ path, handler: mountedHandlers.get(path) || 'server/index.js (inline)' }));

const missingEntries = routes.filter(route => !entries.has(route.id));
if (missingEntries.length) throw new Error(`routes missing Vite entries: ${missingEntries.map(item => item.id).join(', ')}`);
function nodeId(value) { return value.replace(/[^a-zA-Z0-9]/gu, '_'); }

function importedModules(module) {
  const source = readFileSync(join(demoRoot, module), 'utf8');
  const parent = module.split('/').slice(0, -1);
  return [...source.matchAll(/from\s+['"]([^'"]+)['"]/gu)]
    .map(match => match[1])
    .filter(value => value.startsWith('.'))
    .map(value => {
      const parts = [...parent, ...value.split('/')];
      const normalized = [];
      for (const part of parts) part === '..' ? normalized.pop() : part !== '.' && normalized.push(part);
      return normalized.join('/');
    });
}

function checkedEdge(from, to, label = '') {
  if (!importedModules(from).includes(to)) throw new Error(`architecture edge is not backed by an import: ${from} -> ${to}`);
  return `  ${nodeId(from)} -->${label ? `|${label}|` : ''} ${nodeId(to)}["${to}"]`;
}

const viewNodes = [...new Set([...lazyViews, ...eagerViews].map(item => item.module))].sort();
const apiNodes = [...new Set(mounts.map(item => item.handler).filter(item => !item.includes('(inline)')))].sort();
const diagram = [
  'flowchart LR',
  `  Browser["教师浏览器 · ${routes.length} 个页面入口"] --> App["src/App.jsx · 路由壳"]`,
  ...viewNodes.map(module => `  App --> ${nodeId(module)}["${module}"]`),
  ...viewNodes.map(module => `  ${nodeId(module)} --> Core["src/app-core.js · 请求与领域适配"]`),
  '  Core --> Server["server/index.js · API 路由"]',
  ...apiNodes.map(module => `  Server --> ${nodeId(module)}["${module}"]`),
  checkedEdge('api/index.js', 'serverless/index-provider.js', '教材搜索与问答'),
  checkedEdge('api/drafts.js', 'serverless/card-generation.js', '三卡生成'),
  checkedEdge('serverless/index-provider.js', 'serverless/grounded-answer.js', '带依据回答'),
  checkedEdge('serverless/card-generation.js', 'serverless/grounded-answer.js', '单卡与三卡'),
  checkedEdge('api/ai.js', 'serverless/deepseek.js', '个人连接'),
  checkedEdge('serverless/grounded-answer.js', 'serverless/llm-gateway.js', '系统智能'),
  checkedEdge('serverless/grounded-answer.js', 'serverless/ai-orchestrator.js', '多轮审校'),
  checkedEdge('serverless/grounded-answer.js', 'serverless/teaching-agent-contract.js', '回合契约与教师确认边界'),
  checkedEdge('serverless/pi-retrieval-agent.js', 'serverless/teaching-agent-contract.js', '确定性依据门'),
  '  serverless_index_provider_js --> PageIndex[("自部署教材索引")]',
  '  serverless_deepseek_js --> DeepSeek[("DeepSeek 官方接口")]',
  '  serverless_llm_gateway_js --> Gateway[("系统智能网关")]',
  '  serverless_auth_js --> Supabase[("Supabase · 账号、草稿与版本")]',
  checkedEdge('api/drafts.js', 'serverless/auth.js'),
  checkedEdge('api/assets.js', 'serverless/auth.js'),
  checkedEdge('serverless/auth-proxy.js', 'serverless/auth.js')
].join('\n');
const routeRows = routes.map(route => `| \`${route.path}\` | ${route.title} | \`${route.id}\` |`).join('\n');
const apiRows = mounts.map(item => `| \`${item.path}\` | \`${item.handler}\` |`).join('\n');
const content = `<!-- GENERATED by demo/scripts/generate-code-architecture.mjs. DO NOT EDIT. -->
# 活教参代码架构图

> 本图直接从当前代码生成。运行 \`cd demo && npm run docs:architecture\` 更新；\`npm run check\` 会在代码和本图不一致时失败。

## 运行架构

\`\`\`mermaid
${diagram}
\`\`\`

## 页面路由（来自 \`src/app-core.js\` 与 \`vite.config.js\`）

| URL | 页面 | 构建入口 |
|---|---|---|
${routeRows}

## 服务端入口（来自 \`server/index.js\`）

| API 前缀 | 实际处理模块 |
|---|---|
${apiRows}

## 一致性规则

1. 页面 URL 必须同时存在于 \`ROUTES\` 和 Vite 多页入口。
2. 页面组件通过 \`App.jsx\` 懒加载，业务请求统一经过 \`app-core.js\`。
3. 教材页码、教材标识和引用由服务端返回；前端只负责定位与展示。
4. 本文件由代码生成，不作为手工设计假设；新增页面或 API 后必须重新生成。
`;

if (checkOnly) {
  let current = '';
  try { current = readFileSync(outputPath, 'utf8'); } catch {}
  if (current !== content) {
    console.error(`${relative(repoRoot, outputPath)} is stale. Run: cd demo && npm run docs:architecture`);
    process.exit(1);
  }
  console.log(`Architecture contract passed: ${routes.length} pages, ${viewNodes.length} view modules, ${mounts.length} API mounts.`);
} else {
  writeFileSync(outputPath, content);
  console.log(`Wrote ${relative(repoRoot, outputPath)} from ${routes.length} routes and ${mounts.length} API mounts.`);
}
