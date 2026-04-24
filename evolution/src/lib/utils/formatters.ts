// Centralized number formatting utilities for the evolution dashboard.
// Ensures consistent display of costs, Elo scores, percentages, and durations.

/** Format cost for tables, summaries, and headers — 2 decimal places.
 *  Returns '—' for null/undefined/NaN to distinguish missing data from genuinely $0.00. */
export function formatCost(usd: number | null | undefined): string {
  if (usd == null || isNaN(usd)) return '—';
  return `$${usd.toFixed(2)}`;
}

/** Format cost for per-agent breakdowns — 3 decimal places. */
export function formatCostDetailed(usd: number | null | undefined): string {
  if (usd == null || isNaN(usd)) return '—';
  return `$${usd.toFixed(3)}`;
}

/** Format cost for individual LLM calls — 4 decimal places (preserves sub-cent precision). */
export function formatCostMicro(usd: number | null | undefined): string {
  if (usd == null || isNaN(usd)) return '—';
  return `$${usd.toFixed(4)}`;
}

/** Format an expected/upper-bound cost range as "$0.003 – $0.007" (Phase 6a triple-value
 *  estimates). Used by the wizard preview and Cost Estimates tab to communicate that the
 *  dispatch gate reserves the upper bound while display reflects the likely outcome. */
export function formatCostRange(
  expected: number | null | undefined,
  upperBound: number | null | undefined,
): string {
  if (expected == null || upperBound == null || isNaN(expected) || isNaN(upperBound)) return '—';
  // When they collapse to the same value (e.g. swiss iterations with no per-agent cost),
  // render a single value rather than an identical range.
  if (Math.abs(expected - upperBound) < 1e-6) return formatCostMicro(expected);
  return `${formatCostMicro(expected)} – ${formatCostMicro(upperBound)}`;
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

/**
 * Format a value that is ALREADY in percentage units (not a 0-1 ratio) — just
 * rounds and appends `%`. Use this for metrics whose source data is stored
 * in percent (e.g. `cost_estimation_error_pct` is persisted as e.g. -38.2).
 *
 * B7 (use_playwright_find_bugs_ux_issues_20260422): previously those metrics
 * used `formatPercent`, which multiplied by 100 again and produced nonsense
 * displays like `-3821%` instead of `-38%`.
 */
export function formatPercentValue(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return '—';
  return `${Math.round(value)}%`;
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

/** Format a numeric score — 1 decimal place. Used for dimension scores, Elo ratings. */
export function formatScore1(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return '—';
  return value.toFixed(1);
}

/** Compute 95% confidence interval half-width from uncertainty (Elo-scale standard deviation). */
export function elo95CI(uncertainty: number): number {
  return Math.round(1.96 * uncertainty);
}

/** Format Elo with 95% CI range as "[lo, hi]". Returns null if uncertainty is unavailable. */
export function formatEloCIRange(elo: number, uncertainty: number | null | undefined): string | null {
  if (uncertainty == null || uncertainty <= 0) return null;
  const half = elo95CI(uncertainty);
  return `[${Math.round(elo - half)}, ${Math.round(elo + half)}]`;
}

/** Format Elo with uncertainty as "1200 ± 45". uncertainty must be Elo-scale. */
export function formatEloWithUncertainty(elo: number, uncertainty: number | null | undefined): string | null {
  if (uncertainty == null || uncertainty <= 0) return null;
  const half = elo95CI(uncertainty);
  return `${Math.round(elo)} ± ${half}`;
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
