// Server actions for strategy creation UI previews — pure wrappers around pipeline
// estimation helpers. Kept separate from costAnalytics.ts (which is DB-backed admin
// analytics) because these actions are pure and only need admin auth + input validation.

'use server';

import { z } from 'zod';
import { adminAction, type AdminContext } from './adminAction';
import { estimateAgentCost } from '../lib/pipeline/infra/estimateCosts';
import { allowedLLMModelSchema } from '@/lib/schemas/schemas';
import { DEFAULT_SEED_CHARS } from '../lib/pipeline/loop/projectDispatchPlan';

// ─── Schemas ────────────────────────────────────────────────────

/** Representative defaults used by the preview — see returned `assumptions` for values.
 *  We assume a fixed 15 ranking comparisons per agent rather than deriving from
 *  pool size / numVariants. Rationale: actual comparisons per agent vary by
 *  dispatch stage (first parallel agent sees pool=1 → 0 comparisons; later
 *  sequential agents see a growing pool). A flat representative number keeps
 *  the preview stable and predictable for budget planning. */
const REPRESENTATIVE_SEED_CHARS = 5000;
const REPRESENTATIVE_STRATEGY = 'grounding_enhance'; // Most expensive of 3 core strategies
const REPRESENTATIVE_COMPARISONS = 15;

const previewInputSchema = z.object({
  generationModel: allowedLLMModelSchema,
  judgeModel: allowedLLMModelSchema,
  /** Override the representative seed article size. Defaults to 5000 chars. */
  seedArticleChars: z.number().int().min(100).max(100000).optional(),
});

export interface AgentCostPreview {
  estimatedAgentCostUsd: number;
  assumptions: {
    seedArticleChars: number;
    tactic: string;
    /** Representative ranking comparisons per agent used by the preview. */
    comparisonsUsed: number;
  };
}

// ─── Action ─────────────────────────────────────────────────────

/** Preview the estimated cost of one generateFromPreviousArticle agent for the given
 *  strategy config. Used by the strategy creation form to show the USD equivalent
 *  when a user specifies budget floors in "Multiple of agent cost" mode. */
export const estimateAgentCostPreviewAction = adminAction(
  'estimateAgentCostPreview',
  // The second `_ctx` param is REQUIRED for adminAction's arity detection —
  // a 1-arg handler is treated as ctx-only, causing client input to be passed
  // as ctx and Zod parsing to fail silently.
  async (
    input: z.input<typeof previewInputSchema>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _ctx: AdminContext,
  ): Promise<AgentCostPreview> => {
    const parsed = previewInputSchema.parse(input);

    const seedArticleChars = parsed.seedArticleChars ?? REPRESENTATIVE_SEED_CHARS;
    // To force `estimateAgentCost` to use exactly REPRESENTATIVE_COMPARISONS comparisons,
    // pass poolSize = REPRESENTATIVE_COMPARISONS + 1 (so poolSize - 1 = 15) and cap at 15.
    // The internal logic is `min(poolSize - 1, maxComparisonsPerVariant)`.
    const poolSizeForEstimate = REPRESENTATIVE_COMPARISONS + 1;

    const estimatedAgentCostUsd = estimateAgentCost(
      seedArticleChars,
      REPRESENTATIVE_STRATEGY,
      parsed.generationModel,
      parsed.judgeModel,
      poolSizeForEstimate,
      REPRESENTATIVE_COMPARISONS,
    );

    return {
      estimatedAgentCostUsd,
      assumptions: {
        seedArticleChars,
        tactic: REPRESENTATIVE_STRATEGY,
        comparisonsUsed: REPRESENTATIVE_COMPARISONS,
      },
    };
  },
);

// ─── Phase 3: smart-default prompt ─────────────────────────────────

export interface LastUsedPromptResult {
  id: string;
  name: string;
  promptText: string;
}

/**
 * Return the most recent prompt that appeared in a non-test-content run. Used by the
 * strategy creation wizard to pre-populate the optional promptId selector, giving users
 * an accurate arena-size preview by default (without forcing them to pick a prompt).
 *
 * Filters:
 * - `evolution_strategies.is_test_content = false` (excludes [TEST]-prefixed strategies)
 * - `evolution_prompts.status = 'active'`
 * - `evolution_prompts.deleted_at IS NULL`
 *
 * Returns null when no qualifying prompt exists (empty DB, all test, all archived).
 * Note: Query is cross-user — no per-admin filter because `evolution_runs` has no
 * created_by column. For a single-admin or small-team setup this is fine; worth
 * flagging if multiple admins work in parallel on different prompts.
 */
