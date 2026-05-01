# Bring Back Editing Agents Evolution Research

## Problem Statement

The V2 evolution pipeline currently has only two work-agent types — `GenerateFromPreviousArticleAgent` (full-article regeneration) and `SwissRankingAgent` (pairwise ranking) — plus the seed agent and `MergeRatingsAgent`. There is no agent that performs targeted edits, decomposes an article into sections for parallel editing, or restructures via an outline. Three V1 agents that covered these gaps were deleted in commit `4f03d4f6` (2026-03-14, M8 of `rebuild_evolution_cleanly_20260314`) and never ported. This project brings them back.

## Requirements (from GH Issue #NNN)

I want to reintroduce some of the editing agents we've had historically. Please look through github history and find the various editing agents including iterativeediting agent and outline editing agent

## High Level Summary

Five rounds of research (4 parallel agents per round = 20 agent investigations) confirm: **the path is mostly paved**. Most foundational work is already in the V2 tree as orphaned scaffolding from V1. We are not designing new agent types — we are porting V1 agents to the V2 `Agent<TInput, TOutput, TDetail>` base class.

Key takeaways:
- **3 V1 editing agents existed:** `IterativeEditingAgent` (intro `8f254eec` 2026-02-04, 336 LOC + 473-LOC test + V1 deep-dive doc), `OutlineGenerationAgent` (4-step pipeline, 317 LOC), `SectionDecompositionAgent` (224 LOC + helper suite). All deleted at `4f03d4f6`. All were production-mature (multiple modification commits between intro and deletion: action-dispatch refactor, mu/sigma migration, reorganization).
- **Orphaned scaffolding survives:** Zod schemas (`iterativeEditingExecutionDetailSchema` lines 660–686, `sectionDecompositionExecutionDetailSchema` 725–740, `outlineGenerationExecutionDetailSchema` 780–791), `DETAIL_VIEW_CONFIGS` entries, the `agentExecutionDetailSchema` discriminated union slot, and the `InvocationEntity.listFilters` agent-name dropdown options for all 3 agents are already in `evolution/`.
- **Pre-built fixtures exist:** `evolution/src/testing/executionDetailFixtures.ts` already contains `iterativeEditingDetailFixture`, `sectionDecompositionDetailFixture`, and `outlineGenerationDetailFixture`. They match the orphaned schemas.
- **Critical gaps:** `'text-diff'` field type not in `DetailFieldDef` union; `recordSnapshot()` hardcodes `iterationType: 'generate' | 'swiss'`; `evolution_cost_calibration.phase` CHECK constraint locked to 4 values (needs migration).
- **Two prior abandoned branches:** `feat/create_editing_agent_evolution_20260415` (skeleton only); `feat/introduce_editing_agent_evolution_20260421` (fleshed-out 7-phase plan, ~700 lines of planning + research). The latter is the direct ancestor of this project.

## Documents Read

### Core docs
- `docs/docs_overall/getting_started.md`
- `docs/docs_overall/architecture.md`
- `docs/docs_overall/project_workflow.md`
- All 14 docs under `evolution/docs/**/*.md`

### Auto-discovered + manually tracked
- `docs/feature_deep_dives/multi_iteration_strategies.md`
- `docs/feature_deep_dives/variant_lineage.md`
- `docs/feature_deep_dives/evolution_metrics.md`
- `docs/planning/iterative_editing_agent_20260203/iterative_editing_agent_20260203_planning.md` (V1 plan)
- `docs/planning/iterative_editing_agent_20260203/iterative_editing_agent_20260203_research.md` (V1 research)

### From git
- Abandoned-branch artifacts via `git show feat/introduce_editing_agent_evolution_20260421:docs/planning/introduce_editing_agent_evolution_20260421/...{planning,research}.md`
- V1 source via `git show 8f254eec:` and `git show 4f03d4f6^:`

## Code Files Read

