# Simplify Evolution Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce evolution pipeline complexity by ~15% LOC, eliminate dead/unreachable code, consolidate duplicated logic, extract modules from the 1,363-LOC pipeline.ts (target ~850 LOC), and simplify configuration from 134 params to ~18 meaningful ones — all without changing pipeline behavior.

**Architecture:** Three-phase approach — Phase 1 removes dead code and extracts shared utilities (low risk), Phase 2 decomposes pipeline.ts into focused modules, collapses the feature flag system, and extracts cross-cutting deduplication (medium risk), Phase 3 simplifies budget tracking, agent gating, and remaining config (high risk, requires production data first). Each phase is independently shippable with full test coverage.

**Tech Stack:** TypeScript (strict mode), OpenSkill rating library, Supabase (Postgres + JSONB), Next.js server actions, Vitest test framework.

---

## Background

The evolution pipeline has grown to 56 non-test TypeScript source files (~8,500-9,500 LOC, plus 63 test files) with 14 agents, a two-phase supervisor, 134 configurable parameters across 7 systems, and a three-tier agent gating mechanism. While the system is well-tested (~995 test cases) and production-resilient, the complexity makes it hard to debug, onboard new contributors, and add features. This project simplifies the pipeline incrementally.

## Requirements (from GH Issue #441)

1. Remove confirmed dead code (unused parameters, never-toggled feature flags, dead DB rows)
2. Extract duplicated patterns into shared utilities (TextVariation factory, format validation rules, CritiqueBatch, comparison reversal, test helpers)
3. Decompose pipeline.ts (1,363 LOC) into focused modules (~850 LOC target, stretch ~800)
4. Collapse DB-backed feature flags to env vars for experimental toggles + enabledAgents for the rest
5. Simplify budget system from per-agent caps to total-only (Phase 3, pending production data)
6. Clean up integration layer (dead flag checks in scripts, admin UI, seed article consolidation)
7. Maintain all existing test coverage; no behavior changes

## Problem

The evolution pipeline's `pipeline.ts` is a 1,363 LOC monolith handling orchestration, finalization, Hall of Fame integration, persistence, metrics, and status management. Configuration spans 134 parameters across 7 systems, but only ~18 are ever meaningfully varied. Three independent gating tiers (PhaseConfig, DB feature flags, enabledAgents) control agent execution with significant overlap. Six agents duplicate TextVariation construction logic. Two format validators duplicate rule logic. Three call sites duplicate critique batch logic. Two comparison modules duplicate 2-pass reversal structure. Test mock utilities (`makeMockLLMClient`, `makeMockLogger`, etc.) are duplicated across 40+ test files. The `dryRunOnly` and `promptBasedEvolutionEnabled` feature flags are actively checked but never toggled from their defaults in production (`false` and `true` respectively). The `useEmbeddings` config param is set but never read.

## Research Corrections

1. **PairwiseRanker is NOT dead code.** The research document incorrectly identified it as dead. It is actively used by Tournament internally:
```typescript
// tournament.ts:131
private readonly pairwise = new PairwiseRanker();
```
It is NOT created in `createDefaultAgents()` (which manages pipeline-level agents), but it IS instantiated as a composition helper inside Tournament. **Do not delete PairwiseRanker.**

2. **`calibration.minOpponents` is NOT dead.** The research said "set but never read." It is actively used in `calibrationRanker.ts:127`: `ctx.payload.config.calibration.minOpponents ?? 2`. **Do not remove it.**

3. **`configValidation.ts` (146 LOC) is a new file** added by PR #442 after the research was conducted. It validates `budgetCaps`, `enabledAgents`, and `models` in `preparePipelineRun()`. Phase 2/3 config simplification tasks must account for this file — updating or simplifying its validation rules as config params are hardcoded or removed.

4. **Shared test helpers already exist** at `src/testing/utils/evolution-test-helpers.ts` (349 LOC, 13+ exports). The research implied none existed ("40+ files duplicate mocks"). Task 1.0 was updated from "create from scratch" to "audit & expand adoption."

5. **LOC drift after PR #443 merge** (85 source files changed): pipeline.ts is now 1,363 LOC (was 1,337), debateAgent grew 363→407 LOC, costTracker shrank 93→81 LOC, jsonParser tripled 18→54 LOC. LOC targets in the plan are approximate and should be verified during execution.

6. **Research inflated file/LOC counts.** The "106+ TypeScript files" claim counted test files as source files. Actual: **56 non-test source files** under `src/lib/evolution/`, **63 test files** separately. Sub-module LOC was also inflated: treeOfThought/ is 6 files/970 LOC (not 10/2,155), section/ is 5 files/392 LOC (not 9/934), experiment/ is 2 files/468 LOC (not 4/828). Total source LOC is closer to **~8,500-9,500** (not 11,000-13,000). Also: config.ts is 99 LOC (not 76), formatValidator.ts is 105 LOC (not 93). Research doc has been corrected.

7. **Two new core/ files not in research**: `adaptiveAllocation.ts` (234 LOC) and `costEstimator.ts` (391 LOC) were added by PR #443. These 625 LOC of new functionality must be accounted for in tasks touching `core/`.

8. **`dryRunOnly` and `promptBasedEvolutionEnabled` are not "dead code"** — they are actively checked at 2 call sites each. However, they are **never toggled from their defaults** in production (false and true respectively). The plan correctly removes the never-toggled conditional branches but the characterization as "dead" in the research was misleading. Research doc corrected.

9. **Phase transition uses config-driven thresholds**, not hardcoded values. Research incorrectly said "poolSize >= 15 AND diversity >= 0.25 OR iteration >= 8" — actual code uses `expansionMinPool`, `expansionDiversityThreshold`, `expansionMaxIterations` from config.

