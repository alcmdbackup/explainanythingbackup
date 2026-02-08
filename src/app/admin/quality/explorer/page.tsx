'use client';
// Unified Dimensional Explorer page for cross-cutting analysis of evolution runs, articles, and tasks.
// Supports table, matrix, and trend views with multi-dimensional filtering.

import { Fragment, useState, useCallback, useEffect, type ReactNode } from 'react';
import { logger } from '@/lib/client_utilities';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
} from '@/lib/services/unifiedExplorerActions';

// ─── Dynamic Recharts imports ─────────────────────────────────────

const TrendChart = dynamic(() => import('recharts').then((mod) => {
  const { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } = mod;

  const SERIES_COLORS = [
    'var(--accent-gold)',
    'var(--status-success)',
    'var(--status-error)',
    'var(--status-warning)',
    'var(--accent-copper)',
    'var(--text-secondary)',
    'var(--text-muted)',
  ];

  function Chart({ data }: { data: ExplorerTrendResult }) {
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
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
            width={50}
          />
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

const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: 'table', label: 'Table' },
  { id: 'matrix', label: 'Matrix' },
  { id: 'trend', label: 'Trend' },
];

const UNITS: { id: UnitOfAnalysis; label: string }[] = [
  { id: 'run', label: 'Run' },
  { id: 'article', label: 'Article' },
  { id: 'task', label: 'Task' },
];

const METRICS: { id: ExplorerMetric; label: string }[] = [
  { id: 'avgElo', label: 'Avg Elo' },
  { id: 'totalCost', label: 'Total Cost' },
  { id: 'runCount', label: 'Run Count' },
  { id: 'avgEloDollar', label: 'Elo/Dollar' },
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

// ─── Skeletons and helpers ───────────────────────────────────────

function ChartSkeleton() {
  return <div className="h-[300px] bg-[var(--surface-secondary)] rounded-book animate-pulse" />;
}

function TableSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-10 bg-[var(--surface-elevated)] rounded-book animate-pulse" />
      ))}
    </div>
  );
}

function StatCard({ label, value, loading }: { label: string; value: string; loading: boolean }) {
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
}) {
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

function MultiInput({ label, value, onChange, placeholder }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-ui text-[var(--text-muted)]">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="px-3 py-1.5 text-sm font-ui bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-gold)]"
      />
    </label>
  );
}

function ButtonGroup<T extends string>({ options, value, onChange }: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
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

function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th className={`px-3 py-2 text-left text-xs font-ui font-medium text-[var(--text-muted)] uppercase tracking-wide ${className ?? ''}`}>
      {children}
    </th>
  );
}

