/**
 * Healing modülü için LLM çağrısı (Anthropic veya OpenAI uyumlu / Ollama).
 * triage/classify.ts ile aynı ortam değişkenlerini kullanır.
 */
import fs from 'node:fs';

try {
  if (fs.existsSync('.env')) process.loadEnvFile('.env');
} catch {
  /* eski Node: değişkenleri export ile ver */
}

export function llmConfigured(): 'anthropic' | 'openai' | null {
  const p = process.env.LLM_PROVIDER?.toLowerCase();
  if (p === 'anthropic' || p === 'openai') return p;
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL) return 'openai';
  return null;
}

export async function callLLM(system: string, user: string): Promise<string> {
  const provider = llmConfigured();
  if (!provider) throw new Error('LLM ayarlı değil (.env: ANTHROPIC_API_KEY veya OPENAI_API_KEY / OPENAI_BASE_URL)');

  if (provider === 'anthropic') {
    const res = await fetch(process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
        ...(process.env.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID } : {}),
      },
      body: JSON.stringify({
        model: process.env.LLM_MODEL ?? 'claude-sonnet-5-5',
        max_tokens: 500,
        // Current Claude models reject `temperature` (400), so it is not sent
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { content: { text?: string }[] };
    return data.content.map((c) => c.text ?? '').join('');
  }

  const base = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY ?? 'ollama'}` },
    body: JSON.stringify({
      model: process.env.LLM_MODEL ?? 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI uyumlu API ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message.content ?? '';
}
