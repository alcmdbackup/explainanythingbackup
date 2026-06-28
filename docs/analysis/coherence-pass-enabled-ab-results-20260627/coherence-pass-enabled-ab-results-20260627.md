# CoherencePassEnabled A/B Results — 2026-06-27

## Header
- **Analysis name:** coherence-pass-enabled-ab-results-20260627
- **Project:** [docs/planning/rebuild_coherence_pass_agent_mode_ab_configurable_20260624/](../../planning/rebuild_coherence_pass_agent_mode_ab_configurable_20260624/)
- **Branch:** chore/run_coherence_pass_mode_ab_staging_20260626
- **PR:** [#1295](https://github.com/Minddojo/explainanything/pull/1295)
- **Date:** 2026-06-27
- **Source research doc:** [`rebuild_coherence_pass_agent_mode_ab_configurable_20260624_research.md`](../../planning/rebuild_coherence_pass_agent_mode_ab_configurable_20260624/rebuild_coherence_pass_agent_mode_ab_configurable_20260624_research.md)
- **Prior A/Bs in this lineage:**
  - [`coherence-pass-perf-ab-results-20260624`](../coherence-pass-perf-ab-results-20260624/coherence-pass-perf-ab-results-20260624.md) (Phase 7 of the prior project — diagnosed Mode A/B mismatch)
  - CoherencePassMode A/B (v1 + v2) — see ad-hoc analysis in [PR #1295 thread](https://github.com/Minddojo/explainanything/pull/1295)

## Question

After PR #1292 made the coherence pass's editing mode configurable (Mode A / Mode B) and defaulted to Mode B, the open question was: **does Phase C (the coherence pass) actually add value on top of Phase A + B (per-slot rewrites + slot ranking + recombine)?**

Prior observational evidence (matched models, last 30 days, n=23 vs n=46 on `federal_reserve_2`) suggested the coherence pass costs **~67 Elo** vs the `paragraph_recombine` agent. But that comparison had a methodological confound: the two AGENTS differ in more than Phase C — they also differ in Phase A + B implementation (budget allocation, slot ranking, slot selection logic). The observed −67 Elo could be:

- Phase C is genuinely degrading the article
- Phase A + B implementation differs between the agents
- Or some mix of both

This experiment isolates Phase C by running the *same agent* (`paragraph_recombine_with_coherence_pass`) with `coherencePassEnabled` toggled — so Phase A + B are byte-identical between the arms, and only Phase C differs.

## Methodology

**Seed script:** [`evolution/scripts/experiments/seedCoherencePassEnabledExperiment_20260627.ts`](../../../evolution/scripts/experiments/seedCoherencePassEnabledExperiment_20260627.ts).

**Invocation:**
```bash
npx tsx evolution/scripts/experiments/seedCoherencePassEnabledExperiment_20260627.ts \
  --target staging \
  --runs-per-arm 8 \
  --apply --reuse-existing
```

The script follows the production seeding pattern (`upsertStrategy + createExperiment + addRunToExperiment`). LLM calls route through `createEvolutionLLMClient → recordSpend` so per-call cost lands in `llmCallTracking` and per-invocation cost in `evolution_agent_invocations.cost_usd`. Cost tracking is production-grade.

**Arms (both use the same `paragraph_recombine_with_coherence_pass` agent):**

| Arm | strategy_id | `coherencePassEnabled` | `perInvocationCapUsd` |
|---|---|---|---|
| **Control (CP-Off)** | `0cd27136-b14a-408a-b7f6-635983c66bb6` | **`false`** (Phase C skipped) | `0.10` (pinned explicitly) |
| **Treatment (CP-On)** | `fe314a1e-4894-4765-9162-8bf51c827dbc` (re-used) | (default `true` → Phase C runs) | `0.10` (canonicalize fold) |

CP-Off's `perInvocationCapUsd` is **pinned explicitly to $0.10** because the agent's canonicalize would otherwise fold it to $0.05 when `coherencePassEnabled=false` (since the agent expects no Phase C spend). Without this pin, the control would run at half the Phase A + B budget — a real confound.

Treatment is a verbatim re-use of the existing staging strategy `fe314a1e-…` ("Strategy 7a494f (lite, 2it)") that has been running coherence-pass A/Bs since 2026-06-24. config_hash matches its existing row → `--reuse-existing` picks it up without creating a duplicate.

**Other shared config:** generation+judge model `google/gemini-2.5-flash-lite`, `budgetUsd=0.10/run`, `maxComparisonsPerVariant=3`, prompt `federal_reserve_2` (`a546b7e9-…`), iteration plan `[generate seed 30%, paragraph_recombine_with_coherence_pass pool 70% with maxDispatches=5, qualityCutoff topN=3, rewritesPerParagraph=5, maxComparisonsPerParagraph=8, maxParagraphsPerInvocation=12, coherencePassLengthCapRatio=1.10, coherencePassMaxCycles=2]`.

**Experiment row:** `evolution_experiments.id = 7ecb398a-7a43-4d1e-9015-22a01dbda05a` ("CoherencePassEnabled A/B (federal_reserve_2)").

**Run completion:** 16 runs queued (8/arm). **All 16 completed** (no failed/stale runs). After multi-dispatch filtering (see methodology note below), analyzed sample = **8 first-dispatch variants per arm**.

## Methodology note — multi-dispatch asymmetry

The strategies allow `maxDispatches: 5` per iteration. The dispatch gate fires another dispatch when budget remains for it. Because Phase C eats budget, the gate's behavior differed between arms:

| Arm | Runs | Total invocations | Multi-dispatch runs |
|---|---|---|---|
| CP-Off | 8 | 10 | 2 (2 dispatches each) |
| CP-On | 8 | 8 | 0 |

CP-Off effectively got more rolls of the dice per run, which would inflate its surfaced-variant count. **All analyses below use the FIRST-dispatch variant per run** (`DISTINCT ON (run_id) ORDER BY execution_order ASC`) to control for this. The 2 extra CP-Off variants and the 1 CP-Off variant that didn't surface to arena (`variant_surfaced=false`) are excluded.

## Key Findings

### 1. Verdict: **NEUTRAL** — Phase C is statistically indistinguishable from no-Phase-C at n=8/arm

The point estimates for mean delta and median delta are within 2 Elo. Mann-Whitney one-sided p ≈ 0.44–0.56 (clearly null in either direction). The "coherence pass costs ~67 Elo" observational finding does **not** replicate when Phase A + B are held constant.

| Metric | CP-Off (n=8, first-dispatch) | CP-On (n=8) | Diff |
|---|---|---|---|
| Mean child Elo | 1206.4 | 1191.3 | +15.1 in CP-Off |
| Mean parent Elo | 1259.5 | 1244.7 | +14.8 in CP-Off |
| **Mean Δ (child − parent)** | **−53.1** | **−53.4** | **+0.3** (essentially zero) |
| Median Δ | −50.3 | −48.5 | +1.8 |
| Mann-Whitney one-sided p (CP-On Δ > CP-Off Δ) | — | — | **≈ 0.56** |

The child-Elo +15 difference is **fully explained** by the parent-Elo +15 difference — CP-Off happened to draw higher-quality parents at this sample size. No measurable Phase C effect on the child's absolute or relative Elo.

### 2. Cost per variant

| Arm | Total spend / 8 runs | Variants surfaced | Cost per variant |
|---|---|---|---|
| CP-Off | $0.599 | 9 (includes the 2 multi-dispatch extras + 1 unsurfaced) | $0.067 |
| CP-On | $0.556 | 8 | $0.070 |

Per-invocation, CP-On costs 11% more ($0.0411 vs $0.0370). But CP-Off uses the saved Phase-C budget to fund extra dispatches, so per-run CP-Off is actually slightly more expensive ($0.075 vs $0.070). Per-variant the gap shrinks to **+5%** for CP-On.

### 3. Per-bucket — small-sample noise

| Parent Elo bucket | CP-Off (n, mean Δ) | CP-On (n, mean Δ) |
|---|---|---|
| High (≥1270) | n=4, Δ = −70.3 | n=2, Δ = −75.4 |
| Mid (1240–1270) | n=1, Δ = −87.4 | n=1, Δ = −44.0 |
| Low (<1240) | n=3, Δ = −18.7 | n=5, Δ = −46.5 |

Per-bucket sub-samples are tiny (n=1–5). Signal is mixed and dominated by single-outlier swings of ±40 Elo. No consistent direction.

### 4. Both arms show the same "regression to ~1180 floor"

Independent of arm or parent Elo, child Elo lands at 1140–1234. The under-measurement explanation (`maxComparisonsPerVariant=3` — too few games for TrueSkill to escape the prior) holds for both arms. Phase C neither rescues nor exacerbates this floor.

## Deep Dive — what overturned my prior analysis

I had previously argued (in ad-hoc PR #1295 thread analysis):

1. **"The coherence pass costs ~67 Elo on top of recombine"** — based on `paragraph_recombine` (Elo 1242, n=23) vs `paragraph_recombine_with_coherence_pass` (Elo 1175, n=46) over the same prompt + matched models + last 30 days.
2. **"Mode B introduces voice-flattening edits"** — based on inspecting individual Mode B atomic edits.

The controlled experiment overturns #1 partly and weakens #2:

### What overturned #1

The +67 Elo gap between the two AGENTS was real, but was NOT entirely the coherence pass's fault. When the same agent runs with Phase C disabled (this experiment's Control), its child Elo lands at 1206.4 — **not** at `paragraph_recombine`'s 1242 baseline. There's a ~36-Elo gap purely from "running the `paragraph_recombine_with_coherence_pass` agent's Phase A + B without Phase C" vs "running the `paragraph_recombine` agent end-to-end". The two agents differ in Phase A + B in ways that account for most of the prior observed gap.

The remaining gap attributable to Phase C itself, in this controlled comparison, is **0.3 Elo** (point estimate) with a 95% CI roughly [−15, +15] at n=8.

### What weakened #2

The voice-flattening claim was based on me reading individual Mode B atomic edits and observing a "wholesale paragraph rewrite that strips bold + replaces vivid phrasing" pattern in one cherry-picked edit (`f408cf88-… edit 1`). A systematic check across all 80 Mode B applied edits in the prior CoherencePassMode A/B (v2) showed the bold-stripping pattern was much milder than the cherry-picked example — 106 bold pairs in oldText → 99 in newText (93% preserved). The dominant pattern is **synonym churn + filler insertion → wordier but not flattened prose**.

If Mode B's edits were systematically degrading the article, the CP-On arm in this experiment would score lower than CP-Off. It does not (point estimate +0.3 Elo difference, p ≈ 0.56). The verbose-synonym pattern is real at the edit level but its net Elo effect is below the n=8 detection threshold.

## Methodology concerns to flag

1. **Multi-dispatch asymmetry is structural**, not a fluke. Phase C eats budget → the dispatch gate fires more aggressively for the no-Phase-C arm. Any future Phase-C A/B should either: (a) pin `maxDispatches: 1` on both arms, (b) match `perInvocationCapUsd` so both arms hit the gate symmetrically, or (c) post-filter to first-dispatch only as this analysis did. Note that in this experiment the 2nd-dispatch CP-Off variant that surfaced had delta −103.3 (worse than typical), so including it actually pulled CP-Off's mean WORSE, not better.
2. **Parent Elo drift at n=8 is normal sampling variance but matters**. CP-Off vs CP-On parent means differed by 15 Elo from sheer luck. Either stratify by parent Elo at allocation time or run n=30+/arm to dilute the variance.
3. **n=8/arm leaves the CI around ±15 Elo**. A true Phase C effect smaller than that magnitude is not detectable here. The conclusion "Phase C is approximately neutral" should be read as "Phase C is in the [−15, +15] Elo band" rather than "Phase C is exactly zero".
4. **The arena judge calls ~80% of comparisons "draw"** — even between variants with 100+ Elo gaps. Empirically, the judge only renders a non-draw verdict when the gap is **~150 Elo or more** (mean Elo gap of non-draw outcomes: +154 in CP-Off, +154 in CP-On). This bias affects both arms equally so the comparison is methodologically fair, BUT it caps the experiment's effective resolution: a true Phase C effect under ~50 Elo can't be measured because TrueSkill barely updates when the judge always says "draw". The child Elo collapse to a tight 1140–1234 band is judge-resolution-limited, not arm-specific.
5. **No direct head-to-head comparisons** between CP-Off and CP-On variants were performed in the arena. Each variant was compared against the existing pool, never against the other arm's variants from the same run. This makes the comparison **independent-samples** rather than **paired**, losing statistical power. A better experimental design would generate matched CP-Off / CP-On variants from the SAME parent and arrange direct A-vs-B comparisons.

## Phase-by-phase deep dive — confirming Phase C ran

Concern raised in review: was Phase C actually exercised on the CP-On arm, or did something silently skip it? Deep-dive verification:

**Phase A (per-slot paragraph rewrites)** — same in both arms.
- CP-Off avg cost: $0.00500 / invocation
- CP-On avg cost: $0.00472 / invocation
- Diff: ~6% (variance-level, n=8-10)

**Phase B (slot ranking + recombine)** — small structural drift.
- CP-Off avg cost: $0.03030 / invocation
- CP-On avg cost: $0.03174 / invocation
- Diff: +5% in CP-On
- Cause: parent paragraph count drift — CP-On parents had avg 9.38 slots vs CP-Off 8.80 (+6.6% more paragraphs → more slot-rank LLM calls). NOT a code path difference; same agent, same logic, just different inputs from random parent sampling.

**Phase C (coherence pass)** — confirmed active on every CP-On invocation:
| Invocation (run prefix) | Cycles | Cycle 1 propose $ | Cycle 1 approve $ | Cycle 1 applied | Cycle 1 accepted | Cycle 1 rejected |
|---|---|---|---|---|---|---|
| c18ce8c5 | 2 | $0.00068 | $0.00045 | 6 | 7 | 6 |
| ae17760a | 2 | $0.00093 | $0.00032 | 3 | 3 | 0 |
| 36135fa5 | 2 | $0.00074 | $0.00055 | 2 | 6 | 8 |
| 4bcd0322 | 2 | $0.00081 | $0.00052 | 7 | 7 | 2 |
| e3df8ffd | 2 | $0.00062 | $0.00033 | 4 | 4 | 1 |
| 56d174bf | 2 | $0.00098 | $0.00058 | 5 | 9 | 1 |
| e40dd8bb | 2 | $0.00099 | $0.00058 | 9 | 9 | 3 |
| 4bc98d1f | 2 | $0.00083 | $0.00071 | 19 | 19 | 0 |

8/8 invocations had:
- 2 full cycles of proposer + approver
- Real LLM spend ($0.0028 avg total Phase C cost per invocation)
- Real edits applied (range 2–19 in cycle 1, mean ~7)
- Real proposer + approver disagreement in 7/8 cases (rejected > 0)
- Silent rejections (accepted > applied) in 4/8 cases — proposer suggested, approver approved, apply step dropped

CP-Off counterpart: all 10 invocations had `coherencePass: { skipped: 'disabled' }` (Phase C never invoked). No leakage, no budget-gate accidents.

**Phase C was real and substantive. The neutral Elo result is NOT explained by Phase C being silently absent.**

## Why is the result neutral if Phase C is real?

Two non-exclusive hypotheses:

1. **Phase C's net Elo effect is genuinely near zero.** The mix of "good edits" (≤10% of applied edits, e.g. pronoun specification, content tightening) and "bad edits" (synonym churn, filler insertion documented in PR #1295's ad-hoc analysis) cancels out at the article level.

2. **The judge's draw bias caps the experiment's resolution.** Even if Phase C had a real +30 Elo effect, the judge would still mostly call the comparisons "draw" against pool members at similar Elo, and TrueSkill wouldn't move the variants enough to detect it at n=8/arm.

The data is consistent with EITHER hypothesis. A properly-powered (n=30+) experiment with paired head-to-head matchups would distinguish them. This experiment cannot.

## Recommendation

**Ship `coherencePassEnabled: false` as the default** for `paragraph_recombine_with_coherence_pass` strategies. The coherence pass is statistically indistinguishable from no coherence pass on Elo *at the resolution this experiment can measure*, and costs +5% more per variant. Defaults should follow the cost-rational option until a properly-powered (n=30+) experiment with paired head-to-head matchups finds a real Phase C win.

If you want to keep the option of running Phase C for cases where it might help (e.g. higher-quality proposer models, rubric-based approval that's more discriminating than holistic judging, or richer paired-comparison designs), keep the iter-config field — but flip the default. Strategies that explicitly want Phase C can pin `coherencePassEnabled: true`.

## Suggested next experiment

To definitively resolve the "Phase C neutral or just unmeasurable?" question:

1. **n=30+ runs/arm** to bring CI under ±5 Elo.
2. **Pin `maxDispatches: 1`** on both arms to eliminate the multi-dispatch asymmetry.
3. **Generate paired variants from the same parent** in each arm (custom seeding logic — fork a run after Phase A + B, run Phase C only in the treatment fork, then compare the two outputs directly).
4. **Arrange direct head-to-head arena comparisons** between paired variants. With paired comparisons, the test is sign-rank not Mann-Whitney, giving substantially more power.
5. **Consider rubric-based judging** rather than holistic to break out of the draw bias.

## Artifacts

- **Seed script**: [`evolution/scripts/experiments/seedCoherencePassEnabledExperiment_20260627.ts`](../../../evolution/scripts/experiments/seedCoherencePassEnabledExperiment_20260627.ts)
- **Experiment row**: `evolution_experiments.id = 7ecb398a-7a43-4d1e-9015-22a01dbda05a` ("CoherencePassEnabled A/B (federal_reserve_2)")
- **Strategies**:
  - Control (CP-Off): `0cd27136-b14a-408a-b7f6-635983c66bb6` — auto-named "Strategy 66f213 (lite, 2it)"
  - Treatment (CP-On): `fe314a1e-4894-4765-9162-8bf51c827dbc` — "Strategy 7a494f (lite, 2it)" (re-used)
- **Branch**: `chore/run_coherence_pass_mode_ab_staging_20260626` ([PR #1295](https://github.com/Minddojo/explainanything/pull/1295))
