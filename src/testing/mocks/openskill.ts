// Mock for openskill package used in evolution pipeline rating system.
// Models simplified Bayesian rating updates that account for relative strength
// differences, so that expected wins yield small shifts and upsets yield large ones.

export function rating(): { mu: number; sigma: number } {
  return { mu: 25, sigma: 25 / 3 };
}

export function rate(
  teams: Array<Array<{ mu: number; sigma: number }>>,
  opts: { rank: number[] },
): Array<Array<{ mu: number; sigma: number }>> {
  const [[a], [b]] = teams;

  // Approximate expected-outcome probability via logistic function
  const diff = a.mu - b.mu;
  const expectedA = 1 / (1 + Math.exp(-diff / 6));

  if (opts.rank[0] < opts.rank[1]) {
    // a wins: shift proportional to surprise (1 - expectedA)
    const shift = 2 * (1 - expectedA) + 0.1; // min ~0.1 shift
    return [
      [{ mu: a.mu + shift, sigma: Math.max(0.5, a.sigma - 0.5) }],
      [{ mu: b.mu - shift, sigma: Math.max(0.5, b.sigma - 0.5) }],
    ];
  }
  if (opts.rank[0] > opts.rank[1]) {
    // b wins: shift proportional to surprise (expectedA)
    const shift = 2 * expectedA + 0.1;
    return [
      [{ mu: a.mu - shift, sigma: Math.max(0.5, a.sigma - 0.5) }],
      [{ mu: b.mu + shift, sigma: Math.max(0.5, b.sigma - 0.5) }],
    ];
  }
  // draw: move both toward mean of the two, proportional to gap
  const drawShift = diff * 0.05;
  return [
    [{ mu: a.mu - drawShift, sigma: Math.max(0.5, a.sigma - 0.3) }],
    [{ mu: b.mu + drawShift, sigma: Math.max(0.5, b.sigma - 0.3) }],
  ];
}

export function ordinal(r: { mu: number; sigma: number }): number {
  return r.mu - 3 * r.sigma;
}
