const { test, expect } = require('@playwright/test');

function fixture(status = 'draft', run = {}) {
  return {
    id: 'button-loop', title: '岳阳楼记', question: '怎样理解忧乐观？', version: 1,
    answer: { summary: '回到原文理解忧乐观', objectives: ['引用原文'], keyPoints: ['忧乐观'],
      planApproval: { status: 'confirmed', hasUnconfirmedChanges: false }, classroomRun: run },
    citations: [], cards: ['board', 'question', 'assessment'].map((type, index) => ({
      id: type, type, title: ['板书卡', '提问卡', '评价卡'][index], status,
      items: [{ id: `${type}-1`, text: '引用原文说明人物的忧乐观', citationIds: [] }]
    }))
  };
}
async function open(page, draft = fixture(), query = '') {
  const writes = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('huojiaocan.supabase.session', JSON.stringify({
    user: { id: 'button-loop-user' }, access_token: 'local-fixture-not-a-credential'
  })));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/drafts/button-loop/classroom-run') {
      const body = route.request().postDataJSON(); writes.push(body);
      draft = { ...draft, version: draft.version + 1, answer: { ...draft.answer, classroomRun: body } };
      return route.fulfill({ json: { draft } });
    }
    if (path === '/api/drafts/button-loop') return route.fulfill({ json: { draft } });
    return route.fulfill({ json: { profiles: [], documents: [], configured: false } });
  });
  await page.goto(`/cards/?draftId=button-loop${query}`);
  await expect(page.locator(draft.cards.length ? '#board-preview' : '#teacher-plan-editor')).toBeVisible();
  return { writes, errors };
}
const entry = page => page.locator('.board-preview-footer > button');
const classroom = page => page.getByRole('dialog', { name: '课堂共创记录' });
const step = (page, number) => expect(classroom(page).locator('.blackboard-topline')).toContainText(`第 ${number} / 5 步`);

test('both continuation buttons lead to the unlocked card, without starting a classroom', async ({ page }) => {
  const draft = fixture(); draft.cards[0].status = 'locked';
  const state = await open(page, draft);
  for (const button of [entry(page), page.locator('.hero-actions > button.primary')]) {
    await expect(button).toHaveText('继续：检查并锁定三卡');
    await expect(button).toBeEnabled();
    await button.click();
    await expect(page.locator('.card-nav-question')).toHaveClass(/active/);
    await expect(page.locator('#card-workspace')).toBeInViewport();
  }
  await expect(classroom(page)).toHaveCount(0);
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});

