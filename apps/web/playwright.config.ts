import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  outputDir: '/tmp/cubic-media-browser-results',
  use: { baseURL: 'http://127.0.0.1:3197', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'narrow-desktop', use: { viewport: { width: 900, height: 700 } } },
    { name: 'phone-portrait', use: { viewport: { width: 390, height: 844 }, hasTouch: true } },
    { name: 'phone-landscape', use: { viewport: { width: 844, height: 390 }, hasTouch: true } },
    { name: 'small-phone', use: { viewport: { width: 320, height: 568 }, hasTouch: true } }
  ],
  webServer: {
    command: 'node tests/browser/server.mjs',
    url: 'http://127.0.0.1:3197/login',
    reuseExistingServer: false
  }
});
