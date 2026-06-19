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

**Stage 2 — scale (an additional 25/arm, total 30/arm = 60)**: powered to detect a 13 % → 30 % improver-rate lift at α = 0.05 two-sided, β = 0.20. Triggered only if Stage 1 passed all acceptance checks below. Cost: an additional ~$2.00, $2.50 hard ceiling.

**Cumulative experiment cost ceiling: $3.00 if both stages run; $0.50 if Stage 1 alone.**

### Stage 1 (smoke) acceptance checks

Stage 2 fires only when ALL six hold after the 10 smoke runs complete:

- [ ] **No code crashes**. Zero runs in `status='failed'` with `error_code IN ('iterative_edit_invalid_groups', 'unhandled_exception')`. Treatment-arm runs complete with `status='completed'`.
- [ ] **Cost stays under budget**. Mean per-run cost ≤ $0.05 in both arms; total experiment spend ≤ $0.50.
- [ ] **Filter-disable actually takes effect in treatment arm**. At least one treatment-arm invocation shows `proposedGroupsRaw.length` ≥ 15 (the raw diff atomic count, no longer capped at 10), AND every group in `proposedGroupsRaw` has exactly 1 atomic edit (no coalescing happened), AND `reviewDecisions.length` = `proposedGroupsRaw.length` (every group received an approver decision). For control: `proposedGroupsRaw.length` ≤ 10 (the cap fired) and some groups have ≥ 2 atomic edits.
- [ ] **Admin UI renders treatment-arm Edit Cycle tabs cleanly**. Manually open one treatment-arm invocation's `/admin/evolution/invocations/[id]` page and confirm:
  - The Edit Cycle tab loads without errors despite ~15-30 group rows (vs control's ~10)
  - The per-group accept/reject table renders every singleton group as its own row
  - The `proposedMarkup` / `computedMarkup` fields still show the original CriticMarkup string (the markup is unchanged; only the group bucketing changed)
  - The cycle-cost split (`proposeCostUsd`, `approveCostUsd`) is positive and reasonable; `approveCostUsd` should be modestly higher than control's (≈ +30 %) because the approver prompt is longer
- [ ] **Admin UI renders the experiment page cleanly**. Open `/admin/evolution/experiments/[experimentId]` and confirm both strategies appear in the Analysis tab with their per-arm aggregate cards. No "missing strategy" or "0 runs" rendering glitches.
- [ ] **Arena sync works**. At least one variant from each arm reaches `synced_to_arena=true` and appears in `/admin/evolution/arena/a546b7e9-...`. Confirms the run finalized end-to-end and the sync path doesn't break on split-group invocations.

If any check fails, fix the issue and re-run the 10 smoke runs (this is cheap enough to repeat). Do NOT proceed to Stage 2 with a partially-working setup.

**Programmatic Stage 1 verification** — checks 1, 2, 3, 6 are SQL-verifiable; check 4, 5 require human eyes. Add `evolution/scripts/verifyBundleSplitStage1.ts` that runs the SQL checks and exits non-zero if any fail:

```typescript
// evolution/scripts/verifyBundleSplitStage1.ts (sketch)
// Exits 0 if all SQL-verifiable Stage 1 checks pass for experiment $1.
const experimentId = args._[0];

const failed = await runSqlChecks(experimentId, [
  // Check 1: no failed runs
  { name: 'no_failures',
    sql: `SELECT COUNT(*) FROM evolution_runs
          WHERE experiment_id = $1 AND status = 'failed'`,
    expect: (r) => Number(r.rows[0].count) === 0 },
  // Check 2: cost ceiling
  { name: 'cost_under_ceiling',
    sql: `SELECT SUM(cost_usd) AS total FROM evolution_runs WHERE experiment_id = $1`,
    expect: (r) => Number(r.rows[0].total) < 0.50 },
  // Check 3a: treatment proposedGroupsRaw.length >= 15 on at least one cycle
  { name: 'treatment_bypass_active',
    sql: `SELECT COUNT(*) AS n FROM evolution_invocations i
          JOIN evolution_runs r ON i.run_id = r.id
          JOIN evolution_strategies s ON r.strategy_id = s.id
          WHERE r.experiment_id = $1
            AND s.name LIKE 'ApproverFilter Off%'
            AND jsonb_array_length((i.editing_cycles->0->'proposedGroupsRaw')) >= 15`,
    expect: (r) => Number(r.rows[0].n) >= 1 },
  // Check 3b: control proposedGroupsRaw <= 10 on every cycle (cap fired)
  { name: 'control_cap_fired',
    sql: `SELECT MAX(jsonb_array_length(c.cycle->'proposedGroupsRaw')) AS max_groups
          FROM evolution_invocations i
          JOIN evolution_runs r ON i.run_id = r.id
          JOIN evolution_strategies s ON r.strategy_id = s.id
          CROSS JOIN LATERAL jsonb_array_elements(i.editing_cycles) AS c(cycle)
          WHERE r.experiment_id = $1
            AND s.name LIKE 'ApproverFilter Control%'`,
    expect: (r) => Number(r.rows[0].max_groups) <= 10 },
  // Check 3c: treatment every group is a singleton
  { name: 'treatment_all_singletons',
    sql: `SELECT MAX(jsonb_array_length(g->'atomicEdits')) AS max_atomics
          FROM evolution_invocations i
          JOIN evolution_runs r ON i.run_id = r.id
          JOIN evolution_strategies s ON r.strategy_id = s.id
          CROSS JOIN LATERAL jsonb_array_elements(i.editing_cycles) AS c(cycle)
          CROSS JOIN LATERAL jsonb_array_elements(c.cycle->'proposedGroupsRaw') AS g(g)
          WHERE r.experiment_id = $1
            AND s.name LIKE 'ApproverFilter Off%'`,
    expect: (r) => Number(r.rows[0].max_atomics) === 1 },
  // Check 6: arena sync — at least one variant per arm reached synced=true
  { name: 'arena_sync_both_arms',
    sql: `SELECT s.name, SUM(CASE WHEN v.synced_to_arena THEN 1 ELSE 0 END) AS synced
          FROM evolution_variants v
          JOIN evolution_runs r ON v.run_id = r.id
          JOIN evolution_strategies s ON r.strategy_id = s.id
          WHERE r.experiment_id = $1
          GROUP BY s.name`,
    expect: (r) => r.rows.every((row) => Number(row.synced) >= 1) },
]);

if (failed.length > 0) {
  console.error('Stage 1 checks failed:', failed);
  process.exit(1);
}
console.log('All Stage 1 SQL checks passed. Now run the 2 manual UI checks (#4, #5).');
```

Run with: `npx tsx evolution/scripts/verifyBundleSplitStage1.ts <experimentId>`. Stage 2 is gated by both (a) this script exits 0 AND (b) the 2 human UI checks pass.

**Cancel-experiment rollback drill** — if Stage 1 detects a problem mid-flight or Stage 2 needs to be aborted, cancel the experiment cleanly:

```bash
# 1. Stop new runs from claiming
npx tsx evolution/scripts/cancelExperiment.ts \
  --experiment-id <experimentId> \
  --target staging \
  --reason "Stage 1 check N failed: <details>"

# What it does:
# - UPDATE evolution_runs SET status='cancelled' WHERE experiment_id = $1 AND status = 'pending'
# - UPDATE evolution_experiments SET status='cancelled', cancelled_reason = $2 WHERE id = $1
# - Does NOT roll back already-completed runs or already-synced arena variants (history is preserved for forensic analysis)
# - Does NOT delete the strategies (they remain in evolution_strategies for re-use)

# 2. Mark in-progress runs (rare): processRunQueue is idempotent; the cancelled
#    flag will be checked at the start of each claim. In-flight runs complete
#    normally — no SIGTERM, no orphaned LLM calls.

# 3. (Optional) Remove arena variants if the experiment was malformed and is
#    polluting the leaderboard. ALWAYS get explicit user approval before this:
#    DELETE FROM evolution_arena_variants WHERE run_id IN (
#      SELECT id FROM evolution_runs WHERE experiment_id = $1
#    );
```

If `cancelExperiment.ts` doesn't exist yet, add it in the same PR (the SQL above is the one-liner equivalent if running ad-hoc).

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

**Stopping rule**: run all 60. If at the 30-run mark the treatment arm has already shown ≥ 50 % improver rate (vs control's ~ 13 %), stop early and report — that's the strongest possible signal at the smallest cost. If both arms are tracking within 5 % of each other, run the full 60 to confirm null.

### Implementation — single config field, one conditional

The minimal code change is one new `IterationConfig` field (defaults to false → exact backward compatibility) plus a single conditional that bypasses two filter steps:

**Code touch points** (paths and line numbers verified against the current branch):

1. `evolution/src/lib/pipeline/types.ts` — add `disableApproverFiltering?: boolean` to `IterationConfig` interface. Default `false`.
2. `evolution/src/lib/schemas.ts` — add the same field to `iterationConfigSchema` Zod definition. Valid only when `agentType === 'iterative_editing_rewrite'` (Mode A's `iterative_editing` path uses a different proposer/diff architecture; bypassing filters there is out of scope for this experiment).
3. `evolution/src/lib/core/agents/editing/IterativeEditingAgent.ts` — the Mode B post-parse pipeline is at lines 304-310:
   ```typescript
   // Current (unchanged) code at lines 304-310:
   if (isRewriteMode) {
     const coalesced = coalesceAdjacentGroups(parseResult.groups, current.text);
     const cap = capGroupsByMagnitude(coalesced, current.text, 10);
     parseResult.groups = cap.kept;
     parseResult.dropped = [...parseResult.dropped, ...cap.dropped];
   }
   ```
   After this change, wrap the body with the bypass conditional (the variable `input.config.disableApproverFiltering` reads from the `IterationConfig` already present on `input.config`):
   ```typescript
   if (isRewriteMode) {
     if (input.config?.disableApproverFiltering) {
       // BYPASS: skip coalescer + magnitude cap entirely. parseResult.groups
       // stays as the raw diff atomics (each is already its own group because
       // Mode B's parseProposedEdits never bundles — bundling only happens in
       // coalesceAdjacentGroups). Hard validation rules (validateEditGroups at
       // line 429) still run and may drop groups that violate
       // EDIT_NEWTEXT_LENGTH_CAP, heading/code-fence/quote rules, or the
       // AGENT_MAX_ATOMIC_EDITS_PER_CYCLE=30 ceiling. No-op here.
     } else {
       // PRODUCTION DEFAULT (current behavior, unchanged):
       const coalesced = coalesceAdjacentGroups(parseResult.groups, current.text);
       const cap = capGroupsByMagnitude(coalesced, current.text, 10);
       parseResult.groups = cap.kept;
       parseResult.dropped = [...parseResult.dropped, ...cap.dropped];
     }
   }
   ```
   **Critical**: The bypass operates on the Mode B post-parse block at line 305, NOT on the `validation.approverGroups` consumer site at line 467 (the consumer reads from `validateEditGroups`'s return value `{approverGroups, droppedPreApprover, sizeExplosion}`, which is structurally a result object, not a bare array). The earlier pseudocode that called `validateEditGroups(parseResult.groups, current.text)` and treated the return as an array was incorrect — `validateEditGroups` returns `ValidateResult`. The bypass cleanly sits BEFORE the unconditional `validateEditGroups` call at line 429, so the result-object contract is unchanged.
4. `evolution/src/lib/core/agents/editing/constants.ts` — no change. `AGENT_MAX_ATOMIC_EDITS_PER_GROUP=5` enforces the per-group atomic cap (vacuous for singletons when bypass is active). `AGENT_MAX_ATOMIC_EDITS_PER_CYCLE=30` enforces the per-cycle ceiling and applies to BOTH arms. `EDIT_NEWTEXT_LENGTH_CAP=500` applies to both arms.
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

*Spy/mock tests* — proving the bypass is mechanical, not behavioral:
- [ ] `IterativeEditingAgent.test.ts` — `vi.spyOn(coalesceAdjacentGroupsModule, 'coalesceAdjacentGroups')` and `vi.spyOn(capGroupsByMagnitudeModule, 'capGroupsByMagnitude')`. Run a Mode B execution with `disableApproverFiltering: true`. Assert BOTH spies received `toHaveBeenCalledTimes(0)`. Same execution with `disableApproverFiltering: false` (or omitted) → both spies called exactly 1× per cycle. This proves the conditional skips, not just substitutes a no-op.

*Regression tests* — proving default behavior is unchanged:
- [ ] `IterativeEditingAgent.test.ts` — snapshot test: an `IterationConfig` with `disableApproverFiltering` UNSET (the production default) produces a byte-identical sequence of `approverGroups` to a frozen snapshot taken before the bypass PR landed. Confirms the feature flag is a true no-op when unset.
- [ ] `IterativeEditingAgent.test.ts` — snapshot test: same `IterationConfig` with `disableApproverFiltering: false` (explicit) produces the same byte-identical `approverGroups`. Confirms explicit-false and unset behave identically.

*Hash tests*:
- [ ] `findOrCreateStrategy.test.ts` — two configs differing only in `disableApproverFiltering` produce different `config_hash`.
- [ ] `findOrCreateStrategy.test.ts` — a config with `disableApproverFiltering: true` AND `agentType: 'generate'` produces the same `config_hash` as the same config without the field (proves `FIELD_GATES` strips it for non-rewrite agents).

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
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-strategy-creation.spec.ts` (or wherever wizard E2E tests live) — case: select `iterative_editing_rewrite` agent type → confirm the disable-approver-filtering checkbox appears; switch to a different agent type → confirm it disappears
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
// CRITICAL: upsertStrategy uses ON CONFLICT (config_hash) DO UPDATE in
// findOrCreateStrategy.ts:230-233. If a strategy with this exact config_hash
// already exists (e.g., a teammate ran a similar experiment yesterday),
// upsertStrategy returns the EXISTING strategy ID without warning. Runs we
// enqueue against that ID become contaminated with that prior strategy's
// history (its prior runs, prior invocations, prior arena variants).
// MITIGATION: reuse-guard the seed script.

async function seedStrategy(name: string, cfg: StrategyConfig, db: DbClient) {
  const existing = await db.query(
    'SELECT id, name, created_at FROM evolution_strategies WHERE config_hash = $1',
    [computeConfigHash(cfg)]
  );
  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    // Refuse silently-reused IDs. Either bump the experiment name to force a new
    // strategy, or pass --reuse-existing to opt in explicitly.
    if (!args.reuseExisting) {
      throw new Error(
        `Strategy config_hash collision: arm "${name}" hashes identically to existing ` +
        `strategy "${row.name}" (id=${row.id}, created ${row.created_at}). ` +
        `Re-using it would contaminate this experiment with the existing strategy's ` +
        `prior runs and arena variants. Pass --reuse-existing if this is intentional, ` +
        `or modify the strategy name/label/config to break the collision.`
      );
    }
    console.warn(`Reusing existing strategy ${row.id} for arm "${name}" (opt-in via --reuse-existing).`);
    return row.id;
  }
  const id = await upsertStrategy(cfg, db);
  return id;
}

