// Wilson score interval for binomial proportions — the right CI for "k / n agreed".
// Pure module, no side effects. Used by the Agreement Sweep leaderboard + reducer to
// render `78% [72, 84]` whiskers without bootstrap (bootstrap is for means of variance-
// bearing samples; proportions deserve proportion math).

export interface WilsonInterval {
  low: number;
  high: number;
}

/** Two-sided Wilson score interval for a proportion. Clamped to [0, 1]. Returns null when n=0.
 *  Default z=1.96 (~95% CI); pass z=1.645 for ~90%, z=2.576 for ~99%. */
export function wilsonScoreCI(
  successes: number,
  n: number,
  z: number = 1.96,
): WilsonInterval | null {
  if (successes < 0 || n < 0 || z < 0) {
    throw new Error('wilsonScoreCI: negative input');
  }
  if (n === 0) return null;
  if (successes > n) {
    throw new Error('wilsonScoreCI: successes > n');
  }
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denom;
  const low = Math.max(0, center - margin);
  const high = Math.min(1, center + margin);
  return { low, high };
}
