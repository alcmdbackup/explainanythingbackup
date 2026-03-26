// Strategies CRUD list page using RegistryPage pattern with V2 schema.
// Provides create, edit, clone, archive, and delete actions for strategy configs.

'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { RegistryPage, type RegistryPageConfig, type RowAction } from '@evolution/components/evolution/RegistryPage';
import type { FieldDef } from '@evolution/components/evolution/FormDialog';
import type { ColumnDef, FilterDef } from '@evolution/components/evolution';
import { createMetricColumns } from '@evolution/lib/metrics/metricColumns';
import {
  listStrategiesAction,
  createStrategyAction,
  updateStrategyAction,
  cloneStrategyAction,
  archiveStrategyAction,
  deleteStrategyAction,
  type StrategyListItem,
} from '@evolution/services/strategyRegistryActions';
import { MODEL_OPTIONS } from '@/lib/utils/modelOptions';

const loadData = async (filters: Record<string, string>, page: number, pageSize: number) => {
  const result = await listStrategiesAction({
    limit: pageSize,
    offset: (page - 1) * pageSize,
    status: filters.status || undefined,
    pipeline_type: filters.pipeline_type || undefined,
    created_by: filters.created_by || undefined,
    filterTestContent: filters.filterTestContent === 'true',
  });
  if (!result.success) throw new Error(result.error?.message ?? 'Load failed');
  return { items: result.data!.items, total: result.data!.total };
};

const baseColumns: ColumnDef<StrategyListItem>[] = [
  { key: 'name', header: 'Name', render: (row) => row.name },
  { key: 'label', header: 'Label', render: (row) => <span className="truncate block max-w-[200px]" title={row.label}>{row.label}</span> },
  { key: 'pipeline_type', header: 'Pipeline', render: (row) => row.pipeline_type ?? '—' },
  { key: 'status', header: 'Status', render: (row) => row.status },
  { key: 'run_count', header: 'Runs', render: (row) => row.run_count },
  { key: 'avg_final_elo', header: 'Avg Elo', render: (row) => (row.avg_final_elo != null ? row.avg_final_elo.toFixed(0) : '—') },
];
const columns: ColumnDef<StrategyListItem>[] = [...baseColumns, ...createMetricColumns<StrategyListItem>('strategy')];

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
    key: 'pipeline_type',
    label: 'Pipeline',
    type: 'select',
    options: [
      { label: 'All', value: '' },
      { label: 'Full', value: 'full' },
      { label: 'Single', value: 'single' },
    ],
  },
  { key: 'filterTestContent', label: 'Hide test content', type: 'checkbox', defaultChecked: true },
];

const createFields: FieldDef[] = [
  { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Strategy name' },
  { name: 'description', label: 'Description', type: 'textarea', placeholder: 'Optional description' },
  { name: 'generationModel', label: 'Generation Model', type: 'select', required: true, options: [{ label: 'Select a model...', value: '' }, ...MODEL_OPTIONS.map(m => ({ label: m, value: m }))] },
  { name: 'judgeModel', label: 'Judge Model', type: 'select', required: true, options: [{ label: 'Select a model...', value: '' }, ...MODEL_OPTIONS.map(m => ({ label: m, value: m }))] },
  { name: 'iterations', label: 'Iterations', type: 'number', required: true },
];

type DialogState =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'edit'; row: StrategyListItem }
  | { kind: 'clone'; row: StrategyListItem }
  | { kind: 'archive'; row: StrategyListItem }
  | { kind: 'delete'; row: StrategyListItem };

