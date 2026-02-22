# Judge Article Flow Plan

## Background
Evaluate "flow" of writing — how little friction a reader feels: ideas progress in a sensible order, transitions connect paragraphs, sentences vary in rhythm, and the voice stays consistent. To grade it without humans, use blind A/B pairwise judging ("which version reads more smoothly and naturally?") with a separate judge model, and require the judge to point to exact friction spots (sentences) it would revise. The rubric uses 0–5 sub-scores: local cohesion (sentence-to-sentence glue), global coherence (paragraph arc), transition quality, rhythm/variety (no monotone sentence patterns), and redundancy — and penalize abrupt topic jumps, repeated sentence openers, and unnecessary repetition.

## Requirements (from GH Issue #384)
[To be provided]

## Problem
The evolution pipeline has two divergent dimension lists: ReflectionAgent's `CRITIQUE_DIMENSIONS` (clarity, structure, engagement, precision, coherence) and PairwiseRanker's `EVALUATION_DIMENSIONS` (clarity, flow, engagement, voice_fidelity, conciseness). These were defined independently, evaluate overlapping concepts with different names, and make it hard to correlate critique scores with comparison outcomes. Meanwhile, "flow" is addressed only coarsely — a single dimension in PairwiseRanker and implicitly via "coherence" in ReflectionAgent. There is no way to diagnose *specific* flow defects (choppy transitions, monotone sentence patterns) or cite exact friction sentences. This limits the editing agents — IterativeEditing and TreeSearch can only target "coherence" or "flow" as monolithic weaknesses, not surgical flow repairs.

## Options Considered

### Option A: Extend Existing Dimensions Only
Add flow sub-dimensions to both existing dimension lists. Lowest friction — auto-propagates to all downstream consumers.

**Pros**: Minimal code changes. Reuses all existing infrastructure.
**Cons**: Doesn't add friction-spot citations. Dilutes existing dimensions (10+ dimensions). Doesn't fix the two-divergent-lists problem.

### Option B: Standalone FlowJudge Agent
New pipeline agent with specialized flow prompts, feature flag, and budget cap.

**Pros**: Clean separation. Own prompt engineering and output format.
**Cons**: Heaviest lift — full 7-step agent registration, new feature flag, budget cap. Adds another agent to the already long COMPETITION phase.

### Option C: Unified Quality Dimensions + Dedicated Flow Evaluator (CHOSEN)
Unify the two existing dimension lists into one shared `QUALITY_DIMENSIONS` constant. Create a separate dedicated flow evaluator with 5 flow sub-dimensions, friction citations, and its own feature flag. Both ReflectionAgent and PairwiseRanker share the quality dimensions. Flow evaluation runs as a second pass when enabled.

**Pros**: Fixes the divergent-lists problem. Gives flow the dedicated attention it deserves with specialized prompts and friction citations. Leverages all existing infrastructure (bias mitigation, caching, Match type, checkpoint serialization). No new agent needed.
**Cons**: More work than Option A, but the unified dimensions are a quality improvement independent of flow.

## Architecture

### Unified Quality Dimensions (5) — shared by ReflectionAgent + PairwiseRanker

| Dimension | Description | Origin |
|---|---|---|
| `clarity` | Clear, understandable writing; appropriate word choice; no jargon without context | Both systems (already shared) |
| `engagement` | Compelling, interesting; hooks the reader; maintains attention | Both systems (already shared) |
| `precision` | Accurate, specific language; claims supported; no vague hand-waving | Critique only → promoted to shared |
| `voice_fidelity` | Preserves the original author's tone and style | Comparison only → promoted to shared |
| `conciseness` | Appropriately brief; no filler words; every sentence earns its place | Comparison only → promoted to shared |

**Dropped** (subsumed by flow evaluator):
- ~~`structure`~~ → covered by `global_coherence`
- ~~`coherence`~~ → covered by `global_coherence` + `local_cohesion`
- ~~`flow`~~ → the entire flow evaluator replaces this single dimension

### Dedicated Flow Dimensions (5) — separate flow evaluator

| Dimension | Description |
|---|---|
| `local_cohesion` | Sentence-to-sentence glue — each sentence follows logically from the previous |
| `global_coherence` | Paragraph arc — the argument builds in a sensible order |
| `transition_quality` | Explicit bridges between paragraphs and ideas |
| `rhythm_variety` | Sentence lengths and structures vary; no monotone patterns |
| `redundancy` | No unnecessary repetition; ideas advance with each sentence |

### Pipeline Execution Order (COMPETITION phase)

Current pipeline without flow (for reference):
```
Step  Agent                    What it does
────  ─────                    ────────────
 1    GenerationAgent          Create new variant texts
 2    OutlineGenerationAgent   Create outline-based variants              [flag-gated]
 3    ReflectionAgent          Critique each variant (absolute 1-10 on 5 dims)
 4    IterativeEditingAgent    Edit weakest dimension from critique        [flag-gated]
 5    TreeSearchAgent          Beam search revisions from critique         [flag-gated]
 6    SectionDecompAgent       Per-section critique→edit→judge             [flag-gated]
 7    DebateAgent              Multi-advocate debate + synthesis           [flag-gated]
 8    EvolutionAgent           Mutation/crossover on pool                  [flag-gated]
 9    Tournament/Calibration   Pairwise comparison → OpenSkill rating updates
10    ProximityAgent           Diversity scoring
11    MetaReviewAgent          Pool health analysis (no LLM)
```