V2 current tree (sampling): `evolution/src/lib/core/Agent.ts`, `evolution/src/lib/core/agents/{generateFromPreviousArticle,SwissRankingAgent,MergeRatingsAgent,createSeedArticle}.ts`, `evolution/src/lib/core/agentRegistry.ts`, `evolution/src/lib/core/agentNames.ts`, `evolution/src/lib/schemas.ts`, `evolution/src/lib/core/detailViewConfigs.ts`, `evolution/src/lib/core/entities/InvocationEntity.ts`, `evolution/src/lib/pipeline/loop/runIterationLoop.ts`, `evolution/src/lib/pipeline/loop/projectDispatchPlan.ts`, `evolution/src/lib/pipeline/infra/{trackBudget,createEvolutionLLMClient,estimateCosts,costCalibrationLoader}.ts`, `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts`, `evolution/src/lib/metrics/{registry,types,writeMetrics}.ts`, `evolution/src/lib/core/metricCatalog.ts`, `evolution/src/lib/shared/{rating,reversalComparison,computeRatings,ratingDelta}.ts`, `evolution/src/components/evolution/{visualizations/TextDiff,sections/VariantLineageSection,variant/VariantParentBadge,DispatchPlanView,tabs/{TimelineTab,VariantsTab,CostEstimatesTab,LogsTab,InvocationParentBlock,InvocationTimelineTab}}.tsx`, `evolution/src/services/{strategyPreviewActions,strategyRegistryActions,invocationActions}.ts`, `evolution/src/testing/{v2MockLlm,evolution-test-helpers,executionDetailFixtures}.ts`, `src/app/admin/evolution/{strategies/new,invocations/[invocationId],variants/[variantId],runs/[runId]}/...`.

V1 source via `git show <sha>:<path>`: `iterativeEditingAgent.ts`, `iterativeEditingAgent.test.ts`, `outlineGenerationAgent.ts`, `sectionDecompositionAgent.ts`, `section/{sectionParser,sectionStitcher,sectionEditRunner}.ts`, `shared/diffComparison.ts`, `pipeline/evolve.ts` (mutate_clarity / mutate_structure / crossover / creative_exploration prompts).

---

## Round 1 — Historical Archaeology

**Timeline:** V1 editing agents lived ~Feb 4 → Mar 14, 2026, receiving 4–6 modification commits each (action-dispatch refactor, mu/sigma migration, reorg). All deleted 2026-03-14 in `4f03d4f6`. 971 V1 tests deleted in the same purge.

**The 3 historical editing agents:**

| Agent | Intro SHA | Deleted SHA | LOC | Tests | Notes |
|---|---|---|---|---|---|
| `IterativeEditingAgent` | `8f254eec` (2026-02-04) | `4f03d4f6` | 336 | 473 (21 cases) | Critique → edit → blind diff-judge with 2-pass direction reversal |
| `OutlineGenerationAgent` | `8ae43a20` (2026-02-15) | `4f03d4f6` | 317 | 90 | 4-step: outline → expand → polish → verify (each scored 0–1) |
| `SectionDecompositionAgent` | `3d8e3d4e` (2026-02-06) | `4f03d4f6` | 224 + 246 helpers | 286 | Parse H2s → parallel per-section edits → stitch → format-validate |

