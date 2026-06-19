# Rewrite Efficacy Decay Curve — Federal Reserve 2

## Header
- **Analysis name:** rewrite-efficacy-decay-federal-reserve-2-20260617
- **Project:** docs/planning/meta_analysis_how_to_get_top_arena_federal_reserve_2_20260616/
- **Branch:** feat/meta_analysis_how_to_get_top_arena_federal_reserve_2_20260616
- **Date:** 2026-06-17 (Δ-Elo bucket table); cost columns A + B added 2026-06-18
- **Source research doc:** docs/planning/meta_analysis_how_to_get_top_arena_federal_reserve_2_20260616/meta_analysis_how_to_get_top_arena_federal_reserve_2_research.md (§ "Rewrite efficacy decay — all-rewrites pooled, 50-Elo parent buckets")
- **Related analysis:** docs/analysis/rewrite-success-by-top-tier-federal-reserve-2-20260618/ — same cost dataset, drilled into two specific percentile-derived parent cutoffs (top 10 % at Elo ≥ 1287, top 5 % at Elo ≥ 1319) with per-agent breakdown. The cost-per-invocation and cost-per-improver columns added below mirror that report's columns A and B.

## Methodology

**Question.** How does the probability and magnitude of a rewrite improving its parent's Elo depend on the parent's Elo, for the `Federal Reserve 2` arena prompt?

**Data source.** Staging Supabase (read-only role `readonly_local`, accessed via `npm run query:staging`), tables `evolution_variants` (self-joined for parent lookup) and `evolution_prompts`.

**Prompt scope.** Only the `Federal Reserve 2` arena topic (`evolution_prompts.id = a546b7e9-f066-403d-9589-f5e0d2c9fa4f`, `prompt_kind='article'`). This prompt exists on staging only — there is no production counterpart.

**Inclusion criteria for "rewrites".** For each row in `evolution_variants` matching:
- `prompt_id = a546b7e9-f066-403d-9589-f5e0d2c9fa4f`
- `synced_to_arena = true`
- `archived_at IS NULL`
- `variant_kind = 'article'` (paragraph-recombine slot rewrites excluded — different scoring regime)
- `generation > 0` (excludes seeded/baseline variants)
- `parent_variant_ids` non-empty (must have a real pipeline parent)

The primary parent is `parent_variant_ids[1]` (PostgreSQL 1-indexed, matches the canonical primary parent convention used in `get_variant_full_chain`). The parent's `elo_score` is taken at query time (live), so multi-parent debate variants use only their canonical primary.

**Computed metric.** Δ-Elo = `child.elo_score − parent.elo_score`. Aggregated into 8 fixed 50-Elo buckets by parent Elo: `bucket = floor(parent.elo_score / 50) * 50`. Per bucket: `n_attempts`, `n_improvers` (Δ > 0), `improver_pct`, `avg_delta`, `median_delta` (`percentile_cont(0.5)`), `avg_delta_when_up` (filter Δ > 0), `avg_delta_when_down` (filter Δ < 0), `min_delta`, `max_delta`.

**Cost columns (added 2026-06-18).** LEFT-joined `evolution_agent_invocations.cost_usd` via `evolution_variants.agent_invocation_id`. Per bucket:
- **n_with_cost**: count of rewrites whose invocation row exists with `cost_usd > 0`. Slightly lower than `n_attempts` only in the 1100–1150 bucket (1,421 of 1,433) — older rows pre-date the FK addition or carry NULL cost. All other buckets have 100 % coverage.
- **cost_per_invocation (column A)**: `avg(cost_usd)` over rewrites with non-null cost. The realized LLM-call cost per attempt at this parent quality.
- **total_cost**: `sum(cost_usd)` — total USD compute spent at this parent tier.
- **cost_per_improver (column B)**: `total_cost / n_improvers` (where n_improvers also requires non-null cost). The bottom-line economic question: how much does it cost to buy one variant that beats its parent?

**Sample size.** **2,323 rewrites** total across all agents/strategies/runs against this prompt; **2,311** of those have invocation cost data (98.5 % coverage).

