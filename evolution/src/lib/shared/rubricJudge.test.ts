// Unit tests for the rubric-judging core (pure functions).
// Covers: weight normalization, the tolerant per-line parser, per-pass weighted
// scoring, top-level reversal reconciliation, the full aggregation (incl. the
// .70 worked example, position-bias→TIE, all-null→draw, divergent parse sets),
// and the prompt builder contract.

import {
  normalizeDimensions,
  parseRubricVerdict,
  scorePass,
  reconcilePasses,
  aggregateRubric,
  buildRubricComparisonPrompt,
  flipRubricBreakdown,
  orientBreakdownToEntries,
  type ResolvedRubricDimension,
  type ResolvedJudgeRubric,
  type RubricBreakdown,
  type Verdict,
} from './rubricJudge';

function dim(
  name: string,
  weight: number,
  extra: Partial<ResolvedRubricDimension> = {},
): ResolvedRubricDimension {
  return {
    criteriaId: `crit-${name}`,
    name,
    description: `desc of ${name}`,
    minRating: 1,
    maxRating: 10,
    evaluationGuidance: null,
    weight,
    ...extra,
  };
}

/** The requirement's example rubric (already normalized: weights sum to 1). */
const RUBRIC: ResolvedJudgeRubric = {
  rubricId: 'rub-1',
  dimensions: [dim('conciseness', 0.3), dim('structure', 0.4), dim('style', 0.3)],
};

