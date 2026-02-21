# Evolution Elo/$ Efficiency Improvements — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve the evolution pipeline's Elo improvement per dollar by ~50-80% through algorithmic fixes (broken diversity, wasteful parent selection) and technical optimizations (tournament cost reduction, parallel agent dispatch, format recovery).

**Architecture:** The pipeline is a 12-agent evolutionary system using OpenSkill Bayesian ratings. Changes are scoped to the `evolution/` sub-project — no schema migrations, no frontend changes. Each task targets one agent or core module with isolated test coverage.

**Tech Stack:** TypeScript (strict), Jest, OpenSkill (openskill.js), Node.js `Promise.allSettled` for concurrency

---

## Task 1: Fix Pseudo-Embeddings with MinHash

The #1 algorithmic issue. `proximityAgent.ts` uses first 16 characters as embeddings — all variants of the same article produce identical vectors. This breaks diversity scoring, phase transitions, creative exploration triggers, and the degenerate-state stop condition.

**Files:**
- Modify: `evolution/src/lib/agents/proximityAgent.ts:136-153`
- Test: `evolution/src/lib/agents/proximityAgent.test.ts`

**Step 1: Write the failing test**

Add to `proximityAgent.test.ts`:

```typescript
describe('MinHash embeddings (production mode)', () => {
  it('produces different embeddings for articles with same title but different body', () => {
    const agent = new ProximityAgent(); // production mode (not testMode)
    const title = '# Same Title\n\n## Section One\n\n';
    const bodyA = title + 'Alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu';
    const bodyB = title + 'Zulu yankee xray whiskey victor uniform tango sierra romeo quebec papa oscar november mike lima kilo juliet india hotel golf foxtrot echo delta charlie bravo alpha';
    const embedA = agent._embed(bodyA);
    const embedB = agent._embed(bodyB);
    const sim = cosineSimilarity(embedA, embedB);
    // Must distinguish these — old pseudo-embeddings gave sim ≈ 1.0
    expect(sim).toBeLessThan(0.95);
    expect(sim).toBeGreaterThan(0); // not orthogonal
  });

  it('produces high similarity for near-identical texts', () => {
    const agent = new ProximityAgent();
    const textA = '# Title\n\n## Intro\n\nThe quick brown fox jumps over the lazy dog repeatedly.';
    const textB = '# Title\n\n## Intro\n\nThe quick brown fox leaps over the lazy dog repeatedly.';
    const sim = cosineSimilarity(agent._embed(textA), agent._embed(textB));
    expect(sim).toBeGreaterThan(0.8);
  });

  it('produces 64-dimensional vectors', () => {
    const agent = new ProximityAgent();
    const embed = agent._embed('# Title\n\nSome content here with enough words to generate shingles.');
    expect(embed).toHaveLength(64);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd evolution && npx jest src/lib/agents/proximityAgent.test.ts --testNamePattern="MinHash" -v`
Expected: FAIL — old 16-char embeddings give sim ≈ 1.0 for different bodies

**Step 3: Write minimal implementation**

Replace the production branch in `proximityAgent.ts:146-153`:

```typescript
    // MinHash on word trigrams — zero-cost, captures lexical similarity across full text.
    const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 0);
    const DIMS = 64;
    const vec = new Array(DIMS).fill(0);
    for (let i = 0; i < words.length - 2; i++) {
      const shingle = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
      let h = 0;
      for (let j = 0; j < shingle.length; j++) {
        h = (Math.imul(31, h) + shingle.charCodeAt(j)) >>> 0;
      }
      vec[h % DIMS]++;
    }
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map(v => v / norm);
```

Remove the `_pseudoEmbeddingWarned` field and the `console.warn` call since they're no longer needed.

**Step 4: Run test to verify it passes**

Run: `cd evolution && npx jest src/lib/agents/proximityAgent.test.ts -v`
Expected: ALL PASS (including existing tests — testMode still uses MD5 hash path)

**Step 5: Run lint + tsc**

Run: `cd evolution && npx eslint src/lib/agents/proximityAgent.ts --fix && npx tsc --noEmit`

**Step 6: Commit**

```bash
git add evolution/src/lib/agents/proximityAgent.ts evolution/src/lib/agents/proximityAgent.test.ts
git commit -m "feat(evolution): replace pseudo-embeddings with MinHash trigram hashing

Fixes HIGH-4: production _embed() used first 16 chars, producing identical
vectors for all variants of the same article. Now uses word-trigram MinHash
over the full text body, generating 64-dim vectors with meaningful cosine
similarity. Zero API cost, ~0.1ms per text.

Unlocks correct behavior for: phase transitions, creative exploration
trigger, degenerate-state stop condition, diversity history tracking."
```

---

## Task 2: Tournament Quick Fixes (4 independent changes)

Four low-risk tournament optimizations that can ship as one PR.

**Files:**
- Modify: `evolution/src/lib/agents/tournament.ts:42,44,184,337`
- Modify: `evolution/src/lib/core/reversalComparison.ts:31-35`
- Test: `evolution/src/lib/agents/tournament.test.ts`

**Step 1: Write failing tests for each fix**

Add to `tournament.test.ts`:

