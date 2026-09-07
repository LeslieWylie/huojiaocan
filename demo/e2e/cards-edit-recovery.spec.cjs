const { test, expect } = require('@playwright/test');

// Isolated browser regressions: actual Cards UI, deterministic draft API failures/delays.
function draftFixture() {
  return {
    id: 'cards-editing', title: '岳阳楼记', question: '怎样理解忧乐观？', version: 1,
    answer: { summary: '回到原文说明忧乐观', objectives: ['引用原文'], keyPoints: ['忧乐观'],
      planApproval: { status: 'confirmed', hasUnconfirmedChanges: false } },
    citations: [], cards: ['board', 'question', 'assessment'].map((type, index) => ({
      id: type, type, title: ['板书卡', '提问卡', '评价卡'][index], status: 'draft',
      items: [{ id: `${type}-1`, text: `原始${type}内容`, citationIds: [] }]
    }))
  };
}
async function openCards(page) {
  let draft = draftFixture();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !/Failed to load resource:.*503/.test(message.text())) errors.push(message.text());
  });
  await page.addInitScript(() => localStorage.setItem('huojiaocan.supabase.session', JSON.stringify({
    user: { id: 'cards-editor-test' }, access_token: 'local-fixture-not-a-credential'
  })));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/drafts/cards-editing') return route.fulfill({ json: { draft } });
    if (url.pathname === '/api/drafts/cards-editing/cards') {
      const body = route.request().postDataJSON();
      draft = { ...draft, cards: body.cards, version: draft.version + 1 };
      return route.fulfill({ json: { draft } });
    }
    return route.fulfill({ json: { profiles: [], documents: [], configured: false } });
  });
  await page.goto('/cards/?draftId=cards-editing');
  await expect(page.locator('.card-editor textarea').first()).toBeVisible();
  return { errors, getDraft: () => draft, setDraft: next => { draft = next; } };
}
const editor = page => page.locator('.card-editor textarea').first();
const nextButton = page => page.getByRole('button', { name: '保存并查看下一张', exact: true });
const choose = (page, type) => page.locator(`.card-nav-${type}`).click();

test('switching cards preserves edits; failed save stays put, explains failure and can retry', async ({ page }, testInfo) => {
  const state = await openCards(page);
  await editor(page).fill('未保存板书');
  await choose(page, 'question');
  await editor(page).fill('未保存提问');
  await choose(page, 'board');
  await expect(editor(page)).toHaveValue('未保存板书');
  await page.route('**/api/drafts/cards-editing/cards', route => route.fulfill({ status: 503, json: { error: 'service_unavailable' } }), { times: 1 });
  await nextButton(page).click();
  await expect(page.locator('.card-editor [role="alert"]')).toContainText('未保存');
  await page.screenshot({ path: testInfo.outputPath('desktop-save-failed-viewport.png'), fullPage: false });
  await page.locator('.card-editor-layout').screenshot({ path: testInfo.outputPath('desktop-save-failed.png') });
  await expect(editor(page)).toHaveValue('未保存板书');
  await nextButton(page).click();
  await expect(editor(page)).toHaveValue('未保存提问');
  expect(state.getDraft().cards[0].items[0].text).toBe('未保存板书');
  expect(state.errors).toEqual([]);
});

test('pending save freezes editing and switching, then advances from the saved card only once', async ({ page }) => {
  const state = await openCards(page);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/drafts/cards-editing/cards', async route => {
    await gate;
    const body = route.request().postDataJSON();
    await route.fulfill({ json: { draft: { ...state.getDraft(), cards: body.cards, version: 2 } } });
  });
  await editor(page).fill('保存快照');
  await nextButton(page).click();
  try {
    await expect(editor(page)).toBeDisabled();
    await expect(page.locator('.card-nav-question')).toBeDisabled();
    await expect(page.getByRole('button', { name: '锁定本卡', exact: true })).toBeDisabled();
  } finally { release(); }
  await expect(editor(page)).toHaveValue('原始question内容');
  await choose(page, 'board');
  await expect(editor(page)).toHaveValue('保存快照');
  expect(state.errors).toEqual([]);
});

test('lock has pending feedback, prevents concurrent actions and recovers after failure', async ({ page }, testInfo) => {
  const state = await openCards(page);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let requests = 0;
  await page.route('**/cards/board/lock', async route => {
    requests++;
    await gate;
    await route.fulfill({ status: 503, json: { error: 'service_unavailable' } });
  });
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '锁定本卡', exact: true }).click();
  try {
    await expect(page.getByRole('button', { name: '锁定中…', exact: true })).toBeDisabled();
    await page.locator('.card-editor').screenshot({ path: testInfo.outputPath('lock-pending.png') });
    await expect(editor(page)).toBeDisabled();
    await expect(page.getByRole('button', { name: /补全本卡|重新生成本卡/ })).toBeDisabled();
  } finally { release(); }
  await expect(page.getByRole('button', { name: '锁定本卡', exact: true })).toBeEnabled();
  await expect(editor(page)).toBeEnabled();
  expect(requests).toBe(1);
  expect(state.errors).toEqual([]);
});

