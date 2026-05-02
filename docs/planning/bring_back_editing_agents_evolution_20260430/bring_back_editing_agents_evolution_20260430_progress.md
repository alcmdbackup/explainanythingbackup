# Bring Back Editing Agents Evolution Progress

## Phase 0: Initialization
### Work Done
- Created branch `feat/bring_back_editing_agents_evolution_20260430` off `origin/main`.
- Initialized `docs/planning/bring_back_editing_agents_evolution_20260430/` with `_status.json`, research, planning, and progress docs.
- Surveyed git history for prior editing agents (V1 `IterativeEditingAgent`, `OutlineGenerationAgent`, `SectionDecompositionAgent` deleted in `4f03d4f6`).
- Identified two unmerged prior branches (`feat/create_editing_agent_evolution_20260415`, `feat/introduce_editing_agent_evolution_20260421`); the latter has a fleshed-out plan that we're inheriting as the starting design.

### Issues Encountered
None yet.

### User Clarifications
- Project summary and detailed requirements are identical (verbatim, per user).
- Manual doc tags: skipped; auto-discovered docs accepted (multi_iteration_strategies, variant_lineage, evolution_metrics).

## Phase 1: Scaffolding (COMPLETE — 2026-05-01)

### Work Done
All 10 Phase 1 sub-tasks committed to `feat/bring_back_editing_agents_evolution_20260430`:

- **1.1** `evolution/src/lib/schemas.ts` — `iterationAgentTypeEnum` widened to 4 values; split `isVariantProducingAgentType` into `canBeFirstIteration` + `producesNewVariants`; added `editingMaxCycles` + `editingEligibilityCutoff` to `iterationConfigSchema` with refines; added `editingModel` + `approverModel` to `strategyConfigBaseSchema`; bundled producer/consumer enum widening (`recordSnapshot`, `IterationResult.agentType`, `IterationPlanEntry.agentType`, `IterationPlanEntryClient.agentType`, `IterationSnapshotRow.iterationType`, `MergeRatingsInput.iterationType`, `iterationSnapshotSchema`, `mergeRatingsExecutionDetailSchema`).
- **1.2** `evolution/src/lib/core/agentNames.ts` — added 3 per-LLM-call AgentName labels (`iterative_edit_propose`, `iterative_edit_review`, `iterative_edit_drift_recovery`); all map to `iterative_edit_cost` metric.
- **1.3** `evolution/src/lib/metrics/types.ts` — added `iterative_edit_cost` + 3 operational health metrics (`drift_rate`, `recovery_success_rate`, `accept_rate`) + 2 propagation metrics.
- **1.4** `evolution/src/lib/core/metricCatalog.ts` + `evolution/src/lib/metrics/registry.ts` — 5 new metric defs with threshold annotations.
- **1.5a + 1.5b** Two DB migrations: `20260501204141_evolution_cost_calibration_reflection_phase.sql` (DROP+RECREATE with explicit name `evolution_cost_calibration_phase_allowed`, adds `'reflection'` — fixes PR #1017's silent-reject) and `20260501204142_evolution_cost_calibration_editing_phases.sql` (adds 3 editing phases under same constraint name).
- **1.6** `evolution/scripts/refreshCostCalibration.ts` Phase enum + `evolution/src/lib/pipeline/infra/costCalibrationLoader.ts` `CalibrationRow['phase']` extended; new `evolution/src/lib/core/startupAssertions.ts` (~180 LOC) standalone deploy gate independent of `COST_CALIBRATION_ENABLED` (asserts both TS sources sync with DB CHECK; fail-open on permission denied; throws `MissingMigrationError` on mismatch).
- **1.7** `evolution/src/lib/pipeline/infra/estimateCosts.ts` — added `estimateIterativeEditingCost(seedChars, editingModel, approverModel, driftRecoveryModel, judgeModel, maxCycles)` returning `{ expected, upperBound }` with size-aware proposer output (drops fixed 7500-char budget) and 1.5×-per-cycle growth in upper-bound. Extended `EstPerAgentValue` with `editing` field.
- **1.8** `evolution/src/lib/schemas.ts` `iterativeEditingExecutionDetailSchema` rewritten with v2 redesign shape (Proposer / pre-check / Approver / Implementer audit + per-purpose cost split + driftRecovery + sizeRatio + 12-value stopReason). `evolution/src/lib/types.ts` `IterativeEditingExecutionDetail` mirrored. `evolution/src/testing/executionDetailFixtures.ts` rewritten with 2-cycle realistic scenario. `evolution/src/lib/core/entities/InvocationEntity.ts` listFilters value renamed.
- **1.9** Cleanup: removed ghost tactic palette entries (mutate_clarity, crossover, mutate_engagement); deleted unused `evolution/src/lib/legacy-schemas.ts`; fixed `low_sigma_opponents_count` → `low_uncertainty_opponents_count` mismatch.
- **1.10** New `evolution/src/lib/pipeline/loop/editingDispatch.ts` — split into `resolveEditingDispatchRuntime` + `resolveEditingDispatchPlanner` sharing inner `applyCutoffToCount` (mirrors PR #1017's `resolveReflectionEnabled` pattern). 15 unit tests pass; cross-mode equivalence test asserts runtime + planner agree.

### Issues Encountered
- Phase 1.1 enum widening cascaded to 6 producer/consumer types that needed bundled type-only widening to keep typecheck green (recordSnapshot, IterationResult, IterationPlanEntry/Client, IterationSnapshotRow, MergeRatingsInput).
- `editingEligibilityCutoff` originally specified with `.default()` in plan; switched to `.optional()` so the "only allowed on iterative_editing" refine could enforce it (Zod default + refine are incompatible).
- `IterativeEditingExecutionDetail` type lives in 2 places (Zod schema + hand-written interface in types.ts); both updated to stay in sync.

### User Clarifications
- User instructed to "execute the plan"; Phase 1 (scaffolding, ~10 sub-tasks) committed; Phase 2 (~30 sub-tasks, ~2500 LOC of new agent components + tests) pending.

## Phase 2-6: PENDING

Remaining work breakdown:
- **Phase 2 (Week 2)**: IterativeEditingAgent class + Proposer prompt + parser + drift detector + drift recovery + Approver prompt + parser + applier + 6 sub-suites of unit/property/sample-article tests (~2500 LOC, ~30 sub-tasks).
- **Phase 3 (Week 3)**: Pipeline integration — agent registry, dispatch branch in runIterationLoop, MergeRatingsAgent widening, 2 integration tests (~10 sub-tasks).
- **Phase 4 (Week 4 part 1)**: Invocation-detail UI — text-diff + annotated-edits field types, AnnotatedProposals component (~12 sub-tasks).
- **Phase 5 (Week 4 part 2)**: Strategy wizard — editing iteration row, Step 1 model dropdowns, rubber-stamping warning, editing-terminal warning (~6 sub-tasks).
- **Phase 6 (Week 4 part 3)**: E2E + docs + rollout — split E2E (real-LLM @evolution + Jest+RTL UI), 3 BC tests, CI workflow + env var enumeration, deploy-gate proof test, 7 doc updates (~12 sub-tasks).
