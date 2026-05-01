# Develop Reflection and GenerateFromParentArticle Agent Evolution Progress

## Phase 1: Schema & Cost-Stack Foundation ✅
### Work Done
- `agentNames.ts`: added `'reflection'` to `AGENT_NAMES` and `COST_METRIC_BY_AGENT`.
- `metrics/types.ts`: added `'reflection_cost'`, `'total_reflection_cost'`, `'avg_reflection_cost_per_run'` to `STATIC_METRIC_NAMES`.
- `costCalibrationLoader.ts`: added `'reflection'` to phase enum.
- `createEvolutionLLMClient.ts`: added `'reflection'` to calibration ladder + `OUTPUT_TOKEN_ESTIMATES.reflection = 600` (tokens).
- `metrics/registry.ts`: added run-level `reflection_cost` def + propagation defs (total + avg).
- `metricCatalog.ts`: 3 new entries (reflection_cost, total_reflection_cost, avg_reflection_cost_per_run).
- `RunEntity.ts`, `StrategyEntity.ts`, `ExperimentEntity.ts` registrations.
- `projectDispatchPlan.ts`: `EstPerAgentValue.reflection: number`. Updated 3 literal call sites with default `reflection: 0`.
- `schemas.ts`: `iterationConfigSchema` extended with `useReflection` + `reflectionTopN` plus 3 new Zod refinements; new `reflectAndGenerateFromPreviousArticleExecutionDetailSchema` registered in `agentExecutionDetailSchema` discriminated union.
- `findOrCreateStrategy.ts`: `hashStrategyConfig` canonicalization strips falsy optionals.
- 5 new tests including 3-way hash collision symmetry.
- Updated existing entities.test.ts count assertions (RunEntity 4→5, StrategyEntity 31→33).

### Test Results
All 1423 evolution lib tests pass (2 skipped). tsc clean. Lint clean.

## Phase 2: Framework Logger Fix ✅
### Work Done
- `trackInvocations.ts:74`: switched `execution_detail` and `error_message` to conditional-spread. Omitting these fields PRESERVES the prior DB value.
- 4 new sub-cases in `trackInvocations.test.ts` for partial-update semantics.
- `AgentContext` (`types.ts`): added optional `experimentId`, `strategyId`, `tacticEloBoosts`. `db` was already there.
- `Agent.run()`: builds invocation-scoped logger via `createEntityLogger({entityType:'invocation', entityId:invocationId, ...})` when invocationId is present. Routes ONLY the LLM client to it (preserves backward-compat for tests spying on `ctx.logger.warn`).
- 5 AgentContext call sites updated to propagate new FKs: `runIterationLoop.ts:414/602/670/697`, `claimAndExecuteRun.ts:291`.
- `createEntityLogger.ts`: defensive guard skips DB insert when `supabase.from` isn't a function (test envs).

### Test Results
All 1427 evolution lib tests pass.

## Phase 3: Cost Estimation Integration ⏸️ (deferred)
Deferred for follow-up. Current behavior: reflection iterations use vanilla GFPA cost for parallel-batch sizing, slightly under-estimating. Budget gating catches any overrun.

## Phase 4: Mid-Run Tactic ELO Query ✅
### Work Done
- New file `evolution/src/services/tacticReflectionActions.ts` with `getTacticEloBoostsForReflection(db, promptId, tacticNames, logger?)`.
- Two-trip strategy: live aggregate from `evolution_variants` ⨝ `evolution_runs` ⨝ `evolution_strategies` (status='completed', is_test_content=false, prompt_id=$1) → mean(elo_score-1200) per tactic; falls back to `evolution_metrics entity_type='tactic' metric_name='avg_elo_delta'` for tactics with n<3.
- `is_test_content` filter goes through `evolution_strategies` (correctly — not `evolution_runs`).
- 4 unit tests: cold-start, insufficient samples, sufficient samples, DB error fallback.

## Phase 5: Tactic Summary Helper ✅
### Work Done
- New `getTacticSummary(name)` helper in `tactics/index.ts`.
- Distills `${label} — ${preamble} ${firstSentence(instructions)}` (~250 char cap, truncate-at-word + ellipsis).
- 7 unit tests covering null/format/cap/ellipsis/coverage/all-24-tactics.

## Phase 6: ReflectAndGenerateFromPreviousArticleAgent ✅
### Work Done
- New file `reflectAndGenerateFromPreviousArticle.ts` with `ReflectAndGenerateFromPreviousArticleAgent` class.
- `name = 'reflect_and_generate_from_previous_article'`, `usesLLM = true`, `getAttributionDimension(detail) → detail.tactic`.
- Custom errors: `ReflectionLLMError`, `ReflectionParseError(message, rawResponse)`.
- Helpers (exported): `buildReflectionPrompt`, `parseReflectionRanking` (priority chain).
- `execute()`: capture costBeforeReflection → build prompt → LLM call → parse → validate → inner GFPA `.execute()` (NOT `.run()`) → merge with explicit `totalCost = reflectionCost + gfpaDetail.totalCost` recompute.
- Pre-throw partial-detail writes via `updateInvocation(ctx.db, ctx.invocationId, ...)` survive Agent.run()'s catch handler thanks to Phase 2's partial-update fix.
- Registered in `agentRegistry.ts`. New entry in `DETAIL_VIEW_CONFIGS` matching the agent's detailViewConfig.
- 15 unit tests covering prompt building, parser tolerance, agent error paths.

