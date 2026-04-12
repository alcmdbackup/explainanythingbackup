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

// Available generation strategy names for the guidance selector.
const GENERATION_STRATEGIES = [
  'structural_transform',
  'lexical_simplify',
  'grounding_enhance',
  'engagement_amplify',
  'style_polish',
  'argument_fortify',
  'narrative_weave',
  'tone_transform',
] as const;

type GuidanceEntry = { strategy: string; percent: number };

/** Custom form field for generationGuidance: add/remove strategy rows with percent inputs. */
function GenerationGuidanceField(
  { value, onChange }: { value: unknown; onChange: (v: unknown) => void },
): JSX.Element {
  const entries = (Array.isArray(value) ? value : []) as GuidanceEntry[];
  const usedStrategies = new Set(entries.map((e) => e.strategy));
  const available = GENERATION_STRATEGIES.filter((s) => !usedStrategies.has(s));
  const total = entries.reduce((sum, e) => sum + (e.percent || 0), 0);

  const addEntry = () => {
    if (available.length === 0) return;
    onChange([...entries, { strategy: available[0], percent: 0 }]);
  };

  const removeEntry = (idx: number) => {
    onChange(entries.filter((_, i) => i !== idx));
  };

  const updateEntry = (idx: number, field: 'strategy' | 'percent', val: string | number) => {
    const updated = entries.map((e, i) => (i === idx ? { ...e, [field]: val } : e));
    onChange(updated);
  };

  return (
    <div className="space-y-2" data-testid="generation-guidance-field">
      {entries.map((entry, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <select
            value={entry.strategy}
            onChange={(e) => updateEntry(idx, 'strategy', e.target.value)}
            className="flex-1 rounded-book border border-[var(--border-default)] bg-[var(--surface-input)] p-1.5 font-mono text-xs text-[var(--text-primary)]"
            data-testid={`guidance-strategy-${idx}`}
          >
            <option value={entry.strategy}>{entry.strategy}</option>
            {available.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            max={100}
            value={entry.percent}
            onChange={(e) => updateEntry(idx, 'percent', parseInt(e.target.value, 10) || 0)}
            className="w-20 rounded-book border border-[var(--border-default)] bg-[var(--surface-input)] p-1.5 font-mono text-xs text-[var(--text-primary)] text-right"
            data-testid={`guidance-percent-${idx}`}
          />
          <span className="font-ui text-xs text-[var(--text-muted)]">%</span>
          <button
            type="button"
            onClick={() => removeEntry(idx)}
            className="font-ui text-xs text-[var(--status-error)] hover:underline"
            data-testid={`guidance-remove-${idx}`}
          >
            Remove
          </button>
        </div>
      ))}
      {available.length > 0 && (
        <button
          type="button"
          onClick={addEntry}
          className="font-ui text-xs text-[var(--accent-gold)] hover:underline"
          data-testid="guidance-add"
        >
          + Add strategy
        </button>
      )}
      <div className={`font-ui text-xs ${total === 100 ? 'text-[var(--status-success)]' : total > 0 ? 'text-[var(--status-error)]' : 'text-[var(--text-muted)]'}`} data-testid="guidance-total">
        Total: {total}%{total > 0 && total !== 100 ? ' (must equal 100%)' : ''}
      </div>
    </div>
  );
}

const createFields: FieldDef[] = [
  { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Strategy name' },
  { name: 'description', label: 'Description', type: 'textarea', placeholder: 'Optional description' },
  { name: 'generationModel', label: 'Generation Model', type: 'select', required: true, options: [{ label: 'Select a model...', value: '' }, ...MODEL_OPTIONS.map(m => ({ label: m, value: m }))] },
  { name: 'judgeModel', label: 'Judge Model', type: 'select', required: true, options: [{ label: 'Select a model...', value: '' }, ...MODEL_OPTIONS.map(m => ({ label: m, value: m }))] },
  { name: 'iterations', label: 'Iterations', type: 'number', required: true },
  {
    name: 'generationGuidance',
    label: 'Generation Guidance (optional)',
    type: 'custom',
    render: (value, onChange) => <GenerationGuidanceField value={value} onChange={onChange} />,
  },
  { name: 'maxVariantsToGenerateFromSeedArticle', label: 'Max Variants to Generate', type: 'number', placeholder: '9 (default)' },
  { name: 'maxComparisonsPerVariant', label: 'Max Comparisons per Variant', type: 'number', placeholder: '15 (default)' },
  { name: 'budgetBufferAfterParallel', label: 'Budget Buffer After Parallel (0-1)', type: 'number', placeholder: '0 (default)' },
  { name: 'budgetBufferAfterSequential', label: 'Budget Buffer After Sequential (0-1)', type: 'number', placeholder: '0 (default)' },
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
        generationGuidance: (dialog.row.config as Record<string, unknown>)?.generationGuidance ?? [],
      }
    : {};

  const handleFormSubmit = async (values: Record<string, unknown>) => {
    if (dialog.kind === 'create') {
      const guidance = Array.isArray(values.generationGuidance) && (values.generationGuidance as GuidanceEntry[]).length > 0
        ? (values.generationGuidance as GuidanceEntry[])
        : undefined;
      const result = await createStrategyAction({
        name: values.name as string,
        description: values.description as string,
        generationModel: values.generationModel as string,
        judgeModel: values.judgeModel as string,
        iterations: values.iterations as number,
        generationGuidance: guidance,
        maxVariantsToGenerateFromSeedArticle: values.maxVariantsToGenerateFromSeedArticle ? Number(values.maxVariantsToGenerateFromSeedArticle) : undefined,
        maxComparisonsPerVariant: values.maxComparisonsPerVariant ? Number(values.maxComparisonsPerVariant) : undefined,
        budgetBufferAfterParallel: values.budgetBufferAfterParallel ? Number(values.budgetBufferAfterParallel) : undefined,
        budgetBufferAfterSequential: values.budgetBufferAfterSequential ? Number(values.budgetBufferAfterSequential) : undefined,
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
        validate: (values) => {
          const guidance = values.generationGuidance as GuidanceEntry[] | undefined;
          if (guidance && guidance.length > 0) {
            const total = guidance.reduce((sum, e) => sum + (e.percent || 0), 0);
            if (total !== 100) return `Generation guidance percentages must sum to 100% (currently ${total}%)`;
          }
          return null;
        },
      } : undefined}
      confirmDialog={confirmOpen ? {
        open: true,
        onClose: close,
        ...getConfirmProps(),
      } : undefined}
    />
  );
}
