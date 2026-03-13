// Strategy Registry admin page. Provides CRUD management for evolution strategy configs
// with preset-based creation, inline editing, cloning, archiving, and performance stats.

'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { logger } from '@/lib/client_utilities';
import { toast } from 'sonner';
import { MODEL_OPTIONS } from '@/lib/utils/modelOptions';
import { EvolutionBreadcrumb, TableSkeleton, EmptyState } from '@evolution/components/evolution';
import {
  getStrategiesAction,
  getStrategyPresetsAction,
  createStrategyAction,
  updateStrategyAction,
  cloneStrategyAction,
  archiveStrategyAction,
  unarchiveStrategyAction,
  deleteStrategyAction,
  type StrategyPreset,
} from '@evolution/services/strategyRegistryActions';
import type { StrategyConfigRow } from '@evolution/lib/core/strategyConfig';
import type { PipelineType } from '@evolution/lib/types';
import { getStrategiesPeakStatsAction, type StrategyPeakStats } from '@evolution/services/eloBudgetActions';
import Link from 'next/link';
import { buildStrategyUrl } from '@evolution/lib/utils/evolutionUrls';
import { formToConfig, rowToForm, type FormState } from './strategyFormUtils';
import {
  REQUIRED_AGENTS,
  OPTIONAL_AGENTS,
  validateAgentSelection,
} from '@evolution/lib/core/budgetRedistribution';
import { toggleAgent as toggleAgentUtil } from '@evolution/lib/core/agentToggle';
import type { AgentName } from '@evolution/lib/types';

type StatusFilter = 'all' | 'active' | 'archived';
type CreatedByFilter = 'all' | 'system' | 'admin' | 'experiment' | 'batch';

const DEFAULT_ENABLED_AGENTS = [...OPTIONAL_AGENTS] as string[];

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  generationModel: 'deepseek-chat',
  judgeModel: 'gpt-4.1-nano',
  iterations: 50,
  enabledAgents: DEFAULT_ENABLED_AGENTS,
  singleArticle: false,
  budgetCapUsd: 0.50,
};

const AGENT_LABELS: Record<string, string> = {
  generation: 'Generation',
  calibration: 'Calibration',
  tournament: 'Tournament',
  ranking: 'Ranking',
  proximity: 'Proximity',
  reflection: 'Reflection',
  iterativeEditing: 'Iterative Editing',
  treeSearch: 'Tree Search',
  sectionDecomposition: 'Section Decomposition',
  debate: 'Debate',
  evolution: 'Evolution',
  outlineGeneration: 'Outline Generation',
  metaReview: 'Meta Review',
  flowCritique: 'Flow Critique',
};


const PIPELINE_OPTIONS: PipelineType[] = ['full', 'minimal', 'batch', 'single'];

function eloPerDollarColor(value: number | null): string {
  const v = value ?? 0;
  if (v > 200) return 'text-[var(--status-success)]';
  if (v > 100) return 'text-[var(--accent-gold)]';
  return 'text-[var(--text-secondary)]';
}


