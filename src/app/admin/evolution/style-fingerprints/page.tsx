// Style fingerprints CRUD list page using EntityListPage self-managed mode.
// Manages evolution_style_fingerprints with create (name + description), edit (description),
// and soft-delete via deleted_at. Articles are managed on the per-fingerprint detail page.

'use client';

import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { EntityListPage } from '@evolution/components/evolution';
import type { RowAction, FilterDef, ColumnDef, FieldDef } from '@evolution/components/evolution';
import {
  listStyleFingerprintsAction,
  createStyleFingerprintAction,
  updateStyleFingerprintAction,
  type StyleFingerprintListItem,
} from '@evolution/services/styleFingerprintActions';
import { executeEntityAction } from '@evolution/services/entityActions';
import { formatDate } from '@evolution/lib/utils/formatters';

const loadData = async (filters: Record<string, string>, page: number, pageSize: number) => {
  const result = await listStyleFingerprintsAction({
    limit: pageSize,
    offset: (page - 1) * pageSize,
    status: filters.status || undefined,
    filterTestContent: filters.filterTestContent === 'true',
    name: filters.name || undefined,
  });
  if (!result.success) throw new Error(result.error?.message ?? 'Load failed');
  return { items: result.data!.items, total: result.data!.total };
};

const columns: ColumnDef<StyleFingerprintListItem>[] = [
  { key: 'name', header: 'Name', render: (row) => row.name },
  {
    key: 'description',
    header: 'Description',
    skipLink: true,
    render: (row) => {
      const text = row.description ?? '';
      return text.length > 100 ? `${text.substring(0, 100)}...` : text;
    },
  },
  { key: 'article_count', header: 'Articles', skipLink: true, render: (row) => row.article_count },
  {
    key: 'spelling',
    header: 'Spelling',
    skipLink: true,
    render: (row) => row.fingerprint?.spellingRegion ?? '—',
  },
  { key: 'status', header: 'Status', skipLink: true, render: (row) => row.status },
  { key: 'updated_at', header: 'Updated', skipLink: true, render: (row) => formatDate(row.updated_at) },
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
  { key: 'filterTestContent', label: 'Hide test content', type: 'checkbox', defaultChecked: true },
  { key: 'name', label: 'Name', type: 'text', placeholder: 'Search...' },
];

type DialogState =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'edit'; row: StyleFingerprintListItem }
  | { kind: 'delete'; row: StyleFingerprintListItem };

const fields: FieldDef[] = [
  { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'e.g. hemingway_terse (letters/digits/_/-, no spaces)' },
  { name: 'description', label: 'Description', type: 'textarea', placeholder: 'What voice this fingerprint captures' },
];

export default function StyleFingerprintsPage(): JSX.Element {
  useEffect(() => { document.title = 'Style Fingerprints | Evolution'; }, []);
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });

  const close = useCallback(() => setDialog({ kind: 'none' }), []);

  const rowActions: RowAction<StyleFingerprintListItem>[] = [
    { label: 'Edit', onClick: (row) => setDialog({ kind: 'edit', row }) },
    { label: 'Delete', onClick: (row) => setDialog({ kind: 'delete', row }), danger: true },
  ];

  const formOpen = dialog.kind === 'create' || dialog.kind === 'edit';
  const formInitial = dialog.kind === 'edit'
    ? { name: dialog.row.name, description: dialog.row.description ?? '' }
    : {};

  const handleFormSubmit = async (values: Record<string, unknown>) => {
    if (dialog.kind === 'create') {
      const result = await createStyleFingerprintAction({
        name: values.name as string,
        description: (values.description as string) || null,
      });
      if (!result.success) throw new Error(result.error?.message ?? 'Create failed');
      toast.success('Style fingerprint created — add articles on its detail page');
    } else if (dialog.kind === 'edit') {
      const result = await updateStyleFingerprintAction({
        id: dialog.row.id,
        description: (values.description as string) || null,
      });
      if (!result.success) throw new Error(result.error?.message ?? 'Update failed');
      toast.success('Style fingerprint updated');
    }
  };

  const handleDelete = async () => {
    if (dialog.kind !== 'delete') return;
    const result = await executeEntityAction({ entityType: 'style_fingerprint', entityId: dialog.row.id, actionKey: 'delete' });
    if (!result.success) throw new Error(result.error?.message ?? 'Delete failed');
    toast.success('Style fingerprint deleted');
  };

  return (
    <EntityListPage<StyleFingerprintListItem>
      title="Style Fingerprints"
      breadcrumbs={[
        { label: 'Evolution', href: '/admin/evolution-dashboard' },
        { label: 'Style Fingerprints' },
      ]}
      columns={columns}
      filters={filters}
      loadData={loadData}
      getRowHref={(row) => `/admin/evolution/style-fingerprints/${row.id}`}
      rowActions={rowActions}
      headerAction={{ label: 'New Fingerprint', onClick: () => setDialog({ kind: 'create' }) }}
      emptyMessage="No style fingerprints yet. Create one, then add articles to compute it."
      formDialog={formOpen ? {
        open: true,
        onClose: close,
        title: dialog.kind === 'create' ? 'New Style Fingerprint' : 'Edit Style Fingerprint',
        fields: dialog.kind === 'edit' ? fields.filter((f) => f.name !== 'name') : fields,
        initial: formInitial,
        onSubmit: handleFormSubmit,
      } : undefined}
      confirmDialog={dialog.kind === 'delete' ? {
        open: true,
        onClose: close,
        title: 'Delete Style Fingerprint',
        message: `Soft-delete "${dialog.row.name}"? Strategies referencing it fall back to no style enforcement; historical runs keep their snapshot.`,
        confirmLabel: 'Delete',
        onConfirm: handleDelete,
        danger: true,
      } : undefined}
    />
  );
}
