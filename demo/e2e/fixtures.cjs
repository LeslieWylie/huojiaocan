const { test: base, expect } = require('@playwright/test');

const test = base.extend({
  consoleGuard: [async ({ page }, use) => {
    const errors = [];
    // PDF rendering is browser-plugin behavior, not the navigation contract
    // under test. A tiny local response keeps page/return-path checks fast and
    // deterministic; production smoke never applies this interception.
    if (process.env.E2E_TARGET !== 'production') {
      await page.route('**/*.pdf', route => route.fulfill({
        status: 200,
        contentType: 'application/pdf',
        body: '%PDF-1.4\n%%EOF\n'
      }));
    }
    page.on('console', message => {
      if (message.type() === 'error') {
        const source = message.location()?.url;
        errors.push(`console.error${source ? ` (${source})` : ''}: ${message.text()}`);
      }
    });
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    await use(errors);
    expect(errors, 'the browser emitted console errors').toEqual([]);
  }, { auto: true }]
});

module.exports = { test, expect };
