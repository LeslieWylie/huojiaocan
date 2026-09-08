const { test, expect } = require('./fixtures.cjs');

function legacyDraft() {
  return {
    title: '《岳阳楼记》', question: '如何理解先忧后乐？',
    answer: { lesson: { title: '《岳阳楼记》', coreQuestion: '作者如何由写景走向价值判断？' }, objectives: ['比较阴晴两景'], planApproval: { status: 'confirmed', hasUnconfirmedChanges: false, confirmedAt: '2026-09-08T00:00:00Z' } },
    citations: [{ id: 'E1', documentId: 'textbook', pdfPage: 56 }, { id: 'E2', documentId: 'teacher-guide', pdfPage: 224 }],
    cards: [
      { type: 'board', items: [{ text: '景—情—志', citationIds: ['E1', 'E2'] }] },
      { type: 'question', items: [{ text: '两种景怎样影响情感？', citationIds: ['E1', 'E2'] }] },
      { type: 'assessment', items: [{ text: '引用原文说明古仁人之心。', citationIds: ['E1', 'E2'] }] }
    ]
  };
}

test('OpenMAIC canvas edits, undo-redo, saves and survives refresh without exposing teacher notes', async ({ page, consoleGuard }) => {
  const { buildTeachingSlideDeckV2, createTeachingSlideDeckV2Revision, updateTeachingSlideDeckV2 } = await import('../shared/teaching-slides-v2.js');
  let deck = buildTeachingSlideDeckV2(legacyDraft()), version = 8;
  const writes = [];
  await page.addInitScript(() => localStorage.setItem('huojiaocan.supabase.session', JSON.stringify({ user: { id: 'slides-test-user' }, access_token: 'local-fixture-not-a-credential' })));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/drafts/slides-openmaic/slides') {
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON(); writes.push(body);
        deck = body.revise ? createTeachingSlideDeckV2Revision(deck) : updateTeachingSlideDeckV2(deck, { ...body, confirmedBy: 'slides-test-user' }); version += 1;
      }
      return route.fulfill({ json: { deck, draftVersion: version, stale: false } });
    }
    if (url.pathname === '/api/config') return route.fulfill({ json: { supabaseConfigured: true } });
    return route.fulfill({ json: { configured: false, profiles: [], documents: [] } });
  });

  await page.goto('/slides/?draftId=slides-openmaic');
  await expect(page.locator('.openmaic-slide-surface')).toBeVisible();
  await expect(page.locator('.openmaic-thumbnail-canvas')).toHaveCount(7);
  await expect(page.locator('.openmaic-thumbnail-canvas .slide-element').first()).toBeVisible();
  await expect(page.locator('#teaching-slide-element-cover-title')).toContainText('岳阳楼记');
  await expect(page.getByRole('button', { name: /撤销/ })).toBeDisabled();

  await page.getByRole('button', { name: '全屏授课' }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await page.keyboard.press('End');
  await expect(page.getByRole('button', { name: /第 7 页/ })).toHaveClass(/active/);
  await page.keyboard.press('Home');
  await expect(page.getByRole('button', { name: /第 1 页/ })).toHaveClass(/active/);
  await page.evaluate(() => document.exitFullscreen());
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);

  await page.getByRole('button', { name: '插入文本框' }).click();
  const box = await page.locator('.openmaic-slide-surface').boundingBox();
  await page.mouse.move(box.x + box.width * .55, box.y + box.height * .55);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .78, box.y + box.height * .66, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: /撤销/ })).toBeEnabled();
  await page.getByRole('button', { name: /撤销/ }).click();
  await expect(page.getByRole('button', { name: /重做/ })).toBeEnabled();
  await page.getByRole('button', { name: /重做/ }).click();
  await expect(page.getByRole('button', { name: '保存画布' })).toBeEnabled();
  await page.getByRole('button', { name: '保存画布' }).click();
  await expect(page.getByText('画布修改已保存；刷新页面后仍可恢复。')).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0].slideId).toBe('cover');

  await page.reload();
  await expect(page.locator('.openmaic-slide-surface')).toBeVisible();
  await expect(page.getByRole('button', { name: '保存画布' })).toBeDisabled();
  await page.getByRole('button', { name: '确认课件定稿' }).click();
  await expect(page.getByRole('button', { name: '创建修订版' })).toBeVisible();
  await page.getByRole('button', { name: '创建修订版' }).click();
  await expect(page.getByText('已从定稿创建新的可编辑修订版；原定稿已保留。')).toBeVisible();
  await page.getByRole('button', { name: '教师备课' }).click();
  await expect(page.getByLabel('教师提示（不会进入投屏文件）')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(350);
  await expect(page.locator('.openmaic-slide-surface')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  expect(consoleGuard).toEqual([]);
});
