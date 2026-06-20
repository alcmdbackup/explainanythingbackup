# Meta Analysis: How to Get Top Arena (Federal Reserve 2) Plan

## Background
Analyze what approaches are effective at generating variants that reach the very top of the Arena leaderboard for federal reserve 2. Generate new ideas for how to improve our existing system.

## Requirements (from GH Issue #NNN)
Same as summary - analyze and then generate new suggestions.

Specifically:
- Identify and quantify which strategies/agents/tactics/models/iteration shapes/criteria/rubrics/sourceMode+cutoff/floor configs/temperatures are producing top-of-arena variants for `federal_reserve_2`.
- Produce a ranked list of concrete, implementable improvement ideas (with predicted impact + cost + risk).

## Problem
*(refine after /research)*

The arena leaderboard for the `federal_reserve_2` prompt aggregates variants across runs, models, and strategies. While the leaderboard surfaces *which* variants are best, we lack a systematic, queryable analysis of **what made them best** — the combination of agent, tactic, parent lineage, iteration shape, and judge configuration that produced the top cohort. Without that breakdown we cannot make principled choices about which strategies to invest more compute in, which to retire, or which new agent/tactic ideas to prototype next.

## Options Considered

- [ ] **Option A: Pure SQL + admin-UI analysis (no code change)** — Query staging+prod via `npm run query:staging`/`query:prod` and screenshot the admin arena leaderboard, attribution charts, tactic leaderboard, and per-variant lineage. Deliverable: a written `docs/analysis/` report cataloging top-of-arena winners + their producing configurations + a ranked idea list. Pros: zero risk, fast turnaround, fits the existing `/analysis` skill shape. Cons: no executable artifact; relies on a human re-running the queries to verify findings later. Suitable when the output is a research report.
- [ ] **Option B: Analysis + a reusable analysis script** — Same as A, but also ship a TypeScript script under `evolution/scripts/` (e.g. `analyzeTopArena.ts`) that takes a `--prompt-id` arg, queries arena variants + invocations + attribution metrics, and emits a structured JSON/markdown report. Reusable for any future prompt. Pros: durable artifact, repeatable, parameterizable per prompt. Cons: small code-quality + test burden, modest scope creep beyond "analyze federal reserve 2".
- [ ] **Option C: Analysis + a new admin UI view** — Add an `/admin/evolution/arena/[topicId]/analysis` tab that auto-renders the meta analysis (top-N table, agent/tactic breakdown, attribution chart, lineage tree, cost-efficiency scatter). Pros: every researcher gets this view going forward; surfaces stale data on every visit. Cons: significant UI + server-action + tests scope; overkill if this is a one-off question.

> **Default recommendation:** Option A for the analysis report, with Option B as a fast follow-up if the same query shape proves useful across multiple prompts. Defer Option C unless researchers ask for it after seeing A/B.

## Phased Execution Plan

### Phase 1: Establish the data baseline
- [ ] Resolve the `federal_reserve_2` prompt UUID on staging and prod (`SELECT id, name FROM evolution_prompts WHERE name ILIKE '%federal%reserve%2%';`)
- [ ] Snapshot the top-50 arena variants (with full attribution: agent_name, tactic, model, parent chain, elo, uncertainty, arena_match_count, eloPer$) into a markdown table
- [ ] Snapshot the per-(agent, tactic) `eloAttrDelta:*` rows at strategy + experiment level for strategies that contributed to the top-50
- [ ] Snapshot the global tactic leaderboard (`/admin/evolution/tactics`, sorted by avg_elo_delta desc) for context
- [ ] Snapshot the head-to-head `evolution_arena_comparisons` history for the top-10 — who beat whom, how decisively, by which judge model

### Phase 2: Characterize the top cohort
- [ ] Group top-50 by agent type. Compute share, mean elo, median lineage depth, mean cost
- [ ] Within `generate` / `reflect_and_generate`, group by tactic. Identify the dominant tactics for this prompt
- [ ] Cross-tabulate (generation_model × judge_model) within the top cohort
- [ ] Compute the `sentence_verbatim_ratio` distribution — surgical edits (≥0.6) vs wholesale rewrites (≤0.3) cohorts
- [ ] Walk lineage on top-10 via `get_variant_full_chain` — characterize ancestor chains (depth, agents touched, tactic transitions)
- [ ] Identify which strategies (`evolution_strategies.config_hash`) produced multiple top variants — signal of a reproducible recipe

### Phase 3: Contrast against the rest of the leaderboard
- [ ] Compare top-N (top 10%) vs middle-50% vs bottom-25% on the same dimensions
- [ ] Identify dimensions that discriminate (agent, tactic, model, lineage depth, ratio) — these are the high-leverage knobs
- [ ] Identify dimensions that DON'T discriminate — these are noise / sample-too-small / saturated

### Phase 4: Synthesize new improvement ideas
- [ ] For each high-leverage knob, propose 1–3 concrete changes (e.g. shift tactic-guidance percentages, add an iteration of agent X after agent Y, swap judge model to Y, add a new criterion to a rubric, tune temperature ladder, try paragraph_recombine on top variants from generate)
- [ ] Rank proposals by expected impact / cost / risk
- [ ] For each top-3 proposal, sketch a controlled experiment that would test it (strategy config + experiment shape + N runs + success criterion)

### Phase 5: Write the analysis report
- [ ] Author `docs/analysis/top_of_arena_federal_reserve_2_YYYYMMDD.md` with: dataset summary, top-N table, breakdown charts (markdown tables), key findings, ranked idea list, recommended experiment configs
- [ ] Link the analysis report from `meta_analysis_how_to_get_top_arena_federal_reserve_2_progress.md`
- [ ] (If Option B chosen) Author `evolution/scripts/analyzeTopArena.ts` accepting `--prompt-id` / `--top-n` / `--out` + unit tests for the SQL helpers

## Testing

### Unit Tests
- [ ] (Only if Option B) `evolution/scripts/analyzeTopArena.test.ts` — exercise the SQL-builder + report-renderer helpers with mocked Supabase responses

### Integration Tests
- [ ] (Only if Option B) `src/__tests__/integration/analyze-top-arena.integration.test.ts` — seed a small synthetic arena (3 strategies × 5 runs × 5 variants) and assert the report's top-N table + tactic breakdown match expected

### E2E Tests
- [ ] None — analysis project, no UI changes

### Manual Verification
- [ ] Sanity-check the top-N table by manually opening `/admin/evolution/arena/[topicId]` in staging and spot-comparing 3 entries' Elo and parent chains
- [ ] Sanity-check 1–2 ranked ideas by walking the cited variants' lineage in the admin UI

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] N/A (analysis only — no UI changes unless Option C)

