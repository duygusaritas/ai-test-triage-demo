import { test, expect, type Page } from '@playwright/test';
import { testData } from './test-data';

async function login(page: Page, user: string) {
  await page.goto(testData.baseUrl);
  await page.locator('[data-test="username"]').fill(user);
  await page.locator('[data-test="password"]').fill(testData.password);
  await page.locator('[data-test="login-button"]').click();
}

// ✅ Sağlam test
test('standart kullanıcı ürün listesini görür', async ({ page }) => {
  await login(page, testData.standardUser);
  await expect(page.locator('[data-test="title"]')).toHaveText('Products');
});

// ✅ Sağlam test
test('ürün sepete eklenince sepet rozeti 1 olur', async ({ page }) => {
  await login(page, testData.standardUser);
  await page.locator('[data-test="add-to-cart-sauce-labs-backpack"]').click();
  await expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveText('1');
});

// ❌ TEST_BUG: locator yanlış (gerçek id: add-to-cart-sauce-labs-bike-light)
test('bike light sepete eklenebilir', async ({ page }) => {
  await login(page, testData.standardUser);
  await page.locator('[data-test="add-to-cart-bike-light"]').click();
  await expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveText('1');
});

// ❌ TEST_BUG: test mantığı yanlış (1 ürün eklenip 2 bekleniyor)
test('iki ürün eklenince sepet rozeti 2 olur', async ({ page }) => {
  await login(page, testData.standardUser);
  await page.locator('[data-test="add-to-cart-sauce-labs-backpack"]').click();
  await expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveText('2');
});

// ❌ TEST_DATA: seed edilen kullanıcı kilitli
test('checkout kullanıcısı giriş yapabilir', async ({ page }) => {
  await login(page, testData.checkoutUser);
  await expect(page).toHaveURL(/inventory\.html/);
});

// ❌ PRODUCT_BUG: problem_user'da soyad alanına yazılamıyor
test('checkout formunda soyad alanı doldurulabilir', async ({ page }) => {
  await login(page, testData.problemUser);
  await page.locator('[data-test="add-to-cart-sauce-labs-backpack"]').click();
  await page.locator('[data-test="shopping-cart-link"]').click();
  await page.locator('[data-test="checkout"]').click();
  await page.locator('[data-test="firstName"]').fill('Duygu');
  await page.locator('[data-test="lastName"]').fill('Yılmaz');
  await expect(page.locator('[data-test="lastName"]')).toHaveValue('Yılmaz');
});

// ❌ PRODUCT_BUG: problem_user'da fiyata göre sıralama çalışmıyor
test('ürünler fiyata göre artan sıralanır', async ({ page }) => {
  await login(page, testData.problemUser);
  await page.locator('[data-test="product-sort-container"]').selectOption('lohi');
  await expect(page.locator('[data-test="inventory-item-price"]').first()).toHaveText('$7.99');
});

// ⚠️ FLAKY: performance_glitch_user ~5 sn'de giriş yapıyor, bekleme süresi sınırda
test('yavaş kullanıcı giriş sonrası ürünleri görür', async ({ page }) => {
  await login(page, testData.slowUser);
  await expect(page.locator('[data-test="title"]')).toHaveText('Products', { timeout: 6_000 });
});