With flow evaluation enabled (`evolution_flow_critique_enabled = true`):
```
Step  Agent                    What it does
────  ─────                    ────────────
 1    GenerationAgent          Create new variant texts
 2    OutlineGenerationAgent   Create outline-based variants              [flag-gated]
 3    ReflectionAgent          QUALITY CRITIQUE: score each variant on 5 quality dims (1-10)
 3b   ReflectionAgent          FLOW CRITIQUE: score each variant on 5 flow dims (0-5)     ← NEW
                               + cite friction sentences per variant
 4    IterativeEditingAgent    Edit weakest dimension across quality + flow                [flag-gated]
 5    TreeSearchAgent          Beam search revisions targeting flow defects                [flag-gated]
 6    SectionDecompAgent       Per-section critique→edit→judge                             [flag-gated]
 7    DebateAgent              Multi-advocate debate + synthesis                           [flag-gated]
 8    EvolutionAgent           Mutation/crossover on pool                                  [flag-gated]
 9    Tournament/Calibration   QUALITY COMPARISON: pairwise on quality dims → rating updates
 9b   (same Tournament)        FLOW COMPARISON: pairwise on flow dims + friction spots    ← NEW
                               (scores stored in Match record, does NOT update ratings)
10    ProximityAgent           Diversity scoring
11    MetaReviewAgent          Pool health analysis (no LLM)
```

### How Each Evaluation Type Works

| Evaluation | When | Input | Output | Consumes Output |
|---|---|---|---|---|
| **Quality Critique** (step 3) | Every iteration | Single variant text | 5 quality dimension scores (1-10) + good/bad examples | Editing agents (steps 4-6): target weakest quality dimension |
| **Flow Critique** (step 3b) | Flag-gated | Single variant text | 5 flow dimension scores (0-5) + friction sentences | Editing agents (steps 4-6): target weakest flow dimension if worse than quality |
| **Quality Comparison** (step 9) | Every iteration, inside Tournament | Two variant texts | A/B/TIE per quality dim + overall winner | **Updates OpenSkill ratings** — determines which variant rises/falls |
| **Flow Comparison** (step 9b) | Flag-gated, same Tournament pairs | Two variant texts | A/B/TIE per flow dim + friction spots | **Stored only, does NOT update ratings** — observational data for analysis |

### Rating Update Policy

**Quality comparison determines winners and updates ratings** (same as today). Flow comparison runs on the same pairs within the same Tournament round but its results are informational — stored in `Match.dimensionScores` with `flow:` prefix keys and visible in visualization.

This is deliberate: flow scoring is new and unvalidated. By storing flow scores without influencing ratings, we can observe them for several runs and validate that the flow judge produces sensible results before letting them affect ranking. Upgrading to flow-influenced ratings later is a config change (add flow winner as a second rating update), not an architecture change.

### Dimension Namespacing in Match Records

Flow dimension keys in `Match.dimensionScores` use a `flow:` prefix (`flow:local_cohesion`, `flow:transition_quality`, etc.) so they coexist with quality dimension keys in the same Record without collision. Example Match record:
```
{
  dimensionScores: {
    // Quality comparison results
    "clarity": "A",
    "engagement": "B",
    "precision": "A",
    "voice_fidelity": "TIE",
    "conciseness": "A",
    // Flow comparison results (flow: prefix)
    "flow:local_cohesion": "A",
    "flow:global_coherence": "B",
    "flow:transition_quality": "A",
    "flow:rhythm_variety": "TIE",
    "flow:redundancy": "A"
  },
  winner: "variant-123",      // determined by quality comparison only
  confidence: 1.0,
  frictionSpots: {             // from flow comparison only
    a: ["This leads to better outcomes.", "However, the results show..."],
    b: ["Moving on to the next topic."]
  }
}
```

## Phased Execution Plan

### Phase 1: Shared Constants & Flow Prompt Builders
**Goal**: Define unified quality dimensions, flow dimensions, and flow prompt/parsing functions. No pipeline integration yet.

**Files to create**:
- `src/lib/evolution/flowRubric.ts` — `QUALITY_DIMENSIONS`, `FLOW_DIMENSIONS`, flow prompt builders, flow response parsers

**What to build**:
1. `QUALITY_DIMENSIONS: Record<string, string>` constant — 5 unified dimensions as key-description pairs (clarity, engagement, precision, voice_fidelity, conciseness). Shape is `Record<string, string>` to match PairwiseRanker's `EVALUATION_DIMENSIONS`. ReflectionAgent uses `Object.keys(QUALITY_DIMENSIONS)` where it needs a string array. Used by both agents.

2. `FLOW_DIMENSIONS: Record<string, string>` constant — 5 flow sub-dimensions as key-description pairs:
   - `local_cohesion`: "Sentence-to-sentence glue — does each sentence follow logically from the previous?"
   - `global_coherence`: "Paragraph arc — does the article's argument build in a sensible order?"
   - `transition_quality`: "Transitions connect paragraphs — are there explicit bridges between ideas?"
   - `rhythm_variety`: "Sentence rhythm — do sentence lengths and structures vary, or is the prose monotone?"
   - `redundancy`: "Redundancy — is information repeated unnecessarily or do ideas advance with each sentence?"

3. `buildFlowComparisonPrompt(textA, textB)` — A/B pairwise prompt focused on flow. Requires the judge to:
   - Score each flow sub-dimension A/B/TIE
   - Cite 1-3 exact friction sentences per text (the sentences that disrupt flow most)
   - Provide OVERALL_WINNER and CONFIDENCE

4. `parseFlowComparisonResponse(response)` — Extract dimension scores + friction citations. Return `{ winner, dimensionScores, confidence, frictionSpotsA, frictionSpotsB }`.