### B) Automated Tests
- [ ] (Only if Option B) `npm run test:unit -- --grep "analyzeTopArena"`
- [ ] (Only if Option B) `npm run test:integration -- --grep "analyze-top-arena"`

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/arena.md` — note any new analytical methodology if Option B ships a reusable script
- [ ] `evolution/docs/architecture.md` — likely no change (read-only analysis)
- [ ] `evolution/docs/agents/overview.md` — note any new improvement ideas that justify a new agent / tactic prototype
- [ ] `evolution/docs/criteria_agents.md` — if findings recommend new criteria rubrics, add a section
- [ ] `evolution/docs/editing_agents.md` — if findings suggest editing-agent tweaks, document
- [ ] `evolution/docs/paragraph_recombine.md` — if findings suggest paragraph_recombine knob changes, document
- [ ] `evolution/docs/rating_and_comparison.md` — likely no change
- [ ] `evolution/docs/strategies_and_experiments.md` — note any new recommended strategy templates if findings produce them
- [ ] `evolution/docs/multi_iteration_strategies.md` — note any new recommended `iterationConfigs[]` shapes
- [ ] `evolution/docs/variant_lineage.md` — likely no change
- [ ] `evolution/docs/metrics.md` — likely no change (would only update if a new metric is proposed)
- [ ] `evolution/docs/cost_optimization.md` — note any cost-efficiency findings (eloPer$ recipes)
- [ ] `evolution/docs/data_model.md` — likely no change
- [ ] `evolution/docs/visualization.md` — only if Option C ships a new admin tab

## Phase 6: Follow-up Experiment — Mode B Approver-Filtering

The analyses surfaced one clearly-actionable architectural pattern in `iterative_editing_rewrite` (Mode B): the proposer's rewrites get fragmented into many atomic edits by the diff engine, but a two-stage upstream filter pipeline (`coalesceAdjacentGroups` then `capGroupsByMagnitude`, top-K=10 by group magnitude) reshapes those atomics before the approver ever sees them. The filter both **bundles** adjacent same-kind atomics into multi-atomic groups (hiding bad atomics inside otherwise-good bundles) and **drops** ~half of the atomics entirely (forcing them to compete for 10 slots regardless of where they sit in the article). The approver's per-group accept/reject contract has no veto path narrower than a whole group.

The historical observational sample (16 invocations, 1 prompt) is too thin to distinguish filtering-effect from parent-quality-confounder. A controlled A/B experiment can settle it cheaply.

### Hypothesis

**H1**: When the approver sees every diff atomic as its own individually-reviewable group — bypassing both `coalesceAdjacentGroups` and `capGroupsByMagnitude` — it will (a) make per-atomic accept/reject decisions instead of bundle-level approve-all-or-reject-all, (b) preserve atomic-edit coverage across the whole article instead of dropping low-individual-magnitude clusters, and (c) shift the mean Δ-Elo upward by ≥ 20 points on parents in the top-decile (Elo ≥ 1287).

**Null (H0)**: Disabling the filter has no effect (the approver's per-group judgment on bundles is functionally identical to its per-atomic judgment on singletons, AND the dropped low-magnitude atomics didn't matter to outcomes anyway).

### Design decisions (locked after Phase 6 review iteration 1)

The /plan-review iteration surfaced three design knobs that materially change what the experiment can claim. Captured here so the configs + acceptance criteria below stay consistent with them:

- **A3 — Raise `editingProposerSoftCap` to 8 in BOTH arms** (historical = 3). At softCap=3 the proposer aims for 3 prose-level improvements per cycle (~30 atomic diff regions). At softCap=8 the proposer aims for 8 (~40-60 atomic regions), which (i) more aggressively triggers `capGroupsByMagnitude`'s K=10 cap in Control (the actual filter we want to compare against), (ii) maximizes treatment-vs-control contrast (treatment sends every atomic, Control sends top-10 groups), and (iii) gives the strongest possible test of the bundling-vs-singleton hypothesis. **Trade-off accepted:** results may not transfer back to default softCap=3 production runs without a follow-up replication at the production cap. Both arms get the same softCap so the soft-cap effect is held constant between arms.
- **B1 — Treatment disables BOTH `coalesceAdjacentGroups` AND `capGroupsByMagnitude`** (rather than splitting them). This is the maximally-permissive Treatment: every diff atomic that passes `validateEditGroups`' hard rules reaches the approver. **Trade-off accepted:** if Treatment wins, we cannot disambiguate "per-atomic granularity helps" from "more total atomics applied helps" — a follow-up B2 design (disable only coalescer, keep cap, route singletons through the K=10 selection) is needed to isolate granularity. The acceptance criteria below treat a Treatment win as "filter pipeline as a unit hurts Mode B" — not "granularity is the cause."
- **C1 — Keep `gemini-2.5-flash-lite` as both proposer AND approver model** (same-model rubber-stamping confound accepted). Historical Mode B used `qwen-2.5-7b-instruct` as approver (different family from the openai/gemini proposer); approver `approves_per_call` averaged 2.8/5 in that regime vs 4.4/5 when proposer/approver shared a family. **Trade-off accepted:** the experiment's improver-rate baseline (~13 % from historical) was measured under heterogeneous models. If our same-model Control improver rate is meaningfully different from 13 %, that's the rubber-stamping confound. A follow-up replication with a distinct-family approver (e.g. `gpt-4.1-mini`) is needed before generalizing to all production Mode B configurations. The historical-vs-experiment comparison covered earlier ("calibration caveat") is one half of this; the rubber-stamping confound is the other.

### Experiment design — staged (smoke first, then scale)

The plan stages the experiment into a **5/arm smoke** ($0.40 expected) followed by a conditional **scale-up to 30/arm** only if the smoke confirms (a) the code works end-to-end and (b) the standard admin UI renders treatment-arm invocations correctly.

**A/B arms** dispatched in a single `evolution_experiments` row against the same prompt and parent population:

| Arm | Strategy name | Behavior |
|---|---|---|
| **A — Control** | `ApproverFilter Control` | Current Mode B. After diff: `coalesceAdjacentGroups` bundles adjacent same-kind atomics → `validateEditGroups` → `capGroupsByMagnitude` (top-K=10 by group magnitude) → approver. |
| **B — Treatment** | `ApproverFilter Off` | Same as Control, but `disableApproverFiltering: true` on the editing iterations. After diff: skip coalescer AND skip magnitude cap. Only `validateEditGroups` (hard rules: no heading mods, no quote edits, code-fence guards) runs. Every surviving diff atomic becomes its own singleton group and reaches the approver. |

Both arms identical otherwise. The settings mirror the **most-recent production Mode B strategy** that ran on this prompt — `"Iterative editing - whole article"` (`evolution_strategies.id = 4900ff14-a11f-4653-9854-85af3cd1480c`, last used 2026-05-12, the strategy that produced the historical variants we analyzed). The deviations from that strategy:
1. `judgeModel` switched to `gemini-2.5-flash-lite` per the all-gemini directive (was qwen) — see "calibration caveat" below.
2. `editingProposerSoftCap` raised from 3 (historical default) → 8 in BOTH arms — see design decision A3 above. The historical-vs-experiment delta from this knob is documented; the within-experiment A/B is clean (both arms see softCap=8).
3. Treatment arm adds `disableApproverFiltering: true` on the editing iterations — the manipulation under test.

- `generationModel: google/gemini-2.5-flash-lite` (matches historical)
- `judgeModel: google/gemini-2.5-flash-lite` (switched from historical `qwen-2.5-7b-instruct`)
- `editingModel` and `approverModel` unset → fall back to `generationModel` = `gemini-2.5-flash-lite` (matches historical; rubber-stamping confound noted in design decision C1)
- `budgetUsd: 0.05` (matches historical)
- `generationTemperature: 1.0` (matches historical)
- `maxComparisonsPerVariant: 3` (matches historical)
- `minBudgetAfterParallelAgentMultiple: 1` (matches historical)
- `iterationConfigs`: 3 iterations — `[generate seed 34 %, iterative_editing_rewrite 33 %, iterative_editing_rewrite 33 %]` (matches historical exactly). Each editing iteration runs up to `AGENT_DEFAULT_MAX_CYCLES = 3` propose/approve cycles internally (constants.ts:5), so the per-run editing-cycle count is up to 6 (2 iterations × 3 cycles). Cost math below reflects this.
- `editingProposerSoftCap: 8` on both editing iterations in BOTH arms (A3). The proposer prompt at `proposerPromptRewrite.ts:45` reads "AT MOST 8 distinct improvements per response."
- `editingEligibilityCutoff`: not set on the editing iterations → defaults to `{mode: 'topN', value: 10}` at consumption time (matches historical — `iterative_editing_rewrite` uses `editingEligibilityCutoff`, NOT `sourceMode`/`qualityCutoff`, which apply only to `generate`/`reflect`/`criteria` agents)
- `prompt_id: a546b7e9-f066-403d-9589-f5e0d2c9fa4f` (federal_reserve_2)
- **Per-cycle atomic-edit ceiling**: `AGENT_MAX_ATOMIC_EDITS_PER_CYCLE = 30` (constants.ts:7) caps total atomics passed to the approver in any one cycle regardless of bypass state. At softCap=8 the proposer's expected ~40-60 atomics will sometimes hit this ceiling; the size-explosion guardrail then drops highest-numbered groups. Both arms see this ceiling, so it's held constant.
- **Drift recovery model**: `iterative_editing_rewrite` never enters drift recovery by construction (IterativeEditingAgent.ts:341-344: "Mode B never enters drift recovery"). The default drift-recovery model (`gpt-4.1-nano`) never fires for either arm in this experiment, so the all-gemini directive is not violated.

> **Calibration caveat from using gemini-flash-lite as judge.** Every historical Mode B variant on federal_reserve_2 was judged by `qwen-2.5-7b-instruct`. Our experiment uses gemini-flash-lite as judge instead, so the Elo numbers our variants pick up are NOT directly comparable to the existing arena leaderboard's qwen-calibrated Elos. The A/B comparison **within** our experiment is unaffected — both arms use the same judge, so the bundling-vs-singleton signal is clean. But the cross-experiment claim ("our treatment arm's variants reach top-decile") needs to be re-checked against the qwen-judged historical cutoff via a separate sanity comparison.

**Stage 1 — smoke (5 runs per arm, 10 total)**: minimum sample to confirm the splitter doesn't crash, the cost stays under budget, and `/admin/evolution/invocations/[id]` renders treatment-arm Edit Cycle tabs cleanly. Will not statistically settle anything but will catch implementation bugs and surfacing issues. Cost: ~$0.40 expected, $0.50 hard ceiling.

**Stage 2 — scale (an additional 25/arm, total 30/arm = 60)**: Triggered only if Stage 1 passed all acceptance checks below. Cost: an additional ~$2.00, $2.50 hard ceiling.

> **Honest statistical power at n=30/arm** (corrected after plan-review iteration 2). The two-proportion z-test power at α=0.05 two-sided, n=30 per arm:
> - For 13 % → 30 % (Cohen's h ≈ 0.42): **~37 % power**. Likely under-detected even if H1 is true. Not 80 % as the prior draft claimed.
> - For 13 % → 45 % (Cohen's h ≈ 0.75): **~83 % power**. Realistic detectable lift at this budget.
> - To reach 80 % power for 13 % → 30 % requires ~88/arm = $7+ — outside the $3 ceiling.
>
> **Decision**: keep n=30/arm but reframe Stage 2 as "detect strong-signal lifts (≥ 30 percentage-point improver-rate gain, ≥ 25-point median Δ-Elo)" at 80 % power. Any modest signal (< 30 pp lift) lands in Inconclusive and triggers a budget request for an n=90/arm follow-up. This keeps the experiment honest about what 30/arm can prove.

**Cumulative experiment cost ceiling: $3.00 if both stages run; $0.50 if Stage 1 alone. Follow-up n=90/arm (if Inconclusive) is an additional $5-6 — out of scope for this PR, requested as a separate budget if needed.**

**Explicit statistical tests** (the analysis report MUST cite exactly these — "CIs don't cross" is too loose):
- **Primary**: two-proportion z-test on improver rate (improver = child Elo > parent Elo), α=0.05 two-sided. Report `p-value`, `effect_size_pct_points` (treatment % − control %), and the 95 % Wilson-score CI of the difference.
- **Secondary**: Welch's t-test on per-run mean Δ-Elo, α=0.05 two-sided. Report `t`, `p-value`, and the 95 % CI of the mean difference.
- **Robust secondary**: Mann–Whitney U on per-run Δ-Elo distributions (no Gaussian assumption). Report `U`, `p-value`.
- **Effect size**: bootstrap 95 % CI of the difference-in-medians via 10 000 resamples (anchored to per-run mean Δ-Elo).

### Stage 1 (smoke) acceptance checks

Stage 2 fires only when ALL six hold after the 10 smoke runs complete:

- [ ] **No code crashes**. Zero runs in `status='failed'` for the experiment. Treatment-arm runs complete with `status='completed'`. (The earlier fake allowlist `error_code IN ('iterative_edit_invalid_groups', 'unhandled_exception')` was wrong — actual error_code literals written by the pipeline are `'unhandled_error'` (claimAndExecuteRun.ts:98), `'all_generations_failed'`, `'finalize_empty_pool'`. We just check `status='failed'` since any failed run is a Stage 1 blocker.)
- [ ] **Cost stays under budget**. Mean per-run cost ≤ $0.05 in both arms; total experiment spend ≤ $0.50. Cost is read via the existing `get_run_total_cost(p_run_id UUID)` SQL RPC (migration 20260322000007:381-385), NOT via a fabricated `evolution_runs.cost_usd` column (which does not exist — cost lives on `evolution_agent_invocations.cost_usd`).
- [ ] **Filter-disable actually takes effect in treatment arm**. At least one treatment-arm invocation shows `proposedGroupsRaw.length` ≥ 15 (the raw diff atomic count, no longer capped at 10), AND treatment-arm groups are **mostly singletons** (mean atomic-count per group < 1.5 across all treatment-arm groups; NOT "every group is a singleton" because `parseProposedEdits` itself does adjacency-based auto-grouping at `parseProposedEdits.ts:185-199` before `coalesceAdjacentGroups` runs — so 2-3-atomic groups can occur even with the coalescer bypassed), AND the total group count is strictly greater than control's K=10 ceiling (proving the magnitude cap was skipped, not just the coalescer). For control: `proposedGroupsRaw.length` ≤ 10 (the cap fired) and some groups have ≥ 2 atomic edits.
- [ ] **Admin UI renders treatment-arm Edit Cycle tabs cleanly**. Manually open one treatment-arm invocation's `/admin/evolution/invocations/[id]` page and confirm:
  - The Edit Cycle tab loads without errors despite ~15-30 group rows (vs control's ~10)
  - The per-group accept/reject table renders every singleton group as its own row
  - The `proposedMarkup` / `computedMarkup` fields still show the original CriticMarkup string (the markup is unchanged; only the group bucketing changed)
  - The cycle-cost split (`proposeCostUsd`, `approveCostUsd`) is positive and reasonable; `approveCostUsd` should be modestly higher than control's (≈ +30 %) because the approver prompt is longer
- [ ] **Admin UI renders the experiment page cleanly**. Open `/admin/evolution/experiments/[experimentId]` and confirm both strategies appear in the Analysis tab with their per-arm aggregate cards. No "missing strategy" or "0 runs" rendering glitches.
- [ ] **Arena sync works**. At least one variant from each arm reaches `synced_to_arena=true` and appears in `/admin/evolution/arena/a546b7e9-...`. Confirms the run finalized end-to-end and the sync path doesn't break on split-group invocations.

If any check fails, fix the issue and re-run the 10 smoke runs (this is cheap enough to repeat). Do NOT proceed to Stage 2 with a partially-working setup.

**Programmatic Stage 1 verification** — checks 1, 2, 3, 6 are SQL-verifiable; check 4, 5 require human eyes. Add `evolution/scripts/verifyBundleSplitStage1.ts` that runs the SQL checks and exits non-zero if any fail. The script accepts the two arm strategy IDs (NOT names — `upsertStrategy` auto-generates names like `Strategy abc123 (lite, 3it)` from the config hash, so name-LIKE filters would match zero rows and the gate would pass vacuously):

```typescript
// evolution/scripts/verifyBundleSplitStage1.ts (sketch)
// Exits 0 if all SQL-verifiable Stage 1 checks pass.
//
// Usage: npx tsx evolution/scripts/verifyBundleSplitStage1.ts \
//          --experiment-id <expId> --control-strategy <ctlId> --treatment-strategy <trtId>
//
// Table & column references verified against supabase/migrations/20260322000007:
//   - evolution_agent_invocations (NOT evolution_invocations)
//   - execution_detail JSONB column with shape { cycles: [{proposedGroupsRaw: [...], ...}, ...] }
//   - evolution_variants with synced_to_arena BOOLEAN
//   - evolution_arena_comparisons with entry_a UUID, entry_b UUID
const { experimentId, controlStrategy, treatmentStrategy } = args;

