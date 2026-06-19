<!-- Implementation plan: infer rubric dimension weights from human pairwise preferences + per-criterion gradings, surface a ratings-needed preview, and save the result as a real judge rubric. -->

# Calculate Implied Rubric Weights (Evolution) Plan

## Background
Allow user preferences to support implicitly calculating implicit rubric criteria and weights. Instead of an admin hand-setting each judging dimension's weight, infer rough weights from two human inputs — (1) which of a pair of articles is better, and (2) per-criterion grades on individual articles — and find the weighting that best reconciles them. Show an upfront preview of how many ratings of each type are needed. Live as a new tool under the evolution admin "Tools" nav group; the final inferred rubric can be saved as a real rubric in the system.

## Requirements (from GH Issue #1229)
- Let user choose which variant is better, for a given pair.
- Let user grade articles on rubric components, separately.
- Figure out implied rough weightings that allow the two to match.
- This is a high-level idea, figure out how to do this and serve up a preview upfront of how many ratings of each type are necessary.
- **(follow-up)** Implement as a new section within the "Tools" section of the evolution admin dash left nav.
- **(follow-up)** Be able to save the final implied-rubric output as a new rubric in the system.

## Problem
The existing `evolution_judge_rubrics` system requires an admin to type each dimension's weight by hand. There is no data-driven way to discover the weighting that reflects a person's revealed preferences. We need to (a) collect human per-criterion gradings and human pairwise winner choices over a shared article pool, (b) fit non-negative weights `w` so the weighted per-criterion score difference predicts the pairwise winner, (c) preview the data volume required before the user invests effort and refine it live, and (d) save the fitted weights as a real judge rubric. K (criteria count) is small (≈3–8), so the statistics are light; the work is data-collection ergonomics, identifiability handling, the preview, and the save-as-rubric integration.

