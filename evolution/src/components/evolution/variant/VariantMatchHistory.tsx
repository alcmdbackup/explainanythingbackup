// Variant match history table showing pairwise comparison results from checkpoint data.
// Displays opponent IDs, win/loss, confidence, and opponent Elo for each match.

'use client';

import { useEffect, useState } from 'react';

import Link from 'next/link';
import { buildVariantDetailUrl } from '@evolution/lib/utils/evolutionUrls';

function ShortId({ id, href }: { id: string; href?: string }): JSX.Element {
  const display = id.substring(0, 8);
  if (href) {
    return <Link href={href} className="font-mono text-xs text-[var(--accent-gold)] hover:underline" title={id}>{display}</Link>;
  }
  return <span className="font-mono text-xs text-[var(--accent-gold)]" title={id}>{display}</span>;
}
import {
  getVariantMatchHistoryAction,
  type VariantMatchEntry,
} from '@evolution/services/variantDetailActions';

const SECTION_CLASS = 'border border-[var(--border-default)] rounded-book bg-[var(--surface-elevated)] p-6';
interface VariantMatchHistoryProps {
  variantId: string;
}

export function VariantMatchHistory({ variantId }: VariantMatchHistoryProps): JSX.Element {
  const [matches, setMatches] = useState<VariantMatchEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getVariantMatchHistoryAction(variantId).then((result) => {
      if (result.success && result.data) {
        setMatches(result.data);
      } else {
        setError(result.error?.message ?? 'Failed to load match history');
      }
      setLoading(false);
    }).catch(() => { setError('Failed to load match history'); setLoading(false); });
  }, [variantId]);

  if (loading) {
    return (
      <div className={SECTION_CLASS} data-testid="variant-match-history">
        <h2 className="text-2xl font-display font-semibold text-[var(--text-primary)] mb-3">Match History</h2>
        <div className="space-y-2 animate-pulse">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-8 bg-[var(--surface-secondary)] rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={SECTION_CLASS} data-testid="variant-match-history">
        <h2 className="text-2xl font-display font-semibold text-[var(--text-primary)] mb-2">Match History</h2>
        <p className="text-sm text-[var(--status-error)]">{error}</p>
      </div>
    );
  }

  if (matches.length === 0) {
    return (
      <div className={SECTION_CLASS} data-testid="variant-match-history">
        <h2 className="text-2xl font-display font-semibold text-[var(--text-primary)] mb-2">Match History</h2>
        <p className="text-sm text-[var(--text-muted)]">No match data available for this variant.</p>
      </div>
    );
  }

  const wins = matches.filter(m => m.won).length;
  const losses = matches.length - wins;

  return (
    <div className={SECTION_CLASS} data-testid="variant-match-history">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-2xl font-display font-semibold text-[var(--text-primary)]">Match History</h2>
        <span className="text-xs text-[var(--text-muted)] font-ui">
          <span className="text-[var(--status-success)]">{wins}W</span>
          {' / '}
          <span className="text-[var(--status-error)]">{losses}L</span>
          {' '}
          ({matches.length} total)
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-secondary)]">
            <tr>
              <th className="px-2 py-1.5 text-left text-xs text-[var(--text-muted)]">Result</th>
              <th className="px-2 py-1.5 text-left text-xs text-[var(--text-muted)]">Opponent</th>
              <th className="px-2 py-1.5 text-right text-xs text-[var(--text-muted)]">Opp. Rating</th>
              <th className="px-2 py-1.5 text-right text-xs text-[var(--text-muted)]">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {matches.map((m, i) => (
              <tr
                key={i}
                className={`border-t border-[var(--border-default)] ${
                  m.won ? 'bg-[var(--status-success)]/5' : 'bg-[var(--status-error)]/5'
                }`}
                data-testid="match-row"
              >
                <td className="px-2 py-1.5">
                  <span className={`text-xs font-semibold ${m.won ? 'text-[var(--status-success)]' : 'text-[var(--status-error)]'}`}>
                    {m.won ? 'WIN' : 'LOSS'}
                  </span>
                </td>
                <td className="px-2 py-1.5">
                  <ShortId id={m.opponentId} href={buildVariantDetailUrl(m.opponentId)} />
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-[var(--text-muted)]">
                  {m.opponentElo !== null
                    ? (m.opponentUncertainty != null
                        ? `${Math.round(m.opponentElo)} ± ${Math.round(1.96 * m.opponentUncertainty)}`
                        : Math.round(m.opponentElo))
                    : '\u2014'}
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-[var(--text-muted)]">
                  {(m.confidence * 100).toFixed(0)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
