import { test, expect } from '@playwright/test';
import { testData } from './test-data';

// ✅ Sağlam test
test('booking servisi ayakta', async ({ request }) => {
  const res = await request.get('https://restful-booker.herokuapp.com/ping');
  expect(res.status()).toBe(201);
});

// ❌ ENVIRONMENT: ödeme servisi 503 dönüyor (httpbin ile simüle)
test('ödeme servisi health check', async ({ request }) => {
  const res = await request.get('https://httpbin.org/status/503');
  expect(res.status(), 'payment-service /health').toBe(200);
});

// ❌ ENVIRONMENT: staging stok servisi DNS'te yok / ulaşılamıyor
test('stok servisi ürün adedini döner', async ({ request }) => {
  const res = await request.get('https://inventory-api.staging.invalid/v1/stock/42', { timeout: 5_000 });
  expect(res.ok()).toBeTruthy();
});

// ❌ TEST_DATA: fixture'daki booking kaydı artık yok
test('mevcut rezervasyon detayı getirilir', async ({ request }) => {
  const res = await request.get(
    `https://restful-booker.herokuapp.com/booking/${testData.existingBookingId}`,
  );
  expect(res.status()).toBe(200);
});
