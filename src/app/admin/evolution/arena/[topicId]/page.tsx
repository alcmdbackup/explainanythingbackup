'use client';
// Topic detail page for the Arena. Shows rating leaderboard with entry links,
// cost vs rating scatter chart, side-by-side text diff, match history, and run comparison controls.

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { diffWordsWithSpace } from 'diff';
import { EvolutionBreadcrumb } from '@evolution/components/evolution';
import { formatCost } from '@evolution/lib/utils/formatters';
import { toast } from 'sonner';
import {
  getArenaTopicAction,
  getArenaLeaderboardAction,
  getArenaEntriesAction,
  getArenaMatchHistoryAction,
  runArenaComparisonAction,
  deleteArenaEntryAction,
  addToArenaAction,
  type ArenaTopic,
  type ArenaEloEntry,
  type ArenaEntry,
  type ArenaComparison,
} from '@evolution/services/arenaActions';
import { archivePromptAction, unarchivePromptAction } from '@evolution/services/promptRegistryActions';
import {
  getEvolutionRunsAction,
  getEvolutionVariantsAction,
  getEvolutionRunSummaryAction,
  type EvolutionRun,
  type EvolutionVariant,
} from '@evolution/services/evolutionActions';
import type { AllowedLLMModelType } from '@/lib/schemas/schemas';
import { buildExplanationUrl, buildRunUrl, buildVariantDetailUrl } from '@evolution/lib/utils/evolutionUrls';
import { filterByBudgetTier, type BudgetTier } from '../arenaBudgetFilter';

const CostEloScatter = dynamic(() => import('recharts').then((mod) => {
  const { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine, ReferenceArea } = mod;

  const METHOD_DOT_COLORS: Record<string, string> = {
    oneshot: 'var(--accent-copper)',
    evolution_winner: 'var(--status-success)',
    evolution_baseline: 'var(--text-muted)',
  };

  function Chart({ data, onDotClick }: {
    data: Array<{ entry_id: string; cost: number; elo: number; method: string; model: string }>;
    onDotClick: (entryId: string) => void;
  }) {
    if (data.length === 0) return null;

    // Compute medians for quadrant reference lines
    const costs = data.map(d => d.cost).sort((a, b) => a - b);
    const elos = data.map(d => d.elo).sort((a, b) => a - b);
    const median = (arr: number[]) => arr.length % 2 === 0 ? (arr[arr.length / 2 - 1] + arr[arr.length / 2]) / 2 : arr[Math.floor(arr.length / 2)];
    const medianCost = median(costs);
    const medianElo = median(elos);

    return (
      <ResponsiveContainer width="100%" height={300}>
        <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
          <XAxis
            dataKey="cost" name="Cost" unit="$"
            tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
            label={{ value: 'Cost (USD)', position: 'bottom', fontSize: 11, fill: 'var(--text-secondary)' }}
          />
          <YAxis
            dataKey="elo" name="Rating"
            tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
            label={{ value: 'Rating', angle: -90, position: 'insideLeft', fontSize: 11, fill: 'var(--text-secondary)' }}
          />
          {data.length >= 4 && (
            <>
              <ReferenceLine x={medianCost} stroke="var(--border-default)" strokeDasharray="4 4" strokeOpacity={0.7} />
              <ReferenceLine y={medianElo} stroke="var(--border-default)" strokeDasharray="4 4" strokeOpacity={0.7} />
              <ReferenceArea x1={costs[0]} x2={medianCost} y1={medianElo} y2={elos[elos.length - 1]} fill="var(--status-success)" fillOpacity={0.04} label={{ value: 'Optimal', fontSize: 9, fill: 'var(--status-success)', position: 'insideTopLeft' }} />
            </>
          )}
          <Tooltip
            cursor={{ strokeDasharray: '3 3' }}
            contentStyle={{ background: 'var(--surface-secondary)', border: '1px solid var(--border-default)', borderRadius: 6 }}
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const d = payload[0].payload as { cost: number; elo: number; method: string; model: string };
              return (
                <div className="text-sm" style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border-default)', borderRadius: 6, padding: '8px 12px' }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>{d.method.replace(/_/g, ' ')}</div>
                  <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>{d.model}</div>
                  <div>Rating: {d.elo.toFixed(0)}</div>
                  <div>Cost: ${d.cost.toFixed(4)}</div>
                </div>
              );
            }}
          />
          <Scatter data={data} onClick={(d) => onDotClick(d.entry_id)}>
            {data.map((d, i) => (
              <Cell key={i} fill={METHOD_DOT_COLORS[d.method] ?? 'var(--text-muted)'} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    );
  }
  return Chart;
}), {
  ssr: false,
  loading: () => <div className="h-[300px] bg-[var(--surface-secondary)] rounded-book animate-pulse" />,
});

