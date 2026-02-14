/**
 * Display component for strategy configuration details.
 * Shows models, iterations, budget allocation with full agent names and redistribution preview.
 */

import type { StrategyConfig } from '@/lib/evolution/core/strategyConfig';
import { computeEffectiveBudgetCaps, REQUIRED_AGENTS } from '@/lib/evolution/core/budgetRedistribution';
import { DEFAULT_EVOLUTION_CONFIG } from '@/lib/evolution/config';
import type { AgentName } from '@/lib/evolution/core/pipeline';

const AGENT_LABELS: Record<string, string> = {
  generation: 'Generation',
  calibration: 'Calibration',
  tournament: 'Tournament',
  evolution: 'Evolution',
  reflection: 'Reflection',
  debate: 'Debate',
  iterativeEditing: 'Iterative Editing',
  treeSearch: 'Tree Search',
  outlineGeneration: 'Outline Gen',
  sectionDecomposition: 'Section Decomp',
  flowCritique: 'Flow Critique',
};

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

  // Merge with defaults for backward compat (old configs may lack some agents)
  const baseCaps = { ...DEFAULT_EVOLUTION_CONFIG.budgetCaps, ...config.budgetCaps };
  const effectiveCaps = computeEffectiveBudgetCaps(
    baseCaps,
    config.enabledAgents,
    !!config.singleArticle,
  );

  // Determine which agents are enabled
  const enabledSet = config.enabledAgents ? new Set<string>(config.enabledAgents) : null;
  const isEnabled = (agent: string) => {
    if (REQUIRED_AGENTS.includes(agent as AgentName)) return true;
    return enabledSet ? enabledSet.has(agent) : true;
  };

  const budgetEntries = Object.entries(baseCaps).sort(([, a], [, b]) => b - a);

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
          {config.singleArticle && (
            <ConfigRow label="Mode" value="Single Article" highlight />
          )}
          {hasAgentOverrides && (
            <div className="pt-2 border-t border-[var(--border-default)] mt-2">
              <span className="font-ui text-xs text-[var(--accent-copper)]">
                Agent Overrides:
              </span>
              {Object.entries(config.agentModels!).map(([agent, model]) => (
                <ConfigRow key={agent} label={AGENT_LABELS[agent] ?? agent} value={model} highlight />
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
        <div className="bg-[var(--surface-primary)] rounded-page p-3 space-y-1">
          {budgetEntries.map(([agent, basePct]) => {
            const enabled = isEnabled(agent);
            const effectivePct = effectiveCaps[agent];
            const showRedistributed = enabled && effectivePct != null && Math.abs(effectivePct - basePct) > 0.001;
            return (
              <div
                key={agent}
                className={`flex items-center justify-between py-0.5 ${!enabled ? 'opacity-40' : ''}`}
                data-testid={`budget-row-${agent}`}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${enabled ? 'bg-[var(--status-success)]' : 'bg-[var(--text-muted)]'}`}
                    title={enabled ? 'Enabled' : 'Disabled'}
                  />
                  <span className="font-ui text-xs text-[var(--text-secondary)]">
                    {AGENT_LABELS[agent] ?? agent}
                  </span>
                </div>
                <span className="font-mono text-xs text-[var(--text-primary)]">
                  {(basePct * 100).toFixed(0)}%
                  {showRedistributed && (
                    <span className="text-[var(--accent-gold)] ml-1">
                      → {(effectivePct * 100).toFixed(0)}%
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