**Caveats affecting interpretation.**
1. **Elo 1200 is the default for unrated variants** (`DEFAULT_ELO = 1200` in `evolution/src/lib/shared/rating.ts`; `evolution_variants.elo_score NOT NULL DEFAULT 1200`). A small fraction of parents in the 1150–1250 buckets may have 0 matches and therefore an Elo of exactly 1200 by default rather than by judging. This biases the 1150–1250 region toward the default value — the crossover detected at ~Elo 1200 should be interpreted as "around the default" rather than a precise threshold.
2. **Live parent Elo, not at-rewrite-time Elo.** The parent's `elo_score` is read live. Since the arena Elo can drift after a parent enters the arena (further matches shift it), the parent's effective Elo when its child was generated may differ from the value used here. For aggregate trends across thousands of rewrites this averages out; for single-variant interpretation it could matter.
3. **Independent-bucket aggregation.** No control for agent type, generation depth, model, or strategy. All rewrites are pooled per bucket. Bucket-internal heterogeneity (especially in 1300+ buckets, where the agent mix shifts toward polish agents) is called out in Finding 6 but not removed by the SQL.
4. **No outlier capping.** The Δ range extends to −296 and +311. Means are sensitive to these tails; medians are reported alongside for robustness.
5. **Static cutoff times.** The Δ-Elo query reflects staging at 2026-06-17; the cost query reflects 2026-06-18. New rewrites against this prompt after those dates will shift bucket counts and may change the picture, especially in the strong-parent (>1300) buckets where current sample size is thin.

6. **Cost is invocation cost only — ranking cost excluded.** `evolution_agent_invocations.cost_usd` captures the LLM-call cost the agent itself consumed; it does NOT include the per-rewrite ranking cost (binary-search pairwise comparisons placing the new variant in the Elo pool). For agents that trigger many ranking calls per rewrite — `paragraph_recombine` in particular — including ranking cost would inflate cost-per-improver further. The cost columns here therefore underestimate the true economic cost; the *relative* ranking between buckets remains directionally correct because the agent mix in each bucket has been roughly stable across the prompt's history.

**Reproducibility.** Full SQL is in `queries.sql`; results inlined verbatim in § Queries & Results and in `dataset.csv`. To regenerate: clone this folder, run the Q3 query against staging via `npm run query:staging -- --json`, compare `dataset.csv` to the new output.

## Key Findings

1. **Phase transition at parent Elo ≈ 1200.** Median Δ flips from +1.0 (1150–1200 bucket) to −2.1 (1200–1250 bucket), and mean Δ flips from +6.6 to −4.2. Below 1200, the average rewrite is net positive; above 1200, the average rewrite destroys quality. Note caveat 1: the default-Elo floor sits exactly at the crossover, so the precise threshold should be read as "around 1200" rather than precisely 1200.

2. **Improver rate cascades 78 % → 0 % across the 1100→1450 parent range.** Per-bucket attempt-success: 100.0 % (1050, n=3) → 78.1 % (1100, n=1433) → 51.9 % (1150, n=54) → 44.1 % (1200, n=186) → 16.8 % (1250, n=475) → 7.4 % (1300, n=108) → 17.0 % (1350, n=53) → 0.0 % (1400, n=11). The steepest single drop is between the 1200–1250 and 1250–1300 buckets (44.1 % → 16.8 %).

3. **Asymmetric magnitude scaling: upside compresses, downside grows.** Mean Δ when the rewrite improves: +100.9 → +39.2 → +36.9 → +21.9 → +27.0 → +12.2 across the 1100→1350 range (then no improvers at 1400+). Mean Δ when the rewrite regresses: −23.7 → −28.4 → −36.7 → −51.7 → −95.8 → −105.3 → −143.5. Across the 1100→1450 range the downside scales ~6× while the upside shrinks ~8×, so expected value per attempt collapses.

4. **Elo 1400 is a hard ceiling for federal_reserve_2 at this moment.** Of the 11 rewrites attempted against a parent in the 1400–1450 bucket, **0 improved** and the mean Δ was −143.5. No rewrite has ever lifted a parent above Elo 1400 on this prompt. The current arena top (Elo 1431) is therefore a wall the system hasn't pushed past despite dedicated attempts.

5. **The dataset is ~8× undersampled on strong parents.** The 1100–1150 bucket holds 1,433 of 2,323 attempts (62 %) because the canonical baseline sits at Elo 1104.6 and most pipeline runs start there. Parents > 1300 Elo total just 172 attempts (108 + 53 + 11). To learn more about the strong-parent regime, the system needs to *deliberately dispatch* more invocations with `sourceMode: 'pool'` + tight `qualityCutoff` (topN = 1 or 2) — currently pool-mode defaults to topN = 3–5, which dilutes the high-end sample.