```typescript
describe('convergence streak reduction', () => {
  it('exits after 2 consecutive converged rounds (not 5)', async () => {
    // Construct a tournament where all variants converge quickly.
    // With convergenceChecks=2 it should exit at round 2, not round 5.
    const tournament = new Tournament({ convergenceChecks: 2 });
    // ... (use existing test patterns from the file, mock comparisons so all
    // variants reach sigma < 3.0 within 2 rounds)
    // Assert: exitReason === 'convergence'
  });
});

describe('tiebreaker threshold', () => {
  it('does not fire tiebreaker for confidence 0.7 matches', async () => {
    // Mock a comparison returning confidence 0.7 (one TIE, one decisive).
    // Assert: the LLM client is called exactly 2 times (forward+reverse),
    // NOT 3 (no tiebreaker).
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd evolution && npx jest src/lib/agents/tournament.test.ts --testNamePattern="convergence streak|tiebreaker" -v`
Expected: FAIL

**Step 3: Apply the four fixes**

**Fix A — Reduce convergence streak** (`tournament.ts:42`):
```typescript
  convergenceChecks: 2,  // was 5 — sigma is monotonically decreasing, 2 is sufficient
```

**Fix B — Reduce stale rounds** (`tournament.ts:44`):
```typescript
  maxStaleRounds: 1,  // was 3 — if no pairs exist, exit immediately
```

**Fix C — Tighten tiebreaker threshold** (`tournament.ts:184`):
```typescript
    if (useMultiTurn && match.confidence <= 0.5) {  // was < 1.0 — only genuine disagreement
```

Also remove the dead code at lines 195-203 (duplicate `tiebreaker.winner === null` check):

```typescript
      if (tiebreaker.winner === 'A') {
        return { ...match, winner: varA.id, confidence: 0.8, turns: 3, dimensionScores: mergedDims };
      }
      if (tiebreaker.winner === 'B') {
        return { ...match, winner: varB.id, confidence: 0.8, turns: 3, dimensionScores: mergedDims };
      }
      // Tiebreaker inconclusive — return original match with reduced confidence
      return { ...match, confidence: 0.4, turns: 3, dimensionScores: mergedDims };
```

**Fix D — Parallelize reversal comparison** (`reversalComparison.ts:31-35`):
```typescript
  const [forwardResponse, reverseResponse] = await Promise.all([
    config.callLLM(forward),
    config.callLLM(reverse),
  ]);
  const forwardParsed = config.parseResponse(forwardResponse);
  const reverseParsed = config.parseResponse(reverseResponse);
```

**Step 4: Run all tournament and comparison tests**

Run: `cd evolution && npx jest src/lib/agents/tournament.test.ts src/lib/core/reversalComparison.test.ts -v`
Expected: ALL PASS

**Step 5: Run lint + tsc**

Run: `cd evolution && npx eslint src/lib/agents/tournament.ts src/lib/core/reversalComparison.ts --fix && npx tsc --noEmit`

**Step 6: Commit**

```bash
git add evolution/src/lib/agents/tournament.ts evolution/src/lib/core/reversalComparison.ts evolution/src/lib/agents/tournament.test.ts
git commit -m "fix(evolution): tournament cost reduction — 4 quick wins

- convergenceChecks 5→2: sigma is monotonic, 5 rounds of confirmation was waste
- maxStaleRounds 3→1: exit immediately when no pairs remain
- tiebreaker threshold <1.0→≤0.5: only fire for genuine disagreement, not TIE-vs-winner
- run2PassReversal: sequential→Promise.all (50% calibration latency reduction)
- Removed dead code: duplicate null check in tiebreaker path

Estimated savings: ~30% reduction in tournament+calibration LLM calls."
```

---

## Task 3: Format Auto-Fix Mode

Recover variants that fail formatting instead of wasting LLM spend.

**Files:**
- Modify: `evolution/src/lib/agents/formatValidator.ts`
- Modify: `evolution/src/lib/core/formatValidationRules.ts` (if needed)
- Test: `evolution/src/lib/agents/formatValidator.test.ts`

**Step 1: Write failing tests**

Add to `formatValidator.test.ts`:

```typescript
describe('FORMAT_VALIDATION_MODE=fix', () => {
  beforeEach(() => { process.env.FORMAT_VALIDATION_MODE = 'fix'; });
  afterEach(() => { delete process.env.FORMAT_VALIDATION_MODE; });

  it('converts bullet points to prose paragraphs', () => {
    const input = '# Title\n\n## Section\n\n- First point about something\n- Second important detail\n- Third conclusion here\n\nA normal paragraph follows with two sentences. It continues here.';
    const result = validateFormat(input);
    expect(result.valid).toBe(true);
    expect(result.fixedText).toBeDefined();
    expect(result.fixedText).not.toContain('- ');
  });

  it('promotes first line to H1 when missing', () => {
    const input = 'My Article Title\n\n## Section\n\nSome content here with two sentences. More content follows.';
    const result = validateFormat(input);
    expect(result.valid).toBe(true);
    expect(result.fixedText).toMatch(/^# My Article Title/);
  });

  it('demotes extra H1s to H2', () => {
    const input = '# Title\n\n## Section\n\n# Another H1\n\nContent paragraph with enough sentences. Another sentence here.';
    const result = validateFormat(input);
    expect(result.valid).toBe(true);
    const h1Count = (result.fixedText!.match(/^# /gm) || []).length;
    expect(h1Count).toBe(1);
  });

  it('returns original text when no fixes needed', () => {
    const input = '# Good Title\n\n## Section One\n\nA paragraph with two sentences. Here is the second.';
    const result = validateFormat(input);
    expect(result.valid).toBe(true);
    expect(result.fixedText).toBeUndefined(); // no fix needed
  });

  it('rejects if auto-fix cannot resolve all issues', () => {
    // Text with only single-sentence paragraphs (not auto-fixable)
    const input = '# Title\n\n## Section\n\nOne.\n\nTwo.\n\nThree.\n\nFour.\n\nFive.';
    const result = validateFormat(input);
    expect(result.valid).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd evolution && npx jest src/lib/agents/formatValidator.test.ts --testNamePattern="fix" -v`
