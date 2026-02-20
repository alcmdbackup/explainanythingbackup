/**
 * Summary metric cards for the optimization dashboard.
 * Displays total runs, strategies, spend, and best performers.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCost, formatElo } from '@evolution/lib/utils/formatters';

interface OptimizationSummary {
  totalRuns: number;
  totalStrategies: number;
  totalSpentUsd: number;
  avgEloPerDollar: number | null;
  bestStrategy: { name: string; avgElo: number } | null;
  topAgent: { name: string; eloPerDollar: number } | null;
}

interface CostSummaryCardsProps {
  summary: OptimizationSummary | null;
  loading: boolean;
  expanded?: boolean;
}

function MetricCard({
  label,
  value,
  subValue,
  loading,
}: {
  label: string;
  value: string | number;
  subValue?: string;
  loading: boolean;
}) {
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
          <>
            <div className="text-2xl font-display font-bold text-[var(--text-primary)]">
              {value}
            </div>
            {subValue && (
              <p className="text-xs font-ui text-[var(--text-muted)] mt-1">{subValue}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function CostSummaryCards({ summary, loading, expanded }: CostSummaryCardsProps) {
  const cards = [
    {
      label: 'Total Runs',
      value: summary?.totalRuns ?? 0,
      subValue: `${summary?.totalStrategies ?? 0} unique strategies`,
    },
    {
      label: 'Total Spent',
      value: formatCost(summary?.totalSpentUsd ?? 0),
      subValue: undefined,
    },
    {
      label: 'Avg Elo/$',
      value: summary?.avgEloPerDollar != null ? formatElo(summary.avgEloPerDollar) : '-',
      subValue: 'Elo gain per dollar',
    },
    {
      label: 'Best Strategy',
      value: summary?.bestStrategy ? formatElo(summary.bestStrategy.avgElo) : '-',
      subValue: summary?.bestStrategy?.name ?? 'No data',
    },
  ];

  // Expanded view adds more cards
  const expandedCards = expanded
    ? [
        ...cards,
        {
          label: 'Top Agent',
          value: summary?.topAgent ? formatElo(summary.topAgent.eloPerDollar) : '-',
          subValue: summary?.topAgent?.name ?? 'No data',
        },
        {
          label: 'Strategies',
          value: summary?.totalStrategies ?? 0,
          subValue: 'Unique configurations',
        },
      ]
    : cards;

  return (
    <div className={`grid gap-4 ${expanded ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-6' : 'grid-cols-2 md:grid-cols-4'}`}>
      {expandedCards.map((card) => (
        <MetricCard
          key={card.label}
          label={card.label}
          value={card.value}
          subValue={card.subValue}
          loading={loading}
        />
      ))}
    </div>
  );
}
