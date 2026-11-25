import { test as base, expect } from '@playwright/test';

/**
 * Test kırıldığında sayfanın o anki görünür metnini (innerText) ve input değerlerini
 * "page-snapshot" eki olarak rapora ekler. Triage script'i bunu okuyup modele gönderir:
 * ekranda görünen hata mesajları ("locked out" gibi) ve input değerleri bu sayede görünür.
 * Playwright'ın error-context formatına bağlı değildir.
 *
 * Snapshot alınamazsa (sayfa kapanmış, navigasyon sürüyor vb.) nedeni
 * "page-snapshot-error" eki olarak yazılır; böylece sessizce kaybolmaz.
 */
export const test = base.extend<{ snapshotOnFailure: void }>({
  snapshotOnFailure: [
    async ({ page }, use, testInfo) => {
      await use();
      if (testInfo.status === testInfo.expectedStatus) return;
      try {
        if (page.isClosed()) throw new Error('sayfa kapanmış');
        const text = await page.locator('body').innerText({ timeout: 3_000 });
        const inputs = await page.$$eval('input, textarea, select', (els) =>
          els
            .map((e) => {
              const el = e as HTMLInputElement;
              if (el.type === 'password') return `${el.name || el.id}: <gizli>`;
              return `${el.name || el.id || el.type}: ${JSON.stringify(el.value)}`;
            })
            .filter(Boolean),
        );
        const body =
          `URL: ${page.url()}\n\n# Görünür metin\n${text.trim()}` +
          (inputs.length ? `\n\n# Input değerleri\n${inputs.join('\n')}` : '');
        await testInfo.attach('page-snapshot', { body: body.slice(0, 5_000), contentType: 'text/plain' });
      } catch (err) {
        await testInfo.attach('page-snapshot-error', {
          body: err instanceof Error ? err.message : String(err),
          contentType: 'text/plain',
        });
      }
    },
    { auto: true },
  ],
});

export { expect };
