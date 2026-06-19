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

### Experiment design — staged (smoke first, then scale)

The plan stages the experiment into a **5/arm smoke** ($0.40 expected) followed by a conditional **scale-up to 30/arm** only if the smoke confirms (a) the code works end-to-end and (b) the standard admin UI renders treatment-arm invocations correctly.

**A/B arms** dispatched in a single `evolution_experiments` row against the same prompt and parent population:

| Arm | Strategy name | Behavior |
|---|---|---|
| **A — Control** | `ApproverFilter Control` | Current Mode B. After diff: `coalesceAdjacentGroups` bundles adjacent same-kind atomics → `validateEditGroups` → `capGroupsByMagnitude` (top-K=10 by group magnitude) → approver. |
| **B — Treatment** | `ApproverFilter Off` | Same as Control, but `disableApproverFiltering: true` on the editing iterations. After diff: skip coalescer AND skip magnitude cap. Only `validateEditGroups` (hard rules: no heading mods, no quote edits, code-fence guards) runs. Every surviving diff atomic becomes its own singleton group and reaches the approver. |

Both arms identical otherwise. The settings mirror the **most-recent production Mode B strategy** that ran on this prompt — `"Iterative editing - whole article"` (`evolution_strategies.id = 4900ff14-a11f-4653-9854-85af3cd1480c`, last used 2026-05-12, the strategy that produced the historical variants we analyzed). The only deviations from that strategy are (a) switching `judgeModel` to `gemini-2.5-flash-lite` per the all-gemini directive, and (b) adding `disableApproverFiltering: true` on the editing iterations in the Treatment arm.

- `generationModel: google/gemini-2.5-flash-lite` (matches historical)
- `judgeModel: google/gemini-2.5-flash-lite` (switched from historical `qwen-2.5-7b-instruct`)
- `editingModel` and `approverModel` unset → fall back to `generationModel` = `gemini-2.5-flash-lite` (matches historical)
- `budgetUsd: 0.05` (matches historical)
- `generationTemperature: 1.0` (matches historical)
- `maxComparisonsPerVariant: 3` (matches historical)
- `minBudgetAfterParallelAgentMultiple: 1` (matches historical)
- `iterationConfigs`: 3 iterations — `[generate seed 34 %, iterative_editing_rewrite 33 %, iterative_editing_rewrite 33 %]` (matches historical exactly)
- `editingEligibilityCutoff`: not set on the editing iterations → defaults to `{mode: 'topN', value: 10}` at consumption time (matches historical — `iterative_editing_rewrite` uses `editingEligibilityCutoff`, NOT `sourceMode`/`qualityCutoff`, which apply only to `generate`/`reflect`/`criteria` agents)
- `prompt_id: a546b7e9-f066-403d-9589-f5e0d2c9fa4f` (federal_reserve_2)

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

**Code touch points**:
1. `evolution/src/lib/pipeline/types.ts` — add `disableApproverFiltering?: boolean` to `IterationConfig` interface. Default `false`.
2. `evolution/src/lib/schemas.ts` — add the same field to `iterationConfigSchema` Zod definition; valid only when `agentType ∈ {'iterative_editing', 'iterative_editing_rewrite'}`.
3. `evolution/src/lib/core/agents/editing/IterativeEditingAgent.ts` — in `execute()`, replace the current Mode B post-diff pipeline with a conditional:
   ```typescript
   // Before this change, the pipeline was unconditionally:
   //   parsed → (Mode B: coalesce) → validate → capByMagnitude → approver
   // After this change, when disableApproverFiltering is true on Mode B:
   //   parsed → validate → approver  (no coalesce, no cap)
   
   const baseGroups = isRewriteMode
     ? coalesceAdjacentGroups(parseResult.groups, current.text)
     : parseResult.groups;
   const validated = validateEditGroups(baseGroups, current.text);
   
   if (input.config?.disableApproverFiltering) {
     // Skip coalescer and magnitude cap. Approver gets every diff atomic
     // as its own singleton group. Hard validation rules (no heading mods,
     // no quote edits, code-fence guards, max-atomic-per-group cap) still
     // apply via validateEditGroups. EDIT_NEWTEXT_LENGTH_CAP still applies.
     // For Mode B, also use the uncoalesced parser output to ensure every
     // atomic is reviewed individually.
     groups = isRewriteMode
       ? validateEditGroups(parseResult.groups, current.text)
       : validated;
   } else {
     // Current production behavior (unchanged).
     groups = capGroupsByMagnitude(validated, current.text);
   }
   ```
4. `evolution/src/lib/core/agents/editing/constants.ts` — no change. `AGENT_MAX_ATOMIC_EDITS_PER_GROUP=5` still enforces the per-group atomic cap, but when filtering is disabled and every group is a singleton, it's vacuously satisfied.
5. `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts` — confirm the new field participates in `config_hash` so Control and Treatment strategies don't collide.

