/**
 * Log'lar API'ye gitmeden önce hassas verileri maskeler (KVKK / güvenlik).
 * Kendi projene özel değerleri MASK_VALUES="deger1,deger2" ile ekleyebilirsin.
 */
const PATTERNS: [RegExp, string][] = [
  [/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer ***'],
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g, '***JWT***'],
  [/(password|passwd|pwd|secret|token|api[_-]?key)(["'\s:=]+)([^\s"',;]+)/gi, '$1$2***'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '***@***'],
  [/\b[1-9]\d{10}\b/g, '***TCKN***'],
  [/\b(?:\d[ -]?){13,19}\b/g, '***KART***'],
  [/\bTR\d{2}(?:\s?\d{4}){5}\s?\d{2}\b/gi, '***IBAN***'],
];

const custom = (process.env.MASK_VALUES ?? '')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);

export function mask(text: string): string {
  let out = text;
  for (const v of custom) out = out.split(v).join('***');
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}
