/**
 * Self-healing locator.
 *
 *   const addToCart = await heal(page, {
 *     selector: '[data-test="add-to-cart-backpack"]',
 *     intent: 'Sauce Labs Backpack ürününü sepete ekleyen buton',
 *   });
 *   await addToCart.click();
 *
 * Akış:
 *  1. Eski selector'ı dene. Tek ve görünür bir element bulursa onu döndür (AI'a hiç gidilmez).
 *  2. Bulamazsa sayfadaki etkileşimli elementlerin özetini çıkar, maskele ve LLM'e sor.
 *  3. LLM'in önerdiği elementi DOĞRULA: önerilen selector tek elemente gidiyor mu, görünür mü,
 *     ve LLM'in işaret ettiği aday ile aynı element mi?
 *  4. Doğrulanırsa yeni locator ile devam et. Öneri, rapora "pending" olarak eklenir;
 *     kod otomatik değiştirilmez, onay ekranından insan karar verir.
 *  5. LLM "bu element artık yok" derse (found:false) test FAIL eder. Bu bilerek böyle:
 *     benzer ama farklı işlevli bir elemente "onarmak" gerçek bir bug'ı gizler.
 *
 * HEAL=off ile kapatılabilir (karşılaştırma için).
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test } from '@playwright/test';
import { mask } from '../triage/mask';
import { callLLM, llmConfigured } from './llm';

export interface HealTarget {
  /** Testte yazan (eski) selector */
  selector: string;
  /** Element ne işe yarıyor? İnsan diliyle. LLM bunu esas alır. */
  intent: string;
}

export interface HealRecord {
  test: string;
  file: string;
  oldSelector: string;
  intent: string;
  status: 'healed' | 'refused' | 'invalid' | 'error' | 'disabled';
  newSelector: string | null;
  confidence: number;
  reason: string;
  candidateCount: number;
  /** Değerlendirme için: onarılan element doğru element mi (data-qa-truth). LLM'e GÖNDERİLMEZ. */
  truthMatch: boolean | null;
  durationMs: number;
}

interface Candidate {
  i: number;
  tag: string;
  text: string;
  dataTest?: string;
  id?: string;
  role?: string;
  name?: string;
  type?: string;
  ariaLabel?: string;
  placeholder?: string;
  context: string;
}

export const HEAL_SYSTEM_PROMPT = `Sen bir test otomasyon uzmanısın. Bir Playwright testinde selector artık hiçbir elemente gitmiyor.
Görevin, testin hedeflediği elementi sayfadaki aday listesinden bulmak.

Kurallar:
- SADECE testin amacını (intent) birebir karşılayan elementi seç. Aynı işi yapan element yoksa found:false döndür.
- Benzer görünen ama FARKLI bir iş yapan elementi ASLA seçme. Örnek: "Ödemeye geç" butonu yoksa "Alışverişe devam et" butonu doğru cevap DEĞİLDİR; "Hesabı sil" yoksa "Hesabı dondur" doğru cevap DEĞİLDİR.
- Birden fazla benzer aday varsa (örn. her satırda bir "Sil" butonu), "context" alanındaki bilgiyle doğru olanı seç.
- Selector önerirken sırayla tercih et: [data-test="..."] > #id > role ve isim (örn. role=button[name="Kaydet"]). CSS class ve sıra (nth-child) kullanma.
- Emin değilsen confidence değerini düşük ver.

SADECE şu JSON'u döndür:
{"found": true|false, "index": <aday numarası veya null>, "selector": "<önerilen selector veya null>", "confidence": <0-1>, "reason": "<Türkçe, en fazla 2 cümle>"}`;

/** Sayfadaki etkileşimli elementlerin özeti. Değerlendirme işaretleri (data-qa-truth) OKUNMAZ. */
async function collectCandidates(page: Page): Promise<Candidate[]> {
  return page.evaluate(() => {
    const sel =
      'button, a[href], input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="tab"], [data-test]';
    const out: Candidate[] = [];
    const clean = (s: string | null | undefined, n: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
    document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') return;
      const i = out.length;
      if (i >= 150) return;
      el.setAttribute('data-heal-idx', String(i));
      // Bağlam: elementi içeren en yakın "kart / satır / form" benzeri kabın metni
      const box = el.closest('li, tr, article, section, form, [data-test$="item"], .item, .card, .row') ?? el.parentElement;
      out.push({
        i,
        tag: el.tagName.toLowerCase(),
        text: clean(el.innerText || (el as HTMLInputElement).value, 60),
        dataTest: el.getAttribute('data-test') ?? undefined,
        id: el.id || undefined,
        role: el.getAttribute('role') ?? undefined,
        name: el.getAttribute('name') ?? undefined,
        type: el.getAttribute('type') ?? undefined,
        ariaLabel: el.getAttribute('aria-label') ?? undefined,
        placeholder: el.getAttribute('placeholder') ?? undefined,
        context: box && box !== el ? clean((box as HTMLElement).innerText, 120) : '',
      });
    });
    return out;
  });
}

async function cleanup(page: Page) {
  await page.evaluate(() => document.querySelectorAll('[data-heal-idx]').forEach((e) => e.removeAttribute('data-heal-idx'))).catch(() => {});
}

