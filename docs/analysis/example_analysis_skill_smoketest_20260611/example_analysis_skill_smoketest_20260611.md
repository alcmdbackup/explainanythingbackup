# Example Analysis — Skill Smoketest

> **This is an illustrative reference example** produced to validate the `/analysis` template and layout. Its dataset is **synthetic** (not from a real query) and exists only to demonstrate the required structure. Real analyses capture actual `query:staging`/`query:prod` output.

## Header
- **Analysis name:** Example Analysis — Skill Smoketest
- **Project:** `docs/planning/build_analysis_skill_20260609/`
- **Branch:** `feat/build_analysis_skill_20260609`
- **Date:** 2026-06-11
- **Source research doc:** `docs/planning/build_analysis_skill_20260609/build_analysis_skill_20260609_research.md`

## Methodology
A formal analysis is a distillation of the **useful findings** in a project's `_research.md` into a durable, reproducible report. This example demonstrates the method end-to-end:
1. Resolve the project by branch and read its `_research.md`.
2. Select the findings worth promoting (here: the "no analysis skill existed; `docs/research/` was the de-facto surface" finding).
3. State methodology (this section), summarize key findings, and attach the **exact dataset** (`dataset.csv`) + **all queries used** (`queries.sql`).
4. For real analyses, the dataset is captured via the read-only SQL scripts (`npm run query:staging --json` / `query:prod`); for non-SQL sources, the Dataset + Queries sections are filled manually. Here the dataset is synthetic and labeled as such.

**Reproducibility note:** the dataset below is illustrative. The `queries.sql` in this folder shows the *shape* a real capture query would take; it is not run against any environment for this smoketest.

## Key Findings
1. The `/analysis` template renders cleanly with all five required sections (Header, Methodology, Key Findings, Dataset, Queries & Results).
2. The per-analysis subfolder layout (`<name>.md` + `dataset.csv` + `queries.sql`) keeps the report self-contained and citable independent of the (eventually fossilized) planning folder.
3. Provenance is bidirectional: this report's Header links back to its project + branch, and the project's `_status.json.analyses[]` + `_research.md` "## Promoted Analyses" point forward to it.

## Dataset
Synthetic illustrative data (no PII), held in [`dataset.csv`](./dataset.csv). 3 rows:

| category | count | share_pct |
|----------|-------|-----------|
| published | 1200 | 60.0 |
| draft | 600 | 30.0 |
| archived | 200 | 10.0 |

Size: well under the ~1 MB / ~10k-row cap, so it is inlined as `dataset.csv` in full. Above the cap, an analysis instead stores a representative `sample.csv` + the exact regeneration query in `queries.sql` + the full row count noted here.

## Queries & Results
The query shape a real capture would use (read-only, aggregate, no PII columns selected) is recorded in [`queries.sql`](./queries.sql):

```sql
-- ILLUSTRATIVE ONLY — not executed for this smoketest.
SELECT status AS category,
       count(*) AS count,
       round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS share_pct
FROM explanations
GROUP BY status
ORDER BY count DESC;
```

**Result (synthetic):** the 3-row table shown in the Dataset section above. A real run would paste the actual `--json`/CSV output here verbatim alongside the exact command invoked (e.g. `npm run query:prod -- --json "<query>"`).
