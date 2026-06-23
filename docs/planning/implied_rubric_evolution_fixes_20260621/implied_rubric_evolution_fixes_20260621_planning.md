# Implied Rubric Evolution Fixes Plan

## Background
A collection of fixes for implied rubric. (More to be added later.)

## Requirements (from GH Issue #1245)
1. **(Q1 — bug)** How many matches are held when you select "article mode" with N
   articles? The preview text doesn't fully update so it's hard to tell.
2. **(Q2 — feature)** Add a cost preview to see how much the auto run will cost with
   different models.
3. **(Q3 — clarify)** Explain how the rubric is "implied". Will all weights add up to 1?
   Should they?
4. **(Q4 — clarify)** How does it work when we select an arena topic?

*(More requirements to be added later.)*

## Problem
The Implicit/Implied Rubric Weights new-session UX is unclear and incomplete: the
ratings-needed preview ignores the article pool size and the `min(C(M,2), 12·K)` cap, so
it overstates/under-reflects how many matches will actually be judged (Q1); there's no
dollar cost estimate for auto runs across models, only a raw LLM-call count (Q2); and the
"implied" mechanism + arena-topic flow are under-documented (Q3/Q4). See the research doc
[Findings](./implied_rubric_evolution_fixes_20260621_research.md#findings-answers-to-the-current-requirements)
for full analysis. Fixes must preserve the non-negative, sum-to-1 weight invariant and the
canonical pair-orientation contract.

## Options Considered
- [x] **Option A: Per-fix incremental phases**: Treat each requirement as its own phase
  with its own tests; commit independently. (Likely fit — "collection of fixes".)
- [x] **Option B: Grouped by subsystem**: Batch fixes by layer (preview action, form UI,
  cost helper, docs).
- [x] **Option C: TBD**: Revisit as more requirements are added.

## Phased Execution Plan

### Sequencing & PR split (DECISION, from plan-review)
- **Two PRs.** PR-A = functional fixes (Phases 1, 2, 3, 5, 6). PR-B = the evolution-wide
  terminology rename (Phase 4) on its own, landed AFTER PR-A. Rationale: the rename touches
  ~40 tsx files + many `@evolution` specs; isolating it keeps both diffs reviewable/revertible
  and stops a broad copy churn from masking functional regressions.
- **Dependency gate:** Phase 2 (cost preview) depends on Phase 1's extended preview action
  (they share one server round-trip for real article sizes) — do Phase 1 first.

### Phase 1: Fix the new-session preview (Q1) — DECISION: accurate server-side M
- [x] Extend `getWeightInferencePreviewAction` to accept `promptId` + `sampleSize` (topic)
  / `testSetId` + `pairKind` (test set) and return the **exact** materializable pair count
  `min(C(M,2), requiredRatings(K).pairs)`, where `M` = actual `synced_to_arena` article
  variants for the topic capped at `sampleSize`. (Chosen over the client-only
  `min(C(sample_size,2), …)` upper bound because the complaint is that the preview is
  *misleading* — an upper bound can still overstate when the topic has fewer variants than
  the pool size. One round-trip already happens on topic change; reuse it.)
- [x] Add `sampleSize`, `topicId`, `sourceKind`/`testSetId`/`pairKind` to the preview
  `useEffect` deps (`page.tsx:97`) so it re-fires when any of them change
- [x] Clarify preview copy so "recommended" vs "will actually judge" are distinct
- [x] **Explain the match-count math in the UI** so the user can see *why* a given
  number of matches is held. Show the actual figure plus a plain-language breakdown of
  `min( C(M,2), max(20, 12·K) )`, e.g.:
  > "Judging **45** matches: your pool of **10** articles allows **45** distinct matches
  > (10×9÷2), which is fewer than the **48** recommended for 4 criteria (12 per
  > criterion, min 20) — so all 45 will be judged."
  and the inverse when the recommendation binds:
  > "Judging **48** matches: that's the recommended **48** for 4 criteria (12 per
  > criterion, min 20); your pool of 30 could supply up to 435 distinct matches."
  Surface which term is binding (pool vs recommendation), and pair it with a small
  help tooltip defining "match" (= an article pairing, `C(M,2)`) and the 12-per-criterion rule.
- [x] Add a unit test asserting the displayed/derived match count equals
  `min(C(M,2), requiredRatings(K).pairs)` across the binding-by-pool and
  binding-by-recommendation cases
