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

**CHOSEN: Option B** — persist everything additively on `judge_eval_calls`, store prompts **verbatim**, and model the heavy/light split in the **app layer** (not the DB). Rationale recorded below; revisit only if independent retention of the heavy payload becomes a real requirement.

- [x] **Option B: Persist full I/O + ground-truth snapshot on `judge_eval_calls` (CHOSEN)**: Additive columns for the exact forward/reverse input prompts (verbatim), reasoning trace text (+ format), and the pair ground-truth snapshot (mu/sigma, gap_kind, baseline_confidence, expected_winner, variant ids). Build the history view on persisted data. Faithful + queryable + analysis-durable; purely additive migration + type regen.
- [ ] ~~**Option A: UI-only (reconstruct on read)**~~: Rejected — reconstructing the prompt can drift from what was actually sent, and reasoning text is unrecoverable. Fails the "full model input" + analyzability goals.
- [ ] ~~**Option C: Separate `judge_eval_call_details` table**~~: Rejected for now. Its main argument (keep the analytical table lean) is largely moot: (1) `judge_eval_calls` already carries heavy text (`forward_raw`/`reverse_raw`), so C introduces no new pattern only by also migrating those (scope creep); (2) Postgres **TOAST** stores large TEXT out-of-line and never reads it unless the column is named, so analytical queries that avoid `SELECT *` already skip the heavy bytes; (3) the existing errored-partial-results path (`replaceCalls`) stays atomic as a single-table insert. C's one genuine advantage — independent retention/pruning of the heavy payload — is the **only** trigger to reconsider, and is not needed at current volume (test sets are samples; repeats ≤ 50).

**Decision guardrails (make Option B safe):**
1. **Never `SELECT *` on `judge_eval_calls` in analytical/list paths** — name columns explicitly so TOASTed prompt/reasoning bytes aren't read. (The leaderboard VIEW already only aggregates light columns; it is unaffected by the additive heavy columns.)
2. **Model the heavy/light split in TypeScript, not SQL:** a `JudgeEvalCallCore` type (verdict + metrics + ground-truth snapshot) for list/aggregate queries, and a `JudgeEvalCallAudit` type (prompts + reasoning + raw) fetched only when a single match is expanded. Gives C's access-pattern cleanliness without a second table.
3. **Verbatim prompts** (not reconstruct-on-read): satisfies the "full model input" requirement and survives future changes to `buildComparisonPrompt`. Accept the per-call A/B-text duplication across forward/reverse prompts as cheap at this volume; if storage ever bites, store `text_a`/`text_b` once + wrapper rather than reverting to reconstruction.

## Phased Execution Plan

### Phase 1: Persistence (DB + engine) — additive columns on `judge_eval_calls`
- [ ] Add columns (verbatim audit payload): `forward_prompt` TEXT, `reverse_prompt` TEXT (the exact rendered judge input incl. injected A/B text + custom rubric), `forward_reasoning` TEXT, `reverse_reasoning` TEXT, `reasoning_trace_format` TEXT (`verbatim`/`summary`/`unavailable`/null). (`forward_raw`/`reverse_raw` already exist for the raw output.)
- [ ] Add columns (light ground-truth snapshot, frozen at write time — durable against bank re-seeding): `mu_a`/`mu_b`, `sigma_a`/`sigma_b` NUMERIC, `gap_kind` TEXT, `baseline_confidence` NUMERIC, `expected_winner` TEXT, `variant_a_id`/`variant_b_id` UUID. Source = the pair-bank `pairs` entry resolved at sweep start.
- [ ] Add additive, idempotent migration under `supabase/migrations/` (guards per environments.md lint). No change needed to `judge_eval_settings_leaderboard` (it aggregates only light columns).
- [ ] Populate new fields in `runJudgeEval.ts` (capture `forwardPrompt`/`reversePrompt` + reasoning text + format from the `JudgeFn` result) and thread the resolved pair metadata through `executeSweep.ts`; persist via `persist.ts`. Confirm the errored-partial-results path (`replaceCalls`) carries the new fields too.
- [ ] Regenerate `src/lib/database.types.ts`; update Zod schemas in `evolution/src/lib/judgeEval/schemas.ts`. **Split the TS shape:** `JudgeEvalCallCore` (verdict + metrics + snapshot) vs `JudgeEvalCallAudit` (prompts + reasoning + raw), so reads can fetch only what they need.

### Phase 2: Server action + data access
- [ ] Add `getJudgeEvalCallsAction({ evalRunId, filters?, pagination? })` (cap/RLS pattern in `judgeEvalActions.ts`) returning **Core** rows only — explicit column list, **never `SELECT *`** (keeps TOASTed prompt/reasoning out of the list query). Ground-truth comes from the snapshot columns, so no pair-bank join is needed.
- [ ] Add `getJudgeEvalCallDetailAction({ callId })` returning the **Audit** payload (prompts, reasoning, raw, format) for a single expanded match.

### Phase 3: Match-history UI
- [ ] Add a Matches/History view at `/admin/evolution/judge-lab/runs/[evalRunId]` (model after the arena Match Viewer): a Core-data list (pair, winner, confidence, decisive, gap_kind, baseline_confidence) → expandable row that lazily loads the Audit detail and shows both content pieces, full judge input (incl. custom prompt), full output, and reasoning (collapsible; render the `reasoning_trace_format` state explicitly when `unavailable`/absent).
- [ ] Wire `data-testid`s for E2E; respect "Hide test content" / reset-filters conventions if a list filter is added.

## Testing

### Unit Tests
- [ ] `evolution/src/lib/judgeEval/runJudgeEval.test.ts` — assert new prompt/reasoning fields are captured per pass.
- [ ] `evolution/src/lib/judgeEval/persist.test.ts` — assert new fields (prompts, reasoning, format, AND ground-truth snapshot: mu/sigma, gap_kind, baseline_confidence) round-trip on insert.
- [ ] `evolution/src/lib/judgeEval/executeSweep.test.ts` — assert resolved pair metadata is threaded onto each call row (snapshot, not re-join).
- [ ] Server action unit tests: `getJudgeEvalCallsAction` (Core shape, explicit columns / no `SELECT *`, pagination, snapshot fields present) + `getJudgeEvalCallDetailAction` (Audit shape: prompts/reasoning/raw/format).

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
