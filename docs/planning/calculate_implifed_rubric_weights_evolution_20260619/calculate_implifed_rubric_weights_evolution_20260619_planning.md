<!-- Implementation plan for inferring implicit rubric criteria weights from human pairwise preferences + per-criterion gradings. -->

# Calculate Implied Rubric Weights (Evolution) Plan

## Background
Allow user preferences to support implicitly calculating implicit rubric criteria and weights. Instead of an admin hand-setting each judging dimension's weight, infer rough weights from two human inputs — (1) which of a pair of articles is better, and (2) per-criterion grades on individual articles — and find the weighting that best reconciles them. Show an upfront preview of how many ratings of each type are needed.

## Requirements (from GH Issue #NNN)
- Let user choose which variant is better, for a given pair.
- Let user grade articles on rubric components, separately.
- Figure out implied rough weightings that allow the two to match.
- This is a high-level idea, figure out how to do this and serve up a preview upfront of how many ratings of each type are necessary.

## Problem
The existing `evolution_judge_rubrics` system requires an admin to manually type each criterion's weight. There is no data-driven way to discover what weighting actually reflects a person's revealed preferences. We need to (a) collect human per-criterion gradings and human pairwise winner choices, (b) fit weights `w` so the weighted score difference predicts the pairwise winners, and (c) preview the data volume required before the user invests effort. K (criteria count) is small (≈3–8), so the statistics are light; the work is data-collection ergonomics, identifiability handling, and a clean preview.

## Options Considered
- [ ] **Option A: Logistic regression on score-difference features**: feature = `s(a) − s(b)`, label = pairwise winner; fit `w` by (regularized) logistic regression / Bradley–Terry; renormalize to non-negative sum-to-1 weights. Hand-rolled IRLS or gradient descent in TS (K small ⇒ no heavy dep). Preview via closed-form rule-of-thumb + live CI refinement. *(Leading candidate — simplest, interpretable, matches the "make the two match" framing exactly.)*
- [ ] **Option B: Constrained quadratic/convex fit (non-neg, sum-to-1 simplex)**: directly optimize weights on the simplex (projected gradient) maximizing pairwise-agreement. More faithful "rubric weight" semantics; slightly more code than A.
- [ ] **Option C: Bayesian / bootstrap weight posterior**: reuse the repo's bootstrap-CI machinery to produce weight CIs + the sample-size preview from simulation. Richest uncertainty story; heaviest. Possibly layer on top of A/B for the preview only.
- [ ] **Option D: Reuse Judge Lab tables vs. new dedicated tables**: extend `judge_eval_*` with a human-label + grading dimension vs. add new `evolution_weight_inference_*` tables. (Cross-cutting decision — affects every phase.)

## Phased Execution Plan

> Phases below are a first-pass skeleton to be refined after `/research` (code-level confirmation of integration seams) and `/plan-review`. Each phase ends with lint + tsc + build + tests green (per CLAUDE.md).

### Phase 1: Data model + statistics core (no UI)
- [ ] Decide table strategy (Option D) and write migration(s) for: human per-criterion gradings, human pairwise labels, and a "weight-inference run" entity. Follow evolution RLS pattern (deny-all + `service_role_all` + `readonly_local`) and migration-idempotency lint.
- [ ] Implement the weight-fit function (Option A/B) in `evolution/src/lib/` with full unit tests (synthetic data where true weights are known → recovered within tolerance; collinearity/degenerate cases flagged).
- [ ] Implement the sample-size/preview estimator (`requiredRatings(K, targets)`), unit-tested against simulated data.

### Phase 2: Server actions + persistence
- [ ] `adminAction`-wrapped server actions: create inference run, record a grading, record a pairwise label, fetch current fit + CIs + preview, export inferred weights to an `evolution_judge_rubric`.
- [ ] Pair/article sourcing (seed from `evolution_arena_comparisons` / an arena topic, mirroring Judge Lab pair-banks).
- [ ] Integration tests (real DB) for the persistence + fit-on-read path.

### Phase 3: Admin UI
- [ ] Pairwise "which is better?" chooser (A/B/tie), per-criterion grader (uses each criterion's `[min,max]` + `evaluation_guidance` anchors), upfront + live sample-size preview, inferred-weights results view (weights + CIs + collinearity/zero-weight warnings), "Export to rubric" action. Midnight Scholar tokens; obey design-system ESLint rules.
- [ ] Wire into the evolution "Tools" sidebar group + a dashboard card (mirror Judge Lab / Match Viewer placement).

### Phase 4: Integration + docs + rollout
- [ ] Close the loop: exported rubric usable by rubric-based judging; kill switch / feature gate consistent with `EVOLUTION_*_ENABLED` conventions.
- [ ] Fill in `evolution/docs/implicit_rubric_weights.md`; update relevant docs (see Documentation Updates).

## Testing

### Unit Tests
- [ ] `evolution/src/lib/<weightFit>.test.ts` — recovers known weights from synthetic gradings+labels; non-negativity/sum-to-1; tie handling; collinear/zero-variance criteria flagged; degenerate (too-few-labels) returns wide CIs not NaN.
- [ ] `evolution/src/lib/<sampleSize>.test.ts` — `requiredRatings` monotonic in K and in target precision; simulation-backed estimate within tolerance.

### Integration Tests
- [ ] `src/__tests__/integration/evolution-weight-inference.integration.test.ts` — create run → record gradings + pairwise labels → fit → export to `evolution_judge_rubrics`; RLS + `[TEST]`/`[TEST_EVO]` cleanup (FK-safe).

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-weight-inference.spec.ts` (`@evolution`) — grade an article, choose a pairwise winner, see preview update, view inferred weights, export to rubric. `resetFilters()` + `afterAll` cleanup per testing rules.

### Manual Verification
- [ ] Seed known-preference synthetic data, confirm inferred weights match intuition and the preview's estimate roughly predicts the data needed to converge.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Drive the new admin page on the local tmux server (`ensure-server.sh`): grade → pairwise pick → preview → inferred weights → export.

### B) Automated Tests
- [ ] `npm run test:unit -- --grep "weight"` and `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-weight-inference.spec.ts`

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/implicit_rubric_weights.md` — NEW deep dive (this feature) — fill in during implementation
- [ ] `evolution/docs/rating_and_comparison.md` — note inferred-weights path feeding the Rubric-Based Judging weights
- [ ] `evolution/docs/criteria_agents.md` — criteria as the graded components
- [ ] `evolution/docs/data_model.md` — new tables (human gradings / pairwise labels / inference run) + RLS
- [ ] `evolution/docs/arena.md` — human pairwise labels vs. LLM arena comparisons
- [ ] `evolution/docs/metrics.md` — any new metrics (fit quality, label counts)
- [ ] `evolution/docs/visualization.md` — new admin page + Tools nav entry
- [ ] `docs/feature_deep_dives/judge_evaluation.md` — relationship to Judge Lab pair-banks/test-sets
- [ ] `docs/docs_overall/architecture.md` — DB schema table list

## Review & Discussion
[Populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