// Pre-validate every UUID arg at argv-parse time, before any DB call.
// Throws a clear "invalid UUID for --<flag>" message instead of letting
// Postgres throw an opaque type error mid-query.
for (const [flag, value] of [['experiment-id', experimentId], ['control-strategy', controlStrategy], ['treatment-strategy', treatmentStrategy]]) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`Invalid UUID for --${flag}: ${value}`);
  }
}

const failed = await runSqlChecks([
  // Check 1: no failed runs. Any failure is a Stage 1 blocker — we don't
  // pre-classify by error_code because the pipeline's actual error_code
  // literals are 'unhandled_error', 'all_generations_failed', 'finalize_empty_pool'.
  { name: 'no_failures',
    sql: `SELECT COUNT(*) AS n FROM evolution_runs
          WHERE experiment_id = $1 AND status = 'failed'`,
    params: [experimentId],
    expect: (r) => Number(r.rows[0].n) === 0 },
  // Check 2: cost ceiling. Uses the existing get_run_total_cost(uuid) RPC
  // (defined in migration 20260322000007:381-385) which sums
  // evolution_agent_invocations.cost_usd for each run.
  { name: 'cost_under_ceiling',
    sql: `SELECT COALESCE(SUM(get_run_total_cost(r.id)), 0) AS total
          FROM evolution_runs r
          WHERE r.experiment_id = $1`,
    params: [experimentId],
    expect: (r) => Number(r.rows[0].total) < 0.50 },
  // Check 3a: treatment proposedGroupsRaw.length >= 15 on at least one cycle.
  // Tolerates empty execution_detail.cycles via COUNT(*) presence check.
  { name: 'treatment_bypass_active',
    sql: `SELECT COUNT(*) AS n
          FROM evolution_agent_invocations i
          JOIN evolution_runs r ON i.run_id = r.id
          CROSS JOIN LATERAL jsonb_array_elements(COALESCE(i.execution_detail->'cycles', '[]'::jsonb)) AS c(cycle)
          WHERE r.experiment_id = $1
            AND r.strategy_id = $2
            AND jsonb_array_length(COALESCE(c.cycle->'proposedGroupsRaw', '[]'::jsonb)) >= 15`,
    params: [experimentId, treatmentStrategy],
    expect: (r) => Number(r.rows[0].n) >= 1 },
  // Check 3b: control proposedGroupsRaw <= 10 on every cycle (cap fired).
  // COALESCE protects against NULL when there are no cycles at all.
  { name: 'control_cap_fired',
    sql: `SELECT COALESCE(MAX(jsonb_array_length(COALESCE(c.cycle->'proposedGroupsRaw', '[]'::jsonb))), 0) AS max_groups
          FROM evolution_agent_invocations i
          JOIN evolution_runs r ON i.run_id = r.id
          CROSS JOIN LATERAL jsonb_array_elements(COALESCE(i.execution_detail->'cycles', '[]'::jsonb)) AS c(cycle)
          WHERE r.experiment_id = $1 AND r.strategy_id = $2`,
    params: [experimentId, controlStrategy],
    expect: (r) => Number(r.rows[0].max_groups) <= 10 },
  // Check 3c: treatment groups are MOSTLY singletons. NOT "every group is a singleton"
  // because parseProposedEdits itself does adjacency-based auto-grouping
  // (parseProposedEdits.ts:185-199) BEFORE coalesceAdjacentGroups runs — so multi-
  // atomic groups can exist even when the coalescer was skipped. The reframed
  // check: in treatment, average atomic-count per group is < 1.5 AND there are
  // strictly more groups than control's K=10 ceiling.
  { name: 'treatment_mostly_singletons',
    sql: `SELECT
            COALESCE(AVG(jsonb_array_length(COALESCE(g->'atomicEdits', '[]'::jsonb))), 1)::numeric AS avg_atomics,
            COUNT(g)                                                                    AS total_groups
          FROM evolution_agent_invocations i
          JOIN evolution_runs r ON i.run_id = r.id
          CROSS JOIN LATERAL jsonb_array_elements(COALESCE(i.execution_detail->'cycles', '[]'::jsonb)) AS c(cycle)
          CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.cycle->'proposedGroupsRaw', '[]'::jsonb)) AS g(g)
          WHERE r.experiment_id = $1 AND r.strategy_id = $2`,
    params: [experimentId, treatmentStrategy],
    expect: (r) => Number(r.rows[0].avg_atomics) < 1.5 && Number(r.rows[0].total_groups) > 10 },
  // Check 6: arena sync — at least one variant per arm reached synced_to_arena=true.
  { name: 'arena_sync_both_arms',
    sql: `SELECT r.strategy_id, COUNT(*) FILTER (WHERE v.synced_to_arena) AS synced
          FROM evolution_variants v
          JOIN evolution_runs r ON v.run_id = r.id
          WHERE r.experiment_id = $1 AND r.strategy_id IN ($2, $3)
          GROUP BY r.strategy_id`,
    params: [experimentId, controlStrategy, treatmentStrategy],
    expect: (r) => r.rows.length === 2 && r.rows.every((row) => Number(row.synced) >= 1) },
]);

if (failed.length > 0) {
  console.error('Stage 1 checks failed:', failed);
  process.exit(1);
}
console.log('All Stage 1 SQL checks passed. Now run the 2 manual UI checks (#4, #5).');
```

Run with: `npx tsx evolution/scripts/verifyBundleSplitStage1.ts --experiment-id <expId> --control-strategy <ctlId> --treatment-strategy <trtId>`. The strategy IDs are printed by the seed script at the end of `--apply`. Stage 2 is gated by both (a) this script exits 0 AND (b) the 2 human UI checks pass.

**Cancel-experiment rollback drill** — if Stage 1 detects a problem mid-flight or Stage 2 needs to be aborted, the **existing** `cancel_experiment(p_experiment_id UUID)` SQL RPC handles cancellation atomically. It is defined at migration 20260322000006:302-319 and re-issued at 20260322000007:378-388. We call it directly; the new `cancelExperiment.ts` script is a thin wrapper that adds reason-logging and the optional archive/un-sync steps.

**RPC behavior** (NOT what an earlier draft of this plan claimed — verified against the migration):
- Sets `evolution_experiments.status='cancelled'` only if the experiment is currently `status='running'`. No-op on already-cancelled / draft / completed.
- Sets `evolution_runs.status='failed'` (NOT `'cancelled'`) for runs in `('pending', 'claimed', 'running')`, with `error_message='Experiment cancelled'` and `completed_at=now()`. Already-completed and already-failed runs are NOT touched.
- This means in-progress runs DO get marked failed when the RPC fires. The `claim_evolution_run` RPC (NOT `claim_pending_run` — that name was wrong in earlier drafts; correct name verified at migration 20260322000001:8) will skip the now-failed row on subsequent claims, but does not force-kill the in-flight worker.

```bash
# 1. Cancel the experiment via the existing RPC + log the reason per-run.
npx tsx evolution/scripts/cancelExperiment.ts \
  --experiment-id <experimentId> \
  --target staging \
  --reason "Stage 1 check N failed: <details>"

# What it does (in TypeScript):
#   // Snapshot now() BEFORE the RPC so the post-RPC log SELECT filters to the
#   // runs JUST cancelled by this invocation (the WHERE error_message=
#   // 'Experiment cancelled' alone would also match runs cancelled by any prior
#   // call to this script, causing the current --reason to be re-logged against
#   // historical cancellations).
#   const cancelStartedAt = new Date().toISOString();
#   await db.rpc('cancel_experiment', { p_experiment_id: experimentId });
#   // RPC sets status='cancelled' on the experiment (if it was 'running') and
#   // status='failed' + error_message='Experiment cancelled' + completed_at=now()
#   // on all incomplete runs (status IN ('pending', 'claimed', 'running')).
#
#   // Log the reason against each just-cancelled run via createEntityLogger (the
#   // canonical write helper at evolution/src/lib/pipeline/infra/createEntityLogger.ts).
#   // evolution_run_logs is a VIEW over evolution_logs; its actual columns are
#   // {entity_type, entity_id (both NOT NULL), level, subagent_name, message,
#   //  run_id, experiment_id, strategy_id}. We use the helper rather than raw
#   // INSERTs to stay schema-stable.
#   //
#   // The createEntityLogger signature is (entityCtx, supabase, basePath?). The
#   // 'cancelExperiment' label is passed as basePath[0] so it lands in the
#   // subagent_name column. EntityLogContext does NOT have a subagentName field
#   // — putting it there is a TS excess-property error AND would silently drop
#   // the label on a loose cast.
#   const { data: runs } = await db
#     .from('evolution_runs')
#     .select('id, experiment_id, strategy_id')
#     .eq('experiment_id', experimentId)
#     .eq('status', 'failed')
#     .eq('error_message', 'Experiment cancelled')
#     .gte('completed_at', cancelStartedAt);  // discriminating: only THIS RPC's victims
#   for (const r of runs ?? []) {
#     const logger = createEntityLogger(
#       { entityType: 'run', entityId: r.id,
#         runId: r.id, experimentId: r.experiment_id, strategyId: r.strategy_id ?? undefined },
#       db,
#       ['cancelExperiment'],  // basePath → subagent_name column
#     );
#     await logger.info(reason);
#   }

