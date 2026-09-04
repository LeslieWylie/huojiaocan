const crypto = require('node:crypto');
const { test, expect } = require('./fixtures.cjs');

const ROUTES = [
  '/', '/guide/', '/unit/', '/cards/', '/slides/', '/homework/', '/marking/',
  '/rehearsal/', '/pulse/', '/worksheet/', '/alignment/', '/learning/',
  '/deliberation/', '/study/', '/compare/', '/research/', '/observation/',
  '/assets/', '/share/', '/reflection/', '/library/', '/ask/', '/ingest/',
  '/jobs/', '/inspect/', '/validation/', '/document/', '/login/', '/settings/',
  '/decision/', '/pitch/'
];

const TECHNICAL_COPY = /(?:PageIndex|MLAMP|PDF Index Service|\bBFF\b|gateway_unauthorized|citation_text_mismatch|pageindex_[a-z_]+)/u;

test.setTimeout(300_000);

function testAccount() {
  return {
    email: `huojiaocan-page-audit-${Date.now()}-${crypto.randomBytes(3).toString('hex')}@example.test`,
    password: `Audit-${crypto.randomBytes(12).toString('base64url')}!`
  };
}

function routeUrl(path, draftId) {
  const lesson = encodeURIComponent('11 岳阳楼记');
  if (path === '/cards/' || path === '/slides/' || path === '/homework/' || path === '/rehearsal/' ||
      path === '/pulse/' || path === '/worksheet/' || path === '/alignment/' || path === '/learning/' ||
      path === '/deliberation/' || path === '/study/' || path === '/compare/' || path === '/research/' ||
      path === '/observation/' || path === '/reflection/' || path === '/ask/') {
    return `${path}?draftId=${encodeURIComponent(draftId)}`;
  }
  if (path === '/library/') return `${path}?doc=textbook&page=56&scope=both&node=textbook-u3-n1&lesson=${lesson}`;
  if (path === '/document/') return `${path}?doc=textbook&page=56&return=${encodeURIComponent(`/ask/?draftId=${draftId}`)}`;
  if (path === '/inspect/' || path === '/validation/') return `${path}?doc=textbook&page=56`;
  if (path === '/unit/') return `${path}?doc=textbook&node=textbook-u3-n1&lesson=${lesson}`;
  return path;
}

async function createContextDraft(page) {
  const account = testAccount();
  await page.goto('/ask/?doc=textbook&page=56&node=textbook-u3-n1&lesson=11%20岳阳楼记&scope=both');
  await page.locator('form.ask-large textarea').fill('怎样围绕《岳阳楼记》的忧乐观组织课堂？');
  await page.getByRole('link', { name: '立即登录' }).click();
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('邮箱').fill(account.email);
  await page.getByLabel('密码').fill(account.password);
  await page.getByRole('button', { name: '创建账号并获取验证邮件' }).click();
  await expect(page).toHaveURL(/draftId=/);
  return new URL(page.url()).searchParams.get('draftId');
}

async function auditRenderedPage(page, path, draftId) {
  await page.goto(routeUrl(path, draftId), { waitUntil: 'domcontentloaded' });
  await page.locator('.page-loading').waitFor({ state: 'hidden', timeout: 20_000 }).catch(() => {});
  await expect(page.locator('body')).not.toBeEmpty();

  const audit = await page.evaluate(({ allowedRoutes, technicalPattern }) => {
    const visible = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const controls = [...document.querySelectorAll('button, a[href], input, textarea, select')]
      .filter(visible)
      .map(element => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          name: (element.getAttribute('aria-label') || [...(element.labels || [])].map(label => label.textContent).join(' ') || element.textContent || element.getAttribute('title') || element.getAttribute('placeholder') || '').trim(),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          disabled: Boolean(element.disabled),
          href: element.tagName === 'A' ? element.getAttribute('href') : null
        };
      });
    const internalBroken = controls.filter(control => {
      if (!control.href || /^(?:https?:|mailto:|tel:|#)/u.test(control.href)) return false;
      try {
        const url = new URL(control.href, location.origin);
        return url.origin === location.origin && !allowedRoutes.includes(url.pathname) && !url.pathname.startsWith('/materials/');
      } catch { return true; }
    });
    const duplicateIds = [...document.querySelectorAll('[id]')]
      .map(element => element.id)
      .filter((id, index, ids) => id && ids.indexOf(id) !== index);
    const bodyText = document.body.innerText || '';
    return {
      bodyLength: bodyText.trim().length,
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      unnamedControls: controls.filter(control => !control.name && !control.disabled),
      tinyControls: controls.filter(control => !control.disabled && ['button', 'a', 'select'].includes(control.tag) && (control.width < 24 || control.height < 24)),
      internalBroken,
      duplicateIds: [...new Set(duplicateIds)],
      technicalCopy: new RegExp(technicalPattern, 'u').test(bodyText),
      route: document.body.dataset.route || '',
      title: document.title
    };
  }, { allowedRoutes: ROUTES, technicalPattern: TECHNICAL_COPY.source });

  return audit;
}

test('all declared pages render with valid controls, routes, copy and responsive layout', async ({ page }) => {
  const draftId = await createContextDraft(page);
  expect(draftId).toBeTruthy();
  const issues = [];
  const conflicts = [];
  page.on('response', response => {
    if (response.status() === 409) conflicts.push(`${response.request().method()} ${response.url()}`);
  });

  for (const path of ROUTES) {
    await test.step(path, async () => {
      const audit = await auditRenderedPage(page, path, draftId);
      if (audit.bodyLength <= 20) issues.push(`${path}: 页面没有有效内容`);
      if (audit.horizontalOverflow > 2) issues.push(`${path}: 横向溢出 ${audit.horizontalOverflow}px`);
      if (audit.unnamedControls.length) issues.push(`${path}: 控件没有可访问名称 ${JSON.stringify(audit.unnamedControls)}`);
      if (audit.tinyControls.length) issues.push(`${path}: 操作区域小于 24px ${JSON.stringify(audit.tinyControls)}`);
      if (audit.internalBroken.length) issues.push(`${path}: ${audit.internalBroken.length} 个链接指向未声明页面`);
      if (audit.duplicateIds.length) issues.push(`${path}: 重复 id ${audit.duplicateIds.join(', ')}`);
      if (audit.technicalCopy) issues.push(`${path}: 泄露内部技术术语`);
      if (!audit.title.includes('活教参')) issues.push(`${path}: 页面标题缺少产品名`);
    });
  }
  if (conflicts.length) issues.push(`出现版本冲突请求：${[...new Set(conflicts)].join(', ')}`);
  expect(issues, '全站运行时质量问题').toEqual([]);
});
