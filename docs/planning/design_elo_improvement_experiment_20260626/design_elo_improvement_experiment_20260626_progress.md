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
- **Concurrency fix decided (user, 2026-06-26):** add **idea 1** (concurrency-safe live merge: re-read current arena rating + re-fold this run's matches + optimistic CAS, additive match_count) as a root-cause fix to `sync_to_arena` — makes the experiment correct-by-construction AND fixes the standing production race (which affects any concurrent same-prompt runs, incl. all past multi-run experiments + FR2's accumulated ratings). Terminal `recompute-arena-elo.ts` retained for reproducible analysis numbers, idea-1 validation, and repairing existing arenas. Added **Phase 1c** + a critical concurrency integration test + migration-verify. Walked through why idea 1 (cheap, scales, self-sufficient, preserves online semantics) beats locking (B/C) and per-run full replay (idea 2).
- **Arm set decided (user, 2026-06-26):** modify the two editing agents (Mode A & B) to run off the seed → clean **9-arm single-iteration block** (generate, reflect, 3 criteria, 2 editing, 2 paragraph). `debate_and_generate` excluded/untouched; `swiss` out of scope. Confirmed `iterationAgentTypeEnum` (schemas.ts:675–692) has exactly 11 types — all accounted for, no others.
- Added **Phase 1b** (editing-agent product code change) to the plan with tests + `editing_agents.md` doc update.

### Design decisions — ALL RESOLVED (user walkthrough, 2026-06-26)
- **#1 Concurrency (Decision F):** concurrent runs + idea-1 live concurrency-safe merge (CAS re-read/re-fold) + retained terminal recompute for reproducibility/validation/repair.
- **#2 Pool (Decision G):** accumulate; single common Elo scale via end recompute.
- **#3 Primary DV (Decision C):** ceiling = per-run max over a run's OWN variants' POINT Elos − seed; median headline (mean cross-check); + run-level "% runs improving on seed".
- **#4 Significance (Decision H):** PRIMARY = bootstrap P(best)/top tier (variant-sigma propagated, sigma sampling retained; no correction). SECONDARY = one-sided vs-`generate` diff-of-medians, α=0.05 + Holm/8, computed once at final N. Minimal effect ~40 Elo + P(within-40-of-best). Noise guard retired (uncertainty handled by inference).
- **#5 Sample size (Decision E):** adaptive P(best) stopping (min-N≥5/arm + 2-batch stability); **$40 cap**; ~$5 initial validation batch first. Cross-run sigma DROPPED — only "variant sigma" named.
- **#6 Ops pre-flight (Phase 2.5):** provider credit, MAX_OUTPUT_TOKENS, minicomputer pull+restart, daily-cap pace, wipeout detector.
- Editing agents (Mode A/B) to run off seed = Phase 1b; idea-1 concurrency fix = Phase 1c. Terminology saved to memory.

## Plan Review (iteration 1, 2026-06-26)
Scores: Security 3/5, Architecture 2/5, Testing 3/5 — NOT consensus. Code-verified critical gaps fixed in the plan:
1. **Phase 1c re-grounded:** race is in `syncToArena`+RPC (not MergeRatingsAgent); fold is TS-side (OpenSkill not plpgsql); RPC → guarded CAS UPDATE, signature changes; CAS must cover BOTH branches incl. the SEED (newEntries ON-CONFLICT + arenaUpdates); additive count on both.
2. **Retry contract:** N=5 + jittered backoff + FAIL-LOUD on exhaustion (no silent swallow).
3. **Kill-switch + rollback** (`EVOLUTION_ARENA_CAS_ENABLED`, default off).
4. **Phase 1b is net-new dispatch logic:** editing branch has NO seed-parent path + A1 seed excluded from pool → editing pool size 0. Must inject a synthetic seed parent.
5. **Editing budget-fill:** editing has no top-up → 1 variant/parent → under-spend confound. Add multi-dispatch off seed, else drop the 2 editing arms (checkpoint).
6. **Concurrency test must FORCE interleaving** (two pg connections; assert retry counter) — naive Promise.all in maxWorkers:1 tests nothing.
7. **migration:verify MANDATORY** (RPC body changes) + backward-compat gate on existing sync-arena test.
8. **$40 cap ENFORCED** via pre-batch assertion (was advisory).
9. **Recompute mirrors live path exactly** (confidence=0 no count, draw id-sort, absolute count) + prod-refusal guard + tolerance defined.
Plus minor fixes (projectDispatchPlan path, "differ only in agentType"→+family knobs, maxDispatches paragraph-only, drop warm-up iteration, auto-complete re-open check).

