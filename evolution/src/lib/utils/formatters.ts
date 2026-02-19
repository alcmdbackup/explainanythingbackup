// Centralized number formatting utilities for the evolution dashboard.
// Ensures consistent display of costs, Elo scores, percentages, and durations.

/** Format cost for tables, summaries, and headers — 2 decimal places. */
export function formatCost(usd: number | null | undefined): string {
  if (usd == null || isNaN(usd)) return '$0.00';
  return `$${usd.toFixed(2)}`;
}

/** Format cost for per-agent breakdowns — 3 decimal places. */
export function formatCostDetailed(usd: number | null | undefined): string {
  if (usd == null || isNaN(usd)) return '$0.000';
  return `$${usd.toFixed(3)}`;
}

/** Format cost for individual LLM calls — 4 decimal places (preserves sub-cent precision). */
export function formatCostMicro(usd: number | null | undefined): string {
  if (usd == null || isNaN(usd)) return '$0.0000';
  return `$${usd.toFixed(4)}`;
}

/** Format Elo score — integer, no decimals. */
export function formatElo(score: number | null | undefined): string {
  if (score == null || isNaN(score)) return '—';
  return Math.round(score).toString();
}

/** Format Elo-per-dollar ratio — 1 decimal place. */
export function formatEloDollar(ratio: number | null | undefined): string {
  if (ratio == null || isNaN(ratio)) return '—';
  return ratio.toFixed(1);
}

/** Format a ratio (0–1) or raw number as a percentage string. */
export function formatPercent(ratio: number | null | undefined): string {
  if (ratio == null || isNaN(ratio)) return '0%';
  return `${Math.round(ratio * 100)}%`;
}

/** Format duration in seconds to human-readable string. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || isNaN(seconds)) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

/** Format a numeric score — 2 decimal places. Used for confidence, diversity, etc. */
export function formatScore(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return '—';
  return value.toFixed(2);
}

/** Format a numeric score — 1 decimal place. Used for dimension scores, Mu ratings. */
export function formatScore1(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return '—';
  return value.toFixed(1);
}
