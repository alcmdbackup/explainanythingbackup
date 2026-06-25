# Implicit Rubric Weights

## Overview

Infers rubric-dimension **weights** from human preference data instead of an admin typing them in by hand. The rubric works **on pairs**, exactly like the production match rubric (`rubricJudge.scorePass`): for each article pair the judge gives a per-criterion verdict ("is A or B better on this criterion") plus an independent **overall** verdict, and weights `w` are fit so the weighted vote of the per-criterion verdicts predicts the overall winner (`sign(Σ wᵢ·vᵢ)`, `vᵢ∈{−1,0,+1}`). Because that IS the production voting rule, the inferred weights plug straight into the existing rubric vote with no semantic mismatch. Output weights export to a real `evolution_judge_rubrics` row, closing the loop into rubric-based LLM judging.

Two modes share the same tables, fit, results, and export:
- **human mode** — a person gives the verdicts (interactive; overall judged first, per-criterion on a separate gated step, with a sampled reversal audit for bias).
- **auto mode** — an LLM-as-judge gives both verdicts via the existing 2-pass comparison primitives, under a pre-flight cost cap (Phase 5). Auto mode reverse-engineers the judge model's *implicit* rubric.

Project: `docs/planning/calculate_implifed_rubric_weights_evolution_20260619/`.

## The fit