function Td({ children, className }: { children: ReactNode; className?: string }) {
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

// ─── Main Component ──────────────────────────────────────────────

export default function ExplorerPage() {
  // View state
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [unit, setUnit] = useState<UnitOfAnalysis>('run');

  // Filter state
  const [promptFilter, setPromptFilter] = useState('');
  const [strategyFilter, setStrategyFilter] = useState('');
  const [pipelineFilter, setPipelineFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Matrix controls
  const [matrixRow, setMatrixRow] = useState<ExplorerDimension>('strategy');
  const [matrixCol, setMatrixCol] = useState<ExplorerDimension>('prompt');
  const [matrixMetric, setMatrixMetric] = useState<ExplorerMetric>('avgElo');

  // Trend controls
  const [trendGroupBy, setTrendGroupBy] = useState<ExplorerDimension>('strategy');
  const [trendMetric, setTrendMetric] = useState<ExplorerMetric>('avgElo');
  const [trendBucket, setTrendBucket] = useState<TimeBucket>('week');

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

  // Build filters object from input state
  const buildFilters = useCallback((): ExplorerFilters => {
    const filters: ExplorerFilters = {};
    const promptIds = promptFilter.split(',').map(s => s.trim()).filter(Boolean);
    if (promptIds.length) filters.promptIds = promptIds;
    const strategyIds = strategyFilter.split(',').map(s => s.trim()).filter(Boolean);
    if (strategyIds.length) filters.strategyIds = strategyIds;
    const pipelineTypes = pipelineFilter.split(',').map(s => s.trim()).filter(Boolean);
    if (pipelineTypes.length) filters.pipelineTypes = pipelineTypes as ExplorerFilters['pipelineTypes'];
    if (dateFrom || dateTo) {
      filters.dateRange = { from: dateFrom || '2000-01-01', to: dateTo || '2099-12-31' };
    }
    return filters;
  }, [promptFilter, strategyFilter, pipelineFilter, dateFrom, dateTo]);

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
            setError(res.error?.message ?? 'Failed to load table data');
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
            setError(res.error?.message ?? 'Failed to load matrix data');
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
            setError(res.error?.message ?? 'Failed to load trend data');
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

  // ─── Render ─────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-4xl font-display font-bold text-[var(--text-primary)]">
            Explorer
          </h1>
          <p className="text-[var(--text-muted)] font-body text-sm mt-1">
            Cross-dimensional analysis of evolution runs, articles, and tasks
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

      {/* View mode toggle */}
      <div className="flex flex-wrap items-center gap-4">
        <ButtonGroup options={VIEW_MODES} value={viewMode} onChange={setViewMode} />

        {viewMode === 'table' && (
          <ButtonGroup options={UNITS} value={unit} onChange={setUnit} />
        )}
      </div>

      {/* Filter bar */}
      <Card className="bg-[var(--surface-secondary)] paper-texture">
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <MultiInput
              label="Prompt IDs"
              value={promptFilter}
              onChange={setPromptFilter}
              placeholder="id1, id2..."
            />
            <MultiInput
              label="Strategy IDs"
              value={strategyFilter}
              onChange={setStrategyFilter}
              placeholder="id1, id2..."
            />
            <MultiInput
              label="Pipeline Types"
              value={pipelineFilter}
              onChange={setPipelineFilter}
              placeholder="full, minimal, batch"
            />
            <label className="flex flex-col gap-1">
              <span className="text-xs font-ui text-[var(--text-muted)]">From</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="px-3 py-1.5 text-sm font-ui bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-gold)]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-ui text-[var(--text-muted)]">To</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="px-3 py-1.5 text-sm font-ui bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-gold)]"
              />
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Aggregation stat cards (table mode only) */}
      {viewMode === 'table' && tableData?.aggregation && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Total Count"
            value={String(tableData.aggregation.totalCount)}
            loading={loading}
          />
          <StatCard
            label="Avg Elo"
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

      {/* Error */}
      {error && (
        <div className="p-3 bg-[var(--status-error)]/10 border border-[var(--status-error)] rounded-book text-[var(--status-error)] font-body text-sm">
          {error}
        </div>
      )}

      {/* ─── Table Mode ──────────────────────────────────────────── */}
      {viewMode === 'table' && (
        <Card className="bg-[var(--surface-secondary)] paper-texture overflow-hidden">
          <CardContent className="p-0">
            {loading ? (
              <div className="p-6"><TableSkeleton /></div>
            ) : (
              <div className="overflow-x-auto">
                {/* Run table */}
                {unit === 'run' && (
                  <RunTable rows={tableData?.runs ?? []} />
                )}

                {/* Article table */}
                {unit === 'article' && (
                  <ArticleTable
                    rows={tableData?.articles ?? []}
                    expandedId={expandedArticle}
                    detail={articleDetail}
                    detailLoading={detailLoading}
                    onExpand={handleArticleExpand}
                  />
                )}

                {/* Task table */}
                {unit === 'task' && (
                  <TaskTable rows={tableData?.tasks ?? []} />
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ─── Matrix Mode ─────────────────────────────────────────── */}
      {viewMode === 'matrix' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <SelectControl
              label="Row Dimension"
              value={matrixRow}
              onChange={(v) => setMatrixRow(v as ExplorerDimension)}
              options={DIMENSIONS}
            />
            <SelectControl
              label="Column Dimension"
              value={matrixCol}
              onChange={(v) => setMatrixCol(v as ExplorerDimension)}
              options={DIMENSIONS}
            />
            <SelectControl
              label="Metric"
              value={matrixMetric}
              onChange={(v) => setMatrixMetric(v as ExplorerMetric)}
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

      {/* ─── Trend Mode ──────────────────────────────────────────── */}
      {viewMode === 'trend' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <SelectControl
              label="Group By"
              value={trendGroupBy}
              onChange={(v) => setTrendGroupBy(v as ExplorerDimension)}
              options={DIMENSIONS}
            />
            <SelectControl
              label="Metric"
              value={trendMetric}
              onChange={(v) => setTrendMetric(v as ExplorerMetric)}
              options={METRICS}
            />
            <SelectControl
              label="Time Bucket"
              value={trendBucket}
              onChange={(v) => setTrendBucket(v as TimeBucket)}
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
                <TrendChart data={trendData} />
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

function RunTable({ rows }: { rows: ExplorerRunRow[] }) {
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
            <Td className="text-xs text-[var(--text-muted)]">{formatDate(row.created_at)}</Td>
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
}) {
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
          <Th>Elo</Th>
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
              <Td className="font-mono text-xs text-[var(--text-muted)]">
                {row.run_id.slice(0, 8)}
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

function TaskTable({ rows }: { rows: ExplorerTaskRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="p-12 text-center text-[var(--text-muted)] font-body text-sm">
        No tasks found. Adjust filters to see results.
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
          <Th>Avg Elo</Th>
          <Th>Elo Gain</Th>
          <Th>Elo/$</Th>
          <Th>Run</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--border-default)]">
        {rows.map((row) => (
          <tr key={row.id} className="hover:bg-[var(--surface-elevated)] transition-colors">
            <Td>{row.agent_name}</Td>
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
            <Td className="font-mono text-xs text-[var(--text-muted)]">
              {row.run_id.slice(0, 8)}
            </Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Sub-components: Matrix ─────────────────────────────────────

function MatrixGrid({ data, metric }: { data: ExplorerMatrixResult; metric: ExplorerMetric }) {
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

function ArticleDetailPanel({ detail, loading }: { detail: ExplorerArticleDetail | null; loading: boolean }) {
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
      {/* Metadata */}
      <div className="flex flex-wrap gap-4 text-xs font-ui">
        <span className="text-[var(--text-muted)]">
          Agent: <span className="text-[var(--text-primary)]">{detail.agentName}</span>
        </span>
        <span className="text-[var(--text-muted)]">
          Generation: <span className="text-[var(--text-primary)]">{detail.generation}</span>
        </span>
        <span className="text-[var(--text-muted)]">
          Elo: <span className="text-[var(--text-primary)]">{detail.eloScore.toFixed(0)}</span>
        </span>
      </div>

      {/* Content */}
      <div>
        <h4 className="text-lg font-display font-medium text-[var(--text-secondary)] mb-2">Content</h4>
        <div className="p-4 bg-[var(--surface-secondary)] rounded-book border border-[var(--border-default)] text-sm font-body text-[var(--text-primary)] whitespace-pre-wrap max-h-64 overflow-y-auto">
          {detail.content}
        </div>
      </div>

      {/* Parent content */}
      {detail.parentContent && (
        <div>
          <h4 className="text-lg font-display font-medium text-[var(--text-secondary)] mb-2">Parent Content</h4>
          <div className="p-4 bg-[var(--surface-secondary)] rounded-book border border-[var(--border-default)] text-sm font-body text-[var(--text-muted)] whitespace-pre-wrap max-h-48 overflow-y-auto">
            {detail.parentContent}
          </div>
        </div>
      )}

      {/* Lineage chain */}
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

function EloGainLabel({ value }: { value: number }): ReactNode {
  let colorClass = '';
  if (value > 0) colorClass = 'text-[var(--status-success)]';
  else if (value < 0) colorClass = 'text-[var(--status-error)]';

  const prefix = value > 0 ? '+' : '';
  return <span className={colorClass}>{prefix}{value.toFixed(1)}</span>;
}

// ─── Status badge ────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
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
