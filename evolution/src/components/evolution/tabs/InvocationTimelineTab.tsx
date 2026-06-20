'use client';
// Timeline tab for a single generate_from_previous_article invocation.
// Renders a two-segment phase bar (generation + ranking) with per-comparison
// sub-bars stacked within the ranking segment. Reads `execution_detail` directly
// (NOT config-driven) because the visualization is bespoke.
//
// Handles 4 shapes:
//   1. Complete invocation with full timing
//   2. Running invocation (duration_ms null, partial execution_detail)
//   3. Pre-instrumentation historical invocation (no durationMs fields)
//      → falls back to proportional share from total ranking cost/duration
//   4. Discarded variant (ranking === null) → only generation segment rendered
//
// Comparison count > 20 triggers bucket aggregation to prevent illegible
// 30-segment ranking bars.

import { GanttBar } from '@evolution/components/evolution/visualizations/GanttBar';

const GENERATION_COLOR = '#3b82f6'; // blue
const RANKING_COLOR = '#8b5cf6';    // purple
const COMPARISON_COLOR = '#a78bfa'; // lighter purple
// Phase 10 of develop_reflection_and_generateFromParentArticle_agent_evolution_20260430:
// the wrapper agent prepends a reflection LLM call, rendered as an amber bar.
const REFLECTION_COLOR = '#f59e0b'; // amber
// Criteria-driven wrapper: single combined evaluate + suggest LLM call rendered as
// an emerald bar (one phase, not two — sourced from one LLM response).
const EVALUATE_AND_SUGGEST_COLOR = '#10b981'; // emerald
// bring_back_debate_agent_20260506 Phase 4.5 — debate wrapper's combined analyze+judge
// LLM call rendered as a rose bar (one phase per Option C — Decision §17). Distinct from
// the marker-tactic palette color #fda4af (Phase 1.11) used in the lineage graph.
const DEBATE_COLOR = '#f472b6'; // rose
// rank_individual_paragraphs_evolution_20260525 Phase 6 — paragraph slot timing.
// Two sub-segments per slot rendered as parallel rows: rewrite (light) + rank (deep).
const PARAGRAPH_REWRITE_COLOR = '#06b6d4'; // cyan
const PARAGRAPH_RANK_COLOR = '#0e7490';    // deep cyan
const COMPARISON_BUCKET_THRESHOLD = 20;
const COMPARISON_BUCKET_SIZE = 5;

export interface InvocationTimelineTabProps {
  invocation: {
    id: string;
    agent_name: string;
    duration_ms: number | null;
    execution_detail: Record<string, unknown> | null;
  };
}

interface ComparisonRecord {
  round: number;
  opponentId?: string;
  outcome?: string;
  durationMs?: number;
}

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Resolve per-comparison durations. If timing data is missing (historical invocations),
 *  proportionally distribute the total ranking duration across comparisons. Returns
 *  the resolved array plus a flag indicating whether timing was estimated. */
function resolveComparisonDurations(
  comparisons: ComparisonRecord[],
  rankingTotalMs: number | undefined,
): { resolved: Array<ComparisonRecord & { resolvedDurationMs: number }>; estimated: boolean } {
  const withTiming = comparisons.filter((c) => c.durationMs != null && c.durationMs > 0);
  if (withTiming.length === comparisons.length && comparisons.length > 0) {
    // All have timing — use directly.
    return {
      resolved: comparisons.map((c) => ({ ...c, resolvedDurationMs: c.durationMs ?? 0 })),
      estimated: false,
    };
  }
  // Missing timing — proportionally distribute total ranking duration.
  const fallbackTotal = rankingTotalMs ?? 0;
  const perComparison = comparisons.length > 0 ? fallbackTotal / comparisons.length : 0;
  return {
    resolved: comparisons.map((c) => ({
      ...c,
      resolvedDurationMs: c.durationMs ?? perComparison,
    })),
    estimated: comparisons.length > 0 && withTiming.length < comparisons.length,
  };
}

/** Aggregate comparisons into buckets of size ~COMPARISON_BUCKET_SIZE when count
 *  exceeds COMPARISON_BUCKET_THRESHOLD. Prevents illegible 30-segment bars. */
