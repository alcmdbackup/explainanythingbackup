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

## Problem
The existing `evolution_judge_rubrics` system requires an admin to type each dimension's weight by hand. There is no data-driven way to discover the weighting that reflects a person's revealed preferences. Production rubric judging (`evolution/src/lib/shared/rubricJudge.ts`) already works per-pair-per-criterion: `scorePass` adds each criterion's weight to whichever side won that criterion (TIE/null contribute nothing), and the higher weighted score wins the match. We want to (a) collect, per article pair, human **per-criterion A/B/TIE verdicts** plus an independent human **overall A/B/TIE verdict**, (b) fit non-negative weights `w` so the weighted per-criterion vote `sign(Σ wᵢ·vᵢ)` predicts the overall verdict (i.e. learn the weights of the exact `scorePass` rule), (c) preview the number of ratings required and refine it live, and (d) save the fitted weights as a real judge rubric. K (criteria count) is small (≈3–8), so the statistics are light; the work is data-collection ergonomics, identifiability handling, the preview, and the save-as-rubric integration.

## Confirmed design decisions (from research + user)
- **Pair-based, per-criterion verdicts (NOT absolute article grading).** For each human-judged pair (A,B) we collect a per-criterion verdict `vᵢ ∈ {A-better:+1, B-better:−1, tie:0}` for each criterion, **plus** an independent overall verdict. This exactly matches the production `scorePass` voting model — the fit learns the weights of that rule, with **no continuous-score approximation gap**.
- **Article pool source:** sample variants from a chosen **arena topic** (`evolution_prompts` / `evolution_variants`), reusing the Judge-Lab seeding path (`evolution/src/lib/judgeEval/seed.ts` pull + snapshot pattern). Snapshot content + `mu`/`sigma`.
- **Infer scope:** weights for an **admin-chosen criteria set**. Near-zero inferred weights are surfaced as "this criterion barely matters" (free pruning byproduct) — no automatic criterion discovery in v1.
- **"Separately" = independent elicitation, overall FIRST.** For each pair the **overall** verdict is collected **before** the per-criterion verdicts — ideally on a separate screen — so the holistic judgment is a genuine gut call, not a rationalized sum of the per-criterion verdicts just made. Both must be present for the same pair to enter the fit. (Enforced in the UI flow: a pair's per-criterion step is gated on its overall verdict already existing.)
- **Position-bias mitigation + sampled reversal audit.** A/B presentation order is randomized per pair across the dataset (balances position bias in aggregate). On top of that, a **configurable `replication_rate`** (default ~15%, dial 0–100%) re-shows a sample of pairs a second time with sides **swapped** (a forced reversal) — the human analog of production's 2-pass reversal, which they can't cheaply do on every pair. Verdicts are always stored **oriented to the canonical `article_a`/`article_b` frame** (we flip the raw on-screen answer on save based on the shown orientation, like `flipWinner`), so the two passes are directly comparable. Yields a **position-bias rate** + **self-consistency rate** (the human analogs of Judge Lab's LLM-judge metrics) for both the overall and per-criterion verdicts; replicated-pair agreement feeds a **per-pair confidence** that weights (or, on disagreement, down-weights/ties) that pair in the fit. Replica items are interleaved into the work queue transparently (the reviewer isn't told a pair is a replica).
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
- `evolution_weight_inference_articles` — pooled article snapshots: `id`, `session_id CASCADE`, `variant_id` (bare UUID), `label`, `content` (snapshot), `mu`/`sigma`/`elo` (snapshot, UNCONSTRAINED NUMERIC), `position`; UNIQUE `(session_id, label)`.
- `evolution_weight_inference_comparisons` — one row per human-judged pair **per pass**: `id`, `session_id CASCADE`, `article_a_id→articles`, `article_b_id→articles` (stored in canonical min,max order), `pass INT NOT NULL DEFAULT 0` (0 = original, 1 = reversal replica), `shown_swapped BOOLEAN NOT NULL DEFAULT false` (true ⇒ the human saw canonical-B on the left), `overall_winner TEXT CHECK ('a','b','tie') NULL` (canonical-oriented; NULL until the overall step is done), `rater_id`, `created_at`, `updated_at`; UNIQUE `(session_id, article_a_id, article_b_id, rater_id, pass)`. (Mirrors `evolution_arena_comparisons`; the `pass`/`shown_swapped` columns add the reversal-audit support — verdicts flipped to canonical on save so passes are directly comparable.)
- `evolution_weight_inference_dimension_verdicts` — per-criterion verdict for a pair: `comparison_id→comparisons CASCADE`, `criteria_id` (bare UUID) + `criteria_name` snapshot, `verdict TEXT CHECK ('a','b','tie')`, `position`, `created_at`; PK `(comparison_id, criteria_id)`. (Mirrors `evolution_submatch_dimension_verdicts` / `judge_eval_dimension_verdicts`: no criteria FK, snapshot the name.)
- RLS per table: `deny_all` + `service_role_all` + DO-guarded `readonly_select`, then `REVOKE ... FROM PUBLIC, anon, authenticated`. `is_test_content` trigger reusing `evolution_is_test_name(NEW.name)` on the name-bearing `sessions` table.
- Zod `…InsertSchema` + `…RowSchema` + `z.infer` pairs in `evolution/src/lib/schemas.ts`. `npm run db:types` after apply.

### Statistics core (`evolution/src/lib/weightInference/`, no new deps)
- `fitWeights(comparisonsWithVerdicts, criteriaIds, opts)` → `{ weights:[{criteriaId,weight}] (non-neg, sum-1), logLik, trainAccuracy, heldOutAccuracy?, collinearity, perCriterionAgreement, perWeightCI }`. Non-negative logistic/BT (softmax-param or clamp-refit) with L2 reg on the verdict vectors `vᵢ∈{−1,0,+1}`, **per-pair confidence weighting** (replicated-and-consistent pairs up-weighted; replicated-and-inconsistent down-weighted/tied); sigmoid per `swissPairing.ts`, logit clamp per `judgeEval/metrics.ts`. Only pairs with BOTH the overall verdict AND a complete per-criterion verdict set enter X; overall-ties dropped (noted). A criterion whose verdicts never align with the overall outcome ⇒ near-0 weight ("barely matters"); a criterion that systematically *opposes* the overall ⇒ would-be-negative ⇒ clamped + flagged ("disagrees with overall").
- `auditConsistency(comparisons, verdicts)` → for replicated pairs (pass 0 vs pass 1, both canonical-oriented): `positionBiasRate` (canonical verdict flips under reversal) + `selfConsistencyRate` (canonical verdicts agree), computed for the overall verdict AND per criterion. Mirrors Judge Lab's `position-bias rate` / self-consistency. Emits the per-pair confidence consumed by `fitWeights`.
- `weightCIs(...)` → non-parametric bootstrap over judged pairs (resample+refit, 2.5/97.5 pct) reusing `createSeededRng` + the percentile idiom; returns `MetricValue` per weight.
- `requiredRatings(K, targets, replicationRate)` (upfront rule-of-thumb: distinct pairs ≥ ~10–15×K, **plus a `(1 + replicationRate)` overhead** for the reversal audit — the preview reports distinct pairs, total comparisons, and total verdicts = comparisons × (1 overall + K per-criterion)) and `estimateRemaining(currentData, targets)` (live, simulation-backed) + collinearity/identifiability detection (criteria whose verdicts move together can't be separated → warn).

### Server actions (`evolution/src/services/weightInferenceActions.ts`, all `adminAction`)
- `createWeightInferenceSessionAction({name, promptId, criteriaIds, sampleSize?, replicationRate?})` — seeds article pool from the topic's variants; validates criteria via `validateCriteriaIds`.
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
- [ ] Migration `20260619000001_evolution_weight_inference.sql` (5 tables — sessions, criteria junction, articles, comparisons, dimension_verdicts — RLS, `is_test_content` trigger, indexes incl. `…_non_test`) — passes `lint-migrations-idempotent.ts` + `migration:verify`.
- [ ] Zod schemas in `evolution/src/lib/schemas.ts` (Insert/Row pairs + `z.infer` types).
- [ ] `evolution/src/lib/weightInference/{fit,ci,sampleSize,audit}.ts` with unit tests (recover known weights from synthetic verdict vectors within tolerance; non-neg + sum-1; collinear/always-tie criteria flagged; overall-ties dropped; "disagrees with overall" criterion clamped+flagged; degenerate too-few-pairs → wide CIs not NaN; `requiredRatings` monotonic in K + target precision and scales with `replicationRate`; **`auditConsistency`: synthetic position-biased rater → high positionBiasRate; consistent rater → high selfConsistencyRate; canonical-orientation flip correctness**).

### Phase 2: Server actions + persistence
- [ ] `evolution/src/services/weightInferenceActions.ts` — all actions above (`adminAction`-wrapped, Zod-validated inputs, kill switch).
- [ ] Topic→article seeding (snapshot variants), reversal-replica scheduling per `replication_rate`, per-step verdict upserts (comparison-pass + dimension-verdict rows, canonical-oriented), fit-on-read + consistency audit, export-to-rubric (`createJudgeRubricAction`).
- [ ] Integration test: create session → record per-criterion + overall verdicts → fit → export to `evolution_judge_rubrics`; RLS + `[TEST_EVO]` FK-safe cleanup.

### Phase 3: Admin UI + nav
- [ ] Pages under `src/app/admin/evolution/weight-inference/` (+ `loading.tsx`); Tools nav entry.
- [ ] Judge-overall (1st) → Judge-by-criterion (2nd, gated on overall) / Preview / Results / Export panels per the design above.

### Phase 4: Integration + docs + rollout
- [ ] Verify exported rubric drives rubric-based judging end-to-end (same `scorePass` vote, learned weights); kill switch + host/admin gating confirmed.
- [ ] Fill `evolution/docs/implicit_rubric_weights.md`; update relevant docs (see below).

## Testing

### Unit Tests
- [ ] `evolution/src/lib/weightInference/fit.test.ts` — recovers known weights from synthetic per-criterion-verdict + overall data; non-neg + sum-1; overall-tie handling; collinear/always-tie criteria flagged; "disagrees-with-overall" criterion clamped+flagged; degenerate inputs return wide CIs not NaN.
- [ ] `evolution/src/lib/weightInference/sampleSize.test.ts` — `requiredRatings` monotonic in K and target precision; simulation estimate within tolerance (seeded RNG, deterministic).

### Integration Tests
- [ ] `src/__tests__/integration/evolution-weight-inference.integration.test.ts` — session → per-criterion + overall verdicts → fit → `exportWeightInferenceRubricAction` writes a valid `evolution_judge_rubrics` row; RLS enforced; `[TEST_EVO]` FK-safe cleanup (sessions → criteria/articles/comparisons/dimension_verdicts cascade; created rubric removed).

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-weight-inference.spec.ts` (`@evolution`) — open tool from Tools nav, create session, judge a pair **overall first** then **per-criterion** (assert the per-criterion step is gated until the overall verdict exists), see preview update, view inferred weights, export to rubric (assert the rubric appears under Judge Rubrics). `resetFilters()` after nav; `afterAll` cleanup (imports a DB tool ⇒ required).

### Manual Verification
- [ ] Seed synthetic data where the overall winner IS a known weighted vote of per-criterion verdicts; confirm the fit recovers those weights and the preview's estimate roughly predicts pairs-to-converge; confirm exported rubric is selectable in a strategy.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Drive the new tool on the local tmux server (`ensure-server.sh`): Tools nav → new session → overall verdict (1st) → per-criterion verdicts (2nd) → live preview → results → export to rubric → verify rubric on `/admin/evolution/judge-rubrics`.

### B) Automated Tests
- [ ] `npm run test:unit -- --grep "weightInference"` and `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-weight-inference.spec.ts`

## Documentation Updates
- [ ] `evolution/docs/implicit_rubric_weights.md` — NEW deep dive (fill in during implementation)
- [ ] `evolution/docs/rating_and_comparison.md` — inferred-weights path feeding Rubric-Based Judging weights (same per-criterion `scorePass` vote)
- [ ] `evolution/docs/criteria_agents.md` — criteria as the judged-per-pair components
- [ ] `evolution/docs/data_model.md` — new `evolution_weight_inference_*` tables + RLS
- [ ] `evolution/docs/arena.md` — human pairwise + per-criterion verdicts vs. LLM arena comparisons; topic-as-article-pool sourcing
- [ ] `evolution/docs/visualization.md` — new Tools page + nav entry
- [ ] `docs/feature_deep_dives/judge_evaluation.md` — relationship to Judge Lab seeding/test-set + dimension-verdict pattern
- [ ] `docs/docs_overall/architecture.md` — DB schema table list
- [ ] `evolution/docs/reference.md` — new env-var/kill-switch (`EVOLUTION_WEIGHT_INFERENCE_ENABLED`), files, server actions

## Review & Discussion
[Populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