test('regeneration is busy during its prerequisite save and does not run after save failure', async ({ page }) => {
  await openCards(page);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let generated = 0;
  await page.route('**/cards/board/regenerate', route => { generated++; return route.fulfill({ json: {} }); });
  await page.route('**/api/drafts/cards-editing/cards', async route => {
    await gate;
    await route.fulfill({ status: 503, json: { error: 'service_unavailable' } });
  });
  await editor(page).fill('生成前保留的手改');
  await page.getByRole('button', { name: /补全本卡|重新生成本卡/ }).click();
  try {
    await expect(page.getByRole('button', { name: '正在依据中生成', exact: true })).toBeDisabled();
    await expect(editor(page)).toBeDisabled();
  } finally { release(); }
  await expect(editor(page)).toBeEnabled();
  await expect(editor(page)).toHaveValue('生成前保留的手改');
  expect(generated).toBe(0);
});

test('unsaved edits warn on leave and recover even when the server load succeeds', async ({ page }) => {
  await openCards(page);
  await editor(page).fill('离页前未保存的内容');
  // Synthetic cancelable event checks registration without dismissing a native dialog.
  expect(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true);
  page.once('dialog', dialog => dialog.accept());
  await page.reload();
  await expect(editor(page)).toHaveValue('离页前未保存的内容');
  await expect(page.locator('.card-actions')).toContainText('有未保存修改');
});

test('failed load reads the account-scoped recovery cache rather than losing the editor', async ({ page }) => {
  const state = await openCards(page);
  await editor(page).fill('断网恢复内容');
  await page.route('**/api/drafts/cards-editing', route => route.fulfill({ status: 503, json: { error: 'service_unavailable' } }));
  page.once('dialog', dialog => dialog.accept());
  await page.reload();
  await expect(editor(page)).toHaveValue('断网恢复内容');
  await expect(page.locator('.card-actions')).toContainText('有未保存修改');
  expect(state.errors).toEqual([]);
});

test('plan and cards dirty together save, confirm and generate against each returned version', async ({ page }) => {
  const state = await openCards(page);
  const versions = [];
  await page.route(/\/api\/drafts\/cards-editing(?:\/|$)/, async route => {
    if (route.request().method() === 'GET') return route.fallback();
    const path = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON();
    const base = state.getDraft();
    versions.push([path.split('/').pop(), body.version]);
    expect(body.version).toBe(base.version);
    let draft = { ...base, version: base.version + 1 };
    if (path.endsWith('/cards')) draft.cards = body.cards;
    else if (route.request().method() === 'PATCH') draft = { ...draft, ...body, version: base.version + 1, answer: { ...body.answer, planApproval: { status: 'changes_pending', hasUnconfirmedChanges: true } } };
    else if (path.endsWith('/confirm')) draft.answer = { ...draft.answer, planApproval: { status: 'confirmed', hasUnconfirmedChanges: false } };
    state.setDraft(draft);
    await route.fulfill({ json: { draft } });
  });
  await editor(page).fill('三卡和方案一起保存');
  await page.getByRole('button', { name: '修改已确认方案', exact: true }).click();
  await page.locator('#teacher-plan-editor').getByRole('textbox', { name: '课堂主线', exact: true }).fill('同时修改的课堂主线');
  await page.locator('#teacher-plan-editor').getByRole('button', { name: /重新生成.*三卡/ }).click();
  await expect(page.locator('.card-generation-progress')).toHaveCount(0);
  await expect(page.getByText('三卡已保存：系统已完成初稿与教材依据、课堂可用性审校。')).toBeVisible();
  expect(versions).toEqual([['cards', 1], ['cards-editing', 2], ['confirm', 3], ['generate', 4]]);
  expect(state.getDraft().cards[0].items[0].text).toBe('三卡和方案一起保存');
  expect(state.getDraft().answer.summary).toBe('同时修改的课堂主线');
  expect(state.errors).toEqual([]);
});

