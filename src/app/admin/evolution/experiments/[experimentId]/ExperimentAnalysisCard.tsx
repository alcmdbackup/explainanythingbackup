// Structured display for experiment analysis results.
// Renders legacy manual analysis table and new v2 metrics table with Elo CIs.

'use client';

import { useState, useEffect } from 'react';
import type { ExperimentStatus } from '@evolution/services/experimentActions';
import { getExperimentMetricsAction } from '@evolution/services/experimentActions';
import type { ExperimentMetricsResult } from '@evolution/experiments/evolution/experimentMetrics';

interface ExperimentAnalysisCardProps {
  experiment: ExperimentStatus;
}

interface ManualRunResult {
  runId: string;
  configLabel: string;
  elo: number | null;
  cost: number;
  'eloPer$': number | null;
}

interface ManualAnalysis {
  type: 'manual';
  runs: ManualRunResult[];
  completedRuns: number;
  totalRuns: number;
  warnings: string[];
}

function isManualAnalysis(a: unknown): a is ManualAnalysis {
  return !!a && typeof a === 'object' && (a as Record<string, unknown>).type === 'manual';
}

function fmtNum(v: number | undefined | null, decimals = 0): string {
  if (v == null) return '—';
  return v.toFixed(decimals);
}

function MetricsTable({ metricsResult }: { metricsResult: ExperimentMetricsResult }) {
  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  // Summary stats
  const completedRuns = metricsResult.runs.filter((r) => r.status === 'completed');
  const totalSpend = completedRuns.reduce((s, r) => s + (r.metrics.cost?.value ?? 0), 0);
  const bestMaxElo = completedRuns.reduce(
    (best, r) => {
      const elo = r.metrics.maxElo;
      if (elo && (best == null || elo.value > best.value)) return elo;
      return best;
    },
    null as { value: number; sigma: number | null; ci: [number, number] | null; n: number } | null,
  );

  return (
    <div className="border border-[var(--border-default)] rounded-page overflow-hidden bg-[var(--surface-secondary)]">
      <div className="p-3 space-y-3">
        <h5 className="text-xs font-ui font-medium text-[var(--text-muted)] uppercase tracking-wide">
          Detailed Metrics ({metricsResult.completedRuns}/{metricsResult.totalRuns} completed)
        </h5>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <SummaryCard label="Completed" value={`${metricsResult.completedRuns}/${metricsResult.totalRuns}`} />
          <SummaryCard label="Total Spend" value={`$${totalSpend.toFixed(2)}`} />
          <SummaryCard label="Best Max Elo" value={fmtNum(bestMaxElo?.value)} />
          <SummaryCard label="Strategies" value={String(new Set(completedRuns.map((r) => r.strategyConfigId).filter(Boolean)).size)} />
        </div>

        {/* Metrics table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-ui" data-testid="metrics-v2-table">
            <thead>
              <tr className="text-[var(--text-muted)] border-b border-[var(--border-default)]">
                <th className="text-left py-1 pr-2">Run</th>
                <th className="text-left py-1 pr-2">Status</th>
                <th className="text-left py-1 pr-2">Config</th>
                <th className="text-right py-1 pr-2">Variants</th>
                <th className="text-right py-1 pr-2">Median Elo</th>
                <th className="text-right py-1 pr-2">90p Elo</th>
                <th className="text-right py-1 pr-2">Max Elo</th>
                <th className="text-right py-1 pr-2">Cost</th>
                <th className="text-right py-1">Elo/$</th>
              </tr>
            </thead>
            <tbody>
              {metricsResult.runs.map((run) => {
                const m = run.metrics;
                const agentCostKeys = Object.keys(m).filter((k) => k.startsWith('agentCost:'));
                const isExpanded = expandedRun === run.runId;
                return (
                  <tr key={run.runId} className="border-b border-[var(--border-default)] last:border-0">
                    <td className="py-1.5 pr-2 font-mono text-[var(--text-primary)]">
                      {run.runId.slice(0, 8)}
                      {agentCostKeys.length > 0 && (
                        <button
                          onClick={() => setExpandedRun(isExpanded ? null : run.runId)}
                          className="ml-1 text-[var(--accent-gold)] hover:text-[var(--accent-copper)]"
                          title="Toggle agent costs"
                        >
                          {isExpanded ? '▾' : '▸'}
                        </button>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 text-[var(--text-secondary)]">{run.status}</td>
                    <td className="py-1.5 pr-2 text-[var(--text-secondary)] max-w-[150px] truncate">{run.configLabel}</td>
                    <td className="py-1.5 pr-2 text-right font-mono text-[var(--text-secondary)]">{fmtNum(m.totalVariants?.value)}</td>
                    <td className="py-1.5 pr-2 text-right font-mono text-[var(--text-secondary)]">{fmtNum(m.medianElo?.value)}</td>
                    <td className="py-1.5 pr-2 text-right font-mono text-[var(--text-secondary)]">{fmtNum(m.p90Elo?.value)}</td>
                    <td className="py-1.5 pr-2 text-right font-mono text-[var(--text-secondary)]">
                      {fmtNum(m.maxElo?.value)}
                      {m.maxElo?.sigma != null && (
                        <span className="text-[var(--text-muted)] ml-1" title={`sigma: ${m.maxElo.sigma.toFixed(1)}`}>
                          ±{m.maxElo.sigma.toFixed(0)}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 text-right font-mono text-[var(--text-secondary)]">${fmtNum(m.cost?.value, 3)}</td>
                    <td className="py-1.5 text-right font-mono text-[var(--text-secondary)]">{fmtNum(m['eloPer$']?.value)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Expanded agent costs */}
        {expandedRun && (() => {
          const run = metricsResult.runs.find((r) => r.runId === expandedRun);
          if (!run) return null;
          const agentCosts = Object.entries(run.metrics)
            .filter(([k]) => k.startsWith('agentCost:'))
            .map(([k, v]) => ({ agent: k.replace('agentCost:', ''), cost: v?.value ?? 0 }))
            .sort((a, b) => b.cost - a.cost);
          return (
            <div className="pl-4 py-2 border-t border-[var(--border-default)]">
              <span className="text-xs font-ui text-[var(--text-muted)]">Agent costs for {expandedRun.slice(0, 8)}:</span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 mt-1">
                {agentCosts.map(({ agent, cost }) => (
                  <div key={agent} className="text-xs font-mono text-[var(--text-secondary)]">
                    {agent}: ${cost.toFixed(3)}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {metricsResult.warnings.length > 0 && (
          <div className="p-2 bg-[var(--status-warning)]/10 border border-[var(--status-warning)] rounded-page">
            <ul className="list-disc list-inside space-y-0.5 text-xs font-body text-[var(--status-warning)]">
              {metricsResult.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-2 bg-[var(--surface-elevated)] rounded-page">
      <span className="text-xs font-ui text-[var(--text-muted)] uppercase tracking-wide">{label}</span>
      <p className="text-sm font-mono text-[var(--text-primary)]">{value}</p>
    </div>
  );
}

function ManualAnalysisView({ analysis }: { analysis: ManualAnalysis }) {
  return (
    <div className="border border-[var(--border-default)] rounded-page overflow-hidden bg-[var(--surface-secondary)]">
      <div className="p-3 space-y-3">
        <h5 className="text-xs font-ui font-medium text-[var(--text-muted)] uppercase tracking-wide">
          Run Comparison ({analysis.completedRuns}/{analysis.totalRuns} completed)
        </h5>
        <table className="w-full text-xs font-ui" data-testid="manual-runs-table">
          <thead>
            <tr className="text-[var(--text-muted)] border-b border-[var(--border-default)]">
              <th className="text-left py-1 pr-4">Config</th>
              <th className="text-right py-1 pr-4">Elo</th>
              <th className="text-right py-1 pr-4">Cost</th>
              <th className="text-right py-1">Elo/$</th>
            </tr>
          </thead>
          <tbody>
            {analysis.runs
              .slice()
              .sort((a, b) => (b.elo ?? 0) - (a.elo ?? 0))
              .map((run) => (
                <tr key={run.runId} className="border-b border-[var(--border-default)] last:border-0">
                  <td className="py-1.5 pr-4 font-medium text-[var(--text-primary)]">{run.configLabel}</td>
                  <td className="py-1.5 pr-4 text-right font-mono text-[var(--text-secondary)]">
                    {run.elo != null ? run.elo.toFixed(0) : '—'}
                  </td>
                  <td className="py-1.5 pr-4 text-right font-mono text-[var(--text-secondary)]">
                    ${run.cost.toFixed(3)}
                  </td>
                  <td className="py-1.5 text-right font-mono text-[var(--text-secondary)]">
                    {run['eloPer$'] != null ? run['eloPer$'].toFixed(0) : '—'}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {analysis.warnings.length > 0 && (
          <div className="p-2 bg-[var(--status-warning)]/10 border border-[var(--status-warning)] rounded-page">
            <ul className="list-disc list-inside space-y-0.5 text-xs font-body text-[var(--status-warning)]">
              {analysis.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export function ExperimentAnalysisCard({ experiment }: ExperimentAnalysisCardProps) {
  const analysis = experiment.analysisResults;
  const [metricsResult, setMetricsResult] = useState<ExperimentMetricsResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const result = await getExperimentMetricsAction({ experimentId: experiment.id });
        if (!cancelled && result.success && result.data) {
          setMetricsResult(result.data);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (['completed', 'failed', 'analyzing'].includes(experiment.status)) {
      load();
    }
    return () => { cancelled = true; };
  }, [experiment.id, experiment.status]);

  return (
    <div className="space-y-4">
      {/* New v2 metrics */}
      {loading && (
        <div className="p-3 text-xs font-body text-[var(--text-muted)]">Loading metrics...</div>
      )}
      {metricsResult && <MetricsTable metricsResult={metricsResult} />}

      {/* Legacy manual analysis */}
      {!metricsResult && !loading && analysis && isManualAnalysis(analysis) && (
        <ManualAnalysisView analysis={analysis} />
      )}

      {!analysis && !metricsResult && !loading && (
        <div className="p-3 text-xs font-body text-[var(--text-muted)]">
          {['completed', 'failed', 'cancelled'].includes(experiment.status)
            ? 'No analysis results available.'
            : 'Analysis pending.'}
        </div>
      )}
    </div>
  );
}