6. **The 1350–1400 bucket beats the 1300–1350 bucket on improver rate (17.0 % vs 7.4 %).** This isn't because rewrites are easier on a stronger parent — the magnitudes are worse (mean Δ when down −105 vs −96). It's because the 1300–1350 bucket includes more regression-prone wholesale-rewrite tactics (the volume workhorses occasionally land here when pool topN is loose) while the 1350+ range is dominated by polish-oriented agents (`iterative_editing`, `iterative_editing_rewrite`) that at least try the right pattern. **Agent-selection mix matters more than parent Elo at the top of the curve** — gate the right agents to the right parent range and the 7 % floor lifts to 17–28 %.

### Cost findings (columns A + B, added 2026-06-18)

7. **Cost per invocation is roughly flat across all buckets ($0.0017 – $0.0035).** Per-invocation cost varies less than 2× across the entire parent-Elo range: $0.00168 (1050–1100) → $0.00175 (1100–1150) → $0.00283 (1150–1200) → $0.00275 (1200–1250) → $0.00222 (1250–1300) → $0.00314 (1300–1350) → $0.00282 (1350–1400) → $0.00353 (1400–1450). The LLM-call cost depends on the agent, not the parent quality, and the agent mix is broadly similar across buckets. The slightly higher per-invocation cost in the top buckets (~$0.003) reflects the heavier polish-oriented agents (`criteria_driven_single_pass`, `iterative_editing`) being over-represented there.

8. **Cost per improver scales ~25× across the curve.** From cheapest to most expensive bucket: $0.0017 (1050–1100, n=3) → $0.0022 (1100–1150) → $0.0055 (1150–1200) → $0.0062 (1200–1250) → $0.0132 (1250–1300) → **$0.0424 (1300–1350)** → $0.0166 (1350–1400) → undefined (1400–1450, zero improvers). The 1300–1350 bucket is the **costliest improver bucket on this prompt** — 19× more expensive per success than the 1100–1150 baseline bucket. This is the economic mirror of the Δ-Elo decay: as success rate collapses, the dollar cost of buying one win explodes.

9. **The 1350–1400 bucket beats 1300–1350 on cost-per-improver too ($0.0166 vs $0.0424).** Same agent-mix story as finding 6 — polish agents at the very top are cheaper *and* more often successful. The agent-selection cliff between these two buckets manifests as a 2.6× cost savings on top of the 2.3× success-rate lift.

10. **The 1400–1450 bucket has spent $0.0388 producing zero improvers.** The 11 attempts at this tier cost roughly 4 cents total — a small absolute number, but **infinity dollars per improver** since none of them succeeded. Future strategy design should treat this regime as research-mode only: don't expect to amortize the spend across improvements.

11. **The 1100–1150 baseline bucket dominates total spend ($2.48 of $4.73 total = 52 %)** because it dominates attempt counts. At $0.0022 per improver, the system has paid roughly the price of a sandwich to produce 1,119 successful rewrites of the canonical baseline. This is the cheapest, most productive compute on the prompt — and it's where the volume of arena variants comes from.

12. **The strategic spend ratio at strong parents.** Buckets 1300–1450 cost a combined $0.527 (1300–1350 $0.339 + 1350–1400 $0.149 + 1400–1450 $0.039) and produced 17 improvers — **$0.031 per improver pooled**, but with high variance bucket-to-bucket. Compare to buckets 1100–1200's $2.63 producing 1,147 improvers at **$0.0023 per improver pooled** — a 13× cost differential. Strong-parent improvement is **13× more expensive per unit gain** than baseline improvement; the strategic question is whether the marginal Elo lift at the top is worth that premium.

## Dataset

Full result inlined as `dataset.csv` (8 rows, ≤ 2 KB). One row per 50-Elo parent-Elo bucket. Columns:

| Column | Type | Notes |
|---|---|---|
| `parent_elo_bucket` | int | Lower edge of the bucket (e.g. `1100` covers `[1100, 1150)`) |
| `bucket_range` | text | Human-readable range string |
| `n_attempts` | int | Total rewrites in this bucket |
| `n_improvers` | int | Rewrites with Δ > 0 |
| `improver_pct` | numeric | `100 * n_improvers / n_attempts` |
| `avg_delta` | numeric | Mean Δ (signed) |
| `median_delta` | numeric | `percentile_cont(0.5)` of Δ |
| `avg_delta_when_up` | numeric | Mean Δ over rewrites with Δ > 0 (null if 0 improvers) |
| `avg_delta_when_down` | numeric | Mean Δ over rewrites with Δ < 0 (null if 0 regressors) |
| `min_delta` | numeric | Minimum (most-negative) Δ |
| `max_delta` | numeric | Maximum (most-positive) Δ |
| `n_with_cost` | int | Rewrites in the bucket whose invocation row has `cost_usd > 0` |
| `cost_per_invocation` | numeric | **Column A** — `avg(cost_usd)` over rewrites with cost data (USD) |
| `total_cost` | numeric | `sum(cost_usd)` for the bucket (USD) |
| `cost_per_improver` | numeric | **Column B** — `total_cost / n_improvers` (USD per successful rewrite); blank when `n_improvers = 0` |

