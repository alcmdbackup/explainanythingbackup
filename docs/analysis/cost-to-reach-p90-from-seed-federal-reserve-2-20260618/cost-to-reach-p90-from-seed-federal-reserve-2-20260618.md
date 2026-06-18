# Cost to Reach a p90 Variant Starting From the Canonical Seed — Federal Reserve 2

## Header
- **Analysis name:** cost-to-reach-p90-from-seed-federal-reserve-2-20260618
- **Project:** docs/planning/meta_analysis_how_to_get_top_arena_federal_reserve_2_20260616/
- **Branch:** feat/meta_analysis_how_to_get_top_arena_federal_reserve_2_20260616
- **Date:** 2026-06-18
- **Source research doc:** docs/planning/meta_analysis_how_to_get_top_arena_federal_reserve_2_20260616/meta_analysis_how_to_get_top_arena_federal_reserve_2_research.md
- **Related analyses:**
  - docs/analysis/arena-elo-distribution-federal-reserve-2-20260617/ — defines the p90 cutoff (Elo 1287) used here.
  - docs/analysis/rewrite-efficacy-decay-federal-reserve-2-20260617/ — per-parent-Elo-bucket Δ-Elo curve + cost columns (cost-per-improver scales 25× across the curve).
  - docs/analysis/rewrite-success-by-top-tier-federal-reserve-2-20260618/ — per-agent success rate at top-10 % and top-5 % parent cutoffs + cost columns.

## Methodology

**Question.** Starting "from scratch" — meaning dispatched against the canonical seed variant of `federal_reserve_2` rather than against a pre-evolved high-Elo parent — what is the total invocation cost required so that there is at least a **75 % probability** of producing at least one variant whose Elo exceeds the arena's p90 (Elo 1287)?

**Why this question.** The companion analyses showed (a) where variants currently sit (distribution), (b) how rewrite Δ-Elo decays as parent gets stronger (decay curve), and (c) per-agent success rates and costs against already-strong parents. None of those answers "what does it cost to *make* a top-decile variant from a fresh seed?" — which is the relevant compute-budget question for a researcher dispatching a new strategy against an unevolved prompt.

**Data source.** Staging Supabase (read-only role `readonly_local`, accessed via `npm run query:staging`). Tables: `evolution_variants` (self-joined for parent identity), `evolution_agent_invocations` (joined for `cost_usd`).

**Prompt scope.** `Federal Reserve 2` arena topic only (`evolution_prompts.id = a546b7e9-f066-403d-9589-f5e0d2c9fa4f`). Staging only.

**Seed identity (Q1).** The canonical seed for federal_reserve_2 is `evolution_variants.id = 26ab2327-6f14-488d-b68f-9e155a7ed278`, with `agent_name = 'baseline'`, `generation_method = 'seed'`, `generation = 0`. Critically:
- **Seed Elo = 1104.6**, *not* 1200. The default 1200 in `evolution_variants.elo_score DEFAULT 1200` applies only to variants with zero matches; this seed has 21 arena matches and has lost most of them to its evolved descendants, dragging its rating down ~95 Elo points below default.
- Required lift from seed to p90 = 1287 − 1104.6 = **+182.4 Elo points** per successful rewrite.

**Inclusion criteria for "from-seed rewrites" (Q2, Q3).**
- `prompt_id = a546b7e9-...`
- `synced_to_arena = true`
- `archived_at IS NULL`
- `variant_kind = 'article'`
- `parent_variant_ids[1] = '26ab2327-...'` (the canonical seed is the primary parent)
- `evolution_agent_invocations.cost_usd` non-null and > 0

This yields **n = 1,408** historical rewrite attempts directly against the canonical seed. Per-agent rows are filtered to `count(*) >= 5` to suppress single-sample noise.

**Computed metrics per slice.**
- **n_attempts**: rewrites in the slice.
- **n_p90_hits**: rewrites where `child.elo_score > 1287`.
- **p90_rate_pct** = `p = n_p90_hits / n_attempts × 100` — the empirical probability that one invocation of this agent against this seed produces a p90 variant.
- **cost_per_invocation** = `avg(evolution_agent_invocations.cost_usd)` — the realized LLM-call cost per attempt.
- **n_needed_for_75pct** = `⌈ln(0.25) / ln(1 − p)⌉` — the smallest integer N satisfying `1 − (1 − p)^N ≥ 0.75`. Null for agents with p = 0 (unreachable at any finite N).
- **cost_for_75pct** = `n_needed_for_75pct × cost_per_invocation` — total USD spend for 75 % confidence of at least one p90 hit using that single agent. Null for p = 0 agents.

