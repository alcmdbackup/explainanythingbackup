/**
 * Strategy leaderboard table with sortable columns.
 * Shows strategy configs ranked by Elo, Elo/$, or consistency.
 */

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { StrategyLeaderboardEntry } from '@/lib/services/eloBudgetActions';
import { StrategyConfigDisplay } from './StrategyConfigDisplay';
import { StrategyDetail } from './StrategyDetail';

type SortField = 'avgFinalElo' | 'avgEloPerDollar' | 'runCount' | 'stddevFinalElo';
type SortDir = 'asc' | 'desc';

interface StrategyLeaderboardProps {
  strategies: StrategyLeaderboardEntry[];
  loading: boolean;
}

export function StrategyLeaderboard({ strategies, loading }: StrategyLeaderboardProps) {
  const [sortField, setSortField] = useState<SortField>('avgEloPerDollar');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailStrategy, setDetailStrategy] = useState<StrategyLeaderboardEntry | null>(null);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      // Default directions: higher is better except for stddev
      setSortDir(field === 'stddevFinalElo' ? 'asc' : 'desc');
    }
  };

  const sorted = [...strategies].sort((a, b) => {
    const aVal = a[sortField] ?? 0;
    const bVal = b[sortField] ?? 0;
    return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
  });

  const SortHeader = ({ field, label }: { field: SortField; label: string }) => (
    <th
      className="p-3 text-right font-ui text-sm text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-primary)] transition-colors"
      onClick={() => handleSort(field)}
    >
      {label}
      {sortField === field && (
        <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
      )}
    </th>
  );

  return (
    <Card className="bg-[var(--surface-secondary)] paper-texture">
      <CardHeader>
        <CardTitle className="text-xl font-display text-[var(--text-primary)]">
          Strategy Leaderboard
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface-elevated)]">
              <tr>
                <th className="p-3 text-left font-ui text-sm text-[var(--text-muted)]">
                  Strategy
                </th>
                <SortHeader field="avgFinalElo" label="Avg Elo" />
                <SortHeader field="avgEloPerDollar" label="Elo/$" />
                <SortHeader field="runCount" label="Runs" />
                <SortHeader field="stddevFinalElo" label="StdDev" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center">
                    <div className="flex items-center justify-center gap-2 text-[var(--text-muted)]">
                      <div className="w-4 h-4 border-2 border-[var(--accent-gold)] border-t-transparent rounded-full animate-spin" />
                      <span className="font-ui">Loading strategies...</span>
                    </div>
                  </td>
                </tr>
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-[var(--text-muted)] font-body">
                    No strategy data yet. Run evolution experiments to see results.
                  </td>
                </tr>
              ) : (
                sorted.map((s) => (
                  <React.Fragment key={s.id}>
                    <tr
                      onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                      className="border-t border-[var(--border-default)] hover:bg-[var(--surface-elevated)] cursor-pointer transition-colors"
                    >
                      <td className="p-3">
                        <div>
                          <span className="font-ui font-medium text-[var(--text-primary)]">
                            {s.name}
                          </span>
                          <span className="block text-xs font-ui text-[var(--text-muted)] mt-0.5 truncate max-w-xs">
                            {s.label}
                          </span>
                        </div>
                      </td>
                      <td className="p-3 text-right font-mono text-[var(--text-primary)]">
                        {s.avgFinalElo?.toFixed(0) ?? '-'}
                      </td>
                      <td className="p-3 text-right">
                        <span className={`font-mono ${
                          (s.avgEloPerDollar ?? 0) > 200
                            ? 'text-[var(--status-success)]'
                            : (s.avgEloPerDollar ?? 0) > 100
                            ? 'text-[var(--accent-gold)]'
                            : 'text-[var(--text-secondary)]'
                        }`}>
                          {s.avgEloPerDollar?.toFixed(0) ?? '-'}
                        </span>
                      </td>
                      <td className="p-3 text-right font-mono text-[var(--text-secondary)]">
                        {s.runCount}
                      </td>
                      <td className="p-3 text-right font-mono text-[var(--text-muted)]">
                        {s.stddevFinalElo?.toFixed(1) ?? '-'}
                      </td>
                    </tr>
                    {expandedId === s.id && (
                      <tr key={`${s.id}-expanded`}>
                        <td colSpan={5} className="p-4 bg-[var(--surface-elevated)]">
                          <div className="flex gap-4">
                            <div className="flex-1">
                              <StrategyConfigDisplay config={s.config} />
                            </div>
                            <div className="flex-shrink-0">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDetailStrategy(s);
                                }}
                                className="px-3 py-1.5 text-sm font-ui bg-[var(--accent-gold)] text-[var(--surface-primary)] rounded-page hover:opacity-90 transition-opacity"
                              >
                                View Run History
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardContent>

      {/* Strategy detail modal */}
      {detailStrategy && (
        <StrategyDetail
          strategy={detailStrategy}
          onClose={() => setDetailStrategy(null)}
        />
      )}
    </Card>
  );
}
