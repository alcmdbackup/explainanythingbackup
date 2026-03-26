/**
 * Display component for strategy configuration details.
 * Shows models, iterations, budget allocation with agent names.
 */

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

interface StrategyConfig {
  generationModel: string;
  judgeModel: string;
  iterations: number;
  budgetUsd?: number;
  singleArticle?: boolean;
  enabledAgents?: string[];
  agentModels?: Record<string, string>;
}

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

export function StrategyConfigDisplay({ config: raw, showRaw }: StrategyConfigDisplayProps): JSX.Element {
  const config = raw as StrategyConfig;

  if (showRaw) {
    return (
      <pre className="text-xs font-mono bg-[var(--surface-primary)] p-3 rounded-page overflow-auto max-h-64 text-[var(--text-secondary)]">
        {JSON.stringify(config, null, 2)}
      </pre>
    );
  }

  const hasAgentOverrides = config.agentModels && Object.keys(config.agentModels).length > 0;
  const enabledSet = config.enabledAgents ? new Set<string>(config.enabledAgents) : null;
  const isEnabled = (agent: string) => {
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
          <ConfigRow label="Iterations" value={String(config.iterations ?? '—')} />
          {config.budgetUsd != null && (
            <ConfigRow label="Budget" value={`$${config.budgetUsd.toFixed(2)}`} highlight />
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