# 2. (Optional) Archive the experiment's strategies so the wizard hides them
#    from future researchers (history remains for forensic inspection).
#    evolution_strategies.status CHECK constraint allows ONLY ('active', 'archived')
#    per migration 20260329000001:31 — there is NO 'deprecated' value. An earlier
#    draft of this plan used 'deprecated' which would throw a constraint violation.
npx tsx evolution/scripts/cancelExperiment.ts \
  --experiment-id <experimentId> \
  --archive-strategies
# UPDATE evolution_strategies SET status='archived' WHERE id IN (<ctlId>, <trtId>)

# 3. (Optional) Un-sync arena rows if the experiment was malformed and is
#    polluting the leaderboard. ALWAYS get explicit user approval before this.
#    Arena rows live on evolution_variants itself (synced_to_arena BOOLEAN):
#    UPDATE evolution_variants
#      SET synced_to_arena = false
#      WHERE run_id IN (SELECT id FROM evolution_runs WHERE experiment_id = $1);
#    (Do NOT DELETE evolution_variants — that breaks the foreign key from
#     evolution_arena_comparisons.entry_a/entry_b and orphans match history.)
```

`cancelExperiment.ts` wraps the RPC + reason logging + the two optional steps. The seed-script test suite covers the cancel idempotency contract:
- Cancel on a non-running experiment (already cancelled, completed, draft): the RPC is a no-op (returns void; experiment status unchanged because the WHERE filter doesn't match).
- Cancel on a non-existent experimentId: the RPC silently returns (no error — the WHERE matches zero rows). The wrapper script should detect zero affected runs and warn the user.
- Cancel does NOT affect runs in `status='completed'` or `status='failed'`.
- `--archive-strategies` flips status from `active` → `archived`; without it, strategies are left alone.
- `--archive-strategies` on already-archived strategies: no-op (the UPDATE matches zero rows).

### Stage 1 → Stage 2 decision tree

| Stage 1 outcome | Action |
|---|---|
| All 6 checks pass, treatment arm shows directional signal (≥ 1 of 5 improvers vs control's 0/5) | Proceed to Stage 2 (full 25/arm) |
| All 6 checks pass, treatment arm shows no directional signal (0/5 vs control 0/5) | Run Stage 2 anyway — 5/arm is too small to rule out a real effect, need the full sample for power |
| All 6 checks pass, treatment arm clearly LOSES to control (e.g. 0/5 vs 2/5) | Pause and investigate. Splitter may be triggering an approver behavior I didn't predict. Don't burn $2 on Stage 2 until understood. |
| Any of the 6 checks fail | Fix and re-run Stage 1. Do not proceed. |

**Outcome metrics** (already populated by the existing finalize path; no new metric work needed):
- Primary: per-arm `improver_pct` against `eloAttrDelta:iterative_editing_rewrite:rewrite` (% of accepted-bundle-applied variants whose child Elo > parent)
- Secondary: per-arm median Δ-Elo, mean Δ-Elo, p90 Δ-Elo
- Tertiary: per-arm `invocation_mirror_agreement_rate`-style breakdown of how often the treatment arm's approver rejects what would have been accepted in the control arm (visible by comparing accepted-group counts × n atomic edits before/after split)

**Stopping rule**: run the full Stage 2 (60 total, 30/arm). Optional early-stop check at the 15/arm mark (= 30 total runs): if treatment improver rate ≥ 50 % AND control improver rate ≤ 20 %, the two-proportion z-test is significant at n=15/arm with p < 0.05, so stop early and report. If both arms are within 5 pp of each other at the 15/arm mark, continue to the full 30/arm — 15/arm is too underpowered to confirm null.

### Implementation — single config field, one conditional

The minimal code change is one new `IterationConfig` field (defaults to false → exact backward compatibility) plus a single conditional that bypasses two filter steps:

**Code touch points** (paths and line numbers verified against the current branch HEAD):

> **Type source of truth**: `IterationConfig` is `z.infer<typeof iterationConfigSchema>` (schemas.ts:862). There is NO `evolution/src/lib/pipeline/types.ts`. All type changes flow through the Zod schema below. An earlier draft listed a separate `pipeline/types.ts` touch point — that was wrong and is removed.

1. `evolution/src/lib/schemas.ts:693` — **widen `editingProposerSoftCap` max from 5 to 10**. Current:
   ```typescript
   editingProposerSoftCap: z.number().int().min(1).max(5).optional(),
   ```
   Change to:
   ```typescript
   editingProposerSoftCap: z.number().int().min(1).max(10).optional(),
   ```
   Without this, A3's softCap=8 fails `strategyConfigSchema.safeParse` at run-claim time (`buildRunContext.ts:349`) and marks every experiment run as `status='failed' / error_code='invalid_config'`. The widening is a hard prerequisite for the experiment to be runnable.
2. `evolution/src/lib/schemas.ts` (same file, near the existing refines around lines 792-794) — add the new `disableApproverFiltering` field to `iterationConfigSchema` + a refine gating it to `iterative_editing_rewrite`:
   ```typescript
   // In iterationConfigSchema object:
   disableApproverFiltering: z.boolean().optional(),
   
   // After the existing refines block:
   .refine(
     (c) => c.agentType === 'iterative_editing_rewrite' || c.disableApproverFiltering === undefined,
     { message: 'disableApproverFiltering only valid when agentType is iterative_editing_rewrite', path: ['disableApproverFiltering'] },
   )
   ```
3. `evolution/src/lib/core/agents/editing/IterativeEditingAgent.ts` — **two related changes**:
   - **(a) Extend the inline structural type** at line 155-163 (where `cfg.iterationConfigs[i]` is accessed via `iterCfg`):
     ```typescript
     // Current line 155-163:
     const cfg = ctx.config as {
       …
       iterationConfigs?: Array<{ agentType?: string; editingMaxCycles?: number; editingProposerSoftCap?: number }>;
       …
     };
     const iterCfg = cfg.iterationConfigs?.[iterIdx];
     ```
     Add `disableApproverFiltering?: boolean` to the inline array element type so TypeScript permits the read below.
   - **(b) Replace the Mode B post-parse block** at lines 304-310. The bypass reads from `iterCfg`, NOT from any `input.config` (which doesn't exist on `IterativeEditInput`):
     ```typescript
     // Current (unchanged) code at lines 304-310:
     if (isRewriteMode) {
       const coalesced = coalesceAdjacentGroups(parseResult.groups, current.text);
       const cap = capGroupsByMagnitude(coalesced, current.text, 10);
       parseResult.groups = cap.kept;
       parseResult.dropped = [...parseResult.dropped, ...cap.dropped];
     }
     ```
     After this change:
     ```typescript
     if (isRewriteMode) {
       if (iterCfg?.disableApproverFiltering) {
         // BYPASS: skip coalescer + magnitude cap entirely. parseResult.groups
         // stays as the raw diff atomics (each is already its own group because
         // Mode B's parseProposedEdits never bundles — bundling only happens in
         // coalesceAdjacentGroups). Hard validation rules (validateEditGroups at
         // line 429) still run and may drop groups that violate
         // EDIT_NEWTEXT_LENGTH_CAP, heading/code-fence/quote rules, or the
         // AGENT_MAX_ATOMIC_EDITS_PER_CYCLE=30 ceiling. The `proposedGroupsRaw`
         // field name is asymmetric here — under bypass it captures the true
         // raw atomics; under the production default it captures post-coalesce/cap
         // groups. Both arms remain internally consistent for the verifier SQL.
       } else {
         // PRODUCTION DEFAULT (current behavior, unchanged):
         const coalesced = coalesceAdjacentGroups(parseResult.groups, current.text);
         const cap = capGroupsByMagnitude(coalesced, current.text, 10);
         parseResult.groups = cap.kept;
         parseResult.dropped = [...parseResult.dropped, ...cap.dropped];
       }
     }
     ```
   **Critical**: The bypass uses `iterCfg?.disableApproverFiltering` — matching the existing precedent at line 172 (`iterCfg?.editingProposerSoftCap ?? 3`). The bypass operates on the Mode B post-parse block at line 305, NOT on the `validation.approverGroups` consumer site at line 467 (the consumer reads from `validateEditGroups`'s return value `{approverGroups, droppedPreApprover, sizeExplosion}`, which is structurally a result object, not a bare array). The earlier pseudocode that called `validateEditGroups(parseResult.groups, current.text)` and treated the return as an array was incorrect — `validateEditGroups` returns `ValidateResult`. The bypass cleanly sits BEFORE the unconditional `validateEditGroups` call at line 429, so the result-object contract is unchanged.
4. `evolution/src/lib/core/agents/editing/constants.ts` — no change. `AGENT_MAX_ATOMIC_EDITS_PER_GROUP=5` enforces the per-group atomic cap (vacuous for singletons when bypass is active). `AGENT_MAX_ATOMIC_EDITS_PER_CYCLE=30` enforces the per-cycle ceiling and applies to BOTH arms. **Implication for the Treatment arm**: at softCap=8 the proposer typically emits 40-60 atomics; `validateEditGroups` will drop highest-numbered groups until ≤30 atomics remain (with reason `cycle_cap_exceeded`). So the Treatment approver sees AT MOST 30 groups, not 40-60. The bypass amplifies `cycle_cap_exceeded` drops; the verifier SQL counts RAW `proposedGroupsRaw` length (which can exceed 30 pre-drop) and `reviewDecisions.length` (which is ≤30). `EDIT_NEWTEXT_LENGTH_CAP=500` applies to both arms.
5. `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts` (lines 49-70) — add a `FIELD_GATES` entry so the field is stripped before hashing for any agent type that can't use it:
   ```typescript
   disableApproverFiltering: (t) => t === 'iterative_editing_rewrite',
   ```
   This mirrors `editingProposerSoftCap` (line 56) and ensures (a) the field doesn't leak into other agent types' `config_hash`, and (b) Control and Treatment do hash differently because both have `agentType === 'iterative_editing_rewrite'` so the gate passes through.

**Behavior reminder — what's preserved**:
- `validateEditGroups` still runs: heading-cross, quote-modification, code-fence, list-boundary, paragraph-break, `EDIT_NEWTEXT_LENGTH_CAP=500` chars, `AGENT_MAX_ATOMIC_EDITS_PER_GROUP=5` (vacuous for singletons), redundancy guardrails, flow guardrails (if enabled). These are quality gates, not approver-attention guards — they stay.
- The approver's system prompt, output contract (JSONL per group), and per-group accept/reject semantics are unchanged.
- The size-ratio guardrail (≤ 1.5× article growth) inside the approver/applier path is unchanged.
- All Mode A behavior is unchanged. The new field only triggers on `iterative_editing_rewrite`.

**Tests** to add in the same PR (unit + integration):

*Behavior tests* — what the bypass produces:
- [ ] `IterativeEditingAgent.test.ts` — case: input rewrite produces 8 diff atomics split into 1 multi-atomic group (4 atomics) + 4 singletons. With `disableApproverFiltering: false`, approver receives a list of 5 groups (1 multi, 4 single). With `true`, approver receives 8 singleton groups. GroupNumbers are unique. Atomic-edit contents match across both paths.
- [ ] `IterativeEditingAgent.test.ts` — case: high-atomic-count rewrite (~30 atomics). With `disableApproverFiltering: false` + `capGroupsByMagnitude(K=10)`, approver sees ≤ 10 groups. With `true`, approver sees ~30 singleton groups (capped only by `AGENT_MAX_ATOMIC_EDITS_PER_CYCLE=30` if applicable).
- [ ] `IterativeEditingAgent.test.ts` — case: an atomic edit that violates a hard rule (e.g., modifies a heading line) is filtered by `validateEditGroups` in both modes.

*Spy/mock tests* — proving the bypass is mechanical, not behavioral. Named ESM imports already-bound at module-init can't be rewired by `vi.spyOn` reliably; use `vi.mock` with a partial factory:
- [ ] `IterativeEditingAgent.test.ts`:
  ```typescript
  // At top of file:
  import * as coalesceMod from '../../core/agents/editing/coalesceAdjacentGroups';
  import * as capMod from '../../core/agents/editing/capGroupsByMagnitude';
  
  vi.mock('../../core/agents/editing/coalesceAdjacentGroups', async (importOriginal) => ({
    ...await importOriginal<typeof coalesceMod>(),
    coalesceAdjacentGroups: vi.fn(coalesceMod.coalesceAdjacentGroups),
  }));
  vi.mock('../../core/agents/editing/capGroupsByMagnitude', async (importOriginal) => ({
    ...await importOriginal<typeof capMod>(),
    capGroupsByMagnitude: vi.fn(capMod.capGroupsByMagnitude),
  }));
  ```
  Then run a Mode B execution with `disableApproverFiltering: true`. Assert `vi.mocked(coalesceMod.coalesceAdjacentGroups)` and `vi.mocked(capMod.capGroupsByMagnitude)` both received `toHaveBeenCalledTimes(0)`. Same execution with `disableApproverFiltering: false` (or omitted) → both mocks called exactly 1× per cycle. This proves the conditional skips, not just substitutes a no-op.

*Regression tests* — proving default behavior is unchanged:
- [ ] `IterativeEditingAgent.test.ts` — snapshot test: an `IterationConfig` with `disableApproverFiltering` UNSET (the production default) produces a byte-identical sequence of `approverGroups` to a frozen snapshot taken before the bypass PR landed. Confirms the feature flag is a true no-op when unset.
- [ ] `IterativeEditingAgent.test.ts` — snapshot test: same `IterationConfig` with `disableApproverFiltering: false` (explicit) produces the same byte-identical `approverGroups`. Confirms explicit-false and unset behave identically.

*Hash tests*:
- [ ] `findOrCreateStrategy.test.ts` — two `iterative_editing_rewrite` configs differing ONLY in `disableApproverFiltering` produce different `config_hash`.
- [ ] `findOrCreateStrategy.test.ts` — **parametrized strip test**: for every non-rewrite agent type in `iterationAgentTypeEnum` (`generate`, `reflect_and_generate`, `criteria_and_generate`, `single_pass_evaluate_criteria_and_generate`, `proposer_approver_criteria_generate`, `debate_and_generate`, `iterative_editing` (Mode A), `paragraph_recombine`, `swiss`), a config with `disableApproverFiltering: true` on that agent type produces the SAME `config_hash` as the same config without the field. Use `it.each(ALL_NON_REWRITE_AGENT_TYPES)` so the test enumerates all 9 types — a single 'generate' case regresses silently if a new agent type is added and someone forgets the FIELD_GATES entry.

*Integration*:
- [ ] One integration test in `evolution-iterative-editing-agent.integration.test.ts` exercising the disable-filtering path end-to-end on a minimal fixture; verify `proposedGroupsRaw.length` ≈ N atomic edits and `reviewDecisions.length` = `proposedGroupsRaw.length` (every group gets a decision).

*Seed-script tests* (`evolution/scripts/seedBundleSplitExperiment.test.ts`):
- [ ] Dry-run (no `--apply`) prints the planned SQL and exits without writing.
- [ ] `--apply` on a clean DB creates both strategies + experiment + enqueued runs in the expected counts.
- [ ] Re-running with `--apply` and no other flag throws on the `config_hash` collision guard (reuse-existing not opted in).
- [ ] Re-running with `--apply --reuse-existing` reuses the existing strategy ID and only adds NEW runs (idempotent enqueue).
- [ ] `--append --runs-per-arm 25` adds runs to the existing experiment, doesn't create a new experiment row.

**No DB migration required**. The field lives in `evolution_strategies.config` JSONB; the Zod schema enforces the shape.

**Strategy wizard UI** (`src/app/admin/evolution/strategies/new/page.tsx`):

Add a single checkbox to the per-iteration control panel that appears only when `iteration.agentType === 'iterative_editing_rewrite'`. The wizard already swaps per-iteration controls by agent type (reflection's `reflectionTopN`, criteria's `criteriaIds`/`weakestK`, paragraph_recombine's `rewritesPerParagraph` etc.), so this slots cleanly into the same pattern.

Spec:
- **Component**: a labeled checkbox inside the existing per-iteration row, rendered after `editingMaxCycles` and `editingEligibilityCutoff` when the row's agent is `iterative_editing_rewrite`
- **Label**: "Disable approver filtering (send all atomics individually)"
- **Helper text** under the checkbox: "When checked, the approver sees every diff atomic as its own group — no coalescing, no magnitude cap. Quality gates (heading/quote/code-fence rules, max edit length) still apply. Use for testing whether the approver's per-atomic granularity matters; expect ~3× more approver decisions per cycle and slightly higher approver cost."
- **Wires to**: the iteration row's `disableApproverFiltering: boolean` field in `IterationConfig`
- **Default state**: unchecked (`false`)
- **Validation**: client-side just unmounted when agent type is wrong; server-side Zod refinement already added in the schema change above
- **Hide when**: agent type is anything other than `iterative_editing_rewrite` (the field is gated to that type per the Zod refinement; showing it for other agents would be misleading)
- **Agent-switch cleanup** (`src/app/admin/evolution/strategies/new/page.tsx:648,681,713`): mirror the existing pattern that deletes `updated.editingMaxCycles`/`updated.editingCutoff*` when the agent type changes away from a supporting type. Specifically, in the `updateIteration` handler's per-agent-type cleanup blocks, add:
  ```typescript
  // In every branch where agentType !== 'iterative_editing_rewrite':
  delete updated.disableApproverFiltering;
  ```
  This prevents a stale `disableApproverFiltering: true` from surviving an agent switch and silently changing `config_hash` (via the `FIELD_GATES` strip) after re-edit. The wizard E2E test below verifies it.

This makes the experiment reproducible from the wizard for future researchers, not just via the seed script for this specific A/B run. Future strategies that want to use `disableApproverFiltering` (e.g., a Mode A-vs-disabled-Mode-B head-to-head experiment) can be created entirely through the UI.

**Wizard tests** to add:
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-iterative-editing.spec.ts` (or wherever wizard E2E tests live) — case: select `iterative_editing_rewrite` agent type → confirm the disable-approver-filtering checkbox appears; switch to a different agent type → confirm it disappears
- [ ] Same spec — case: check the box, complete the wizard, confirm the resulting strategy's `config.iterationConfigs[i].disableApproverFiltering === true`