function getIterations(entry: ArenaEntry | undefined): number | undefined {
  if (!entry?.metadata) return undefined;
  const iter = (entry.metadata as Record<string, unknown>).iterations;
  return typeof iter === 'number' ? iter : undefined;
}

const METHOD_COLORS: Record<string, string> = {
  oneshot: 'bg-blue-600/20 text-blue-600 dark:bg-blue-400/20 dark:text-blue-400',
  evolution_winner: 'bg-[var(--status-success)]/20 text-[var(--status-success)]',
  evolution_baseline: 'bg-[var(--text-muted)]/20 text-[var(--text-muted)]',
  evolution: 'bg-[var(--status-success)]/20 text-[var(--status-success)]',
};

function MethodBadge({ method, iterations }: { method: string; iterations?: number | null }): JSX.Element {
  const colors = METHOD_COLORS[method] ?? 'bg-[var(--surface-elevated)] text-[var(--text-secondary)]';
  let label = method.replace(/_/g, ' ');
  if (iterations != null && method.startsWith('evolution_')) {
    label += ` (${iterations} iter)`;
  }
  return (
    <span className={`inline-block px-2 py-0.5 rounded-page text-xs font-ui font-medium ${colors}`}>
      {label}
    </span>
  );
}

function TextDiff({ original, modified }: { original: string; modified: string }): JSX.Element {
  const parts = diffWordsWithSpace(original, modified);

  return (
    <pre className="whitespace-pre-wrap text-sm leading-relaxed font-mono p-4 bg-[var(--surface-secondary)] rounded-book max-h-[500px] overflow-y-auto">
      {parts.map((part, i) => {
        if (part.added) {
          return <span key={i} className="bg-[var(--status-success)]/20 text-[var(--status-success)]">{part.value}</span>;
        }
        if (part.removed) {
          return <span key={i} className="bg-[var(--status-error)]/20 text-[var(--status-error)] line-through">{part.value}</span>;
        }
        return <span key={i}>{part.value}</span>;
      })}
    </pre>
  );
}

function RunComparisonDialog({ onRun, onClose, entryCount }: {
  onRun: (judgeModel: string, rounds: number) => void;
  onClose: () => void;
  entryCount: number;
}): JSX.Element {
  const [model, setModel] = useState('gpt-4.1-nano');
  const [rounds, setRounds] = useState(1);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div
        className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-6 w-96 space-y-4"
        role="dialog"
        aria-label="Run comparison"
      >
        <h2 className="text-2xl font-display font-semibold text-[var(--text-primary)]">
          Run Comparison
        </h2>
        <p className="text-sm text-[var(--text-muted)]">
          Swiss-style pairwise comparison using a judge LLM. Updates skill ratings.
          {entryCount >= 2 && (
            <span className="block mt-1">
              ~{Math.floor(entryCount / 2) * rounds} comparisons across {rounds} round{rounds > 1 ? 's' : ''} ({entryCount} entries)
            </span>
          )}
        </p>
        <div>
          <label className="block text-sm text-[var(--text-secondary)] mb-1">Judge Model</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            data-testid="judge-model-select"
            className="w-full px-3 py-2 border border-[var(--border-default)] rounded-page bg-[var(--surface-input)] text-[var(--text-primary)]"
          >
            <option value="gpt-4.1-nano">gpt-4.1-nano (cheapest)</option>
            <option value="gpt-4.1-mini">gpt-4.1-mini</option>
            <option value="gpt-4.1">gpt-4.1</option>
            <option value="gpt-4o-mini">gpt-4o-mini</option>
            <option value="gpt-4o">gpt-4o</option>
            <option value="gpt-5-nano">gpt-5-nano</option>
            <option value="gpt-5-mini">gpt-5-mini</option>
            <option value="gpt-5.2">gpt-5.2</option>
            <option value="gpt-5.2-pro">gpt-5.2-pro</option>
            <option value="o3-mini">o3-mini</option>
            <option value="deepseek-chat">deepseek-chat</option>
            <option value="claude-sonnet-4-20250514">claude-sonnet-4</option>
          </select>
        </div>
        <div>
          <label className="block text-sm text-[var(--text-secondary)] mb-1">Rounds</label>
          <select
            value={rounds}
            onChange={(e) => setRounds(Number(e.target.value))}
            data-testid="rounds-select"
            className="w-full px-3 py-2 border border-[var(--border-default)] rounded-page bg-[var(--surface-input)] text-[var(--text-primary)]"
          >
            <option value={1}>1 round</option>
            <option value={2}>2 rounds</option>
            <option value={3}>3 rounds</option>
            <option value={5}>5 rounds</option>
          </select>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-[var(--border-default)] rounded-page text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]"
          >
            Cancel
          </button>
          <button
            onClick={() => onRun(model, rounds)}
            data-testid="run-comparison-submit"
            className="px-4 py-2 bg-[var(--accent-gold)] text-[var(--surface-primary)] rounded-page hover:opacity-90"
          >
            Run
          </button>
        </div>
      </div>
    </div>
  );
}

