/**
 * Sınıflandırıcılar:
 *  - classifyWithLLM: Anthropic veya OpenAI uyumlu API (Ollama ile lokal model dahil)
 *  - classifyBaseline: kural tabanlı (regex) sınıflandırıcı; LLM'i kıyaslamak için taban çizgi
 */
import type { FailedTest } from './report';
import { mask } from './mask';

export const CATEGORIES = ['PRODUCT_BUG', 'TEST_BUG', 'ENVIRONMENT', 'FLAKY', 'TEST_DATA'] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Verdict {
  category: Category;
  confidence: number;
  reason: string;
  suggested_action: string;
}

export const SYSTEM_PROMPT = `Sen deneyimli bir QA mühendisisin. Görevin, CI'da başarısız olan bir otomasyon testinin
KÖK NEDENİNİ aşağıdaki kategorilerden TAM OLARAK BİRİNE atamak:

- PRODUCT_BUG: Uygulama yanlış davranıyor. Test doğru yazılmış, beklenti mantıklı, ama ürün beklentiyi karşılamıyor.
- TEST_BUG: Test kodunun kendisi hatalı: yanlış/eskimiş locator, yanlış beklenen değer, hatalı test mantığı.
- ENVIRONMENT: Altyapı sorunu: servis kapalı, 5xx, DNS/ağ hatası, bağlantı reddi, deploy sırasında koşu.
- FLAKY: Zamanlama/yarış durumu. Aynı kodla bazen geçip bazen kırılıyor; sınırda timeout'lar. Geçmişte hem geçip hem kırıldıysa güçlü işarettir.
- TEST_DATA: Test verisi sorunu: kullanıcı kilitli/silinmiş, kayıt bulunamadı (404), veri tükenmiş.

Kurallar:
- Hata mesajını, test kodunu ve geçmiş istatistiğini BİRLİKTE değerlendir.
- Bir locator hiç bulunamıyorsa ve sayfa yüklenmişse genelde TEST_BUG'dır; ama element var ve davranış yanlışsa PRODUCT_BUG'dır.
- Emin değilsen confidence değerini düşür, uydurma.
- SADECE şu JSON'u döndür, başka metin yazma:
{"category": "<KATEGORI>", "confidence": <0-1>, "reason": "<Türkçe, en fazla 2 cümle>", "suggested_action": "<Türkçe, tek cümle>"}`;

export function buildUserPrompt(t: FailedTest): string {
  const { runs, failures } = t.history;
  const historyLine =
    runs > 0 ? `Son ${runs} koşuda ${failures} kez kırıldı, ${runs - failures} kez geçti.` : 'Geçmiş veri yok.';
  return mask(`## Test
Ad: ${t.title}
Dosya: ${t.file}:${t.line}
Süre: ${t.durationMs} ms
Geçmiş: ${historyLine}

## Hata mesajı
${t.errorMessage}

## Hata noktası (kod)
${t.errorSnippet || '-'}

## Stack trace (kısaltılmış)
${t.stack || '-'}

## Test kodu
\`\`\`ts
${t.testSource || '-'}
\`\`\`

## Hata anında sayfa (erişilebilirlik ağacı)
${t.pageSnapshot || '-'}

## Log (son satırlar)
${t.stdoutTail || '-'}`);
}

function parseVerdict(raw: string): Verdict {
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error(`Modelden JSON alınamadı: ${raw.slice(0, 200)}`);
  const v = JSON.parse(json);
  const category = String(v.category ?? '').toUpperCase() as Category;
  if (!CATEGORIES.includes(category)) throw new Error(`Geçersiz kategori: ${v.category}`);
  return {
    category,
    confidence: Math.max(0, Math.min(1, Number(v.confidence) || 0)),
    reason: String(v.reason ?? ''),
    suggested_action: String(v.suggested_action ?? ''),
  };
}

async function callAnthropic(user: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
      // Workspace'e bağlı olmayan anahtarlar için gerekli
      ...(process.env.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID } : {}),
    },
    body: JSON.stringify({
      model: process.env.LLM_MODEL ?? 'claude-sonnet-5-5',
      max_tokens: 400,
      // Güncel Claude modelleri `temperature` parametresini kabul etmiyor (400 döner)
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content: { type: string; text?: string }[] };
  return data.content.map((c) => c.text ?? '').join('');
}

/** OpenAI ve OpenAI uyumlu API'ler (Ollama: OPENAI_BASE_URL=http://localhost:11434/v1). */
async function callOpenAICompatible(user: string): Promise<string> {
  const base = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.OPENAI_API_KEY ?? 'ollama'}`,
    },
    body: JSON.stringify({
      model: process.env.LLM_MODEL ?? 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI uyumlu API ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message.content ?? '';
}

export function llmProvider(): 'anthropic' | 'openai' | null {
  const p = process.env.LLM_PROVIDER?.toLowerCase();
  if (p === 'anthropic' || p === 'openai') return p;
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL) return 'openai';
  return null;
}

export async function classifyWithLLM(t: FailedTest): Promise<Verdict> {
  const user = buildUserPrompt(t);
  const provider = llmProvider();
  if (!provider) throw new Error('LLM ayarlı değil. ANTHROPIC_API_KEY veya OPENAI_API_KEY / OPENAI_BASE_URL tanımla.');
  for (let attempt = 1; ; attempt++) {
    try {
      const raw = provider === 'anthropic' ? await callAnthropic(user) : await callOpenAICompatible(user);
      return parseVerdict(raw);
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 1_000 * attempt));
    }
  }
}

/** Kural tabanlı taban çizgi. Yazıda "regex ile nereye kadar gidilir?" karşılaştırması için. */
export function classifyBaseline(t: FailedTest): Verdict {
  const msg = `${t.errorMessage}\n${t.stack}`;
  const { runs, failures } = t.history;
  const v = (category: Category, reason: string, confidence = 0.6): Verdict => ({
    category,
    confidence,
    reason,
    suggested_action: '-',
  });

  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|getaddrinfo|socket hang up|net::ERR_/i.test(msg))
    return v('ENVIRONMENT', 'Ağ/DNS hatası');
  if (/Received:\s*5\d\d\b/.test(msg)) return v('ENVIRONMENT', '5xx yanıt');
  if (runs >= 3 && failures > 0 && failures < runs) return v('FLAKY', `Geçmişte ${failures}/${runs} kırılma`);
  if (/locked out/i.test(`${msg}\n${t.pageSnapshot}`)) return v('TEST_DATA', 'Kilitli kullanıcı');
  if (/Received:\s*404\b/.test(msg)) return v('TEST_DATA', '404 - kayıt yok');
  // Element HİÇ bulunamadıysa (resolve olmadıysa) locator hatası say.
  // "locator resolved to ..." varsa element var demektir; o zaman sorun değer/davranışta.
  if (/waiting for locator/i.test(msg) && /Timeout|exceeded/i.test(msg) && !/locator resolved to/i.test(msg))
    return v('TEST_BUG', 'Locator bulunamadı');
  return v('PRODUCT_BUG', 'Diğer kurallara uymadı (varsayılan)', 0.3);
}