**Behavior reminder — what's preserved**:
- `validateEditGroups` still runs: heading-cross, quote-modification, code-fence, list-boundary, paragraph-break, `EDIT_NEWTEXT_LENGTH_CAP=500` chars, `AGENT_MAX_ATOMIC_EDITS_PER_GROUP=5` (vacuous for singletons), redundancy guardrails, flow guardrails (if enabled). These are quality gates, not approver-attention guards — they stay.
- The approver's system prompt, output contract (JSONL per group), and per-group accept/reject semantics are unchanged.
- The size-ratio guardrail (≤ 1.5× article growth) inside the approver/applier path is unchanged.
- All Mode A behavior is unchanged. The new field only triggers on `iterative_editing_rewrite`.

**Tests** to add in the same PR (unit + integration):
- [ ] `IterativeEditingAgent.test.ts` — case: input rewrite produces 8 diff atomics split into 1 multi-atomic group (4 atomics) + 4 singletons. With `disableApproverFiltering: false`, approver receives a list of 5 groups (1 multi, 4 single). With `true`, approver receives 8 singleton groups. GroupNumbers are unique. Atomic-edit contents match across both paths.
- [ ] `IterativeEditingAgent.test.ts` — case: high-atomic-count rewrite (~30 atomics). With `disableApproverFiltering: false` + `capGroupsByMagnitude(K=10)`, approver sees ≤ 10 groups. With `true`, approver sees ~30 singleton groups.
- [ ] `IterativeEditingAgent.test.ts` — case: an atomic edit that violates a hard rule (e.g., modifies a heading line) is filtered by `validateEditGroups` in both modes.
- [ ] `findOrCreateStrategy.test.ts` — two configs differing only in `disableApproverFiltering` produce different `config_hash`.
- [ ] One integration test in `evolution-iterative-editing-agent.integration.test.ts` exercising the disable-filtering path end-to-end on a minimal fixture; verify `proposedGroupsRaw.length` ≈ N atomic edits and `reviewDecisions.length` = `proposedGroupsRaw.length` (every group gets a decision).

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
  (gen_random_uuid(), 'ApproverFilter Control', 'AF-Ctrl', 'active',
   '{ "generationModel": "google/gemini-2.5-flash-lite",
      "judgeModel": "google/gemini-2.5-flash-lite",
      "budgetUsd": 0.05,
      "generationTemperature": 1,
      "maxComparisonsPerVariant": 3,
      "minBudgetAfterParallelAgentMultiple": 1,
      "iterationConfigs": [
        {"agentType": "generate", "sourceMode": "seed", "budgetPercent": 34},
        {"agentType": "iterative_editing_rewrite", "budgetPercent": 33},
        {"agentType": "iterative_editing_rewrite", "budgetPercent": 33}
      ]
    }'::jsonb,
   /* config_hash computed by upsertStrategy at INSERT time, OR seed via app */
   NULL, 'experiment_runner', false),

  (gen_random_uuid(), 'ApproverFilter Off', 'AF-Off', 'active',
   '{ "generationModel": "google/gemini-2.5-flash-lite",
      "judgeModel": "google/gemini-2.5-flash-lite",
      "budgetUsd": 0.05,
      "generationTemperature": 1,
      "maxComparisonsPerVariant": 3,
      "minBudgetAfterParallelAgentMultiple": 1,
      "iterationConfigs": [
        {"agentType": "generate", "sourceMode": "seed", "budgetPercent": 34},
        {"agentType": "iterative_editing_rewrite", "disableApproverFiltering": true, "budgetPercent": 33},
        {"agentType": "iterative_editing_rewrite", "disableApproverFiltering": true, "budgetPercent": 33}
      ]
    }'::jsonb,
   NULL, 'experiment_runner', false);
```

Because the app computes `config_hash`, the cleanest path is a small one-shot TypeScript helper script:

```bash
npx tsx evolution/scripts/seedBundleSplitExperiment.ts --target staging
```

which calls `findOrCreateStrategy.upsertStrategy(config, db)` for each arm (this handles `config_hash` computation + uniqueness correctly) and then creates the experiment + enqueues runs.

**Step 2 — Create the experiment and enqueue runs** (same script):

```typescript
// evolution/scripts/seedBundleSplitExperiment.ts (sketch)
const ctlStrategyId = await upsertStrategy(controlConfig, db);
const trtStrategyId = await upsertStrategy(treatmentConfig, db);
const experiment = await createExperiment('BundleSplit A/B (federal_reserve_2)',
                                           'a546b7e9-f066-403d-9589-f5e0d2c9fa4f', db);
