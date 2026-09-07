const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

for (const width of [1280, 390]) for (const route of ['/', '/library/', '/login/', '/ask/']) {
  test(`public accessibility ${route} at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({width, height: 900});
    await page.goto(route);
    await expect(page.locator('main')).toBeVisible();
    await page.locator('.page-loading').waitFor({ state: 'hidden' });
    // Wait for real form/navigation controls, not the lazy loading skeleton.
    await expect(page.locator('main').locator('button:visible, a[href]:visible, input:visible').first()).toBeVisible();
    await page.evaluate(async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await Promise.all(document.getAnimations().filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime))
        .map(a => a.finished.catch(() => {})));
    });
    if (route === '/library/') await expect(page.locator('.tree-item').first()).toBeVisible({timeout:30000});
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    const report = {
      route, width, engine: result.testEngine, timestamp: result.timestamp,
      violations: result.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, url: v.helpUrl,
        nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })),
      incomplete: result.incomplete.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))
    };
    require('node:fs').writeFileSync(testInfo.outputPath('accessibility.json'), JSON.stringify(report, null, 2));
    await testInfo.attach('accessibility.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
    if (route === '/' && width === 1280) await page.screenshot({path:testInfo.outputPath('home.png')});
    expect(report.violations).toEqual([]);
  });
}
