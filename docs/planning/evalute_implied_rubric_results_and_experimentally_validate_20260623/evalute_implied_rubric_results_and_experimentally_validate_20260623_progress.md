# Evaluate Implied Rubric Results and Experimentally Validate Progress

## CI status (PR #1281)

- Run 1 (commit `8f773d4ee`): `Lint` failed on the new E2E spec (`waitForTimeout` + silent `.catch`). Migration verify ✓, deploy migrations ✓, typecheck ✓ — everything else skipped on fail-fast.
- Run 2 (commit `5d7dee399`): `Lint` ✓ + everything green EXCEPT `Integration Tests (Evolution)` flaked on two pre-existing tests that share staging state with the live minicomputer's `claim_evolution_run` polling — `evolution-claim-gate.integration.test.ts` (queue-claim race vs minicomputer's 60s poll) and `evolution-e2e-test-llm-pipeline.integration.test.ts` (concurrent-run-limit overflow during minicomputer activity). Zero code overlap with this PR's diff (which is scoped to `evolution_weight_inference_sessions` + `buildComparisonPrompt`). Confirmed via staging query: 83 stale `[TEST]` pending runs + 2 running runs at the moment the test ran. Retriggering CI via a no-op commit to validate transience.

## Phase 1: Plumbing — `holistic_prompt_override` on weight-inference sessions
### Work Done
_(pending)_

### Issues Encountered
_(pending)_

### User Clarifications
_(pending)_

## Phase 2: Define the 4 arms — frozen prompt strings
### Work Done
_(pending)_

### Issues Encountered
_(pending)_

### User Clarifications
_(pending)_

## Phase 3: Run the experiment — 3 new sessions on staging
### Work Done
_(pending)_

### Issues Encountered
_(pending)_

### User Clarifications
_(pending)_

## Phase 4: Analysis script — quantify the priming effect
### Work Done
_(pending)_

### Issues Encountered
_(pending)_

### User Clarifications
_(pending)_

## Phase 5: Decision rule + reporting
### Work Done
_(pending)_

### Issues Encountered
_(pending)_

### User Clarifications
_(pending)_

## Phase 6: Promote findings to `/docs/analysis/`
### Work Done
_(pending)_

### Issues Encountered
_(pending)_

### User Clarifications
_(pending)_

## CI run 5 (commit 7cad68ad) — environmental issue

- ✓ Integration (Evolution) PASSED — race-safe assertion fix landed.
- ✗ Integration (Critical) failed in `explanation-generation.integration.test.ts` with `Daily non_evolution budget exceeded: $50.18 spent + $0.00 reserved of $50.00 cap`.

Diagnosed (unrelated to this PR): `daily_cost_rollups.total_cost_usd` for today's non_evolution row was poisoned by `llmCallTracking` row deletions — the `AFTER INSERT` rollup trigger only increments, never decrements, so when cleanup removed test rows the rollup kept their cost. Drift had been accumulating for 5 days: $7.90 → $51.70 today, while the actual `SUM(estimated_cost_usd)` was $0.004. Repaired the rollup: $51.70 → $0.00144 (matching the actual sum). Retriggering CI.
