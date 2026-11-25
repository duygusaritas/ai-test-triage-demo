/**
 * Kullanım:
 *   npm run triage                 -> LLM ile sınıflandır
 *   npm run triage:baseline        -> kural tabanlı sınıflandır (API anahtarı gerekmez)
 *   npm run triage -- --report results/history/run-03.json
 *
 * Çıktılar: results/triage.json, results/triage-report.md (+ SLACK_WEBHOOK_URL varsa Slack mesajı)
 */
import fs from 'node:fs';
import path from 'node:path';
import { collectFailures, loadHistory, readReport, type FailedTest } from './report';
import { CATEGORIES, classifyBaseline, classifyWithLLM, llmProvider, type Category, type Verdict } from './classify';

// .env varsa yükle (Node 20.12+)
try {
  if (fs.existsSync('.env')) process.loadEnvFile('.env');
} catch {
  /* eski Node: değişkenleri export ile ver */
}

const ROOT = process.cwd();
const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const useBaseline = args.includes('--baseline');
const reportPath = arg('--report') ?? path.join(ROOT, 'results/latest.json');
const outPrefix = arg('--out') ?? path.join(ROOT, useBaseline ? 'results/triage-baseline' : 'results/triage');
const CONCURRENCY = Number(process.env.TRIAGE_CONCURRENCY ?? 3);

const EMOJI: Record<Category, string> = {
  PRODUCT_BUG: '🐞',
  TEST_BUG: '🧪',
  ENVIRONMENT: '🌩️',
  FLAKY: '🎲',
  TEST_DATA: '🗃️',
};

export interface TriageItem extends Verdict {
  title: string;
  file: string;
  line: number;
  history: FailedTest['history'];
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

function toMarkdown(items: TriageItem[], mode: string): string {
  const lines = [`# Başarısız test triyajı (${mode})`, '', `Toplam başarısız test: **${items.length}**`, ''];
  for (const cat of CATEGORIES) {
    const group = items.filter((i) => i.category === cat);
    if (!group.length) continue;
    lines.push(`## ${EMOJI[cat]} ${cat} (${group.length})`, '');
    for (const g of group.sort((a, b) => b.confidence - a.confidence)) {
      const hist = g.history.runs ? ` · geçmiş ${g.history.failures}/${g.history.runs}` : '';
      lines.push(`- **${g.title}** — \`${g.file}:${g.line}\` · güven %${Math.round(g.confidence * 100)}${hist}`);
      lines.push(`  - Neden: ${g.reason}`);
      if (g.suggested_action && g.suggested_action !== '-') lines.push(`  - Öneri: ${g.suggested_action}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function postToSlack(items: TriageItem[]) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  const counts = CATEGORIES.map((c) => [c, items.filter((i) => i.category === c).length] as const).filter(([, n]) => n);
  const bugs = items.filter((i) => i.category === 'PRODUCT_BUG');
  const text = [
    `*Gece regresyonu: ${items.length} başarısız test*`,
    counts.map(([c, n]) => `${EMOJI[c]} ${c}: ${n}`).join('  ·  '),
    bugs.length ? `\n*Önce bunlara bak (olası gerçek bug):*\n${bugs.map((b) => `• ${b.title} — ${b.reason}`).join('\n')}` : '',
  ].join('\n');
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
  console.log(res.ok ? '📨 Slack mesajı gönderildi' : `⚠️  Slack hatası: ${res.status}`);
}

async function main() {
  if (!fs.existsSync(reportPath)) {
    console.error(`Rapor bulunamadı: ${reportPath}\nÖnce "npm test" veya "npm run test:history" çalıştır.`);
    process.exit(1);
  }
  if (!useBaseline && !llmProvider()) {
    console.error('LLM ayarlı değil. ANTHROPIC_API_KEY / OPENAI_API_KEY tanımla ya da "npm run triage:baseline" kullan.');
    process.exit(1);
  }

  const history = loadHistory(path.join(ROOT, 'results/history'));
  const failures = collectFailures(readReport(reportPath), history, ROOT);
  const mode = useBaseline ? 'kural tabanlı' : `LLM: ${llmProvider()} / ${process.env.LLM_MODEL ?? 'varsayılan model'}`;
  console.log(`🔎 ${failures.length} başarısız test bulundu (${mode})\n`);

  const started = Date.now();
  const items = await mapLimit(failures, useBaseline ? 1 : CONCURRENCY, async (f) => {
    let verdict: Verdict;
    try {
      verdict = useBaseline ? classifyBaseline(f) : await classifyWithLLM(f);
    } catch (e) {
      console.warn(`⚠️  ${f.title}: ${(e as Error).message} -> kural tabanlıya düşüldü`);
      verdict = { ...classifyBaseline(f), reason: `(LLM hatası, kural tabanlı) ${classifyBaseline(f).reason}` };
    }
    console.log(`${EMOJI[verdict.category]} ${verdict.category.padEnd(11)} %${String(Math.round(verdict.confidence * 100)).padStart(3)}  ${f.title}`);
    return { title: f.title, file: f.file, line: f.line, history: f.history, ...verdict } satisfies TriageItem;
  });

  fs.mkdirSync(path.dirname(outPrefix), { recursive: true });
  fs.writeFileSync(`${outPrefix}.json`, JSON.stringify(items, null, 2));
  fs.writeFileSync(`${outPrefix}-report.md`, toMarkdown(items, mode));
  console.log(`\n✅ ${((Date.now() - started) / 1000).toFixed(1)} sn · ${outPrefix}.json · ${outPrefix}-report.md`);
  await postToSlack(items);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
