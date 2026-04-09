# Investigate Recent Evolution Runs Research

## Problem Statement
This project investigates recent evolution pipeline runs to verify the parallel generate-rank architecture (implemented in generate_rank_evolution_parallel_20260331) is working correctly in production. We will analyze run data end-to-end including agent invocations, structured logs, and metrics to identify any bugs or deviations from the expected behavior. The goal is to debug pipeline issues and ensure the orchestrator-driven iteration model (generate → swiss → swiss → ...) is functioning as designed.

## Requirements (from GH Issue #NNN)
Look at runs end-to-end including invocations, logs, metrics and explore if it's working properly as per our plan file in generate_rank_evolution_parallel_20260331.

## High Level Summary

Both investigated runs (c4057835 and eb62d393) completed with `status=completed` and `stopReason=budget_exceeded` on a $0.05 budget cap. The parallel generate-rank architecture is structurally working (generate → swiss iterations fire correctly), but three significant bugs were identified:

1. **FK violation bug** — `MergeRatingsAgent` writes `evolution_arena_comparisons` rows during the run loop using variant IDs as `entry_a`/`entry_b`, but new variants aren't persisted to `evolution_variants` until `finalizeRun` at the end. This causes FK constraint failures for all comparisons involving newly generated variants.

2. **LLM 60s timeout** — Multiple LLM calls in both generation and ranking agents hit the 60-second timeout (`totalAttempts=1`). No retry logic. These timeouts directly reduce ranking coverage and inflate costs.

3. **`muHistory` identical across iterations** — From invocation data, top-5 mu values in `muHistory` are the same across all iterations, suggesting the pool's mu isn't being updated correctly between iterations (possible stale rating propagation).

## Runs Investigated (Staging)

| Field | c4057835 | eb62d393 |
|---|---|---|
| Status | completed | completed |
| Stop reason | budget_exceeded | budget_exceeded |
| Budget cap | $0.05 | $0.05 |
| Iterations | 2 (1 gen + 1 swiss) | 4 (1 gen + 3 swiss) |
| Total matches | 17 | 153 |
| Variants generated | 9 (gen=0) | 8 (gen=0) |
| Variants persisted | 4 | 8 |
| Synced to arena | 4 | 8 |

## Key Findings

### Finding 1: FK Violation in MergeRatingsAgent (Bug)

**Error from logs:**
```
[merge_ratings] MergeRatingsAgent: arena_comparisons insert failed
  context: {"count":17,"error":"...violates foreign key constraint \"evolution_arena_comparisons_entry_b_fkey\""}
[merge_ratings] MergeRatingsAgent: arena_comparisons insert failed
  context: {"count":103,"error":"...violates foreign key constraint \"evolution_arena_comparisons_entry_a_fkey\""}
[merge_ratings] MergeRatingsAgent: arena_comparisons insert failed
  context: {"count":20,"error":"...violates foreign key constraint \"evolution_arena_comparisons_entry_b_fkey\""}
```

**Root cause:** `evolution_arena_comparisons.entry_a`/`entry_b` have FK constraints referencing `evolution_variants(id)` (migration `20260322000007`). `MergeRatingsAgent` writes these rows during the iteration loop (in-run), using in-memory variant IDs. However, newly generated variants aren't persisted to `evolution_variants` until `finalizeRun` is called at the very end of the pipeline (`claimAndExecuteRun.ts:247`).

This means any comparison involving a newly generated variant (not an existing seed/pool variant) will fail the FK constraint. Matches between pre-existing pool variants may succeed (their IDs already in DB), which explains why some inserts succeed and others fail.

**Relevant code:**
- `MergeRatingsAgent.ts:280-281` — writes `entry_a: idA, entry_b: idB`
- `runIterationLoop.ts:359-363` — sets `idA: m.winnerId, idB: m.loserId`
- `persistRunResults.ts:234` — variant upsert (happens only after loop ends)
- Migration `20260322000007_evolution_prod_convergence.sql:202-204` — FK definition

**Fix direction:** Either (a) persist variants to `evolution_variants` early (before/during merge) or (b) remove/defer the FK constraint on `entry_a`/`entry_b` and write comparisons after finalization.

### Finding 2: LLM 60s Timeouts (Bug)

Many LLM calls hit the 60-second timeout in both generation and ranking agents, with no retry:

```
[generation] LLM call failed: {"error":"LLM call timeout (60s)","totalAttempts":1}
[ranking] LLM call failed: {"error":"LLM call timeout (60s)","totalAttempts":1}
```

c4057835 had significantly more ranking timeouts (11 ranking errors vs 2 for eb62d393), explaining why it only got 17 matches vs 153 for eb62d393.

