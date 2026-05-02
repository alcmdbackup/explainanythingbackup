// Shared dispatch-plan renderer for the wizard preview, run detail Cost Estimates tab,
// and strategy detail Cost Estimates tab. Takes a projectDispatchPlan() output + optional
// actual dispatch data and renders the per-iteration breakdown with:
// - triple-value cost range (expected – upperBound) via formatCostRange
// - effective-cap badge (budget / safety_cap / floor / swiss)
// - optional projected-vs-actual delta column (when `actual` is supplied)
//
// Phase 6 of the 2026-04-20 refactor. Replaces three bespoke tables with a single
// canonical renderer so wizard / run / strategy pages can't drift.

'use client';

import type { IterationPlanEntryClient } from '@evolution/services/strategyPreviewActions';
import { formatCostMicro, formatCostRange } from '@evolution/lib/utils/formatters';

export interface DispatchPlanActualRow {
  iterIdx: number;
  actualDispatched: number;
  actualCostUsd: number;
}

export interface DispatchPlanViewProps {
  plan: IterationPlanEntryClient[];
  /** Per-iteration actual dispatch data. When supplied, a Δ column is rendered. */
  actual?: DispatchPlanActualRow[];
  /** Visual variant. `wizard` shows the calibration footer; `run`/`strategy` show actual deltas. */
  variant?: 'wizard' | 'run' | 'strategy';
  /** Optional total budget for roll-up display at the table foot. */
  totalBudgetUsd?: number;
  /** Optional test id for wrapper element. */
  testId?: string;
}

function badgeForCap(cap: IterationPlanEntryClient['effectiveCap']): { label: string; tone: 'neutral' | 'warning' | 'error' } {
  switch (cap) {
    case 'budget': return { label: 'budget', tone: 'neutral' };
    case 'floor': return { label: 'floor', tone: 'warning' };
    case 'safety_cap': return { label: 'safety cap', tone: 'error' };
    case 'swiss': return { label: 'swiss', tone: 'neutral' };
    case 'eligibility': return { label: 'cutoff', tone: 'warning' };
  }
}

const TONE_CLASSES: Record<'neutral' | 'warning' | 'error', string> = {
  neutral: 'bg-[var(--surface-base)] text-[var(--text-muted)] border-[var(--border-subtle)]',
  warning: 'bg-[var(--status-warning)]/15 text-[var(--status-warning)] border-[var(--status-warning)]/40',
  error: 'bg-[var(--status-error)]/15 text-[var(--status-error)] border-[var(--status-error)]/40',
};

const CAP_TOOLTIPS: Record<IterationPlanEntryClient['effectiveCap'], string> = {
  budget: 'Budget is the binding constraint.',
  floor: 'Budget floor (parallel) shrank the batch to the 1-agent minimum.',
  safety_cap: 'DISPATCH_SAFETY_CAP=100 binding — budget math would otherwise allow more.',
  swiss: 'Swiss iteration — no parallel generate batch.',
  eligibility: 'Editing eligibility cutoff is binding — budget math would allow more invocations than there are eligible top-Elo parents.',
};

function deltaBucket(pct: number): { color: string; label: string } {
  const abs = Math.abs(pct);
  const label = `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`;
  if (abs < 20) return { color: 'text-[var(--status-success)]', label };
  if (abs < 50) return { color: 'text-[var(--status-warning)]', label };
  return { color: 'text-[var(--status-error)]', label };
}

