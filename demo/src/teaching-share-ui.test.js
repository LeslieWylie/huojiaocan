import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
import { appSource as app } from './test-app-source.js';
const vite = fs.readFileSync(path.resolve(here, '../vite.config.js'), 'utf8');
const vercel = fs.readFileSync(path.resolve(here, '../vercel.json'), 'utf8');

test('the immutable teaching-share flow is reachable from classroom design and assets', () => {
  assert.match(app, /function TeachingSharePage\(/u);
  assert.match(app, /\/share\/\?draftId=/u);
  assert.match(app, /\/api\/shares\/resolve/u);
  assert.match(app, /发布共备快照/u);
  assert.match(app, /账号信息、历史对话、私人教材和连接信息不会进入分享内容/u);
  assert.match(vite, /share: page\('\.\/share\/index\.html'\)/u);
  assert.match(vercel, /\/api\/shares\/:path\*/u);
});

test('the public viewer resolves a fragment token without placing it in an API URL', () => {
  assert.match(app, /location\.hash/u);
  assert.match(app, /rootRequest\('\/api\/shares\/resolve', \{ method: 'POST', body: \{ token \} \}\)/u);
  assert.doesNotMatch(app, /\/api\/shares\/resolve\?token=/u);
});