- [x] **Handle BOTH sources:** the topic branch returns `min(C(M,2), requiredRatings(K).pairs)`
  with server-counted `M`; the **test_set** branch returns the exact frozen-pair count for the
  chosen `pair_kind` (it judges every frozen pair, ignoring the K-recommendation) — don't leave
  test_set showing the misleading K-based number.
- [x] **Keep the security envelope:** the extended action stays `adminAction`-wrapped and keeps
  `assertEnabled()`; the new topic-count read must filter exactly like the create-session pool —
  `.eq('prompt_id', topicId).eq('synced_to_arena', true).eq('variant_kind', pairKind).is('archived_at', null)`
  capped at `sampleSize`. NOTE: the existing `getArenaCountForPromptAction` does NOT filter by
  `variant_kind`, so it over-counts — do not naively reuse it.
- [x] **Lightweight query:** count + size aggregate only, NOT full article bodies — the preview
  re-fires on every form change, so it must not ship 30–100 article bodies to the client. NOTE:
  PostgREST aggregate + `.limit()` interact awkwardly; the safe shape is a narrow
  `select('id, variant_content')`-style read of just the top-`sampleSize` rows and compute
  `char_length` avg in JS (or an RPC), rather than a server-side SQL `AVG` over a limited set.
- [x] Define the explicit input schema (`{ sessionId? | (promptId, sampleSize, pairKind) | (testSetId, pairKind) , criteriaCount, replicationRate }`)
  and return shape (add `matchesToJudge` and `avgArticleChars`/aggregate for Phase 2)

### Phase 2: Auto-run cost preview across models (Q2) — DECISION: tight projection, reuse infra
Pre-run estimate on the **new-session form only** (the session-detail page already shows
*actual* spend via `getWeightInferenceProgressAction.spendUsd`).

**Resolved design decisions (from plan-review):**
- **One cost API, not two.** Size inputs in **chars** and price via the chars-based path
  `calculateCost(inputChars, outputChars, getModelPricing(model))` — the SAME convention
  `estimateCosts.ts` / `createEvolutionLLMClient.ts` use (`Math.ceil(chars/4)` baked in). Do
  NOT also route through token-based `calculateLLMCost` (the earlier plan conflated the two).
- **Module placement:** the helper lives in `evolution/src/lib/weightInference/autoCost.ts`
  (co-located with the existing cap logic + `autoCost.test.ts`), since the 4-call shape is
  weight-inference-specific and this keeps estimate + cap in one module.