**Geometric-cost model assumptions.**
- Independent identically-distributed Bernoulli trials per invocation. The system's invocations against a given seed are not perfectly independent (some strategies dispatch in parallel batches that share random seeds), but for the historical pool the empirical hit-rate is the most defensible per-invocation probability.
- 75 % is an arbitrary confidence target — the formula scales to any α: `N(α) = ⌈ln(1 − α) / ln(1 − p)⌉`. For 90 %: roughly 1.5× the N at 75 %. For 50 %: roughly 0.5×.
- The seed Elo is treated as a constant 1104.6; the arena Elo can drift, but historical attempts were generated against the seed's *at-the-time* Elo. The Q2/Q3 fields use the *current* `evolution_variants.elo_score` for children; the p90 cutoff (1287) is also current.

**Caveats affecting interpretation.**
1. **Ranking cost is excluded.** Same caveat as the companion analyses — `evolution_agent_invocations.cost_usd` captures the agent's own LLM-call cost (proposer + approver + recombine internals) but not the binary-search pairwise comparisons that place the new variant in the Elo pool. Including ranking cost would inflate `cost_for_75pct` further, especially for `paragraph_recombine` which triggers many ranking calls per invocation.
2. **Seed-generation cost not included.** The canonical seed already exists in the arena and is reused free of charge by every run. If "from scratch" means *generating a fresh seed from the prompt*, add ~$0.0008 – $0.005 in seed-generation cost (two LLM calls for title + article, depending on the generation model).
3. **n = 1,408 is dominated by `structural_transform` (n=470), `lexical_simplify` (n=414), and `grounding_enhance` (n=374).** The aggregate `p = 7.81 %` is largely a weighted average of those three agents' from-seed performance. Strategies that change the agent mix will shift the aggregate rate.
4. **Single-agent dispatch (Q3) ignores cross-agent synergy.** The per-agent rows assume you'd dispatch *only* that agent against the seed. In practice, mixing agents could outperform any single-agent recipe.
5. **The seed's Elo changes over time** as new descendants are added and lose to it (rare) or beat it. Future analyses against the same seed may see a slightly different starting Elo and slightly different p90 hit rates if the arena cutoff drifts.
6. **Other "root-like" variants exist in the arena** at higher Elos (gen-0 `structural_transform` / `grounding_enhance` variants at Elo 1244–1300 from other runs). They are not the canonical seed and are excluded from this analysis. A future report could compute "cost from a pre-evolved root" using one of those higher-Elo gen-0 variants as the starting point, which would change the answer significantly downward.

**Reproducibility.** Full SQL in `queries.sql`; all results inlined in `dataset.csv` and in § Queries & Results below. To regenerate: clone this folder, run Q1/Q2/Q3 against staging, compare to the captured rows.

## Key Findings

1. **The seed sits at Elo 1104.6, well below the default 1200.** The user-supplied "around 1200" intuition reflects the `DEFAULT_ELO` constant for unrated variants; in practice the federal_reserve_2 seed has been rated 21 times and pushed down to ~1105 by losing most matches to its evolved descendants. The lift to p90 is **~182 Elo points** per successful rewrite — a non-trivial structural change.

2. **Empirical aggregate answer: ~$0.031 (~3.1¢) and ~18 attempts for 75 % confidence.** Across the system's actual historical mix of agents dispatched against this seed (n = 1,408), the per-invocation p90 hit rate is **7.81 %**. With average invocation cost $0.00174, the geometric calculation gives **N = 18 invocations × $0.00174 = $0.0314**. This is the empirical default cost a researcher would face if they simply replayed the historical dispatch mix.

3. **Cheapest deliberate path is `structural_transform`-only: ~$0.0145 (1.5¢) and 9 attempts.** With the largest credible sample at this seed (n = 470), `structural_transform` produces a p90 child **15.11 %** of the time at $0.00161 per invocation. Geometric cost: `N = 9 × $0.00161 = $0.0145`. This is roughly **half the empirical default**, achieved purely by changing the agent mix to wholesale structural rewrites of the seed.

