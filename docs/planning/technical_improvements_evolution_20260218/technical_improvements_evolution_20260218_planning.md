# Technical Improvements Evolution Plan

## Background
Identify and implement technical improvements to the evolution pipeline, focusing on code simplification, robustness, and efficiency. The pipeline has grown to include 12 agents, extensive checkpoint/resume machinery, complex phase transitions, and multiple integration points. This project will systematically find and address opportunities for cleaner code, better error handling, reduced redundancy, and performance gains.

## Requirements (from GH Issue #475)
Look for opportunities to improve evolution pipeline technically - e.g. simplifying code, robustness, efficiency, etc

## Problem
The evolution pipeline (~11,500 LOC, 50+ source files) has accumulated dead code (234 LOC `adaptiveAllocation.ts` entirely unwired), duplicated patterns (BudgetExceededError re-throw loop appears in 5+ agents, metaFeedback extraction in 3, format validation guard in 6), and inconsistent error handling (some agents log failures while others silently skip, `markRunPaused` lacks the status guard that `markRunFailed` has). The local CLI bypasses validation and budget redistribution by reimplementing LLM client logic inline. Default model values diverge across 5 files.

## Options Considered

### Scope Decisions

**In scope** — changes that are mechanical, low-risk, and directly improve code quality:
- Dead code removal (files and inline)
- Stale documentation references
- Model default unification (single source of truth)
- Robustness fix for `markRunPaused` status guard
- Strategy constant deduplication
- Redundant `canExecute()` removal
- Confidence ladder deduplication within `pairwiseRanker.ts`

**Deferred** — higher risk or requiring separate projects:
- Legacy Elo naming in DB columns → requires DB migration (separate project)
- `run-evolution-local.ts` refactoring → 817 LOC, its own project
- V1/V2 run summary schema cleanup → requires migration path
- `serializeState` deep copy → no known bugs, premature
- `run2PassReversal` parallelization → needs perf benchmarks
- `getTopByRating` caching → pool is small, premature optimization
- `BudgetExceededError` re-throw extraction → touches 5+ agents, higher risk than reward for a helper
- `metaFeedback` extraction helper → only 3 occurrences, not worth abstracting
- FORMAT_RULES guard extraction → 6 agents, but each has slightly different post-validation logic
- `requiredCount` derivation from `REQUIRED_AGENTS.length` → singleArticle mode disables `generation` from required set (4→3), so simple `.length` won't work; adds complexity to a label function

### Approach
Prioritize by risk (lowest first) within 5 phases. Each phase produces a single commit with passing tests. Phases can be reviewed independently.

## Phased Execution Plan

### Phase 1: Dead Code Removal (~234+ LOC removed, zero risk)

| Item | File | Change |
|------|------|--------|
| 1a | `core/adaptiveAllocation.ts` | Delete entire file (234 LOC). Move `AgentROI` interface to `services/eloBudgetActions.ts` (its only consumer, via `import type`). Delete `core/adaptiveAllocation.test.ts` |
| 1b | ~~`core/pipeline.ts:556`~~ | **DROPPED**: The `throw new Error('Unreachable: ...')` at line 556 is a defensive guard after the `runAgent` retry for-loop. While currently unreachable, it catches future refactors that might break the loop's return/throw invariant. Keep it. |
| 1c | `core/pipeline.ts:30-31` | Remove unused `runId` parameter from `insertBaselineVariant` and eslint-disable comment on line 30 |
| 1d | `agents/pairwiseRanker.ts:11-12` | Remove deprecated `EVALUATION_DIMENSIONS` export and `@deprecated` comment |
| 1e | `agents/reflectionAgent.ts:9-10` | Remove deprecated `CRITIQUE_DIMENSIONS` export and `@deprecated` comment. **Also update** `reflectionAgent.test.ts:5,190-196` — remove the import and delete the test block that asserts on `CRITIQUE_DIMENSIONS` (it tests the deprecated export being removed). |

