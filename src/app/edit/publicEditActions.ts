'use server';
// Public /edit server actions (Phase 1 of build_website_for_evolutiOn_20260626).
//
// Unauthed surface — uses publicAction wrapper (no requireAdmin). Cost discipline
// enforced through layered caps:
//   1. Vercel BotID (checkBotId) before any work
//   2. Per-IP + per-region $ caps via perIpSpendingGate (Upstash)
//   3. Pre-submission affordability check against remaining budgets
//   4. evolution_runs.budget_cap_usd = $0.10 per submission
//   5. Per-user gate (shared guest pool, via LLMSpendingGate.reserveForUser inside callLLM)
//   6. Global evolution_daily_cap_usd / monthly cap
//
// Submission flow inserts: topics → explanations → evolution_runs (pending),
// then returns runId. The minicomputer picks up the pending run within ~60s.

import { publicAction, type PublicContext } from '@evolution/services/publicAction';
import { getPerIpSpendingGate, getClientGeo, PerIpBudgetExceededError } from '@/lib/services/perIpSpendingGate';
import { getSpendingGate } from '@/lib/services/llmSpendingGate';
import { validateRunContentRefs } from '@evolution/services/shared';
import { z } from 'zod';
import { headers as nextHeaders } from 'next/headers';
import { checkBotId } from 'botid/server';
import { logger } from '@/lib/server_utilities';

// ─── Constants ─────────────────────────────────────────────────────

/** Hard per-run budget cap for /edit submissions. Matches the public_visible
 *  whitelist guard (Phase 1: updateStrategyAction refuses publicVisible=true
 *  when config.budgetUsd > $0.10). */
const PER_RUN_BUDGET_CAP_USD = 0.10;

/** [EDIT] title prefix used to (a) discriminate /edit content from real
 *  explanations in the discovery filters and (b) clearly label admin views. */
const EDIT_TITLE_PREFIX = '[EDIT]';

/** Max article text length. Keeps the strategy projector / per-call cost
 *  estimate in a sane range; also defends against pathological POST bodies. */
const MAX_ARTICLE_CHARS = 50_000;

// ─── Schemas ───────────────────────────────────────────────────────

const submitInputSchema = z.object({
  articleText: z.string().min(1).max(MAX_ARTICLE_CHARS),
  strategyId: z.string().uuid(),
});

const runIdSchema = z.string().uuid();

// ─── Types ─────────────────────────────────────────────────────────

export interface SubmitPublicEditResult {
  runId: string;
}

export interface EditRunStatus {
  status: 'pending' | 'claimed' | 'running' | 'completed' | 'failed' | 'cancelled';
  originalContent: string;
  winnerVariantContent: string | null;
  errorMessage: string | null;
  costSpent: number | null;
  etaSeconds: number | null;
}

// ─── Helpers ───────────────────────────────────────────────────────

function isPublicEditDisabled(): boolean {
  return process.env.PUBLIC_EDIT_DISABLED === 'true';
}

function botProtectionDisabled(): boolean {
  return process.env.BOT_PROTECTION_DISABLED === 'true';
}

/** Build the [EDIT]-prefixed title from the article body (first ~60 chars).
 *  A per-submission unique suffix is required because `topics.topic_title` has
 *  a unique constraint, and the same article submitted twice would otherwise
 *  collide. The suffix is the caller-supplied submission id (a short string
 *  taken from a fresh UUID's first segment); both the topic title and
 *  explanation title use the same suffix so admin views see a 1:1 match. */
function buildEditTitle(articleText: string, uniqueSuffix: string): string {
  const trimmed = articleText.trim().slice(0, 60).replace(/\s+/g, ' ');
  const ellipsis = articleText.length > 60 ? '…' : '';
  return `${EDIT_TITLE_PREFIX} ${trimmed}${ellipsis} · ${uniqueSuffix}`;
}

/** Rough estimate of /edit run cost from articleText length. Used by the
 *  pre-submission affordability check. We don't have the full strategy projector
 *  call wired here for v1; conservative upper bound = per-run cap. */
function estimateRunCostUsd(): number {
  // Conservative: the per-run cap is the upper bound; use it for affordability.
  // Follow-up: invoke projectDispatchPlan(strategy.config, ...).expected for
  // a tighter estimate, but the cap-based estimate is fail-safe.
  return PER_RUN_BUDGET_CAP_USD;
}

// ─── Actions ───────────────────────────────────────────────────────

/**
 * Submit a paste-and-run /edit request. Inserts the topic + explanation +
 * pending evolution_runs row, returns {runId}. The minicomputer picks up
 * the pending run within ~60s and the client polls getEditRunStatusAction.
 */
