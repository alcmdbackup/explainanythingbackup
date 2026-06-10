# Improve Judge Lab Evolution v3 Plan

## Background
Make it possible to see the match history for runs in the judge lab, including both input pieces of content (either paragraph or article), the winner, and the full model input and output for the judge model (including the custom prompt if included and the full model reasoning including output if that is included). Also, make sure we have this information saved to the database so that later we can query it to understand it if needed.

## Requirements (from GH Issue #NNN)
Make it possible to see the match history for runs in the judge lab, including both input pieces of content (either paragraph or article), the winner, and the full model input and output for the judge model (including the custom prompt if included and the full model reasoning including output if that is included). Also, make sure we have this information saved to the database so that later we can query it to understand it if needed.

## Problem
Judge Lab eval runs persist per-(run × pair × repeat) verdicts in `judge_eval_calls`, but there is no UI to inspect the individual matches behind a run, and the persisted data is incomplete for after-the-fact analysis: the two compared content pieces are only joinable from the pair-bank JSONB, the exact judge **input prompt** (incl. custom rubric, as actually rendered) is not stored per call, and the full **reasoning trace** text is not stored (only a token count). This makes it hard to see *why* the judge ruled the way it did or to query the raw I/O later.

## Analyzability Goal
A first-class goal: the persisted per-call data must be **self-contained and queryable after the fact** so we can analyze *what drives decisiveness* (`confidence > 0.6`) without depending on mutable state. Concretely, after a sweep we should be able to (in SQL or the UI):
- Decompose every non-decisive call into its structural cause (position-bias `0.5` vs partial-tie `0.7` vs single/double error) from `forward_winner`/`reverse_winner`/`error`.
- Correlate decisiveness against **judge settings** (model × temp × reasoning × prompt) and against **pair difficulty** (ground-truth gap, baseline confidence).
- Read the judge's **exact input** (incl. rendered custom rubric) and **full output + reasoning** for any match, to see *why* it ruled as it did and to audit verdict parsing.

**Durability requirement (the reason to snapshot):** `text_a`/`text_b`, `mu`/`sigma`, `gap_kind`, and `baseline_confidence` all live in `judge_eval_pair_banks.pairs` JSONB, which **can be re-seeded** (frozen test-set members can later fail to resolve — the known "orphan" case). Any analysis that re-joins `pair_label` → bank would then read drifted or missing values. Therefore the call row must **freeze the ground-truth pair characteristics at write time**, not re-derive them later. Persisting the input prompt already snapshots the A/B text as a side effect; the numeric ground-truth must be snapshotted explicitly.

Caveat to record (not a blocker): `confidence` is `NUMERIC(2,1)` with only 5 discrete values, so decisiveness analysis is bucket-level, not a continuous gradient; and reasoning text is provider-dependent (store `reasoning_trace_format` so "not requested" is distinguishable from "provider dropped it").

## Options Considered
- [ ] **Option A: UI-only (reconstruct on read)**: Build a Matches/History view that reconstructs the judge input prompt in the UI (rubric + hydrated A/B text) and shows `forward_raw`/`reverse_raw` as the output. No migration. Risk: reconstruction can drift from what was actually sent; reasoning text not recoverable.
- [ ] **Option B: Persist full I/O + ground-truth snapshot + UI (recommended)**: Add columns to `judge_eval_calls` for the exact forward/reverse input prompts, reasoning trace text (+ format), AND a snapshot of the pair's ground-truth characteristics (mu/sigma, gap_kind, baseline_confidence); populate them in `runJudgeEval.ts`/`executeSweep.ts`, then build the history view reading persisted data. Faithful + queryable + analysis-durable; requires an additive migration + type regen.
- [ ] **Option C: Separate detail table**: Store heavy text (prompts/reasoning) in a sibling `judge_eval_call_details` table to keep `judge_eval_calls` lean. More normalized; extra join + more surface area.

## Phased Execution Plan

