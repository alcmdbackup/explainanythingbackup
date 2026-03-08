// Strategy detail page: shows config, performance stats, and run history for a single strategy.
// Server component fetches data, client StrategyDetailContent renders tabs.

import { notFound } from 'next/navigation';
import { EvolutionBreadcrumb } from '@evolution/components/evolution';
import { getStrategyDetailAction } from '@evolution/services/strategyRegistryActions';
import { getStrategyRunsAction, type StrategyRunEntry } from '@evolution/services/eloBudgetActions';
import { StrategyDetailContent } from './StrategyDetailContent';

interface Props {
  params: Promise<{ strategyId: string }>;
}

export default async function StrategyDetailPage({ params }: Props) {
  const { strategyId } = await params;
  const [strategyResult, runsResult] = await Promise.all([
    getStrategyDetailAction(strategyId),
    getStrategyRunsAction(strategyId, 50),
  ]);

  if (!strategyResult.success || !strategyResult.data) notFound();
  const strategy = strategyResult.data;
  const runs: StrategyRunEntry[] = runsResult.success && runsResult.data ? runsResult.data : [];

  return (
    <div className="space-y-6 pb-12">
      <EvolutionBreadcrumb
        items={[
          { label: 'Strategies', href: '/admin/evolution/strategies' },
          { label: strategy.name ?? strategy.label },
        ]}
      />
      <StrategyDetailContent strategy={strategy} runs={runs} strategyId={strategyId} />
    </div>
  );
}
