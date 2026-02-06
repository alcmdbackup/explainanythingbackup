/**
 * Display component for strategy configuration details.
 * Shows models, iterations, budget allocation in a readable format.
 */

import type { StrategyConfig } from '@/lib/evolution/core/strategyConfig';

interface StrategyConfigDisplayProps {
  config: StrategyConfig;
  showRaw?: boolean;
}

function ConfigRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex justify-between items-center py-1">
      <span className="font-ui text-xs text-[var(--text-muted)]">{label}</span>
      <span
        className={`font-mono text-xs ${
          highlight
            ? 'text-[var(--accent-gold)] font-medium'
            : 'text-[var(--text-primary)]'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export function StrategyConfigDisplay({ config, showRaw }: StrategyConfigDisplayProps) {
  if (showRaw) {
    return (
      <pre className="text-xs font-mono bg-[var(--surface-primary)] p-3 rounded-page overflow-auto max-h-64 text-[var(--text-secondary)]">
        {JSON.stringify(config, null, 2)}
      </pre>
    );
  }

  const hasAgentOverrides = config.agentModels && Object.keys(config.agentModels).length > 0;
  const budgetEntries = Object.entries(config.budgetCaps).sort(([, a], [, b]) => b - a);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Models Section */}
      <div className="space-y-2">
        <h4 className="font-display text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
          Models
        </h4>
        <div className="bg-[var(--surface-primary)] rounded-page p-3 space-y-1">
          <ConfigRow label="Generation" value={config.generationModel} />
          <ConfigRow label="Judge" value={config.judgeModel} />
        </div>
      </div>

      {/* Execution Section */}
      <div className="space-y-2">
        <h4 className="font-display text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
          Execution
        </h4>
        <div className="bg-[var(--surface-primary)] rounded-page p-3 space-y-1">
          <ConfigRow label="Iterations" value={String(config.iterations)} />
          {hasAgentOverrides && (
            <div className="pt-2 border-t border-[var(--border-default)] mt-2">
              <span className="font-ui text-xs text-[var(--accent-copper)]">
                Agent Overrides:
              </span>
              {Object.entries(config.agentModels!).map(([agent, model]) => (
                <ConfigRow key={agent} label={agent} value={model} highlight />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Budget Allocation Section */}
      <div className="space-y-2">
        <h4 className="font-display text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
          Budget Allocation
        </h4>
        <div className="bg-[var(--surface-primary)] rounded-page p-3">
          <div className="flex flex-wrap gap-1">
            {budgetEntries.map(([agent, pct]) => (
              <span
                key={agent}
                className="px-2 py-1 bg-[var(--surface-elevated)] rounded-page font-mono text-xs text-[var(--text-secondary)]"
                title={`${agent}: ${(pct * 100).toFixed(0)}%`}
              >
                {agent.slice(0, 4)}: {(pct * 100).toFixed(0)}%
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
