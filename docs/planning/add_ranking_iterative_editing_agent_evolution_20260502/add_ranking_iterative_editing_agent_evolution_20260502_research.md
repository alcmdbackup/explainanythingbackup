# Add Ranking to IterativeEditingAgent — Research

## Problem Statement

I want to add a ranking step to iterative editing agent, since its missing it currently.

## Requirements (from user)

Read the docs for iterative editing agent for evolution. Add ranking, and then follow the pattern of generateFromPreviousArticle and reflectThenGenerateFromPreviousArticle to see how to do it in a modular way.

Adjust all components of agent, including invocation detail view as needed to accommodate this.

## Starting Context (already known from prior project)

The just-shipped `feat/bring_back_editing_agents_evolution_20260430` (PR #1020) deliberately decided in §14: *"editing emits ZERO `arena_comparisons` rows"*. This project revisits that decision and adds local arena ranking to the agent's output variants.

Today's state in the codebase:

- **`generate` (`GenerateFromPreviousArticleAgent`)**: writes a new variant, then calls `rankNewVariant()` (binary-search Elo against pool). Produces `arena_comparisons` rows via `MergeRatingsAgent` at iteration end.
- **`reflect_and_generate`**: 1 LLM tactic-ranking call → calls `GenerateFromPreviousArticleAgent.execute()` internally. Inherits ranking transitively.
- **`iterative_editing`** (this project's target): runs Proposer / pre-check / Approver / Implementer cycles, emits one final variant per parent, but **never ranks it** against the pool. New variants land unranked; their first comparisons happen in a downstream `swiss` iteration.

The wrapper-pattern precedent (PR #1017's `reflect_and_generate` invariant: one invocation row per parent, no nested `Agent.run()`) constrains how the new ranking step must be wired.

## Documents Read

### Core docs
- `docs/docs_overall/getting_started.md`
- `docs/docs_overall/project_workflow.md`

### Auto-discovered + manually tracked
- `evolution/docs/rating_and_comparison.md` — Elo ratings, `rankSingleVariant` binary-search algorithm, two-phase orchestrator-driven ranking model
- `docs/feature_deep_dives/editing_agents.md` — current IterativeEditingAgent algorithm + Decisions §13-§18
- `evolution/docs/architecture.md` — V2 pipeline, iteration loop dispatch, agent registry
- `evolution/docs/agents/overview.md` — Agent class details, `rankNewVariant()` patterns, cost/invocation tracking
- `evolution/docs/arena.md` — `arena_comparisons` schema and lifecycle

## Open Research Questions (to fill in via `/research`)

1. **Where does the ranking step go in the Proposer / Approver / Implementer cycle structure?** Options: (a) rank only the FINAL surviving variant once, mirroring `generate`; (b) rank intermediate cycle outputs (likely too expensive); (c) rank only when `appliedCount > 0` AND format-valid (the conditions for emitting a final variant).
2. **Cost reservation impact.** `estimateIterativeEditingCost()` today doesn't include ranking cost. The estimator needs an additional `+ rankingCost(judgeModel)` term. Does this push parallel dispatch over the safety cap on tight budgets?
3. **Wrapper-pattern faithfulness.** `reflect_and_generate` calls `GenerateFromPreviousArticleAgent.execute()` directly to inherit ranking. Should `IterativeEditingAgent` do the same — refactor the propose/review/apply loop to produce a `Variant`, then call `GenerateFromPreviousArticleAgent.execute()` only for the rank step? Or is the right pattern to extract a shared `rankVariant()` helper that both agents call?
4. **Surface/discard decision.** `GenerateFromPreviousArticleAgent` discards if the new variant's local Elo falls below the top-15% cutoff. Should editing inherit that policy? Editing is more expensive per variant (multiple LLM calls), so discarding may be too punishing.
5. **`arena_comparisons` row writes.** Does the existing `MergeRatingsAgent` dispatch path already cover editing iterations after `iterationType` was widened in `bring_back_editing_agents_evolution_20260430`? Or does additional wiring need to happen in `runIterationLoop.ts` to flush the editing iteration's rank-match buffer?
6. **Execution detail schema impact.** The current `iterativeEditingExecutionDetailSchema` has no `ranking` sub-object (unlike `generateFromPreviousArticleExecutionDetailSchema`). The detail view will need a new `ranking` field with cost + comparisons table, mirroring the existing GFPA detail.
7. **`EDITING_AGENTS_ENABLED` rollout semantics.** Editing currently lands dormant in production (`EDITING_AGENTS_ENABLED='false'`). Adding ranking should not change rollout — but the new ranking cost should be flagged separately for staging calibration.

## V1 / Prior-Art Reminders

- Decisions §13 (wrapper pattern), §14 (one-variant-per-invocation, zero arena_comparisons) are LOAD-BEARING for the prior project. §14 is the one this project explicitly revisits.
- `MergeRatingsAgent.iterationType` was widened to include `'iterative_editing'` post-bring-back. This unblocks the rank-match merge path; the question is whether editing actually feeds it.
- All LLM-call labels (`iterative_edit_propose`, `iterative_edit_review`, `iterative_edit_drift_recovery`) collapse into a single `iterative_edit_cost` metric. The new ranking cost should follow the existing `ranking` metric naming (it's a `ranking`-phase call against `judgeModel`, not a new editing-phase phase string).
