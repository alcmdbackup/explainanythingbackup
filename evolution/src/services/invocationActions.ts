'use server';
// Server actions for evolution agent invocations: list and detail.
// Provides paginated listing and single-invocation fetch for the admin UI.

import { adminAction, type AdminContext } from './adminAction';
import { validateUuid, getTestStrategyIds } from './shared';
import { z } from 'zod';

// ─── Types ───────────────────────────────────────────────────────

export interface InvocationListEntry {
  id: string;
  run_id: string;
  agent_name: string;
  iteration: number | null;
  execution_order: number | null;
  success: boolean;
  cost_usd: number | null;
  duration_ms: number | null;
  error_message: string | null;
  created_at: string;
}

export interface InvocationDetail {
  id: string;
  run_id: string;
  agent_name: string;
  iteration: number | null;
  execution_order: number | null;
  success: boolean;
  cost_usd: number | null;
  duration_ms: number | null;
  error_message: string | null;
  execution_detail: Record<string, unknown> | null;
  created_at: string;
}

const listInvocationsInputSchema = z.object({
  runId: z.string().uuid().optional(),
  filterTestContent: z.boolean().optional(),
  successFilter: z.enum(['all', 'success', 'failed']).optional(),
  agentName: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export type ListInvocationsInput = z.input<typeof listInvocationsInputSchema>;

// ─── Actions ─────────────────────────────────────────────────────

export const listInvocationsAction = adminAction(
  'listInvocationsAction',
  async (
    input: ListInvocationsInput,
    ctx: AdminContext,
  ): Promise<{ items: InvocationListEntry[]; total: number }> => {
    const parsed = listInvocationsInputSchema.parse(input);
    const { supabase } = ctx;

    // For invocations, the nested embed path (invocations → runs → strategies) doesn't work
    // cleanly because evolution_agent_invocations has two FKs to evolution_runs (run_id +
    // a legacy failed_at_invocation_fkey), causing PGRST201. Use the two-step approach instead:
    // getTestStrategyIds() now reads the indexed is_test_content column (fast, small result),
    // then we fetch test run IDs and exclude them. The IN list is bounded by test RUN count
    // (smaller than the 984-strategy list that caused the original URL-length bug).
    const baseFields = 'id, run_id, agent_name, iteration, execution_order, success, cost_usd, duration_ms, error_message, created_at';
    let testRunIds: string[] = [];
    if (parsed.filterTestContent) {
      const testStrategyIds = await getTestStrategyIds(supabase);
      if (testStrategyIds.length > 0) {
        const { data: testRuns } = await supabase
          .from('evolution_runs')
          .select('id')
          .in('strategy_id', testStrategyIds);
        testRunIds = (testRuns ?? []).map(r => r.id as string);
      }
    }

    let query = supabase
      .from('evolution_agent_invocations')
      .select(baseFields, { count: 'exact' });

    if (parsed.runId) query = query.eq('run_id', parsed.runId);
    if (parsed.successFilter === 'success') query = query.eq('success', true);
    if (parsed.successFilter === 'failed') query = query.eq('success', false);
    if (parsed.agentName) {
      const escaped = parsed.agentName.replace(/[%_\\]/g, '\\$&');
      query = query.ilike('agent_name', `%${escaped}%`);
    }
    if (parsed.filterTestContent && testRunIds.length > 0) {
      // B002-S5: chunk the IN-list to avoid PostgREST URL truncation at scale (the
      // 2026-04-22 sweep documented the 36KB limit at ~984 test strategies). For
      // invocations, testRunIds can grow as test runs accumulate; chunk into 200-id
      // batches and AND them. Each chunk excludes its own subset; AND of "not in chunk"
      // semantically excludes the union.
      const CHUNK = 200;
      for (let i = 0; i < testRunIds.length; i += CHUNK) {
        const chunk = testRunIds.slice(i, i + CHUNK);
        query = query.not('run_id', 'in', `(${chunk.join(',')})`);
      }
    }

    query = query.order('created_at', { ascending: false })
      .range(parsed.offset, parsed.offset + parsed.limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    // Cast via unknown — embedded-resource select doesn't parse cleanly into the generated types.
    return { items: (data ?? []) as unknown as InvocationListEntry[], total: count ?? 0 };
  },
);

export const getInvocationDetailAction = adminAction(
  'getInvocationDetailAction',
  async (invocationId: string, ctx: AdminContext): Promise<InvocationDetail> => {
    if (!validateUuid(invocationId)) throw new Error('Invalid invocationId');
    const { supabase } = ctx;

    const { data, error } = await supabase
      .from('evolution_agent_invocations')
      .select('id, run_id, agent_name, iteration, execution_order, success, cost_usd, duration_ms, error_message, execution_detail, created_at')
      .eq('id', invocationId)
      .single();

    if (error) throw error;
    return data as InvocationDetail;
  },
);

/** Phase 6: Raw LLM call rows for a given invocation. Prompts may contain source article PII —
 *  UI must surface this via a disclosure banner. */
export interface LLMCallRow {
  id: number;
  prompt: string;
  content: string;
  model: string | null;
  call_source: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  created_at: string;
}

export const getLLMCallsForInvocationAction = adminAction(
  'getLLMCallsForInvocationAction',
  async (invocationId: string, ctx: AdminContext): Promise<LLMCallRow[]> => {
    if (!validateUuid(invocationId)) throw new Error('Invalid invocationId');
    const { supabase } = ctx;

    const { data, error } = await supabase
      .from('llmCallTracking')
      .select('id, prompt, content, model, call_source, prompt_tokens, completion_tokens, total_tokens, created_at')
      .eq('evolution_invocation_id', invocationId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data ?? []) as LLMCallRow[];
  },
);

/** Phase 6: fetch the single variant produced by an invocation, plus its parent's mu/sigma.
 *  Used to render the "Parent block" on the invocation detail page for
 *  generate_from_previous_article invocations. Returns null when no variant was produced. */
export interface InvocationVariantContext {
  variantId: string;
  /** The produced variant's run_id — compared against parentRunId to detect cross-run parents. */
  variantRunId: string;
  variantElo: number;
  variantMu: number | null;
  variantSigma: number | null;
  /** The produced variant's text content — used by InvocationParentBlock's <TextDiff>
   *  collapsible (Phase 4.4/4.5). Null when the invocation produced no variant. */
  variantContent: string | null;
  parentVariantId: string | null;
  parentElo: number | null;
  parentMu: number | null;
  parentSigma: number | null;
  parentRunId: string | null;
  /** Parent variant's text content for the diff. Null when no parent or parent missing. */
  parentContent: string | null;
}

export const getInvocationVariantContextAction = adminAction(
  'getInvocationVariantContextAction',
  async (invocationId: string, ctx: AdminContext): Promise<InvocationVariantContext | null> => {
    if (!validateUuid(invocationId)) throw new Error('Invalid invocationId');
    const { supabase } = ctx;

    type InvocationVariantRow = {
      id: string; run_id: string; elo_score: number; mu: number | null; sigma: number | null;
      parent_variant_id: string | null; variant_content: string | null;
    };
    const { data: variantsData } = await supabase
      .from('evolution_variants')
      .select('id, run_id, elo_score, mu, sigma, parent_variant_id, variant_content')
      .eq('agent_invocation_id', invocationId)
      .limit(1);
    const variants = (variantsData ?? []) as unknown as InvocationVariantRow[];

    const variant = variants?.[0];
    if (!variant) return null;

    let parentElo: number | null = null;
    let parentMu: number | null = null;
    let parentSigma: number | null = null;
    let parentRunId: string | null = null;
    let parentContent: string | null = null;

    if (variant.parent_variant_id) {
      const { data: parent } = await supabase
        .from('evolution_variants')
        .select('elo_score, mu, sigma, run_id, variant_content')
        .eq('id', variant.parent_variant_id)
        .single();
      if (parent) {
        parentElo = parent.elo_score ?? null;
        parentMu = parent.mu ?? null;
        parentSigma = parent.sigma ?? null;
        parentRunId = parent.run_id ?? null;
        parentContent = (parent as { variant_content?: string | null }).variant_content ?? null;
      }
    }

    return {
      variantId: variant.id,
      variantRunId: variant.run_id,
      variantElo: variant.elo_score,
      variantMu: variant.mu ?? null,
      variantSigma: variant.sigma ?? null,
      variantContent: variant.variant_content ?? null,
      parentVariantId: variant.parent_variant_id,
      parentElo,
      parentMu,
      parentSigma,
      parentRunId,
      parentContent,
    };
  },
);
