// Rubric-based pairwise judging core (pure functions).
//
// Implements the locked aggregation model for rubric judging: the judge scores
// which of two texts wins each named dimension, per pass; each pass's weighted
// score picks a pass winner; the two pass winners are reconciled with the same
// 5-value confidence table the holistic judge uses (run2PassReversal level), and
// the per-dimension breakdown is snapshotted for persistence + the Match Viewer.
//
// All exports here are pure (no DB / LLM / IO) and unit-tested in rubricJudge.test.ts.
// Wiring into compareWithBiasMitigation / buildRunContext / persistence lives elsewhere.

import type { ComparisonResult, ComparisonMode } from './computeRatings';
import type { EvaluationGuidance } from '../schemas';

export type Verdict = 'A' | 'B' | 'TIE';

/** A resolved rubric dimension: an evolution_criteria row + its normalized weight. */
export interface ResolvedRubricDimension {
  criteriaId: string;
  name: string;
  description: string | null;
  minRating: number;
  maxRating: number;
  evaluationGuidance: EvaluationGuidance | null;
  /** Normalized so the rubric's weights sum to 1 (see normalizeDimensions). */
  weight: number;
}

/** The runtime shape carried on EvolutionConfig.judgeRubric. */
export interface ResolvedJudgeRubric {
  rubricId: string;
  dimensions: ResolvedRubricDimension[];
}

export interface RubricPassResult {
  scoreA: number;
  scoreB: number;
  /** null only when the pass parsed NO dimension at all. */
  winner: Verdict | null;
}

export interface RubricDimensionBreakdown {
  criteriaId: string;
  name: string;
  weight: number;
  forwardVerdict: Verdict | null;
  /** Already flipped to the real (variant-A/variant-B) frame. */
  reverseVerdict: Verdict | null;
}

/** Persisted in evolution_arena_comparisons.rubric_breakdown + carried in-memory. */
export interface RubricBreakdown {
  rubricId: string;
  dimensions: RubricDimensionBreakdown[];
  forwardPass: RubricPassResult;
  reversePass: RubricPassResult;
  overall: { winner: Verdict; confidence: number };
}

export interface RubricComparisonResult extends ComparisonResult {
  rubricBreakdown: RubricBreakdown;
}

// ─── Weight normalization ──────────────────────────────────────────────────

/** Normalize raw weights so they sum to 1 across the given dimensions. When the
 *  sum is 0 (or no dims), weights are left as 0 — callers treat an empty/0-weight
 *  rubric as "no usable rubric". */
export function normalizeDimensions(
  dims: ReadonlyArray<Omit<ResolvedRubricDimension, 'weight'> & { weight: number }>,
): ResolvedRubricDimension[] {
  const total = dims.reduce((s, d) => s + (d.weight > 0 ? d.weight : 0), 0);
  return dims.map((d) => ({
    ...d,
    weight: total > 0 ? (d.weight > 0 ? d.weight : 0) / total : 0,
  }));
}

// ─── Tolerant per-dimension parser ─────────────────────────────────────────

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Extract a per-dimension verdict from a per-line `dimension: A|B|TIE` response.
 *  Tolerant (E3): a missing/ambiguous dimension yields null for THAT dimension
 *  while the others survive. A line that mentions both A and B for one dimension
 *  is treated as ambiguous → null (strict). The LAST clean line for a dimension
 *  wins, so a reasoning preamble followed by final markers parses correctly. */
export function parseRubricVerdict(
  response: string,
  dimensionNames: ReadonlyArray<string>,
): Record<string, Verdict | null> {
  const out: Record<string, Verdict | null> = {};
  const lines = response.split('\n');
  for (const name of dimensionNames) {
    const nameRe = new RegExp(
      `(?:^|[^A-Za-z0-9_-])${escapeRegExp(name)}(?:[^A-Za-z0-9_-]|$)`,
      'i',
    );
    let verdict: Verdict | null = null;
    const lowerName = name.toLowerCase();
    for (const line of lines) {
      if (!nameRe.test(line)) continue;
      const idx = line.toLowerCase().indexOf(lowerName);
      const after = line.slice(idx + name.length).toUpperCase();
      const tokens = after.match(/\b(TIE|A|B)\b/g) ?? [];
      const distinct = [...new Set(tokens)];
      if (distinct.length === 1) {
        verdict = distinct[0] as Verdict; // last matching line wins
      } else if (distinct.length > 1) {
        verdict = null; // ambiguous on this line
      }
    }
    out[name] = verdict;
  }
  return out;
}