export const getLastUsedPromptAction = adminAction(
  'getLastUsedPrompt',
  async (_input: unknown, ctx: AdminContext): Promise<LastUsedPromptResult | null> => {
    const { data, error } = await ctx.supabase
      .from('evolution_runs')
      .select(`
        prompt_id,
        evolution_strategies!inner(is_test_content),
        evolution_prompts!inner(id, name, prompt, status, deleted_at)
      `)
      .not('prompt_id', 'is', null)
      .eq('evolution_strategies.is_test_content', false)
      .eq('evolution_prompts.status', 'active')
      .is('evolution_prompts.deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;

    // Supabase join returns the prompt as a single object (we used !inner + .maybeSingle);
    // the generated types may express it as an array. Normalize.
    const promptField = (data as unknown as { evolution_prompts: unknown }).evolution_prompts;
    const prompt = Array.isArray(promptField) ? promptField[0] : promptField;
    if (!prompt || typeof prompt !== 'object') return null;
    const p = prompt as { id: string; name: string; prompt: string };

    return { id: p.id, name: p.name, promptText: p.prompt };
  },
);

/** Fetch the count of arena-synced variants for a prompt. Powers the wizard's arena-size
 *  preview when a promptId is selected. Non-archived only. Returns 0 for empty/unknown. */
export const getArenaCountForPromptAction = adminAction(
  'getArenaCountForPrompt',
  async (input: { promptId: string }, ctx: AdminContext): Promise<{ arenaCount: number }> => {
    const parsed = z.object({ promptId: z.string().uuid() }).parse(input);
    const { count, error } = await ctx.supabase
      .from('evolution_variants')
      .select('id', { count: 'exact', head: true })
      .eq('prompt_id', parsed.promptId)
      .eq('synced_to_arena', true)
      .is('archived_at', null);

    if (error) return { arenaCount: 0 };
    return { arenaCount: count ?? 0 };
  },
);

// ─── Unified dispatch preview server action ─────────────────────────

const dispatchPreviewInputSchema = z.object({
  /** Strategy config payload. We accept the fields projectDispatchPlan needs, mirror
   *  what createStrategyAction expects, and tolerate extra keys for forward-compat. */
  config: z.object({
    generationModel: z.string(),
    judgeModel: z.string(),
    budgetUsd: z.number().positive(),
    maxComparisonsPerVariant: z.number().int().positive().optional(),
    iterationConfigs: z.array(z.object({
      agentType: z.enum(['generate', 'swiss']),
      budgetPercent: z.number().min(1).max(100),
      sourceMode: z.enum(['seed', 'pool']).optional(),
      qualityCutoff: z.object({ mode: z.enum(['topN', 'topPercent']), value: z.number().positive() }).optional(),
      generationGuidance: z.array(z.unknown()).optional(),
    })).min(1).max(20),
    minBudgetAfterParallelFraction: z.number().min(0).max(1).optional(),
    minBudgetAfterParallelAgentMultiple: z.number().min(0).optional(),
    minBudgetAfterSequentialFraction: z.number().min(0).max(1).optional(),
    minBudgetAfterSequentialAgentMultiple: z.number().min(0).optional(),
    generationGuidance: z.array(z.unknown()).optional(),
  }).passthrough(),
  /** Optional prompt to source arena size from. When null/omitted the preview assumes
   *  an empty arena (initialPoolSize=0). */
  promptId: z.string().uuid().optional(),
  /** Optional seed article length override. Defaults to DEFAULT_SEED_CHARS. */
  seedArticleChars: z.number().int().min(100).max(100000).optional(),
});

export interface DispatchPreviewResult {
  plan: IterationPlanEntryClient[];
  arenaCount: number;
  seedArticleChars: number;
  promptName: string | null;
}

/** Serializable snapshot of IterationPlanEntry for client consumption. Matches the
 *  shape of IterationPlanEntry exactly — re-declared here because the server action
 *  cannot export the pipeline type directly without leaking server-only imports. */
export interface IterationPlanEntryClient {
  iterIdx: number;
  agentType: 'generate' | 'swiss';
  iterBudgetUsd: number;
  tactic: string;
  estPerAgent: {
    expected: { gen: number; rank: number; total: number };
    upperBound: { gen: number; rank: number; total: number };
  };
  maxAffordable: { atExpected: number; atUpperBound: number };
  dispatchCount: number;
  effectiveCap: 'budget' | 'safety_cap' | 'floor' | 'swiss';
  poolSizeAtStart: number;
  parallelFloorUsd: number;
}

/**
 * Unified dispatch-plan preview for the wizard. Calls projectDispatchPlan with either
 * the selected prompt's arena count (when promptId given) or 0 (empty arena assumption).
 * Returns the full plan + the inputs used so the UI can display them with source labels.
 */
export const getStrategyDispatchPreviewAction = adminAction(
  'getStrategyDispatchPreview',
  async (
    input: z.input<typeof dispatchPreviewInputSchema>,
    ctx: AdminContext,
  ): Promise<DispatchPreviewResult> => {
    const parsed = dispatchPreviewInputSchema.parse(input);

    // Arena count — 0 when no promptId; queries evolution_variants otherwise.
    let arenaCount = 0;
    let promptName: string | null = null;
    if (parsed.promptId) {
      const [{ count }, { data: promptRow }] = await Promise.all([
        ctx.supabase
          .from('evolution_variants')
          .select('id', { count: 'exact', head: true })
          .eq('prompt_id', parsed.promptId)
          .eq('synced_to_arena', true)
          .is('archived_at', null),
        ctx.supabase
          .from('evolution_prompts')
          .select('name')
          .eq('id', parsed.promptId)
          .maybeSingle(),
      ]);
      arenaCount = count ?? 0;
      promptName = (promptRow as { name?: string } | null)?.name ?? null;
    }

    const seedChars = parsed.seedArticleChars ?? DEFAULT_SEED_CHARS;

    // Import the pipeline helper lazily so this server action module doesn't pull the
    // entire pipeline graph into the Next.js server bundle.
    const { projectDispatchPlan } = await import('../lib/pipeline/loop/projectDispatchPlan');
    const { DEFAULT_TACTICS } = await import('../lib/core/tactics');

    const plan = projectDispatchPlan(parsed.config as Parameters<typeof projectDispatchPlan>[0], {
      seedChars,
      initialPoolSize: arenaCount,
      tactics: [...DEFAULT_TACTICS],
    });

    return { plan, arenaCount, seedArticleChars: seedChars, promptName };
  },
);
