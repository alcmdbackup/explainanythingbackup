'use client';
// Prompt Registry admin page. Provides CRUD management for evolution pipeline prompts
// with filtering by status, inline editing, and archive/delete confirmation dialogs.

import { Fragment, useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { logger } from '@/lib/client_utilities';
import { toast } from 'sonner';
import { EvolutionBreadcrumb, TableSkeleton, EmptyState } from '@evolution/components/evolution';
import {
  getPromptsAction,
  createPromptAction,
  updatePromptAction,
  archivePromptAction,
  deletePromptAction,
} from '@evolution/services/promptRegistryActions';
import type { PromptMetadata } from '@evolution/lib/types';
import { getPromptRunsAction, type StrategyRunEntry } from '@evolution/services/eloBudgetActions';
import { buildRunUrl, buildExplanationUrl, buildArenaTopicUrl } from '@evolution/lib/utils/evolutionUrls';
import { formatCostDetailed } from '@evolution/lib/utils/formatters';

type StatusFilter = 'all' | 'active' | 'archived';

const DIFFICULTY_OPTIONS = ['easy', 'medium', 'hard'] as const;

function parseTags(input: string): string[] {
  return input.split(',').map((t) => t.trim()).filter(Boolean);
}

function truncatePrompt(text: string, max = 60): string {
  return text.length > max ? text.slice(0, max) + '...' : text;
}

function StatusBadge({ status }: { status: 'active' | 'archived' }) {
  const color = status === 'active' ? 'var(--status-success)' : 'var(--text-muted)';
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-page text-xs font-ui font-medium"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 20%, transparent)`, color }}
    >
      {status}
    </span>
  );
}

const RUN_STATUS_COLORS: Record<string, string> = {
  completed: 'bg-[var(--status-success)]/20 text-[var(--status-success)]',
  failed: 'bg-[var(--status-error)]/20 text-[var(--status-error)]',
};

function RunStatusBadge({ status }: { status: string }) {
  const color = RUN_STATUS_COLORS[status] ?? 'bg-[var(--text-muted)]/20 text-[var(--text-muted)]';
  return (
    <span className={`px-1.5 py-0.5 rounded-page ${color}`}>{status}</span>
  );
}

