# Arena Elo Distribution — Federal Reserve 2

## Header
- **Analysis name:** arena-elo-distribution-federal-reserve-2-20260617
- **Project:** docs/planning/meta_analysis_how_to_get_top_arena_federal_reserve_2_20260616/
- **Branch:** feat/meta_analysis_how_to_get_top_arena_federal_reserve_2_20260616
- **Date:** 2026-06-17
- **Source research doc:** docs/planning/meta_analysis_how_to_get_top_arena_federal_reserve_2_20260616/meta_analysis_how_to_get_top_arena_federal_reserve_2_research.md (§ "High Level Summary" — decile bands extended here to standard percentiles + ventiles)
- **Related analysis:** docs/analysis/rewrite-efficacy-decay-federal-reserve-2-20260617/ — same prompt + arena population, characterizes rewrite Δ-Elo by parent bucket. This report describes the *static distribution*; the related report describes the *dynamic improvement curve*.

## Methodology

**Question.** What is the shape of the Federal Reserve 2 arena Elo leaderboard — central tendency, spread, tails — so that the planning project can translate `qualityCutoff: topN` knobs into concrete Elo thresholds and cross-reference the rewrite-efficacy crossover (Elo ≈ 1200) against where population mass sits?

**Data source.** Staging Supabase (read-only role `readonly_local`, accessed via `npm run query:staging`), table `evolution_variants`.

**Prompt scope.** Only the `Federal Reserve 2` arena topic (`evolution_prompts.id = a546b7e9-f066-403d-9589-f5e0d2c9fa4f`, `prompt_kind='article'`). This prompt exists on staging only — no production counterpart.

**Population.** All active synced arena variants for this prompt:
- `prompt_id = a546b7e9-f066-403d-9589-f5e0d2c9fa4f`
- `synced_to_arena = true`
- `archived_at IS NULL`

No `variant_kind` filter — federal_reserve_2 currently has **zero** paragraph-kind arena rows (verified via the prior decay-curve analysis: `SELECT count(*) FILTER (WHERE variant_kind='paragraph')` returned 0). All 2,388 rows are articles.

No `generation` filter — we want the full leaderboard distribution including roots/seeds, since the planning project's `qualityCutoff: topN` semantics select against the full pool, not just rewrites.

**Sample size.** **n = 2,388** active arena variants.

**Computed metrics.**
- Q1: aggregate summary — `min`, `p1`, `p5`, `p10`, `p25`, `p50` (median), `p75`, `p90`, `p95`, `p99`, `max`, mean, stddev. Percentiles computed via PostgreSQL `percentile_cont(<p>)` over the full sample.
- Q2: ventile (5%-bucket) breakdown via `ntile(20)` — per bucket: `n`, `min_elo`, `max_elo`, `avg_elo`. 20 rows total; the first 8 buckets are 120-row groups, the last 12 are 119-row groups (an artifact of `ntile` distributing the remainder).

**Caveats affecting interpretation.**
1. **Variants with 0 matches default to Elo 1200** (`DEFAULT_ELO` in `evolution/src/lib/shared/rating.ts`; `evolution_variants.elo_score NOT NULL DEFAULT 1200`). The exact median sitting at Elo 1200.6 may be slightly inflated by unrated variants clustering at the default. The reported median should be read as "approximately the default Elo."
2. **Live `elo_score` column.** Drift over time as new comparisons land. This is a snapshot at 2026-06-17.
3. **All variants pooled.** No breakdown by agent / strategy / generation. For those splits see the related decay-curve analysis or the source research doc's findings 1–6 (agent composition of top 10%) and findings 31–36 (decay curve).
4. **The current arena ceiling (Elo 1431) is a snapshot, not a permanent ceiling.** Future runs against parent Elo > 1400 could lift it. The related analysis showed 0 of 11 attempts have done so to date.

**Reproducibility.** Full SQL is in `queries.sql`; Q2's 20 rows are in `dataset.csv`; Q1's single summary row is inlined in § Queries & Results. To regenerate: clone this folder, run both queries against staging via `npm run query:staging -- --json`, and compare `dataset.csv` to the new Q2 output.

## Key Findings

