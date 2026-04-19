// Benchmark raw LLM call latency for Gemini, DeepSeek, and GPT-5 Nano at
// concurrency levels 1, 5, and 10. Bypasses the app's callLLM wrapper to
// measure pure provider latency without spending gate, semaphore, or DB overhead.
//
// Usage:
//   npx tsx evolution/scripts/benchmark-latency.ts
//   npx tsx evolution/scripts/benchmark-latency.ts --models gpt-5-nano,deepseek-chat
//   npx tsx evolution/scripts/benchmark-latency.ts --concurrency 1,5
//   npx tsx evolution/scripts/benchmark-latency.ts --calls 3

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import OpenAI from 'openai';

// ── Config ──────────────────────────────────────────────────────────

const DEFAULT_CALLS_PER_LEVEL = 5;
const DEFAULT_CONCURRENCY_LEVELS = [1, 5, 10];

interface ModelDef {
  id: string;
  provider: 'openai' | 'deepseek' | 'openrouter';
  apiModel: string;
}

const ALL_MODELS: ModelDef[] = [
  { id: 'gpt-5-nano',                  provider: 'openai',     apiModel: 'gpt-5-nano' },
  { id: 'deepseek-chat',               provider: 'deepseek',   apiModel: 'deepseek-chat' },
  { id: 'google/gemini-2.5-flash-lite', provider: 'openrouter', apiModel: 'google/gemini-2.5-flash-lite' },
];

// ~8.5K chars, similar to a typical evolution generation prompt
const BENCHMARK_PROMPT = `You are an expert writing editor. Your task is to rewrite the following article using a structural transformation strategy. AGGRESSIVELY restructure the text: reorder sections, merge or split paragraphs, invert hierarchy. Reimagine the organization from scratch.

## Original Text

# Understanding Neural Networks

Neural networks are computational models inspired by the biological neural networks in the human brain. They consist of interconnected nodes organized in layers that process information using connectionist approaches to computation.

## Architecture

The basic architecture of a neural network includes an input layer, one or more hidden layers, and an output layer. Each connection between nodes has an associated weight that is adjusted during the learning process. The input layer receives the raw data, which is then processed through the hidden layers before producing an output.

## How They Learn

Neural networks learn through a process called backpropagation. During training, the network makes predictions on input data and compares them to the expected output. The difference between the predicted and actual output, known as the error or loss, is then propagated backward through the network. Each weight is adjusted proportionally to its contribution to the error, gradually improving the network's accuracy over time.

The learning rate is a crucial hyperparameter that controls how much the weights are updated during each iteration. A learning rate that is too high can cause the network to overshoot optimal solutions, while one that is too low can result in extremely slow convergence or getting stuck in local minima.

## Types of Neural Networks

Convolutional Neural Networks (CNNs) are specialized for processing grid-like data such as images. They use convolutional layers that apply filters across the input, detecting features like edges, textures, and shapes at various levels of abstraction. CNNs have revolutionized computer vision tasks including image classification, object detection, and segmentation.

Recurrent Neural Networks (RNNs) are designed for sequential data processing. They maintain a hidden state that acts as a form of memory, allowing information from previous time steps to influence current processing. Long Short-Term Memory (LSTM) networks and Gated Recurrent Units (GRUs) are variants that address the vanishing gradient problem in standard RNNs, enabling them to capture long-range dependencies in sequences.

Transformer networks represent the latest paradigm shift in neural network architecture. They rely entirely on attention mechanisms to process sequences in parallel, rather than sequentially like RNNs. This parallelization enables significantly faster training and has led to breakthroughs in natural language processing, with models like BERT and GPT achieving state-of-the-art results across numerous benchmarks.

## Applications

Neural networks have found applications across virtually every domain of technology and science. In healthcare, they assist with medical image analysis, drug discovery, and patient outcome prediction. In finance, they power fraud detection systems, algorithmic trading strategies, and credit scoring models. In transportation, they enable autonomous driving systems and traffic optimization. The breadth of applications continues to expand as new architectures and training techniques are developed.

## Rules
- Start with a single H1 title
- Use ## or ### headings for sections
- Write complete paragraphs with two or more sentences
- No bullet points, numbered lists, or tables`;

