# Simplify Evolution Plan

## Background
The evolution pipeline has grown complex with many agents, abstractions, and data model layers. This project aims to comprehensively simplify both the evolution data model and pipeline code, removing unused abstractions, streamlining the schema, reducing code complexity, and removing unused agents or features to make the system more maintainable.

## Requirements (from GH Issue #635)
- Research the evolution codebase to identify simplification opportunities
- Identify unused or underutilized agents, features, and abstractions
- Identify data model simplifications (unused tables, columns, overly complex schemas)
- Identify code simplifications (dead code, unnecessary abstractions, over-engineering)
- Propose concrete deletions and simplifications with risk assessment
- Execute the simplification plan incrementally

## Problem
The evolution pipeline is ~62,700 LOC across 233 files with 13 agents, 69 server actions, 77 components, and 85 DB migrations. Five rounds of research with 20 parallel agents identified ~3,000-4,000 production LOC and ~5,000 test LOC of consolidation opportunities. The complexity stems from duplicated agent boilerplate (same patterns repeated across 13 agents), over-extracted pipeline orchestration (3 checkpoint functions doing the same thing, fragmented agent selection across 3 files), server action/component/query duplication, and confirmed dead code. None of this complexity serves a functional purpose — it's accumulated technical debt from iterative development.

## Options Considered

### Option A: Surgical Cleanup Only (Dead Code + Duplicates)
- Delete confirmed dead code, duplicate scripts, deprecated fields
- ~600 LOC savings, 1-2 days effort
- **Pro:** Zero risk, fast
- **Con:** Doesn't address structural complexity

### Option B: Consolidation-First (Agent + Pipeline + Selection)
- Option A + agent base class helpers + pipeline simplification + agent selection unification
- ~2,000 LOC savings, 5-7 days effort
- **Pro:** Addresses the largest sources of complexity
- **Con:** Higher risk, touches core pipeline

### Option C: Full Simplification (All Categories)
- Option B + server action consolidation + component consolidation + query layer + test cleanup
- ~4,000+ production LOC + ~5,000 test LOC savings, 10-14 days effort
- **Pro:** Comprehensive cleanup
- **Con:** Very large scope, risk of regressions

### Recommended: Option B (Consolidation-First)
Focus on the highest-impact structural simplifications (agent boilerplate, pipeline orchestration, agent selection). Defer server action/component/test cleanup to a follow-up project. This delivers the most maintainability improvement per unit of risk.

## Phased Execution Plan

### Phase 1: Dead Code Deletion (~600 LOC, ~2 hours)
Safe deletions with zero functional impact.

1. Delete `evolution/src/lib/core/diversityTracker.ts` (PoolDiversityTracker, ~111 LOC) + its test file
2. Delete duplicate scripts AND their tests:
   - `evolution/scripts/run-bank-comparison.ts` (~271 LOC) + `evolution/scripts/run-bank-comparison.test.ts`
   - `evolution/scripts/add-to-bank.ts` (~176 LOC) + test if exists
3. Remove deprecated type fields from `evolution/src/lib/types.ts`:
   - Remove `plateau` and `budgetCaps` from EvolutionRunConfig (deprecated, ignored at runtime)
   - **Keep** `'batch'` in PipelineType for now — it may exist in DB CHECK constraints on `evolution_runs.pipeline_type` and `evolution_strategy_configs.pipeline_type`. Removing requires a migration to alter the CHECK constraint and audit for existing rows. Defer to a separate migration-focused cleanup.
   - Update any test fixtures that set `plateau` or `budgetCaps` (e.g., in `pipeline.test.ts`)
4. Un-export internal helper `aggregateWinners` in `comparison.ts` (make non-exported). Note: `flipWinner` and `makeCacheKey` are already non-exported.
   Un-export internal helpers in `diffComparison.ts`: `parseDiffVerdict`, `buildDiffJudgePrompt`, `interpretDirectionReversal` — move to file-local scope. Update `diffComparison.test.ts` if it imports these directly (test via the public `compareWithDiff()` API instead).
