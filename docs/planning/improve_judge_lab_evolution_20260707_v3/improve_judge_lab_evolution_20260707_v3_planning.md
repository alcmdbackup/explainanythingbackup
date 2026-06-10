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

Caveat to record (not a blocker): `confidence` is `NUMERIC(2,1)` with only 5 discrete values, so decisiveness analysis is bucket-level, not a continuous gradient; and reasoning text is provider-dependent (store `reasoning_trace_format` so "not requested" is distinguishable from "provider dropped it"). **Format states:** the LLM layer (`src/lib/services/llms.ts`) emits exactly three values — `'verbatim' | 'summary' | 'unavailable'`; the column is additionally nullable (NULL = thinking not requested / no usage callback fired). So the column is `TEXT NULL CHECK (reasoning_trace_format IN ('verbatim','summary','unavailable'))`, not a 4-value enum.

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
- [x] Add columns (verbatim audit payload), all nullable: `forward_prompt` TEXT, `reverse_prompt` TEXT (the exact rendered judge input incl. injected A/B text + custom rubric), `forward_reasoning` TEXT, `reverse_reasoning` TEXT, `reasoning_trace_format` TEXT NULL CHECK (`reasoning_trace_format IN ('verbatim','summary','unavailable')`). (`forward_raw`/`reverse_raw` already exist for the raw output.)
- [x] Add columns (light ground-truth snapshot, frozen at write time — durable against bank re-seeding): `mu_a`/`mu_b`, `sigma_a`/`sigma_b` **NUMERIC (no precision/scale — these are OpenSkill values ~25/~8, unbounded; must NOT copy the `NUMERIC(2,1)` style or ground-truth is truncated)**, `gap_kind` TEXT, `baseline_confidence` NUMERIC (no scale), `expected_winner` TEXT, `variant_a_id`/`variant_b_id` UUID. All nullable (legacy rows + degraded cases). Source = the resolved `JudgeEvalPair` (`schemas.ts` already carries all of these).
- [x] Add additive, idempotent migration under `supabase/migrations/` using `ALTER TABLE judge_eval_calls ADD COLUMN IF NOT EXISTS …` (per environments.md idempotency lint; `npm run lint:migrations`). **RLS/posture note:** no new GRANT/policy needed — columns ride on `judge_eval_calls` (already deny-all + service_role-only); the `judge_eval_settings_leaderboard` VIEW enumerates only light columns so it needs no DROP/RECREATE.
- [x] **Capture reasoning correctly (source fix):** reasoning text + format are NOT on the `JudgeFn` return value — they arrive via the `onUsage(LLMUsageMetadata)` callback (`reasoningTrace`/`reasoningTraceFormat`, `src/lib/services/llms.ts`), which `createCallLLMJudge`'s `onUsage` (`runJudgeEval.ts`) currently discards. Extend `JudgeCallOutput` with `reasoningTrace?`/`reasoningTraceFormat?`, capture them in the per-call `onUsage` closure (per-attempt scope, last-write-wins across retries), and return them from `JudgeFn`. **Forward and reverse are two separate `JudgeFn` invocations** (the `Promise.all` in `evaluatePair`), each with its own closure — so `forward_reasoning`/`reverse_reasoning` come from the respective fwd/rev `JudgeCallOutput`, NOT a shared accumulator (mirror how `forward_raw`/`reverse_raw` are already kept distinct).
- [x] **Name the row-build change sites:** the snapshot + prompt + reasoning fields are dropped today because `evaluatePair()` and `erroredRepeat()` (`runJudgeEval.ts`) build the per-call result rows with only `forward_raw`/`reverse_raw`. Populate the new fields on BOTH the success row and the `erroredRepeat` row (errored rows still know their pair → snapshot stays non-null; prompts may be set, reasoning/raw null). `executeSweep.ts` already has `pairs` in scope but the per-row write belongs in `evaluatePair`.
- [x] Add the new fields as `.nullable()` to **`judgeEvalCallSchema`** (`schemas.ts`, the Zod object) — `JudgeEvalCall` and the derived `JudgeEvalCallResult` (= `Omit<JudgeEvalCall,'id'|'eval_run_id'>`) then both pick them up automatically. `replaceCalls` (`persist.ts`) spreads `...r`, so they flow to insert once set on the result object.
- [x] Regenerate `src/lib/database.types.ts`. **Split the TS shape:** `JudgeEvalCallCore` (verdict + metrics + snapshot) vs `JudgeEvalCallAudit` (prompts + reasoning + raw), so reads can fetch only what they need.

