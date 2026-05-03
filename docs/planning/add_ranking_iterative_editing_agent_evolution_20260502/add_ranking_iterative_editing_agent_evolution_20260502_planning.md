# Add Ranking to IterativeEditingAgent — Planning

## Background

The just-shipped `bring_back_editing_agents_evolution_20260430` project (PR #1020) ships `IterativeEditingAgent` with Decisions §14 explicitly forbidding arena ranking inside the agent ("editing emits ZERO `arena_comparisons` rows"). This was a deliberate v1 simplification — local ranking was to be deferred to a downstream `swiss` iteration.

This follow-up project revisits that decision. New editing variants currently land in the pool unranked; they don't surface until a later `swiss` iteration compares them. That delay is operationally awkward: dashboard surfaces show fresh editing variants with no Elo, dispatch decisions can't act on their relative quality, and the cost-attribution split between "edit cost" and "rank cost" stays opaque.

We follow the same `rankNewVariant()` pattern that `GenerateFromPreviousArticleAgent` already uses, and that `ReflectAndGenerateFromPreviousArticleAgent` inherits transitively via inner-GFPA delegation.

## Requirements (from user)

- Read the docs for iterative editing agent for evolution.
- Add ranking, and follow the pattern of `generateFromPreviousArticle` and `reflectThenGenerateFromPreviousArticle` for modularity.
- Adjust all components of the agent, including invocation detail view, as needed to accommodate this.

## Problem

`IterativeEditingAgent` produces one final `Variant` per parent (Decisions §14) but never ranks it locally. As a result:

1. Newly-edited variants have no Elo until a Swiss iteration runs (could be 1+ iterations later, or never if editing is the terminal iteration).
2. The `editingEligibilityCutoff` policy uses pre-iteration Elo for parent selection — fine — but downstream iterations can't use editing outputs as inputs to "top-N" heuristics until they're ranked.
3. The agent's `iterative_edit_cost` metric is a single bucket; once we add ranking, we need to surface ranking cost separately to keep operational visibility (per-purpose split mirrors the existing Proposer / Approver / DriftRecovery split).
4. The invocation detail view has no `ranking` section — so even when a future Swiss iteration ranks an editing variant, there's no per-invocation surface tying the comparisons to the editing run.

## Options Considered

(To be expanded during /plan-review.)

- **Option A — Extract a shared `rankVariant()` helper.** Lift the local-ranking logic out of `GenerateFromPreviousArticleAgent` into a reusable helper module. Both agents call it. Cleanest abstraction; biggest blast radius for the existing agent.
- **Option B — Inner-GFPA delegation.** Mirror `reflect_and_generate`: at the end of editing, call `GenerateFromPreviousArticleAgent.execute()` solely for its rank step. Reuses an existing entry point but feels like an abuse of the wrapper pattern (no actual generation happens).
- **Option C — Inline `rankNewVariant()` call.** Add a direct `rankNewVariant()` call after the cycle loop terminates, gated on `appliedCount > 0`. Smallest change, least abstraction; duplicates orchestration logic.

Tentative lean: **Option A** for the shared-helper extraction, since editing has materially different cost-tracking semantics than generation (per-purpose split with new `rank_cost` field) — Option B would force editing to inherit GFPA's metric shape.

## Decisions Locked (initial — to refine via /plan-review)

(None yet — fill in during planning phase.)

## Phased Execution Plan

(High-level placeholder; expand via `/plan-review` and `/plan-walkthrough`.)

### Phase 1 — Schema + types
- [ ] **1.1** Add `ranking` sub-object to `iterativeEditingExecutionDetailSchema` (Zod) mirroring the GFPA shape: `{ cost, surfaced, comparisons: Array<{...}>, durationMs }`.
- [ ] **1.2** Mirror in `IterativeEditingExecutionDetail` TS type.
- [ ] **1.3** Update `executionDetailFixtures.iterativeEditingDetailFixture` to include realistic ranking data.
- [ ] **1.4** Update schema tests to cover the new shape (parses correctly, fixture conforms).

### Phase 2 — Shared `rankVariant()` helper (or chosen approach)
- [ ] **2.1** Decide approach (A / B / C above) via /plan-review.
- [ ] **2.2** Implement helper / refactor / inline call.
- [ ] **2.3** Wire into `IterativeEditingAgent.execute()` after the cycle loop terminates.
- [ ] **2.4** Add unit test coverage for the new ranking step (mocked LLM judge).

### Phase 3 — Cost + estimator
- [ ] **3.1** Update `estimateIterativeEditingCost()` to add `+ rankingCost(judgeModel)`.
- [ ] **3.2** Add `rankingCostUsd` to the per-cycle execution detail (or top-level if ranking happens once after all cycles).
- [ ] **3.3** Verify `EstPerAgentValue.editing` upper-bound covers the new cost.
- [ ] **3.4** Add unit test for the estimator delta.

### Phase 4 — Pipeline integration
- [ ] **4.1** Confirm `MergeRatingsAgent` already merges editing-iteration buffers (post-bring-back widening).
- [ ] **4.2** If not, add the wiring in `runIterationLoop.ts`.
- [ ] **4.3** Add integration test: mock-LLM `evolveArticle` end-to-end with a 1×generate + 1×iterative_editing strategy, assert editing variants have non-default Elo + uncertainty after the run.
- [ ] **4.4** Revisit Decisions §14 in the prior project's planning doc — link to this project as the explicit follow-up.

### Phase 5 — Invocation detail UI
- [ ] **5.1** Add `ranking` field type entries to `DETAIL_VIEW_CONFIGS['iterative_editing']` mirroring the GFPA `ranking` block (cost, surfaced flag, comparisons table).
- [ ] **5.2** Verify `ConfigDrivenDetailRenderer` handles the new fields without changes (it should — `'object'` + `'table'` field types already exist).
- [ ] **5.3** RTL test for the editing detail view rendering with the new ranking section.

### Phase 6 — Docs + finalize
- [ ] **6.1** Update `docs/feature_deep_dives/editing_agents.md` — Algorithm section gets a step 6 ("Rank final variant"); Cost tracking section gets the new ranking line; Decisions §14 note updated to reflect the change.
- [ ] **6.2** Update `evolution/docs/agents/overview.md` if needed (depends on Option chosen).
- [ ] **6.3** E2E spec update: `admin-evolution-iterative-editing.spec.ts` — change the assertion from "ZERO `arena_comparisons` rows" to ">=N rows where N matches expected ranking comparisons".
- [ ] **6.4** Run `/finalize`.

## Testing

### Unit Tests
(To enumerate after Phase 2 design lock.)

### Integration Tests
- `evolution/src/__tests__/integration/evolution-iterative-editing-agent.integration.test.ts` — extend existing test to assert post-run editing variants have non-default Elo.

### E2E Tests
- `src/__tests__/e2e/specs/09-admin/admin-evolution-iterative-editing.spec.ts` — flip the §14 assertion (zero arena rows → some arena rows). Tagged `@evolution`, runs in production E2E only.

### Manual Verification
Spawn a real-LLM run with editing enabled, confirm in admin UI that editing-iteration variants have Elo badges populated.

## Verification

(Filled during /plan-review.)

## Documentation Updates

- `docs/feature_deep_dives/editing_agents.md`
- `evolution/docs/agents/overview.md` (if shared helper changes the agent surface)
- The prior project's planning doc — append a "Decisions §14 superseded by `add_ranking_iterative_editing_agent_evolution_20260502`" note.

## Review & Discussion

(To be filled during /plan-review iterations.)
