// Prompts CRUD list page using RegistryPage pattern with V2 schema.
// Manages evolution_arena_topics (prompts) with create, edit, archive, and delete.

'use client';

import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { RegistryPage, type RegistryPageConfig, type RowAction } from '@evolution/components/evolution/RegistryPage';
import type { FieldDef } from '@evolution/components/evolution/FormDialog';
import type { ColumnDef, FilterDef } from '@evolution/components/evolution';
import {
  listPromptsAction,
  createPromptAction,
  updatePromptAction,
  archivePromptAction,
  deletePromptAction,
  type PromptListItem,
} from '@evolution/services/promptRegistryActionsV2';

// ─── Load data adapter ────────────────────────────────────────────

const loadData = async (filters: Record<string, string>, page: number, pageSize: number) => {
  const result = await listPromptsAction({
    limit: pageSize,
    offset: (page - 1) * pageSize,
    status: filters.status || undefined,
    difficulty_tier: filters.difficulty_tier || undefined,
  });
  if (!result.success) throw new Error(result.error?.message ?? 'Load failed');
  return { items: result.data!.items, total: result.data!.total };
};

// ─── Column + filter definitions ──────────────────────────────────

const columns: ColumnDef<PromptListItem>[] = [
  { key: 'title', header: 'Title', render: (row) => row.title },
  {
    key: 'prompt',
    header: 'Prompt',
    render: (row) => {
      const text = row.prompt ?? '';
      return text.length > 100 ? `${text.substring(0, 100)}...` : text;
    },
  },
  { key: 'difficulty_tier', header: 'Difficulty', render: (row) => row.difficulty_tier ?? '—' },
  { key: 'status', header: 'Status', render: (row) => row.status },
  { key: 'created_at', header: 'Created', render: (row) => new Date(row.created_at).toLocaleDateString() },
];

const filters: FilterDef[] = [
  {
    key: 'status',
    label: 'Status',
    type: 'select',
    options: [
      { label: 'All', value: '' },
      { label: 'Active', value: 'active' },
      { label: 'Archived', value: 'archived' },
    ],
  },
  {
    key: 'difficulty_tier',
    label: 'Difficulty',
    type: 'select',
    options: [
      { label: 'All', value: '' },
      { label: 'Easy', value: 'easy' },
      { label: 'Medium', value: 'medium' },
      { label: 'Hard', value: 'hard' },
    ],
  },
];

// ─── Form fields ──────────────────────────────────────────────────

const createFields: FieldDef[] = [
  { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Prompt title' },
  { name: 'prompt', label: 'Prompt', type: 'textarea', required: true, placeholder: 'Enter prompt text' },
  {
    name: 'difficulty_tier',
    label: 'Difficulty Tier',
    type: 'select',
    options: [
      { label: 'Easy', value: 'easy' },
      { label: 'Medium', value: 'medium' },
      { label: 'Hard', value: 'hard' },
    ],
  },
  { name: 'domain_tags', label: 'Domain Tags (comma separated)', type: 'text', placeholder: 'e.g. science, math' },
];

// ─── Component ────────────────────────────────────────────────────

type DialogState =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'edit'; row: PromptListItem }
  | { kind: 'archive'; row: PromptListItem }
  | { kind: 'delete'; row: PromptListItem };