function maybeBucketComparisons(
  comparisons: Array<ComparisonRecord & { resolvedDurationMs: number }>,
): Array<{ label: string; durationMs: number; tooltip: string }> {
  if (comparisons.length <= COMPARISON_BUCKET_THRESHOLD) {
    return comparisons.map((c) => ({
      label: `#${c.round}`,
      durationMs: c.resolvedDurationMs,
      tooltip: `Comparison ${c.round}\nOpponent: ${c.opponentId?.slice(0, 8) ?? '—'}\nOutcome: ${c.outcome ?? '—'}\nDuration: ${fmtMs(c.resolvedDurationMs)}`,
    }));
  }
  // Bucket into groups of COMPARISON_BUCKET_SIZE
  const buckets: Array<{ label: string; durationMs: number; tooltip: string }> = [];
  for (let i = 0; i < comparisons.length; i += COMPARISON_BUCKET_SIZE) {
    const chunk = comparisons.slice(i, i + COMPARISON_BUCKET_SIZE);
    const sumMs = chunk.reduce((s, c) => s + c.resolvedDurationMs, 0);
    const first = chunk[0]!.round;
    const last = chunk[chunk.length - 1]!.round;
    buckets.push({
      label: `#${first}-${last}`,
      durationMs: sumMs,
      tooltip: `Comparisons ${first}-${last}\nTotal duration: ${fmtMs(sumMs)}`,
    });
  }
  return buckets;
}