**PII safety.** The dataset contains only arena Elo aggregates, bucket counts, and USD compute totals — no user identifiers, no `email`, no raw query text, no authentication metadata, no article content. Confirm `dataset.csv` contains no PII before committing.

Inline preview (matches `dataset.csv`):

| Parent Elo | n | improver % | mean Δ | median Δ | mean ↑ | mean ↓ | min / max | **$/inv** | total $ | **$/improver** |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1050–1100 | 3 | 100.0 | +136.6 | +165.4 | +136.6 | — | +1.2 / +243.1 | $0.00168 | $0.0050 | $0.0017 |
| 1100–1150 | 1,433 | 78.1 | +73.6 | +69.1 | +100.9 | −23.7 | −68.6 / +311.6 | $0.00175 | $2.4806 | **$0.0022** |
| 1150–1200 | 54 | 51.9 | +6.6 | +1.0 | +39.2 | −28.4 | −109.9 / +111.7 | $0.00283 | $0.1529 | $0.0055 |
| 1200–1250 | 186 | 44.1 | −4.2 | −2.1 | +36.9 | −36.7 | −162.7 / +115.6 | $0.00275 | $0.5115 | $0.0062 |
| 1250–1300 | 475 | 16.8 | −39.3 | −41.5 | +21.9 | −51.7 | −214.7 / +113.6 | $0.00222 | $1.0556 | $0.0132 |
| 1300–1350 | 108 | 7.4 | −86.7 | −91.4 | +27.0 | −95.8 | −261.8 / +119.5 | $0.00314 | $0.3393 | **$0.0424** |
| 1350–1400 | 53 | 17.0 | −85.3 | −90.2 | +12.2 | −105.3 | −296.4 / +41.9 | $0.00282 | $0.1493 | $0.0166 |
| 1400–1450 | 11 | 0.0 | −143.5 | −144.9 | — | −143.5 | −252.3 / −58.0 | $0.00353 | $0.0388 | — |
| **Total** | **2,323** | | | | | | | | **$4.7330** | |

## Queries & Results

All queries below were run via `npm run query:staging -- --json "<query>"` against the staging Supabase `readonly_local` role on 2026-06-17. The exact SQL is also in `queries.sql`.

### Q1 — Confirm prompt identity

```sql
SELECT id, name, prompt_kind, status, archived_at, created_at
FROM evolution_prompts
WHERE name ILIKE '%federal%reserve%2%';
```

Result:

```json
[
  {
    "id": "a546b7e9-f066-403d-9589-f5e0d2c9fa4f",
    "name": "Federal Reserve 2",
    "prompt_kind": "article",
    "status": "active",
    "archived_at": null,
    "created_at": "2026-04-15T04:18:02.073Z"
  }
]
```

### Q2 — Arena population size for the prompt

```sql
SELECT count(*) AS total,
       count(*) FILTER (WHERE archived_at IS NULL) AS active,
       count(*) FILTER (WHERE variant_kind='paragraph') AS paragraph,
       count(*) FILTER (WHERE variant_kind='article') AS article
FROM evolution_variants
WHERE prompt_id='a546b7e9-f066-403d-9589-f5e0d2c9fa4f'
  AND synced_to_arena=true;
```

Result:

```json
[ { "total": "2388", "active": "2388", "paragraph": "0", "article": "2388" } ]
```

The 2,388 active arena variants include 65 root variants (`generation = 0` or empty `parent_variant_ids`) which the Q3 filter excludes. The Q3 pool of 2,323 rewrites = `2,388 − 65`.

### Q3 — Main decay-curve table

