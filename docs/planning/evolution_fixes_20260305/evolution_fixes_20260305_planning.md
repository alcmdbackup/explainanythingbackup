# Evolution Fixes Plan

## Background
The evolution experiment system has several UX and architectural issues that reduce pipeline quality and usability. Budget should be set once at the experiment level rather than per-run, the "optimizing for" dropdown is unnecessary, experiment names shouldn't influence prompt names, strategy reuse needs confirmation, the model list is missing GPT-5 models, per-agent budgets should be eliminated, and runs should always exhaust their full budget rather than stopping early.

## Requirements (from GH Issue #627)
- [ ] Set budget for each per run once at experiment level - rather than for each run
- [ ] Get rid of "optimizing for" dropdown within experiment creation and eliminate anything associated to it
- [ ] Why does experiment name influence prompt name
- [ ] Confirm runs re-use strategies if they already exist
- [ ] List of available models available within experiment UI does NOT include GPT-5 models. Make sure we have canonical model set.
- [ ] Eliminate per agent budgets
- [ ] Make sure run always goes until full budget is exhausted
- [ ] Deprecate L8 factorial experiment system to simplify codebase

## Problem
The experiment system has accumulated complexity from the L8 factorial system and per-agent budget enforcement that doesn't improve outcomes. Budget is configured per-run instead of per-experiment, creating UX friction. The "optimizing for" dropdown is dead code — analysis always ranks by |eloEffect|. Experiment names leak into prompt titles, breaking arena matching. The model list is stale (missing GPT-5). Runs stop early due to plateau detection and low maxIterations, wasting allocated budget.

## Options Considered
1. **Incremental fixes** — Fix each issue independently in separate PRs. Rejected: too many small PRs for tightly coupled changes.
2. **Single PR with phased commits** — Group related changes into logical phases within one branch. **Selected**: allows atomic rollback while keeping changes testable.
3. **Rewrite experiment system** — Too risky, most of the system works fine. Only L8 needs removal.

## Phased Execution Plan

### Phase 1: Remove "optimizing for" dropdown (Req 2)
Lowest risk, no behavioral change. Pure removal.

**Files to change:**
- `src/app/admin/quality/optimization/_components/ExperimentForm.tsx` — Remove `target` state (line 38), remove dropdown (lines 185-198), hardcode `'elo'` in submit
- `src/app/admin/quality/optimization/experiment/[experimentId]/ExperimentOverviewCard.tsx` — Remove "Target" display (line 137)
- `evolution/src/services/experimentActions.ts` — Hardcode `optimization_target: 'elo'` in DB inserts, remove from function params
- `evolution/src/experiments/evolution/experimentReportPrompt.ts` — Remove optimization_target from report context
- `src/app/api/cron/experiment-driver/route.ts` — Remove optimization_target from SELECT (line 314)

**DB**: Column stays with default `'elo'`, no migration needed.

**Tests**: Update `ExperimentForm.test.tsx` (remove target assertion at line 195), `experiment-driver/route.test.ts` (remove optimization_target from fixtures/baseExperiment), `experimentReportPrompt.test.ts` (1 optimization_target ref), `admin-experiment-detail.spec.ts` (remove optimization_target from e2e seed). Remove `ExperimentRow` interface `optimization_target` field in route.ts.

### Phase 2: Add GPT-5 models to UI (Req 5)
Simple, no logic changes.

**Files to change:**
- `src/app/admin/quality/optimization/_components/runFormUtils.ts` — Add `gpt-5.2`, `gpt-5.2-pro`, `gpt-5-mini`, `gpt-5-nano` to MODEL_OPTIONS
- `src/app/admin/quality/arena/page.tsx` — Add GPT-5 models to generation model selector (lines 331-337)
- `src/app/admin/quality/arena/[topicId]/page.tsx` — Add gpt-5.2, gpt-5.2-pro to judge selector (lines 299-309)

**Consider**: Derive UI model lists from `allowedLLMModelSchema` to prevent future drift.

### Phase 3: Fix experiment name → prompt name (Req 3)
Stop embedding experiment name in explanation titles. Only fix the manual path — the L8 path is deleted in Phase 7.

