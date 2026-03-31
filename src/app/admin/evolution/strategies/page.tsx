// Strategies CRUD list page using EntityListPage self-managed mode.
// Provides create, edit, clone, and delete actions for strategy configs (no archive).

'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { EntityListPage } from '@evolution/components/evolution';
import type { RowAction, FilterDef, ColumnDef } from '@evolution/components/evolution';
import type { FieldDef } from '@evolution/components/evolution';
import { createMetricColumns } from '@evolution/lib/metrics/metricColumns';
import { getListViewMetrics } from '@evolution/lib/metrics/registry';
import {
  listStrategiesAction,
  createStrategyAction,
  updateStrategyAction,
  cloneStrategyAction,
  type StrategyListItem,
} from '@evolution/services/strategyRegistryActions';
import { getBatchMetricsAction } from '@evolution/services/metricsActions';
import { executeEntityAction } from '@evolution/services/entityActions';
import { MODEL_OPTIONS } from '@/lib/utils/modelOptions';
import type { MetricRow } from '@evolution/lib/metrics/types';

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

  const items = result.data!.items;

  // Batch-fetch list-view metrics for strategies
  const metricNames = getListViewMetrics('strategy').map(d => d.name);
  if (items.length > 0 && metricNames.length > 0) {
    const metricsResult = await getBatchMetricsAction('strategy', items.map(s => s.id), metricNames);
    const metricsMap = metricsResult.success && metricsResult.data ? metricsResult.data : {};
    return {
      items: items.map(s => ({ ...s, metrics: (metricsMap[s.id] ?? []) as MetricRow[] })),
      total: result.data!.total,
    };
  }

  return { items, total: result.data!.total };
};

const baseColumns: ColumnDef<StrategyListItem>[] = [
  { key: 'name', header: 'Name', render: (row) => row.name },
  { key: 'label', header: 'Label', render: (row) => <span className="truncate block max-w-[200px]" title={row.label}>{row.label}</span> },
  { key: 'pipeline_type', header: 'Pipeline', render: (row) => row.pipeline_type ?? '—' },
  { key: 'status', header: 'Status', render: (row) => row.status },
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
  {
    key: 'created_by',
    label: 'Origin',
    type: 'select',
    options: [
      { label: 'All', value: '' },
      { label: 'Admin', value: 'admin' },
      { label: 'System', value: 'system' },
      { label: 'Experiment', value: 'experiment' },
      { label: 'Batch', value: 'batch' },
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
  | { kind: 'delete'; row: StrategyListItem };

export default function StrategiesPage(): JSX.Element {
  useEffect(() => { document.title = 'Strategies | Evolution'; }, []);
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });

  const close = (): void => setDialog({ kind: 'none' });

  const rowActions: RowAction<StrategyListItem>[] = [
    { label: 'Edit', onClick: (row) => setDialog({ kind: 'edit', row }) },
    { label: 'Clone', onClick: (row) => setDialog({ kind: 'clone', row }) },
    { label: 'Delete', onClick: (row) => setDialog({ kind: 'delete', row }), danger: true },
  ];

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

  const handleDelete = async () => {
    if (dialog.kind !== 'delete') return;
    const result = await executeEntityAction({ entityType: 'strategy', entityId: dialog.row.id, actionKey: 'delete' });
    if (!result.success) throw new Error(result.error?.message ?? 'Delete failed');
    toast.success('Strategy deleted');
  };

  const confirmOpen = dialog.kind === 'clone' || dialog.kind === 'delete';
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
    return {
      title: 'Delete Strategy',
      message: `Permanently delete "${dialog.kind === 'delete' ? dialog.row.name : ''}" and all its runs? This cannot be undone.`,
      confirmLabel: 'Delete',
      onConfirm: handleDelete,
      danger: true,
    };
  };

  return (
    <EntityListPage<StrategyListItem>
      title="Strategies"
      breadcrumbs={[
        { label: 'Evolution', href: '/admin/evolution-dashboard' },
        { label: 'Strategies' },
      ]}
      columns={columns}
      filters={filters}
      loadData={loadData}
      getRowHref={(row) => `/admin/evolution/strategies/${row.id}`}
      rowActions={rowActions}
      headerAction={{ label: 'New Strategy', onClick: () => setDialog({ kind: 'create' }) }}
      emptyMessage="No strategies found."
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
