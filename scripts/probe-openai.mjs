// One-off probe: minimal gpt-4o-mini chat call. Run with: node scripts/probe-openai.mjs
// Delete after use.
import { config } from 'dotenv';
import OpenAI from 'openai';

config({ path: '.env.local' });
config({ path: '.env' });

const key = process.env.OPENAI_API_KEY;
if (!key) { console.error('OPENAI_API_KEY missing'); process.exit(2); }
const client = new OpenAI({ apiKey: key });
const started = Date.now();
try {
  const resp = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'reply with the single word: pong' }],
    max_tokens: 5,
    temperature: 0,
  });
  const ms = Date.now() - started;
  const u = resp.usage;
  const estCostUsd = u
    ? (u.prompt_tokens * 0.15 / 1_000_000) + (u.completion_tokens * 0.60 / 1_000_000)
    : null;
  console.log(JSON.stringify({
    ok: true,
    reply: resp.choices[0]?.message?.content ?? '<no content>',
    model: resp.model,
    latencyMs: ms,
    usage: u,
    estCostUsd,
  }, null, 2));
} catch (err) {
  console.log(JSON.stringify({
    ok: false,
    latencyMs: Date.now() - started,
    status: err?.status ?? null,
    code: err?.code ?? null,
    type: err?.type ?? null,
    message: err?.message ?? String(err),
    body: err?.error ?? null,
  }, null, 2));
  process.exit(1);
}
