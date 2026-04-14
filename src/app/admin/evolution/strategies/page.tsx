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
import { estimateAgentCostPreviewAction } from '@evolution/services/strategyPreviewActions';
import { getBatchMetricsAction } from '@evolution/services/metricsActions';
import { executeEntityAction } from '@evolution/services/entityActions';
import { MODEL_OPTIONS } from '@/lib/utils/modelOptions';
import { DEFAULT_JUDGE_MODEL } from '@/config/modelRegistry';
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

// ─── Budget Floors composite field ───────────────────────────
// Schema has 4 optional fields (fraction vs agentMultiple × parallel vs sequential),
// but exactly one mode is active per strategy. The UI exposes a single mode dropdown
// + two value inputs, and submits only the two fields matching the chosen mode.

type BudgetFloorsValue = {
  mode: 'fraction' | 'agentMultiple';
  parallelValue: number | null;
  sequentialValue: number | null;
};

function BudgetFloorsField({
  value,
  onChange,
  generationModel,
  judgeModel,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  generationModel?: string;
  judgeModel?: string;
}): JSX.Element {
  const v = (value as BudgetFloorsValue | undefined) ?? { mode: 'fraction', parallelValue: null, sequentialValue: null };
  const [preview, setPreview] = useState<{ estimatedAgentCostUsd: number; assumptions: { seedArticleChars: number; strategy: string; comparisonsUsed: number } } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Debounced preview fetch when in agentMultiple mode and models are set.
  useEffect(() => {
    if (v.mode !== 'agentMultiple' || !generationModel || !judgeModel) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    const requestId = ++previewRequestCounter;
    const timer = setTimeout(async () => {
      try {
        const result = await estimateAgentCostPreviewAction({
          generationModel,
          judgeModel,
        });
        // Discard out-of-order responses (race condition guard)
        if (requestId !== previewRequestCounter) return;
        if (result.success && result.data) {
          setPreview(result.data);
          setPreviewError(null);
        } else if (!result.success) {
          setPreview(null);
          setPreviewError(result.error?.message ?? 'Preview request failed');
        }
      } catch (err) {
        if (requestId !== previewRequestCounter) return;
        setPreview(null);
        setPreviewError(err instanceof Error ? err.message : String(err));
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [v.mode, generationModel, judgeModel]);

  const update = (patch: Partial<BudgetFloorsValue>) => onChange({ ...v, ...patch });

  const handleModeChange = (newMode: 'fraction' | 'agentMultiple') => {
    if (newMode === v.mode) return;
    // Clear values — a fraction value is not the same as an agentMultiple value
    onChange({ mode: newMode, parallelValue: null, sequentialValue: null });
  };

  const parseNum = (s: string): number | null => {
    if (s === '') return null;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  };

  const fmtCost = (c: number) => `$${c.toFixed(4)}`;

  const rangeLabel = v.mode === 'fraction' ? '(0-1)' : '(≥ 0)';
  const step = v.mode === 'fraction' ? 0.05 : 0.5;

  // Cross-field error: sequential > parallel
  const orderingError =
    v.parallelValue != null && v.sequentialValue != null && v.parallelValue < v.sequentialValue
      ? `Sequential floor (${v.sequentialValue}) must be ≤ parallel floor (${v.parallelValue})`
      : null;

  const floorForParallel =
    v.mode === 'agentMultiple' && preview != null && v.parallelValue != null
      ? preview.estimatedAgentCostUsd * v.parallelValue
      : null;
  const floorForSequential =
    v.mode === 'agentMultiple' && preview != null && v.sequentialValue != null
      ? preview.estimatedAgentCostUsd * v.sequentialValue
      : null;

  return (
    <div className="space-y-3" data-testid="budget-floors-field">
      <select
        value={v.mode}
        onChange={(e) => handleModeChange(e.target.value as 'fraction' | 'agentMultiple')}
        className="w-full rounded-book border border-[var(--border-default)] bg-[var(--surface-input)] p-2 font-ui text-sm text-[var(--text-primary)]"
        data-testid="budget-floors-mode"
      >
        <option value="fraction">Fraction of budget</option>
        <option value="agentMultiple">Multiple of agent cost</option>
      </select>

      {v.mode === 'agentMultiple' && (
        <div className="rounded-book border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-2 font-ui text-xs text-[var(--text-muted)]" data-testid="budget-floors-preview">
          {preview ? (
            <>
              Estimated cost per generateFromSeedArticle: {fmtCost(preview.estimatedAgentCostUsd)}
              <div className="mt-1 font-mono">
                Based on: {preview.assumptions.seedArticleChars.toLocaleString()}-char seed • {preview.assumptions.strategy} strategy • {preview.assumptions.comparisonsUsed} ranking comparisons
              </div>
            </>
          ) : previewError ? (
            <span className="text-[var(--status-error)]" data-testid="budget-floors-preview-error">
              Cost preview failed: {previewError}
            </span>
          ) : generationModel && judgeModel ? (
            <span>Loading cost estimate…</span>
          ) : (
            <span>Select generation and judge models to see cost preview</span>
          )}
        </div>
      )}

      <div>
        <label className="block font-ui text-xs text-[var(--text-secondary)]">
          Min budget after parallel {rangeLabel}
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={v.mode === 'fraction' ? 1 : undefined}
            step={step}
            value={v.parallelValue ?? ''}
            onChange={(e) => update({ parallelValue: parseNum(e.target.value) })}
            className="w-32 rounded-book border border-[var(--border-default)] bg-[var(--surface-input)] p-1.5 font-mono text-xs text-[var(--text-primary)]"
            data-testid="budget-floors-parallel"
          />
          {floorForParallel != null && (
            <span className="font-mono text-xs text-[var(--text-muted)]">= ~{fmtCost(floorForParallel)} floor</span>
          )}
        </div>
      </div>

      <div>
        <label className="block font-ui text-xs text-[var(--text-secondary)]">
          Min budget after sequential {rangeLabel}
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={v.mode === 'fraction' ? 1 : undefined}
            step={step}
            value={v.sequentialValue ?? ''}
            onChange={(e) => update({ sequentialValue: parseNum(e.target.value) })}
            className="w-32 rounded-book border border-[var(--border-default)] bg-[var(--surface-input)] p-1.5 font-mono text-xs text-[var(--text-primary)]"
            data-testid="budget-floors-sequential"
          />
          {floorForSequential != null && (
            <span className="font-mono text-xs text-[var(--text-muted)]">
              = ~{fmtCost(floorForSequential)} floor <span className="italic">(adjusts at runtime)</span>
            </span>
          )}
        </div>
      </div>

      {orderingError && (
        <div className="font-ui text-xs text-[var(--status-error)]" data-testid="budget-floors-error">
          {orderingError}
        </div>
      )}
    </div>
  );
}

// Counter for debounced preview requests — last-wins via ID check.
let previewRequestCounter = 0;

/** Build the create/edit fields array, capturing current form values so the
 *  composite Budget Floors field can show a live cost preview. */
function buildCreateFields(formValues: Record<string, unknown>): FieldDef[] {
  const generationModel = (formValues.generationModel as string) || undefined;
  const judgeModel = (formValues.judgeModel as string) || undefined;

  return [
    { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Strategy name' },
    { name: 'description', label: 'Description', type: 'textarea', placeholder: 'Optional description' },
    { name: 'generationModel', label: 'Generation Model', type: 'select', required: true, options: [{ label: 'Select a model...', value: '' }, ...MODEL_OPTIONS] },
    { name: 'judgeModel', label: 'Judge Model', type: 'select', required: true, options: [{ label: 'Select a model...', value: '' }, ...MODEL_OPTIONS] },
    { name: 'iterations', label: 'Iterations', type: 'number', required: true },
    {
      name: 'generationGuidance',
      label: 'Generation Guidance (optional)',
      type: 'custom',
      render: (value, onChange) => <GenerationGuidanceField value={value} onChange={onChange} />,
    },
    { name: 'maxVariantsToGenerateFromSeedArticle', label: 'Max Variants to Generate', type: 'number', placeholder: '9 (default)' },
    { name: 'maxComparisonsPerVariant', label: 'Max Comparisons per Variant', type: 'number', placeholder: '15 (default)' },
    {
      name: 'budgetFloors',
      label: 'Budget Floors',
      type: 'custom',
      render: (value, onChange) => (
        <BudgetFloorsField
          value={value}
          onChange={onChange}
          generationModel={generationModel}
          judgeModel={judgeModel}
        />
      ),
    },
    { name: 'generationTemperature', label: 'Generation Temperature (0-2)', type: 'number', placeholder: 'Provider default' },
  ];
}

type DialogState =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'edit'; row: StrategyListItem }
  | { kind: 'clone'; row: StrategyListItem }
  | { kind: 'delete'; row: StrategyListItem };

/** Derive the composite budgetFloors form value from a loaded StrategyConfig. */
function deriveBudgetFloorsFormValue(config: Record<string, unknown> | undefined): BudgetFloorsValue {
  if (!config) return { mode: 'fraction', parallelValue: null, sequentialValue: null };
  const pF = config.minBudgetAfterParallelFraction as number | undefined;
  const pM = config.minBudgetAfterParallelAgentMultiple as number | undefined;
  const sF = config.minBudgetAfterSequentialFraction as number | undefined;
  const sM = config.minBudgetAfterSequentialAgentMultiple as number | undefined;
  if (pM != null || sM != null) {
    return { mode: 'agentMultiple', parallelValue: pM ?? null, sequentialValue: sM ?? null };
  }
  return { mode: 'fraction', parallelValue: pF ?? null, sequentialValue: sF ?? null };
}

/** Expand composite form value into the 2-of-4 schema fields matching the chosen mode. */
function expandBudgetFloorsToConfig(v: BudgetFloorsValue | undefined): {
  minBudgetAfterParallelFraction?: number;
  minBudgetAfterParallelAgentMultiple?: number;
  minBudgetAfterSequentialFraction?: number;
  minBudgetAfterSequentialAgentMultiple?: number;
} {
  if (!v) return {};
  if (v.mode === 'fraction') {
    return {
      minBudgetAfterParallelFraction: v.parallelValue ?? undefined,
      minBudgetAfterSequentialFraction: v.sequentialValue ?? undefined,
    };
  }
  return {
    minBudgetAfterParallelAgentMultiple: v.parallelValue ?? undefined,
    minBudgetAfterSequentialAgentMultiple: v.sequentialValue ?? undefined,
  };
}

export default function StrategiesPage(): JSX.Element {
  useEffect(() => { document.title = 'Strategies | Evolution'; }, []);
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});

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
        maxVariantsToGenerateFromSeedArticle: (dialog.row.config as Record<string, unknown>)?.maxVariantsToGenerateFromSeedArticle,
        maxComparisonsPerVariant: (dialog.row.config as Record<string, unknown>)?.maxComparisonsPerVariant,
        budgetFloors: deriveBudgetFloorsFormValue(dialog.row.config as Record<string, unknown> | undefined),
        generationTemperature: (dialog.row.config as Record<string, unknown>)?.generationTemperature,
      }
    : { judgeModel: DEFAULT_JUDGE_MODEL, budgetFloors: { mode: 'fraction', parallelValue: null, sequentialValue: null } };

  const handleFormSubmit = async (values: Record<string, unknown>) => {
    const budgetFloorFields = expandBudgetFloorsToConfig(values.budgetFloors as BudgetFloorsValue | undefined);

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
        ...budgetFloorFields,
        generationTemperature: values.generationTemperature ? Number(values.generationTemperature) : undefined,
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
        fields: buildCreateFields(formValues),
        initial: formInitial,
        onSubmit: handleFormSubmit,
        onFormChange: setFormValues,
        validate: (values) => {
          const guidance = values.generationGuidance as GuidanceEntry[] | undefined;
          if (guidance && guidance.length > 0) {
            const total = guidance.reduce((sum, e) => sum + (e.percent || 0), 0);
            if (total !== 100) return `Generation guidance percentages must sum to 100% (currently ${total}%)`;
          }
          // Budget floors ordering guard
          const bf = values.budgetFloors as BudgetFloorsValue | undefined;
          if (bf && bf.parallelValue != null && bf.sequentialValue != null && bf.parallelValue < bf.sequentialValue) {
            return `Sequential floor (${bf.sequentialValue}) must be ≤ parallel floor (${bf.parallelValue})`;
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
