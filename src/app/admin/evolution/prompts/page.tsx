// Prompts CRUD list page using EntityListPage self-managed mode.
// Manages evolution_prompts with create, edit, and delete (no archive).

'use client';

import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { EntityListPage } from '@evolution/components/evolution';
import type { RowAction, FilterDef, ColumnDef, FieldDef } from '@evolution/components/evolution';
import {
  listPromptsAction,
  createPromptAction,
  updatePromptAction,
  type PromptListItem,
} from '@evolution/services/arenaActions';
import { executeEntityAction } from '@evolution/services/entityActions';
import { formatDate } from '@evolution/lib/utils/formatters';

const loadData = async (filters: Record<string, string>, page: number, pageSize: number) => {
  const result = await listPromptsAction({
    limit: pageSize,
    offset: (page - 1) * pageSize,
    status: filters.status || undefined,
    filterTestContent: filters.filterTestContent === 'true',
    name: filters.name || undefined,
  });
  if (!result.success) throw new Error(result.error?.message ?? 'Load failed');
  return { items: result.data!.items, total: result.data!.total };
};

// U32 (use_playwright_find_bugs_ux_issues_20260422): Name column carries the
// row-level Link; other columns skipLink to avoid duplicate anchors per row.
const columns: ColumnDef<PromptListItem>[] = [
  { key: 'name', header: 'Name', render: (row) => row.name },
  {
    key: 'prompt',
    header: 'Prompt',
    skipLink: true,
    render: (row) => {
      const text = row.prompt ?? '';
      return text.length > 100 ? `${text.substring(0, 100)}...` : text;
    },
  },
  { key: 'status', header: 'Status', skipLink: true, render: (row) => row.status },
  // U15 + U32: match runs/arena list format AND skip link wrap.
  { key: 'created_at', header: 'Created', skipLink: true, render: (row) => formatDate(row.created_at) },
];

const filters: FilterDef[] = [
  {
    key: 'status',
    label: 'Status',
    type: 'select',
    options: [
      { label: 'All', value: '' },
      { label: 'Active', value: 'active' },
    ],
  },
  { key: 'filterTestContent', label: 'Hide test content', type: 'checkbox', defaultChecked: true },
  { key: 'name', label: 'Name', type: 'text', placeholder: 'Search...' },
];

const createFields: FieldDef[] = [
  { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Prompt name' },
  { name: 'prompt', label: 'Prompt', type: 'textarea', required: true, placeholder: 'Enter prompt text' },
];

type DialogState =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'edit'; row: PromptListItem }
  | { kind: 'delete'; row: PromptListItem };

export default function PromptsPage(): JSX.Element {
  useEffect(() => { document.title = 'Prompts | Evolution'; }, []);
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });

  const close = useCallback(() => setDialog({ kind: 'none' }), []);

  const rowActions: RowAction<PromptListItem>[] = [
    { label: 'Edit', onClick: (row) => setDialog({ kind: 'edit', row }) },
    { label: 'Delete', onClick: (row) => setDialog({ kind: 'delete', row }), danger: true },
  ];

  const formOpen = dialog.kind === 'create' || dialog.kind === 'edit';
  const formInitial = dialog.kind === 'edit' ? { name: dialog.row.name, prompt: dialog.row.prompt } : {};

  const handleFormSubmit = async (values: Record<string, unknown>) => {
    if (dialog.kind === 'create') {
      const result = await createPromptAction({ name: values.name as string, prompt: values.prompt as string });
      if (!result.success) throw new Error(result.error?.message ?? 'Create failed');
      toast.success('Prompt created');
    } else if (dialog.kind === 'edit') {
      const result = await updatePromptAction({ id: dialog.row.id, name: values.name as string, prompt: values.prompt as string });
      if (!result.success) throw new Error(result.error?.message ?? 'Update failed');
      toast.success('Prompt updated');
    }
  };

  const handleDelete = async () => {
    if (dialog.kind !== 'delete') return;
    const result = await executeEntityAction({ entityType: 'prompt', entityId: dialog.row.id, actionKey: 'delete' });
    if (!result.success) throw new Error(result.error?.message ?? 'Delete failed');
    toast.success('Prompt deleted');
  };

  return (
    <EntityListPage<PromptListItem>
      title="Prompts"
      breadcrumbs={[
        { label: 'Evolution', href: '/admin/evolution-dashboard' },
        { label: 'Prompts' },
      ]}
      columns={columns}
      filters={filters}
      loadData={loadData}
      getRowHref={(row) => `/admin/evolution/prompts/${row.id}`}
      rowActions={rowActions}
      headerAction={{ label: 'New Prompt', onClick: () => setDialog({ kind: 'create' }) }}
      emptyMessage="No prompts found."
      formDialog={formOpen ? {
        open: true,
        onClose: close,
        title: dialog.kind === 'create' ? 'New Prompt' : 'Edit Prompt',
        fields: createFields,
        initial: formInitial,
        onSubmit: handleFormSubmit,
      } : undefined}
      confirmDialog={dialog.kind === 'delete' ? {
        open: true,
        onClose: close,
        title: 'Delete Prompt',
        message: `Delete "${dialog.row.name}" and all its experiments/runs? This cannot be undone.`,
        confirmLabel: 'Delete',
        onConfirm: handleDelete,
        danger: true,
      } : undefined}
    />
  );
}