5. Remove from `index.ts` re-exports: `PoolDiversityTracker`, `DIVERSITY_THRESHOLDS`, `DiversityStatus` type

**Commit after phase. Run: lint, tsc, build, ALL unit tests (to catch any broken fixtures).**

### Phase 2: Agent Base Class Helpers (~460 LOC savings, ~3 hours)
Add shared methods to `AgentBase` to eliminate boilerplate across 13 agents.

1. Add to `AgentBase` (`agents/base.ts`):
   ```typescript
   protected skipResult(reason: string, ctx: ExecutionContext): AgentResult
   protected failResult(error: string, ctx: ExecutionContext): AgentResult
   protected successResult(ctx: ExecutionContext, opts?: { variantsAdded?: number; matchesPlayed?: number; executionDetail?: unknown }): AgentResult
   ```
2. Extract `rethrowBudgetErrors(results: PromiseSettledResult<unknown>[])` to `agents/agentUtils.ts`
3. Update all 13 agents to use these helpers (search-replace refactor)
4. Update agent tests to verify helper behavior

**Commit after phase. Run: lint, tsc, build, unit tests.**

### Phase 3: Agent Selection Consolidation (~40 net LOC, high maintainability impact, ~2 hours)
Unify fragmented agent selection logic into single source of truth.

1. Create `evolution/src/lib/core/agentConfiguration.ts` containing:
   - `REQUIRED_AGENTS`, `OPTIONAL_AGENTS`, `SINGLE_ARTICLE_DISABLED`, `EXPANSION_ALLOWED_AGENTS`
   - `AGENT_EXECUTION_ORDER`, `AGENT_DEPENDENCIES`
   - `isAgentActive(agentName, context)` — single filtering function
   - `getActiveAgents(enabledAgents, singleArticle, phase)` — ordered list
   - `validateAgentSelection(enabledAgents)` — dependency validation
   - `toggleAgent(current, agent)` — UI toggle with cascade
2. Update `supervisor.ts`: remove local constants, import from agentConfiguration
3. Update `budgetRedistribution.ts`: remove lists, re-export from agentConfiguration
4. Update `costEstimator.ts`: replace inline `isActive()` with shared `isAgentActive()`
5. Update `agentToggle.ts`: replace implementation with re-export
6. Fix name inconsistency: `SINGLE_ARTICLE_EXCLUDED` → use `SINGLE_ARTICLE_DISABLED` everywhere

**Commit after phase. Run: lint, tsc, build, unit tests (supervisor, budgetRedistribution, agentToggle, costEstimator tests).**

### Phase 4: Checkpoint/Resume Simplification (~80 LOC, ~2 hours)
Reduce checkpoint system complexity.

