'use client';
// Arena topic list page. Displays cross-topic cost efficiency summary cards
// and a table of topics with entry counts, rating ranges, and best methods.

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { EvolutionBreadcrumb, TableSkeleton, EmptyState } from '@evolution/components/evolution';
import {
  getArenaTopicsAction,
  getCrossTopicSummaryAction,
  addToArenaAction,
  deleteArenaTopicAction,
  generateAndAddToArenaAction,
  getPromptBankCoverageAction,
  getPromptBankMethodSummaryAction,
  runArenaComparisonAction,
  type ArenaTopicWithStats,
  type CrossTopicMethodSummary,
  type PromptBankCoverageRow,
  type PromptBankMethodSummary,
} from '@evolution/services/arenaActions';
import { PROMPT_BANK, type MethodConfig } from '@evolution/config/promptBankConfig';
import type { AllowedLLMModelType } from '@/lib/schemas/schemas';

// ─── Method badge ──────────────────────────────────────────────

const METHOD_COLORS: Record<string, string> = {
  oneshot: 'bg-blue-600/20 text-blue-600 dark:bg-blue-400/20 dark:text-blue-400',
  evolution_winner: 'bg-[var(--status-success)]/20 text-[var(--status-success)]',
  evolution_baseline: 'bg-[var(--text-muted)]/20 text-[var(--text-muted)]',
  evolution: 'bg-[var(--status-success)]/20 text-[var(--status-success)]',
};

function MethodBadge({ method }: { method: string }) {
  const colors = METHOD_COLORS[method] ?? 'bg-[var(--surface-elevated)] text-[var(--text-secondary)]';
  const label = method.replace(/_/g, ' ');
  return (
    <span className={`inline-block px-2 py-0.5 rounded-page text-xs font-ui font-medium ${colors}`}>
      {label}
    </span>
  );
}

// ─── Cross-topic summary cards ──────────────────────────────────

