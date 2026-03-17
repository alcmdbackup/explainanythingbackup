'use client';
// Prompt Registry admin page. Uses shared FormDialog, ConfirmDialog, and StatusBadge.

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { logger } from '@/lib/client_utilities';
import { toast } from 'sonner';
import { EvolutionBreadcrumb, TableSkeleton, EmptyState } from '@evolution/components/evolution';
import { StatusBadge } from '@evolution/components/evolution/StatusBadge';
import { FormDialog, type FieldDef } from '@evolution/components/evolution/FormDialog';
import { ConfirmDialog } from '@evolution/components/evolution/ConfirmDialog';
import {
  getPromptsAction,
  createPromptAction,
  updatePromptAction,
  archivePromptAction,
  deletePromptAction,
} from '@evolution/services/promptRegistryActions';
import type { PromptMetadata } from '@evolution/lib/types';
import { buildArenaTopicUrl } from '@evolution/lib/utils/evolutionUrls';

type StatusFilter = 'all' | 'active' | 'archived';

function parseTags(input: string): string[] {
  return input.split(',').map((t) => t.trim()).filter(Boolean);
}

function TagChip({ tag }: { tag: string }) {
  return (
    <span className="inline-block px-2 py-0.5 rounded-page text-xs font-ui bg-[var(--surface-elevated)] text-[var(--text-secondary)] border border-[var(--border-default)]">
      {tag}
    </span>
  );
}

const PROMPT_FIELDS: FieldDef[] = [
  { name: 'promptTitle', label: 'Title', type: 'text', required: true, placeholder: 'e.g. Quantum for Kids' },
  { name: 'prompt', label: 'Prompt Text', type: 'textarea', required: true, placeholder: 'e.g. Explain quantum computing to a 10-year-old' },
  {
    name: 'difficultyTier', label: 'Difficulty Tier', type: 'select',
    options: [
      { value: '', label: 'None' },
      { value: 'easy', label: 'Easy' },
      { value: 'medium', label: 'Medium' },
      { value: 'hard', label: 'Hard' },
    ],
  },
  { name: 'domainTags', label: 'Domain Tags (comma-separated)', type: 'text', placeholder: 'e.g. science, physics, education' },
  {
    name: 'status', label: 'Status', type: 'select',
    options: [
      { value: 'active', label: 'Active' },
      { value: 'archived', label: 'Archived' },
    ],
  },
];

