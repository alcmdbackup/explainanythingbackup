'use client';
/**
 * Elo Budget Optimization dashboard.
 * Provides strategy and agent analysis with visualizations for optimizing Elo per dollar.
 */

import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import {
  getStrategyLeaderboardAction,
  getAgentROILeaderboardAction,
  getOptimizationSummaryAction,
  getStrategyParetoAction,
  type StrategyLeaderboardEntry,
  type ParetoPoint,
} from '@/lib/services/eloBudgetActions';
import type { AgentROI } from '@/lib/evolution/core/adaptiveAllocation';
import { StrategyLeaderboard } from './_components/StrategyLeaderboard';
import { StrategyParetoChart } from './_components/StrategyParetoChart';
import { AgentROILeaderboard } from './_components/AgentROILeaderboard';
import { CostSummaryCards } from './_components/CostSummaryCards';
import { CostBreakdownPie } from './_components/CostBreakdownPie';
import { CostAccuracyPanel } from './_components/CostAccuracyPanel';

type TabId = 'strategy' | 'agent' | 'cost' | 'accuracy';

const TABS: { id: TabId; label: string }[] = [
  { id: 'strategy', label: 'Strategy Analysis' },
  { id: 'agent', label: 'Agent Analysis' },
  { id: 'cost', label: 'Cost Analysis' },
  { id: 'accuracy', label: 'Cost Accuracy' },
];

interface OptimizationSummary {
  totalRuns: number;
  totalStrategies: number;
  totalSpentUsd: number;
  avgEloPerDollar: number | null;
  bestStrategy: { name: string; avgElo: number } | null;
  topAgent: { name: string; eloPerDollar: number } | null;
}

export default function OptimizationDashboardPage() {
  const [activeTab, setActiveTab] = useState<TabId>('strategy');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Data state
  const [strategies, setStrategies] = useState<StrategyLeaderboardEntry[]>([]);
  const [paretoPoints, setParetoPoints] = useState<ParetoPoint[]>([]);
  const [agents, setAgents] = useState<AgentROI[]>([]);
  const [summary, setSummary] = useState<OptimizationSummary | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [strategyRes, paretoRes, agentRes, summaryRes] = await Promise.all([
        getStrategyLeaderboardAction(),
        getStrategyParetoAction(),
        getAgentROILeaderboardAction(),
        getOptimizationSummaryAction(),
      ]);

      if (strategyRes.success && strategyRes.data) {
        setStrategies(strategyRes.data);
      }
      if (paretoRes.success && paretoRes.data) {
        setParetoPoints(paretoRes.data);
      }
      if (agentRes.success && agentRes.data) {
        setAgents(agentRes.data);
      }
      if (summaryRes.success && summaryRes.data) {
        setSummary(summaryRes.data);
      }

      // Check for any errors
      const errors = [strategyRes, paretoRes, agentRes, summaryRes]
        .filter(r => !r.success)
        .map(r => r.error);

      if (errors.length > 0) {
        console.warn('Some data failed to load:', errors);
      }
    } catch (err) {
      setError(String(err));
      toast.error('Failed to load optimization data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-4xl font-display font-bold text-[var(--text-primary)]">
            Elo Optimization
          </h1>
          <p className="text-[var(--text-muted)] font-body text-sm mt-1">
            Analyze strategy and agent performance to maximize Elo per dollar
          </p>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="px-4 py-2 font-ui text-sm border border-[var(--border-default)] rounded-page text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] disabled:opacity-50 transition-scholar"
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--border-default)]">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 font-ui text-sm transition-colors ${
              activeTab === tab.id
                ? 'border-b-2 border-[var(--accent-gold)] text-[var(--text-primary)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-[var(--status-error)]/10 border border-[var(--status-error)] rounded-page text-[var(--status-error)] font-body text-sm">
          {error}
        </div>
      )}

      {/* Strategy Analysis Tab */}
      {activeTab === 'strategy' && (
        <div className="space-y-6">
          {/* Summary cards at top */}
          <CostSummaryCards summary={summary} loading={loading} />

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Leaderboard */}
            <div className="xl:col-span-1">
              <StrategyLeaderboard strategies={strategies} loading={loading} />
            </div>

            {/* Pareto Chart */}
            <div className="xl:col-span-1">
              <StrategyParetoChart points={paretoPoints} loading={loading} />
            </div>
          </div>
        </div>
      )}

      {/* Agent Analysis Tab */}
      {activeTab === 'agent' && (
        <div className="space-y-6">
          <AgentROILeaderboard agents={agents} loading={loading} />
        </div>
      )}

      {/* Cost Analysis Tab */}
      {activeTab === 'cost' && (
        <div className="space-y-6">
          <CostSummaryCards summary={summary} loading={loading} expanded />

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Cost distribution pie chart */}
            <CostBreakdownPie agents={agents} loading={loading} />

            {/* Agent ROI for cost context */}
            <AgentROILeaderboard agents={agents} loading={loading} />
          </div>
        </div>
      )}

      {/* Cost Accuracy Tab */}
      {activeTab === 'accuracy' && (
        <CostAccuracyPanel />
      )}
    </div>
  );
}