export function InvocationTimelineTab({ invocation }: InvocationTimelineTabProps): JSX.Element {
  const detail = invocation.execution_detail as Record<string, unknown> | null;

  // paragraph_recombine has its own per-slot bespoke timeline (see below).
  if (detail && (detail.detailType as string | undefined) === 'paragraph_recombine') {
    return <ParagraphRecombineTimeline detail={detail} totalDurationMs={invocation.duration_ms} />;
  }

  // Extract generation and ranking subsections
  const generation = (detail?.generation as Record<string, unknown> | undefined) ?? null;
  const ranking = (detail?.ranking as Record<string, unknown> | null | undefined) ?? null;

  // Running invocation — no total duration yet
  if (invocation.duration_ms == null && !detail) {
    return (
      <div className="p-4 rounded-book bg-[var(--surface-elevated)] text-sm font-ui text-[var(--text-muted)]" data-testid="timeline-running">
        Invocation in progress — timeline will appear once execution completes.
      </div>
    );
  }

  const generationDurationMs =
    (generation?.durationMs as number | undefined) ??
    (ranking == null && invocation.duration_ms != null ? invocation.duration_ms : undefined);

  const rankingDurationMs = ranking?.durationMs as number | undefined;

  // Phase 10: the wrapper agent's execution_detail prepends a `reflection` sub-object
  // with its own durationMs/cost. Optional — omitted on legacy/historic rows.
  const reflection = (detail?.reflection as Record<string, unknown> | undefined) ?? null;
  const reflectionDurationMs = reflection?.durationMs as number | undefined;

  // Criteria-driven wrapper: single combined evaluate + suggest sub-object.
  const evaluateAndSuggest = (detail?.evaluateAndSuggest as Record<string, unknown> | undefined) ?? null;
  const evaluateAndSuggestDurationMs = evaluateAndSuggest?.durationMs as number | undefined;

  // bring_back_debate_agent_20260506 Phase 4.5 — debate wrapper's combined analyze+judge call.
  // Path: execution_detail.debate.combined.{durationMs, cost} per Phase 1.2 schema.
  const debateBlock = (detail?.debate as Record<string, unknown> | undefined) ?? null;
  const debateCombined = (debateBlock?.combined as Record<string, unknown> | undefined) ?? null;
  const debateCombinedDurationMs = debateCombined?.durationMs as number | undefined;

  // Phase bar total = reflection + evaluate-and-suggest + debate-judge + generation + ranking,
  // fallback to invocation total. (Reflection / evaluate-and-suggest / debate-judge are
  // mutually exclusive — one wrapper agent uses each.)
  const phaseTotalMs =
    (reflectionDurationMs ?? 0)
    + (evaluateAndSuggestDurationMs ?? 0)
    + (debateCombinedDurationMs ?? 0)
    + (generationDurationMs ?? 0)
    + (rankingDurationMs ?? 0) ||
    invocation.duration_ms ||
    1;

  // Bar startMs offsets account for the wrapper-prefix phase coming first.
  const wrapperPrefixMs =
    (reflectionDurationMs ?? 0)
    + (evaluateAndSuggestDurationMs ?? 0)
    + (debateCombinedDurationMs ?? 0);
  const generationStartMs = wrapperPrefixMs;
  const rankingStartMs = generationStartMs + (generationDurationMs ?? 0);

  const comparisons = ((ranking?.comparisons as ComparisonRecord[] | undefined) ?? []);
  const discardedVariant = ranking === null;

  const { resolved, estimated } = resolveComparisonDurations(comparisons, rankingDurationMs);
  const buckets = maybeBucketComparisons(resolved);
  const bucketed = buckets.length < comparisons.length;

  return (
    <div className="space-y-4" data-testid="invocation-timeline">
      <div className="text-xs font-ui text-[var(--text-muted)]">
        Total invocation: {fmtMs(invocation.duration_ms)}
        {estimated && (
          <span className="ml-2 italic" data-testid="timeline-estimated-note">
            (per-comparison timing estimated from total — instrumentation unavailable)
          </span>
        )}
        {bucketed && (
          <span className="ml-2 italic" data-testid="timeline-bucketed-note">
            ({comparisons.length} comparisons bucketed into {buckets.length} groups)
          </span>
        )}
      </div>

      {/* Phase bar: reflection (amber, optional) + generation (blue) + ranking (purple) */}
      <div className="space-y-1">
        <div className="text-xs font-ui text-[var(--text-secondary)]">Phases</div>
        <div className="flex gap-2 items-center">
          <div className="w-20 shrink-0 text-right">
            <span className="text-xs font-ui text-[var(--text-muted)]">Phase</span>
          </div>
          <div className="flex-1 relative h-6" data-testid="timeline-phase-bars">
            {reflectionDurationMs != null && (
              <GanttBar
                startMs={0}
                durationMs={reflectionDurationMs}
                totalMs={phaseTotalMs}
                color={REFLECTION_COLOR}
                label={`Refl ${fmtMs(reflectionDurationMs)}`}
                tooltip={`Reflection phase (1 LLM call to pick tactic)\nDuration: ${fmtMs(reflectionDurationMs)}\nCost: ${(reflection?.cost as number | undefined)?.toFixed(4) ?? '—'}`}
                testId="timeline-reflection-bar"
              />
            )}
            {evaluateAndSuggestDurationMs != null && (
              <GanttBar
                startMs={0}
                durationMs={evaluateAndSuggestDurationMs}
                totalMs={phaseTotalMs}
                color={EVALUATE_AND_SUGGEST_COLOR}
                label={`Eval & Suggest ${fmtMs(evaluateAndSuggestDurationMs)}`}
                tooltip={`Combined evaluate + suggest phase (1 LLM call)\nDuration: ${fmtMs(evaluateAndSuggestDurationMs)}\nCost: ${(evaluateAndSuggest?.cost as number | undefined)?.toFixed(4) ?? '—'}`}
                testId="timeline-evaluate-and-suggest-bar"
              />
            )}
            {debateCombinedDurationMs != null && (
              <GanttBar
                startMs={0}
                durationMs={debateCombinedDurationMs}
                totalMs={phaseTotalMs}
                color={DEBATE_COLOR}
                label={`Analyze + Judge ${fmtMs(debateCombinedDurationMs)}`}
                tooltip={`Combined analyze + judge phase (1 LLM call per Option C — bring_back_debate_agent_20260506 Decision §17)\nDuration: ${fmtMs(debateCombinedDurationMs)}\nCost: ${(debateCombined?.cost as number | undefined)?.toFixed(4) ?? '—'}`}
                testId="timeline-debate-bar"
              />
            )}
            {generationDurationMs != null && (
              <GanttBar
                startMs={generationStartMs}
                durationMs={generationDurationMs}
                totalMs={phaseTotalMs}
                color={GENERATION_COLOR}
                label={`Gen ${fmtMs(generationDurationMs)}`}
                tooltip={`Generation phase\nDuration: ${fmtMs(generationDurationMs)}\nCost: ${(generation?.cost as number | undefined)?.toFixed(4) ?? '—'}`}
                testId="timeline-generation-bar"
              />
            )}
            {rankingDurationMs != null && (
              <GanttBar
                startMs={rankingStartMs}
                durationMs={rankingDurationMs}
                totalMs={phaseTotalMs}
                color={RANKING_COLOR}
                label={`Rank ${fmtMs(rankingDurationMs)}`}
                tooltip={`Ranking phase (${comparisons.length} comparisons)\nDuration: ${fmtMs(rankingDurationMs)}\nCost: ${(ranking?.cost as number | undefined)?.toFixed(4) ?? '—'}`}
                testId="timeline-ranking-bar"
              />
            )}
          </div>
        </div>
      </div>

      {/* Discarded variant notice */}
      {discardedVariant && (
        <div className="p-3 rounded-book bg-[var(--surface-elevated)] text-xs font-ui text-[var(--text-muted)]" data-testid="timeline-discarded">
          Variant was discarded — no ranking phase occurred.
        </div>
      )}

      {/* Per-comparison sub-bars */}
      {buckets.length > 0 && rankingDurationMs != null && (() => {
        // Position sub-bars relative to the full phase bar. Cumulative offsets within ranking.
        // Phase 10: rankingStartMs already accounts for reflection's offset.
        let cursorMs = rankingStartMs;
        return (
          <div className="space-y-1" data-testid="timeline-comparisons">
            <div className="text-xs font-ui text-[var(--text-secondary)]">
              Comparisons ({comparisons.length}{bucketed ? `, bucketed` : ''})
            </div>
            {buckets.map((b, i) => {
              const barStart = cursorMs;
              cursorMs += b.durationMs;
              return (
                <div key={i} className="flex gap-2 items-center" data-testid={`timeline-comparison-${i}`}>
                  <div className="w-20 shrink-0 text-right">
                    <span className="text-xs font-mono text-[var(--text-muted)]">{b.label}</span>
                  </div>
                  <div className="flex-1 relative h-4">
                    <GanttBar
                      startMs={barStart}
                      durationMs={b.durationMs}
                      totalMs={phaseTotalMs}
                      color={COMPARISON_COLOR}
                      tooltip={b.tooltip}
                      testId={`timeline-comparison-bar-${i}`}
                    />
                  </div>
                  <div className="w-14 shrink-0 text-right">
                    <span className="text-xs font-mono text-[var(--text-muted)]">{fmtMs(b.durationMs)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
}

interface ParagraphSlotTimingDetail {
  detailType: 'paragraph_recombine';
  slots: Array<{
    slotIndex: number;
    spentUsd: number;
    rewrites: Array<{ durationMs?: number }>;
    ranking?: { matchCount: number };
    discardReason?: { failurePoint: string };
  }>;
  /** Sequential Context-Aware Generation: presence implies sequential execution (vs parallel). */
  coordinatorPlan?: unknown;
  /** Sequential coordinator phase timing — drawn as a leading bar before slot rows. */
  coordinator?: { durationMs?: number; cost?: number };
}

function ParagraphRecombineTimeline({
  detail,
  totalDurationMs,
}: {
  detail: Record<string, unknown>;
  totalDurationMs: number | null;
}): JSX.Element {
  const typedDetail = detail as unknown as ParagraphSlotTimingDetail;
  const slots = typedDetail.slots ?? [];

  if (slots.length === 0) {
    return (
      <div className="p-3 rounded-book bg-[var(--surface-elevated)] text-sm font-ui text-[var(--text-muted)]" data-testid="timeline-paragraph-empty">
        No slot timing data.
      </div>
    );
  }

  // Per-slot total ms = sum of rewrite durations + (matchCount × heuristic 300ms per ranking call).
  // No ranking timing is recorded per-call in v1, so we estimate from match count.
  const RANK_MS_PER_MATCH = 300;
  const slotTotals = slots.map((s) => {
    const rewriteMs = s.rewrites.reduce((acc, r) => acc + (r.durationMs ?? 0), 0);
    const rankMs = (s.ranking?.matchCount ?? 0) * RANK_MS_PER_MATCH;
    return { slotIndex: s.slotIndex, rewriteMs, rankMs, totalMs: rewriteMs + rankMs };
  });
  const widestSlotMs = Math.max(1, ...slotTotals.map((s) => s.totalMs));

  const isSequential = typedDetail.coordinatorPlan !== undefined;
  const executionMode = isSequential ? 'sequentially (Phase B context-aware loop)' : 'in parallel (D18)';

  return (
    <div className="space-y-3" data-testid="timeline-paragraph-recombine">
      <div className="text-xs font-ui text-[var(--text-muted)]">
        Total invocation: {fmtMs(totalDurationMs)} · {slots.length} slot{slots.length === 1 ? '' : 's'} executed {executionMode}
      </div>
      <div className="space-y-1">
        {slotTotals.map((s) => (
          <div key={s.slotIndex} className="flex gap-2 items-center" data-testid={`timeline-paragraph-slot-${s.slotIndex}`}>
            <div className="w-16 shrink-0 text-right">
              <span className="text-xs font-mono text-[var(--text-muted)]">P{s.slotIndex + 1}</span>
            </div>
            <div className="flex-1 relative h-5">
              <GanttBar
                startMs={0}
                durationMs={s.rewriteMs}
                totalMs={widestSlotMs}
                color={PARAGRAPH_REWRITE_COLOR}
                label={`rewrite ${fmtMs(s.rewriteMs)}`}
                tooltip={`Paragraph ${s.slotIndex + 1} rewrite phase (M parallel rewrites)\nDuration: ${fmtMs(s.rewriteMs)}`}
                testId={`timeline-paragraph-rewrite-${s.slotIndex}`}
              />
              <GanttBar
                startMs={s.rewriteMs}
                durationMs={s.rankMs}
                totalMs={widestSlotMs}
                color={PARAGRAPH_RANK_COLOR}
                label={`rank ${fmtMs(s.rankMs)}`}
                tooltip={`Paragraph ${s.slotIndex + 1} ranking phase (estimated ${RANK_MS_PER_MATCH}ms/match)\nDuration: ${fmtMs(s.rankMs)}`}
                testId={`timeline-paragraph-rank-${s.slotIndex}`}
              />
            </div>
            <div className="w-20 shrink-0 text-right">
              <span className="text-xs font-mono text-[var(--text-muted)]">{fmtMs(s.totalMs)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
