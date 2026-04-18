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

  // Phase bar total = generation + ranking durations, fallback to invocation total.
  const phaseTotalMs =
    (generationDurationMs ?? 0) + (rankingDurationMs ?? 0) ||
    invocation.duration_ms ||
    1;

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

      {/* Phase bar: generation (blue) + ranking (purple) */}
      <div className="space-y-1">
        <div className="text-xs font-ui text-[var(--text-secondary)]">Phases</div>
        <div className="flex gap-2 items-center">
          <div className="w-20 shrink-0 text-right">
            <span className="text-xs font-ui text-[var(--text-muted)]">Phase</span>
          </div>
          <div className="flex-1 relative h-6" data-testid="timeline-phase-bars">
            {generationDurationMs != null && (
              <GanttBar
                startMs={0}
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
                startMs={generationDurationMs ?? 0}
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
        const rankingStart = generationDurationMs ?? 0;
        // Position sub-bars relative to the full phase bar. Cumulative offsets within ranking.
        let cursorMs = rankingStart;
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