function AddFromRunDialog({ prompt, onClose, onAdded }: {
  prompt: string;
  onClose: () => void;
  onAdded: () => void;
}): JSX.Element {
  const [runs, setRuns] = useState<EvolutionRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<EvolutionRun | null>(null);
  const [variants, setVariants] = useState<EvolutionVariant[]>([]);
  const [includeBaseline, setIncludeBaseline] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(true);

  useEffect(() => {
    getEvolutionRunsAction().then((res) => {
      if (res.success && res.data) {
        setRuns(res.data.filter((r) => r.status === 'completed'));
      }
      setLoadingRuns(false);
    }).catch(() => setLoadingRuns(false));
  }, []);

  useEffect(() => {
    if (!selectedRun) { setVariants([]); return; }
    getEvolutionVariantsAction(selectedRun.id).then((res) => {
      if (res.success && res.data) setVariants(res.data);
    }).catch(() => {});
  }, [selectedRun]);

  const winner = variants.find((v) => v.is_winner) ?? variants[0];
  const baseline = variants.find((v) => v.agent_name === 'original_baseline' || v.generation === 0);

  const handleSubmit = async () => {
    if (!selectedRun || !winner) return;
    setSubmitting(true);

    const metadata: Record<string, unknown> = {
      winning_strategy: winner.agent_name,
      winner_elo: winner.elo_score,
      winner_match_count: winner.match_count,
      variants_generated: selectedRun.total_variants,
      explanation_id: selectedRun.explanation_id,
      total_iterations: selectedRun.current_iteration,
    };

    try {
      const summaryRes = await getEvolutionRunSummaryAction(selectedRun.id);
      if (summaryRes.success && summaryRes.data) {
        const s = summaryRes.data;
        metadata.strategy_effectiveness = s.strategyEffectiveness;
        metadata.match_stats = s.matchStats;
        metadata.duration_seconds = s.durationSeconds;
        metadata.baseline_rank = s.baselineRank;
        metadata.baseline_elo = s.baselineOrdinal;
        metadata.meta_feedback = s.metaFeedback;
      }
    } catch { /* non-fatal */ }

    const result = await addToArenaAction({
      prompt,
      content: winner.variant_content,
      generation_method: 'evolution_winner',
      model: winner.agent_name,
      total_cost_usd: selectedRun.total_cost_usd,
      evolution_run_id: selectedRun.id,
      evolution_variant_id: winner.id,
      metadata,
    });

    if (!result.success) {
      toast.error(result.error?.message || 'Failed to add');
      setSubmitting(false);
      return;
    }

    if (includeBaseline && baseline) {
      await addToArenaAction({
        prompt,
        content: baseline.variant_content,
        generation_method: 'evolution_baseline',
        model: baseline.agent_name,
        total_cost_usd: null,
        evolution_run_id: selectedRun.id,
        evolution_variant_id: baseline.id,
        metadata: { explanation_id: selectedRun.explanation_id },
      });
    }

    toast.success('Added from evolution run');
    onAdded();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div
        className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-6 w-[500px] space-y-4 max-h-[80vh] overflow-y-auto"
        role="dialog"
        aria-label="Add from evolution run"
      >
        <h2 className="text-2xl font-display font-semibold text-[var(--text-primary)]">
          Add from Evolution Run
        </h2>
        <p className="text-sm text-[var(--text-muted)]">
          Select a completed evolution run to add its winner to this topic.
        </p>

        {loadingRuns ? (
          <div className="py-4 text-center text-[var(--text-muted)]">Loading runs...</div>
        ) : runs.length === 0 ? (
          <div className="py-4 text-center text-[var(--text-muted)]">No completed runs found.</div>
        ) : (
          <div className="max-h-48 overflow-y-auto border border-[var(--border-default)] rounded-page">
            {runs.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelectedRun(r)}
                className={`w-full text-left px-3 py-2 text-sm border-b border-[var(--border-default)] last:border-b-0 hover:bg-[var(--surface-secondary)] ${
                  selectedRun?.id === r.id ? 'bg-[var(--accent-gold)]/10' : ''
                }`}
                data-testid={`run-option-${r.id}`}
              >
                <div className="flex justify-between">
                  <span className="font-mono text-xs">
                    Run #{r.explanation_id ?? r.id.slice(0, 8)}
                    {r.explanation_id && (
                      <Link
                        href={buildExplanationUrl(r.explanation_id)}
                        className="ml-1 text-[var(--accent-gold)] hover:underline"
                        onClick={(e) => e.stopPropagation()}
                        title={`View explanation #${r.explanation_id}`}
                      >
                        ↗
                      </Link>
                    )}
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">${r.total_cost_usd.toFixed(2)}</span>
                </div>
                <div className="text-xs text-[var(--text-muted)]">
                  {r.total_variants} variants &middot; {new Date(r.created_at).toLocaleDateString()}
                </div>
              </button>
            ))}
          </div>
        )}

        {winner && (
          <div className="text-xs text-[var(--text-secondary)] bg-[var(--surface-secondary)] p-3 rounded-page">
            <div>Winner: <span className="font-mono">{winner.agent_name}</span> (Rating {Math.round(winner.elo_score)})</div>
            <div className="mt-1 text-[var(--text-muted)] truncate">{winner.variant_content.slice(0, 100)}...</div>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={includeBaseline}
            onChange={(e) => setIncludeBaseline(e.target.checked)}
            className="rounded"
          />
          Also add baseline (seed article)
        </label>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-[var(--border-default)] rounded-page text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !winner}
            data-testid="add-from-run-submit"
            className="px-4 py-2 bg-[var(--accent-gold)] text-[var(--surface-primary)] rounded-page hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Adding...' : 'Add to Arena'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface DiffSelectionInfo {
  title: string;
  label: string;
}

