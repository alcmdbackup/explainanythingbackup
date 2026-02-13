# Hierarchical Decomposition Agent Plan

## Background

**Current approach**: Evolve the entire article as one unit. Every LLM call sees the full text.

**Alternative**: Parse the article into sections (Intro, Section 1, Section 2, Conclusion). Evolve each section independently with its own mini-pipeline. Then stitch the best section variants together and run a final coherence check.

**Key difference**: True parallelism — 5 sections can evolve simultaneously. Smaller context windows = cheaper LLM calls. You can accept improvements to Section 2 while rejecting changes to Section 3.

**Best for**: Long articles (2000+ words) where full-article context is expensive, or when you want granular human control over which improvements to accept. Leverages the iterative editing agent where needed.

## Problem

The evolution pipeline treats articles as atomic text blobs — every agent receives the full article string, generates a complete replacement variant, and stores it as a complete document. For long articles (2000+ words), this wastes tokens on unchanged sections and prevents granular control over which sections improve. There is zero section-level awareness in code despite the format validator enforcing a natural H1/H2/H3 section structure. The IterativeEditingAgent's edit prompts say "rewrite ONLY the sections exhibiting this weakness" but the agent doesn't extract sections — it relies on the LLM to target appropriately, which is unreliable.

## Options Considered

### Option A: New agent in existing pipeline (Selected)
Add a `SectionDecompositionAgent` as a new `AgentBase` subclass that runs in COMPETITION phase after `IterativeEditing`. It decomposes the top variant into sections, runs a simplified iterative editing loop on each section independently (in parallel), stitches results back, and adds the stitched variant to the main pool where it competes via tournament like any other variant.

**Pros**: Incremental, backward-compatible, reuses existing agent framework and tournament ranking. Holistic edits and section edits compete directly.
**Cons**: Stitched variant may have transition issues between independently-edited sections.

### Option B: Separate section-level mini-pipeline
Create a completely separate pipeline function (`executeSectionPipeline`) that manages per-section pools, ratings, and convergence independently. Called as an alternative to `executeFullPipeline`.

**Pros**: Clean separation, full control over section-level evolution.
**Cons**: Massive scope, duplicates orchestration logic, can't easily compare section-evolved vs holistic variants in same tournament.

### Option C: Modify existing agents to be section-aware
Modify `GenerationAgent`, `EvolutionAgent`, etc. to accept optional section scope, operating on section text when provided.

**Pros**: Reuses existing agent code directly.
**Cons**: Invasive changes to every agent, high risk of breaking existing behavior, hard to test incrementally.

**Decision**: Option A — new agent, least invasive, incrementally deliverable in 3 phases.

## Key Design Decisions

1. **Section state** lives inside `PipelineState` as `sectionState: SectionEvolutionState | null` (backward-compatible). Requires updates to: `PipelineState` interface, `PipelineStateImpl` class, `SerializedPipelineState` interface, `serializeState()`, and `deserializeState()` in `state.ts` — all for checkpoint round-trip.
2. **New `SectionVariation` type** — section fragments never enter the main pool or rating system. Cost tracking uses the single agent name `sectionDecomposition` for all section LLM calls via `costTracker.reserveBudget('sectionDecomposition', totalEstimatedCost)`.
3. **Extract standalone critique→edit→judge function** — `IterativeEditingAgent.execute()` is tightly coupled to whole-article state (calls `state.getTopByRating`, `state.addToPool`, `getCritiqueForVariant`). The section edit runner must be a **standalone function** that takes section text + critique + llmClient directly, NOT re-enter IterativeEditingAgent. Follow the same prompt/judge pattern but without pool/rating dependencies.
4. **Regex-based parser** for Phase 1 (FORMAT_RULES guarantee clean H1/H2/H3 structure; avoids ESM import complexity). Reuse the same fenced-code-block stripping logic from `formatValidator.ts` (lines 47-48) to ensure consistency.
5. **Runs after IterativeEditing** in COMPETITION phase — both agents target top variant independently; the stitched variant enters the pool as a separate competitor, not replacing the holistic edit.
6. **Preamble** (H1 title + intro before first H2) treated as a special section, skipped by default.
7. **Budget reservation is upfront** — `SectionDecompositionAgent.execute()` calls `costTracker.reserveBudget('sectionDecomposition', totalEstimate)` ONCE before `Promise.allSettled` fan-out, not per-section inside parallel branches. This avoids concurrent reservation race conditions.
8. **Section format validation** — `sectionFormatValidator.ts` relaxes `validateFormat` rules: no H1 required, H2 heading required at top of non-preamble sections, paragraph sentence count still enforced, no bullets/lists/tables. The FULL stitched article must still pass the original `validateFormat()` before entering the pool.

