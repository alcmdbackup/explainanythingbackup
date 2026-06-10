# Improve Judge Lab Evolution v3 Progress

## Phase 1: Persistence (DB + engine)
### Work Done
- Migration `supabase/migrations/20260610000001_judge_eval_calls_audit_and_snapshot.sql` — additive,
  idempotent `ADD COLUMN IF NOT EXISTS` for the audit payload (`forward_prompt`/`reverse_prompt`,
  `forward_reasoning`/`reverse_reasoning`, `reasoning_trace_format` 3-state CHECK) + ground-truth
  snapshot (`mu_a`/`mu_b`/`sigma_a`/`sigma_b`/`baseline_confidence` unconstrained NUMERIC, `gap_kind`/
  `expected_winner` CHECK, `variant_a_id`/`variant_b_id`), all nullable. Passed `lint:migrations`.
- `schemas.ts`: nullable fields added to `judgeEvalCallSchema`; `REASONING_TRACE_FORMATS` enum;
  `JudgeEvalCallCore` (Omit audit + `decisive`) / `JudgeEvalCallAudit` split.
- `runJudgeEval.ts`: `JudgeCallOutput` gains `reasoningTrace`/`reasoningTraceFormat`, captured in the
  per-attempt `onUsage` closure (NOT the return value). `evaluatePair` success row + `erroredRepeat`
  now populate prompts + per-pass reasoning + a `pairSnapshot()` of ground-truth.
- `metrics.ts`: `computeMetrics` narrowed to a minimal `JudgeMetricsInput` (accepts Core or Result);
  CLI + run-detail page trimmed accordingly.
- `database.types.ts`: new columns added to judge_eval_calls Row/Insert/Update.
- Tests: engine capture (success), errored-row invariant (snapshot non-null / reasoning null),
  `onUsage` reasoning capture. 12 engine + 57 judgeEval unit tests pass.

### Issues Encountered
- `.select(<string-variable>)` loses supabase-js row inference (returns a parser-error type) → cast
  action results to the typed Core/Audit shapes.
- `decisive` is a DB GENERATED column absent from the insert-shaped Zod schema → added to
  `JudgeEvalCallCore` as `& { decisive: boolean }` (not to the base schema, which feeds inserts).

## Phase 2: Server action + data access
### Work Done
- `judgeEvalActions.ts`: `CORE_CALL_COLUMNS`/`AUDIT_CALL_COLUMNS` constants. Fixed the pre-existing
  `getEvalRunDetailAction` `SELECT *` → explicit Core list. Added `getJudgeEvalCallsAction` (paginated
  Core list, count+range, no `SELECT *`) and `getJudgeEvalCallDetailAction` (Audit, tolerates legacy
  all-null rows). 9 action tests (incl. explicit-columns + legacy-null) pass.

## Phase 3: Match-history UI
### Work Done
- New sub-route `src/app/admin/evolution/judge-lab/runs/[evalRunId]/matches/page.tsx`: paginated Core
  list → expandable row lazily loads the Audit payload (both content pieces parsed from the prompt,
  full fwd/rev input + raw output + reasoning, `reasoning_trace_format` state). XSS-safe `<pre>`
  rendering; enumerated `data-testid`s. Link added from the run-detail aggregates page.

## Tests + docs + finalize
### Work Done
- Integration: new-column round-trip read-back; probe gated on `forward_prompt` so it skips pre-migration.
- E2E: extended `admin-evolution-judge-lab.spec.ts` — seed a fully-populated row + a legacy-null row,
  exercise the matches view + backward-compat empty state; probe gated on the new column.
- Docs: `judge_evaluation.md`, evolution `data_model.md` + `visualization.md`.
- Local checks green: lint, tsc, build, unit (7157 pass / 0 fail), ESM (156). Integration + evolution
  E2E skip locally pre-migration and run in CI after deploy-migrations.

### Outstanding (CI / finalize)
- `migration:verify` needs Docker (unavailable locally) — runs in CI's migration-verify job.
- PR to main is high-blast (touches `supabase/migrations/**`) → requires `/finalize` push-gate.
