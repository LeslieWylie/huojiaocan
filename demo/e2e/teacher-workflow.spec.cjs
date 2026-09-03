const crypto = require('node:crypto');
const { test, expect } = require('./fixtures.cjs');

function credentials() {
  return {
    email: process.env.E2E_EMAIL || `huojiaocan-e2e-${Date.now()}-${crypto.randomBytes(3).toString('hex')}@example.test`,
    password: process.env.E2E_PASSWORD || `E2e-${crypto.randomBytes(12).toString('base64url')}!`
  };
}

test('login recovery preserves the question through continuous Q&A, finalization, cards, locking and classroom', async ({ page }) => {
  const account = credentials();
  await page.goto('/ask/?doc=textbook&page=56&node=textbook-u3-n1&lesson=11%20岳阳楼记&scope=both');

  const composer = page.locator('form.ask-large textarea');
  await composer.fill('怎样围绕《岳阳楼记》的忧乐观组织课堂？');
  await page.getByRole('link', { name: '立即登录' }).click();
  await expect(page).toHaveURL(/\/login\//);

  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('邮箱').fill(account.email);
  await page.getByLabel('密码').fill(account.password);
  await page.getByRole('button', { name: '创建账号并获取验证邮件' }).click();

  await expect(page).toHaveURL(/\/ask\//);
  await expect(page.locator('.conversation-latest').getByText('怎样围绕《岳阳楼记》的忧乐观组织课堂？', { exact: true })).toBeVisible();
  await expect(page.getByText('先回答你的问题').last()).toBeVisible();
  await expect(page).toHaveURL(/draftId=/);

  await page.reload();
  await expect(page.locator('.conversation-latest').getByText('怎样围绕《岳阳楼记》的忧乐观组织课堂？', { exact: true })).toBeVisible();
  await expect(page.locator('form.ask-large textarea')).toHaveValue('');

  await page.locator('form.ask-large textarea').fill('请调整为两课时，并保留当前篇目。');
  await page.getByRole('button', { name: '开始提问', exact: true }).click();
  await expect(page.getByText('请调整为两课时，并保留当前篇目。', { exact: true })).toBeVisible();
  await expect(page.getByText('已沿用本场对话上下文').last()).toBeVisible();
  await expect(page.locator('form.ask-large textarea')).toHaveValue('');

  const evidence = page.locator('.conversation-latest details.raw-evidence');
  await evidence.getByText('查看原文片段与页码').click();
  await evidence.locator('a').first().click();
  await expect(page).toHaveURL(/\/document\/\?/);
  expect(new URL(page.url()).searchParams.get('return')).toMatch(/^\/ask\/\?draftId=/);
  await page.getByRole('link', { name: /返回原页面|返回本课问答/ }).click();
  await expect(page).toHaveURL(/\/ask\/\?draftId=/);

  await page.getByRole('link', { name: '查看并定稿方案' }).last().click();
  await expect(page).toHaveURL(/\/cards\/\?draftId=/);
  const continueToCards = page.getByRole('button', { name: '请先生成三卡' });
  await expect(continueToCards).toBeEnabled();
  await continueToCards.click();
  await expect(page.locator('#teacher-plan-editor')).toBeInViewport();
  await page.getByRole('button', { name: /确认本版并生成三卡|生成板书与三卡/ }).click();
  await expect(page.getByRole('heading', { name: '三张卡，分别对应课堂中的三个动作' })).toBeVisible();

  for (const cardName of ['板书卡', '提问卡', '评价卡']) {
    await page.getByRole('button', { name: new RegExp(cardName) }).first().click();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '锁定本卡' }).click();
    await expect(page.getByText('当前卡已锁定')).toBeVisible();
  }

  const classroom = page.getByRole('button', { name: '开始上课并记录' }).first();
  await expect(classroom).toBeEnabled();
  await classroom.click();
  await expect(page.getByRole('dialog', { name: '课堂共创记录' })).toBeVisible();
  await expect(page.getByText('课堂共创板书 · 只记录学生真正说出的内容')).toBeVisible();
  await page.getByRole('button', { name: '关闭课堂模式' }).click();
});
