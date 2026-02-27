// Table showing agent-level Elo attribution aggregated across all runs for an article.
// Highlights which creating agents contributed most to Elo improvement.

'use client';

import { useEffect, useState } from 'react';
import { getArticleAgentAttributionAction, type ArticleAgentAttribution as AgentAttr } from '@evolution/services/articleDetailActions';
import { AgentAttributionSummary } from '@evolution/components/evolution/AttributionBadge';
import { EmptyState } from '@evolution/components/evolution';

interface ArticleAgentAttributionProps {
  explanationId: number;
}

export function ArticleAgentAttribution({ explanationId }: ArticleAgentAttributionProps): JSX.Element {
  const [agents, setAgents] = useState<AgentAttr[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getArticleAgentAttributionAction(explanationId).then(res => {
      if (res.success && res.data) setAgents(res.data);
      setLoading(false);
    });
  }, [explanationId]);

  if (loading) {
    return <div className="h-40 bg-[var(--surface-elevated)] rounded-book animate-pulse" />;
  }

  if (agents.length === 0) {
    return <EmptyState message="No agent attribution data yet." suggestion="Run at least one evolution pipeline to see agent contributions." />;
  }

  return (
    <div className="border border-[var(--border-default)] rounded-book overflow-hidden" data-testid="article-agent-attribution">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[var(--surface-secondary)] text-xs text-[var(--text-muted)]">
            <th className="text-left px-4 py-2 font-medium">Agent</th>
            <th className="text-right px-4 py-2 font-medium">Runs</th>
            <th className="text-right px-4 py-2 font-medium">Variants</th>
            <th className="text-right px-4 py-2 font-medium">Avg Gain</th>
          </tr>
        </thead>
        <tbody>
          {agents.map(agent => (
            <tr key={agent.agentName} className="border-t border-[var(--border-default)]">
              <td className="px-4 py-2 font-mono text-xs text-[var(--text-primary)]">{agent.agentName}</td>
              <td className="px-4 py-2 text-right text-[var(--text-secondary)]">{agent.runCount}</td>
              <td className="px-4 py-2 text-right text-[var(--text-secondary)]">{agent.totalVariants}</td>
              <td className="px-4 py-2 text-right">
                <AgentAttributionSummary agentName={agent.agentName} avgGain={agent.avgGain} avgCi={agent.avgCi} variantCount={agent.totalVariants} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
