'use client';
// Admin page for viewing content quality evaluation scores.
// Shows per-article quality summaries, eval run history, and manual eval triggers.

import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import {
  getArticleQualitySummariesAction,
  getEvalRunsAction,
  triggerEvalRunAction,
  type ArticleQualitySummary,
  type ContentEvalRun,
} from '@/lib/services/contentQualityActions';

// ─── Score bar component ─────────────────────────────────────────

function ScoreBar({ score, label }: { score: number; label?: string }) {
  const pct = Math.round(score * 100);
  const color = score >= 0.7 ? 'bg-green-600' : score >= 0.5 ? 'bg-yellow-600' : 'bg-red-600';

  return (
    <div className="flex items-center gap-2">
      {label && <span className="text-xs text-[var(--text-muted)] w-20 truncate">{label}</span>}
      <div className="flex-1 bg-[var(--surface-secondary)] rounded-full h-2 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono w-8 text-right">{pct}%</span>
    </div>
  );
}

// ─── Eval run status badge ───────────────────────────────────────

function statusColor(status: string): string {
  switch (status) {
    case 'pending': return 'bg-yellow-800 text-yellow-100';
    case 'running': return 'bg-blue-800 text-blue-100';
    case 'completed': return 'bg-green-800 text-green-100';
    case 'failed': return 'bg-red-800 text-red-100';
    default: return 'bg-gray-800 text-gray-100';
  }
}

// ─── Run eval dialog ─────────────────────────────────────────────

function RunEvalDialog({
  onRun,
  onClose,
}: {
  onRun: (ids: number[]) => void;
  onClose: () => void;
}) {
  const [idsInput, setIdsInput] = useState('');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div
        className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-6 w-96 space-y-4"
        role="dialog"
        aria-label="Run quality evaluation"
      >
        <h2 className="text-2xl font-display font-semibold text-[var(--text-primary)]">Run Quality Eval</h2>

        <div>
          <label className="block text-sm text-[var(--text-secondary)] mb-1">
            Explanation IDs (comma-separated)
          </label>
          <input
            type="text"
            value={idsInput}
            onChange={(e) => setIdsInput(e.target.value)}
            data-testid="eval-ids-input"
            className="w-full px-3 py-2 border border-[var(--border-default)] rounded-page bg-[var(--surface-secondary)] text-[var(--text-primary)]"
            placeholder="e.g. 1, 5, 12, 42"
          />
          <p className="text-xs text-[var(--text-muted)] mt-1">Max 100 articles per batch</p>
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
              const ids = idsInput
                .split(',')
                .map((s) => parseInt(s.trim(), 10))
                .filter((n) => !isNaN(n) && n > 0);
              if (ids.length === 0) {
                toast.error('Enter at least one valid explanation ID');
                return;
              }
              onRun(ids);
            }}
            data-testid="eval-submit"
            className="px-4 py-2 bg-[var(--accent-gold)] text-[var(--surface-primary)] rounded-page hover:opacity-90"
          >
            Run Eval
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────

