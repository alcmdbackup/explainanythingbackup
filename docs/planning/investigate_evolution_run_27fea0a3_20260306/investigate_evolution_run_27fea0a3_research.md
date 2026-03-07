# Investigate Evolution Run 27fea0a3 Research

## Problem Statement
Run 27fea0a3 exceeded budget in production and its results may not have synced to the Arena. The pipeline reported `sync_to_arena RPC failed (non-fatal)` with a foreign key constraint violation on `evolution_arena_entries`. Need to investigate the budget exhaustion cause, diagnose the Arena sync failure, and determine if results need manual recovery.

## Requirements (from GH Issue #653)
1. Investigate budget exhaustion cause via budget_events audit log
2. Diagnose sync_to_arena RPC failure and FK constraint violation
3. Determine if results were partially synced or fully lost
4. Fix any bugs found
5. Re-sync results to arena if needed

## High Level Summary

Two distinct issues found. Both have clear root causes:

1. **Budget exceeded by 26%** ($0.126 actual vs $0.10 cap) because gpt-5.2 generation costs were 3-4x the pre-call reservation estimates. All 3 parallel generation calls pass the budget check simultaneously, then each produces far more output than estimated.

2. **Arena sync FK violation during mid-run sync** — `syncToArena()` is called after each iteration (not just at finalization), but variants aren't persisted to `evolution_variants` until `finalizePipelineRun()`. The FK `evolution_arena_entries_evolution_variant_id_fkey` fails because the variant IDs only exist in memory. The **final sync at finalization succeeded** after variants were persisted — all 10 entries are in the arena.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/evolution/visualization.md — Timeline/Budget tab shows per-agent costs
- evolution/docs/evolution/reference.md — Budget enforcement: global cap, 30% safety margin, FIFO reservations
- evolution/docs/evolution/architecture.md — Two-phase pipeline, checkpoint after each agent, finalizePipelineRun flow
- evolution/docs/evolution/data_model.md — Variant persistence only at finalization, arena entry FK to evolution_variants
- evolution/docs/evolution/rating_and_comparison.md — OpenSkill ratings, calibration
- evolution/docs/evolution/agents/overview.md — GenerationAgent uses Promise.allSettled for 3 parallel calls
- evolution/docs/evolution/arena.md — syncToArena RPC, unified pool model
- evolution/docs/evolution/cost_optimization.md — estimateTokenCost, reservation cleanup, budget event audit log
- docs/docs_overall/debugging.md — query:prod tool, budget event queries
- evolution/docs/evolution/agents/generation.md — 3-strategy parallel generation

## Code Files Read
- evolution/src/lib/core/pipeline.ts — syncToArena called at line 513 (mid-run, per-iteration) AND line 179 (finalization)
- evolution/src/lib/core/arenaIntegration.ts — syncToArena builds entries with evolution_variant_id from in-memory pool
- evolution/src/lib/core/costTracker.ts — reserveBudget with 30% margin, recordSpend dequeues FIFO, no overshoot prevention
- evolution/src/lib/core/llmClient.ts — estimateTokenCost: output = 50% of input tokens for generation tasks
- evolution/src/lib/agents/generationAgent.ts — 3 concurrent calls via Promise.allSettled
- supabase/migrations/20260303000005_arena_rename_and_schema.sql — sync_to_arena RPC definition

## Key Findings

### Finding 1: Budget Exhaustion Root Cause

**Run details:**
- Run ID: `27fea0a3-65ea-495f-a5df-ad3b15e9c548`
- Budget cap: $0.10 (from experiment "Light test of stopping")
- Strategy: gpt-5.2 generation, deepseek-chat judging, 50 max iterations
- Reached iteration 3, EXPANSION phase, total cost: $0.1258

**Cost breakdown by iteration:**
| Iteration | Generation | Calibration | Proximity | Subtotal |
|-----------|-----------|-------------|-----------|----------|
| 1 | $0.034 | $0.006 | $0.000 | $0.039 |
| 2 | $0.041 | $0.007 | $0.000 | $0.048 |
| 3 | $0.038 | $0.000 (failed) | — | $0.039 |
| **Total** | **$0.113** | **$0.013** | **$0.000** | **$0.126** |

