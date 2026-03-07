'use client';
/**
 * Rating Budget Optimization dashboard.
 * Provides strategy and agent analysis with visualizations for optimizing rating per dollar.
 */

import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { logger } from '@/lib/client_utilities';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EvolutionBreadcrumb } from '@evolution/components/evolution';
import {
  getStrategyLeaderboardAction,
  getAgentROILeaderboardAction,
  getOptimizationSummaryAction,
  getStrategyParetoAction,
  getRecommendedStrategyAction,
  type StrategyLeaderboardEntry,
  type ParetoPoint,
} from '@evolution/services/eloBudgetActions';
import type { AgentROI } from '@evolution/services/eloBudgetActions';
import { formatElo, formatCost } from '@evolution/lib/utils/formatters';
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

interface RecommendedStrategy {
  recommended: StrategyLeaderboardEntry | null;
  alternatives: StrategyLeaderboardEntry[];
  reasoning: string;
}

export default function OptimizationDashboardPage(): JSX.Element {
  const [activeTab, setActiveTab] = useState<TabId>('strategy');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [strategies, setStrategies] = useState<StrategyLeaderboardEntry[]>([]);
  const [paretoPoints, setParetoPoints] = useState<ParetoPoint[]>([]);
  const [agents, setAgents] = useState<AgentROI[]>([]);
  const [summary, setSummary] = useState<OptimizationSummary | null>(null);
  const [recommended, setRecommended] = useState<RecommendedStrategy | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [strategyRes, paretoRes, agentRes, summaryRes, recommendedRes] = await Promise.all([
        getStrategyLeaderboardAction(),
        getStrategyParetoAction(),
        getAgentROILeaderboardAction(),
        getOptimizationSummaryAction(),
        getRecommendedStrategyAction({ budgetUsd: 1.0, optimizeFor: 'elo' }),
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
      if (recommendedRes.success && recommendedRes.data) {
        setRecommended(recommendedRes.data);
      }

      const failedResults = [strategyRes, paretoRes, agentRes, summaryRes, recommendedRes]
        .filter(r => !r.success);
      if (failedResults.length > 0) {
        logger.debug('Some data failed to load:', failedResults.map(r => r.error));
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
      <EvolutionBreadcrumb items={[
        { label: 'Dashboard', href: '/admin/evolution-dashboard' },
        { label: 'Analysis' },
      ]} />
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-4xl font-display font-bold text-[var(--text-primary)]">
            Analysis
          </h1>
          <p className="text-[var(--text-muted)] font-body text-sm mt-1">
            Analyze strategy and agent performance to maximize rating per dollar
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

      {error && (
        <div className="p-3 bg-[var(--status-error)]/10 border border-[var(--status-error)] rounded-page text-[var(--status-error)] font-body text-sm">
          {error}
        </div>
      )}

      {activeTab === 'strategy' && (
        <div className="space-y-6">
          <CostSummaryCards summary={summary} loading={loading} />
          <RecommendedStrategyCard recommended={recommended} loading={loading} />
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <StrategyLeaderboard strategies={strategies} loading={loading} />
            <StrategyParetoChart points={paretoPoints} loading={loading} />
          </div>
        </div>
      )}

      {activeTab === 'agent' && (
        <div className="space-y-6">
          <AgentROILeaderboard agents={agents} loading={loading} />
        </div>
      )}

      {activeTab === 'cost' && (
        <div className="space-y-6">
          <CostSummaryCards summary={summary} loading={loading} expanded />
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <CostBreakdownPie agents={agents} loading={loading} />
            <AgentROILeaderboard agents={agents} loading={loading} />
          </div>
        </div>
      )}

      {activeTab === 'accuracy' && (
        <CostAccuracyPanel />
      )}

    </div>
  );
}

// ─── Recommended Strategy Card ──────────────────────────────────

function RecommendedStrategyCard({
  recommended,
  loading,
}: {
  recommended: RecommendedStrategy | null;
  loading: boolean;
}): JSX.Element | null {
  if (loading) {
    return (
      <Card className="bg-[var(--surface-secondary)] paper-texture">
        <CardContent className="p-6">
          <div className="h-6 w-48 bg-[var(--surface-elevated)] animate-pulse rounded-page" />
        </CardContent>
      </Card>
    );
  }

  if (!recommended) return null;

  const strategy = recommended.recommended;

  return (
    <Card className="bg-[var(--surface-secondary)] paper-texture border-[var(--accent-gold)]/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-display text-[var(--text-primary)]">
          Recommended Strategy
        </CardTitle>
      </CardHeader>
      <CardContent>
        {strategy ? (
          <div className="flex items-start justify-between">
            <div>
              <div className="font-ui font-medium text-[var(--text-primary)]">
                {strategy.name}
              </div>
              <div className="text-xs font-ui text-[var(--text-muted)] mt-0.5 max-w-md truncate">
                {strategy.label}
              </div>
              <div className="flex items-center gap-4 mt-2 text-sm">
                <span className="font-mono text-[var(--text-primary)]">
                  Rating: {formatElo(strategy.avgFinalElo)}
                </span>
                <span className="font-mono text-[var(--accent-gold)]">
                  Rating/$: {formatElo(strategy.avgEloPerDollar)}
                </span>
                <span className="font-mono text-[var(--text-secondary)]">
                  Cost: {formatCost(strategy.totalCostUsd / strategy.runCount)}
                </span>
                <span className="font-mono text-[var(--text-muted)]">
                  {strategy.runCount} runs
                </span>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm font-body text-[var(--text-muted)]">
            {recommended.reasoning}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
