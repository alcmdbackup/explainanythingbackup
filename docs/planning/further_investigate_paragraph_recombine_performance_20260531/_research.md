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

✅ **RESOLVED (was flagged as a mismatch; it is not one):** the stored `config` (2 iterations: `generate`/seed then `paragraph_recombine`/pool) DOES match the per-run `iteration_snapshots`. The 3 generations come from 2 iterations because the `generate` iteration emits both seed paragraph rewrites (gen 0) and **tactic** variants (gen 1) via `tacticsUsed`; `paragraph_recombine` is gen 2. See the "RESOLVED: where the gen-1 agents come from" section below for details.

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

### RESOLVED: where the gen-1 agents come from (it is NOT a config mismatch)

The per-run `iteration_snapshots` (clean JSON from `evolution_runs`, run `c5d7c977`) shows the strategy has exactly **2 iterations**, which MATCHES the stored `config` — there is no drift/mismatch (my earlier "config↔data mismatch" flag was wrong; retracting it):
- **iteration 0**: `agentType: generate`, `sourceMode: seed`, budget 40%, **`tacticsUsed: [grounding_enhance, lexical_simplify, structural_transform]`**
- **iteration 1**: `agentType: paragraph_recombine`, `sourceMode: pool`, budget 60%, `maxDispatches: 10`, `rewritesPerParagraph: 3`, `qualityCutoff: topN/5`

So `grounding_enhance`/`lexical_simplify`/`structural_transform` are **tactics of the generate iteration**, not separate iterations and not separate strategies. They are rows in the **`evolution_tactics`** table (verified: ids `4c7511c2`/`d64c571b`/`f212b2d0`). The `generate` agent fans out into one sub-agent per tactic, which is why `evolution_variants.agent_name` shows them. The `generation` column (0/1/2) counts variant lineage depth, not `iterationConfigs` index — that's why 2 iterations yield 3 generations (seed paragraphs → tactic articles → recombined article).

### Strategy config specificity / dedup behavior (answers "does any variation create a net-new strategy?")

**No — and this is a real gap.** `evolution/src/lib/strategy/strategyHash.ts` (read in full):
- `hashStrategyConfig()` hashes ONLY `generationModel`, `judgeModel`, and a **whitelist** of per-iteration fields produced by `canonicalizeIterationConfig()`.
- `upsertStrategy()` does `INSERT ... ON CONFLICT (config_hash)` and there is a **UNIQUE index** `evolution_strategies_config_hash_key` (verified; 0 hash collisions in the table).

Consequence: **two configs that differ only in a non-hashed field get the SAME `config_hash`, collide on the unique index, and the upsert dedupes them into one row — silently overwriting the stored `config` with the latest caller's values.** They are NOT treated as distinct strategies. This is "merged/blocked," exactly the behavior to eliminate.

Fields the hash currently INCLUDES (per iteration): `agentType`, `budgetPercent`, `sourceMode`, `qualityCutoff`, `generationGuidance`, `reflectionTopN` (reflect only), `criteriaIds`+`weakestK` (criteria agents only), `lengthCapRatio`/`redundancyJaccardThreshold`/`includesMirrorApprover` (specific agents only), `perInvocationCapUsd`+`maxDispatches` (paragraph_recombine only, added by the J1.5 fix), and the four budget-floor fractions.

Fields the hash currently EXCLUDES (so they DON'T create a net-new strategy):
- **`tacticsUsed`** — two strategies with different tactic sets hash identically (directly relevant: the gen-1 behavior above is invisible to the hash).
- **`rewritesPerParagraph`, `maxComparisonsPerParagraph`, `maxParagraphsPerInvocation`** — the file's own comment (lines 81–89) says these "remain unhashed by deliberate choice."
- Top-level **`budgetUsd`, `generationTemperature`, `judgeModel` is included but `maxComparisonsPerVariant`, `minBudgetAfterParallelAgentMultiple`** are excluded (only generationModel/judgeModel/iterationConfigs feed the hash).

**Proposed fix (to make any config difference produce a distinct strategy):** replace the whitelist in `canonicalizeIterationConfig` + `hashStrategyConfig` with a **full deep-canonicalization** of the entire `StrategyConfig` (recursively sort object keys, sort order-insensitive arrays like `criteriaIds`, drop only truly-undefined optionals), then hash that. Trade-offs/risks to weigh before implementing:
1. **Existing rows keep their old `config_hash`** (hash is stored, only computed at creation), so historical strategies are unaffected — but a *re-run* of an old config will now hash differently and create a NEW row (intended, but means old and "same" new configs won't dedupe to each other).
2. Tests that assert specific hash values (e.g. `strategyHash` unit tests, `staging-strategies-2026-04-13.json` fixture) will need updating.
3. The original whitelist existed to keep "semantically equivalent" configs merged; full hashing means even cosmetic differences split — which is precisely what's requested, but confirm no caller relies on the merge behavior.
4. Order-sensitivity: decide whether `iterationConfigs` order matters (it should — order changes execution) but within-iteration arrays like `criteriaIds` should stay sorted.

This is a **code change deferred out of /research** (and out of this degraded session) — captured as the actionable plan item; implement + run lint/tsc/unit in a clean session.

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