**Other V1 agents at deletion** (per Round 1D's complete inventory of `git ls-tree -r 4f03d4f6^ -- evolution/src/lib/agents/`): `base.ts`, `calibrationRanker.ts`, `debateAgent.ts`, `evolvePool.ts`, `formatRules.ts`, `formatValidator.ts`, `generationAgent.ts`, `metaReviewAgent.ts`, `pairwiseRanker.ts`, `proximityAgent.ts`, `rankingAgent.ts`, `reflectionAgent.ts`, `tournament.ts`, `treeSearchAgent.ts`. Plus 4 `evolveVariants()` tactics from V1 `evolve.ts`: `mutate_clarity`, `mutate_structure`, `crossover`, `creative_exploration` (verbatim prompts captured).

**`debateAgent` is also editing-flavored** (synthesis from 2 parents → 1 variant, crossover-shaped) but its V1 implementation was less mature than the 3 above; not in scope for v1 of this project.

**Unmerged remote branches:** `feat/iterative_editing_agent_20260203`, `feat/new_edit_operator_20260201`, `feat/outline_based_generation_editing_20260206` are stale snapshots (1024+ commits divergent from main) — superseded by what eventually shipped on main, then deleted. Not missed work. Plus two recent abandoned local branches (`feat/create_editing_agent_evolution_20260415` skeleton-only, `feat/introduce_editing_agent_evolution_20260421` with fleshed plan).

**V1 features the abandoned plan understates:** `attemptedTargets: Set<string>` — V1 deduplicated edit targets within a single execution; abandoned plan doesn't carry this forward. Worth preserving.

**The `outline_based_generation_editing_20260206` branch invented step-targeted mutation** — re-edit only the weakest step of the outline pipeline (e.g., if `polish` scored 0.3, re-edit polish only). Worth preserving as a v1.1 feature.

---

## Round 2 — V2 Integration Audit

### Agent base class (`evolution/src/lib/core/Agent.ts`)

`abstract class Agent<TInput, TOutput, TDetail>` with `run()` template lifecycle:

1. Capture `startMs` BEFORE invocation creation (Bug B047 fix: prevents under-counting duration).
2. Create invocation row via `createInvocation()`.
3. Build per-invocation `AgentCostScope` via `createAgentCostScope(ctx.costTracker)` — wraps shared tracker, adds `getOwnSpent()` for parallel-safe per-invocation cost attribution.
4. When `usesLLM=true`, build scoped `EvolutionLLMClient` from `ctx.rawProvider`, inject into `effectiveInput.llm`. FK threading via 7th param (gated by `EVOLUTION_FK_THREADING_ENABLED`, default true).
5. Call abstract `execute()`.
6. Validate `executionDetailSchema.safeParse(detail)`; on failure, mark `success: false` with first 3 validation errors as `error_message` (Bug B051 fix).
7. `updateInvocation()` writes `cost_usd`, `success`, `execution_detail`, `duration_ms`, `error_message`.
8. Catch `BudgetExceededError` and `BudgetExceededWithPartialResults` (subclass MUST be checked first).

**Required subclass fields:** `name`, `executionDetailSchema`, `detailViewConfig`, `usesLLM` (default true), `execute()`. Optional: `invocationMetrics`, `getAttributionDimension()`.

### Orphaned Zod schemas — all 8 confirmed in `evolution/src/lib/schemas.ts`

| Schema | Lines | Notes |
|---|---|---|
| `iterativeEditingExecutionDetailSchema` | 660–686 | Has `cycles[]` with `{cycleNumber, target, verdict, confidence, formatValid, newVariantId}`, `initialCritique`/`finalCritique`, `stopReason` enum |
| `sectionDecompositionExecutionDetailSchema` | 725–740 | Has `sections[]`, `sectionsImproved`, `totalEligible`, `formatValid`, `newVariantId?` |
| `outlineGenerationExecutionDetailSchema` | 780–791 | Has `steps[]`, `weakestStep`, `variantId`, `totalCost` |
| `reflectionExecutionDetailSchema` | 688–701 | (Reflection support if needed) |
| `debateExecutionDetailSchema` | 703–723 | (Debate support if needed) |
| `treeSearchExecutionDetailSchema` | 758–778 | (Not in scope) |
| `proximityExecutionDetailSchema` | 822–828 | (Not in scope) |
| `metaReviewExecutionDetailSchema` | 830–844 | (Not in scope) |

**Discriminated union:** `agentExecutionDetailSchema` at lines 1107–1123 includes all 8.

**Drift findings:**
- `low_sigma_opponents_count` in `rankingExecutionDetailSchema` line 819 vs `low_uncertainty_opponents_count` in `detailViewConfigs.ts` line 166 — **separate cleanup item**.
- All 3 editing fixtures in `executionDetailFixtures.ts` parse cleanly against their respective schemas.

### Field types & `text-diff`

`evolution/src/lib/core/types.ts:187–194` defines `DetailFieldDef`:

```typescript
export interface DetailFieldDef {
  key: string;
  label: string;
  type: 'table' | 'boolean' | 'badge' | 'number' | 'text' | 'list' | 'object';
  columns?: Array<{ key: string; label: string }>;
  children?: DetailFieldDef[];
  formatter?: string;
}
```

**`'text-diff'` is not in the union — confirmed missing.**

### Orchestrator (`evolution/src/lib/pipeline/loop/runIterationLoop.ts`, 826 LOC)

- **Generate branch:** lines 316–639. Pattern: parallel batch via `Promise.allSettled` → top-up loop → single `MergeRatingsAgent` call with `iterationType: 'generate'`.
- **Swiss branch:** lines 640–742. Pattern: per-round Swiss agent → `MergeRatingsAgent` UNCONDITIONAL after each round (paid-for matches must reach global ratings).
- **`recordSnapshot()` at lines 83–115 hardcodes `iterationType: 'generate' | 'swiss'`** — must be widened.

`projectDispatchPlan.ts` Swiss returns zero-cost dispatch entry (`effectiveCap: 'swiss'`). Constants: `DISPATCH_SAFETY_CAP = 100`, `EXPECTED_GEN_RATIO = 0.7`, `EXPECTED_RANK_COMPARISONS_RATIO = 0.5`, `DEFAULT_SEED_CHARS = 8000`.

### Metrics & cost

- `AGENT_NAMES` const (`agentNames.ts` line 10): `['generation', 'ranking', 'seed_title', 'seed_article', 'evolution']`. Adding 3 new names is the cleanest path. Trade-off: granular labels (e.g. `iterative_edit_generation` / `_critique` / `_judge`) enable per-phase calibration; consolidated labels keep registry simple. Round 5B chose consolidated.
- `COST_METRIC_BY_AGENT` mapping at lines 22–27 — 4 entries. Need `iterativeEditing → iterative_edit_cost` etc.
- 9 new metric defs needed: 3 during-execution (`iterative_edit_cost`, `section_decomposition_cost`, `outline_generation_cost`) + 6 propagation (total + avg per agent).
- `InvocationEntity.listFilters` agent-name dropdown **already includes** `iterativeEditing`, `sectionDecomposition`, `outlineGeneration` (12 entries total at lines 49–54). No UI change needed.
- `iterationAgentTypeEnum` at `schemas.ts` line 388: `z.enum(['generate', 'swiss'])` — must widen.
- 4 refines on `iterationConfigSchema` (lines 413–425) guard sourceMode/qualityCutoff/generationGuidance for swiss — extend for editing.

---

## Round 3 — UI Surface Audit

### Strategy wizard (`src/app/admin/evolution/strategies/new/page.tsx`, 1008 LOC)

- `IterationRow` interface lines 34–46, `IterationConfigPayload` lines 73–79 — extend `agentType` union.
- `<select>` at lines 814–823 — add 3 new options.
- **`sourceMode` rendering at lines 853–903 is the exact template to copy for `outlineMode`** (conditional sub-field for `agentType === 'outline'`).
- Budget bar colors at lines 947–962 hardcode gold (generate) / copper (swiss) — add 3 new colors.
- Validation logic at lines 360–390 — extend "first must be generate" to allow `outline + outlineMode='generate'` as first iteration.
- `DispatchPlanView.tsx` lines 117–119 hardcode blue (generate) / purple (swiss) badges — add 3 new colors.

### Invocation detail UI

- `InvocationDetailContent.tsx:11` hardcodes `TIMELINE_AGENTS = new Set(['generate_from_previous_article'])` — Timeline tab gated.
- `ConfigDrivenDetailRenderer.tsx` has 7 `case` branches; adding `'text-diff'` is ~10 LOC.
- `InvocationParentBlock.tsx` is the natural insertion point for `<TextDiff>` — currently shows parent ID, ELO, delta CI but not content.
- `getInvocationVariantContextAction` at `invocationActions.ts:156–221` does NOT currently include `variant_content` for either variant — exact ~8 LOC change to add both.
- `<TextDiff>` at `evolution/src/components/evolution/visualizations/TextDiff.tsx` (130 LOC, `'use client'`) takes `original`, `modified`, `previewLength?` props. Uses `diffWordsWithSpace` from `diff` npm package. Already used in `VariantLineageSection`.

### Variant detail / lineage / diff infrastructure

- `VariantLineageSection.tsx` (253 LOC) is the canonical pattern: full chain rendering with per-hop `<TextDiff>` collapsibles + pair-picker + children list. **Direct copy/wrap for editing-agent invocation timeline.**
- `VariantParentBadge.tsx` (129 LOC) is mutation-agnostic — already used in 5+ surfaces. Reusable as-is.
- `bootstrapDeltaCI` at `ratingDelta.ts` (66 LOC) — pure server-safe. Reusable.
- `RenderCriticMarkupFromMDAstDiff` at `src/editorFiles/markdownASTdiff/markdownASTdiff.ts` (1091 LOC) is server-safe (no `'use client'`). Available if we eventually want MDAST-format judge prompts (deferred to v1.1).

### Run detail / dashboard

- `TimelineTab.tsx` `agentKind()` at lines 29–35 hardcodes `generate|swiss|merge|other` — needs `'edit'` case.
- `VariantsTab.tsx` Parent column already handles `parent_variant_id` + Elo delta CI — auto-supports editing variants.
- `CostEstimatesTab.tsx` lines 418–421 infers agent type from name — extend with `else if (name.includes('edit'))`.
- LogsTab is free-text agent filter — auto-supports new agents.
- Dashboard auto-renders `listView: true` metrics via `createMetricColumns()` — adding `total_iterative_edit_cost: { listView: true }` surfaces it with no UI changes.

---

## Round 4 — Cost, Testing, Friction, Bias

### Cost model + calibration

- `EMPIRICAL_OUTPUT_CHARS` map (`estimateCosts.ts:17–49`) has 27 tactic entries, `DEFAULT_OUTPUT_CHARS = 9197`. New tactics fall through to default cleanly.
- **`evolution_cost_calibration.phase` CHECK constraint locked to 4 values** (`migration 20260414000001`): `'generation','ranking','seed_title','seed_article'`. Needs SQL migration to add new phases.
- `refreshCostCalibration.ts` `Phase` type literals are hardcoded — needs code update too.

**Cost per agent invocation (gpt-4.1-mini pricing, 5000-char seed):**

| Agent | Estimated Cost | Verdict at 30% of $0.15 budget ($0.045) |
|---|---|---|
| IterativeEditing 3 cycles | $0.0464 | **TIGHT** (-3%) |
| IterativeEditing 2 cycles | $0.0310 | Safe (+31%) |
| SectionDecomposition (5 sec × 2) | $0.0187 | Comfortable (+58%) |
| OutlineGeneration generate | $0.0255 | Comfortable (+43%) |
| OutlineGeneration edit (2/5 changed) | $0.0133 | Very comfortable (+70%) |

**Recommendation:** Default IterativeEditing maxCycles = 2 in v1; bump to 3 only when iteration budget ≥ 40%.

### Testing infrastructure

- 4 V2 agent test files, 51 cases total, all use `v2MockLlm` + `makeCtx()` helpers.
- `executionDetailFixtures.ts` already has fixtures for the 3 editing agents — pre-built and parsing cleanly.
- 504 total test cases would result with ~53 new tests (12% increase).
- Property-based tests at `computeRatings.property.test.ts`, `trackBudget.property.test.ts`, `enforceVariantFormat.property.test.ts` — fast-check pattern. Recommend properties: CriticMarkup idempotency, accept→pool monotonicity, rejection-streak finiteness.
- E2E pattern: seed strategy/prompt/run → trigger via API → poll DB → navigate UI → assert. Cap LLM by mocking via `nock` to avoid flakiness.

### `Match.frictionSpots` — DEFERRED

- `Match.frictionSpots?: { a: string[]; b: string[] }` exists in type at `evolution/src/lib/types.ts:123–132` but is **not** in the V2Match Zod schema.
- **Never produced** in current pipeline — no LLM prompt asks judges to identify friction spots.
- **Never consumed** — `getVariantFrictionSpots` and `formatFrictionSpots` helpers exist in `evolution/src/lib/pipeline/loop/frictionSpots.ts` but have zero call sites outside their own test file.
- DB doesn't persist them — `evolution_arena_comparisons` has no column.
- Conclusion: **dead code on both ends**. Defer to v1.1 follow-up project.

### Bias mitigation / judge format

- `run2PassReversal<TParsed, TResult>` at `evolution/src/lib/shared/reversalComparison.ts` (computeRatings.ts:281–299) is generic — reusable for editing judge.
- V1 used CriticMarkup MDAST format (1091 LOC dependency, dynamic `import()` for `unified`/`remark-parse` to avoid ESM contamination — proven precedent).
- Word-diff alternative: 280 LOC vs CriticMarkup's 450 LOC. Token cost: ~3500 vs ~4800 per 2-pass judgment (~$0.0005 difference at gpt-4.1-nano).
- Direction-reversal truth table validated for editing context: ACCEPT+REJECT → ACCEPT (1.0); REJECT+ACCEPT → REJECT (1.0); both ACCEPT → UNSURE (0.5, framing bias); both REJECT → UNSURE (0.5); any UNSURE → UNSURE (0.3).
- **Recommendation:** ship word-diff in v1, MDAST as v1.1 follow-up. No env var (we're not A/B testing).

---

## Round 5 — Synthesis

### Risk register (29 risks across 8 categories — full list in research notes)

**Top high-priority items:**

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|------------|--------|------------|
| P1 | `recordSnapshot()` hardcoded `iterationType` | High | High | Widen union, update 4 call sites |
| C1 | Cost under-estimation for new agents | High | High | Calibrate on 50 shadow-deploy runs before rollout; default maxCycles=2 |
| C2 | `evolution_cost_calibration.phase` CHECK constraint blocks new phases | High | High | DB migration + `refreshCostCalibration.ts` `Phase` literal update |
| T1 | Orphaned schema fixtures may have drifted | Medium | High | Run `z.parse(fixture)` for each fixture in test bootstrap |
| D1 | V1 deep-dive doc deleted, full re-create | High | Medium | Create `docs/feature_deep_dives/editing_agents.md` |
| PR1 | Backward compat with active strategies | Medium | High | Audit all 5 active strategies; add migration test deserializing legacy configs |
| B1 | Editing agents amplify bad critiques | Medium | High | Add critique-quality validation; log rejected critiques |

### Open questions resolved (full rationale in agent reports)

| # | Question | Decision | v1 LOC |
|---|----------|----------|--------|
| 1 | Naming | Keep `'iterativeEditing'` internally; expose `'editing'` externally | 16 |
| 2 | Parent selection | Top-K via optional `editingTopK` (default = parallel batch size) | 25 |
| 3 | Tactics per cycle | V1 dimension-picking; no `editingGuidance` | 50 |
| 4 | Judge format | Word-diff; MDAST as follow-up; no env var | 150 |
| 5 | `frictionSpots` wiring | **Defer entirely to v1.1** (dead code on both ends) | 0 |
| 6 | Merge compat | Reuse `iterationType: 'generate'` (semantically identical) | 10 |
| 7 | Per-cycle invocation timeline | **Defer to v1.1** (cycles already in `execution_detail`; component redesign) | 0 |

### MVP scope: Variant A (IterativeEditingAgent only, fully fleshed)

Decisive over Variant B (all-three skeletal):
- 4-week timeline is realistic; team ships on-time.
- Quality > breadth: deep focus on one agent → better tests, docs, understanding.
- User sees editing in 4 weeks (not 8–9).
- Risk isolation: production bug affects 1 agent, not 3.
- Knowledge compounds: ship → real feedback → iterate on Outline + Section design.

**Same total timeline either way** — Variant A staged ships all three by day ~84, matching aggressive Variant B's risk-loaded single-PR ship.

### V1.1 / v1.2 follow-ups (explicitly deferred)

- `OutlineGenerationAgent` (generate-only first, edit-mode in v1.2)
- `SectionDecompositionAgent`
- `Match.frictionSpots` production + consumption
- CriticMarkup MDAST judge (alternative to word-diff)
- Per-cycle invocation timeline UI
- Step-targeted mutation (re-edit only the weakest step of the outline pipeline — pulled forward from `feat/outline_based_generation_editing_20260206`)

## Open Questions (post-research)

1. **Test count target.** V1 had 21 cases for IterativeEditingAgent; abandoned plan listed ~17. We should commit to ≥21 to avoid coverage regression.
2. **Cost calibration deploy order.** DB migration before agent code, or after? Roll-forward strategy needs clarification in /plan-review.
3. **Feature flag default.** `EDITING_AGENTS_ENABLED=true` (opt-out) or `false` (opt-in for staging only)?

These get pinned during /plan-review.
