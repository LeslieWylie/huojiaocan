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