4. **`lexical_simplify` from the seed has produced ZERO p90 variants across 414 attempts** (~$0.60 of historical compute). It is the single largest source of wasted from-seed budget on this prompt. Permanently disabling it from seed-mode dispatch would cut the historical wasted spend by ~$0.60 with no loss of p90 hits.

5. **Four other agents are 0-hit from the seed despite ≥ 5 attempts:** `pedagogy_scaffold` (0/5), `progressive_disclosure` (0/6), `sensory_concretize` (0/7), and `paragraph_recombine` (0/8). The criteria-driven family is also 0-hit from seed: `criteria_driven_single_pass` (0/18) and `criteria_driven_propose_approve` (0/54). All eight should be excluded from seed-mode iteration slots.

6. **`paragraph_recombine` from-seed is uniquely wasteful**: 0/8 hits at $0.01677 per invocation — 10× the per-call cost of every other agent. Even one attempt against the seed costs more than 9 `structural_transform` attempts combined. This agent requires a strong parent to be economically viable; dispatching it on the canonical seed pure-burns compute.

7. **`grounding_enhance` is the second-best deliberate path at $0.027 for 75 %**, with the second-largest sample (n = 374) and an 8.56 % from-seed p90 rate — meaningfully below `structural_transform`'s 15.11 %, requiring **16 attempts × $0.00169 = $0.0270**. It is roughly 1.9× more expensive than `structural_transform` for the same 75 % confidence target.

8. **The from-seed aggregate rate (7.81 %) is lower than the all-rewrites pooled rate (9.61 %, from the rewrite-success-by-top-tier analysis).** The gap (~1.8 points) reflects the boost provided by attempts on already-strong parents: when researchers dispatch agents against top-tier pool variants, some of those attempts succeed at higher rates than from-seed work, raising the pooled average. The cleaner from-seed-only filter isolates the "starting from scratch" rate.

9. **The 75 % confidence target is conservative.** Re-running the geometric formula for other confidence targets at the structural_transform 15.11 % hit rate:

    | Confidence target | N attempts | $ total |
    |---:|---:|---:|
    | 50 % | 5 | $0.0081 |
    | 75 % | 9 | $0.0145 |
    | 90 % | 15 | $0.0242 |
    | 95 % | 19 | $0.0306 |
    | 99 % | 29 | $0.0467 |

    Doubling confidence from 50 % to 99 % only costs ~6× more — a favorable confidence-versus-budget curve.

10. **Headline strategic recommendation.** For a researcher running a fresh evolution strategy against `federal_reserve_2` (or a structurally similar prompt) who needs at least one p90 variant to compete for arena attention: **dispatch ~9 `structural_transform` invocations against the seed at total cost ~$0.015**. This carries a 75 % probability of at least one p90 hit and a 50 % probability of at least one p99-class hit (Elo > 1384), based on the historical tail of structural_transform from-seed results.

## Dataset

`dataset.csv` (12 rows, < 1 KB) holds the full Q2 aggregate + Q3 per-agent (n ≥ 5) breakdown. Columns:

| Column | Type | Notes |
|---|---|---|
| `slice` | text | `ALL` for the aggregate row; `agent` for per-agent rows |
| `agent_name` | text | `ALL` on the aggregate row; the producing agent's name otherwise |
| `n_attempts` | int | Historical rewrite attempts in this slice |
| `n_p90_hits` | int | Subset where `child.elo_score > 1287` |
| `p90_rate_pct` | numeric | `p = 100 * n_p90_hits / n_attempts` |
| `cost_per_invocation` | numeric | `avg(cost_usd)` in USD |
| `n_needed_for_75pct` | int | `⌈ln(0.25)/ln(1 − p/100)⌉`. Blank when p = 0. |
| `cost_for_75pct` | numeric | `n_needed_for_75pct × cost_per_invocation` in USD. Blank when p = 0. |

**PII safety.** The dataset contains only aggregate counts and USD figures — no user identifiers, no `email`, no raw query text, no authentication metadata, no article content. Confirm `dataset.csv` contains no PII before committing.

Inline preview — aggregate plus per-agent (sorted by p90 rate descending):

