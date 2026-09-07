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
async function openCards(page, fixture = draftFixture()) {
  let draft = fixture;
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
  await editor(page).fill('锁定失败仍保留的修改');
  await page.getByRole('button', { name: '锁定本卡', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '锁定“板书卡”？' });
  await dialog.getByRole('button', { name: '确认锁定', exact: true }).dblclick();
  try {
    await expect(page.getByRole('button', { name: '锁定中…', exact: true })).toBeDisabled();
    await page.locator('.card-editor').screenshot({ path: testInfo.outputPath('lock-pending.png') });
    await expect(editor(page)).toBeDisabled();
    await expect(page.getByRole('button', { name: /补全本卡|重新生成本卡/ })).toBeDisabled();
  } finally { release(); }
  await expect(dialog.getByRole('alert')).toContainText('编辑内容仍保留');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('button', { name: '锁定本卡', exact: true })).toBeEnabled();
  await expect(editor(page)).toBeEnabled();
  await expect(editor(page)).toHaveValue('锁定失败仍保留的修改');
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

test('lock cancel and Escape write nothing, preserve edits and restore keyboard focus', async ({ page }, testInfo) => {
  await openCards(page);
  let writes = 0;
  page.on('request', request => { if (request.url().includes('/api/') && request.method() !== 'GET') writes++; });
  page.on('dialog', dialog => { throw new Error(`Unexpected native dialog: ${dialog.type()}`); });
  await editor(page).fill('取消锁定不应写入');
  const trigger = page.getByRole('button', { name: '锁定本卡', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '锁定“板书卡”？' });
  const cancel = dialog.getByRole('button', { name: '取消', exact: true });
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: '确认锁定', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(cancel).toBeFocused();
  await dialog.screenshot({ path: testInfo.outputPath('lock-confirmation.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await cancel.click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(editor(page)).toHaveValue('取消锁定不应写入');
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(writes).toBe(0);
  await expect(page.locator('.card-actions')).toContainText('有未保存修改');
});

test('lock prerequisite failure keeps edits; retry locks once with saved version and protects the card', async ({ page }) => {
  const state = await openCards(page);
  let locks = 0;
  await page.route('**/cards/board/lock', async route => {
    locks++;
    expect(route.request().postDataJSON().version).toBe(2);
    const draft = { ...state.getDraft(), version: 3, cards: state.getDraft().cards.map(card => card.id === 'board' ? { ...card, status: 'locked' } : card) };
    state.setDraft(draft);
    await route.fulfill({ json: { draft } });
  });
  await page.route('**/api/drafts/cards-editing/cards', route => route.fulfill({ status: 503, json: { error: 'service_unavailable' } }), { times: 1 });
  await editor(page).fill('确认锁定的教师修改');
  await page.getByRole('button', { name: '锁定本卡', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '锁定“板书卡”？' });
  await dialog.getByRole('button', { name: '确认锁定', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('编辑内容仍保留');
  expect(locks).toBe(0);
  await expect(editor(page)).toHaveValue('确认锁定的教师修改');
  await expect(page.locator('.card-actions')).toContainText('有未保存修改');
  await dialog.getByRole('button', { name: '确认锁定', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('当前卡已锁定')).toBeVisible();
  await expect(editor(page)).toBeDisabled();
  await expect(editor(page)).toHaveValue('确认锁定的教师修改');
  await expect(page.getByRole('button', { name: /补全本卡|重新生成本卡/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '复制为新版本', exact: true })).toBeEnabled();
  expect(locks).toBe(1);
  expect(state.errors).toEqual([]);
});

test('neutral board preserves order, five stages and 320-wide nonoverlapping leaves', async ({ page }, testInfo) => {
  const fixture = draftFixture();
  fixture.answer.lesson = { coreQuestion: '阴晴两景如何衬托古仁人之心？' };
  fixture.cards[0].items = Array.from({ length: 9 }, (_, index) => ({ id: `b${index}`, text: ['阴景与悲情', '晴景与喜情', '古仁人之心', '进亦忧', '退亦忧', '不以物喜', '不以己悲', '先忧后乐', '讨论尚待完成'][index], citationIds: [`E${index}`] }));
  await openCards(page, fixture);
  const board = page.locator('.board-preview-canvas .board-map');
  await expect(board.locator('.board-map-core-prompt')).toHaveText('阴晴两景如何衬托古仁人之心？');
  await expect(board.locator('.board-map-leaf')).toHaveCount(0);
  const stages = page.locator('.board-step-tabs button');
  await expect(stages).toHaveCount(5);
  await stages.nth(1).click();
  await expect(board.locator('.board-map-branch-label')).toHaveText(['落笔 1、2、3', '落笔 4、5、6', '落笔 7、8、9']);
  await expect(board.locator('.board-map-leaf')).toHaveCount(0);
  await stages.nth(2).click();
  await expect(board.locator('.board-map-leaf')).toHaveCount(9);
  await expect(board.locator('.board-map-conclusion')).toHaveCount(0);
  await stages.nth(3).click();
  await expect(board.locator('.board-map-conclusion')).toHaveText('课堂归纳：________');
  await stages.nth(4).click();
  await expect(board.locator('.board-map-blanks')).toBeVisible();
  const boxes = await board.locator('.board-map-leaf > rect').evaluateAll(nodes => nodes.map(node => ({ x: +node.getAttribute('x'), y: +node.getAttribute('y'), w: +node.getAttribute('width'), h: +node.getAttribute('height') })));
  for (const [i, box] of boxes.entries()) {
    expect(box.w).toBe(320);
    expect(box.y + box.h).toBeLessThan(635);
    for (const other of boxes.slice(i + 1)) expect(Math.abs(box.x - other.x) >= 336 || Math.abs(box.y - other.y) >= 74).toBe(true);
  }
  await page.getByRole('button', { name: '查看落笔排练', exact: true }).click();
  await expect(page.locator('.board-writing-steps article').nth(1)).toContainText('落笔 1、2、3');
  await expect(page.locator('.board-writing-steps article').nth(3)).toContainText('归纳：________');
  await board.screenshot({ path: testInfo.outputPath('neutral-board-five-stages.png') });
});

test('saved boardPlan survives edits; preview and classroom use the same groups and question', async ({ page }, testInfo) => {
  const fixture = draftFixture();
  const items = [{ id: 'scene', text: '阴晴两景', citationIds: ['E1'] }, { id: 'heart', text: '古仁人之心', citationIds: ['E2'] }];
  const boardPlan = { coreQuestion: '作者如何从阴晴两景转入古仁人之心？', branches: [{ title: '价值判断', nodes: [items[1]] }, { title: '景情对照', nodes: [items[0]] }], conclusion: '超越个人悲喜' };
  fixture.cards[0] = { ...fixture.cards[0], items, boardPlan };
  const state = await openCards(page, fixture);
  await editor(page).fill('阴晴两景与悲喜');
  await nextButton(page).click();
  expect(state.getDraft().cards[0].boardPlan).toEqual(boardPlan);
  expect(state.getDraft().cards[0].items[0].citationIds).toEqual(['E1']);
  const board = page.locator('.board-preview-canvas .board-map');
  await page.locator('.board-step-tabs button').nth(4).click();
  await expect(board.locator('.board-map-branch-label')).toHaveText(['价值判断', '景情对照']);
  await expect(board.locator('.board-map-leaf-label')).toHaveText(['古仁人之心', '阴晴两景与悲喜']);
  expect(await board.locator('.board-map-leaf').evaluateAll(nodes => nodes.map(node => node.dataset.itemId))).toEqual(['heart', 'scene']);
  await expect(board.locator('.board-map-conclusion')).toHaveText('课堂归纳：超越个人悲喜');
  state.setDraft({ ...state.getDraft(), cards: state.getDraft().cards.map(card => ({ ...card, status: 'locked' })) });
  await page.reload();
  await page.getByRole('button', { name: '开始上课并记录', exact: true }).first().click();
  const classroom = page.getByRole('dialog', { name: '课堂共创记录' });
  await expect(classroom.locator('.board-map-core-prompt')).toHaveText(boardPlan.coreQuestion);
  await classroom.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(classroom.locator('.board-map-branch-label')).toHaveText(['价值判断', '景情对照']);
  await classroom.locator('.board-map').screenshot({ path: testInfo.outputPath('planned-board-classroom.png') });
  expect(state.errors).toEqual([]);
});
