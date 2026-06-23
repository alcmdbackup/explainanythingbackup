// One-off probe: make a minimal gpt-4o-mini chat call and report status/cost.
// Delete after use.
import 'dotenv/config';
import OpenAI from 'openai';

async function main() {
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
    const reply = resp.choices[0]?.message?.content ?? '<no content>';
    const u = resp.usage;
    const estCostUsd = u ? (u.prompt_tokens * 0.15 / 1_000_000) + (u.completion_tokens * 0.60 / 1_000_000) : null;
    console.log(JSON.stringify({
      ok: true,
      reply,
      model: resp.model,
      latencyMs: ms,
      usage: u,
      estCostUsd,
    }, null, 2));
  } catch (err: any) {
    const ms = Date.now() - started;
    console.log(JSON.stringify({
      ok: false,
      latencyMs: ms,
      status: err?.status ?? null,
      code: err?.code ?? null,
      type: err?.type ?? null,
      message: err?.message ?? String(err),
      body: err?.error ?? null,
    }, null, 2));
    process.exit(1);
  }
}
main();