**Files to change:**
- `evolution/src/services/experimentActions.ts`:
  - Line 698 (manual path only): Remove `[Exp: manual]` prefix, use clean prompt text as title
  - Skip line 237 (L8 path) — entire function deleted in Phase 7
- Remove explanation creation entirely from manual experiment path. Runs link to prompts via `prompt_id` FK.

### Phase 4: Budget at experiment level (Req 1)
Move budget from per-run to per-experiment.

**Files to change:**
- `src/app/admin/quality/optimization/_components/ExperimentForm.tsx`:
  - Add `budgetPerRun` state to setup step (alongside name/prompt)
  - Remove per-run budget slider from run config cards
  - Compute `totalBudget = budgetPerRun * runs.length`
  - Cap at MAX_RUN_BUDGET_USD per run, MAX_EXPERIMENT_BUDGET_USD total
- `src/app/admin/quality/optimization/_components/runFormUtils.ts`:
  - Remove `budgetCapUsd` from `RunFormState` and `DEFAULT_RUN_STATE`
  - Update `runFormToConfig()` to not include budget
- `evolution/src/services/experimentActions.ts`:
  - `addRunToExperimentAction()`: Accept budget from experiment level, not per-run
  - `createManualExperimentAction()`: Store experiment-level budget
- `src/app/admin/quality/optimization/experiment/[experimentId]/RunsTab.tsx` — Update per-run budget display
- `src/app/admin/quality/optimization/_components/ExperimentStatusCard.tsx` — Update budget progress bar

### Phase 5: Eliminate per-agent budgets (Req 6)
Remove per-agent enforcement, keep tracking.

**ATOMICITY CONSTRAINT**: Like Phase 6, these changes MUST be in a single commit. `configValidation.ts:21` executes `Object.keys(DEFAULT_EVOLUTION_CONFIG.budgetCaps)` at module load time — removing `budgetCaps` from `DEFAULT_EVOLUTION_CONFIG` without simultaneously deleting `VALID_BUDGET_CAP_KEYS` and `validateBudgetCaps()` causes a load-time TypeError crash on every module that imports configValidation.

**Files to change (all in one commit):**
- `evolution/src/lib/config.ts` — Remove `budgetCaps` from `DEFAULT_EVOLUTION_CONFIG` (lines 21-34)
- `evolution/src/lib/types.ts` — Remove `budgetCaps` from `EvolutionRunConfig` type
- `evolution/src/lib/core/costTracker.ts`:
  - Remove `budgetCaps` constructor param (line 20)
  - Remove per-agent cap check in `reserveBudget()` (lines 25-30)
  - Keep per-agent spend tracking (`spentByAgent`, `recordSpend`) for observability
- `evolution/src/lib/core/budgetRedistribution.ts`:
  - Remove `computeEffectiveBudgetCaps()`
  - Keep REQUIRED_AGENTS, OPTIONAL_AGENTS, AGENT_DEPENDENCIES, `validateAgentSelection()`, `enabledAgentsSchema` (used by supervisor for agent selection, independent of budget)
- `evolution/src/lib/index.ts` — Update `preparePipelineRun()` (line 166) and `resumePipelineRun()` (line 236) which call `computeEffectiveBudgetCaps()` and pass result to CostTrackerImpl. Remove re-export of `computeEffectiveBudgetCaps` (line 96).
- `evolution/src/lib/core/pipeline.ts` — Update CostTrackerImpl construction to not pass budgetCaps
- `evolution/src/services/evolutionVisualizationActions.ts` — Remove budgetCaps reference (line 719)
- `evolution/src/lib/core/configValidation.ts`:
  - Delete `VALID_BUDGET_CAP_KEYS` constant (line 21) — `Object.keys(DEFAULT_EVOLUTION_CONFIG.budgetCaps)` crashes at module load if budgetCaps removed
  - Delete `validateBudgetCaps()` function entirely
  - Remove `validateBudgetCaps` calls from `validateRunConfig()` (line 98) and `validateStrategyConfig()` (line 71)
- `evolution/src/lib/core/strategyConfig.ts`:
  - Remove `budgetCaps` from `StrategyConfig` type
  - Remove `budgetCaps` field from `extractStrategyConfigInputSchema` Zod schema (line 127)
  - Remove `defaultBudgetCaps` second parameter from `extractStrategyConfig()` (line 148)
  - Remove budgetCaps from `extractStrategyConfig()` return value