### Phase 1: Persistence (DB + engine)
- [ ] Decide column set (Option B vs C) for: full input prompt (`forward_prompt`/`reverse_prompt`), full reasoning trace text (`forward_reasoning`/`reverse_reasoning`), and `reasoning_trace_format` (`verbatim`/`summary`/`unavailable`/null).
- [ ] **Snapshot ground-truth pair characteristics onto the call row** (frozen at write time, durable against bank re-seeding): `mu_a`/`mu_b`, `sigma_a`/`sigma_b`, `gap_kind`, `baseline_confidence`, `expected_winner` (+ `variant_a_id`/`variant_b_id` for provenance). Source = the pair-bank `pairs` entry resolved at sweep start.
- [ ] Add additive, idempotent migration under `supabase/migrations/` (guards per environments.md lint).
- [ ] Populate new fields in `runJudgeEval.ts` (capture `forwardPrompt`/`reversePrompt` + reasoning) and thread the resolved pair metadata through `executeSweep.ts`; persist via `persist.ts`.
- [ ] Regenerate `src/lib/database.types.ts`; update Zod schemas in `evolution/src/lib/judgeEval/schemas.ts`.

### Phase 2: Server action + data access
- [ ] Add `getJudgeEvalCallsAction({ evalRunId, filters?, pagination? })` (cap/RLS pattern in `judgeEvalActions.ts`) returning per-match rows joined/hydrated with Text A/Text B from the pair-bank.

### Phase 3: Match-history UI
- [ ] Add a Matches/History view at `/admin/evolution/judge-lab/runs/[evalRunId]` (model after the arena Match Viewer): per-match rows → expandable detail showing both content pieces, winner/confidence, full judge input (incl. custom prompt), full output, and reasoning (collapsible).
- [ ] Wire `data-testid`s for E2E; respect "Hide test content" / reset-filters conventions if a list filter is added.

## Testing

### Unit Tests
- [ ] `evolution/src/lib/judgeEval/runJudgeEval.test.ts` — assert new prompt/reasoning fields are captured per pass.
- [ ] `evolution/src/lib/judgeEval/persist.test.ts` — assert new fields (prompts, reasoning, format, AND ground-truth snapshot: mu/sigma, gap_kind, baseline_confidence) round-trip on insert.
- [ ] `evolution/src/lib/judgeEval/executeSweep.test.ts` — assert resolved pair metadata is threaded onto each call row (snapshot, not re-join).
- [ ] Server action unit test for `getJudgeEvalCallsAction` (shape + A/B hydration + pagination).

### Integration Tests
- [ ] `src/__tests__/integration/` — judge-eval calls write+read with new columns against real DB (auto-skip if evolution tables unmigrated).

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/` — `@evolution` spec: open a run → Matches view → expand a match → assert both content pieces, winner, judge input (custom prompt), output, reasoning visible.

### Manual Verification
- [ ] Run a small sweep (CLI/UI), open the run, confirm match history shows content + full I/O + reasoning; query the new columns via `npm run query:staging`.
- [ ] **Analyzability check:** after a sweep, run a SQL query that decomposes non-decisive calls by structural cause and correlates decisive_rate against the snapshotted `gap_kind`/`baseline_confidence` — confirm it returns sensible results purely from `judge_eval_calls` (no bank join). Re-seed the bank, re-run the query, confirm results are unchanged (snapshot durability).

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] New `@evolution` spec under `09-admin/` exercising the match-history view (run on local server via ensure-server.sh).

### B) Automated Tests
- [ ] `npm run lint && npm run typecheck && npm run build`
- [ ] `npm test` (affected unit) + `npm run test:integration` (evolution) + targeted `npx playwright test <new spec>`
- [ ] `npm run migration:verify` (migration touched) + `npm run lint:migrations`

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `docs/feature_deep_dives/judge_evaluation.md` — document the match-history view + any new `judge_eval_calls` columns.
- [ ] `evolution/docs/data_model.md` — update `judge_eval_calls` column list if schema changes.
- [ ] `evolution/docs/rating_and_comparison.md` — note where the full judge input/reasoning is now persisted.
- [ ] `evolution/docs/arena.md` — cross-reference if the Match Viewer pattern is reused.
- [ ] `evolution/docs/visualization.md` — add the new admin view to the UI inventory.
- [ ] `evolution/docs/logging.md` — note persistence of raw judge I/O if logging conventions change.

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