// ─── Per-pass scoring + reconciliation ─────────────────────────────────────

function flipVerdict(v: Verdict | null): Verdict | null {
  if (v === 'A') return 'B';
  if (v === 'B') return 'A';
  return v; // TIE / null unchanged
}

/** Weighted score for one pass (verdicts already in the real frame). TIE & null
 *  dims contribute to neither side. Winner = higher score; equal-with-some-parsed
 *  → TIE; nothing parsed → null. */
export function scorePass(
  verdicts: Record<string, Verdict | null>,
  dimensions: ReadonlyArray<ResolvedRubricDimension>,
): RubricPassResult {
  let scoreA = 0;
  let scoreB = 0;
  let anyParsed = false;
  for (const d of dimensions) {
    const v = verdicts[d.name] ?? null;
    if (v === 'A') {
      scoreA += d.weight;
      anyParsed = true;
    } else if (v === 'B') {
      scoreB += d.weight;
      anyParsed = true;
    } else if (v === 'TIE') {
      anyParsed = true; // counted as "parsed" but contributes no score
    }
  }
  let winner: Verdict | null;
  if (!anyParsed) winner = null;
  else if (scoreA > scoreB) winner = 'A';
  else if (scoreB > scoreA) winner = 'B';
  else winner = 'TIE';
  return { scoreA, scoreB, winner };
}

/** Reconcile two REAL-frame pass winners into {winner, confidence}. Mirrors the
 *  holistic aggregateWinners 5-value table WITHOUT flipping (inputs are already
 *  real-frame): agree→1.0, one-TIE→0.7, A-vs-B→TIE 0.5, one-null→0.3, both-null→0.0. */
export function reconcilePasses(
  forward: Verdict | null,
  reverse: Verdict | null,
): { winner: Verdict; confidence: number } {
  if (forward === null || reverse === null) {
    const partial = forward ?? reverse;
    if (partial === 'A') return { winner: 'A', confidence: 0.3 };
    if (partial === 'B') return { winner: 'B', confidence: 0.3 };
    return { winner: 'TIE', confidence: 0.0 };
  }
  if (forward === reverse) return { winner: forward, confidence: 1.0 };
  if (forward === 'TIE' || reverse === 'TIE') {
    return { winner: (forward === 'TIE' ? reverse : forward), confidence: 0.7 };
  }
  return { winner: 'TIE', confidence: 0.5 }; // A vs B disagreement
}

/** Aggregate the two passes' raw (as-shown) per-dimension verdicts into a full
 *  RubricComparisonResult. `forwardVerdicts` are already real-frame; the reverse
 *  pass showed B-then-A, so its verdicts are flipped to the real frame here. */
export function aggregateRubric(
  forwardVerdicts: Record<string, Verdict | null>,
  reverseVerdictsAsShown: Record<string, Verdict | null>,
  rubric: ResolvedJudgeRubric,
): RubricComparisonResult {
  const reverseReal: Record<string, Verdict | null> = {};
  for (const d of rubric.dimensions) {
    reverseReal[d.name] = flipVerdict(reverseVerdictsAsShown[d.name] ?? null);
  }
  const forwardPass = scorePass(forwardVerdicts, rubric.dimensions);
  const reversePass = scorePass(reverseReal, rubric.dimensions);
  const overall = reconcilePasses(forwardPass.winner, reversePass.winner);

  const dimensions: RubricDimensionBreakdown[] = rubric.dimensions.map((d) => ({
    criteriaId: d.criteriaId,
    name: d.name,
    weight: d.weight,
    forwardVerdict: forwardVerdicts[d.name] ?? null,
    reverseVerdict: reverseReal[d.name] ?? null,
  }));

  return {
    winner: overall.winner,
    confidence: overall.confidence,
    turns: 2,
    rubricBreakdown: { rubricId: rubric.rubricId, dimensions, forwardPass, reversePass, overall },
  };
}

