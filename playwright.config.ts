import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Reuse an installed browser in this workstation; CI can use Playwright's own Chromium.
const localChromium = join(
  process.env.LOCALAPPDATA || '',
  'ms-playwright',
  'chromium-1228',
  'chrome-win64',
  'chrome.exe',
);
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
  (existsSync(localChromium) ? localChromium : undefined);

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || 'test-results',
  use: {
    actionTimeout: 15_000,
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173',
    browserName: 'chromium',
    viewport: { width: 1440, height: 1000 },
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    acceptDownloads: true,
    launchOptions: executablePath ? { executablePath } : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