### Phase 2: Server action + data access
- [x] **Fix the pre-existing `SELECT *` regression (blocking):** `getEvalRunDetailAction` (`evolution/src/services/judgeEvalActions.ts`) currently does `.select('*')` on `judge_eval_calls` and is the sole data source for the existing `runs/[evalRunId]` page. Once the heavy columns land, that query would ship every call's full prompt+reasoning to the client on each run-detail load — violating guardrail #1. Convert it to an explicit **Core** column list (verdict + metrics + snapshot), dropping `forward_raw`/`reverse_raw` from this read too.
- [x] Add `getJudgeEvalCallsAction({ evalRunId, filters?, pagination? })` (admin/cap-gated via the existing `adminAction` → `requireAdmin` host-gate + `assertWithinJudgeEvalCap` pattern in `judgeEvalActions.ts`) returning **Core** rows only — explicit column list, **never `SELECT *`**. Ground-truth comes from the snapshot columns, so no pair-bank join is needed. Reuse the arena Match Viewer pagination shape (limit/offset/PAGE_SIZE, per `matches/page.tsx`).
- [x] Add `getJudgeEvalCallDetailAction({ callId })` returning the **Audit** payload (prompts, reasoning, raw, format) for a single expanded match. Must tolerate legacy rows where all audit fields are NULL (return nulls, do not throw).

### Phase 3: Match-history UI
- [x] **Resolve the route collision:** `/admin/evolution/judge-lab/runs/[evalRunId]` ALREADY exists (App Router page under `src/app/...`; per-kind aggregates + per-pair table). Do NOT clobber it. Add the match history as a **sub-route** `runs/[evalRunId]/matches` (and a detail at `runs/[evalRunId]/matches/[callId]`, or an in-page expandable row), linked from the existing run-detail page. Decide tab-within-page vs sub-route during implementation; either way the existing aggregates page stays. **If the in-page-tab option is chosen, update the E2E `safeGoto` nav target + the Verification(B) Firefox note** (currently `runs/[evalRunId]/matches`) to match. (Note: App Router pages live in `src/app/`; server actions + engine live in the `evolution/` package.)
- [x] Match list (Core data: pair, winner, confidence, decisive, gap_kind, baseline_confidence) → expandable row / detail that lazily loads the Audit payload via `getJudgeEvalCallDetailAction` and shows both content pieces, full judge input (incl. custom prompt), full output, and reasoning. Render the `reasoning_trace_format` state explicitly (e.g. "provider dropped trace" when `unavailable`, "not requested" when null).
- [x] **XSS-safe rendering:** prompts/reasoning/raw are arbitrary model+user text — render as plain text only (`<pre className="whitespace-pre-wrap">` / `{value}` interpolation, React auto-escaped). NEVER `dangerouslySetInnerHTML` or a markdown renderer that emits raw HTML.
- [x] Reuse arena Match Viewer component patterns + `data-testid` conventions where possible. Enumerate new testids up front: `match-row`, `match-expand`, `match-audit-detail`, `judge-input-forward`/`judge-input-reverse`, `judge-output-forward`/`judge-output-reverse`, `judge-reasoning`, `reasoning-format-state`, `match-text-a`/`match-text-b`.
- [x] **Drop the "Hide test content" convention here** — it's arena-only (keyed on `evolution_strategies.is_test_content`); `judge_eval_calls` has no such relationship, so v1 ships no test-content list filter (avoids the `require-reset-filters` lint firing on a filter that doesn't apply).

## Testing

