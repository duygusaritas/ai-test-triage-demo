# AI Test Triage Demo 🔎

Gece koşan regresyonda kırmızıya düşen testleri bir LLM'e **sınıflandırtan** küçük bir demo:

| Kategori | Anlamı | Demo'da nasıl üretiliyor |
|---|---|---|
| 🐞 `PRODUCT_BUG` | Uygulama hatası | saucedemo `problem_user`: soyad alanı yazılmıyor, sıralama bozuk |
| 🧪 `TEST_BUG` | Test kodu hatalı | Yanlış locator, yanlış beklenen değer |
| 🌩️ `ENVIRONMENT` | Altyapı/ortam sorunu | httpbin `503`, DNS'te olmayan staging servisi |
| 🎲 `FLAKY` | Zamanlama / yarış durumu | Sınırda timeout'lar, rastgele gecikmeli buton |
| 🗃️ `TEST_DATA` | Test verisi sorunu | Kilitli kullanıcı, silinmiş booking kaydı (404) |

Her testin **gerçek** kategorisi `expected.json` içinde. Testleri bilerek bozduğumuz için AI'ın doğruluğunu otomatik ölçebiliyoruz.

## Akış

```
Playwright (N koşu) ──► results/history/*.json ──┐
                    └─► results/latest.json ─────┤
                                                 ▼
                      triage.ts: hata + stack + test kodu (yorumsuz) + geçmiş
                                 │  maskeleme (token, e-posta, TCKN, kart, IBAN)
                                 ▼
                      LLM (Claude / OpenAI / lokal Ollama) ──► JSON karar
                                 ▼
             results/triage.json + triage-report.md (+ Slack)
                                 ▼
                      evaluate.ts ──► doğruluk + karışıklık matrisi
```

## Kurulum

```bash
npm install
npx playwright install chromium
cp .env.example .env   # bir LLM anahtarı gir (veya Ollama ayarla)
```

## Çalıştırma

```bash
# 1) Suite'i 10 kez koş (flaky geçmişi oluşsun). Kırmızı testler beklenen durum.
npm run test:history

# 2) Önce kural tabanlı baseline (API anahtarı gerekmez)
npm run triage:baseline

# 3) AI triage
npm run triage

# 4) İkisini yan yana değerlendir
npm run evaluate -- results/triage.json results/triage-baseline.json
```

Örnek değerlendirme çıktısı:

```
=== results/triage.json ===
Doğruluk: 9/10 (%90)

gerçek \ tahmin   P_BUG  T_BUG    ENV  FLAKY T_DATA
P_BUG                 2      ·      ·      ·      ·
...
Yanlış sınıflandırılanlar:
  ✗ ...
```

> Sayılar örnek; kendi koşundan çıkan gerçek sonuçları yazında kullan.

## LLM seçenekleri

| Seçenek | `.env` | Not |
|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY=...` | Varsayılan model `claude-sonnet-5-5`, `LLM_MODEL` ile değiştirilebilir |
| OpenAI | `OPENAI_API_KEY=...` | Varsayılan `gpt-4o-mini` |
| **Ollama (lokal)** | `OPENAI_BASE_URL=http://localhost:11434/v1` + `LLM_MODEL=qwen2.5:14b` | Veri makineden çıkmaz. Şirket içi kullanım için en güvenli seçenek |

LLM hata verirse ilgili test otomatik olarak kural tabanlı sınıflandırmaya düşer ve bu durum raporda belirtilir.

## Dikkat edilenler (yazıda anlatmaya değer)

- **Cevap sızıntısı yok:** Test dosyalarındaki `// ❌ TEST_BUG` gibi yorumlar modele gönderilmeden önce siliniyor. Aksi halde değerlendirme hileli olurdu.
- **Sabit kategoriler + JSON çıktı:** Serbest metin yerine enum ve güven skoru istendiği için sonuç ölçülebilir ve otomasyona bağlanabilir.
- **Geçmiş bilgisi:** "Son 10 koşuda 4 kez kırıldı" bilgisi, flaky ayrımını en çok güçlendiren sinyal.
- **Maskeleme:** `triage/mask.ts`. Projene özel değerleri `MASK_VALUES` ile ekleyebilirsin.
- **Flaky testler** her koşuda kırılmaz. Değerlendirme sadece o koşuda kırılan testler üzerinden yapılır.

## Projeyi kendine uyarlamak

- Prompt ve kategori tanımları: `triage/classify.ts` → `SYSTEM_PROMPT`
- Kural tabanlı baseline: `classifyBaseline()`
- Yeni bozuk test eklersen `expected.json`'a da ekle.
- CI: `.github/workflows/triage.yml` (secrets: `ANTHROPIC_API_KEY` veya `OPENAI_API_KEY`, opsiyonel `SLACK_WEBHOOK_URL`)

## Not

saucedemo.com, the-internet.herokuapp.com, restful-booker ve httpbin, test pratiği için açılmış herkese açık sitelerdir. Testleri makul sayıda koşturalım 🙂