Expected: FAIL — `fixedText` property doesn't exist, `fix` mode not recognized

**Step 3: Implement auto-fix**

Update `FormatResult` interface and add fix logic to `formatValidator.ts`:

```typescript
export interface FormatResult {
  valid: boolean;
  issues: string[];
  /** If mode=fix and fixes were applied, contains the corrected text. */
  fixedText?: string;
}

/** Attempt to auto-fix common format violations. Returns null if no fixes possible. */
function autoFixFormat(text: string): string | null {
  let fixed = text;
  let changed = false;

  const lines = fixed.split('\n');

  // Fix: missing H1 — promote first non-empty line
  const h1Lines = findH1Lines(lines);
  if (h1Lines.length === 0) {
    const firstIdx = lines.findIndex(l => l.trim().length > 0);
    if (firstIdx >= 0 && !lines[firstIdx].startsWith('#')) {
      lines[firstIdx] = `# ${lines[firstIdx].trim()}`;
      changed = true;
    }
  }

  // Fix: multiple H1s — demote extras to H2
  if (h1Lines.length > 1) {
    for (let i = 1; i < h1Lines.length; i++) {
      lines[h1Lines[i]] = '#' + lines[h1Lines[i]]; // # Title → ## Title
    }
    changed = true;
  }

  // Fix: H1 not on first line — swap to position 0
  if (h1Lines.length === 1 && h1Lines[0] !== 0) {
    const firstNonEmpty = lines.findIndex(l => l.trim().length > 0);
    if (h1Lines[0] !== firstNonEmpty) {
      const h1Line = lines.splice(h1Lines[0], 1)[0];
      lines.unshift(h1Line);
      changed = true;
    }
  }

  fixed = lines.join('\n');

  // Fix: bullet points → prose sentences
  const bulletPattern = /^(\s*[-*+]\s.+\n?)+/gm;
  if (bulletPattern.test(fixed)) {
    fixed = fixed.replace(bulletPattern, (block) => {
      const items = block.split('\n')
        .filter(l => /^\s*[-*+]\s/.test(l))
        .map(l => l.replace(/^\s*[-*+]\s+/, '').trim())
        .filter(Boolean);
      if (items.length === 0) return block;
      return items.join('. ') + '.\n\n';
    });
    changed = true;
  }

  // Fix: numbered lists → prose sentences
  const numberedPattern = /^(\s*\d+[.)]\s.+\n?)+/gm;
  if (numberedPattern.test(fixed)) {
    fixed = fixed.replace(numberedPattern, (block) => {
      const items = block.split('\n')
        .filter(l => /^\s*\d+[.)]\s/.test(l))
        .map(l => l.replace(/^\s*\d+[.)]\s+/, '').trim())
        .filter(Boolean);
      if (items.length === 0) return block;
      return items.join('. ') + '.\n\n';
    });
    changed = true;
  }

  // Fix: tables → remove (lossy but prevents rejection)
  const tablePattern = /^\|.+\|$/gm;
  if (tablePattern.test(stripCodeBlocks(fixed))) {
    fixed = fixed.replace(/^\|.+\|\n?/gm, '');
    // Remove separator lines
    fixed = fixed.replace(/^[|:\- ]+\n?/gm, '');
    changed = true;
  }

  return changed ? fixed : null;
}
```

Update `validateFormat` to handle `fix` mode:

```typescript
  if (mode === 'fix' && issues.length > 0) {
    const fixedText = autoFixFormat(text);
    if (fixedText) {
      // Re-validate the fixed text in reject mode
      const recheck = validateFormatInternal(fixedText);
      if (recheck.issues.length === 0) {
        return { valid: true, issues: [], fixedText };
      }
      // Fix didn't resolve everything — reject with remaining issues
      return { valid: false, issues: recheck.issues };
    }
    // No fixes possible — reject
    return { valid: false, issues };
  }
```

**Step 4: Run all format validator tests**

Run: `cd evolution && npx jest src/lib/agents/formatValidator.test.ts -v`
Expected: ALL PASS

**Step 5: Wire auto-fix into generationAgent**

Update `generationAgent.ts:82-88` to use fixedText when available:

```typescript
        const fmtResult = validateFormat(generatedText);
        if (!fmtResult.valid) {
          logger.warn('Format rejected', { strategy, issues: fmtResult.issues });
          return { text: null, strategy, formatIssues: fmtResult.issues };
        }
        const finalText = fmtResult.fixedText ?? generatedText;
        return { text: finalText.trim(), strategy, formatIssues: undefined };
