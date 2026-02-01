// Standalone CLI for running evolution pipeline on a local markdown file.
// Creates its own LLM client and Supabase client to avoid Next.js import chain.
//
// Usage:
//   npx tsx scripts/run-evolution-local.ts --file docs/sample_evolution_content/filler_words.md --mock
//   npx tsx scripts/run-evolution-local.ts --file docs/sample_evolution_content/filler_words.md
//   npx tsx scripts/run-evolution-local.ts --file docs/sample_evolution_content/filler_words.md --full --iterations 3

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { z } from 'zod';

// Clean imports — these modules have no Next.js/Sentry/Supabase transitive deps
import { PipelineStateImpl, serializeState } from '../src/lib/evolution/core/state';
import { createCostTracker } from '../src/lib/evolution/core/costTracker';
import { DEFAULT_EVOLUTION_CONFIG, resolveConfig } from '../src/lib/evolution/config';
import type {
  EvolutionLLMClient, EvolutionLogger, ExecutionContext, AgentResult,
  PipelinePhase, PipelineState,
} from '../src/lib/evolution/types';
import { BudgetExceededError, LLMRefusalError } from '../src/lib/evolution/types';
import { PoolSupervisor, supervisorConfigFromRunConfig } from '../src/lib/evolution/core/supervisor';
import { GenerationAgent } from '../src/lib/evolution/agents/generationAgent';
import { CalibrationRanker } from '../src/lib/evolution/agents/calibrationRanker';
import { EvolutionAgent } from '../src/lib/evolution/agents/evolvePool';
import { Tournament } from '../src/lib/evolution/agents/tournament';
import { ReflectionAgent } from '../src/lib/evolution/agents/reflectionAgent';
import { ProximityAgent } from '../src/lib/evolution/agents/proximityAgent';
import { MetaReviewAgent } from '../src/lib/evolution/agents/metaReviewAgent';

// ─── Types ────────────────────────────────────────────────────────

/** Agent interface matching pipeline.ts PipelineAgent (defined inline to avoid importing pipeline.ts). */
interface PipelineAgent {
  readonly name: string;
  execute(ctx: ExecutionContext): Promise<AgentResult>;
  canExecute(state: PipelineState): boolean;
}