- `evolution/src/services/strategyResolution.ts`:
  - Remove `opts.defaultBudgetCaps` parameter from `resolveOrCreateStrategyFromRunConfig()` (line 103)
  - Update call to `extractStrategyConfig()` to not pass defaultBudgetCaps
- `src/app/admin/quality/optimization/_components/StrategyConfigDisplay.tsx` — Remove `computeEffectiveBudgetCaps` import and call (line 68), remove budget caps display section
- `src/app/admin/quality/strategies/page.tsx` — Remove `computeEffectiveBudgetCaps` import/useMemo (line 179), remove budget caps form state (line 50), preset loading (line 157), form rendering (line 423), onChange handlers (line 443). Entire budget caps editing UI section removed.
- `src/app/admin/quality/strategies/strategyFormUtils.ts` — Remove `DEFAULT_BUDGET_CAPS` (derived from `DEFAULT_EVOLUTION_CONFIG.budgetCaps` at line 22), remove `budgetCaps` from `FormState` (line 16), update `formToConfig()` and `rowToForm()` to not include budgetCaps
- `evolution/src/services/experimentActions.ts`:
  - Line 692 (manual path): Remove `resolvedConfig.budgetCaps` passed to `resolveOrCreateStrategyFromRunConfig` as defaultBudgetCaps
  - Line 107 (L8 validation path): Delete `computeEffectiveBudgetCaps` call in `_validateExperimentConfigAction` (dead code for manual experiments, fully deleted in Phase 7)
- `evolution/src/services/evolutionActions.ts` — Remove `budgetCaps` from `StartEvolutionOptions` type (line 72), remove conditional budgetCaps copy into runConfig (lines 297-307)
- `evolution/src/services/strategyRegistryActions.ts` — Remove hardcoded `budgetCaps` from preset strategy configs (lines 392, 404, 416)
- `evolution/src/lib/core/metricsWriter.ts` — Remove `config.budgetCaps` passed as `defaultBudgetCaps` to `resolveOrCreateStrategyFromRunConfig` (line 65)
- `evolution/src/lib/core/costEstimator.ts` — Remove optional `budgetCaps` field from `CostEstimateConfig` and per-agent clamping logic (lines 282-284)
- `evolution/scripts/backfill-prompt-ids.ts` — Remove local `StrategyConfig.budgetCaps` type (line 17) and related validation (line 219)

**Tests** (~600-800 lines affected across 30+ files):
- `evolution/src/lib/core/costTracker.test.ts` (2 refs — remove budgetCaps from config construction)
- `evolution/src/lib/core/budgetRedistribution.test.ts` (~230 lines for computeEffectiveBudgetCaps)
- `evolution/src/lib/core/agentSelection.test.ts` (23 budgetCaps refs)
- `evolution/src/lib/core/strategyConfig.test.ts` (13 refs)
- `evolution/src/lib/core/pipeline.test.ts` (6 budgetCaps refs in 2795-line file)
- `evolution/src/lib/core/configValidation.test.ts` (~50 lines budgetCaps validation)
- `evolution/src/services/evolutionActions.test.ts` (13 refs)
- `evolution/src/services/eloBudgetActions.test.ts` (3 refs)
- `evolution/src/services/strategyRegistryActions.test.ts` (2 refs)
- `evolution/src/services/strategyResolution.test.ts` (1 ref)
- `evolution/src/services/evolutionVisualizationActions.test.ts` (4 refs)
- `evolution/src/lib/config.test.ts` (3 refs — distinct from core/config.test.ts)
- `evolution/src/lib/agents/treeSearchAgent.test.ts` (2 refs)
- `evolution/scripts/backfill-prompt-ids.test.ts` (1 ref)
- `src/app/admin/quality/strategies/strategyFormUtils.test.ts` (11 refs)
- `src/app/admin/quality/optimization/_components/StrategyConfigDisplay.test.tsx` (1 ref)
- `src/__tests__/integration/evolution-cost-attribution.integration.test.ts` (13 refs)
- `src/__tests__/integration/evolution-actions.integration.test.ts` (3 refs)
- `src/__tests__/integration/evolution-pipeline.integration.test.ts` (2 refs)
- `src/__tests__/integration/strategy-resolution.integration.test.ts` (3 refs)
- `src/__tests__/integration/evolution-visualization.integration.test.ts` (2 refs)
- `src/__tests__/integration/arena-actions.integration.test.ts` (1 ref)
- `src/__tests__/integration/evolution-tree-search.integration.test.ts` (1 ref)
- `src/__tests__/integration/evolution-outline.integration.test.ts` (1 ref)
- `evolution/src/lib/core/config.test.ts` (3 budgetCaps refs — also has 7 plateau refs updated in Phase 6)
- `evolution/src/components/evolution/tabs/TimelineTab.test.tsx` (1 budgetCap ref in mock data)
- `evolution/src/components/evolution/tabs/BudgetTab.test.tsx` (1 budgetCap ref in mock data)
- `evolution/src/testing/evolution-test-helpers.ts` — Shared test helper with `budgetCaps: {}` in strategy fixture (line 123); imported by 10+ test files