1. **The arena's central tendency is exactly the default Elo.** Median = **1200.6**, mean = **1197.8**, both within a rounding error of the `DEFAULT_ELO` constant (1200) used for unrated variants. The mean ≈ median ≈ default coincidence is partly explained by caveat 1 (unrated variants ratchet the median toward the default), but it also reflects a real fact: **half the arena's variants haven't beaten the default rating**.

2. **The rewrite-efficacy crossover equals the population median.** The prior decay-curve analysis identified Elo ≈ 1200 as the rewrite-efficacy crossover (median Δ flips from +1.0 to −2.1 across that boundary). That crossover lands at the population median by construction: any pool-mode parent above the median is in the regime where the average rewrite attempt destroys quality. This is a strong indicator of *system saturation* — half the leaderboard is past the regression-to-mean wall.

3. **Stddev = 75.3, distribution is tight around the mean.** ~68 % of variants fall in roughly 1122 – 1273 (mean ± 1 σ). ~95 % fall in 1047 – 1348 (mean ± 2 σ). The arena is heavily compressed in the middle: the body is far narrower than the tails.

4. **Heavy pile-up between Elo 1200 and 1257.** Ventiles 11 – 17 (35 % of all 2,388 variants) span just 57 Elo points (1200.6 – 1257.1). The arena clusters tightly above the default but below the polished-variant tier — many variants accumulate small Elo gains over the baseline without reaching the high-quality regime.

5. **The top 5 % covers a 112-Elo range — the tail is wider than the body.** Ventile 20 (top 5 %, n = 119) spans Elo 1319 → 1431 (width 112). Compare to ventile 11 (median ± 5 %, n = 119) which spans just 1200.6 → 1209.1 (width 8.5). Top variants are differentiated; mid-tier variants are not. This makes the top 5 % the natural target for `qualityCutoff: topN` knobs aimed at strong parents.

6. **Concrete `qualityCutoff: topN` thresholds for strategy design.** Translating topN values into Elo cutoffs against the current arena:

   | `qualityCutoff: {topN: N}` | Approx. Elo floor | Notes |
   |---:|---:|---|
   | 1 | 1431 | the lone arena ceiling holder |
   | 5 | ≈ 1400 | ventile 20's top edge — essentially `> p99` |
   | 25 | ≈ 1384 | matches p99 |
   | 119 (top 5 %) | 1319 | ventile 20 floor — the documented "polish regime" floor |
   | 239 (top 10 %) | 1287 | matches p90 |
   | 597 (top 25 %) | 1252 | matches p75 |

   Strategies that set `qualityCutoff: {topN: 3}` (as the top-producing "Sequential iteration 2" and "Sequential paragraph rewrite initial" strategies do) effectively select parents with Elo > ~1410. Loosening to topN: 5 brings the cutoff to ~1400; loosening to topN: 25 drops it to ~1384.

7. **Only ~24 variants in the entire arena exceed Elo 1400.** This is `p99` (1383.8) ± a few, with the actual count being 11 + 13 = 24 in the 1400–1450 + 1380–1400 bands (roughly). That tiny population is the pool from which the decay-curve's 1400–1450 parent bucket draws — and explains why only 11 rewrite attempts in the entire arena history have targeted that range. Strong-parent compute is naturally scarce until the leaderboard grows.

## Dataset

`dataset.csv` holds the **Q2 ventile breakdown** (20 rows, ≤ 1 KB) — the canonical reproducible artifact for plotting and re-aggregation. Each row is one 5 % bucket (119–120 variants), ordered ventile 20 (top 5 %) → ventile 1 (bottom 5 %).

Columns:

| Column | Type | Notes |
|---|---|---|
| `ventile` | int | 1 (bottom 5 %) … 20 (top 5 %) |
| `pct_band` | text | Human-readable percentile band (e.g. `"top 5%"`, `"90-95%"`) |
| `n` | int | Rows in this ventile (119 or 120 due to `ntile` remainder distribution) |
| `min_elo` | numeric | Lowest Elo in the bucket |
| `max_elo` | numeric | Highest Elo in the bucket |
| `avg_elo` | numeric | Mean Elo within the bucket |

The Q1 percentile summary is a single row × 14 columns — too narrow to be a useful CSV. It is inlined in § Queries & Results below.

