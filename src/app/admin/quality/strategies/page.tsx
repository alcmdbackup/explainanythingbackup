'use client';
// Strategy Registry admin page. Provides CRUD management for evolution strategy configs
// with preset-based creation, inline editing, cloning, archiving, and performance stats.

import { Fragment, useState, useCallback, useEffect, useMemo } from 'react';
import { logger } from '@/lib/client_utilities';
import { toast } from 'sonner';
import {
  getStrategiesAction,
  getStrategyPresetsAction,
  createStrategyAction,
  updateStrategyAction,
  cloneStrategyAction,
  archiveStrategyAction,
  deleteStrategyAction,
  type StrategyPreset,
} from '@/lib/services/strategyRegistryActions';
import type { StrategyConfigRow, StrategyConfig } from '@/lib/evolution/core/strategyConfig';
import type { PipelineType } from '@/lib/evolution/types';
import { getStrategyAccuracyAction, type StrategyAccuracyStats } from '@/lib/services/costAnalyticsActions';

// ─── Types ───────────────────────────────────────────────────────

type StatusFilter = 'all' | 'active' | 'archived';

interface FormState {
  name: string;
  description: string;
  pipelineType: PipelineType;
  generationModel: string;
  judgeModel: string;
  iterations: number;
  budgetCap: number;
}

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  pipelineType: 'full',
  generationModel: 'deepseek-chat',
  judgeModel: 'gpt-4.1-nano',
  iterations: 3,
  budgetCap: 0.20,
};

const MODEL_OPTIONS = [
  'deepseek-chat',
  'gpt-4.1-nano',
  'gpt-4.1-mini',
  'gpt-4.1',
  'gpt-4o',
  'o3-mini',
  'claude-sonnet-4-20250514',
];

const PIPELINE_OPTIONS: PipelineType[] = ['full', 'minimal', 'batch'];

/** Return a Tailwind color class based on Elo/$ efficiency tier */
function eloPerDollarColor(value: number | null): string {
  const v = value ?? 0;
  if (v > 200) return 'text-[var(--status-success)]';
  if (v > 100) return 'text-[var(--accent-gold)]';
  return 'text-[var(--text-secondary)]';
}

// ─── Status badge ────────────────────────────────────────────────