### Phase 6: Run until budget exhausted (Req 7)
Disable plateau detection, raise maxIterations to 50.

**ATOMICITY CONSTRAINT**: The following changes MUST be in a single commit — removing `plateau` from the config type while `resolveConfig()` still references `resolved.plateau.window` (line 83) would crash every config resolution call. Same for `configValidation.ts` which validates plateau fields as required.

**Files to change (all in one commit):**
- `evolution/src/lib/config.ts`:
  - Change `maxIterations: 15` → `maxIterations: 50`
  - Remove `plateau` from `DEFAULT_EVOLUTION_CONFIG`
  - Remove plateau-dependent auto-clamping logic in `resolveConfig()` (lines 83-91) — this references `resolved.plateau.window` and will crash if plateau is removed from type without updating this
- `evolution/src/lib/types.ts` — Remove `plateau` from `EvolutionRunConfig`
- `evolution/src/lib/core/supervisor.ts`:
  - Remove plateau detection block in `shouldStop()` (lines 189-195)
  - Remove `_isPlateaued()`, `trackCompetitionMetrics()`, `ordinalHistory`, `diversityHistory`
  - Keep quality threshold (single-article), budget exhaustion, maxIterations checks
  - `SupervisorConfig`: Remove `plateauWindow`, `plateauThreshold` fields
  - `supervisorConfigFromRunConfig()`: Remove plateau mapping (lines 51-52)
  - `SupervisorResumeState`: Remove `ordinalHistory`, `diversityHistory` — handle gracefully for in-flight run checkpoints (default to empty arrays if missing during deserialization)
- `evolution/src/lib/core/configValidation.ts` — Remove plateau validation (lines 122-136) — validates plateau fields as required, will reject all configs if plateau removed from type without this update

**Tests (all in same commit):**
- `evolution/src/lib/core/supervisor.test.ts` — Remove plateau detection tests
- `evolution/src/lib/core/pipeline.test.ts` — Update 15 plateau references
- `evolution/src/lib/core/config.test.ts` — Remove expansion auto-clamping tests that depend on plateau.window (7 refs; budgetCaps refs already handled in Phase 5)
- `evolution/src/lib/core/agentSelection.test.ts` — Update 2 plateau references
- `evolution/scripts/run-evolution-local.test.ts` — Update plateau refs
- `evolution/src/lib/core/arena.test.ts` — Update plateau refs
- `evolution/src/lib/core/configValidation.test.ts` — Remove plateau.window and plateau.threshold validation tests (7 refs; budgetCaps refs already handled in Phase 5)
- `src/__tests__/integration/evolution-pipeline.integration.test.ts` — Update 1 plateau-dependent expansion clamping assertion (line 295-296)

**Pre-deploy guard**: Ensure no in-flight runs with active checkpoints containing ordinalHistory. If found, they must complete or be cancelled before deploy.

