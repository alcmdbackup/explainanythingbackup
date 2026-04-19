# Fixes Additional Generation Tactics Evolution Plan

## Background
Fix and enhance the evolution tactics system. The tactics list page shows no tactics, the detail view needs verification, tactics need to appear as a top-level entity in the left nav, and the strategy creation wizard needs tactic preference configuration per generateFromSeedArticle iteration. Additionally, a cost attribution bug causes all invocation `cost_usd` values to be $0, and backward-compat references from the generateFromSeedArticle → generateFromPreviousArticle rename need cleanup.

## Requirements (from GH Issue #NNN)
- **Make sure there is a way to set tactics preference from the strategy creation wizard, for each generateFromSeedArticle in each iteration**
- Tactics should be in left nav, as a top-level entity
- There are no tactics listed when I go to the tactics list view
- Make sure we have a tactics detail view
- **Strategy wizard iteration screen should show a preview of expected agent dispatch per generate round — parallel vs. sequential counts — based on budget settings**
- **Fix invocation cost_usd = 0 bug**: propagate rawProvider/defaultModel on AgentContext so per-invocation cost scoping works
- **Clean up backward-compat references**: update syncSystemTactics.ts and TacticEntity.ts to use `generate_from_previous_article`

## Problem
The tactics system was added in PR #995 but left incomplete: the DB table is empty (sync script never ran), the sidebar omits tactics, the strategy wizard has no tactic guidance UI, and the detail view has stub tabs. A cost attribution bug in the pipeline means every invocation records $0 cost because the per-invocation AgentCostScope is never wired up (rawProvider not propagated to AgentContext). The recent rename from generateFromSeedArticle to generateFromPreviousArticle left two backward-compat references.

## Options Considered
- [x] **Option A: Phased incremental approach** — Fix low-hanging fruit first (sync, nav, backward-compat, cost bug), then build UI features (wizard tactic guidance, dispatch preview, detail tabs). Each phase independently testable and deployable.
- [ ] **Option B: Big bang** — All changes in one phase. Rejected: too risky, hard to test incrementally.

## Phased Execution Plan

### Phase 1: Foundation Fixes (Data + Nav + Cost Bug + Backward-Compat)
- [x] Run `npx tsx evolution/scripts/syncSystemTactics.ts` manually against staging to populate the `evolution_tactics` table with 24 system tactics
- [x] Add Tactics to sidebar nav in `src/components/admin/EvolutionSidebar.tsx` — insert `{ href: '/admin/evolution/tactics', label: 'Tactics', icon: '⚔️', testId: 'evolution-sidebar-nav-tactics', description: 'Generation tactics registry' }` in the Entities group after Strategies
- [x] Update `src/components/admin/EvolutionSidebar.test.tsx` — add `{ testId: 'evolution-sidebar-nav-tactics', href: '/admin/evolution/tactics' }` to expectedItems
- [x] Fix invocation cost_usd = 0 bug in `evolution/src/lib/pipeline/loop/runIterationLoop.ts`:
  - Keep `llmProvider` reference (line 164 function param) but remove the shared `const llm = createEvolutionLLMClient(...)` at line 207
  - Add `rawProvider: llmProvider` and `defaultModel: resolvedConfig.generationModel` and `generationTemperature: resolvedConfig.generationTemperature` to `ctxForAgent` (line 362-373) for generate agents
  - Add same fields to mergeCtx (~line 452) and swiss agent context
  - **Remove `llm` from agent input objects** at all dispatch call sites (line 378 for generate, ~line 532 for swiss) as cleanup — the shared LLM client is no longer needed since Agent.run() will build scoped clients. **Note:** the actual bug fix is adding `rawProvider`/`defaultModel` to ctx. Agent.run() line 63-73 builds a scoped client when `ctx.rawProvider && ctx.defaultModel` are set, and injects it as `effectiveInput.llm` (overwriting any pre-existing `input.llm`). So adding rawProvider to ctx IS sufficient alone; removing `input.llm` is optional cleanup to avoid creating a wasteful shared LLM client at line 207
  - MergeRatingsAgent has `usesLLM = false` so it skips the scoped client build — no change needed for merge agent input
  - Update `runIterationLoop.test.ts` mocks: the `createEvolutionLLMClient` module mock at lines 44-49 should be **kept** — Agent.run() line 64 calls it internally when `ctx.rawProvider` is set, so the mock intercepts that scoped build. Remove any `llm` properties from agent input assertions in `mockGenerateRun`/`mockSwissRun`. Add `rawProvider` and `defaultModel` to the test's AgentContext setup.
  - **No type changes needed for AgentContext**: `rawProvider` and `defaultModel` are already optional fields on `AgentContext` (defined in `evolution/src/lib/core/types.ts` lines 157-165). TypeScript will accept them on ctxForAgent without interface changes.
