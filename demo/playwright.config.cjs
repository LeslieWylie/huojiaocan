const { defineConfig, devices } = require('@playwright/test');

const production = process.env.E2E_TARGET === 'production';
const localPort = Number(process.env.E2E_PORT || 18790);
const requestedChannel = process.env.E2E_BROWSER_CHANNEL || 'chrome';
const browserChannel = requestedChannel === 'bundled' ? undefined : requestedChannel;
const baseURL = production
  ? String(process.env.SITE_URL || 'https://app.huojiaocan.workers.dev').replace(/\/$/u, '')
  : `http://127.0.0.1:${localPort}`;

module.exports = defineConfig({
  testDir: './e2e',
  outputDir: './node_modules/.cache/playwright-results',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [['line'], ['html', { outputFolder: './node_modules/.cache/playwright-report', open: 'never' }]]
    : [['list'], ['html', { outputFolder: './node_modules/.cache/playwright-report', open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: production ? undefined : {
    command: 'npm run build && node scripts/e2e-local-server.mjs',
    url: `${baseURL}/api/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      E2E_PORT: String(localPort)
    }
  },
  projects: production ? [
    {
      name: 'production-smoke',
      testMatch: /production-smoke\.spec\.cjs/,
      use: { ...devices['Desktop Chrome'], channel: browserChannel }
    }
  ] : [
    {
      name: 'chromium-desktop',
      testIgnore: /production-smoke\.spec\.cjs/,
      use: { ...devices['Desktop Chrome'], channel: browserChannel }
    },
    {
      name: 'mobile-chromium',
      testMatch: /anonymous-reader\.spec\.cjs/,
      use: { ...devices['Pixel 7'], channel: browserChannel }
    }
  ]
});
