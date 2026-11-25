/**
 * Playwright JSON raporunu okuyup başarısız testleri ve geçmiş istatistiklerini çıkarır.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface FailedTest {
  title: string;
  file: string;
  line: number;
  errorMessage: string;
  stack: string;
  errorSnippet: string;
  stdoutTail: string;
  durationMs: number;
  testSource: string;
  pageSnapshot: string;
  history: { runs: number; failures: number };
}

interface PwResult {
  status: string;
  duration: number;
  error?: { message?: string; stack?: string; snippet?: string };
  errors?: { message?: string }[];
  stdout?: { text?: string }[];
  stderr?: { text?: string }[];
  attachments?: { name: string; contentType?: string; path?: string; body?: string }[];
}
interface PwSpec {
  title: string;
  file: string;
  line: number;
  tests: { results: PwResult[] }[];
}
interface PwSuite {
  specs?: PwSpec[];
  suites?: PwSuite[];
}
interface PwReport {
  suites: PwSuite[];
}

const FAILED = new Set(['failed', 'timedOut', 'interrupted']);
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

export function readReport(file: string): PwReport {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as PwReport;
}

function* walkSpecs(suites: PwSuite[]): Generator<PwSpec> {
  for (const s of suites) {
    for (const spec of s.specs ?? []) yield spec;
    yield* walkSpecs(s.suites ?? []);
  }
}

/** Her testin son sonucu: geçti mi kırıldı mı (son retry esas alınır). */
export function outcomes(report: PwReport): Map<string, 'passed' | 'failed' | 'skipped'> {
  const map = new Map<string, 'passed' | 'failed' | 'skipped'>();
  for (const spec of walkSpecs(report.suites)) {
    const last = spec.tests[0]?.results.at(-1);
    if (!last) continue;
    map.set(spec.title, FAILED.has(last.status) ? 'failed' : last.status === 'passed' ? 'passed' : 'skipped');
  }
  return map;
}

/** results/history/*.json içindeki geçmiş koşulardan test başına koşu/hata sayısı. */
export function loadHistory(dir: string): Map<string, { runs: number; failures: number }> {
  const stats = new Map<string, { runs: number; failures: number }>();
  if (!fs.existsSync(dir)) return stats;
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    try {
      for (const [title, outcome] of outcomes(readReport(path.join(dir, f)))) {
        if (outcome === 'skipped') continue;
        const s = stats.get(title) ?? { runs: 0, failures: 0 };
        s.runs++;
        if (outcome === 'failed') s.failures++;
        stats.set(title, s);
      }
    } catch {
      console.warn(`⚠️  Geçmiş dosyası okunamadı, atlanıyor: ${f}`);
    }
  }
  return stats;
}

/**
 * Testin kaynak kodunu (sadece test fonksiyonu) çıkarır ve YORUMLARI SİLER.
 * Önemli: demo testlerinde "// ❌ TEST_BUG" gibi cevabı veren yorumlar var.
 * Bunlar modele giderse değerlendirme hile olur (data leakage).
 */
export function extractTestSource(file: string, line: number, rootDir: string): string {
  const candidates = [file, path.join(rootDir, file), path.join(rootDir, 'tests', file)];
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) return '';
  const lines = fs.readFileSync(found, 'utf8').split('\n');
  const out: string[] = [];
  let depth = 0;
  let started = false;
  for (let i = line - 1; i < lines.length && out.length < 60; i++) {
    const l = lines[i];
    out.push(l);
    for (const ch of l) {
      if (ch === '{') { depth++; started = true; }
      if (ch === '}') depth--;
    }
    if (started && depth <= 0) break;
  }
  return stripComments(out.join('\n'));
}

/**
 * Playwright'ın error-context.md eki, hata anındaki sayfanın erişilebilirlik ağacını
 * ("Page snapshot") içerir: görünen hata mesajları, input değerleri vb.
 * Dosyanın geri kalanında (yorumlu) test kodu ve Playwright'ın kendi talimatları var;
 * cevap sızmasın diye SADECE snapshot bölümünü alıyoruz.
 */
export function extractPageSnapshot(result: PwResult, rootDir: string): string {
  // 1) tests/fixtures.ts'in eklediği snapshot (tercih edilen, sürümden bağımsız)
  const own = result.attachments?.find((a) => a.name === 'page-snapshot');
  if (own?.body) return Buffer.from(own.body, 'base64').toString('utf8').slice(0, 3_000);
  if (own?.path && fs.existsSync(own.path)) return fs.readFileSync(own.path, 'utf8').slice(0, 3_000);

  // 2) Yedek: Playwright'ın error-context.md içindeki "Page snapshot" bölümü
  const att = result.attachments?.find((a) => a.name === 'error-context' && a.path);
  if (!att?.path) return '';
  const p = path.isAbsolute(att.path) ? att.path : path.join(rootDir, att.path);
  if (!fs.existsSync(p)) return '';
  const md = fs.readFileSync(p, 'utf8');
  const snap = md.match(/# Page snapshot\s*```[a-z]*\n([\s\S]*?)```/);
  return snap ? snap[1].trim().slice(0, 3_000) : '';
}

export function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1').trimEnd())
    .filter((l) => l.trim() !== '')
    .join('\n');
}

export function collectFailures(
  report: PwReport,
  history: Map<string, { runs: number; failures: number }>,
  rootDir: string,
): FailedTest[] {
  const failures: FailedTest[] = [];
  for (const spec of walkSpecs(report.suites)) {
    const result = spec.tests[0]?.results.at(-1);
    if (!result || !FAILED.has(result.status)) continue;
    const message = result.error?.message ?? result.errors?.map((e) => e.message).join('\n') ?? '';
    const logs = [...(result.stdout ?? []), ...(result.stderr ?? [])].map((o) => o.text ?? '').join('');
    failures.push({
      title: spec.title,
      file: spec.file,
      line: spec.line,
      errorMessage: message.replace(ANSI, '').slice(0, 2_000),
      // Stack'in başı hata mesajını tekrar eder; token harcamamak için sadece "at ..." satırları
      stack: (result.error?.stack ?? '')
        .replace(ANSI, '')
        .split('\n')
        .filter((l) => l.trim().startsWith('at '))
        .slice(0, 8)
        .join('\n'),
      errorSnippet: stripComments((result.error?.snippet ?? '').replace(ANSI, '')),
      stdoutTail: logs.split('\n').slice(-20).join('\n'),
      durationMs: result.duration,
      testSource: extractTestSource(spec.file, spec.line, rootDir),
      pageSnapshot: extractPageSnapshot(result, rootDir),
      history: history.get(spec.title) ?? { runs: 0, failures: 0 },
    });
  }
  return failures;
}