5. `buildFlowCritiquePrompt(text, dimensions)` — Per-variant flow analysis. Asks for 0-5 score per sub-dimension plus specific friction sentences to revise. Output JSON via `extractJSON()`.

6. `parseFlowCritiqueResponse(response)` — Extract sub-scores + friction examples. **Clamp raw scores to [0, 5] range** before returning (handles malformed LLM output). Fallback: if parse fails, return null (caller logs warning and skips, matching existing `extractJSON` pattern). Similarly, `parseFlowComparisonResponse()` validates dimension values are one of `A`/`B`/`TIE` and discards malformed entries.

7. `normalizeScore(score, scale)` — Normalize scores to [0, 1] range using min-max normalization. Quality scores (1-10): `(score - 1) / 9`. Flow scores (0-5): `score / 5`. This accounts for different scale floors (quality min is 1, flow min is 0) so both extremes map to exactly 0.0 and 1.0. **Output is clamped to [0, 1]** via `Math.max(0, Math.min(1, result))` to handle out-of-range LLM scores (e.g., quality score 0 would produce -0.111 without clamping). Used by editing agents to compare weakest dimension across scales.

8. `getFlowCritiqueForVariant(variantId, critiques)` — Find the flow critique for a variant. Filters `allCritiques[]` by `variationId` AND `scale === '0-5'`. Returns the flow critique or `undefined`. Complements existing `getCritiqueForVariant()` which returns the first match (always quality, since quality critiques are appended first).

9. `getWeakestDimensionAcrossCritiques(qualityCritique, flowCritique)` — Compare normalized scores across both critiques. Returns `{ dimension: string, source: 'quality' | 'flow', normalizedScore: number }`. If flowCritique is undefined, falls back to quality-only `getWeakestDimension()`.

**Tests**: `src/lib/evolution/flowRubric.test.ts` — Unit tests for all constants, prompt builders, parsers, and normalizeScore (prompt structure, parse edge cases, missing/malformed fields, normalization edge cases). 15+ tests.

**Validation**: lint, tsc, build, unit tests pass.

### Phase 2: Unify Existing Dimension Lists
**Goal**: Replace the two divergent dimension constants with the shared `QUALITY_DIMENSIONS`.