**Validated findings:**
- `index.ts` does NOT re-export `adaptiveAllocation` — no change needed there (original item 1f dropped)
- `PoolDiversityTracker` is re-exported from `index.ts` as public API — keep it (original item 1g dropped)
- `eloBudgetActions.ts:11` has `import type { AgentROI } from '@evolution/lib/core/adaptiveAllocation'` — must inline the 5-field interface before deleting the file
- **24 test call sites** for `insertBaselineVariant` need `runId` arg removed:
  - `pipeline.test.ts` (17 sites): lines 85, 98, 99, 107, 114, 133, 174, 186, 198, 214, 232, 254, 279, 815, 852, 904, 930
  - `hallOfFame.test.ts` (7 sites): lines 135, 184, 229, 281, 320, 359, 496

**Tests**: Delete `adaptiveAllocation.test.ts`. Update all 24 `insertBaselineVariant` calls. Run `npx tsc --noEmit`, `npm run lint`, `npm run test`.

### Phase 2: Documentation Fixes (zero risk)

| Item | File | Change |
|------|------|--------|
| 2a | `evolution/docs/evolution/reference.md:215` | Remove stale `ELO_CONSTANTS` and `K_SCHEDULE` from `config.ts` table row — these constants don't exist in current `config.ts` |
| 2b | `evolution/docs/evolution/agents/flow_critique.md:58` | Remove stale `featureFlags.ts` reference — file doesn't exist in evolution module |

**Validated findings:**
- `featureFlags.ts` reference is in `agents/flow_critique.md:58`, NOT in `reference.md` (corrected from original plan)
- Agent count is 12 in both `createDefaultAgents()` and docs — no update needed (original item 2c dropped)

**Tests**: None — documentation only.

### Phase 3: Single Source of Truth (low risk)

| Item | File | Change |
|------|------|--------|
| 3a | `core/strategyConfig.ts:144` | Replace hardcoded `'deepseek-chat'` → import `EVOLUTION_DEFAULT_MODEL` from `./llmClient` |
| 3b | `core/costEstimator.ts:148` | Replace hardcoded `'deepseek-chat'` → import `EVOLUTION_DEFAULT_MODEL` from `./llmClient` |
| 3c | `core/hallOfFameIntegration.ts:163` | Replace hardcoded `'deepseek-chat'` → import `EVOLUTION_DEFAULT_MODEL` from `./llmClient` (already imports from this file for `EVOLUTION_SYSTEM_USERID`) |
| 3d | `agents/generationAgent.ts:11-12` | Replace local `const STRATEGIES = [...]` and `type Strategy` with imports: `import { GENERATION_STRATEGIES, type GenerationStrategy } from '../core/supervisor'`. Update usages at lines 78, 105, 147 |

**Key constants:**
- `EVOLUTION_DEFAULT_MODEL = 'deepseek-chat'` at `core/llmClient.ts:12`
- `GENERATION_STRATEGIES` at `core/supervisor.ts:10-14` — exact same 3-element array as `generationAgent.ts:11`

**Tests**: Run `strategyConfig.test.ts`, `costEstimator.test.ts`, `hallOfFameIntegration.test.ts`, `generationAgent.test.ts`. Values are identical, just sourced from single location.

### Phase 4: Robustness Fix (low-medium risk)

| Item | File | Change |
|------|------|--------|
| 4a | `core/persistence.ts:107-112` | Add `.in('status', [...])` guard to `markRunPaused` matching `markRunFailed`'s pattern |

**Current** `markRunPaused` (no guard):
```typescript
export async function markRunPaused(runId: string, error: BudgetExceededError): Promise<void> {
  const supabase = await createSupabaseServiceClient();
  await supabase.from('evolution_runs').update({
    status: 'paused',
    error_message: error.message,
  }).eq('id', runId);
}
```

