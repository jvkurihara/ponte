import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', timeout: 90000, workers: 1, retries: 0,
  use: { baseURL: process.env.TEST_ORIGIN || 'http://localhost:5173', viewport: { width: 1505, height: 1045 }, trace: 'retain-on-failure', screenshot: 'only-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ['--no-sandbox', '--allow-loopback-in-peer-connection', '--disable-features=WebRtcHideLocalIpsWithMdns'] } : undefined,
  },
  reporter: 'list',
});