export default function StrategiesPage(): JSX.Element {
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });

  const close = (): void => setDialog({ kind: 'none' });

  const rowActions: RowAction<StrategyListItem>[] = [
    {
      label: 'Edit',
      onClick: (row) => setDialog({ kind: 'edit', row }),
    },
    {
      label: 'Clone',
      onClick: (row) => setDialog({ kind: 'clone', row }),
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

  const config: RegistryPageConfig<StrategyListItem> = {
    title: 'Strategies',
    breadcrumbs: [{ label: 'Evolution', href: '/admin/evolution-dashboard' }],
    columns,
    filters,
    loadData,
    getRowHref: (row) => `/admin/evolution/strategies/${row.id}`,
    rowActions,
    headerAction: { label: 'New Strategy', onClick: () => setDialog({ kind: 'create' }) },
    emptyMessage: 'No strategies found.',
  };

  const formOpen = dialog.kind === 'create' || dialog.kind === 'edit';
  const formInitial = dialog.kind === 'edit'
    ? {
        name: dialog.row.name,
        description: dialog.row.description ?? '',
        generationModel: dialog.row.config?.generationModel ?? '',
        judgeModel: dialog.row.config?.judgeModel ?? '',
        iterations: dialog.row.config?.iterations ?? 10,
      }
    : {};

  const handleFormSubmit = async (values: Record<string, unknown>) => {
    if (dialog.kind === 'create') {
      const result = await createStrategyAction({
        name: values.name as string,
        description: values.description as string,
        generationModel: values.generationModel as string,
        judgeModel: values.judgeModel as string,
        iterations: values.iterations as number,
      });
      if (!result.success) throw new Error(result.error?.message ?? 'Create failed');
      toast.success('Strategy created');
    } else if (dialog.kind === 'edit') {
      const result = await updateStrategyAction({
        id: dialog.row.id,
        name: values.name as string,
        description: values.description as string,
      });
      if (!result.success) throw new Error(result.error?.message ?? 'Update failed');
      toast.success('Strategy updated');
    }
  };

  const handleClone = async () => {
    if (dialog.kind !== 'clone') return;
    const result = await cloneStrategyAction({
      sourceId: dialog.row.id,
      newName: `${dialog.row.name} (copy)`,
    });
    if (!result.success) throw new Error(result.error?.message ?? 'Clone failed');
    toast.success('Strategy cloned');
  };

  const handleArchive = async () => {
    if (dialog.kind !== 'archive') return;
    const isArchived = dialog.row.status === 'archived';
    if (isArchived) {
      const result = await updateStrategyAction({ id: dialog.row.id, status: 'active' });
      if (!result.success) throw new Error(result.error?.message ?? 'Unarchive failed');
      toast.success('Strategy unarchived');
    } else {
      const result = await archiveStrategyAction(dialog.row.id);
      if (!result.success) throw new Error(result.error?.message ?? 'Archive failed');
      toast.success('Strategy archived');
    }
  };

  const handleDelete = async () => {
    if (dialog.kind !== 'delete') return;
    const result = await deleteStrategyAction(dialog.row.id);
    if (!result.success) throw new Error(result.error?.message ?? 'Delete failed');
    toast.success('Strategy deleted');
  };

  const confirmOpen = dialog.kind === 'clone' || dialog.kind === 'archive' || dialog.kind === 'delete';
  const getConfirmProps = (): { title: string; message: string; confirmLabel?: string; onConfirm: () => Promise<void>; danger: boolean } => {
    if (dialog.kind === 'clone') {
      return {
        title: 'Clone Strategy',
        message: `Clone "${dialog.row.name}" as "${dialog.row.name} (copy)"?`,
        confirmLabel: 'Clone',
        onConfirm: handleClone,
        danger: false,
      };
    }
    if (dialog.kind === 'archive') {
      const isArchived = dialog.row.status === 'archived';
      return {
        title: isArchived ? 'Unarchive Strategy' : 'Archive Strategy',
        message: isArchived
          ? `Unarchive "${dialog.row.name}"?`
          : `Archive "${dialog.row.name}"? It will no longer appear in active lists.`,
        confirmLabel: isArchived ? 'Unarchive' : 'Archive',
        onConfirm: handleArchive,
        danger: false,
      };
    }
    return {
      title: 'Delete Strategy',
      message: `Permanently delete "${dialog.kind === 'delete' ? dialog.row.name : ''}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      onConfirm: handleDelete,
      danger: true,
    };
  };

  return (
    <RegistryPage<StrategyListItem>
      config={config}
      formDialog={formOpen ? {
        open: true,
        onClose: close,
        title: dialog.kind === 'create' ? 'New Strategy' : 'Edit Strategy',
        fields: dialog.kind === 'create' ? createFields : createFields.slice(0, 2),
        initial: formInitial,
        onSubmit: handleFormSubmit,
      } : undefined}
      confirmDialog={confirmOpen ? {
        open: true,
        onClose: close,
        ...getConfirmProps(),
      } : undefined}
    />
  );
}