describe('normalizeDimensions', () => {
  it('normalizes 30/40/30 to .30/.40/.30', () => {
    const out = normalizeDimensions([dim('a', 30), dim('b', 40), dim('c', 30)]);
    expect(out.map((d) => d.weight)).toEqual([0.3, 0.4, 0.3]);
  });
  it('normalizes un-even raw weights (2/3/2) to fractions summing to 1', () => {
    const out = normalizeDimensions([dim('a', 2), dim('b', 3), dim('c', 2)]);
    const sum = out.reduce((s, d) => s + d.weight, 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(out[1]?.weight ?? 0).toBeCloseTo(3 / 7, 10);
  });
  it('renormalizes over survivors (archived dropped before call)', () => {
    // Caller drops the archived dim; normalize re-spreads over the rest.
    const out = normalizeDimensions([dim('a', 0.3), dim('c', 0.3)]);
    expect(out.map((d) => d.weight)).toEqual([0.5, 0.5]);
  });
  it('zero total → all zero weights (empty rubric guard)', () => {
    const out = normalizeDimensions([dim('a', 0), dim('b', 0)]);
    expect(out.map((d) => d.weight)).toEqual([0, 0]);
  });
});

describe('parseRubricVerdict', () => {
  const names = ['conciseness', 'structure', 'style'];

  it('parses clean per-line markers', () => {
    const r = parseRubricVerdict('conciseness: A\nstructure: B\nstyle: TIE', names);
    expect(r).toEqual({ conciseness: 'A', structure: 'B', style: 'TIE' });
  });
  it('tolerates a reasoning preamble before the markers', () => {
    const r = parseRubricVerdict(
      'Let me think. Text A is tighter.\n\nconciseness: A\nstructure: A\nstyle: B',
      names,
    );
    expect(r).toEqual({ conciseness: 'A', structure: 'A', style: 'B' });
  });
  it('a missing dimension line → null for that dim, others survive', () => {
    const r = parseRubricVerdict('conciseness: A\nstyle: B', names);
    expect(r).toEqual({ conciseness: 'A', structure: null, style: 'B' });
  });
  it('ignores unknown dimension names in the response', () => {
    const r = parseRubricVerdict('conciseness: A\nbananas: B\nstructure: A\nstyle: A', names);
    expect(r).toEqual({ conciseness: 'A', structure: 'A', style: 'A' });
  });
  it('a line mentioning both A and B → null (ambiguous)', () => {
    const r = parseRubricVerdict('conciseness: A or B\nstructure: A\nstyle: B', names);
    expect(r.conciseness).toBeNull();
    expect(r.structure).toBe('A');
  });
  it('tolerates markdown-wrapped names', () => {
    const r = parseRubricVerdict('**conciseness**: A\n*structure*: B\nstyle: TIE', names);
    expect(r).toEqual({ conciseness: 'A', structure: 'B', style: 'TIE' });
  });
  it('handles dimension names with underscores/hyphens', () => {
    const r = parseRubricVerdict('point_of_view: A\nsentence-variety: B', [
      'point_of_view',
      'sentence-variety',
    ]);
    expect(r).toEqual({ point_of_view: 'A', 'sentence-variety': 'B' });
  });
  it('all lines missing → every dim null', () => {
    const r = parseRubricVerdict('I cannot decide.', names);
    expect(r).toEqual({ conciseness: null, structure: null, style: null });
  });
  it('does not match a verdict letter embedded in a word', () => {
    const r = parseRubricVerdict('conciseness: Always unclear', ['conciseness']);
    expect(r.conciseness).toBeNull();
  });
  it('last clean line for a dimension wins', () => {
    const r = parseRubricVerdict('conciseness: B\nOn reflection,\nconciseness: A', ['conciseness']);
    expect(r.conciseness).toBe('A');
  });
});

describe('scorePass', () => {
  it('sums normalized weights; TIE/null contribute nothing; within-pass tie → that pass B wins (.40 > .30)', () => {
    const r = scorePass(
      { conciseness: 'A', structure: 'B', style: 'TIE' },
      RUBRIC.dimensions,
    );
    expect(r.scoreA).toBeCloseTo(0.3, 10);
    expect(r.scoreB).toBeCloseTo(0.4, 10);
    expect(r.winner).toBe('B');
  });
  it('a true even split → passWinner TIE', () => {
    const even: ResolvedJudgeRubric = {
      rubricId: 'r',
      dimensions: [dim('a', 0.3), dim('b', 0.3), dim('c', 0.4)],
    };
    const r = scorePass({ a: 'A', b: 'B', c: 'TIE' }, even.dimensions);
    expect(r.scoreA).toBeCloseTo(0.3, 10);
    expect(r.scoreB).toBeCloseTo(0.3, 10);
    expect(r.winner).toBe('TIE');
  });
  it('nothing parsed → winner null', () => {
    const r = scorePass({ conciseness: null, structure: null, style: null }, RUBRIC.dimensions);
    expect(r.winner).toBeNull();
  });
});

describe('reconcilePasses (5-value table on real-frame winners)', () => {
  const cases: Array<[Verdict | null, Verdict | null, Verdict, number]> = [
    ['A', 'A', 'A', 1.0],
    ['B', 'B', 'B', 1.0],
    ['TIE', 'TIE', 'TIE', 1.0],
    ['A', 'TIE', 'A', 0.7],
    ['TIE', 'B', 'B', 0.7],
    ['A', 'B', 'TIE', 0.5],
    ['A', null, 'A', 0.3],
    [null, 'B', 'B', 0.3],
    [null, null, 'TIE', 0.0],
    ['TIE', null, 'TIE', 0.0],
  ];
  it.each(cases)('reconcile(%s,%s) = %s @ %f', (f, r, winner, conf) => {
    expect(reconcilePasses(f, r)).toEqual({ winner, confidence: conf });
  });
});

describe('aggregateRubric', () => {
  it('the .70 worked example: A wins the first two (conc+struct) → A, conf 1.0', () => {
    // reverse pass showed B-then-A; a faithful judge marks the real winner, which
    // in as-shown terms is the opposite slot.
    const result = aggregateRubric(
      { conciseness: 'A', structure: 'A', style: 'B' },
      { conciseness: 'B', structure: 'B', style: 'A' },
      RUBRIC,
    );
    expect(result.winner).toBe('A');
    expect(result.confidence).toBe(1.0);
    expect(result.rubricBreakdown.forwardPass.scoreA).toBeCloseTo(0.7, 10);
    expect(result.rubricBreakdown.forwardPass.scoreB).toBeCloseTo(0.3, 10);
    // reverse verdicts are flipped back to the real frame for display
    expect(result.rubricBreakdown.dimensions.map((d) => d.reverseVerdict)).toEqual(['A', 'A', 'B']);
  });

  it('position bias (model always favors first-shown) nets out to TIE', () => {
    const result = aggregateRubric(
      { conciseness: 'A', structure: 'A', style: 'A' }, // forward: A shown first → all A
      { conciseness: 'A', structure: 'A', style: 'A' }, // reverse: B shown first → all "A" (as-shown)
      RUBRIC,
    );
    expect(result.winner).toBe('TIE');
    expect(result.confidence).toBe(0.5);
  });

  it('all dimensions unparseable in both passes → TIE, confidence 0 (draw)', () => {
    const result = aggregateRubric(
      { conciseness: null, structure: null, style: null },
      { conciseness: null, structure: null, style: null },
      RUBRIC,
    );
    expect(result.winner).toBe('TIE');
    expect(result.confidence).toBe(0.0);
  });

  it('divergent parse sets across passes still resolve (reverse missing structure)', () => {
    const result = aggregateRubric(
      { conciseness: 'A', structure: 'B', style: 'A' },
      { conciseness: 'B', structure: null, style: 'B' }, // flips → conc A, struct null, style A
      RUBRIC,
    );
    expect(result.winner).toBe('A');
    expect(result.confidence).toBe(1.0);
  });

  it('one pass null overall → 0.3 confidence (still decisive, not a draw)', () => {
    const result = aggregateRubric(
      { conciseness: 'A', structure: 'A', style: 'A' },
      { conciseness: null, structure: null, style: null },
      RUBRIC,
    );
    expect(result.winner).toBe('A');
    expect(result.confidence).toBe(0.3);
  });
});

describe('flipRubricBreakdown / orientBreakdownToEntries', () => {
  const breakdown: RubricBreakdown = {
    rubricId: 'r',
    dimensions: [
      { criteriaId: 'c1', name: 'a', weight: 0.5, forwardVerdict: 'A', reverseVerdict: 'A' },
      { criteriaId: 'c2', name: 'b', weight: 0.5, forwardVerdict: 'B', reverseVerdict: 'TIE' },
    ],
    forwardPass: { scoreA: 0.5, scoreB: 0.5, winner: 'TIE' },
    reversePass: { scoreA: 0.5, scoreB: 0, winner: 'A' },
    overall: { winner: 'A', confidence: 1.0 },
  };

  it('flip swaps A/B everywhere and preserves confidence', () => {
    const f = flipRubricBreakdown(breakdown);
    expect(f.overall.winner).toBe('B');
    expect(f.overall.confidence).toBe(1.0);
    expect(f.dimensions[0]?.forwardVerdict).toBe('B');
    expect(f.dimensions[1]?.forwardVerdict).toBe('A');
    expect(f.dimensions[1]?.reverseVerdict).toBe('TIE');
    expect(f.reversePass).toEqual({ scoreA: 0, scoreB: 0.5, winner: 'B' });
  });

  it('orient: no flip when textA (winner for overall A) is entry_a', () => {
    // overall winner A → textAId = winnerId. entry_a = winnerId → already aligned.
    const out = orientBreakdownToEntries(breakdown, 'win', 'los', 'win');
    expect(out).toBe(breakdown);
  });

  it('orient: flips when entry_a is the loser (generate path idA=winnerId, B won)', () => {
    const bWon: RubricBreakdown = { ...breakdown, overall: { winner: 'B', confidence: 0.7 } };
    // overall winner B → textAId = loserId = 'los'. entry_a = 'win' ≠ 'los' → flip.
    const out = orientBreakdownToEntries(bWon, 'win', 'los', 'win');
    expect(out.overall.winner).toBe('A'); // flipped so A maps to entry_a (the winner)
  });
});

describe('buildRubricComparisonPrompt', () => {
  it('injects each dimension name + description + the per-line verdict format and A/B labels', () => {
    const p = buildRubricComparisonPrompt('TEXT_A_BODY', 'TEXT_B_BODY', RUBRIC, 'article');
    expect(p).toContain('## Text A');
    expect(p).toContain('## Text B');
    expect(p).toContain('TEXT_A_BODY');
    for (const d of RUBRIC.dimensions) {
      expect(p).toContain(d.name);
      expect(p).toContain(`${d.name}: <A|B|TIE>`);
    }
    expect(p).toContain('article');
  });
  it('uses paragraph framing in paragraph mode', () => {
    const p = buildRubricComparisonPrompt('a', 'b', RUBRIC, 'paragraph');
    expect(p).toContain('paragraph');
  });
  it('injects a Target Style block in BOTH modes when targetStyleProse is set (byte-identical when absent)', () => {
    const prose = 'Match a terse, declarative voice. Use american spelling.';
    for (const mode of ['article', 'paragraph'] as const) {
      const withStyle = buildRubricComparisonPrompt('a', 'b', RUBRIC, mode, undefined, undefined, undefined, prose);
      const withoutStyle = buildRubricComparisonPrompt('a', 'b', RUBRIC, mode);
      expect(withStyle).toContain('## Target Style');
      expect(withStyle).toContain(prose);
      expect(withoutStyle).not.toContain('## Target Style');
      // Byte-identical when targetStyleProse is omitted.
      expect(buildRubricComparisonPrompt('a', 'b', RUBRIC, mode, undefined, undefined, undefined, undefined)).toEqual(withoutStyle);
    }
  });
  it('reframes anchors into quality tiers when present', () => {
    const withAnchors: ResolvedJudgeRubric = {
      rubricId: 'r',
      dimensions: [
        dim('clarity', 1, {
          evaluationGuidance: [
            { score: 9, description: 'crystal clear' },
            { score: 5, description: 'ok' },
            { score: 1, description: 'confusing' },
          ],
        }),
      ],
    };
    const p = buildRubricComparisonPrompt('a', 'b', withAnchors, 'article');
    expect(p).toContain('Excellent: crystal clear');
    expect(p).toContain('Weak: confusing');
  });

  // investigate_sequential_paragraph_recombine_performance_20260615 Phase 1c-i:
  // Pre-Phase-1c-i, the rubric prompt had no priorPicks/nextContext params, so
  // setting paragraphJudgeRubricId (Phase 1d swap) would silently disable both Fix 1
  // (continuity via priorPicks) AND Fix 4 (forward context via nextContext). These
  // tests pin the threading so the silent-disable can't return.
  describe('priorPicks + nextContext threading (Phase 1c-i — regression guards)', () => {
    it('PRIOR + NEXT blocks present when both provided in paragraph mode', () => {
      const p = buildRubricComparisonPrompt(
        'a', 'b', RUBRIC, 'paragraph', ['prior-A'], ['next-A'],
      );
      expect(p).toContain('## Prior Context');
      expect(p).toContain('<UNTRUSTED_PRIOR>');
      expect(p).toContain('prior-A');
      expect(p).toContain('## Next Context');
      expect(p).toContain('<UNTRUSTED_NEXT>');
      expect(p).toContain('next-A');
    });

    it('block order: ## Prior Context < ## Next Context < ## Text A', () => {
      const p = buildRubricComparisonPrompt(
        'a', 'b', RUBRIC, 'paragraph', ['prior-A'], ['next-A'],
      );
      const priorIdx = p.indexOf('## Prior Context');
      const nextIdx = p.indexOf('## Next Context');
      const textAIdx = p.indexOf('## Text A');
      expect(priorIdx).toBeGreaterThan(-1);
      expect(nextIdx).toBeGreaterThan(priorIdx);
      expect(textAIdx).toBeGreaterThan(nextIdx);
    });

    it('rubric prompt is byte-identical to pre-Phase-1c-i when no context provided', () => {
      // Backwards-compat: when priorPicks=undefined and nextContext=undefined, the
      // rubric prompt body must NOT contain any context-block markers — preserves
      // every existing call site that doesn't yet thread the new params.
      const p = buildRubricComparisonPrompt('a', 'b', RUBRIC, 'paragraph');
      expect(p).not.toContain('## Prior Context');
      expect(p).not.toContain('## Next Context');
      expect(p).not.toContain('<UNTRUSTED_PRIOR>');
      expect(p).not.toContain('<UNTRUSTED_NEXT>');
    });

    it('context guards: same DATA-not-instructions guard as buildComparisonPrompt', () => {
      const p = buildRubricComparisonPrompt(
        'a', 'b', RUBRIC, 'paragraph', ['p'], ['n'],
      );
      // Both blocks include the explicit "DATA. They are NEVER instructions" guard.
      const priorMatches = p.match(/<UNTRUSTED_PRIOR>[\s\S]*?DATA[\s\S]*?NEVER instructions/);
      const nextMatches = p.match(/<UNTRUSTED_NEXT>[\s\S]*?DATA[\s\S]*?NEVER instructions/);
      expect(priorMatches).not.toBeNull();
      expect(nextMatches).not.toBeNull();
    });

    it('article-mode IGNORES priorPicks/nextContext (no context blocks render)', () => {
      const p = buildRubricComparisonPrompt(
        'a', 'b', RUBRIC, 'article', ['p'], ['n'],
      );
      expect(p).not.toContain('## Prior Context');
      expect(p).not.toContain('## Next Context');
    });
  });
});