function StatusBadge({ status }: { status: 'active' | 'archived' }): JSX.Element {
  const color = status === 'active'
    ? 'bg-[var(--status-success)]/20 text-[var(--status-success)]'
    : 'bg-[var(--text-muted)]/20 text-[var(--text-muted)]';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-page text-xs font-ui font-medium ${color}`}>
      {status}
    </span>
  );
}

function PipelineBadge({ type }: { type: string | null }): JSX.Element {
  if (!type) return <span className="text-[var(--text-muted)] text-xs">--</span>;
  return (
    <span className="inline-block px-2 py-0.5 rounded-page text-xs font-ui font-medium bg-[var(--surface-elevated)] text-[var(--text-secondary)]">
      {type}
    </span>
  );
}

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
}): JSX.Element {
  const [form, setForm] = useState<FormState>(initial);
  const [submitting, setSubmitting] = useState(false);

  const applyPreset = (preset: StrategyPreset) => {
    setForm({
      name: preset.name,
      description: preset.description,
      generationModel: preset.config.generationModel,
      judgeModel: preset.config.judgeModel,
      iterations: preset.config.iterations,
      enabledAgents: preset.config.enabledAgents
        ? [...preset.config.enabledAgents] as string[]
        : DEFAULT_ENABLED_AGENTS,
      singleArticle: preset.config.singleArticle ?? false,
      budgetCapUsd: preset.config.budgetCapUsd ?? 0.50,
    });
  };

  const toggleAgent = (agent: string) => {
    setForm((prev) => ({
      ...prev,
      enabledAgents: toggleAgentUtil(prev.enabledAgents, agent),
    }));
  };

  const agentErrors = useMemo(
    () => validateAgentSelection(form.enabledAgents as AgentName[]),
    [form.enabledAgents],
  );

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

        <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] font-ui cursor-pointer">
          <input
            type="checkbox"
            checked={form.singleArticle}
            onChange={(e) => setForm({ ...form, singleArticle: e.target.checked })}
            className="rounded-page"
            data-testid="strategy-single-article"
          />
          Single-article mode
          <span className="text-xs text-[var(--text-muted)]">(disables generation/outline/evolution)</span>
        </label>

        <div className="space-y-2">
          <label className={labelClass}>Agent Selection</label>

          <div>
            <div className="text-xs text-[var(--text-muted)] font-ui mb-1">Required (always enabled)</div>
            <div className="flex flex-wrap gap-2">
              {REQUIRED_AGENTS.map((agent) => (
                <label key={agent} className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] font-ui opacity-60">
                  <input type="checkbox" checked disabled className="rounded-page" />
                  {AGENT_LABELS[agent] ?? agent}
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs text-[var(--text-muted)] font-ui mb-1">Optional</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {OPTIONAL_AGENTS.map((agent) => {
                const isDisabledBySingleArticle =
                  form.singleArticle &&
                  ['generation', 'outlineGeneration', 'evolution'].includes(agent);
                return (
                  <label
                    key={agent}
                    className={`flex items-center gap-1.5 text-xs font-ui cursor-pointer ${
                      isDisabledBySingleArticle
                        ? 'text-[var(--text-muted)] opacity-50'
                        : 'text-[var(--text-secondary)]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={form.enabledAgents.includes(agent) && !isDisabledBySingleArticle}
                      disabled={isDisabledBySingleArticle}
                      onChange={() => toggleAgent(agent)}
                      className="rounded-page"
                      data-testid={`agent-toggle-${agent}`}
                    />
                    {AGENT_LABELS[agent] ?? agent}
                  </label>
                );
              })}
            </div>
          </div>

          {agentErrors.length > 0 && (
            <div className="text-xs text-[var(--status-error)] font-ui space-y-0.5" data-testid="agent-errors">
              {agentErrors.map((err) => (
                <div key={err}>{err}</div>
              ))}
            </div>
          )}

        </div>

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

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Iterations</label>
            <input
              type="number"
              min={1}
              max={100}
              value={form.iterations}
              onChange={(e) => setForm({ ...form, iterations: Number(e.target.value) || 1 })}
              className={inputClass}
              data-testid="strategy-iterations-input"
            />
          </div>
          <div>
            <label className={labelClass}>Budget Cap (USD)</label>
            <input
              type="number"
              min={0.01}
              max={1.00}
              step={0.01}
              value={form.budgetCapUsd}
              onChange={(e) => setForm({ ...form, budgetCapUsd: Number(e.target.value) || 0.01 })}
              className={inputClass}
              data-testid="strategy-budget-input"
            />
          </div>
        </div>

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
            {submitting
              ? 'Saving...'
              : mode === 'create'
                ? 'Create'
                : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CloneDialog({
  sourceName,
  onSubmit,
  onClose,
}: {
  sourceName: string;
  onSubmit: (name: string, description: string) => Promise<void>;
  onClose: () => void;
}): JSX.Element {
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

export default function StrategyRegistryPage(): JSX.Element {
  const [strategies, setStrategies] = useState<StrategyConfigRow[]>([]);
  const [presets, setPresets] = useState<StrategyPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [createdByFilter, setCreatedByFilter] = useState<CreatedByFilter>('all');
  const [pipelineFilter, setPipelineFilter] = useState<PipelineType | 'all'>('all');

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editTarget, setEditTarget] = useState<StrategyConfigRow | null>(null);
  const [cloneTarget, setCloneTarget] = useState<StrategyConfigRow | null>(null);

  const [peakStatsMap, setPeakStatsMap] = useState<Map<string, StrategyPeakStats>>(new Map());

  const [sortField, setSortField] = useState<'name' | 'run_count' | 'avg_final_elo' | 'avg_elo_per_dollar'>('run_count');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const filters = {
        status: statusFilter as 'active' | 'archived' | 'all',
        createdBy: createdByFilter !== 'all' ? [createdByFilter] : undefined,
        pipelineType: pipelineFilter !== 'all' ? pipelineFilter : undefined,
      };

      const [strategiesRes, presetsRes] = await Promise.all([
        getStrategiesAction(filters),
        getStrategyPresetsAction(),
      ]);

      if (strategiesRes.success && strategiesRes.data) {
        setStrategies(strategiesRes.data);
        // Load peak stats for strategies with runs
        const withRuns = strategiesRes.data.filter(s => s.run_count > 0).map(s => s.id);
        if (withRuns.length > 0) {
          getStrategiesPeakStatsAction(withRuns).then(res => {
            if (res.success && res.data) {
              setPeakStatsMap(new Map(res.data.map(s => [s.strategyId, s])));
            }
          });
        }
      } else {
        setError(strategiesRes.error?.message || 'Failed to load strategies');
      }

      if (presetsRes.success && presetsRes.data) {
        setPresets(presetsRes.data);
      }

    } catch (err) {
      const msg = String(err);
      setError(msg);
      logger.error('Failed to load strategy data', { error: msg });
      toast.error('Failed to load strategy data');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, createdByFilter, pipelineFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

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

  const handleCreate = async (form: FormState) => {
    const result = await createStrategyAction({
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      config: formToConfig(form),
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

  const handleUnarchive = async (strategy: StrategyConfigRow) => {
    setActionLoading(true);
    const result = await unarchiveStrategyAction(strategy.id);
    if (result.success) {
      toast.success(`Strategy "${strategy.name}" restored to active`);
      loadData();
    } else {
      toast.error(result.error?.message || 'Failed to unarchive strategy');
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

  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb items={[
        { label: 'Dashboard', href: '/admin/evolution-dashboard' },
        { label: 'Strategy Registry' },
      ]} />
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

        <div className="flex items-center gap-2">
          <label className="text-sm text-[var(--text-secondary)] font-ui">Origin:</label>
          <select
            value={createdByFilter}
            onChange={(e) => setCreatedByFilter(e.target.value as CreatedByFilter)}
            className="px-2 py-1 border border-[var(--border-default)] rounded-page bg-[var(--surface-input)] text-[var(--text-primary)] font-ui text-sm"
            data-testid="created-by-filter"
          >
            <option value="all">All</option>
            <option value="admin">Admin</option>
            <option value="system">System</option>
            <option value="experiment">Experiment</option>
            <option value="batch">Batch</option>
          </select>
        </div>

        <span className="text-xs text-[var(--text-muted)] font-ui ml-auto">
          {strategies.length} strateg{strategies.length === 1 ? 'y' : 'ies'}
        </span>
      </div>

      {error && (
        <div className="p-3 bg-[var(--status-error)]/10 border border-[var(--status-error)] rounded-page text-[var(--status-error)] font-body text-sm">
          {error}
        </div>
      )}

      <div className="overflow-x-auto border border-[var(--border-default)] rounded-book" data-testid="strategies-table">
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-elevated)]">
            <tr>
              <SortHeader field="name" label="Name" align="left" />
              <th className="p-3 text-left font-ui text-sm text-[var(--text-muted)]">Label</th>
              <th className="p-3 text-left font-ui text-sm text-[var(--text-muted)]">Pipeline</th>
              <SortHeader field="run_count" label="Runs" />
              <SortHeader field="avg_final_elo" label="Avg Rating" />
              <th className="p-3 text-right font-ui text-sm text-[var(--text-muted)]">P90 Elo</th>
              <th className="p-3 text-right font-ui text-sm text-[var(--text-muted)]">Max Elo</th>
              <SortHeader field="avg_elo_per_dollar" label="Rating/$" />
              <th className="p-3 text-center font-ui text-sm text-[var(--text-muted)]">Status</th>
              <th className="p-3 text-left font-ui text-sm text-[var(--text-muted)]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10} className="p-0">
                  <TableSkeleton columns={10} rows={4} />
                </td>
              </tr>
            ) : sortedStrategies.length === 0 ? (
              <tr>
                <td colSpan={10}>
                  <EmptyState message="No strategies found" suggestion="Create a strategy to get started" />
                </td>
              </tr>
            ) : (
              sortedStrategies.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => window.location.href = buildStrategyUrl(s.id)}
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
                        <Link
                          href={buildStrategyUrl(s.id)}
                          className="font-ui font-medium text-[var(--text-primary)] hover:text-[var(--accent-gold)] transition-colors"
                        >
                          {s.name}
                        </Link>
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
                    <td className="p-3 text-right font-mono text-[var(--text-secondary)]">
                      {peakStatsMap.get(s.id)?.bestP90Elo?.toFixed(0) ?? '--'}
                    </td>
                    <td className="p-3 text-right font-mono text-[var(--text-secondary)]">
                      {peakStatsMap.get(s.id)?.bestMaxElo?.toFixed(0) ?? '--'}
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
                        {s.status === 'active' && (
                          <button
                            onClick={() => handleArchive(s)}
                            disabled={actionLoading}
                            className="text-xs font-ui text-[var(--status-warning)] hover:text-[var(--status-error)] disabled:opacity-50"
                            title="Archive"
                          >
                            Archive
                          </button>
                        )}
                        {s.status === 'archived' && (
                          <button
                            onClick={() => handleUnarchive(s)}
                            disabled={actionLoading}
                            className="text-xs font-ui text-[var(--status-success)] hover:text-[var(--text-primary)] disabled:opacity-50"
                            title="Unarchive"
                          >
                            Unarchive
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
              ))
            )}
          </tbody>
        </table>
      </div>

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
          initial={rowToForm(editTarget, DEFAULT_ENABLED_AGENTS)}
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