test('account changes never copy prior editor state into the next recovery scope', async ({ page }) => {
  const state = await openCards(page);
  await editor(page).fill('仅属于原账号的未保存内容');
  await page.evaluate(() => {
    localStorage.setItem('huojiaocan.supabase.session', JSON.stringify({ user: { id: 'second-editor' }, access_token: 'second-local-fixture' }));
    window.dispatchEvent(new Event('huojiaocan:auth-change'));
  });
  await expect(editor(page)).toHaveValue('原始board内容');
  const caches = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.includes('second-editor')));
  expect(caches.some(([, value]) => value.includes('仅属于原账号'))).toBe(false);
  await page.evaluate(() => {
    localStorage.setItem('huojiaocan.supabase.session', JSON.stringify({ user: { id: 'cards-editor-test' }, access_token: 'local-fixture-not-a-credential' }));
    window.dispatchEvent(new Event('huojiaocan:auth-change'));
  });
  await expect(editor(page)).toHaveValue('仅属于原账号的未保存内容');
  expect(state.errors).toEqual([]);
});

test('a late save response cannot overwrite the next account editor or cache', async ({ page }) => {
  const state = await openCards(page);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/drafts/cards-editing/cards', async route => {
    await gate;
    await route.fulfill({ json: { draft: { ...state.getDraft(), cards: route.request().postDataJSON().cards, version: 2 } } });
  });
  await editor(page).fill('原账号保存中的内容');
  await nextButton(page).click();
  await expect(editor(page)).toBeDisabled();
  await page.evaluate(() => {
    localStorage.setItem('huojiaocan.supabase.session', JSON.stringify({ user: { id: 'second-editor' }, access_token: 'second-local-fixture' }));
    window.dispatchEvent(new Event('huojiaocan:auth-change'));
  });
  await expect(editor(page)).toHaveValue('原始board内容');
  const response = page.waitForResponse('**/api/drafts/cards-editing/cards');
  release(); await response;
  await expect(editor(page)).toHaveValue('原始board内容');
  await expect(editor(page)).toBeEnabled();
  expect(await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.includes('second-editor')).some(([, value]) => value.includes('原账号保存中的内容')))).toBe(false);
});

test('different server version requires an explicit recovery choice and preserves server locks', async ({ page }, testInfo) => {
  const state = await openCards(page);
  await editor(page).fill('本机板书修改');
  await choose(page, 'question');
  await editor(page).fill('本机提问修改');
  state.setDraft({ ...state.getDraft(), version: 2, cards: state.getDraft().cards.map(card => card.type === 'board' ? { ...card, status: 'locked' } : card) });
  page.once('dialog', dialog => dialog.accept());
  await page.reload();
  await expect(page.getByText('账号版本已更新，本机还有未保存修改')).toBeVisible();
  await page.locator('.cards-edit-recovery').screenshot({ path: testInfo.outputPath('version-recovery-choice.png') });
  await page.getByRole('button', { name: '保留本机修改（待保存）', exact: true }).click();
  await expect(editor(page)).toHaveValue('原始board内容');
  await expect(editor(page)).toBeDisabled();
  await choose(page, 'question');
  await expect(editor(page)).toHaveValue('本机提问修改');
  await expect(editor(page)).toBeEnabled();
  await nextButton(page).click();
  expect(state.getDraft().version).toBe(3);
  expect(state.getDraft().cards[0].status).toBe('locked');
  expect(state.getDraft().cards[1].items[0].text).toBe('本机提问修改');
  await expect(page.locator('.card-actions')).toContainText('内容已保存');
  await expect.poll(() => page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(false);
});

test('generation keeps controls busy until the actual result arrives and failure leaves saved text intact', async ({ page }) => {
  const state = await openCards(page);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/cards/board/regenerate', async route => {
    await gate;
    await route.fulfill({ status: 503, json: { error: 'card_generation_failed' } });
  });
  await editor(page).fill('已保存的教师手改');
  await page.getByRole('button', { name: /补全本卡|重新生成本卡/ }).click();
  try {
    await expect(page.getByRole('button', { name: '正在依据中生成', exact: true })).toBeDisabled();
    await expect(page.locator('.card-nav-question')).toBeDisabled();
  } finally { release(); }
  await expect(editor(page)).toBeEnabled();
  await expect(editor(page)).toHaveValue('已保存的教师手改');
  expect(state.getDraft().cards[0].items[0].text).toBe('已保存的教师手改');
});

test('mobile editor shows failed-save recovery in place without horizontal overflow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCards(page);
  await editor(page).fill('移动端保存失败后仍然保留的教师修改');
  await page.route('**/api/drafts/cards-editing/cards', route => route.fulfill({ status: 503, json: { error: 'service_unavailable' } }));
  await nextButton(page).click();
  await expect(page.locator('.card-editor [role="alert"]')).toContainText('尚未保存');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile-save-failed-viewport.png'), fullPage: false });
  await page.locator('.card-editor').screenshot({ path: testInfo.outputPath('mobile-save-failed.png') });
});