- [x] Update `evolution/scripts/syncSystemTactics.ts` line 31 — change `agent_type: 'generate_from_seed_article'` to `'generate_from_previous_article'`
- [x] Update `evolution/src/lib/core/entities/TacticEntity.ts` line 50 — change filter options from `['generate_from_seed_article']` to `['generate_from_previous_article']`

### Phase 2: Per-Iteration Tactic Guidance (Schema + Pipeline)
- [x] Add `generationGuidance: generationGuidanceSchema.optional()` to the `z.object({...})` portion of `iterationConfigSchema` in `evolution/src/lib/schemas.ts` (before existing `.refine()` chains)
- [x] Chain a new `.refine()` after the existing refines: `generationGuidance` must not be set for swiss iterations (`.refine(c => c.agentType !== 'swiss' || !c.generationGuidance, { message: '...' })`)
- [x] **Verify data flow end-to-end**: `iterationConfigSchema` is embedded in `strategyConfigSchema` (line 424) → `strategyConfigSchema` is used in `buildRunContext.ts` to parse the DB config → parsed `IterationConfig` (auto-derived via `z.infer`) flows into `EvolutionConfig.iterationConfigs[]` → accessed as `iterCfg` in `runIterationLoop.ts` line 266. Since `IterationConfig` is schema-derived, the new `generationGuidance` field propagates automatically through the entire chain. No manual type updates needed in `pipeline/infra/types.ts`.
- [x] Update `evolution/src/lib/pipeline/setup/buildRunContext.ts` — validate tactic names in per-iteration `generationGuidance` entries via `isValidTactic()`, alongside existing strategy-level validation (add a loop over `stratConfig.iterationConfigs` after line 259)
- [x] Update `evolution/src/lib/pipeline/loop/runIterationLoop.ts` tactic selection (lines 322-330) — change `const guidance = resolvedConfig.generationGuidance` to `const guidance = iterCfg.generationGuidance ?? resolvedConfig.generationGuidance` (per-iteration takes precedence over strategy-level, falls back to round-robin if both undefined)
- [x] Update `evolution/src/lib/schemas.ts` preprocess migration — if a legacy config has `iterationConfigs[].strategy` field, rename to `tactic` (matching the existing strategy→tactic preprocess pattern)

### Phase 3: Strategy Wizard — Tactic Guidance UI
- [x] Extend `IterationRow` interface in `src/app/admin/evolution/strategies/new/page.tsx` — add `tacticGuidance?: Array<{ tactic: string; percent: number }>`
- [x] Add "Configure Tactics" button per generate iteration row that opens a popover/modal
- [x] Build `TacticGuidancePopover` component: list all 24 tactics grouped by category (using `TACTICS_BY_CATEGORY`), each with a percent input. Validate percentages sum to 100. Use `TACTIC_PALETTE` for color indicators. Include quick presets: "Even across all" (equal distribution), "Core only" (even across 3 core tactics), "Clear all" (reset to no guidance / default round-robin).
- [x] Update `handleSubmit` (line 162-176) to include `generationGuidance` in each iteration's config when set
- [x] Update `createStrategyAction` schema in `evolution/src/services/strategyRegistryActions.ts` — the `iterationConfigs` entries should pass through the updated `iterationConfigSchema` which now allows `generationGuidance`
- [x] Update `StrategyConfigDisplay.tsx` — show per-iteration tactic guidance in the iterations table (expandable row detail or inline badges)

### Phase 4: Strategy Wizard — Agent Dispatch Preview
- [x] Add inline dispatch preview per generate iteration row showing: estimated agents (parallel + sequential), estimated per-agent cost
- [x] Import/reuse estimation logic from `evolution/src/lib/pipeline/infra/estimateCosts.ts` — `estimateAgentCost()` for per-agent cost, then compute `parallelCount = Math.min(maxAgents, Math.floor(availBudget / estPerAgent))` and `sequentialCount` from remaining budget after floor
- [x] Display as compact text: e.g., "~3 parallel + ~2 sequential" or "~5 agents" next to each generate iteration row
- [x] Recalculate on budget/model/floor changes

### Phase 5: Tactic Detail View — Variants & Runs Tabs
- [x] Implement Variants tab in `TacticDetailContent.tsx` — query `evolution_variants` filtered by `agent_name = tacticName`, display with `EntityListPage` columns (ID, Run, Elo, Created)
- [x] Add server action `getTacticVariantsAction` in `evolution/src/services/tacticActions.ts` — paginated query joining variants with runs for context
- [x] Implement Runs tab — query distinct runs that used this tactic (via `evolution_agent_invocations` where `tactic = tacticName`), display with run columns
- [x] Add server action `getTacticRunsAction` — paginated distinct run query