## Phased Execution Plan

### Phase 1: Section Parser + Stitcher (Pure Utilities, No LLM)

Testable building blocks for splitting markdown at H2 boundaries and reassembling.

**Create:**
| File | Purpose |
|------|---------|
| `src/lib/evolution/section/types.ts` | `ArticleSection`, `ParsedArticle`, `SectionVariation` types |
| `src/lib/evolution/section/sectionParser.ts` | `parseArticleIntoSections(md)` — regex split at `## ` boundaries, skip fenced code blocks |
| `src/lib/evolution/section/sectionStitcher.ts` | `stitchSections(sections)`, `stitchWithReplacements(parsed, replacements)` |
| `src/lib/evolution/section/sectionParser.test.ts` | Round-trip tests, edge cases |
| `src/lib/evolution/section/sectionStitcher.test.ts` | Round-trip, selective replacement, whitespace normalization |

**Key types:**
```typescript
interface ArticleSection {
  index: number;                // 0 = preamble
  heading: string | null;       // H2 text, null for preamble
  body: string;                 // content after heading
  markdown: string;             // full section (heading + body)
  isPreamble: boolean;
}

interface ParsedArticle {
  originalText: string;
  sections: ArticleSection[];
  sectionCount: number;         // excludes preamble
}

interface SectionVariation {
  id: string;
  sectionIndex: number;
  heading: string | null;
  body: string;
  markdown: string;
  strategy: string;
  costUsd: number;
}
```