**Why budget check didn't prevent overshoot:**
1. `estimateTokenCost()` estimates output as 50% of input tokens
2. For generation tasks, gpt-5.2 produces 5-7x more output than input (e.g., 7473 chars from 1076 char prompt)
3. Each generation call reserved ~$0.003-0.004, but actual cost was $0.005-0.020
4. All 3 calls run via `Promise.allSettled()` — all pass budget check simultaneously
5. Combined reservation: ~$0.011, combined actual: ~$0.038 (3.5x underestimate)
6. The 30% safety margin is insufficient when actual costs are 300-400% of estimates

**Budget timeline (iteration 3):**
- Before generation: $0.087 spent, $0.013 available
- 3 calls reserved: $0.011 total → check passes ($0.013 > $0.011)
- Actual costs: $0.005 + $0.013 + $0.020 = $0.038
- After generation: $0.126 spent, available = **-$0.026** (negative!)
- Calibration immediately hit BudgetExceededError

### Finding 2: Arena Sync FK Violation

**Timeline from run logs:**
1. After iteration 1: `sync_to_arena RPC failed (non-fatal)` — FK violation on `evolution_arena_entries_evolution_variant_id_fkey`
2. After iteration 2: Same FK violation
3. At finalization: `Arena synced` — success, 10 entries inserted, 74 elos upserted

**Root cause:** `syncToArena()` is called mid-run (pipeline.ts:510-518) after each iteration. It builds arena entries using variant IDs from the in-memory pool. But these variants haven't been written to `evolution_variants` yet — that only happens in `finalizePipelineRun()`. The `evolution_arena_entries.evolution_variant_id` FK references `evolution_variants.id`, so the insert fails.

**Code path:**
```
pipeline.ts:513 → syncToArena(runId, ctx, logger, watermark)
  → arenaIntegration.ts: builds entries with v.id from ctx.state.pool
  → sync_to_arena RPC: INSERT INTO evolution_arena_entries (evolution_variant_id = v.id)
  → FK check: evolution_variants.id doesn't exist yet → FAIL
```

**Why finalization succeeded:** `finalizePipelineRun()` calls `persistVariants()` BEFORE `syncToArena()`. By the time the final sync runs, all variant rows exist in the DB.

### Finding 3: Data Integrity Status

- **10 variants persisted** — all 3 iterations × 3 strategies + 1 baseline
- **10 arena entries synced** — final sync succeeded
- **No winner set** — expected (budget exhausted in EXPANSION, no competition phase)
- **3 uncalibrated variants** (iteration 3) — Elo 1200 (calibration failed due to budget)
- **All arena entry FKs valid** — LEFT JOIN confirms all evolution_variant_ids reference existing variants
- **No manual recovery needed** — data is intact

### Finding 4: Pool had 64 pre-existing Arena entries

The pool started with 64 Arena entries loaded (`Arena entries loaded into pool, loaded: 64`). This is the unified pool model — pre-existing Arena variants for this topic were loaded and competed alongside new variants.

## Open Questions

1. **Should mid-run syncToArena be removed or fixed?** It always fails because variants aren't in the DB yet. Options:
   a. Remove mid-run sync entirely (simplest — finalization sync handles everything)
   b. Call persistVariants() before mid-run sync (more complex, potential partial persistence issues)
   c. Make the FK nullable or deferrable (schema change, may have other implications)

2. **Should budget estimation be improved for expensive models?** The 50%-of-input heuristic badly underestimates gpt-5.2 output. Options:
   a. Model-specific output multipliers (e.g., gpt-5.2 generates longer text)
   b. Use historical cost baselines if available
   c. Sequential budget checks (run 1 generation call, check actual cost, then decide on remaining)
   d. Accept that $0.10 is just too small for gpt-5.2 and document minimum budgets per model

3. **Is the 30% safety margin sufficient?** Even with better estimation, parallel calls create inherent overshoot risk. The margin would need to be 300%+ to cover generation tasks with expensive models.
