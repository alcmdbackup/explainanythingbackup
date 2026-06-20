# Compare Criteria Judge vs Whole Article/Paragraph Judge Progress

## Phase 1: Research & design
### Work Done
- Initialized project; read all standard docs + all evolution docs.
- Deep code investigation (4 parallel agents) across the judgeEval engine, judging primitives (`computeRatings.ts`/`rubricJudge.ts`), server actions + admin UI, and the judge_eval migrations.
- Wrote the research doc with a concrete Proposal (Option A: dedicated "Agreement Sweep" mode). Key finding: every judging primitive already exists; only a holistic↔rubric pairing + agreement surfacing is missing. `favored_match_winner` is NOT reusable (compares to rubric aggregate, not holistic).

### Issues Encountered
- One investigating agent initially claimed "no migration needed" by reusing `favored_match_winner`; corrected — that column compares criteria to the rubric's own aggregate, not the holistic winner the requirement asks for.

### User Clarifications
- Q: What is the "article-level winner" compared against? → **A: the HOLISTIC no-rubric judge** (run both judges per pair; agreement = same label).
- Q: How should the rubric judge run? → **A: one 2-pass call scoring all criteria** (4 LLM calls/pair·repeat; single model). Not the per-criterion `criteria_split` planner.
- Open questions O1–O5 walked through and resolved (2026-06-19):
  - O1 repeats → **show both** (per-pair-modal headline + per-repeat rate; store per-repeat rows).
  - O2 TIE → **three buckets** (strict + both-decisive + abstain/divergence; per-criterion TIE = abstain).
  - O3 per-criterion storage → **child table** `judge_eval_agreement_criterion_verdicts` (SQL-queryable).
  - O4 holistic source → **re-judge in-sweep**, both judges share one model.
  - O5 ground-truth → **yes, incl. per-criterion** accuracy vs Elo `expected_winner` (large-gap pairs).

## Phase 2: Data model + engine
### Work Done
- Migration `supabase/migrations/20260619000001_judge_eval_agreement.sql`: 3 tables (`judge_eval_agreement_runs` / `_calls` / `_criterion_verdicts`) + `judge_eval_agreement_leaderboard` view; idempotent, deny-all + service_role_all RLS; GENERATED decisive columns; FILTER+NULLIF guards.
- Added the 3 tables + view to `src/lib/database.types.ts`.
- Engine `evolution/src/lib/judgeEval/agreement.ts` (pure `computePairAgreement` + `evaluatePairAgreement`/`runAgreementOverPairs` over an injected JudgeFn, 4 calls/pair·repeat, partialResults protocol).
- Reducer `agreementMetrics.ts` (3 TIE buckets, per-pair-modal + per-repeat, per-criterion agree/abstain, GT accuracy).
- Persistence `agreementPersist.ts` (upsert run by settings_key + delete-then-insert calls + criterion verdicts).
- Orchestration `executeAgreementSweep.ts` (loadTestSetPairs → cap gate chainCap=2 → engine → persist).
- `buildAgreementSettingsKey` in `settings.ts` (`agreement|` prefix).
- Unit tests: `agreement.test.ts` (6) + `agreementMetrics.test.ts` (10) — all pass.

### Issues Encountered
- None blocking. Followed the plan's execution caveats (full GENERATED-ALWAYS-AS-STORED syntax; both-null criterion treated as abstain; criteriaId/name field mapping in persist).

## Phase 3: Server actions + CLI
### Work Done
- `createAgreementSweepAction` (adminAction, cap-gated, hard-fails on null rubric), `getAgreementLeaderboardAction` (SQL view), `getAgreementRunDetailAction` (run + Core calls + criterion verdicts) in `judgeEvalActions.ts`.
- CLI `agreement-sweep` subcommand in `evolution/scripts/judge-eval.ts`.

## Phase 4: Admin UI
### Work Done
- Third "Agreement" entry on the launcher mode toggle (link to sub-route) in `judge-lab/page.tsx`.
- `judge-lab/agreement/page.tsx` (launcher + leaderboard) and `judge-lab/agreement/runs/[agreementRunId]/page.tsx` (metric tiles + per-criterion table + GT-accuracy panel + disagreement drill-down with Open-in-Match-Viewer).
- Integration test (`evolution-judge-eval-agreement.integration.test.ts`) — 3-table persistence + leaderboard + CASCADE, auto-skip probe, afterAll cleanup.
- E2E spec (`admin-evolution-judge-lab-agreement.spec.ts`, @evolution) — deterministic seeded rows, leaderboard + run-detail + kind re-slice, mode-link nav; cleanup via tracked bank.

## Phase 5: Docs
### Work Done
- Added the "Agreement Sweep — rubric ↔ holistic" section to `docs/feature_deep_dives/judge_evaluation.md`.