```sql
WITH children AS (
  SELECT v.elo_score AS child_elo, v.parent_variant_ids[1] AS parent_id
  FROM evolution_variants v
  WHERE v.prompt_id='a546b7e9-f066-403d-9589-f5e0d2c9fa4f'
    AND v.synced_to_arena=true AND v.archived_at IS NULL
    AND v.variant_kind='article' AND v.generation > 0
    AND v.parent_variant_ids IS NOT NULL AND cardinality(v.parent_variant_ids) > 0
),
pairs AS (
  SELECT c.child_elo, p.elo_score AS parent_elo, c.child_elo - p.elo_score AS delta,
         (floor(p.elo_score/50.0)*50)::int AS bucket
  FROM children c JOIN evolution_variants p ON p.id = c.parent_id
)
SELECT bucket AS parent_elo_bucket,
       count(*) AS n_attempts,
       count(*) FILTER (WHERE delta > 0) AS n_improvers,
       round((100.0 * count(*) FILTER (WHERE delta > 0) / count(*))::numeric, 1) AS improver_pct,
       round(avg(delta)::numeric, 1) AS avg_delta,
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY delta))::numeric, 1) AS median_delta,
       round(avg(delta) FILTER (WHERE delta > 0)::numeric, 1) AS avg_delta_when_up,
       round(avg(delta) FILTER (WHERE delta < 0)::numeric, 1) AS avg_delta_when_down,
       round(min(delta)::numeric, 1) AS min_delta,
       round(max(delta)::numeric, 1) AS max_delta
FROM pairs GROUP BY bucket ORDER BY bucket;
```

Result (also in `dataset.csv`):

```json
[
  { "parent_elo_bucket": 1050, "n_attempts": "3",    "n_improvers": "3",    "improver_pct": "100.0", "avg_delta": "136.6", "median_delta": "165.4", "avg_delta_when_up": "136.6", "avg_delta_when_down": null,     "min_delta": "1.2",    "max_delta": "243.1" },
  { "parent_elo_bucket": 1100, "n_attempts": "1433", "n_improvers": "1119", "improver_pct": "78.1",  "avg_delta": "73.6",  "median_delta": "69.1",  "avg_delta_when_up": "100.9", "avg_delta_when_down": "-23.7",  "min_delta": "-68.6",  "max_delta": "311.6" },
  { "parent_elo_bucket": 1150, "n_attempts": "54",   "n_improvers": "28",   "improver_pct": "51.9",  "avg_delta": "6.6",   "median_delta": "1.0",   "avg_delta_when_up": "39.2",  "avg_delta_when_down": "-28.4",  "min_delta": "-109.9", "max_delta": "111.7" },
  { "parent_elo_bucket": 1200, "n_attempts": "186",  "n_improvers": "82",   "improver_pct": "44.1",  "avg_delta": "-4.2",  "median_delta": "-2.1",  "avg_delta_when_up": "36.9",  "avg_delta_when_down": "-36.7",  "min_delta": "-162.7", "max_delta": "115.6" },
  { "parent_elo_bucket": 1250, "n_attempts": "475",  "n_improvers": "80",   "improver_pct": "16.8",  "avg_delta": "-39.3", "median_delta": "-41.5", "avg_delta_when_up": "21.9",  "avg_delta_when_down": "-51.7",  "min_delta": "-214.7", "max_delta": "113.6" },
  { "parent_elo_bucket": 1300, "n_attempts": "108",  "n_improvers": "8",    "improver_pct": "7.4",   "avg_delta": "-86.7", "median_delta": "-91.4", "avg_delta_when_up": "27.0",  "avg_delta_when_down": "-95.8",  "min_delta": "-261.8", "max_delta": "119.5" },
  { "parent_elo_bucket": 1350, "n_attempts": "53",   "n_improvers": "9",    "improver_pct": "17.0",  "avg_delta": "-85.3", "median_delta": "-90.2", "avg_delta_when_up": "12.2",  "avg_delta_when_down": "-105.3", "min_delta": "-296.4", "max_delta": "41.9" },
  { "parent_elo_bucket": 1400, "n_attempts": "11",   "n_improvers": "0",    "improver_pct": "0.0",   "avg_delta": "-143.5","median_delta": "-144.9","avg_delta_when_up": null,    "avg_delta_when_down": "-143.5", "min_delta": "-252.3", "max_delta": "-58.0" }
]
```

### Q4 — Cost-augmented decay-curve table (added 2026-06-18)

Same population as Q3 with a LEFT JOIN to `evolution_agent_invocations` for `cost_usd`. The LEFT JOIN preserves the 2,323-row total even for the 12 baseline-bucket rewrites missing invocation data; cost aggregates ignore those NULL rows.

