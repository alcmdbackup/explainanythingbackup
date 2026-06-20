<!-- Implementation plan: infer rubric dimension weights from per-criterion PAIRWISE verdicts + an overall pairwise winner, surface a ratings-needed preview, and save the result as a real judge rubric. -->

# Calculate Implied Rubric Weights (Evolution) Plan

## Background
Allow user preferences to support implicitly calculating implicit rubric criteria and weights. Instead of an admin hand-setting each judging dimension's weight, infer rough weights from two human inputs on article pairs — (1) which of A/B is better **overall**, and (2) which of A/B is better **on each specific criterion** — and find the weighting that best reconciles them. This mirrors how rubric-based matches work today: the judge returns a per-criterion A/B/TIE verdict and the weighted vote of those verdicts produces the overall match result. Here the human supplies both the per-criterion verdicts and an independent overall verdict, and we fit the weights so the weighted vote matches the overall. Show an upfront preview of how many ratings are needed. Lives as a new tool under the evolution admin "Tools" nav group; the final inferred rubric can be saved as a real rubric in the system.

## Requirements (from GH Issue #1229)
- Let user choose which variant is better, for a given pair.
- Let user grade articles on rubric components, separately.
- Figure out implied rough weightings that allow the two to match.
- This is a high-level idea, figure out how to do this and serve up a preview upfront of how many ratings of each type are necessary.
- **(follow-up)** Implement as a new section within the "Tools" section of the evolution admin dash left nav.
- **(follow-up)** Be able to save the final implied-rubric output as a new rubric in the system.
- **(follow-up)** The rubric must work **on pairs** — "is A or B better on this specific criterion" — matching how the production match rubric works today (per-criterion A/B/TIE verdicts, not absolute per-article scores).
- **(follow-up)** Add an **"auto mode"** that uses an LLM-as-judge to produce both the overall and per-criterion verdicts (same setup, LLM in place of human), then backs out the weighting via the same fit — reverse-engineering the judge model's implicit rubric.

## Problem
The existing `evolution_judge_rubrics` system requires an admin to type each dimension's weight by hand. There is no data-driven way to discover the weighting that reflects a person's revealed preferences. Production rubric judging (`evolution/src/lib/shared/rubricJudge.ts`) already works per-pair-per-criterion: `scorePass` adds each criterion's weight to whichever side won that criterion (TIE/null contribute nothing), and the higher weighted score wins the match. We want to (a) collect, per article pair, human **per-criterion A/B/TIE verdicts** plus an independent human **overall A/B/TIE verdict**, (b) fit non-negative weights `w` so the weighted per-criterion vote `sign(Σ wᵢ·vᵢ)` predicts the overall verdict (i.e. learn the weights of the exact `scorePass` rule), (c) preview the number of ratings required and refine it live, and (d) save the fitted weights as a real judge rubric. K (criteria count) is small (≈3–8), so the statistics are light; the work is data-collection ergonomics, identifiability handling, the preview, and the save-as-rubric integration.

