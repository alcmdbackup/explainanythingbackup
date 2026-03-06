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

1. Delete `evolution/src/lib/core/diversityTracker.ts` (PoolDiversityTracker, ~111 LOC) + its test
2. Delete duplicate scripts: `evolution/scripts/run-bank-comparison.ts` (~271 LOC), `evolution/scripts/add-to-bank.ts` (~176 LOC)
3. Remove deprecated type fields: `'batch'` from PipelineType union, `plateau` and `budgetCaps` from EvolutionRunConfig
4. Un-export internal helpers in `comparison.ts` (`flipWinner`, `makeCacheKey`, `aggregateWinners`) and `diffComparison.ts` (`parseDiffVerdict`, `buildDiffJudgePrompt`, `interpretDirectionReversal`)
5. Remove `diversityTracker` from `index.ts` re-exports

**Commit after phase. Run: lint, tsc, build, unit tests.**

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

1. Merge `persistCheckpoint()` and `persistCheckpointWithSupervisor()` into single function with optional supervisor parameter
2. Remove ComparisonCache serialization/restore from checkpoint (rebuild on resume, ~$0.01 cost)
3. Simplify `costTracker.restoreSpent()` to core logic only
4. Update `prepareResumedPipelineRun()` to skip cache restore

**Commit after phase. Run: lint, tsc, build, unit + integration tests (persistence, continuation tests).**

### Phase 5: Pipeline Dispatch Simplification (~200 LOC, ~4 hours)
Flatten the pipeline orchestration layer.

1. **Consolidate pipeline prep**: Merge `preparePipelineRun()` and `prepareResumedPipelineRun()` into single function accepting optional checkpoint data
2. **Simplify phase management in supervisor.ts**: Replace `_phaseLocked` + `_currentPhase` with single `_phase` field; inline phase detection into `beginIteration()`
3. **Merge resume/fresh paths in evolutionRunnerCore.ts**: Single code path with branching only at content resolution
4. **Flatten pipelineUtilities.ts**: Move invocation persistence functions into `persistence.ts`, inline diff metrics computation into pipeline loop

**Commit after phase. Run: lint, tsc, build, unit + integration tests (pipeline, runner core tests).**

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
- **After each phase**: Run `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run test` (unit)
- **After phases 4-5**: Run integration tests: `npm run test:integration -- --testPathPattern="evolution"`
- **After phase 6**: Run full test suite including E2E

### Tests to Modify
- `diversityTracker.test.ts` — Delete (dead code removal)
- `supervisor.test.ts` — Update imports to use agentConfiguration.ts
- `budgetRedistribution.test.ts` — Update imports, may simplify
- `agentToggle.test.ts` — Update imports
- `costEstimator.test.ts` — Verify isAgentActive consistency
- `persistence.test.ts` — Update for merged checkpoint function
- `persistence.continuation.test.ts` — Update for merged checkpoint
- `pipeline.test.ts` — Update for flattened dispatch
- All 13 agent tests — Update to use base class helpers

### New Tests to Add
- `agentConfiguration.test.ts` — Unit tests for `isAgentActive()`, `getActiveAgents()`, `toggleAgent()`, `validateAgentSelection()`
- Edge case: costEstimator now uses shared `isAgentActive()` — verify EXPANSION phase gate applies

### Manual Verification
- Run local CLI: `npx tsx evolution/scripts/run-evolution-local.ts --file evolution/docs/sample_content/filler_words.md --mock`
- Run full pipeline locally with `--full --iterations 3` to verify no regression
- Verify admin dashboard still loads (evolution page, optimization page, strategies page)

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
