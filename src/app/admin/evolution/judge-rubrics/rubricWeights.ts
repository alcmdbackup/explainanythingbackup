// Pure weight helpers for the Judge Rubrics builder/editor. Extracted from page.tsx so they
// are unit-testable without importing the client component + its server actions.

export interface WeightedDim { criteria_id: string; weight: number }

/** Distribute 100 evenly across n dimensions; the remainder lands on the first so the
 *  displayed weights always sum to exactly 100. */
export function evenSplit<T extends WeightedDim>(dims: T[]): T[] {
  const n = dims.length;
  if (n === 0) return dims;
  const base = Math.floor(100 / n);
  const remainder = 100 - base * n;
  return dims.map((d, i) => ({ ...d, weight: base + (i === 0 ? remainder : 0) }));
}

/** Hydrate stored dimension weights into the editor's 0–100 percentage unit.
 *  `evolution_judge_rubric_dimensions.weight` is MIXED-UNIT: the builder stores 0–100, but
 *  weight-inference "Export as judge rubric" stores normalized 0–1 fractions. Without this,
 *  an exported rubric loaded into the editor shows e.g. 0.17/0.30/0.53 → "1% / 100%" → Save
 *  permanently disabled (T21). Detect fractions by SUM (≈1 → scale ×100; a real 0–100 set
 *  can never sum to ~1 and a 0–1 set can never sum to ~100), rounding the remainder onto the
 *  first dimension (like evenSplit) so the result sums to exactly 100. */
export function hydrateDimensionWeights<T extends WeightedDim>(dims: T[]): T[] {
  if (dims.length === 0) return dims;
  const sum = dims.reduce((s, d) => s + (Number.isFinite(d.weight) ? d.weight : 0), 0);
  // Outside the fraction band → already 0–100 (or degenerate); leave untouched.
  if (sum < 0.5 || sum > 1.5) return dims;
  const scaled = dims.map((d) => ({ ...d, weight: Math.round((Number.isFinite(d.weight) ? d.weight : 0) * 100) }));
  const remainder = 100 - scaled.reduce((s, d) => s + d.weight, 0);
  return scaled.map((d, i) => (i === 0 ? { ...d, weight: d.weight + remainder } : d));
}
