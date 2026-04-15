// Cost Estimates tab for run and strategy detail pages.
// Surfaces data from costEstimationActions: summary, cost-by-agent, per-invocation table,
// error histogram, and the projected-vs-actual Budget Floor Sensitivity module.
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { MetricGrid, type MetricItem } from '@evolution/components/evolution';
import {
  getRunCostEstimatesAction,
  getStrategyCostEstimatesAction,
  type RunCostEstimates,
  type StrategyCostEstimates,
  type BudgetFloorSensitivity,
  type CostByAgentRow,
  type HistogramBucket,
} from '@evolution/services/costEstimationActions';
import { formatCost, formatCostDetailed, formatPercent } from '@evolution/lib/utils/formatters';

interface CostEstimatesTabProps {
  entityType: 'run' | 'strategy';
  entityId: string;
}

type Status = 'idle' | 'loading' | 'data' | 'error';

// ─── Entry point ─────────────────────────────────────────────────

export function CostEstimatesTab({ entityType, entityId }: CostEstimatesTabProps): JSX.Element {
  if (entityType === 'run') return <RunCostEstimatesView runId={entityId} />;
  return <StrategyCostEstimatesView strategyId={entityId} />;
}

// ─── Run view ────────────────────────────────────────────────────

function RunCostEstimatesView({ runId }: { runId: string }): JSX.Element {
  const [status, setStatus] = useState<Status>('loading');
  const [data, setData] = useState<RunCostEstimates | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setStatus('loading');
      const res = await getRunCostEstimatesAction({ runId });
      if (cancelled) return;
      if (res.success && res.data) {
        setData(res.data);
        setStatus('data');
      } else {
        setError(res.error?.message ?? 'Failed to load cost estimates');
        setStatus('error');
      }
    }
    load();
    return () => { cancelled = true; };
  }, [runId]);

  if (status === 'loading') return <LoadingSkeleton />;
  if (status === 'error' || !data) {
    return <ErrorBanner message={error ?? 'Failed to load cost estimates'} />;
  }

  const { summary, costByAgent, invocations, histogram, budgetFloorSensitivity } = data;

  const hasAnyEstimateData = summary.estimatedCost != null || summary.errorPct != null;

  return (
    <div className="space-y-6" data-testid="cost-estimates-tab">
      {!hasAnyEstimateData && (
        <Badge tone="info" testId="cost-estimates-pre-instrumentation">
          No estimation data (pre-instrumentation run)
        </Badge>
      )}

      <SummarySection
        items={[
          { id: 'totalCost', label: 'Total Cost', value: formatCostMaybe(summary.totalCost) },
          { id: 'estimatedCost', label: 'Estimated', value: formatCostMaybe(summary.estimatedCost) },
          { id: 'absError', label: 'Abs Error', value: formatCostDetailMaybe(summary.absError) },
          { id: 'errorPct', label: 'Error %', value: formatPctWithTone(summary.errorPct) },
          { id: 'budgetCap', label: 'Budget Cap', value: formatCostMaybe(summary.budgetCap) },
        ]}
      />

      <CostByAgentSection rows={costByAgent} />

      {budgetFloorSensitivity.applicable && (
        <BudgetFloorSensitivitySection sensitivity={budgetFloorSensitivity} />
      )}

      <ErrorHistogramSection histogram={histogram} title="GFSA Error Distribution" />

      <CostPerInvocationSection invocations={invocations} />
    </div>
  );
}

// ─── Strategy view ───────────────────────────────────────────────

function StrategyCostEstimatesView({ strategyId }: { strategyId: string }): JSX.Element {
  const [status, setStatus] = useState<Status>('loading');
  const [data, setData] = useState<StrategyCostEstimates | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setStatus('loading');
      const res = await getStrategyCostEstimatesAction({ strategyId });
      if (cancelled) return;
      if (res.success && res.data) {
        setData(res.data);
        setStatus('data');
      } else {
        setError(res.error?.message ?? 'Failed to load cost estimates');
        setStatus('error');
      }
    }
    load();
    return () => { cancelled = true; };
  }, [strategyId]);

  if (status === 'loading') return <LoadingSkeleton />;
  if (status === 'error' || !data) {
    return <ErrorBanner message={error ?? 'Failed to load cost estimates'} />;
  }

  const { summary, runs, sliceBreakdown, histogram, truncatedSlices } = data;

  return (
    <div className="space-y-6" data-testid="cost-estimates-tab">
      <SummarySection
        items={[
          { id: 'runCount', label: 'Runs', value: String(summary.runCount) },
          { id: 'totalCost', label: 'Total Cost', value: formatCostMaybe(summary.totalCost) },
          { id: 'estimatedCost', label: 'Total Estimated', value: formatCostMaybe(summary.estimatedCost) },
          { id: 'errorPct', label: 'Avg Error %', value: formatPctWithTone(summary.errorPct) },
          { id: 'withEst', label: 'Runs w/ Estimates', value: String(summary.runsWithEstimates) },
        ]}
      />

      <SliceBreakdownSection rows={sliceBreakdown} truncated={truncatedSlices} />

      <ErrorHistogramSection histogram={histogram} title="Error Distribution Across Runs" />

      <RunsTableSection runs={runs} />
    </div>
  );
}

