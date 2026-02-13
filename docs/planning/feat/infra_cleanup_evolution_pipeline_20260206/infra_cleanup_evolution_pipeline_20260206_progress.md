# Infra Cleanup Evolution Pipeline Progress

## Phase 1: Extract createDefaultAgents() factory & fix agent gaps
### Work Done
- Added `createDefaultAgents()` factory to `src/lib/evolution/index.ts` with all 12 agents
- Used aliased local imports since re-exports don't create local bindings
- Updated 5 callsites to use factory, fixing 6 missing-agent gaps:
  - cron route: +TreeSearchAgent, +SectionDecompositionAgent
  - admin trigger: +TreeSearchAgent
  - run-batch: +TreeSearchAgent, +SectionDecompositionAgent
  - evolution-runner: +SectionDecompositionAgent
  - run-evolution-local: refactored buildAgents() to delegate to factory
- Added 2 unit tests to `pipeline.test.ts` — all pass
- tsc, lint clean

### Issues Encountered
- Project folder path mismatch with branch name — moved folder to `docs/planning/feat/...`
- `PipelineAgents` optional fields required adjusting local CLI steps array type

### User Clarifications
None needed.

## Phase 2: Fix cost infrastructure bugs (2a-2j)
### Work Done
- **2a** DebateAgent: replaced 9 `costUsd: 0` with `ctx.costTracker.getAgentCost(this.name)`
- **2b** CostTracker: FIFO reservation queue replaces lossy `min()` release
- **2c** CostTracker: `getAvailableBudget()` now subtracts `totalReserved`
- **2d** DebateAgent: moved `state.debateTranscripts.push()` after BudgetExceededError check in 4 catch blocks
- **2e** IterativeEditingAgent: added `console.warn` in 2 swallowed catch blocks
- **2f** EvolvePool: added `BudgetExceededError` re-throw in creative exploration catch
- **2g** Tournament: added BudgetExceededError scan after `Promise.allSettled`
- **2h** BeamSearch: re-throws BudgetExceededError after saving partial survivors
- **2i** CostEstimator: `.replace('evolution_', '')` → `.replace(/^evolution_/, '')`
- **2j** Config: added comment explaining intentional >1.0 budget cap sum
- Added 5 new costTracker tests (FIFO queue, phantom leak, reservation subtraction)
- Updated debateAgent test for new BudgetExceededError behavior
- All tests pass: 75 agent + 25 beamSearch + 16 costTracker

### Issues Encountered
- debateAgent.test.ts expected old buggy behavior (partial transcript on BudgetExceededError) — updated to expect clean state

### User Clarifications
None needed.

## Phase 3: Extract finalizePipelineRun() helper
### Work Done
- Extracted `finalizePipelineRun()` from duplicated ~20-line post-completion blocks in both `executeMinimalPipeline` and `executeFullPipeline`
- Consolidates: `buildRunSummary → validateRunSummary → persistVariants → persistAgentMetrics → linkStrategyConfig`
- Added 2 unit tests (all 4 persistence calls, validation failure handling)
- All 22 pipeline tests pass

### Issues Encountered
None.

### User Clarifications
None needed.

## Phase 4: Extract preparePipelineRun() context factory
### Work Done
- Created `PipelineRunInputs` and `PreparedPipelineRun` interfaces in `index.ts`
- `preparePipelineRun()` consolidates 7-step context construction: resolveConfig → PipelineStateImpl → createCostTracker → createEvolutionLogger → createEvolutionLLMClient → build ctx → createDefaultAgents
- Simplified 4 callsites (cron route, admin trigger, run-batch, evolution-runner) from ~20 lines each to ~5 lines
- Fixed `state` scoping issues in run-batch.ts and evolution-runner.ts
- Added 3 unit tests (valid context, config overrides, missing llmClient/llmClientId error)
- All 25 pipeline tests pass, 609 evolution tests pass