## Confirmed design decisions (from research + user)
- **Article pool source:** sample variants from a chosen **arena topic** (`evolution_prompts` / `evolution_variants`), reusing the Judge-Lab seeding path (`evolution/src/lib/judgeEval/seed.ts` pull + snapshot pattern). Snapshot content + `mu`/`sigma`.
- **Infer scope:** weights for an **admin-chosen criteria set**. Near-zero inferred weights are surfaced as "this criterion barely matters" (free pruning byproduct) — no automatic criterion discovery in v1.
- **New tables**, not an extension of `judge_eval_*` (human inputs don't fit the LLM-verdict call shape). Mirror the Judge-Lab *spine* (session → article pool → input rows) and the `evolution_judge_rubrics` migration *template* (RLS + `is_test_content` trigger + soft-delete).
- **Stats:** hand-rolled non-negative logistic / Bradley–Terry fit on per-criterion score-difference features — **no new dependency** (none exists; `package.json` has no LA/optimization lib). Reuse `createSeededRng` + the bootstrap-percentile idiom (`evolution/src/lib/metrics/experimentMetrics.ts`) for coefficient CIs and the sample-size simulation; copy the sigmoid from `swissPairing.ts` and the logit-clamp from `judgeEval/metrics.ts`.
- **Weight semantics (load-bearing):** output **non-negative, sum-to-1 relative** weights. `normalizeDimensions` in `rubricJudge.ts` clamps negatives to 0 and renormalizes to sum-1 at read time, so the fit MUST produce non-negative weights (softmax-parameterize or clamp-and-refit) or they'll be silently zeroed downstream.
- **Save-as-rubric:** call the existing `createJudgeRubricAction({ name, label?, description?, dimensions: [{criteria_id, weight, position}] })` (`evolution/src/services/judgeRubricActions.ts`). Raw weights are fine — the system normalizes at read. Closes the loop into rubric-based judging (`EVOLUTION_RUBRIC_JUDGING_ENABLED`).
- **Server actions only** (no long-running LLM ⇒ no API route, no cost-cap gate). All `adminAction`-wrapped. New route auto host-gated + admin-gated (no middleware/layout change).

## Options Considered
- [x] **Statistical model — continuous logistic on score-deltas (CHOSEN)**: feature = `s(a) − s(b)` (per-criterion grade differences), label = pairwise winner; fit non-negative `w`, renormalize to sum-1. Matches the "grade on components + which is better → implied weights" framing. *Note:* production judging discretizes each dimension to A/B/TIE before weighting (`rubricJudge.scorePass`), so the continuous fit is a deliberate approximation of that voting process — acceptable for "rough" weights.
- [ ] **Discretized per-dimension voting fit**: train on per-dimension winners (A/B/TIE) instead of raw deltas, exactly matching `scorePass`. More faithful but needs the grader to effectively pick a per-criterion winner per pair; rejected for v1 (the brief says grade articles *separately*, i.e. absolute per-criterion scores, not per-pair dimension winners).
- [x] **New `evolution_weight_inference_*` tables (CHOSEN)** vs. extending `judge_eval_*` (rejected — shape mismatch).
- [ ] **Bayesian/full-posterior weights** — richer uncertainty; deferred. Bootstrap CIs cover v1.

## Architecture (proposed)

```
Admin → "Implied Rubric Weights" (Tools nav)
  1. New session: pick arena topic + criteria set + sample size
        → seed article pool (snapshot N variants) + show UPFRONT ratings-needed preview
  2. Two independent input streams over the pooled articles ("separately"):
        • Grade panel    → per-criterion score (uses each criterion's [min,max] + evaluation_guidance anchors)
        • Compare panel  → pairwise A/B/Tie winner
  3. Fit (local, hand-rolled): X = per-pair score-deltas, y = winner
        → non-negative sum-1 weights + bootstrap CIs + collinearity / "barely matters" flags
        → LIVE preview: weights+CIs now, "≈X more comparisons to converge"
  4. Export → createJudgeRubricAction(weights) → new evolution_judge_rubrics row
        → usable by rubric-based LLM judging
```

### New tables (migration `20260619000001_evolution_weight_inference.sql`, transactional + idempotent + RLS template)
- `evolution_weight_inference_sessions` — `id`, `name UNIQUE`, `description`, `status`, `prompt_id` (arena topic; bare UUID snapshot), `sample_size`, `is_test_content` (name trigger), `archived_at`, `deleted_at`, `created_at`, `updated_at`.
- `evolution_weight_inference_criteria` — junction `(session_id→sessions CASCADE, criteria_id→evolution_criteria RESTRICT, position)` PK `(session_id, criteria_id)`. The chosen criteria set (no weight column — weight is the OUTPUT).
- `evolution_weight_inference_articles` — pooled article snapshots: `id`, `session_id CASCADE`, `variant_id` (bare UUID), `label`, `content` (snapshot), `mu`/`sigma`/`elo` (snapshot, UNCONSTRAINED NUMERIC), `position`; UNIQUE `(session_id, label)`.
- `evolution_weight_inference_gradings` — human per-criterion grades: `id`, `session_id CASCADE`, `article_id→articles CASCADE`, `criteria_id` (bare UUID) + `criteria_name` snapshot, `score NUMERIC`, `rater_id`, `created_at`; UNIQUE `(session_id, article_id, criteria_id, rater_id)` (upsert latest-wins).
- `evolution_weight_inference_preferences` — human pairwise labels: `id`, `session_id CASCADE`, `article_a_id`, `article_b_id`, `winner CHECK ('a','b','tie')`, `rater_id`, `created_at`; UNIQUE `(session_id, article_a_id, article_b_id, rater_id)` storing canonical (min,max) order to dedupe.
- RLS per table: `deny_all` + `service_role_all` + DO-guarded `readonly_select`, then `REVOKE ... FROM PUBLIC, anon, authenticated`. `is_test_content` trigger reusing `evolution_is_test_name(NEW.name)` on the name-bearing `sessions` table.
- Zod `…InsertSchema` + `…RowSchema` + `z.infer` pairs in `evolution/src/lib/schemas.ts`. `npm run db:types` after apply.

### Statistics core (`evolution/src/lib/weightInference/`, no new deps)
- `fitWeights(gradings, preferences, criteriaIds, opts)` → `{ weights:[{criteriaId,weight}] (non-neg, sum-1), logLik, trainAccuracy, heldOutAccuracy?, collinearity, perWeightCI }`. Non-negative logistic/BT (softmax-param or clamp-refit) with L2 reg; sigmoid per `swissPairing.ts`, logit clamp per `judgeEval/metrics.ts`. Only pairs whose BOTH endpoints are fully graded enter X; ties dropped (noted).
- `weightCIs(...)` → non-parametric bootstrap over labelled pairs (resample+refit, 2.5/97.5 pct) reusing `createSeededRng` + the percentile idiom; returns `MetricValue` per weight.
- `requiredRatings(K, targets)` (upfront rule-of-thumb: pairs ≥ ~10–15×K + enough graded articles to cover them) and `estimateRemaining(currentData, targets)` (live, simulation-backed) + collinearity/identifiability detection (criteria whose Δscores never vary independently can't be separated → warn).

### Server actions (`evolution/src/services/weightInferenceActions.ts`, all `adminAction`)
- `createWeightInferenceSessionAction({name, promptId, criteriaIds, sampleSize?})` — seeds article pool from the topic's variants; validates criteria via `validateCriteriaIds`.
- `listWeightInferenceSessionsAction`, `getWeightInferenceSessionDetailAction`.
- `getWeightInferencePreviewAction({sessionId|K, targets})` — upfront + live ratings-needed.
- `recordGradingAction(...)` (upsert), `recordPreferenceAction(...)` (upsert).
- `getNextGradingTargetAction` / `getNextPairAction` — prioritize ungraded articles / informative pairs.
- `getWeightInferenceFitAction({sessionId})` — current weights + CIs + warnings + coverage + accuracy.
- `exportWeightInferenceRubricAction({sessionId, rubricName, label?, description?})` — fit → `createJudgeRubricAction(...)` → returns new rubric id (the **save-as-rubric** requirement).

### Admin UI (`src/app/admin/evolution/weight-inference/`)
- Sessions landing + new-session dialog (topic + criteria multi-select + sample size; shows upfront preview).
- Session detail: **Grade** panel (article + per-criterion inputs with `evaluation_guidance` anchor tooltips), **Compare** panel (A vs B via `SideBySideWordDiff`; A/B/Tie), **Progress/Preview** (counts vs needed, live), **Results** (weight bars + CI whiskers via `MetricGrid`/small chart, collinearity + "barely matters" flags, train/held-out accuracy), **Export to rubric** dialog.
- Nav: append one `NavItem` to the **Tools** group in `src/components/admin/EvolutionSidebar.tsx` (`href:'/admin/evolution/weight-inference'`, `testId:'evolution-sidebar-nav-weight-inference'`). Midnight Scholar tokens; obey design-system ESLint rules.
- Kill switch: `EVOLUTION_WEIGHT_INFERENCE_ENABLED` (default on; `'false'` ⇒ actions reject / nav item inert), mirroring the prompt-editor/feature-flag convention.

## Phased Execution Plan

### Phase 1: Migration + schemas + statistics core
- [ ] Migration `20260619000001_evolution_weight_inference.sql` (5 tables, RLS, `is_test_content` trigger, indexes incl. `…_non_test`) — passes `lint-migrations-idempotent.ts` + `migration:verify`.
- [ ] Zod schemas in `evolution/src/lib/schemas.ts` (Insert/Row pairs + `z.infer` types).
- [ ] `evolution/src/lib/weightInference/{fit,ci,sampleSize}.ts` with unit tests (recover known weights from synthetic data within tolerance; non-neg + sum-1; collinear/zero-variance flagged; ties dropped; degenerate too-few-labels → wide CIs not NaN; `requiredRatings` monotonic in K + target precision).

### Phase 2: Server actions + persistence
- [ ] `evolution/src/services/weightInferenceActions.ts` — all actions above (`adminAction`-wrapped, Zod-validated inputs, kill switch).
- [ ] Topic→article seeding (snapshot variants), grading/preference upserts, fit-on-read, export-to-rubric (`createJudgeRubricAction`).
- [ ] Integration test: create session → grade + pairwise → fit → export to `evolution_judge_rubrics`; RLS + `[TEST_EVO]` FK-safe cleanup.

### Phase 3: Admin UI + nav
- [ ] Pages under `src/app/admin/evolution/weight-inference/` (+ `loading.tsx`); Tools nav entry.
- [ ] Grade / Compare / Preview / Results / Export panels per the design above.

### Phase 4: Integration + docs + rollout
- [ ] Verify exported rubric drives rubric-based judging end-to-end; kill switch + host/admin gating confirmed.
- [ ] Fill `evolution/docs/implicit_rubric_weights.md`; update relevant docs (see below).

## Testing

### Unit Tests
- [ ] `evolution/src/lib/weightInference/fit.test.ts` — recovers known weights from synthetic gradings+labels; non-neg + sum-1; tie handling; collinear/zero-variance criteria flagged; degenerate inputs return wide CIs not NaN.
- [ ] `evolution/src/lib/weightInference/sampleSize.test.ts` — `requiredRatings` monotonic in K and target precision; simulation estimate within tolerance (seeded RNG, deterministic).

### Integration Tests
- [ ] `src/__tests__/integration/evolution-weight-inference.integration.test.ts` — session → gradings + preferences → fit → `exportWeightInferenceRubricAction` writes a valid `evolution_judge_rubrics` row; RLS enforced; `[TEST_EVO]` FK-safe cleanup (sessions → criteria/articles/gradings/preferences cascade; created rubric removed).

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-weight-inference.spec.ts` (`@evolution`) — open tool from Tools nav, create session, grade an article, choose a pairwise winner, see preview update, view inferred weights, export to rubric (assert the rubric appears under Judge Rubrics). `resetFilters()` after nav; `afterAll` cleanup (imports a DB tool ⇒ required).

### Manual Verification
- [ ] Seed synthetic known-preference data; confirm inferred weights match intuition and the preview's estimate roughly predicts data-to-converge; confirm exported rubric is selectable in a strategy.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Drive the new tool on the local tmux server (`ensure-server.sh`): Tools nav → new session → grade → pairwise → live preview → results → export to rubric → verify rubric on `/admin/evolution/judge-rubrics`.

### B) Automated Tests
- [ ] `npm run test:unit -- --grep "weightInference"` and `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-weight-inference.spec.ts`

## Documentation Updates
- [ ] `evolution/docs/implicit_rubric_weights.md` — NEW deep dive (fill in during implementation)
- [ ] `evolution/docs/rating_and_comparison.md` — inferred-weights path feeding Rubric-Based Judging weights
- [ ] `evolution/docs/criteria_agents.md` — criteria as the graded components
- [ ] `evolution/docs/data_model.md` — new `evolution_weight_inference_*` tables + RLS
- [ ] `evolution/docs/arena.md` — human pairwise labels vs. LLM arena comparisons; topic-as-article-pool sourcing
- [ ] `evolution/docs/visualization.md` — new Tools page + nav entry
- [ ] `docs/feature_deep_dives/judge_evaluation.md` — relationship to Judge Lab seeding/test-set pattern
- [ ] `docs/docs_overall/architecture.md` — DB schema table list
- [ ] `evolution/docs/reference.md` — new env-var/kill-switch (`EVOLUTION_WEIGHT_INFERENCE_ENABLED`), files, server actions

## Review & Discussion
[Populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