### Triggering without UI on staging

The plan is to provision everything via SQL and the existing CLI runner. No admin-UI clicks needed.

**Step 1 — Create both strategies** (one-shot SQL via `npm run query:staging`, or `psql` with write perms via a transient setup script):

The configs mirror the historical `"Iterative editing - whole article"` strategy (id `4900ff14-...`), with only the all-gemini judge swap and the treatment-arm `disableApproverFiltering: true` flag.

```sql
INSERT INTO evolution_strategies (id, name, label, status, config, config_hash, created_by, is_predefined)
VALUES
  (gen_random_uuid(), 'ApproverFilter Control (softCap=8)', 'AF-Ctrl', 'active',
   '{ "generationModel": "google/gemini-2.5-flash-lite",
      "judgeModel": "google/gemini-2.5-flash-lite",
      "budgetUsd": 0.05,
      "generationTemperature": 1,
      "maxComparisonsPerVariant": 3,
      "minBudgetAfterParallelAgentMultiple": 1,
      "iterationConfigs": [
        {"agentType": "generate", "sourceMode": "seed", "budgetPercent": 34},
        {"agentType": "iterative_editing_rewrite", "editingProposerSoftCap": 8, "budgetPercent": 33},
        {"agentType": "iterative_editing_rewrite", "editingProposerSoftCap": 8, "budgetPercent": 33}
      ]
    }'::jsonb,
   /* config_hash computed by upsertStrategy at INSERT time — DO NOT INSERT direct;
      this SQL is illustrative only. Always go through the seed script below. */
   NULL, 'experiment_runner', false),

  (gen_random_uuid(), 'ApproverFilter Off (softCap=8)', 'AF-Off', 'active',
   '{ "generationModel": "google/gemini-2.5-flash-lite",
      "judgeModel": "google/gemini-2.5-flash-lite",
      "budgetUsd": 0.05,
      "generationTemperature": 1,
      "maxComparisonsPerVariant": 3,
      "minBudgetAfterParallelAgentMultiple": 1,
      "iterationConfigs": [
        {"agentType": "generate", "sourceMode": "seed", "budgetPercent": 34},
        {"agentType": "iterative_editing_rewrite", "editingProposerSoftCap": 8, "disableApproverFiltering": true, "budgetPercent": 33},
        {"agentType": "iterative_editing_rewrite", "editingProposerSoftCap": 8, "disableApproverFiltering": true, "budgetPercent": 33}
      ]
    }'::jsonb,
   NULL, 'experiment_runner', false);
```

