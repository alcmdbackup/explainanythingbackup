'use client';
// Admin cost analytics page. Shows LLM usage costs with breakdowns by model and user.

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
} from '@evolution/services/costAnalytics';
import { formatCost, getModelPricing } from '@/config/llmPricing';
import {
  getLLMCostConfigAction,
  updateLLMCostConfigAction,
  toggleKillSwitchAction,
  getSpendingSummaryAction,
  type CostConfigData,
} from '@/lib/services/llmCostConfigActions';
import type { SpendingSummary } from '@/lib/services/llmSpendingGate';

type DateRangeKey = '1m' | '1h' | '1d' | '7d' | '30d' | '90d';

const DATE_RANGE_MS: Record<DateRangeKey, number> = {
  '1m': 60 * 1000,
  '1h': 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

function formatNumber(num: number): string {
  return new Intl.NumberFormat().format(Math.round(num));
}

function ProgressBar({ value, max, label, detail }: { value: number; max: number; label: string; detail: string }): React.ReactElement {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const color = pct >= 95 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-green-500';
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-[var(--text-primary)]">{label}</span>
        <span className="text-[var(--text-muted)]">{detail}</span>
      </div>
      <div className="h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function AdminCostsPage(): React.ReactElement {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [dailyCosts, setDailyCosts] = useState<DailyCost[]>([]);
  const [modelCosts, setModelCosts] = useState<ModelCost[]>([]);
  const [userCosts, setUserCosts] = useState<UserCost[]>([]);

  const [dateRange, setDateRange] = useState<DateRangeKey>('30d');
  const [backfillStatus, setBackfillStatus] = useState<string | null>(null);

  // Cost security state
  const [costConfig, setCostConfig] = useState<CostConfigData | null>(null);
  const [spendingSummary, setSpendingSummary] = useState<SpendingSummary | null>(null);
  const [killSwitchConfirm, setKillSwitchConfirm] = useState(false);
  const [editingCaps, setEditingCaps] = useState(false);
  const [capForm, setCapForm] = useState({ dailyCapUsd: 50, monthlyCapUsd: 500, evolutionDailyCapUsd: 25 });

  const getDateRange = useCallback(() => {
    const now = new Date();
    const start = new Date(now.getTime() - DATE_RANGE_MS[dateRange]);
    return { startDate: start.toISOString(), endDate: now.toISOString() };
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

      // Load cost security data
      const [configRes, spendingRes] = await Promise.all([
        getLLMCostConfigAction(),
        getSpendingSummaryAction(),
      ]);
      if (configRes.success && configRes.data) {
        setCostConfig(configRes.data);
        setCapForm({
          dailyCapUsd: configRes.data.dailyCapUsd,
          monthlyCapUsd: configRes.data.monthlyCapUsd,
          evolutionDailyCapUsd: configRes.data.evolutionDailyCapUsd,
        });
      }
      if (spendingRes.success && spendingRes.data) {
        setSpendingSummary(spendingRes.data);
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

  const handleToggleKillSwitch = async () => {
    const newState = !costConfig?.killSwitchEnabled;
    const result = await toggleKillSwitchAction(newState);
    if (result.success) {
      setCostConfig(prev => prev ? { ...prev, killSwitchEnabled: newState } : null);
      setKillSwitchConfirm(false);
    } else {
      setError(result.error?.message || 'Failed to toggle kill switch');
    }
  };

  const handleUpdateCaps = async () => {
    const updates = [
      { key: 'daily_cap_usd', value: capForm.dailyCapUsd },
      { key: 'monthly_cap_usd', value: capForm.monthlyCapUsd },
      { key: 'evolution_daily_cap_usd', value: capForm.evolutionDailyCapUsd },
    ];
    for (const { key, value } of updates) {
      const result = await updateLLMCostConfigAction(key, value);
      if (!result.success) {
        setError(result.error?.message || `Failed to update ${key}`);
        return;
      }
    }
    setEditingCaps(false);
    loadData();
  };

  const maxDailyCost = Math.max(...dailyCosts.map(d => d.totalCost), 0.01);

  return (
    <div className="space-y-6">
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
            onChange={(e) => setDateRange(e.target.value as DateRangeKey)}
            className="px-3 py-2 border border-[var(--border-color)] rounded-md bg-[var(--bg-secondary)] text-[var(--text-primary)]"
          >
            <option value="1m">Last minute</option>
            <option value="1h">Last hour</option>
            <option value="1d">Last day</option>
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

      {(summary?.nullCostCount ?? 0) > 0 && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/50 rounded-md text-sm flex items-center gap-2">
          <span className="text-amber-500 font-medium">{summary?.nullCostCount.toLocaleString()}</span>
          <span className="text-[var(--text-secondary)]">records missing cost data</span>
          <span className="text-[var(--text-muted)]">-</span>
          <span className="text-[var(--text-muted)]">Click Backfill Costs to fix</span>
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
          <div className="p-4 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)]">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">Spending Gate</h2>
              <div className="flex items-center gap-3">
                {killSwitchConfirm ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-[var(--text-muted)]">
                      {costConfig?.killSwitchEnabled ? 'Re-enable LLM calls?' : 'Block ALL LLM calls?'}
                    </span>
                    <button onClick={handleToggleKillSwitch} className="px-3 py-1 bg-red-600 text-white rounded text-sm">
                      Confirm
                    </button>
                    <button onClick={() => setKillSwitchConfirm(false)} className="px-3 py-1 border border-[var(--border-color)] rounded text-sm">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setKillSwitchConfirm(true)}
                    className={`px-3 py-1 rounded text-sm font-medium ${
                      costConfig?.killSwitchEnabled
                        ? 'bg-red-900/30 text-red-400 border border-red-600'
                        : 'bg-green-900/30 text-green-400 border border-green-600'
                    }`}
                  >
                    Kill Switch: {costConfig?.killSwitchEnabled ? 'ON' : 'OFF'}
                  </button>
                )}
              </div>
            </div>

            {spendingSummary && (
              <div className="space-y-3">
                {spendingSummary.daily.map((d) => (
                  <ProgressBar
                    key={d.category}
                    value={d.totalCostUsd}
                    max={d.cap}
                    label={`${d.category.replace('_', '-')} daily`}
                    detail={`$${d.totalCostUsd.toFixed(2)} / $${d.cap.toFixed(2)} (${d.callCount} calls)`}
                  />
                ))}
                <ProgressBar
                  value={spendingSummary.monthlyTotal}
                  max={spendingSummary.monthlyCap}
                  label="Monthly total"
                  detail={`$${spendingSummary.monthlyTotal.toFixed(2)} / $${spendingSummary.monthlyCap.toFixed(2)}`}
                />
              </div>
            )}

            <div className="mt-4 pt-4 border-t border-[var(--border-color)]">
              {editingCaps ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs text-[var(--text-muted)]">Daily Cap ($)</label>
                      <input type="number" min="0" step="1" value={capForm.dailyCapUsd}
                        onChange={(e) => setCapForm(prev => ({ ...prev, dailyCapUsd: Number(e.target.value) }))}
                        className="w-full px-2 py-1 border border-[var(--border-color)] rounded bg-[var(--bg-secondary)] text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--text-muted)]">Monthly Cap ($)</label>
                      <input type="number" min="0" step="1" value={capForm.monthlyCapUsd}
                        onChange={(e) => setCapForm(prev => ({ ...prev, monthlyCapUsd: Number(e.target.value) }))}
                        className="w-full px-2 py-1 border border-[var(--border-color)] rounded bg-[var(--bg-secondary)] text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--text-muted)]">Evolution Daily ($)</label>
                      <input type="number" min="0" step="1" value={capForm.evolutionDailyCapUsd}
                        onChange={(e) => setCapForm(prev => ({ ...prev, evolutionDailyCapUsd: Number(e.target.value) }))}
                        className="w-full px-2 py-1 border border-[var(--border-color)] rounded bg-[var(--bg-secondary)] text-sm"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleUpdateCaps} className="px-3 py-1 bg-blue-600 text-white rounded text-sm">Save</button>
                    <button onClick={() => setEditingCaps(false)} className="px-3 py-1 border border-[var(--border-color)] rounded text-sm">Cancel</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setEditingCaps(true)} className="text-sm text-blue-400 hover:text-blue-300">
                  Edit spending caps
                </button>
              )}
            </div>
          </div>

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
                    <th className="p-3 text-right">System Pricing</th>
                    <th className="p-3 text-right">Total Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {modelCosts.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-4 text-center text-[var(--text-muted)]">
                        No data for this period
                      </td>
                    </tr>
                  ) : (
                    modelCosts.map((model) => {
                      const pricing = getModelPricing(model.model);
                      return (
                        <tr key={model.model} className="border-t border-[var(--border-color)]">
                          <td className="p-3 font-mono text-xs">{model.model || 'unknown'}</td>
                          <td className="p-3 text-right">{formatNumber(model.callCount)}</td>
                          <td className="p-3 text-right">{formatNumber(model.promptTokens)}</td>
                          <td className="p-3 text-right">{formatNumber(model.completionTokens)}</td>
                          <td className="p-3 text-right">{formatNumber(model.reasoningTokens)}</td>
                          <td className="p-3 text-right text-[var(--text-muted)] text-xs">
                            ${pricing.inputPer1M}/${pricing.outputPer1M} per 1M
                          </td>
                          <td className="p-3 text-right font-semibold">{formatCost(model.totalCost)}</td>
                        </tr>
                      );
                    })
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