interface CLIArgs {
  file: string;
  mock: boolean;
  full: boolean;
  iterations: number;
  budget: number;
  output: string;
  explanationId: number | null;
  model: string;
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
  --file <path>            Markdown file to evolve (required)
  --mock                   Use mock LLM (no API keys needed)
  --full                   Run full agent suite (default: minimal)
  --iterations <n>         Number of iterations (default: 3)
  --budget <n>             Budget cap in USD (default: 5.00)
  --output <path>          Output JSON path (default: auto-generated)
  --explanation-id <n>     Optional: link run to an explanation in DB
  --model <name>           LLM model (default: deepseek-chat)
  --help                   Show this help message`);
    process.exit(0);
  }

  const file = getValue('file');
  if (!file) {
    console.error('Error: --file is required');
    process.exit(1);
  }

  const resolvedFile = path.resolve(file);
  if (!fs.existsSync(resolvedFile)) {
    console.error(`Error: File not found: ${resolvedFile}`);
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const defaultOutput = `evolution-output-${timestamp}.json`;

  return {
    file: resolvedFile,
    mock: getFlag('mock'),
    full: getFlag('full'),
    iterations: parseInt(getValue('iterations') ?? '3', 10),
    budget: parseFloat(getValue('budget') ?? '5.00'),
    output: getValue('output') ?? defaultOutput,
    explanationId: getValue('explanation-id') ? parseInt(getValue('explanation-id')!, 10) : null,
    model: getValue('model') ?? 'deepseek-chat',
  };
}

// ─── Console Logger ──────────────────────────────────────────────

function createConsoleLogger(): EvolutionLogger {
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

// ─── Token Cost Estimation (inlined from llmClient.ts) ───────────

function estimateTokenCost(prompt: string): number {
  const estimatedInputTokens = Math.ceil(prompt.length / 4);
  const estimatedOutputTokens = Math.ceil(estimatedInputTokens * 0.5);
  const costPer1MInput = 0.14; // deepseek-chat pricing
  const costPer1MOutput = 0.28;
  return (
    (estimatedInputTokens / 1_000_000) * costPer1MInput +
    (estimatedOutputTokens / 1_000_000) * costPer1MOutput
  );
}

// ─── Structured Output Parser (inlined from llmClient.ts) ────────

function parseStructuredOutput<T>(raw: string, schema: z.ZodType<T>): T {
  if (!raw || raw.trim() === '') {
    throw new LLMRefusalError('Model returned empty response');
  }
  try {
    return schema.parse(JSON.parse(raw));
  } catch {
    const cleaned = raw.replace(/,(\s*[}\]])/g, '$1');
    return schema.parse(JSON.parse(cleaned));
  }
}

// ─── Mock LLM Client ─────────────────────────────────────────────

function createMockLLMClient(logger: EvolutionLogger): EvolutionLLMClient {
  let callCount = 0;

  // Mock text templates must pass formatValidator: H1 title, ## sections, multi-sentence paragraphs, no bullets
  const textTemplates = [
    '# Building a Great API\n\n## Endpoint Design\n\nWhen building an API, start by designing your endpoints thoughtfully. Define your resources clearly and map them to RESTful operations.\n\n## Authentication\n\nImplement authentication using JWT tokens to protect your routes. This ensures only authorized clients can access sensitive endpoints.\n\n## Database and Testing\n\nNormalize your database schema to prevent data anomalies. Write comprehensive tests to validate every path through your API.',

    '# API Development Guide\n\n## Planning Your Resources\n\nAPIs succeed through careful planning of resource endpoints. Each resource needs clear CRUD operations that map to your domain model.\n\n## Security Layer\n\nAuthentication with JWT or OAuth protects your routes from unauthorized access. Always validate tokens on every request to ensure security.\n\n## Error Handling\n\nReturn proper status codes so clients understand what happened. Use 404 for missing resources, 400 for bad requests, and 500 for server errors.',

    '# How to Build Robust APIs\n\n## Designing Endpoints\n\nDesign RESTful endpoints that map cleanly to your domain resources. Each endpoint should represent a single resource with well-defined operations.\n\n## Implementing Security\n\nToken-based authentication is essential for any production API. JWT tokens provide a stateless mechanism for verifying client identity.\n\n## Schema and Validation\n\nDesign a properly normalized database schema to support your endpoints. Add comprehensive error handling with appropriate HTTP status codes for every failure mode.',

    '# The Foundation of Good APIs\n\n## Resource Modeling\n\nThe foundation of any good API is its endpoint design. Each endpoint should represent a clear resource with well-defined operations and consistent naming.\n\n## Authentication Strategy\n\nSecure your endpoints with JWT authentication from day one. Never expose unprotected routes that handle sensitive data.\n\n## Quality Assurance\n\nHandle errors gracefully with standard HTTP codes that clients can programmatically interpret. Validate everything with automated tests that cover both happy paths and edge cases.',

    '# Engineering Great APIs\n\n## Starting with Resources\n\nGreat APIs emerge from disciplined engineering of resource models. Start by asking what entities your API exposes and how they relate to each other.\n\n## Adding Authentication\n\nLayer on JWT-based authentication to protect your resources. Design your auth middleware to be reusable across all protected routes.\n\n## Error Handling and Testing\n\nImplement error handling that returns meaningful status codes and error messages. Test every path through your API to ensure reliability under all conditions.',

    '# Effective API Development\n\n## Domain-Driven Endpoints\n\nDesign endpoints around your domain model for intuitive API structure. Each endpoint should clearly communicate its purpose through its URL and HTTP method.\n\n## Security Implementation\n\nAdd JWT authentication to protect your API from unauthorized access. Store tokens securely and implement proper token refresh flows.\n\n## Robustness\n\nStructure your database with proper normalization to prevent data integrity issues. Implement comprehensive error handling using standard HTTP status codes for every failure scenario.',
  ];

  // Rotating A/B/TIE pattern for comparison responses — ensures Elo differentiation
  const comparisonResponses = ['A', 'B', 'A', 'TIE', 'B', 'A', 'A', 'B', 'TIE', 'A'];

  // Structured comparison template for tournament mode
  const structuredTemplates = [
    'clarity: A\nflow: A\nengagement: B\nvoice_fidelity: A\nconciseness: TIE\nOVERALL_WINNER: A\nCONFIDENCE: high',
    'clarity: B\nflow: A\nengagement: A\nvoice_fidelity: TIE\nconciseness: B\nOVERALL_WINNER: B\nCONFIDENCE: medium',
    'clarity: A\nflow: TIE\nengagement: A\nvoice_fidelity: A\nconciseness: A\nOVERALL_WINNER: A\nCONFIDENCE: high',
    'clarity: TIE\nflow: B\nengagement: B\nvoice_fidelity: A\nconciseness: TIE\nOVERALL_WINNER: TIE\nCONFIDENCE: low',
    'clarity: B\nflow: B\nengagement: A\nvoice_fidelity: B\nconciseness: A\nOVERALL_WINNER: B\nCONFIDENCE: high',
  ];

  const critiqueTemplate = {
    scores: { clarity: 7, structure: 8, engagement: 6, precision: 7, coherence: 8 },
    good_examples: {
      clarity: ['Clear endpoint design section'],
      structure: ['Logical flow from design to testing'],
    },
    bad_examples: {
      clarity: ['Some sections could be more specific'],
      engagement: ['Opening could be more compelling'],
    },
    notes: {
      clarity: 'Generally clear but could improve specificity',
      structure: 'Good logical progression',
      engagement: 'Needs more concrete examples',
      precision: 'Technical terms used appropriately',
      coherence: 'Well-connected paragraphs',
    },
  };

  function isStructuredComparison(prompt: string): boolean {
    return prompt.includes('OVERALL_WINNER') && prompt.includes('Evaluation Dimensions');
  }

  function isSimpleComparison(prompt: string): boolean {
    return prompt.includes('## Text A') && prompt.includes('## Text B');
  }

  function isCritiquePrompt(prompt: string): boolean {
    return prompt.includes('quality dimensions') || prompt.includes('Dimensions to Evaluate');
  }

  return {
    async complete(prompt: string, agentName: string): Promise<string> {
      callCount++;
      logger.debug('Mock LLM call', { agentName, callCount });

      // Simulate latency
      await new Promise((r) => setTimeout(r, 30 + Math.random() * 40));

      if (isStructuredComparison(prompt)) {
        return structuredTemplates[(callCount - 1) % structuredTemplates.length];
      }

      if (isSimpleComparison(prompt)) {
        return comparisonResponses[(callCount - 1) % comparisonResponses.length];
      }

      if (isCritiquePrompt(prompt)) {
        const varied = JSON.parse(JSON.stringify(critiqueTemplate));
        for (const dim of Object.keys(varied.scores)) {
          varied.scores[dim] = Math.min(10, Math.max(1, varied.scores[dim] + (callCount % 3) - 1));
        }
        return JSON.stringify(varied);
      }

      // Text generation — return varied templates
      return textTemplates[(callCount - 1) % textTemplates.length];
    },

    async completeStructured<T>(
      prompt: string,
      schema: z.ZodType<T>,
      _schemaName: string,
      agentName: string,
    ): Promise<T> {
      const raw = await this.complete(prompt, agentName);
      return parseStructuredOutput(raw, schema);
    },
  };
}

// ─── Direct LLM Client (DeepSeek / OpenAI) ──────────────────────

function createDirectLLMClient(
  model: string,
  costTracker: ReturnType<typeof createCostTracker>,
  logger: EvolutionLogger,
): EvolutionLLMClient {
  const isDeepSeek = model.startsWith('deepseek-');

  const client = (() => {
    if (isDeepSeek) {
      const key = process.env.DEEPSEEK_API_KEY;
      if (!key) throw new Error('DEEPSEEK_API_KEY required for deepseek models');
      return new OpenAI({ apiKey: key, baseURL: 'https://api.deepseek.com', maxRetries: 3, timeout: 60000 });
    }
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY required for OpenAI models');
    return new OpenAI({ apiKey: key, maxRetries: 3, timeout: 60000 });
  })();

  // Pricing per 1M tokens
  const inputRate = isDeepSeek ? 0.14 : 0.40;
  const outputRate = isDeepSeek ? 0.28 : 1.60;

  return {
    async complete(prompt: string, agentName: string): Promise<string> {
      const estimate = estimateTokenCost(prompt);
      await costTracker.reserveBudget(agentName, estimate);

      logger.debug('LLM call', { agentName, model, promptLength: prompt.length });

      const response = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
      });

      const content = response.choices[0]?.message?.content;
      if (!content || content.trim() === '') {
        throw new LLMRefusalError(`Empty response from ${agentName}`);
      }

      if (response.usage) {
        const cost =
          (response.usage.prompt_tokens / 1_000_000) * inputRate +
          (response.usage.completion_tokens / 1_000_000) * outputRate;
        costTracker.recordSpend(agentName, cost);
      }

      return content;
    },

    async completeStructured<T>(
      prompt: string,
      schema: z.ZodType<T>,
      _schemaName: string,
      agentName: string,
    ): Promise<T> {
      const raw = await this.complete(prompt, agentName);
      return parseStructuredOutput(raw, schema);
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
  config: ReturnType<typeof resolveConfig>,
): Promise<boolean> {
  try {
    const { error } = await supabase.from('content_evolution_runs').insert({
      id: runId,
      explanation_id: explanationId,
      source,
      status: 'pending',
      config,
      budget_cap_usd: config.budgetCapUsd,
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

async function updateRunStatus(
  supabase: SupabaseClient | null,
  runId: string,
  updates: Record<string, unknown>,
): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from('content_evolution_runs').update(updates).eq('id', runId);
  } catch {
    // Best effort — don't crash the pipeline for DB write failures
  }
}

async function persistCheckpoint(
  supabase: SupabaseClient | null,
  runId: string,
  state: PipelineState,
  agentName: string,
  phase: PipelinePhase,
  logger: EvolutionLogger,
): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from('evolution_checkpoints').upsert(
      {
        run_id: runId,
        iteration: state.iteration,
        phase,
        last_agent: agentName,
        state_snapshot: serializeState(state),
      },
      { onConflict: 'run_id,iteration,last_agent' },
    );
    await supabase
      .from('content_evolution_runs')
      .update({
        current_iteration: state.iteration,
        phase,
        last_heartbeat: new Date().toISOString(),
        runner_agents_completed: state.pool.length,
      })
      .eq('id', runId);
  } catch (e) {
    logger.warn('Checkpoint write failed', { error: String(e) });
  }
}

// ─── Agent Construction ──────────────────────────────────────────

interface NamedAgents {
  generation: PipelineAgent;
  calibration: PipelineAgent;
  tournament: PipelineAgent;
  evolution: PipelineAgent;
  reflection: PipelineAgent;
  proximity: PipelineAgent;
  metaReview: PipelineAgent;
}

function buildAgents(): NamedAgents {
  return {
    generation: new GenerationAgent(),
    calibration: new CalibrationRanker(),
    tournament: new Tournament(),
    evolution: new EvolutionAgent(),
    reflection: new ReflectionAgent(),
    proximity: new ProximityAgent({ testMode: true }),
    metaReview: new MetaReviewAgent(),
  };
}

// ─── Pipeline Orchestrator ───────────────────────────────────────

async function runAgent(
  agent: PipelineAgent,
  ctx: ExecutionContext,
  supabase: SupabaseClient | null,
  phase: PipelinePhase,
  logger: EvolutionLogger,
): Promise<AgentResult | null> {
  if (!agent.canExecute(ctx.state)) {
    logger.debug('Skipping agent (preconditions not met)', { agent: agent.name });
    return null;
  }

  logger.info('Executing agent', { agent: agent.name, iteration: ctx.state.iteration });
  const result = await agent.execute(ctx);
  logger.info('Agent completed', {
    agent: agent.name,
    success: result.success,
    costUsd: result.costUsd,
    variantsAdded: result.variantsAdded,
    matchesPlayed: result.matchesPlayed,
  });
  await persistCheckpoint(supabase, ctx.runId, ctx.state, agent.name, phase, logger);
  return result;
}

async function runMinimalPipeline(
  args: CLIArgs,
  ctx: ExecutionContext,
  agents: NamedAgents,
  supabase: SupabaseClient | null,
  logger: EvolutionLogger,
): Promise<string> {
  const sequence: PipelineAgent[] = [agents.generation, agents.calibration];

  for (let i = 0; i < args.iterations; i++) {
    ctx.state.startNewIteration();
    logger.info('Iteration start', { iteration: ctx.state.iteration, poolSize: ctx.state.getPoolSize() });

    for (const agent of sequence) {
      try {
        await runAgent(agent, ctx, supabase, 'EXPANSION', logger);
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          logger.warn('Budget exceeded', { agent: agent.name });
          await updateRunStatus(supabase, ctx.runId, { status: 'paused', error_message: error.message });
          return 'budget_exceeded';
        }
        throw error;
      }
    }
  }

  return 'completed';
}

async function runFullPipeline(
  args: CLIArgs,
  ctx: ExecutionContext,
  agents: NamedAgents,
  supabase: SupabaseClient | null,
  logger: EvolutionLogger,
): Promise<string> {
  const supervisorCfg = supervisorConfigFromRunConfig(ctx.payload.config);
  const supervisor = new PoolSupervisor(supervisorCfg);
  let previousPhase: PipelinePhase = 'EXPANSION';

  for (let i = 0; i < args.iterations; i++) {
    ctx.state.startNewIteration();
    supervisor.beginIteration(ctx.state);
    const phaseConfig = supervisor.getPhaseConfig(ctx.state);
    const phase = phaseConfig.phase;

    if (phase !== previousPhase) {
      logger.info('Phase transition', { from: previousPhase, to: phase, poolSize: ctx.state.getPoolSize() });
      previousPhase = phase;
    }

    logger.info('Iteration start', { iteration: ctx.state.iteration, phase, poolSize: ctx.state.getPoolSize() });

    const [shouldStop, reason] = supervisor.shouldStop(ctx.state, ctx.costTracker.getAvailableBudget());
    if (shouldStop) {
      logger.info('Stopping pipeline', { reason });
      return reason;
    }

    // Run agents in phase-defined order
    const steps: Array<{ run: boolean; agent: PipelineAgent }> = [
      { run: phaseConfig.runGeneration, agent: agents.generation },
      { run: phaseConfig.runReflection, agent: agents.reflection },
      { run: phaseConfig.runEvolution, agent: agents.evolution },
      { run: phaseConfig.runCalibration, agent: phase === 'COMPETITION' ? agents.tournament : agents.calibration },
      { run: phaseConfig.runProximity, agent: agents.proximity },
      { run: phaseConfig.runMetaReview, agent: agents.metaReview },
    ];

    for (const step of steps) {
      if (!step.run) continue;
      try {
        await runAgent(step.agent, ctx, supabase, phase, logger);
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          logger.warn('Budget exceeded', { agent: step.agent.name });
          await updateRunStatus(supabase, ctx.runId, { status: 'paused', error_message: error.message });
          return 'budget_exceeded';
        }
        throw error;
      }
    }

    // Report top performers
    const top = ctx.state.getTopByElo(3);
    for (const v of top) {
      const elo = ctx.state.eloRatings.get(v.id) ?? 1200;
      logger.debug('Top variant', { id: v.id.slice(0, 8), elo: elo.toFixed(0), strategy: v.strategy });
    }
  }

  return 'completed';
}

// ─── Output Builder ──────────────────────────────────────────────

function buildOutput(
  ctx: ExecutionContext,
  stopReason: string,
  durationMs: number,
  dbTracked: boolean,
) {
  const rankings = [...ctx.state.eloRatings.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([id, elo], rank) => {
      const variant = ctx.state.pool.find((v) => v.id === id);
      return {
        rank: rank + 1,
        id,
        elo: Math.round(elo),
        strategy: variant?.strategy ?? 'unknown',
        textPreview: variant?.text.slice(0, 120) ?? '',
      };
    });

  return {
    runId: ctx.runId,
    stopReason,
    durationMs,
    dbTracked,
    iterations: ctx.state.iteration,
    totalVariants: ctx.state.getPoolSize(),
    costSummary: {
      totalUsd: ctx.costTracker.getTotalSpent(),
    },
    rankings,
    fullState: serializeState(ctx.state),
  };
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  const logger = createConsoleLogger();
  const runId = uuidv4();

  console.log('\n┌─────────────────────────────────────────┐');
  console.log('│  Evolution Pipeline — Local CLI          │');
  console.log('└─────────────────────────────────────────┘\n');

  logger.info('Configuration', {
    file: path.basename(args.file),
    mode: args.mock ? 'mock' : 'real',
    pipeline: args.full ? 'full' : 'minimal',
    iterations: args.iterations,
    budget: args.budget,
    model: args.model,
    runId: runId.slice(0, 8),
  });

  // Read input file
  const originalText = fs.readFileSync(args.file, 'utf-8');
  logger.info('Input loaded', { chars: originalText.length, words: originalText.split(/\s+/).length });

  // Build config — adjust constraints for full mode with low iteration counts
  const configOverrides: Partial<ReturnType<typeof resolveConfig>> = {
    maxIterations: args.iterations,
    budgetCapUsd: args.budget,
  };
  if (args.full) {
    // Supervisor requires maxIterations > expansion.maxIterations + plateau.window + 1
    const expansionMax = Math.max(1, Math.floor(args.iterations * 0.4));
    const plateauWindow = DEFAULT_EVOLUTION_CONFIG.plateau.window;
    const minIterations = expansionMax + plateauWindow + 2;
    configOverrides.maxIterations = Math.max(args.iterations, minIterations);
    configOverrides.expansion = {
      ...DEFAULT_EVOLUTION_CONFIG.expansion,
      maxIterations: expansionMax,
    };
    if (configOverrides.maxIterations !== args.iterations) {
      logger.warn('Adjusted iterations for supervisor constraints', {
        requested: args.iterations,
        adjusted: configOverrides.maxIterations,
      });
    }
  }
  const config = resolveConfig(configOverrides);

  // Set up Supabase tracking — auto-persist when env vars are available
  const supabase = getSupabase();
  let dbTracking = false;
  if (supabase) {
    const source = args.explanationId !== null
      ? 'explanation'
      : `local:${path.basename(args.file)}`;
    dbTracking = await createRunRecord(supabase, runId, args.explanationId, source, config);
    if (dbTracking) {
      logger.info('DB tracking enabled', { source, explanationId: args.explanationId });
    }
  } else {
    logger.info('Supabase not configured — file output only');
  }

  // Build components
  const state = new PipelineStateImpl(originalText);
  const costTracker = createCostTracker(config);
  const llmClient = args.mock
    ? createMockLLMClient(logger)
    : createDirectLLMClient(args.model, costTracker, logger);

  const ctx: ExecutionContext = {
    payload: {
      originalText,
      title: path.basename(args.file, path.extname(args.file)),
      explanationId: args.explanationId ?? 0,
      runId,
      config,
    },
    state,
    llmClient,
    logger,
    costTracker,
    runId,
  };

  const agents = buildAgents();
  const agentNames = args.full
    ? ['generation', 'calibration', 'tournament', 'evolution', 'reflection', 'proximity', 'metaReview']
    : ['generation', 'calibration'];
  logger.info('Agent suite', { agents: agentNames, mode: args.full ? 'full' : 'minimal' });

  // Run pipeline
  await updateRunStatus(dbTracking ? supabase : null, runId, {
    status: 'running',
    started_at: new Date().toISOString(),
  });

  const startMs = Date.now();
  try {
    const stopReason = args.full
      ? await runFullPipeline(args, ctx, agents, dbTracking ? supabase : null, logger)
      : await runMinimalPipeline(args, ctx, agents, dbTracking ? supabase : null, logger);

    const durationMs = Date.now() - startMs;

    // Mark completed
    await updateRunStatus(dbTracking ? supabase : null, runId, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      total_variants: ctx.state.getPoolSize(),
      total_cost_usd: ctx.costTracker.getTotalSpent(),
    });

    // Build and write output
    const output = buildOutput(ctx, stopReason, durationMs, dbTracking);
    const outputPath = path.resolve(args.output);
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    logger.info('Output written', { path: outputPath });

    // Print summary
    console.log('\n┌─────────────────────────────────────────┐');
    console.log('│  Results Summary                         │');
    console.log('└─────────────────────────────────────────┘\n');
    console.log(`  Run ID:      ${runId.slice(0, 8)}`);
    console.log(`  Stop reason: ${stopReason}`);
    console.log(`  Duration:    ${(durationMs / 1000).toFixed(1)}s`);
    console.log(`  Iterations:  ${state.iteration}`);
    console.log(`  Variants:    ${state.getPoolSize()}`);
    console.log(`  Total cost:  $${costTracker.getTotalSpent().toFixed(4)}`);
    console.log(`  DB tracked:  ${dbTracking ? 'yes' : 'no'}`);
    console.log(`  Output:      ${outputPath}\n`);

    if (output.rankings.length > 0) {
      console.log('  Top Rankings:');
      for (const r of output.rankings.slice(0, 5)) {
        const preview = r.textPreview.slice(0, 60).replace(/\n/g, ' ');
        console.log(`    #${r.rank} [${r.elo}] ${r.strategy.padEnd(22)} ${r.id.slice(0, 8)} "${preview}..."`);
      }
      console.log('');
    }
  } catch (error) {
    const durationMs = Date.now() - startMs;
    logger.error('Pipeline failed', { error: String(error), durationMs });
    await updateRunStatus(dbTracking ? supabase : null, runId, {
      status: 'failed',
      error_message: String(error),
    });
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
