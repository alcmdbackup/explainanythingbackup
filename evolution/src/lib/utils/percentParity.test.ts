// Parity test: MetricsTab (formatPercentValue) and CostEstimatesTab (toFixed(1))
// must agree on sign and integer part for the same Estimation Error % value.
// Both treat the input as already-percent — neither multiplies by 100.
//
// B7 (use_playwright_find_bugs_ux_issues_20260422): the bug we're guarding
// against is one tab regressing to multiplying by 100 again, which would
// produce -3821% on Metrics while CostEstimates correctly showed -38.2%.

import { formatPercentValue } from './formatters';

// Inline copy of the CostEstimatesTab formatter (kept private to that file).
function costEstimatesTabFormat(pct: number): string {
  return `${pct.toFixed(1)}%`;
}

describe('Estimation Error % parity (MetricsTab ↔ CostEstimatesTab)', () => {
  // The two formatters produce different precision on purpose (Metrics rounds
  // to integer; CostEstimates keeps 1 decimal). Parity here means: same sign
  // and same integer part — never two orders of magnitude off.
  function intPart(s: string): number {
    const m = s.match(/-?\d+/);
    return m ? Math.abs(parseInt(m[0], 10)) : NaN;
  }

  const cases = [-38.2, -3.5, 0, 3.5, 38.2, 99.7, 150.4];

  it.each(cases)('value %p formats with the same sign and integer part on both tabs', (v) => {
    const metricsOut = formatPercentValue(v);
    const costEstOut = costEstimatesTabFormat(v);
    // Sign agreement (or both zero)
    const metricsNeg = metricsOut.startsWith('-');
    const costNeg = costEstOut.startsWith('-');
    expect(metricsNeg).toBe(costNeg);
    // Integer-part agreement within ±1 (rounding to integer can bump by 1).
    const diff = Math.abs(intPart(metricsOut) - intPart(costEstOut));
    expect(diff).toBeLessThanOrEqual(1);
  });

  // Anti-regression: the original bug rendered -3821% on Metrics for an input
  // of -38.2 (because the formatter used `formatPercent`, which multiplies by 100).
  it('B7 regression-pin: Metrics tab does NOT render -38.2 as -3821%', () => {
    expect(formatPercentValue(-38.2)).toBe('-38%');
    expect(formatPercentValue(-38.2)).not.toMatch(/3821/);
  });
});
