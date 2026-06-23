# Implied Rubric Evolution Fixes Research

## Problem Statement
A collection of fixes for implied rubric. Four concrete items so far (below); more to be
added later. Three are questions to answer/clarify (Q1, Q3, Q4); one is a feature request
(Q2 — cost preview).

## Requirements (from GH Issue #1245)
1. **(Q1 — bug)** How many matches are held when you select "article mode" with N
   articles? The preview text doesn't fully update so it's hard to tell.
2. **(Q2 — feature)** Add a cost preview to see how much the auto run will cost with
   different models.
3. **(Q3 — clarify)** Explain how the rubric is "implied". Will all weights add up to 1?
   Should they?
4. **(Q4 — clarify)** How does it work when we select an arena topic?

*(More requirements to be added later.)*

## High Level Summary
This project collects fixes for the **Implicit/Implied Rubric Weights** feature
(`evolution/src/lib/weightInference/` + `evolution/src/services/weightInferenceActions.ts`
+ `src/app/admin/evolution/weight-inference/`). The feature infers rubric-dimension
weights from human or LLM (auto-mode) pairwise preference data via ridge-regularized
logistic regression (IRLS), clamps negatives to 0, renormalizes to a non-negative
sum-to-1 weight per criterion, and exports to a real `evolution_judge_rubrics` row so
the inferred weights plug into the production rubric vote (`sign(Σ wᵢ·vᵢ)`).

