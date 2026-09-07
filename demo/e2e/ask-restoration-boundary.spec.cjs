const { test, expect } = require('@playwright/test');

for (const target of ['saved', 'local']) {
  test(`restoring ${target} conversation never submits an unsent scratch question`, async ({ page }) => {
    const calls = [];
    await page.addInitScript(() => {
      localStorage.setItem('huojiaocan.supabase.session', JSON.stringify({ user: { id: 'restore-user' }, access_token: 'fixture-only' }));
      if (!localStorage.getItem('huojiaocan.ask.session.restore-user')) localStorage.setItem('huojiaocan.ask.session.restore-user', JSON.stringify({
        question: '未发送的新课输入', draftId: '', savedAt: new Date().toISOString(), messages: [], conversationHistory: []
      }));
    });
    const response = { summary: '比较迁客骚人与古仁人的忧乐', lesson: { title: '岳阳楼记' }, citations: [] };
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (/\/ask$/.test(path)) { calls.push(route.request().postData()); return route.fulfill({ json: response }); }
      if (path === '/api/config') return route.fulfill({ json: { gatewayConfigured: true, textModelConfigured: true } });
      if (path === '/api/drafts/saved') return route.fulfill({ json: { draft: {
        id: 'saved', version: 1, title: '岳阳楼记', question: '改成两课时', scope: ['textbook'],
        lesson_context: {},
        answer: { ...response, conversationTurns: [{ question: '《岳阳楼记》怎样备课？', response }] }, cards: [], citations: []
      } } });
      return route.fulfill({ json: { keys: [], documents: [], drafts: [], profiles: [], results: [] } });
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!attempt) await page.goto(target === 'saved' ? '/ask/?draftId=saved' : '/ask/');
      else await page.reload();
      const composer = page.locator('form.ask-large textarea');
      await expect(page.locator('form.ask-large').getByRole('button', { name: '开始提问', exact: true })).toBeVisible();
      if (target === 'saved') {
        await expect(page.getByRole('region', { name: '最新一轮问答' })).toContainText('《岳阳楼记》怎样备课？');
        await expect(composer).toHaveValue('');
        await expect(page.getByLabel('当前备课范围')).toContainText('岳阳楼记');
        await expect(page.getByLabel('当前备课范围')).not.toContainText('改成两课时');
        await expect(page.locator('main')).not.toContainText('未发送的新课输入');
      } else await expect(composer).toHaveValue('未发送的新课输入');
      // Let readiness, restoration and debounced persistence effects settle.
      await page.waitForTimeout(1200);
      expect(calls).toEqual([]);
    }
    if (target === 'saved') {
      const composer = page.locator('form.ask-large textarea');
      await composer.fill('请增加朗读训练，这句话还未发送');
      await page.reload();
      await expect(composer).toHaveValue('请增加朗读训练，这句话还未发送');
      await expect(page.getByLabel('当前备课范围')).toContainText('岳阳楼记');
      await page.waitForTimeout(1200);
      expect(calls).toEqual([]);
      await page.goto('/ask/?draftId=saved&doc=textbook&lesson=岳阳楼记');
      await expect(composer).toHaveValue('请增加朗读训练，这句话还未发送');
      expect(calls).toEqual([]);
      await composer.fill('');
      await page.reload();
      await expect(composer).toHaveValue('');
      expect(calls).toEqual([]);
    }
  });
}
