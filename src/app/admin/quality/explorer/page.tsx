'use client';
// Unified Dimensional Explorer page for cross-cutting analysis of evolution runs, articles, and tasks.
// Supports table, matrix, and trend views with multi-dimensional filtering.

import { Fragment, Suspense, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { EvolutionBreadcrumb, TableSkeleton } from '@evolution/components/evolution';
import { logger } from '@/lib/client_utilities';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getPromptsAction } from '@evolution/services/promptRegistryActions';
import { getStrategiesAction } from '@evolution/services/strategyRegistryActions';
import { isTestEntry } from '@evolution/lib/core/configValidation';
import { PIPELINE_TYPES } from '@evolution/lib/types';
import {
  getUnifiedExplorerAction,
  getExplorerMatrixAction,
  getExplorerTrendAction,
  getExplorerArticleDetailAction,
  type ExplorerFilters,
  type UnitOfAnalysis,
  type ExplorerMetric,
  type ExplorerDimension,
  type TimeBucket,
  type ExplorerTableResult,
  type ExplorerMatrixResult,
  type ExplorerTrendResult,
  type ExplorerArticleDetail,
  type ExplorerRunRow,
  type ExplorerArticleRow,
  type ExplorerTaskRow,
} from '@evolution/services/unifiedExplorerActions';

// ─── Dynamic Recharts imports ─────────────────────────────────────

