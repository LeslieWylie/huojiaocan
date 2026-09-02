const { test, expect } = require('./fixtures.cjs');

test('anonymous teacher browses a textbook and keeps an exact cross-document search target', async ({ page }) => {
  const mark = label => console.log(`[anonymous-reader] ${label}`);
  await page.goto('/library/');
  mark('library loaded');

  await expect(page.getByRole('heading', { name: /先选定要查的材料/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /学生教材/ }).first()).toBeVisible();
  await page.getByRole('button', { name: /11 岳阳楼记/ }).first().click({ noWaitAfter: true });
  mark('lesson selected');
  await expect(page).toHaveURL(/doc=textbook/);
  await expect(page).toHaveURL(/page=56/);

  await page.getByRole('textbox', { name: '搜索篇名、章节或教学问题' }).fill('岳阳楼记');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  mark('search submitted');
  await expect(page.locator('.index-results small[role="status"]')).toContainText(/条相关页面/);

  const guideHit = page.locator('.index-results button').filter({ hasText: '第224页' }).first();
  await expect(guideHit).toBeVisible();
  await guideHit.click({ noWaitAfter: true });
  mark('guide result selected');

  await expect(page).toHaveURL(/doc=teacher-guide/);
  await expect(page).toHaveURL(/page=224/);
  await expect(page).toHaveURL(/node=teacher-guide-u3-n2/);
  await expect(page.locator('.library-pdf-meta').getByText('原始教材是唯一可核验的依据')).toBeVisible();

  await page.getByRole('link', { name: /核验原始教材/ }).click({ noWaitAfter: true });
  mark('reader opened');
  await expect(page).toHaveURL(/\/document\/\?/);
  await expect(page).toHaveURL(/doc=teacher-guide/);
  await expect(page).toHaveURL(/page=224/);
  await expect(page.getByText(/第 224 页/).first()).toBeVisible();
  await page.getByRole('link', { name: /返回原页面|返回教材库/ }).click();
  mark('returned to library');
  await expect(page).toHaveURL(/\/library\/\?/);
  await expect(page).toHaveURL(/doc=teacher-guide/);
  await expect(page).toHaveURL(/page=224/);
});

test('anonymous reader remains usable at the active viewport', async ({ page }, testInfo) => {
  await page.goto('/library/?doc=textbook&page=56&node=textbook-u3-n1&lesson=11%20岳阳楼记');
  await expect(page.getByRole('heading', { name: /先选定要查的材料/ })).toBeVisible();

  if (testInfo.project.name === 'mobile-chromium') {
    await expect(page.getByRole('button', { name: '打开侧栏导航' })).toBeVisible();
    await page.getByRole('button', { name: '打开侧栏导航' }).click();
    await expect(page.getByRole('link', { name: '备课问答', exact: true })).toBeVisible();
  } else {
    await expect(page.getByRole('link', { name: '备课问答', exact: true })).toBeVisible();
  }
});

test('reader accepts a multi-digit physical page and recovers from an incomplete link', async ({ page }) => {
  await page.goto('/document/?doc=teacher-guide&page=64&lesson=5%20%E4%B9%A1%E6%84%81');
  const pageInput = page.getByRole('textbox', { name: /教材页码/ });
  await pageInput.fill('224');
  await pageInput.press('Enter');
  await expect(page).toHaveURL(/doc=teacher-guide/);
  await expect(page).toHaveURL(/page=224/);
  await expect(page.getByText(/第 224 页/).first()).toBeVisible();

  await page.goto('/document/');
  await expect(page.getByRole('heading', { name: '这个教材链接缺少定位信息' })).toBeVisible();
  await expect(page.getByRole('link', { name: '返回教材库' })).toBeVisible();
});