### Phase 6: Tactic Metrics — Elo Delta with Bootstrap CI
- [x] Add `avg_elo_delta` metric to `computeTacticMetrics()` in `evolution/src/lib/metrics/computations/tacticMetrics.ts` — compute per-variant `elo - 1200` (delta from default baseline), then use `bootstrapMeanCI()` with per-variant uncertainty to produce value + 95% CI
- [x] Upgrade `avg_elo` metric to use `bootstrapMeanCI()` instead of plain mean — propagate uncertainty from each variant's `sigma` (via `dbToRating`), produce `ci_lower`/`ci_upper` when 2+ variants
- [x] Add `win_rate` metric — `winner_count / total_variants` as a fraction (0-1), with binomial CI via `bootstrapMeanCI()` (treating each variant as 1/0 win indicator)
- [x] Update `TacticDetailContent.tsx` Metrics tab to display Elo Delta with CI (e.g., "+87 ±23") and Win Rate (e.g., "3.8% [1.2%, 6.4%]")
- [x] Update `TacticPromptPerformanceTable` to show Elo Delta column alongside existing Avg Elo
- [x] Add tactic metrics to the registry in `evolution/src/lib/metrics/registry.ts` if not already there — ensure `listView: true` for `avg_elo_delta`, `avg_elo`, `win_rate`, `total_variants` so they appear as columns on the tactics list page via `createMetricColumns('tactic')`

## Testing

### Unit Tests
- [x] `evolution/src/lib/schemas.test.ts` — test iterationConfigSchema accepts/rejects generationGuidance correctly (valid entries, swiss rejection, percentage validation)
- [x] `evolution/src/lib/pipeline/loop/runIterationLoop.test.ts` — test per-iteration guidance takes precedence over strategy-level; test fallback to strategy-level when per-iteration is undefined
- [x] `evolution/src/lib/core/Agent.test.ts` — verify that when rawProvider + defaultModel are set on ctx, Agent.run() builds a scoped LLM client and costScope.getOwnSpent() > 0 (existing test at line 258, verify it passes)
- [x] `evolution/src/lib/core/tactics/generateTactics.test.ts` — verify all tactics have valid definitions (existing, should still pass)
- [x] `src/components/admin/EvolutionSidebar.test.tsx` — verify Tactics nav item renders
- [x] **CREATE** `evolution/src/lib/metrics/computations/tacticMetrics.test.ts` — test avg_elo_delta computation with bootstrap CI, test win_rate, test avg_elo CI, test single-variant (no CI) edge case (this file does not exist yet)

### Integration Tests
- [x] **CREATE** `evolution/src/__tests__/integration/evolution-cost-attribution.integration.test.ts` — verify invocation cost_usd is non-zero after the rawProvider fix (this file does not exist yet, must be created following existing integration test patterns in that directory)

### E2E Tests
- [x] **CREATE** `src/__tests__/e2e/specs/09-evolution-admin/evolution-tactics-list.spec.ts` — verify tactics list page loads with items (after sync), sidebar shows Tactics link (follows existing naming convention in `09-evolution-admin/` directory)
- [x] **CREATE** `src/__tests__/e2e/specs/09-evolution-admin/evolution-strategy-wizard-tactics.spec.ts` — verify tactic guidance popover opens, percentages sum validation, dispatch preview updates. **Note:** existing `strategy-generation-guidance.spec.ts` in the same directory tests strategy-level generationGuidance; the new spec focuses on per-iteration guidance via the popover. Check for overlap and extend existing spec if appropriate rather than creating a duplicate.

### Manual Verification
- [x] Run syncSystemTactics against staging, verify 24 tactics appear in list view
- [x] Navigate to a tactic detail page, verify Overview/Metrics/By Prompt tabs render data
- [x] Create a strategy with per-iteration tactic guidance, verify config is saved and displayed correctly
- [x] Verify dispatch preview updates when changing budget/model/floors
- [x] Run a pipeline execution with per-iteration guidance, verify different tactics are used per iteration in the run logs

## Verification

### A) Playwright Verification (required for UI changes)
- [x] Tactics list page shows 24 items after sync
- [x] Sidebar shows Tactics link between Strategies and Runs
- [x] Tactic detail page renders Overview tab with preamble/instructions
- [x] Strategy wizard Step 2 shows "Configure Tactics" button on generate iterations
- [x] TacticGuidancePopover opens and shows 7 categories of tactics
- [x] Dispatch preview inline on each generate iteration row
- [x] Variants and Runs tabs render data on tactic detail page