export const submitPublicEditAction = publicAction(
  'submitPublicEdit',
  async (
    input: z.input<typeof submitInputSchema>,
    ctx: PublicContext,
  ): Promise<SubmitPublicEditResult> => {
    // 1. Operational kill switch — turn off /edit entirely without a code deploy.
    if (isPublicEditDisabled()) {
      throw new Error('Public /edit is temporarily disabled. Try again later.');
    }

    // 2. Vercel BotID — invisible challenge verdict. NO `request` argument
    //    (botid/server reads context from the active request automatically).
    //    BOT_PROTECTION_DISABLED='true' short-circuits for tests / local dev.
    if (!botProtectionDisabled()) {
      const verdict = await checkBotId();
      if (verdict.isBot) {
        logger.warn('submitPublicEdit blocked by BotID', { verdict });
        throw new Error('Submission blocked. If you are a human and seeing this in error, try again.');
      }
    }

    // 3. Input validation
    const parsed = submitInputSchema.parse(input);

    // 4. Strategy must be in the public whitelist (public_visible=true,
    //    status=active, is_test_content=false). Read by strategy_id direct
    //    rather than going through listPublicStrategiesAction so we don't
    //    pay the cache-pollution cost on every submit.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const strategyQuery: any = ctx.supabase
      .from('evolution_strategies')
      .select('id, name, config, public_visible, status, is_test_content')
      .eq('id', parsed.strategyId)
      .eq('public_visible', true)
      .eq('status', 'active')
      .eq('is_test_content', false)
      .maybeSingle();
    const { data: strategy, error: stratErr } = await strategyQuery;
    if (stratErr) throw stratErr;
    if (!strategy) {
      throw new Error(`Strategy not available for public submissions: ${parsed.strategyId}`);
    }

    // 5. Geo + per-IP/per-region affordability check
    const reqHeaders = await nextHeaders();
    const { ip, country } = getClientGeo(reqHeaders);
    const perIpGate = getPerIpSpendingGate();
    const estRunCost = estimateRunCostUsd();
    const { ipRemaining, regionRemaining } = await perIpGate.remainingForIp(ip, country);
    if (estRunCost > Math.min(ipRemaining, regionRemaining)) {
      logger.info('submitPublicEdit refused — pre-submission affordability check', {
        ip,
        country,
        estRunCost,
        ipRemaining,
        regionRemaining,
      });
      const err = new Error('Daily quota would be exceeded by this submission. Try again tomorrow.') as Error & { status?: number };
      err.status = 429;
      throw err;
    }

    // 6. Reserve eagerly against per-IP + per-region gates (intentional
    //    over-projection — defense in depth; max-leak bounded by PER_RUN_BUDGET_CAP_USD).
    let reservedIpCost = 0;
    try {
      reservedIpCost = await perIpGate.reserveForIp(ip, country, estRunCost);
    } catch (err) {
      if (err instanceof PerIpBudgetExceededError) {
        const wrapped = new Error('Daily quota exceeded — try again tomorrow.') as Error & { status?: number };
        wrapped.status = 429;
        throw wrapped;
      }
      throw err;
    }

    // 6b. Reserve against the shared guest pool. The pipeline LLM calls run as
    //     EVOLUTION_SYSTEM_USERID (not GUEST_USER_ID), so the per-user gate
    //     inside callLLM never fires for /edit. Pre-reserve at the action layer
    //     so the $10/day shared-pool cap is actually enforced. Reservation is
    //     released by orphan-cleanup if the run never lands; the matching
    //     `recordActualForUser` happens via the per_user_daily_cost_rollups
    //     trigger when llmCallTracking rows land — both keyed on the same
    //     guest userid (NOT the system userid).
    const guestUserId = process.env.GUEST_USER_ID;
    let reservedGuestCost = 0;
    const spendingGate = getSpendingGate();
    if (guestUserId) {
      try {
        const guestCap = await spendingGate.getGuestUserCap();
        reservedGuestCost = await spendingGate.reserveForUser(guestUserId, estRunCost, guestCap);
      } catch (err) {
        // Release per-IP reservation before bubbling up.
        await perIpGate.releaseForIp(ip, country, reservedIpCost).catch(() => {});
        const wrapped = new Error('Daily quota exceeded — try again tomorrow.') as Error & { status?: number };
        wrapped.status = 429;
        wrapped.cause = err;
        throw wrapped;
      }
    }

    try {
      // 7. Create the topic for this submission (matches processImport pattern at
      //    src/actions/importActions.ts:119). One topic row per submission.
      //
      //    `topics.topic_title` has a unique constraint, so repeated submissions
      //    of the same article would collide on the first 60-char title slug.
      //    Append a short per-submission suffix (first 8 chars of a fresh UUID)
      //    to keep each submission's topic distinct. Both topic and explanation
      //    titles use the SAME suffix so admin tooling can match them 1:1.
      const submissionSuffix = crypto.randomUUID().slice(0, 8);
      const topicTitle = buildEditTitle(parsed.articleText, submissionSuffix);
      const { data: topicRow, error: topicErr } = await ctx.supabase
        .from('topics')
        .insert({ topic_title: topicTitle })
        .select('id')
        .single();
      if (topicErr) throw topicErr;
      const topicId = topicRow.id;

      // 8. Create the explanation row referencing the new topic.
      //    Schema-verified payload (src/lib/database.types.ts:1714-1735):
      //    - primary_topic_id BIGINT NOT NULL FK→topics (REQUIRED)
      //    - status enum allows 'draft' | 'published' (NOT 'private')
      //    - source CHECK constraint (migration 20251222215629) restricts to
      //      ('chatgpt','claude','gemini','other','generated'). Use 'generated'
      //      since the pipeline rewrites the article. The [EDIT] discovery
      //      filters (on topic_title prefix + explanation_title prefix) keep
      //      these out of the public Explore — source is not the discriminator.
      const explanationTitle = buildEditTitle(parsed.articleText, submissionSuffix);
      const { data: explanationRow, error: expErr } = await ctx.supabase
        .from('explanations')
        .insert({
          explanation_title: explanationTitle,
          content: parsed.articleText,
          primary_topic_id: topicId,
          status: 'draft',
          source: 'generated',
        })
        .select('id')
        .single();
      if (expErr) throw expErr;
      const explanationId = explanationRow.id;

      // 9. Symmetric validation now that we have the BIGINT explanation id.
      //    (Shared validator with admin queueEvolutionRunAction; the row exists
      //    by construction, but this is the defense in depth.)
      await validateRunContentRefs({ explanationId }, ctx.supabase);

      // 10. Insert the pending evolution_runs row. The minicomputer's
      //     processRunQueue.ts will claim it on its next tick.
      const { data: runRow, error: runErr } = await ctx.supabase
        .from('evolution_runs')
        .insert({
          explanation_id: explanationId,
          strategy_id: parsed.strategyId,
          budget_cap_usd: PER_RUN_BUDGET_CAP_USD,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- run_source added by migration 20260627000004
          run_source: 'public_edit' as any,
          status: 'pending',
        })
        .select('id')
        .single();
      if (runErr) throw runErr;

      return { runId: runRow.id as string };
    } catch (err) {
      // On insert failure, release both reservations so the visitor isn't
      // billed for work that never happened. Per-user reservation is also
      // backstopped by the orphan-cleanup pass.
      await perIpGate.releaseForIp(ip, country, reservedIpCost).catch(() => undefined);
      if (guestUserId && reservedGuestCost > 0) {
        await spendingGate.recordActualForUser(guestUserId, reservedGuestCost).catch(() => undefined);
      }
      throw err;
    }
  },
);