// ── Clients ─────────────────────────────────────────────────────────

function createLLMClient(model: ModelDef): OpenAI {
  switch (model.provider) {
    case 'openai':
      if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
      return new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 30_000 });
    case 'deepseek':
      if (!process.env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY not set');
      return new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com', maxRetries: 0, timeout: 30_000 });
    case 'openrouter':
      if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY not set');
      return new OpenAI({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: 'https://openrouter.ai/api/v1', maxRetries: 0, timeout: 30_000 });
    default:
      throw new Error(`Unknown provider: ${model.provider}`);
  }
}

// ── Single call ─────────────────────────────────────────────────────

interface CallResult {
  model: string;
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  responseChars: number;
  error: string | null;
}

async function singleCall(client: OpenAI, model: ModelDef): Promise<CallResult> {
  const start = Date.now();
  try {
    const resp = await client.chat.completions.create({
      model: model.apiModel,
      messages: [{ role: 'user', content: BENCHMARK_PROMPT }],
      ...(model.apiModel.startsWith('gpt-5') ? {} : { temperature: 0 }),
    });
    const durationMs = Date.now() - start;
    const text = resp.choices[0]?.message?.content ?? '';
    return {
      model: model.id,
      durationMs,
      promptTokens: resp.usage?.prompt_tokens ?? 0,
      completionTokens: resp.usage?.completion_tokens ?? 0,
      responseChars: text.length,
      error: null,
    };
  } catch (err) {
    return {
      model: model.id,
      durationMs: Date.now() - start,
      promptTokens: 0,
      completionTokens: 0,
      responseChars: 0,
      error: err instanceof Error ? err.message.slice(0, 120) : String(err),
    };
  }
}

// ── Batch at concurrency level ──────────────────────────────────────

async function runBatch(
  client: OpenAI,
  model: ModelDef,
  concurrency: number,
  totalCalls: number,
): Promise<CallResult[]> {
  const results: CallResult[] = [];
  let remaining = totalCalls;

  while (remaining > 0) {
    const batchSize = Math.min(concurrency, remaining);
    const batch = await Promise.all(
      Array.from({ length: batchSize }, () => singleCall(client, model)),
    );
    results.push(...batch);
    remaining -= batchSize;
  }

  return results;
}

// ── Stats helpers ───────────────────────────────────────────────────

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

interface BatchSummary {
  model: string;
  concurrency: number;
  calls: number;
  errors: number;
  avgMs: number;
  medianMs: number;
  p90Ms: number;
  minMs: number;
  maxMs: number;
  avgCompletionTokens: number;
  avgResponseChars: number;
  throughputCharsPerSec: number;
}

function summarize(results: CallResult[], concurrency: number): BatchSummary {
  const ok = results.filter(r => !r.error);
  const durations = ok.map(r => r.durationMs);
  const completionTokens = ok.map(r => r.completionTokens);
  const responseChars = ok.map(r => r.responseChars);

  const avgMs = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const avgChars = responseChars.length ? responseChars.reduce((a, b) => a + b, 0) / responseChars.length : 0;

  return {
    model: results[0]?.model ?? '?',
    concurrency,
    calls: results.length,
    errors: results.filter(r => r.error).length,
    avgMs: Math.round(avgMs),
    medianMs: durations.length ? Math.round(median(durations)) : 0,
    p90Ms: durations.length ? Math.round(percentile(durations, 90)) : 0,
    minMs: durations.length ? Math.min(...durations) : 0,
    maxMs: durations.length ? Math.max(...durations) : 0,
    avgCompletionTokens: completionTokens.length ? Math.round(completionTokens.reduce((a, b) => a + b, 0) / completionTokens.length) : 0,
    avgResponseChars: Math.round(avgChars),
    throughputCharsPerSec: avgMs > 0 ? Math.round(avgChars / (avgMs / 1000)) : 0,
  };
}

