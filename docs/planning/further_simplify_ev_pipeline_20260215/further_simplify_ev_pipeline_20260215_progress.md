# Further Simplify Evolution Pipeline Progress

## Phase 1: Add getActiveAgents() + promote flowCritique
### Work Done
- **1a:** Extended `AgentName` type to include `'flowCritique'` (pipeline.ts)
- **1b:** Added `'flowCritique'` to `OPTIONAL_AGENTS` and `AGENT_DEPENDENCIES` (budgetRedistribution.ts)
- **1c:** Created `getActiveAgents()` function with `AGENT_EXECUTION_ORDER`, `EXPANSION_ALLOWED`, `SINGLE_ARTICLE_EXCLUDED` constants, and `ExecutableAgent` type (supervisor.ts)
- **1d:** Updated budgetRedistribution tests: flowCritique is now managed (not unmanaged), schema accepts it, agent count 12→13, added dependency tests
- **1e:** Added 10 unit tests for `getActiveAgents()` covering EXPANSION/COMPETITION, singleArticle, enabledAgents, flowCritique gating, ranking sentinel, ordering

### Issues Encountered
- Hook enforcement required symlink from `docs/planning/feat/further_simplify_ev_pipeline_20260215/` → existing folder (branch has `feat/` prefix but planning folder doesn't)

### Test Results
- tsc: clean compile
- 91 tests pass (budgetRedistribution + supervisor)
- 1450 total evolution tests pass

## Phase 2: Remove MUTEX_AGENTS
### Work Done
- Deleted `MUTEX_AGENTS` from `budgetRedistribution.ts`
- Removed mutex check from `validateAgentSelection()`
- Removed mutex enforcement from `agentToggle.ts`
- Removed `MUTEX_AGENTS` from `index.ts` re-exports
- Updated tests: mutex tests → coexistence tests in budgetRedistribution.test.ts, agentToggle.test.ts, configValidation.test.ts

### Test Results
- 76 tests pass (budgetRedistribution + agentToggle + configValidation)
- Commit: `4629c348`

## Phase 3: Delete featureFlags + simplify dispatch
### Work Done
- **3a:** Deleted `featureFlags.ts` and `featureFlags.test.ts`
- **3b:** Removed `featureFlags` from `ExecutionContext` (types.ts), `SupervisorConfig` (supervisor.ts), `FullPipelineOptions` (pipeline.ts), `index.ts` re-exports
- **3c:** Removed `getFeatureFlags()` from all 4 entry points: evolutionActions.ts, route.ts, evolution-runner.ts, run-batch.ts
- **3d:** Simplified `PhaseConfig` from 12 booleans to `activeAgents: ExecutableAgent[]`. Rewrote `getExpansionConfig()`/`getCompetitionConfig()` to call `getActiveAgents()`. Removed `isEnabled()` method.
- **3e:** Rewrote pipeline.ts dispatch: replaced individual if-blocks + `runGatedAgents()` with single loop over `config.activeAgents`. Handles `'ranking'` sentinel and `'flowCritique'` inline function as special cases.
- **3f:** Migrated tournament.ts: `ctx.featureFlags?.flowCritiqueEnabled` → `ctx.payload.config.enabledAgents?.includes('flowCritique')`
- **3g:** Updated 8 test files: pipeline.test.ts (removed featureFlags from options + ctx), supervisor.test.ts (boolean → activeAgents assertions), hallOfFame.test.ts, tournament.test.ts (enabledAgents in config), evolutionActions.test.ts, route.test.ts, evolution-agent-selection.integration.test.ts, evolution-infrastructure.integration.test.ts (deleted Feature flags describe block)

### Stats
- 19 files changed, 147 additions, 466 deletions (net -319 lines)
- Commit: `01790073`

### Test Results
- tsc: clean compile
- 1692 evolution tests pass, 101 suites

## Phase 4: UI + cleanup
### Work Done
- **4a:** Added `flowCritique: 'Flow Critique'` to `AGENT_LABELS` in strategies/page.tsx (StrategyConfigDisplay already had it)
- **4c:** Updated `docs/evolution/architecture.md` and `docs/evolution/reference.md` — removed env-var feature flag references, documented 2-layer gating model
- No `.env` references found to clean up

### Test Results
- tsc: clean compile, lint clean, 1692 tests pass
- Commit: `70144818`