```sql
WITH children AS (
  SELECT v.elo_score AS child_elo, v.parent_variant_ids[1] AS parent_id, v.agent_invocation_id
  FROM evolution_variants v
  WHERE v.prompt_id='a546b7e9-f066-403d-9589-f5e0d2c9fa4f'
    AND v.synced_to_arena=true AND v.archived_at IS NULL
    AND v.variant_kind='article' AND v.generation > 0
    AND v.parent_variant_ids IS NOT NULL AND cardinality(v.parent_variant_ids) > 0
),
pairs AS (
  SELECT c.child_elo, p.elo_score AS parent_elo, c.child_elo - p.elo_score AS delta,
         i.cost_usd AS cost, (floor(p.elo_score/50.0)*50)::int AS bucket
  FROM children c JOIN evolution_variants p ON p.id = c.parent_id
  LEFT JOIN evolution_agent_invocations i ON i.id = c.agent_invocation_id
)
SELECT bucket AS parent_elo_bucket,
       count(*) AS n_attempts,
       count(*) FILTER (WHERE delta > 0) AS n_improvers,
       round((100.0*count(*) FILTER (WHERE delta > 0)/count(*))::numeric,1) AS improver_pct,
       round(avg(delta)::numeric,1) AS avg_delta,
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY delta))::numeric,1) AS median_delta,
       count(*) FILTER (WHERE cost IS NOT NULL AND cost > 0) AS n_with_cost,
       round(avg(cost)::numeric,5) AS cost_per_invocation,
       round(sum(cost)::numeric,4) AS total_cost,
       round((sum(cost)/NULLIF(count(*) FILTER (WHERE delta > 0 AND cost IS NOT NULL AND cost > 0),0))::numeric,4) AS cost_per_improver
FROM pairs GROUP BY bucket ORDER BY bucket;
```

Result (8 rows, also in `dataset.csv`):

```json
[
  { "parent_elo_bucket": 1050, "n_attempts": "3",    "n_improvers": "3",    "improver_pct": "100.0", "avg_delta": "136.6", "median_delta": "165.4", "n_with_cost": "3",    "cost_per_invocation": "0.00168", "total_cost": "0.0050", "cost_per_improver": "0.0017" },
  { "parent_elo_bucket": 1100, "n_attempts": "1433", "n_improvers": "1119", "improver_pct": "78.1",  "avg_delta": "73.6",  "median_delta": "69.1",  "n_with_cost": "1421", "cost_per_invocation": "0.00175", "total_cost": "2.4806", "cost_per_improver": "0.0022" },
  { "parent_elo_bucket": 1150, "n_attempts": "54",   "n_improvers": "28",   "improver_pct": "51.9",  "avg_delta": "6.6",   "median_delta": "1.0",   "n_with_cost": "54",   "cost_per_invocation": "0.00283", "total_cost": "0.1529", "cost_per_improver": "0.0055" },
  { "parent_elo_bucket": 1200, "n_attempts": "186",  "n_improvers": "82",   "improver_pct": "44.1",  "avg_delta": "-4.2",  "median_delta": "-2.1",  "n_with_cost": "186",  "cost_per_invocation": "0.00275", "total_cost": "0.5115", "cost_per_improver": "0.0062" },
  { "parent_elo_bucket": 1250, "n_attempts": "475",  "n_improvers": "80",   "improver_pct": "16.8",  "avg_delta": "-39.3", "median_delta": "-41.5", "n_with_cost": "475",  "cost_per_invocation": "0.00222", "total_cost": "1.0556", "cost_per_improver": "0.0132" },
  { "parent_elo_bucket": 1300, "n_attempts": "108",  "n_improvers": "8",    "improver_pct": "7.4",   "avg_delta": "-86.7", "median_delta": "-91.4", "n_with_cost": "108",  "cost_per_invocation": "0.00314", "total_cost": "0.3393", "cost_per_improver": "0.0424" },
  { "parent_elo_bucket": 1350, "n_attempts": "53",   "n_improvers": "9",    "improver_pct": "17.0",  "avg_delta": "-85.3", "median_delta": "-90.2", "n_with_cost": "53",   "cost_per_invocation": "0.00282", "total_cost": "0.1493", "cost_per_improver": "0.0166" },
  { "parent_elo_bucket": 1400, "n_attempts": "11",   "n_improvers": "0",    "improver_pct": "0.0",   "avg_delta": "-143.5","median_delta": "-144.9","n_with_cost": "11",   "cost_per_invocation": "0.00353", "total_cost": "0.0388", "cost_per_improver": null     }
]
```