for (let i = 0; i < 30; i++) {
  await addRunToExperiment(experiment.id, { strategy_id: ctlStrategyId, budget_cap_usd: 0.05 }, db);
  await addRunToExperiment(experiment.id, { strategy_id: trtStrategyId, budget_cap_usd: 0.05 }, db);
}
```

**Step 3 — Run the queue from the CLI** (the standard batch runner used by the minicomputer cron):

```bash
npx tsx evolution/scripts/processRunQueue.ts \
  --parallel 3 \
  --max-runs 60 \
  --max-concurrent-llm 20
```

Or, if a single run needs to be smoke-tested first:

```bash
curl -X POST https://ea-evolution.vercel.app/api/evolution/run \
  -H "Authorization: Bearer $ADMIN_BEARER" \
  -d '{"runId": "<one-of-the-pending-run-uuids>"}'
```

(The API route at `src/app/api/evolution/run/route.ts` accepts `{runId}` body and calls `claimAndExecuteRun` with that target — same code path the cron uses.)

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

Treatment arm cost breakdown for the additional approver work:
- Control: ~10 groups, ~80 tokens/group header × 10 input = 800 tokens input + ~10 JSONL lines × ~40 tokens = 400 tokens output → ~$0.0002 input + $0.0002 output = **$0.0004** per editing-cycle approver call
- Treatment: ~30 groups, same per-group rendering = 2,400 tokens input + 1,200 tokens output → ~$0.0002 input + $0.0005 output = **$0.0007** per editing-cycle approver call
- Difference per call: +$0.0003; 2 editing iterations per run → +$0.0006 per run; the run-level cost moves from $0.038 → $0.039

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
- [ ] (Code) Add `disableApproverFiltering` field to `IterationConfig` types + Zod schema (default `false`)
- [ ] (Code) Implement the filter-bypass conditional in `IterativeEditingAgent.execute()` — skips both `coalesceAdjacentGroups` and `capGroupsByMagnitude` when the flag is true
- [ ] (UI) Add the disable-filtering checkbox to the strategy wizard's per-iteration row when agent type is `iterative_editing_rewrite` (with helper text explaining behavior + cost impact)
- [ ] (Tests) Unit tests for the bypass + standard path
- [ ] (Tests) Integration test exercising the bypass end-to-end
- [ ] (Tests) Strategy wizard E2E test for the new checkbox (appears for Mode B, hidden for other agents, persists to config)
- [ ] (Tests) `findOrCreateStrategy` `config_hash` uniqueness test (two configs differing only in the new field hash differently)
- [ ] (PR) Land the code change + UI as a feature-flagged no-op

**Stage 1 — smoke (10 runs, $0.40, ~10 min wall clock at `--parallel 3`)**:
- [ ] (Script) Write `evolution/scripts/seedBundleSplitExperiment.ts` (idempotent, dry-run by default, `--apply` to write, `--runs-per-arm 5` flag)
- [ ] (Setup) Run `npx tsx evolution/scripts/seedBundleSplitExperiment.ts --target staging --runs-per-arm 5 --apply` to create both strategies + experiment + 10 pending runs
- [ ] (Single-run smoke) Trigger 1 control + 1 treatment run via `/api/evolution/run` API; wait for both to complete
- [ ] (UI verify — single run) On staging admin UI:
  - Open one control invocation's Edit Cycle tab — confirms baseline rendering
  - Open one treatment invocation's Edit Cycle tab — confirms split groups render as N rows
  - Open the experiment page — confirms both arms appear
  - Open the variant detail Diff-vs-parent tab on a treatment-arm variant — confirms standard rendering
  - Open the arena leaderboard `/admin/evolution/arena/a546b7e9-...` — confirms variants synced
- [ ] (Batch) Run `processRunQueue.ts --parallel 3 --max-runs 8` to complete the remaining 8 runs
- [ ] (Stage 1 checklist) Walk through all 6 acceptance checks (see "Stage 1 acceptance checks" above)

**Stage 2 — scale (conditional, 50 additional runs, $2.00, ~45 min)**:
- [ ] (Decision gate) Confirm Stage 1 passed all 6 checks. If not, stop and remediate.
- [ ] (Enqueue) Re-run the seed script: `npx tsx evolution/scripts/seedBundleSplitExperiment.ts --target staging --runs-per-arm 25 --append --apply` (`--append` adds 25 more to each arm of the EXISTING experiment, doesn't create a new one)
- [ ] (Batch) Run `processRunQueue.ts --parallel 3 --max-runs 50`
- [ ] (Analysis) Open `/admin/evolution/experiments/[id]` — pull per-arm aggregates
- [ ] (Report) Append findings to `_research.md` and promote to a new `docs/analysis/bundle-split-ab-federal-reserve-2-<date>/`
- [ ] (Decision) If H1 confirmed, file follow-up PR flipping default to `disableApproverFiltering: true` for `iterative_editing_rewrite`

## Review & Discussion
*(populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration)*
