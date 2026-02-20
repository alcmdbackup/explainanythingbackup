/**
 * Agent ROI leaderboard showing which agents produce the most Elo per dollar.
 * Helps identify where to invest budget for maximum effectiveness.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { AgentROI } from '@evolution/services/eloBudgetActions';

interface AgentROILeaderboardProps {
  agents: AgentROI[];
  loading: boolean;
}

function ROIBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 bg-[var(--surface-primary)] rounded-page h-2 overflow-hidden">
        <div
          className="h-full rounded-page bg-gradient-to-r from-[var(--accent-copper)] to-[var(--accent-gold)]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="font-mono text-xs text-[var(--text-secondary)] w-12 text-right">
        {value.toFixed(0)}
      </span>
    </div>
  );
}

export function AgentROILeaderboard({ agents, loading }: AgentROILeaderboardProps) {
  const maxEpd = Math.max(...agents.map(a => a.avgEloPerDollar), 1);

  return (
    <Card className="bg-[var(--surface-secondary)] paper-texture">
      <CardHeader>
        <CardTitle className="text-xl font-display text-[var(--text-primary)]">
          Agent ROI Leaderboard
        </CardTitle>
        <p className="text-xs font-ui text-[var(--text-muted)] mt-1">
          Which agents produce the most Elo improvement per dollar spent?
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface-elevated)]">
              <tr>
                <th className="p-3 text-left font-ui text-sm text-[var(--text-muted)]">
                  Agent
                </th>
                <th className="p-3 text-right font-ui text-sm text-[var(--text-muted)]">
                  Avg Cost
                </th>
                <th className="p-3 text-right font-ui text-sm text-[var(--text-muted)]">
                  Avg Elo Gain
                </th>
                <th className="p-3 font-ui text-sm text-[var(--text-muted)] w-48">
                  Elo per Dollar
                </th>
                <th className="p-3 text-right font-ui text-sm text-[var(--text-muted)]">
                  Samples
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center">
                    <div className="flex items-center justify-center gap-2 text-[var(--text-muted)]">
                      <div className="w-4 h-4 border-2 border-[var(--accent-gold)] border-t-transparent rounded-full animate-spin" />
                      <span className="font-ui">Loading agent data...</span>
                    </div>
                  </td>
                </tr>
              ) : agents.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-[var(--text-muted)] font-body">
                    No agent ROI data yet. Run evolution experiments to collect agent metrics.
                  </td>
                </tr>
              ) : (
                agents.map((agent, i) => (
                  <tr
                    key={agent.agentName}
                    className="border-t border-[var(--border-default)] hover:bg-[var(--surface-elevated)] transition-colors"
                  >
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-6 h-6 flex items-center justify-center rounded-page text-xs font-ui font-medium ${
                            i === 0
                              ? 'bg-[var(--accent-gold)] text-[var(--surface-primary)]'
                              : i === 1
                              ? 'bg-[var(--accent-copper)] text-[var(--surface-primary)]'
                              : 'bg-[var(--surface-elevated)] text-[var(--text-muted)]'
                          }`}
                        >
                          {i + 1}
                        </span>
                        <span className="font-ui font-medium text-[var(--text-primary)] capitalize">
                          {agent.agentName}
                        </span>
                      </div>
                    </td>
                    <td className="p-3 text-right font-mono text-[var(--text-secondary)]">
                      ${agent.avgCostUsd.toFixed(4)}
                    </td>
                    <td className="p-3 text-right font-mono text-[var(--text-secondary)]">
                      {agent.avgEloGain > 0 ? '+' : ''}{agent.avgEloGain.toFixed(1)}
                    </td>
                    <td className="p-3">
                      <ROIBar value={agent.avgEloPerDollar} max={maxEpd} />
                    </td>
                    <td className="p-3 text-right font-mono text-[var(--text-muted)]">
                      {agent.sampleSize}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Insights */}
        {agents.length > 0 && (
          <div className="p-4 border-t border-[var(--border-default)] bg-[var(--surface-elevated)]">
            <h4 className="font-display text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
              Insights
            </h4>
            <ul className="space-y-1 text-xs font-body text-[var(--text-secondary)]">
              {agents[0] && (
                <li>
                  <span className="text-[var(--accent-gold)] font-medium">{agents[0].agentName}</span>
                  {' '}is your most efficient agent at{' '}
                  <span className="font-mono">{agents[0].avgEloPerDollar.toFixed(0)}</span> Elo/$
                </li>
              )}
              {agents.length > 1 && agents[agents.length - 1].avgEloPerDollar < agents[0].avgEloPerDollar * 0.3 && (
                <li>
                  Consider reducing budget for{' '}
                  <span className="text-[var(--text-primary)] font-medium">{agents[agents.length - 1].agentName}</span>
                  {' '}which has low ROI
                </li>
              )}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
