// Compact card displaying variant summary info (ID, Elo, strategy, iteration).
// Used in lineage graph tooltips and side panels.
'use client';

import { formatEloWithUncertainty } from '@evolution/lib/utils/formatters';

/** Strategy-to-hex mapping for border accents and chart series. */
export const STRATEGY_PALETTE: Record<string, string> = {
  structural_transform: '#3b82f6', // blue
  lexical_simplify: '#22c55e', // green
  grounding_enhance: '#f97316', // orange
  mutate_clarity: '#a855f7', // purple
  crossover: '#a855f7', // purple
  mutate_engagement: '#a855f7', // purple
  // Tree search strategies (prefixed with tree_search_)
  tree_search_edit_dimension: '#eab308', // gold
  tree_search_structural_transform: '#3b82f6', // blue (matches parent strategy)
  tree_search_lexical_simplify: '#22c55e', // green
  tree_search_grounding_enhance: '#f97316', // orange
  tree_search_creative: '#ec4899', // pink
};

export function VariantCard({
  shortId,
  elo,
  uncertainty,
  strategy,
  iterationBorn,
  isWinner = false,
  className = '',
  treeDepth,
  revisionAction,
}: {
  shortId: string;
  elo: number;
  /** Elo-scale rating uncertainty. When present, rating displays as "elo ± half-width". Phase 4b. */
  uncertainty?: number;
  strategy: string;
  iterationBorn: number;
  isWinner?: boolean;
  className?: string;
  /** Tree search depth (null if not from tree search). */
  treeDepth?: number | null;
  /** Tree search revision action description. */
  revisionAction?: string | null;
}) {
  return (
    <div
      className={`border border-[var(--border-default)] border-l-4 rounded bg-[var(--surface-elevated)] p-3 space-y-1 ${className}`}
      style={{ borderLeftColor: STRATEGY_PALETTE[strategy] ?? 'var(--border-default)' }}
      data-testid={`variant-card-${shortId}`}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-[var(--text-muted)]">
          {shortId}
          {isWinner && (
            <span className="ml-1 text-[var(--accent-gold)]">&#9733;</span>
          )}
        </span>
        <span className="text-sm font-semibold text-[var(--text-primary)]">
          {uncertainty != null
            ? (formatEloWithUncertainty(elo, uncertainty) ?? Math.round(elo))
            : Math.round(elo)}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
        <span className="font-mono">{strategy}</span>
        <span>iter {iterationBorn}</span>
      </div>
      {treeDepth != null && (
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] border-t border-[var(--border-default)] pt-1 mt-1">
          <span className="font-mono">depth {treeDepth}</span>
          {revisionAction && (
            <span className="truncate">{revisionAction}</span>
          )}
        </div>
      )}
    </div>
  );
}