```

Apply the same pattern in `evolvePool.ts` wherever `validateFormat` is called.

**Step 6: Run lint + tsc + full test suite**

Run: `cd evolution && npx eslint src/lib/agents/formatValidator.ts src/lib/agents/generationAgent.ts --fix && npx tsc --noEmit && npx jest --passWithNoTests`

**Step 7: Commit**

```bash
git add evolution/src/lib/agents/formatValidator.ts evolution/src/lib/agents/formatValidator.test.ts evolution/src/lib/agents/generationAgent.ts evolution/src/lib/agents/evolvePool.ts
git commit -m "feat(evolution): add FORMAT_VALIDATION_MODE=fix for auto-recovery

Auto-fixes: bullet→prose, numbered-list→prose, missing/extra H1, table removal.
Re-validates after fix; rejects only if auto-fix can't resolve all issues.
Wired into generationAgent and evolvePool to use fixedText when available.

Recovers ~30-50% of format-rejected variants (mostly bullet violations
from structural_transform strategy)."
```

---

## Task 4: Diverse Parent Selection for Crossover

Fix the always-top-2 elitist parent selection that kills crossover diversity.

**Files:**
- Modify: `evolution/src/lib/core/pool.ts:107-112`
- Test: `evolution/src/lib/core/pool.test.ts`

**Step 1: Write failing test**

Add to `pool.test.ts`:

```typescript
describe('getEvolutionParents diversity', () => {
  it('selects second parent dissimilar to first when similarity data exists', () => {
    // Create pool with 6 variants, top-3 by rating
    // Set similarity: top1↔top2 = 0.95 (near-identical), top1↔top3 = 0.3 (different)
    // Assert: second parent is top3, not top2 (prefers diversity)
    const state = new PipelineStateImpl(DEFAULT_EVOLUTION_CONFIG, 'test-article');
    const v1 = makeVariation('v1', 'text-1', { strategy: 'structural_transform' });
    const v2 = makeVariation('v2', 'text-2', { strategy: 'lexical_simplify' });
    const v3 = makeVariation('v3', 'text-3', { strategy: 'grounding_enhance' });
    state.addToPool(v1); state.addToPool(v2); state.addToPool(v3);
    // v1 = best, v2 = second, v3 = third
    state.ratings.set('v1', { mu: 30, sigma: 3 });
    state.ratings.set('v2', { mu: 28, sigma: 3 });
    state.ratings.set('v3', { mu: 26, sigma: 3 });
    // v1↔v2 very similar, v1↔v3 different
    state.similarityMatrix = {
      v1: { v2: 0.95, v3: 0.3 },
      v2: { v1: 0.95, v3: 0.5 },
      v3: { v1: 0.3, v2: 0.5 },
    };

    const pool = new PoolManager(state);
    const parents = pool.getEvolutionParents(2);
    expect(parents[0].id).toBe('v1'); // elitist first parent
    expect(parents[1].id).toBe('v3'); // diverse second parent
  });

  it('falls back to rating order when no similarity data exists', () => {
    const state = new PipelineStateImpl(DEFAULT_EVOLUTION_CONFIG, 'test-article');
    const v1 = makeVariation('v1', 'text-1', { strategy: 'structural_transform' });
    const v2 = makeVariation('v2', 'text-2', { strategy: 'lexical_simplify' });
    state.addToPool(v1); state.addToPool(v2);
    state.ratings.set('v1', { mu: 30, sigma: 3 });
    state.ratings.set('v2', { mu: 28, sigma: 3 });

    const pool = new PoolManager(state);
    const parents = pool.getEvolutionParents(2);
    expect(parents[0].id).toBe('v1');
    expect(parents[1].id).toBe('v2'); // rating fallback
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd evolution && npx jest src/lib/core/pool.test.ts --testNamePattern="diversity" -v`
Expected: FAIL — current code always returns top-2 by rating

**Step 3: Implement diverse selection**

Replace `getEvolutionParents` in `pool.ts:107-112`:

```typescript
  /** Get top N parents for evolution. First parent is elitist (top-1). Second parent
   *  is chosen from top-30% weighted by dissimilarity to first, if similarity data exists. */
  getEvolutionParents(n: number = 2): TextVariation[] {
    const allByRating = this.state.getTopByRating(this.state.getPoolSize());
    const eligible = allByRating.filter((v) => v.strategy !== BASELINE_STRATEGY);
    if (eligible.length === 0) return [];
    if (n <= 1 || eligible.length <= 1) return eligible.slice(0, n);

    const firstParent = eligible[0];

    // Try diversity-weighted selection for second parent
    const candidateCount = Math.max(2, Math.floor(eligible.length * 0.3));
    const candidates = eligible.slice(0, candidateCount).filter(v => v.id !== firstParent.id);

    if (candidates.length > 0 && this.state.similarityMatrix) {
      // Sort by ascending similarity to first parent (most different first)
      candidates.sort((a, b) => {
        const simA = this.state.similarityMatrix?.[firstParent.id]?.[a.id]
          ?? this.state.similarityMatrix?.[a.id]?.[firstParent.id] ?? 0.5;
        const simB = this.state.similarityMatrix?.[firstParent.id]?.[b.id]
          ?? this.state.similarityMatrix?.[b.id]?.[firstParent.id] ?? 0.5;
        return simA - simB;
      });
      return [firstParent, candidates[0]];
    }

    // Fallback: top-2 by rating
    return eligible.slice(0, n);
  }
```

**Step 4: Run tests**

Run: `cd evolution && npx jest src/lib/core/pool.test.ts -v`
Expected: ALL PASS

**Step 5: Run lint + tsc**

Run: `cd evolution && npx eslint src/lib/core/pool.ts --fix && npx tsc --noEmit`

**Step 6: Commit**

```bash
git add evolution/src/lib/core/pool.ts evolution/src/lib/core/pool.test.ts
git commit -m "feat(evolution): diversity-weighted second parent for crossover

First parent stays elitist (top-1 by ordinal). Second parent is chosen
from top-30% by lowest similarity to first parent using the similarity
matrix. Falls back to rating order when no similarity data exists.

Prevents repeated crossover of near-identical parents that produces
homogeneous children."
```

---

## Task 5: Pool Culling at Phase Transition

Prevent unbounded pool growth from inflating calibration costs.

**Files:**
- Modify: `evolution/src/lib/core/supervisor.ts:189-194`
- Test: `evolution/src/lib/core/supervisor.test.ts`

**Step 1: Write failing test**

Add to `supervisor.test.ts`:

```typescript
describe('pool culling at phase transition', () => {
  it('removes bottom 25% of variants at EXPANSION→COMPETITION transition', () => {
    const cfg: SupervisorConfig = {
      maxIterations: 15, minBudget: 0.01, plateauWindow: 3, plateauThreshold: 0.02,
      expansionMinPool: 5, expansionDiversityThreshold: 0.25, expansionMaxIterations: 3,
      singleArticle: false,
    };
    const supervisor = new PoolSupervisor(cfg);
    const state = new PipelineStateImpl(DEFAULT_EVOLUTION_CONFIG, 'test');

    // Add 12 variants + baseline
    const baseline = makeVariation('baseline', 'baseline-text', { strategy: 'baseline' as any });
    state.addToPool(baseline);
    for (let i = 0; i < 12; i++) {
      const v = makeVariation(`v${i}`, `text-${i}`, { strategy: 'structural_transform' });
      state.addToPool(v);
      state.ratings.set(v.id, { mu: 25 + i, sigma: 5 }); // v11 is best
    }
    state.diversityScore = 0.5;

    // Force past expansion max iterations
    state.iteration = 3;
    supervisor.beginIteration(state); // should trigger transition + culling

    // Bottom 25% = 3 variants (v0, v1, v2) should be removed
    expect(state.getPoolSize()).toBeLessThanOrEqual(10); // 13 - 3 = 10
    expect(state.pool.find(v => v.id === 'baseline')).toBeDefined(); // baseline preserved
    expect(state.pool.find(v => v.id === 'v11')).toBeDefined(); // top variant preserved
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd evolution && npx jest src/lib/core/supervisor.test.ts --testNamePattern="culling" -v`
Expected: FAIL — no culling happens

**Step 3: Implement culling**

Update `transitionToCompetition` in `supervisor.ts:189-194`. The supervisor currently doesn't have access to state — we need to pass it in. Update `beginIteration`:

```typescript
  beginIteration(state: PipelineState): void {
    this.guardIterationIdempotency(state.iteration);
    this._currentIteration = state.iteration;

    const phase = this._phaseLocked ?? this.detectPhase(state);
    const isPhaseTransition = phase === 'COMPETITION' && this._currentPhase === 'EXPANSION';

    if (isPhaseTransition) {
      this.transitionToCompetition(state);
    }

    this._currentPhase = phase;
    // ...rest unchanged
  }

  private transitionToCompetition(state: PipelineState): void {
    this._phaseLocked = 'COMPETITION';
    this.ordinalHistory = [];
    this.diversityHistory = [];
    this._strategyRotationIndex = -1;

    // Cull bottom 25% of rated variants to reduce calibration overhead
    this.cullBottomQuartile(state);
  }

  private cullBottomQuartile(state: PipelineState): void {
    if (state.ratings.size < 8) return; // too few to cull meaningfully
    const rated = [...state.ratings.entries()]
      .map(([id, r]) => ({ id, ordinal: getOrdinal(r) }))
      .sort((a, b) => a.ordinal - b.ordinal); // ascending — worst first

    const cullCount = Math.floor(rated.length * 0.25);
    const toCull = new Set(rated.slice(0, cullCount).map(e => e.id));

    // Never cull baseline
    const baselineId = state.pool.find(v => v.strategy === BASELINE_STRATEGY)?.id;
    if (baselineId) toCull.delete(baselineId);

    if (toCull.size === 0) return;

    // Remove from pool and ratings
    state.pool = state.pool.filter(v => !toCull.has(v.id));
    for (const id of toCull) {
      state.ratings.delete(id);
      state.poolIds.delete(id);
    }
  }
```

Note: `state.pool` is a public array per `PipelineStateImpl` in `state.ts`. We'll need to verify `poolIds` is a `Set<string>` that tracks active pool member IDs.

**Step 4: Run tests**

Run: `cd evolution && npx jest src/lib/core/supervisor.test.ts -v`
Expected: ALL PASS

**Step 5: Run lint + tsc**

Run: `cd evolution && npx eslint src/lib/core/supervisor.ts --fix && npx tsc --noEmit`

**Step 6: Commit**

```bash
git add evolution/src/lib/core/supervisor.ts evolution/src/lib/core/supervisor.test.ts
git commit -m "feat(evolution): cull bottom 25% of pool at EXPANSION→COMPETITION transition

Removes the lowest-rated quartile when entering COMPETITION phase.
Preserves baseline variant. Requires minimum pool of 8 to trigger.
Reduces calibration cost by shrinking the opponent pool for stratified
sampling."
```

---

## Task 6: Self-Eval Pre-Filter Before Pool Entry

Gate variants with a cheap pointwise quality check before paying calibration costs.

**Files:**
- Modify: `evolution/src/lib/agents/generationAgent.ts:82-88`
- Modify: `evolution/src/lib/agents/evolvePool.ts` (same pattern)
- Test: `evolution/src/lib/agents/generationAgent.test.ts`

**Step 1: Write failing test**

Add to existing generation agent tests (or create a focused test file):

```typescript
describe('self-eval pre-filter', () => {
  it('rejects variants that score below threshold', async () => {
    const mockLLM = createMockEvolutionLLMClient({
      complete: jest.fn()
        .mockResolvedValueOnce('# Title\n\n## Section\n\nGenerated text is here. Second sentence.')
        .mockResolvedValueOnce('{"score": 3, "reason": "low quality"}') // self-eval rejects
        .mockResolvedValueOnce('# Title\n\n## Section\n\nAnother good text here. Second sentence.')
        .mockResolvedValueOnce('{"score": 7, "reason": "good quality"}') // self-eval accepts
        .mockResolvedValueOnce('# Title\n\n## Section\n\nThird variant text. Second sentence.')
        .mockResolvedValueOnce('{"score": 8, "reason": "great quality"}'), // self-eval accepts
    });
    const ctx = createMockExecutionContext({ llmClient: mockLLM });
    ctx.state.originalText = '# Article\n\n## Intro\n\nOriginal content.';

    const agent = new GenerationAgent();
    const result = await agent.execute(ctx);

    // 3 strategies generated, but 1 filtered by self-eval = 2 added to pool
    expect(result.variantsAdded).toBe(2);
  });

  it('gracefully handles self-eval parse failure', async () => {
    const mockLLM = createMockEvolutionLLMClient({
      complete: jest.fn()
        .mockResolvedValueOnce('# Title\n\n## Section\n\nValid text. Second sentence.')
        .mockResolvedValueOnce('unparseable garbage'), // self-eval fails to parse
    });
    const ctx = createMockExecutionContext({ llmClient: mockLLM });
    ctx.state.originalText = '# Article\n\n## Intro\n\nOriginal.';

    const agent = new GenerationAgent();
    const result = await agent.execute(ctx);

    // Self-eval parse failure should NOT reject the variant (fail-open)
    expect(result.variantsAdded).toBe(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd evolution && npx jest src/lib/agents/generationAgent.test.ts --testNamePattern="self-eval" -v`
Expected: FAIL — no self-eval exists

**Step 3: Implement self-eval gate**

Add helper function and wire into `generationAgent.ts`:

```typescript
const SELF_EVAL_THRESHOLD = 5;

async function selfEvalGate(
  text: string,
  llmClient: EvolutionLLMClient,
  agentName: string,
  logger: EvolutionLogger,
): Promise<boolean> {
  try {
    const prompt = `Rate this article on a scale of 1-10 for overall writing quality (clarity, structure, engagement). Output ONLY a JSON object: {"score": N}\n\n${text.slice(0, 3000)}`;
    const response = await llmClient.complete(prompt, agentName, { model: 'gpt-4.1-nano' });
    const match = response.match(/\{\s*"score"\s*:\s*(\d+)/);
    if (!match) return true; // fail-open: can't parse → keep the variant
    const score = parseInt(match[1], 10);
    return score >= SELF_EVAL_THRESHOLD;
  } catch {
    return true; // fail-open on error
  }
}
```

Wire into the generation loop after format validation:

```typescript
        if (!fmtResult.valid) {
          logger.warn('Format rejected', { strategy, issues: fmtResult.issues });
          return { text: null, strategy, formatIssues: fmtResult.issues };
        }
        const finalText = fmtResult.fixedText ?? generatedText;
        // Self-eval quality gate
        const passesEval = await selfEvalGate(finalText, llmClient, 'generation', logger);
        if (!passesEval) {
          logger.info('Self-eval pre-filter rejected', { strategy });
          return { text: null, strategy, formatIssues: undefined, selfEvalRejected: true };
        }
        return { text: finalText.trim(), strategy, formatIssues: undefined };
```

Apply the same pattern in `evolvePool.ts`.

**Step 4: Run all generation agent tests**

Run: `cd evolution && npx jest src/lib/agents/generationAgent.test.ts -v`
Expected: ALL PASS

**Step 5: Run lint + tsc**

Run: `cd evolution && npx eslint src/lib/agents/generationAgent.ts src/lib/agents/evolvePool.ts --fix && npx tsc --noEmit`

**Step 6: Commit**

```bash
git add evolution/src/lib/agents/generationAgent.ts evolution/src/lib/agents/generationAgent.test.ts evolution/src/lib/agents/evolvePool.ts
git commit -m "feat(evolution): self-eval pre-filter gates variants before pool entry

Cheap pointwise quality check (gpt-4.1-nano, ~$0.0002/eval) before
adding to pool. Variants scoring <5/10 are rejected, avoiding expensive
calibration matches on low-quality outputs. Fail-open on parse errors.

Estimated savings: 15-25% calibration cost reduction by filtering
low-quality variants from creative_exploration and mutation strategies."
```

---

## Task 7: Staged Parallel Agent Dispatch

The highest-impact technical change — 3-4x wall-clock speedup.

**Files:**
- Modify: `evolution/src/lib/core/pipeline.ts:388-415`
- Modify: `evolution/src/lib/agents/iterativeEditingAgent.ts` (snapshot fix)
- Test: `evolution/src/lib/core/pipelineFlow.test.ts`

**Step 1: Write failing test**

Add to `pipelineFlow.test.ts`:

```typescript
describe('staged parallel dispatch', () => {
  it('runs generation and outlineGeneration concurrently in stage 1', async () => {
    // Use spy to track execution order via timestamps
    const executionLog: Array<{ agent: string; startMs: number; endMs: number }> = [];
    // Mock agents that record start/end times
    // Assert: generation.startMs ≈ outlineGeneration.startMs (concurrent)
    // Assert: calibration.startMs > generation.endMs (sequential gate)
  });
});
```

This test requires careful mock setup — the exact test depends on how concurrency is verified (timestamps or execution order tracking).

**Step 2: Implement staged dispatch**

Replace the sequential `for...of` loop in `executeFullPipeline` (`pipeline.ts:388-415`) with staged execution:

```typescript
        // ─── Staged parallel dispatch ─────────────────────────────────
        const agentSet = new Set(config.activeAgents);

        // Stage 1: Variant producers (generation + outlineGeneration + evolution if rated parents exist)
        const stage1: Array<Promise<AgentResult | null>> = [];
        if (agentSet.has('generation') && agents.generation) {
          stage1.push(runAgent(runId, agents.generation, ctx, phase, logger, executionOrder++));
        }
        if (agentSet.has('outlineGeneration') && agents.outlineGeneration) {
          stage1.push(runAgent(runId, agents.outlineGeneration, ctx, phase, logger, executionOrder++));
        }
        // Evolution can run in stage 1 if rated parents exist (iteration > 1)
        const evolutionInStage1 = agentSet.has('evolution') && agents.evolution && state.ratings.size >= 1;
        if (evolutionInStage1) {
          stage1.push(runAgent(runId, agents.evolution, ctx, phase, logger, executionOrder++));
        }
        if (stage1.length > 0) await Promise.allSettled(stage1);

        // Stage 2: Critique producers (needs pool from stage 1)
        const stage2: Array<Promise<any>> = [];
        if (agentSet.has('reflection') && agents.reflection) {
          stage2.push(runAgent(runId, agents.reflection, ctx, phase, logger, executionOrder++));
        }
        if (agentSet.has('flowCritique')) {
          stage2.push(runFlowCritiques(ctx, logger).then(r => {
            persistCheckpoint(runId, ctx.state, 'flowCritique', phase, logger, 3, ctx.costTracker.getTotalSpent(), ctx.comparisonCache);
            return r;
          }));
        }
        if (stage2.length > 0) await Promise.allSettled(stage2);

        // Stage 3: Calibration (needs new entrants from stage 1)
        if (agentSet.has('ranking')) {
          const rankingAgent = phase === 'COMPETITION' ? agents.tournament : agents.calibration;
          await runAgent(runId, rankingAgent, ctx, phase, logger, executionOrder++);
        }

        // Stage 4: Editing agents (needs ratings from stage 3, critiques from stage 2)
        const stage4: Array<Promise<AgentResult | null>> = [];
        if (agentSet.has('iterativeEditing') && agents.iterativeEditing) {
          stage4.push(runAgent(runId, agents.iterativeEditing, ctx, phase, logger, executionOrder++));
        }
        if (agentSet.has('treeSearch') && agents.treeSearch) {
          stage4.push(runAgent(runId, agents.treeSearch, ctx, phase, logger, executionOrder++));
        }
        if (agentSet.has('sectionDecomposition') && agents.sectionDecomposition) {
          stage4.push(runAgent(runId, agents.sectionDecomposition, ctx, phase, logger, executionOrder++));
        }
        if (agentSet.has('debate') && agents.debate) {
          stage4.push(runAgent(runId, agents.debate, ctx, phase, logger, executionOrder++));
        }
        // Evolution in stage 4 if not already in stage 1
        if (agentSet.has('evolution') && agents.evolution && !evolutionInStage1) {
          stage4.push(runAgent(runId, agents.evolution, ctx, phase, logger, executionOrder++));
        }
        if (stage4.length > 0) await Promise.allSettled(stage4);

        // Stage 5: Second ranking pass (tournament for new variants from stage 4)
        // Only in COMPETITION phase, only if stage 4 produced new entrants
        if (phase === 'COMPETITION' && state.newEntrantsThisIteration.length > 0) {
          await runAgent(runId, agents.calibration, ctx, phase, logger, executionOrder++);
        }

        // Stage 6: Proximity + MetaReview (needs all variants and ratings)
        if (agentSet.has('proximity') && agents.proximity) {
          await runAgent(runId, agents.proximity, ctx, phase, logger, executionOrder++);
        }
        if (agentSet.has('metaReview') && agents.metaReview) {
          await runAgent(runId, agents.metaReview, ctx, phase, logger, executionOrder++);
        }
```

**Step 3: Fix iterativeEditingAgent target snapshot**

In `iterativeEditingAgent.ts`, ensure the target variant is captured once at the start:

```typescript
  // Snapshot target at agent start — don't re-query mid-cycle in parallel context
  const topVariants = state.getTopByRating(1);
  if (topVariants.length === 0) return { ... };
  let current = topVariants[0];
  // Use 'current' throughout all cycles without re-querying
```

**Step 4: Run all pipeline tests**

Run: `cd evolution && npx jest src/lib/core/pipelineFlow.test.ts -v`
Expected: ALL PASS

**Step 5: Run lint + tsc + full evolution test suite**

Run: `cd evolution && npx eslint src/lib/core/pipeline.ts src/lib/agents/iterativeEditingAgent.ts --fix && npx tsc --noEmit && npx jest --passWithNoTests`

**Step 6: Commit**

```bash
git add evolution/src/lib/core/pipeline.ts evolution/src/lib/agents/iterativeEditingAgent.ts evolution/src/lib/core/pipelineFlow.test.ts
git commit -m "feat(evolution): staged parallel agent dispatch for 3-4x wall-clock speedup

Replaces sequential agent-by-agent loop with 6-stage parallel dispatch:
  Stage 1: generation ∥ outlineGeneration ∥ evolution (variant producers)
  Stage 2: reflection ∥ flowCritique (critique producers)
  Stage 3: calibration (rating gate)
  Stage 4: iterativeEditing ∥ treeSearch ∥ sectionDecomp ∥ debate (editors)
  Stage 5: second calibration for stage-4 new entrants
  Stage 6: proximity + metaReview (analysis)

Safe in JS cooperative concurrency — all shared state is append-only.
Fixed iterativeEditingAgent to snapshot target variant once at start."
```

---

## Task 8: Confidence Instrumentation

Enable data-driven decisions for adaptive single-pass (future work).

**Files:**
- Modify: `evolution/src/lib/core/metricsWriter.ts`
- Modify: `evolution/src/lib/agents/tournament.ts`
- Test: `evolution/src/lib/core/metricsWriter.test.ts`

**Step 1: Write failing test**

```typescript
describe('confidence distribution tracking', () => {
  it('records confidence levels in tournament execution detail', async () => {
    // Run a tournament with mocked comparisons returning various confidence levels
    // Assert: executionDetail includes confidenceDistribution with counts
    const detail = result.executionDetail as TournamentExecutionDetail;
    expect(detail.confidenceDistribution).toBeDefined();
    expect(detail.confidenceDistribution!['1.0']).toBeGreaterThan(0);
  });
});
```

**Step 2: Implement**

Add to `TournamentExecutionDetail` type in `types.ts`:
```typescript
  confidenceDistribution?: Record<string, number>;
```

In `tournament.ts`, track confidence levels during execution:
```typescript
    const confidenceCounts: Record<string, number> = {};
    // Inside the match processing loop:
    const bucket = match.confidence.toFixed(1);
    confidenceCounts[bucket] = (confidenceCounts[bucket] ?? 0) + 1;
    // Include in detail:
    confidenceDistribution: confidenceCounts,
```

**Step 3: Run tests, lint, commit**

```bash
git add evolution/src/lib/agents/tournament.ts evolution/src/lib/types.ts evolution/src/lib/core/metricsWriter.ts
git commit -m "feat(evolution): instrument confidence distributions in tournament metrics

Tracks per-comparison confidence level counts (1.0, 0.7, 0.5, 0.3, 0.0)
in TournamentExecutionDetail. Enables data-driven decisions for adaptive
single-pass bias mitigation in future work."
```

---

## Execution Order Summary

### Active (This Sprint)

| Task | Depends On | Estimated Time |
|------|-----------|---------------|
| 1. MinHash embeddings | None | 15 min |
| 2. Tournament quick fixes | None | 20 min |
| 5. Pool culling | None | 15 min |
| 8. Confidence instrumentation | None | 10 min |
| 7. Staged parallel dispatch | After 1, 2, 5, 8 | 40 min |

Tasks 1, 2, 5, 8 are fully independent. Task 7 is last (most complex, benefits from clean integration).

### Deferred (Appendix)

Tasks 3 (format auto-fix), 4 (diverse parent selection), 6 (self-eval pre-filter) are deferred to a follow-up sprint. Their full specs remain above for reference.
