import { defineConfig, devices } from '@playwright/test';

/**
 * retries: 0 -> Ham hatayı görmek istiyoruz. Flaky tespitini Playwright'ın
 * retry mekanizmasına değil, geçmiş koşulara (results/history) bırakıyoruz;
 * böylece AI'ın "bu test son N koşuda kaç kez kırıldı" bilgisini kullanmasını gösterebiliyoruz.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 0,
  fullyParallel: true,
  reporter: [
    ['list'],
    ['json', { outputFile: process.env.RUN_OUTPUT ?? 'results/latest.json' }],
  ],
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 10_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