## Confirmed design decisions (from research + user)
- **Pair-based, per-criterion verdicts (NOT absolute article grading).** For each human-judged pair (A,B) we collect a per-criterion verdict `vᵢ ∈ {A-better:+1, B-better:−1, tie:0}` for each criterion, **plus** an independent overall verdict. This exactly matches the production `scorePass` voting model — the fit learns the weights of that rule, with **no continuous-score approximation gap**.
- **Article pool source:** sample variants from a chosen **arena topic** by querying `evolution_variants WHERE prompt_id = <topic> AND archived_at IS NULL` directly (the ~10-line pattern `buildRunContext`/`loadArenaEntries` already use), then snapshot each into `evolution_weight_inference_articles` (content + `mu` + `sigma`; display Elo derived from `mu` at render, no stored `elo` column). **NOT** `judgeEval/seed.ts` — that path snapshots already-judged `evolution_arena_comparisons` LLM pairs into one capped JSONB pair-bank, which would (a) restrict the pool to previously-compared variants and (b) inherit its 400-pair cap. We want a fresh variant sample, so query variants directly.
- **Pair generation (materialization + selection):** at session create, after sampling the M-variant pool, **eagerly materialize the target set of comparison rows** (`pass=0`). Target pair count `P = requiredRatings(K).pairs` (capped at `C(M,2)`; if `P > C(M,2)` warn that the pool is too small and surface the max achievable). Selection draws P distinct unordered pairs from the pool via a **seeded** shuffle (`createSeededRng(session-seed)`) of all `C(M,2)` candidates — random/uniform in v1 (active-learning "informative pair" selection is a noted future option). Each row's A/B presentation orientation (`shown_swapped`) is set at materialization from the same seeded RNG. Reversal replicas (`pass=1`) are materialized for a `replication_rate` fraction of those pairs with `shown_swapped` forced opposite. `getNextPairAction` simply serves the next un-judged materialized row for the requested step. Progress denominators = count of materialized rows per step. This makes pool-size→pair-count, the preview denominators, and replica scheduling all deterministic and pre-decided (no mid-build invention).
- **Infer scope:** weights for an **admin-chosen criteria set**. Near-zero inferred weights are surfaced as "this criterion barely matters" (free pruning byproduct) — no automatic criterion discovery in v1.
- **"Separately" = independent elicitation, overall FIRST.** For each pair the **overall** verdict is collected **before** the per-criterion verdicts — ideally on a separate screen — so the holistic judgment is a genuine gut call, not a rationalized sum of the per-criterion verdicts just made. Both must be present for the same pair to enter the fit. (Enforced in the UI flow: a pair's per-criterion step is gated on its overall verdict already existing.)
- **Canonical pair ordering + verdict orientation (load-bearing).** A pair's two articles are stored in a **stable canonical order**: `article_a_id` = lexicographically smaller `articles.id` (UUID string compare), `article_b_id` = larger — so `pass=0` and `pass=1` of the same pair always land on the identical `(article_a_id, article_b_id)` tuple (the UNIQUE key + the pass-0-vs-pass-1 audit join both depend on this). `shown_swapped` records whether the human saw canonical-B on the left. On **save**, the raw on-screen verdict is flipped into the canonical frame by a single explicit rule applied identically to the overall verdict AND every per-criterion verdict: `flip('a')='b'`, `flip('b')='a'`, `flip('tie')='tie'` — applied iff `shown_swapped`. We add a **new local helper named `flipPairVerdict`** operating on lowercase `'a'|'b'|'tie'` — deliberately a DIFFERENT name from `rubricJudge.flipVerdict` (which operates on `'A'|'B'|'TIE'`) to avoid a same-name cross-module collision. Unit-test `flipPairVerdict(flipPairVerdict(v))===v` plus that a swapped-orientation save round-trips to the same canonical verdict as an unswapped save.
- **Position-bias mitigation + sampled reversal audit.** Per-pair A/B presentation order is seeded-randomized at materialization (balances position bias in aggregate). On top, the **configurable `replication_rate`** (default ~15%, dial 0–100%) re-shows a sample of pairs as a `pass=1` row with sides **swapped** — the human analog of production's 2-pass reversal. **Replica (`pass=1`) rows feed ONLY the reversal audit + per-pair confidence — they are NOT added to the fit's training matrix X as independent rows** (that would double-count the underlying pair and inflate sample size / shrink CIs). X uses exactly one row per distinct pair (the `pass=0` canonical verdict); a pair whose `pass=1` replica disagrees gets its per-pair confidence down-weighted (or, on overall-verdict flip, treated as a tie ⇒ dropped). A pair with `pass=0` complete but `pass=1` only partially judged contributes its `pass=0` row at default confidence (audit just skips it). Audit yields a **position-bias rate** + **self-consistency rate** (human analogs of Judge Lab's metrics) for overall and per-criterion. Replicas are interleaved transparently (the reviewer isn't told).
- **New tables**, not an extension of `judge_eval_*`. Mirror the production shape: a **comparison** row (pair + overall winner) with child **dimension-verdict** rows — directly analogous to `evolution_arena_comparisons` + `evolution_submatch_dimension_verdicts` / `judge_eval_dimension_verdicts`. Follow the `evolution_judge_rubrics` migration *template* (RLS + `is_test_content` trigger + soft-delete).
- **Stats:** hand-rolled non-negative logistic / Bradley–Terry fit on the **per-criterion verdict vector** — **no new dependency**. Reuse `createSeededRng` + the bootstrap-percentile idiom (`evolution/src/lib/metrics/experimentMetrics.ts`) for coefficient CIs and the sample-size simulation; copy the sigmoid from `swissPairing.ts` and the logit-clamp from `judgeEval/metrics.ts`.
- **Weight semantics (load-bearing):** output **non-negative, sum-to-1 relative** weights. `normalizeDimensions` in `rubricJudge.ts` clamps negatives to 0 and renormalizes to sum-1 at read time, so the fit MUST produce non-negative weights (softmax-parameterize or clamp-and-refit) or they'll be silently zeroed downstream.
- **Save-as-rubric:** call the existing `createJudgeRubricAction({ name, label?, description?, dimensions: [{criteria_id, weight, position}] })` (`evolution/src/services/judgeRubricActions.ts`). Raw weights are fine — the system normalizes at read. Closes the loop into rubric-based judging (`EVOLUTION_RUBRIC_JUDGING_ENABLED`).
- **Server actions only** (no long-running LLM ⇒ no API route, no cost-cap gate). All `adminAction`-wrapped. New route auto host-gated + admin-gated (no middleware/layout change).

## Options Considered
- [x] **Discretized per-criterion pairwise voting fit (CHOSEN — per user)**: feature per pair = per-criterion verdict vector `v ∈ {−1,0,+1}ᴷ`, label = overall verdict; fit non-negative `w` so `sign(Σ wᵢvᵢ)` matches overall, renormalize to sum-1. **Exactly models production `scorePass`** — the inferred weights plug straight into the existing rubric vote with no semantic mismatch.
- [ ] **Continuous logistic on absolute score-deltas (rejected)**: grade each article on a `[min,max]` scale, feature = `s(a)−s(b)`. Was the prior approach; rejected because production discretizes per-dimension to A/B/TIE before weighting, so the continuous fit is only an approximation, and it requires absolute grading the user doesn't want.
- [x] **New `evolution_weight_inference_*` tables (CHOSEN)** vs. extending `judge_eval_*` (rejected — shape mismatch).
- [ ] **Bayesian/full-posterior weights** — richer uncertainty; deferred. Bootstrap CIs cover v1.

## Architecture (proposed)

```
Admin → "Implied Rubric Weights" (Tools nav)
  1. New session: pick arena topic + criteria set + sample size
        → seed article pool (snapshot N variants) + show UPFRONT ratings-needed preview
  2. Per pair (A,B), two independent elicitation steps ("separately"), OVERALL FIRST:
        • Overall step (1st)       → A better / B better / Tie overall          (label)
        • Per-criterion step (2nd) → for each criterion: A better / B better / Tie (vᵢ ∈ {+1,−1,0})
        (overall judged before criteria to reduce anchoring; separate screens.
         A/B presentation order randomized per pair to balance position bias)
     (~replication_rate of pairs re-shown reversed → position-bias + self-consistency audit)
  3. Fit (local, hand-rolled): for pairs with BOTH steps done,
        X = per-criterion verdict vectors (canonical frame), y = overall winner,
        per-pair confidence from replicated-pair agreement
        → non-negative sum-1 weights of the scorePass vote + bootstrap CIs
        → flags: collinearity / "barely matters" (near-0) / "disagrees with overall" (would-be-negative)
        → audit: position-bias rate, self-consistency rate (overall + per-criterion)
        → LIVE preview: weights+CIs now, "≈X more pairs to converge"
  4. Export → createJudgeRubricAction(weights) → new evolution_judge_rubrics row
        → usable by rubric-based LLM judging (same scorePass rule, now with learned weights)
```

### New tables (migration `20260619000001_evolution_weight_inference.sql`, transactional + idempotent + RLS template)
- `evolution_weight_inference_sessions` — `id`, `name UNIQUE`, `description`, `status`, `prompt_id` (arena topic; bare UUID snapshot), `sample_size`, `replication_rate NUMERIC NOT NULL DEFAULT 0.15 CHECK (0..1)` (fraction of pairs re-shown reversed), `is_test_content` (name trigger), `archived_at`, `deleted_at`, `created_at`, `updated_at`.
- `evolution_weight_inference_criteria` — junction `(session_id→sessions CASCADE, criteria_id→evolution_criteria RESTRICT, position)` PK `(session_id, criteria_id)`. The chosen criteria set (no weight column — weight is the OUTPUT).
- `evolution_weight_inference_articles` — pooled article snapshots: `id`, `session_id CASCADE`, `variant_id` (bare UUID), `label`, `content` (snapshot), `mu`/`sigma` (snapshot, UNCONSTRAINED NUMERIC; display Elo derived from `mu` at render — no stored `elo` column), `position`; UNIQUE `(session_id, label)`.
- `evolution_weight_inference_comparisons` — one row per human-judged pair **per pass**: `id`, `session_id CASCADE`, `article_a_id→articles`, `article_b_id→articles` (stored in canonical min,max order), `pass INT NOT NULL DEFAULT 0` (0 = original, 1 = reversal replica), `shown_swapped BOOLEAN NOT NULL DEFAULT false` (true ⇒ the human saw canonical-B on the left), `overall_winner TEXT CHECK ('a','b','tie') NULL` (canonical-oriented; NULL until the overall step is done), `rater_id`, `created_at`, `updated_at`; UNIQUE `(session_id, article_a_id, article_b_id, rater_id, pass)`. (Mirrors `evolution_arena_comparisons`; the `pass`/`shown_swapped` columns add the reversal-audit support — verdicts flipped to canonical on save so passes are directly comparable.)
- `evolution_weight_inference_dimension_verdicts` — per-criterion verdict for a pair: `comparison_id→comparisons CASCADE`, `criteria_id` (bare UUID) + `criteria_name` snapshot, `verdict TEXT CHECK ('a','b','tie')`, `position`, `created_at`; PK `(comparison_id, criteria_id)`. (Mirrors `evolution_submatch_dimension_verdicts` / `judge_eval_dimension_verdicts`: no criteria FK, snapshot the name.)
- RLS per table: `deny_all` + `service_role_all` + DO-guarded `readonly_select`, then `REVOKE ... FROM PUBLIC, anon, authenticated`. `is_test_content` trigger reusing `evolution_is_test_name(NEW.name)` on the name-bearing `sessions` table.
- Zod `…InsertSchema` + `…FullDbSchema` + `z.infer` pairs in `evolution/src/lib/schemas.ts` (matching the established naming; standalone-row idiom if a schema needs `.refine()`). `evolution_arena_comparisons` uses `winner ∈ {a,b,draw}`; these tables use `{a,b,tie}` (consistent with the dimension-verdict enum — note the intentional divergence in a comment). **`database.types.ts` regenerates from the REMOTE/staging DB**, so the new tables won't be in generated types until the migration is deployed to staging; the hand-written Zod `Insert`/`FullDb` types are the interim type source (Phase 2 is not blocked waiting on type-gen). Run `npm run db:types` after the migration lands on staging.

### Statistics core (`evolution/src/lib/weightInference/`, no new deps)
- `fitWeights(comparisonsWithVerdicts, criteriaIds, opts)` → `{ weights:[{criteriaId,weight}] (non-neg, sum-1), logLik, trainAccuracy, heldOutAccuracy?, collinearity, perCriterionAgreement, perWeightCI }`. **Clamp-and-refit (committed — NOT softmax):** unconstrained ridge-regularized logistic/BT on the verdict vectors `vᵢ∈{−1,0,+1}`, then clamp any negative coefficient to 0 and refit on the surviving columns; renormalize survivors to sum-1. (Softmax parameterization is rejected because it can never yield an exact 0, contradicting the "barely matters"→near-0 / "disagrees"→clamped-to-0 product requirements.) **Numerical guards (mandatory, not optional):** L2 ridge penalty with a fixed non-zero λ (handles perfect separation — common at small K with discretized features, e.g. a criterion that always agrees with the overall); Newton/IRLS with a max-iteration cap + step damping (or regularized GD); sigmoid/logit clamped to `[ε, 1−ε]` (reuse the `judgeEval/metrics.ts` clamp bounds) so `log(0)`/`exp(overflow)` can't escape; any all-zero/constant (always-tie, non-identifiable) criterion column is **pinned to weight 0** (not fed to the solver) and flagged. **Per-pair confidence weighting** from the audit (replicated-consistent up-weighted; replicated-inconsistent down-weighted/tied). Only `pass=0` rows with BOTH the overall verdict AND a complete per-criterion verdict set enter X; overall-ties dropped (noted). Near-0 weight ⇒ "barely matters"; a criterion whose coefficient was negative pre-clamp ⇒ flagged "disagrees with overall". **Export guard:** if the fit yields an all-zero weight vector (e.g. every overall verdict was a tie/dropped), export is blocked with a clear error (an all-zero rubric falls back to holistic at read — useless).
- `auditConsistency(comparisons, verdicts)` → for replicated pairs (pass 0 vs pass 1, both canonical-oriented): `positionBiasRate` (canonical verdict flips under reversal) + `selfConsistencyRate` (canonical verdicts agree), computed for the overall verdict AND per criterion. Mirrors Judge Lab's `position-bias rate` / self-consistency. Emits the per-pair confidence consumed by `fitWeights`.
- `weightCIs(...)` → **net-new code** (NOT a reuse of `bootstrapMeanCI`/`bootstrapPercentileCI`, which resample a flat scalar array and never refit a model): non-parametric bootstrap that resamples judged pairs with replacement and **re-runs the full `fitWeights`** each iteration, then takes 2.5/97.5 percentiles per weight → `MetricValue` per weight. Only `createSeededRng` + the B045 "two-draws-per-iter" determinism discipline genuinely carry over. Must guarantee **finite CIs (never NaN)** when a resample is degenerate (all-ties / perfectly separated) — same ridge + clamp guards as the point fit; a degenerate resample falls back to the point estimate rather than emitting NaN.
- `requiredRatings(K, targets, replicationRate)` (upfront rule-of-thumb: distinct pairs ≥ ~10–15×K, **plus a `(1 + replicationRate)` overhead** for the reversal audit — the preview reports distinct pairs, total comparisons, and total verdicts = comparisons × (1 overall + K per-criterion)) and `estimateRemaining(currentData, targets)` (live, simulation-backed) + collinearity/identifiability detection (criteria whose verdicts move together can't be separated → warn).

### Server actions (`evolution/src/services/weightInferenceActions.ts`, all `adminAction`)
> **`rater_id` is always server-derived from `ctx.adminUserId`** (provided by the `adminAction` factory) on every write — it is **never** a Zod input field and never accepted from the client (otherwise it'd be spoofable and would corrupt the per-pair confidence / audit aggregation). All inputs are Zod-validated (UUIDs validated as `z.string().uuid()`); the kill switch is checked **inside each action** (server actions are directly invocable regardless of UI). Export pre-validates criteria via `validateCriteriaIds` and surfaces a friendly message if a criterion was archived/deleted mid-session ("criterion X was archived — re-activate or exclude it") and on `evolution_judge_rubrics.name` UNIQUE collision ("rubric name already exists").
- `createWeightInferenceSessionAction({name, promptId, criteriaIds, sampleSize?, replicationRate?})` — seeds article pool from the topic's variants; validates criteria via `validateCriteriaIds`. `sampleSize` Zod-capped (e.g. ≤100) so the in-memory `C(M,2)` candidate enumeration + eager materialization stay bounded; article text is snapshotted once per article row (comparison rows reference `article_id`s — text is NOT re-inlined per pair).
- `listWeightInferenceSessionsAction`, `getWeightInferenceSessionDetailAction`.
- `getWeightInferencePreviewAction({sessionId|K, targets})` — upfront + live ratings-needed (pairs, and the implied 1 overall + K per-criterion verdicts per pair).
- `recordDimensionVerdictsAction({sessionId, comparisonId, verdicts:[{criteriaId, verdict}]})` and `recordOverallVerdictAction({sessionId, comparisonId, overallWinner})` — independent per-step writes against a specific comparison **pass** row; raw on-screen answers are flipped to the canonical frame on save using that row's `shown_swapped`.
- `getNextPairAction({sessionId, step})` — pick the next comparison (pass) to judge for the `overall` or `criteria` step (overall queue drains first; the criteria step for a comparison is gated on its overall verdict; replica passes interleaved per `replication_rate`; A/B orientation set per row).
- `getWeightInferenceFitAction({sessionId})` — current weights + CIs + warnings + coverage + accuracy **+ position-bias rate + self-consistency rate** (overall + per-criterion).
- `exportWeightInferenceRubricAction({sessionId, rubricName, label?, description?})` — fit → `createJudgeRubricAction(...)` → returns new rubric id (the **save-as-rubric** requirement).

### Admin UI (`src/app/admin/evolution/weight-inference/`)
- Sessions landing + new-session dialog (topic + criteria multi-select + sample size; shows upfront preview).
- Session detail, presented as **separate steps with the overall judged FIRST**: **Judge-overall** screen (A vs B via `SideBySideWordDiff`; A/B/Tie overall) → then **Judge-by-criterion** screen (same pair; per criterion an A/B/Tie control with the criterion's `description`/`evaluation_guidance` shown as guidance). The per-criterion screen for a pair is reachable only after that pair's overall verdict is recorded (`getNextPairAction({step:'overall'})` drains first, then `{step:'criteria'}`). Plus **Progress/Preview** (distinct pairs + total comparisons/verdicts vs needed, live; new-session dialog exposes the `replication_rate` knob), **Results** (weight bars + CI whiskers via `MetricGrid`/small chart; collinearity, "barely matters", and "disagrees with overall" flags; train/held-out accuracy; **position-bias rate + self-consistency rate** from the reversal audit), **Export to rubric** dialog.
- Nav: append one `NavItem` to the **Tools** group in `src/components/admin/EvolutionSidebar.tsx` (`href:'/admin/evolution/weight-inference'`, `testId:'evolution-sidebar-nav-weight-inference'`). Midnight Scholar tokens; obey design-system ESLint rules.
- Kill switch: `EVOLUTION_WEIGHT_INFERENCE_ENABLED` (default on; `'false'` ⇒ actions reject / nav item inert), mirroring the prompt-editor/feature-flag convention.

## Auto Mode (LLM-as-judge)

**Concept.** Identical setup to human mode, with an **LLM judge** in place of the human. The model produces the same two things the human does — an independent **holistic overall** verdict and **per-criterion** A/B/TIE verdicts — over the same materialized pairs; the **same `fitWeights` core** backs out the weights. This reverse-engineers the judge model's *implicit* rubric: the weighting its holistic judgments behave as if they use. Independently valuable: (a) cheaply bootstrap a starting rubric (then refine/validate with a human session on the same pairs); (b) diagnose a judge model — a criterion you care about that gets ~0 implied weight means the model isn't attending to it holistically; (c) compare human-implied vs LLM-implied weights side by side.

**Everything downstream is shared and unchanged** — the session / articles / comparisons / dimension_verdicts tables, `fitWeights` / `weightCIs` / `auditConsistency`, the Results panel, and Export-to-rubric. Auto mode only swaps the *source* of the verdicts.

**Judging engine (confirmed reuse — display-only, ZERO ratings/arena writes).** Per pair, mirror the Judge-Lab / `rejudgeComparisonAction` inline 2-pass pattern (chosen over `compareWithBiasMitigation`'s rubric branch because that branch doesn't expose temperature/model controls):
- **Overall** = `run2PassReversal` + `buildComparisonPrompt` (holistic, no rubric) → `parseWinner` → `aggregateWinners` ⇒ overall A/B/TIE + confidence.
- **Per-criterion** = `run2PassReversal` + `buildRubricComparisonPrompt(criteria,…)` → `parseRubricVerdict` → per-dimension forward/reverse verdicts; reconcile each dimension's two passes via `reconcilePasses` ⇒ per-criterion A/B/TIE + confidence. (Weights in the rubric prompt are placeholders — per-dimension verdicts are **weight-independent**; we re-fit.)
- Overall and per-criterion are **separate calls** (separate model contexts) — the LLM analog of the human "judge overall separately." Order is moot for stateless calls; position bias is handled by the built-in 2-pass reversal.
- **4 LLM calls/pair** (2 holistic + 2 rubric). All routed through `callLLM(prompt, 'evolution_weight_inference', adminUserId, judgeModel, false, null, null, null, false, { temperature, reasoningEffort, onUsage })` — the `evolution_` prefix bills the evolution daily budget + the global `LLMSpendingGate`. The 2-pass reversal already yields real-frame verdicts, so LLM rows are stored canonical-oriented with **no `shown_swapped` flip** (that mechanism is human-mode only).

**Cost controls (LLM spend — unlike human mode).** Pre-flight hard cap mirroring `assertWithinJudgeEvalCap`: `WEIGHT_INFERENCE_AUTO_ENABLED` (kill switch), `WEIGHT_INFERENCE_AUTO_MAX_CALLS` (default 8000), `WEIGHT_INFERENCE_AUTO_MAX_USD` (default $5); `plannedCalls = pairs × repeats × 4`, asserted BEFORE any LLM call. The new-session preview shows the **estimated $ + call count** before the run starts (auto-mode analog of "ratings needed"). The evolution daily cap + global kill switch are the hard backstop.

**Audit in auto mode.** Position-bias = the **forward-vs-reverse disagreement rate** from the built-in 2-pass reversal (the same `position-bias rate` Judge Lab reports). Self-consistency comes from optional **`auto_repeats`** (run each pair K times at temperature>0; default 1 at temp 0). So `replication_rate` (human) and `auto_repeats`/2-pass (auto) are the analogous audit knobs. Verdict **confidence** (the `aggregateWinners`/`reconcilePasses` 0/0.3/0.5/0.7/1.0) feeds the **same per-pair confidence weighting** in the fit.

**Fit "explanatory power" framing.** Because the per-criterion and overall verdicts come from the same model, the fit accuracy answers: *how well does a linear weighting of these criteria explain the judge's holistic preference?* High accuracy ⇒ the criteria set captures what the model cares about; low ⇒ the model's holistic judgment uses signals outside the criteria (or is non-linear) — itself a useful finding, surfaced in Results as "criteria explain X% of the judge's holistic calls."

**Data-model additions (folded into the SAME Phase-1 migration — additive + defaulted, no second migration):**
- `sessions`: `mode TEXT NOT NULL DEFAULT 'human' CHECK ('human','auto')`, `judge_model TEXT`, `judge_temperature NUMERIC`, `judge_reasoning_effort TEXT`, `auto_repeats INT NOT NULL DEFAULT 1`.
- `comparisons`: `source TEXT NOT NULL DEFAULT 'human' CHECK ('human','llm')`, `confidence NUMERIC` (reconciled verdict confidence; human rows null/1.0), `judge_model TEXT` (null for human), optional `forward_raw`/`reverse_raw` JSONB for LLM auditability (nullable). `rater_id` stays the launching admin; `source` carries provenance.
- `dimension_verdicts`: `confidence NUMERIC` (reconciled per-dimension; null for human).

**Execution (background batch via API route).** Auto-mode judging is long-running ⇒ `POST /api/evolution/weight-inference/auto-run` (`maxDuration=300`, `requireAdmin`, Zod, kill-switch + pre-flight cost-cap gate) — mirrors the prompt-editor route. It iterates the session's materialized pairs, runs the 4 calls/pair (bounded concurrency + the shared evolution LLM semaphore via `callLLM`), persists `comparison(source='llm')` + `dimension_verdict` rows with confidence, and reports progress. Create/preview/fit/export remain plain server actions — only the batch judging needs the route. The E2E test path uses the standard `E2E_TEST_MODE` LLM stub (no real spend in CI).

**UI additions.** The new-session dialog gains a **mode toggle (Human ↔ Auto)**. Auto reveals judge-model / temperature / reasoning / repeats selectors (curated via `getJudgeModelOptionsAction`, default the production `DEFAULT_JUDGE_MODEL`) and the **estimated-cost** preview; "Create & run" kicks off the batch with a progress bar (auto-refresh like the dashboard). The Judge/Compare panels are hidden in auto mode (no human input). Results + Export are identical, plus a "judge: `<model>` @ temp `<t>`" provenance line and the explanatory-power accuracy read. (Optional follow-up: a side-by-side "human-implied vs LLM-implied weights" view when both a human and an auto session exist for the same topic+criteria.)

## UI Wireframes

Layout/flow only — actual styling is the Midnight Scholar theme (warm tokens, Playfair/Source Serif, gold accents, `paper-texture` cards). Deliberate choices: Step 2 **hides** the earlier overall verdict (anti-anchoring; alternative was to show it for context); the overall screen uses a plain side-by-side, with an optional `SideBySideWordDiff` toggle only on the per-criterion screen (a word-diff can bias toward "what changed" over holistic quality).

### 1. Sessions landing — `/admin/evolution/weight-inference`
```
Evolution ▸ Tools ▸ Implied Rubric Weights

┌──────────────────────────────────────────────────────────────────────────┐
│  Implied Rubric Weights                               [ + New session ]    │
│  Infer judge-rubric weights from human pairwise verdicts                   │
├──────────────────────────────────────────────────────────────────────────┤
│  ☐ Hide test content                            Search: [____________]     │
│  Name              Topic            Criteria  Progress       Status        │
│  ────────────────────────────────────────────────────────────────────────│
│  Fed-rubric v1     Federal Reserve 2   5      48/75 pairs    ● collecting  │
│  Clarity-weighting Quantum Computing   3      ready          ✓ fitted      │
│                                                    ‹ Prev   1 2 3   Next ›  │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2. New-session dialog (with upfront "ratings needed" preview)
```
┌────────────────────  New inference session  ────────────────────┐
│  Name          [ Fed-rubric v1______________________________ ]   │
│  Description    [ optional________________________________ ]      │
│  Arena topic    [ Federal Reserve 2                  ▼ ]          │
│                  → 312 variants available                        │
│  Criteria to weight   [ select… ▼ ]   (5 selected)               │
│    ☑ clarity   ☑ engagement  ☑ structure  ☑ depth  ☑ tone        │
│    ☐ point_of_view   ☐ sentence_variety   [+ manage criteria]    │
│  Article pool size      [  30 ]  variants sampled                │
│  Reversal audit rate    [ 15 %]  of pairs re-shown swapped       │
│  ┌─ Preview: ratings needed ────────────────────────────────┐   │
│  │  ≈ 75 pairs  (target: stable weights for 5 criteria)      │   │
│  │   → 75 overall verdicts                                   │   │
│  │   → 375 per-criterion verdicts  (75 × 5)                  │   │
│  │   + ~15% reversal audit  ⇒ ≈ 86 pairs to judge total      │   │
│  │  Rough estimate — refines live as you judge.              │   │
│  └───────────────────────────────────────────────────────────┘  │
│                                       [ Cancel ]  [ Create ]     │
└──────────────────────────────────────────────────────────────────┘
```

### 3. Session detail — tabs + progress (overall-first visible)
```
Evolution ▸ Tools ▸ Implied Rubric Weights ▸ Fed-rubric v1
┌──────────────────────────────────────────────────────────────────────────┐
│  Fed-rubric v1                                        ● collecting         │
│  Topic: Federal Reserve 2 · 5 criteria · pool 30 · audit 15%               │
├────────[ Judge ]────[ Progress ]────[ Results ]───────────────────────────┤
│   Step 1 — Overall            Step 2 — By criterion                        │
│   ████████████░░░  48/75       ███████░░░░░░  31/48                         │
│   (judge these first)          (unlocks per pair after its overall)        │
│                    [ ▶ Continue judging ]                                  │
│   ≈ 27 more pairs to reach stable weights.                                 │
└──────────────────────────────────────────────────────────────────────────┘
```

### 4. Step 1 — Judge OVERALL (holistic gut call, judged first)
```
┌──────────────────────────────────────────────────────────────────────────┐
│  Overall judgment           Pair 49 of ~86          Step 1 of 2   skip ⏭   │
│  Which article is better — overall?                                        │
├───────────────────────────────────┬────────────────────────────────────────┤
│             ARTICLE A             │             ARTICLE B                  │
│  ┌─────────────────────────────┐  │  ┌──────────────────────────────────┐ │
│  │ # The Federal Reserve…      │  │  │ # How the Fed Works              │ │
│  │ The Federal Reserve is the  │  │  │ Picture the economy as a car —   │ │
│  │ central bank of the U.S. …  │  │  │ the Fed is the foot on the pedal.│ │
│  │ …                  [scroll] │  │  │ …                       [scroll] │ │
│  └─────────────────────────────┘  │  └──────────────────────────────────┘ │
│      (  ◉ A is better  )    (  ○ Tie  )    (  ○ B is better  )             │
│                          [  Submit & next →  ]                             │
│  ⓘ Judge holistically — you'll rate individual criteria later.             │
└──────────────────────────────────────────────────────────────────────────┘
  (left/right randomized per pair; ~15% reappear later sides-swapped → bias audit)
```

### 5. Step 2 — Judge BY CRITERION (same pairs, after their overall is done)
```
┌──────────────────────────────────────────────────────────────────────────┐
│  Per-criterion judgment     Pair 31 of ~86          Step 2 of 2            │
│  For each criterion, which article is better?                              │
├───────────────────────────────────┬────────────────────────────────────────┤
│   ARTICLE A  # The Federal…  [▾]   │   ARTICLE B  # How the Fed…   [▾]      │
├──────────────────────────────────────────────────────────────────────────┤
│                                          A better    Tie    B better       │
│   clarity        ⓘ                      (   ◉   )  (  ○  )  (   ○   )      │
│   engagement     ⓘ                      (   ○   )  (  ○  )  (   ◉   )      │
│   structure      ⓘ                      (   ○   )  (  ◉  )  (   ○   )      │
│   depth          ⓘ                      (   ○   )  (  ○  )  (   ◉   )      │
│   tone           ⓘ                      (   ◉   )  (  ○  )  (   ○   )      │
├──────────────────────────────────────────────────────────────────────────┤
│  ⓘ Judge each criterion on its own merits.   [  Submit & next →  ]         │
└──────────────────────────────────────────────────────────────────────────┘
  (the earlier overall verdict is intentionally NOT shown here)
```

### 6. Results — inferred weights + CIs + bias audit + export
```
┌──────────────────────────────────────────────────────────────────────────┐
│  Inferred weights            68 pairs fitted · train 91% · held-out 84%    │
├──────────────────────────────────────────────────────────────────────────┤
│  Implied rubric weight (normalized, sum = 100%)        ├─┤ = 95% CI         │
│   depth       ███████████████████████  34%      ├──┤  [28–40%]             │
│   clarity     ██████████████████  27%           ├──┤  [22–33%]             │
│   structure   ████████████  19%               ├───┤   [13–25%]             │
│   engagement  ████████  14%                  ├────┤   [8–20%]              │
│   tone        ███  6%  ⚠ barely matters      ├──┤     [1–11%]              │
│  ⚠ Flags: tone near-zero (consider dropping); none disagree with overall   │
│  Reviewer-bias audit  (12 reversal-checked pairs)                          │
│    Position-bias 8% ✓ low    Self-consistency 92% ✓ high                   │
│    Per-criterion: clarity 100% · depth 92% · tone 75% ⚠                     │
│  Stability: ≈ 7 more pairs to tighten CIs.                                 │
│                                   [  Export as judge rubric →  ]           │
└──────────────────────────────────────────────────────────────────────────┘
```

### 7. Export dialog → creates a real `evolution_judge_rubrics` row
```
┌─────────────────  Export as judge rubric  ─────────────────┐
│  Creates a new rubric in Judge Rubrics with the inferred    │
│  weights — usable by rubric-based judging immediately.      │
│  Rubric name   [ Fed-rubric v1 (inferred)______________ ]   │
│  Label         [ optional____________________________ ]     │
│  Description   [ optional____________________________ ]     │
│  Dimensions (normalized):                                   │
│    depth 34% · clarity 27% · structure 19% ·                │
│    engagement 14% · tone 6%                                 │
│    ☐ Drop "barely matters" criteria (tone)                  │
│                          [ Cancel ]  [ Create rubric ]      │
└─────────────────────────────────────────────────────────────┘
```

**Flow:** create session (topic + criteria + audit rate, see ratings-needed preview) → drain Step 1 overall verdicts → Step 2 per-criterion verdicts unlock → Results updates live (weights, CIs, bias audit, "≈N more pairs") → Export writes a real rubric.

## Phased Execution Plan

### Phase 1: Migration + schemas + statistics core
- [ ] Migration `20260619000001_evolution_weight_inference.sql` (5 tables — sessions, criteria junction, articles, comparisons, dimension_verdicts — RLS, `is_test_content` trigger, indexes incl. `…_non_test`) — **including the auto-mode columns** (`sessions.mode`/`judge_model`/`judge_temperature`/`judge_reasoning_effort`/`auto_repeats`; `comparisons.source`/`confidence`/`judge_model`/`forward_raw`/`reverse_raw`; `dimension_verdicts.confidence`) so no second migration is needed when auto mode lands. Passes `lint-migrations-idempotent.ts` + `migration:verify`.
- [ ] Zod schemas in `evolution/src/lib/schemas.ts` (Insert/Row pairs + `z.infer` types).
- [ ] `evolution/src/lib/weightInference/{fit,ci,sampleSize,audit}.ts` with unit tests: recover known weights from synthetic verdict vectors within tolerance; non-neg + sum-1; collinear/always-tie criteria pinned to 0 + flagged; overall-ties dropped; perfect-separation → finite weights (ridge) not NaN/∞; "disagrees with overall" criterion clamped+flagged; degenerate too-few-pairs → wide CIs not NaN; all-zero-weight fit → export-blocking error; `requiredRatings` monotonic in K + target precision and scales with `replicationRate`; **`auditConsistency`: synthetic position-biased rater → high positionBiasRate; consistent rater → high selfConsistencyRate**; `flipVerdict(flipVerdict(v))===v` and swapped-save canonical round-trip. **Determinism:** two `fitWeights`/`weightCIs` runs with the same seed produce byte-identical CIs (guards against unseeded `Math.random`). **Property-based (`fast-check`, already a dep):** for any random verdict matrix the output weights are non-negative and sum to 1 (or all-zero → flagged).

### Phase 2: Server actions + persistence
- [ ] `evolution/src/services/weightInferenceActions.ts` — all actions above (`adminAction`-wrapped, Zod-validated inputs, kill switch).
- [ ] Topic→article seeding (snapshot variants), reversal-replica scheduling per `replication_rate`, per-step verdict upserts (comparison-pass + dimension-verdict rows, canonical-oriented), fit-on-read + consistency audit, export-to-rubric (`createJudgeRubricAction`).
- [ ] Add `EVOLUTION_WEIGHT_INFERENCE_ENABLED` to the `integration-evolution` env block in `.github/workflows/ci.yml` (mirrors existing evolution kill-switch flags).
- [ ] Integration test: create session → record overall + per-criterion verdicts (incl. swapped-orientation round-trip) → fit → export to `evolution_judge_rubrics`; assert server-derived `rater_id` + kill-switch-OFF rejection; RLS + `[TEST_EVO]` FK-safe cleanup in the order above.

### Phase 3: Admin UI + nav
- [ ] Pages under `src/app/admin/evolution/weight-inference/` (+ `loading.tsx`); Tools nav entry.
- [ ] Judge-overall (1st) → Judge-by-criterion (2nd, gated on overall) / Preview / Results / Export panels per the design above.

### Phase 4: Integration + docs + rollout (human mode)
- [ ] Verify exported rubric drives rubric-based judging end-to-end (same `scorePass` vote, learned weights); kill switch + host/admin gating confirmed.
- [ ] Fill `evolution/docs/implicit_rubric_weights.md`; update relevant docs (see below).

### Phase 5: Auto mode (LLM-as-judge) — layered on the shared core
- [ ] `evolution/src/lib/weightInference/autoJudge.ts` — per-pair holistic 2-pass (`run2PassReversal` + `buildComparisonPrompt`/`parseWinner`/`aggregateWinners`) + per-criterion 2-pass (`buildRubricComparisonPrompt`/`parseRubricVerdict`/`reconcilePasses`), via an injected `JudgeFn` for unit-testability (mirrors `runJudgeEval.ts`). Returns canonical-oriented verdicts + confidence. Unit-tested with a mock JudgeFn.
- [ ] Pre-flight cost cap `assertWithinWeightInferenceAutoCap` (`WEIGHT_INFERENCE_AUTO_ENABLED` / `_MAX_CALLS` / `_MAX_USD`; `plannedCalls = pairs × repeats × 4`), mirroring `judgeEval/settings.ts`. Unit-tested.
- [ ] API route `POST /api/evolution/weight-inference/auto-run` (`maxDuration=300`, `requireAdmin`, Zod, kill-switch + cap gate, `callLLM` with `call_source='evolution_weight_inference'`, bounded concurrency). Persists `source='llm'` comparison + dimension_verdict rows + progress.
- [ ] Mode toggle + judge selectors + estimated-cost preview in the new-session dialog; hide Judge/Compare panels in auto mode; provenance + explanatory-power read in Results.
- [ ] Integration test (mock/`E2E_TEST_MODE` LLM): auto-run persists llm-source verdicts → fit → export; respects the cost cap + kill switch; `[TEST_EVO]` cleanup. E2E (`@evolution`, route-mocked LLM like the suggestions/prompt-editor specs): create auto session → run completes → weights render → export.

## Testing

### Unit Tests
- [ ] `evolution/src/lib/weightInference/fit.test.ts` — recovers known weights from synthetic per-criterion-verdict + overall data; non-neg + sum-1; overall-tie handling; collinear/always-tie criteria flagged; "disagrees-with-overall" criterion clamped+flagged; degenerate inputs return wide CIs not NaN.
- [ ] `evolution/src/lib/weightInference/sampleSize.test.ts` — `requiredRatings` monotonic in K and target precision; simulation estimate within tolerance (seeded RNG, deterministic).

### Integration Tests
- [ ] `src/__tests__/integration/evolution-weight-inference.integration.test.ts` — session → overall + per-criterion verdicts (incl. a swapped-orientation row, asserting canonical round-trip) → fit → `exportWeightInferenceRubricAction` writes a valid `evolution_judge_rubrics` row; asserts `rater_id` came from the admin context (not input); asserts the **kill switch OFF** path (`EVOLUTION_WEIGHT_INFERENCE_ENABLED='false'` ⇒ actions reject; flag is read per-call so the in-test env mutation takes effect; **restore the env var in `try/finally` or `afterEach`** so OFF doesn't leak into later ON assertions in the same file). RLS enforced. **Cleanup ORDER (matches `evolution-judge-rubric.integration.test.ts`):** delete the exported **rubric first** (cascades its dimensions, releasing the junction's `ON DELETE RESTRICT` to `evolution_criteria`), then any test-created criteria, then the **session** (cascades articles/comparisons/dimension_verdicts/criteria-junction). Test-created criteria use the `TESTEVO-…-<ms>` name form ([TEST_EVO] brackets are illegal in `evolution_criteria.name`); session uses `[TEST_EVO]` prefix. Migration touched ⇒ `migration:verify` runs in /finalize + the `migration-verify-test` CI job.

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-weight-inference.spec.ts` (`@evolution`, NOT `@critical` — admin is host-gated) — open tool from Tools nav, create session, judge a pair **overall first** then **per-criterion** (assert the per-criterion step is **gated** until the overall verdict exists — wait on a named deterministic signal, e.g. a `data-testid="criteria-step-locked"` / `…-unlocked` marker or a disabled-until-overall control, never a sleep/poll), then assert results + export. **Flakiness guards (mandatory):** assert only on **presence/structure**, never on RNG/data-dependent values — i.e. a weight bar exists + a CI whisker renders + the position-bias/self-consistency rows render, NOT specific numbers (preview estimate + bootstrap CIs are RNG/data-dependent); select articles/controls by **`data-testid` tied to the canonical article frame**, never by on-screen left/right position (A/B orientation is randomized). After export, assert the rubric appears under Judge Rubrics. `resetFilters()` after landing-list nav (default "Hide test content" on); `afterAll` cleanup deletes BOTH the session (cascades children) AND the exported judge rubric (not FK-linked to the session). Uses `[TEST_EVO]`-prefixed session names; any test-created `evolution_criteria` use the `TESTEVO-…-<ms>` name form (bracket prefixes are illegal in `evolution_criteria.name`).

### Manual Verification
- [ ] Seed synthetic data where the overall winner IS a known weighted vote of per-criterion verdicts; confirm the fit recovers those weights and the preview's estimate roughly predicts pairs-to-converge; confirm exported rubric is selectable in a strategy.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Drive the new tool on the local tmux server (`ensure-server.sh`): Tools nav → new session → overall verdict (1st) → per-criterion verdicts (2nd) → live preview → results → export to rubric → verify rubric on `/admin/evolution/judge-rubrics`.

### B) Automated Tests
- [ ] `npm run test:unit -- --grep "weightInference"` and `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-weight-inference.spec.ts`

## Rollback & CI

- **Rollback (forward-only migration):** the migration `20260619000001` is **forward-only — no down-migration** (the repo's migrations are forward-only; reverting DDL in prod is the high-risk path the migration-idempotency lint exists to avoid). Rollback is operational, in escalating order: (1) flip `EVOLUTION_WEIGHT_INFERENCE_ENABLED='false'` — every server action rejects and the Tools nav item is inert (sub-minute, no redeploy needed on the runner; a Vercel env change for the web app); (2) revert the feature PR (code only) — the 5 new tables are **additive and RLS-deny-by-default**, so leaving them in place is inert and safe (nothing else references them). No data migration to unwind.
- **CI job set (expected):** the touched paths — `evolution/**`, `src/app/admin/evolution/**`, `supabase/migrations/**` — all match `EVOLUTION_ONLY_PATHS`, so a PR to `main` routes to `integration-evolution` + `e2e-evolution` (plus `migration-verify-test` because migrations changed, `lint-migrations-idempotent`, `check-migration-order`, `check-migration-append-only`). The new integration file (`evolution-weight-inference…`) matches the `test:integration:evolution` grep. **Note:** `integration-critical` (the 5 fixed tests on PRs to main) will NOT pick up the new test — it runs only via the evolution-only/full path; the full integration + E2E suites run on PRs to `production`. A stray non-evolution file edit would flip classification to `full` (still runs everything).
- **Kill-switch CI wiring:** add `EVOLUTION_WEIGHT_INFERENCE_ENABLED` (whole feature) and `WEIGHT_INFERENCE_AUTO_ENABLED` (auto mode only) to the `integration-evolution` job env block in `.github/workflows/ci.yml` (default-on), mirroring how `EDITING_AGENTS_ENABLED` / `EVOLUTION_DEBATE_ENABLED` / `JUDGE_EVAL_ENABLED` are wired. Convention: `process.env.X !== 'false'` (default-on; only the exact string `'false'` disables). Auto mode adds the cost ceilings `WEIGHT_INFERENCE_AUTO_MAX_CALLS` (default 8000) + `WEIGHT_INFERENCE_AUTO_MAX_USD` (default 5), enforced pre-flight (mirrors `JUDGE_EVAL_MAX_*`). Auto mode is independently disable-able from human mode.
- **Type-gen:** `database.types.ts` regenerates from staging after `deploy-migrations`; tsc/unit referencing the new tables resolve via the hand-written Zod types until `db:types` is regenerated + auto-committed on the PR branch (CI `generate-types` job). Don't block Phase 2 on it.

## Documentation Updates
- [ ] `evolution/docs/implicit_rubric_weights.md` — NEW deep dive (fill in during implementation)
- [ ] `evolution/docs/rating_and_comparison.md` — inferred-weights path feeding Rubric-Based Judging weights (same per-criterion `scorePass` vote)
- [ ] `evolution/docs/criteria_agents.md` — criteria as the judged-per-pair components
- [ ] `evolution/docs/data_model.md` — new `evolution_weight_inference_*` tables + RLS
- [ ] `evolution/docs/arena.md` — human pairwise + per-criterion verdicts vs. LLM arena comparisons; topic-as-article-pool sourcing
- [ ] `evolution/docs/visualization.md` — new Tools page + nav entry
- [ ] `docs/feature_deep_dives/judge_evaluation.md` — relationship to Judge Lab seeding/test-set + dimension-verdict pattern; **auto mode** reuses the same 2-pass / `buildRubricComparisonPrompt` judging primitives and cost-cap pattern
- [ ] `docs/docs_overall/architecture.md` — DB schema table list
- [ ] `evolution/docs/reference.md` — new env-var/kill-switch (`EVOLUTION_WEIGHT_INFERENCE_ENABLED`), files, server actions

## Review & Discussion
[Populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
