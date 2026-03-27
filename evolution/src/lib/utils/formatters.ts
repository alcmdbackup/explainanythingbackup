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

/** Compute 95% confidence interval half-width from sigma (already in Elo scale). */
export function elo95CI(sigma: number): number {
  return Math.round(1.96 * sigma);
}

/** Format Elo with 95% CI range as "[lo, hi]". Returns null if sigma is unavailable. */
export function formatEloCIRange(elo: number, sigma: number | null | undefined): string | null {
  if (sigma == null || sigma <= 0) return null;
  const half = elo95CI(sigma);
  return `[${Math.round(elo - half)}, ${Math.round(elo + half)}]`;
}

// ─── Date formatting ─────────────────────────────────────

/** Format date for list views (short: "Mar 26"). Includes year if not current year. */
export function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-US', opts);
}

/** Format date+time for detail views (e.g., "Mar 26, 2026 14:30"). */
export function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}