test('preview all five steps, start at classroom stage one, navigate, exit and resume', async ({ page }, testInfo) => {
  const state = await open(page, fixture('locked'));
  for (let i = 0; i < 5; i++) {
    const tab = page.locator('.board-step-tabs button').nth(i);
    await tab.click();
    await expect(tab).toHaveAttribute('aria-current', 'step');
    await expect(page.locator('.board-preview-step b')).toHaveText(`0${i + 1}`);
  }
  await entry(page).click();
  await step(page, 1);
  await expect(classroom(page).getByRole('button', { name: '上一步', exact: true })).toBeDisabled();
  await expect(classroom(page).getByRole('button', { name: '恢复初始' })).toBeDisabled();
  for (let i = 2; i <= 5; i++) {
    await classroom(page).getByRole('button', { name: '下一步', exact: true }).click();
    await step(page, i);
  }
  await expect(classroom(page).getByRole('button', { name: '已到最后一步' })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('classroom-stage-five.png'), fullPage: true });
  await classroom(page).getByRole('button', { name: '上一步', exact: true }).click();
  await step(page, 4);
  await classroom(page).getByRole('button', { name: '恢复初始' }).click();
  await step(page, 1);
  await classroom(page).getByRole('button', { name: '下一步', exact: true }).click();
  await classroom(page).getByRole('button', { name: '关闭课堂模式' }).click();
  await expect(classroom(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/classroom=1/);
  await expect(entry(page)).toBeFocused();
  expect(state.writes.at(-1).currentStage).toBe(2);
  await entry(page).click();
  await step(page, 2);
  // Enter/resume renders the stage before its save settles. Keyboard events do
  // not auto-wait for disabled controls as locator.click does.
  await expect(classroom(page).getByRole('button', { name: '关闭课堂模式' })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(classroom(page)).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test('saving freezes stage and close controls; failed exit retains the classroom and retries', async ({ page }) => {
  const state = await open(page, fixture('locked'));
  await entry(page).click();
  await expect(classroom(page).getByRole('button', { name: '关闭课堂模式' })).toBeEnabled();
  await classroom(page).getByRole('button', { name: '下一步', exact: true }).click();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/classroom-run', async route => {
    await gate;
    await route.fulfill({ status: 503, json: { error: 'service_unavailable' } });
  }, { times: 1 });
  await classroom(page).getByRole('button', { name: '关闭课堂模式' }).click();
  try {
    await expect(classroom(page).getByRole('button', { name: '下一步', exact: true })).toBeDisabled();
    await expect(classroom(page).getByRole('button', { name: '关闭课堂模式' })).toBeDisabled();
    await expect(classroom(page).getByRole('button', { name: '学生已经说出' })).toBeDisabled();
  } finally { release(); }
  await expect(classroom(page).getByRole('button', { name: '关闭课堂模式' })).toBeEnabled();
  await step(page, 2);
  await expect(page).toHaveURL(/classroom=1/);
  await classroom(page).getByRole('button', { name: '关闭课堂模式' }).click();
  await expect(classroom(page)).toHaveCount(0);
  expect(state.writes.at(-1).currentStage).toBe(2);
});

test('confirmed classroom permits five-stage review without mutating the saved record', async ({ page }) => {
  const state = await open(page, fixture('locked', { status: 'confirmed', currentStage: 1 }));
  await expect(entry(page)).toHaveText('查看课堂记录');
  await entry(page).click();
  for (let i = 2; i <= 5; i++) {
    await classroom(page).getByRole('button', { name: '下一步', exact: true }).click();
    await step(page, i);
  }
  await expect(classroom(page).getByRole('button', { name: '学生已经说出' })).toBeDisabled();
  await expect(classroom(page).getByRole('button', { name: '保存现场记录' })).toBeDisabled();
  await expect(classroom(page).getByRole('button', { name: '结束并整理复盘' })).toHaveCount(0);
  await classroom(page).getByRole('button', { name: '关闭课堂模式' }).click();
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});

test('classroom URL cannot bypass unlocked cards; incomplete locked cards return to editing', async ({ page }) => {
  const state = await open(page, fixture(), '&classroom=1');
  await expect(classroom(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/classroom=1/);
  expect(state.writes).toEqual([]);
  const incomplete = fixture('locked'); incomplete.cards = incomplete.cards.slice(0, 1);
  await open(page, incomplete);
  await expect(entry(page)).toHaveText('继续：检查并补全三卡');
  await entry(page).click();
  await expect(page.locator('#card-workspace')).toBeInViewport();
  await expect(classroom(page)).toHaveCount(0);
});

test('ending classroom saves pending review before navigating', async ({ page }) => {
  const state = await open(page, fixture('locked'));
  await entry(page).click();
  page.on('dialog', dialog => dialog.accept());
  await classroom(page).getByRole('button', { name: '结束并整理复盘' }).click();
  await expect(page).toHaveURL(/\/reflection\/\?draftId=button-loop/);
  expect(state.writes.at(-1).status).toBe('pending_review');
});

test('unsaved plan returns to confirmation instead of entering with locked cards', async ({ page }) => {
  const state = await open(page, fixture('locked'));
  await page.getByRole('button', { name: '修改已确认方案', exact: true }).click();
  await page.locator('#teacher-plan-editor').getByRole('textbox', { name: '课堂主线', exact: true }).fill('需要重新确认的主线');
  await expect(entry(page)).toHaveText('继续：核对并生成三卡');
  await entry(page).click();
  await expect(page.locator('#teacher-plan-editor')).toBeInViewport();
  await expect(classroom(page)).toHaveCount(0);
  expect(state.writes).toEqual([]);
});

for (const selection of ['own-connection-id', '', null]) {
  test(`both card-generation paths use current account selection (${JSON.stringify(selection)}), never legacy selection`, async ({ page }) => {
    await page.addInitScript(selection => {
      sessionStorage.setItem('activeDeepSeekKeyId', 'other-account-legacy-id');
      localStorage.setItem('huojiaocan.ai.selection.other-user', JSON.stringify({ owner: 'other-user', keyId: 'other-account-id' }));
      if (selection !== null) localStorage.setItem('huojiaocan.ai.selection.button-loop-user', JSON.stringify({ owner: 'button-loop-user', keyId: selection }));
    }, selection);
    const draft = fixture(); draft.cards = [];
    await open(page, draft);
    const requests = [];
    await page.route(/\/cards\/(generate|board\/regenerate)$/, route => {
      requests.push(route.request().postDataJSON());
      return route.fulfill({ json: { draft: { ...fixture(), version: requests.length + 1 }, generations: [] } });
    });
    await page.locator('#teacher-plan-editor').getByRole('button', { name: '生成板书与三卡', exact: true }).click();
    await expect(page.locator('.card-editor textarea').first()).toBeVisible();
    await page.getByRole('button', { name: /补全本卡|重新生成本卡/ }).click();
    await expect.poll(() => requests.length).toBe(2);
    expect(requests.map(body => body.keyId || '')).toEqual([selection || '', selection || '']);
  });
}
