const { test, expect } = require('@playwright/test');

const oldTurn = { question: '《岳阳楼记》怎样备课？', response: { answer: { summary: '旧回答', lesson: { title: '岳阳楼记' } }, citations: [] } };
const newResponse = { answer: { summary: '新的朗读训练回答', lesson: { title: '岳阳楼记' } }, citations: [], evidenceSufficient: true };
const session = { user: { id: 'handoff-user' }, access_token: 'fixture-only' };

async function mockApi(page, { failSave = 0, savedTurns = [oldTurn] } = {}) {
  const calls = [];
  // The account read must reflect successful writes, just like the real API.
  // AskPage hydrates the new draft id immediately after the POST completes.
  let savedDraft = {
    id: 'saved', version: 1, title: '岳阳楼记', question: oldTurn.question, scope: ['textbook'],
    answer: { ...oldTurn.response.answer, conversationTurns: savedTurns }, lesson_context: {}, cards: [], citations: []
  };
  await page.route('**/api/**', async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (/\/ask$/.test(path)) {
      calls.push(req.postDataJSON());
      return route.fulfill({ json: newResponse });
    }
    if (path === '/api/config') return route.fulfill({ json: { gatewayConfigured: true, textModelConfigured: true } });
    if (/^\/api\/drafts(?:\/saved)?$/.test(path) && req.method() !== 'GET') {
      if (failSave) return route.fulfill({ status: failSave, json: { error: failSave === 401 ? 'auth_required' : 'save_failed' } });
      const body = req.postDataJSON();
      savedDraft = { ...savedDraft, ...body, id: 'saved', version: savedDraft.version + 1, lesson_context: body.lessonContext || savedDraft.lesson_context };
      return route.fulfill({ json: { draft: savedDraft } });
    }
    if (path === '/api/drafts/saved') return route.fulfill({ json: { draft: savedDraft } });
    return route.fulfill({ json: { keys: [], documents: [], drafts: [], profiles: [], results: [] } });
  });
  return calls;
}

async function seed(page, recovery, { loggedIn = true, failLocal = false } = {}) {
  await page.addInitScript(({ recovery, session, oldTurn, loggedIn, failLocal }) => {
    if (!sessionStorage.getItem('handoff-fixture-initialized')) {
      sessionStorage.setItem('handoff-fixture-initialized', '1');
      if (loggedIn) localStorage.setItem('huojiaocan.supabase.session', JSON.stringify(session));
      localStorage.setItem(`huojiaocan.ask.session.${loggedIn ? session.user.id : 'anonymous'}`, JSON.stringify({
        question: oldTurn.question, composerText: '旧缓存文字', messages: [oldTurn], savedAt: new Date().toISOString()
      }));
      if (recovery) sessionStorage.setItem('huojiaocan.auth.recovery', JSON.stringify({
        ownerUserId: session.user.id, planQuestion: oldTurn.question, messages: [oldTurn], savedAt: new Date().toISOString(), ...recovery
      }));
    }
    if (failLocal) {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key.startsWith('huojiaocan.ask.session.')) throw new DOMException('quota', 'QuotaExceededError');
        return original.call(this, key, value);
      };
    }
  }, { recovery, session, oldTurn, loggedIn, failLocal });
}

async function ready(page) {
  await expect(page.locator('form.ask-large button[type=submit]')).toHaveText('开始提问');
}