## Phase 7: Orchestrator Integration ✅
### Work Done
- `runIterationLoop.ts`: iteration-scoped `reflectionEnabled` + `reflectionTopN` resolution.
- Pre-fetch `tacticEloBoosts` ONCE per iteration when reflectionEnabled (shared by all parallel + top-up dispatches).
- Kill-switch: `process.env.EVOLUTION_REFLECTION_ENABLED !== 'false'` — single env flip rolls reflection back to vanilla GFPA.
- `dispatchOneAgent` closure refactored to branch on `reflectionEnabled`. Top-up loop reuses the same closure → covers both phases.
- Deterministic candidate-list shuffle via `deriveSeed(randomSeed, 'iter${i}', 'reflect_shuffle${execOrder}')` + `SeededRandom.shuffle()`.

## Phase 8: Aggregator Migration ✅
### Work Done
- New file `attributionExtractors.ts` with `ATTRIBUTION_EXTRACTORS: Record<string, DimensionExtractor>` and `registerAttributionExtractor()` function.
- Side-effect imports at bottom of GFPA + wrapper agent register their extractors.
- `computeEloAttributionMetrics` now dispatches via the registry. Mutually exclusive with legacy fallback (registered extractor OR legacy path, never both).
- New eager-import barrel `evolution/src/lib/core/agents/index.ts` re-exports all agent classes (load-bearing for worker contexts).
- experimentMetrics does NOT import the barrel (would create circular dep through writeMetrics → registry → propagation → experimentMetrics). Production callers reach the aggregator via claimAndExecuteRun, which transitively loads agents.
- 6 new tests for the registry.

## Phase 9: UI Invocation Detail Tabs ✅
### Work Done
- `InvocationDetailContent.tsx`: dynamic tab construction. Wrapper agent gets 5 tabs (Reflection Overview, Generation Overview, Metrics, Timeline, Logs); other agents keep legacy single-Overview shape.
- `InvocationExecutionDetail.tsx`: new optional `keyFilter` prop slices the DETAIL_VIEW_CONFIGS array — wrapper's split tabs render disjoint slices of the same `execution_detail`.
- Added `'reflect_and_generate_from_previous_article'` to `TIMELINE_AGENTS`.

## Phase 10: UI Timeline 3-phase Bar ✅
### Work Done
- `InvocationTimelineTab.tsx`: added `REFLECTION_COLOR = '#f59e0b'` (amber). Reads `execution_detail.reflection.{durationMs,cost}` (optional). 3-phase bar with proper startMs offsets. Per-comparison sub-bars use `rankingStartMs` as cursor origin.
- New data-testid `'timeline-reflection-bar'`.
- All 9 existing timeline tests still pass.

## Phase 11: UI Strategy Wizard ✅
### Work Done
- `IterationRow` + `IterationConfigPayload` gained `useReflection: boolean` + `reflectionTopN: number` fields.
- Reflection checkbox + Top-N number input under each generate iteration row, with mutual-exclusivity gating: checkbox disabled when tacticGuidance non-empty; Tactics button disabled when useReflection=true.
- `updateIteration()` enforces mutex at state level.
- `toIterationConfigsPayload` conditionally emits both fields ONLY when useReflection=true.

## Phase 12: Documentation Updates ✅
### Work Done
- `evolution/docs/agents/overview.md`: new "ReflectAndGenerateFromPreviousArticleAgent" section covering class, prompt, parser, inner-`.execute()` invariant, cost stack, failure-mode handling, mutex, kill-switch.
- `evolution/docs/strategies_and_experiments.md`: extended IterationConfig type signature + table description with new fields.
- `evolution/docs/architecture.md`: renamed "Three Agent Types" to "Agent Types" + cross-link to wrapper agent in overview.
- `evolution/docs/reference.md`: added `EVOLUTION_REFLECTION_ENABLED` to Kill Switches table.
- `docs/feature_deep_dives/multi_iteration_strategies.md`: added useReflection + reflectionTopN to the IterationConfig field list.

## Final Status
- 11/12 phases complete (Phase 3 deferred — non-blocking).
- 8 commits on `feat/develop_reflection_and_generateFromParentArticle_agent_evolution_20260430`.
- All 1738 unit tests pass (evolution + admin); tsc clean throughout.
- Backend functionally complete: setting `iterationConfig.useReflection: true` dispatches the wrapper agent; reflection LLM picks tactic from all 24; inner GFPA generates + ranks variant; cost correctly attributed; `eloAttrDelta` metrics flow; UI surfaces reflection in tabs + timeline; wizard exposes the toggle; kill-switch available.