> **Field difference between arms**: ONLY `disableApproverFiltering: true` on the editing iterations. Everything else is identical, including `editingProposerSoftCap: 8`. This is the bare-minimum manipulation for the A/B.

Because the app computes `config_hash`, the cleanest path is a small one-shot TypeScript helper script:

```bash
npx tsx evolution/scripts/seedBundleSplitExperiment.ts --target staging
```

which calls `findOrCreateStrategy.upsertStrategy(config, db)` for each arm (this handles `config_hash` computation + uniqueness correctly) and then creates the experiment + enqueues runs.

**Step 2 — Create the experiment and enqueue runs** (same script):

```typescript
// evolution/scripts/seedBundleSplitExperiment.ts (sketch)
// Uses existing helpers — does NOT introduce new SQL paths:
//   upsertStrategy(db, config)            // findOrCreateStrategy.ts:218 — note arg order (db first)
//   createExperiment(name, promptId, db)  // evolution/src/lib/pipeline/manageExperiments.ts
//                                            (re-exported via experimentActions.ts:9)
//   addRunToExperiment(experimentId, runOpts, db)
//                                         // evolution/src/lib/pipeline/manageExperiments.ts
//                                            (used by experimentActions.ts:202+)
// (An earlier draft incorrectly cited evolution/src/lib/pipeline/setup/addRunToExperiment.ts
//  — that file does not exist; both helpers live in manageExperiments.ts.)
//
// CRITICAL: upsertStrategy uses ON CONFLICT (config_hash) DO UPDATE in
// findOrCreateStrategy.ts. If a strategy with this exact config_hash already
// exists (e.g., a teammate ran a similar experiment yesterday), upsertStrategy
// returns the EXISTING strategy ID without warning. Runs we enqueue against
// that ID become contaminated with that prior strategy's history.
//
// ALSO: upsertStrategy auto-generates the strategy name from the config hash
// (e.g. "Strategy abc123 (lite, 3it)"). It does NOT accept a name argument.
// We therefore identify arms by strategy_id throughout (seed → verifier → cancel),
// not by name. The seed script prints both IDs at the end of --apply for paste.

async function seedStrategy(armLabel: string, cfg: StrategyConfig, db: SupabaseClient) {
  const hash = hashStrategyConfig(cfg);
  const { data: existing } = await db
    .from('evolution_strategies')
    .select('id, name, created_at')
    .eq('config_hash', hash)
    .maybeSingle();
  if (existing) {
    if (!args.reuseExisting) {
      throw new Error(
        `Strategy config_hash collision: arm "${armLabel}" hashes identically to existing ` +
        `strategy "${existing.name}" (id=${existing.id}, created ${existing.created_at}). ` +
        `Re-using it would contaminate this experiment with the existing strategy's ` +
        `prior runs and arena variants. Pass --reuse-existing if this is intentional, ` +
        `or modify the strategy config (e.g. tweak a benign field) to break the collision.`
      );
    }
    console.warn(`Reusing existing strategy ${existing.id} for arm "${armLabel}" (opt-in via --reuse-existing).`);
    return existing.id;
  }
  return await upsertStrategy(db, cfg);  // (db, config) — NOT (config, db)
}

const ctlStrategyId = await seedStrategy('AF-Ctrl', controlConfig, db);
const trtStrategyId = await seedStrategy('AF-Off', treatmentConfig, db);

// Create or look up the experiment. `getExperimentByName` helper does not
// exist — use an inline SELECT for the --append flow. createExperiment
// auto-suffixes duplicate names ' (1)', ' (2)' (manageExperiments.ts:42-58),
// so a re-run WITHOUT --append silently forks into 'BundleSplit A/B (1)' rather
// than reusing. The append path MUST be taken explicitly.
const EXP_NAME = 'BundleSplit A/B (federal_reserve_2)';
let experimentId: string;
if (args.append) {
  const { data: existing, error } = await db
    .from('evolution_experiments')
    .select('id')
    .eq('name', EXP_NAME)
    .maybeSingle();
  if (error || !existing) {
    throw new Error(`--append requires existing experiment "${EXP_NAME}"; none found. ` +
                    `Run without --append to create one.`);
  }
  experimentId = existing.id;
} else {
  const created = await createExperiment(EXP_NAME, 'a546b7e9-f066-403d-9589-f5e0d2c9fa4f', db);
  experimentId = created.id;
}

// Enqueue runs. addRunToExperiment returns { runId }.
for (let i = 0; i < args.runsPerArm; i++) {
  await addRunToExperiment(experimentId, { strategy_id: ctlStrategyId, budget_cap_usd: 0.05 }, db);
  await addRunToExperiment(experimentId, { strategy_id: trtStrategyId, budget_cap_usd: 0.05 }, db);
}

console.log(`Seeded. Use these IDs in verifyBundleSplitStage1.ts:`);
console.log(`  --experiment-id ${experimentId}`);
console.log(`  --control-strategy ${ctlStrategyId}`);
console.log(`  --treatment-strategy ${trtStrategyId}`);
```

**Flags**: `--target {staging|prod}`, `--runs-per-arm N` (default 5), `--apply` (else dry-run prints planned writes), `--append` (adds runs to existing experiment of the same name instead of creating new), `--reuse-existing` (opt-in to skip the collision guard).

**Step 3 — Run the queue from the CLI** (the standard batch runner used by the minicomputer cron):

```bash
npx tsx evolution/scripts/processRunQueue.ts \
  --parallel 3 \
  --max-runs 60 \
  --max-concurrent-llm 20
```

Or, if a single run needs to be smoke-tested first, **call `processRunQueue.ts` directly with the run ID** — the HTTP API at `/api/evolution/run` uses `requireAdmin()` session-cookie auth (NOT Bearer tokens), so `curl` from a CLI requires a saved Supabase auth cookie, which is operationally clumsy. Direct invocation is simpler and matches the cron's code path:

```bash
# Recommended: same code path the API route uses, no auth dance.
npx tsx evolution/scripts/processRunQueue.ts \
  --parallel 1 \
  --max-runs 1 \
  --target-run-id <one-of-the-pending-run-uuids>
```

If `processRunQueue.ts` doesn't accept `--target-run-id` yet, add the flag in the same PR — wire it to the existing single-run code path it shares with `/api/evolution/run` (which body-shapes the field as `targetRunId` per `route.ts:21`, NOT `runId`). Equivalent path if you really want the HTTP route:

```bash
# Less preferred: requires saved cookie jar from a prior admin sign-in.
# WARNING: ~/.cache/ea-staging-cookies.txt contains an admin Supabase session
# cookie in plaintext. Set 0600 permissions and never commit / never sync to a
# backed-up location. On a shared dev host this is a privilege-escalation risk.
chmod 600 ~/.cache/ea-staging-cookies.txt
curl -X POST https://explainanythingstage.vercel.app/api/evolution/run \
  -b ~/.cache/ea-staging-cookies.txt \
  -H 'content-type: application/json' \
  -d '{"targetRunId": "<one-of-the-pending-run-uuids>"}'
```

(The API route at `src/app/api/evolution/run/route.ts` validates `{targetRunId: z.string().uuid().optional()}` and calls `requireAdmin()` before dispatch — same downstream code path the cron uses, but cookie-gated.)

**Env vars** required by the seed/verify/cancel scripts (verified in `docs/docs_overall/environments.md`):
- `SUPABASE_URL_STAGING` — staging Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY_STAGING` — staging service-role key for writes
- (existing — already in `.env.local` per getting_started.md; no new secret provisioning required)
- For prod (out of scope for this experiment): the same pair with `_PROD` suffix. The `--target prod` flag is intentionally NOT documented in the seed-script flag list above; if a future researcher wants to seed against prod, they must add an explicit `--i-know-this-is-prod` confirmation flag to the script.

**`processRunQueue.ts --target-run-id` flag**: this flag does not currently exist on `processRunQueue.ts`. The Code-change task list above includes adding it (same code PR as the bypass conditional) — wire it to the existing single-run code path that `/api/evolution/run` already uses. Without it, single-run smoke-testing requires the HTTP route + cookie jar.

### Result surfacing in the UI (auto, no new pages)

All the right views already exist. No code changes needed for visualization:

| Where to look | What it shows | Why it matters here |
|---|---|---|
| `/admin/evolution/experiments/[experimentId]` | Per-arm aggregates: cost, winner Elo, eloPer$, variant count, decisive rate. The Analysis tab compares strategy arms head-to-head. | Direct A/B comparison surface |
| `/admin/evolution/experiments/[experimentId]/Logs` | Multi-entity log query — surfaces all 60 runs' logs | Diagnosis when a run fails |
| `/admin/evolution/runs/[runId]/Variants` (per run) | Lineage + agent_name + Elo per variant | Per-run drill-in for treatment-arm variants to see whether they survived |
| `/admin/evolution/runs/[runId]/Metrics` | The new run-level `eloAttrDelta:iterative_editing_rewrite:rewrite` row + 95 % CI | Quantified per-run attribution Δ |
| `/admin/evolution/invocations/[invocationId]/Edit Cycle` (per iteration) | `proposedGroupsRaw`, `reviewDecisions`, `droppedPreApprover`, `droppedPostApprover`, accepted groups with truncated atomic-edit list, cost split per cycle | **Most important**: treatment-arm invocations will show ~5× more groups (split bundles → singletons) and the approver's per-singleton accept/reject pattern is directly inspectable |
| `/admin/evolution/variants/[variantId]/Diff vs parent` | Side-by-side word diff | See exactly what the treatment arm preserved that control arm rewrote |
| `/admin/evolution/matches` filtered by `run_id IN (...)` | All arena comparisons that involved these variants | Confirm the Elo deltas via the underlying judge calls |
| `/admin/evolution/strategies/[strategyId]/Tactics` | Per-strategy bootstrap-CI Δ-Elo bars | Long-term aggregate view if the experiment is repeated |

Since every variant produced enters the federal_reserve_2 arena, the leaderboard at `/admin/evolution/arena/a546b7e9-...` will also update with the new contenders.

**Arena contamination — analyzed-result hygiene**. The federal_reserve_2 arena is a shared pool: any variant added enters the same Elo system as all historical (qwen-judged) variants. Two consequences for analysis:

