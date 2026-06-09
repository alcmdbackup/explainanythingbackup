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

### Now also done (second pass, static-verified)
- **UI Screens 2–4**: `/judge-lab/runs/[evalRunId]` (per-kind aggregates + per-pair table), `/judge-lab/pair-banks` (list + seed-from-topic), `/judge-lab/test-sets` (list + create) + `seedPairBankAction`. All 4 judge-lab routes build.
- **E2E spec** `admin-evolution-judge-lab.spec.ts` (@evolution, seeds a completed run, asserts leaderboard + drill-down; auto-skips until migration deployed) + E2E factory `judge_eval_pair_bank` cleanup wiring.
- **Docs**: new `docs/feature_deep_dives/judge_evaluation.md` + pointers in `evolution/docs/data_model.md` and `reference.md`.
- **Final checks green**: tsc clean · full `npm run lint` exit 0 · `npm run build` compiles all routes · 38 judge-eval unit tests pass · `check:stale-specs` ✓.

### Blocked / deferred to merge (per user: "take care of migration on merge to main")
- **Migration applies via CI on merge to main** (deploy-migrations job → staging, then `db:types` auto-regen). NOT applied locally.
- **Local UI review + integration/E2E execution** therefore activate post-merge (or after a manual `supabase login` + `db push`). The integration + E2E specs auto-skip until the `judge_eval_*` tables exist.
- **Docker unavailable** → `migration:verify` not run locally; CI's `migration-verify-test` job covers it.
- **`database.types.ts`** hand-augmented for the new tables; CI regenerates from staging post-deploy (`.gitattributes` auto-resolves).

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
