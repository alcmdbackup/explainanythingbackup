# Implied Rubric Evolution Fixes Progress

## PR-A — functional fixes (Phases 1, 2, 3, 5, 6) — DONE & verified
### Work Done
- **Phase 1 (Q1):** `getWeightInferencePreviewAction` now returns the exact
  `matchesToJudge = min(C(M,2), requiredRatings(K).pairs)` with server-counted `M` (topic) /
  frozen-pair count (test set), plus `poolSize`, `avgArticleChars`, `bindingLimit`. Added
  shared `resolveTestSetPool`/`topicPoolStats`/`pairsFromPool`/`distinctPairCount` helpers
  (create-session refactored onto `resolveTestSetPool`). New-session form preview re-fires on
  pool/topic/source changes and shows the binding-limit explainer (`wi-match-breakdown`).
- **Phase 2 (Q2):** `estimateAutoRunCost` in `autoCost.ts` (chars-based `getModelPricing`;
  2 holistic + 2 rubric calls; `perCallUsd = totalUsd/plannedCalls`; NaN/empty guard). Live
  `$` line in the form (`wi-cost-estimate`). Cost cap ACTIVATED — `perCallUsd` wired into
  `assertWithinWeightInferenceAutoCap` at `autoRun.ts` (per-chunk) + a whole-run pre-flight in
  `createWeightInferenceSessionAction`.
- **Phase 3 (Q3/Q4):** `implicit_rubric_weights.md` — "how it's implied + weights sum to 1" +
  arena-topic flow + preview/cost sections. In-UI explainer (intro paragraph).
- **Phase 5:** A/B → Left/Right on cards + overall + dim buttons (display-only; `'a'|'b'|'tie'`
  wire unchanged — locked by existing `orientToCanonical` tests). Reversal-replica notice
  (`wi-replica-notice`).
- **Phase 6:** Results legend (`wi-results-legend`).
- Stale "human verdicts" copy → "human or LLM-judged" (form intro + comment + sidebar).

### Tests
- Unit: `autoCost.test.ts` — `estimateAutoRunCost` (single-source identity, NaN guard,
  scaling, model pricing). All 52 weightInference unit tests pass.
- Integration: extended `evolution-weight-inference.integration.test.ts` — preview both
  binding cases (28 pool-bound / 24 recommendation-bound), `variant_kind` filter, avg size.
  Ran against real dev DB: 5/5 pass.

### Verification
lint ✓ · typecheck ✓ · build ✓ · unit (52) ✓ · integration (5) ✓

## PR-B — evolution-wide terminology rename (Phase 4) — DONE & verified (E2E gate pending in CI)
### Work Done
Display-copy only: unit → "match" (retiring "comparison"/"pair"; "Pair Banks" label →
"Match Banks", route unchanged), judgment → "winner" ("verdict"/"is better" → "wins").
10 files: judge-lab (page, pair-banks, agreement ×2, eval-run + matches views), match-detail,
strategy wizard, invocation/timeline tabs. Done by 3 rule-bound subagents + central review.
Identifiers, data-testids, DB columns, route paths, wire enums, and Elo "rating" untouched
(diff is balanced 48/48 string swaps). Fixed the one stale E2E text assertion
(budget-dispatch). Weight-inference UI/docs already aligned to match/winner in PR-A.

### Verification
typecheck ✓ · lint ✓ · build ✓ · check:stale-specs ✓ · renamed-component unit tests (34) ✓.
**Remaining gate:** full `npm run test:e2e:evolution` — the plan's PR-B safety net — must run
in CI (needs a running app + seeded admin data; not reliably runnable locally here).

## Notes / deviations
- Single feature branch holds both PR-A and PR-B as separate commits (the "two PRs" split is
  preserved at commit granularity; can be split into two GitHub PRs at finalize if desired).
- Deep technical docs (`visualization.md`, `rating_and_comparison.md`) retain "comparison"/
  "verdict" prose where it maps to code identifiers — left to avoid doc/code drift.
- No schema/migration changes. Riskiest change (Q2 cap activation) is config-revertible.