1. **The leaderboard view mixes regimes**. A treatment-arm variant's Elo on the leaderboard reflects matches against (a) other experiment variants under gemini-judge and (b) historical variants under qwen-judge. The qwen vs gemini judge calibration delta is unknown until measured. Use the leaderboard as a coarse signal only.
2. **The clean Δ-Elo signal lives in `evolution_arena_comparisons` filtered by experiment**. The actual schema (verified in `supabase/migrations/20260322000007:201-204`): `evolution_arena_comparisons (prompt_id, entry_a UUID, entry_b UUID, winner, confidence, run_id, ...)` — `entry_a`/`entry_b` are FKs to `evolution_variants.id`. There is NO `evolution_arena_variants` table; arena rows live on `evolution_variants` itself with the `synced_to_arena BOOLEAN` flag.
   ```sql
   -- "Clean" comparisons: both sides came from THIS experiment, so both are gemini-judged.
   SELECT c.*
   FROM evolution_arena_comparisons c
   JOIN evolution_variants va ON c.entry_a = va.id
   JOIN evolution_variants vb ON c.entry_b = vb.id
   JOIN evolution_runs ra ON va.run_id = ra.id
   JOIN evolution_runs rb ON vb.run_id = rb.id
   WHERE ra.experiment_id = '<exp_id>' AND rb.experiment_id = '<exp_id>';
   ```
   The analysis report (Stage 2 output) MUST cite this filtered view, not the leaderboard, when computing treatment-vs-control Δ-Elo. Document this in the report's methodology section.
3. **Strategy-ID filter**: another safe filter is `WHERE ra.strategy_id IN (<ctl>, <trt>) AND rb.strategy_id IN (<ctl>, <trt>)` to scope to the two experiment arms only — analogous to the `gen_method` label idea but anchored to the actual strategies we created.

### Acceptance criteria