function TagChip({ tag }: { tag: string }) {
  return (
    <span className="inline-block px-2 py-0.5 rounded-page text-xs font-ui bg-[var(--surface-elevated)] text-[var(--text-secondary)] border border-[var(--border-default)]">
      {tag}
    </span>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div
        className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-6 w-96 space-y-4 shadow-warm-lg"
        role="dialog"
        aria-label={title}
      >
        <h2 className="text-2xl font-display font-semibold text-[var(--text-primary)]">
          {title}
        </h2>
        <p className="text-sm font-body text-[var(--text-secondary)]">{message}</p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-[var(--border-default)] rounded-page font-ui text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-page font-ui text-sm text-white"
            style={{
              backgroundColor: danger ? 'var(--status-error)' : 'var(--accent-gold)',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

interface PromptFormData {
  promptTitle: string;
  prompt: string;
  difficultyTier: string;
  domainTags: string;
  status: 'active' | 'archived';
}

function PromptFormDialog({
  title,
  initial,
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  initial: PromptFormData;
  submitLabel: string;
  onSubmit: (data: PromptFormData) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<PromptFormData>(initial);

  const handleSubmit = () => {
    if (!form.promptTitle.trim()) {
      toast.error('Title is required');
      return;
    }
    if (!form.prompt.trim()) {
      toast.error('Prompt text is required');
      return;
    }
    onSubmit(form);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div
        className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-6 w-[500px] space-y-4 shadow-warm-lg max-h-[80vh] overflow-y-auto"
        role="dialog"
        aria-label={title}
      >
        <h2 className="text-2xl font-display font-semibold text-[var(--text-primary)]">
          {title}
        </h2>

        <div>
          <label className="block text-sm font-ui text-[var(--text-secondary)] mb-1">
            Title
          </label>
          <input
            type="text"
            value={form.promptTitle}
            onChange={(e) => setForm({ ...form, promptTitle: e.target.value })}
            data-testid="prompt-form-title"
            className="w-full px-3 py-2 border border-[var(--border-default)] rounded-page bg-[var(--surface-input)] text-[var(--text-primary)] font-ui"
            placeholder="e.g. Quantum for Kids"
          />
        </div>

        <div>
          <label className="block text-sm font-ui text-[var(--text-secondary)] mb-1">
            Prompt Text
          </label>
          <textarea
            value={form.prompt}
            onChange={(e) => setForm({ ...form, prompt: e.target.value })}
            data-testid="prompt-form-text"
            className="w-full px-3 py-2 border border-[var(--border-default)] rounded-page bg-[var(--surface-input)] text-[var(--text-primary)] font-body min-h-[100px]"
            placeholder="e.g. Explain quantum computing to a 10-year-old"
          />
        </div>

        <div>
          <label className="block text-sm font-ui text-[var(--text-secondary)] mb-1">
            Difficulty Tier
          </label>
          <select
            value={form.difficultyTier}
            onChange={(e) => setForm({ ...form, difficultyTier: e.target.value })}
            data-testid="prompt-form-difficulty"
            className="w-full px-3 py-2 border border-[var(--border-default)] rounded-page bg-[var(--surface-input)] text-[var(--text-primary)] font-ui"
          >
            <option value="">None</option>
            {DIFFICULTY_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d.charAt(0).toUpperCase() + d.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-ui text-[var(--text-secondary)] mb-1">
            Domain Tags (comma-separated)
          </label>
          <input
            type="text"
            value={form.domainTags}
            onChange={(e) => setForm({ ...form, domainTags: e.target.value })}
            data-testid="prompt-form-tags"
            className="w-full px-3 py-2 border border-[var(--border-default)] rounded-page bg-[var(--surface-input)] text-[var(--text-primary)] font-ui"
            placeholder="e.g. science, physics, education"
          />
        </div>

        <div>
          <label className="block text-sm font-ui text-[var(--text-secondary)] mb-1">
            Status
          </label>
          <select
            value={form.status}
            onChange={(e) =>
              setForm({ ...form, status: e.target.value as 'active' | 'archived' })
            }
            data-testid="prompt-form-status"
            className="w-full px-3 py-2 border border-[var(--border-default)] rounded-page bg-[var(--surface-input)] text-[var(--text-primary)] font-ui"
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-[var(--border-default)] rounded-page font-ui text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            data-testid="prompt-form-submit"
            className="px-4 py-2 bg-[var(--accent-gold)] text-[var(--surface-primary)] rounded-page font-ui text-sm hover:opacity-90"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PromptRegistryPage(): JSX.Element {
  const [prompts, setPrompts] = useState<PromptMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [actionLoading, setActionLoading] = useState(false);

  // Dialog state
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<PromptMetadata | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<PromptMetadata | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PromptMetadata | null>(null);

  // Expansion state for runs
  const [expandedPromptId, setExpandedPromptId] = useState<string | null>(null);
  const [promptRuns, setPromptRuns] = useState<StrategyRunEntry[]>([]);
  const [promptRunsLoading, setPromptRunsLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await getPromptsAction(
        statusFilter !== 'all' ? { status: statusFilter } : {},
      );

      if (result.success && result.data) {
        setPrompts(result.data);
      } else {
        setError(result.error?.message || 'Failed to load prompts');
      }
    } catch (err) {
      const msg = String(err);
      setError(msg);
      logger.error('Failed to load prompts', { error: msg });
      toast.error('Failed to load prompts');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const togglePromptRuns = async (promptId: string) => {
    if (expandedPromptId === promptId) {
      setExpandedPromptId(null);
      return;
    }
    setExpandedPromptId(promptId);
    setPromptRunsLoading(true);
    const result = await getPromptRunsAction(promptId, 10);
    if (result.success && result.data) setPromptRuns(result.data);
    else setPromptRuns([]);
    setPromptRunsLoading(false);
  };

  const handleCreate = async (data: PromptFormData) => {
    setActionLoading(true);
    const tags = parseTags(data.domainTags);

    const result = await createPromptAction({
      prompt: data.prompt.trim(),
      title: data.promptTitle.trim(),
      difficultyTier: data.difficultyTier || undefined,
      domainTags: tags,
      status: data.status,
    });

    if (result.success) {
      toast.success('Prompt created');
      setShowAddDialog(false);
      loadData();
    } else {
      toast.error(result.error?.message || 'Failed to create prompt');
    }
    setActionLoading(false);
  };

  const handleUpdate = async (data: PromptFormData) => {
    if (!editingPrompt) return;
    setActionLoading(true);

    const tags = parseTags(data.domainTags);

    const result = await updatePromptAction({
      id: editingPrompt.id,
      prompt: data.prompt.trim(),
      title: data.promptTitle.trim(),
      difficultyTier: data.difficultyTier || null,
      domainTags: tags,
      status: data.status,
    });

    if (result.success) {
      toast.success('Prompt updated');
      setEditingPrompt(null);
      loadData();
    } else {
      toast.error(result.error?.message || 'Failed to update prompt');
    }
    setActionLoading(false);
  };

  const handleArchive = async () => {
    if (!confirmArchive) return;
    setActionLoading(true);

    const result = await archivePromptAction(confirmArchive.id);

    if (result.success) {
      toast.success('Prompt archived');
      setConfirmArchive(null);
      loadData();
    } else {
      toast.error(result.error?.message || 'Failed to archive prompt');
    }
    setActionLoading(false);
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setActionLoading(true);

    const result = await deletePromptAction(confirmDelete.id);

    if (result.success) {
      toast.success('Prompt deleted');
      setConfirmDelete(null);
      loadData();
    } else {
      toast.error(result.error?.message || 'Failed to delete prompt');
    }
    setActionLoading(false);
  };

  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb items={[
        { label: 'Dashboard', href: '/admin/evolution-dashboard' },
        { label: 'Prompt Registry' },
      ]} />
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-4xl font-display font-bold text-[var(--text-primary)]">
            Prompt Registry
          </h1>
          <p className="text-[var(--text-muted)] font-body text-sm mt-1">
            Manage prompts used by the evolution pipeline
          </p>
        </div>
        <button
          onClick={() => setShowAddDialog(true)}
          disabled={actionLoading}
          data-testid="add-prompt-btn"
          className="px-4 py-2 bg-[var(--accent-gold)] text-[var(--surface-primary)] rounded-page font-ui text-sm hover:opacity-90 disabled:opacity-50"
        >
          Add Prompt
        </button>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm font-ui text-[var(--text-secondary)]">Status:</label>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          data-testid="status-filter"
          className="px-3 py-1.5 border border-[var(--border-default)] rounded-page bg-[var(--surface-input)] text-[var(--text-primary)] font-ui text-sm"
        >
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      {error && (
        <div
          className="rounded-book bg-[var(--status-error)]/10 border border-[var(--status-error)]/20 p-4 font-ui text-sm"
          style={{ color: 'var(--status-error)' }}
        >
          {error}
        </div>
      )}

      <div
        className="overflow-x-auto border border-[var(--border-default)] rounded-book shadow-warm-lg"
        data-testid="prompts-table"
      >
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-elevated)]">
            <tr>
              <th className="p-3 text-left font-ui text-[var(--text-muted)]">Title</th>
              <th className="p-3 text-left font-ui text-[var(--text-muted)]">Prompt</th>
              <th className="p-3 text-left font-ui text-[var(--text-muted)]">Difficulty</th>
              <th className="p-3 text-left font-ui text-[var(--text-muted)]">Tags</th>
              <th className="p-3 text-left font-ui text-[var(--text-muted)]">Status</th>
              <th className="p-3 text-left font-ui text-[var(--text-muted)]">Created</th>
              <th className="p-3 text-left font-ui text-[var(--text-muted)]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="p-0">
                  <TableSkeleton columns={7} rows={4} />
                </td>
              </tr>
            ) : prompts.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <EmptyState message="No prompts found" suggestion="Click 'Add Prompt' to create one" />
                </td>
              </tr>
            ) : (
              prompts.map((p) => (
                <Fragment key={p.id}>
                <tr
                  className="border-t border-[var(--border-default)] hover:bg-[var(--surface-secondary)] cursor-pointer"
                  data-testid={`prompt-row-${p.id}`}
                  onClick={() => togglePromptRuns(p.id)}
                >
                  <td className="p-3 text-[var(--text-primary)] font-ui font-medium whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      {p.title}
                      <Link
                        href={buildArenaTopicUrl(p.id)}
                        className="text-xs text-[var(--text-muted)] hover:text-[var(--accent-gold)]"
                        onClick={(e) => e.stopPropagation()}
                        title="View Arena"
                      >
                        Arena &rarr;
                      </Link>
                    </div>
                  </td>

                  <td
                    className="p-3 text-[var(--text-primary)] max-w-[350px] truncate font-body"
                    title={p.prompt}
                  >
                    {p.prompt}
                  </td>

                  <td className="p-3 text-[var(--text-secondary)] font-ui">
                    {p.difficulty_tier
                      ? p.difficulty_tier.charAt(0).toUpperCase() + p.difficulty_tier.slice(1)
                      : '—'}
                  </td>

                  <td className="p-3">
                    <div className="flex flex-wrap gap-1">
                      {p.domain_tags.length > 0
                        ? p.domain_tags.map((tag) => <TagChip key={tag} tag={tag} />)
                        : <span className="text-[var(--text-muted)]">—</span>}
                    </div>
                  </td>

                  <td className="p-3">
                    <StatusBadge status={p.status} />
                  </td>

                  <td className="p-3 text-[var(--text-muted)] font-ui text-xs whitespace-nowrap">
                    {new Date(p.created_at).toLocaleDateString()}
                  </td>

                  <td className="p-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setEditingPrompt(p)}
                        disabled={actionLoading}
                        data-testid={`edit-prompt-${p.id}`}
                        className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-ui text-xs disabled:opacity-50"
                      >
                        Edit
                      </button>
                      {p.status === 'active' && (
                        <button
                          onClick={() => setConfirmArchive(p)}
                          disabled={actionLoading}
                          data-testid={`archive-prompt-${p.id}`}
                          className="font-ui text-xs disabled:opacity-50"
                          style={{ color: 'var(--status-warning)' }}
                        >
                          Archive
                        </button>
                      )}
                      <button
                        onClick={() => setConfirmDelete(p)}
                        disabled={actionLoading}
                        data-testid={`delete-prompt-${p.id}`}
                        className="font-ui text-xs disabled:opacity-50"
                        style={{ color: 'var(--status-error)' }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
                {expandedPromptId === p.id && (
                  <tr data-testid={`prompt-runs-${p.id}`}>
                    <td colSpan={7} className="p-4 bg-[var(--surface-elevated)]">
                      <div className="text-sm font-ui font-semibold text-[var(--text-primary)] mb-2">
                        Runs using this prompt
                      </div>
                      {promptRunsLoading ? (
                        <div className="text-xs text-[var(--text-muted)] font-ui">Loading runs...</div>
                      ) : promptRuns.length === 0 ? (
                        <div className="text-xs text-[var(--text-muted)] font-ui">No runs found for this prompt</div>
                      ) : (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-[var(--text-muted)] font-ui">
                              <th className="p-1.5 text-left">Run</th>
                              <th className="p-1.5 text-left">Explanation</th>
                              <th className="p-1.5 text-center">Status</th>
                              <th className="p-1.5 text-right">Cost</th>
                              <th className="p-1.5 text-right">Iters</th>
                            </tr>
                          </thead>
                          <tbody>
                            {promptRuns.map((run) => (
                              <tr key={run.runId} className="border-t border-[var(--border-default)]">
                                <td className="p-1.5">
                                  <Link href={buildRunUrl(run.runId)} className="font-mono text-[var(--accent-gold)] hover:underline">
                                    {run.runId.substring(0, 8)}
                                  </Link>
                                </td>
                                <td className="p-1.5 text-[var(--text-primary)] truncate max-w-[200px]">
                                  {run.explanationId ? (
                                    <Link href={buildExplanationUrl(run.explanationId)} className="hover:text-[var(--accent-gold)] hover:underline">
                                      {run.explanationTitle}
                                    </Link>
                                  ) : run.explanationTitle}
                                </td>
                                <td className="p-1.5 text-center">
                                  <RunStatusBadge status={run.status} />
                                </td>
                                <td className="p-1.5 text-right font-mono text-[var(--text-secondary)]">{formatCostDetailed(run.totalCostUsd)}</td>
                                <td className="p-1.5 text-right text-[var(--text-muted)]">{run.iterations}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showAddDialog && (
        <PromptFormDialog
          title="Add Prompt"
          initial={{ promptTitle: '', prompt: '', difficultyTier: '', domainTags: '', status: 'active' }}
          submitLabel="Create"
          onSubmit={handleCreate}
          onClose={() => setShowAddDialog(false)}
        />
      )}

      {editingPrompt && (
        <PromptFormDialog
          title="Edit Prompt"
          initial={{
            promptTitle: editingPrompt.title,
            prompt: editingPrompt.prompt,
            difficultyTier: editingPrompt.difficulty_tier ?? '',
            domainTags: editingPrompt.domain_tags.join(', '),
            status: editingPrompt.status,
          }}
          submitLabel="Save"
          onSubmit={handleUpdate}
          onClose={() => setEditingPrompt(null)}
        />
      )}

      {confirmArchive && (
        <ConfirmDialog
          title="Archive Prompt"
          message={`Archive "${truncatePrompt(confirmArchive.prompt)}"? Archived prompts won't be used in new runs.`}
          confirmLabel="Archive"
          onConfirm={handleArchive}
          onCancel={() => setConfirmArchive(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete Prompt"
          message={`Permanently delete "${truncatePrompt(confirmDelete.prompt)}"? This cannot be undone. Prompts with associated runs cannot be deleted.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