const ctlStrategyId = await seedStrategy('AF-Ctrl', controlConfig, db);
const trtStrategyId = await seedStrategy('AF-Off', treatmentConfig, db);
const experiment = await createExperiment('BundleSplit A/B (federal_reserve_2)',
                                           'a546b7e9-f066-403d-9589-f5e0d2c9fa4f', db);
for (let i = 0; i < args.runsPerArm; i++) {
  await addRunToExperiment(experiment.id, { strategy_id: ctlStrategyId, budget_cap_usd: 0.05 }, db);
  await addRunToExperiment(experiment.id, { strategy_id: trtStrategyId, budget_cap_usd: 0.05 }, db);
}
```

**Flags**: `--target {staging|prod}`, `--runs-per-arm N` (default 5), `--apply` (else dry-run prints SQL), `--append` (adds runs to existing experiment instead of creating new), `--reuse-existing` (opt-in to skip the collision guard).

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
curl -X POST https://explainanythingstage.vercel.app/api/evolution/run \
  -b ~/.cache/ea-staging-cookies.txt \
  -H 'content-type: application/json' \
  -d '{"targetRunId": "<one-of-the-pending-run-uuids>"}'
```

(The API route at `src/app/api/evolution/run/route.ts` validates `{targetRunId: z.string().uuid().optional()}` and calls `requireAdmin()` before dispatch — same downstream code path the cron uses, but cookie-gated.)

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
2. **The clean Δ-Elo signal lives in `evolution_arena_comparisons` filtered by experiment**:
   ```sql
   -- "Clean" comparisons: both sides came from THIS experiment, so both are gemini-judged.
   SELECT * FROM evolution_arena_comparisons c
   JOIN evolution_arena_variants v1 ON c.variant_a_id = v1.id
   JOIN evolution_arena_variants v2 ON c.variant_b_id = v2.id
   JOIN evolution_runs r1 ON v1.run_id = r1.id
   JOIN evolution_runs r2 ON v2.run_id = r2.id
   WHERE r1.experiment_id = '<exp_id>' AND r2.experiment_id = '<exp_id>';
   ```
   The analysis report (Stage 2 output) MUST cite this filtered view, not the leaderboard, when computing treatment-vs-control Δ-Elo. Document this in the report's methodology section.
