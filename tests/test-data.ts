/**
 * Test verisi. Gerçek projelerde bu genelde bir fixture dosyası ya da seed script'idir.
 * Kasıtlı hata: checkoutUser "locked_out_user" -> TEST_DATA kategorisi.
 */
export const testData = {
  baseUrl: 'https://www.saucedemo.com',
  password: 'secret_sauce',
  standardUser: 'standard_user',
  checkoutUser: 'locked_out_user', // ❌ birisi seed'i değiştirmiş: bu kullanıcı kilitli
  problemUser: 'problem_user', // saucedemo bu kullanıcıda bilerek hatalı davranır -> PRODUCT_BUG
  slowUser: 'performance_glitch_user', // login ~5 sn sürer -> FLAKY
  existingBookingId: 999_999_999, // ❌ fixture'daki kayıt silinmiş -> TEST_DATA
};
