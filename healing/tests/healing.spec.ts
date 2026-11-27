import { test, expect, Page } from '@playwright/test';
import { heal } from '../heal';

/**
 * Self-healing senaryoları. İnternet gerekmez: her sayfa, uygulamanın "yeni sürümünü"
 * temsil eden sabit bir HTML. Testteki selector'lar ise "eski sürüme" göre yazılmış.
 *
 * - Onarılması gereken 5 senaryo: test, AI doğru elementi bulursa GEÇER.
 * - Onarılmaması gereken 2 tuzak: hedef element gerçekten kaldırılmış (ürün hatası).
 *   AI benzer bir butona "onarırsa" gerçek bug gizlenir; test bunu yakalar.
 * - 1 kontrol senaryosu: selector hâlâ çalışıyor, AI'a hiç gidilmemeli.
 *
 * data-qa-truth: değerlendirme için doğru elementin işareti. LLM'e GÖNDERİLMEZ
 * (healing/heal.ts bu attribute'u okumaz).
 */
async function release(page: Page, body: string) {
  await page.setContent(`<!doctype html><html><head><title>Demo uygulama</title>
    <style>body{font-family:sans-serif;padding:16px} li,tr{margin:6px 0} button{margin:4px}</style></head>
    <body>${body}<p id="status"></p>
    <script>function s(t){document.getElementById('status').textContent=t}</script></body></html>`);
}

const status = (page: Page) => page.locator('#status');

// ---------------------------------------------------------------- onarılmalı

test('data-test değeri değişen sepete ekle butonu', async ({ page }) => {
  await release(page, `
    <ul>
      <li class="item"><h3>Sauce Labs Backpack</h3><p>$29.99</p>
        <button data-test="add-to-cart-sauce-labs-backpack" data-qa-truth onclick="s('backpack eklendi')">Add to cart</button></li>
      <li class="item"><h3>Sauce Labs Bike Light</h3><p>$9.99</p>
        <button data-test="add-to-cart-sauce-labs-bike-light" onclick="s('bike light eklendi')">Add to cart</button></li>
      <li class="item"><h3>Sauce Labs Bolt T-Shirt</h3><p>$15.99</p>
        <button data-test="add-to-cart-sauce-labs-bolt-t-shirt" onclick="s('t-shirt eklendi')">Add to cart</button></li>
    </ul>`);
  const btn = await heal(page, {
    selector: '[data-test="add-to-cart-backpack"]',
    intent: 'Sauce Labs Backpack ürününü sepete ekleyen buton',
  });
  await btn.click();
  await expect(status(page)).toHaveText('backpack eklendi');
});

test('id değeri kaldırılan giriş butonu', async ({ page }) => {
  await release(page, `
    <form onsubmit="return false">
      <input data-test="username" placeholder="Kullanıcı adı">
      <input data-test="password" type="password" placeholder="Şifre">
      <button type="button" data-test="login-button" data-qa-truth onclick="s('giriş yapıldı')">Giriş yap</button>
      <a href="#" onclick="s('şifre sıfırlama')">Şifremi unuttum</a>
    </form>`);
  const btn = await heal(page, { selector: '#login-btn', intent: 'Giriş formunu gönderen buton' });
  await btn.click();
  await expect(status(page)).toHaveText('giriş yapıldı');
});

test('metni değişen sepete ekle butonu', async ({ page }) => {
  await release(page, `
    <article class="card"><h2>Kablosuz kulaklık</h2><p>1.299 TL</p>
      <button data-qa-truth onclick="s('sepete eklendi')">Sepete at</button>
      <button onclick="s('favorilere eklendi')">Favorilere ekle</button>
    </article>`);
  const btn = await heal(page, { selector: 'button:has-text("Sepete ekle")', intent: 'Ürünü sepete ekleyen buton' });
  await btn.click();
  await expect(status(page)).toHaveText('sepete eklendi');
});

test('sayfa yapısı değişen kaydet butonu', async ({ page }) => {
  await release(page, `
    <form id="profile-form" onsubmit="return false">
      <input name="fullName" placeholder="Ad soyad">
      <input name="email" placeholder="E-posta">
      <footer class="form-footer">
        <button type="button" class="ghost" onclick="s('iptal edildi')">İptal</button>
        <button type="button" class="cta" data-qa-truth onclick="s('kaydedildi')">Kaydet</button>
      </footer>
    </form>`);
  const btn = await heal(page, {
    selector: 'form#profile > div.actions > button.submit',
    intent: 'Profil formundaki bilgileri kaydeden buton',
  });
  await btn.click();
  await expect(status(page)).toHaveText('kaydedildi');
});

test('satırlarda aynı isimli sil butonları', async ({ page }) => {
  await release(page, `
    <table>
      <tr><td>Ayşe Demir</td><td>ayse@example.com</td><td><button onclick="s('ayşe silindi')">Sil</button></td></tr>
      <tr><td>Ahmet Yılmaz</td><td>ahmet@example.com</td><td><button data-qa-truth onclick="s('ahmet silindi')">Sil</button></td></tr>
      <tr><td>Mehmet Kaya</td><td>mehmet@example.com</td><td><button onclick="s('mehmet silindi')">Sil</button></td></tr>
    </table>`);
  const btn = await heal(page, {
    selector: '#delete-row-ahmet',
    intent: 'Kullanıcı listesinde Ahmet Yılmaz satırındaki Sil butonu',
  });
  await btn.click();
  await expect(status(page)).toHaveText('ahmet silindi');
});

// ---------------------------------------------------------------- tuzaklar: onarılmamalı

test('tuzak: kaldırılan ödemeye geç butonu', async ({ page }) => {
  // Ürün hatası: yeni sürümde "Ödemeye geç" butonu yanlışlıkla kaldırılmış.
  await release(page, `
    <section class="cart"><h2>Sepetim</h2>
      <ul><li>Sauce Labs Backpack · $29.99</li></ul>
      <button data-test="continue-shopping" onclick="s('alışverişe dönüldü')">Alışverişe devam et</button>
      <button data-test="clear-cart" onclick="s('sepet temizlendi')">Sepeti temizle</button>
    </section>`);
  await expect(
    heal(page, { selector: '[data-test="checkout"]', intent: "Sepetten ödeme adımına geçiren 'Ödemeye geç' butonu" }),
  ).rejects.toThrow(/Locator bulunamadı/);
});

test('tuzak: kaldırılan hesabı sil butonu', async ({ page }) => {
  // Ürün hatası: "Hesabı sil" kaldırılmış, yerine farklı işlevli "Hesabı dondur" var.
  await release(page, `
    <section class="settings"><h2>Hesap ayarları</h2>
      <button data-test="change-password" onclick="s('şifre ekranı')">Şifreyi değiştir</button>
      <button data-test="freeze-account" onclick="s('hesap donduruldu')">Hesabı dondur</button>
      <button data-test="logout" onclick="s('çıkış yapıldı')">Çıkış yap</button>
    </section>`);
  await expect(
    heal(page, { selector: '[data-test="delete-account"]', intent: 'Hesabı kalıcı olarak silen buton' }),
  ).rejects.toThrow(/Locator bulunamadı/);
});

// ---------------------------------------------------------------- kontrol

test('kontrol: selector hâlâ çalışıyor', async ({ page }) => {
  await release(page, `<button data-test="subscribe" onclick="s('abone olundu')">Abone ol</button>`);
  const btn = await heal(page, { selector: '[data-test="subscribe"]', intent: 'Bültene abone olan buton' });
  await btn.click();
  await expect(status(page)).toHaveText('abone olundu');
});