**Budget safeguard layers that remain:**
1. `resolveConfig()` clamps `budgetCapUsd` to `MAX_RUN_BUDGET_USD` ($1.00)
2. `configValidation.ts` validates budget within bounds
3. `CostTrackerImpl.reserveBudget()` checks global budget before every LLM call (30% margin)
4. `supervisor.shouldStop()` checks `availableBudget < $0.01`
5. `MAX_EXPERIMENT_BUDGET_USD` ($10.00) enforced when adding runs
6. `experiment-driver` cron computes `spent_usd` and checks against experiment budget

### Phase 7: Deprecate L8 factorial system (Req 8)
Remove all L8-specific code, including full-factorial. Manual experiments become the only experiment type.

**Pre-deploy guard**: Run before deploying:
```sql
SELECT count(*) FROM evolution_experiments
WHERE design IN ('L8', 'full-factorial')
AND status NOT IN ('completed', 'failed', 'cancelled');
-- Must return 0. Any non-terminal L8/full-factorial experiments must complete or be cancelled first.
```

**Files to DELETE:**
- `evolution/src/experiments/evolution/factorial.ts` — L8_ARRAY, generateL8Design(), generateFullFactorialDesign(), factor types
- `evolution/src/experiments/evolution/factorial.test.ts`
- `evolution/src/experiments/evolution/strategyExperiment.test.ts`
- `evolution/src/experiments/evolution/experimentValidation.ts` — L8-specific validation (buildL8FactorDefinitions, validateExperimentConfig)
- `evolution/src/experiments/evolution/experimentValidation.test.ts`
- `evolution/src/experiments/evolution/factorRegistry.ts` — L8 factor metadata registry
- `evolution/src/experiments/evolution/factorRegistry.test.ts`
- `scripts/run-strategy-experiment.ts`
- `scripts/run-strategy-experiment.test.ts`
- Any remaining L8-only test fixtures

**Files to MODIFY (remove L8/full-factorial branches, keep manual paths):**
- `evolution/src/services/experimentActions.ts`:
  - Remove `startExperimentAction()` (L8 path, lines 166-277)
  - Remove all L8 imports: `buildL8FactorDefinitions`, `validateExperimentConfig`, `estimateBatchCostDetailed`, `FactorInput` from experimentValidation.ts; `generateL8Design` from factorial.ts; `FACTOR_REGISTRY`, `_getFactorMetadataAction` from factorRegistry.ts
  - Remove L8 design type from `createExperimentAction()` if separate
  - Keep manual experiment functions
- `evolution/src/experiments/evolution/analysis.ts`:
  - Remove imports: `L8_ARRAY`, `ExperimentDesign`, `L8Design`, `FullFactorialDesign`, `MultiLevelFactor` from factorial.ts
  - Remove `computeMainEffects()`, `computeInteractionEffects()`, `computeFullFactorialEffects()`, `computeMultiLevelEffect()`
  - Remove L8 branches in `rankFactors()` and `analyzeExperiment()` dispatch
  - Keep `computeManualAnalysis()`
  - Simplify `analyzeExperiment()` to only handle manual design
- `src/app/api/cron/experiment-driver/route.ts`:
  - Remove L8/full-factorial branches in state machine (lines 179-181)
  - Remove factor_definitions handling
  - Remove `ExperimentRow` interface fields for L8-specific columns
  - Remove imports from factorial.ts (generateL8Design, generateFullFactorialDesign)
- UI components: Remove `design === 'L8'` conditionals in ExperimentForm, ExperimentOverviewCard, etc.

**Tests to update:**
- `src/app/api/cron/experiment-driver/route.test.ts` (627 lines) — Remove L8 fixtures from `baseExperiment()`, remove L8-specific test cases, keep manual experiment tests
- `evolution/src/services/experimentActions.test.ts` — Remove L8 design type refs
- `evolution/src/experiments/evolution/analysis.test.ts` — Remove L8 main effects tests
- `src/app/admin/quality/optimization/experiment/[experimentId]/ExperimentOverviewCard.test.tsx` — Change design:'L8' fixture to 'manual'
- `src/app/admin/quality/optimization/experiment/[experimentId]/RunsTab.test.tsx` — Delete 'shows L8 Row column' test case, update design:'L8' fixtures
- `src/app/admin/quality/optimization/experiment/[experimentId]/ExperimentAnalysisCard.test.tsx` — Change design:'L8' fixture to 'manual'
- `src/app/admin/quality/optimization/experiment/[experimentId]/ExperimentDetailTabs.test.tsx` — Change design:'L8' fixture to 'manual'
- `evolution/src/services/experimentReportPrompt.test.ts` — Change design:'L8' fixture to 'manual'
- E2E tests: `admin-experiment-detail.spec.ts`, `admin-elo-optimization.spec.ts` — Remove L8 fixtures

