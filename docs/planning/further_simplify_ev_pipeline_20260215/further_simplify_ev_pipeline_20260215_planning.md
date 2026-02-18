# Further Simplify Evolution Pipeline Plan

## Background
Help me simplify how my pipeline works since there are many agents and config options today. Explain to me how it works in simple terms also, given the number of variations.

## Requirements (from GH Issue #449)
Help me simplify how my pipeline works since there are many agents and config options today. Explain to me how it works in simple terms also, given the number of variations.

## Problem
The evolution pipeline currently decides whether an agent runs via 4 separate layers:
1. **PhaseConfig** — 12 `run*` booleans from `supervisor.getPhaseConfig()`
2. **Feature flags** — 3 env vars (`EVOLUTION_TREE_SEARCH`, etc.) read synchronously
3. **enabledAgents** — strategy-level agent selection (DB-stored)
4. **canExecute()** — per-agent runtime data guard

Layers 1-3 all answer "should this agent run?" but in 3 different places. This makes it hard to reason about which agents will run for a given configuration, and adding a new agent requires touching 3 separate files.

Additionally, TreeSearch and IterativeEditing are artificially mutually exclusive (no principled conflict — they're complementary exploit+explore strategies), and flowCritique is hidden behind an env var nobody sets in production.

## Options Considered

**Option A: Fold feature flags into enabledAgents only**
- Remove env vars, make all agents configurable per strategy
- Leaves PhaseConfig 12 booleans intact
- Partial simplification

**Option B: Replace PhaseConfig booleans with agent list only**
- supervisor returns `activeAgents: AgentName[]` instead of 12 booleans
- Leaves feature flags intact
- Partial simplification

**Option C (chosen): Both A+B — collapse to 2 layers**
- Delete feature flags entirely
- Replace PhaseConfig booleans with `getActiveAgents()` function
- Remove TreeSearch/IterativeEditing mutex
- Promote flowCritique to standard `enabledAgents` toggle
- Result: only `getActiveAgents()` + `canExecute()` remain

## Phased Execution Plan

### Phase 1: Add `getActiveAgents()` + promote flowCritique (additive, no breakage)

#### 1a. Extend AgentName type for flowCritique
**File:** `src/lib/evolution/core/pipeline.ts`
- `AgentName` is currently `keyof PipelineAgents`. flowCritique is not a PipelineAgent (it's an inline function), so change to:
  ```typescript
  export type AgentName = keyof PipelineAgents | 'flowCritique';
  ```

#### 1b. Add flowCritique to agent classification and dependencies
**File:** `src/lib/evolution/core/budgetRedistribution.ts`
- Add `'flowCritique'` to `OPTIONAL_AGENTS`
- `enabledAgentsSchema` already uses `OPTIONAL_AGENTS`, so it auto-includes flowCritique
- Add dependency: `flowCritique: ['reflection']` to `AGENT_DEPENDENCIES` (preserves current gating where flowCritique only runs when reflection runs)
- **Budget note:** flowCritique is currently "unmanaged" in `MANAGED_AGENTS` (passes through `computeEffectiveBudgetCaps` unchanged). Adding it to `OPTIONAL_AGENTS` makes it "managed" — subject to proportional scaling and removal when not in `enabledAgents`. This is the **desired behavior** for the new system (flowCritique should be disabled when not in enabledAgents). Update existing tests that assert flowCritique is unmanaged (lines 43-46, 71-72, 96-99, 114-116 of budgetRedistribution.test.ts)

#### 1c. Create `getActiveAgents()`
**File:** `src/lib/evolution/core/supervisor.ts`
```typescript
/**
 * Canonical execution order. Uses 'ranking' sentinel instead of separate
 * calibration/tournament entries — the pipeline dispatch swaps the actual
 * agent by phase (calibration in EXPANSION, tournament in COMPETITION).
 */
const AGENT_EXECUTION_ORDER: (AgentName | 'ranking')[] = [
  'generation', 'outlineGeneration', 'reflection', 'flowCritique',
  'iterativeEditing', 'treeSearch', 'sectionDecomposition',
  'debate', 'evolution',
  'ranking',          // dispatches as calibration (EXPANSION) or tournament (COMPETITION)
  'proximity', 'metaReview',
];

const EXPANSION_ALLOWED: Set<AgentName | 'ranking'> = new Set([
  'generation', 'ranking', 'proximity',
]);

const SINGLE_ARTICLE_EXCLUDED: Set<AgentName> = new Set([
  'generation', 'outlineGeneration', 'evolution',
]);

export function getActiveAgents(
  phase: PipelinePhase,
  enabledAgents: AgentName[] | undefined,
  singleArticle: boolean,
): ExecutableAgent[] {
  const enabledSet = enabledAgents ? new Set(enabledAgents) : null;
  return AGENT_EXECUTION_ORDER.filter(name => {
    if (name === 'ranking') return true;  // always included — pipeline swaps by phase
    if (phase === 'EXPANSION' && !EXPANSION_ALLOWED.has(name)) return false;
    if (singleArticle && SINGLE_ARTICLE_EXCLUDED.has(name)) return false;
    if (REQUIRED_AGENTS.includes(name as AgentName)) return true;
    return !enabledSet || enabledSet.has(name as AgentName);
  });
}
```

#### 1d. Update budgetRedistribution tests for flowCritique promotion
**File:** `src/lib/evolution/core/budgetRedistribution.test.ts`
- Update tests that assert flowCritique is "unmanaged" (lines 43-46, 71-72, 96-99, 114-116) — flowCritique is now managed
- Update/remove test at line 192 that asserts `enabledAgentsSchema.safeParse(['flowCritique'])` is rejected — it's now valid
- Update "agent classification constants" test (lines 204-208): `all.size` changes from 12 to 13 after adding flowCritique
- Add test: flowCritique excluded from budget when not in enabledAgents
- Add test: flowCritique dependency on reflection validated by `validateAgentSelection()`

#### 1e. Unit tests for `getActiveAgents()`
**File:** `src/lib/evolution/core/supervisor.test.ts` (new describe block)
- EXPANSION returns only generation, ranking, proximity
- COMPETITION returns all enabled agents in correct order
- singleArticle excludes generation, outlineGeneration, evolution
- Required agents always present regardless of enabledAgents
- undefined enabledAgents = all optional agents
- flowCritique included when in enabledAgents during COMPETITION
- flowCritique excluded during EXPANSION (not in EXPANSION_ALLOWED)
- 'ranking' sentinel always present in both phases
- Order matches AGENT_EXECUTION_ORDER

**Commit:** `feat: add getActiveAgents() for unified agent selection`

---

### Phase 2: Remove MUTEX_AGENTS

#### 2a. budgetRedistribution.ts
- Delete `MUTEX_AGENTS` export (line 45-47)
- Remove mutex check from `validateAgentSelection()` (lines 155-159)

#### 2b. agentToggle.ts
- Remove `MUTEX_AGENTS` import
- Remove mutex enforcement block (lines 34-38)

#### 2c. index.ts
- Remove `MUTEX_AGENTS` from re-exports (line 94)

#### 2d. Update tests
- `budgetRedistribution.test.ts` — remove mutex error test, update multi-error test
- `agentToggle.test.ts` — remove mutex enforcement tests (lines 82-96)
- `configValidation.test.ts` — remove "errors on agent mutex violation" test (lines 114-124) which calls `validateStrategyConfig` and asserts mutex errors

**Commit:** `refactor: remove MUTEX_AGENTS — treeSearch and iterativeEditing can coexist`

---

### Phase 3: Delete featureFlags.ts + simplify dispatch (combined to avoid flowCritique gap)

Phases 3 and 4 from original brainstorm combined in one commit so flowCritique transitions directly from env-var gating to enabledAgents gating with no gap.

#### 3a. Delete files
- Delete `src/lib/evolution/core/featureFlags.ts`
- Delete `src/lib/evolution/core/featureFlags.test.ts`

#### 3b. Remove featureFlags from types and interfaces
- `types.ts` — remove `featureFlags` field from `ExecutionContext`
- `supervisor.ts` — remove `featureFlags` from `SupervisorConfig`, remove param from `supervisorConfigFromRunConfig()`
- `pipeline.ts` — remove `featureFlags` from `FullPipelineOptions`, remove `GatedAgentEntry.flagKey`, remove flagKey checks in `runGatedAgents()`
- `index.ts` — remove `getFeatureFlags`, `DEFAULT_EVOLUTION_FLAGS`, `EvolutionFeatureFlags` exports

#### 3c. Remove featureFlags from entry points
- `evolutionActions.ts` — remove `getFeatureFlags()` call and passing
- `route.ts` (cron) — remove `getFeatureFlags()` call and passing
- `evolution-runner.ts` (batch) — remove `getFeatureFlags()` call and passing
- `scripts/run-batch.ts` — remove `getFeatureFlags()` import (lines 155-156) and `featureFlags` passing (line 168)

#### 3d. Simplify PhaseConfig
**File:** `supervisor.ts`
```typescript
/** Agents or sentinels that can appear in the active list. */
export type ExecutableAgent = AgentName | 'ranking';

export interface PhaseConfig {
  phase: PipelinePhase;
  activeAgents: ExecutableAgent[];
  generationPayload: { strategies: string[] };
  calibrationPayload: { opponentsPerEntrant: number };
}
```
Note: `'ranking'` is a dispatch sentinel — calibration/tournament remain in `REQUIRED_AGENTS` for budget redistribution but are absent from `AGENT_EXECUTION_ORDER` since `'ranking'` handles them.
- `getExpansionConfig()` and `getCompetitionConfig()` call `getActiveAgents()` instead of setting 12 booleans
- Remove private `isEnabled()` method

#### 3e. Rewrite pipeline.ts dispatch
Replace individual if-blocks + `runGatedAgents()` with a loop:
```typescript
const config = supervisor.getPhaseConfig(ctx.state);

for (const agentName of config.activeAgents) {
  // flowCritique: inline function, not a PipelineAgent.
  // MUST preserve dual-path error handling from current pipeline.ts:456-473:
  //   - BudgetExceededError → markRunPaused(runId, error) then rethrow (run is resumable)
  //   - All other errors → log as non-fatal warning, continue pipeline
  if (agentName === 'flowCritique') {
    try {
      const flowResult = await runFlowCritiques(ctx, logger);
      logger.info('Flow critique pass complete', { critiqued: flowResult.critiqued, costUsd: flowResult.costUsd });
      await persistCheckpoint(runId, ctx.state, 'flowCritique', phase, logger, 3, ctx.costTracker.getTotalSpent(), ctx.comparisonCache);
    } catch (error) {
      if (error instanceof BudgetExceededError) {
        logger.warn('Budget exceeded during flow critique', { error: error.message });
        await markRunPaused(runId, error);
        throw error;  // rethrow — pipeline stops, run is resumable
      }
      logger.warn('Flow critique pass failed (non-fatal)', { error: String(error) });
    }
    continue;
  }

  // 'ranking' sentinel — dispatches calibration (EXPANSION) or tournament (COMPETITION)
  if (agentName === 'ranking') {
    const rankingAgent = config.phase === 'COMPETITION' ? agents.tournament : agents.calibration;
    await runAgent(runId, rankingAgent, ctx, config.phase, logger, executionOrder++);
    continue;
  }

  const agent = agents[agentName as keyof PipelineAgents];
  if (agent) await runAgent(runId, agent, ctx, config.phase, logger, executionOrder++);
}
```
- Delete `GatedAgentEntry` interface
- Delete `runGatedAgents()` function

#### 3f. Migrate tournament.ts flowCritique gating
- Replace `ctx.featureFlags?.flowCritiqueEnabled === true` with:
  ```typescript
  ctx.payload.config.enabledAgents?.includes('flowCritique') ?? false
  ```
- Update `flowEnabled` in execution detail to use new source, or make `TournamentExecutionDetail.flowEnabled` optional in `types.ts` (existing DB records still have the field)

#### 3g. Update all tests
- `pipeline.test.ts` (25 featureFlags references):
  - Remove `DEFAULT_EVOLUTION_FLAGS` import and all `featureFlags: { ... }` in options (~15 occurrences)
  - Rewrite flow critique tests to use `enabledAgents: ['flowCritique', 'reflection', ...]`
  - Rewrite `ctx.featureFlags` propagation test (line 753) to test `enabledAgents` propagation instead
- `supervisor.test.ts` — rewrite existing PhaseConfig boolean assertions (`config.runReflection`, `config.runIterativeEditing`, etc.) to assert against `config.activeAgents` array contents instead
- `hallOfFame.test.ts` — remove `DEFAULT_EVOLUTION_FLAGS` import (line 12) and usage (line 481)
- `tournament.test.ts` — migrate `ctx.featureFlags` to `ctx.payload.config.enabledAgents`, update `detail.flowEnabled` assertion (line 479)
- `evolutionActions.test.ts` — remove `jest.mock('@/lib/evolution/core/featureFlags', ...)`
- `route.test.ts` — remove `jest.mock` for featureFlags and all `mockGetFeatureFlags` calls
- `evolution-infrastructure.integration.test.ts` — remove `getFeatureFlags, DEFAULT_EVOLUTION_FLAGS` imports AND delete entire `describe('Feature flags', ...)` block (lines 274-302)

**Commit:** `refactor: collapse 4-layer agent gating to 2 layers — delete featureFlags, simplify PhaseConfig`

---

### Phase 4: UI + cleanup

#### 4a. Strategy form UI
**File:** `src/app/admin/quality/strategies/page.tsx`
- Add `flowCritique: 'Flow Critique'` to `AGENT_LABELS`
- flowCritique auto-appears in agent toggles since UI iterates `OPTIONAL_AGENTS`
- treeSearch + iterativeEditing can now both be selected (mutex removed in Phase 2)

#### 4b. StrategyConfigDisplay
**File:** `src/app/admin/quality/optimization/_components/StrategyConfigDisplay.tsx`
- Add `flowCritique: 'Flow Critique'` to its `AGENT_LABELS`

#### 4c. Cleanup sweep
- Verify no remaining imports of deleted featureFlags.ts
- Remove env var references from `.env.example`, docs, deployment configs
- Run `tsc`, `jest`, `npm run build`

**Commit:** `feat: add flowCritique to strategy agent toggles, final cleanup`

---

## Files Changed

| File | Phase | Change |
|------|-------|--------|
| `src/lib/evolution/core/featureFlags.ts` | 3 | **DELETE** |
| `src/lib/evolution/core/featureFlags.test.ts` | 3 | **DELETE** |
| `src/lib/evolution/core/pipeline.ts` | 1,3 | Extend AgentName, rewrite dispatch loop |
| `src/lib/evolution/core/supervisor.ts` | 1,3 | Add getActiveAgents(), simplify PhaseConfig |
| `src/lib/evolution/core/budgetRedistribution.ts` | 1,2 | Add flowCritique to OPTIONAL_AGENTS + AGENT_DEPENDENCIES, remove MUTEX_AGENTS |
| `src/lib/evolution/core/agentToggle.ts` | 2 | Remove mutex enforcement |
| `src/lib/evolution/index.ts` | 2,3 | Remove MUTEX_AGENTS + featureFlags exports |
| `src/lib/evolution/types.ts` | 3 | Remove featureFlags from ExecutionContext, update TournamentExecutionDetail.flowEnabled |
| `src/lib/evolution/agents/tournament.ts` | 3 | Migrate flowCritique gating |
| `src/lib/services/evolutionActions.ts` | 3 | Remove getFeatureFlags call |
| `src/app/api/cron/evolution-runner/route.ts` | 3 | Remove getFeatureFlags call |
| `scripts/evolution-runner.ts` | 3 | Remove getFeatureFlags call |
| `scripts/run-batch.ts` | 3 | Remove getFeatureFlags call |
| `src/app/admin/quality/strategies/page.tsx` | 4 | Add flowCritique label |
| `src/app/admin/quality/optimization/_components/StrategyConfigDisplay.tsx` | 4 | Add flowCritique label |

**Tests updated:** pipeline.test.ts (25 refs), supervisor.test.ts (PhaseConfig rewrite + new getActiveAgents tests), budgetRedistribution.test.ts (flowCritique promotion + mutex removal), agentToggle.test.ts, hallOfFame.test.ts, tournament.test.ts, evolutionActions.test.ts, route.test.ts, evolution-infrastructure.integration.test.ts (full Feature flags describe block deletion)

## Testing

After each phase:
1. `npx tsc --noEmit 2>&1 | grep -v '^\.next/'` — clean compile
2. `npx jest --testPathPattern='evolution|evolutionActions|route' --passWithNoTests` — all tests pass
3. `npm run build` — production build succeeds

Final validation:
- Run full pipeline locally via `scripts/run-evolution-local.ts` with a test article
- Verify strategy form shows flowCritique toggle and allows treeSearch + iterativeEditing together
- Verify existing strategies (without flowCritique in enabledAgents) behave identically to before

## Rollback Plan

Each phase is independently committable. If a phase fails:
- **Phase 1 (additive):** `git revert` the commit — no production impact since getActiveAgents() is unused until Phase 3
- **Phase 2 (mutex removal):** `git revert` — mutex restored, no data affected
- **Phase 3 (largest):** `git revert` — restores featureFlags.ts, PhaseConfig, and dispatch. All entry points revert to loading env vars. No DB migration to roll back.
- **Phase 4 (UI):** `git revert` — UI labels revert

Phase 3 is the riskiest. If partial failure during execution: `git stash` and fix forward, or `git checkout .` to discard all changes.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/evolution/architecture.md` - Remove 4-layer gating description, document getActiveAgents()
- `docs/evolution/data_model.md` - Remove featureFlags references
- `docs/evolution/reference.md` - Remove EVOLUTION_* env vars, update config reference
- `docs/evolution/rating_and_comparison.md` - No changes expected
- `docs/evolution/cost_optimization.md` - No changes expected (budget redistribution unchanged)
- `docs/evolution/visualization.md` - No changes expected
- `docs/evolution/hall_of_fame.md` - No changes expected
- `docs/evolution/strategy_experiments.md` - Update agent selection docs, note mutex removal
