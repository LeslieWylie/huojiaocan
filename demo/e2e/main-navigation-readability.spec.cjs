const { test, expect } = require('./fixtures.cjs');

const px = async locator => Number.parseFloat(await locator.evaluate(element => getComputedStyle(element).fontSize));

test('the public main path keeps one clear action and preserves the lesson handoff', async ({ page }, testInfo) => {
  await page.goto('/');

  for (const [name, pathname] of [
    ['教学任务', '/'],
    ['教材库', '/library/'],
    ['备课问答', '/ask/'],
    ['一课三卡', '/cards/']
  ]) {
    await expect(page.getByRole('link', { name, exact: true })).toHaveAttribute('href', pathname);
  }

  const moreTools = page.locator('details.sidebar-more-tools summary');
  await moreTools.click();
  await expect(page.getByRole('link', { name: '使用引导', exact: true })).toHaveAttribute('href', '/guide/');

  await page.getByRole('link', { name: '先选一篇教材' }).click();
  await expect(page).toHaveURL(/\/library\//);
  await expect(page.getByRole('heading', { name: /先选定要查的材料/ })).toBeVisible();

  const choices = page.locator('.source-choice');
  await expect(choices).toHaveCount(3);
  if (testInfo.project.name === 'chromium-desktop') {
    const boxes = await choices.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().top));
    expect(Math.max(...boxes) - Math.min(...boxes)).toBeLessThan(2);
  }

  expect(await px(choices.first().locator('.source-choice-copy strong'))).toBeGreaterThanOrEqual(14);
  expect(await px(choices.first().locator('.source-choice-copy small'))).toBeGreaterThanOrEqual(12);
  expect(await px(choices.first().locator('.source-choice-actions a'))).toBeGreaterThanOrEqual(12);

  await page.getByRole('button', { name: /11 岳阳楼记/ }).first().click({ noWaitAfter: true });
  await expect(page).toHaveURL(/doc=textbook/);
  await expect(page).toHaveURL(/page=56/);

  const prepare = page.getByRole('link', { name: '围绕本篇开始备课' });
  await expect(prepare).toHaveAttribute('href', /lesson=11(?:\+|%20)%E5%B2%B3%E9%98%B3%E6%A5%BC%E8%AE%B0/);
  await prepare.click();
  await expect(page).toHaveURL(/\/ask\//);
  expect(new URL(page.url()).searchParams.get('lesson')).toBe('11 岳阳楼记');
  expect(new URL(page.url()).searchParams.get('page')).toBe('56');
});

test('library search controls and page actions stay readable and operational', async ({ page }) => {
  await page.goto('/library/');

  const search = page.getByRole('textbox', { name: '搜索篇名、章节或教学问题' });
  expect(await px(search)).toBeGreaterThanOrEqual(14);
  await search.fill('岳阳楼记');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.locator('.index-results small[role="status"]')).toContainText(/条相关页面/);

  const hit = page.locator('.index-results button').filter({ hasText: '第56页' }).first();
  await expect(hit).toBeVisible();
  await hit.click({ noWaitAfter: true });
  await expect(page).toHaveURL(/doc=textbook/);
  await expect(page).toHaveURL(/page=56/);

  expect(await px(page.getByRole('button', { name: '上一页', exact: true }))).toBeGreaterThanOrEqual(13);
  expect(await px(page.getByRole('link', { name: '核验原始教材' }))).toBeGreaterThanOrEqual(13);
});
