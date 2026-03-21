// Standalone CLI for running the V2 evolution pipeline on a local markdown file or topic prompt.
// Creates its own LLM provider and Supabase client to avoid Next.js import chain.
//
// Usage:
//   npx tsx scripts/run-evolution-local.ts --file docs/sample_evolution_content/filler_words.md --mock
//   npx tsx scripts/run-evolution-local.ts --file docs/sample_evolution_content/filler_words.md --iterations 3
//   npx tsx scripts/run-evolution-local.ts --prompt "Explain quantum entanglement" --model deepseek-chat --iterations 5

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

import { calculateLLMCost } from '../../src/config/llmPricing';
import { toEloScale } from '../src/lib/shared/rating';
import {
  evolveArticle,
  generateSeedArticle,
  createRunLogger,
  upsertStrategy,
} from '../src/lib/pipeline';
import type { EvolutionConfig, EvolutionResult, RunLogger } from '../src/lib/pipeline';

// ─── Types ────────────────────────────────────────────────────────

interface CLIArgs {
  file: string | null;
  prompt: string | null;
  seedModel: string | null;
  mock: boolean;
  iterations: number;
  budget: number;
  output: string;
  explanationId: number | null;
  model: string;
  judgeModel: string | null;
  strategiesPerRound: number | null;
}

// ─── CLI Argument Parsing ────────────────────────────────────────