### B) Automated Tests
- [x] `npm run test:unit -- --testPathPattern="schemas\\.test"` — schema validation
- [x] `npm run test:unit -- --testPathPattern="runIterationLoop\\.test"` — per-iteration guidance
- [x] `npm run test:unit -- --testPathPattern="Agent\\.test"` — cost scope wiring
- [x] `npm run test:unit -- --testPathPattern="EvolutionSidebar"` — nav items
- [x] `npm run test:integration -- --testPathPattern="cost-attribution"` — invocation cost (new test file)
- [x] `npm run test:unit -- --testPathPattern="tacticMetrics"` — bootstrap CI metrics (new test file)
- [x] `npx playwright test src/__tests__/e2e/specs/09-evolution-admin/evolution-tactics-list.spec.ts`

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [x] `evolution/docs/architecture.md` — update agent name references (generateFromSeedArticle → generateFromPreviousArticle), update tactic count if changed
- [x] `evolution/docs/data_model.md` — document per-iteration generationGuidance in iterationConfigSchema, update agent_name examples
- [x] `evolution/docs/strategies_and_experiments.md` — document per-iteration generationGuidance field, update StrategyConfig example, add wizard tactic guidance documentation
- [x] `evolution/docs/entities.md` — update TacticEntity agent_type filter reference
- [x] `evolution/docs/metrics.md` — note invocation cost_usd fix, document new tactic metrics (avg_elo_delta with CI, win_rate, upgraded avg_elo with CI)
- [x] `evolution/docs/visualization.md` — document Tactics sidebar entry, tactic guidance popover, dispatch preview, Variants/Runs tabs on tactic detail

## Rollback Plan
- **Phase 1 (cost bug)**: Revert the runIterationLoop.ts changes — restore shared `llm` creation and `input.llm` passing. Invocations will go back to $0 cost_usd (pre-existing bug), no data corruption.
- **Phase 2 (schema)**: The new `generationGuidance` field on `iterationConfigSchema` is optional. Existing configs without it parse identically. Revert = remove the field from the schema; existing DB rows are unaffected.
- **Phase 3-4 (wizard UI)**: Pure UI changes. Revert the page.tsx file. No backend impact.
- **Phase 5-6 (detail tabs + metrics)**: Revert the component and metrics computation changes. Existing metric rows in `evolution_metrics` from the old computation are overwritten by the next recompute cycle, so no stale data issues.
- **General**: All phases are committed separately with clear commit messages. `git revert <commit>` for any individual phase.

## Review & Discussion

### Iteration 1 (3/3/3 → fixes applied)
**Security & Technical (3/5):** 2 critical — cost bug fix underspecified (shared `llm` on input would override scoped client), `llmProvider` source unclear. **Fixed:** expanded Phase 1 cost bug item with 6 sub-steps enumerating all call sites, explicitly stating `input.llm` must be removed.

**Architecture & Integration (3/5):** 3 critical — cost fix call-site enumeration missing, schema refine chain insertion ambiguous, data flow for per-iteration guidance not traced. **Fixed:** added call-site details to Phase 1, clarified refine insertion in Phase 2, added data flow verification step tracing wizard → DB → schema parse → EvolutionConfig → runIterationLoop.

**Testing & CI/CD (3/5):** 3 critical — cost-attribution integration test doesn't exist (plan assumed it did), tacticMetrics unit test doesn't exist, E2E test paths used wrong directory convention. **Fixed:** marked all 3 as CREATE with correct paths (`09-evolution-admin/` for E2E), added rollback plan.

### Iteration 2 (4/4/4 → fixes applied)
**Security & Technical (4/5):** 0 critical. Minor: mergeCtx doesn't need rawProvider (usesLLM=false), verify SwissRankingAgent.usesLLM=true, confirm no other `llm` references in function beyond lines 378/532.

**Architecture & Integration (4/5):** 1 critical — plan's justification for removing input.llm was incorrect (Agent.run actually DOES override input.llm with scoped client via effectiveInput spread). **Fixed:** corrected justification to clarify that adding rawProvider to ctx IS the fix; removing input.llm is optional cleanup.

**Testing & CI/CD (4/5):** 3 critical — E2E overlap with existing strategy-generation-guidance.spec.ts, mock update instructions imprecise, AgentContext type extension concern. **Fixed:** noted E2E overlap and suggested extending existing spec if appropriate; clarified mock update (keep createEvolutionLLMClient mock for Agent.run's internal call, remove llm from input assertions); confirmed AgentContext already has rawProvider/defaultModel as optional fields in core/types.ts.

### Iteration 3 (5/5/5 → CONSENSUS)
**Security & Technical (5/5):** No critical gaps. Minor: skip mergeCtx rawProvider (usesLLM=false), coupled llm variable removal (either keep or remove both refs).

**Architecture & Integration (5/5):** No critical gaps. Minor: SwissRankingAgent inherits usesLLM=true (confirmed), z.object field insertion point clear from code.

**Testing & CI/CD (5/5):** No critical gaps. Minor: add buildRunContext.test.ts coverage for per-iteration validation, add tests for Phase 4 dispatch preview and Phase 5 server actions during implementation.