function getDiffSelectionInfo(entryId: string, diffA: string | null, diffB: string | null): DiffSelectionInfo {
  if (diffA === entryId) return { title: 'Selected as A', label: 'A\u2713' };
  if (diffB === entryId) return { title: 'Selected as B', label: 'B\u2713' };
  return { title: 'Select for diff', label: 'Diff' };
}

type TabId = 'leaderboard' | 'chart' | 'history' | 'diff';

const TABS: { id: TabId; label: string }[] = [
  { id: 'leaderboard', label: 'Leaderboard' },
  { id: 'chart', label: 'Cost vs Rating' },
  { id: 'history', label: 'Match History' },
  { id: 'diff', label: 'Compare Text' },
];

export default function ArenaTopicDetailPage(): JSX.Element {
  const params = useParams();
  const topicId = params.topicId as string;

  const [topic, setTopic] = useState<ArenaTopic | null>(null);
  const [leaderboard, setLeaderboard] = useState<ArenaEloEntry[]>([]);
  const [entries, setEntries] = useState<ArenaEntry[]>([]);
  const [matches, setMatches] = useState<ArenaComparison[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('leaderboard');
  const [showComparisonDialog, setShowComparisonDialog] = useState(false);
  const [showAddFromRun, setShowAddFromRun] = useState(false);
  const [comparisonRunning, setComparisonRunning] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const [diffA, setDiffA] = useState<string | null>(null);
  const [diffB, setDiffB] = useState<string | null>(null);
  const [budgetTier, setBudgetTier] = useState<BudgetTier>('all');

  const loadData = useCallback(async () => {
    setLoading(true);
    const [topicRes, lbRes, entriesRes] = await Promise.all([
      getArenaTopicAction(topicId),
      getArenaLeaderboardAction(topicId),
      getArenaEntriesAction(topicId),
    ]);

    if (topicRes.success && topicRes.data) setTopic(topicRes.data);
    if (lbRes.success && lbRes.data) setLeaderboard(lbRes.data);
    if (entriesRes.success && entriesRes.data) setEntries(entriesRes.data);
    setLoading(false);
  }, [topicId]);

  const loadMatches = useCallback(async () => {
    const res = await getArenaMatchHistoryAction(topicId);
    if (res.success && res.data) setMatches(res.data);
  }, [topicId]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => {
    if (activeTab === 'history') loadMatches();
  }, [activeTab, loadMatches]);

  const entryMap = useMemo(
    () => new Map(entries.map((e) => [e.id, e])),
    [entries],
  );

  const handleRunComparison = async (judgeModel: string, rounds: number) => {
    setShowComparisonDialog(false);
    setComparisonRunning(true);
    const result = await runArenaComparisonAction(topicId, judgeModel as AllowedLLMModelType, rounds);
    if (result.success && result.data) {
      toast.success(`${result.data.comparisons_run} comparisons complete`);
      loadData();
    } else {
      toast.error(result.error?.message || 'Comparison failed');
    }
    setComparisonRunning(false);
  };

  const handleSelectDiff = (entryId: string) => {
    if (!diffA) {
      setDiffA(entryId);
    } else if (!diffB && diffA !== entryId) {
      setDiffB(entryId);
      setActiveTab('diff');
    } else {
      setDiffA(entryId);
      setDiffB(null);
    }
  };

  const handleToggleArchive = async () => {
    if (!topic) return;
    const action = topic.status === 'archived' ? unarchivePromptAction : archivePromptAction;
    const result = await action(topicId);
    if (result.success) {
      toast.success(topic.status === 'archived' ? 'Topic unarchived' : 'Topic archived');
      loadData();
    } else {
      toast.error(result.error?.message || 'Failed to update topic');
    }
  };

  const handleDeleteEntry = async (entryId: string) => {
    if (!confirm('Delete this entry? Rating and match history will be removed.')) return;
    setActionLoading(true);
    const result = await deleteArenaEntryAction(entryId);
    if (result.success) {
      toast.success('Entry deleted');
      loadData();
    } else {
      toast.error(result.error?.message || 'Failed to delete');
    }
    setActionLoading(false);
  };

  const filteredLeaderboard = useMemo(
    () => filterByBudgetTier(leaderboard, budgetTier),
    [leaderboard, budgetTier],
  );

  const scatterData = useMemo(() =>
    filteredLeaderboard
      .filter((e) => e.total_cost_usd !== null && e.total_cost_usd > 0)
      .map((e) => ({
        entry_id: e.entry_id,
        cost: e.total_cost_usd!,
        elo: e.display_elo,
        method: e.generation_method,
        model: e.model,
      })),
    [filteredLeaderboard],
  );

  const diffEntryA = diffA ? entryMap.get(diffA) : null;
  const diffEntryB = diffB ? entryMap.get(diffB) : null;

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 bg-[var(--surface-elevated)] rounded animate-pulse" />
        <div className="h-[400px] bg-[var(--surface-elevated)] rounded-book animate-pulse" />
      </div>
    );
  }

  if (!topic) {
    return (
      <div className="text-center py-12 text-[var(--text-muted)]">
        Topic not found: {topicId}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb items={[
        { label: 'Arena', href: '/admin/evolution/arena' },
        { label: topic.prompt.slice(0, 60) + (topic.prompt.length > 60 ? '...' : '') },
      ]} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-4xl font-display font-bold text-[var(--text-primary)]">
              {topic.title || topic.prompt.slice(0, 80)}
            </h1>
            {topic.status === 'archived' && (
              <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-[var(--text-muted)]/20 text-[var(--text-muted)]">
                Archived
              </span>
            )}
          </div>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            {leaderboard.length} entries &middot; {matches.length > 0 ? `${matches.length} matches` : 'No matches yet'}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleToggleArchive}
            data-testid="archive-topic-btn"
            className="px-4 py-2 border border-[var(--border-default)] rounded-page text-sm text-[var(--text-muted)] hover:bg-[var(--surface-elevated)]"
          >
            {topic.status === 'archived' ? 'Unarchive' : 'Archive'}
          </button>
          <button
            onClick={() => setShowAddFromRun(true)}
            data-testid="add-from-run-btn"
            className="px-4 py-2 border border-[var(--border-default)] rounded-page text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)]"
          >
            Add from Run
          </button>
          <button
            onClick={() => setShowComparisonDialog(true)}
            disabled={comparisonRunning || leaderboard.length < 2}
            data-testid="run-comparison-btn"
            className="px-4 py-2 bg-[var(--accent-gold)] text-[var(--surface-primary)] rounded-page hover:opacity-90 disabled:opacity-50"
          >
            {comparisonRunning ? `Comparing ${entries.length} entries...` : 'Run Comparison'}
          </button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-[var(--border-default)]" data-testid="tab-bar">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-[var(--accent-gold)] text-[var(--accent-gold)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
            data-testid={`tab-${tab.id}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <label className="text-xs font-ui text-[var(--text-muted)]">Budget tier:</label>
        <select
          value={budgetTier}
          onChange={(e) => setBudgetTier(e.target.value as BudgetTier)}
          className="px-2 py-1 border border-[var(--border-default)] rounded-page bg-[var(--surface-input)] text-[var(--text-primary)] font-ui text-xs"
          data-testid="budget-tier-filter"
        >
          <option value="all">All</option>
          <option value="0.25">&le; $0.25</option>
          <option value="0.50">$0.25 &ndash; $0.50</option>
          <option value="1.00">$0.50 &ndash; $1.00</option>
        </select>
      </div>

      <div data-testid="tab-content">
        {activeTab === 'leaderboard' && (
          <div className="overflow-x-auto border border-[var(--border-default)] rounded-book" data-testid="leaderboard-table">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-elevated)]">
                <tr>
                  <th className="px-2 py-2 text-left w-8">#</th>
                  <th className="px-2 py-2 text-left">Method / Model</th>
                  <th className="px-2 py-2 text-right">Rating</th>
                  <th className="px-2 py-2 text-right">Rating/$</th>
                  <th className="px-2 py-2 text-right">Cost</th>
                  <th className="px-2 py-2 text-right">Matches</th>
                  <th className="px-2 py-2 text-left">Source</th>
                  <th className="px-2 py-2 text-left">Date</th>
                  <th className="px-2 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredLeaderboard.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-[var(--text-muted)]">
                      {budgetTier === 'all' ? 'No entries with ratings yet' : 'No entries in this budget tier'}
                    </td>
                  </tr>
                ) : (
                  filteredLeaderboard.map((entry, i) => {
                    const fullEntry = entryMap.get(entry.entry_id);
                    const isEvolution = entry.generation_method === 'evolution' || entry.generation_method.startsWith('evolution_');
                    return (
                        <tr
                          key={entry.entry_id}
                          className={`border-t border-[var(--border-default)] hover:bg-[var(--surface-secondary)] ${
                            i === 0 ? 'bg-[var(--status-success)]/5' : ''
                          }`}
                          data-testid={`lb-row-${i}`}
                        >
                          <td className="px-2 py-2 text-[var(--text-muted)]">
                            {i + 1}
                            {i === 0 && entry.match_count > 0 && (
                              <span className="ml-1 text-[var(--status-success)] text-xs">{'\u2605'}</span>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex flex-col">
                              <Link
                                href={`/admin/evolution/arena/entries/${entry.entry_id}`}
                                className="hover:text-[var(--accent-gold)]"
                                data-testid={`entry-link-${i}`}
                              >
                                <MethodBadge method={entry.generation_method} iterations={getIterations(fullEntry)} />
                              </Link>
                              <span className="font-mono text-xs text-[var(--text-muted)]">{entry.model}</span>
                            </div>
                          </td>
                          <td className="px-2 py-2 text-right">
                            <div className="font-semibold">{entry.display_elo.toFixed(0)}</div>
                            <div className="text-xs text-[var(--text-muted)] font-mono">{entry.ci_lower.toFixed(0)}&ndash;{entry.ci_upper.toFixed(0)}</div>
                          </td>
                          <td className={`px-2 py-2 text-right font-mono text-xs ${entry.elo_per_dollar !== null && entry.elo_per_dollar < 0 ? 'text-[var(--status-error)]' : ''}`}>
                            {entry.elo_per_dollar !== null ? entry.elo_per_dollar.toFixed(1) : '\u2014'}
                          </td>
                          <td className="px-2 py-2 text-right font-mono text-xs" title={entry.run_cost_usd !== null ? `Run cost: ${formatCost(entry.run_cost_usd)}` : undefined}>
                            {formatCost(entry.run_cost_usd ?? entry.total_cost_usd ?? 0) || '\u2014'}
                          </td>
                          <td className="px-2 py-2 text-right text-[var(--text-muted)]">{entry.match_count}</td>
                          <td className="px-2 py-2">
                            {isEvolution && fullEntry?.evolution_run_id ? (
                              <div className="flex flex-col gap-0.5">
                                <span className="flex gap-2">
                                  <Link
                                    href={buildRunUrl(fullEntry.evolution_run_id)}
                                    className="text-[var(--accent-gold)] hover:underline text-xs"
                                    title="Open evolution run"
                                    data-testid={`source-link-${i}`}
                                  >
                                    {'\u2197'} Run
                                  </Link>
                                  {fullEntry.evolution_variant_id && (
                                    <Link
                                      href={buildVariantDetailUrl(fullEntry.evolution_variant_id)}
                                      className="text-[var(--text-muted)] hover:text-[var(--accent-gold)] text-xs"
                                      title="View variant detail"
                                    >
                                      Variant
                                    </Link>
                                  )}
                                </span>
                                {(entry.strategy_label || entry.experiment_name) && (
                                  <span className="text-xs text-[var(--text-muted)] truncate max-w-[120px]" title={[entry.strategy_label, entry.experiment_name].filter(Boolean).join(' · ')}>
                                    {[entry.strategy_label, entry.experiment_name].filter(Boolean).join(' · ')}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <Link
                                href={`/admin/evolution/arena/entries/${entry.entry_id}`}
                                className="text-[var(--accent-gold)] hover:underline text-xs"
                                data-testid={`source-link-${i}`}
                              >
                                {'\u2197'} Detail
                              </Link>
                            )}
                          </td>
                          <td className="px-2 py-2 text-[var(--text-muted)] text-xs">
                            {new Date(entry.created_at).toLocaleDateString()}
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleSelectDiff(entry.entry_id)}
                                className="text-[var(--accent-gold)] hover:underline text-xs"
                                title={getDiffSelectionInfo(entry.entry_id, diffA, diffB).title}
                              >
                                {getDiffSelectionInfo(entry.entry_id, diffA, diffB).label}
                              </button>
                              <button
                                onClick={() => handleDeleteEntry(entry.entry_id)}
                                disabled={actionLoading}
                                className="text-[var(--status-error)] hover:underline text-xs disabled:opacity-50"
                                data-testid={`delete-entry-${i}`}
                              >
                                {'\u2715'}
                              </button>
                            </div>
                          </td>
                        </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'chart' && (
          <div className="border border-[var(--border-default)] rounded-book p-4" data-testid="cost-elo-chart">
            <div className="text-sm font-semibold text-[var(--text-secondary)] mb-0.5">Cost vs Rating</div>
            <div className="text-xs text-[var(--text-muted)] mb-2">Green area = high rating at low cost (optimal quadrant)</div>
            {scatterData.length >= 2 ? (
              <CostEloScatter
                data={scatterData}
                onDotClick={(entryId) => {
                  window.location.href = `/admin/evolution/arena/entries/${entryId}`;
                }}
              />
            ) : (
              <p className="py-8 text-center text-[var(--text-muted)]">
                Need at least 2 entries with cost data for the chart
              </p>
            )}
            <div className="flex gap-4 mt-3 text-xs text-[var(--text-muted)]">
              <span><span className="inline-block w-3 h-3 rounded-full mr-1 bg-[var(--accent-copper)]" />1-shot</span>
              <span><span className="inline-block w-3 h-3 rounded-full mr-1 bg-[var(--status-success)]" />Evolution winner</span>
              <span><span className="inline-block w-3 h-3 rounded-full mr-1 bg-[var(--text-muted)]" />Baseline</span>
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="overflow-x-auto border border-[var(--border-default)] rounded-book" data-testid="match-history-table">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-elevated)]">
                <tr>
                  <th className="p-3 text-left">Entry A</th>
                  <th className="p-3 text-left">Entry B</th>
                  <th className="p-3 text-left">Winner</th>
                  <th className="p-3 text-right">Confidence</th>
                  <th className="p-3 text-left">Judge</th>
                  <th className="p-3 text-left">Date</th>
                </tr>
              </thead>
              <tbody>
                {matches.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-[var(--text-muted)]">
                      No matches yet. Run a comparison to see results.
                    </td>
                  </tr>
                ) : (
                  matches.map((m) => {
                    const aEntry = entryMap.get(m.entry_a_id);
                    const bEntry = entryMap.get(m.entry_b_id);
                    const winnerEntry = m.winner_id ? entryMap.get(m.winner_id) : null;

                    return (
                      <tr key={m.id} className="border-t border-[var(--border-default)]">
                        <td className="p-3 text-xs">
                          {aEntry ? (
                            <span className="font-mono">{aEntry.model} <MethodBadge method={aEntry.generation_method} iterations={getIterations(aEntry)} /></span>
                          ) : (
                            <span className="text-[var(--text-muted)]">{m.entry_a_id.slice(0, 8)}</span>
                          )}
                        </td>
                        <td className="p-3 text-xs">
                          {bEntry ? (
                            <span className="font-mono">{bEntry.model} <MethodBadge method={bEntry.generation_method} iterations={getIterations(bEntry)} /></span>
                          ) : (
                            <span className="text-[var(--text-muted)]">{m.entry_b_id.slice(0, 8)}</span>
                          )}
                        </td>
                        <td className="p-3">
                          {m.winner_id === null ? (
                            <span className="text-[var(--text-muted)]">TIE</span>
                          ) : winnerEntry ? (
                            <span className="font-mono text-xs">{winnerEntry.model}</span>
                          ) : (
                            <span className="text-[var(--text-muted)]">{m.winner_id.slice(0, 8)}</span>
                          )}
                        </td>
                        <td className="p-3 text-right font-mono">
                          {m.confidence !== null ? m.confidence.toFixed(2) : '\u2014'}
                        </td>
                        <td className="p-3 font-mono text-xs text-[var(--text-muted)]">{m.judge_model}</td>
                        <td className="p-3 text-[var(--text-muted)] text-xs">
                          {new Date(m.created_at).toLocaleString()}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'diff' && (
          <div className="space-y-4" data-testid="diff-view">
            <div className="flex gap-4 items-center text-sm text-[var(--text-secondary)]">
              <span>Select two entries from the leaderboard to compare.</span>
              {(diffA || diffB) && (
                <button
                  onClick={() => { setDiffA(null); setDiffB(null); }}
                  className="text-[var(--accent-gold)] hover:underline text-xs"
                >
                  Clear selection
                </button>
              )}
            </div>
            <div className="flex gap-4">
              {([['Entry A', diffA, setDiffA], ['Entry B', diffB, setDiffB]] as const).map(([label, value, setter]) => (
                <div key={label} className="flex-1">
                  <label className="block text-xs text-[var(--text-muted)] mb-1">{label}</label>
                  <select
                    value={value ?? ''}
                    onChange={(e) => setter(e.target.value || null)}
                    className="w-full px-3 py-2 border border-[var(--border-default)] rounded-page bg-[var(--surface-input)] text-[var(--text-primary)] text-sm"
                  >
                    <option value="">Select...</option>
                    {entries.map((e) => {
                      const iter = getIterations(e);
                      const suffix = iter != null ? ` ${iter}iter` : '';
                      return (
                        <option key={e.id} value={e.id}>
                          {e.generation_method} ({e.model}{suffix})
                        </option>
                      );
                    })}
                  </select>
                </div>
              ))}
            </div>
            {diffEntryA && diffEntryB ? (
              <TextDiff original={diffEntryA.content} modified={diffEntryB.content} />
            ) : (
              <p className="py-8 text-center text-[var(--text-muted)]">
                Select two entries above to view word-level diff
              </p>
            )}
          </div>
        )}
      </div>

      {showComparisonDialog && (
        <RunComparisonDialog
          onRun={handleRunComparison}
          onClose={() => setShowComparisonDialog(false)}
          entryCount={entries.length}
        />
      )}

      {showAddFromRun && topic && (
        <AddFromRunDialog
          prompt={topic.prompt}
          onClose={() => setShowAddFromRun(false)}
          onAdded={loadData}
        />
      )}
    </div>
  );
}