/**
 * Poll status of a previously-submitted /edit run. NOT admin-gated. Anyone
 * with the run-id UUID can read — UUIDs are unguessable + the run contains
 * the visitor's own pasted text.
 */
export const getEditRunStatusAction = publicAction(
  'getEditRunStatus',
  async (input: string, ctx: PublicContext): Promise<EditRunStatus> => {
    const runId = runIdSchema.parse(input);

    // Read the run + the originating explanation content.
    const { data: run, error: runErr } = await ctx.supabase
      .from('evolution_runs')
      .select('id, status, error_message, explanation_id')
      .eq('id', runId)
      .maybeSingle();
    if (runErr) throw runErr;
    if (!run) throw new Error(`Run not found: ${runId}`);

    let originalContent = '';
    if (run.explanation_id) {
      const { data: exp, error: expErr } = await ctx.supabase
        .from('explanations')
        .select('content')
        .eq('id', run.explanation_id)
        .maybeSingle();
      if (expErr) throw expErr;
      originalContent = exp?.content ?? '';
    }

    let winnerVariantContent: string | null = null;
    let costSpent: number | null = null;

    if (run.status === 'completed') {
      // Find the winning variant (highest elo_score for this run).
      const { data: winners, error: winErr } = await ctx.supabase
        .from('evolution_variants')
        .select('variant_content, cost_usd')
        .eq('run_id', runId)
        .eq('is_winner', true)
        .limit(1);
      if (winErr) throw winErr;
      if (winners && winners.length > 0) {
        winnerVariantContent = winners[0]!.variant_content as string;
      }
      // Read the run's aggregated cost metric if available
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const costRow: any = await ctx.supabase
        .from('evolution_metrics')
        .select('value')
        .eq('entity_type', 'run')
        .eq('entity_id', runId)
        .eq('metric_name', 'cost')
        .maybeSingle();
      if (!costRow.error && costRow.data) {
        costSpent = Number(costRow.data.value);
      }
    }

    return {
      status: run.status as EditRunStatus['status'],
      originalContent,
      winnerVariantContent,
      errorMessage: run.error_message ?? null,
      costSpent,
      // Rough ETA: pending = ~30s queue wait, claimed/running = depends. v1 is null.
      etaSeconds: run.status === 'pending' ? 30 : null,
    };
  },
);
