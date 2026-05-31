# Analyze Effectiveness Paragraph Recombine Research

## Problem Statement
Analyze the effectiveness of `paragraph_recombine` invocations during evolution run `88b5e860-1690-41c4-9128-2c1fb85d5297` by querying Supabase staging. The output should characterize whether the per-slot rewrite + recombine pipeline produced meaningful quality improvements (Elo lift, surviving variants, slot win-rate) and how its cost / drop-rate / projector accuracy compared to expectations.

## Requirements (from GH Issue #NNN)
analyze the effective of paragraph recombien invocations during run 88b5e860-1690-41c4-9128-2c1fb85d5297 by querying Supabase staging

## High Level Summary

**Full findings in [`findings.md`](./findings.md).** Headline:

For run `88b5e860-1690-41c4-9128-2c1fb85d5297` (the agent's first-ever staging run, multi-dispatch K=5, gemini-2.5-flash-lite + qwen-2.5-7b-instruct):

- **Article-level effectiveness is negative**: median Elo delta vs parent = -49.3, match record 1W-7L-7D, `eloAttrDelta:paragraph_recombine:paragraph_recombine = -3.08 ± 4.4`. Only 1 of 5 recombined variants beat its parent.
- **Rewrite drop rate is way over target**: 47.5% aggregate vs 5-15% goal; index-0 = 44.7% vs <30% post-I3a/I3b goal. The "tighten" directive at temp 0.7 is overshooting (ratios 0.62-0.80) despite the hard char-count prompt fix.
- **Per-slot signal is weak**: rewrites win 23 / originals win 18 / draws 33 out of 74 pairs (44% draw rate). The Option B1 paragraph-mode rubric helped vs documented pre-B1 ~98% draws but is still high.
- **Persistence is healthy**: 121/121 variants persisted, migration `20260529000001` delivering, no `paragraph_slot_match_persist_failures`. The `investigate_paragraph_recombine_invocation_20260529` symptoms are resolved.
- **Cost contracts honored**: `paragraph_recombine_cost` metric = $0.0198 (correct per `writeMetricMax` MAX-write of run-cumulative phase sums). $0.0034 (~15%) of paragraph_recombine LLM spend lands under non-`paragraph_rewrite`/`paragraph_rank` labels — small accounting hole worth tracing.
- **Estimator badly off**: `paragraph_rewrite_estimation_error_pct = +183.9%` (actual ~3× projector).
- **D10 cross-invocation accumulation not measurable** — topology artifact (all 5 parents fresh, no prior staging touch on this prompt).
- **No baseline run exists** to disentangle "multi-dispatch artifact" from "intrinsic agent behavior". Multi-dispatch (Option J) shipped 2026-05-30; this is its debut.
- **Cleared false alarms**: 100% `winner='a'` is a persistence-layer convention (`entry_a := winnerId`), not judge position bias. Reversal IS running.
- **Code oversight discovered**: `sentence_verbatim_ratio` is NULL on paragraph_recombine variants because `ParagraphRecombineAgent.ts:325-334` doesn't call `sentenceVerbatimOverlap`. One-line fix mirroring GFPA pattern.
- **Wizard projector bug** (new in `/research` round 5, see [Projector Preview Bug](#projector-preview-bug) below). `projectDispatchPlan.ts` paragraph_recombine branch never reads `qualityCutoff` or `sourceMode`, so the wizard dispatch preview always shows **1** for paragraph_recombine even when the iter config has `maxDispatches=10` + `qualityCutoff: topN:5`. Runtime correctly dispatches K — the wizard preview lies. Reproduced visually on stage (`https://explainanythingstage.vercel.app/admin/evolution/strategies/new` → screenshots at `.playwright-mcp/dispatch-preview-bug-*.png`).

Recommended follow-ups (top 3): **fix the projector preview bug** (this PR — see plan); run a `maxDispatches=1` baseline; investigate index-0 length_under (model/temp/prompt).

## Projector Preview Bug

User-reported: "UI always shows only one invocation will be dispatched, even though way more than that ran."

### Reproduction (stage)

Wizard at `/admin/evolution/strategies/new`, iter config matching the staging run's strategy `ce9799fa-…`:

| Knob | Wizard value | UI control |
|---|---|---|
| Generation Model | Gemini 2.5 Flash Lite | combobox |
| Judge Model | Qwen 2.5 7B Instruct | combobox |
| Budget | $0.05 | spinbutton |
| Iter 1 | `generate` 40% sourceMode=seed | row |
| Iter 2 | `paragraph_recombine` 60% | row |
| Iter 2 sourceMode | `pool` ("This run's top variants") | combobox |
| Iter 2 qualityCutoff | `topN: 5` | "Take top 5 variants" |
| Iter 2 maxDispatches | **10** | spinbutton |
| Iter 2 rewritesPerParagraph | 3 (default) | spinbutton |
| Iter 2 maxComparisonsPerParagraph | 8 (default) | spinbutton |
| Iter 2 maxParagraphsPerInvocation | 12 (default) | spinbutton |
| Iter 2 perInvocationCapUsd | $0.05 (default) | spinbutton |

**Wizard projector output** (screenshot `.playwright-mcp/dispatch-preview-bug-table-only.png`):

| Iter | Type | Iter Budget | **Dispatch** | **Likely total (with top-up)** |
|---|---|---|---|---|
| 1 | GENERATE | $0.0200 | 4 | 10 (4 parallel + 6 top-up) |
| **2** | **PARAGRAPH_RECOMBINE** | **$0.0300** | **1** | **1** |

Iter 1 generate correctly computes multi-dispatch (4 parallel + 6 top-up = 10). Iter 2 paragraph_recombine collapses to 1 regardless of the multi-dispatch knobs.

**Runtime reality** (run `88b5e860-…`, same iter config):
- Iter 1 generate: 14 GFPA invocations
- **Iter 2 paragraph_recombine: 5 invocations** (`min(SAFETY_CAP=100, parallelAffordable, maxDispatches=10, eligibleParents=5) = 5`; capped by `qualityCutoff.value=5`)

So the projector says **1**, the runtime ran **5**. The user was right.

### Code root cause

`evolution/src/lib/pipeline/loop/projectDispatchPlan.ts`:

- **Line 481** — reads `iterCfg.maxDispatches ?? 1` into `maxDispatchesK`. ✅ knob read.
- **Line 525** — `const parallelN = Math.min(DISPATCH_SAFETY_CAP, parallelAffordable, maxDispatchesK, poolSize);`. ❌ uses `poolSize` (full in-run pool) as the eligibility ceiling.

The function never reads `iterCfg.qualityCutoff`. It never branches on `iterCfg.sourceMode`. There is no equivalent of the `resolveEditingDispatchPlanner` helper that the editing branch uses to derive `eligibleCount` from a cutoff.

The runtime, on the other hand, applies `qualityCutoff` at `runIterationLoop.ts:1303-1318` to filter `inRunPool → eligibleParents` BEFORE computing dispatch count, then ceilings dispatch by `eligibleParents.length`. With `qualityCutoff.value=5` and `poolSize=14`, eligibleParents=5. Hence the 1-vs-5 mismatch.

For this strategy with $0.03 iter budget and projector `expected ≈ $0.029` per agent: `parallelAffordable = floor(0.03 / 0.029) = 1`, so the projector returns `min(100, 1, 10, 14) = 1`. The fix's correct value: `min(100, parallelAffordable, 10, eligibleCount=5)`. With budget the binding constraint, even after the fix the projector would show 1 — BUT once the user widens iter budget (e.g. raises Iter 2 to 80% of a larger budget), the projector would surface up to 5 instead of capping at 14.

### Documentation evidence

This bug was already specified for resolution but never landed:

- `evolution/docs/paragraph_recombine.md` Multi-dispatch section: *"Eligible parent set: filter the in-run pool via the existing `qualityCutoff` (eligibility, NOT dispatch count)."*
- `docs/planning/investigate_paragraph_rewrite_cost_undershoot_evolution_20260529/`, Phase 7a, line item K1: *"Extend `projectDispatchPlan.ts:458-507` paragraph_recombine branch to compute `dispatchCount` via the same `parallelFloor` + `sequentialFloor` math used for generate iterations in the PROJECTOR. ... Inputs: iteration budget, projector `expected`/`upperBound`, **`qualityCutoff` to size eligible set**, `maxDispatches` as upper bound."*

The runtime side of K1 landed (`runIterationLoop.ts:1303-1318`). The projector side did not.

### Test coverage gap

- `evolution/src/components/evolution/DispatchPlanView.test.tsx` — renders only.
- `evolution/src/lib/pipeline/loop/projectDispatchPlan.test.ts` — has paragraph_recombine cases for SINGLE-dispatch (`maxDispatches=1` default) only. No multi-dispatch cases.

### Visual artifacts (committed to repo)

- `.playwright-mcp/dispatch-preview-bug-table-only.png` — focused screenshot of the dispatch preview table.
- `.playwright-mcp/dispatch-preview-bug-pr-shows-1-with-K10-pool.png` — full-page screenshot of the strategy creation wizard.

Likely query surfaces (per `evolution/docs/paragraph_recombine.md` + `metrics.md` + `data_model.md`):

- **Per-invocation rows** — `evolution_agent_invocations WHERE run_id = '88b5e860-…' AND agent_name = 'paragraph_recombine'`. Pull `cost_usd`, `duration_ms`, `success`, `execution_detail` (estimatedTotalCost, estimationErrorPct, slots[*].rewrites[*].{status,dropReason,temperature,costUsd}, slots[*].ranking.{comparisonCount,cost,status,winnerSlotVariantId}, paragraph_rewrite/paragraph_rank phase breakdowns).
- **Recombined variant outcomes** — `evolution_variants WHERE run_id = ... AND variant_kind = 'article' AND agent_name = 'paragraph_recombine'`. Compare `elo_score` / `mu` / `sigma` / `arena_match_count` / `is_winner` vs in-run peers.
- **Per-slot Elo accumulation** — `evolution_variants v JOIN evolution_prompts p ON p.id = v.prompt_id WHERE v.variant_kind = 'paragraph' AND p.prompt_kind = 'paragraph' AND p.prompt LIKE '[para] V<parent8>%'`. Verify `arena_match_count > 0` + `parent_variant_ids` non-empty (post-`20260529000001`).
- **Run-level cost metrics** — `evolution_metrics WHERE entity_type='run' AND entity_id = '88b5e860-…' AND metric_name IN ('paragraph_recombine_cost','cost','cost_estimation_error_pct','estimated_cost','paragraph_rewrite_estimation_error_pct','paragraph_rank_estimation_error_pct','paragraph_slot_match_persist_failures')`.
- **Match rows** — `evolution_arena_comparisons WHERE run_id = '88b5e860-…'` (article-level) and `WHERE prompt_id IN (slot topic ids)` (per-slot).
- **Logs** — `evolution_logs WHERE run_id = '88b5e860-…' AND (level IN ('warn','error') OR message ILIKE '%paragraph%' OR message ILIKE '%length_under%' OR message ILIKE '%topic_arena_growth_warn%')`.

Effectiveness dimensions to evaluate (per `paragraph_recombine.md` "Failure modes" + I3a/I3b/J context):
1. **Drop rate** — fraction of rewrites validated vs dropped, broken down by `dropReason` and rewrite index. Target post-I3: index-0 < 30%, aggregate 5–15%.
2. **Per-slot quality lift** — for each slot's `winnerSlotVariantId`, did it come from this invocation (`winnerSource: 'this_invocation'`) or fall back to original / a prior invocation's rewrite?
3. **Article-level Elo lift** — recombined variant Elo vs parent Elo (`parent_variant_ids[0]` lookup) and vs run pool median/max.
4. **Cost envelope** — actual vs projector (`estimationErrorPct`), vs the new $0.05 per-invocation cap (post-F1 lowered from $0.40). Per-rewrite cost breakdown.
5. **Multi-dispatch effectiveness (if applicable)** — was `maxDispatches > 1` used? If so, were all K dispatches distinct-parent? Top-up loop behavior?
6. **Persistence health** — `paragraph_slot_match_persist_failures > 0`? `parent_variant_ids` populated on slot variant rows (only true if run post-dates migration `20260529000001`)?

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (read at init)
- docs/docs_overall/environments.md
- docs/docs_overall/testing_overview.md
- docs/docs_overall/debugging.md
- docs/feature_deep_dives/testing_setup.md
- evolution/docs/paragraph_recombine.md
- evolution/docs/architecture.md
- evolution/docs/data_model.md
- evolution/docs/arena.md
- evolution/docs/agents/overview.md
- evolution/docs/cost_optimization.md
- evolution/docs/metrics.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/reference.md (partial — file is large; read first ~520 lines)
- evolution/docs/entities.md

## Code Files Read
_(to be populated during /research — likely `evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.ts`, `evolution/src/lib/pipeline/loop/runIterationLoop.ts` (paragraph_recombine branch), `evolution/src/services/slotTopicActions.ts`)_

## Open questions for /research

1. **Run vintage** — was run `88b5e860-…` triggered before or after migration `20260529000001`? That determines whether slot variant rows carry `parent_variant_ids` + `match_count` (and thus whether the "Seed · no parent" / "Matches=0" symptoms apply to this run).
2. **Strategy config used** — `evolution_runs.strategy_id` → `evolution_strategies.config` to read `iterationConfigs[]` and confirm `agentType='paragraph_recombine'`, `maxDispatches`, `perInvocationCapUsd`, `sourceMode`/`qualityCutoff`.
3. **Single vs multi-dispatch** — `maxDispatches` value in the iter config dictates which projector path was used (single vs J runtime). Affects how to read invocation rows.
4. **Number of invocations** — single-iteration strategy = 1 invocation; multi-dispatch = K invocations per iteration. Filter `evolution_agent_invocations` accordingly.
5. **Did the recombined variants win the run?** — `evolution_variants.is_winner` flag set at finalization.
