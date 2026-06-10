# Improve Judge Lab Evolution v3 Plan

## Background
Make it possible to see the match history for runs in the judge lab, including both input pieces of content (either paragraph or article), the winner, and the full model input and output for the judge model (including the custom prompt if included and the full model reasoning including output if that is included). Also, make sure we have this information saved to the database so that later we can query it to understand it if needed.

## Requirements (from GH Issue #NNN)
Make it possible to see the match history for runs in the judge lab, including both input pieces of content (either paragraph or article), the winner, and the full model input and output for the judge model (including the custom prompt if included and the full model reasoning including output if that is included). Also, make sure we have this information saved to the database so that later we can query it to understand it if needed.

## Problem
Judge Lab eval runs persist per-(run × pair × repeat) verdicts in `judge_eval_calls`, but there is no UI to inspect the individual matches behind a run, and the persisted data is incomplete for after-the-fact analysis: the two compared content pieces are only joinable from the pair-bank JSONB, the exact judge **input prompt** (incl. custom rubric, as actually rendered) is not stored per call, and the full **reasoning trace** text is not stored (only a token count). This makes it hard to see *why* the judge ruled the way it did or to query the raw I/O later.

## Options Considered
- [ ] **Option A: UI-only (reconstruct on read)**: Build a Matches/History view that reconstructs the judge input prompt in the UI (rubric + hydrated A/B text) and shows `forward_raw`/`reverse_raw` as the output. No migration. Risk: reconstruction can drift from what was actually sent; reasoning text not recoverable.
- [ ] **Option B: Persist full I/O + UI (recommended)**: Add columns to `judge_eval_calls` to store the exact forward/reverse input prompts and reasoning trace text (+ format), populate them in `runJudgeEval.ts`/`executeSweep.ts`, then build the history view reading persisted data. Faithful + queryable; requires an additive migration + type regen.
- [ ] **Option C: Separate detail table**: Store heavy text (prompts/reasoning) in a sibling `judge_eval_call_details` table to keep `judge_eval_calls` lean. More normalized; extra join + more surface area.

## Phased Execution Plan

### Phase 1: Persistence (DB + engine)
- [ ] Decide column set (Option B vs C) for full input prompt + reasoning trace + format.
- [ ] Add additive, idempotent migration under `supabase/migrations/` (guards per environments.md lint).
- [ ] Populate new fields in `runJudgeEval.ts` (capture `forwardPrompt`/`reversePrompt` + reasoning) and persist via `persist.ts`/`executeSweep.ts`.
- [ ] Regenerate `src/lib/database.types.ts`; update Zod schemas in `evolution/src/lib/judgeEval/schemas.ts`.

### Phase 2: Server action + data access
- [ ] Add `getJudgeEvalCallsAction({ evalRunId, filters?, pagination? })` (cap/RLS pattern in `judgeEvalActions.ts`) returning per-match rows joined/hydrated with Text A/Text B from the pair-bank.

### Phase 3: Match-history UI
- [ ] Add a Matches/History view at `/admin/evolution/judge-lab/runs/[evalRunId]` (model after the arena Match Viewer): per-match rows → expandable detail showing both content pieces, winner/confidence, full judge input (incl. custom prompt), full output, and reasoning (collapsible).
- [ ] Wire `data-testid`s for E2E; respect "Hide test content" / reset-filters conventions if a list filter is added.

## Testing

### Unit Tests
- [ ] `evolution/src/lib/judgeEval/runJudgeEval.test.ts` — assert new prompt/reasoning fields are captured per pass.
- [ ] `evolution/src/lib/judgeEval/persist.test.ts` — assert new fields round-trip on insert.
- [ ] Server action unit test for `getJudgeEvalCallsAction` (shape + A/B hydration + pagination).

### Integration Tests
- [ ] `src/__tests__/integration/` — judge-eval calls write+read with new columns against real DB (auto-skip if evolution tables unmigrated).

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/` — `@evolution` spec: open a run → Matches view → expand a match → assert both content pieces, winner, judge input (custom prompt), output, reasoning visible.

### Manual Verification
- [ ] Run a small sweep (CLI/UI), open the run, confirm match history shows content + full I/O + reasoning; query the new columns via `npm run query:staging`.

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
