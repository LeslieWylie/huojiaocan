import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appPath = new URL('./App.jsx', import.meta.url);
const vitePath = new URL('../vite.config.js', import.meta.url);

async function source(url) { return readFile(url, 'utf8'); }

function routeIdsFromApp(text) {
  const block = text.match(/const ROUTES = \[([\s\S]*?)\n\];/u)?.[1] || '';
  return [...block.matchAll(/\['([^']+)',/gu)].map(match => match[1]);
}

function entryIdsFromVite(text) {
  const block = text.match(/input:\s*\{([\s\S]*?)\n\s*\}/u)?.[1] || '';
  return [...block.matchAll(/^\s*,?([a-z][a-z-]*):\s*page\(/gmu)].map(match => match[1]);
}

test('every built page has a teacher-facing route title', async () => {
  const [app, vite] = await Promise.all([source(appPath), source(vitePath)]);
  const routeIds = new Set(routeIdsFromApp(app));
  const entries = entryIdsFromVite(vite).map(id => id === 'dashboard' ? 'dashboard' : id);
  assert.ok(entries.length >= 30, `expected the full multi-page build, got ${entries.length}`);
  assert.deepEqual(entries.filter(id => !routeIds.has(id)), []);
});

test('teacher workflow entry points do not send an unbound user to a naked cards page', async () => {
  const app = await source(appPath);
  const guide = app.match(/function GuidancePage\(\)[\s\S]*?\n\}/u)?.[0] || '';
  const decision = app.slice(app.indexOf('function Decision()'), app.indexOf('function Unit()'));
  assert.doesNotMatch(guide, /href=["']\/cards\/["']/u);
  assert.doesNotMatch(decision, /href=["']\/cards\/["']/u);
  assert.match(guide, /继续追问并保存方案/u);
  assert.match(decision, /围绕示例开始备课/u);
});

test('ask and cards evidence links preserve their exact draft return path', async () => {
  const app = await source(appPath);
  assert.match(app, /const askReaderReturn = draftId \? `\/ask\/\?draftId=/u);
  assert.match(app, /const cardsReaderReturn = draftId \? `\/cards\/\?draftId=/u);
  assert.match(app, /TeachingEvidenceChain chain=\{teachingEvidenceChain\} returnTo=\{cardsReaderReturn\}/u);
  assert.match(app, /DualSourceEvidenceDesk[^\n]*returnTo=\{askReaderReturn\}/u);
  assert.doesNotMatch(app, /returnTo="cards"/u);
  assert.doesNotMatch(app, /&return=share/u);
  assert.match(app, /const shareReturnTo = `\/share\/#\$\{token\}`/u);
});

test('teacher-facing copy does not expose internal feature version numbers', async () => {
  const app = await source(appPath);
  assert.doesNotMatch(app, /活教参\s+\d+\.\d+\s*·/u);
});