export default function PromptRegistryPage(): JSX.Element {
  const [prompts, setPrompts] = useState<PromptMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [actionLoading, setActionLoading] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<PromptMetadata | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<PromptMetadata | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PromptMetadata | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getPromptsAction(statusFilter !== 'all' ? { status: statusFilter } : {});
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

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreate = async (data: Record<string, unknown>) => {
    setActionLoading(true);
    const result = await createPromptAction({
      prompt: (data.prompt as string).trim(),
      title: (data.promptTitle as string).trim(),
      difficultyTier: (data.difficultyTier as string) || undefined,
      domainTags: parseTags(data.domainTags as string),
      status: data.status as 'active' | 'archived',
    });
    if (result.success) {
      toast.success('Prompt created');
      loadData();
    } else {
      toast.error(result.error?.message || 'Failed to create prompt');
    }
    setActionLoading(false);
  };

  const handleUpdate = async (data: Record<string, unknown>) => {
    if (!editingPrompt) return;
    setActionLoading(true);
    const result = await updatePromptAction({
      id: editingPrompt.id,
      prompt: (data.prompt as string).trim(),
      title: (data.promptTitle as string).trim(),
      difficultyTier: (data.difficultyTier as string) || null,
      domainTags: parseTags(data.domainTags as string),
      status: data.status as 'active' | 'archived',
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

  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb items={[
        { label: 'Dashboard', href: '/admin/evolution-dashboard' },
        { label: 'Prompt Registry' },
      ]} />

      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-4xl font-display font-bold text-[var(--text-primary)]">Prompt Registry</h1>
          <p className="text-[var(--text-muted)] font-body text-sm mt-1">Manage prompts used by the evolution pipeline</p>
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
        <div className="rounded-book bg-[var(--status-error)]/10 border border-[var(--status-error)]/20 p-4 font-ui text-sm" style={{ color: 'var(--status-error)' }}>
          {error}
        </div>
      )}

      <div className="overflow-x-auto border border-[var(--border-default)] rounded-book shadow-warm-lg" data-testid="prompts-table">
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
              <tr><td colSpan={7} className="p-0"><TableSkeleton columns={7} rows={4} /></td></tr>
            ) : prompts.length === 0 ? (
              <tr><td colSpan={7}><EmptyState message="No prompts found" suggestion="Click 'Add Prompt' to create one" /></td></tr>
            ) : (
              prompts.map((p) => (
                <tr key={p.id} className="border-t border-[var(--border-default)] hover:bg-[var(--surface-secondary)]" data-testid={`prompt-row-${p.id}`}>
                  <td className="p-3 text-[var(--text-primary)] font-ui font-medium whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <Link href={`/admin/evolution/prompts/${p.id}`} className="hover:text-[var(--accent-gold)] hover:underline" data-testid={`prompt-link-${p.id}`}>{p.title}</Link>
                      <Link href={buildArenaTopicUrl(p.id)} className="text-xs text-[var(--text-muted)] hover:text-[var(--accent-gold)]" title="View Arena">Arena &rarr;</Link>
                    </div>
                  </td>
                  <td className="p-3 text-[var(--text-primary)] max-w-[350px] truncate font-body" title={p.prompt}>{p.prompt}</td>
                  <td className="p-3 text-[var(--text-secondary)] font-ui">{p.difficulty_tier ? p.difficulty_tier.charAt(0).toUpperCase() + p.difficulty_tier.slice(1) : '—'}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1">
                      {p.domain_tags.length > 0 ? p.domain_tags.map((tag) => <TagChip key={tag} tag={tag} />) : <span className="text-[var(--text-muted)]">—</span>}
                    </div>
                  </td>
                  <td className="p-3"><StatusBadge variant="entity-status" status={p.status} /></td>
                  <td className="p-3 text-[var(--text-muted)] font-ui text-xs whitespace-nowrap">{new Date(p.created_at).toLocaleDateString()}</td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <button onClick={() => setEditingPrompt(p)} disabled={actionLoading} data-testid={`edit-prompt-${p.id}`} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-ui text-xs disabled:opacity-50">Edit</button>
                      {p.status === 'active' && (
                        <button onClick={() => setConfirmArchive(p)} disabled={actionLoading} data-testid={`archive-prompt-${p.id}`} className="font-ui text-xs disabled:opacity-50" style={{ color: 'var(--status-warning)' }}>Archive</button>
                      )}
                      <button onClick={() => setConfirmDelete(p)} disabled={actionLoading} data-testid={`delete-prompt-${p.id}`} className="font-ui text-xs disabled:opacity-50" style={{ color: 'var(--status-error)' }}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <FormDialog
        open={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        title="Add Prompt"
        fields={PROMPT_FIELDS}
        initial={{ promptTitle: '', prompt: '', difficultyTier: '', domainTags: '', status: 'active' }}
        onSubmit={handleCreate}
        validate={(v) => !((v.promptTitle as string)?.trim()) ? 'Title is required' : !((v.prompt as string)?.trim()) ? 'Prompt text is required' : null}
      />

      {editingPrompt && (
        <FormDialog
          open={!!editingPrompt}
          onClose={() => setEditingPrompt(null)}
          title="Edit Prompt"
          fields={PROMPT_FIELDS}
          initial={{
            promptTitle: editingPrompt.title,
            prompt: editingPrompt.prompt,
            difficultyTier: editingPrompt.difficulty_tier ?? '',
            domainTags: editingPrompt.domain_tags.join(', '),
            status: editingPrompt.status,
          }}
          onSubmit={handleUpdate}
        />
      )}

      <ConfirmDialog
        open={!!confirmArchive}
        onClose={() => setConfirmArchive(null)}
        title="Archive Prompt"
        message={`Archive "${confirmArchive?.prompt.slice(0, 60)}"? Archived prompts won't be used in new runs.`}
        confirmLabel="Archive"
        onConfirm={async () => {
          if (!confirmArchive) return;
          const result = await archivePromptAction(confirmArchive.id);
          if (result.success) { toast.success('Prompt archived'); loadData(); }
          else toast.error(result.error?.message || 'Failed to archive');
        }}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete Prompt"
        message={`Permanently delete "${confirmDelete?.prompt.slice(0, 60)}"? This cannot be undone.`}
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          if (!confirmDelete) return;
          const result = await deletePromptAction(confirmDelete.id);
          if (result.success) { toast.success('Prompt deleted'); loadData(); }
          else toast.error(result.error?.message || 'Failed to delete');
        }}
      />
    </div>
  );
}