function parse(raw: string) {
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error(`Modelden JSON alınamadı: ${raw.slice(0, 200)}`);
  const v = JSON.parse(json);
  return {
    found: Boolean(v.found),
    index: typeof v.index === 'number' ? v.index : null,
    selector: typeof v.selector === 'string' && v.selector.trim() ? v.selector.trim() : null,
    confidence: Math.max(0, Math.min(1, Number(v.confidence) || 0)),
    reason: String(v.reason ?? ''),
  };
}

async function attach(testInfo: TestInfo, rec: HealRecord) {
  await testInfo.attach('healing', { body: JSON.stringify(rec), contentType: 'application/json' });
}

export async function heal(page: Page, target: HealTarget, opts: { timeout?: number } = {}): Promise<Locator> {
  const testInfo = test.info();
  const started = Date.now();
  const original = page.locator(target.selector);

  // 1) Eski selector hâlâ çalışıyor mu?
  try {
    await original.first().waitFor({ state: 'visible', timeout: opts.timeout ?? 2_000 });
    if ((await original.count()) === 1) return original;
  } catch {
    /* bulunamadı -> onarmayı dene */
  }

  const base: Omit<HealRecord, 'status' | 'newSelector' | 'confidence' | 'reason' | 'truthMatch' | 'durationMs'> = {
    test: testInfo.title,
    file: testInfo.file,
    oldSelector: target.selector,
    intent: target.intent,
    candidateCount: 0,
  };
  const finish = async (rec: Partial<HealRecord> & Pick<HealRecord, 'status'>) => {
    const full: HealRecord = { newSelector: null, confidence: 0, reason: '', truthMatch: null, ...base, ...rec, durationMs: Date.now() - started };
    await attach(testInfo, full);
    return full;
  };

  if (process.env.HEAL === 'off' || !llmConfigured()) {
    await finish({ status: 'disabled', reason: process.env.HEAL === 'off' ? 'HEAL=off' : 'LLM ayarlı değil' });
    throw new Error(`Locator bulunamadı: ${target.selector} (self-healing kapalı)`);
  }

  // 2) Adayları topla ve LLM'e sor
  const candidates = await collectCandidates(page);
  base.candidateCount = candidates.length;
  const user = mask(
    `Testin amacı (intent): ${target.intent}
Eski selector: ${target.selector}
Sayfa başlığı: ${await page.title()}

Adaylar (her satır bir element, JSON):
${candidates.map((c) => JSON.stringify(c)).join('\n')}`,
  );

  let verdict: ReturnType<typeof parse>;
  try {
    verdict = parse(await callLLM(HEAL_SYSTEM_PROMPT, user));
  } catch (e) {
    await cleanup(page);
    await finish({ status: 'error', reason: (e as Error).message.slice(0, 300) });
    throw new Error(`Locator bulunamadı: ${target.selector} (AI'a ulaşılamadı: ${(e as Error).message.slice(0, 120)})`);
  }

  // 5) AI "bu element yok" dedi -> bilerek fail
  if (!verdict.found || verdict.index === null) {
    await cleanup(page);
    await finish({ status: 'refused', confidence: verdict.confidence, reason: verdict.reason });
    throw new Error(`Locator bulunamadı ve AI onarmadı: ${target.selector}. Gerekçe: ${verdict.reason}`);
  }

  // 3) Doğrula: önerilen selector tek elemente gidiyor mu ve o element AI'ın seçtiği aday mı?
  const pickedByIndex = page.locator(`[data-heal-idx="${verdict.index}"]`);
  let healed: Locator | null = null;
  let invalidReason = '';
  if (verdict.selector && /data-heal-idx|data-qa-truth/.test(verdict.selector)) {
    invalidReason = 'Önerilen selector geçici/işaret attribute kullanıyor.';
  } else if (verdict.selector) {
    try {
      const proposed = page.locator(verdict.selector);
      const count = await proposed.count();
      const sameAsPicked = count === 1 && (await proposed.getAttribute('data-heal-idx')) === String(verdict.index);
      if (count === 1 && sameAsPicked && (await proposed.isVisible())) healed = proposed;
      else invalidReason = `Önerilen selector ${count} elemente gidiyor${count === 1 ? ' ama AI\'ın seçtiği aday değil' : ''}.`;
    } catch (e) {
      invalidReason = `Önerilen selector geçersiz: ${(e as Error).message.split('\n')[0]}`;
    }
  } else {
    invalidReason = 'AI selector önermedi.';
  }

  if (!healed) {
    await cleanup(page);
    await finish({ status: 'invalid', newSelector: verdict.selector, confidence: verdict.confidence, reason: `${verdict.reason} [Doğrulama: ${invalidReason}]` });
    throw new Error(`Locator bulunamadı, AI önerisi doğrulanamadı: ${target.selector} -> ${verdict.selector}. ${invalidReason}`);
  }

  const truth = await pickedByIndex.getAttribute('data-qa-truth').catch(() => null);
  await cleanup(page);
  const rec = await finish({
    status: 'healed',
    newSelector: verdict.selector,
    confidence: verdict.confidence,
    reason: verdict.reason,
    truthMatch: truth === null ? false : true,
  });
  console.log(`🩹 ${rec.test}: ${rec.oldSelector} -> ${rec.newSelector} (%${Math.round(rec.confidence * 100)})`);
  // data-heal-idx temizlendiği için yeni selector'ın kendisini döndür
  return page.locator(verdict.selector!);
}
