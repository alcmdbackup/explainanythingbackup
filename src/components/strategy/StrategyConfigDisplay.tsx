/**
 * Display component for strategy configuration details.
 * Shows models, iterations, budget allocation with agent names.
 *
 * Moved from src/app/admin/evolution/_components/ in improvements_to_edit_page_evolution_20260630
 * Phase 2 so the public /edit picker can render it in the "Show config" modal.
 * Uses the schema-derived StrategyConfig type from evolution/lib/pipeline/infra/types
 * (the local duplicate interface was removed as part of the same project).
 */
import type { StrategyConfig } from '@evolution/lib/pipeline/infra/types';
import type { IterationConfig, IterationAgentType } from '@evolution/lib/schemas';

const REQUIRED_AGENTS = ['generation', 'ranking', 'proximity'];

const AGENT_LABELS: Record<string, string> = {
  generation: 'Generation',
  ranking: 'Ranking',
  evolution: 'Evolution',
  reflection: 'Reflection',
  debate: 'Debate',
  iterativeEditing: 'Iterative Editing',
  treeSearch: 'Tree Search',
  outlineGeneration: 'Outline Gen',
  sectionDecomposition: 'Section Decomp',
  flowCritique: 'Flow Critique',
  proximity: 'Proximity',
  metaReview: 'Meta Review',
};

interface StrategyConfigDisplayProps {
  config: StrategyConfig | Record<string, unknown>;
  showRaw?: boolean;
}

function ConfigRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }): JSX.Element {
  return (
    <div className="flex justify-between items-center py-1">
      <span className="font-ui text-xs text-[var(--text-muted)]">{label}</span>
      <span className={`font-mono text-xs ${highlight ? 'text-[var(--accent-gold)] font-medium' : 'text-[var(--text-primary)]'}`}>
        {value}
      </span>
    </div>
  );
}

function fmtBudgetFraction(fraction: number, budgetUsd?: number): string {
  const pct = `${(fraction * 100).toFixed(0)}% of budget`;
  return budgetUsd != null ? `${pct} ($${(fraction * budgetUsd).toFixed(3)})` : pct;
}

// Loose accessors — the schema-derived StrategyConfig doesn't include the
// display-only fields agentModels / enabledAgents / singleArticle etc., which
// are legacy shapes still present on some persisted rows. Cast at read.
interface LooseConfig extends Partial<StrategyConfig> {
  singleArticle?: boolean;
  enabledAgents?: string[];
  agentModels?: Record<string, string>;
  iterations?: number;
  maxVariantsToGenerateFromSeedArticle?: number;
  budgetBufferAfterParallel?: number;
  budgetBufferAfterSequential?: number;
}

function BudgetFloorRows({ config }: { config: LooseConfig }): JSX.Element {
  const pF = config.minBudgetAfterParallelFraction ?? config.budgetBufferAfterParallel;
  const pM = config.minBudgetAfterParallelAgentMultiple;
  const sF = config.minBudgetAfterSequentialFraction ?? config.budgetBufferAfterSequential;
  const sM = config.minBudgetAfterSequentialAgentMultiple;

  return (
    <>
      {pF != null && pF > 0 && <ConfigRow label="Min After Parallel" value={fmtBudgetFraction(pF, config.budgetUsd)} highlight />}
      {pM != null && pM > 0 && <ConfigRow label="Min After Parallel" value={`${pM}× agent cost (runtime)`} highlight />}
      {sF != null && sF > 0 && <ConfigRow label="Min After Sequential" value={fmtBudgetFraction(sF, config.budgetUsd)} highlight />}
      {sM != null && sM > 0 && <ConfigRow label="Min After Sequential" value={`${sM}× agent cost (runtime)`} highlight />}
    </>
  );
}

