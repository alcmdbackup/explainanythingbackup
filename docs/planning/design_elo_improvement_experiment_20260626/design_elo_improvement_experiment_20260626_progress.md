# Design Elo Improvement Experiment Progress

<!-- Execution tracking for the single-seed agent-comparison experiment design. -->

## Phase 0: Initialization
### Work Done
- Created branch `feat/design_elo_improvement_experiment_20260626` off `origin/main`.
- Read all 7 core workflow/ops docs + all 27 evolution docs (via parallel Explore agents).
- Confirmed target arena on staging: `Federal Reserve 2` = `a546b7e9-f066-403d-9589-f5e0d2c9fa4f` (2675 synced variants, arena max Elo ~1442).
- Identified ~1325-Elo seed candidates: `da03b016…`, `538bfbc9…`, `93a9ac9d…` — all with only 3–6 arena matches (sigma 5–6 → noisy baseline).
- Wrote research doc (rating instrument, candidate arms, seeding, budget/ops, failure modes) and planning doc (Decisions A–E with recommended options + phased plan).

### Issues Encountered
- `evolution_variants` text column is `variant_content` (not `variant_text`); uncertainty is stored as `sigma`/`mu`, not an `uncertainty` column. Adjusted queries accordingly.

### User Clarifications
- (none yet)

### Key open question for next phase
- Decision A: how to insert the copied seed as a **fixed in-pool anchor** in a new arena (docs say the seed is excluded from the pool since 2026-04-15). → **RESOLVED in /research, see below.**

## Phase 0.5: Code-level research (/research)
### Work Done
- Fanned out 4 code-reading agents (seed/arena mechanics; config/experiment surface; seed-script template; stats/metrics + QA), then verified specifics on staging.
- **Resolved Decision A (KF1/KF2):** the seed needs **two** pre-inserted rows — an anchor competitor (`generation_method='pipeline'`, `synced_to_arena=true`, pinned mu/sigma) that `loadArenaEntries` loads as a `fromArena` opponent, plus a `generation_method='seed'` source row to pin generation text. Runs must be **serialized** (concurrent runs clobber anchor mu/sigma); pool accumulates each run (archive-vs-accept decision open).
- **Config recipe (KF3):** changing only `agentType` yields a distinct strategy hash; ranking is inline (no trailing swiss); editing/debate/swiss can't be iteration 1 → need shared `generate` warm-up; generic criteria already exist (UUIDs captured).
- **Template (KF4):** clone `seedCoherencePassPerformanceExperiment_20260624.ts`; cost tracking enforced downstream via `trackedEvolutionProvider` (`requireTracking:true`).
- **Metrics (KF5):** run-level DVs in `evolution_metrics`; `eloAttrDelta` emitted by default; bootstrap CI helpers exist — but **NO two-sample significance test exists** → must build a seeded permutation/bootstrap diff-of-means + Holm correction (the only net-new product code).
- **QA gates (KF6):** `evolution_agent_invocations.success/cost_usd` + `detectArenaOnlyWipeouts.ts` per arm.
- Updated research doc (Key Findings KF1–KF7, Open Questions, Code Files Read) and planning doc (Decision A resolved; Phase 2 + tests now include the significance helper).

### Issues Encountered
- Confirmed uncertainty column on `evolution_metrics` is named `sigma` (not `uncertainty`); seed candidates store rating as `mu`/`sigma` (OpenSkill scale), `elo_score` is the Elo-scale view.

### User Clarifications (2026-06-26 review — 3 corrections, verified on staging)
- **Baseline precision is a non-goal.** Fresh arena is for isolation only; ±Elo on the seed doesn't matter. (Dropped the noisy-1325 framing.)
- **Seeds DO compete + show on the leaderboard with a real Elo** (FR2 seed `26ab2327…` = 1104.6, sigma 4.61, 21 matches). ⇒ two-row "anchor trick" demoted to a fallback; default = insert seed ONCE.
- **"Clobber" was imprecise:** match rows never lost; only the entry-row summary rating races under concurrency → mitigate by serial runs or recompute-from-comparisons. Not a blocker.
- **Elo CIs already exist/persist;** the only missing bit is a ~10-line difference-of-means wrapper (or just compare existing CIs) — downgraded from "must build a significance test".
- Editing/debate arms: user notes they can be modified to source from the seed (alternative to a shared warm-up).
- Cost: equal per-run budget across arms AND cost-adjusted analysis (Elo-per-$).
- Updated research KF1/KF2/KF5 + planning Decision A and Phase 2 accordingly.

## Phase 1: Finalize design + pre-registration
### Work Done
- **Arm set decided (user, 2026-06-26):** modify the two editing agents (Mode A & B) to run off the seed → clean **9-arm single-iteration block** (generate, reflect, 3 criteria, 2 editing, 2 paragraph). `debate_and_generate` excluded/untouched; `swiss` out of scope. Confirmed `iterationAgentTypeEnum` (schemas.ts:675–692) has exactly 11 types — all accounted for, no others.
- Added **Phase 1b** (editing-agent product code change) to the plan with tests + `editing_agents.md` doc update.

### Remaining (good candidate for /plan-review)
- Primary DV (lean `max_elo` lift), minimal effect size + α, run count/power (pilot-driven).
