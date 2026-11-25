import { test as base, expect } from '@playwright/test';

/**
 * Test kırıldığında sayfanın o anki erişilebilirlik ağacını (aria snapshot)
 * "page-snapshot" eki olarak rapora ekler. Triage script'i bunu okuyup modele gönderir:
 * ekranda görünen hata mesajları ("locked out" gibi) ve input değerleri bu sayede görünür.
 * Playwright'ın error-context formatına bağlı değildir.
 */
export const test = base.extend<{ snapshotOnFailure: void }>({
  snapshotOnFailure: [
    async ({ page }, use, testInfo) => {
      await use();
      if (testInfo.status === testInfo.expectedStatus) return;
      try {
        const snapshot = await page.locator('body').ariaSnapshot({ timeout: 3_000 });
        await testInfo.attach('page-snapshot', { body: snapshot, contentType: 'text/plain' });
      } catch {
        /* sayfa kapanmış olabilir; ek olmadan devam */
      }
    },
    { auto: true },
  ],
});

export { expect };