All three use the explicit tests defined in the Stage 2 section above (two-proportion z on improver rate; Welch's t on per-run mean Δ-Elo; bootstrap CI of the difference). The improver-rate test is the PRIMARY decision criterion; the others are corroborating.

**Confirmed H1** — proceed to a follow-up PR proposing `disableApproverFiltering: true` as the production default for Mode B (NOT a direct rollout — H1 confirmation just unlocks the C3 / B2 follow-ups needed before generalizing):
- **Primary, required**: Two-proportion z-test p < 0.05 AND treatment improver rate ≥ control + 30 percentage points (matching the ~80 %-power detectable effect at n=30/arm)
- **AND at least ONE of the two corroborators** (the prior draft required BOTH corroborators with AND, which stacked type-II error to an unreasonable level at n=30/arm — the relaxed gate keeps type-I control via the primary while preventing the experiment from landing in Inconclusive on a marginal corroborator miss):
  - Welch's t-test on per-run mean Δ-Elo p < 0.10
  - Bootstrap 95 % CI of the median Δ-Elo difference excludes 0

**Null H0** — revert the field to permanent `false` or remove:
- Two-proportion z-test p > 0.30 (clearly no signal, not just under-powered)
- AND |treatment improver rate − control improver rate| < 10 percentage points
- AND |treatment mean Δ-Elo − control mean Δ-Elo| < 5 Elo points

**Inconclusive** — run the n=90/arm follow-up or design a B2 (granularity-only) experiment:
- Two-proportion z-test p in (0.05, 0.30) (signal present but not significant at this sample size)
- OR treatment improver rate − control improver rate in (10, 30) pp range (modest signal — exactly the regime n=30/arm can't distinguish from noise)
- OR effect sign disagreement between primary and secondary tests

**Plan-review acceptance** for the resulting analysis report PR: the methodology section MUST explicitly call out all 4 caveats (softCap=8 deviation from production default, gemini-judge calibration vs historical qwen, same-model rubber-stamping confound, arena-contamination filter applied via experiment-id-scoped SQL). Reviewer should reject the report PR if any caveat is missing.

### Cost budget — staged

All models are `google/gemini-2.5-flash-lite` (proposer, approver, judge, drift-recovery, seed-gen all fall back to or are explicitly set to this model). Per-run cost is essentially flat across both arms; the treatment arm's approver sees ~3× as many groups in its user prompt and emits ~3× as many JSONL lines, but at gemini-flash-lite rates the additional spend is < $0.002 per run (rounding noise on $0.038).

| Stage | Arm config | Runs | $ per run expected | $ per run cap | Stage total expected | Stage total cap |
|---|---|---:|---:|---:|---:|---:|
| Stage 1 — smoke | 5 control + 5 treatment | 10 | $0.040 | $0.050 | **$0.40** | $0.50 |
| Stage 2 — scale (conditional) | 25 control + 25 treatment | 50 | $0.040 | $0.050 | **$2.00** | $2.50 |
| **Cumulative if both stages run** | | **60** | | | **$2.40** | **$3.00** |
| **Cumulative if only Stage 1** | | **10** | | | **$0.40** | **$0.50** |

Treatment arm cost breakdown for the additional approver work — corrected to account for `AGENT_DEFAULT_MAX_CYCLES = 3` per editing iteration (constants.ts:5), so a single run can do up to **6 approver calls** (2 editing iterations × 3 cycles), NOT 2:

- Control: ~10 groups, ~80 tokens/group header × 10 input = 800 tokens input + ~10 JSONL lines × ~40 tokens = 400 tokens output → ~$0.0002 input + $0.0002 output = **$0.0004** per editing-cycle approver call. With softCap=8 (more proposer output to render in the approver prompt), bump to **~$0.0006** per call.
- Treatment: ~40-50 groups (softCap=8 means more atomics; bounded by `AGENT_MAX_ATOMIC_EDITS_PER_CYCLE=30` ceiling), same per-group rendering = 3,200-4,000 tokens input + 1,600-2,000 tokens output → ~$0.0003 input + $0.0008 output = **~$0.0011** per editing-cycle approver call.
- Difference per call: ~+$0.0005; up to 6 cycles per run → up to **+$0.003 per run**; the run-level cost moves from $0.038 → ~$0.041 in the worst case. Both arms still well within the $0.05 per-run cap. The `budgetUsd: 0.05` config enforces a hard ceiling — if a run exceeds it, the runner halts the iteration early.

> **Practical lower bound**: in the historical data, federal_reserve_2 Mode B runs typically used 1-2 cycles per iteration (not the full 3) before hitting the budget. So the realistic cycle count is closer to 2-4 per run, and the realistic per-run delta is +$0.001-$0.002. The cost ceiling table below uses the conservative 6-cycle bound.

Ranking cost is already counted in `evolution_metrics.ranking_cost` per the cost-augmented analyses. The gemini-judge swap doesn't change ranking-call cost meaningfully (similar token rates to qwen).

### Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| The approver LLM has fixed approver-prompt-length token costs that double if it sees 5× more groups | Medium | +30 % per-invocation cost on treatment arm | Confirmed acceptable — total budget is $3, even 2× cost overrun ($4.60) is trivial |
| Splitting a 5-atomic group produces 5 redundant approver rationales that don't add information | High | Slightly wastes approver attention | Real cost is < 1¢/invocation; the experiment is whether the per-atomic granularity matters at all |
| The treatment arm's many small-group approver decisions take longer wall-clock | Low-medium | +50 % wall-clock per editing cycle | Not a budget concern; runs are async via CLI |
| The 30/arm sample size isn't enough to distinguish a real but modest effect | Medium | Inconclusive result | Stopping rule allows early-stop if effect is large; if inconclusive at 60 runs, scale to 120 |
| The treatment-arm strategy gets a unique `config_hash` and pollutes the strategies list | Low | UI clutter | Mark with clear `name` prefix `BundleSplit` for filterability |
| A bug in the splitter produces invalid groupNumbers and causes `applyAcceptedGroups` to fail | Low | Treatment arm has high failure rate | Unit tests + integration test before SQL seed; smoke a single run via `/api/evolution/run` before mass-enqueue |

### What this experiment does NOT settle

- It tests Mode B in isolation. Mode A is unaffected — the new field is gated to `iterative_editing_rewrite`.
- It tests on one prompt (federal_reserve_2). A clean win on this prompt doesn't guarantee transfer to other prompts; a follow-up would replay it against 2-3 other prompts with their own pools.
- It doesn't compare Mode A vs filter-disabled-Mode B head-to-head. Best to run that as a separate experiment after the H1 result is in.
- It bundles two architectural changes together (no coalescing AND no magnitude cap). If H1 confirms, a follow-up could disambiguate which of the two changes mattered — but for this initial test, the goal is just to see whether removing the filter pipeline as a unit makes Mode B work better. Either component (coalescer-only-off, cap-only-off) is a strict subset of disabling both, so the disabled-both setup is the maximally-permissive baseline against which any partial restore can be measured.

### Phase 6 task list

**Code change** (one PR):
- [ ] (Code) Widen `editingProposerSoftCap` Zod max from 5 to 10 at `evolution/src/lib/schemas.ts:693` (prerequisite for A3's softCap=8 to parse). Update the inline comment that says "Default 3" if present.
- [ ] (Code) Add `disableApproverFiltering?: boolean` to `iterationConfigSchema` in `evolution/src/lib/schemas.ts` + Zod refine gating it to `agentType === 'iterative_editing_rewrite'`. (No separate `pipeline/types.ts` file exists — IterationConfig is `z.infer` from this schema.)
- [ ] (Code) Add the `FIELD_GATES` entry in `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts:49-70`: `disableApproverFiltering: (t) => t === 'iterative_editing_rewrite'`
- [ ] (Code) Extend the inline `iterationConfigs` element type at `IterativeEditingAgent.ts:155-163` to include `disableApproverFiltering?: boolean` so the bypass read at the new conditional compiles
- [ ] (Code) Implement the filter-bypass conditional at `IterativeEditingAgent.ts:304-310` reading from `iterCfg?.disableApproverFiltering` (follows the existing `iterCfg?.editingProposerSoftCap ?? 3` precedent at line 172). When the flag is true, skip the Mode B post-parse `coalesceAdjacentGroups` + `capGroupsByMagnitude` block entirely; `parseResult.groups` stays as raw diff atomics; `validateEditGroups` at line 429 still runs.
- [ ] (Code) Add `--target-run-id <uuid>` flag to `evolution/scripts/processRunQueue.ts` — wire to the existing single-run path via `claimAndExecuteRun.targetRunId` (already accepted at claimAndExecuteRun.ts:45). When the flag is set, the runner MUST coerce `--parallel 1 --max-runs 1` (a second concurrent claim attempt on the same UUID returns claimed=false and causes immediate idle-exit).
- [ ] (Code) Verify the actual `claim_evolution_run(p_runner_id TEXT, p_run_id UUID)` RPC signature (NOT `claim_pending_run`, which doesn't exist — verified at migration 20260322000001:10) supports the target-run-id parameter end-to-end. If not, add it.
- [ ] (UI) Add the disable-filtering checkbox to the strategy wizard's per-iteration row when agent type is `iterative_editing_rewrite` (with helper text explaining behavior + cost impact)
- [ ] (UI) Extend the wizard-side `IterationRow` interface (`src/app/admin/evolution/strategies/new/page.tsx:38`) and `IterationConfigPayload` interface (line 144) to include `disableApproverFiltering?: boolean`. Update the `toIterationConfigsPayload` serializer (line 219) to write the field through. Without these type-source-of-truth extensions, the form state can't round-trip the field.
- [ ] (UI) Add `delete updated.disableApproverFiltering` to every non-rewrite agent-switch branch in the wizard's `updateIteration` handler (`updateIteration` starts at page.tsx:620). Enumerate explicitly — not just `~648, 681, 713`. The full set as of HEAD: any branch where agentType ≠ `iterative_editing_rewrite`, including the Mode A (`iterative_editing`) branch, the `generate`/`reflect_and_generate` branches, the criteria branches, the `paragraph_recombine` branch, the `debate_and_generate` branch, and the `swiss` branch.
  **Mode A edge case**: the current code shares a single branch for `iterative_editing` AND `iterative_editing_rewrite` (page.tsx:657). The cleanup needs to either (a) split the shared branch into two, or (b) wrap the delete inside an `if (updated.agentType === 'iterative_editing') delete updated.disableApproverFiltering` guard inside the shared block. Don't add the delete to the shared block unconditionally — that would cripple Mode B (the field is valid there). Pick (b) for minimum diff.
- [ ] (UI optional but recommended) Add a `editingProposerSoftCap` widget to the wizard's per-iteration row for `iterative_editing_rewrite` so the wizard-reproducibility claim holds end-to-end. Max value gates to 10 per the schema change above. Add the field to `IterationRow` + `IterationConfigPayload` interfaces as well.
- [ ] (Tests) Behavior unit tests for the bypass + standard path (8-atomic case, 30-atomic case, hard-rule violation case, AGENT_MAX_ATOMIC_EDITS_PER_CYCLE=30 ceiling case)
- [ ] (Tests) `vi.mock` partial-factory tests proving `coalesceAdjacentGroups` and `capGroupsByMagnitude` receive zero calls in bypass mode (the exact mock setup is documented in the Tests section above — `vi.spyOn` doesn't reliably rewire named ESM imports already bound at module-init)
- [ ] (Tests) Default-false regression test — snapshot of `approverGroups` derived from a frozen checked-in CriticMarkup fixture at `evolution/src/lib/core/agents/editing/__fixtures__/disableApproverFiltering-snapshot.criticmarkup.txt` (the `__fixtures__/sample-articles.ts` companion in this folder is the existing pattern). The fixture must be a hand-written CriticMarkup string, NOT an LLM-generated output, so it can't drift on re-run. For an unset-field config the snapshot must match the pre-PR baseline byte-for-byte
- [ ] (Tests) Mode A defense-in-depth — explicit unit test that runs a Mode A (`iterative_editing`) iteration with `disableApproverFiltering: true` set on the config (bypassing Zod via a direct cast); assert the coalesce+cap path STILL runs (the new bypass is gated by `isRewriteMode` so this should be vacuously true, but the test documents the runtime invariant and catches any future refactor that lifts the gate)
- [ ] (Tests) `proposerPromptRewrite.test.ts` — extend the existing `it.each` to cover `editingProposerSoftCap` values `[1, 3, 5, 8, 10]`. Assert each renders `/AT MOST <N> distinct improvements/` in the system prompt. Without this, a future refactor that clamps the rendered cap to 5 would silently null the A3=8 experiment.
- [ ] (Tests) Zod regression for the schema widening — `editingProposerSoftCap: 8` parses cleanly; `editingProposerSoftCap: 11` rejects with the max(10) message.
- [ ] (Tests) `verifyBundleSplitStage1.ts` invalid-UUID test — invalid UUIDs for any of `--experiment-id`/`--control-strategy`/`--treatment-strategy` throw `"Invalid UUID for --<flag>"` BEFORE any DB call (the pre-DB regex validation added to the script above).
- [ ] (Tests) Explicit-false snapshot test — `disableApproverFiltering: false` produces the same `approverGroups` as the unset case
- [ ] (Tests) Integration test exercising the bypass end-to-end
- [ ] (Tests) Strategy wizard E2E test (at `src/__tests__/e2e/specs/09-admin/admin-evolution-iterative-editing.spec.ts` — verified path) for the new checkbox: appears for Mode B, hidden for other agents, persists to config, cleared on agent switch
- [ ] (Tests) `findOrCreateStrategy` `config_hash` uniqueness test — two `iterative_editing_rewrite` configs differing only in the new field hash differently
- [ ] (Tests) `findOrCreateStrategy` `FIELD_GATES`-strip test — parametrized via `it.each` over all 9 non-rewrite agent types (the full `iterationAgentTypeEnum` minus `iterative_editing_rewrite`); each must hash identically with vs. without the field set
- [ ] (Tests) `findOrCreateStrategy` softCap=8 hash-stability test — confirm raising `editingProposerSoftCap` from 3 to 8 actually changes the hash (otherwise the experiment Control and Treatment arms would collide silently with any historical softCap=3 strategy)
- [ ] (Tests) `processRunQueue` `--target-run-id` coercion test — when `--target-run-id <uuid>` is set, the runner forces `--parallel 1 --max-runs 1` (and either applies the coercion silently or errors clearly if the user passed a conflicting `--parallel 3`)
- [ ] (CI) Confirm `evolution/scripts/**` is covered by the existing `npm run test:unit` and `npm run test:integration:evolution` glob patterns. If not, update `.github/workflows/ci.yml` to include them so future signature changes to `upsertStrategy` / `createExperiment` / `addRunToExperiment` don't silently break the seed script.
- [ ] (Deps) Add a tiny stats helper to compute two-proportion z + Welch's t + bootstrap CI. Neither `simple-statistics` nor `jstat` exist in `package.json` (verified). **Default: hand-roll the three tests** in `evolution/scripts/stats.ts` (~60 lines total — z, t, bootstrap) so the analysis-report PR is never blocked on a deps decision. Override only if a reviewer of the report PR specifically prefers a library. Adding a dependency for ~60 lines of well-tested numeric code is a worse trade than the lines themselves.
- [ ] (PR) Land the code change + UI as a feature-flagged no-op (production behavior unchanged when field is unset)

**Stage 1 — smoke (10 runs, $0.40, ~10 min wall clock at `--parallel 3`)**:
- [ ] (Script) Write `evolution/scripts/seedBundleSplitExperiment.ts` (idempotent, dry-run by default, `--apply` to write, `--runs-per-arm 5` flag, `--reuse-existing` flag, `--append` flag). Includes the `seedStrategy` reuse-guard above.
- [ ] (Script) Write `evolution/scripts/verifyBundleSplitStage1.ts` (4 SQL acceptance checks; exits non-zero on any fail)
- [ ] (Script) Write `evolution/scripts/cancelExperiment.ts` (cancels pending runs + marks experiment status='cancelled' without rolling back completed history)
- [ ] (Tests) Tests for all three scripts (dry-run/apply, collision-guard throws, idempotent re-apply, append mode, cancel idempotency)
- [ ] (Setup) Run `npx tsx evolution/scripts/seedBundleSplitExperiment.ts --target staging --runs-per-arm 5 --apply` to create both strategies + experiment + 10 pending runs
- [ ] (Single-run smoke) Trigger 1 control + 1 treatment run via `processRunQueue.ts --max-runs 1 --target-run-id <id>`; wait for both to complete
- [ ] (UI verify — single run) On staging admin UI:
  - Open one control invocation's Edit Cycle tab — confirms baseline rendering
  - Open one treatment invocation's Edit Cycle tab — confirms split groups render as N rows
  - Open the experiment page — confirms both arms appear
  - Open the variant detail Diff-vs-parent tab on a treatment-arm variant — confirms standard rendering
  - Open the arena leaderboard `/admin/evolution/arena/a546b7e9-...` — confirms variants synced
- [ ] (Batch) Run `processRunQueue.ts --parallel 3 --max-runs 8` to complete the remaining 8 runs
- [ ] (SQL gate) Run `npx tsx evolution/scripts/verifyBundleSplitStage1.ts --experiment-id <expId> --control-strategy <ctlId> --treatment-strategy <trtId>` — must exit 0 before proceeding. The 6 SQL checks the script runs: `no_failures`, `cost_under_ceiling`, `treatment_bypass_active`, `control_cap_fired`, `treatment_mostly_singletons`, `arena_sync_both_arms`. (The "4 SQL checks" phrasing in earlier drafts was off-by-2.)
- [ ] (UI gate) Manually walk through checks #4 (Edit Cycle render) and #5 (experiment page render). Document any rendering glitches in `_progress.md`.

**Stage 2 — scale (conditional, 50 additional runs, $2.00, ~45 min)**:
- [ ] (Decision gate) Confirm Stage 1 passed all 6 checks (4 SQL via `verifyBundleSplitStage1.ts` + 2 manual UI checks). If not, stop and remediate.
- [ ] (Enqueue) Re-run the seed script: `npx tsx evolution/scripts/seedBundleSplitExperiment.ts --target staging --runs-per-arm 25 --append --apply --reuse-existing` (`--append` adds 25 more to each arm of the EXISTING experiment; `--reuse-existing` is required because the strategy `config_hash`es already exist from Stage 1)
- [ ] (Batch) Run `processRunQueue.ts --parallel 3 --max-runs 50`
- [ ] (Analysis) Open `/admin/evolution/experiments/[id]` — pull per-arm aggregates
- [ ] (Analysis) Pull the experiment-filtered comparison SQL (see "Arena contamination" above) and compute per-arm Δ-Elo on gemini-judged-only matches
- [ ] (Report) Append findings to `_research.md` and promote to a new `docs/analysis/bundle-split-ab-federal-reserve-2-<date>/`. Methodology section MUST document (a) softCap=8 deviation from production default, (b) gemini-judge calibration vs historical qwen, (c) same-model rubber-stamping confound, (d) arena-contamination filter applied
- [ ] (Decision) If H1 confirmed, file follow-up PR flipping default to `disableApproverFiltering: true` for `iterative_editing_rewrite`. Note: before generalizing, also schedule the B2 follow-up (granularity-only test) and the C3 follow-up (distinct-family approver test) to isolate confounds

**Documentation updates** (same PR as the code change, before merge):
- [ ] (Docs) Add a "Disabling approver filtering (experimental)" subsection to `evolution/docs/editing_agents.md` near the Mode B section. Explain the field, when it applies (Mode B only), expected behavior change, and cost/coverage trade-offs. Include the SQL example showing the difference in `proposedGroupsRaw` shape between arms.
- [ ] (Docs) Add a brief callout to `evolution/docs/multi_iteration_strategies.md` in the iterationConfigs schema section noting the new field and its Mode B gate
- [ ] (Docs) Update `evolution/docs/cost_optimization.md` with a note that disabling filtering raises approver token spend by ~10-15 % per editing cycle but stays well under the run budget cap
- [ ] (Docs) Cross-link the resulting analysis report into `evolution/docs/strategies_and_experiments.md` once Stage 2 completes

## Review & Discussion
*(populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration)*