export function DispatchPlanView({
  plan,
  actual,
  variant = 'wizard',
  totalBudgetUsd,
  testId,
}: DispatchPlanViewProps): JSX.Element {
  const actualByIdx = new Map<number, DispatchPlanActualRow>(
    (actual ?? []).map((a) => [a.iterIdx, a]),
  );

  const showActual = actual != null && actual.length > 0;

  const totalPlannedDispatch = plan.reduce((acc, p) => acc + p.dispatchCount, 0);
  const totalLikelyDispatch = plan.reduce((acc, p) => acc + p.expectedTotalDispatch, 0);
  // Cost roll-ups multiply by `expectedTotalDispatch` (parallel + projected top-up) so the
  // displayed totals match what the runtime actually spends. Using `dispatchCount` here
  // would under-state the cost relative to the "Likely total" dispatch count column.
  const totalExpectedCost = plan.reduce((acc, p) => acc + p.expectedTotalDispatch * p.estPerAgent.expected.total, 0);
  const totalUpperBoundCost = plan.reduce((acc, p) => acc + p.expectedTotalDispatch * p.estPerAgent.upperBound.total, 0);
  const totalActualCost = showActual
    ? Array.from(actualByIdx.values()).reduce((a, b) => a + b.actualCostUsd, 0)
    : null;
  const realizationRatio = showActual && totalUpperBoundCost > 0
    ? (totalActualCost ?? 0) / totalUpperBoundCost
    : null;

  return (
    <div
      data-testid={testId ?? `dispatch-plan-${variant}`}
      className="space-y-2 text-sm font-ui"
    >
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left border-b border-[var(--border-default)]">
            <th className="py-1 pr-3 font-ui text-[var(--text-muted)]">Iter</th>
            <th className="py-1 pr-3 font-ui text-[var(--text-muted)]">Type</th>
            <th className="py-1 pr-3 font-ui text-[var(--text-muted)] text-right">Iter Budget</th>
            <th className="py-1 pr-3 font-ui text-[var(--text-muted)] text-right">Dispatch</th>
            <th
              className="py-1 pr-3 font-ui text-[var(--text-muted)] text-right"
              title="Parallel batch is reservation-safe (sized at upper-bound cost). Top-up runs after the parallel batch using actual cost feedback. EVOLUTION_TOPUP_ENABLED=false disables top-up."
            >Likely total (with top-up)</th>
            <th className="py-1 pr-3 font-ui text-[var(--text-muted)] text-right">$/Agent (exp – upper)</th>
            <th className="py-1 pr-3 font-ui text-[var(--text-muted)]">Cap</th>
            {showActual && <th className="py-1 pr-3 font-ui text-[var(--text-muted)] text-right">Actual</th>}
            {showActual && <th className="py-1 pr-3 font-ui text-[var(--text-muted)] text-right">Δ %</th>}
          </tr>
        </thead>
        <tbody>
          {plan.map((entry) => {
            const cap = badgeForCap(entry.effectiveCap);
            const act = actualByIdx.get(entry.iterIdx);
            // Per-iteration projected cost uses expectedTotalDispatch so the actual-vs-expected
            // delta compares against what we projected the runtime would actually spend
            // (parallel + top-up), not just the parallel batch.
            const expectedIterCost = entry.expectedTotalDispatch * entry.estPerAgent.expected.total;
            const delta = act && expectedIterCost > 0
              ? ((act.actualCostUsd - expectedIterCost) / expectedIterCost) * 100
              : null;
            return (
              <tr key={entry.iterIdx} className="border-b border-[var(--border-subtle)] last:border-0" data-testid={`dispatch-plan-row-${entry.iterIdx}`}>
                <td className="py-1 pr-3 font-mono">{entry.iterIdx + 1}</td>
                <td className="py-1 pr-3">
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold uppercase tracking-wider ${
                    entry.agentType === 'generate' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'
                  }`}>{entry.agentType}</span>
                </td>
                <td className="py-1 pr-3 text-right font-mono text-[var(--text-muted)]">
                  {formatCostMicro(entry.iterBudgetUsd)}
                </td>
                <td className="py-1 pr-3 text-right font-mono">{entry.dispatchCount}</td>
                <td className="py-1 pr-3 text-right font-mono" data-testid={`dispatch-plan-row-${entry.iterIdx}-likely`}>
                  {entry.agentType === 'swiss' ? '—' : (
                    <>
                      <div>{entry.expectedTotalDispatch}</div>
                      {entry.expectedTopUpDispatch > 0 && (
                        <div className="text-xs text-[var(--text-muted)]">
                          {entry.dispatchCount} parallel + {entry.expectedTopUpDispatch} top-up
                        </div>
                      )}
                    </>
                  )}
                </td>
                <td className="py-1 pr-3 text-right font-mono text-[var(--text-muted)]">
                  {entry.agentType === 'swiss' ? '—' : formatCostRange(entry.estPerAgent.expected.total, entry.estPerAgent.upperBound.total)}
                </td>
                <td className="py-1 pr-3">
                  <span
                    className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-ui border ${TONE_CLASSES[cap.tone]}`}
                    title={CAP_TOOLTIPS[entry.effectiveCap]}
                  >{cap.label}</span>
                </td>
                {showActual && (
                  <td className="py-1 pr-3 text-right font-mono">
                    {act ? `${act.actualDispatched} @ ${formatCostMicro(act.actualCostUsd)}` : '—'}
                  </td>
                )}
                {showActual && (
                  <td className="py-1 pr-3 text-right font-mono">
                    {delta != null ? <span className={deltaBucket(delta).color}>{deltaBucket(delta).label}</span> : '—'}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-[var(--border-default)] text-[var(--text-muted)]">
            <td className="py-1 pr-3 font-mono" colSpan={3}>
              Total · {totalBudgetUsd != null ? `budget ${formatCostMicro(totalBudgetUsd)}` : ''}
            </td>
            <td className="py-1 pr-3 text-right font-mono">{totalPlannedDispatch}</td>
            <td className="py-1 pr-3 text-right font-mono" data-testid="dispatch-plan-total-likely">{totalLikelyDispatch}</td>
            <td className="py-1 pr-3 text-right font-mono">
              {formatCostRange(totalExpectedCost, totalUpperBoundCost)}
            </td>
            <td className="py-1 pr-3"></td>
            {showActual && (
              <td className="py-1 pr-3 text-right font-mono">{formatCostMicro(totalActualCost ?? 0)}</td>
            )}
            {showActual && realizationRatio != null && (
              <td className="py-1 pr-3 text-right font-mono text-[var(--text-muted)]" title="actual spend / upper-bound projection">
                {(realizationRatio * 100).toFixed(0)}% realized
              </td>
            )}
          </tr>
        </tfoot>
      </table>

      {/* Warnings (6g) */}
      <DispatchPlanWarnings plan={plan} />

      {/* Calibration provenance (6f) — wizard-only for now; run/strategy pages show the
          Cost Estimates tab's own provenance elsewhere. */}
      {variant === 'wizard' && (
        <p className="text-xs font-ui text-[var(--text-muted)] italic">
          Estimates use empirical output sizes per tactic. `expected` values apply
          heuristic ratios (65–75% of upper bound for generation, ~50% of max comparisons for
          ranking) derived from Fed-class runs; live calibration via COST_CALIBRATION_ENABLED
          is not yet flipped on. The dispatch gate reserves at upperBound (reservation-safe);
          the runtime then top-ups beyond the parallel batch using actual cost feedback —
          the &ldquo;Likely total&rdquo; column projects this. When EVOLUTION_TOPUP_ENABLED=false,
          the projection collapses to the parallel batch.
        </p>
      )}
    </div>
  );
}

/** Warning banners surfaced above the plan table. Kept internal to DispatchPlanView but
 *  exported for tests / specific UI overrides. */
function DispatchPlanWarnings({ plan }: { plan: IterationPlanEntryClient[] }): JSX.Element | null {
  const warnings: string[] = [];

  // Arena-saturation warning: rank cost dominates total cost on generate iterations.
  const firstGenerate = plan.find((p) => p.agentType === 'generate');
  if (firstGenerate) {
    const { gen, rank } = firstGenerate.estPerAgent.upperBound;
    if (rank > 0 && gen > 0 && rank / (gen + rank) >= 0.7) {
      warnings.push(
        `Ranking cost dominates per-agent cost (≥70%). Consider lowering maxComparisonsPerVariant to fit more agents per iteration.`,
      );
    }
  }

  // Budget-insufficient: any variant-producing iter would dispatch ≤1 agent at upperBound.
  // When top-up rescues it, prefer the "likely fills via top-up" copy; otherwise keep the
  // original "increase budget" message.
  const tinyIter = plan.find(
    (p) => (p.agentType === 'generate' || p.agentType === 'reflect_and_generate') && p.dispatchCount <= 1,
  );
  if (tinyIter) {
    const iterLabel = tinyIter.iterIdx + 1;
    if (tinyIter.expectedTotalDispatch > tinyIter.dispatchCount) {
      warnings.push(
        `Iteration ${iterLabel} parallel batch is bound by floor (${tinyIter.dispatchCount} agent at upperBound) — top-up will likely add ~${tinyIter.expectedTopUpDispatch} more agents at runtime.`,
      );
    } else {
      warnings.push(
        `Iteration ${iterLabel} dispatches ${tinyIter.dispatchCount} agent at upperBound cost — budget is marginal for this iter. Increase budgetUsd or reduce maxComparisonsPerVariant.`,
      );
    }
  }

  // Safety-cap binding: unusual — usually means the cost estimator returned near-zero.
  const safetyHit = plan.find((p) => p.effectiveCap === 'safety_cap');
  if (safetyHit) {
    warnings.push(
      `Iteration ${safetyHit.iterIdx + 1} hit the 100-agent DISPATCH_SAFETY_CAP. This is rare — usually means the cost estimator returned an absurdly low value. Verify model pricing is wired correctly.`,
    );
  }

  if (warnings.length === 0) return null;

  return (
    <ul className="text-xs font-ui text-[var(--status-warning)] space-y-0.5 border-l-2 border-[var(--status-warning)]/60 pl-2" data-testid="dispatch-plan-warnings">
      {warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
    </ul>
  );
}