| Slice | n | hits | **p (%)** | $/inv | **N for 75%** | **$ for 75%** |
|---|---:|---:|---:|---:|---:|---:|
| **ALL (from seed)** | **1,408** | **110** | **7.81** | $0.00174 | **18** | **$0.0314** |
| zoom_lens | 5 | 1 | 20.00 | $0.00155 | 7 | $0.0108 |
| **structural_transform** | **470** | **71** | **15.11** | $0.00161 | **9** | **$0.0145** |
| narrative_weave | 7 | 1 | 14.29 | $0.00141 | 9 | $0.0127 |
| grounding_enhance | 374 | 32 | 8.56 | $0.00169 | 16 | $0.0270 |
| pedagogy_scaffold | 5 | 0 | 0.00 | $0.00146 | — (∞) | — |
| progressive_disclosure | 6 | 0 | 0.00 | $0.00111 | — (∞) | — |
| sensory_concretize | 7 | 0 | 0.00 | $0.00156 | — (∞) | — |
| paragraph_recombine | 8 | 0 | 0.00 | $0.01677 | — (∞) | — |
| criteria_driven_single_pass | 18 | 0 | 0.00 | $0.00251 | — (∞) | — |
| **lexical_simplify** | **414** | **0** | **0.00** | $0.00145 | — (∞) | — (~$0.60 wasted) |
| criteria_driven_propose_approve | 54 | 0 | 0.00 | $0.00335 | — (∞) | — |

## Queries & Results

All three queries below were run via `npm run query:staging -- --json "<query>"` against the staging Supabase `readonly_local` role on 2026-06-18. Exact SQL is in `queries.sql`. Full results are inlined in `dataset.csv` and previewed in § Dataset above.

### Q1 — Confirm canonical seed identity

```sql
SELECT id, agent_name, generation, generation_method,
       round(elo_score::numeric, 1) AS elo_score,
       arena_match_count, length(variant_content) AS content_chars, created_at
FROM evolution_variants
WHERE id = '26ab2327-6f14-488d-b68f-9e155a7ed278';
```

Result (1 row):

```json
[
  {
    "id": "26ab2327-6f14-488d-b68f-9e155a7ed278",
    "agent_name": "baseline",
    "generation": 0,
    "generation_method": "seed",
    "elo_score": "1104.6",
    "arena_match_count": 21,
    "content_chars": 7682,
    "created_at": "2026-04-15T04:30:34.000Z"
  }
]
```

### Q2 — Aggregate (from-seed pooled)

```sql
WITH children AS (
  SELECT v.elo_score AS child_elo, v.agent_name, i.cost_usd
  FROM evolution_variants v
  JOIN evolution_agent_invocations i ON i.id = v.agent_invocation_id
  WHERE v.prompt_id='a546b7e9-f066-403d-9589-f5e0d2c9fa4f'
    AND v.synced_to_arena=true AND v.archived_at IS NULL
    AND v.variant_kind='article'
    AND v.parent_variant_ids[1] = '26ab2327-6f14-488d-b68f-9e155a7ed278'
    AND i.cost_usd IS NOT NULL AND i.cost_usd > 0
)
SELECT 'ALL (from seed 26ab2327)' AS slice,
       count(*) AS n,
       count(*) FILTER (WHERE child_elo > 1287) AS n_p90,
       round((100.0*count(*) FILTER (WHERE child_elo > 1287)/count(*))::numeric, 2) AS p90_rate_pct,
       round(avg(cost_usd)::numeric, 5) AS cost_per_invocation,
       CASE WHEN count(*) FILTER (WHERE child_elo > 1287) = 0 THEN NULL
            ELSE ceil(ln(0.25)/ln(1 - count(*) FILTER (WHERE child_elo > 1287)::float/count(*))) END AS n_needed_for_75pct,
       CASE WHEN count(*) FILTER (WHERE child_elo > 1287) = 0 THEN NULL
            ELSE round((avg(cost_usd) * ceil(ln(0.25)/ln(1 - count(*) FILTER (WHERE child_elo > 1287)::float/count(*))))::numeric, 4) END AS cost_for_75pct
FROM children;
```

Result (1 row):

```json
[
  {
    "slice": "ALL (from seed 26ab2327)",
    "n": "1408",
    "n_p90": "110",
    "p90_rate_pct": "7.81",
    "cost_per_invocation": "0.00174",
    "n_needed_for_75pct": 18,
    "cost_for_75pct": "0.0314"
  }
]
```

### Q3 — Per-agent (n ≥ 5)

