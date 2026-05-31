# Further Investigate Paragraph Recombine Performance Research

## Problem Statement
Further investigate performance of the 5 most recent paragraph recombine runs.

## Requirements (from GH Issue #1154)
Further investigate performance of 5 most recent paragraph recombine runs.

## High Level Summary

### Why paragraph rewrites "lowered ELO" — verified findings (2026-05-31, fresh session, staging/dev)

Runs analyzed: `c5d7c977`, `ebf7c9da`, `5ebd4185`, `0943ba13`, `88b5e860`.

**Real data model (corrected — a prior session ran on a fabricated schema; discard that):**
- `evolution_variants`: paragraph candidates = `variant_kind='paragraph'`, `generation=0` (344 across 5 runs); recombined articles = `variant_kind='article'`, `generation=1` (71) and `generation=2` (25). Text column is **`variant_content`** (not `variant_text`). ELO baseline ≈ 1200 (openskill `mu` default 25 → elo ~1200), range 1078–1324.
- `evolution_arena_comparisons`: `entry_a`, `entry_b`, `winner` ('a' | 'draw'; decisive winner is normalized to `entry_a`, so 0 literal 'b' — a storage convention, **not** a bug), `confidence`, `mu/sigma _before/_after`. **There is NO `reasoning`/`dimension` column** — judge rationale is not persisted here.

**What actually drives the ELO drops (high confidence on structure; see caveat on exact figures):**
1. **The ELO signal is too thin to trust.** Only **~1.6 candidates per slot** (211 slots; min 1, max 3 — many slots have a *single* candidate, i.e. no competition at all) and **~1.9 arena matches per variant**, with a small per-slot ELO spread (~49 pts). A candidate that loses one of its 1–2 sparse matches falls from the ~1200 default toward ~1078. So "lowered ELO" is mostly **measurement noise**, not a quality regression.
2. **~44% of matches are draws** (≈348 draw vs ≈438 decisive, confidence 0.5) — the judge frequently can't separate candidates, so the few decisive matches drive all rating movement, amplifying the noise.
3. **It is NOT verbosity/length.** `corr(elo_score, length(variant_content)) = +0.299` (n=344) — a *modest positive* relationship (ELO tertiles: low avg 740 chars → high avg 863 chars). Longer paragraphs score slightly **higher**, so verbosity is not penalized. This refutes the earlier (fabricated) "rewrites too verbose" claim.
4. Recombination iterates gen-1 → gen-2 but article winners barely improve (gen-1 winner ~1312 → gen-2 winner ~1319).
5. **Possible rationale store (unread):** `evolution_logs` / `evolution_run_logs` tables exist and may hold the per-comparison judge rationale (absent from `evolution_arena_comparisons`). Checking them is the next step for content-level "why".

**Open item (needs code read, not DB):** the *content-level* reason a judge prefers one candidate is not stored in the DB. To get it, read the `paragraph_rank` judge prompt + whether rationale is logged in LLM invocation records. Deferred.

**Implication / suggestions direction:** the priority is not "make rewrites less verbose" but **make the arena signal trustworthy** — more matches per candidate, reduce the 44% draw rate (sharper judge or tie-breaking), and ensure ≥2 candidates per slot. Only then is "rewrite X lowered ELO" a real signal worth acting on.

⚠️ Numbers above were obtained this (fresh) session via clean single-table queries and cross-checked; a few late outputs showed echo-duplication noise but no fabricated values. Confidence: high on the structural facts (draws, matches/variant, candidates/slot, length-corr); medium on exact ELO averages.

Context from doc review: `paragraph_recombine` is a per-paragraph rewrite-and-rank agent that splits a parent explanation into paragraph "slots", generates N temperature-varied rewrites per slot (`paragraph_rewrite`), ranks them in a per-slot arena (`paragraph_rank`), and stitches winners back together. Recent investigations (20260529–20260530) already addressed a persistence/display bug (migration `20260529000001`), a cost-undershoot (per-rewrite instrumentation G1-G7, tighten-directive I3), and an effectiveness analysis (`analyze_effectiveness_paragraph_recombine_20260530`). This project continues that line by examining the 5 most recent runs.

Key data sources for the investigation:
- `evolution_agent_invocations` — per-invocation `cost_usd`, `duration_ms`, `execution_detail` JSONB (per-slot/per-rewrite cost, status, dropReason, temperature, estimationErrorPct)
- `evolution_variants` — persisted arena columns (`arena_match_count`, `parent_variant_ids`, `generation`, `elo_score`, `mu`, `sigma`)
- `evolution_arena_comparisons` — head-to-head match results
- `evolution_metrics` — run-level `cost`, `cost_estimation_error_pct`
- Read-only DB access via `npm run query:staging` / `npm run query:prod`

## Documents Read

### Core Workflow Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Core Operations Docs
- docs/docs_overall/environments.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/debugging.md (includes paragraph_recombine cost-undershoot + slot-leaderboard debugging sections)

### Evolution Docs (all read per request)
- evolution/docs/evolution/README.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/operations.md
- evolution/docs/evolution/rating.md
- evolution/docs/evolution/arena.md
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/experiments.md
- evolution/docs/evolution/paragraph_recombine.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/strategost.md
- evolution/docs/evolution/visualizations.md

### Relevant Docs (discovered in step 2.7)
- docs/feature_deep_dives/evolution_pipeline.md
- docs/feature_deep_dives/error_handling.md
- docs/feature_deep_dives/tag_system.md
- docs/feature_deep_dives/manage_sources.md
- docs/feature_deep_dives/add_sources_citations.md
- docs/feature_deep_dives/user_testing.md
- docs/feature_deep_dives/iterative_planning_agent.md

## Code Files Read
- [list of code files reviewed during /research]
