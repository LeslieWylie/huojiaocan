import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const view = name => readFile(new URL(`./views/${name}`, import.meta.url), 'utf8');
const styles = () => readFile(new URL('./styles.css', import.meta.url), 'utf8');

test('sidebar exposes four primary entries and collects every secondary entry under more tools', async () => {
  const source = await view('shell-pages.jsx');
  const primary = source.match(/export const PRIMARY_NAV = \[([\s\S]*?)\n\];/u)?.[1] || '';
  assert.equal((primary.match(/^\s*\['/gmu) || []).length, 4);
  for (const id of ['dashboard', 'library', 'ask', 'cards']) assert.match(primary, new RegExp(`\\['${id}'`, 'u'));
  assert.match(source, /export const MORE_TOOL_NAV = \[/u);
  assert.match(source, /<span>更多工具<\/span>/u);
  assert.doesNotMatch(source, />课堂与教研工具</u);
  assert.doesNotMatch(source, />教材导入与处理</u);
});

test('shell provides a keyboard skip target and dashboard hero has one contextual CTA', async () => {
  const source = await view('shell-pages.jsx');
  assert.match(source, /className="skip-link" href="#main-content">跳到主要内容/u);
  assert.match(source, /<main className="main-area" id="main-content" tabIndex=\{-1\}>/u);
  const dashboard = source.slice(source.indexOf('export function Dashboard()'));
  const heroActions = dashboard.match(/<div className="hero-actions">([\s\S]*?)<\/div><\/div><div className="teaching-flow-summary"/u)?.[1] || '';
  assert.equal((heroActions.match(/<a\b/gu) || []).length, 2, 'the two conditional branches each render exactly one CTA');
  assert.doesNotMatch(heroActions, /开始新的备课|查看单元接力/u);
});

test('ask keeps the lesson visible while folding older turns behind the latest answer', async () => {
  const source = await view('ask-page.jsx');
  assert.match(source, /className="ask-context-summary" aria-label="当前备课范围"/u);
  assert.match(source, /className="conversation-history-fold"/u);
  assert.match(source, /展开此前 \{messages\.length - 1\} 轮问答/u);
  assert.match(source, /className="conversation-latest" aria-label="最新一轮问答"/u);
  assert.match(source, /turn=\{messages\.at\(-1\)\}/u);
  assert.ok(source.indexOf('conversation-history-fold') < source.indexOf('conversation-latest'));
  assert.match(source, /recoveryMatchesCurrentPath/u, 'an exact login return must restore the pending question even when the URL names a lesson');
});

test('cards use a neutral skeleton and support sequential save plus post-lock version copying', async () => {
  const source = await view('cards-page.jsx');
  const css = await styles();
  assert.match(source, /className="panel cards-loading-skeleton"/u);
  assert.match(source, /const saveAndViewNext = async \(\) =>/u);
  assert.match(source, /保存并查看下一张/u);
  assert.match(source, /currentCard\.status !== 'locked' \?[\s\S]*?复制为新版本/u);
  assert.match(source, /const copyVersion = async \(\) =>/u);
  assert.match(source, /\/api\/assets\/\$\{encodeURIComponent\(draftId\)\}\/copy/u);
  assert.match(css, /\.cards-loading-skeleton\{[^}]*background:#fbfaf7/u);
  assert.match(css, /\.conversation-latest\{[^}]*border-top:4px solid #c3943f/u);
});