**Target** (with guard):
```typescript
export async function markRunPaused(runId: string, error: BudgetExceededError): Promise<void> {
  const supabase = await createSupabaseServiceClient();
  await supabase.from('evolution_runs').update({
    status: 'paused',
    error_message: error.message,
  }).eq('id', runId).in('status', ['pending', 'claimed', 'running', 'continuation_pending']);
}
```

**Tests**: Add unit test to `persistence.test.ts` verifying `markRunPaused` does not update when status is `completed` or `failed`. Model after existing `markRunFailed` guard tests.

### Phase 5: Redundancy Cleanup (low-medium risk)

| Item | File | Change |
|------|------|--------|
| 5a | `agents/calibrationRanker.ts:99` | Remove redundant `if (!this.canExecute(state))` guard inside `execute()` |
| 5b | `agents/pairwiseRanker.ts:312` | Same — remove redundant `canExecute()` guard |
| 5c | `agents/tournament.ts:211` | Same — remove redundant `canExecute()` guard |
| 5d | `agents/debateAgent.ts:194` | Same — remove redundant `canExecute()` guard |
| 5e | `agents/pairwiseRanker.ts:199-213 & 286-300` | Deduplicate verbatim confidence ladder — extract to local `aggregateConfidence()` helper, call from both `compareQualityWithBiasMitigation` and `compareFlowWithBiasMitigation` |

**Justification for 5a-5d**: `pipeline.ts` already calls `canExecute()` before `execute()` at both line 189 (`executeMinimalPipeline`) and line 489 (`runAgent` in `executeFullPipeline`). The in-agent checks are dead branches during normal pipeline operation.

**Tests**: Run `calibrationRanker.test.ts`, `pairwiseRanker.test.ts`, `tournament.test.ts`, `debateAgent.test.ts`, `pipeline.test.ts`.

## Files Modified (Summary)

| Phase | Files Modified | Files Deleted |
|-------|---------------|---------------|
| 1 | `pipeline.ts`, `pairwiseRanker.ts`, `reflectionAgent.ts`, `eloBudgetActions.ts`, `pipeline.test.ts`, `hallOfFame.test.ts` | `adaptiveAllocation.ts`, `adaptiveAllocation.test.ts` |
| 2 | `reference.md`, `flow_critique.md` | — |
| 3 | `strategyConfig.ts`, `costEstimator.ts`, `hallOfFameIntegration.ts`, `generationAgent.ts` | — |
| 4 | `persistence.ts`, `persistence.test.ts` | — |
| 5 | `calibrationRanker.ts`, `pairwiseRanker.ts`, `tournament.ts`, `debateAgent.ts` | — |

## Testing

### Strategy
- Each phase gets its own commit with `npm run test` passing before moving to next phase
- Phases 1-3 are purely mechanical — existing tests validate correctness
- Phase 4 adds a new test for the guard
- Phase 5 relies on existing agent and pipeline tests
- Run `npx tsc --noEmit` after each phase to catch type errors
- Run `npm run lint` after each phase

### Test Files Most Likely Affected
- `core/adaptiveAllocation.test.ts` (deleted in Phase 1)
- `core/pipeline.test.ts` (insertBaselineVariant signature change — 17 call sites)
- `core/hallOfFame.test.ts` (insertBaselineVariant signature change — 7 call sites)
- `core/persistence.test.ts` (new markRunPaused test in Phase 4)

### Verification (End-to-End)
After all phases (1-5 original + 6-14 Round 3):
```bash
cd evolution
npx tsc --noEmit          # Type checking
npm run lint              # Linting
npm run test              # Full test suite (75 test files)
```

### Integration Test Step
After completing all phases, run a local evolution dry-run to verify end-to-end behavior:
```bash
# Quick smoke test: single iteration with mock LLM
npm run test -- --testPathPattern='pipeline.test' --verbose
# If integration test suite exists:
npm run test:integration 2>/dev/null || echo "No integration suite — rely on unit tests"
```