**Fix direction:** Add retry logic for transient LLM timeouts, or increase the timeout threshold.

### Finding 3: Budget Cap Too Low ($0.05)

Both runs stop at `budget_exceeded` with only 1-4 iterations. A $0.05 budget is insufficient for meaningful evolution. `rankSingleVariant: budget exceeded` warnings show mid-ranking budget exhaustion.

```
[ranking] rankSingleVariant: budget exceeded  {"comparisonsRun":24}
[ranking] rankSingleVariant: budget exceeded  {"comparisonsRun":33}
```

### Finding 4: muHistory Identical Across Iterations (Confirmed Bug — Swiss Pairing Sigma Weight)

**Data:**
- eb62d393: 4 muHistory entries, all `[47.857, 47.637, 44.210, 42.508, 41.349]` — bit-for-bit identical
- c4057835: 2 muHistory entries, both `[47.857, 47.562, 44.210, 42.508, 41.096]` — bit-for-bit identical
- eb62d393 ran 3 Swiss iterations with 20+20+10=50 completed matches, `eligibleCount=129`

**Root cause (confirmed):** Swiss pairing scores pairs by `outcomeUncertainty * sigmaWeight` (`swissPairing.ts:62-64`). New variants start with `sigma=8.333` (default). Established pool variants loaded from arena have `sigma~1-2` (converged). With 129 established variants + 8 new variants in the pool, all 20 Swiss pairs come from the 28 possible new-variant pairs — their product `outcomeUncertainty * 8.333` always beats established variants' `outcomeUncertainty * 1.5`. The top-5 established variants are never paired, their ratings never change, muHistory is frozen.

This means Swiss ranking is entirely ineffective for re-ranking the established pool when new variants are present — a fundamental design flaw in the pairing formula.

### Finding 5: All Variants at generation=0

All variants in both runs have `generation=0`. This is expected in the V2 parallel architecture — the `generation` field tracks prompt generation (not swiss iteration number). All variants are generated in the generate phase (iteration 0), so `generation=0` is correct.

### Finding 6: finalPhase = "COMPETITION" (Possible Stale Naming)

`run_summary.finalPhase` shows `"COMPETITION"` which is not a V2 phase name (V2 uses `generate`/`swiss`). This may be leftover from V1 naming and is worth auditing.

### Finding 7: Seed Article Format Warning (Minor)

Both runs emit:
```
[seed_setup] Seed article format validation issues: {"issues":["Multiple H1 titles (lines 0, 2)"]}
```
Minor warning, not blocking.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/architecture.md
- evolution/docs/data_model.md
- evolution/docs/metrics.md
- evolution/docs/arena.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/logging.md
- evolution/docs/entities.md
- evolution/docs/agents/overview.md
- evolution/docs/cost_optimization.md
- evolution/docs/curriculum.md
- evolution/docs/visualization.md
- evolution/docs/reference.md
- evolution/docs/minicomputer_deployment.md
- evolution/docs/README.md
- docs/feature_deep_dives/evolution_metrics.md
- docs/docs_overall/debugging.md
- docs/feature_deep_dives/testing_setup.md
- docs/planning/generate_rank_evolution_parallel_20260331/generate_rank_evolution_parallel_20260331_planning.md

## Code Files Read
- evolution/src/lib/core/agents/MergeRatingsAgent.ts — writes arena_comparisons during loop; FK violation root cause
- evolution/src/lib/core/agents/generateFromSeedArticle.ts — generates variant, ranks against local pool, returns matches
- evolution/src/lib/pipeline/loop/runIterationLoop.ts — orchestrates generate+swiss+merge iterations
- evolution/src/lib/pipeline/claimAndExecuteRun.ts — full run lifecycle; finalizeRun called after loop
- evolution/src/lib/pipeline/finalize/persistRunResults.ts — variant upsert (line 234) — happens last
- evolution/src/lib/schemas.ts — V2Match schema (winnerId/loserId, not idA/idB)
- supabase/migrations/20260322000007_evolution_prod_convergence.sql — FK definition for entry_a/entry_b
- supabase/migrations/20260331000002_sync_to_arena_in_run_matches.sql — sync_to_arena architecture (MergeRatingsAgent as sole writer)

## Open Questions

1. Why are some arena comparison inserts succeeding while others fail? Likely: pre-existing pool variants loaded from arena ARE already in `evolution_variants`, so matches between them succeed. Matches involving freshly generated variants fail. Needs confirmation.
2. What is the correct fix for the FK violation — remove the FK (Option A) or persist variants earlier (Option B)?
3. Is `finalPhase: "COMPETITION"` a stale V1 remnant or actively used anywhere?