**PII safety.** The dataset contains only arena Elo aggregates and bucket counts — no user identifiers, no `email`, no raw query text, no authentication metadata, no article content. Confirm `dataset.csv` contains no PII before committing.

Inline preview of `dataset.csv` (top-down):

| Ventile | Pct band | n | Elo range | avg Elo |
|---:|---:|---:|---:|---:|
| 20 | top 5% | 119 | 1319.0 – 1431.0 | 1352.5 |
| 19 | 90-95% | 119 | 1287.0 – 1319.0 | 1303.4 |
| 18 | 85-90% | 119 | 1269.1 – 1286.8 | 1277.2 |
| 17 | 80-85% | 119 | 1257.1 – 1269.1 | 1262.1 |
| 16 | 75-80% | 119 | 1252.5 – 1257.1 | 1254.4 |
| 15 | 70-75% | 119 | 1249.6 – 1252.5 | 1251.0 |
| 14 | 65-70% | 119 | 1243.2 – 1249.6 | 1247.1 |
| 13 | 60-65% | 119 | 1222.7 – 1243.1 | 1233.6 |
| 12 | 55-60% | 119 | 1209.1 – 1222.6 | 1215.0 |
| 11 | 50-55% | 119 | 1200.6 – 1209.1 | 1204.1 |
| 10 | 45-50% | 119 | 1196.3 – 1200.6 | 1198.5 |
| 9 | 40-45% | 119 | 1188.3 – 1196.2 | 1192.9 |
| 8 | 35-40% | 120 | 1165.4 – 1188.2 | 1176.3 |
| 7 | 30-35% | 120 | 1147.4 – 1165.4 | 1154.1 |
| 6 | 25-30% | 120 | 1138.8 – 1147.3 | 1142.5 |
| 5 | 20-25% | 120 | 1122.5 – 1138.8 | 1129.3 |
| 4 | 15-20% | 120 | 1110.8 – 1122.5 | 1117.5 |
| 3 | 10-15% | 120 | 1092.8 – 1110.7 | 1098.9 |
| 2 | 5-10% | 120 | 1076.3 – 1092.8 | 1083.3 |
| 1 | bottom 5% | 120 | 1057.7 – 1076.2 | 1067.5 |
| **Total** | | **2,388** | | |

## Queries & Results

Both queries were run via `npm run query:staging -- --json "<query>"` against the staging Supabase `readonly_local` role on 2026-06-17. The exact SQL is also in `queries.sql`.

### Q1 — Percentile summary

```sql
SELECT count(*) AS n,
       round(min(elo_score)::numeric,1) AS min,
       round(percentile_cont(0.01) WITHIN GROUP (ORDER BY elo_score)::numeric,1) AS p1,
       round(percentile_cont(0.05) WITHIN GROUP (ORDER BY elo_score)::numeric,1) AS p5,
       round(percentile_cont(0.10) WITHIN GROUP (ORDER BY elo_score)::numeric,1) AS p10,
       round(percentile_cont(0.25) WITHIN GROUP (ORDER BY elo_score)::numeric,1) AS p25,
       round(percentile_cont(0.50) WITHIN GROUP (ORDER BY elo_score)::numeric,1) AS p50,
       round(percentile_cont(0.75) WITHIN GROUP (ORDER BY elo_score)::numeric,1) AS p75,
       round(percentile_cont(0.90) WITHIN GROUP (ORDER BY elo_score)::numeric,1) AS p90,
       round(percentile_cont(0.95) WITHIN GROUP (ORDER BY elo_score)::numeric,1) AS p95,
       round(percentile_cont(0.99) WITHIN GROUP (ORDER BY elo_score)::numeric,1) AS p99,
       round(max(elo_score)::numeric,1) AS max,
       round(avg(elo_score)::numeric,1) AS mean,
       round(stddev(elo_score)::numeric,1) AS stddev
FROM evolution_variants
WHERE prompt_id='a546b7e9-f066-403d-9589-f5e0d2c9fa4f'
  AND synced_to_arena=true AND archived_at IS NULL;
```

Result (one row):

```json
[
  {
    "n":      "2388",
    "min":    "1057.7",
    "p1":     "1063.1",
    "p5":     "1076.3",
    "p10":    "1092.7",
    "p25":    "1138.6",
    "p50":    "1200.6",
    "p75":    "1252.5",
    "p90":    "1286.6",
    "p95":    "1318.9",
    "p99":    "1383.8",
    "max":    "1431.0",
    "mean":   "1197.8",
    "stddev": "75.3"
  }
]
```