Answers to the four current requirements are below. Net: Q1 is a real preview bug
(the live preview ignores pool size and the `C(M,2)` cap), Q2 is a small feature
(the data to compute $ already exists — `MODEL_REGISTRY` prices + the planned-calls
formula), Q3/Q4 are clarifications (weights DO and SHOULD sum to 1; arena-topic flow
documented). See [Findings](#findings-answers-to-the-current-requirements).

## Findings (answers to the current requirements)

### Q1 — Number of matches in "article mode" + why the preview is wrong

**"Article mode"** = `pair_kind = 'article'`. The number of *matches* (pass-0
comparisons) actually materialized at session-create depends on the pair **source**:

- **Arena topic source** (`source_kind='topic'`): the pool is up to `sample_size`
  ("Article pool size", default 30) arena variants; call the actual found count `M`
  (`M ≤ sample_size`). All `C(M,2)` candidate pairs are seeded-shuffled and the first
  `requiredRatings(K).pairs` are kept, where `K` = number of selected criteria and
  `requiredRatings(K).pairs = max(20, ⌈12·K⌉)` (`sampleSize.ts`). So:

  > **matches (pass-0) = min( C(M,2), max(20, 12·K) )**

  How the formula reads: `C(M,2) = M·(M−1)/2` is the number of distinct article pairs the
  pool *can* form (a hard ceiling). `max(20, 12·K)` is how many pairs you *want* — 12 per
  criterion, with a floor of 20 for tiny K. `min(…)` takes the smaller: never more pairs
  than exist, never more than the recommendation needs. Quick table:

  | Pool M | C(M,2) | K | 12·K (≥20) | matches | binding limit |
  |---|---|---|---|---|---|
  | 30 | 435 | 4 | 48 | 48 | recommendation |
  | 10 | 45 | 4 | 48 | 45 | pool size |
  | 5 | 10 | 4 | 48 | 10 | pool size |
  | 30 | 435 | 2 | 24 | 24 | recommendation |

  Plus, in **human mode**, `⌊matches × replication_rate⌋` pass-1 reversal replicas
  (default rate 0.15). **Auto mode** adds 0 replicas (its built-in 2-pass reversal
  handles position bias). Worked examples (K=4 criteria → recommended 48 pairs):
  - M=30 pool → C(30,2)=435 candidates → **48** matches kept (+ 7 human replicas = 55 comparisons).
  - M=10 pool → C(10,2)=45 < 48 → **45** matches (the pool, not K, is the binding cap).
  So with a "normal" pool the match count is driven by the **criteria count K**, not by
  N articles; N only binds when `C(M,2)` is smaller than the K-recommendation.

- **Judge Lab test-set source** (`source_kind='test_set'`): judges **every frozen pair**
  in the set for the chosen `pair_kind` (`testSetPairs`), ignoring the K-recommendation.

**The actual bug (preview "doesn't fully update"):** the live preview
(`getWeightInferencePreviewAction` called with `criteriaCount` only) computes
`requiredRatings(K)` from **K and `replicationRate` alone** — and the form's `useEffect`
dependency array is `[selectedCriteria, replicationRate]` (`page.tsx:97`). Therefore:
  1. Changing **"Article pool size"** never re-fires or changes the preview (it isn't a
     dependency and isn't an input to `requiredRatings`).
  2. For topic mode the preview prints the pure K-based `preview.pairs` /
     `preview.comparisons` / `preview.verdicts`, so it does **not** reflect the
     `min(C(M,2), …)` cap. A small pool (e.g. 5 articles → only 10 pairs possible) still
     shows "≈ 48 pairs / 48 comparisons", overstating what will be judged.
The fix: feed the pool size into the preview and clamp the displayed pairs to
`min(C(M,2), requiredRatings(K).pairs)` (M = min(sample_size, available arena variants);
exact availability is only known server-side, so either show `min(C(sample_size,2), …)`
as an upper bound or have the preview action count available variants for a topic).

### Q2 — Cost preview for auto runs across models (feature)

Today the preview shows only a **call count**, not dollars:
`≈ pairs × autoRepeats × 4` LLM calls (`page.tsx:330`, `4 = CALLS_PER_PAIR` = 2 holistic
+ 2 rubric, each a 2-pass reversal — `autoCost.ts`). A **hard cost cap** already exists
server-side (`assertWithinWeightInferenceAutoCap`, `WEIGHT_INFERENCE_AUTO_MAX_USD`
default $5) and even accepts an optional `estCostPerCall`, but the UI never computes or
shows a `$` figure, so there's no way to compare models before launching.

This is a genuinely new (small) feature, and the pieces exist:
- `MODEL_REGISTRY` (`src/config/modelRegistry.ts`) has per-model pricing (`inputPer1M` /
  `outputPer1M` / `cachedInputPer1M`, USD per 1M tokens); price via `getModelPricing(model)` +
  the chars-based `calculateCost(inputChars, outputChars, pricing)` (NOT token-based `calculateLLMCost`).
- `plannedCalls(remainingPairs, repeats)` already gives the call count.
- Token-based `calculateLLMCost` exists in the evolution LLM layer (per debugging.md).
Plan sketch: estimate tokens/call (≈ both article bodies as prompt input + a small
structured-verdict completion), multiply by the selected model's price, ×
`plannedCalls`, and render a live "≈ $X.XX with <model>" line that updates with model /
repeats / pool / criteria — ideally a tiny per-pair tokens→$ helper next to
`plannedCalls` so the same number can also be passed as `estCostPerCall` into the
existing cap check (single source of truth).

### Q3 — How the rubric is "implied"; do/should weights sum to 1?

**"Implied"** = the weights are *not* typed in by an admin; they are **inferred (backed
out)** from preference data. For each labelled pair the judge produces a per-criterion
verdict vector `v ∈ {−1,0,+1}ᴷ` (features) and an **independent overall** verdict
(label). `fitWeights` runs ridge-regularized logistic regression (IRLS) to find
coefficients so that `sign(Σ wₖ·vₖ)` best predicts the overall winner. The rubric is
"implied" by *which criteria statistically drive the overall preference*: a criterion
that consistently agrees with the overall winner gets a large weight; one that's
irrelevant trends to ~0; one that *opposes* the overall is clamped to 0 (flagged
`disagreesWithOverall`). In auto mode this reverse-engineers the *judge model's* own
implicit rubric.

**Do they sum to 1?** **Yes.** `normalizeToWeights` (`fit.ts:163`) clamps negatives to 0
and divides by the total, so the returned `CriterionWeight.weight` values are
non-negative and **sum to 1** — except the degenerate/all-zero case, where they're all 0
(`degenerate: true`). (Caveat: the *exported* rubric drops zero- and optionally
"barely-matters" dims, so the stored `evolution_judge_rubric_dimensions.weight` subset
may not literally sum to 1 — but `rubricJudge.normalizeDimensions` renormalizes at
read time, so the production vote is unaffected.)

**Should they?** **Yes, by design** — but it's a normalization *convention*, not a
statistical necessity:
- The production vote is `sign(Σ wᵢ·vᵢ)`, which is **scale-invariant** — multiplying all
  weights by any positive constant gives the identical decision. Sum-to-1 is just the
  canonical, interpretable representation (each weight = that criterion's *share* of the
  decision).
- `normalizeDimensions` **silently zeroes negative** weights downstream, so the fit
  *must* emit non-negative weights — hence clamp-then-normalize (and softmax was rejected
  because it can't produce exact-0 weights).
- Trade-off to note: normalization discards the raw coefficients' **magnitude**, which
  encoded how *decisive/confident* the rubric is overall. Sum-1 weights capture only
  *relative* importance, not absolute separability — fine for a sign vote, but it means
  two rubrics with very different confidence can look identical.

### Q4 — What happens when you select an arena topic

Selecting **"Arena topic"** (`source_kind='topic'`, `prompt_id` = the topic) drives this
path in `createWeightInferenceSessionAction`:
1. **Require** a `prompt_id` (the arena topic).
2. **Sample the pool**: `evolution_variants WHERE prompt_id=<topic> AND
   synced_to_arena=true AND variant_kind='article' AND archived_at IS NULL`, ordered by
   `elo_score DESC`, `LIMIT sample_size` (the "Article pool size"). Throws if `< 2`
   variants exist ("need at least 2 to form pairs").
3. **Snapshot** each sampled variant into `evolution_weight_inference_articles` (content +
   `mu`/`sigma` frozen at session create, so later edits/archival don't change the run).
4. **Materialize pairs**: build all `C(M,2)` candidate pairs, seeded-shuffle them
   (deterministic RNG = `hashSeed(sessionId)`), keep the first
   `min(C(M,2), requiredRatings(K).pairs)` as `pass=0` rows (canonical-ordered, random
   `shown_swapped` per row for display debiasing).
5. **Replicas**: human mode adds `⌊pairs × replication_rate⌋` `pass=1` reversal rows;
   auto mode adds none.
6. Judging then proceeds — human via `getNextPairAction` (overall-first, criteria gated),
   or auto via the Phase-5 API route — and the fit reads back canonical-oriented verdicts.

Note: the topic source is **article-only** in practice (arena topics hold article
variants); **paragraph** pairs only come from the test-set source. This is why the form
hardwires `pair_kind: 'article'` when `source_kind==='topic'` (`page.tsx:120`).

## Documents Read

### Core Workflow Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Core Operations Docs
- docs/docs_overall/environments.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/debugging.md

### Relevant Docs (evolution + feature deep dives)
- evolution/docs/implicit_rubric_weights.md (primary — feature this project fixes)
- evolution/docs/rating_and_comparison.md (rubric-based judging the weights feed)
- evolution/docs/criteria_agents.md (`evolution_criteria` components being judged)
- evolution/docs/data_model.md (the five weight-inference tables + RLS)
- docs/feature_deep_dives/judge_evaluation.md (Judge Lab — auto-mode reuses its 2-pass primitives)
- All remaining evolution/docs/*.md were read in summary form for system context
  (architecture, arena, cost_optimization, metrics, etc.)

## Code Files Read
- `evolution/src/lib/weightInference/sampleSize.ts` — `requiredRatings(K)` = max(20, 12·K) pairs (Q1)
- `evolution/src/lib/weightInference/fit.ts` — IRLS ridge logreg, clamp-and-refit, `normalizeToWeights` (sum-to-1) (Q3)
- `evolution/src/lib/weightInference/types.ts` — `CriterionWeight` "non-negative, weights sum to 1" (Q3)
- `evolution/src/lib/weightInference/autoCost.ts` — `plannedCalls`, `CALLS_PER_PAIR=4`, hard $ cap w/ optional `estCostPerCall` (Q2)
- `evolution/src/services/weightInferenceActions.ts` — create-session pool sampling + pair materialization (Q1/Q4); `getWeightInferencePreviewAction` (Q1)
- `src/app/admin/evolution/weight-inference/page.tsx` — new-session form; preview `useEffect` deps `[selectedCriteria, replicationRate]` (Q1 bug); call-count-only preview (Q2)
- `src/config/modelRegistry.ts` — per-model `inputPer1M`/`outputPer1M`/`cachedInputPer1M`, `getModelInfo`, `getModelOptions`, `DEFAULT_JUDGE_MODEL` (Q2)

## Q2 grounding (read in 2nd pass) — confirms the tight-projection plan
- `evolution/src/lib/weightInference/autoJudge.ts` — `judgePairOnce` = **2 holistic calls**
  (`run2PassReversal` over `buildComparisonPrompt(A,B)`, fwd+rev) + **2 rubric calls**
  (`compareWithBiasMitigation` over `buildRubricComparisonPrompt`, fwd+rev) = the 4
  calls/pair; `auto_repeats` multiplies it. Rubric calls are larger (carry criteria).
- `evolution/src/lib/weightInference/autoRun.ts` — chunked, resumable; per-pair cost sink;
  persists `cost` per comparison; calls `assertWithinWeightInferenceAutoCap` per chunk.
- `src/config/llmPricing.ts` — `calculateLLMCost(model, inTok, outTok, reasonTok?, cachedTok?)`
  + `getModelPricing`; token convention `Math.ceil(chars/4)` (`createEvolutionLLMClient.ts`).
- `evolution/src/lib/pipeline/infra/estimateCosts.ts` + `evolution/src/services/strategyPreviewActions.ts`
  — existing pure-estimator + server-preview pattern to mirror for the cost preview.
- Prompt builders to size inputs: `buildComparisonPrompt` (`computeRatings.ts`),
  `buildRubricComparisonPrompt` (`rubricJudge.ts`).
- Session detail already shows **actual** spend (`getWeightInferenceProgressAction.spendUsd`),
  so Q2 is a *pre-run* estimate on the new-session form only.

## Decisions made (from user, 2026-06-21)
- **Q1 →** accurate server-side `M` (extend the preview action to count topic variants),
  not a client-only upper bound.
- **Q2 →** tight projection reusing existing infra (`calculateLLMCost`/`getModelPricing`,
  prompt builders, `estimateCosts`/`strategyPreviewActions` pattern); share Q1's round-trip
  to get real article sizes; unify with `estCostPerCall`.
- **Minors →** the issue is misleading UX only: fix the preview. Server-side materialization
  count is already correct; do NOT surface the exported-weights "subset may not sum to 1
  pre-renormalize" detail (internal, harmless).
- **UX sweep scoping (from user) →** address these only, plus 3 extras:
  - Stale "human verdicts" copy → "human or LLM-judged".
  - Terminology: the head-to-head unit is **"match"** everywhere across evolution
    user-facing copy + docs (retire "comparison"/"pair" as UI nouns).
  - Terminology: the judgment is **"winner"** everywhere across evolution (converge
    "verdict"/judgment-"rating"/"better"). **Keep Elo "rating" (the score) untouched.**
  - Both renames are **whole-evolution** (chosen over weight-inference-only), scoped to
    **user-facing copy + docs only** — never DB columns, type names, code identifiers, or
    API fields. Hand-review (~40 tsx files; blast radius ≈ comparison 142 / pair 129 /
    verdict 36 / winner 155 / rating-or-rate 65 hits) — NOT a regex sweep.
  - Extras kept: **Left/Right instead of A/B** (cards+buttons → "Left wins/Right wins/Tie";
    data quality), **flag the reversal replica** as an intentional re-check (data quality),
    **results legend** (weights sum to 100% / 95% CI / held-out accuracy; reinforces Q3).
  - Extra dropped: non-deployable-model filter. Everything else from the sweep is **Deferred**
    (see planning doc "Deferred"); findings retained above for a future project.

## UX review findings (2026-06-21, 4-agent sweep — deduplicated)
Additional confusion points beyond Q1/Q2, found by reviewing the new-session form
(`page.tsx`), the human judging flow + results/export (`[sessionId]/page.tsx`, all inline),
the auto-mode operability, and terminology across the feature. Grouped by severity.

### HIGH — actively misleading or failure-inducing
- **Stale "human verdicts" framing ignores auto mode.** Intro copy `page.tsx:174-175`,
  sidebar `EvolutionSidebar.tsx:43`, top-of-file comment `page.tsx:1-3` all say "human
  pairwise verdicts" though a prominent "Auto — LLM as judge" toggle exists. Fix: "…from
  pairwise verdicts (human or LLM-judged)".
- **Judge-model picker offers non-deployable local models.** `page.tsx:25` uses
  `getModelOptions()` (all models incl. `local`); should use `getDeployableEvolutionModelIds()`
  (`modelRegistry.ts:279-284`) so a local model can't be picked and then fail the run.
- **"Reversal audit rate" stays editable in auto mode but is forced to 0/ignored**
  (`page.tsx:238-241`, forced at `:124`). Hide/disable it in auto mode with a note.
- **Cards labeled "Article A/B" are position slots, not stable identities** (`[sessionId]:264,272-274,296`).
  On the reversal replica the same article moves sides, so "A" is a different doc the 2nd
  time — contradicts "vote left vs right" and threatens data quality. Fix: label Left/Right
  ("← Left is better" / "Right is better →"); server already re-orients to canonical.
- **Reversal-audit replica is shown silently** (`[sessionId]:262-267`; materialized
  `weightInferenceActions.ts:439-448`). The same pair reappears swapped with no explanation —
  reads as a duplicate/bug, and a rater "staying consistent" defeats the audit. Fix: tell the
  rater some pairs repeat as a quality check (or badge replicas).
- **No back / undo / correct a verdict** (`[sessionId]` `submitOverall:146-154`,
  `submitDims:156-171` persist+advance immediately). Backend already overwrites
  (`recordOverallVerdictAction` UPDATE / dims upsert), so only the UI lacks a path.
- **Results are bare numbers with no legend** (`[sessionId]:318-336`): nothing says weights
  sum to 1, that brackets are a 95% bootstrap CI, or what accuracy means.
- **Two of four diagnostic flags never render** — only `barelyMatters` +
  `disagreesWithOverall` shown (`[sessionId]:338-343`); `nonIdentifiable` + `collinear`
  (`fit.ts:228-249`) are silent, and shown flags are jargon. Fix: render all four with a plain gloss.
- **`degenerate` is terse + silently disables Export** (`[sessionId]:322` warning, `:360`
  disabled, no reason/remedy). Fix: banner with cause ("need ≥ K+1 non-tie pairs — judge
  more") + disabled-reason tooltip.
- **Auto-run has no stall detection** (`[sessionId]:121-144`): a hung chunk looks identical
  to a slow one — no "last updated Xs ago" / no-progress warning.
- **Cap/disabled errors are transient toasts** (`[sessionId]:131-133`; route 402/403): no
  standing explanation of the $5 / 8000-call caps (`autoCost.ts:4-5`) or the kill switches.
- **Kill-switch state never proactively shown.** Two switches
  (`EVOLUTION_WEIGHT_INFERENCE_ENABLED`, `WEIGHT_INFERENCE_AUTO_ENABLED`); Run button looks
  enabled and only errors on click. Fix: report `autoEnabled` and disable Run with a caption.

### MEDIUM — terminology + flow clarity
- **One unit, three names: "pair" / "comparison" / "match".** "comparisons = pairs +
  reversal replicas" is never explained, yet both numbers sit adjacent in the create preview
  (`page.tsx:331` vs `:215`/`:375`). Pick "pair" everywhere; spell out "46 comparisons
  (40 pairs + 6 reversal re-checks)".
- **One act, several names: "verdict" / "rating" / "winner" / "better"** (preview says
  "verdicts" `page.tsx:331`; error "Rate every criterion" `[sessionId]:160`; buttons "A is
  better"). Standardize.
- **Two-step overall→criteria gating is invisible** (`[sessionId]:258-259,86-90`): no "Step
  1 of 2" signpost; combined with the silent replica, the phase switch reads as "why again?".
- **Progress bar tracks only the overall phase** — `criteriaDone` hardcoded `0`
  (`weightInferenceActions.ts:556`), so it freezes at "N/N · ≈0 to go" through the (longer)
  criteria phase, looking done. Same gap in the sessions-list "Progress" column
  (`page.tsx:375`).
- **Audit metrics lack direction/interpretation** (`[sessionId]:345-347`): position-bias
  (lower better) vs self-consistency (higher better) unlabeled.
- **Export form doesn't say what it creates or that the name must be unique** until the
  23505 collision (`weightInferenceActions.ts:816`); add helper text.
- **`dropBarelyMatters` is supported by the action but has no UI checkbox**
  (`weightInferenceActions.ts:788,800-802`; `doExport` never sends it).
- **Opaque field copy:** "Article pool size" (top-N by Elo; → up to C(M,2) pairs),
  "Reversal audit rate" (fraction re-shown swapped), "Repeats / pair" (multiplies LLM
  calls), and the preview's magic "×4 LLM calls" all need one-line help text.
- **Pair-kind toggle silently overridden for topic source** (`page.tsx:215-228,120`): switch
  from a test set (paragraph) to a topic and you silently get article pairs.
- **"Tie" is under-specified**, esp. per-criterion (equally-good vs N/A) (`[sessionId]:273,285-297`).
- **Breadcrumb leaf is generic "Session"** (`[sessionId]:194`) though the name is fetched.
- **Long articles cramped in independent scroll boxes** (`[sessionId]:265`, `max-h-80`): no
  sync-scroll/expand for a tool whose whole job is side-by-side reading.

### LOW — polish
- Client validation says "≥2 criteria" but server max is 20 → raw Zod error (`page.tsx:109,263`).
- Recommendation is floored at 20, so it's non-linear for small K — note "(minimum 20)".
- Test-set "fewer than recommended" warning is non-actionable (frozen set) — add next step.
- No keyboard shortcuts for the repetitive verdict clicks (`[sessionId]:271-302`).
- Per-criterion submit error doesn't highlight the unrated rows (`[sessionId]:158-161`).
- "All pairs judged 🎉" can show while the fit is still degenerate/unexportable.
- Train-vs-held-out accuracy distinction invisible; held-out absent < 10 pairs.
- `nPairs` (entered the fit) is narrower than the judging count → looks like data loss.
- CI fallback renders a zero-width `[45%,45%]` interval = false precision
  (`weightInferenceActions.ts:241-243`) — mark "CI n/a" instead.
- Auto "Done" is the only end-state; session `status`/failure never rendered.
- Criterion names can be opaque when `description` is null.

## Still to read (during implementation)
- `src/app/admin/evolution/weight-inference/[sessionId]/page.tsx` — session-detail (confirm
  it already renders actual spend; no pre-run estimate needed there)
- `supabase/migrations/20260619000002_evolution_weight_inference.sql` — table/column confirmation