const TrendChart = dynamic(() => import('recharts').then((mod) => {
  const { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, Label } = mod;

  const SERIES_COLORS = [
    'var(--accent-gold)',
    'var(--status-success)',
    'var(--status-error)',
    'var(--status-warning)',
    'var(--accent-copper)',
    'var(--text-secondary)',
    'var(--text-muted)',
  ];

  function Chart({ data, metricLabel }: { data: ExplorerTrendResult; metricLabel?: string }) {
    if (data.series.length === 0) {
      return (
        <div className="h-[300px] flex items-center justify-center text-sm text-[var(--text-muted)] font-body">
          No trend data available
        </div>
      );
    }

    // Build unified data array: each point has date + one key per series
    const dateSet = new Set<string>();
    for (const s of data.series) {
      for (const p of s.points) dateSet.add(p.date);
    }
    const dates = [...dateSet].sort();
    const chartData = dates.map(date => {
      const entry: Record<string, string | number> = { date };
      for (const s of data.series) {
        const point = s.points.find(p => p.date === date);
        entry[s.dimensionLabel] = point?.value ?? 0;
      }
      return entry;
    });

    return (
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={chartData}>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
            tickFormatter={(v: string) => v.slice(5)}
          >
            <Label value="Date" position="insideBottom" offset={-2} fontSize={10} fill="var(--text-muted)" />
          </XAxis>
          <YAxis
            tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
            width={55}
          >
            {metricLabel && <Label value={metricLabel} angle={-90} position="insideLeft" fontSize={10} fill="var(--text-muted)" offset={5} />}
          </YAxis>
          <Tooltip
            contentStyle={{
              background: 'var(--surface-elevated)',
              border: '1px solid var(--border-default)',
              borderRadius: 6,
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {data.series.map((s, i) => (
            <Line
              key={s.dimensionId}
              type="monotone"
              dataKey={s.dimensionLabel}
              stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }
  return Chart;
}), { ssr: false, loading: () => <ChartSkeleton /> });

// ─── Types ───────────────────────────────────────────────────────

type ViewMode = 'table' | 'matrix' | 'trend';

const UNITS: { id: UnitOfAnalysis; label: string }[] = [
  { id: 'run', label: 'Run' },
  { id: 'article', label: 'Article' },
  { id: 'task', label: 'Agents' },
];

const METRICS: { id: ExplorerMetric; label: string }[] = [
  { id: 'avgElo', label: 'Avg Rating' },
  { id: 'totalCost', label: 'Total Cost' },
  { id: 'runCount', label: 'Run Count' },
  { id: 'avgEloDollar', label: 'Rating/Dollar' },
  { id: 'successRate', label: 'Success Rate' },
];

const DIMENSIONS: { id: ExplorerDimension; label: string }[] = [
  { id: 'prompt', label: 'Prompt' },
  { id: 'strategy', label: 'Strategy' },
  { id: 'pipelineType', label: 'Pipeline Type' },
  { id: 'agent', label: 'Agent' },
];

const TIME_BUCKETS: { id: TimeBucket; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
];

const PIPELINE_TYPE_OPTIONS = PIPELINE_TYPES.map(t => ({ id: t, label: t }));

type DatePreset = 'all' | 'last1d' | 'last7d' | 'last30d' | 'custom';

const DATE_PRESETS: { id: DatePreset; label: string }[] = [
  { id: 'all', label: 'All Time' },
  { id: 'last1d', label: 'Last 1 Day' },
  { id: 'last7d', label: 'Last Week' },
  { id: 'last30d', label: 'Last Month' },
  { id: 'custom', label: 'Custom Date Range' },
];

function computeDatePreset(preset: DatePreset): { from: string; to: string } | null {
  if (preset === 'custom' || preset === 'all') return null;
  const to = new Date();
  const from = new Date();
  switch (preset) {
    case 'last1d': from.setDate(from.getDate() - 1); break;
    case 'last7d': from.setDate(from.getDate() - 7); break;
    case 'last30d': from.setDate(from.getDate() - 30); break;
  }
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

// ─── Skeletons and helpers ───────────────────────────────────────

function ChartSkeleton(): JSX.Element {
  return <div className="h-[300px] bg-[var(--surface-secondary)] rounded-book animate-pulse" />;
}


function StatCard({ label, value, loading }: { label: string; value: string; loading: boolean }): JSX.Element {
  return (
    <Card className="bg-[var(--surface-secondary)] paper-texture">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-ui font-medium text-[var(--text-muted)]">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-8 w-24 bg-[var(--surface-elevated)] animate-pulse rounded-page" />
        ) : (
          <div className="text-2xl font-display font-bold text-[var(--text-primary)]">
            {value}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SelectControl({ label, value, onChange, options, className }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { id: string; label: string }[];
  className?: string;
}): JSX.Element {
  return (
    <label className={`flex flex-col gap-1 ${className ?? ''}`}>
      <span className="text-xs font-ui text-[var(--text-muted)]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-1.5 text-sm font-ui bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-gold)]"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

/** Searchable multi-select dropdown. Shows recent items, filterable by label or ID. */
function SearchableMultiSelect({ label, items, selected, onChange, placeholder }: {
  label: string;
  items: { id: string; label: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  placeholder: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const lowerSearch = search.toLowerCase();
  const filtered = search
    ? items.filter(i => i.label.toLowerCase().includes(lowerSearch) || i.id.toLowerCase().includes(lowerSearch))
    : items.slice(0, 5);

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id]);
  };

  const selectedLabels = selected
    .map(id => items.find(i => i.id === id)?.label ?? id.slice(0, 8))
    .join(', ');

  return (
    <div className="flex flex-col gap-1 relative" ref={ref}>
      <span className="text-xs font-ui text-[var(--text-muted)]">{label}</span>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="px-3 py-1.5 text-sm font-ui bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book text-left truncate focus:outline-none focus:ring-1 focus:ring-[var(--accent-gold)]"
        style={{ color: selected.length ? 'var(--text-primary)' : 'var(--text-muted)' }}
      >
        {selected.length ? selectedLabels : placeholder}
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book shadow-warm-lg max-h-56 overflow-hidden flex flex-col">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or ID..."
            autoFocus
            className="px-3 py-2 text-sm font-ui bg-transparent border-b border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
          />
          <div className="overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-[var(--text-muted)]">No matches</div>
            ) : (
              filtered.map(item => {
                const isSelected = selected.includes(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggle(item.id)}
                    className="w-full px-3 py-1.5 text-left text-sm font-ui hover:bg-[var(--surface-secondary)] flex items-center gap-2"
                  >
                    <span
                      className="w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center text-xs"
                      style={{
                        borderColor: isSelected ? 'var(--accent-gold)' : 'var(--border-default)',
                        backgroundColor: isSelected ? 'var(--accent-gold)' : 'transparent',
                        color: isSelected ? 'var(--surface-primary)' : 'transparent',
                      }}
                    >
                      {isSelected ? '✓' : ''}
                    </span>
                    <span className="truncate text-[var(--text-primary)]">{item.label}</span>
                    <span className="ml-auto text-xs font-mono text-[var(--text-muted)] flex-shrink-0">
                      {item.id.slice(0, 8)}
                    </span>
                  </button>
                );
              })
            )}
          </div>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="px-3 py-1.5 text-xs font-ui text-[var(--text-muted)] hover:text-[var(--text-secondary)] border-t border-[var(--border-default)]"
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ButtonGroup<T extends string>({ options, value, onChange }: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}): JSX.Element {
  return (
    <div className="inline-flex border border-[var(--border-default)] rounded-book overflow-hidden">
      {options.map((opt) => (
        <button
          key={opt.id}
          onClick={() => onChange(opt.id)}
          className={`px-4 py-1.5 text-sm font-ui transition-colors ${
            value === opt.id
              ? 'bg-[var(--accent-gold)] text-[var(--surface-primary)]'
              : 'bg-[var(--surface-elevated)] text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Th({ children, className }: { children?: ReactNode; className?: string }): JSX.Element {
  return (
    <th className={`px-3 py-2 text-left text-xs font-ui font-medium text-[var(--text-muted)] uppercase tracking-wide ${className ?? ''}`}>
      {children}
    </th>
  );
}

function Td({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return (
    <td className={`px-3 py-2 text-sm font-body text-[var(--text-primary)] ${className ?? ''}`}>
      {children}
    </td>
  );
}

function formatCost(v: number): string {
  return `$${v.toFixed(4)}`;
}

function formatElo(v: number | null): string {
  return v !== null ? v.toFixed(0) : '-';
}

function formatDate(v: string | null): string {
  if (!v) return '-';
  return new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function truncate(s: string | null, max: number): string {
  if (!s) return '-';
  return s.length > max ? s.slice(0, max) + '...' : s;
}

// ─── URL param helpers ───────────────────────────────────────────

/** Read a comma-separated URL param as string array, defaulting to []. */
function readArrayParam(params: URLSearchParams, key: string): string[] {
  const v = params.get(key);
  return v ? v.split(',').filter(Boolean) : [];
}

// ─── Main Component ──────────────────────────────────────────────

/** Suspense wrapper — useSearchParams requires this to avoid hydration mismatch. */
export default function ExplorerPage(): JSX.Element {
  return (
    <Suspense fallback={<ExplorerSkeleton />}>
      <ExplorerContent />
    </Suspense>
  );
}

function ExplorerSkeleton(): JSX.Element {
  return (
    <div className="space-y-6">
      <div className="h-10 w-48 bg-[var(--surface-elevated)] rounded animate-pulse" />
      <div className="h-12 bg-[var(--surface-elevated)] rounded-book animate-pulse" />
      <div className="h-64 bg-[var(--surface-elevated)] rounded-book animate-pulse" />
    </div>
  );
}

function ExplorerContent(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read initial state from URL params (enables deep-linking)
  const [viewMode, setViewMode] = useState<ViewMode>(
    (searchParams.get('view') as ViewMode) || 'table'
  );
  const [unit, setUnit] = useState<UnitOfAnalysis>(
    (searchParams.get('unit') as UnitOfAnalysis) || 'run'
  );

  // Filter state — initialized from URL
  const [promptFilter, setPromptFilter] = useState<string[]>(readArrayParam(searchParams, 'prompts'));
  const [strategyFilter, setStrategyFilter] = useState<string[]>(readArrayParam(searchParams, 'strategies'));
  const [pipelineFilter, setPipelineFilter] = useState<string[]>(readArrayParam(searchParams, 'pipelines'));
  const [datePreset, setDatePreset] = useState<DatePreset>(
    (searchParams.get('datePreset') as DatePreset) || 'all'
  );
  const [dateFrom, setDateFrom] = useState(searchParams.get('dateFrom') ?? '');
  const [dateTo, setDateTo] = useState(searchParams.get('dateTo') ?? '');

  // Dropdown options (loaded once)
  const [promptOptions, setPromptOptions] = useState<{ id: string; label: string }[]>([]);
  const [strategyOptions, setStrategyOptions] = useState<{ id: string; label: string }[]>([]);

  // Matrix controls — initialized from URL
  const [matrixRow, setMatrixRow] = useState<ExplorerDimension>(
    (searchParams.get('matrixRow') as ExplorerDimension) || 'strategy'
  );
  const [matrixCol, setMatrixCol] = useState<ExplorerDimension>(
    (searchParams.get('matrixCol') as ExplorerDimension) || 'prompt'
  );
  const [matrixMetric, setMatrixMetric] = useState<ExplorerMetric>(
    (searchParams.get('metric') as ExplorerMetric) || 'avgElo'
  );

  // Trend controls — initialized from URL
  const [trendGroupBy, setTrendGroupBy] = useState<ExplorerDimension>(
    (searchParams.get('groupBy') as ExplorerDimension) || 'strategy'
  );
  const [trendMetric, setTrendMetric] = useState<ExplorerMetric>(
    (searchParams.get('trendMetric') as ExplorerMetric) || 'avgElo'
  );
  const [trendBucket, setTrendBucket] = useState<TimeBucket>(
    (searchParams.get('bucket') as TimeBucket) || 'week'
  );

  // Sync state changes to URL params (shallow replace, no scroll)
  const syncToUrl = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '' || value === undefined) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : '?', { scroll: false });
  }, [router, searchParams]);

  // Wrap setters to also sync to URL
  const setViewModeAndSync = useCallback((v: ViewMode) => {
    setViewMode(v);
    syncToUrl({ view: v === 'table' ? null : v });
  }, [syncToUrl]);

  const setUnitAndSync = useCallback((v: UnitOfAnalysis) => {
    setUnit(v);
    syncToUrl({ unit: v === 'run' ? null : v });
  }, [syncToUrl]);

  const setPromptFilterAndSync = useCallback((v: string[]) => {
    setPromptFilter(v);
    syncToUrl({ prompts: v.length ? v.join(',') : null });
  }, [syncToUrl]);

  const setStrategyFilterAndSync = useCallback((v: string[]) => {
    setStrategyFilter(v);
    syncToUrl({ strategies: v.length ? v.join(',') : null });
  }, [syncToUrl]);

  const setPipelineFilterAndSync = useCallback((v: string[]) => {
    setPipelineFilter(v);
    syncToUrl({ pipelines: v.length ? v.join(',') : null });
  }, [syncToUrl]);

  const setDatePresetAndSync = useCallback((v: DatePreset) => {
    setDatePreset(v);
    syncToUrl({ datePreset: v === 'all' ? null : v });
  }, [syncToUrl]);

  const setDateFromAndSync = useCallback((v: string) => {
    setDateFrom(v);
    syncToUrl({ dateFrom: v || null });
  }, [syncToUrl]);

  const setDateToAndSync = useCallback((v: string) => {
    setDateTo(v);
    syncToUrl({ dateTo: v || null });
  }, [syncToUrl]);

  // Data state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tableData, setTableData] = useState<ExplorerTableResult | null>(null);
  const [matrixData, setMatrixData] = useState<ExplorerMatrixResult | null>(null);
  const [trendData, setTrendData] = useState<ExplorerTrendResult | null>(null);

  // Article detail expansion
  const [expandedArticle, setExpandedArticle] = useState<string | null>(null);
  const [articleDetail, setArticleDetail] = useState<ExplorerArticleDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Load dropdown options on mount and clean up any URL-persisted test entry IDs
  useEffect(() => {
    (async () => {
      const [pRes, sRes] = await Promise.all([
        getPromptsAction({ status: 'active' }),
        getStrategiesAction({ status: 'active' }),
      ]);
      if (pRes.success && pRes.data) {
        const opts = pRes.data.filter(p => !isTestEntry(p.title)).map(p => ({ id: p.id, label: p.title }));
        setPromptOptions(opts);
        // Remove URL-persisted IDs that were filtered out (ghost filter prevention)
        const validPromptIds = new Set(opts.map(o => o.id));
        const urlPrompts = readArrayParam(searchParams, 'prompts');
        const cleaned = urlPrompts.filter(id => validPromptIds.has(id));
        if (cleaned.length !== urlPrompts.length) {
          setPromptFilter(cleaned);
          syncToUrl({ prompts: cleaned.length ? cleaned.join(',') : null });
        }
      }
      if (sRes.success && sRes.data) {
        const opts = sRes.data.filter(s => !isTestEntry(s.name)).map(s => ({ id: s.id, label: s.name }));
        setStrategyOptions(opts);
        const validStrategyIds = new Set(opts.map(o => o.id));
        const urlStrategies = readArrayParam(searchParams, 'strategies');
        const cleaned = urlStrategies.filter(id => validStrategyIds.has(id));
        if (cleaned.length !== urlStrategies.length) {
          setStrategyFilter(cleaned);
          syncToUrl({ strategies: cleaned.length ? cleaned.join(',') : null });
        }
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only: reads initial searchParams to clean up ghost test-entry filters
  }, []);

  // Build filters object from input state
  const buildFilters = useCallback((): ExplorerFilters => {
    const filters: ExplorerFilters = {};
    if (promptFilter.length) filters.promptIds = promptFilter;
    if (strategyFilter.length) filters.strategyIds = strategyFilter;
    if (pipelineFilter.length) filters.pipelineTypes = pipelineFilter as ExplorerFilters['pipelineTypes'];
    // Date range: use preset or custom inputs
    const presetRange = datePreset !== 'custom' ? computeDatePreset(datePreset) : null;
    if (presetRange) {
      filters.dateRange = presetRange;
    } else if (dateFrom || dateTo) {
      filters.dateRange = { from: dateFrom || '2000-01-01', to: dateTo || '2099-12-31' };
    }
    return filters;
  }, [promptFilter, strategyFilter, pipelineFilter, datePreset, dateFrom, dateTo]);

  // Load data based on current view mode
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const filters = buildFilters();

      switch (viewMode) {
        case 'table': {
          const res = await getUnifiedExplorerAction(filters, unit);
          if (res.success && res.data) {
            setTableData(res.data);
          } else {
            const msg = res.error?.message ?? 'Failed to load table data';
            setError(msg);
            toast.error(msg);
          }
          break;
        }
        case 'matrix': {
          const res = await getExplorerMatrixAction({
            rowDimension: matrixRow,
            colDimension: matrixCol,
            metric: matrixMetric,
            filters,
          });
          if (res.success && res.data) {
            setMatrixData(res.data);
          } else {
            const msg = res.error?.message ?? 'Failed to load matrix data';
            setError(msg);
            toast.error(msg);
          }
          break;
        }
        case 'trend': {
          const res = await getExplorerTrendAction({
            groupByDimension: trendGroupBy,
            metric: trendMetric,
            timeBucket: trendBucket,
            filters,
          });
          if (res.success && res.data) {
            setTrendData(res.data);
          } else {
            const msg = res.error?.message ?? 'Failed to load trend data';
            setError(msg);
            toast.error(msg);
          }
          break;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      logger.error('Failed to load explorer data', { error: msg, viewMode });
      toast.error('Failed to load explorer data');
    } finally {
      setLoading(false);
    }
  }, [viewMode, unit, buildFilters, matrixRow, matrixCol, matrixMetric, trendGroupBy, trendMetric, trendBucket]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Article detail handler
  const handleArticleExpand = useCallback(async (article: ExplorerArticleRow) => {
    if (expandedArticle === article.id) {
      setExpandedArticle(null);
      setArticleDetail(null);
      return;
    }

    setExpandedArticle(article.id);
    setDetailLoading(true);

    try {
      const res = await getExplorerArticleDetailAction({
        runId: article.run_id,
        variantId: article.id,
      });
      if (res.success && res.data) {
        setArticleDetail(res.data);
      }
    } catch (err) {
      logger.error('Failed to load article detail', { error: String(err), articleId: article.id });
      toast.error('Failed to load article detail');
    } finally {
      setDetailLoading(false);
    }
  }, [expandedArticle]);

  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb items={[
        { label: 'Dashboard', href: '/admin/evolution-dashboard' },
        { label: 'Explorer' },
      ]} />
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-4xl font-display font-bold text-[var(--text-primary)]">
            Explorer
          </h1>
          <p className="text-[var(--text-muted)] font-body text-sm mt-1">
            Cross-dimensional analysis of evolution runs, articles, and agents
          </p>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="px-4 py-2 font-ui text-sm border border-[var(--border-default)] rounded-book text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] disabled:opacity-50 transition-scholar"
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        {viewMode === 'table' ? (
          <>
            <ButtonGroup options={UNITS} value={unit} onChange={setUnitAndSync} />
            <button
              onClick={() => setViewModeAndSync('matrix')}
              className="text-xs font-ui text-[var(--text-muted)] hover:text-[var(--accent-gold)] transition-colors"
            >
              Advanced Views &rsaquo;
            </button>
          </>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-xs font-ui text-[var(--text-muted)]">Advanced:</span>
            <ButtonGroup
              options={[
                { id: 'matrix' as ViewMode, label: 'Matrix' },
                { id: 'trend' as ViewMode, label: 'Trend' },
              ]}
              value={viewMode}
              onChange={setViewModeAndSync}
            />
            <button
              onClick={() => setViewModeAndSync('table')}
              className="text-xs font-ui text-[var(--text-muted)] hover:text-[var(--accent-gold)] transition-colors"
            >
              &lsaquo; Back to Table
            </button>
          </div>
        )}
      </div>

      <Card className="bg-[var(--surface-secondary)] paper-texture" style={{ zIndex: 100, position: 'relative' }}>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <SearchableMultiSelect
              label="Prompts"
              items={promptOptions}
              selected={promptFilter}
              onChange={setPromptFilterAndSync}
              placeholder="All prompts"
            />
            <SearchableMultiSelect
              label="Strategies"
              items={strategyOptions}
              selected={strategyFilter}
              onChange={setStrategyFilterAndSync}
              placeholder="All strategies"
            />
            <SearchableMultiSelect
              label="Pipeline Types"
              items={PIPELINE_TYPE_OPTIONS}
              selected={pipelineFilter}
              onChange={setPipelineFilterAndSync}
              placeholder="All pipelines"
            />
            <SelectControl
              label="Date Range"
              value={datePreset}
              onChange={(v) => setDatePresetAndSync(v as DatePreset)}
              options={DATE_PRESETS}
            />
            {datePreset === 'custom' && (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-ui text-[var(--text-muted)]">From</span>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFromAndSync(e.target.value)}
                    className="px-3 py-1.5 text-sm font-ui bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-gold)]"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-ui text-[var(--text-muted)]">To</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateToAndSync(e.target.value)}
                    className="px-3 py-1.5 text-sm font-ui bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-gold)]"
                  />
                </label>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {viewMode === 'table' && tableData?.aggregation && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Total Count"
            value={String(tableData.aggregation.totalCount)}
            loading={loading}
          />
          <StatCard
            label="Avg Rating"
            value={formatElo(tableData.aggregation.avgElo)}
            loading={loading}
          />
          <StatCard
            label="Total Cost"
            value={formatCost(tableData.aggregation.totalCost)}
            loading={loading}
          />
          <StatCard
            label="Top Agent"
            value={tableData.aggregation.topAgent ?? '-'}
            loading={loading}
          />
        </div>
      )}

      {error && (
        <div className="p-3 bg-[var(--status-error)]/10 border border-[var(--status-error)] rounded-book text-[var(--status-error)] font-body text-sm">
          {error}
        </div>
      )}

      {viewMode === 'table' && (
        <Card className="bg-[var(--surface-secondary)] paper-texture overflow-hidden">
          <CardContent className="p-0">
            {loading ? (
              <div className="p-6"><TableSkeleton /></div>
            ) : (
              <div className="overflow-x-auto">
                {unit === 'run' && (
                  <RunTable rows={tableData?.runs ?? []} />
                )}
                {unit === 'article' && (
                  <ArticleTable
                    rows={tableData?.articles ?? []}
                    expandedId={expandedArticle}
                    detail={articleDetail}
                    detailLoading={detailLoading}
                    onExpand={handleArticleExpand}
                  />
                )}
                {unit === 'task' && (
                  <TaskTable rows={tableData?.tasks ?? []} />
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {viewMode === 'matrix' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <SelectControl
              label="Row Dimension"
              value={matrixRow}
              onChange={(v) => { setMatrixRow(v as ExplorerDimension); syncToUrl({ matrixRow: v }); }}
              options={DIMENSIONS}
            />
            <SelectControl
              label="Column Dimension"
              value={matrixCol}
              onChange={(v) => { setMatrixCol(v as ExplorerDimension); syncToUrl({ matrixCol: v }); }}
              options={DIMENSIONS}
            />
            <SelectControl
              label="Metric"
              value={matrixMetric}
              onChange={(v) => { setMatrixMetric(v as ExplorerMetric); syncToUrl({ metric: v }); }}
              options={METRICS}
            />
          </div>

          <Card className="bg-[var(--surface-secondary)] paper-texture overflow-hidden">
            <CardContent className="p-0">
              {loading ? (
                <div className="p-6"><TableSkeleton /></div>
              ) : matrixData && matrixData.rows.length > 0 ? (
                <MatrixGrid data={matrixData} metric={matrixMetric} />
              ) : (
                <div className="p-12 text-center text-[var(--text-muted)] font-body text-sm">
                  No matrix data available. Adjust filters or dimensions.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {viewMode === 'trend' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <SelectControl
              label="Group By"
              value={trendGroupBy}
              onChange={(v) => { setTrendGroupBy(v as ExplorerDimension); syncToUrl({ groupBy: v }); }}
              options={DIMENSIONS}
            />
            <SelectControl
              label="Metric"
              value={trendMetric}
              onChange={(v) => { setTrendMetric(v as ExplorerMetric); syncToUrl({ trendMetric: v }); }}
              options={METRICS}
            />
            <SelectControl
              label="Time Bucket"
              value={trendBucket}
              onChange={(v) => { setTrendBucket(v as TimeBucket); syncToUrl({ bucket: v }); }}
              options={TIME_BUCKETS}
            />
          </div>

          <Card className="bg-[var(--surface-secondary)] paper-texture">
            <CardHeader>
              <CardTitle className="text-xl font-display text-[var(--text-primary)]">
                Trend
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <ChartSkeleton />
              ) : trendData ? (
                <TrendChart data={trendData} metricLabel={METRICS.find(m => m.id === trendMetric)?.label} />
              ) : (
                <div className="h-[300px] flex items-center justify-center text-[var(--text-muted)] font-body text-sm">
                  No trend data available
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components: Tables ─────────────────────────────────────

function RunTable({ rows }: { rows: ExplorerRunRow[] }): JSX.Element {
  if (rows.length === 0) {
    return (
      <div className="p-12 text-center text-[var(--text-muted)] font-body text-sm">
        No runs found. Adjust filters to see results.
      </div>
    );
  }

  return (
    <table className="w-full">
      <thead className="bg-[var(--surface-elevated)]">
        <tr>
          <Th>Prompt</Th>
          <Th>Strategy</Th>
          <Th>Pipeline</Th>
          <Th>Status</Th>
          <Th>Cost</Th>
          <Th>Variants</Th>
          <Th>Date</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--border-default)]">
        {rows.map((row) => (
          <tr key={row.id} className="hover:bg-[var(--surface-elevated)] transition-colors">
            <Td className="max-w-[200px]">
              <span title={row.prompt_text ?? undefined}>
                {truncate(row.prompt_text, 40)}
              </span>
            </Td>
            <Td>{truncate(row.strategy_label, 30)}</Td>
            <Td>
              <span className="inline-block px-2 py-0.5 text-xs font-ui rounded-book bg-[var(--surface-elevated)] border border-[var(--border-default)]">
                {row.pipeline_type ?? '-'}
              </span>
            </Td>
            <Td>
              <StatusBadge status={row.status} />
            </Td>
            <Td className="font-mono text-xs">{formatCost(row.total_cost_usd)}</Td>
            <Td>{row.total_variants}</Td>
            <Td className="text-xs">
              <Link href={`/admin/quality/evolution/run/${row.id}`} className="text-[var(--accent-gold)] hover:underline font-mono">
                {formatDate(row.created_at)}
              </Link>
            </Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ArticleTable({ rows, expandedId, detail, detailLoading, onExpand }: {
  rows: ExplorerArticleRow[];
  expandedId: string | null;
  detail: ExplorerArticleDetail | null;
  detailLoading: boolean;
  onExpand: (row: ExplorerArticleRow) => void;
}): JSX.Element {
  if (rows.length === 0) {
    return (
      <div className="p-12 text-center text-[var(--text-muted)] font-body text-sm">
        No articles found. Adjust filters to see results.
      </div>
    );
  }

  return (
    <table className="w-full">
      <thead className="bg-[var(--surface-elevated)]">
        <tr>
          <Th>Content</Th>
          <Th>Rating</Th>
          <Th>Agent</Th>
          <Th>Gen</Th>
          <Th>Matches</Th>
          <Th>HoF</Th>
          <Th>Run</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--border-default)]">
        {rows.map((row) => (
          <Fragment key={row.id}>
            <tr
              className="hover:bg-[var(--surface-elevated)] transition-colors cursor-pointer"
              onClick={() => onExpand(row)}
            >
              <Td className="max-w-[300px]">
                <span title={row.variant_content_preview}>
                  {truncate(row.variant_content_preview, 60)}
                </span>
              </Td>
              <Td className="font-mono text-xs">{formatElo(row.elo_score)}</Td>
              <Td>{row.agent_name}</Td>
              <Td>{row.generation}</Td>
              <Td>{row.match_count}</Td>
              <Td>
                {row.hall_of_fame_rank !== null ? (
                  <span className="text-[var(--accent-gold)] font-ui text-xs">#{row.hall_of_fame_rank}</span>
                ) : '-'}
              </Td>
              <Td className="font-mono text-xs">
                <Link href={`/admin/quality/evolution/run/${row.run_id}`} className="text-[var(--accent-gold)] hover:underline" onClick={(e) => e.stopPropagation()}>
                  {row.run_id.slice(0, 8)}
                </Link>
              </Td>
            </tr>

            {expandedId === row.id && (
              <tr>
                <td colSpan={7} className="p-0">
                  <ArticleDetailPanel detail={detail} loading={detailLoading} />
                </td>
              </tr>
            )}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

function TaskTable({ rows }: { rows: ExplorerTaskRow[] }): JSX.Element {
  if (rows.length === 0) {
    return (
      <div className="p-12 text-center text-[var(--text-muted)] font-body text-sm">
        No agents found. Adjust filters to see results.
      </div>
    );
  }

  return (
    <table className="w-full">
      <thead className="bg-[var(--surface-elevated)]">
        <tr>
          <Th>Agent</Th>
          <Th>Prompt</Th>
          <Th>Cost</Th>
          <Th>Variants</Th>
          <Th>Avg Rating</Th>
          <Th>Rating Gain</Th>
          <Th>Rating/$</Th>
          <Th>Run</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--border-default)]">
        {rows.map((row) => (
          <tr key={row.id} className="hover:bg-[var(--surface-elevated)] transition-colors">
            <Td>
              <Link
                href={`/admin/quality/evolution/run/${row.run_id}?tab=timeline&agent=${row.agent_name}`}
                className="text-[var(--accent-gold)] hover:underline"
              >
                {row.agent_name}
              </Link>
            </Td>
            <Td className="max-w-[200px]">
              <span title={row.prompt_text ?? undefined}>
                {truncate(row.prompt_text, 40)}
              </span>
            </Td>
            <Td className="font-mono text-xs">{formatCost(row.cost_usd)}</Td>
            <Td>{row.variants_generated}</Td>
            <Td className="font-mono text-xs">{formatElo(row.avg_elo)}</Td>
            <Td className="font-mono text-xs">
              {row.elo_gain !== null ? (
                <EloGainLabel value={row.elo_gain} />
              ) : '-'}
            </Td>
            <Td className="font-mono text-xs">{row.elo_per_dollar !== null ? row.elo_per_dollar.toFixed(0) : '-'}</Td>
            <Td className="font-mono text-xs">
              <Link href={`/admin/quality/evolution/run/${row.run_id}`} className="text-[var(--accent-gold)] hover:underline">
                {row.run_id.slice(0, 8)}
              </Link>
            </Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Sub-components: Matrix ─────────────────────────────────────

function MatrixGrid({ data, metric }: { data: ExplorerMatrixResult; metric: ExplorerMetric }): JSX.Element {
  // Build cell lookup
  const cellMap = new Map<string, number>();
  let minVal = Infinity;
  let maxVal = -Infinity;

  for (const cell of data.cells) {
    const key = `${cell.rowId}::${cell.colId}`;
    cellMap.set(key, cell.value);
    if (cell.value < minVal) minVal = cell.value;
    if (cell.value > maxVal) maxVal = cell.value;
  }

  // Normalize value to 0-1 for heat coloring
  const range = maxVal - minVal;
  const normalize = (v: number) => range > 0 ? (v - minVal) / range : 0.5;

  function formatCell(v: number): string {
    if (metric === 'totalCost') return `$${v.toFixed(2)}`;
    if (metric === 'runCount') return String(Math.round(v));
    if (metric === 'successRate') return `${(v * 100).toFixed(0)}%`;
    return v.toFixed(1);
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-[var(--surface-elevated)]">
          <tr>
            <Th />
            {data.cols.map((col) => (
              <Th key={col.id} className="text-center">
                <span title={col.label}>{truncate(col.label, 20)}</span>
              </Th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border-default)]">
          {data.rows.map((row) => (
            <tr key={row.id}>
              <Td className="font-ui text-xs font-medium whitespace-nowrap">
                <span title={row.label}>{truncate(row.label, 25)}</span>
              </Td>
              {data.cols.map((col) => {
                const key = `${row.id}::${col.id}`;
                const value = cellMap.get(key);
                const hasValue = value !== undefined;
                const intensity = hasValue ? normalize(value) : 0;

                return (
                  <td
                    key={col.id}
                    className="px-3 py-2 text-center text-xs font-mono"
                    style={hasValue ? {
                      backgroundColor: `var(--surface-elevated)`,
                      opacity: 0.5 + intensity * 0.5,
                    } : undefined}
                  >
                    {hasValue ? (
                      <span className="text-[var(--text-primary)]">{formatCell(value)}</span>
                    ) : (
                      <span className="text-[var(--text-muted)]">-</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Sub-components: Article Detail ─────────────────────────────

function ArticleDetailPanel({ detail, loading }: { detail: ExplorerArticleDetail | null; loading: boolean }): JSX.Element {
  if (loading) {
    return (
      <div className="p-6 bg-[var(--surface-elevated)] border-t border-[var(--border-default)]">
        <div className="h-32 bg-[var(--surface-secondary)] rounded-book animate-pulse" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="p-6 bg-[var(--surface-elevated)] border-t border-[var(--border-default)] text-[var(--text-muted)] font-body text-sm">
        No detail data available
      </div>
    );
  }

  return (
    <div className="p-6 bg-[var(--surface-elevated)] border-t border-[var(--border-default)] space-y-4">
      <div className="flex flex-wrap gap-4 text-xs font-ui">
        <span className="text-[var(--text-muted)]">
          Agent: <span className="text-[var(--text-primary)]">{detail.agentName}</span>
        </span>
        <span className="text-[var(--text-muted)]">
          Generation: <span className="text-[var(--text-primary)]">{detail.generation}</span>
        </span>
        <span className="text-[var(--text-muted)]">
          Rating: <span className="text-[var(--text-primary)]">{detail.eloScore.toFixed(0)}</span>
        </span>
      </div>

      <div>
        <h4 className="text-lg font-display font-medium text-[var(--text-secondary)] mb-2">Content</h4>
        <div className="p-4 bg-[var(--surface-secondary)] rounded-book border border-[var(--border-default)] text-sm font-body text-[var(--text-primary)] whitespace-pre-wrap max-h-64 overflow-y-auto">
          {detail.content}
        </div>
      </div>

      {detail.parentContent && (
        <div>
          <h4 className="text-lg font-display font-medium text-[var(--text-secondary)] mb-2">Parent Content</h4>
          <div className="p-4 bg-[var(--surface-secondary)] rounded-book border border-[var(--border-default)] text-sm font-body text-[var(--text-muted)] whitespace-pre-wrap max-h-48 overflow-y-auto">
            {detail.parentContent}
          </div>
        </div>
      )}

      {detail.lineage.length > 0 && (
        <div>
          <h4 className="text-lg font-display font-medium text-[var(--text-secondary)] mb-2">
            Lineage ({detail.lineage.length} ancestors)
          </h4>
          <div className="space-y-1">
            {detail.lineage.map((ancestor, i) => (
              <div
                key={ancestor.id}
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-ui bg-[var(--surface-secondary)] rounded-book border border-[var(--border-default)]"
              >
                <span className="text-[var(--text-muted)]">Gen {ancestor.generation}</span>
                <span className="text-[var(--accent-gold)]">{ancestor.agentName}</span>
                <span className="text-[var(--text-muted)] truncate flex-1">{ancestor.preview}</span>
                {i < detail.lineage.length - 1 && (
                  <span className="text-[var(--text-muted)]">&larr;</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EloGainLabel({ value }: { value: number }): JSX.Element {
  const colorClass = value > 0 ? 'text-[var(--status-success)]'
    : value < 0 ? 'text-[var(--status-error)]' : '';
  const prefix = value > 0 ? '+' : '';
  return <span className={colorClass}>{prefix}{value.toFixed(1)}</span>;
}

// ─── Status badge ────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }): JSX.Element {
  const colorMap: Record<string, string> = {
    completed: 'var(--status-success)',
    failed: 'var(--status-error)',
    running: 'var(--status-warning)',
    paused: 'var(--text-muted)',
    pending: 'var(--text-muted)',
  };
  const color = colorMap[status] ?? 'var(--text-muted)';

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-ui rounded-book border"
      style={{ borderColor: color, color }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {status}
    </span>
  );
}