**DB**: Leave `convergence_threshold` and `factor_definitions` columns as nullable (no migration risk). DB CHECK constraint already includes 'manual'.

### Phase 8: Strategy reuse confirmation (Req 4)
Already confirmed working via `resolveOrCreateStrategyFromRunConfig()` with SHA-256 hash dedup. **No code changes needed.** Add a brief comment in the code noting this behavior for discoverability.

## Testing

### Unit Tests (per phase, updated in same commit as code)
**Phase 1**: ExperimentForm.test.tsx (remove optimization_target assertion), experiment-driver/route.test.ts (remove optimization_target from fixtures)
**Phase 2**: No test changes (model lists are not unit-tested)
**Phase 3**: experimentActions.test.ts (update explanation title expectations)
**Phase 4**: ExperimentForm.test.tsx (budget-at-experiment-level flow), runFormUtils.test.ts (remove budgetCapUsd)
**Phase 5**: See detailed list in Phase 5 section (25+ files, ~600-800 lines)
**Phase 6**: See detailed list in Phase 6 section (supervisor, pipeline, config, arena tests)
**Phase 7**: See detailed list in Phase 7 section (route.test.ts, analysis.test.ts, e2e specs)

### Integration Tests
- `src/__tests__/integration/evolution-cost-attribution.integration.test.ts` — Update CostTrackerImpl construction (13 budgetCaps refs)
- `src/__tests__/integration/evolution-pipeline.integration.test.ts` — Update config fixtures
- `src/__tests__/integration/strategy-resolution.integration.test.ts` — Update strategy config
- `src/__tests__/integration/evolution-actions.integration.test.ts` — Update experiment fixtures
- New: Add test verifying combined effect of no per-agent caps + no plateau = run until budget exhaustion

### E2E Tests
- `admin-experiment-detail.spec.ts` — Remove optimization_target and L8 fixtures
- `admin-elo-optimization.spec.ts` — Update budgetCaps in seed data
- `admin-strategy-registry.spec.ts` — Update budgetCaps in seed data

### Manual Verification (on staging)
- Create manual experiment with 3 runs, verify budget divides equally
- Verify "Optimize" dropdown is gone
- Verify GPT-5 models appear in all model selectors
- Run experiment and confirm it runs until budget exhausted (not early stop)

## Rollback Plan
- Each phase is a separate commit — can revert individual phases via `git revert`
- **Pre-deploy**: Ensure no in-flight L8/full-factorial experiments (SQL guard in Phase 7)
- **Pre-deploy**: Ensure no in-flight runs with active checkpoints (guard in Phase 6)
- **If issues found post-deploy**: Revert the PR. Budget safeguard layers (6 independent checks) ensure no cost overrun even during partial rollback. Existing experiment data in DB remains valid since no destructive migrations are included.
- **No feature flags needed**: Changes are purely subtractive (removing dead code, removing enforcement layers, removing UI elements). There is no new behavior to gate.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/README.md` — Remove L8 references, update budget model description
- `evolution/docs/evolution/architecture.md` — Remove L8 phase transitions, update stopping conditions
- `evolution/docs/evolution/data_model.md` — Remove L8 design type, update experiment model
- `evolution/docs/evolution/reference.md` — Update config defaults (no budgetCaps, no plateau, maxIterations=50), update model list
- `evolution/docs/evolution/cost_optimization.md` — Remove per-agent budget enforcement, keep tracking docs
- `evolution/docs/evolution/arena.md` — Update if experiment→arena integration changes
- `evolution/docs/evolution/rating_and_comparison.md` — Remove plateau detection from stopping conditions
- `evolution/docs/evolution/agents/overview.md` — Remove per-agent budget cap references
- `evolution/docs/evolution/agents/generation.md` — Remove generation budget cap
- `evolution/docs/evolution/agents/editing.md` — Remove editing budget cap
