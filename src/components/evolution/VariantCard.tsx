// Compact card displaying variant summary info (ID, Elo, strategy, iteration).
// Used in lineage graph tooltips and side panels.
'use client';

/** Strategy-to-hex mapping for border accents and chart series. */
export const STRATEGY_PALETTE: Record<string, string> = {
  structural_transform: '#3b82f6', // blue
  lexical_simplify: '#22c55e', // green
  grounding_enhance: '#f97316', // orange
  mutate_clarity: '#a855f7', // purple
  crossover: '#a855f7', // purple
  mutate_engagement: '#a855f7', // purple
};

export function VariantCard({
  shortId,
  elo,
  strategy,
  iterationBorn,
  isWinner = false,
  className = '',
}: {
  shortId: string;
  elo: number;
  strategy: string;
  iterationBorn: number;
  isWinner?: boolean;
  className?: string;
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
          {Math.round(elo)}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
        <span className="font-mono">{strategy}</span>
        <span>iter {iterationBorn}</span>
      </div>
    </div>
  );
}
