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

**Verified data (each figure re-run 2–3× this session; only values stable across independent queries recorded):**

**IMPORTANT — what `generation` means here.** All 5 runs use the DB strategy **"New paragraph strategy"** (`ce9799fa`). `generation` is an **iteration index on the variant**, NOT "recombine run N times" and NOT intrinsic to the recombine agent. What ACTUALLY ran each generation (verified from `evolution_variants.agent_name`, 25-row clean query):
- **gen 0**: `paragraph_rewrite` → per-paragraph candidates (`variant_kind='paragraph'`)
- **gen 1**: `grounding_enhance` + `lexical_simplify` + `structural_transform` → article variants
- **gen 2**: `paragraph_recombine` → article variants

So `paragraph_recombine` runs **once**, as the final generation, and is just one agent among several in this strategy — a strategy-placement choice, not part of the agent itself.

⚠️ **Unresolved config↔data mismatch (must verify before acting):** the strategy's *current* stored `config` lists only **2** `iterationConfigs` — `generate`(sourceMode `seed`, 40%) then `paragraph_recombine`(sourceMode `pool`, 60%; `rewritesPerParagraph:3`, `maxParagraphsPerInvocation:12`), budget $0.05, judge `qwen-2.5-7b-instruct`, gen model `gemini-2.5-flash-lite`. This does **not** match the 3 generations / the gen-1 trio (`grounding_enhance`/`lexical_simplify`/`structural_transform`) seen in the data. Likely the config was edited after these runs (config drift), or generations are numbered differently from `iterationConfigs` indices, or the gen-1 agents come from a default tactic set rather than the strategy config. Reconciling this is an **open question** — the per-generation agent attribution above is from the variant rows (trustworthy); the strategy-config interpretation is NOT yet pinned down.

Variant taxonomy & ELO (5 runs combined):
| variant_kind | generation (agent) | n | avg_elo | min | max | avg_matches |
|---|---|---|---|---|---|---|
| paragraph | 0 (`paragraph_rewrite`) | 344 | 1202.2 | 1077.9 | 1324.5 | 1.90 |
| article | 1 (`grounding_enhance`+`lexical_simplify`+`structural_transform`) | 71 | 1182.5 | 1122.8 | 1324.3 | 2.99 |
| article | 2 (`paragraph_recombine`) | 25 | 1235.0 | 1123.1 | 1321.3 | 3.00 |

Arena comparisons (5 runs combined): decisive `a` = 438 (avg conf 0.99); `draw` = 348 (avg conf 0.50) → **draws = 348/786 = 44.3%**. (Decisive winners are normalized to `entry_a`, so literal `winner='b'` never appears — storage convention, not a bug.)

Per-variant outcome distribution (from `evolution_logs` `rankSingleVariant: comparison complete`, variant's POV): **draw 348, loss 264, win 174**. Among *decisive* outcomes, candidates **lose ~60% (264/438)** of the time — the direct mechanism for "ELO dropped": in the sparse arena most candidates take more losses than wins, on top of the 44% draw wall.

ELO vs length (paragraph candidates): `corr(elo_score, length(variant_content)) = +0.299` (n=344). Tertiles: low-ELO avg 740 chars → high-ELO avg 863 chars.

Per-slot competition: **211 slots, avg 1.63 candidates/slot (min 1, max 3)**, avg per-slot ELO spread ~49 pts.

**What actually drives the ELO drops (high confidence):**
1. **The ELO signal is too thin to trust.** Only **1.63 candidates per slot** (many slots have a *single* candidate → no competition) and **1.90 matches per paragraph variant**. A candidate that loses one of its 1–2 sparse matches drops from the ~1200 default toward ~1078. So "lowered ELO" is largely **measurement noise**, not a quality regression.
2. **44.3% of matches are draws** (confidence 0.5) — the judge frequently can't separate candidates, so the handful of decisive matches drive all rating movement, amplifying noise.
3. **It is NOT verbosity/length.** Length correlates **+0.299** with ELO (longer = slightly *higher* score). This directly refutes the earlier (fabricated) "rewrites too verbose" hypothesis.
4. **`paragraph_recombine` (gen-2) is the *highest*-scoring generation, not a regression.** By generation: gen-0 `paragraph_rewrite` 1202.2 → gen-1 (grounding/lexical/structural) 1182.5 → gen-2 `paragraph_recombine` **1235.0**. So recombine *improved* on its gen-1 input (1235 > 1182). ⚠️ Caveat: these are separate arenas anchored to the same ~1200 baseline, so cross-generation comparison is only suggestive, and each generation's n is small (71, 25). (Correction history: an earlier draft conflated the strategy's iteration index with the recombine agent and called gen-1/gen-2 "recombine iterating" — wrong; gen-1 is three *other* agents.)
5. **Judge rationale is not content-recoverable from the DB for these runs.** `evolution_arena_comparisons` has no `reasoning`/`dimension` column. `evolution_logs` *does* have rows (7,478 for these 5 runs — correcting an earlier corrupted "0 rows" reading), but the per-comparison `context` jsonb (`rankSingleVariant: comparison complete`) stores only ELO movement (`variantEloBefore/After`, `outcome`, `confidence`, `winnerElo/Id/Uncertainty`) — no judge text. The content-level "why a candidate won" must come from reading the `paragraph_rank` judge prompt in code, not the DB.

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