### Unit Tests
- [x] `evolution/src/lib/judgeEval/runJudgeEval.test.ts` — assert the `onUsage` closure captures `reasoningTrace`/`reasoningTraceFormat` per pass and they land on the result; assert `evaluatePair` populates prompts + the ground-truth snapshot on the success row.
- [x] `evolution/src/lib/judgeEval/runJudgeEval.test.ts` (errored path) — assert `erroredRepeat` produces a row with audit fields (reasoning/raw) NULL but the **ground-truth snapshot non-null** (pair is known on failure), and the `JudgeEvalCallResult` Zod schema accepts the nullable audit fields.
- [x] `evolution/src/lib/judgeEval/persist.test.ts` — assert new fields (prompts, reasoning, format, snapshot) round-trip through `replaceCalls` on insert, including a partial/errored row with null audit + non-null snapshot.
- [x] Server action unit tests: `getJudgeEvalCallsAction` (Core shape, explicit columns / no `SELECT *`, pagination, snapshot present) + `getJudgeEvalCallDetailAction` (Audit shape; **legacy all-null row returns nulls without throwing**) + `getEvalRunDetailAction` (now selects explicit Core columns, no heavy fields).

### Integration Tests
- [x] Extend `src/__tests__/integration/evolution-judge-eval.integration.test.ts` — bank → test set → run → `replaceCalls` round-trip asserting the new columns persist+read against the real DB. Use the judge-eval-specific `judgeEvalTablesExist()` auto-skip probe (NOT the generic `evolutionTablesExist`), `[TEST]` prefix, and the existing `afterAll` FK-cascade cleanup.