### Rollback Strategy
Each phase is committed independently, so rollback is straightforward:
- **Per-phase rollback**: `git revert <commit-hash>` for any single phase
- **Ordering constraint**: Phases 1-5 and 6-14 are independent groups. Within each group, phases can be reverted in reverse order without conflicts.
- **Phase 12 (AgentName move)** is the highest-risk phase — if circular dependency issues arise during implementation, revert 12a-12m as a unit.
- **Phase 9a (meta_review rename)** affects DB data — if reverted after deployment, new rows will have `'metaReview'` while the code expects `'meta_review'`. Mitigate by ensuring queries do not filter on agent name string, or by using `IN ('meta_review', 'metaReview')` in any such query.
- **No-revert scenario**: If a phase is deployed and causes issues, prefer a forward-fix commit over revert to avoid rebasing conflicts with later phases.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/reference.md` - Fix stale constants in config table (Phase 2)
- `evolution/docs/evolution/agents/flow_critique.md` - Fix stale featureFlags.ts reference (Phase 2)
- `evolution/docs/evolution/architecture.md` - Check for adaptiveAllocation mention after Phase 1
- `evolution/docs/evolution/cost_optimization.md` - Verify model default references after Phase 3

---

## Round 3 Improvements (Categories 13-18)

Prioritized by **impact × feasibility**. Lower phase number = higher priority. Each phase is independently committable with passing tests.

### Phase 6: Performance — Parallelize `run2PassReversal` (HIGH impact, low risk)

The single highest-impact fix in the pipeline. Calibration comparisons run forward+reverse LLM calls sequentially when they are independent.

| Item | File | Change |
|------|------|--------|
| 6a | `core/reversalComparison.ts:26-38` | Change sequential `await callLLM(forward)` then `await callLLM(reverse)` to `Promise.all([callLLM(forward), callLLM(reverse)])`. Return parsed results from both. |

**Context**: `pairwiseRanker.ts:185` already parallelizes the same pattern correctly. This fix aligns `reversalComparison.ts` (used by `calibrationRanker`) with the existing parallel pattern.

**Tests**: Run `reversalComparison.test.ts`, `comparisonCache.test.ts`, `calibrationRanker.test.ts`. **Note on test ordering**: `reversalComparison.test.ts` uses `toHaveBeenNthCalledWith(1, ...)` and `(2, ...)` to assert call order. With `Promise.all`, both LLM calls are initiated synchronously in array order before either resolves — Jest tracks invocation order (not resolution order), so `nthCalledWith` assertions are preserved. `mockResolvedValueOnce` chaining also works correctly because both promises consume mocks in creation order. Existing tests should pass without modification.

### Phase 7: Correctness — Post-Resume State Validation (medium impact, low risk)

`validateStateContracts()` exists but is never called after deserializing a checkpoint. A malformed checkpoint silently propagates corrupt state.

| Item | File | Change |
|------|------|--------|
| 7a | `core/validation.ts` | Add `validateStateIntegrity(state: PipelineState): string[]` — a **phase-independent** validation that checks only structural invariants (pool/poolIds consistency, parent ID integrity, ratings keys ⊆ poolIds). Does NOT check phase-dependent contracts (those require `AgentStepPhase` which is not available at resume time). |
| 7b | `core/persistence.ts:181` | After `deserializeState(snapshot)`, call `validateStateIntegrity(state)`. If violations are non-empty, throw `CheckpointCorruptedError(runId, violations.join('; '))`. |

**Design note**: The existing `validateStateContracts(state, expectedPhase: AgentStepPhase)` requires a phase ordinal (0-5) that is not available in `loadCheckpointForResume`. The checkpoint stores `PipelinePhase` (EXPANSION/COMPETITION), not `AgentStepPhase`. Rather than attempting a lossy mapping, we create a separate phase-independent validator for the resume path. The full `validateStateContracts` remains available for per-iteration validation if wired in later.

**Tests**: Add test to `persistence.test.ts` verifying corrupt checkpoint (e.g., pool with variant whose id is not in poolIds) throws `CheckpointCorruptedError` on resume. **Create new file** `core/validation.test.ts` (does not exist yet) with unit tests for `validateStateIntegrity`: (1) valid state returns empty violations, (2) pool/poolIds mismatch detected, (3) orphan parent ID detected, (4) rating for unknown variant detected.

### Phase 8: Performance — Cache `getTopByRating` (medium impact, low risk)

Called 14+ times per iteration with identical data. Each call does O(n log n) sort + Map rebuild.

| Item | File | Change |
|------|------|--------|
| 8a | `core/state.ts` | Add private `_sortedCache: TextVariation[] | null = null`. Invalidate (set to `null`) in `addToPool()`, `startNewIteration()`, and any method that mutates `ratings`. |
| 8b | `core/state.ts:62-72` | In `getTopByRating(n)`, return from cache if valid, otherwise compute and cache. |
| 8c | `core/state.ts` | Add persistent `_idToVarMap: Map<string, TextVariation>` updated in `addToPool()` instead of rebuilding per call. |

**Tests**: Existing `state.test.ts` tests should pass. Add test verifying cache invalidation on `addToPool`.

### Phase 9: Naming & Type Fixes (low risk, quick wins)

| Item | File | Change |
|------|------|--------|
| 9a | `agents/metaReviewAgent.ts` | Change `name = 'meta_review'` → `name = 'metaReview'` (line 17). Also update `agentType: 'meta_review'` → `'metaReview'` at lines 23 and 82. (`detailType: 'metaReview'` at line 66 is already camelCase — no change.) |
| 9a-test | `agents/metaReviewAgent.test.ts:43` | Update assertion `expect(agent.name).toBe('meta_review')` → `toBe('metaReview')`. **Verification**: Grepped all test files for `'meta_review'` string — only this 1 assertion exists. The `agentType: 'meta_review'` return values at lines 23/82 are included in result objects but no test directly asserts the `agentType` string value. |
| 9b | ~~`core/metricsWriter.ts`~~ | **VERIFIED NO-OP**: `metricsWriter.ts` contains zero `'meta_review'` string literals (agent name is passed dynamically via the `name` property). No changes needed. |
| 9c | `core/pipeline.ts:13` | Replace `import { createAppSpan } from '../../../../instrumentation'` with a cleaner path. **Note**: `@/` maps to `./src/*` per tsconfig, so `@/instrumentation` won't work since `instrumentation.ts` is at the project root. Options: (a) add a `@root/*` alias to tsconfig pointing to project root, (b) keep the relative import as-is. **Decision**: Defer — the relative import works and adding a new tsconfig alias has blast radius across the project. |
| 9d | `core/llmClient.ts:44` | Remove dead `_clientId` parameter from `createEvolutionLLMClient`. Update **all 9 caller sites** to drop the first argument: **Evolution module**: `index.ts:178` (`inputs.llmClientId!`), `index.ts:244` (`inputs.llmClientId`), `evolutionActions.ts:569` (`'evolution-admin-seed'`), `llmClient.test.ts:71,102,120` (`'user1'`). **Next.js app**: `src/app/api/cron/evolution-runner/route.ts:154` (`'evolution-cron-seed'`), `src/__tests__/integration/evolution-pipeline.integration.test.ts:428` (`'test-staging'`), `src/app/api/cron/evolution-runner/route.test.ts:73` (mock definition with old arity). Note: the bare re-export at `index.ts:63` needs no change — the new signature propagates automatically. |
| 9e | `types.ts` | Add `SerializedCheckpoint` type that includes the 3 sidecar fields (`supervisorState`, `costTrackerTotalSpent`, `comparisonCacheEntries`). Use it in `persistence.ts:175` instead of the inline `as` cast. |

**Full blast radius for 9a**: The rename touches 4 source locations (metaReviewAgent.ts lines 17, 23, 82; plus metricsWriter.ts), 1 test assertion (metaReviewAgent.test.ts:43), and DB queries. Budget cap keys in `budgetRedistribution.ts:18` and `supervisor.ts:77` already use `'metaReview'` (camelCase) — no change needed there.

**DB query locations confirmed**: `evolutionVisualizationActions.ts` lines 1026 and 1091 filter with `.eq('agent_name', agentName)` on the `evolution_agent_invocations` table. After rename, old rows have `'meta_review'`, new rows have `'metaReview'`. **Mitigation**: Before executing 9a, grep `persistence.ts`, `metricsWriter.ts`, and `evolutionVisualizationActions.ts` for `agent_name` filtering. For the 2 confirmed sites (lines 1026, 1091), the `agentName` parameter comes from the client (originally read from existing DB rows), so old data fetches old name correctly. New runs will write `'metaReview'` — the UI will display them correctly when clicked. **Visualization impact**: Aggregations that group by `agent_name` (lines 384, 638, 651) will show `meta_review` and `metaReview` as separate agents. **Concrete mitigation**: After the rename, add a `normalizeAgentName()` helper to `evolutionVisualizationActions.ts` that maps `'meta_review'` → `'metaReview'` when grouping results. Apply it in the aggregation loops at lines 393 and 651. Alternatively, add a SQL `CASE WHEN agent_name = 'meta_review' THEN 'metaReview' ELSE agent_name END` alias in the `.select()` calls. Either approach is ~5 LOC. If neither is worth the effort, document this as a known cosmetic regression and defer.

**Tests**: Run full suite. For 9a, check `metaReviewAgent.test.ts` and `pipeline.test.ts`. Note: `metricsWriter.test.ts` exists but `metricsWriter.ts` has no `meta_review` string literals (agent name is passed dynamically) — no test changes needed there.

### Phase 10: Performance — Finalization & Tournament Micro-optimizations (low-medium risk)

| Item | File | Change |
|------|------|--------|
| 10a | `core/pipeline.ts:121-168` | In `finalizePipelineRun`, parallelize independent operations. **Parallel group** (no dependencies between them): `Promise.all([summaryUpdate, persistVariants, persistAgentMetrics, costBlock, linkStrategyConfig])` where `costBlock` is an async wrapper around the sequential read-then-persist pair (lines 147-160). **Sequential after**: `autoLinkPrompt` → `feedHallOfFame` (ordering invariant — prompt must be linked before hall-of-fame can reference it). The `run_summary` update (lines 134-142) is conditional on `validateRunSummary` returning non-null; wrap in a helper that returns early on null. |
| 10b | `agents/tournament.ts:88-108` | In `swissPairing`, precompute `ordinalMap: Map<string, number>` once before the inner loop instead of calling `getOrdinal()` per pair. |
| 10c | `agents/tournament.ts:140-146` | Hoist `getTopQuartileOrdinal` computation out of per-pair loop — compute once per round. |
| 10d | `agents/pairwiseRanker.ts:16-44` | Precompute `dimensionsList`, `instructionsList`, `responseTemplate` as module-level constants instead of rebuilding per call. |
| 10e | `core/comparisonCache.ts:17-21` | Add a private `textHashCache: Map<string, string>` (text content → SHA-256 hash) on `ComparisonCache`. In `makeKey(textA, textB, ...)`, check cache before computing SHA-256: `const hashA = this.textHashCache.get(textA) ?? this.computeAndCache(textA)`. This avoids re-hashing the same variant text on every comparison pair. Does NOT mutate `TextVariation` or the checkpoint serialization format. |

**Tests**: Existing tests cover all these paths. Run `tournament.test.ts`, `pairwiseRanker.test.ts`, `pipeline.test.ts`, `comparisonCache.test.ts`.

### Phase 11: Resilience — Bounded State Growth (medium risk)

| Item | File | Change |
|------|------|--------|
| 11a | `core/state.ts` | Add `MAX_MATCH_HISTORY = 5000` constant. In `serializeState`, if `matchHistory.length > MAX_MATCH_HISTORY`, serialize only the last N entries. Keep full in-memory for agents. |
| 11b | `core/comparisonCache.ts` | Add LRU eviction: when `cache.size > MAX_CACHE_SIZE` (e.g., 500), evict oldest entries. Add `createdAt` timestamp to `CachedMatch`. |
| 11c | `core/state.ts` | In `serializeState`, only serialize `allCritiques` from the last 5 iterations (not full history). Keep full in-memory. |

**Context**: `matchHistory` grows O(N² × iterations), serialized to checkpoint JSONB every iteration. For 20 variants × 20 iterations, this is 16K entries (3-8 MB per checkpoint). Pruning serialized form reduces DB pressure without affecting agent behavior.

**Tests**: Add tests for boundary conditions. Verify deserialized state works correctly with truncated history.

### Phase 12: Architecture — Move `AgentName` to `types.ts` (medium risk)

Root cause of circular `import type` chains between `types.ts` ↔ `pipeline.ts`. **Scope**: Move only `AgentName` to `types.ts`. Do NOT move `PipelineAgents` — it references `PipelineAgent` (the interface with `execute()`/`canExecute()`), which is defined in `pipeline.ts`. Moving `PipelineAgents` would re-introduce the circular dependency.

**Implementation**: Define `AgentName` in `types.ts` as the string literal union matching the 12 actual `PipelineAgents` keys (from `pipeline.ts:244-257`) plus `flowCritique`:
```typescript
export type AgentName =
  | 'generation' | 'calibration' | 'tournament' | 'evolution'
  | 'reflection' | 'iterativeEditing' | 'treeSearch' | 'sectionDecomposition'
  | 'debate' | 'proximity' | 'metaReview' | 'outlineGeneration'
  | 'flowCritique';
```
Remove `AgentName` from `pipeline.ts` and import it from `../types`.

| Item | File | Change |
|------|------|--------|
| 12a | `types.ts` | Add `AgentName` type as a string literal union (not derived from `keyof PipelineAgents` to avoid importing `PipelineAgents`). |
| 12b | `core/pipeline.ts` | Remove `AgentName` definition. Import `AgentName` from `../types`. Keep `PipelineAgents` in place. |
| 12c | `core/supervisor.ts:5` | Change `import type { AgentName } from './pipeline'` → `import type { AgentName } from '../types'`. |
| 12d | `core/budgetRedistribution.ts:4` | Same change. |
| 12e | `core/agentToggle.ts:4` | Same change. |
| 12f | `core/configValidation.ts:9` | Change `import type { AgentName } from './pipeline'` → `import type { AgentName } from '../types'`. |
| 12g | `core/strategyConfig.ts:9` | Same change. |
| 12h | `types.ts:8` | Change `import type { AgentName } from './core/pipeline'` → local definition (since `AgentName` is being moved here, remove the import and keep the definition). |
| 12i | `experiments/evolution/factorial.ts:4` | Change `import type { AgentName } from '@evolution/lib/core/pipeline'` → `import type { AgentName } from '@evolution/lib/types'`. |
| 12j | `services/evolutionActions.ts:316` | Change inline `import('@evolution/lib/core/pipeline').AgentName[]` → `import('@evolution/lib/types').AgentName[]`. |
| 12k | `src/app/admin/quality/strategies/strategyFormUtils.ts:5` | Change `import type { AgentName } from '@evolution/lib/core/pipeline'` → `import type { AgentName } from '@evolution/lib/types'`. |
| 12l | `src/app/admin/quality/strategies/page.tsx:33` | Same change. |
| 12m | `src/app/admin/quality/optimization/_components/StrategyConfigDisplay.tsx:9` | Same change. |

**Total**: 11 files reference `AgentName` from pipeline (8 in evolution module + 3 in Next.js app) — all must be updated. `npx tsc --noEmit` is the primary validation. Run full test suite.

### Phase 13: Observability — Populate `duration_ms` (low risk)

The `evolution_run_logs.duration_ms` column exists but is always NULL.

| Item | File | Change |
|------|------|--------|
| 13a | `core/pipeline.ts:498-520` | Record `Date.now()` before agent `execute()`, compute delta after, pass `durationMs` in the `logger.info('Agent completed', { durationMs, ... })` call. |

**Tests**: Verify in `pipeline.test.ts` that agent completion log includes `durationMs` > 0.

### Phase 14: DX — Consistent Agent Early-Exit Semantics (low risk)

Agents use `skipped: true` vs `success: false` inconsistently for "nothing to do" conditions.

| Item | File | Change |
|------|------|--------|
| 14a | `agents/reflectionAgent.ts:69` | Change `{ success: false, error: 'No variants to critique' }` to `{ success: true, skipped: true, reason: 'No variants to critique' }` for "pool too small" precondition. |
| 14b | `agents/generationAgent.ts:68` | Change `{ success: false, error: 'No originalText in state' }` to `{ success: true, skipped: true, reason: 'No originalText in state' }` for missing-input precondition. |
| 14c | Document the convention: `skipped: true` = preconditions not met (normal), `success: false` = execution attempted but failed (abnormal). |

**Important**: `generationAgent.ts:135` (`{ success: false, error: 'All strategies failed' }`) is NOT a precondition — it's an actual execution failure. Do NOT change it.

**Downstream impact**: `pipeline.ts:508` records `success: result.success ? 1 : 0` in OTel span attributes. After this change, skipped agents will report `success: 1` instead of `success: 0` in telemetry — this is correct behavior since skipping is not a failure.

**Test assertions to update** (2 sites — precondition skips only):
- `reflectionAgent.test.ts:110` ("returns failure when pool is empty") — `expect(result.success).toBe(false)` → `toBe(true)` + add `expect(result.skipped).toBe(true)`
- `generationAgent.test.ts:87` ("fails when no originalText in state") — `expect(result.success).toBe(false)` → `toBe(true)` + add `expect(result.skipped).toBe(true)`

**DO NOT change these sites** (actual execution failures, not precondition skips):
- `reflectionAgent.test.ts:80` ("handles malformed JSON gracefully") — `success: false` is correct (LLM returned unparseable output)
- `generationAgent.test.ts:64` ("skips variants that fail format validation") — `success: false` is correct (all strategies produced invalid output)

---

## Deferred Items (require separate projects)

These findings from Round 3 are valuable but out of scope for this project:

| Finding | Category | Why Deferred |
|---------|----------|-------------|
| Supabase DI (7 files hardcode `createSupabaseServiceClient`) | Cat 14 | Major refactor — needs interface extraction, all tests updated |
| Barrel file split (`index.ts` factory logic → `factory.ts`) | Cat 14 | Import path changes across all consumers |
| `PipelineState` read-only view | Cat 14 | Interface segregation — touches all agent type signatures |
| Prompt versioning / registry | Cat 15 | New feature, not a refactor |
| Dynamic model fallback on failures | Cat 15 | New feature |
| Differential checkpoint serialization | Cat 17 | Complex — needs migration of existing checkpoints |
| Checkpoint replay CLI for debugging | Cat 18 | New tool, not a refactor |
| `evolution_variants` written during run (not just finalize) | Cat 16 | Changes data model semantics |
| Two separate logging formats (production vs CLI) | Cat 18 | Would require shared logger abstraction |
| `run-evolution-local.ts` silent `--iterations` adjustment | Cat 18 | Part of the larger CLI refactor (deferred from original plan) |