**Parser approach:** Regex split on `/^## /m` (not `### `). Before splitting, strip fenced code blocks (``` regions), split, then restore. Each segment becomes an `ArticleSection`. The preamble is everything before the first `## `.

**Stitcher approach:** Concatenate `section.markdown` values with double newlines. `stitchWithReplacements` takes a `ParsedArticle` and a `Map<number, string>` of section index → replacement markdown.

**Verification:** `stitchSections(parseArticleIntoSections(md))` must equal `md` (modulo trailing whitespace normalization). Use inline test fixtures with multiple H2 sections — `docs/sample_evolution_content/filler_words.md` has no H2 headings and cannot be used for section parsing tests. Create a multi-section test fixture inline in the test file (3+ H2 sections, preamble, nested H3, code block containing `## `).

---

### Phase 2: SectionDecompositionAgent (Pipeline Integration)

New agent that decomposes → section-edits → stitches → adds to pool.

**Create:**
| File | Purpose |
|------|---------|
| `src/lib/evolution/section/sectionEditRunner.ts` | Standalone `runSectionEdit(section, articleContext, weakness, llmClient, agentName)` — critique→edit→judge loop per section. Does NOT re-enter IterativeEditingAgent; follows same prompt/judge pattern but takes section text + full article context directly. |
| `src/lib/evolution/section/sectionFormatValidator.ts` | `validateSectionFormat(section, isPreamble)` — relaxed rules: no H1 required, H2 heading required at top of non-preamble sections, paragraph sentence count enforced (2+ sentences, 25% tolerance), no bullets/lists/tables. Reuses fenced-code-block stripping from `formatValidator.ts`. |
| `src/lib/evolution/agents/sectionDecompositionAgent.ts` | `SectionDecompositionAgent extends AgentBase` |
| Tests for all 3 new files | |

**Modify:**
| File | Change |
|------|--------|
| `src/lib/evolution/core/supervisor.ts` | Add `runSectionDecomposition: boolean` to `PhaseConfig` interface. Update BOTH hard-coded return objects in `getPhaseConfig()`: set `false` in EXPANSION branch, `true` in COMPETITION branch. Update existing supervisor tests that assert on PhaseConfig shape. |
| `src/lib/evolution/core/pipeline.ts` | Add `sectionDecomposition?: PipelineAgent` to `PipelineAgents` interface. Add execution slot in `executeFullPipeline` after iterativeEditing block. Add `section_decomposition` entry to `STRATEGY_TO_AGENT` mapping for cost attribution. |
| `src/lib/evolution/core/featureFlags.ts` | Add `sectionDecompositionEnabled?: boolean` |
| `src/lib/evolution/config.ts` | Add `sectionDecomposition: 0.10` to `DEFAULT_EVOLUTION_CONFIG.budgetCaps` |
| `src/lib/evolution/types.ts` | Add `sectionState: SectionEvolutionState | null` to `PipelineState` interface and `SerializedPipelineState` |
| `src/lib/evolution/core/state.ts` | Add `sectionState = null` to `PipelineStateImpl`. Update `serializeState()` to include `sectionState`. Update `deserializeState()` to restore `sectionState` (default null for backward compat). |
| `src/lib/services/evolutionActions.ts` | Instantiate `SectionDecompositionAgent` in agent map, add to `buildAgents()` |
| `scripts/run-evolution-local.ts` | Instantiate in `buildAgents()` function |
| `src/lib/evolution/index.ts` | Export `SectionDecompositionAgent` and section types |

**Agent flow:**
1. `canExecute`: Return true if pool has rated variants with critiques AND top variant has ≥2 H2 sections
2. Get top variant + its critique from `state.allCritiques`
3. Parse into sections via `parseArticleIntoSections`
4. Filter eligible sections (skip preamble by default, skip sections < 100 chars)
5. Run `Promise.allSettled` of `runSectionEdit()` on eligible sections (parallel)
6. Build replacement map from accepted edits
7. `stitchWithReplacements` → validate full article format → `state.addToPool`
8. Return `AgentResult` with `variantsAdded: 1` (or 0 if no improvements)

**Section edit runner** (`runSectionEdit`):
- Standalone function (NOT re-entering IterativeEditingAgent class)
- Takes: `section: ArticleSection`, `fullArticleText: string` (for context), `weakness: { dimension: string, description: string }`, `llmClient: EvolutionLLMClient`, `agentName: string`
- Builds a section-scoped prompt: "Here is the full article for context. Focus ONLY on improving this section: [section text]. The weakness is: [dimension from critique]"
- Calls `llmClient.complete()` for the edit
- Validates edited section via `validateSectionFormat()` — rejects if section fails relaxed format rules
- Calls `compareWithDiff()` on just the section text (before vs after) for blind judge
- Returns `{ sectionIndex, improved: boolean, markdown, costUsd }`
- Max 2 cycles per section (lower than full article's 3 — sections are smaller)

**Budget:**
- `estimateCost` = per-section cost × number of eligible sections
- Per-section cost per cycle = 1 edit call + 2 judge calls (forward + reverse for bias mitigation) = 3 LLM calls
- With 5 sections × 2 cycles = **30 LLM calls** (corrected from earlier estimate of 20)
- Budget reservation: called ONCE upfront via `costTracker.reserveBudget('sectionDecomposition', totalEstimate)` before `Promise.allSettled`, not per-section inside parallel branches
- Cap at 10% of total budget. On a $5 budget, that is $0.50 for all section work
- If any section edit triggers `BudgetExceededError`, it propagates and the agent returns partial results (only sections edited before budget exhaustion)

---

### Phase 3: Per-Section Pools + Coherence Check (Future)

Upgrade to maintain per-section variant pools across iterations with independent ratings and convergence tracking.

**Create:**
| File | Purpose |
|------|---------|
| `src/lib/evolution/section/sectionPool.ts` | Per-section pool with OpenSkill ratings |
| `src/lib/evolution/section/sectionSupervisor.ts` | Budget allocation, convergence detection per section |
| `src/lib/evolution/section/coherenceChecker.ts` | LLM-assisted post-stitch transition smoothing |
| Tests for all 3 | |

**Modify:**
| File | Change |
|------|--------|
| `src/lib/evolution/types.ts` | Add full `SectionEvolutionState` (per-section pools, ratings, best variants) |
| `src/lib/evolution/core/state.ts` | Serialize/deserialize `sectionState` |
| `src/lib/evolution/agents/sectionDecompositionAgent.ts` | Upgrade to use persistent section pools across iterations |

**Deferred to Phase 3** because Phase 2 already delivers the core value (section-level editing). Phase 3 adds multi-iteration section evolution and coherence smoothing.

## Testing

### Phase 1
- **Fixture:** Create inline multi-section test fixtures in test files (NOT `filler_words.md` — it has no H2 headings). Fixtures must include: 3+ H2 sections, preamble with H1, nested H3 inside H2, fenced code block containing `## ` line.
- **Unit:** Round-trip `stitchSections(parseArticleIntoSections(md)) === md` (with trailing whitespace normalization)
- **Unit:** Edge cases: article with no H2 (entire text is preamble), article with exactly 1 H2, code block with `## ` not treated as section boundary
- **Unit:** `stitchWithReplacements` correctly substitutes a single section while preserving others
- **Unit:** Parser + stitcher output passes `validateFormat()` (existing full-article validator) — round-trip integration test

### Phase 2
- **Unit:** Mock LLM + mock `compareWithDiff` to test agent flow (decompose→edit→stitch→pool)
- **Unit:** `canExecute` returns false for articles with <2 H2 sections (boundary: exactly 2 sections should return true)
- **Unit:** Budget propagation — `BudgetExceededError` in one section edit during `Promise.allSettled` propagates correctly; already-completed sections still contribute to partial result
- **Unit:** Concurrent budget reservation — verify `reserveBudget` called ONCE upfront, not per-section inside fan-out
- **Unit:** `validateSectionFormat()` rejects section text with H1, accepts section with H2 heading + prose
- **Unit:** Stitched output passes `validateFormat()` — format validator integration test
- **Unit:** Update existing `supervisor.test.ts` assertions for new `runSectionDecomposition` field in `PhaseConfig`
- **Integration:** Run `scripts/run-evolution-local.ts --file <multi-section-fixture>.md --full --mock --iterations 3` with section decomposition enabled, verify stitched variant appears in pool. (Note: mock LLM templates may need section-aware responses to avoid producing H1 in section edits.)
- **Manual:** Run on a real 2000+ word multi-section article, inspect section-level edits in admin UI

### Phase 3
- **Unit:** Section pool add/rank/getBest, state serialization round-trip with backward compatibility (null sectionState)
- **Unit:** Checkpoint round-trip: `deserializeState(serializeState(stateWithSections))` preserves section pools
- **Integration:** Multi-iteration run verifying per-section convergence

## Documentation Updates

The following docs were identified as relevant and may need updates:
- `docs/feature_deep_dives/hierarchical_decomposition_agent.md` — fill in from stub with full implementation details
- `docs/feature_deep_dives/evolution_pipeline.md` — add section on decomposition agent in agent catalog
- `docs/feature_deep_dives/iterative_editing_agent.md` — reference section edit runner as derivative pattern
- `docs/feature_deep_dives/comparison_infrastructure.md` — note section-level diff usage
- `docs/feature_deep_dives/elo_budget_optimization.md` — document section decomposition budget cap
- `docs/feature_deep_dives/evolution_pipeline_visualization.md` — section-level viz if admin UI changes

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Code blocks with `## ` cause false splits | Strip fenced code blocks before regex split, restore after. Reuse stripping logic from `formatValidator.ts` for consistency. |
| Section edits break cross-section references | Phase 2: full-article format validator runs on stitched result before pool entry. Phase 3: coherence checker smooths transitions. |
| Cost multiplication (5 sections × 2 cycles = 30 LLM calls) | 10% budget cap ($0.50 on $5 total), skip preamble, min section length filter. Both iterativeEditing (10%) + sectionDecomposition (10%) = 20% total on editing — acceptable. |
| Checkpoint size growth (~75KB for 5 sections × 3 variants) | Acceptable; JSONB handles this fine |
| FORMAT_RULES changes break parser | Parser tested against format rules; both live in evolution module |
| Format validator rejects section text (no H1) | `sectionFormatValidator.ts` applies relaxed rules per section; full `validateFormat()` only runs on the final stitched article |
| Existing supervisor tests break on PhaseConfig change | Tests updated in Phase 2 to assert new `runSectionDecomposition` field |
| IterativeEditingAgent tightly coupled to pool state | Section edit runner is a standalone function, not re-entering the agent class |
| Pre-feature checkpoints missing sectionState | `deserializeState()` defaults `sectionState` to null for backward compat |
