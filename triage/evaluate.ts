/**
 * AI (veya baseline) tahminlerini expected.json ile karşılaştırır.
 *   npm run evaluate                                   -> results/triage.json
 *   npm run evaluate -- results/triage-baseline.json   -> baseline
 *   npm run evaluate -- results/triage.json results/triage-baseline.json  -> yan yana
 */
import fs from 'node:fs';
import { CATEGORIES, type Category } from './classify';

const expected: Record<string, Category> = JSON.parse(fs.readFileSync('expected.json', 'utf8'));
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['results/triage.json'];

function evaluate(file: string) {
  const items: { title: string; category: Category }[] = JSON.parse(fs.readFileSync(file, 'utf8'));
  const scored = items.filter((i) => expected[i.title]);
  const unknown = items.filter((i) => !expected[i.title]);
  const correct = scored.filter((i) => expected[i.title] === i.category);

  console.log(`\n=== ${file} ===`);
  console.log(`Doğruluk: ${correct.length}/${scored.length} (%${scored.length ? Math.round((100 * correct.length) / scored.length) : 0})`);

  // Karışıklık matrisi: satır = gerçek, sütun = tahmin
  const short = (c: string) => c.replace('PRODUCT_', 'P_').replace('ENVIRONMENT', 'ENV').replace('TEST_', 'T_');
  const header = ['gerçek \\ tahmin'.padEnd(16), ...CATEGORIES.map((c) => short(c).padStart(7))].join('');
  console.log(`\n${header}`);
  for (const actual of CATEGORIES) {
    const row = CATEGORIES.map((pred) =>
      String(scored.filter((i) => expected[i.title] === actual && i.category === pred).length || '·').padStart(7),
    );
    console.log(`${short(actual).padEnd(16)}${row.join('')}`);
  }

  const wrong = scored.filter((i) => expected[i.title] !== i.category);
  if (wrong.length) {
    console.log('\nYanlış sınıflandırılanlar:');
    for (const w of wrong) console.log(`  ✗ ${w.title}: beklenen ${expected[w.title]}, tahmin ${w.category}`);
  }
  if (unknown.length) console.log(`\n(expected.json'da olmayan ${unknown.length} test atlandı)`);
  return { file, accuracy: scored.length ? correct.length / scored.length : 0, n: scored.length };
}

const results = files.filter((f) => {
  if (!fs.existsSync(f)) console.warn(`⚠️  Bulunamadı: ${f}`);
  return fs.existsSync(f);
}).map(evaluate);

if (results.length > 1) {
  console.log('\n=== Özet ===');
  for (const r of results) console.log(`${r.file.padEnd(40)} %${Math.round(r.accuracy * 100)} (${r.n} test)`);
}
