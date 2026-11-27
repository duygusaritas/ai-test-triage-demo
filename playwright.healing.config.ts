import { defineConfig, devices } from '@playwright/test';

/** Self-healing demosu için ayrı config: npm run heal */
export default defineConfig({
  testDir: './healing/tests',
  timeout: 60_000, // LLM çağrısı için pay
  retries: 0,
  workers: 2,
  reporter: [['list'], ['json', { outputFile: process.env.RUN_OUTPUT ?? 'results/healing/report.json' }]],
  use: { actionTimeout: 5_000 },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
