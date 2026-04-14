'use client';
// Run-detail Timeline tab: Gantt-style view of agent invocations grouped by iteration.
// Parallel agents (same iteration, overlapping timestamps) appear as stacked rows.
// Each bar links to the invocation detail page. Final run outcome is shown below.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  listInvocationsAction,
  type InvocationListEntry,
} from '@evolution/services/invocationActions';
import type { EvolutionRun } from '@evolution/services/evolutionActions';
import {
  buildInvocationUrl,
  buildVariantDetailUrl,
} from '@evolution/lib/utils/evolutionUrls';
import { GanttBar } from '@evolution/components/evolution/visualizations/GanttBar';

export interface TimelineTabProps {
  runId: string;
  run: EvolutionRun;
}

// ─── Agent classification ───────────────────────────────────────────────────

type AgentKind = 'generate' | 'swiss' | 'merge' | 'other';

function agentKind(name: string): AgentKind {
  const n = name.toLowerCase();
  if (n.includes('generate')) return 'generate';
  if (n.includes('swiss')) return 'swiss';
  if (n.includes('merge')) return 'merge';
  return 'other';
}

const KIND_CONFIG: Record<AgentKind, { label: string; color: string }> = {
  generate: { label: 'Generate', color: '#3b82f6' },
  swiss:    { label: 'Swiss',    color: '#8b5cf6' },
  merge:    { label: 'Merge',    color: '#10b981' },
  other:    { label: 'Agent',    color: '#6b7280' },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtCost(usd: number | null | undefined): string {
  if (usd == null || usd === 0) return '—';
  if (usd < 0.0001) return '<$0.0001';
  return `$${usd.toFixed(4)}`;
}

function fmtSec(sec: number): string {
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m ${s}s`;
}

// ─── Sub-components ─────────────────────────────────────────────────────────

interface BarProps {
  inv: InvocationListEntry;
  runStartMs: number;
  totalMs: number;
}

function InvocationBar({ inv, runStartMs, totalMs }: BarProps): JSX.Element {
  const kind = agentKind(inv.agent_name);
  const { label, color } = KIND_CONFIG[kind];
  const offsetMs = new Date(inv.created_at).getTime() - runStartMs;

  const tooltip = [
    inv.agent_name,
    `Iter ${inv.iteration ?? '?'} · order ${inv.execution_order ?? '?'}`,
    `Duration: ${fmtMs(inv.duration_ms)}`,
    inv.cost_usd != null ? `Cost: $${inv.cost_usd.toFixed(5)}` : '',
    inv.success ? '✓ success' : `✗ ${inv.error_message ?? 'failed'}`,
  ].filter(Boolean).join('\n');

  return (
    <div className="flex items-center gap-2 py-0.5" data-testid={`timeline-inv-${inv.id}`}>
      {/* Left label */}
      <div className="w-32 shrink-0 text-right pr-1">
        <span className="text-xs font-ui text-[var(--text-secondary)] truncate">
          {label}
          {inv.execution_order != null ? (
            <span className="text-[var(--text-muted)]"> #{inv.execution_order}</span>
          ) : null}
        </span>
      </div>

      {/* Bar track — delegated to GanttBar primitive */}
      <GanttBar
        startMs={offsetMs}
        durationMs={inv.duration_ms}
        totalMs={totalMs}
        color={color}
        label={fmtMs(inv.duration_ms)}
        href={buildInvocationUrl(inv.id)}
        tooltip={tooltip}
        failed={!inv.success}
        errorMessage={inv.error_message ?? undefined}
        testId={`timeline-bar-${inv.id}`}
      />

      {/* Right duration label */}
      <div className="w-14 shrink-0 text-right">
        <span className="text-xs font-mono text-[var(--text-muted)]">
          {fmtMs(inv.duration_ms)}
        </span>
      </div>

      {/* Right cost label */}
      <div className="w-16 shrink-0 text-right" data-testid={`timeline-cost-${inv.id}`}>
        <span className="text-xs font-mono text-[var(--text-muted)]">
          {fmtCost(inv.cost_usd)}
        </span>
      </div>
    </div>
  );
}

interface OutcomeCardProps {
  label: string;
  value: string;
  sub?: string;
  href?: string;
}

function OutcomeCard({ label, value, sub, href }: OutcomeCardProps): JSX.Element {
  return (
    <div className="bg-[var(--surface-secondary)] rounded-book p-2.5">
      <p className="text-xs font-ui uppercase tracking-wide text-[var(--text-muted)] mb-0.5">
        {label}
      </p>
      {href ? (
        <Link href={href} className="text-sm font-ui font-semibold text-[var(--accent-gold)] hover:underline">
          {value}
        </Link>
      ) : (
        <p className="text-sm font-ui font-semibold text-[var(--text-primary)]">{value}</p>
      )}
      {sub && <p className="text-xs font-mono text-[var(--text-secondary)] mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function TimelineTab({ runId, run }: TimelineTabProps): JSX.Element {
  const [invocations, setInvocations] = useState<InvocationListEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const result = await listInvocationsAction({ runId, limit: 200 });
      if (result.success && result.data) {
        const sorted = [...result.data.items].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );
        setInvocations(sorted);
        setTotalCount(result.data.total);
      } else {
        setError(result.error?.message ?? 'Failed to load invocations');
      }
      setLoading(false);
    })();
  }, [runId]);

  if (loading) {
    return <div className="h-64 bg-[var(--surface-elevated)] rounded-book animate-pulse" data-testid="timeline-loading" />;
  }
  if (error) {
    return <div className="text-[var(--status-error)] text-sm p-4" data-testid="timeline-error">{error}</div>;
  }
  if (invocations.length === 0) {
    return (
      <div className="text-[var(--text-muted)] text-sm p-4" data-testid="timeline-empty">
        No invocations recorded for this run.
      </div>
    );
  }

  // ── Timeline bounds ──────────────────────────────────────────────────────
  const runStartMs = new Date(invocations[0]!.created_at).getTime();
  const lastInv = invocations[invocations.length - 1]!;
  const runEndMs = run.completed_at
    ? new Date(run.completed_at).getTime()
    : new Date(lastInv.created_at).getTime() + (lastInv.duration_ms ?? 30_000);
  const totalMs = Math.max(runEndMs - runStartMs, 1);

  // ── Group by iteration ───────────────────────────────────────────────────
  const byIteration = new Map<number, InvocationListEntry[]>();
  for (const inv of invocations) {
    const iter = inv.iteration ?? -1;
    const arr = byIteration.get(iter) ?? [];
    arr.push(inv);
    byIteration.set(iter, arr);
  }
  const sortedIterations = Array.from(byIteration.entries()).sort(([a], [b]) => a - b);

  // ── Summary stats ────────────────────────────────────────────────────────
  const summary = run.run_summary;
  const totalCost = invocations.reduce((s, i) => s + (i.cost_usd ?? 0), 0);
  const winner = summary?.topVariants?.[0];

  return (
    <div className="space-y-4" data-testid="timeline-tab">

      {/* Truncation warning — shown when >200 invocations exist and only 200 are displayed */}
      {totalCount > invocations.length && (
        <div
          className="flex items-center gap-2 rounded-book border border-[var(--status-warning)] bg-[var(--status-warning)]/10 px-3 py-2 text-xs font-ui text-[var(--status-warning)]"
          data-testid="timeline-truncation-warning"
        >
          ⚠ Showing {invocations.length} of {totalCount} invocations — timeline may be incomplete for this run.
        </div>
      )}

      {/* Legend + totals */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1">
        {(['generate', 'swiss', 'merge'] as AgentKind[]).map((k) => (
          <div key={k} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: KIND_CONFIG[k].color }} />
            <span className="text-xs font-ui text-[var(--text-secondary)]">{KIND_CONFIG[k].label}</span>
          </div>
        ))}
        <div className="ml-auto flex items-center gap-3 text-xs font-ui text-[var(--text-muted)]">
          <span>{invocations.length} invocations</span>
          <span>·</span>
          <span>wall-clock {fmtMs(totalMs)}</span>
        </div>
      </div>

      {/* Gantt chart */}
      <div
        className="border border-[var(--border-default)] rounded-book bg-[var(--surface-elevated)] p-4 space-y-3"
        data-testid="timeline-gantt"
      >
        {/* Time axis */}
        <div className="flex items-end gap-2">
          <div className="w-32 shrink-0" />
          <div className="flex-1 relative h-5">
            {([0, 25, 50, 75, 100] as const).map((pct) => (
              <div
                key={pct}
                style={{ left: `${pct}%` }}
                className="absolute bottom-0 flex flex-col items-center"
              >
                <span className="text-xs font-mono text-[var(--text-muted)] -translate-x-1/2 mb-0.5">
                  {fmtMs((totalMs * pct) / 100)}
                </span>
                <div className="h-2 w-px bg-[var(--border-default)]" />
              </div>
            ))}
          </div>
          <div className="w-14 shrink-0" />
          <div className="w-16 shrink-0" />
        </div>

        {/* Separator */}
        <div className="border-t border-[var(--border-default)]" />

        {/* Iterations */}
        {sortedIterations.map(([iter, invs]) => {
          // Classify iteration by whether any generate agent is present
          const isGenerate = invs.some((i) => agentKind(i.agent_name) === 'generate');
          const iterLabel = iter < 0 ? 'Setup' : `Iter ${iter}`;

          // Count parallel work agents (generate or swiss, excluding merge)
          const parallelCount = invs.filter((i) => agentKind(i.agent_name) !== 'merge').length;

          // Iteration wall-clock span
          const iStartMs = Math.min(...invs.map((i) => new Date(i.created_at).getTime()));
          const iEndMs   = Math.max(...invs.map((i) => new Date(i.created_at).getTime() + (i.duration_ms ?? 0)));

          // Iteration cost subtotal
          const iCostUsd = invs.reduce((s, i) => s + (i.cost_usd ?? 0), 0);

          return (
            <div key={iter} className="space-y-0.5" data-testid={`timeline-iter-${iter}`}>
              {/* Iteration header */}
              <div className="flex items-center gap-2 py-1">
                <div className="w-32 shrink-0 text-right pr-1">
                  <span className="text-xs font-ui font-semibold text-[var(--text-primary)]">
                    {iterLabel}
                  </span>
                  {iter >= 0 && (
                    <span className="ml-1 text-xs font-ui text-[var(--text-muted)]">
                      {isGenerate ? `${parallelCount}× parallel` : 'swiss'}
                    </span>
                  )}
                </div>
                <div className="flex-1 h-px bg-[var(--border-default)]" />
                <div className="w-14 shrink-0 text-right">
                  <span className="text-xs font-mono text-[var(--text-muted)]">{fmtMs(iEndMs - iStartMs)}</span>
                </div>
                <div className="w-16 shrink-0 text-right" data-testid={`timeline-iter-cost-${iter}`}>
                  <span className="text-xs font-mono text-[var(--text-muted)]">{fmtCost(iCostUsd)}</span>
                </div>
              </div>

              {/* One row per invocation */}
              {invs.map((inv) => (
                <InvocationBar
                  key={inv.id}
                  inv={inv}
                  runStartMs={runStartMs}
                  totalMs={totalMs}
                />
              ))}
            </div>
          );
        })}
      </div>

      {/* Run outcome */}
      {summary && (
        <div
          className="border border-[var(--border-default)] rounded-book bg-[var(--surface-elevated)] p-4"
          data-testid="timeline-outcome"
        >
          <h3 className="text-xl font-display font-medium text-[var(--text-primary)] mb-3">Run Outcome</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <OutcomeCard
              label="Stop Reason"
              value={summary.stopReason.replace(/_/g, ' ')}
            />
            <OutcomeCard
              label="Iterations"
              value={`${summary.totalIterations}`}
            />
            <OutcomeCard
              label="Wall-Clock"
              value={fmtSec(summary.durationSeconds)}
            />
            <OutcomeCard
              label="Total Cost"
              value={`$${totalCost.toFixed(4)}`}
            />
            <OutcomeCard
              label="Total Matches"
              value={`${summary.matchStats.totalMatches}`}
            />
            <OutcomeCard
              label="Decisive Rate"
              value={`${(summary.matchStats.decisiveRate * 100).toFixed(0)}%`}
            />
            {winner != null && (
              <OutcomeCard
                label="Winner"
                value={winner.isBaseline ? 'baseline' : (winner.strategy ?? '—')}
                sub={(() => {
                  // topVariants stored as Elo-scale; legacy mu-scale values (<100) heuristically converted.
                  const raw = winner.elo;
                  const elo = raw < 100 ? 1200 + (raw - 25) * 16 : raw;
                  return `Elo: ${Math.round(elo)}`;
                })()}
                href={winner.isBaseline ? undefined : buildVariantDetailUrl(winner.id)}
              />
            )}
            {summary.baselineRank != null && (
              <OutcomeCard
                label="Baseline Rank"
                value={`#${summary.baselineRank + 1}`}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