### E2E Tests
- [x] **Extend the existing** `src/__tests__/e2e/specs/09-admin/admin-evolution-judge-lab.spec.ts` (do NOT add a duplicate spec). Reuse its `getEvolutionServiceClient` direct-DB seed (bank → test set → completed run → calls), `safeGoto` to the run detail, the `judge_eval_pair_banks` `42P01` auto-skip, and `adminTest.afterAll(cleanupAllTrackedEvolutionData)`.
- [x] **Deterministic audit seeding (no LLM cost):** the seed must **direct-insert** the new audit columns (`forward_prompt`/`reverse_prompt`/`forward_reasoning`/`reverse_reasoning`/`reasoning_trace_format`) + snapshot columns with literal values — NOT via a live sweep and NOT relying on `E2E_TEST_MODE` (which only stubs a canned verdict for launch, not a pre-completed run's full I/O).
- [x] Spec body: navigate to `runs/[evalRunId]/matches` (via `safeGoto`) → expand a match → wait on the observable `match-audit-detail` testid (no sleeps; `expect.poll`/auto-waiting assertion) → assert both content pieces, winner, judge input (custom prompt), output, and reasoning are visible.
- [x] Backward-compat E2E/render: within the same seeded run, seed TWO `judge_eval_calls` rows with distinct `pair_label`/`repeat_index` — one fully populated, one legacy-style with all audit columns NULL — and target each by a deterministic per-row testid (keyed by callId, not `nth()`). Assert the populated row's detail shows full I/O and the null row expands to the "not requested"/empty state without crashing. Single `adminTest` + one `afterAll` cleanup.

### Manual Verification
- [x] Run a small sweep (CLI/UI), open the run, confirm match history shows content + full I/O + reasoning; query the new columns via `npm run query:staging`.
- [x] **Analyzability check:** after a sweep, run a SQL query that decomposes non-decisive calls by structural cause and correlates decisive_rate against the snapshotted `gap_kind`/`baseline_confidence` — confirm it returns sensible results purely from `judge_eval_calls` (no bank join). Re-seed the bank, re-run the query, confirm results are unchanged (snapshot durability).

## Verification

### A) Playwright Verification (required for UI changes)
- [x] New `@evolution` spec under `09-admin/` exercising the match-history view (run on local server via ensure-server.sh).

### B) Automated Tests
- [x] `npm run lint && npm run typecheck && npm run build`
- [x] `npm test` (affected unit) + `npm run test:integration` (evolution) + targeted `npx playwright test <new spec>`
- [x] `npm run migration:verify` (migration touched) + `npm run lint:migrations`
- [x] Expect the `e2e-evolution` **Firefox matrix** to fire in CI (PR touches `evolution/` + `09-admin/` → `EVOLUTION_ONLY_PATHS`); this is why `safeGoto` on the `runs/[evalRunId]/matches` nav is load-bearing (Firefox `NS_BINDING_ABORTED`).

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [x] `docs/feature_deep_dives/judge_evaluation.md` — document the match-history view + any new `judge_eval_calls` columns.
- [x] `evolution/docs/data_model.md` — update `judge_eval_calls` column list if schema changes.
- [x] `evolution/docs/rating_and_comparison.md` — note where the full judge input/reasoning is now persisted.
- [x] `evolution/docs/arena.md` — cross-reference if the Match Viewer pattern is reused.
- [x] `evolution/docs/visualization.md` — add the new admin view to the UI inventory.
- [x] `evolution/docs/logging.md` — note persistence of raw judge I/O if logging conventions change.

## Review & Discussion

### Iteration 1 — Security 2/5 · Architecture 3/5 · Testing 3/5 (consensus NOT reached)
Critical gaps raised and how they were resolved in this revision:
1. **Pre-existing `SELECT *` regression** (Security+Arch): `getEvalRunDetailAction` selects `*` on `judge_eval_calls` and feeds the existing run-detail page → heavy columns would leak/regress it. → Phase 2 now explicitly converts it to a Core column list.
2. **Route collision** (Arch): target route already exists. → Phase 3 moves the view to a `runs/[evalRunId]/matches` sub-route; existing aggregates page preserved.
3. **Reasoning-capture source mis-specified** (Security+Arch): trace comes via `onUsage(LLMUsageMetadata)`, not the `JudgeFn` return; format is 3 states not 4. → Phase 1 + caveat fixed (extend `JudgeCallOutput`, capture in `onUsage`, 3-state CHECK + nullable).
4. **Snapshot dropped at row-build** (Security+Arch): `evaluatePair`/`erroredRepeat` don't copy ground-truth. → Phase 1 names both sites + `JudgeEvalCallResult` Zod `.nullable()` fields.
5. **NUMERIC precision** (Security): bare `NUMERIC` risked a `(2,1)`-style truncation. → Phase 1 mandates unconstrained NUMERIC for mu/sigma/baseline_confidence.
6. **E2E ignores existing spec + non-deterministic seeding** (Testing): → Testing now extends `admin-evolution-judge-lab.spec.ts`, direct-inserts audit columns (no LLM cost, not E2E_TEST_MODE), uses `safeGoto`/`afterAll` cleanup.
7. **Errored-row + backward-compat tests** (Testing): → Added explicit errored-row round-trip (audit null / snapshot non-null) and legacy all-null render tests.

Minors folded in: drop arena-only "Hide test content" filter; XSS-safe text rendering note; concrete integration filename + `judgeEvalTablesExist` probe; enumerated `data-testid`s; reuse arena pagination/components; explicit RLS-unchanged + VIEW-unchanged notes; Firefox `@evolution` matrix expectation. Deferred minor: reasoning truncation cap (noted as a possible defensive bound, not adopted in v1).

### Iteration 2 — Security 5/5 · Architecture 5/5 · Testing 5/5 ✅ CONSENSUS REACHED
All three reviewers re-verified the seven fixes against the actual repo (line-level: `getEvalRunDetailAction` `SELECT *` at `judgeEvalActions.ts:323`; `llms.ts` 3-state `reasoningTraceFormat`; `evaluatePair`/`erroredRepeat` row-build sites; existing `admin-evolution-judge-lab.spec.ts` + `evolution-judge-eval.integration.test.ts` + `judgeEvalTablesExist` probe). No critical gaps remain. Final precision nits folded in: schema edit lands on `judgeEvalCallSchema` (not the derived `JudgeEvalCallResult`); fwd/rev reasoning captured from each respective `JudgeFn` return (not a shared accumulator); tab-vs-subroute choice must keep the E2E nav target in sync; backward-compat E2E seeds two distinct rows targeted by deterministic per-row testids. Plan is ready for execution.