10. **Agent execution groups are 7, not 4.** Flow critique runs as its own separate step (Group 3), and Proximity and MetaReview run as separate groups (Groups 6 and 7). Research and plan corrected. (Superseded by correction #13 which refined 6→7.)

11. **runAgent() also handles LLMRefusalError** as a permanent, non-retryable error (ERR-6 pattern). Research only documented transient errors and BudgetExceededError.

12. **Migration count is 14, not 20.** 12 evolution + 2 Hall of Fame migrations (not 16+4 as research claimed).

13. **Agent execution groups are 7, not 6.** Proximity and MetaReview run as separate groups (Groups 6 and 7), not combined. Research and plan corrected.

14. **Server action count is 41, not 32.** evolutionActions has 13 (not 12, missing killEvolutionRunAction), visualizationActions has 11 (not 9), hallOfFameActions has 14 (not 8). Research corrected.

15. **Admin pages total ~1,738 LOC, not ~500.** The quality/evolution list page alone is 1,019 LOC. Research corrected.

16. **Feature flag admin UI does NOT exist.** Research claimed ~100 LOC admin section managing DB feature flags. No such UI exists in the codebase. Task 2.4's "delete admin flag UI" step removed.

17. **CalibrationRanker does NOT use PairwiseRanker.** CalibrationRanker has its own independent `compareWithBiasMitigation()` delegating to standalone comparison.ts. Only Tournament uses PairwiseRanker internally. Research corrected.

18. **EditTarget type is already colocated.** It is defined locally in iterativeEditingAgent.ts, not in types.ts as research claimed. Only 4 types need colocation (Task 2.12 updated).

19. **buildRunConfig() is 60 LOC (not ~43) and is internal** (not exported). Task 2.10 updated.

20. **Total agent implementation LOC is ~4,013, not ~4,500.** Research corrected.

21. **pipeline.ts line numbers were systematically offset 1-27 lines.** All function line references corrected in research doc.

## Explicit No-Change Decisions

These research findings were evaluated and intentionally left as-is:
- **Two rating systems (OpenSkill + Elo K-32)**: Different scopes (within-run vs cross-run). Both justified. (Research C.6)
- **PipelineState structure (20+ fields)**: All fields written and read; no dead state. (Research D.5)
- **MetaReviewAgent**: Zero LLM cost, provides `metaFeedback` consumed by 3 agents. (Research A.5)
- **runAgent() retry design**: SDK 3× + pipeline 1× = intentional, documented, state-safe. (Research C.5)
- **Dead `quality_scores` column**: Harmless, leave in DB. (Research I.4)
- **`calibration.minOpponents` parameter**: Research incorrectly identified as dead. Actively used in `calibrationRanker.ts:127`. Keep as-is.
- **Two-phase supervisor (EXPANSION→COMPETITION)**: Value of phase transitions (diversity buildup in EXPANSION, cost savings from deferred expensive agents) exceeds the complexity cost. Keep structure as-is. (Research C.2)
- **`adaptiveAllocation.ts` (234 LOC) and `costEstimator.ts` (391 LOC)**: New files added by PR #443. These are actively used and well-scoped. Not targeted for simplification in this project; audit during Phase 2 if they overlap with extracted modules.

## Options Considered

### Option A: Full Rewrite (Rejected)
Rewrite the pipeline from scratch with a simpler architecture. Risk: too high, would break ~995 test cases and all integration points. 4-6 week effort.

### Option B: Incremental Simplification (Selected)
Three phases of targeted changes, each independently shippable. Phase 1 and 2 are safe refactoring. Phase 3 requires production data analysis first.

### Option C: Configuration-Only Simplification (Rejected)
Only simplify config without touching code structure. Misses the biggest wins (pipeline.ts decomposition, dead code removal).

---

## Phased Execution Plan

### Phase 1: Quick Wins — Dead Code, Shared Utilities & Test Infrastructure

**Goal**: Remove dead code, extract duplicated patterns, establish shared test infrastructure. Low risk, no behavior changes.
**Estimated LOC reduction**: ~55 removed (dead params + never-toggled flag branches), ~155 deduplicated (TextVariation factory ~80 + format validation ~45 + reversal pattern ~30). Test dedup is staged incrementally via Task 1.0 (POC of 5-8 files); remaining test files migrated as touched in later tasks.

**Note**: Research LOC figures are approximate; actual counts vary due to ongoing PRs (see Correction #5). Verify exact starting LOC at Phase 1 completion before confirming Phase 2 targets.

---

#### Task 1.0: Audit & Expand Shared Test Utilities

Shared test helpers already exist at `src/testing/utils/evolution-test-helpers.ts` (349 LOC, 13+ exports including `createMockEvolutionLLMClient`, `createMockEvolutionLogger`, `createTestStrategyConfig`, etc.). However, many of the 63 test files still define inline mocks instead of using the shared module. This task audits adoption and migrates non-adopters.

**Files:**
- Modify: `src/testing/utils/evolution-test-helpers.ts` — add any missing mock patterns (e.g. `makeCtx()`, `makeMockCostTracker()` if not present)
- Modify: Test files that define inline mocks instead of importing shared helpers (incremental — update as touched in later tasks)

**Step 1: Audit adoption**

Grep for common inline mock patterns (`vi.fn()` + `mockLLM\|mockLogger\|mockCost`) across `src/lib/evolution/**/*.test.ts` to identify files NOT using the shared helpers.

**Step 2: Add any missing helpers to the shared module**

If common mock patterns exist that aren't in `evolution-test-helpers.ts`, add them.

**Step 3: Migrate 5-8 high-usage test files as proof of concept**

Replace inline mocks with imports from shared helpers.

**Step 4: Run affected tests**

Run: `npx vitest run src/lib/evolution/`
Expected: All PASS

**Step 5: Commit**

```bash
git commit -m "refactor(evolution): expand shared test helpers, migrate 5-8 test files"
```

Note: Remaining test files will be migrated incrementally as they are touched by later tasks.

---

#### Task 1.1: Remove Dead `useEmbeddings` Parameter

**Note:** `calibration.minOpponents` was originally listed here but is **actively used** in `calibrationRanker.ts:127` (`ctx.payload.config.calibration.minOpponents ?? 2`). It must NOT be removed.

**Files:**
- Modify: `src/lib/evolution/types.ts` (remove `useEmbeddings` from `EvolutionRunConfig`)
- Modify: `src/lib/evolution/config.ts` (remove `useEmbeddings: false` default)

**Step 1: Search for all references**

Run: `grep -rn "useEmbeddings" src/lib/evolution/`
Expected: Only type definitions and defaults — no runtime reads.

**Step 2: Remove from types.ts and config.ts**

**Step 3: Run tsc + existing tests**

Run: `npx tsc --noEmit && npx vitest run src/lib/evolution/config.test.ts`

**Step 4: Commit**

```bash
git commit -m "refactor(evolution): remove dead useEmbeddings param"
```

---

#### Task 1.2: Remove Never-Toggled Feature Flags + DB Rows (`dryRunOnly`, `promptBasedEvolutionEnabled`)

These flags are actively checked at call sites (cron runner, evolutionActions, CLI scripts) but never toggled from their defaults in production (`dryRunOnly: false`, `promptBasedEvolutionEnabled: true`). They are not "dead code" — they are meaningful guards — but since the defaults are never changed, the conditional branches are unreachable in practice. Removing them means removing the conditional branches and hardcoding the default behavior.

**Files:**
- Modify: `src/lib/evolution/core/featureFlags.ts` — remove 2 flags from interface, defaults, and FLAG_MAP
- Modify: `src/app/api/cron/evolution-runner/route.ts` — remove `dryRunOnly` check (~L75) and `promptBasedEvolutionEnabled` check (~L117)
- Modify: `src/lib/services/evolutionActions.ts` — remove `dryRunOnly` check (~L530) and `promptBasedEvolutionEnabled` check (~L559)
- Modify: `scripts/evolution-runner.ts` — remove dead flag checks (2 references)
- Modify: `scripts/run-evolution-local.ts` — remove dead flag check (1 reference)
- Modify: `src/app/api/cron/evolution-runner/route.test.ts` — remove/update tests for dead flags
- Modify: `src/lib/services/evolutionActions.test.ts` — remove dead flag from mock
- Modify: `src/lib/evolution/core/featureFlags.test.ts` — remove dead flag tests
- Modify: `src/__tests__/integration/evolution-infrastructure.integration.test.ts` — update flag count assertions
- Create: Supabase migration to delete dead flag rows from `feature_flags` table

**Step 1: Remove flags from featureFlags.ts**

Remove `dryRunOnly` and `promptBasedEvolutionEnabled` from:
- `EvolutionFeatureFlags` interface
- `DEFAULT_EVOLUTION_FLAGS` object
- `FLAG_MAP` mapping

**Step 2: Remove conditional branches in cron runner**

In `evolution-runner/route.ts`:
- Remove the `if (featureFlags.dryRunOnly)` block (~L75)
- Remove the `if (featureFlags.promptBasedEvolutionEnabled === false)` block (~L117)

**Step 3: Remove conditional branches in evolutionActions.ts**

- Remove the `if (featureFlags.dryRunOnly)` block (~L530)
- Remove the `if (featureFlags.promptBasedEvolutionEnabled === false)` block (~L559)

**Step 4: Remove dead flag checks from CLI scripts**

- `scripts/evolution-runner.ts` (~L156): Remove reference to `dryRunOnly`
- `scripts/run-evolution-local.ts`: Remove reference to `dryRunOnly` if present

**Step 5: Create migration to delete dead DB rows**

```sql
-- Delete dead feature flag rows
DELETE FROM feature_flags WHERE name IN ('evolution_dry_run_only', 'evolution_prompt_based_enabled');
```

**Step 6: Update all test files**

- `featureFlags.test.ts`: Remove tests for removed flags, update mock objects
- `route.test.ts`: Remove `dryRunOnly: true` test case, remove flag from all mock objects
- `evolutionActions.test.ts`: Remove flags from mock objects
- Integration test: Update expected flag count

**Step 7: Run tsc + affected tests**

Run: `npx tsc --noEmit && npx vitest run src/lib/evolution/core/featureFlags.test.ts src/app/api/cron/evolution-runner/route.test.ts src/lib/services/evolutionActions.test.ts`

**Step 8: Commit**

```bash
git commit -m "refactor(evolution): remove dead dryRunOnly and promptBasedEvolutionEnabled flags + DB rows"
```

---

#### Task 1.3: Extract TextVariation Factory

6+ agents manually construct `{id: uuidv4(), text, version, parentIds, strategy, createdAt, iterationBorn}`. Extract a shared factory.

**Files:**
- Create: `src/lib/evolution/core/textVariationFactory.ts`
- Create: `src/lib/evolution/core/textVariationFactory.test.ts`
- Modify: `src/lib/evolution/agents/generationAgent.ts`
- Modify: `src/lib/evolution/agents/evolvePool.ts`
- Modify: `src/lib/evolution/agents/iterativeEditingAgent.ts`
- Modify: `src/lib/evolution/agents/debateAgent.ts`
- Modify: `src/lib/evolution/agents/outlineGenerationAgent.ts`
- Modify: `src/lib/evolution/agents/sectionDecompositionAgent.ts`
- Modify: `src/lib/evolution/index.ts` (add export)

**Step 1: Write the failing test**

```typescript
// textVariationFactory.test.ts
import { describe, it, expect } from 'vitest';
import { createTextVariation } from './textVariationFactory';

describe('createTextVariation', () => {
  it('creates a variation with required fields', () => {
    const v = createTextVariation({
      text: 'Hello world',
      strategy: 'generation_default',
      iterationBorn: 3,
    });
    expect(v.id).toBeDefined();
    expect(v.text).toBe('Hello world');
    expect(v.strategy).toBe('generation_default');
    expect(v.iterationBorn).toBe(3);
    expect(v.parentIds).toEqual([]);
    expect(v.version).toBe(0);
    expect(v.createdAt).toBeInstanceOf(Date);
  });

  it('accepts optional parentIds and version', () => {
    const v = createTextVariation({
      text: 'Edited',
      strategy: 'iterative_editing',
      iterationBorn: 5,
      parentIds: ['abc', 'def'],
      version: 2,
    });
    expect(v.parentIds).toEqual(['abc', 'def']);
    expect(v.version).toBe(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/evolution/core/textVariationFactory.test.ts`
Expected: FAIL — module not found

**Step 3: Implement the factory**

```typescript
// textVariationFactory.ts
// Shared factory for creating TextVariation objects, eliminating duplication across 6+ agents.
import { v4 as uuidv4 } from 'uuid';
import type { TextVariation } from '../types';

interface CreateTextVariationParams {
  text: string;
  strategy: string;
  iterationBorn: number;
  parentIds?: string[];
  version?: number;
}

export function createTextVariation(params: CreateTextVariationParams): TextVariation {
  return {
    id: uuidv4(),
    text: params.text,
    strategy: params.strategy,
    iterationBorn: params.iterationBorn,
    parentIds: params.parentIds ?? [],
    version: params.version ?? 0,
    createdAt: new Date(),
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/evolution/core/textVariationFactory.test.ts`
Expected: PASS

**Step 5: Replace inline constructions in each agent**

For each of the 6 agents, replace `{ id: uuidv4(), text: ..., strategy: ..., ... }` with `createTextVariation({...})`. Import the factory, remove the `uuid` import if no longer needed.

**Step 6: Run all agent tests**

Run: `npx vitest run src/lib/evolution/agents/`
Expected: All PASS

**Step 7: Run tsc + lint**

Run: `npx tsc --noEmit && npx next lint`

**Step 8: Commit**

```bash
git commit -m "refactor(evolution): extract TextVariation factory to eliminate duplication across 6 agents"
```

---

#### Task 1.4: Extract Shared Format Validation Rules

`agents/formatValidator.ts` (full article) and `section/sectionFormatValidator.ts` share ~45 LOC of duplicated rule logic (bullet detection, numbered list detection, table detection, paragraph sentence-count).

**Files:**
- Create: `src/lib/evolution/core/formatValidationRules.ts`
- Create: `src/lib/evolution/core/formatValidationRules.test.ts`
- Modify: `src/lib/evolution/agents/formatValidator.ts`
- Modify: `src/lib/evolution/section/sectionFormatValidator.ts`

**Step 1: Read both validators to identify exact shared logic**

Read `formatValidator.ts` and `sectionFormatValidator.ts` to identify the duplicated rule functions.

**Step 2: Write tests for shared rules**

Test each shared rule function (bullet detection, numbered list, table, paragraph sentence count) in isolation.

**Step 3: Extract shared rules to `formatValidationRules.ts`**

Move the shared logic into pure functions. Both validators import from the new module.

**Step 4: Update both validators to use shared rules**

Replace inline implementations with imports from `formatValidationRules.ts`.

**Step 5: Run all format validation tests**

Run: `npx vitest run src/lib/evolution/agents/formatValidator.test.ts src/lib/evolution/section/sectionFormatValidator.test.ts src/lib/evolution/core/formatValidationRules.test.ts`

**Step 6: Run tsc + lint**

**Step 7: Commit**

```bash
git commit -m "refactor(evolution): extract shared format validation rules to eliminate duplication"
```

---

#### Task 1.5: Extract Shared 2-Pass Reversal Pattern from Comparison Modules

`comparison.ts` (116 LOC) and `diffComparison.ts` (127 LOC) share an identical 2-pass reversal structure. Extract the base reversal pattern.

**Files:**
- Create: `src/lib/evolution/core/reversalComparison.ts`
- Create: `src/lib/evolution/core/reversalComparison.test.ts`
- Modify: `src/lib/evolution/comparison.ts`
- Modify: `src/lib/evolution/diffComparison.ts`

**Step 1: Read both comparison modules to identify shared pattern**

**Step 2: Write tests for the reversal base pattern**

**Step 3: Extract to `reversalComparison.ts`**

**Step 4: Update both modules to use shared base**

**Step 5: Run comparison tests**

Run: `npx vitest run src/lib/evolution/comparison.test.ts src/lib/evolution/diffComparison.test.ts src/lib/evolution/core/reversalComparison.test.ts`

**Step 6: Commit**

```bash
git commit -m "refactor(evolution): extract shared 2-pass reversal pattern from comparison modules"
```

---

#### Task 1.6: Phase 1 Verification

**Step 1: Run full evolution test suite**

Run: `npx vitest run src/lib/evolution/`
Expected: All tests pass

**Step 2: Run tsc + lint + build**

Run: `npx tsc --noEmit && npx next lint && npx next build`

**Step 3: Update progress doc**

Update `docs/planning/simplify_evolution_pipeline_20260214/simplify_evolution_pipeline_20260214_progress.md` with Phase 1 completion.

**Step 4: Commit**

```bash
git commit -m "chore(evolution): Phase 1 verification — all tests pass"
```

---

### Phase 2: Module Extraction, Feature Flag Collapse & Cross-Cutting Deduplication

**Goal**: Break pipeline.ts (1,363 LOC) into focused modules. Collapse feature flags. Extract CritiqueBatch utility. Clean up integration layer. Target: pipeline.ts ~850 LOC (stretch goal: ~800 LOC).
**Estimated LOC moved**: ~520 LOC gross out of pipeline.ts, ~460 net after import/wrapper overhead. ~350 LOC deduplicated across agents and integration layer.

---

#### Task 2.1: Extract Hall of Fame Integration from pipeline.ts

The HoF integration (`feedHallOfFame`, `autoLinkPrompt`, and supporting functions) is ~200 LOC that can be extracted from pipeline.ts into its own module. `finalizePipelineRun()` calls it as its last step.

**Files:**
- Create: `src/lib/evolution/core/hallOfFameIntegration.ts`
- Create: `src/lib/evolution/core/hallOfFameIntegration.test.ts`
- Modify: `src/lib/evolution/core/pipeline.ts` — remove extracted functions, import from new module

**Step 1: Read pipeline.ts to identify exact functions to extract**

Read `feedHallOfFame()` (~L586), `autoLinkPrompt()` (~L498), `findTopicByPrompt()` (~L562), `linkPromptToRun()` (~L575), and any helper functions they depend on within pipeline.ts.

**Step 2: Write tests for the extracted module**

Test `feedHallOfFame` and `autoLinkPrompt` in isolation with mocked Supabase client.

**Step 3: Create hallOfFameIntegration.ts**

Move the functions to the new module, preserving their signatures. Export them.

**Step 4: Update pipeline.ts to import from new module**

Replace the moved function bodies with imports. `finalizePipelineRun()` calls `feedHallOfFame()` the same way but from the import.

**Step 5: Run pipeline tests + new module tests**

Run: `npx vitest run src/lib/evolution/core/pipeline.test.ts src/lib/evolution/core/pipelineFlow.test.ts src/lib/evolution/core/hallOfFameIntegration.test.ts`

**Step 6: Run tsc + lint**

**Step 7: Commit**

```bash
git commit -m "refactor(evolution): extract Hall of Fame integration from pipeline.ts (~200 LOC)"
```

---

#### Task 2.2: Extract Metrics Persistence from pipeline.ts

`persistAgentMetrics()`, `persistCostPrediction()`, `linkStrategyConfig()`, `updateStrategyAggregates()`, `computeFinalElo()` are ~170 LOC of post-run analytics that can move to a dedicated module.

**Files:**
- Create: `src/lib/evolution/core/metricsWriter.ts`
- Create: `src/lib/evolution/core/metricsWriter.test.ts`
- Modify: `src/lib/evolution/core/pipeline.ts`

**Step 1: Read pipeline.ts to identify exact metrics functions**

Read `persistAgentMetrics()` (~L300), `persistCostPrediction()` (~L257), `linkStrategyConfig()` (~L168), `updateStrategyAggregates()` (~L144), `computeFinalElo()` (~L136).

**Step 2: Write tests for extracted metrics functions**

Include a unit test for `computeFinalElo()` / `ordinalToEloScale()` — this was identified as a coverage gap (Research J.7 gap #4).

**Step 3: Create metricsWriter.ts and move functions**

Consider inlining the `update_strategy_aggregates()` Supabase RPC into the TypeScript module. It's only called from one place and inlining removes DB-side indirection, making the logic testable in TypeScript. (Research I.5, ~30 LOC)

**Step 4: Update pipeline.ts imports**

**Step 5: Run pipeline tests + metrics tests**

Run: `npx vitest run src/lib/evolution/core/`

**Step 6: Run tsc + lint**

**Step 7: Commit**

```bash
git commit -m "refactor(evolution): extract metrics persistence from pipeline.ts (~170 LOC)"
```

---

#### Task 2.3: Extract Persistence & Utilities from pipeline.ts

**Persistence** (`persistCheckpoint()`, `persistVariants()`, `markRunFailed()`, `markRunPaused()`) and **utilities** (`sliceLargeArrays()`, `truncateDetail()`) are ~170 LOC that can move out of pipeline.ts. Persistence functions go to `persistence.ts`; utility functions go to `utilities.ts` (they are general-purpose helpers, not DB-specific — Research C.1 UTILITY category).

**Files:**
- Create: `src/lib/evolution/core/persistence.ts` — DB persistence functions
- Create: `src/lib/evolution/core/persistence.test.ts`
- Create: `src/lib/evolution/core/pipelineUtilities.ts` — `sliceLargeArrays()`, `truncateDetail()`
- Create: `src/lib/evolution/core/pipelineUtilities.test.ts`
- Modify: `src/lib/evolution/core/pipeline.ts`

**Step 1: Read pipeline.ts to identify exact persistence + utility functions**

**Step 2: Write tests for extracted functions**

Include a checkpoint resume after partial failure integration test — this was identified as a coverage gap (Research J.7 gap #2).

**Step 3: Create persistence.ts and pipelineUtilities.ts, move functions to each**

**Step 4: Update pipeline.ts imports**

**Step 5: Run pipeline tests + persistence tests**

Run: `npx vitest run src/lib/evolution/core/`

**Step 6: Run tsc + lint**

**Step 7: Commit**

```bash
git commit -m "refactor(evolution): extract persistence layer from pipeline.ts (~170 LOC)"
```

---

#### Task 2.4: Collapse Feature Flags to Env Vars + Delete Admin UI

Replace DB-backed feature flags with:
- 3 env vars for experimental toggles: `EVOLUTION_OUTLINE_GENERATION`, `EVOLUTION_TREE_SEARCH`, `EVOLUTION_FLOW_CRITIQUE`
- 5 always-ON flags hardcoded (tournament, evolvePool, debate, iterativeEditing, sectionDecomposition)
- Agent gating now just: PhaseConfig + enabledAgents (2 tiers instead of 3)
- ~~Delete the feature flag admin UI section~~ — **CORRECTION: No such UI exists in the codebase. Skip this step.**

**Files:**
- Modify: `src/lib/evolution/core/featureFlags.ts` — rewrite to read env vars
- Modify: `src/lib/evolution/core/featureFlags.test.ts` — rewrite tests
- Modify: `src/app/api/cron/evolution-runner/route.ts` — remove DB flag fetching
- Modify: `src/app/api/cron/evolution-runner/route.test.ts`
- Modify: `src/lib/services/evolutionActions.ts` — remove DB flag fetching
- Modify: `src/lib/services/evolutionActions.test.ts`
- Modify: `src/__tests__/integration/evolution-infrastructure.integration.test.ts`
- Modify: `src/lib/evolution/core/configValidation.ts` — update or simplify flag validation logic (146 LOC, added by PR #442)
- ~~Delete: Feature flag management section from admin settings UI~~ — **does not exist, skip**
- Modify: `src/lib/evolution/core/pipeline.ts` — `runGatedAgents()` no longer checks always-ON flags

**Note:** `configValidation.ts` (146 LOC, added by PR #442) validates feature flags, budgetCaps, and enabledAgents during `preparePipelineRun()`. After collapsing feature flags to env vars, update or simplify the validation logic in this file accordingly.

**Step 1: Rewrite featureFlags.ts**

Replace `fetchFeatureFlags()` (DB query) with `getFeatureFlags()` (env var reads):

```typescript
// New featureFlags.ts
// Reads evolution feature flags from environment variables. Only 3 experimental toggles remain.

export interface EvolutionFeatureFlags {
  tournamentEnabled: true;        // always on
  evolvePoolEnabled: true;        // always on
  debateEnabled: true;            // always on
  iterativeEditingEnabled: boolean; // on unless treeSearch is on
  sectionDecompositionEnabled: true; // always on
  outlineGenerationEnabled: boolean;
  treeSearchEnabled: boolean;
  flowCritiqueEnabled: boolean;
}

export function getFeatureFlags(): EvolutionFeatureFlags {
  const treeSearch = process.env.EVOLUTION_TREE_SEARCH === 'true';
  return {
    tournamentEnabled: true,
    evolvePoolEnabled: true,
    debateEnabled: true,
    iterativeEditingEnabled: !treeSearch, // mutex with treeSearch
    sectionDecompositionEnabled: true,
    outlineGenerationEnabled: process.env.EVOLUTION_OUTLINE_GENERATION === 'true',
    treeSearchEnabled: treeSearch,
    flowCritiqueEnabled: process.env.EVOLUTION_FLOW_CRITIQUE === 'true',
  };
}
```

**Step 2: Update callers** — replace `await fetchFeatureFlags()` with `getFeatureFlags()` (sync)

**~~Step 3: Delete feature flag admin UI section~~** — SKIP (no such UI exists)

**Step 3 (renumbered): Simplify `runGatedAgents()`** — remove redundant checks for always-ON flags (tournament, evolvePool, etc.)

**Step 5: Create migration to delete remaining evolution feature flag rows from DB**

```sql
-- Delete all evolution feature flag rows (flags now read from env vars)
DELETE FROM feature_flags WHERE name LIKE 'evolution_%';
```

**Step 6: Rewrite tests** — mock `process.env` instead of DB

**Step 7: Run all affected tests**

**Step 8: Run tsc + lint + build**

**Step 9: Commit**

```bash
git commit -m "refactor(evolution): collapse DB feature flags to env vars"
```

---

#### Task 2.5: Move `qualityThresholdMet()` into Supervisor

Currently in pipeline.ts (~L705), this single-article stopping condition belongs in the supervisor alongside the other 4 stopping conditions.

**Files:**
- Modify: `src/lib/evolution/core/supervisor.ts`
- Modify: `src/lib/evolution/core/supervisor.test.ts`
- Modify: `src/lib/evolution/core/pipeline.ts`

**Step 1: Write test in supervisor.test.ts**

```typescript
it('shouldStop returns qualityThreshold when all critique dims >= threshold', () => {
  // setup state with all dimensions >= 8
  const result = supervisor.shouldStop(state, config);
  expect(result).toContain('qualityThreshold');
});
```

**Step 2: Move function to supervisor**

Move `qualityThresholdMet()` from pipeline.ts to supervisor.ts. Integrate into `shouldStop()`.

**Step 3: Verify all 5 stopping conditions are in supervisor.shouldStop()**

After the move, confirm `shouldStop()` handles all 5 conditions:
1. Quality threshold (single-article, just moved)
2. Quality plateau (COMPETITION)
3. Degenerate state (plateau + diversity < 0.01)
4. Budget exhausted
5. Max iterations

**Step 4: Update pipeline.ts** — remove the inline quality threshold check, rely on `supervisor.shouldStop()`.

**Step 5: Run tests**

Run: `npx vitest run src/lib/evolution/core/supervisor.test.ts src/lib/evolution/core/pipeline.test.ts src/lib/evolution/core/pipelineFlow.test.ts`

**Step 6: Run tsc + lint**

**Step 7: Commit**

```bash
git commit -m "refactor(evolution): move qualityThresholdMet into supervisor for unified stopping logic"
```

---

#### Task 2.6: Extract CritiqueBatch Utility

ReflectionAgent, IterativeEditingAgent.runInlineCritique(), and pipeline.ts `runFlowCritiques()` all duplicate critique batch logic using the same prompt builders from `flowRubric.ts`. Extract a shared utility. (Research A.4, ~150 LOC dedup)

**Files:**
- Create: `src/lib/evolution/core/critiqueBatch.ts`
- Create: `src/lib/evolution/core/critiqueBatch.test.ts`
- Modify: `src/lib/evolution/agents/reflectionAgent.ts`
- Modify: `src/lib/evolution/agents/iterativeEditingAgent.ts`
- Modify: `src/lib/evolution/core/pipeline.ts` (runFlowCritiques)

**Step 1: Read the 3 call sites to identify the shared pattern**

Read ReflectionAgent (~L55-120), IterativeEditingAgent.runInlineCritique (~L256-283), and pipeline.ts runFlowCritiques (~L1306).

**Step 2: Write tests for CritiqueBatch**

Test batch critique execution with parallel and sequential modes, error handling.

**Step 3: Implement `critiqueBatch.ts`**

Extract the shared critique execution logic. Should handle:
- Parallel critique (Reflection, FlowCritique) vs sequential (IterativeEditing)
- `buildQualityCritiquePrompt()` / `buildFlowCritiquePrompt()` usage
- Result parsing and error handling

**Step 4: Update all 3 call sites to use CritiqueBatch**

**Step 5: Run all affected tests**

Run: `npx vitest run src/lib/evolution/agents/reflectionAgent.test.ts src/lib/evolution/agents/iterativeEditingAgent.test.ts src/lib/evolution/core/pipeline.test.ts src/lib/evolution/core/critiqueBatch.test.ts`

**Step 6: Run tsc + lint**

**Step 7: Commit**

```bash
git commit -m "refactor(evolution): extract CritiqueBatch utility from 3 duplicate critique implementations"
```

---

#### Task 2.7: Move experiment/ Out of evolution/

The `experiment/` directory (2 source files, ~468 LOC) is experiment infrastructure, not pipeline code. It's only referenced by `strategyRegistryActions.ts` and its own tests.

**Files:**
- Move: `src/lib/evolution/experiment/` → `src/lib/experiments/evolution/`
- Modify: any imports referencing the old path

**Step 1: Search for all imports of experiment/**

Run: `grep -rn "from.*evolution/experiment" src/`

**Step 2: Move files**

**Step 3: Update all import paths**

**Step 4: Run affected tests**

**Step 5: Commit**

```bash
git commit -m "refactor: move experiment/ from evolution/ to lib/experiments/ (not pipeline code)"
```

---

#### Task 2.8: Simplify Strategy Config Hash

Remove `agentModels` and `budgetCaps` from the strategy config fingerprint hash. Only hash `generationModel`, `judgeModel`, `iterations`, `enabledAgents`. (Research B.5)

**Files:**
- Modify: `src/lib/evolution/core/strategyConfig.ts`
- Modify: `src/lib/evolution/core/strategyConfig.test.ts`

**Step 1: Read strategyConfig.ts to identify `extractStrategyConfig()` and `hashStrategyConfig()`**

**Step 2: Update `extractStrategyConfig()` to omit `agentModels` and `budgetCaps`**

**Step 3: Update tests**

**Step 4: Run tests + tsc**

**Step 5: Commit**

```bash
git commit -m "refactor(evolution): simplify strategy config hash (remove agentModels, budgetCaps)"
```

---

#### Task 2.9: Consolidate Seed Article Generation

3 independent implementations of seed article generation exist across the codebase. Consolidate to 1 shared utility. (Research K.9)

**Files:**
- Modify: `src/lib/evolution/core/seedArticle.ts` (make this the canonical implementation)
- Modify: Other 2 call sites (identify via grep for seed article generation patterns)

**Step 1: Grep for seed article generation patterns across the codebase**

**Step 2: Consolidate into `seedArticle.ts`**

**Step 3: Update callers**

**Step 4: Run tests + tsc**

**Step 5: Commit**

```bash
git commit -m "refactor(evolution): consolidate 3 seed article implementations into 1 shared utility"
```

---

#### Task 2.10: Collapse `buildRunConfig()` in evolutionActions.ts

Simplify `buildRunConfig()` from ~60 LOC to ~30 LOC. Note: this is an internal (non-exported) helper function. (Research K.9)

**Files:**
- Modify: `src/lib/services/evolutionActions.ts`
- Modify: `src/lib/services/evolutionActions.test.ts`

**Step 1: Read `buildRunConfig()` to identify simplification opportunities**

**Step 2: Simplify — remove redundant default handling already done by `resolveConfig()`**

**Step 3: Run tests + tsc**

**Step 4: Commit**

```bash
git commit -m "refactor(evolution): simplify buildRunConfig in evolutionActions"
```

---

#### Task 2.11: Drop V1 Legacy Compat (Gated on Data)

Remove V1 backward compatibility: `eloRatings` checkpoint fallback, V1 summary Zod schema, V1 deserialization path in visualization actions. (Research D.1, I.6, K.9)

**PREREQUISITE**: Query production to verify no V1-format checkpoints remain:
```sql
SELECT COUNT(*) FROM evolution_checkpoints
WHERE state_snapshot->'eloRatings' IS NOT NULL
  AND state_snapshot->'ratings' IS NULL;
```
If count > 0, skip this task.

**Files:**
- Modify: `src/lib/evolution/core/state.ts` — remove `eloToRating()` fallback in `deserializeState()`
- Modify: `src/lib/evolution/types.ts` — remove V1Schema, eloRatings field
- Modify: `src/lib/services/evolutionVisualizationActions.ts` — remove V1 summary handling
- Modify: affected test files

**Step 1: Verify prerequisite query returns 0**

**Step 2: Remove V1 deserialization paths**

**Step 3: Run tests + tsc**

**Step 4: Commit**

```bash
git commit -m "refactor(evolution): remove V1/Elo legacy compatibility code"
```

---

#### Task 2.12: Colocate Agent-Specific Types from types.ts

Move 4 agent-specific types that are only used by 1-2 files out of the 679-LOC `types.ts` and into their respective agent files. Improves locality and reduces the central types surface area. (Research D.1)

**Types to move:**
- `GenerationStep` → `agents/generationAgent.ts`
- `OutlineVariant` → `agents/outlineGenerationAgent.ts`
- `DebateTranscript` → `agents/debateAgent.ts`
- `MetaFeedback` → `agents/metaReviewAgent.ts`
- ~~`EditTarget` → `agents/iterativeEditingAgent.ts`~~ — **CORRECTION: EditTarget is already defined locally in iterativeEditingAgent.ts, not in types.ts. Skip.**

**Files:**
- Modify: `src/lib/evolution/types.ts` — remove 4 type definitions
- Modify: 4 agent files — add type definitions, update imports
- Modify: any other files that import these types (grep first)

**Step 1: Grep for each type to confirm usage is limited to 1-2 files**

**Step 2: Move types one at a time, running tsc after each**

**Step 3: Run full evolution tests**

Run: `npx vitest run src/lib/evolution/`

**Step 4: Commit**

```bash
git commit -m "refactor(evolution): colocate 4 agent-specific types from types.ts to their agents"
```

---

#### Task 2.13: Extract Shared UI Components (DimensionScoresDisplay, useExpandedId)

Two UI patterns are duplicated across multiple evolution components. (Research H.6)

**Files:**
- Create: `src/components/evolution/shared/DimensionScoresDisplay.tsx` (~15 LOC extracted from ReflectionDetail, IterativeEditingDetail, OutlineGenerationDetail)
- Create: `src/components/evolution/shared/useExpandedId.ts` (~30 LOC extracted from TimelineTab, VariantsTab, LogsTab)
- Modify: 3 agent detail components (use DimensionScoresDisplay)
- Modify: 3 tab components (use useExpandedId)

**Step 1: Read the 6 source components to identify exact shared patterns**

**Step 2: Extract `DimensionScoresDisplay` component**

**Step 3: Extract `useExpandedId()` hook**

**Step 4: Update all 6 consumer components**

**Step 5: Run tsc + lint**

**Step 6: Commit**

```bash
git commit -m "refactor(evolution): extract DimensionScoresDisplay and useExpandedId shared UI patterns"
```

---

#### Task 2.14: Add Missing Coverage Gap Tests

The research identified 6 coverage gaps (J.7). Tasks 2.2 and 2.3 address 2 of them. This task adds tests for the remaining 4 that are relevant to this simplification project.

**Tests to add:**

1. **Agent model fallback chain** (J.7 gap #5): Test `agentModels[agent] ?? (isJudge ? judgeModel : generationModel)` — important to verify before Phase 3 config simplification.

2. **Diversity collapse → degenerate stop** (J.7 gap #6): Test that supervisor correctly fires degenerate stop when plateau AND diversity < 0.01. Important to verify before Phase 3 gating changes.

3. **Three-tier gating integration** (J.7 gap #3): Test all 3 tiers (PhaseConfig + feature flags + canExecute) in a single pipeline execution. Important to verify before Phase 3 collapses the tiers.

4. **E2E cron → queue → pipeline → DB** (J.7 gap #1): Integration test verifying the full execution path. Lower priority but valuable safety net.

**Files:**
- Create or modify: `src/lib/evolution/core/supervisor.test.ts` (degenerate stop, model fallback)
- Create or modify: `src/lib/evolution/core/pipelineFlow.test.ts` (gating integration)
- Create or modify: `src/__tests__/integration/evolution-pipeline.integration.test.ts` (E2E)

**Step 1: Write the 4 tests**

**Step 2: Run them to verify they pass with current code**

Run: `npx vitest run src/lib/evolution/core/supervisor.test.ts src/lib/evolution/core/pipelineFlow.test.ts`

**Step 3: Commit**

```bash
git commit -m "test(evolution): add 4 coverage gap tests before Phase 3 simplification"
```

---

#### Task 2.15: Phase 2 Verification

**Step 1: Run full evolution test suite + experiment tests + integration**

Run: `npx vitest run src/lib/evolution/ src/lib/experiments/ src/__tests__/integration/`

**Step 2: Run tsc + lint + build**

Run: `npx tsc --noEmit && npx next lint && npx next build`

**Step 3: Verify pipeline.ts LOC**

Run: `wc -l src/lib/evolution/core/pipeline.ts`
Expected: ~850 LOC (down from 1,363; stretch goal ~800 LOC)

**Step 4: Verify types.ts LOC**

Run: `wc -l src/lib/evolution/types.ts`
Expected: ~600 LOC (down from 679, after colocating 4 agent-specific types)

**Step 5: Update progress doc**

**Step 6: Commit**

```bash
git commit -m "chore(evolution): Phase 2 verification — pipeline.ts decomposed, feature flags collapsed"
```

---

### Phase 3: Structural Simplification (Requires Production Data)

**Goal**: Simplify budget system, agent gating, config defaults, and pipeline modes. High risk — requires production data queries first.

**BLOCKER**: Before starting Phase 3, run these queries against production DB:

```sql
-- 1. Agent ROI (identify bottom performers)
SELECT agent_name, AVG(elo_per_dollar), COUNT(*)
FROM evolution_run_agent_metrics
WHERE created_at >= NOW() - INTERVAL '90 days'
GROUP BY agent_name ORDER BY AVG(elo_per_dollar) ASC;

-- 2. Per-agent budget cap triggers (justify total-only)
SELECT COUNT(*) FILTER (WHERE status = 'paused') as budget_paused,
       COUNT(*) as total_runs
FROM evolution_runs;

-- 3. Feature flag override frequency
SELECT name, enabled FROM feature_flags WHERE name LIKE 'evolution_%';

-- 4. Phase transition frequency
SELECT COUNT(*) as total,
       COUNT(*) FILTER (WHERE message LIKE '%EXPANSION%COMPETITION%') as transitions
FROM evolution_run_logs
WHERE created_at >= NOW() - INTERVAL '90 days';

-- 5. TreeSearch vs IterativeEditing ROI comparison
SELECT agent_name, AVG(elo_per_dollar), STDDEV(elo_per_dollar), COUNT(*)
FROM evolution_run_agent_metrics
WHERE agent_name IN ('iterativeEditing', 'treeSearch')
  AND created_at >= NOW() - INTERVAL '90 days'
GROUP BY agent_name;

-- 6. Prompt-based run frequency (runs with prompt_id without explanation_id)
SELECT COUNT(*) FILTER (WHERE prompt_id IS NOT NULL AND explanation_id IS NULL) as prompt_only,
       COUNT(*) as total
FROM evolution_runs;
```

**If the data supports it**, proceed with these tasks:

---

#### Task 3.1: Simplify Budget to Total-Only

Replace 12 per-agent caps (summing to 135%) + FIFO reservation queue + 30% safety margin with a simple total budget check.

**Files:**
- Modify: `src/lib/evolution/core/costTracker.ts` (~93 → ~40 LOC)
- Delete: `src/lib/evolution/core/budgetRedistribution.ts` (entire file)
- Delete: `src/lib/evolution/core/budgetRedistribution.test.ts`
- Modify: `src/lib/evolution/core/costTracker.test.ts` — simplify tests
- Modify: `src/lib/evolution/types.ts` — replace `budgetCaps: Record<string, number>` with `budgetCapUsd: number`
- Modify: `src/lib/evolution/config.ts` — simplify default budget config
- Modify: `src/components/evolution/BudgetTab.tsx` — remove per-agent caps grid (~80 LOC), show only total budget bar
- Modify: `src/lib/services/evolutionVisualizationActions.ts` — remove `computeEffectiveBudgetCaps()`, replace with simple total lookup

**Simplified CostTracker structure:**

```typescript
// New simplified costTracker.ts (~40 LOC)
export class CostTracker {
  private totalSpent = 0;
  constructor(private readonly budgetCapUsd: number) {}

  reserveBudget(_agentName: string, estimatedCost: number): void {
    if (this.totalSpent + estimatedCost > this.budgetCapUsd) {
      throw new BudgetExceededError(this.totalSpent, estimatedCost, this.budgetCapUsd);
    }
  }

  recordSpend(_agentName: string, actualCost: number): void {
    this.totalSpent += actualCost;
  }

  get availableBudget(): number { return this.budgetCapUsd - this.totalSpent; }
  get spent(): number { return this.totalSpent; }
}
```

**This task should only proceed if production data shows per-agent caps rarely trigger (query #2).**

---

#### Task 3.2: Hardcode Config Defaults & Simplify resolveConfig()

Remove auto-clamping logic. Hardcode parameters that never vary in production. (Research B.3)

**Parameters to hardcode as constants (never overridden in production):**
- `plateau.plateauWindow` (default: 3) → `const PLATEAU_WINDOW = 3`
- `plateau.plateauThreshold` (default: 0.02) → `const PLATEAU_THRESHOLD = 0.02`
- `expansion.minPool` (default: 15) → `const EXPANSION_MIN_POOL = 15`
- `expansion.diversityThreshold` (default: 0.25) → `const EXPANSION_DIVERSITY_THRESHOLD = 0.25`
- `expansion.calibrationOpponents` (default: 3) → `const EXPANSION_CALIBRATION_OPPONENTS = 3`
- `tournament.topK` → flatten to top-level `tournamentTopK: number`

**Parameters to KEEP configurable (~18 meaningful):**
- `maxIterations`, `budgetCapUsd`, `singleArticle` (top-level)
- `expansion.maxIterations` (auto-clamped, keep but simplify clamping)
- `generation.variantsPerIteration`
- `generationModel`, `judgeModel`
- `enabledAgents` (agent selection)
- `tournamentTopK`

**Files:**
- Modify: `src/lib/evolution/config.ts` — remove auto-clamping, hardcode constants
- Modify: `src/lib/evolution/config.test.ts`
- Modify: `src/lib/evolution/types.ts` — flatten nested config types, remove dead fields
- Modify: `src/lib/evolution/core/configValidation.ts` — remove validation for hardcoded params

---

#### Task 3.3: Consolidate Two Pipeline Modes

Merge `executeMinimalPipeline` into `executeFullPipeline` with a config option: `{phases: false, agentFilter: AgentName[]}`. (Research C.3, ~70 LOC saved)

**Files:**
- Modify: `src/lib/evolution/core/pipeline.ts`
- Modify: `src/lib/evolution/core/pipeline.test.ts`
- Modify: all callers of `executeMinimalPipeline`
- Create: Supabase migration to handle `pipeline_type` column (if the column tracked `full`/`minimal`/`batch`, it may need updating since `minimal` mode will no longer exist as a separate entry point — either remove the column or map old values)

---

#### Task 3.4: Collapse Agent Gating to Unified `isEnabled()`

After Phase 2 removes DB feature flags (tier 2), collapse the remaining 2 tiers (PhaseConfig + enabledAgents) into a single `isEnabled(agentName, phase, config)` function. (Research B.1, ~80 LOC saved)

**Files:**
- Modify: `src/lib/evolution/core/supervisor.ts`
- Modify: `src/lib/evolution/core/pipeline.ts`
- Modify: `src/lib/evolution/core/agentToggle.ts`

---

#### Task 3.5: CalibrationRanker as Thin Tournament Wrapper

CalibrationRanker and Tournament independently implement `compareWithBiasMitigation()`, rating update, and flow comparison patterns. CalibrationRanker delegates to standalone `comparison.ts`; Tournament delegates to its internal `PairwiseRanker`. Refactor CalibrationRanker to delegate to Tournament with adaptive budget scaling. (Research A.3, ~100 LOC dedup)

**Design considerations:**
- CalibrationRanker's `minOpponents` adaptive 2-batch behavior (min opponents first, skip rest if confidence ≥ 0.7) must be preserved. This is actively used via `config.calibration.minOpponents` (Correction #2).
- Design step: determine whether to add a "calibration mode" to Tournament (adaptive 2-batch, new entrants only, stratified opponents) or keep CalibrationRanker as a thin wrapper that configures Tournament with calibration-specific parameters.

**Files:**
- Modify: `src/lib/evolution/agents/calibrationRanker.ts`
- Modify: `src/lib/evolution/agents/calibrationRanker.test.ts`
- Possibly modify: `src/lib/evolution/agents/tournament.ts` (if adding calibration mode)

---

#### Task 3.6: Conditional UI Cleanup for Killed Features

If production data (query #5) shows TreeSearch or OutlineGeneration have poor ROI and are killed:
- Delete `TreeSearchDetail.tsx` (49 LOC) + `TreeTab.tsx` (318 LOC) = 367 LOC
- Delete `OutlineGenerationDetail.tsx` (41 LOC)
- Remove from `AgentExecutionDetail` discriminated union in types.ts
- Remove switch cases in `AgentExecutionDetailView`

(Research H.2. Only execute if features are actually killed based on data.)

---

#### Task 3.7: Phase 3 Verification

Full test suite, build, and production smoke test.

---

## Testing

### Tests Modified Per Phase

| Phase | Tests Deleted | Tests Modified | Tests Added | Test LOC Change |
|-------|-------------|---------------|-------------|-----------------|
| Phase 1 | 0 | ~10 (mock object updates, script flag removal) | 4 (factory, format rules, reversal, test helpers) | ~-50 (dedup) |
| Phase 2 | 0 | ~18 (import paths, flag mocks, type moves) | 9 (HoF, metrics, persistence, utilities, critiqueBatch, UI dedup, 4 coverage gaps) | ~-80 |
| Phase 3 | ~20 (budget redistribution, per-agent caps) | ~15 | 0 | ~-400 to -500 |
| **Total** | **~20** | **~43** | **~13** | **~-530 to -630** |

### Manual Verification

After each phase:
1. `npx tsc --noEmit` — no type errors
2. `npx next lint` — no lint errors
3. `npx next build` — successful build
4. `npx vitest run src/lib/evolution/` — all evolution tests pass
5. `npx vitest run src/__tests__/integration/` — integration tests pass

### Before Phase 3 specifically:
- Run production data queries (see Phase 3 BLOCKER above — all 6 queries)
- Verify on staging that evolution runs complete successfully

## Documentation Updates

The following docs should be updated as each phase completes:

### Phase 1
- `docs/evolution/reference.md` — remove `useEmbeddings`, dead flags
- `docs/evolution/agents/overview.md` — note TextVariation factory
- `docs/evolution/rating_and_comparison.md` — note shared reversal pattern

### Phase 2
- `docs/evolution/architecture.md` — updated module structure (HoF, metrics, persistence, utilities extraction)
- `docs/evolution/reference.md` — feature flags section rewritten (env vars instead of DB), types.ts changes, server action counts (41 total)
- `docs/evolution/agents/overview.md` — updated gating description (2-tier instead of 3), CritiqueBatch utility, type colocation (4 types, not 5)
- `docs/evolution/strategy_experiments.md` — updated experiment/ location
- `docs/evolution/visualization.md` — shared UI component patterns (DimensionScoresDisplay, useExpandedId)

### Phase 3
- `docs/evolution/cost_optimization.md` — simplified budget model
- `docs/evolution/reference.md` — config params section updated (hardcoded defaults)
- `docs/evolution/data_model.md` — if budget schema changes
- `docs/evolution/architecture.md` — unified gating, single pipeline mode

### Docs potentially affected (check after each phase):
- `docs/evolution/README.md`
- `docs/evolution/visualization.md`
- `docs/evolution/hall_of_fame.md`
- `docs/evolution/agents/generation.md`
- `docs/evolution/agents/editing.md`
- `docs/evolution/agents/flow_critique.md`
- `docs/evolution/agents/support.md`
- `docs/evolution/agents/tree_search.md`

---

## Summary of Expected Impact

### Pipeline Core

| Metric | Before | After Phase 1 | After Phase 2 | After Phase 3 |
|--------|--------|--------------|--------------|--------------|
| pipeline.ts LOC | 1,363 | 1,363 | ~850 | ~780 |
| Dead code LOC | ~65 | 0 | 0 | 0 |
| Duplicated LOC | ~375 | ~90 | ~0 | ~0 |
| Config parameters | 134 | ~130 | ~25 | ~18 |
| Feature flags (DB) | 10 | 8 | 0 (3 env vars) | 0 |
| Agent gating tiers | 3 | 3 | 2 | 1 |
| Budget tracking LOC | ~200 | ~200 | ~200 | ~40 |

### Full System

| Layer | Files | LOC | Simplifiable LOC | Addressed In |
|-------|-------|-----|-----------------|-------------|
| Pipeline Core (evolution/) | 56 source | ~8,500-9,500 | 1,000-1,600 | All phases |
| UI Components (components/evolution/) | 39 | ~2,849 | 350-650 | Phase 2 (DimensionScoresDisplay, useExpandedId), Phase 3 (BudgetTab, conditional feature UI cleanup) |
| Server Actions (services/) | 5 | ~3,551 | 150-200 | Phase 2 (buildRunConfig, seed article, V1 compat) |
| Cron Jobs (api/cron/) | 2 | ~346 | 20-50 | Phase 1 (dead flags) |
| CLI Scripts (scripts/) | 4 | ~1,602 | 50-100 | Phase 1 (dead flags) |
| Tests (*.test.ts) | 63 | ~5,500-6,000 | 550-650 | All phases |
| Admin Pages (app/admin/) | 4 | ~1,738 | 100 | — |
| **Total** | **173+** | **~24,086-25,586** | **2,220-3,350** | |
