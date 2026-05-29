# Investigate Paragraph Recombine Invocation Research

## Problem Statement
I see that some paragraphs in invocation 83c9a188-cb83-4cd0-bdbc-3356cbc537fc have 0 matches and 0 iterations, and are also coming from seed despite strategy specifying was supposed to take from top variants of run.

## Requirements (from GH Issue #1125)
I see that some paragraphs in invocation 83c9a188-cb83-4cd0-bdbc-3356cbc537fc have 0 matches and 0 iterations, and are also coming from seed despite strategy specifying was supposed to take from top variants of run.

## High Level Summary
[To be filled during /research]

Initial leads from doc review (to verify against code + DB during /research):
- **"Coming from seed despite strategy specifying top variants of run":** `paragraph_recombine` resolves ONE parent via `resolveParent`, honoring `sourceMode`/`qualityCutoff`. When `sourceMode: 'pool'` and the filtered pool is empty (e.g. arena entries excluded as parents, all in-run variants unrated, or cutoff too strict), `resolveParent` falls back to the seed and emits a `fallbackReason: 'no_same_run_variants'` warn-log. Check whether this fallback fired for the invocation, and whether the iteration was actually first (locked to seed) vs non-first.
- **"0 matches and 0 iterations":** per-slot ranking generates M rewrites then ranks survivors via `rankNewVariant`. If rewrites are quality-equivalent paraphrases the judge can't distinguish (~98% draws → per-slot Elo frozen at 1200), or if rewrites are all dropped by `validateParagraphRewrite` (length cap ±20%, no bullets/lists/tables/H1), a slot can end with 0 surviving comparisons. Also check `paragraph_slot_match_persist_failures` metric and the self-abort path (`slotScope.getOwnSpent() >= 0.9 × perSlotBudgetUsd` → fall back to original, other slots continue).
- Recent related work: `investigate_matchmaking_paragraph_recombine_20260528` (per-rewrite diversity directives + temperature ladder + paragraph judging mode) and `make_fixes_paragraph_recombine_20260528` (dedicated dispatch branch + article-level ranking). This invocation may pre-date or post-date those fixes — confirm via `created_at`.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Named Docs (requested by user)
- docs/docs_overall/environments.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/debugging.md

### Evolution Docs (full set, requested by user)
- evolution/docs/README.md
- evolution/docs/architecture.md
- evolution/docs/paragraph_recombine.md
- evolution/docs/multi_iteration_strategies.md
- evolution/docs/data_model.md
- evolution/docs/agents/overview.md
- evolution/docs/arena.md
- evolution/docs/reference.md
- evolution/docs/variant_lineage.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/metrics.md
- evolution/docs/logging.md
- evolution/docs/cost_optimization.md
- evolution/docs/entities.md
- evolution/docs/editing_agents.md
- evolution/docs/criteria_agents.md
- evolution/docs/evolution_metrics.md
- evolution/docs/visualization.md
- evolution/docs/curriculum.md
- evolution/docs/minicomputer_deployment.md

## Code Files Read
- [list of code files reviewed during /research]
