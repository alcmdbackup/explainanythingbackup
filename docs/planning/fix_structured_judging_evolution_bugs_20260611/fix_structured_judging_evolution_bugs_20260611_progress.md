# Fix Structured Judging Evolution Bugs Progress

<!-- Execution tracking for the multi-bug evolution fix project. -->

## Phase 0: Reproduce & root-cause — COMPLETE
### Work Done
Project initialized. Core docs (7) + all 21 evolution docs read. Branch created off origin/main.
**Research: 4 rounds × 5 agents (20 agents)** against read-only staging DB + code. Root cause fully established and adversarially verified — see `_research.md` for file:line evidence and `_planning.md` for the phased fix plan.

**Root cause:** OpenRouter out of credits → all 100 generations per run 402'd (no `max_tokens` cap → 65535 requested). Cascade through 5 latent defects (D1 success-masking, D2 100-agent runaway, D3 arena_only masks total failure, D4 pricing [already mitigated], D5 no max_tokens cap). All 3 named runs `completed`/`arena_only`/0-variants/0-cost under strategy `2fd6d9a0`. Rubric judging NOT implicated. None of the defects is a regression from the structured_judging branch (all latent, Mar–May 2026).

### Issues Encountered
- Issue's run UUIDs were transcription typos; real IDs verified against staging (`bdb1f65a-…4784-…`, `3e94c04f-b7c6-…`).
- Round-2 naive fix designs had 2 latent bugs caught by Round-3 adversarial verification: blanket `max_tokens` cap would truncate main-app article gen (→ scope to evolution); cost-based D2 breaker would false-fire on $0 local/budget-skip runs (→ key on `result.status`).

### User Clarifications
- User opted to read all 21 evolution docs (not the relevant subset).
- User requested research as 4 rounds of 5 agents each.

### Open items carried into execution
See `_research.md` "Open Questions": D1 scope breadth (Paragraph/Swiss agents), the separate un-fixed 402-during-ranking→silent-TIE path (rubric judging doubles exposure), D5 reasoning-model cap headroom, detector back-test, prod exposure.

## Execution — all 5 phases COMPLETE (plan-review consensus 5/5 → implemented)

### Phase 1 — D5 (max_tokens cap) ✓
`CallLLMOptions.maxOutputTokens` + non-reasoning-only cap + `finish_reason==='length'` throw guard in `callOpenAIModel`; `EVOLUTION_MAX_OUTPUT_TOKENS=4096` (env kill-switch) at the `claimAndExecuteRun` chokepoint. Tests: llms.test (5 cases), claimAndExecuteRun.test.

### Phase 2 — D1 (record generation hard-failures as failed) ✓
`AgentOutput.failure` + `Agent.run()` flips `success=false`/`error_message` keeping valid detail; set in GFPA (3 sites) + createSeedArticle (2 sites) + forwarded through 3 wrappers. Tests: Agent.test, GFPA, seed, evaluateCriteria/singlePass/reflect wrappers.

### Phase 3 — D3 (fail all-generations-errored runs) ✓
finalize arena-only branch → `failed`/`all_generations_failed` when no non-arena discarded variants (race-safe). Tests: persistRunResults (new all-errored→failed + all-discarded→arena_only; updated #11/H5).

### Phase 4 — D2 (stop top-up runaway) ✓
breaker keyed on `result.status==='generation_failed'` + parallel-batch guard + `parallelSuccesses` counts variants not cost>0. Tests: runIterationLoop-topup (all-fail→<20 dispatches, $0-success no-false-fire).

### Phase 5 — D4 + detector + docs ✓
llmPricing regression test; `detectArenaOnlyWipeouts.ts` + .test + `evolution-run-health.yml` (verified live — flags all 3 incident runs); doc updates to cost_optimization/architecture/reference/debugging/minicomputer_deployment.

### Final checks ✓
lint=0, tsc=0, build=0, unit 7231 passed/0 failed, evolution integration 263 passed/0 failed.

### Operational (Phase 0 — user action, not code)
Top up OpenRouter credits for the runner's `OPENROUTER_API_KEY` to actually generate (the D5 cap clears the 402 at low balances but credits are still needed to produce variants).