export default function QualityAdminPage() {
  const [summaries, setSummaries] = useState<ArticleQualitySummary[]>([]);
  const [evalRuns, setEvalRuns] = useState<ContentEvalRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showEvalDialog, setShowEvalDialog] = useState(false);
  const [activeTab, setActiveTab] = useState<'scores' | 'runs'>('scores');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [summaryResult, runsResult] = await Promise.all([
      getArticleQualitySummariesAction(),
      getEvalRunsAction(),
    ]);

    if (summaryResult.success && summaryResult.data) {
      setSummaries(summaryResult.data);
    } else {
      setError(summaryResult.error?.message || 'Failed to load quality data');
    }

    if (runsResult.success && runsResult.data) {
      setEvalRuns(runsResult.data);
    }

    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleRunEval = async (ids: number[]) => {
    const result = await triggerEvalRunAction({ explanationIds: ids });
    if (result.success) {
      toast.success(`Eval run started for ${ids.length} article(s)`);
      setShowEvalDialog(false);
      loadData();
    } else {
      toast.error(result.error?.message || 'Failed to start eval');
    }
  };

  const DIMENSION_LABELS: Record<string, string> = {
    clarity: 'Clarity',
    structure: 'Structure',
    engagement: 'Engagement',
    conciseness: 'Conciseness',
    coherence: 'Coherence',
    specificity: 'Specificity',
    point_of_view: 'POV',
    overall: 'Overall',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-4xl font-display font-bold text-[var(--text-primary)]">
            Content Quality
          </h1>
          <p className="text-[var(--text-muted)] text-sm mt-1">
            Article quality scores from LLM evaluation
          </p>
        </div>
        <button
          onClick={() => setShowEvalDialog(true)}
          data-testid="run-eval-btn"
          className="px-4 py-2 bg-[var(--accent-gold)] text-[var(--surface-primary)] rounded-page hover:opacity-90"
        >
          Run Eval
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--border-default)]">
        <button
          onClick={() => setActiveTab('scores')}
          className={`px-4 py-2 text-sm ${activeTab === 'scores' ? 'border-b-2 border-[var(--accent-gold)] text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}
        >
          Article Scores
        </button>
        <button
          onClick={() => setActiveTab('runs')}
          className={`px-4 py-2 text-sm ${activeTab === 'runs' ? 'border-b-2 border-[var(--accent-gold)] text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}
        >
          Eval Runs ({evalRuns.length})
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-[var(--status-error)]/10 border border-[var(--status-error)] rounded-page text-[var(--status-error)]">
          {error}
        </div>
      )}

      {/* Scores tab */}
      {activeTab === 'scores' && (
        <div className="overflow-x-auto border border-[var(--border-default)] rounded-book" data-testid="quality-scores-table">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface-elevated)]">
              <tr>
                <th className="p-3 text-left">Article</th>
                <th className="p-3 text-right">Avg Score</th>
                <th className="p-3 text-left w-64">Dimensions</th>
                <th className="p-3 text-left">Last Eval</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-[var(--text-muted)]">Loading...</td>
                </tr>
              ) : summaries.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-[var(--text-muted)]">
                    No quality scores yet. Run an eval to get started.
                  </td>
                </tr>
              ) : (
                summaries.map((s) => (
                  <tr
                    key={s.explanation_id}
                    className="border-t border-[var(--border-default)] hover:bg-[var(--surface-secondary)]"
                  >
                    <td className="p-3">
                      <div>
                        <span className="font-mono text-xs text-[var(--text-muted)]">#{s.explanation_id}</span>
                        <span className="ml-2 text-[var(--text-primary)]">{s.explanation_title}</span>
                      </div>
                    </td>
                    <td className="p-3 text-right">
                      <span className={`font-semibold ${s.avgScore >= 0.7 ? 'text-green-400' : s.avgScore >= 0.5 ? 'text-yellow-400' : 'text-red-400'}`}>
                        {(s.avgScore * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="space-y-1">
                        {Object.entries(s.scores).map(([dim, score]) => (
                          <ScoreBar
                            key={dim}
                            score={score}
                            label={DIMENSION_LABELS[dim] ?? dim}
                          />
                        ))}
                      </div>
                    </td>
                    <td className="p-3 text-[var(--text-muted)] text-xs">
                      {new Date(s.lastEvalAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Runs tab */}
      {activeTab === 'runs' && (
        <div className="overflow-x-auto border border-[var(--border-default)] rounded-book" data-testid="eval-runs-table">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface-elevated)]">
              <tr>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-right">Articles</th>
                <th className="p-3 text-right">Cost</th>
                <th className="p-3 text-left">Triggered By</th>
                <th className="p-3 text-left">Started</th>
                <th className="p-3 text-left">Completed</th>
              </tr>
            </thead>
            <tbody>
              {evalRuns.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-[var(--text-muted)]">
                    No eval runs yet
                  </td>
                </tr>
              ) : (
                evalRuns.map((run) => (
                  <tr
                    key={run.id}
                    className="border-t border-[var(--border-default)] hover:bg-[var(--surface-secondary)]"
                  >
                    <td className="p-3">
                      <span className={`px-2 py-1 rounded text-xs ${statusColor(run.status)}`}>
                        {run.status}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      {run.completed_articles}/{run.total_articles}
                    </td>
                    <td className="p-3 text-right font-mono">${run.total_cost_usd.toFixed(4)}</td>
                    <td className="p-3 text-[var(--text-secondary)] text-xs">{run.triggered_by}</td>
                    <td className="p-3 text-[var(--text-muted)] text-xs">
                      {run.started_at ? new Date(run.started_at).toLocaleString() : '-'}
                    </td>
                    <td className="p-3 text-[var(--text-muted)] text-xs">
                      {run.completed_at ? new Date(run.completed_at).toLocaleString() : '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Dialog */}
      {showEvalDialog && (
        <RunEvalDialog
          onRun={handleRunEval}
          onClose={() => setShowEvalDialog(false)}
        />
      )}
    </div>
  );
}