function parseArgs(): CLIArgs {
  const args = process.argv.slice(2);

  function getFlag(name: string): boolean {
    return args.includes(`--${name}`);
  }

  function getValue(name: string): string | undefined {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
  }

  if (getFlag('help') || args.length === 0) {
    console.log(`Usage: npx tsx scripts/run-evolution-local.ts [options]

Options:
  --file <path>              Markdown file to evolve (required unless --prompt)
  --prompt <text>            Topic prompt — generates seed article then evolves (required unless --file)
  --seed-model <name>        Model for seed article generation (default: same as --model)
  --mock                     Use mock LLM (no API keys needed)
  --iterations <n>           Number of iterations (default: 3)
  --budget <n>               Budget cap in USD (default: 5.00)
  --output <path>            Output JSON path (default: auto-generated)
  --explanation-id <n>       Optional: link run to an explanation in DB
  --model <name>             LLM model for generation (default: deepseek-chat)
  --judge-model <name>       Override judge model for comparison (default: same as --model)
  --strategies-per-round <n> Number of generation strategies per iteration (default: 3)
  --help                     Show this help message`);
    process.exit(0);
  }

  const file = getValue('file');
  const prompt = getValue('prompt');

  if (!file && !prompt) {
    console.error('Error: either --file or --prompt is required');
    process.exit(1);
  }

  if (file && prompt) {
    console.error('Error: --file and --prompt are mutually exclusive');
    process.exit(1);
  }

  let resolvedFile: string | null = null;
  if (file) {
    resolvedFile = path.resolve(file);
    if (!fs.existsSync(resolvedFile)) {
      console.error(`Error: File not found: ${resolvedFile}`);
      process.exit(1);
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const defaultOutput = `evolution-output-${timestamp}.json`;

  const iterations = parseInt(getValue('iterations') ?? '3', 10);
  const strategiesRaw = getValue('strategies-per-round');

  return {
    file: resolvedFile,
    prompt: prompt ?? null,
    seedModel: getValue('seed-model') ?? null,
    mock: getFlag('mock'),
    iterations,
    budget: parseFloat(getValue('budget') ?? '5.00'),
    output: getValue('output') ?? defaultOutput,
    explanationId: getValue('explanation-id') ? parseInt(getValue('explanation-id')!, 10) : null,
    model: getValue('model') ?? 'deepseek-chat',
    judgeModel: getValue('judge-model') ?? null,
    strategiesPerRound: strategiesRaw ? parseInt(strategiesRaw, 10) : null,
  };
}

// ─── Console Logger (implements RunLogger) ───────────────────────

function createConsoleLogger(): RunLogger {
  function log(level: string, message: string, ctx?: Record<string, unknown>) {
    const ts = new Date().toISOString().slice(11, 23);
    const extra = ctx && Object.keys(ctx).length > 0 ? ` ${JSON.stringify(ctx)}` : '';
    const prefix: Record<string, string> = {
      info: '\x1b[36mINFO\x1b[0m',
      warn: '\x1b[33mWARN\x1b[0m',
      error: '\x1b[31mERR \x1b[0m',
      debug: '\x1b[90mDBG \x1b[0m',
    };
    console.log(`[${ts}] ${prefix[level] ?? level.toUpperCase()} ${message}${extra}`);
  }

  return {
    info: (msg, ctx) => log('info', msg, ctx),
    warn: (msg, ctx) => log('warn', msg, ctx),
    error: (msg, ctx) => log('error', msg, ctx),
    debug: (msg, ctx) => log('debug', msg, ctx),
  };
}

// ─── LLM Provider ────────────────────────────────────────────────
// Raw provider object matching V2's { complete(prompt, label, opts?) } interface.

function createMockLLMProvider(): { complete(prompt: string, label: string, opts?: { model?: string }): Promise<string> } {
  let callCount = 0;

  const textTemplates = [
    '# Building a Great API\n\n## Endpoint Design\n\nWhen building an API, start by designing your endpoints thoughtfully. Define your resources clearly and map them to RESTful operations.\n\n## Authentication\n\nImplement authentication using JWT tokens to protect your routes. This ensures only authorized clients can access sensitive endpoints.\n\n## Database and Testing\n\nNormalize your database schema to prevent data anomalies. Write comprehensive tests to validate every path through your API.',
    '# API Development Guide\n\n## Planning Your Resources\n\nAPIs succeed through careful planning of resource endpoints. Each resource needs clear CRUD operations that map to your domain model.\n\n## Security Layer\n\nAuthentication with JWT or OAuth protects your routes from unauthorized access. Always validate tokens on every request to ensure security.\n\n## Error Handling\n\nReturn proper status codes so clients understand what happened. Use 404 for missing resources, 400 for bad requests, and 500 for server errors.',
    '# How to Build Robust APIs\n\n## Designing Endpoints\n\nDesign RESTful endpoints that map cleanly to your domain resources. Each endpoint should represent a single resource with well-defined operations.\n\n## Implementing Security\n\nToken-based authentication is essential for any production API. JWT tokens provide a stateless mechanism for verifying client identity.\n\n## Schema and Validation\n\nDesign a properly normalized database schema to support your endpoints. Add comprehensive error handling with appropriate HTTP status codes for every failure mode.',
  ];

  const comparisonResponses = ['A', 'B', 'A', 'TIE', 'B', 'A'];

  const structuredTemplates = [
    'clarity: A\nflow: A\nengagement: B\nvoice_fidelity: A\nconciseness: TIE\nOVERALL_WINNER: A\nCONFIDENCE: high',
    'clarity: B\nflow: A\nengagement: A\nvoice_fidelity: TIE\nconciseness: B\nOVERALL_WINNER: B\nCONFIDENCE: medium',
    'clarity: A\nflow: TIE\nengagement: A\nvoice_fidelity: A\nconciseness: A\nOVERALL_WINNER: A\nCONFIDENCE: high',
  ];

  return {
    async complete(prompt: string, _label: string, _opts?: { model?: string }): Promise<string> {
      callCount++;
      await new Promise((r) => setTimeout(r, 30 + Math.random() * 40));

      if (prompt.includes('OVERALL_WINNER') && prompt.includes('Evaluation Dimensions')) {
        return structuredTemplates[(callCount - 1) % structuredTemplates.length];
      }
      if (prompt.includes('## Text A') && prompt.includes('## Text B')) {
        return comparisonResponses[(callCount - 1) % comparisonResponses.length];
      }
      return textTemplates[(callCount - 1) % textTemplates.length];
    },
  };
}

function createDirectLLMProvider(
  model: string,
  logger: RunLogger,
  supabase: SupabaseClient | null = null,
): { complete(prompt: string, label: string, opts?: { model?: string }): Promise<string> } {
  const isLocal = model.startsWith('LOCAL_');
  const apiModel = isLocal ? model.replace(/^LOCAL_/, '') : model;
  const isDeepSeek = model.startsWith('deepseek-');
  const isAnthropic = model.startsWith('claude-');

  if (isAnthropic) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY required for Claude models');
    const anthropicClient = new Anthropic({ apiKey: key, maxRetries: 3, timeout: 60000 });

    return {
      async complete(prompt: string, label: string, opts?: { model?: string }): Promise<string> {
        const useModel = opts?.model ?? model;
        logger.debug(`LLM call (Anthropic)`, { phaseName: label, iteration: undefined });

        const message = await anthropicClient.messages.create({
          model: useModel,
          max_tokens: 8192,
          messages: [{ role: 'user', content: prompt }],
        });

        const content = message.content[0]?.type === 'text' ? message.content[0].text : '';
        if (!content || content.trim() === '') {
          throw new Error(`Empty response from Anthropic (label=${label})`);
        }

        const promptTokens = message.usage.input_tokens;
        const completionTokens = message.usage.output_tokens;
        const cost = calculateLLMCost(useModel, promptTokens, completionTokens, 0);

        if (supabase) {
          void Promise.resolve(
            supabase.from('llmCallTracking').insert({
              userid: '00000000-0000-0000-0000-000000000000',
              prompt,
              content,
              call_source: `evolution_v2_${label}`,
              raw_api_response: JSON.stringify({ provider: 'anthropic', model: useModel, usage: message.usage }),
              model: useModel,
              prompt_tokens: promptTokens,
              completion_tokens: completionTokens,
              total_tokens: promptTokens + completionTokens,
              reasoning_tokens: 0,
              finish_reason: message.stop_reason ?? 'end_turn',
              estimated_cost_usd: cost,
            }),
          ).then(({ error: trackErr }) => {
            if (trackErr) logger.warn('llmCallTracking insert failed', { phaseName: label });
          }).catch(() => { /* non-critical tracking */ });
        }

        return content;
      },
    };
  }

  // OpenAI / DeepSeek / Local path (OpenAI-compatible API)
  const client = (() => {
    if (isLocal) {
      return new OpenAI({
        apiKey: 'local',
        baseURL: process.env.LOCAL_LLM_BASE_URL || 'http://localhost:11434/v1',
        maxRetries: 3,
        timeout: 300000,
      });
    }
    if (isDeepSeek) {
      const key = process.env.DEEPSEEK_API_KEY;
      if (!key) throw new Error('DEEPSEEK_API_KEY required for deepseek models');
      return new OpenAI({ apiKey: key, baseURL: 'https://api.deepseek.com', maxRetries: 3, timeout: 60000 });
    }
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY required for OpenAI models');
    return new OpenAI({ apiKey: key, maxRetries: 3, timeout: 60000 });
  })();

  return {
    async complete(prompt: string, label: string, opts?: { model?: string }): Promise<string> {
      const useModel = opts?.model ?? apiModel;
      logger.debug(`LLM call`, { phaseName: label, iteration: undefined });

      const response = await client.chat.completions.create({
        model: useModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
      });

      const content = response.choices[0]?.message?.content;
      if (!content || content.trim() === '') {
        throw new Error(`Empty response from LLM (label=${label})`);
      }

      const usage = response.usage;
      const promptTokens = usage?.prompt_tokens ?? 0;
      const completionTokens = usage?.completion_tokens ?? 0;
      const cost = calculateLLMCost(opts?.model ?? model, promptTokens, completionTokens, 0);

      if (supabase) {
        void Promise.resolve(
          supabase.from('llmCallTracking').insert({
            userid: '00000000-0000-0000-0000-000000000000',
            prompt,
            content,
            call_source: `evolution_v2_${label}`,
            raw_api_response: JSON.stringify(response.choices[0] ?? {}),
            model: opts?.model ?? model,
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: usage?.total_tokens ?? 0,
            reasoning_tokens: 0,
            finish_reason: response.choices[0]?.finish_reason ?? 'unknown',
            estimated_cost_usd: cost,
          }),
        ).then(({ error: trackErr }) => {
          if (trackErr) logger.warn('llmCallTracking insert failed', { phaseName: label });
        }).catch(() => { /* non-critical tracking */ });
      }

      return content;
    },
  };
}

// ─── Supabase Client ─────────────────────────────────────────────

function getSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// ─── Supabase Run Tracking ───────────────────────────────────────

async function createRunRecord(
  supabase: SupabaseClient,
  runId: string,
  explanationId: number | null,
  source: string,
  config: EvolutionConfig,
): Promise<boolean> {
  try {
    const strategyConfigId = await upsertStrategy(supabase, {
      generationModel: config.generationModel,
      judgeModel: config.judgeModel,
      iterations: config.iterations,
    });

    const { error } = await supabase.from('evolution_runs').insert({
      id: runId,
      explanation_id: explanationId,
      source,
      status: 'pending',
      budget_cap_usd: config.budgetUsd,
      strategy_config_id: strategyConfigId,
    });
    if (error) {
      console.warn(`DB: Failed to create run record: ${error.message}`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn(`DB: Failed to create run record: ${e}`);
    return false;
  }
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  const logger = createConsoleLogger();
  const runId = uuidv4();

  console.log('\n┌─────────────────────────────────────────┐');
  console.log('│  Evolution Pipeline V2 — Local CLI       │');
  console.log('└─────────────────────────────────────────┘\n');

  const inputLabel = args.prompt
    ? `prompt: "${args.prompt}"`
    : `file: ${path.basename(args.file!)}`;

  const judgeModel = args.judgeModel ?? args.model;

  logger.info('Configuration', {
    input: inputLabel,
    mode: args.mock ? 'mock' : 'real',
    iterations: args.iterations,
    budget: args.budget,
    model: args.model,
    judgeModel,
    seedModel: args.seedModel ?? args.model,
    runId: runId.slice(0, 8),
  });

  const config: EvolutionConfig = {
    iterations: args.iterations,
    budgetUsd: args.budget,
    judgeModel,
    generationModel: args.model,
    ...(args.strategiesPerRound != null && { strategiesPerRound: args.strategiesPerRound }),
  };

  // Set up Supabase tracking
  const supabase = getSupabase();
  let dbTracking = false;
  if (supabase) {
    const source = args.explanationId !== null
      ? 'explanation'
      : args.prompt
        ? `prompt:${args.prompt.slice(0, 50)}`
        : `local:${path.basename(args.file!)}`;
    dbTracking = await createRunRecord(supabase, runId, args.explanationId, source, config);
    if (dbTracking) {
      logger.info('DB tracking enabled', { source, explanationId: args.explanationId });
    }
  } else {
    logger.info('Supabase not configured — file output only');
  }

  const llmProvider = args.mock
    ? createMockLLMProvider()
    : createDirectLLMProvider(args.model, logger, supabase);

  let originalText: string;
  let title: string;

  if (args.prompt) {
    const seedModel = args.seedModel ?? args.model;
    const seedProvider = (args.mock || seedModel === args.model)
      ? llmProvider
      : createDirectLLMProvider(seedModel, logger, supabase);

    logger.info('Generating seed article...', { seedModel });
    const seed = await generateSeedArticle(args.prompt, seedProvider);
    originalText = seed.content;
    title = seed.title;
  } else {
    originalText = fs.readFileSync(args.file!, 'utf-8');
    title = path.basename(args.file!, path.extname(args.file!));
  }

  logger.info('Input loaded', { chars: originalText.length, words: originalText.split(/\s+/).length });

  const runLogger: RunLogger = (supabase && dbTracking)
    ? createRunLogger(runId, supabase)
    : logger;

  const db = supabase ?? createClient('http://localhost:54321', 'dummy-key', {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const startMs = Date.now();
  try {
    const result: EvolutionResult = await evolveArticle(
      originalText,
      llmProvider,
      db,
      runId,
      config,
      { logger: runLogger },
    );

    const durationMs = Date.now() - startMs;

    const rankings = [...result.ratings.entries()]
      .map(([id, r]) => ({ id, mu: r.mu }))
      .sort((a, b) => b.mu - a.mu)
      .map(({ id, mu }, rank) => {
        const variant = result.pool.find((v) => v.id === id);
        return {
          rank: rank + 1,
          id,
          elo: Math.round(toEloScale(mu)),
          strategy: variant?.strategy ?? 'unknown',
          textPreview: variant?.text.slice(0, 120) ?? '',
        };
      });

    const output = {
      runId,
      stopReason: result.stopReason,
      durationMs,
      dbTracked: dbTracking,
      iterations: result.iterationsRun,
      totalVariants: result.pool.length,
      costSummary: {
        totalUsd: result.totalCost,
      },
      rankings,
      winnerText: result.winner.text,
      winnerStrategy: result.winner.strategy,
    };
    const outputPath = path.resolve(args.output);
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    logger.info('Output written', { path: outputPath });

    console.log('\n┌─────────────────────────────────────────┐');
    console.log('│  Results Summary                         │');
    console.log('└─────────────────────────────────────────┘\n');
    console.log(`  Run ID:      ${runId.slice(0, 8)}`);
    console.log(`  Stop reason: ${result.stopReason}`);
    console.log(`  Duration:    ${(durationMs / 1000).toFixed(1)}s`);
    console.log(`  Iterations:  ${result.iterationsRun}`);
    console.log(`  Variants:    ${result.pool.length}`);
    console.log(`  Total cost:  $${result.totalCost.toFixed(4)}`);
    console.log(`  DB tracked:  ${dbTracking ? 'yes' : 'no'}`);
    console.log(`  Output:      ${outputPath}\n`);

    if (rankings.length > 0) {
      console.log('  Top Rankings:');
      for (const r of rankings.slice(0, 5)) {
        const preview = r.textPreview.slice(0, 60).replace(/\n/g, ' ');
        console.log(`    #${r.rank} [${r.elo}] ${r.strategy.padEnd(22)} ${r.id.slice(0, 8)} "${preview}..."`);
      }
      console.log('');
    }
  } catch (error) {
    const durationMs = Date.now() - startMs;
    logger.error('Pipeline failed', { error: String(error), durationMs });
    if (dbTracking && supabase) {
      try {
        await supabase.from('evolution_runs').update({
          status: 'failed',
          error_message: String(error),
        }).eq('id', runId);
      } catch { /* best-effort status update */ }
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
