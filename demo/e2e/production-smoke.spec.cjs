const { test, expect } = require('./fixtures.cjs');

test('production public entry, library and exact search are operational', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/活教参/);
  if (process.env.E2E_EXPECT_MAIN_ASSET) {
    await expect(page.locator(`script[src="/assets/${process.env.E2E_EXPECT_MAIN_ASSET}"]`)).toHaveCount(1);
  }
  await page.goto('/library/');
  await expect(page.getByRole('heading', { name: /先选定要查的材料/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /学生教材/ }).first()).toBeVisible();

  await page.getByRole('textbox', { name: '搜索篇名、章节或教学问题' }).fill('岳阳楼记');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.locator('.index-results small[role="status"]')).toContainText(/条相关页面/);
  await expect(page.locator('.index-results button').filter({ hasText: '第56页' }).first()).toBeVisible();
});

test('an expired session does not block the public material catalogue', async ({ page }) => {
  await page.goto('/library/');
  const result = await page.evaluate(async () => {
    const response = await fetch('/api/index/documents', {
      headers: { authorization: 'Bearer expired-session-regression-test' },
      signal: AbortSignal.timeout(20_000)
    });
    return { status: response.status, body: await response.json() };
  });
  expect(result.status).toBe(200);
  expect(result.body.documents.map(document => document.id)).toEqual(expect.arrayContaining(['textbook', 'teacher-guide', 'curriculum-standard']));
  expect(result.body.documents.every(document => document.visibility !== 'private')).toBe(true);
});

// Public, read-only navigation. This checks iframe page binding, not the
// browser's opaque PDF canvas or the scholarly correctness of the excerpt.
for (const lesson of ['我爱这土地', '沁园春·雪']) {
  test(`production search and PDF round trip preserve ${lesson}`, async ({ page }) => {
    await page.goto('/library/');
    await page.getByRole('textbox', { name: '搜索篇名、章节或教学问题' }).fill(lesson);
    await page.getByRole('button', { name: '搜索', exact: true }).click();
    const hit = page.locator('.index-result-group button').filter({ hasText: lesson }).first();
    await expect(hit).toBeVisible({ timeout: 30000 });
    expect(await page.locator('.index-result-group button').count()).toBeLessThanOrEqual(6);
    const label = await hit.locator('small').textContent();
    const physicalPage = Number(label.match(/第(\d+)页/)?.[1]);
    expect(physicalPage).toBeGreaterThan(0);
    await hit.click();
    await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBe(String(physicalPage));
    const target = new URL(page.url());
    expect(target.searchParams.get('doc')).toBeTruthy();
    const frame = page.locator('.library-pdf-article iframe');
    await expect(frame).toBeVisible();
    await expect.poll(async () => new URL(await frame.getAttribute('src'), page.url()).hash)
      .toMatch(new RegExp(`(?:#|&)page=${physicalPage}(?:&|$)`));
    await page.getByRole('link', { name: /核验原始教材/ }).click();
    await expect(page).toHaveURL(/\/document\//);
    expect(new URL(page.url()).searchParams.get('doc')).toBe(target.searchParams.get('doc'));
    expect(new URL(page.url()).searchParams.get('page')).toBe(String(physicalPage));
    await page.getByRole('link', { name: /返回原页面|返回教材库/ }).click();
    await expect(page).toHaveURL(/\/library\//);
    expect(new URL(page.url()).searchParams.get('page')).toBe(String(physicalPage));
    expect(new URL(page.url()).searchParams.get('doc')).toBe(target.searchParams.get('doc'));
  });
}

test('production library is usable at 390px without horizontal page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/library/');
  await expect(page.getByRole('textbox', { name: '搜索篇名、章节或教学问题' })).toBeVisible();
  const layout = await page.evaluate(() => ({ width: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(layout.content).toBeLessThanOrEqual(layout.width + 2);
  await page.getByRole('button', { name: '打开侧栏导航' }).click();
  await expect(page.getByRole('link', { name: '备课问答', exact: true })).toBeVisible();
});