1. Merge `persistCheckpoint()` (in `evolution/src/lib/core/persistence.ts`, has retry loop with configurable maxRetries) and `persistCheckpointWithSupervisor()` (private function in `evolution/src/lib/core/pipeline.ts:682`, simpler try/catch) into a single function in `persistence.ts` with optional supervisor parameter. **Keep the retry logic** from `persistCheckpoint()` since checkpoints are critical for resume. The merged function signature: `persistCheckpoint(runId, state, logger, totalCost, comparisonCache?, supervisor?, maxRetries?)`.
2. Remove ComparisonCache serialization/restore from checkpoint (rebuild on resume, ~$0.01 cost). **Note:** Existing checkpoints with cache entries will be silently ignored on resume (no parsing error since cache is an optional field). Update `comparisonCache.test.ts` to remove or skip `fromEntries()` round-trip tests that test checkpoint restore behavior (keep unit tests for `fromEntries()` itself as it's still a valid API).
3. Simplify `costTracker.restoreSpent()` to core logic only
4. Update `prepareResumedPipelineRun()` in `evolution/src/lib/index.ts` to skip cache restore

**Commit after phase. Run: lint, tsc, build, unit tests + `npm run test:integration` (full integration suite to verify checkpoint/resume).**

### Phase 5: Pipeline Dispatch Simplification (~120 LOC, ~4 hours)
Simplify the pipeline orchestration layer. **Note:** `runAgent()` in `evolution/src/lib/core/pipeline.ts` (~95 LOC) is **kept intact** — it contains critical orchestration logic (retry with exponential backoff, invocation lifecycle, checkpoint-on-error, BudgetExceededError/LLMRefusalError handling, tracing spans) that cannot be safely inlined without replicating all that logic. The simplification targets the surrounding code, not `runAgent()` itself.

1. **Consolidate pipeline prep** in `evolution/src/lib/index.ts`: Merge `preparePipelineRun()` and `prepareResumedPipelineRun()` into single function accepting optional checkpoint data. Reduces ~40 LOC of overlap.
2. **Simplify phase management** in `evolution/src/lib/core/supervisor.ts`: Replace `_phaseLocked` + `_currentPhase` with single `_phase` field. **Phase locking is preserved**: once `_phase` transitions to `'COMPETITION'`, the `beginIteration()` method skips the EXPANSION→COMPETITION detection check entirely (equivalent to current lock behavior, just expressed as a simple conditional rather than a separate boolean flag).
3. **Merge resume/fresh paths** in `evolution/src/services/evolutionRunnerCore.ts`: Single code path with branching only at content resolution stage.
4. **Flatten pipelineUtilities.ts** (`evolution/src/lib/core/pipelineUtilities.ts`): Move invocation persistence functions (`createAgentInvocation`, `updateAgentInvocation`) into `evolution/src/lib/core/persistence.ts`, inline diff metrics computation into pipeline loop.

**Commit after phase. Run: lint, tsc, build, ALL unit tests + `npm run test:integration` (full integration suite).**

### Phase 6: Index.ts Cleanup (~80 LOC, ~1 hour)
Trim barrel exports and simplify public API.

1. Remove re-exports of functions/types that should be imported directly from their modules
2. Keep only top-level factory exports: `createDefaultAgents`, `preparePipelineRun`, `executeFullPipeline`, `executeMinimalPipeline`
3. Update import paths in consumers

**Commit after phase. Run: lint, tsc, build, full test suite.**

### Phase 7: Documentation Update (~2 hours)
Update all evolution docs to reflect simplified architecture.

1. Update docs listed in Documentation Updates section below
2. Remove references to deleted entities (PoolDiversityTracker, deprecated config fields, duplicate scripts)
3. Simplify checkpoint/resume description
4. Update agent selection docs to reference single `agentConfiguration.ts`
5. Update key files tables

## Testing

### Automated Tests
- **After each phase**: Run `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run test` (ALL unit tests — not filtered — to catch unexpected breakage from import changes or fixture updates)
- **After phases 4-5**: Run `npm run test:integration` (full integration suite — this runs all files under `src/__tests__/integration/` via `jest.integration.config.js`, which includes 8 evolution integration test files)
- **After phase 6**: Run full test suite including E2E: `npm run test:e2e -- --grep "admin-evolution"`

### Tests to Delete
| Phase | Test File | Reason |
|-------|-----------|--------|
| 1 | `evolution/src/lib/core/diversityTracker.test.ts` | Source deleted |
| 1 | `evolution/scripts/run-bank-comparison.test.ts` | Source deleted |

### Tests to Modify
| Phase | Test File | Change |
|-------|-----------|--------|
| 1 | `pipeline.test.ts` | Remove/update fixtures that set deprecated `plateau` or `budgetCaps` config fields |
| 1 | `diffComparison.test.ts` | Update to test un-exported helpers via public API (`compareWithDiff()`) instead of direct imports |
| 2 | All 13 agent test files (`generationAgent.test.ts`, etc.) | Update to use base class helpers |
| 3 | `supervisor.test.ts` | Update imports to use agentConfiguration.ts |
| 3 | `budgetRedistribution.test.ts` | Update imports, may simplify |
| 3 | `agentToggle.test.ts` | Update imports |
| 3 | `costEstimator.test.ts` | Verify isAgentActive consistency; test EXPANSION phase gate |
| 4 | `persistence.test.ts` | Update for merged checkpoint function |
| 4 | `persistence.continuation.test.ts` | Update for merged checkpoint |
| 4 | `comparisonCache.test.ts` | Remove/update `fromEntries()` round-trip tests that test checkpoint restore behavior; keep `fromEntries()` unit tests |
| 4 | `costTracker.test.ts` | Review `restoreSpent()` tests for simplified version |
| 5 | `pipeline.test.ts` | Update for flattened pipelineUtilities, supervisor phase simplification |
| 6 | Update any test that imports from `@evolution/lib` barrel — verify all needed exports remain. Key imports used by tests: `PipelineStateImpl`, `GenerationAgent`, `CalibrationRanker`, `BudgetExceededError`, `DEFAULT_EVOLUTION_CONFIG`, `PoolSupervisor`, `REQUIRED_AGENTS`, `OPTIONAL_AGENTS` — these MUST remain re-exported or tests updated to import from source modules |

### New Tests to Add
- `agentConfiguration.test.ts` — Unit tests for `isAgentActive()`, `getActiveAgents()`, `toggleAgent()`, `validateAgentSelection()`. Include edge case: costEstimator now uses shared `isAgentActive()` — verify EXPANSION phase gate applies to cost estimates.

### Manual Verification
- Run local CLI: `npx tsx evolution/scripts/run-evolution-local.ts --file evolution/docs/sample_content/filler_words.md --mock`
- Run full pipeline locally with `--full --iterations 3` to verify no regression
- Verify admin dashboard still loads (evolution page, optimization page, strategies page, arena page)
- Verify E2E specs: `admin-evolution.spec.ts`, `admin-evolution-visualization.spec.ts`, `admin-article-variant-detail.spec.ts`

## Rollback Plan

Each phase is committed separately, enabling surgical rollback:

- **Phase 1-3** (low risk): `git revert <commit>` — these are additive/deletive changes with no cross-phase dependencies
- **Phase 4-5** (medium risk): If integration tests fail after Phase 5, revert Phase 5 commit while keeping 1-4. Phase 5 does NOT depend on Phase 4 (they modify different functions in the same files, but each commit is self-contained). If both need reverting: `git revert <phase5> <phase4>` in reverse order.
- **Phase 6** (low risk): `git revert <commit>` — only changes import paths
- **Emergency rollback**: `git revert --no-commit HEAD~N..HEAD && git commit` to revert all phases at once

**Pre-execution safety**: Before starting Phase 4, create a git tag `pre-pipeline-simplification` so we have a clean rollback point before the medium-risk phases.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/data_model.md` - Remove PoolDiversityTracker references, deprecated config fields
- `evolution/docs/evolution/architecture.md` - Simplify checkpoint description, update agent dispatch flow
- `evolution/docs/evolution/README.md` - Update document map if files renamed/deleted
- `evolution/docs/evolution/reference.md` - Remove deprecated config fields, update key files table
- `evolution/docs/evolution/agents/overview.md` - Reference new agentConfiguration.ts for agent selection
- `evolution/docs/evolution/entity_diagram.md` - No changes expected
- `evolution/docs/evolution/rating_and_comparison.md` - No changes expected
- `evolution/docs/evolution/cost_optimization.md` - Update agent selection references

## Risk Assessment

| Phase | Risk | Mitigation |
|-------|------|------------|
| 1: Dead code | Very low | Only deleting confirmed unused code |
| 2: Agent helpers | Low | Pure additions to base class; agents opt-in |
| 3: Agent selection | Low | Consolidation of existing logic; backward-compat re-exports |
| 4: Checkpoint | Medium | Changes persistence layer; integration tests cover |
| 5: Pipeline dispatch | Medium | Changes core orchestration; thorough testing required |
| 6: Index cleanup | Low | Only changing import paths |
| 7: Docs | None | Documentation only |

## Out of Scope (Future Projects)
- Server action boilerplate consolidation (69 actions, ~900 LOC)
- Component consolidation (StatusBadge, MetricCard, etc., ~870 LOC)
- Supabase query layer consolidation (~250 LOC)
- Test infrastructure consolidation (~5,400 LOC)
- Type system simplification (12 ExecutionDetail types → generic)
- Migration squashing