// ─── Breakdown orientation (for persistence) ───────────────────────────────

/** Swap the A/B frame of a breakdown (every verdict, pass score, and winner). */
export function flipRubricBreakdown(b: RubricBreakdown): RubricBreakdown {
  const flipPass = (p: RubricPassResult): RubricPassResult => ({
    scoreA: p.scoreB,
    scoreB: p.scoreA,
    winner: flipVerdict(p.winner),
  });
  return {
    rubricId: b.rubricId,
    dimensions: b.dimensions.map((d) => ({
      ...d,
      forwardVerdict: flipVerdict(d.forwardVerdict),
      reverseVerdict: flipVerdict(d.reverseVerdict),
    })),
    forwardPass: flipPass(b.forwardPass),
    reversePass: flipPass(b.reversePass),
    overall: { winner: flipVerdict(b.overall.winner) as Verdict, confidence: b.overall.confidence },
  };
}

/** Orient a breakdown so its 'A' side maps to the comparison row's entry_a. The
 *  judge's Text-A variant id is recovered from the match winner/loser + the
 *  overall winner; if it isn't entry_a, the breakdown is flipped. Pure. */
export function orientBreakdownToEntries(
  breakdown: RubricBreakdown,
  winnerId: string,
  loserId: string,
  entryAId: string,
): RubricBreakdown {
  // buildMatch set winnerId = (overall.winner==='B' ? textB : textA); for A/TIE the
  // winnerId is textA. So textA's id is:
  const textAId = breakdown.overall.winner === 'B' ? loserId : winnerId;
  return textAId === entryAId ? breakdown : flipRubricBreakdown(breakdown);
}

// ─── Prompt building ───────────────────────────────────────────────────────

/** Reframe a criterion's absolute-score anchors into comparative quality tiers
 *  (Excellent / Adequate / Weak) by each anchor's position within [min, max].
 *  Returns '' when the criterion has no anchors. */
function tierAnchors(d: ResolvedRubricDimension): string {
  const anchors = d.evaluationGuidance;
  if (!anchors || anchors.length === 0) return '';
  const span = d.maxRating - d.minRating;
  const tierOf = (score: number): string => {
    if (span <= 0) return 'Quality';
    const frac = (score - d.minRating) / span;
    if (frac >= 2 / 3) return 'Excellent';
    if (frac >= 1 / 3) return 'Adequate';
    return 'Weak';
  };
  const lines = [...anchors]
    .sort((a, b) => b.score - a.score)
    .map((a) => `    - ${tierOf(a.score)}: ${a.description}`);
  return `\n  Quality guide:\n${lines.join('\n')}`;
}

/** Build the rubric judge prompt. Design Y: `mode` keeps the existing article /
 *  paragraph text framing; the rubric overlay adds per-dimension blocks + a
 *  per-line verdict contract. Pure — no rubric → callers use buildComparisonPrompt. */
export function buildRubricComparisonPrompt(
  textA: string,
  textB: string,
  rubric: ResolvedJudgeRubric,
  mode: ComparisonMode = 'article',
): string {
  const unit = mode === 'paragraph' ? 'paragraph' : 'article';
  const dimBlocks = rubric.dimensions
    .map((d, i) => {
      const desc = d.description ? `: ${d.description}` : '';
      return `${i + 1}. ${d.name}${desc}${tierAnchors(d)}`;
    })
    .join('\n');
  const verdictLines = rubric.dimensions.map((d) => `${d.name}: <A|B|TIE>`).join('\n');

  return `You are an expert writing evaluator comparing two ${unit}s, Text A and Text B.
For EACH dimension below, decide which ${unit} is stronger ON THAT DIMENSION ALONE.

Dimensions:
${dimBlocks}

## Text A
${textA}

## Text B
${textB}

For each dimension, answer with exactly one of A, B, or TIE on its own line, using this format:
${verdictLines}`;
}
