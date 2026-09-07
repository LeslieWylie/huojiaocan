const base = require('./playwright.config.cjs');
module.exports = {
  ...base,
  testMatch: /public-pages\.a11y\.cjs/,
  outputDir: './node_modules/.cache/accessibility-results',
  reporter: 'list',
  use: { ...base.use, trace: 'off', screenshot: 'only-on-failure' },
  projects: [{ name: 'accessibility-public', use: base.projects[0].use }]
};