function CrossTopicSummary({ summaries }: { summaries: CrossTopicMethodSummary[] }) {
  if (summaries.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="cross-topic-summary">
      {summaries.map((s) => (
        <div
          key={s.generation_method}
          className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4"
        >
          <div className="flex items-center gap-2 mb-2">
            <MethodBadge method={s.generation_method} />
            <span className="text-xs text-[var(--text-muted)]">{s.entry_count} entries</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <div className="text-xs text-[var(--text-muted)]">Avg Rating</div>
              <div className="font-semibold text-[var(--text-primary)]">{s.avg_elo.toFixed(0)}</div>
            </div>
            <div>
              <div className="text-xs text-[var(--text-muted)]">Avg Cost</div>
              <div className="font-semibold text-[var(--text-primary)]">
                {s.avg_cost !== null ? `$${s.avg_cost.toFixed(4)}` : 'N/A'}
              </div>
            </div>
            <div>
              <div className="text-xs text-[var(--text-muted)]">Rating/$</div>
              <div className="font-semibold text-[var(--text-primary)]">
                {s.avg_elo_per_dollar !== null ? s.avg_elo_per_dollar.toFixed(1) : 'N/A'}
              </div>
            </div>
            <div>
              <div className="text-xs text-[var(--text-muted)]">Win Rate</div>
              <div className="font-semibold text-[var(--text-primary)]">
                {(s.win_rate * 100).toFixed(0)}%
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Prompt Bank helpers ──────────────────────────────────────

function expandMethodLabels(methods: MethodConfig[]): string[] {
  const labels: string[] = [];
  for (const m of methods) {
    if (m.type === 'oneshot') {
      labels.push(m.label);
    } else {
      for (const cp of m.checkpoints) {
        labels.push(`${m.label}_${cp}iter`);
      }
    }
  }
  return labels;
}

// ─── Prompt Bank summary ─────────────────────────────────────────

function PromptBankSummary({
  coverage,
  methodSummary,
  onRunComparisons,
  comparisonsRunning,
  comparisonProgress,
}: {
  coverage: PromptBankCoverageRow[];
  methodSummary: PromptBankMethodSummary[];
  onRunComparisons: () => void;
  comparisonsRunning: boolean;
  comparisonProgress: string;
}) {
  const allLabels = expandMethodLabels(PROMPT_BANK.methods);
  const totalSlots = coverage.length * allLabels.length;
  const filledSlots = coverage.reduce(
    (sum, r) => sum + Object.values(r.methods).filter((c) => c.exists).length, 0,
  );
  const comparedSlots = coverage.reduce(
    (sum, r) => sum + Object.values(r.methods).filter((c) => c.exists && (c.matchCount ?? 0) > 0).length, 0,
  );

  const allCompared = filledSlots > 0 && filledSlots === comparedSlots;
  const coveragePct = totalSlots > 0 ? Math.round((filledSlots / totalSlots) * 100) : 0;
  const comparedPct = totalSlots > 0 ? Math.round((comparedSlots / totalSlots) * 100) : 0;

  // Find best method by rating
  const bestMethod = methodSummary.length > 0
    ? [...methodSummary].sort((a, b) => (b.avgElo || 0) - (a.avgElo || 0))[0]
    : null;

  return (
    <div className="bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded-book p-4" data-testid="prompt-bank-section">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-display font-semibold text-[var(--text-primary)]">Prompt Bank</h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {coveragePct}% coverage ({filledSlots}/{totalSlots} entries) &middot; {comparedPct}% compared
            {bestMethod && <> &middot; Best: <span className="text-[var(--accent-gold)]">{bestMethod.label}</span> (Rating {bestMethod.avgElo > 0 ? bestMethod.avgElo.toFixed(0) : '\u2014'})</>}
          </p>
        </div>
        <button
          onClick={onRunComparisons}
          disabled={comparisonsRunning || allCompared || filledSlots === 0}
          data-testid="run-all-comparisons-btn"
          className="px-3 py-1.5 bg-[var(--accent-gold)] text-[var(--surface-primary)] rounded-page text-sm hover:opacity-90 disabled:opacity-50"
        >
          {comparisonsRunning ? comparisonProgress : allCompared ? 'All Compared' : 'Run Comparisons'}
        </button>
      </div>

      {/* Compact method stats */}
      {methodSummary.length > 0 && (
        <div className="flex flex-wrap gap-3 mt-3">
          {methodSummary.map((m) => (
            <div
              key={m.label}
              className="flex items-center gap-2 px-2.5 py-1.5 bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book text-xs font-ui"
            >
              <span className="text-[var(--text-primary)] font-medium">{m.label}</span>
              <span className="text-[var(--text-muted)]">
                {m.avgElo > 0 ? `Rating ${m.avgElo.toFixed(0)}` : '\u2014'}
              </span>
              <span className="text-[var(--text-muted)]">
                {(m.winRate * 100).toFixed(0)}% win
              </span>
              <span className="text-[var(--text-muted)]">
                {m.entryCount}/{PROMPT_BANK.prompts.length}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── New topic dialog ──────────────────────────────────────────

function NewTopicDialog({ onSubmit, onClose }: {
  onSubmit: (prompt: string) => void;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState('');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div
        className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-6 w-96 space-y-4"
        role="dialog"
        aria-label="Create new topic"
      >
        <h2 className="text-2xl font-display font-semibold text-[var(--text-primary)]">
          New Topic
        </h2>
        <div>
          <label className="block text-sm text-[var(--text-secondary)] mb-1">Prompt</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            data-testid="new-topic-prompt"
            className="w-full px-3 py-2 border border-[var(--border-default)] rounded-page bg-[var(--surface-input)] text-[var(--text-primary)] min-h-[80px]"
            placeholder="e.g. Explain quantum computing to a 10-year-old"
          />
        </div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-[var(--border-default)] rounded-page text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (!prompt.trim()) { toast.error('Prompt is required'); return; }
              onSubmit(prompt.trim());
            }}
            data-testid="new-topic-submit"
            className="px-4 py-2 bg-[var(--accent-gold)] text-[var(--surface-primary)] rounded-page hover:opacity-90"
          >
            Create Topic
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Generate New Article dialog ──────────────────────────────────

function GenerateArticleDialog({ onClose, onGenerated, topics }: {
  onClose: () => void;
  onGenerated: (topicId: string) => void;
  topics: ArenaTopicWithStats[];
}) {
  const [selectedTopicId, setSelectedTopicId] = useState<string>('__new__');
  const [newPrompt, setNewPrompt] = useState('');
  const [model, setModel] = useState<AllowedLLMModelType>('gpt-4.1');
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<{ title: string; content: string; topicId: string; entryId: string } | null>(null);

  const effectivePrompt = useMemo(() => {
    if (selectedTopicId === '__new__') return newPrompt.trim();
    return topics.find((t) => t.id === selectedTopicId)?.prompt.trim() ?? '';
  }, [selectedTopicId, newPrompt, topics]);

  const handleGenerate = async () => {
    if (!effectivePrompt) { toast.error('Prompt is required'); return; }
    setGenerating(true);
    setPreview(null);

    const result = await generateAndAddToArenaAction({ prompt: effectivePrompt, model });

    if (result.success && result.data) {
      setPreview({
        title: result.data.title,
        content: result.data.content,
        topicId: result.data.topic_id,
        entryId: result.data.entry_id,
      });
      toast.success('Article generated and added to Arena');
    } else {
      toast.error(result.error?.message || 'Generation failed');
    }
    setGenerating(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div
        className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-6 w-[500px] space-y-4 max-h-[80vh] overflow-y-auto"
        role="dialog"
        aria-label="Generate new article"
      >
        <h2 className="text-2xl font-display font-semibold text-[var(--text-primary)]">
          Generate New Article
        </h2>
        <p className="text-sm text-[var(--text-muted)]">
          Generate an article from a prompt using any supported model.
        </p>

        <div>
          <label className="block text-sm text-[var(--text-secondary)] mb-1">Topic</label>
          <select
            value={selectedTopicId}
            onChange={(e) => setSelectedTopicId(e.target.value)}
            data-testid="generate-topic-select"
            className="relative z-10 w-full px-3 py-2 border border-[var(--border-default)] rounded-page bg-[var(--surface-input)] text-[var(--text-primary)]"
            disabled={generating}
          >
            <option value="__new__">+ New topic</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.prompt.length > 80 ? t.prompt.slice(0, 80) + '...' : t.prompt} ({t.entry_count} {t.entry_count === 1 ? 'entry' : 'entries'})
              </option>
            ))}
          </select>
        </div>

        {selectedTopicId === '__new__' && (
          <div>
            <label className="block text-sm text-[var(--text-secondary)] mb-1">Prompt</label>
            <textarea
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
              data-testid="generate-prompt"
              className="w-full px-3 py-2 border border-[var(--border-default)] rounded-page bg-[var(--surface-input)] text-[var(--text-primary)] min-h-[80px]"
              placeholder="e.g. Explain quantum computing to a 10-year-old"
              disabled={generating}
            />
          </div>
        )}

        <div>
          <label className="block text-sm text-[var(--text-secondary)] mb-1">Model</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value as AllowedLLMModelType)}
            data-testid="generate-model"
            className="relative z-10 w-full px-3 py-2 border border-[var(--border-default)] rounded-page bg-[var(--surface-input)] text-[var(--text-primary)]"
            disabled={generating}
          >
            <option value="gpt-4.1">gpt-4.1 (best quality)</option>
            <option value="gpt-4.1-mini">gpt-4.1-mini (balanced)</option>
            <option value="gpt-4o">gpt-4o</option>
            <option value="gpt-5-nano">gpt-5-nano</option>
            <option value="gpt-5-mini">gpt-5-mini</option>
            <option value="gpt-5.2">gpt-5.2</option>
            <option value="gpt-5.2-pro">gpt-5.2-pro</option>
            <option value="o3-mini">o3-mini</option>
            <option value="claude-sonnet-4-20250514">claude-sonnet-4</option>
            <option value="deepseek-chat">deepseek-chat (cheapest)</option>
          </select>
        </div>

        {preview && (
          <div className="bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded-page p-3 space-y-2">
            <div className="text-sm font-semibold text-[var(--text-primary)]">{preview.title}</div>
            <pre className="whitespace-pre-wrap text-xs text-[var(--text-secondary)] max-h-48 overflow-y-auto font-body">
              {preview.content.slice(0, 500)}{preview.content.length > 500 ? '...' : ''}
            </pre>
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-[var(--border-default)] rounded-page text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]"
          >
            {preview ? 'Close' : 'Cancel'}
          </button>
          {!preview ? (
            <button
              onClick={handleGenerate}
              disabled={generating}
              data-testid="generate-submit"
              className="px-4 py-2 bg-[var(--accent-gold)] text-[var(--surface-primary)] rounded-page hover:opacity-90 disabled:opacity-50"
            >
              {generating ? 'Generating...' : 'Generate'}
            </button>
          ) : (
            <button
              onClick={() => onGenerated(preview.topicId)}
              data-testid="generate-view-topic"
              className="px-4 py-2 bg-[var(--accent-gold)] text-[var(--surface-primary)] rounded-page hover:opacity-90"
            >
              View Topic
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ──────────────────────────────────────────────────

export default function ArenaPage() {
  const router = useRouter();
  const [topics, setTopics] = useState<ArenaTopicWithStats[]>([]);
  const [summaries, setSummaries] = useState<CrossTopicMethodSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewTopic, setShowNewTopic] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [promptBankCoverage, setPromptBankCoverage] = useState<PromptBankCoverageRow[]>([]);
  const [promptBankSummary, setPromptBankSummary] = useState<PromptBankMethodSummary[]>([]);
  const [comparisonsRunning, setComparisonsRunning] = useState(false);
  const [comparisonProgress, setComparisonProgress] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [topicsResult, summaryResult, coverageResult, methodSummaryResult] = await Promise.all([
      getArenaTopicsAction(),
      getCrossTopicSummaryAction(),
      getPromptBankCoverageAction(),
      getPromptBankMethodSummaryAction(),
    ]);

    if (topicsResult.success && topicsResult.data) {
      setTopics(topicsResult.data);
    } else {
      setError(topicsResult.error?.message || 'Failed to load topics');
    }

    if (summaryResult.success && summaryResult.data) {
      setSummaries(summaryResult.data);
    }

    if (coverageResult.success && coverageResult.data) {
      setPromptBankCoverage(coverageResult.data);
    }

    if (methodSummaryResult.success && methodSummaryResult.data) {
      setPromptBankSummary(methodSummaryResult.data);
    }

    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreateTopic = async (prompt: string) => {
    setActionLoading(true);
    // Create topic by adding a placeholder entry (topic is auto-created by addToArenaAction)
    // Actually, we just need to create the topic. Let's use addToArenaAction with minimal content.
    // But addToArenaAction requires content. Instead, we'll just navigate after creating via prompt.
    // For now, create a topic by inserting a minimal entry.
    const result = await addToArenaAction({
      prompt,
      content: '_(empty topic \u2014 add articles to compare)_',
      generation_method: 'oneshot',
      model: 'placeholder',
      total_cost_usd: 0,
    });

    if (result.success && result.data) {
      toast.success('Topic created');
      setShowNewTopic(false);
      router.push(`/admin/quality/arena/${result.data.topic_id}`);
    } else {
      toast.error(result.error?.message || 'Failed to create topic');
    }
    setActionLoading(false);
  };

  const handleDeleteTopic = async (topicId: string, prompt: string, entryCount: number) => {
    if (!confirm(`Delete topic "${prompt}"? This will delete ${entryCount} ${entryCount === 1 ? 'entry' : 'entries'} and all associated comparisons.`)) return;
    setActionLoading(true);
    const result = await deleteArenaTopicAction(topicId);
    if (result.success) {
      toast.success('Topic deleted');
      loadData();
    } else {
      toast.error(result.error?.message || 'Failed to delete topic');
    }
    setActionLoading(false);
  };

  const handleRunAllComparisons = async () => {
    const topicIds = promptBankCoverage
      .map((row) => row.topicId)
      .filter((id): id is string => id !== null);

    if (topicIds.length === 0) {
      toast.error('No prompt bank topics found');
      return;
    }

    setComparisonsRunning(true);
    let completed = 0;
    let totalRun = 0;

    for (const topicId of topicIds) {
      completed++;
      setComparisonProgress(`${completed}/${topicIds.length}...`);
      const result = await runArenaComparisonAction(topicId, 'gpt-4.1-nano', PROMPT_BANK.comparison.rounds);
      if (result.success && result.data) {
        totalRun += result.data.comparisons_run;
      }
    }

    setComparisonsRunning(false);
    setComparisonProgress('');
    toast.success(`Ran ${totalRun} comparisons across ${topicIds.length} topics`);
    loadData();
  };

  // Show cross-topic summary only when there's meaningful data
  const showSummary = useMemo(
    () => summaries.length >= 2 && topics.some((t) => t.elo_max !== null),
    [summaries, topics],
  );

  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb items={[
        { label: 'Dashboard', href: '/admin/evolution-dashboard' },
        { label: 'Arena' },
      ]} />
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-4xl font-display font-bold text-[var(--text-primary)]">
            Arena
          </h1>
          <p className="text-[var(--text-muted)] text-sm mt-1">
            Compare articles across generation methods with skill ratings
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowGenerate(true)}
            disabled={actionLoading}
            data-testid="generate-article-btn"
            className="px-4 py-2 border border-[var(--border-default)] rounded-page text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] disabled:opacity-50"
          >
            Generate New Article
          </button>
          <button
            onClick={() => setShowNewTopic(true)}
            disabled={actionLoading}
            data-testid="new-topic-btn"
            className="px-4 py-2 bg-[var(--accent-gold)] text-[var(--surface-primary)] rounded-page hover:opacity-90 disabled:opacity-50"
          >
            New Topic
          </button>
        </div>
      </div>

      {/* Cross-topic summary */}
      {showSummary && <CrossTopicSummary summaries={summaries} />}

      {/* Prompt Bank summary */}
      <PromptBankSummary
        coverage={promptBankCoverage}
        methodSummary={promptBankSummary}
        onRunComparisons={handleRunAllComparisons}
        comparisonsRunning={comparisonsRunning}
        comparisonProgress={comparisonProgress}
      />

      {/* Error */}
      {error && (
        <div className="p-3 bg-[var(--status-error)]/10 border border-[var(--status-error)] rounded-page text-[var(--status-error)]">
          {error}
        </div>
      )}

      {/* Topics table */}
      <div className="overflow-x-auto border border-[var(--border-default)] rounded-book" data-testid="topics-table">
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-elevated)]">
            <tr>
              <th className="p-3 text-left">Prompt</th>
              <th className="p-3 text-right">Entries</th>
              <th className="p-3 text-right">Rating Range</th>
              <th className="p-3 text-right">Total Cost</th>
              <th className="p-3 text-left">Best Method</th>
              <th className="p-3 text-left">Created</th>
              <th className="p-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="p-0">
                  <TableSkeleton columns={7} rows={4} />
                </td>
              </tr>
            ) : topics.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <EmptyState message="No topics yet" suggestion="Create a topic to start comparing articles" />
                </td>
              </tr>
            ) : (
              topics.map((topic) => (
                <tr
                  key={topic.id}
                  className="border-t border-[var(--border-default)] hover:bg-[var(--surface-secondary)] cursor-pointer"
                  data-testid={`topic-row-${topic.id}`}
                  onClick={() => router.push(`/admin/quality/arena/${topic.id}`)}
                >
                  <td className="p-3 text-[var(--text-primary)] max-w-[300px] truncate">
                    {topic.prompt}
                  </td>
                  <td className="p-3 text-right">{topic.entry_count}</td>
                  <td className="p-3 text-right font-mono text-xs">
                    {topic.elo_min !== null && topic.elo_max !== null
                      ? `${topic.elo_min.toFixed(0)}\u2013${topic.elo_max.toFixed(0)}`
                      : '\u2014'}
                  </td>
                  <td className="p-3 text-right font-mono">
                    {topic.total_cost !== null ? `$${topic.total_cost.toFixed(4)}` : '\u2014'}
                  </td>
                  <td className="p-3">
                    {topic.best_method ? <MethodBadge method={topic.best_method} /> : '\u2014'}
                  </td>
                  <td className="p-3 text-[var(--text-muted)] text-xs">
                    {new Date(topic.created_at).toLocaleDateString()}
                  </td>
                  <td className="p-3" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => handleDeleteTopic(topic.id, topic.prompt, topic.entry_count)}
                      disabled={actionLoading}
                      data-testid={`delete-topic-${topic.id}`}
                      className="text-[var(--status-error)] hover:underline text-xs disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Dialogs */}
      {showNewTopic && (
        <NewTopicDialog
          onSubmit={handleCreateTopic}
          onClose={() => setShowNewTopic(false)}
        />
      )}

      {showGenerate && (
        <GenerateArticleDialog
          topics={topics}
          onClose={() => { setShowGenerate(false); loadData(); }}
          onGenerated={(topicId) => {
            setShowGenerate(false);
            router.push(`/admin/quality/arena/${topicId}`);
          }}
        />
      )}
    </div>
  );
}