3. **Strategy-ID filter**: another safe filter is `WHERE r.strategy_id IN (<ctl>, <trt>)` to scope to the two experiment arms only — analogous to the `gen_method` label idea but anchored to the actual strategies we created.

### Acceptance criteria

**Confirmed H1** (proceed to a production rollout of the `splitBundlesBeforeApprover: true` default for Mode B):
- Treatment arm improver rate ≥ 25 % AND treatment median Δ-Elo > control median Δ-Elo by ≥ 15 points AND treatment 95 % CI does not cross control 95 % CI on `eloAttrDelta`

**Null H0** (revert the field to permanent `false` or remove):
- Treatment arm improver rate within ±5 points of control AND treatment median Δ-Elo within ±10 of control

**Inconclusive** (run more samples or design follow-up):
- Treatment arm improver rate in 14–24 % range OR Δ-Elo CIs overlap meaningfully

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
- [ ] (Code) Add `disableApproverFiltering?: boolean` field to `IterationConfig` types (`evolution/src/lib/pipeline/types.ts`) — default `false`
- [ ] (Code) Add the same field to `iterationConfigSchema` Zod definition (`evolution/src/lib/schemas.ts`) gated to `agentType === 'iterative_editing_rewrite'`
- [ ] (Code) Add the `FIELD_GATES` entry in `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts:49-70`: `disableApproverFiltering: (t) => t === 'iterative_editing_rewrite'`
- [ ] (Code) Implement the filter-bypass conditional at `IterativeEditingAgent.ts:304-310` — when the flag is true, skip the Mode B post-parse `coalesceAdjacentGroups` + `capGroupsByMagnitude` block entirely; `parseResult.groups` stays as raw diff atomics; `validateEditGroups` at line 429 still runs
- [ ] (UI) Add the disable-filtering checkbox to the strategy wizard's per-iteration row when agent type is `iterative_editing_rewrite` (with helper text explaining behavior + cost impact)
- [ ] (UI) Add `delete updated.disableApproverFiltering` to every non-rewrite agent-switch branch in the wizard's `updateIteration` handler (`src/app/admin/evolution/strategies/new/page.tsx` lines ~648, 681, 713)
- [ ] (Tests) Behavior unit tests for the bypass + standard path (8-atomic case, 30-atomic case, hard-rule violation case)
- [ ] (Tests) Spy/mock tests proving `coalesceAdjacentGroups` and `capGroupsByMagnitude` receive zero calls in bypass mode (vi.spyOn pattern)
- [ ] (Tests) Default-false regression test — snapshot of `approverGroups` for an unset-field config must match the pre-PR baseline byte-for-byte
- [ ] (Tests) Explicit-false snapshot test — `disableApproverFiltering: false` produces the same `approverGroups` as the unset case
- [ ] (Tests) Integration test exercising the bypass end-to-end
- [ ] (Tests) Strategy wizard E2E test for the new checkbox (appears for Mode B, hidden for other agents, persists to config, cleared on agent switch)
- [ ] (Tests) `findOrCreateStrategy` `config_hash` uniqueness test — two `iterative_editing_rewrite` configs differing only in the new field hash differently
- [ ] (Tests) `findOrCreateStrategy` `FIELD_GATES`-strip test — `disableApproverFiltering: true` on a `generate` agent hashes identically to the same config without the field
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
- [ ] (SQL gate) Run `npx tsx evolution/scripts/verifyBundleSplitStage1.ts <experimentId>` — must exit 0 before proceeding
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