export function StrategyConfigDisplay({ config: raw, showRaw }: StrategyConfigDisplayProps): JSX.Element {
  const config = raw as LooseConfig;

  if (showRaw) {
    return (
      <pre className="text-xs font-mono bg-[var(--surface-primary)] p-3 rounded-page overflow-auto max-h-64 text-[var(--text-secondary)]">
        {JSON.stringify(config, null, 2)}
      </pre>
    );
  }

  const hasAgentOverrides = config.agentModels && Object.keys(config.agentModels).length > 0;
  const enabledSet = config.enabledAgents ? new Set<string>(config.enabledAgents) : null;
  const isEnabled = (agent: string): boolean => {
    if (REQUIRED_AGENTS.includes(agent)) return true;
    return enabledSet ? enabledSet.has(agent) : true;
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="space-y-2">
        <h4 className="font-display text-lg font-medium text-[var(--text-muted)]">Models</h4>
        <div className="bg-[var(--surface-primary)] rounded-page p-3 space-y-1">
          <ConfigRow label="Generation" value={config.generationModel ?? '—'} />
          <ConfigRow label="Judge" value={config.judgeModel ?? '—'} />
        </div>
      </div>
      <div className="space-y-2">
        <h4 className="font-display text-lg font-medium text-[var(--text-muted)]">Execution</h4>
        <div className="bg-[var(--surface-primary)] rounded-page p-3 space-y-1">
          <ConfigRow label="Iterations" value={String(config.iterations ?? config.iterationConfigs?.length ?? '—')} />
          {config.budgetUsd != null && (
            <ConfigRow label="Budget" value={`$${config.budgetUsd.toFixed(2)}`} highlight />
          )}
          {config.maxVariantsToGenerateFromSeedArticle != null && (
            <ConfigRow label="Max Variants" value={String(config.maxVariantsToGenerateFromSeedArticle)} />
          )}
          {config.maxComparisonsPerVariant != null && (
            <ConfigRow label="Max Comparisons/Variant" value={String(config.maxComparisonsPerVariant)} />
          )}
          <BudgetFloorRows config={config} />
          {config.generationTemperature != null && (
            <ConfigRow label="Gen Temperature" value={String(config.generationTemperature)} />
          )}
          {config.singleArticle && <ConfigRow label="Mode" value="Single Article" highlight />}
          {hasAgentOverrides && (
            <div className="pt-2 border-t border-[var(--border-default)] mt-2">
              <span className="font-ui text-xs text-[var(--accent-copper)]">Agent Overrides:</span>
              {Object.entries(config.agentModels!).map(([agent, model]) => (
                <ConfigRow key={agent} label={AGENT_LABELS[agent] ?? agent} value={model} highlight />
              ))}
            </div>
          )}
        </div>
      </div>
      {config.generationGuidance && config.generationGuidance.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-display text-lg font-medium text-[var(--text-muted)]">Generation Guidance</h4>
          <div className="bg-[var(--surface-primary)] rounded-page p-3 space-y-1">
            {config.generationGuidance.map((entry) => (
              <ConfigRow key={entry.tactic} label={entry.tactic} value={`${entry.percent}%`} highlight={entry.percent >= 50} />
            ))}
          </div>
        </div>
      )}
      {config.iterationConfigs && config.iterationConfigs.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-display text-lg font-medium text-[var(--text-muted)]">Iterations</h4>
          <div className="bg-[var(--surface-primary)] rounded-page p-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left border-b border-[var(--border-default)]">
                  <th className="py-1 pr-3 font-ui text-[var(--text-muted)]">#</th>
                  <th className="py-1 pr-3 font-ui text-[var(--text-muted)]">Type</th>
                  <th className="py-1 pr-3 font-ui text-[var(--text-muted)] text-right">Budget</th>
                  <th className="py-1 pr-3 font-ui text-[var(--text-muted)]">Tactic Guidance</th>
                </tr>
              </thead>
              <tbody>
                {config.iterationConfigs.map((ic, idx: number) => {
                  const budgetDollar = config.budgetUsd != null ? (ic.budgetPercent / 100) * config.budgetUsd : null;
                  const agentType = ic.agentType as IterationAgentType;
                  return (
                    <tr key={idx} className="border-b border-[var(--border-subtle)] last:border-0">
                      <td className="py-1 pr-3 font-mono">{idx + 1}</td>
                      <td className="py-1 pr-3">
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold uppercase tracking-wider ${
                            agentType === 'generate'
                              ? 'bg-blue-500/20 text-blue-400'
                              : agentType === 'reflect_and_generate'
                                ? 'bg-amber-500/20 text-amber-400'
                                : 'bg-purple-500/20 text-purple-400'
                          }`}
                        >
                          {agentType}
                        </span>
                      </td>
                      <td className="py-1 pr-3 text-right font-mono">
                        {ic.budgetPercent}%
                        {budgetDollar != null && (
                          <span className="text-[var(--text-muted)] ml-1">(${budgetDollar.toFixed(2)})</span>
                        )}
                      </td>
                      <td className="py-1 pr-3 text-[var(--text-muted)]">
                        {ic.generationGuidance && ic.generationGuidance.length > 0
                          ? ic.generationGuidance.map((g) => `${g.tactic}: ${g.percent}%`).join(', ')
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="space-y-2">
        <h4 className="font-display text-lg font-medium text-[var(--text-muted)]">Agents</h4>
        <div className="bg-[var(--surface-primary)] rounded-page p-3 space-y-1">
          {Object.keys(AGENT_LABELS).map((agent) => {
            const enabled = isEnabled(agent);
            return (
              <div key={agent} className={`flex items-center gap-1.5 py-0.5 ${!enabled ? 'opacity-40' : ''}`} data-testid={`agent-row-${agent}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${enabled ? 'bg-[var(--status-success)]' : 'bg-[var(--text-muted)]'}`} title={enabled ? 'Enabled' : 'Disabled'} />
                <span className="font-ui text-xs text-[var(--text-secondary)]">{AGENT_LABELS[agent] ?? agent}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
