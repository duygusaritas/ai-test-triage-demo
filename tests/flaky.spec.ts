import { test, expect } from './fixtures';

// ⚠️ FLAKY: the-internet'te element ~5 sn'de yükleniyor, timeout sınırda
test('dinamik yüklenen içerik görünür', async ({ page }) => {
  await page.goto('https://the-internet.herokuapp.com/dynamic_loading/1');
  await page.locator('#start button').click();
  await expect(page.locator('#finish')).toHaveText('Hello World!', { timeout: 5_000 });
});

// ⚠️ FLAKY (internetsiz): yarış durumu simülasyonu.
// Sayfa butonu 0-2 sn arası rastgele bir sürede aktif ediyor, test sadece 1 sn bekliyor.
// Yaklaşık yarı yarıya geçer/kırılır -> geçmiş koşularda "bazen kırmızı" görünür.
test('kaydet butonu aktif olduktan sonra tıklanır', async ({ page }) => {
  await page.setContent(`
    <button id="save" disabled>Kaydet</button>
    <p id="status"></p>
    <script>
      setTimeout(() => document.getElementById('save').disabled = false, Math.random() * 2000);
      document.getElementById('save').onclick = () =>
        document.getElementById('status').textContent = 'Kaydedildi';
    </script>`);
  await page.locator('#save').click({ timeout: 1_000 });
  await expect(page.locator('#status')).toHaveText('Kaydedildi');
});