**Files to modify**:
- `src/lib/evolution/agents/reflectionAgent.ts` — Replace `CRITIQUE_DIMENSIONS` with `QUALITY_DIMENSIONS` import. Keep `CRITIQUE_DIMENSIONS` as deprecated re-export (`export const CRITIQUE_DIMENSIONS = Object.keys(QUALITY_DIMENSIONS)`)
- `src/lib/evolution/agents/pairwiseRanker.ts` — Replace `EVALUATION_DIMENSIONS` with `QUALITY_DIMENSIONS` import. **Critical**: `buildStructuredPrompt()` has hardcoded dimension names in the Instructions section (lines ~37-55) — these must be dynamically generated from `Object.keys(QUALITY_DIMENSIONS)`, not literal strings. Similarly, `parseStructuredResponse()` iterates `Object.keys(EVALUATION_DIMENSIONS)` — update to `Object.keys(QUALITY_DIMENSIONS)`.
- `src/lib/evolution/agents/iterativeEditingAgent.ts` — Imports `CRITIQUE_DIMENSIONS` (line 9) for `runInlineCritique()`. Update to `QUALITY_DIMENSIONS`.
- `src/lib/evolution/treeOfThought/beamSearch.ts` — Dynamic import of `CRITIQUE_DIMENSIONS` (~line 308). Update import path.
- `src/lib/evolution/agents/debateAgent.ts` — Hardcoded dimension names in advocate prompt string (~line 40: "clarity, structure, engagement, precision, coherence"). Update to dynamically join `Object.keys(QUALITY_DIMENSIONS)`.
- `src/lib/evolution/index.ts` — Re-exports `CRITIQUE_DIMENSIONS` from `reflectionAgent` (line ~70). Update to also export `QUALITY_DIMENSIONS` from `flowRubric.ts`. Keep the deprecated `CRITIQUE_DIMENSIONS` re-export (it chains through reflectionAgent's deprecated alias).

**What to build**:
1. ReflectionAgent: `CRITIQUE_DIMENSIONS` → `QUALITY_DIMENSIONS`. Constructor uses `Object.keys()` where it needs a string array. Deprecated re-export for backward compat.
2. PairwiseRanker: `EVALUATION_DIMENSIONS` → `QUALITY_DIMENSIONS`. **Refactor `buildStructuredPrompt()` to dynamically generate ALL THREE blocks of dimension references**: (a) the `## Evaluation Dimensions` list (lines ~21-23), (b) the `## Instructions` numbered list (lines ~38-42: `"1. clarity: [A/B/TIE]"`), and (c) the `Respond in this exact format` template (lines ~49-53: `"clarity: [your choice]"`). All three must be generated from `Object.keys(QUALITY_DIMENSIONS)`. Update `parseStructuredResponse()` to iterate `Object.keys(QUALITY_DIMENSIONS)` instead of `Object.keys(EVALUATION_DIMENSIONS)`.
3. IterativeEditingAgent: Update import from `CRITIQUE_DIMENSIONS` to `QUALITY_DIMENSIONS`. **Also update `runInlineCritique()`'s duplicated prompt template** (lines ~178-210) — the hardcoded JSON example keys (`clarity`, `structure`) must be dynamically generated from `Object.keys(QUALITY_DIMENSIONS)`. Ideally, extract the prompt builder into a shared function in `flowRubric.ts` (named `buildQualityCritiquePrompt()`) to eliminate the duplication noted in the existing comment at lines 167-169.
4. BeamSearch: Update dynamic import to use `QUALITY_DIMENSIONS` from `flowRubric.ts` (not from `reflectionAgent.ts`). Note: the existing mock in beamSearch.test.ts uses `['clarity', 'structure', 'engagement', 'accuracy', 'grammar']` which never matched the real `CRITIQUE_DIMENSIONS` — this pre-existing mismatch is fixed by updating the mock to use the actual `QUALITY_DIMENSIONS` keys.
5. DebateAgent: Replace hardcoded dimension string with `Object.keys(QUALITY_DIMENSIONS).join(', ')`. Import `QUALITY_DIMENSIONS` from `flowRubric.ts`.

**Backward compatibility**: Existing checkpoint data uses string keys in `Record<string, number>` and `Record<string, string>`. Old keys (`structure`, `coherence`, `flow`) will still deserialize fine — they just won't be produced anymore. No migration needed.

**Note**: `content_quality_scores` (removed) table (Phase D eval pipeline) has a CHECK constraint limiting `dimension` to specific values including 'structure' and 'coherence'. This is a SEPARATE system and is NOT affected by this change.

**Tests — all affected test files with exact changes**:
- `reflectionAgent.test.ts`:
  - Update `VALID_CRITIQUE_JSON` fixture (line ~14-19): Replace keys `{clarity, structure, engagement, precision, coherence}` → `{clarity, engagement, precision, voice_fidelity, conciseness}`. Note: `precision` is KEPT (not added), `voice_fidelity` and `conciseness` are new, `structure` and `coherence` are dropped.
  - Update ALL 5 dimension assertions at lines ~170-175 (not just the two being dropped).
  - Add deprecated re-export test: `import { CRITIQUE_DIMENSIONS } from './reflectionAgent'` returns `string[]` with correct 5 values.
- `pairwiseRanker.test.ts`:
  - Update `parseStructuredResponse` fixtures: line ~91 replace `flow: B` → `precision: B`; line ~107 replace `flow: A` → `precision: A`. Verify majority-winner derivation logic still holds with new dimension names.
  - Update structured prompt content assertions to verify dynamic generation (no hardcoded dimension strings).
  - Update `ComparisonCache` tests (lines ~227-241) if cache key format changes.
- `beamSearch.test.ts`:
  - Update mock dimension list (line ~24): Replace `['clarity', 'structure', 'engagement', 'accuracy', 'grammar']` → `Object.keys(QUALITY_DIMENSIONS)` imported from `flowRubric.ts`. This fixes a pre-existing mismatch where the mock never matched the real constant.
- `iterativeEditingAgent.test.ts`:
  - Update `VALID_CRITIQUE_JSON` fixture (line ~25-30): Same key changes as reflectionAgent.test.ts.
  - Update `HIGH_SCORE_CRITIQUE_JSON` (line ~32): Same key changes.
  - Update `makeCritique` helper (line ~70): Update dimension keys.
- `debateAgent.test.ts`:
  - Check for hardcoded dimension assertions in advocate prompt tests. Update if present.

**Validation**: lint, tsc, build, unit tests pass.

### Phase 3: PairwiseRanker Flow Comparison Mode
**Goal**: Wire flow comparison into the existing comparison pipeline as a separate mode.

**Important**: There are TWO distinct `compareWithBiasMitigation` functions in the codebase:
1. **`comparison.ts:compareWithBiasMitigation()`** — Standalone function used by Hall of Fame (`hallOfFameActions.ts`), scripts (`run-bank-comparison.ts`, `run-hall-of-fame-comparison.ts`, `run-prompt-bank-comparisons.ts`). Signature: `(textA, textB, callLLM, cache)`. This function is NOT modified in this phase — it stays as-is for backward compatibility. Phase 6 adds flow support to Hall of Fame separately.
2. **`PairwiseRanker.compareWithBiasMitigation()`** — Class method used by Tournament (`tournament.ts:167`), CalibrationRanker. Signature: `(ctx, idA, textA, idB, textB, structured)`. This is the one we extend.

**Files to modify**:
- `src/lib/evolution/agents/pairwiseRanker.ts` — Add `'flow'` comparison mode
- `src/lib/evolution/types.ts` — Extend `Match` interface with optional `frictionSpots` field

**What to build**:
1. Add `comparePairFlow()` private method that uses `buildFlowComparisonPrompt()` + `parseFlowComparisonResponse()`. This is a new method alongside existing `comparePair()`, not a modification.
2. Add `compareFlowWithBiasMitigation()` as a **new method** (not modifying the existing `compareWithBiasMitigation` signature). This avoids breaking Tournament, CalibrationRanker, and other callers. The new method runs the same 2-pass reversal pattern, uses `parseFlowComparisonResponse()` for parsing, and `mergeDimensionScores()` for merging (already dimension-agnostic since it operates on `Record<string, string>`). Friction spots are collected from both passes (union of cited sentences).
3. Add `frictionSpots?: { a: string[]; b: string[] }` to `Match` type (optional, backward compatible). Old checkpoints deserializing without this field get `undefined` — safe.
4. Flow dimension keys use `flow:` prefix in `Match.dimensionScores` to avoid collision with quality dimensions.
5. Update `ComparisonCache` public API: Add optional `mode?: string` parameter (default `'quality'`) to `get(textA, textB, structured, mode?)` and `set(textA, textB, structured, mode?, value)`. The private `makeKey()` incorporates mode into the hash. Existing callers (which don't pass mode) get `mode='quality'` by default — their cache keys change format slightly (now include `|quality` suffix) but since the cache is in-memory and rebuilt per run, there's no stale-key issue. `compareFlowWithBiasMitigation()` passes `mode='flow'` through to the cache, ensuring flow and quality comparisons of the same text pair don't collide.

**Tests**: New and updated tests in `pairwiseRanker.test.ts`:
- `compareFlowWithBiasMitigation` — full 2-pass reversal with flow dimensions (~3 tests)
- Flow dimension merging with `flow:` prefix keys (~2 tests)
- Friction spot collection and dedup across passes (~2 tests)
- Cache key includes mode — flow and quality comparisons don't collide (~1 test)
- Old Match records without `frictionSpots` deserialize cleanly (~1 test)

**Validation**: lint, tsc, build, unit tests pass.

### Phase 4: ReflectionAgent Flow Critique + Scale Normalization
**Goal**: Add flow critique as a second pass so editing agents can target specific flow defects. Solve the scale mismatch between quality (1-10) and flow (0-5) scores.

**Files to modify**:
- `src/lib/evolution/agents/reflectionAgent.ts` — Add flow critique mode, store as separate Critique objects
- `src/lib/evolution/agents/iterativeEditingAgent.ts` — Update `getWeakestDimension` call to use normalized scores
- `src/lib/evolution/types.ts` — Add optional `scale` field to `Critique` type

**Critical design: Scale normalization**
Quality critiques use 1-10 scores. Flow critiques use 0-5 scores. Without normalization, `getWeakestDimension()` (which returns the key with the lowest numeric value) would systematically prefer flow dimensions since their max is 5 vs 10. Solution:

1. Add `scale?: '1-10' | '0-5'` to the `Critique` type (optional, backward compat — defaults to `'1-10'`).
2. Quality critiques: `scale = '1-10'`. Flow critiques: `scale = '0-5'`.
3. Flow and quality critiques are **separate `Critique` objects** in `state.allCritiques[]` — NOT mixed into one object. This keeps `qualityThresholdMet()` (in IterativeEditingAgent, which checks `every(score >= 8)`) working correctly since it only sees quality critique scores.
4. When editing agents need to find the weakest dimension across both, use `normalizeScore()` from `flowRubric.ts` to convert both to [0, 1] before comparison. Add `getWeakestDimensionAcrossCritiques(qualityCritique, flowCritique)` helper that normalizes and returns the single weakest dimension + which critique it came from.
5. IterativeEditingAgent's `runInlineCritique()` re-evaluates on quality dimensions only (not flow) after an edit. This is acceptable — the flow critique ran once before the edit cycle, and the edit cycle validates quality improvement per iteration.

**What to build**:
1. Import `FLOW_DIMENSIONS`, `normalizeScore`, `getFlowCritiqueForVariant`, and `getWeakestDimensionAcrossCritiques` from `flowRubric.ts`.
2. When flow mode is active, ReflectionAgent runs a **second critique pass** using `buildFlowCritiquePrompt()`. Produces separate `Critique` objects with `scale = '0-5'` and flow dimension keys. These are appended AFTER quality critiques in `state.allCritiques[]`.
3. **Flow critique retrieval**: `getFlowCritiqueForVariant(variantId, state.allCritiques)` filters by `variationId` AND `scale === '0-5'`. Existing `getCritiqueForVariant()` uses `.find()` and always returns the quality critique (appended first). Both functions are defined in `flowRubric.ts`. The `scale` field defaults to `'1-10'` when absent (for backward compat with old checkpoints) — this default is applied in `normalizeScore()` and `getFlowCritiqueForVariant()`.
4. Update IterativeEditingAgent to:
   - Call `getCritiqueForVariant()` for quality critique (unchanged)
   - Call `getFlowCritiqueForVariant()` for flow critique (new)
   - Call `getWeakestDimensionAcrossCritiques(qualityCritique, flowCritique)` when both exist
   - Fall back to existing `getWeakestDimension(qualityCritique)` when flow critique is absent
   - `qualityThresholdMet()` ONLY checks quality critique (unchanged behavior)
   - `runInlineCritique()` re-evaluates quality dimensions only (unchanged behavior)
5. TreeSearch's `edit_dimension` action: The code path is `treeSearchAgent.ts` → `beamSearch()` → `selectRevisionActions(critique, branchingFactor)` in `revisionActions.ts`. Currently `selectRevisionActions` receives a single `Critique` and calls its own `getWeakestDimensions()`. To make TreeSearch flow-aware: modify `beamSearch.ts` to call `getWeakestDimensionAcrossCritiques(qualityCritique, flowCritique)` BEFORE calling `selectRevisionActions`, and pass the result as an override parameter. Add optional `weakestDimensionOverride?: string` to `selectRevisionActions` that, if provided, takes priority over its internal `getWeakestDimensions()` call. This keeps `revisionActions.ts` mostly unchanged while allowing the caller to inject flow-aware dimension targeting.
6. **SectionDecompositionAgent** (`sectionDecompositionAgent.ts`) — imports `getWeakestDimension` from `reflectionAgent.ts`. This agent intentionally does NOT get flow-aware weakness targeting in this phase. It operates per-section and always targets quality dimensions. This is acceptable because SectionDecomp's critique→edit→judge cycle is self-contained per section, and flow is a whole-document property that doesn't decompose well per-section.

**Tests**:
- `reflectionAgent.test.ts` — Flow critique stored as separate Critique with `scale = '0-5'` (~3 tests)
- `flowRubric.test.ts` — `normalizeScore` and `getWeakestDimensionAcrossCritiques` with edge cases: quality score 3/10 vs flow score 4/5 → quality wins as weakest (~4 tests)
- `iterativeEditingAgent.test.ts` — Verify `qualityThresholdMet()` only checks quality critique, not flow. Verify `pickEditTarget()` correctly handles when `getWeakestDimensionAcrossCritiques` returns a flow dimension: threshold `score < 8` always triggers for 0-5 scale, edit prompt should reference the flow dimension name and include friction citations from flow critique (~4 tests)
- `beamSearch.test.ts` — Verify `selectRevisionActions` with `weakestDimensionOverride` uses the override dimension for `edit_dimension` action (~1 test)

**Validation**: lint, tsc, build, unit tests pass.

### Phase 5: Pipeline Integration & Feature Flag
**Goal**: Wire flow evaluation into the pipeline execution loop with a feature flag.

**Files to modify**:
- `src/lib/evolution/config.ts` — Add `flowCritiqueEnabled` to `DEFAULT_EVOLUTION_CONFIG`, add `flowCritique` budget cap entry
- `src/lib/evolution/core/featureFlags.ts` — Add `evolution_flow_critique_enabled` flag to `EvolutionFeatureFlags`, `FLAG_MAP`, `DEFAULT_EVOLUTION_FLAGS`
- `src/lib/evolution/core/supervisor.ts` — Pass flow config to agents
- `src/lib/evolution/core/pipeline.ts` — Run flow critique + flow comparison when flag enabled
- `src/lib/evolution/agents/tournament.ts` — Run flow comparison on same pairs after quality comparison

**What to build**:
1. Feature flag: `evolution_flow_critique_enabled` (default `false`, opt-in).
2. Migration: `supabase/migrations/YYYYMMDDHHMMSS_add_flow_critique_flag.sql` — Insert flag into `feature_flags` table.
3. Budget cap: Add `flowCritique: 0.05` to `budgetCaps` in `config.ts` (~5% of $5.00 budget = $0.25 max). Flow evaluation costs are tracked under agent name `'flowCritique'` in `costTracker`, separate from `'reflection'` and `'tournament'`.
4. When flag enabled, pipeline runs two additional evaluation passes per iteration:
   - **Flow Critique** (step 3b): Runs immediately after Quality Critique (step 3), before editing agents. **Must be implemented as a standalone function in `pipeline.ts`** (NOT via `ReflectionAgent.execute()`) that calls `buildFlowCritiquePrompt` + LLM + `parseFlowCritiqueResponse`. This is critical because `ReflectionAgent.execute()` (line ~158) overwrites `state.dimensionScores[variantId]` with the latest critique's dimension scores — if it ran for flow, it would clobber quality scores with 0-5 flow scores. The standalone function appends flow `Critique` objects (with `scale = '0-5'`) to `state.allCritiques` only, and optionally writes flow scores to `state.dimensionScores` with `flow:` prefix keys (e.g., `state.dimensionScores[variantId]['flow:local_cohesion'] = 3`). This preserves quality scores in the map while making flow scores visible to visualization.
   - **Flow Comparison** (step 9b): **Tournament integration design**: After each tournament round completes its `Promise.allSettled` batch of quality comparisons and applies rating updates, run a **second parallel batch** of flow comparisons on the same pairs. This preserves the existing parallel execution model — quality comparisons are parallel, then flow comparisons are parallel, then next round.
     ```
     for each round:
       qualityMatches = await Promise.allSettled(pairs.map(p => qualityComparison(p)))
       applyRatingUpdates(qualityMatches)  // only quality updates ratings
       if (flowEnabled):
         flowMatches = await Promise.allSettled(pairs.map(p => flowComparison(p)))
         // Correlate by index: both batches process the same `pairs` array in order.
         // Handle rejected promises: if flowMatches[i] is rejected, skip merging for that pair.
         mergeFlowScoresIntoMatches(qualityMatches, flowMatches)  // merge flow: prefixed scores + frictionSpots
     ```
     Flow comparisons do NOT update ratings. Flow dimension scores and friction spots are merged into the existing Match records in `state.matchHistory`.
5. Friction spots persisted in match history (checkpoint-safe via existing JSONB serialization — `frictionSpots` is optional on `Match`, old checkpoints deserialize with `undefined`).
6. Config field: `flowCritiqueEnabled` in `EvolutionRunConfig`, surfaced in Start Run card UI.
7. Rollback safety: If flag is toggled off mid-run, pipeline skips flow steps. Existing checkpoint data with flow scores in `allCritiques` and `matchHistory` is harmless — flow-prefixed keys and extra Critique objects are simply ignored by downstream consumers.

**Tests**:
- Integration test at `src/__tests__/integration/evolution-flow.integration.test.ts`:
  - Uses `createMockEvolutionLLMClient` with a `mockImplementation` that inspects the prompt string to route responses: if prompt contains "flow" dimension names (e.g., `local_cohesion`, `rhythm_variety`), return flow-format mock; if prompt contains quality dimension names (e.g., `clarity`, `engagement`), return quality-format mock. This is necessary because a single `complete` mock must serve both quality and flow prompts within the same pipeline run.
  - Full pipeline run with flow flag enabled, using enough iterations to exercise **Tournament** (COMPETITION phase), not just CalibrationRanker (EXPANSION phase). This ensures step 9b flow comparison is tested end-to-end.
  - Verify flow critique scores (0-5, `scale = '0-5'`) appear in checkpoint `allCritiques`
  - Verify flow comparison scores appear in `matchHistory[].dimensionScores` with `flow:` prefix
  - Verify friction spots appear in `matchHistory[].frictionSpots`
  - Verify OpenSkill ratings are updated only by quality comparison winner (not flow)
  - Verify old checkpoint without flow data deserializes cleanly into new code
  - Verify `getFlowCritiqueForVariant()` returns `undefined` for old critiques (where `scale` field is absent, not `'0-5'`)
  - Verify `getCritiqueForVariant()` still returns old critiques without `scale` field

**Validation**: lint, tsc, build, unit + integration tests pass.

### Phase 6: Hall of Fame Flow Scoring
**Goal**: Populate the dormant `dimension_scores` JSONB column with flow sub-scores.

**Files to modify**:
- `src/lib/services/hallOfFameActions.ts` — Use flow comparison prompt, store dimension scores

**What to build**:
1. Add optional `useFlowComparison: boolean` parameter to `runHallOfFameComparisonAction()`.
2. When enabled, run flow comparison alongside generic comparison.
3. Populate `dimension_scores` JSONB column in `evolution_hall_of_fame_comparisons` with flow sub-scores.
4. Add flow comparison mode toggle to admin UI comparison dialog.

**Tests**: Update `hallOfFameActions.test.ts` — flow comparison mode, dimension_scores populated. ~3 new tests.

**Validation**: lint, tsc, build, unit tests pass.

### Phase 7: Visualization & Documentation
**Goal**: Flow scores visible in admin UI. Update feature deep dives.

**Files to modify**:
- Visualization components (if needed — most should auto-display via generic `dimensionScores` Record)
- Feature deep dive docs

**What to build**:
1. Verify flow sub-dimension scores display in Timeline tab, Variants tab (should work automatically since they use generic Record).
2. If friction spots need display: add expandable friction-spot panel to Variants tab detail view.
3. Hall of Fame Match History: display flow dimension scores if present.
4. Update docs listed below.

**Tests**: Verify existing visualization tests still pass with flow dimension data. Add test for friction spots display if new UI added.

**Validation**: lint, tsc, build, unit tests pass. Manual verification on stage.

## Testing

### New Unit Tests
- `flowRubric.test.ts` — Constants (QUALITY_DIMENSIONS shape, FLOW_DIMENSIONS shape), prompt construction (flow comparison prompt includes all 5 dims, flow critique prompt includes friction citation instruction), response parsing (valid/malformed/empty flow comparison, valid/malformed/empty flow critique), normalizeScore (quality 1-10, flow 0-5, edge values 0 and max), getWeakestDimensionAcrossCritiques (quality-worst-wins, flow-worst-wins, tie, missing flow critique). **15+ tests.**
- `pairwiseRanker.test.ts` (new tests) — `compareFlowWithBiasMitigation` full 2-pass reversal, flow dimension merging with `flow:` prefix, friction spot collection/dedup, cache key with mode, old Match without frictionSpots deserializes. **~9 new tests.**
- `hallOfFameActions.test.ts` (new tests) — Flow comparison mode, dimension_scores populated in DB record. **~3 new tests.**

### Updated Existing Tests
- `reflectionAgent.test.ts` — Update `VALID_CRITIQUE_JSON` fixture keys (structure→precision, coherence→voice_fidelity/conciseness). Update `CRITIQUE_DIMENSIONS.toContain()` assertions. Add: flow critique with `scale='0-5'`, separate Critique objects, deprecated re-export works. **~5 updated + 3 new.**
- `pairwiseRanker.test.ts` — Update `parseStructuredResponse` fixtures (replace `flow: B` with new dimension keys). Update structured prompt assertions for dynamic generation. **~4 updated.**
- `beamSearch.test.ts` — Update mock dimension list (line ~24) to use `QUALITY_DIMENSIONS` keys. **~1 updated.**
- `iterativeEditingAgent.test.ts` — Verify import change compiles. Add: `qualityThresholdMet()` only checks quality critique (not flow). Add: getWeakestDimensionAcrossCritiques integration. **~2 new.**

### Integration Tests
- `src/__tests__/integration/evolution-flow.integration.test.ts` — Full pipeline with flow flag, custom mock LLM responses for flow formats, verify checkpoint contains quality + flow scores, ratings unaffected by flow, old checkpoint backward compat. **~5 tests.**

### Manual Verification
- Run evolution with `flowCritiqueEnabled: true` via admin UI
- Inspect Timeline tab for unified quality + flow sub-dimension scores
- Inspect Variants tab for friction spots
- Run Hall of Fame comparison with flow mode
- Verify dimension_scores populated in DB
- Toggle flag off mid-run, verify pipeline continues without errors
- Pause a run (budget exceeded) after flow critiques are stored, resume from checkpoint, verify deserialized state still contains flow critiques with `scale = '0-5'` and flow dimension scores in match history

## Documentation Updates
The following docs need updates:
- `docs/feature_deep_dives/comparison_infrastructure.md` - Unified QUALITY_DIMENSIONS, flow comparison mode, friction citations
- `docs/feature_deep_dives/evolution_pipeline.md` - Flow critique flag, flow dimensions in pipeline, execution order
- `docs/feature_deep_dives/iterative_editing_agent.md` - Flow sub-dimensions as edit targets
- `docs/feature_deep_dives/tree_of_thought_revisions.md` - Flow evaluation informing edit_dimension actions
- `docs/feature_deep_dives/evolution_framework.md` - flowCritiqueEnabled config parameter
- `docs/feature_deep_dives/elo_budget_optimization.md` - Flow judging cost (~$0.06/run additional)
- `docs/feature_deep_dives/evolution_pipeline_visualization.md` - Flow scores in Timeline/Variants tabs

## Key Design Decisions

1. **Unified quality dimensions** — ReflectionAgent and PairwiseRanker now share one `QUALITY_DIMENSIONS` constant (5 dimensions). This fixes the divergent-lists problem independent of flow evaluation.

2. **Dedicated flow evaluator, not a new agent** — Flow evaluation runs as additional passes on existing ReflectionAgent (flow critique) and PairwiseRanker (flow comparison). Avoids 7-step agent registration overhead.

3. **Two-pass architecture** — Quality evaluation runs every iteration. Flow evaluation runs as a second pass when the flag is on. They're complementary: quality catches general issues, flow catches specific flow defects.

4. **5 flow sub-dimensions, 0-5 scale** — local_cohesion, global_coherence, transition_quality, rhythm_variety, redundancy. Narrower scale (0-5) matches the narrower scope per sub-dimension.

5. **Friction citations** — The distinguishing feature. The judge must cite exact friction sentences, giving editing agents precise targets instead of vague "improve flow."

6. **`flow:` namespace prefix** — Flow dimension keys in `Match.dimensionScores` use `flow:local_cohesion` etc. to coexist with quality dimension keys without collision.

7. **Generic Record types** — `Critique.dimensionScores: Record<string, number>` and `Match.dimensionScores: Record<string, string>` require zero type changes for new dimension keys.

8. **Hall of Fame dimension_scores** — The JSONB column already exists and is unused. Populating it is a natural extension, not a schema change.

9. **Budget impact small** — Flow critique ~$0.03 + flow comparison ~$0.03 = ~$0.06/run additional vs $5.00 default budget.

10. **Dropped dimensions subsumed** — `structure`, `coherence`, and `flow` are dropped from the quality set because they're fully covered by `global_coherence`, `local_cohesion`, and the dedicated flow evaluator respectively.

11. **Flow comparison doesn't update ratings (initially)** — Quality comparison determines winners and updates OpenSkill ratings. Flow comparison runs on the same Tournament pairs but stores results only. This is deliberate: flow scoring is new and unvalidated. We observe flow scores for several runs before letting them influence ranking. Upgrading later is a config change, not an architecture change.

12. **Separate Critique objects for quality and flow** — Flow critiques are stored as separate `Critique` objects in `state.allCritiques[]` with `scale = '0-5'`, not mixed into quality critique objects. This keeps `qualityThresholdMet()` (which checks `every(score >= 8)`) working correctly — it only sees quality scores.

13. **Min-max score normalization** — Quality (1-10) normalized as `(score-1)/9`, flow (0-5) as `score/5`. Both map their respective min→0.0 and max→1.0. Simple division (`score/10`) would be unfair since quality floor is 1 not 0. `getWeakestDimensionAcrossCritiques()` uses this to find the true weakest.

14. **New method, not signature change** — `compareFlowWithBiasMitigation()` is a new method on PairwiseRanker, not a modification of existing `compareWithBiasMitigation()`. This avoids breaking Tournament, CalibrationRanker, and script callers. The standalone `compareWithBiasMitigation()` in `comparison.ts` (used by Hall of Fame and scripts) is a completely separate function and is not modified.

15. **Tournament flow comparison as second parallel batch** — Flow comparison runs after each quality comparison round completes, on the same pairs, as a separate `Promise.allSettled` batch. This preserves the existing parallel execution model.

16. **Budget tracking under dedicated agent name** — Flow evaluation costs tracked under `'flowCritique'` in costTracker, separate from `'reflection'` and `'tournament'`, with its own budget cap (~5% of total).

17. **Flow critique retrieval via `getFlowCritiqueForVariant()`** — Since `getCritiqueForVariant()` uses `.find()` and quality critiques are appended first, it always returns the quality critique. A separate `getFlowCritiqueForVariant()` filters by `scale === '0-5'` to retrieve the flow critique. Both are in `flowRubric.ts`.

18. **CalibrationRanker (EXPANSION phase) does NOT run flow comparison** — Flow comparison only runs in COMPETITION phase inside Tournament. CalibrationRanker has its own private comparison method for EXPANSION-phase quick calibration and is intentionally excluded from flow evaluation.

19. **Shared prompt builder extracted from IterativeEditingAgent** — The duplicated `buildCritiquePrompt` in `runInlineCritique()` is extracted into a shared `buildQualityCritiquePrompt()` in `flowRubric.ts`, eliminating the duplication noted in the existing source comment at iterativeEditingAgent.ts:167-169.

20. **`CritiqueDimension` type widening is intentional** — The deprecated re-export `CRITIQUE_DIMENSIONS = Object.keys(QUALITY_DIMENSIONS)` changes the derived `CritiqueDimension` type from a narrow union (`'clarity' | 'structure' ...`) to `string`. This is acceptable because `dimensionScores` is already `Record<string, number>` — no code uses exhaustiveness checking on dimension names. If narrow typing is needed later, `QUALITY_DIMENSIONS` can be defined with `as const satisfies Record<string, string>` and the union derived from its keys.

21. **Flow critique standalone function prevents `state.dimensionScores` corruption** — Flow critique in pipeline.ts is a standalone function, NOT via `ReflectionAgent.execute()`, because `execute()` overwrites `state.dimensionScores[variantId]` with the latest critique's dimension scores. The standalone function writes flow scores to `state.dimensionScores` with `flow:` prefixed keys (e.g., `flow:local_cohesion`) to coexist with quality scores in the same map.

22. **SectionDecompositionAgent excluded from flow-aware targeting** — SectionDecomp operates per-section and always targets quality dimensions. Flow is a whole-document property that doesn't decompose per-section, so flow-aware weakness targeting is intentionally omitted for this agent.
