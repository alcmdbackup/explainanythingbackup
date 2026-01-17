'use client';
/**
 * Admin cost analytics page.
 * Shows LLM usage costs with breakdowns by model and user.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  getCostSummaryAction,
  getDailyCostsAction,
  getCostByModelAction,
  getCostByUserAction,
  backfillCostsAction,
  type CostSummary,
  type DailyCost,
  type ModelCost,
  type UserCost
} from '@/lib/services/costAnalytics';
import { formatCost } from '@/config/llmPricing';

export default function AdminCostsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [dailyCosts, setDailyCosts] = useState<DailyCost[]>([]);
  const [modelCosts, setModelCosts] = useState<ModelCost[]>([]);
  const [userCosts, setUserCosts] = useState<UserCost[]>([]);

  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d'>('30d');
  const [backfillStatus, setBackfillStatus] = useState<string | null>(null);

  const getDateRange = useCallback(() => {
    const end = new Date().toISOString().split('T')[0];
    const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90;
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    return { startDate: start, endDate: end };
  }, [dateRange]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const filters = getDateRange();

      const [summaryRes, dailyRes, modelRes, userRes] = await Promise.all([
        getCostSummaryAction(filters),
        getDailyCostsAction(filters),
        getCostByModelAction(filters),
        getCostByUserAction({ ...filters, limit: 10 })
      ]);

      if (summaryRes.success && summaryRes.data) {
        setSummary(summaryRes.data);
      }
      if (dailyRes.success && dailyRes.data) {
        setDailyCosts(dailyRes.data);
      }
      if (modelRes.success && modelRes.data) {
        setModelCosts(modelRes.data);
      }
      if (userRes.success && userRes.data) {
        setUserCosts(userRes.data);
      }

      if (!summaryRes.success) {
        setError(summaryRes.error?.message || 'Failed to load data');
      }
    } catch {
      setError('Failed to load cost data');
    }

    setLoading(false);
  }, [getDateRange]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleBackfill = async () => {
    setBackfillStatus('Running backfill...');
    const result = await backfillCostsAction({ batchSize: 500 });
    if (result.success && result.data) {
      setBackfillStatus(`Backfill complete: ${result.data.updated} records updated`);
      loadData();
    } else {
      setBackfillStatus(`Backfill failed: ${result.error?.message}`);
    }
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat().format(Math.round(num));
  };

  // Simple bar chart using CSS
  const maxDailyCost = Math.max(...dailyCosts.map(d => d.totalCost), 0.01);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">
            Cost Analytics
          </h1>
          <p className="text-[var(--text-muted)] text-sm mt-1">
            LLM usage and spending overview
          </p>
        </div>

        <div className="flex gap-2">
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value as '7d' | '30d' | '90d')}
            className="px-3 py-2 border border-[var(--border-color)] rounded-md bg-[var(--bg-secondary)] text-[var(--text-primary)]"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </select>
          <button
            onClick={handleBackfill}
            className="px-3 py-2 border border-[var(--border-color)] rounded-md hover:bg-[var(--bg-secondary)] text-sm"
            title="Backfill missing cost data"
          >
            Backfill Costs
          </button>
        </div>
      </div>

      {backfillStatus && (
        <div className="p-3 bg-blue-900/20 border border-blue-600 rounded-md text-blue-400 text-sm">
          {backfillStatus}
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-900/20 border border-red-600 rounded-md text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-[var(--text-muted)]">Loading...</div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="p-4 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)]">
              <div className="text-sm text-[var(--text-muted)]">Total Cost</div>
              <div className="text-2xl font-bold text-[var(--accent-primary)]">
                {formatCost(summary?.totalCost || 0)}
              </div>
            </div>
            <div className="p-4 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)]">
              <div className="text-sm text-[var(--text-muted)]">Total Calls</div>
              <div className="text-2xl font-bold text-[var(--text-primary)]">
                {formatNumber(summary?.totalCalls || 0)}
              </div>
            </div>
            <div className="p-4 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)]">
              <div className="text-sm text-[var(--text-muted)]">Total Tokens</div>
              <div className="text-2xl font-bold text-[var(--text-primary)]">
                {formatNumber(summary?.totalTokens || 0)}
              </div>
            </div>
            <div className="p-4 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)]">
              <div className="text-sm text-[var(--text-muted)]">Avg Cost/Call</div>
              <div className="text-2xl font-bold text-[var(--text-primary)]">
                {formatCost(summary?.avgCostPerCall || 0)}
              </div>
            </div>
          </div>

          {/* Daily Cost Chart */}
          <div className="p-4 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)]">
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Daily Costs</h2>
            {dailyCosts.length === 0 ? (
              <div className="text-center text-[var(--text-muted)] py-8">No data for this period</div>
            ) : (
              <div className="flex items-end gap-1 h-48 overflow-x-auto">
                {dailyCosts.map((day) => (
                  <div
                    key={day.date}
                    className="flex-shrink-0 flex flex-col items-center"
                    style={{ minWidth: '24px' }}
                  >
                    <div
                      className="w-5 bg-[var(--accent-primary)] rounded-t transition-all hover:opacity-80"
                      style={{
                        height: `${Math.max((day.totalCost / maxDailyCost) * 160, 4)}px`
                      }}
                      title={`${day.date}: ${formatCost(day.totalCost)} (${formatNumber(day.callCount)} calls)`}
                    />
                    <div className="text-[8px] text-[var(--text-muted)] mt-1 -rotate-45 origin-top-left whitespace-nowrap">
                      {day.date.slice(5)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Cost by Model */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="p-4 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)]">
              <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Cost by Model</h2>
              {modelCosts.length === 0 ? (
                <div className="text-center text-[var(--text-muted)] py-4">No data</div>
              ) : (
                <div className="space-y-3">
                  {modelCosts.slice(0, 8).map((model) => {
                    const maxCost = modelCosts[0]?.totalCost || 1;
                    const percentage = (model.totalCost / maxCost) * 100;
                    return (
                      <div key={model.model}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-[var(--text-primary)] font-mono truncate" title={model.model}>
                            {model.model || 'unknown'}
                          </span>
                          <span className="text-[var(--text-muted)] ml-2 flex-shrink-0">
                            {formatCost(model.totalCost)} ({formatNumber(model.callCount)} calls)
                          </span>
                        </div>
                        <div className="h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[var(--accent-primary)] rounded-full"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Cost by User */}
            <div className="p-4 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)]">
              <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Top Users by Cost</h2>
              {userCosts.length === 0 ? (
                <div className="text-center text-[var(--text-muted)] py-4">No data</div>
              ) : (
                <div className="space-y-3">
                  {userCosts.map((user, index) => {
                    const maxCost = userCosts[0]?.totalCost || 1;
                    const percentage = (user.totalCost / maxCost) * 100;
                    return (
                      <div key={user.userId}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-[var(--text-primary)] font-mono text-xs truncate" title={user.userId}>
                            #{index + 1} {user.userId.slice(0, 8)}...
                          </span>
                          <span className="text-[var(--text-muted)] ml-2 flex-shrink-0">
                            {formatCost(user.totalCost)} ({formatNumber(user.callCount)} calls)
                          </span>
                        </div>
                        <div className="h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-green-500 rounded-full"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Detailed Model Table */}
          <div className="p-4 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)]">
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Model Details</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[var(--bg-tertiary)]">
                  <tr>
                    <th className="p-3 text-left">Model</th>
                    <th className="p-3 text-right">Calls</th>
                    <th className="p-3 text-right">Prompt Tokens</th>
                    <th className="p-3 text-right">Completion Tokens</th>
                    <th className="p-3 text-right">Reasoning Tokens</th>
                    <th className="p-3 text-right">Total Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {modelCosts.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-[var(--text-muted)]">
                        No data for this period
                      </td>
                    </tr>
                  ) : (
                    modelCosts.map((model) => (
                      <tr key={model.model} className="border-t border-[var(--border-color)]">
                        <td className="p-3 font-mono text-xs">{model.model || 'unknown'}</td>
                        <td className="p-3 text-right">{formatNumber(model.callCount)}</td>
                        <td className="p-3 text-right">{formatNumber(model.promptTokens)}</td>
                        <td className="p-3 text-right">{formatNumber(model.completionTokens)}</td>
                        <td className="p-3 text-right">{formatNumber(model.reasoningTokens)}</td>
                        <td className="p-3 text-right font-semibold">{formatCost(model.totalCost)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