// ─── Sections ────────────────────────────────────────────────────

function SummarySection({ items }: { items: MetricItem[] }): JSX.Element {
  return (
    <div data-testid="cost-estimates-summary">
      <h3 className="text-xl font-display font-medium text-[var(--text-secondary)] mb-2">Summary</h3>
      <MetricGrid metrics={items} columns={5} variant="card" />
    </div>
  );
}

function CostByAgentSection({ rows }: { rows: CostByAgentRow[] }): JSX.Element {
  return (
    <div data-testid="cost-estimates-by-agent">
      <h3 className="text-xl font-display font-medium text-[var(--text-secondary)] mb-2">Cost by Agent</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)]">No invocations recorded.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-[var(--border-default)]">
                <th className="py-2 pr-4">Agent</th>
                <th className="py-2 pr-4 text-right">Invocations</th>
                <th className="py-2 pr-4 text-right">Estimated</th>
                <th className="py-2 pr-4 text-right">Actual</th>
                <th className="py-2 pr-4 text-right">Error %</th>
                <th className="py-2">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.agentName} className="border-b border-[var(--border-subtle)]">
                  <td className="py-1.5 pr-4 font-mono">{r.agentName}</td>
                  <td className="py-1.5 pr-4 text-right">{r.invocations}</td>
                  <td className="py-1.5 pr-4 text-right font-mono">
                    {r.estimatedUsd != null ? formatCostDetailed(r.estimatedUsd) : '—'}
                  </td>
                  <td className="py-1.5 pr-4 text-right font-mono">
                    {formatCostDetailed(r.actualUsd)}
                  </td>
                  <td className="py-1.5 pr-4 text-right font-mono">
                    {r.errorPct != null ? formatPctWithToneText(r.errorPct) : '—'}
                  </td>
                  <td className="py-1.5 font-mono text-xs text-[var(--text-secondary)]">
                    {r.coverage}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BudgetFloorSensitivitySection({
  sensitivity,
}: { sensitivity: Extract<BudgetFloorSensitivity, { applicable: true }> }): JSX.Element {
  const [showWorking, setShowWorking] = useState(false);
  const { drift, actual, projected, config, edge } = sensitivity;

  const deltaInvocations = actual.sequentialDispatched - projected.sequentialDispatched;
  const deltaMs = (actual.sequentialWallMs ?? 0) - (projected.sequentialWallMs ?? 0);
  const underOrOver = drift.pct < 0 ? 'under' : 'over';
  const driftAbs = Math.abs(drift.pct);

  return (
    <div data-testid="budget-floor-sensitivity"
         className="border border-[var(--border-default)] rounded-book p-4 bg-[var(--surface-elevated)]">
      <h3 className="text-xl font-display font-medium text-[var(--text-secondary)] mb-1">
        Budget Floor Sensitivity
      </h3>
      <p className="text-sm text-[var(--text-secondary)] mb-3">
        How many extra / fewer invocations ran because we over/under-estimated agent invocation cost?
      </p>

      <dl className="grid grid-cols-2 gap-2 text-sm mb-4">
        <dt className="text-[var(--text-secondary)]">Agent cost</dt>
        <dd className="font-mono">
          {formatCostDetailed(drift.estimate)} estimated → {formatCostDetailed(drift.actual)} actual
          {' '}
          <span className={drift.pct < 0 ? 'text-amber-500' : 'text-green-500'}>
            ({underOrOver} {formatPercentNumber(driftAbs)})
          </span>
        </dd>
        <dt className="text-[var(--text-secondary)]">Floor</dt>
        <dd className="font-mono">
          {config.parallelMultiplier != null
            ? `parallel ${config.parallelMultiplier}× agentCost, `
            : 'parallel — static/unset, '}
          sequential {config.sequentialMultiplier}× agentCost
        </dd>
      </dl>

      {edge === 'accurate' && (
        <Badge tone="info" testId="sensitivity-accurate">
          Agent cost estimate within 2% of actual. Projected and actual sequential dispatch match.
        </Badge>
      )}
      {edge === 'ceiling_binding' && (
        <Badge tone="info" testId="sensitivity-ceiling">
          numVariants ceiling binding in both scenarios — Δ = 0.
        </Badge>
      )}

      {!edge && (
        <div className="border border-[var(--border-subtle)] rounded-page p-3 bg-[var(--surface-base)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th></th>
                <th className="text-right">Invocations (sequential)</th>
                <th className="text-right">Wall time (sequential)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="py-1 pr-4">Actual (this run)</td>
                <td className="py-1 pr-4 text-right font-mono">{actual.sequentialDispatched}</td>
                <td className="py-1 pr-4 text-right font-mono">{formatMsMaybe(actual.sequentialWallMs)}</td>
              </tr>
              <tr>
                <td className="py-1 pr-4">Projected (accurate cost)</td>
                <td className="py-1 pr-4 text-right font-mono">{projected.sequentialDispatched}</td>
                <td className="py-1 pr-4 text-right font-mono">{formatMsMaybe(projected.sequentialWallMs)}</td>
              </tr>
              <tr className="border-t border-[var(--border-subtle)]">
                <td className="py-1 pr-4 font-medium">Δ (actual − projected)</td>
                <td className="py-1 pr-4 text-right font-mono">
                  {deltaInvocations > 0 ? `+${deltaInvocations}` : deltaInvocations}
                </td>
                <td className="py-1 pr-4 text-right font-mono">
                  {deltaMs > 0 ? '+' : ''}{formatMsDelta(deltaMs)}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-3 text-sm text-[var(--text-secondary)]">
            {underOrOver === 'under' ? 'Under' : 'Over'}-estimating agent cost by {formatPercentNumber(driftAbs)} caused this run to{' '}
            {deltaInvocations === 0 ? 'dispatch the same number of' :
              deltaInvocations < 0 ? `dispatch ${Math.abs(deltaInvocations)} fewer` :
              `dispatch ${deltaInvocations} more`}{' '}
            sequential GFSA invocation{deltaInvocations === 1 || deltaInvocations === -1 ? '' : 's'}
            {actual.sequentialWallMs != null && projected.sequentialWallMs != null ? (
              <> and finish {deltaMs < 0 ? `~${formatMsDelta(Math.abs(deltaMs))} sooner` : deltaMs > 0 ? `~${formatMsDelta(deltaMs)} later` : 'at the same wall time'} than it would have with an accurate cost estimate.</>
            ) : '.'}
          </p>
          <button
            type="button"
            className="mt-2 text-xs underline text-[var(--text-secondary)]"
            onClick={() => setShowWorking((v) => !v)}
          >
            {showWorking ? 'Hide working' : 'Show working'}
          </button>
          {showWorking && (
            <pre className="mt-2 text-xs bg-[var(--surface-elevated)] p-2 rounded overflow-x-auto">
{`"Projected" holds floor multipliers fixed and swaps the estimate to the
observed actual (${formatCostDetailed(drift.actual)}) throughout the dispatch math.

Actual (est ${formatCostDetailed(drift.estimate)} used at run start):
  parallel dispatched = ${actual.parallelDispatched}
  sequential dispatched = ${actual.sequentialDispatched}

Projected (est = actual ${formatCostDetailed(drift.actual)}):
  parallel dispatched = ${projected.parallelDispatched}
  sequential dispatched = ${projected.sequentialDispatched}

Δ invocations = ${actual.sequentialDispatched} − ${projected.sequentialDispatched} = ${deltaInvocations}
${sensitivity.medianSequentialGfsaDurationMs != null
  ? `Δ wall time ≈ Δ × median sequential GFSA duration (${Math.round(sensitivity.medianSequentialGfsaDurationMs)}ms) = ${Math.round(deltaMs)}ms`
  : 'Δ wall time: not computed (no sequential GFSA samples available)'}`}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function ErrorHistogramSection({ histogram, title }: { histogram: HistogramBucket[]; title: string }): JSX.Element {
  const maxCount = Math.max(1, ...histogram.map((b) => b.count));
  const totalCount = histogram.reduce((a, b) => a + b.count, 0);
  return (
    <div data-testid="cost-estimates-histogram">
      <h3 className="text-xl font-display font-medium text-[var(--text-secondary)] mb-2">{title}</h3>
      {totalCount === 0 ? (
        <p className="text-sm text-[var(--text-secondary)]">No estimation error data.</p>
      ) : (
        <div className="flex items-end gap-3">
          {histogram.map((b) => {
            const height = Math.max(2, Math.round((b.count / maxCount) * 80));
            return (
              <div key={b.label} className="flex flex-col items-center flex-1 min-w-[4rem]">
                <div
                  className="w-full bg-[var(--accent-primary)]/80 rounded-t"
                  style={{ height: `${height}px` }}
                  data-testid={`histogram-bar-${b.label}`}
                />
                <div className="text-xs font-mono mt-1">{b.count}</div>
                <div className="text-xs text-[var(--text-secondary)] mt-0.5 whitespace-nowrap">{b.label}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CostPerInvocationSection({ invocations }: { invocations: RunCostEstimates['invocations'] }): JSX.Element {
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');

  const sorted = useMemo(() => {
    const copy = [...invocations];
    copy.sort((a, b) => {
      const ax = a.estimationErrorPct == null ? -Infinity : Math.abs(a.estimationErrorPct);
      const bx = b.estimationErrorPct == null ? -Infinity : Math.abs(b.estimationErrorPct);
      return sortDir === 'desc' ? bx - ax : ax - bx;
    });
    return copy;
  }, [invocations, sortDir]);

  return (
    <div data-testid="cost-estimates-invocations">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xl font-display font-medium text-[var(--text-secondary)]">Cost per Invocation</h3>
        <button
          type="button"
          className="text-xs underline text-[var(--text-secondary)]"
          onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
        >
          sort |error%| {sortDir === 'desc' ? '↓' : '↑'}
        </button>
      </div>
      {sorted.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)]">No invocations.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-[var(--border-default)]">
                <th className="py-2 pr-3">Iter</th>
                <th className="py-2 pr-3">Agent</th>
                <th className="py-2 pr-3">Strategy</th>
                <th className="py-2 pr-3 text-right">Gen Est</th>
                <th className="py-2 pr-3 text-right">Gen Actual</th>
                <th className="py-2 pr-3 text-right">Rank Est</th>
                <th className="py-2 pr-3 text-right">Rank Actual</th>
                <th className="py-2 pr-3 text-right">Total</th>
                <th className="py-2 pr-3 text-right">Error %</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--surface-elevated)]">
                  <td className="py-1 pr-3 font-mono text-xs">{r.iteration ?? ''}</td>
                  <td className="py-1 pr-3 font-mono text-xs">
                    <Link href={`/admin/evolution/invocations/${r.id}`} className="underline">
                      {r.agentName}
                    </Link>
                  </td>
                  <td className="py-1 pr-3 font-mono text-xs">{r.strategy ?? '—'}</td>
                  <td className="py-1 pr-3 text-right font-mono">{r.generationEstimate != null ? formatCostDetailed(r.generationEstimate) : '—'}</td>
                  <td className="py-1 pr-3 text-right font-mono">{r.generationActual != null ? formatCostDetailed(r.generationActual) : '—'}</td>
                  <td className="py-1 pr-3 text-right font-mono">{r.rankingEstimate != null ? formatCostDetailed(r.rankingEstimate) : '—'}</td>
                  <td className="py-1 pr-3 text-right font-mono">{r.rankingActual != null ? formatCostDetailed(r.rankingActual) : '—'}</td>
                  <td className="py-1 pr-3 text-right font-mono">{r.totalCost != null ? formatCostDetailed(r.totalCost) : '—'}</td>
                  <td className="py-1 pr-3 text-right font-mono">
                    {r.estimationErrorPct != null ? formatPctWithToneText(r.estimationErrorPct) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SliceBreakdownSection({
  rows, truncated,
}: { rows: StrategyCostEstimates['sliceBreakdown']; truncated: boolean }): JSX.Element {
  return (
    <div data-testid="cost-estimates-slices">
      <h3 className="text-xl font-display font-medium text-[var(--text-secondary)] mb-2">Slice Breakdown</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)]">No GFSA invocations recorded.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-[var(--border-default)]">
                <th className="py-2 pr-4">Strategy</th>
                <th className="py-2 pr-4">Generation model</th>
                <th className="py-2 pr-4">Judge model</th>
                <th className="py-2 pr-4 text-right">Invocations</th>
                <th className="py-2 pr-4 text-right">Avg actual</th>
                <th className="py-2 pr-4 text-right">Avg error %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx} className="border-b border-[var(--border-subtle)]">
                  <td className="py-1.5 pr-4 font-mono text-xs">{r.strategy}</td>
                  <td className="py-1.5 pr-4 font-mono text-xs">{r.generationModel ?? '—'}</td>
                  <td className="py-1.5 pr-4 font-mono text-xs">{r.judgeModel ?? '—'}</td>
                  <td className="py-1.5 pr-4 text-right font-mono">{r.runs}</td>
                  <td className="py-1.5 pr-4 text-right font-mono">{r.avgActual != null ? formatCostDetailed(r.avgActual) : '—'}</td>
                  <td className="py-1.5 pr-4 text-right font-mono">
                    {r.avgErrorPct != null ? formatPctWithToneText(r.avgErrorPct) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {truncated && (
            <p className="mt-2 text-xs text-[var(--text-secondary)]">Showing top 50 slices by invocation count.</p>
          )}
        </div>
      )}
    </div>
  );
}

function RunsTableSection({ runs }: { runs: StrategyCostEstimates['runs'] }): JSX.Element {
  return (
    <div data-testid="cost-estimates-runs">
      <h3 className="text-xl font-display font-medium text-[var(--text-secondary)] mb-2">Runs</h3>
      {runs.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)]">No completed runs.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-[var(--border-default)]">
                <th className="py-2 pr-4">Run</th>
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4 text-right">Total</th>
                <th className="py-2 pr-4 text-right">Estimated</th>
                <th className="py-2 pr-4 text-right">Error %</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.runId} className="border-b border-[var(--border-subtle)] hover:bg-[var(--surface-elevated)]">
                  <td className="py-1 pr-4 font-mono text-xs">
                    <Link
                      href={`/admin/evolution/runs/${r.runId}?tab=cost-estimates`}
                      className="underline"
                    >
                      {r.runId.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="py-1 pr-4 font-mono text-xs">{new Date(r.createdAt).toISOString().slice(0, 10)}</td>
                  <td className="py-1 pr-4 text-right font-mono">{r.totalCost != null ? formatCost(r.totalCost) : '—'}</td>
                  <td className="py-1 pr-4 text-right font-mono">{r.estimatedCost != null ? formatCost(r.estimatedCost) : '—'}</td>
                  <td className="py-1 pr-4 text-right font-mono">
                    {r.errorPct != null ? formatPctWithToneText(r.errorPct) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Shared primitives ───────────────────────────────────────────

function LoadingSkeleton(): JSX.Element {
  return (
    <div className="space-y-4" data-testid="cost-estimates-loading">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-24 bg-[var(--surface-elevated)] rounded-book animate-pulse" />
      ))}
    </div>
  );
}

function ErrorBanner({ message }: { message: string }): JSX.Element {
  return (
    <p className="text-[var(--status-error)] font-ui text-sm" data-testid="cost-estimates-error">
      {message}
    </p>
  );
}

function Badge({ tone, children, testId }: { tone: 'info' | 'warning'; children: React.ReactNode; testId?: string }): JSX.Element {
  const cls = tone === 'warning'
    ? 'bg-amber-500/10 text-amber-600 border-amber-500/40'
    : 'bg-sky-500/10 text-sky-600 border-sky-500/40';
  return (
    <div
      data-testid={testId}
      className={`inline-flex items-center px-3 py-1.5 text-xs border rounded-page ${cls}`}
    >
      {children}
    </div>
  );
}

// ─── Formatting helpers ──────────────────────────────────────────

function formatCostMaybe(v: number | null): string { return v == null ? '—' : formatCost(v); }
function formatCostDetailMaybe(v: number | null): string { return v == null ? '—' : formatCostDetailed(v); }

function formatPctWithTone(v: number | null): React.ReactNode {
  if (v == null) return '—';
  const abs = Math.abs(v);
  const tone = abs < 5 ? 'text-green-500' : abs < 15 ? 'text-amber-500' : 'text-red-500';
  const sign = v > 0 ? '+' : '';
  return <span className={`font-mono ${tone}`}>{sign}{formatPercentNumber(v)}</span>;
}

function formatPctWithToneText(v: number): string {
  const sign = v > 0 ? '+' : '';
  return `${sign}${formatPercentNumber(v)}`;
}

function formatPercentNumber(pct: number): string {
  // formatPercent expects a 0..1 ratio; here we have pct already in percentage units.
  // Use toFixed for consistency with the rest of the UI.
  return `${pct.toFixed(1)}%`;
}

function formatMsMaybe(ms: number | null): string {
  if (ms == null) return '—';
  return formatMs(ms);
}

function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s - m * 60);
  return `${m}m ${rest}s`;
}

function formatMsDelta(ms: number): string {
  return formatMs(Math.abs(ms));
}

// Silence unused import when the file is bundled — formatPercent retained for future use.
void formatPercent;
