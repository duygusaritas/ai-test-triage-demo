/**
 * Healing raporunu okur, expected-healing.json ile karşılaştırır ve onay ekranı için
 * results/healing/suggestions.json dosyasını yazar.
 *
 *   npm run heal:evaluate
 *   npm run heal:evaluate -- results/healing/report-off.json   (başka bir rapor)
 */
import fs from 'node:fs';
import path from 'node:path';
import type { HealRecord } from './heal';

type Expected = 'heal' | 'refuse' | 'none';
type Outcome =
  | 'DOĞRU_ONARIM'
  | 'YANLIŞ_ONARIM' // yanlış elemente onardı: tehlikeli
  | 'SAHTE_ONARIM' // onarmaması gerekirken onardı: gerçek bug'ı gizler, en tehlikelisi
  | 'KAÇIRILAN_ONARIM'
  | 'DOĞRU_RED'
  | 'GEREKSİZ_ÇAĞRI'
  | 'DOĞRU_ATLAMA';

const reportPath = process.argv[2] ?? 'results/healing/report.json';
if (!fs.existsSync(reportPath)) {
  console.error(`Rapor bulunamadı: ${reportPath}. Önce "npm run heal" çalıştır.`);
  process.exit(1);
}
const expected: Record<string, Expected> = JSON.parse(fs.readFileSync('expected-healing.json', 'utf8'));
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

interface Row extends Partial<HealRecord> {
  test: string;
  expected: Expected;
  outcome: Outcome;
  testPassed: boolean;
  location: string | null;
}

// Rapordaki her test: sonuç + "healing" ekleri
const tests: { title: string; passed: boolean; records: HealRecord[] }[] = [];
const walk = (suites: any[]) => {
  for (const s of suites ?? []) {
    for (const spec of s.specs ?? []) {
      const r = spec.tests?.[0]?.results?.at(-1);
      const records = (r?.attachments ?? [])
        .filter((a: any) => a.name === 'healing' && a.body)
        .map((a: any) => JSON.parse(Buffer.from(a.body, 'base64').toString('utf8')) as HealRecord);
      tests.push({ title: spec.title, passed: r?.status === 'passed', records });
    }
    walk(s.suites);
  }
};
walk(report.suites);

/** Eski selector'ın kodda geçtiği satır (onay ekranında "nerede değişecek" göstermek için) */
function locate(file: string | undefined, selector: string | undefined): string | null {
  if (!file || !selector || !fs.existsSync(file)) return null;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const i = lines.findIndex((l) => l.includes(selector));
  return i >= 0 ? `${path.relative(process.cwd(), file)}:${i + 1}` : path.relative(process.cwd(), file);
}

function classify(exp: Expected, rec: HealRecord | undefined): Outcome {
  if (!rec) return exp === 'none' ? 'DOĞRU_ATLAMA' : 'KAÇIRILAN_ONARIM';
  if (exp === 'none') return 'GEREKSİZ_ÇAĞRI';
  if (rec.status === 'healed') {
    if (exp === 'refuse') return 'SAHTE_ONARIM';
    return rec.truthMatch ? 'DOĞRU_ONARIM' : 'YANLIŞ_ONARIM';
  }
  return exp === 'refuse' ? 'DOĞRU_RED' : 'KAÇIRILAN_ONARIM';
}

const rows: Row[] = tests
  .filter((t) => expected[t.title])
  .map((t) => {
    const rec = t.records.at(-1);
    return {
      ...rec,
      test: t.title,
      expected: expected[t.title],
      outcome: classify(expected[t.title], rec),
      testPassed: t.passed,
      location: locate(rec?.file, rec?.oldSelector),
    };
  });

const ICON: Record<Outcome, string> = {
  DOĞRU_ONARIM: '✅',
  DOĞRU_RED: '✅',
  DOĞRU_ATLAMA: '✅',
  KAÇIRILAN_ONARIM: '➖',
  GEREKSİZ_ÇAĞRI: '⚠️',
  YANLIŞ_ONARIM: '❌',
  SAHTE_ONARIM: '🚨',
};

console.log(`\n=== ${reportPath} ===\n`);
for (const r of rows) {
  const conf = r.confidence !== undefined && r.status !== 'disabled' ? ` %${Math.round((r.confidence ?? 0) * 100)}` : '';
  const change = r.newSelector ? `  ${r.oldSelector} -> ${r.newSelector}` : '';
  console.log(`${ICON[r.outcome]} ${r.outcome.padEnd(16)} ${r.test}${conf}${change}`);
  if (r.reason && r.status !== 'disabled') console.log(`     ${r.reason}`);
}

const count = (o: Outcome) => rows.filter((r) => r.outcome === o).length;
const needHeal = rows.filter((r) => r.expected === 'heal').length;
const needRefuse = rows.filter((r) => r.expected === 'refuse').length;
console.log(`
Doğru onarım      : ${count('DOĞRU_ONARIM')}/${needHeal}
Doğru red (tuzak) : ${count('DOĞRU_RED')}/${needRefuse}
Yanlış onarım     : ${count('YANLIŞ_ONARIM')}   (yanlış elemente onardı)
Sahte onarım      : ${count('SAHTE_ONARIM')}   (gerçek bir bug'ı gizledi)
Kaçırılan onarım  : ${count('KAÇIRILAN_ONARIM')}
Onarma süresi     : ${rows.reduce((a, r) => a + (r.status && r.status !== 'disabled' ? r.durationMs ?? 0 : 0), 0) / 1000} sn toplam (eski selector için 2 sn bekleme dahil)`);

fs.mkdirSync('results/healing', { recursive: true });
// Onay ekranı sadece gerçek önerileri gösterir; varsa önceki kararlar korunur
const suggestions = rows.filter((r) => r.status === 'healed' || r.status === 'invalid' || r.status === 'refused');
fs.writeFileSync('results/healing/suggestions.json', JSON.stringify(suggestions, null, 2));
console.log(`\nOnay ekranı için: results/healing/suggestions.json (${suggestions.length} kayıt) -> npm run heal:review`);