function StatusBadge({ status }: { status: 'active' | 'archived' }) {
  const color =
    status === 'active'
      ? 'bg-[var(--status-success)]/20 text-[var(--status-success)]'
      : 'bg-[var(--text-muted)]/20 text-[var(--text-muted)]';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-page text-xs font-ui font-medium ${color}`}>
      {status}
    </span>
  );
}

function PipelineBadge({ type }: { type: string | null }) {
  if (!type) return <span className="text-[var(--text-muted)] text-xs">--</span>;
  return (
    <span className="inline-block px-2 py-0.5 rounded-page text-xs font-ui font-medium bg-[var(--surface-elevated)] text-[var(--text-secondary)]">
      {type}
    </span>
  );
}

// ─── Create/Edit dialog ──────────────────────────────────────────

function StrategyDialog({
  mode,
  initial,
  presets,
  onSubmit,
  onClose,
}: {
  mode: 'create' | 'edit';
  initial: FormState;
  presets: StrategyPreset[];
  onSubmit: (form: FormState) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const [submitting, setSubmitting] = useState(false);

  const applyPreset = (preset: StrategyPreset) => {
    setForm({
      name: preset.name,
      description: preset.description,
      pipelineType: preset.pipelineType,
      generationModel: preset.config.generationModel,
      judgeModel: preset.config.judgeModel,
      iterations: preset.config.iterations,
      budgetCap: preset.config.budgetCaps.generation ?? 0.20,
    });
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error('Name is required');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(form);
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full px-3 py-2 border border-[var(--border-default)] rounded-page bg-[var(--surface-input)] text-[var(--text-primary)] font-ui text-sm';
  const labelClass = 'block text-sm text-[var(--text-secondary)] font-ui mb-1';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div
        className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book shadow-warm-lg p-6 w-[520px] max-h-[85vh] overflow-y-auto space-y-4"
        role="dialog"
        aria-label={mode === 'create' ? 'Create strategy' : 'Edit strategy'}
      >
        <h2 className="text-2xl font-display font-semibold text-[var(--text-primary)]">
          {mode === 'create' ? 'Create Strategy' : 'Edit Strategy'}
        </h2>

        {/* Preset selector (create only) */}
        {mode === 'create' && presets.length > 0 && (
          <div>
            <label className={labelClass}>Start from preset</label>
            <div className="flex gap-2">
              {presets.map((p) => (
                <button
                  key={p.name}
                  onClick={() => applyPreset(p)}
                  className={`px-3 py-1.5 text-sm font-ui rounded-page border transition-colors ${
                    form.name === p.name
                      ? 'border-[var(--accent-gold)] bg-[var(--accent-gold)]/10 text-[var(--accent-gold)]'
                      : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]'
                  }`}
                >
                  {p.name}
                </button>
              ))}
              <button
                onClick={() => setForm(EMPTY_FORM)}
                className={`px-3 py-1.5 text-sm font-ui rounded-page border transition-colors ${
                  !presets.some((p) => p.name === form.name)
                    ? 'border-[var(--accent-gold)] bg-[var(--accent-gold)]/10 text-[var(--accent-gold)]'
                    : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]'
                }`}
              >
                Blank
              </button>
            </div>
          </div>
        )}

        {/* Name */}
        <div>
          <label className={labelClass}>Name</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className={inputClass}
            placeholder="e.g. Budget Explorer"
            data-testid="strategy-name-input"
          />
        </div>

        {/* Description */}
        <div>
          <label className={labelClass}>Description</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className={`${inputClass} min-h-[60px]`}
            placeholder="Optional description of this strategy's purpose"
            data-testid="strategy-description-input"
          />
        </div>

        {/* Pipeline type */}
        <div>
          <label className={labelClass}>Pipeline Type</label>
          <select
            value={form.pipelineType}
            onChange={(e) => setForm({ ...form, pipelineType: e.target.value as PipelineType })}
            className={inputClass}
            data-testid="strategy-pipeline-select"
          >
            {PIPELINE_OPTIONS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        {/* Model selectors side by side */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Generation Model</label>
            <select
              value={form.generationModel}
              onChange={(e) => setForm({ ...form, generationModel: e.target.value })}
              className={inputClass}
              data-testid="strategy-gen-model-select"
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Judge Model</label>
            <select
              value={form.judgeModel}
              onChange={(e) => setForm({ ...form, judgeModel: e.target.value })}
              className={inputClass}
              data-testid="strategy-judge-model-select"
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Iterations and budget cap side by side */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Iterations</label>
            <input
              type="number"
              min={1}
              max={50}
              value={form.iterations}
              onChange={(e) => setForm({ ...form, iterations: Number(e.target.value) || 1 })}
              className={inputClass}
              data-testid="strategy-iterations-input"
            />
          </div>
          <div>
            <label className={labelClass}>Budget Cap (generation %)</label>
            <input
              type="number"
              min={0.01}
              max={1}
              step={0.01}
              value={form.budgetCap}
              onChange={(e) => setForm({ ...form, budgetCap: Number(e.target.value) || 0.20 })}
              className={inputClass}
              data-testid="strategy-budget-input"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 border border-[var(--border-default)] rounded-page text-[var(--text-secondary)] font-ui text-sm hover:bg-[var(--surface-secondary)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            data-testid="strategy-submit-btn"
            className="px-4 py-2 bg-[var(--accent-gold)] text-[var(--surface-primary)] rounded-page font-ui text-sm hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Saving...' : mode === 'create' ? 'Create' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Clone dialog ────────────────────────────────────────────────

function CloneDialog({
  sourceName,
  onSubmit,
  onClose,
}: {
  sourceName: string;
  onSubmit: (name: string, description: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(`${sourceName} (Copy)`);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(name.trim(), description.trim());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div
        className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book shadow-warm-lg p-6 w-96 space-y-4"
        role="dialog"
        aria-label="Clone strategy"
      >
        <h2 className="text-2xl font-display font-semibold text-[var(--text-primary)]">
          Clone Strategy
        </h2>
        <p className="text-sm text-[var(--text-muted)] font-body">
          Create a copy of &ldquo;{sourceName}&rdquo; with a new name.
        </p>
        <div>
          <label className="block text-sm text-[var(--text-secondary)] font-ui mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border border-[var(--border-default)] rounded-page bg-[var(--surface-input)] text-[var(--text-primary)] font-ui text-sm"
            data-testid="clone-name-input"
          />
        </div>
        <div>
          <label className="block text-sm text-[var(--text-secondary)] font-ui mb-1">Description (optional)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 border border-[var(--border-default)] rounded-page bg-[var(--surface-input)] text-[var(--text-primary)] font-ui text-sm min-h-[60px]"
          />
        </div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 border border-[var(--border-default)] rounded-page text-[var(--text-secondary)] font-ui text-sm hover:bg-[var(--surface-secondary)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            data-testid="clone-submit-btn"
            className="px-4 py-2 bg-[var(--accent-gold)] text-[var(--surface-primary)] rounded-page font-ui text-sm hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Cloning...' : 'Clone'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Detail expansion row ────────────────────────────────────────

function StrategyDetailRow({ strategy, accuracy }: { strategy: StrategyConfigRow; accuracy?: StrategyAccuracyStats }) {
  const config = strategy.config;
  return (
    <tr>
      <td colSpan={8} className="p-4 bg-[var(--surface-elevated)]">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Config JSON */}
          <div>
            <div className="text-sm font-ui font-semibold text-[var(--text-primary)] mb-2" role="heading" aria-level={4}>
              Configuration
            </div>
            <pre className="text-xs font-mono text-[var(--text-secondary)] bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded-page p-3 overflow-x-auto max-h-48">
              {JSON.stringify(config, null, 2)}
            </pre>
            <div className="mt-2 text-xs text-[var(--text-muted)] font-ui">
              Hash: <span className="font-mono">{strategy.config_hash}</span>
            </div>
          </div>

          {/* Performance stats */}
          <div>
            <div className="text-sm font-ui font-semibold text-[var(--text-primary)] mb-2" role="heading" aria-level={4}>
              Performance
            </div>
            <div className="grid grid-cols-2 gap-2">
              <StatCard label="Runs" value={strategy.run_count} />
              <StatCard label="Avg Elo" value={strategy.avg_final_elo?.toFixed(0) ?? '--'} />
              <StatCard label="Elo/$" value={strategy.avg_elo_per_dollar?.toFixed(1) ?? '--'} />
              <StatCard label="Total Cost" value={`$${strategy.total_cost_usd.toFixed(4)}`} />
              <StatCard label="Best Elo" value={strategy.best_final_elo?.toFixed(0) ?? '--'} />
              <StatCard label="Worst Elo" value={strategy.worst_final_elo?.toFixed(0) ?? '--'} />
              <StatCard label="StdDev" value={strategy.stddev_final_elo?.toFixed(1) ?? '--'} />
              <StatCard label="Created by" value={strategy.created_by} />
            </div>
            {accuracy ? (
              <div className="mt-2 text-xs text-[var(--text-muted)] font-ui" data-testid="accuracy-stats">
                Avg estimation error: <span className={`font-mono font-semibold ${
                  Math.abs(accuracy.avgDeltaPercent) <= 10 ? 'text-[var(--status-success)]'
                    : Math.abs(accuracy.avgDeltaPercent) <= 30 ? 'text-[var(--accent-gold)]'
                      : 'text-[var(--status-error)]'
                }`}>{accuracy.avgDeltaPercent >= 0 ? '+' : ''}{accuracy.avgDeltaPercent}%</span>
                {' '}(±{accuracy.stdDevPercent}%) across {accuracy.runCount} run{accuracy.runCount !== 1 ? 's' : ''}
              </div>
            ) : (
              <div className="mt-2 text-xs text-[var(--text-muted)] font-ui">No estimate data yet</div>
            )}
            <div className="mt-1 text-xs text-[var(--text-muted)] font-ui">
              Created {new Date(strategy.created_at).toLocaleDateString()}
              {strategy.last_used_at && ` | Last used ${new Date(strategy.last_used_at).toLocaleDateString()}`}
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded-page p-2">
      <div className="text-xs text-[var(--text-muted)] font-ui">{label}</div>
      <div className="text-sm font-semibold text-[var(--text-primary)] font-mono">{value}</div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────

export default function StrategyRegistryPage() {
  const [strategies, setStrategies] = useState<StrategyConfigRow[]>([]);
  const [presets, setPresets] = useState<StrategyPreset[]>([]);
  const [accuracyMap, setAccuracyMap] = useState<Map<string, StrategyAccuracyStats>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Filters
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [predefinedOnly, setPredefinedOnly] = useState(false);
  const [pipelineFilter, setPipelineFilter] = useState<PipelineType | 'all'>('all');

  // Dialogs
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editTarget, setEditTarget] = useState<StrategyConfigRow | null>(null);
  const [cloneTarget, setCloneTarget] = useState<StrategyConfigRow | null>(null);

  // Expansion
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Sorting
  const [sortField, setSortField] = useState<'name' | 'run_count' | 'avg_final_elo' | 'avg_elo_per_dollar'>('run_count');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // ─── Data loading ────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const filters: { status?: 'active' | 'archived'; isPredefined?: boolean; pipelineType?: PipelineType } = {};
      if (statusFilter !== 'all') filters.status = statusFilter;
      if (predefinedOnly) filters.isPredefined = true;
      if (pipelineFilter !== 'all') filters.pipelineType = pipelineFilter;

      const [strategiesRes, presetsRes, accuracyRes] = await Promise.all([
        getStrategiesAction(filters),
        getStrategyPresetsAction(),
        getStrategyAccuracyAction(),
      ]);

      if (strategiesRes.success && strategiesRes.data) {
        setStrategies(strategiesRes.data);
      } else {
        setError(strategiesRes.error?.message || 'Failed to load strategies');
      }

      if (presetsRes.success && presetsRes.data) {
        setPresets(presetsRes.data);
      }

      if (accuracyRes.success && accuracyRes.data) {
        setAccuracyMap(new Map(accuracyRes.data.map(a => [a.strategyId, a])));
      }
    } catch (err) {
      const msg = String(err);
      setError(msg);
      logger.error('Failed to load strategy data', { error: msg });
      toast.error('Failed to load strategy data');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, predefinedOnly, pipelineFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ─── Sorting ─────────────────────────────────────────────

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir(field === 'name' ? 'asc' : 'desc');
    }
  };

  const sortedStrategies = useMemo(() => {
    return [...strategies].sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;

      if (sortField === 'name') {
        aVal = a.name.toLowerCase();
        bVal = b.name.toLowerCase();
      } else {
        aVal = a[sortField] ?? 0;
        bVal = b[sortField] ?? 0;
      }

      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [strategies, sortField, sortDir]);

  // ─── Actions ─────────────────────────────────────────────

  const formToConfig = (form: FormState): StrategyConfig => ({
    generationModel: form.generationModel,
    judgeModel: form.judgeModel,
    iterations: form.iterations,
    budgetCaps: {
      generation: form.budgetCap,
      calibration: 0.15,
      tournament: 0.20,
    },
  });

  const handleCreate = async (form: FormState) => {
    const result = await createStrategyAction({
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      config: formToConfig(form),
      pipelineType: form.pipelineType,
    });

    if (result.success) {
      toast.success(`Strategy "${form.name}" created`);
      setShowCreateDialog(false);
      loadData();
    } else {
      toast.error(result.error?.message || 'Failed to create strategy');
    }
  };

  const handleEdit = async (form: FormState) => {
    if (!editTarget) return;
    const result = await updateStrategyAction({
      id: editTarget.id,
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      config: formToConfig(form),
      pipelineType: form.pipelineType,
    });

    if (result.success) {
      toast.success(`Strategy "${form.name}" updated`);
      setEditTarget(null);
      loadData();
    } else {
      toast.error(result.error?.message || 'Failed to update strategy');
    }
  };

  const handleClone = async (name: string, description: string) => {
    if (!cloneTarget) return;
    const result = await cloneStrategyAction({
      sourceId: cloneTarget.id,
      name,
      description: description || undefined,
    });

    if (result.success) {
      toast.success(`Cloned as "${name}"`);
      setCloneTarget(null);
      loadData();
    } else {
      toast.error(result.error?.message || 'Failed to clone strategy');
    }
  };

  const handleArchive = async (strategy: StrategyConfigRow) => {
    if (!confirm(`Archive strategy "${strategy.name}"? It will no longer be available for new runs.`)) return;
    setActionLoading(true);
    const result = await archiveStrategyAction(strategy.id);
    if (result.success) {
      toast.success(`Strategy "${strategy.name}" archived`);
      loadData();
    } else {
      toast.error(result.error?.message || 'Failed to archive strategy');
    }
    setActionLoading(false);
  };

  const handleDelete = async (strategy: StrategyConfigRow) => {
    if (strategy.run_count > 0) {
      toast.error('Cannot delete a strategy with completed runs. Use archive instead.');
      return;
    }
    if (!confirm(`Permanently delete strategy "${strategy.name}"? This cannot be undone.`)) return;
    setActionLoading(true);
    const result = await deleteStrategyAction(strategy.id);
    if (result.success) {
      toast.success(`Strategy "${strategy.name}" deleted`);
      loadData();
    } else {
      toast.error(result.error?.message || 'Failed to delete strategy');
    }
    setActionLoading(false);
  };

  const rowToForm = (row: StrategyConfigRow): FormState => ({
    name: row.name,
    description: row.description ?? '',
    pipelineType: row.pipeline_type ?? 'full',
    generationModel: row.config.generationModel,
    judgeModel: row.config.judgeModel,
    iterations: row.config.iterations,
    budgetCap: row.config.budgetCaps.generation ?? 0.20,
  });

  // ─── Sort header helper ──────────────────────────────────

  const SortHeader = ({
    field,
    label,
    align = 'right',
  }: {
    field: typeof sortField;
    label: string;
    align?: 'left' | 'right';
  }) => (
    <th
      className={`p-3 text-${align} font-ui text-sm text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-primary)] transition-colors`}
      onClick={() => handleSort(field)}
    >
      {label}
      {sortField === field && (
        <span className="ml-1">{sortDir === 'asc' ? '\u2191' : '\u2193'}</span>
      )}
    </th>
  );

  // ─── Render ──────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-4xl font-display font-bold text-[var(--text-primary)]">
            Strategy Registry
          </h1>
          <p className="text-[var(--text-muted)] font-body text-sm mt-1">
            Manage evolution pipeline strategy configurations
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadData}
            disabled={loading}
            className="px-4 py-2 font-ui text-sm border border-[var(--border-default)] rounded-page text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] disabled:opacity-50 transition-scholar"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <button
            onClick={() => setShowCreateDialog(true)}
            data-testid="create-strategy-btn"
            className="px-4 py-2 bg-[var(--accent-gold)] text-[var(--surface-primary)] rounded-page font-ui text-sm hover:opacity-90"
          >
            Create Strategy
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2">
          <label className="text-sm text-[var(--text-secondary)] font-ui">Status:</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="px-2 py-1 border border-[var(--border-default)] rounded-page bg-[var(--surface-input)] text-[var(--text-primary)] font-ui text-sm"
            data-testid="status-filter"
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-[var(--text-secondary)] font-ui">Pipeline:</label>
          <select
            value={pipelineFilter}
            onChange={(e) => setPipelineFilter(e.target.value as PipelineType | 'all')}
            className="px-2 py-1 border border-[var(--border-default)] rounded-page bg-[var(--surface-input)] text-[var(--text-primary)] font-ui text-sm"
            data-testid="pipeline-filter"
          >
            <option value="all">All</option>
            {PIPELINE_OPTIONS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)] font-ui cursor-pointer">
          <input
            type="checkbox"
            checked={predefinedOnly}
            onChange={(e) => setPredefinedOnly(e.target.checked)}
            className="rounded-page"
            data-testid="predefined-filter"
          />
          Predefined only
        </label>

        <span className="text-xs text-[var(--text-muted)] font-ui ml-auto">
          {strategies.length} strateg{strategies.length === 1 ? 'y' : 'ies'}
        </span>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-[var(--status-error)]/10 border border-[var(--status-error)] rounded-page text-[var(--status-error)] font-body text-sm">
          {error}
        </div>
      )}

      {/* Strategies table */}
      <div className="overflow-x-auto border border-[var(--border-default)] rounded-book" data-testid="strategies-table">
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-elevated)]">
            <tr>
              <SortHeader field="name" label="Name" align="left" />
              <th className="p-3 text-left font-ui text-sm text-[var(--text-muted)]">Label</th>
              <th className="p-3 text-left font-ui text-sm text-[var(--text-muted)]">Pipeline</th>
              <SortHeader field="run_count" label="Runs" />
              <SortHeader field="avg_final_elo" label="Avg Elo" />
              <SortHeader field="avg_elo_per_dollar" label="Elo/$" />
              <th className="p-3 text-center font-ui text-sm text-[var(--text-muted)]">Status</th>
              <th className="p-3 text-left font-ui text-sm text-[var(--text-muted)]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="p-8 text-center">
                  <div className="flex items-center justify-center gap-2 text-[var(--text-muted)]">
                    <div className="w-4 h-4 border-2 border-[var(--accent-gold)] border-t-transparent rounded-full animate-spin" />
                    <span className="font-ui">Loading strategies...</span>
                  </div>
                </td>
              </tr>
            ) : sortedStrategies.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-[var(--text-muted)] font-body">
                  No strategies found. Create one to get started.
                </td>
              </tr>
            ) : (
              sortedStrategies.map((s) => (
                <Fragment key={s.id}>
                  <tr
                    onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                    className="border-t border-[var(--border-default)] hover:bg-[var(--surface-secondary)] cursor-pointer transition-colors"
                    data-testid={`strategy-row-${s.id}`}
                  >
                    <td className="p-3">
                      <div className="flex items-center gap-1.5">
                        {s.is_predefined && (
                          <span className="text-[var(--accent-gold)] text-xs" title="Predefined">
                            &#x2605;
                          </span>
                        )}
                        <span className="font-ui font-medium text-[var(--text-primary)]">
                          {s.name}
                        </span>
                      </div>
                      {s.description && (
                        <span className="block text-xs font-body text-[var(--text-muted)] mt-0.5 truncate max-w-xs">
                          {s.description}
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-xs font-ui text-[var(--text-muted)] truncate max-w-[200px]">
                      {s.label}
                    </td>
                    <td className="p-3">
                      <PipelineBadge type={s.pipeline_type} />
                    </td>
                    <td className="p-3 text-right font-mono text-[var(--text-secondary)]">
                      {s.run_count}
                    </td>
                    <td className="p-3 text-right font-mono text-[var(--text-primary)]">
                      {s.avg_final_elo?.toFixed(0) ?? '--'}
                    </td>
                    <td className="p-3 text-right">
                      <span className={`font-mono ${eloPerDollarColor(s.avg_elo_per_dollar)}`}>
                        {s.avg_elo_per_dollar?.toFixed(1) ?? '--'}
                      </span>
                    </td>
                    <td className="p-3 text-center">
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="p-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1.5">
                        {s.is_predefined && s.status === 'active' && (
                          <button
                            onClick={() => setEditTarget(s)}
                            disabled={actionLoading}
                            className="text-xs font-ui text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
                            title="Edit"
                          >
                            Edit
                          </button>
                        )}
                        <button
                          onClick={() => setCloneTarget(s)}
                          disabled={actionLoading}
                          className="text-xs font-ui text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
                          title="Clone"
                        >
                          Clone
                        </button>
                        {s.is_predefined && s.status === 'active' && (
                          <button
                            onClick={() => handleArchive(s)}
                            disabled={actionLoading}
                            className="text-xs font-ui text-[var(--status-warning)] hover:text-[var(--status-error)] disabled:opacity-50"
                            title="Archive"
                          >
                            Archive
                          </button>
                        )}
                        {s.is_predefined && s.run_count === 0 && (
                          <button
                            onClick={() => handleDelete(s)}
                            disabled={actionLoading}
                            className="text-xs font-ui text-[var(--status-error)] hover:underline disabled:opacity-50"
                            title="Delete"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expandedId === s.id && <StrategyDetailRow strategy={s} accuracy={accuracyMap.get(s.id)} />}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Dialogs */}
      {showCreateDialog && (
        <StrategyDialog
          mode="create"
          initial={EMPTY_FORM}
          presets={presets}
          onSubmit={handleCreate}
          onClose={() => setShowCreateDialog(false)}
        />
      )}

      {editTarget && (
        <StrategyDialog
          mode="edit"
          initial={rowToForm(editTarget)}
          presets={[]}
          onSubmit={handleEdit}
          onClose={() => setEditTarget(null)}
        />
      )}

      {cloneTarget && (
        <CloneDialog
          sourceName={cloneTarget.name}
          onSubmit={handleClone}
          onClose={() => setCloneTarget(null)}
        />
      )}
    </div>
  );
}