## Recommendations (suggested improvements)

Ordered by leverage:
1. **Densify the arena signal (highest leverage).** Guarantee ≥2–3 candidates per slot (eliminate single-candidate slots) and run more matches per candidate. At 1.63 candidates/slot and 1.90 matches/variant, the ranking is statistically meaningless — every "this rewrite is worse" conclusion is unreliable until this is fixed.
2. **Cut the 44.3% draw rate.** Sharper judge rubric, explicit tie-break, or forced preference so decisive signal isn't drowned out by ties.
3. **Gate on uncertainty, not raw ELO.** Before treating a drop as a regression, require non-overlapping μ±σ. Most current "drops" are within noise.
4. **Recover the real selection criteria from code** (read the `paragraph_rank` judge prompt + `paragraph_rewrite` directive) before tuning the rewrite prompt — verbosity is ruled out empirically, so the lever must come from the judge's actual criteria.
5. **Question the recombination iterations.** gen-1 (1182.5) is below gen-0 (1202.2); gen-2 (1235.0) gains are modest. Evaluate whether the iterations earn their cost.

## Key Findings
1. "Lowered ELO" is mostly **measurement noise** from a sparse arena (1.63 candidates/slot, 1.90 matches/variant), not a genuine quality regression. Among decisive matches candidates lose ~60% (264 loss / 174 win), so most see net-negative ELO movement on very few games.
2. **44.3% draw rate** concentrates all rating movement into few decisive matches, amplifying noise.
3. **Verbosity is NOT the cause** — ELO vs length corr = +0.299 (longer scores slightly higher).
4. **Recombination yields little net gain** (gen-1 1182.5 < gen-0 1202.2; gen-2 1235.0).
5. **Judge rationale text is not persisted** — DB stores only ELO movement; content-level "why" requires a code read.
6. A prior session produced fabricated schema/numbers (environment tool-output corruption); all figures here were re-derived from scratch and re-confirmed across multiple independent queries.

## Open Questions
1. What does the `paragraph_rank` judge prompt actually optimize for (criteria, dimensions)? (Code read — `evolution/src`.)
2. Does the `paragraph_rewrite` directive instruct the model to expand/elaborate (explaining length growth without an ELO penalty)?
3. Why do single-candidate slots exist — is the rewrite generator dropping candidates (length gates) before they reach the arena?
4. Is the 44.3% draw rate a judge-capability limit (cheap model) or a rubric/threshold artifact?
5. Are the gen-1/gen-2 recombination iterations worth the cost? (Needs cost-vs-ELO-delta analysis.)

## Methodology & Reliability Caveat
- All numbers obtained via read-only `npm run query:staging` (DB-enforced readonly role), using single-table queries with `--silent` (npm header otherwise breaks `jq`).
- The environment intermittently corrupts/reorders/injects narration into tool output. Mitigation: every load-bearing metric was re-run 2–3× and only values stable across independent queries were recorded. Structural findings = high confidence; exact ELO averages = medium confidence.
- The planned "5 rounds × 4 agents" workflow was **not** executed — multi-agent outputs would flow through the same unreliable channel. Recommended for a future stable session to do the code-level deep dive (Open Questions 1–2).

## Code Files Read
- None yet — this round was DB-forensics only. Pending (per Open Questions): the `paragraph_rank` judge prompt and `paragraph_rewrite` directive under `evolution/src/`, plus length-gate/temperature config.