## Plan Review (iteration 2, 2026-06-26)
Scores: Security 3/5, Architecture 3/5 (↑), Testing 4/5 (↑) — iter-1 fixes landed; re-grounding surfaced new gaps, all fixed:
- **Seed doesn't compete (load-bearing):** lone `generation_method='seed'` row is excluded from the pool under default `EVOLUTION_REUSE_SEED_RATING` → primary DV unmeasurable. Fix: **two-row anchor now MANDATORY** (Decision A); anchor pipeline row is the Phase-1c contended row (not the seed-source row).
- **CAS on NUMERIC mu/sigma is unsound** (float round-trip → permanent false-conflict → always fail-loud). Fix: OCC on Postgres `xmin` (exact, no schema change).
- **Additive count double-counts** (current contract is absolute; TS pre-adds from stale snapshot). Fix: delta-only in TS + additive SQL + UPDATE the absolute-count contract test.
- **Concurrency test buildability:** specify READ COMMITTED autocommit, catch 0-row AND 40001, structured `{retries}` return surface, read/CAS test seam, flag ON/OFF, BOTH sync-arena backward-compat tests.
- Editing minors: full-Variant synthetic parent, runtime branch must read sourceMode, editing output-diversity (temp>0 + cache-collision), projector budget-fill math, audit isVariantProducingAgentType. computeRatings path → src/lib/shared/.

## Plan Review (iteration 3, 2026-06-26) — ✅ CONSENSUS
Scores: Security 5/5, Architecture 5/5, Testing 5/5 — zero critical gaps, verified line-by-line. iter-2 fixes confirmed correct: mandatory anchor makes the seed measurable + is the arenaUpdates-contended row; xmin OCC is sound (vs NUMERIC equality); delta-only count coupling correct; concurrency test seam + isolation + structured {retries} buildable. Applied the cheap non-blocking nits (anchor routes via arenaUpdates not newEntries; xmin→rating_version fallback; flag gates TS-side, single RPC version; re-fold-consistency tolerance justification).

## Execution (2026-06-27)
- ✅ **Phase 0** verification done. ✅ **Phase 1b** editing-off-seed shipped (committed, tsc clean, 452+4 tests pass).
- **Reorder decision (autonomous):** **Phase 1c (idea-1) deferred past the validation test.** The validation batch is tiny (~$5, 1–2 runs/arm) → run at **concurrency=1**, which sidesteps the `sync_to_arena` race entirely (Decision F's own "run serially" fallback), with the terminal recompute as canonical-rating backstop. idea-1 (the riskiest production hot-path migration) lands + is concurrency-tested **before the FULL run**, where concurrency matters — not rushed to unblock a low-concurrency smoke test. Build order now: **Phase 2 scripts → merge 1b+scripts → minicomputer pull → validation batch (conc=1) → recompute + QA**, THEN Phase 1c before scaling.

### Build status (2026-06-27) — validation-test code COMPLETE
- ✅ Phase 1b editing-off-seed (commit) · ✅ recompute-arena-elo + module + 7 tests (commit) · ✅ 9-arm seed script + 5 tests + README (commit). tsc=0, 689 unit tests green.
- Deferred: Phase 1c idea-1 (run validation at conc=1), abComparison.ts (only needed for /analysis).
- Remaining to RUN validation: /finalize → PR → CI → merge main → minicomputer pull → seed script --apply (~$1.80) → wait → recompute --apply → verify QA gates (success/cost>0/no wipeout/spend≈cap).

### Next — plan is execution-ready
- Build order: Phase 0 (confirm anchor competes) → 1b (editing off-seed + budget-fill) → 1c (idea-1 CAS) → 2 (seed rows + scripts) → 2.5 (ops pre-flight) → 3 (validation batch + adaptive) → 4 (recompute + /analysis).
- Recommend `/finalize` after each product-code phase (1b, 1c) lands.