export default function PromptsPage(): JSX.Element {
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });

  const close = useCallback(() => setDialog({ kind: 'none' }), []);

  // ─── Row actions ──────────────────────────────────────────────

  const rowActions: RowAction<PromptListItem>[] = [
    {
      label: 'Edit',
      onClick: (row) => setDialog({ kind: 'edit', row }),
    },
    {
      label: 'Archive',
      onClick: (row) => setDialog({ kind: 'archive', row }),
      visible: (row) => row.status !== 'archived',
    },
    {
      label: 'Unarchive',
      onClick: (row) => setDialog({ kind: 'archive', row }),
      visible: (row) => row.status === 'archived',
    },
    {
      label: 'Delete',
      onClick: (row) => setDialog({ kind: 'delete', row }),
      danger: true,
    },
  ];

  // ─── Config ───────────────────────────────────────────────────

  const config: RegistryPageConfig<PromptListItem> = {
    title: 'Prompts',
    breadcrumbs: [{ label: 'Dashboard', href: '/admin/evolution-dashboard' }],
    columns,
    filters,
    loadData,
    getRowHref: (row) => `/admin/evolution/prompts/${row.id}`,
    rowActions,
    headerAction: { label: 'New Prompt', onClick: () => setDialog({ kind: 'create' }) },
    emptyMessage: 'No prompts found.',
  };

  // ─── Create / Edit form ───────────────────────────────────────

  const formOpen = dialog.kind === 'create' || dialog.kind === 'edit';
  const formInitial = dialog.kind === 'edit'
    ? {
        title: dialog.row.title,
        prompt: dialog.row.prompt,
        difficulty_tier: dialog.row.difficulty_tier ?? '',
        domain_tags: (dialog.row.domain_tags ?? []).join(', '),
      }
    : {};

  const handleFormSubmit = async (values: Record<string, unknown>) => {
    if (dialog.kind === 'create') {
      const result = await createPromptAction({
        title: values.title as string,
        prompt: values.prompt as string,
        difficulty_tier: (values.difficulty_tier as string) || undefined,
        domain_tags: (values.domain_tags as string) || undefined,
      });
      if (!result.success) throw new Error(result.error?.message ?? 'Create failed');
      toast.success('Prompt created');
    } else if (dialog.kind === 'edit') {
      const result = await updatePromptAction({
        id: dialog.row.id,
        title: values.title as string,
        prompt: values.prompt as string,
        difficulty_tier: (values.difficulty_tier as string) || undefined,
        domain_tags: (values.domain_tags as string) || undefined,
      });
      if (!result.success) throw new Error(result.error?.message ?? 'Update failed');
      toast.success('Prompt updated');
    }
  };

  // ─── Archive confirm ─────────────────────────────────────────

  const handleArchive = async () => {
    if (dialog.kind !== 'archive') return;
    const result = await archivePromptAction(dialog.row.id);
    if (!result.success) throw new Error(result.error?.message ?? 'Archive failed');
    toast.success(dialog.row.status === 'archived' ? 'Prompt unarchived' : 'Prompt archived');
  };

  // ─── Delete confirm ──────────────────────────────────────────

  const handleDelete = async () => {
    if (dialog.kind !== 'delete') return;
    const result = await deletePromptAction(dialog.row.id);
    if (!result.success) throw new Error(result.error?.message ?? 'Delete failed');
    toast.success('Prompt deleted');
  };

  // ─── Render ───────────────────────────────────────────────────

  const confirmOpen = dialog.kind === 'archive' || dialog.kind === 'delete';
  const confirmProps = (() => {
    if (dialog.kind === 'archive') {
      const isArchived = dialog.row.status === 'archived';
      return {
        title: isArchived ? 'Unarchive Prompt' : 'Archive Prompt',
        message: isArchived
          ? `Unarchive "${dialog.row.title}"?`
          : `Archive "${dialog.row.title}"? It will no longer appear in active lists.`,
        confirmLabel: isArchived ? 'Unarchive' : 'Archive',
        onConfirm: handleArchive,
        danger: false,
      };
    }
    if (dialog.kind === 'delete') {
      return {
        title: 'Delete Prompt',
        message: `Delete "${dialog.row.title}"? This action is permanent.`,
        confirmLabel: 'Delete',
        onConfirm: handleDelete,
        danger: true,
      };
    }
    return { title: '', message: '', onConfirm: async () => {}, danger: false };
  })();

  return (
    <RegistryPage<PromptListItem>
      config={config}
      formDialog={formOpen ? {
        open: true,
        onClose: close,
        title: dialog.kind === 'create' ? 'New Prompt' : 'Edit Prompt',
        fields: createFields,
        initial: formInitial,
        onSubmit: handleFormSubmit,
      } : undefined}
      confirmDialog={confirmOpen ? {
        open: true,
        onClose: close,
        ...confirmProps,
      } : undefined}
    />
  );
}