### Issues Encountered
- `state` variable no longer in scope after using `preparePipelineRun()` — fixed with `ctx.state` destructuring
- Re-exports don't create local bindings — used aliased local imports in factory

### User Clarifications
None needed.

## Phase 5: Refactor run-evolution-local.ts to use canonical pipeline functions
### Work Done
- Removed ~280 lines of duplicated pipeline infrastructure:
  - `runAgent()` (~25 lines) — canonical `pipeline.ts` handles agent execution
  - `runMinimalPipeline()` (~38 lines) → replaced by `executeMinimalPipeline()`
  - `runFullPipeline()` (~78 lines) → replaced by `executeFullPipeline()`
  - `updateRunStatus()` (~12 lines) — canonical pipeline handles status updates
  - `persistCheckpoint()` (~20 lines) — canonical pipeline handles checkpointing
  - `snapshotCheckpointToBank()` (~67 lines) — dead code after removing local loop
  - Local `PipelineAgent` interface — now imported from `pipeline.ts`
- `main()` now calls `executeFullPipeline`/`executeMinimalPipeline` directly
- Kept custom LLM clients (mock + direct) and bank logic (post-completion only)
- Net: -319 lines, +43 lines across 2 files
- tsc clean, lint clean, build clean, 609 evolution tests pass

### Issues Encountered
- Mid-iteration bank checkpoint snapshots no longer possible (canonical pipeline doesn't expose per-iteration hooks). Post-completion bank insertion still works. Accepted trade-off per plan.
- Supabase query builder `.eq()` doesn't return a Promise — replaced `.catch()` with try/catch in error handler

### User Clarifications
None needed.

## Phase 6: Clean up dead code, shared utilities, documentation
### Work Done
- **Dead code removal**: Deleted `ratingToDisplay()` from `rating.ts` (only used in tests), removed from barrel export and test file
- **TODO annotations**: Added `TODO: wire into pipeline` comments to `adaptiveAllocation.ts` for `computeAdaptiveBudgetCaps()` and `budgetPressureConfig()` (exported but never called from production)
- **TODO annotation**: Added TODO comment in `supervisor.ts` noting `generationPayload.strategies` is ignored by GenerationAgent
- **Extracted `extractJSON<T>()`**: New shared utility at `core/jsonParser.ts`, replaced 5 duplicated `response.match(/\{[\s\S]*\}/) + JSON.parse` patterns across:
  - `reflectionAgent.ts` (parseCritiqueResponse)
  - `debateAgent.ts` (parseJudgeResponse)
  - `iterativeEditingAgent.ts` (runOpenReview + runInlineCritique)
  - `treeOfThought/beamSearch.ts` (scoreSingleVariant)
- **8 unit tests** for `extractJSON` — clean JSON, wrapped in prose, markdown fences, nulls, nested objects
- **Documentation updated** (`evolution_pipeline.md`):
  - Fixed outdated DebateAgent `costUsd: 0` note (bug fixed in Phase 2)
  - Updated budget caps config to match current values
  - Updated CostTracker description: FIFO reservation queue replaces old release-via-min()
  - Added `jsonParser.ts` to core infrastructure table
  - Noted `createDefaultAgents()`, `preparePipelineRun()`, `finalizePipelineRun()` in barrel export
  - Updated pipeline mode descriptions to reflect all 5 callsites using canonical functions
- 40 test suites, 615 tests pass; tsc clean

### Skipped Items
- **`estimateCost()` removal**: `sectionDecompositionAgent` and `treeSearchAgent` use it in production — kept
- **Budget caps typing**: Complexity exceeds value for this cleanup pass
- **Barrel export tightening**: Deferred per plan (low priority)

### Issues Encountered
- `extractJSON` returns null — all callsites needed null guard where old `if (!jsonMatch)` handled it
- DebateAgent's `JudgeVerdict.winner` required `as` cast after switching from untyped JSON.parse

### User Clarifications
None needed.