Each labelled pair contributes a feature vector `v ∈ {−1,0,+1}ᴷ` (per-criterion verdict: a=+1, b=−1, tie=0, canonical-oriented) and a label (the overall verdict, a=1/b=0; overall-ties dropped). `fitWeights` runs **ridge-regularized logistic regression (IRLS)** on the verdict vectors, then **clamps negative coefficients to 0 and refits on the survivors** (softmax was rejected — it can't yield exact-0 weights), and renormalizes to a non-negative, sum-to-1 weight per criterion. Guards: mandatory non-zero ridge λ (handles perfect separation), an IRLS iteration cap, sigmoid/logit clamping (no `log(0)`/overflow), and zero-variance (always-tie/constant) columns pinned to 0. Flags: `barelyMatters` (near-0 weight), `disagreesWithOverall` (negative pre-clamp), `nonIdentifiable` (pinned), `collinear` (columns moving together). Confidence intervals come from `weightCIs` — a bootstrap that resamples pairs and **re-runs the full fit** per iteration (NOT a reuse of the scalar `bootstrapMeanCI`), with a finite-CI fallback to the point estimate on degenerate resamples.

The fitted weights are stored RAW in the rubric; the existing `normalizeDimensions` (read-time, in `rubricJudge.ts`) renormalizes — so non-negative output is required (a negative would be silently zeroed downstream).

## How the rubric is "implied" — and do the weights sum to 1?

**"Implied"** means the weights are *inferred from preference data*, not typed in by an admin. For each labelled match the judge gives a per-criterion winner (the feature vector) and an independent **overall** winner (the label); `fitWeights` finds the weights so that the weighted vote of the per-criterion winners best predicts the overall winner. A criterion that consistently agrees with the overall winner earns a large weight; an irrelevant one trends to ~0; one that *opposes* the overall is clamped to 0. In auto mode this reverse-engineers the judge model's own implicit rubric.

**Do they sum to 1? Yes** — `normalizeToWeights` clamps negatives to 0 and divides by the total, so the returned weights are non-negative and sum to 1 (the degenerate/all-zero case returns all 0). **Should they? Yes, by design**, but it's a normalization *convention*: the production vote `sign(Σ wᵢ·vᵢ)` is scale-invariant (any positive scaling gives the same decision), so sum-to-1 is just the interpretable form — each weight is that criterion's *share of the decision*. The trade-off: normalization discards the raw coefficients' magnitude (how decisive the rubric is overall), keeping only relative importance. Note the *exported* rubric drops zero/​barely-matters dims, so the stored subset may not literally sum to 1 — `normalizeDimensions` renormalizes at read time, so the vote is unaffected.

## New-session preview & cost estimate

`getWeightInferencePreviewAction` returns the **exact** number of matches a new session will judge — `matchesToJudge = min(C(M,2), requiredRatings(K).pairs)` for a topic (with `M` = the topic's `synced_to_arena` article variants actually available, capped at the pool size) and the frozen-pair count for a test set — plus `poolSize`, `bindingLimit` (`pool` vs `recommendation`), and `avgArticleChars`. The form's live preview re-fires on every input that affects the count (criteria, replication rate, source, topic, pool size, pair kind, test set) and explains *why* a given count is held. For **auto** mode it also shows a **cost estimate** via `estimateAutoRunCost` (chars-based pricing over the real per-match shape: 2 holistic + 2 rubric calls × repeats), which updates as you change the model. The same `perCallUsd` feeds `assertWithinWeightInferenceAutoCap`, so the displayed estimate and the enforced `WEIGHT_INFERENCE_AUTO_MAX_USD` cap agree.

## Reviewer-bias audit

A configurable `replication_rate` (default 0.15) re-shows a sample of pairs a second time with sides **swapped** (`pass=1`). Verdicts are stored **canonical-oriented** (flipped on save via `shown_swapped`), so the two passes are directly comparable. `auditConsistency` computes a **position-bias rate** (verdict flipped under reversal) and a **self-consistency rate** (verdict agreed) for the overall verdict and per criterion — the human analogs of Judge Lab's LLM-judge metrics. Replicated-pair agreement feeds a **per-pair confidence** (`pairConfidence`) that weights the pair in the fit. Replica (`pass=1`) rows feed ONLY the audit/confidence — never the training matrix (no double-counting).

## Sample-size preview

`requiredRatings(K)` estimates the distinct pairs needed (≈ `max(20, 12·K)`), the comparisons (pairs + the `replication_rate` audit overhead), and the total verdicts (`comparisons × (1 + K)`). Shown upfront in the new-session dialog and live on the session detail (`remainingPairs`).

## Data model

See [Data Model → Weight-inference tables](./data_model.md#weight-inference-tables-calculate_implifed_rubric_weights_evolution_20260619). Five tables (migration `20260619000002`), all on the standard evolution RLS (deny-all + `service_role_all` + `readonly_local`), `is_test_content` trigger on the name-bearing `sessions` table:

- `evolution_weight_inference_sessions` — the run entity (mode, prompt_id, sample_size, replication_rate, auto-mode judge settings).
- `evolution_weight_inference_criteria` — junction (session → criteria; the chosen set; weight is the OUTPUT, not stored here).
- `evolution_weight_inference_articles` — snapshot of the sampled pool (content + mu/sigma).
- `evolution_weight_inference_comparisons` — one row per pair PER PASS; canonical ordering enforced by a CHECK (`article_a_id < article_b_id`); overall_winner + source + (auto) confidence/judge_model/cost/forward_winner/reverse_winner.
- `evolution_weight_inference_dimension_verdicts` — per-criterion verdict (criteria_id bare + criteria_name snapshot).

## Key Files
- `evolution/src/lib/weightInference/` — `types`, `verdicts` (`flipPairVerdict`/canonical orientation), `fit` (`fitWeights`/`predictOverall`), `ci` (`weightCIs`), `sampleSize` (`requiredRatings`), `audit` (`auditConsistency`/`pairConfidence`). All pure + unit-tested.
- `evolution/src/services/weightInferenceActions.ts` — `adminAction`-wrapped server actions: create session (seed pool from an arena topic + materialize pairs), list, preview, getNextPair (overall-first / criteria-gated), recordOverall/recordDimensionVerdicts (canonical flip-on-save), getFit, exportRubric. `rater_id` is server-derived; kill switch `EVOLUTION_WEIGHT_INFERENCE_ENABLED`.
- `src/app/admin/evolution/weight-inference/{page.tsx,[sessionId]/page.tsx,loading.tsx}` — sessions landing + new-session form; session detail (Judge / Results + export).
- `src/components/admin/EvolutionSidebar.tsx` — "Implied Rubric Weights" Tools nav entry.
- `supabase/migrations/20260619000002_evolution_weight_inference.sql` — the five tables.

## Pair source (Phase 6)
A session's pairs come from one of two sources (`evolution_weight_inference_sessions.source_kind`):
- **`topic`** — sample `evolution_variants WHERE prompt_id=<topic> AND synced_to_arena AND variant_kind=<pair_kind> AND archived_at IS NULL` (top-N by `elo_score`), then materialize pairs combinatorially (seeded `C(M,2)` shuffle capped at `requiredRatings(K).pairs`).
- **`test_set`** — reuse a **Judge Lab test set**: read its frozen members + the pair-bank's `pairs` JSONB via the pure `resolveTestSetPairs(bankPairs, members, kind)` helper, snapshot the distinct variants as articles, and materialize **one comparison per frozen pair** (canonical-ordered). This reuses Judge Lab's curation (article/paragraph kind, stratified strategies, clone-&-curate, frozen membership) and enables the same pairs to be judged by a human, by auto mode, and by the production judge for apples-to-apples comparison.

**`pair_kind`** (`article` | `paragraph`) selects the comparison framing — threaded into `judgePairOnce`/`compareWithBiasMitigation` as the `ComparisonMode` so paragraph pairs judge in paragraph mode. Paragraph pairs come from a test set (the topic source is article-only in practice — an arena topic holds article variants).

### Arena-topic flow (what "select an arena topic" does)
1. **Require** a `prompt_id` (the topic).
2. **Sample the pool**: `evolution_variants WHERE prompt_id=<topic> AND synced_to_arena AND variant_kind='article' AND archived_at IS NULL`, ordered by `elo_score DESC`, `LIMIT sample_size` ("Article pool size", default 30). Throws if `< 2` variants exist.
3. **Snapshot** each sampled variant into `evolution_weight_inference_articles` (content + `mu`/`sigma` frozen at create, so later edits/archival don't change the run).
4. **Materialize matches**: build all `C(M,2)` candidate pairs, seeded-shuffle, keep the first `min(C(M,2), requiredRatings(K).pairs)` as `pass=0` rows (canonical-ordered, random `shown_swapped` for display debiasing).
5. **Replicas**: human mode adds `⌊matches × replication_rate⌋` `pass=1` reversal re-checks; auto mode adds none (its 2-pass reversal handles position bias).
6. Judging proceeds — human via `getNextPairAction`, or auto via the API route — and the fit reads back canonical-oriented winners. The topic source is **article-only** in practice (arena topics hold article variants); paragraph matches come only from a test set, which is why the form hardwires `pair_kind: 'article'` for a topic source.

## Implementation notes
- Pairs are materialized eagerly at session create: all `C(M,2)` candidates are seeded-shuffled (`createSeededRng(hash(sessionId))`), the first `requiredRatings(K).pairs` are kept as `pass=0` rows, and a `replication_rate` fraction get a `pass=1` reversal replica.
- `fitWeights` filters by the session's `source` (human XOR auto) — a session is single-source, never a mixed fit.
- Export blocks when the fit is degenerate / all-zero, and surfaces a friendly message on the `evolution_judge_rubrics.name` UNIQUE collision.

## Per-session holistic prompt override (auto mode) — `evalute_implied_rubric_results_and_experimentally_validate_20260623`

An auto-mode session can override the holistic comparison prompt's hardcoded checklist (`Clarity and readability / Structure and flow / Engagement and impact / Grammar and style / Overall effectiveness` from `buildComparisonPrompt`'s article-mode default) via the optional `evolution_weight_inference_sessions.holistic_prompt_override TEXT` column (migration `20260624173001`). NULL = use the default (back-compat byte-identical). The per-criterion path (`buildRubricComparisonPrompt`) is **unaffected** — it has no override, by design — so only the **label** (overall verdict) shifts across arms; the **features** (per-criterion verdicts) are invariant. That isolation is what lets the 4-arm experiment causally attribute the priming effect.

- **Verdict-tail contract.** `buildComparisonPrompt`'s 9th param `strictVerdictTail?: boolean` controls which verdict tail the sandbox builder emits when an override is set. The override path passes `true` → strict "Respond with ONLY one of A/B/TIE" tail, compatible with `judgePairOnce`'s strict `parseWinner` (start-anchored). The rejudge sandbox (`rejudgeComparisonAction` → `buildSandboxComparisonPrompt`) leaves the param undefined → reasoning-tolerant "Your answer:" tail, compatible with `parseVerdictFromReasoning` (last-marker scan). Two distinct contracts on one builder so the rejudge sandbox is byte-identical to pre-experiment.
- **Sanitization.** `evolutionWiSessionInsertSchema`'s Zod refine rejects any override containing the reserved substrings `## Text A`, `## Text B`, `Your answer:`, `<|`, `|>` (`WI_HOLISTIC_OVERRIDE_RESERVED_MARKERS`). Stops an operator typo from pre-positioning fake A/B body markers ahead of the real ones (which would mis-route `parseWinner` step 2's `TEXT A` phrase match). The DB CHECK constraint caps length at 8000 chars.
- **Kill-switch env var.** `EVOLUTION_WI_HOLISTIC_OVERRIDE_DISABLED='true'` causes `runAutoChunk` to ignore any persisted override and fall back to the default checklist for new chunks (one warn log per chunk). Zero-deploy rollback path if the override plumbing regresses on staging/prod.
- **Cost-cap math.** `estimateAutoRunCost`'s `holisticOverheadChars = Math.max(700, holisticOverrideChars ?? 0)` so the form's $ projection matches the bytes actually sent. The pre-flight `WEIGHT_INFERENCE_AUTO_MAX_USD=$5` cap remains conservative even at the 8000-char column max.
- **Experiment arms.** `evolution/src/lib/weightInference/experimentArms.ts` (client-safe) exports the 4 canonical arm prompts (`EXPERIMENT_ARMS[A|B|C|D]`); `experimentArmsHashing.ts` (server-only — uses `node:crypto`, NOT in the public barrel) exports `ACCEPTED_HASHES` (array per arm, append-on-fix never replace) + `verifyArmHash` for the analysis script. The create-session form has an Arm-preset dropdown that auto-fills the textarea from canonical constants (eliminates paste byte-drift); editing the textarea resets the dropdown to "".

## Cross-references
- [Rating & Comparison — Rubric-Based Judging](./rating_and_comparison.md#rubric-based-judging-structured_judging_evolution_20260610) — the explicit-weight system this feature feeds.
- [Criteria Agents](./criteria_agents.md) — `evolution_criteria` rubric components being judged.
- [Judge Evaluation (Judge Lab)](../../docs/feature_deep_dives/judge_evaluation.md) — closest data-collection analog; auto mode reuses its 2-pass / `buildRubricComparisonPrompt` primitives + cost-cap pattern.
- [Data Model](./data_model.md) — the five new tables + RLS.