// ── CLI arg parsing ─────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let models = ALL_MODELS;
  let concurrencyLevels = DEFAULT_CONCURRENCY_LEVELS;
  let callsPerLevel = DEFAULT_CALLS_PER_LEVEL;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--models' && args[i + 1]) {
      const ids = args[++i]!.split(',');
      models = ALL_MODELS.filter(m => ids.includes(m.id));
      if (!models.length) { console.error(`No matching models for: ${ids.join(', ')}`); process.exit(1); }
    } else if (args[i] === '--concurrency' && args[i + 1]) {
      concurrencyLevels = args[++i]!.split(',').map(Number);
    } else if (args[i] === '--calls' && args[i + 1]) {
      callsPerLevel = parseInt(args[++i]!, 10);
    }
  }

  return { models, concurrencyLevels, callsPerLevel };
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const { models, concurrencyLevels, callsPerLevel } = parseArgs();

  console.log(`\nBenchmark: ${models.map(m => m.id).join(', ')}`);
  console.log(`Concurrency levels: ${concurrencyLevels.join(', ')}`);
  console.log(`Calls per level: ${callsPerLevel}`);
  console.log(`Prompt length: ${BENCHMARK_PROMPT.length} chars (~${Math.ceil(BENCHMARK_PROMPT.length / 4)} tokens)`);
  console.log('');

  const allSummaries: BatchSummary[] = [];

  for (const model of models) {
    const client = createLLMClient(model);
    console.log(`── ${model.id} (${model.provider}) ──────────────────────`);

    for (const conc of concurrencyLevels) {
      process.stdout.write(`  concurrency=${conc}, ${callsPerLevel} calls... `);
      const results = await runBatch(client, model, conc, callsPerLevel);
      const summary = summarize(results, conc);
      allSummaries.push(summary);

      const errStr = summary.errors > 0 ? ` (${summary.errors} errors)` : '';
      console.log(
        `avg=${summary.avgMs}ms  med=${summary.medianMs}ms  p90=${summary.p90Ms}ms  ` +
        `min=${summary.minMs}ms  max=${summary.maxMs}ms  ` +
        `tok=${summary.avgCompletionTokens}  chars=${summary.avgResponseChars}  ` +
        `throughput=${summary.throughputCharsPerSec} chars/s${errStr}`,
      );

      // Log individual errors
      for (const r of results.filter(r => r.error)) {
        console.log(`    ERROR (${r.durationMs}ms): ${r.error}`);
      }
    }
    console.log('');
  }

  // ── Summary table ───────────────────────────────────────────────
  console.log('\n═══ Summary Table ═══════════════════════════════════════════════════════════════');
  console.log(
    'Model'.padEnd(32) +
    'Conc'.padStart(5) +
    'Avg ms'.padStart(8) +
    'Med ms'.padStart(8) +
    'P90 ms'.padStart(8) +
    'Min ms'.padStart(8) +
    'Max ms'.padStart(8) +
    'Tok'.padStart(6) +
    'Chars'.padStart(7) +
    'Ch/s'.padStart(7) +
    'Err'.padStart(5),
  );
  console.log('─'.repeat(102));
  for (const s of allSummaries) {
    console.log(
      s.model.padEnd(32) +
      String(s.concurrency).padStart(5) +
      String(s.avgMs).padStart(8) +
      String(s.medianMs).padStart(8) +
      String(s.p90Ms).padStart(8) +
      String(s.minMs).padStart(8) +
      String(s.maxMs).padStart(8) +
      String(s.avgCompletionTokens).padStart(6) +
      String(s.avgResponseChars).padStart(7) +
      String(s.throughputCharsPerSec).padStart(7) +
      String(s.errors).padStart(5),
    );
  }

  // ── JSON output ─────────────────────────────────────────────────
  const outPath = `evolution/scripts/benchmark-latency-${Date.now()}.json`;
  const fs = await import('fs');
  fs.writeFileSync(outPath, JSON.stringify({ timestamp: new Date().toISOString(), config: { callsPerLevel, concurrencyLevels: concurrencyLevels, promptLength: BENCHMARK_PROMPT.length }, summaries: allSummaries }, null, 2));
  console.log(`\nResults written to ${outPath}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