- **No heavy imports.** Do NOT import `buildComparisonPrompt`/`buildRubricComparisonPrompt`
  (they pull the `computeRatings`/`rubricJudge` graph into the form's server action). Instead
  approximate each call's input chars as `articleA+articleB chars + a measured fixed overhead`
  per call-type (holistic vs rubric); define the two overhead constants from a one-off
  measurement and comment them. (Mirrors `strategyPreviewActions.ts`' lazy/decoupled discipline.)
- [x] Add a pure `estimateAutoRunCost({ matches, repeats, model, avgArticleChars, criteriaCount })`
  → `{ totalUsd, perCallUsd }`. It prices the real per-pair shape: **2 holistic calls** +
  **2 larger rubric calls** (rubric overhead scales with `criteriaCount`) × `repeats`, summed
  over `matches`, with a small fixed output-char estimate. `perCallUsd = totalUsd / plannedCalls`
  (`plannedCalls = matches × repeats × 4`) — the single scalar the cap needs. Pure + unit-tested.
- [x] **Guard degenerate inputs:** if `matches`/`avgArticleChars` is 0/NaN/null (empty pool,
  null content), return `{ totalUsd: 0, perCallUsd: 0 }`. (Note: the chars-based `calculateCost`
  does NOT throw on non-finite input — `Math.ceil(NaN/4)` PROPAGATES NaN and silently returns
  NaN, which blanks the form; the guard prevents that. Only the unused token-based
  `calculateLLMCost` throws.)
- [x] Feed the projection with **real article sizes** from the Phase-1 preview action's
  aggregate (`avgArticleChars`) so the figure reflects this topic/test-set's actual content.
- [x] **Cost-cap unification — TREAT AS A SERVER BEHAVIOR CHANGE, not just display.** Today
  `autoRun.ts:132` calls `assertWithinWeightInferenceAutoCap` WITHOUT `estCostPerCall`, so the
  `WEIGHT_INFERENCE_AUTO_MAX_USD` ($5) cap is **dormant** (only the 8000-call ceiling fires).
  Wiring `perCallUsd` in ACTIVATES that hard gate (it can now throw `WeightInferenceAutoCapError`
  mid-run). Sub-tasks:
  - [x] Compute `perCallUsd` INSIDE `runAutoChunk` (`autoRun.ts:132` — the ONLY caller of
    `assertWithinWeightInferenceAutoCap`; the API route reaches the cap only transitively through
    it) from the model + per-chunk article sizes it already loads (`judgeModel`/`repeats` at
    `autoRun.ts:66-67`, article content per-chunk at `:135+`). There is no separate route call site.
  - [x] Reconcile **per-chunk vs whole-run** semantics: the cap evaluates per chunk on
    `remainingPairs` (≤ `getAutoChunkPairs()`=40), so it can never see the whole run; the form's
    whole-run "≈ $X" is informational. Add the **whole-run** ≤ `WEIGHT_INFERENCE_AUTO_MAX_USD`
    pre-flight check in `createWeightInferenceSessionAction` (it knows total materialized matches
    M + repeats) and/or the route's first invocation, surfacing "exceeds the $N cap — reduce
    pool/repeats or raise the cap" BEFORE starting, so activation never surprises a user mid-run.
  - [x] Keep the estimate conservative-but-not-inflated (an over-estimate would now block
    legitimate runs); document the overhead constants' basis.
- [x] Render a live "≈ $X.XX with <model>" line (auto mode), `data-testid="wi-cost-estimate"`,
  updating with model / repeats / pool / criteria, alongside the existing LLM-call count.
- [x] Note: registry pricing has separate cache-hit input (`cachedInputPer1M`); ignore caching
  (rubric prompts carry per-match-distinct article content, so real cache hits are negligible) —
  label the figure an upper-bound estimate.

### Phase 3: Document "implied" mechanism + arena-topic flow (Q3, Q4)
- [x] Update `evolution/docs/implicit_rubric_weights.md` with the "how it's implied" +
  "weights sum to 1 (and should)" explanation and the arena-topic walkthrough
- [x] Surface a short in-UI explainer (tooltip/help text) so the question doesn't recur

---

> **Phases 4–6 below are the CONFIRMED UX items** (2026-06-21 4-agent review + user scoping).
> The remainder of the sweep is **Deferred** (end of this section); full findings live in the
> research doc [UX review findings](./implied_rubric_evolution_fixes_20260621_research.md#ux-review-findings-2026-06-21-4-agent-sweep--deduplicated).

### Phase 4: Evolution-wide terminology + stale copy — CONFIRMED: whole evolution (separate PR-B)
Scope: **all evolution user-facing copy + docs** — never DB columns, type names, code
identifiers, or API fields; keep Elo **"rating"** (a score) untouched. Hand-review each hit
(~40 tsx files: arena, runs, comparison/match views, judge-eval, dashboards,
weight-inference) — NOT a regex sweep (avoids clobbering legit "rating" / entity names).
- [x] **Enumerate the surface first (committed checklist).** Generate the work-list with a
  discovery grep and paste the file list into this plan so nothing is missed, e.g.:
  `grep -rlnE "is better|\bcomparison|\bpair|\bverdict|Article [AB]" src/app/admin/evolution src/components evolution/src/components src/__tests__/e2e/specs`
  (run the same over `evolution/docs/` for prose). Track each file as a checkbox.
- [x] Standardize the head-to-head **unit** → **"match"** in all evolution UI copy
  (retire "comparison" and "pair" as user-facing nouns). Where the replica-inflated count
  appears, spell it out, e.g. "46 matches (40 base + 6 reversal re-checks)".
- [x] Standardize the **judgment** → **"winner"** everywhere (converge "verdict", the
  judgment-sense of "rating", and "A/B is better"). Leave Elo "rating" (the score) alone.
- [x] Fix stale "human verdicts" framing → "human or LLM-judged": intro `page.tsx:174-175`,
  sidebar `EvolutionSidebar.tsx:43`, top-of-file comment `page.tsx:1-3`.
- [x] Update evolution docs to the same vocabulary (match / winner).
- [x] **Do NOT touch these load-bearing identifiers** (regression contracts): the
  `Verdict3` `'a'|'b'|'tie'` wire values; `onScreenWinner`/`overall_winner`/`forward_winner`/
  `reverse_winner`; `source` `'human'|'llm'`; `shown_swapped`; the `RequiredRatings`
  `{ pairs, comparisons, verdicts }` field names + `requiredRatings()`; all `data-testid`s
  (e.g. `wi-recommended`, `wi-source-topic`); and Elo `rating`/`mu`/`sigma`. Verify per-file
  that only display strings change.
- [x] **Verification gate = the actual suites, not stale-specs.** `npm run check:stale-specs`
  ONLY catches removed `data-testid`s — it does NOT catch stale TEXT assertions left by the
  rename. The real guard is running the full `@evolution` E2E (`npm run test:e2e:evolution`)
  + unit suites and fixing every text-assertion failure. Update those specs/snapshots; prefer
  re-anchoring assertions on `data-testid` over visible text where practical.

### Phase 5: Judging-flow data-quality fixes (`[sessionId]/page.tsx`)
- [x] Replace "Article A/B" with **Left / Right** on the cards, the overall buttons, AND the
  per-criterion (dim) buttons (`[sessionId]/page.tsx` ~285-297, same `'a'|'b'|'tie'` wire) →
  "Left wins" / "Right wins" / "Tie" (consistent with the "winner" term). The buttons already
  send on-screen values where `'a'`=left / `'b'`=right and the server
  `orientToCanonical(raw, shown_swapped)` flips to canonical — so this is **display-only**.
  **CRITICAL GUARD:** do NOT rename the `'a'|'b'|'tie'` wire enum or the `onScreenWinner` field;
  "Left wins" must still submit `'a'`.
- [x] Add a guard test asserting "Left wins" → recorded canonical winner is unchanged from the
  pre-relabel behavior (catches anyone "fixing" the enum alongside the label = silent winner
  inversion).
- [x] Name the E2E target: update the human-judging spec to click "Left wins"/"Right wins"/"Tie"
  (not "A is better") — `data-testid`-anchored where possible.
- [x] Surface the reversal-audit replica as an intentional re-check (note/badge,
  `data-testid="wi-replica-notice"`) so the repeated, side-swapped match doesn't read as a
  duplicate/bug and is judged independently.

### Phase 6: Results legend (reinforces Q3)
- [x] Add a legend on the results panel (`data-testid="wi-results-legend"`): a match's weights
  sum to 100%, brackets = 95% bootstrap CI, and held-out is the realistic (cross-validated)
  accuracy vs the optimistic train number.

### Deferred (out of scope this iteration)
From the UX sweep, NOT in this iteration — recorded in the research doc's UX findings for a
future project: non-deployable-model filter, undo/back, two-step phase indicator,
criteria-phase progress, stall detection, caps banner + pinned cap/disabled errors,
kill-switch visibility, session status/error end-states, render-all-four-flags + degenerate
banner + export helper text + `dropBarelyMatters` checkbox, "Tie" clarification, breadcrumb
session-name, reading-area improvements, keyboard shortcuts, client 2–20 criteria validation,
`nPairs` wording / CI-n/a marker, field help text (pool size / audit rate / repeats / ×4),
"when to use" copy.

## Testing

### Unit Tests
- [x] `evolution/src/lib/weightInference/sampleSize.test.ts` (or the Phase-1 display helper's
  test) — `min(C(M,2), requiredRatings(K).pairs)` for binding-by-pool AND binding-by-recommendation
- [x] `evolution/src/lib/weightInference/autoCost.test.ts` — new `estimateAutoRunCost`:
  per-call-type sizing, `repeats`/`criteriaCount` scaling, the `perCallUsd = totalUsd/plannedCalls`
  identity, and the **same value flows to display and to `assertWithinWeightInferenceAutoCap`**
  (single-source assertion); plus the 0/NaN/empty-pool guard returning `{0,0}`
- [x] `evolution/src/lib/weightInference/*.test.ts` — any other fixed pure logic (fit/ci/audit/verdicts)

### Integration Tests
- [x] **Extend `src/__tests__/integration/evolution-weight-inference.integration.test.ts`** for
  the changed `getWeightInferencePreviewAction`: seed a topic with a KNOWN synced_to_arena
  variant count, assert the returned `matchesToJudge` for both binding cases, assert the
  `variant_kind` filter (paragraph variants excluded), and assert the test_set branch returns the
  exact frozen-pair count + the `avgArticleChars` aggregate. Run via `npm run test:integration:evolution`.
  ⚠ This suite **auto-skips when evolution tables are unmigrated** — confirm in CI that these new
  assertions actually RAN (not skipped); per project history, the auto-skip has hidden seed-schema
  bugs locally until CI migrated the real schema.

### E2E Tests
- [x] `src/__tests__/e2e/specs/09-admin/*.spec.ts` (`@evolution`) — add: changing **Article pool
  size** / topic re-renders the preview count (the literal Q1 bug), and the auto-mode
  `wi-cost-estimate` line appears/updates. Assert via `data-testid` + `expect.poll`/`toContainText`
  (NOT point-in-time reads — `flakiness/no-point-in-time-checks` is error-level)
- [x] Phase-5 human-judging spec: click "Left wins"/"Right wins"/"Tie"; assert `wi-replica-notice`
- [x] **PR-B rename gate:** run the FULL `npm run test:e2e:evolution` + unit suites and fix every
  text-assertion failure across arena/runs/comparison-views/judge-eval. `check:stale-specs` does
  NOT catch stale text — it is NOT the safety net. Enumerate affected specs via the Phase-4
  discovery grep and track each as a checkbox.

### Manual Verification
- [x] Verify the implied-rubric-weights admin pages on a local server via ensure-server.sh

## Verification

### A) Playwright Verification (required for UI changes)
- [x] Run the weight-inference `@evolution` specs on a local server (ensure-server.sh): verify
  the preview count updates with pool/topic, the `wi-cost-estimate` line, Left/Right buttons,
  the replica notice, and the results legend
- [x] PR-B: run `npm run test:e2e:evolution` (full) — the rename's real safety net

### B) Automated Tests
- [x] Unit: `npm test -- weightInference` (there is no `test:unit` script — the unit runner is
  `npm test`/jest)
- [x] Integration: `npm run test:integration:evolution` (the extended preview-action test)
- [x] E2E: the new `@evolution` specs (and, for PR-B, the full `npm run test:e2e:evolution` gate)

### C) Rollback / safety
- [x] Q2 cost-cap activation is the riskiest change (it un-dormants the USD gate). If it blocks
  legitimate runs in staging, the fix is config-only: raise `WEIGHT_INFERENCE_AUTO_MAX_USD` or
  revert the `estCostPerCall` argument at the `autoRun.ts`/route call sites (the estimate display
  stays). No migration/schema risk anywhere in this project.
- [x] PR split means PR-B (rename) can be reverted independently of the functional fixes if it
  destabilizes specs.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [x] `evolution/docs/implicit_rubric_weights.md` — Q3/Q4 "implied" + arena-topic explainer; match/winner vocab
- [x] `evolution/docs/rating_and_comparison.md` — if rubric-vote interaction changes; match/winner vocab
- [x] `evolution/docs/criteria_agents.md` — if criteria handling changes
- [x] `evolution/docs/data_model.md` — if any of the five weight-inference tables change
- [x] `docs/feature_deep_dives/judge_evaluation.md` — if auto-mode shared primitives change; match/winner vocab
- [x] **Terminology sweep (Phase 4)**: the match/winner rename is user-facing-copy-wide, so
  other `evolution/docs/*` that use "comparison"/"pair"/"verdict" in prose may need the same
  vocabulary update (keep Elo "rating" / DB-column references unchanged)

## Review & Discussion

### /plan-review — CONSENSUS REACHED (3 iterations, 2026-06-21)

| Iteration | Security & Technical | Architecture & Integration | Testing & CI/CD |
|---|---|---|---|
| 1 | 4/5 | 3/5 | 3/5 |
| 2 | 5/5 | 4/5 | 4/5 |
| 3 | **5/5** | **5/5** | **5/5** |

**Iteration 1 critical gaps (fixed):**
- Cost-cap unification understated — wiring `estCostPerCall` ACTIVATES the currently-dormant
  `WEIGHT_INFERENCE_AUTO_MAX_USD` cap (`autoRun.ts:132` omits it today). Now framed as a server
  behavior change with per-chunk vs whole-run reconciliation + named call site + rollback.
- `estCostPerCall` scalar vs 4 heterogeneous calls — pinned to `perCallUsd = totalUsd/plannedCalls`.
- Cost-helper API conflation + placement — resolved to chars-based `calculateCost`+`getModelPricing`
  in `weightInference/autoCost.ts`, fixed-overhead approximation (no prompt-builder imports).
- Rename test-churn — discovery grep + committed per-file checklist; gate = `test:e2e:evolution` +
  unit, NOT `check:stale-specs` (which can't catch stale text assertions).
- Extended preview action — named integration test target; both binding cases + test_set + aggregate.
- Plus: PR split (A=functional / B=rename), wire-enum guard for Left/Right, identifier-exclusion
  list, `variant_kind` filter + `getArenaCountForPromptAction` over-count note, NaN/empty-pool guard.

**Iteration 2 minors (fixed):** phantom route cap site → `runAutoChunk`-only; whole-run gate
located in `createWeightInferenceSessionAction`; char-aggregate query shape (narrow select + JS avg,
not SQL AVG+limit); NaN rationale corrected; per-criterion dim buttons added to relabel; test
command strings corrected (`npm test`, `test:integration:evolution`); CI auto-skip-confirm reminder;
research pricing field names.

**Status:** ✅ Ready for execution. No schema/migration changes; riskiest item (Q2 cap activation)
is config-revertible.

## Known CI failures — UNRELATED to this PR, root-caused, FIX LATER

After the user merged latest `main` into this branch (2026-06-22), CI went red on **two evolution
tests — neither is in this PR's diff** and both reproduce off pre-existing `main`-level defects
surfaced by the merge. This PR's own surface is green (Unit, Integration **Critical**, **E2E
Critical**, 229/231 evolution E2E incl. the weight-inference spec). Recorded here so we can fix the
underlying issues separately.

Common root cause: **shared dev DB + concurrent CI (`e2e-evolution` ∥ `integration-evolution`,
other PRs, nightly) with insufficient test isolation** — these tests assume exclusive ownership of
rows they don't scope defensively, so a concurrent job deletes their rows mid-test.

### Failure A — E2E: `admin-evolution-iterative-editing.spec.ts:262` ("editing-born variants have non-default mu")
- **Symptom:** `expect(|mu − 25| > 0.01)` received `0` (mu stayed at the default 25). Sibling test
  at `:189` flaked the same run.
- **Root cause (from the run log):** the seed-variant persist failed with
  `insert or update on table "evolution_variants" violates foreign key constraint
  "evolution_variants_run_id_fkey"` — the parent `evolution_runs` row was **deleted/absent before
  the pipeline persisted the seed variant** → 0 variants → ranking never ran → mu unchanged.
- **Likely trigger:** the claim-gate migration that landed on `main` **today** — PR **#1257**
  `claim_evolution_run LEFT JOIN → INNER JOIN for FOR UPDATE` (`supabase/migrations/
  20260622000001_evolution_claim_gate_fix_for_update_join.sql`, +`20260621000001_evolution_claim_gate.sql`)
  — changes run claim/lifecycle ordering. Independent corroboration: **`main` nightly E2E is red
  today**, open release-health issue **#1256** ("[release-health] Nightly E2E failed — 2026-06-22").
- **Fix later (owner: evolution claim-gate / #1257, tie to #1256):** find why a run is
  released/deleted while an in-flight pipeline still needs it to persist variants; likely the
  claim/cleanup ordering or the INNER JOIN change. Add a guard so variant persist can't outlive its
  run, or serialize cleanup after pipeline completion.

### Failure B — Integration: `evolution-llm-cost-attribution.integration.test.ts` ("aggregates spend via the RPC and respects p_include_test")
- **Symptom:** `expect(inclTotal).toBeCloseTo(0.75)` received `0.25` (only the real row counted).
- **Root cause:** the RPC `get_llm_spend_buckets` is **correct** — with `p_include_test=true` the
  `WHERE … (p_include_test OR is_test=false)` clause is always true, so all in-window rows return
  (verified by reading migrations `20260620000003`/`0004`, and the test PASSES locally on the same
  dev DB + RPC). The test inserts a test row (`is_test=true`, $0.50) + real row (`is_test=false`,
  $0.25); the awaited insert succeeds (2 ids), but the RPC then sees only the real row → **the
  `is_test=true` row was physically deleted between insert and read** by a concurrent process
  purging test-flagged spend on the shared dev DB during the parallel `e2e-evolution` job.
- **Fix later (owner: LLM-spend-tracking / #1250):** make the test re-read its own inserted ids (or
  query scoped to its unique `call_source` + `is_test`) instead of trusting the global RPC aggregate
  under concurrency; or run it against an isolated dataset.

### Impact on merging THIS PR
The reds are unrelated and `main`-level. Options when ready to merge: re-run CI (these do
intermittently pass — `e2e-evolution` passed on the merge-commit run), `/approve-pr` override, or
wait for the #1257/#1256 + #1250 fixes to land on `main` and re-merge. No change required in this PR.