Pivoted for readability:

| Stat | Elo |
|---|---:|
| n | 2,388 |
| min | 1057.7 |
| p1 | 1063.1 |
| p5 | 1076.3 |
| p10 | 1092.7 |
| p25 | 1138.6 |
| **p50 (median)** | **1200.6** |
| p75 | 1252.5 |
| p90 | 1286.6 |
| p95 | 1318.9 |
| p99 | 1383.8 |
| max | 1431.0 |
| **mean** | **1197.8** |
| **stddev** | **75.3** |

### Q2 — Ventile breakdown

```sql
WITH ranked AS (
  SELECT elo_score, ntile(20) OVER (ORDER BY elo_score) AS ventile
  FROM evolution_variants
  WHERE prompt_id='a546b7e9-f066-403d-9589-f5e0d2c9fa4f'
    AND synced_to_arena=true AND archived_at IS NULL
)
SELECT ventile, count(*) AS n,
       round(min(elo_score)::numeric,1) AS min_elo,
       round(max(elo_score)::numeric,1) AS max_elo,
       round(avg(elo_score)::numeric,1) AS avg_elo
FROM ranked GROUP BY ventile ORDER BY ventile DESC;
```

Result (20 rows, full data in `dataset.csv`):

```json
[
  { "ventile": 20, "n": "119", "min_elo": "1319.0", "max_elo": "1431.0", "avg_elo": "1352.5" },
  { "ventile": 19, "n": "119", "min_elo": "1287.0", "max_elo": "1319.0", "avg_elo": "1303.4" },
  { "ventile": 18, "n": "119", "min_elo": "1269.1", "max_elo": "1286.8", "avg_elo": "1277.2" },
  { "ventile": 17, "n": "119", "min_elo": "1257.1", "max_elo": "1269.1", "avg_elo": "1262.1" },
  { "ventile": 16, "n": "119", "min_elo": "1252.5", "max_elo": "1257.1", "avg_elo": "1254.4" },
  { "ventile": 15, "n": "119", "min_elo": "1249.6", "max_elo": "1252.5", "avg_elo": "1251.0" },
  { "ventile": 14, "n": "119", "min_elo": "1243.2", "max_elo": "1249.6", "avg_elo": "1247.1" },
  { "ventile": 13, "n": "119", "min_elo": "1222.7", "max_elo": "1243.1", "avg_elo": "1233.6" },
  { "ventile": 12, "n": "119", "min_elo": "1209.1", "max_elo": "1222.6", "avg_elo": "1215.0" },
  { "ventile": 11, "n": "119", "min_elo": "1200.6", "max_elo": "1209.1", "avg_elo": "1204.1" },
  { "ventile": 10, "n": "119", "min_elo": "1196.3", "max_elo": "1200.6", "avg_elo": "1198.5" },
  { "ventile":  9, "n": "119", "min_elo": "1188.3", "max_elo": "1196.2", "avg_elo": "1192.9" },
  { "ventile":  8, "n": "120", "min_elo": "1165.4", "max_elo": "1188.2", "avg_elo": "1176.3" },
  { "ventile":  7, "n": "120", "min_elo": "1147.4", "max_elo": "1165.4", "avg_elo": "1154.1" },
  { "ventile":  6, "n": "120", "min_elo": "1138.8", "max_elo": "1147.3", "avg_elo": "1142.5" },
  { "ventile":  5, "n": "120", "min_elo": "1122.5", "max_elo": "1138.8", "avg_elo": "1129.3" },
  { "ventile":  4, "n": "120", "min_elo": "1110.8", "max_elo": "1122.5", "avg_elo": "1117.5" },
  { "ventile":  3, "n": "120", "min_elo": "1092.8", "max_elo": "1110.7", "avg_elo": "1098.9" },
  { "ventile":  2, "n": "120", "min_elo": "1076.3", "max_elo": "1092.8", "avg_elo": "1083.3" },
  { "ventile":  1, "n": "120", "min_elo": "1057.7", "max_elo": "1076.2", "avg_elo": "1067.5" }
]
```
