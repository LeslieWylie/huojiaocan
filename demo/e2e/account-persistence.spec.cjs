const crypto = require('node:crypto');
const { test, expect } = require('./fixtures.cjs');

// Local mock integration only; never run this account-creating test in production.
test('logout, another account, and re-login preserve A conversation without sharing it with B', async ({ page, context }) => {
  test.skip(process.env.E2E_TARGET === 'production');
  const account = () => ({ email: `isolation-${crypto.randomUUID()}@example.test`, password: crypto.randomBytes(18).toString('base64url') });
  const a = account(); const b = account();
  const register = async user => {
    await page.getByRole('button', { name: '注册', exact: true }).click();
    await page.getByLabel('邮箱').fill(user.email);
    await page.getByLabel('密码').fill(user.password);
    await page.getByRole('button', { name: '创建账号并获取验证邮件', exact: true }).click();
  };
  await page.goto('/ask/?new=1');
  await page.locator('form.ask-large textarea').fill('怎样备课《岳阳楼记》？');
  await page.getByRole('link', { name: '立即登录', exact: true }).click();
  await register(a);
  await expect(page).toHaveURL(/draftId=/);
  await expect(page.locator('.conversation-latest')).toContainText('怎样备课《岳阳楼记》');
  const aUrl = page.url(); const aDraft = new URL(aUrl).searchParams.get('draftId');
  await page.getByRole('button', { name: '退出', exact: true }).click();
  await expect(page.getByRole('button', { name: '退出', exact: true })).toHaveCount(0);
  await page.goto('/login/?next=%2Fask%2F%3Fnew%3D1');
  await register(b);
  await expect(page.getByRole('button', { name: '退出', exact: true })).toBeVisible();
  await expect(page.locator('.conversation-latest')).toHaveCount(0);
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('huojiaocan.supabase.session')).access_token);
  const denied = await page.request.get(`/api/drafts/${aDraft}`, { headers: { Authorization: `Bearer ${token}` } });
  expect([403, 404]).toContain(denied.status());
  expect(await denied.text()).not.toContain('怎样备课');
  await page.getByRole('button', { name: '退出', exact: true }).click();
  await expect(page.getByRole('button', { name: '退出', exact: true })).toHaveCount(0);
  await page.goto(`/login/?next=${encodeURIComponent(new URL(aUrl).pathname + new URL(aUrl).search)}`);
  await page.getByLabel('邮箱').fill(a.email);
  await page.getByLabel('密码').fill(a.password);
  await page.getByRole('button', { name: '登录并开始备课', exact: true }).click();
  await expect(page).toHaveURL(aUrl);
  await expect(page.locator('.conversation-latest')).toContainText('怎样备课《岳阳楼记》');
  await page.reload();
  await expect(page.locator('.conversation-latest')).toContainText('怎样备课《岳阳楼记》');
  const otherTab = await context.newPage();
  await otherTab.goto(aUrl);
  await expect(otherTab.locator('.conversation-latest')).toContainText('怎样备课《岳阳楼记》');
  await page.getByRole('button', { name: '退出', exact: true }).click();
  await expect(otherTab.locator('.conversation-latest')).toHaveCount(0);
  await expect(otherTab.getByRole('button', { name: '退出', exact: true })).toHaveCount(0);
  await otherTab.close();

});
