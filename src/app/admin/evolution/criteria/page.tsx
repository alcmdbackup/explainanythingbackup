// Criteria CRUD list page using EntityListPage self-managed mode.
// Manages evolution_criteria with create, edit (incl. rubric editor), and
// soft-delete via deleted_at.

'use client';

import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { EntityListPage } from '@evolution/components/evolution';
import type { RowAction, FilterDef, ColumnDef, FieldDef } from '@evolution/components/evolution';
import {
  listCriteriaAction,
  createCriteriaAction,
  updateCriteriaAction,
  type CriteriaListItem,
} from '@evolution/services/criteriaActions';
import { executeEntityAction } from '@evolution/services/entityActions';
import { formatDate } from '@evolution/lib/utils/formatters';
import { RubricEditor, type RubricAnchor } from './RubricEditor';

const loadData = async (filters: Record<string, string>, page: number, pageSize: number) => {
  const result = await listCriteriaAction({
    limit: pageSize,
    offset: (page - 1) * pageSize,
    status: filters.status || undefined,
    filterTestContent: filters.filterTestContent === 'true',
    name: filters.name || undefined,
  });
  if (!result.success) throw new Error(result.error?.message ?? 'Load failed');
  return { items: result.data!.items, total: result.data!.total };
};

const columns: ColumnDef<CriteriaListItem>[] = [
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
  { key: 'min_rating', header: 'Min', skipLink: true, render: (row) => row.min_rating },
  { key: 'max_rating', header: 'Max', skipLink: true, render: (row) => row.max_rating },
  {
    key: 'rubric',
    header: 'Rubric',
    skipLink: true,
    render: (row) => row.evaluation_guidance && row.evaluation_guidance.length > 0
      ? `✓ ${row.evaluation_guidance.length}`
      : '—',
  },
  { key: 'status', header: 'Status', skipLink: true, render: (row) => row.status },
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
      { label: 'Archived', value: 'archived' },
    ],
  },
  { key: 'filterTestContent', label: 'Hide test content', type: 'checkbox', defaultChecked: true },
  { key: 'name', label: 'Name', type: 'text', placeholder: 'Search...' },
];

type DialogState =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'edit'; row: CriteriaListItem }
  | { kind: 'delete'; row: CriteriaListItem };

export default function CriteriaPage(): JSX.Element {
  useEffect(() => { document.title = 'Criteria | Evolution'; }, []);
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});

  const close = useCallback(() => {
    setDialog({ kind: 'none' });
    setFormValues({});
  }, []);

  const rowActions: RowAction<CriteriaListItem>[] = [
    { label: 'Edit', onClick: (row) => {
      setFormValues({
        name: row.name,
        description: row.description ?? '',
        min_rating: row.min_rating,
        max_rating: row.max_rating,
        evaluation_guidance: row.evaluation_guidance ?? [],
      });
      setDialog({ kind: 'edit', row });
    } },
    { label: 'Delete', onClick: (row) => setDialog({ kind: 'delete', row }), danger: true },
  ];

  const formOpen = dialog.kind === 'create' || dialog.kind === 'edit';
  const formInitial = dialog.kind === 'edit' ? {
    name: dialog.row.name,
    description: dialog.row.description ?? '',
    min_rating: dialog.row.min_rating,
    max_rating: dialog.row.max_rating,
    evaluation_guidance: dialog.row.evaluation_guidance ?? [],
  } : { evaluation_guidance: [] };

  const fields: FieldDef[] = [
    { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'e.g. clarity' },
    { name: 'description', label: 'Description', type: 'textarea', placeholder: 'What this criterion evaluates' },
    { name: 'min_rating', label: 'Min Rating', type: 'number', required: true },
    { name: 'max_rating', label: 'Max Rating', type: 'number', required: true },
    {
      name: 'evaluation_guidance',
      label: 'Evaluation Guidance (optional rubric)',
      type: 'custom',
      render: (value, onChange) => {
        const minRating = Number((formValues.min_rating ?? formInitial.min_rating ?? 1));
        const maxRating = Number((formValues.max_rating ?? formInitial.max_rating ?? 10));
        const anchors = (value as RubricAnchor[] | null | undefined) ?? [];
        return (
          <RubricEditor
            value={anchors}
            onChange={(next) => onChange(next)}
            minRating={minRating}
            maxRating={maxRating}
          />
        );
      },
    },
  ];

  const handleFormChange = useCallback((values: Record<string, unknown>) => {
    setFormValues(values);
  }, []);

  const handleFormSubmit = async (values: Record<string, unknown>) => {
    const guidanceRaw = values.evaluation_guidance as RubricAnchor[] | null | undefined;
    const guidance = guidanceRaw && guidanceRaw.length > 0 ? guidanceRaw : null;

    if (dialog.kind === 'create') {
      const result = await createCriteriaAction({
        name: values.name as string,
        description: (values.description as string) || null,
        min_rating: Number(values.min_rating),
        max_rating: Number(values.max_rating),
        evaluation_guidance: guidance,
      });
      if (!result.success) throw new Error(result.error?.message ?? 'Create failed');
      toast.success('Criteria created');
    } else if (dialog.kind === 'edit') {
      const result = await updateCriteriaAction({
        id: dialog.row.id,
        name: values.name as string,
        description: (values.description as string) || null,
        min_rating: Number(values.min_rating),
        max_rating: Number(values.max_rating),
        evaluation_guidance: guidance,
      });
      if (!result.success) throw new Error(result.error?.message ?? 'Update failed');
      toast.success('Criteria updated');
    }
  };

  const handleDelete = async () => {
    if (dialog.kind !== 'delete') return;
    const result = await executeEntityAction({ entityType: 'criteria', entityId: dialog.row.id, actionKey: 'delete' });
    if (!result.success) throw new Error(result.error?.message ?? 'Delete failed');
    toast.success('Criteria deleted');
  };

  return (
    <EntityListPage<CriteriaListItem>
      title="Criteria"
      breadcrumbs={[
        { label: 'Evolution', href: '/admin/evolution-dashboard' },
        { label: 'Criteria' },
      ]}
      columns={columns}
      filters={filters}
      loadData={loadData}
      getRowHref={(row) => `/admin/evolution/criteria/${row.id}`}
      rowActions={rowActions}
      headerAction={{ label: 'New Criteria', onClick: () => {
        setFormValues({ evaluation_guidance: [] });
        setDialog({ kind: 'create' });
      } }}
      emptyMessage="No criteria found. Run the seed script or create one to get started."
      formDialog={formOpen ? {
        open: true,
        onClose: close,
        title: dialog.kind === 'create' ? 'New Criteria' : 'Edit Criteria',
        fields,
        initial: formInitial,
        onSubmit: handleFormSubmit,
        onFormChange: handleFormChange,
      } : undefined}
      confirmDialog={dialog.kind === 'delete' ? {
        open: true,
        onClose: close,
        title: 'Delete Criteria',
        message: `Soft-delete "${dialog.row.name}"? Existing variants that reference it will continue to render but the criteria will be hidden from new strategy configurations.`,
        confirmLabel: 'Delete',
        onConfirm: handleDelete,
        danger: true,
      } : undefined}
    />
  );
}
