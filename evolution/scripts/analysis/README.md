[//]: # (Standard SQL snippets consumed by /run_experiment_analysis for the funnel/balance/decisiveness audit. Each file is parameterized on $experiment_id via sed substitution after UUID validation.)

# evolution/scripts/analysis/

Standard SQL snippets for the funnel + balance + decisiveness audit performed by `/run_experiment_analysis` Step 2 (Decision #11 of the experiment-analysis project plan). Each query is parameterized on `$experiment_id` and groups by arm via `evolution_runs.strategy_id`.

## Parameterization mechanism

`scripts/query-db.ts` (behind `npm run query:staging`) has no `-v` flag, so the skill uses **sed substitution after UUID validation** (per the locked Phase 3 mechanism + the Security & Operational Notes safety justification):

```bash
EID=<validated-uuid>  # Step 1 pre-flight gate has already enforced UUID v4 char class
QUERY=$(sed "s/\$experiment_id/'$EID'/g" evolution/scripts/analysis/<file>.sql)
npm run query:staging -- --json "$QUERY"
```

The SQL files use the literal bare token `$experiment_id` (NOT pre-quoted). The sed inserts the surrounding single quotes itself, producing `WHERE r.experiment_id = '<uuid>'::uuid`. Safety: the UUID v4 character class `[0-9a-f-]` excludes all SQL and shell metacharacters, so the substitution is provably safe after the pre-flight gate validates the UUID format.

If a future query needs a non-UUID parameter, do NOT extend this recipe — instead extend `scripts/query-db.ts` with proper psql `-v` support and switch that file to `$1` positional syntax.

## Filter convention

All 6 SQL files filter `r.status IN ('completed', 'failed')` (NOT just `completed`). This is intentional: failed runs with `error_code='all_generations_failed'` (post-D3 wipeouts) must appear in funnel counts so the downstream Balance Audit can surface them. The skill's HARD GATE (Step 3) uses the canonical TS detector (`evolution/scripts/detectArenaOnlyWipeouts.ts --experiment-id`) to classify these — there is NO `arena_only_wipeout_check.sql` in this folder by design (Decision #13 — single source of truth).

## Files

| File | Consumed by | Output |
|---|---|---|
| [`funnel_per_arm_variants.sql`](./funnel_per_arm_variants.sql) | Step 2 / Table B | Per-arm variant counts by iteration + synced-to-arena split |
| [`funnel_per_arm_invocations.sql`](./funnel_per_arm_invocations.sql) | Step 2 / Table B | Per-arm invocation outcomes (success / failed / skipped) by agent_name + iteration |
| [`funnel_per_arm_decisive_matches.sql`](./funnel_per_arm_decisive_matches.sql) | Step 2 / Step 5 | Per-arm match counts + decisive % (confidence ≥ 0.6) + tie / draw / low-confidence breakdown |
| [`funnel_per_arm_top_elo_gain.sql`](./funnel_per_arm_top_elo_gain.sql) | Step 2 / Table A | Per-arm: top — seed Elo, median + min + max across runs |
| [`judge_decisiveness_distribution.sql`](./judge_decisiveness_distribution.sql) | Step 5 (Decisiveness Audit) | Full confidence-bucket distribution per arm (1.0 / 0.7 / 0.5 TIE / 0.3 / 0.0) |
| [`per_arm_cost_breakdown.sql`](./per_arm_cost_breakdown.sql) | Step 2 / Table A | Per-arm total + per-agent cost + improver count + cost-per-improver |

## Wipeout detection (NOT in this folder)

For arena-only wipeouts (the "completed but 0 variants + 0 cost" failure mode that motivated the HARD GATE), use the canonical TS detector — do NOT write a SQL fingerprint:

```bash
WIPEOUT_JSON=$(npx tsx evolution/scripts/detectArenaOnlyWipeouts.ts --experiment-id "$EID" --json || true)
# `|| true` consumes the detector's intentional exit-1 (wipeouts-found signal).
# Skill parses the .wipeouts array from the envelope.
```

See [Decision #13](../../../docs/planning/experiment_analysis_skill_20260628/experiment_analysis_skill_20260628_research.md#decisions-locked-in-2026-06-28) for the rationale (avoid SQL/TS drift on the fingerprint).

## Testing

The integration test `src/__tests__/integration/evolution-analysis-queries.integration.test.ts` seeds a 2-arm `[TEST_EVO]` experiment and exercises each query end-to-end against staging. Seeding helpers are in `evolution/src/testing/evolution-test-helpers.ts`.
