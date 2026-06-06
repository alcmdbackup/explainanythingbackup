# Create Tool Systematic Judge Evaluation (Evolution) Progress

## Phase 0: Research & Methodology Recovery
### Work Done
- Project initialized via /initialize. Read ALL judge-critical docs in full (rating_and_comparison, arena, data_model, agents/overview, strategies_and_experiments, visualization, logging, metrics, architecture, reference + both `docs/research/` agreement docs).
- Ran a 20-agent / 5-round research workflow (`judge-eval-research`, wf_e80379c2-165): recovered the historical methodology (run 140f7bce pair-bank, model×temp sweep, implied-beta back-solve), located the lost scripts on unmerged branch `feat/estimate_match_noise_evolution_20260411` (SHA 65730bc6, issue #959 OPEN), and mapped the live judge code (compareWithBiasMitigation `:478`, decisive_rate=conf>0.6 `finalization.ts:83-86`, temp hard-forced 0 `createEvolutionLLMClient.ts:146-148`).
- **Key discovery**: PR #1168 "Match Viewer" merged today (`23230ece`) — provides the interactive re-judge sandbox + custom-prompt seam + reasoning parser (display-only, persists nothing). **Rebased this branch onto `origin/main` (`838d2956`)** so we build on it. Our project = the persistence + batch-measurement layer on top.
- Designed the 3-table storage (`judge_eval_pair_banks/runs/calls` + leaderboard VIEW), the metric set, and the Option C plan. Wrote findings to `_research.md`, plan to `_planning.md`.

### Issues Encountered
- Local `origin/main` was stale (`970bd6d9`) — the workflow's completeness critic caught the #1168 merge; verified + rebased.
- 1 of 20 workflow agents (git-forensics) failed to return structured output; covered by sibling agents.
- Data quirk: historical pair-bank's variant D shares B's UUID (`2f25e2b0`) — pair-bank seeding must fix the close-pair labeling.

### User Clarifications
- Scope = **arena pairwise judge only** (not the content-quality judge).
- Surface = **script + DB tables + a Judge Lab admin page** (interactive single-match re-judge stays in Match Viewer).
- Ground truth = **mu/Elo gap only** (replicate history); accuracy/implied-beta on large-gap pairs only.

## Execution (post plan-review 5/5/5)
### Done — committed, statically verified (tsc clean · lint clean · build compiles route · 38 unit tests pass)
- **Phase 1:** migration `20260606000001_judge_eval_tables.sql` (5 tables + RLS-locked leaderboard VIEW; idempotency-lint ✓); `database.types.ts` hand-augmented (CI regenerates post-deploy); Zod schemas.
- **Phase 2:** engine `runJudgeEval.ts` (inlined 2-pass mirroring rejudge, injected JudgeFn, E2E stub+prod guard, `evolution_judge_eval` call_source, mandatory concurrency cap), `metrics.ts` (decisive/agreement/position-bias/accuracy/implied-beta, per-kind), `testSet.ts` (seeded freeze + orphan check), `settings.ts` (settings-key + hard cost ceiling + JUDGE_EVAL_ENABLED), `cost.ts`, `persist.ts` (load/freeze/upsert), `seed.ts` (FR2 pull), `executeSweep.ts` (orchestrator, cap-gated).
- **Phase 3:** CLI `evolution/scripts/judge-eval.ts` (`seed` / `create-test-set` / `sweep --dry-run`, shared cap guard).
- **Phase 4:** server actions `judgeEvalActions.ts` (cap enforced before any LLM call) + Judge Lab page `/admin/evolution/judge-lab` (Screen 1: sweep launcher + per-kind leaderboard) + sidebar "Tools" nav.
- **Tests:** 35 core unit + 3 action unit (38 total, all green) + integration test (auto-skips until migration deployed).

### Blocked / remaining (needs user action or follow-up)
- **APPLY MIGRATION to dev Supabase** — required for local UI review + `db:types` + integration/E2E to run. Needs interactive `supabase login` (I can't auth). Commands: `npx supabase login` → `npx supabase link --project-ref ifubinffdbyewoezcidz` → `npx supabase db push` → `npm run db:types`.
- **Docker unavailable** → `migration:verify` not run locally (`MIGRATION_VERIFY_SKIP=true` or rely on CI).
- **E2E spec** `admin-evolution-judge-lab.spec.ts` — not written (needs running server+DB).
- **UI Screens 2–4** (eval-run detail, pair-bank manager, test-set manager) — Screen 1 built; bank-seed + test-set-create available via CLI meanwhile.

## Phase 1: Eval engine + settings override
### Work Done
See "Execution" above.

## Phase 2: Structured logging + storage
### Work Done
_(pending)_

## Phase 3: Sweep runner + metrics
### Work Done
_(pending)_

## Phase 4: Ad-hoc match-viewer / prompt-modifier integration
### Work Done
_(pending)_
