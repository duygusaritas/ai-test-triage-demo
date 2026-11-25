/**
 * Test suite'ini N kez koşturup her raporu results/history/ altına kaydeder.
 * Flaky testlerin "bazen geçiyor, bazen kırılıyor" geçmişini bu oluşturur.
 *   npm run test:history          -> 10 koşu
 *   npm run test:history -- 20    -> 20 koşu
 * Son koşu ayrıca results/latest.json olarak kopyalanır (triage onu okur).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const runs = Number(process.argv[2] ?? 10);
const dir = path.join('results', 'history');
fs.mkdirSync(dir, { recursive: true });

for (let i = 1; i <= runs; i++) {
  const out = path.join(dir, `run-${String(i).padStart(2, '0')}.json`);
  console.log(`\n▶️  Koşu ${i}/${runs}`);
  // Kırmızı test olması beklenen bir durum; çıkış kodunu yok sayıyoruz.
  spawnSync('npx', ['playwright', 'test', '--reporter=dot,json'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: out },
  });
  if (fs.existsSync(out)) fs.copyFileSync(out, path.join('results', 'latest.json'));
}
console.log(`\n✅ ${runs} koşu tamamlandı -> ${dir}`);