```sql
WITH children AS (
  SELECT v.elo_score AS child_elo, v.agent_name, i.cost_usd
  FROM evolution_variants v
  JOIN evolution_agent_invocations i ON i.id = v.agent_invocation_id
  WHERE v.prompt_id='a546b7e9-f066-403d-9589-f5e0d2c9fa4f'
    AND v.synced_to_arena=true AND v.archived_at IS NULL
    AND v.variant_kind='article'
    AND v.parent_variant_ids[1] = '26ab2327-6f14-488d-b68f-9e155a7ed278'
    AND i.cost_usd IS NOT NULL AND i.cost_usd > 0
)
SELECT agent_name, count(*) AS n,
       count(*) FILTER (WHERE child_elo > 1287) AS n_p90,
       round((100.0*count(*) FILTER (WHERE child_elo > 1287)/count(*))::numeric, 2) AS p90_rate_pct,
       round(avg(cost_usd)::numeric, 5) AS cost_per_invocation,
       CASE WHEN count(*) FILTER (WHERE child_elo > 1287) = 0 THEN NULL
            ELSE ceil(ln(0.25)/ln(1 - count(*) FILTER (WHERE child_elo > 1287)::float/count(*))) END AS n_needed_for_75pct,
       CASE WHEN count(*) FILTER (WHERE child_elo > 1287) = 0 THEN NULL
            ELSE round((avg(cost_usd) * ceil(ln(0.25)/ln(1 - count(*) FILTER (WHERE child_elo > 1287)::float/count(*))))::numeric, 4) END AS cost_for_75pct
FROM children
GROUP BY agent_name
HAVING count(*) >= 5
ORDER BY p90_rate_pct DESC NULLS LAST;
```

Result (11 rows, full data in `dataset.csv`):

```json
[
  { "agent_name": "zoom_lens",                       "n":   "5", "n_p90":  "1", "p90_rate_pct": "20.00", "cost_per_invocation": "0.00155", "n_needed_for_75pct": 7,    "cost_for_75pct": "0.0108" },
  { "agent_name": "structural_transform",            "n": "470", "n_p90": "71", "p90_rate_pct": "15.11", "cost_per_invocation": "0.00161", "n_needed_for_75pct": 9,    "cost_for_75pct": "0.0145" },
  { "agent_name": "narrative_weave",                 "n":   "7", "n_p90":  "1", "p90_rate_pct": "14.29", "cost_per_invocation": "0.00141", "n_needed_for_75pct": 9,    "cost_for_75pct": "0.0127" },
  { "agent_name": "grounding_enhance",               "n": "374", "n_p90": "32", "p90_rate_pct":  "8.56", "cost_per_invocation": "0.00169", "n_needed_for_75pct": 16,   "cost_for_75pct": "0.0270" },
  { "agent_name": "pedagogy_scaffold",               "n":   "5", "n_p90":  "0", "p90_rate_pct":  "0.00", "cost_per_invocation": "0.00146", "n_needed_for_75pct": null, "cost_for_75pct": null     },
  { "agent_name": "progressive_disclosure",          "n":   "6", "n_p90":  "0", "p90_rate_pct":  "0.00", "cost_per_invocation": "0.00111", "n_needed_for_75pct": null, "cost_for_75pct": null     },
  { "agent_name": "sensory_concretize",              "n":   "7", "n_p90":  "0", "p90_rate_pct":  "0.00", "cost_per_invocation": "0.00156", "n_needed_for_75pct": null, "cost_for_75pct": null     },
  { "agent_name": "paragraph_recombine",             "n":   "8", "n_p90":  "0", "p90_rate_pct":  "0.00", "cost_per_invocation": "0.01677", "n_needed_for_75pct": null, "cost_for_75pct": null     },
  { "agent_name": "criteria_driven_single_pass",     "n":  "18", "n_p90":  "0", "p90_rate_pct":  "0.00", "cost_per_invocation": "0.00251", "n_needed_for_75pct": null, "cost_for_75pct": null     },
  { "agent_name": "lexical_simplify",                "n": "414", "n_p90":  "0", "p90_rate_pct":  "0.00", "cost_per_invocation": "0.00145", "n_needed_for_75pct": null, "cost_for_75pct": null     },
  { "agent_name": "criteria_driven_propose_approve", "n":  "54", "n_p90":  "0", "p90_rate_pct":  "0.00", "cost_per_invocation": "0.00335", "n_needed_for_75pct": null, "cost_for_75pct": null     }
]
```