// Actual login link writes the handoff. Authentication itself is fixture-controlled.
test('login link keeps the unsent follow-up with existing answers and never sends it', async ({ page }) => {
  const calls = await mockApi(page);
  await seed(page, null, { loggedIn: false });
  await page.goto('/ask/');
  const composer = page.locator('form.ask-large textarea');
  await composer.fill('请增加朗读训练，还没有提交');
  await page.locator('.ask-auth-note').getByRole('link', { name: '立即登录', exact: true }).click();
  await expect(page).toHaveURL(/\/login\//);
  const next = await page.evaluate(session => {
    localStorage.setItem('huojiaocan.supabase.session', JSON.stringify(session));
    return JSON.parse(sessionStorage.getItem('huojiaocan.auth.recovery')).next;
  }, session);
  await page.goto(next);
  await ready(page);
  await expect(composer).toHaveValue('请增加朗读训练，还没有提交');
  await page.waitForTimeout(600);
  expect(calls).toHaveLength(0);
  await page.reload();
  await ready(page);
  await expect(composer).toHaveValue('请增加朗读训练，还没有提交');
  expect(calls).toHaveLength(0);
  await page.locator('form.ask-large button[type=submit]').click();
  await expect(page.getByRole('region', { name: '最新一轮问答' })).toContainText('新的朗读训练回答');
  expect(calls).toHaveLength(1);
  await page.reload();
  await ready(page);
  await expect(page.getByRole('region', { name: '最新一轮问答' })).toContainText('新的朗读训练回答');
  expect(calls).toHaveLength(1);
});

test('submitted unanswered handoff resumes exactly once, including after reload', async ({ page }) => {
  const calls = await mockApi(page);
  await seed(page, { next: '/ask/', question: '请增加朗读训练', resumeSubmittedQuestion: true });
  await page.goto('/ask/');
  await expect(page.getByRole('region', { name: '最新一轮问答' })).toContainText('新的朗读训练回答');
  await expect(page.locator('form.ask-large textarea')).toHaveValue('');
  expect(calls).toHaveLength(1);
  await page.reload();
  await ready(page);
  await page.waitForTimeout(600);
  expect(calls).toHaveLength(1);
});

for (const path of ['/ask/?new=1', '/ask/?draftId=saved']) {
  test(`answered handoff overrides stale URL action and old server turns: ${path}`, async ({ page }) => {
    const savedTurns = Array.from({ length: 12 }, (_, i) => ({ ...oldTurn, question: `此前问题 ${i}` }));
    const calls = await mockApi(page, { savedTurns });
    const next = `${path}&q=old-question`;
    await seed(page, {
      next, question: '', draftId: path.includes('draftId') ? 'saved' : '',
      resumeSubmittedQuestion: false, accountSaveFailed: true,
      messages: [...savedTurns.slice(1), { question: '请增加朗读训练', response: newResponse }]
    });
    await page.goto(next);
    await ready(page);
    await expect(page.getByRole('region', { name: '最新一轮问答' })).toContainText('新的朗读训练回答');
    await expect(page.locator('form.ask-large textarea')).toHaveValue('');
    await expect(page.getByRole('status')).toContainText('没有保存到账号');
    await page.waitForTimeout(600);
    expect(calls).toHaveLength(0);
    expect(new URL(page.url()).searchParams.has('q')).toBe(false);
    await page.reload();
    await ready(page);
    await expect(page.getByRole('region', { name: '最新一轮问答' })).toContainText('新的朗读训练回答');
    await expect(page.locator('form.ask-large textarea')).toHaveValue('');
    await page.waitForTimeout(600);
    expect(calls).toHaveLength(0);
  });
}

for (const failLocal of [false, true]) {
  test(`answer generated but server save fails; local failure=${failLocal}`, async ({ page }) => {
    const calls = await mockApi(page, { failSave: 500 });
    await seed(page, null, { failLocal });
    await page.goto('/ask/?new=1&q=请增加朗读训练');
    await expect(page.getByRole('status')).toContainText('回答已经生成');
    await expect(page.getByRole('region', { name: '最新一轮问答' })).toContainText('新的朗读训练回答');
    await expect(page.locator('form.ask-large textarea')).toHaveValue('');
    if (failLocal) {
      await expect(page.getByRole('alert')).toContainText('本机保存失败');
      await expect(page.locator('.conversation-persistence')).not.toContainText('已保存');
      await expect(page.locator('.conversation-persistence')).not.toContainText('已恢复');
    } else await expect(page.locator('.conversation-persistence')).toContainText('本机副本已保存');
    await page.reload();
    await ready(page);
    await page.waitForTimeout(600);
    expect(calls).toHaveLength(1);
  });
}

test('submit button hands off intent, then resumes after login only once', async ({ page }) => {
  const calls = await mockApi(page);
  await seed(page, null, { loggedIn: false });
  await page.goto('/ask/');
  await page.locator('form.ask-large textarea').fill('请增加朗读训练');
  await page.locator('form.ask-large button[type=submit]').click();
  await expect(page).toHaveURL(/\/login\//);
  const next = await page.evaluate(session => {
    localStorage.setItem('huojiaocan.supabase.session', JSON.stringify(session));
    const recovery = JSON.parse(sessionStorage.getItem('huojiaocan.auth.recovery'));
    if (!recovery.resumeSubmittedQuestion) throw new Error('Missing explicit submit intent');
    return recovery.next;
  }, session);
  expect(calls).toHaveLength(0);
  await page.goto(next);
  await expect(page.getByRole('region', { name: '最新一轮问答' })).toContainText('新的朗读训练回答');
  expect(calls).toHaveLength(1);
});

test('401 saving a generated answer hands off the result, never the model action', async ({ page }) => {
  const calls = await mockApi(page, { failSave: 401 });
  await seed(page, null);
  await page.goto('/ask/?new=1&q=请增加朗读训练');
  await expect(page).toHaveURL(/\/login\//);
  const recovery = await page.evaluate(session => {
    localStorage.setItem('huojiaocan.supabase.session', JSON.stringify(session));
    return JSON.parse(sessionStorage.getItem('huojiaocan.auth.recovery'));
  }, session);
  expect(recovery.resumeSubmittedQuestion).toBe(false);
  expect(recovery.question).toBe('');
  expect(recovery.pendingAction).toBeNull();
  expect(recovery.messages.at(-1).response.answer.summary).toBe('新的朗读训练回答');
  await page.goto(recovery.next);
  await ready(page);
  await expect(page.getByRole('region', { name: '最新一轮问答' })).toContainText('新的朗读训练回答');
  await expect(page.locator('form.ask-large textarea')).toHaveValue('');
  await page.reload();
  await ready(page);
  await expect(page.getByRole('region', { name: '最新一轮问答' })).toContainText('新的朗读训练回答');
  await page.waitForTimeout(600);
  expect(calls).toHaveLength(1);
});


test('failed account PATCH preserves the generated local answer through reload', async ({ page }) => {
  const calls = await mockApi(page, { failSave: 500 });
  await seed(page, null);
  await page.goto('/ask/?draftId=saved');
  await ready(page);
  await page.locator('form.ask-large textarea').fill('请增加朗读训练');
  await page.locator('form.ask-large button[type=submit]').click();
  await expect(page.getByRole('status')).toContainText('回答已经生成');
  await expect(page.getByRole('region', { name: '最新一轮问答' })).toContainText('新的朗读训练回答');
  await page.reload();
  await ready(page);
  await expect(page.getByRole('region', { name: '最新一轮问答' })).toContainText('新的朗读训练回答');
  await expect(page.locator('form.ask-large textarea')).toHaveValue('');
  await expect(page.getByRole('status')).toContainText('没有保存到账号');
  await page.waitForTimeout(600);
  expect(calls).toHaveLength(1);
});
