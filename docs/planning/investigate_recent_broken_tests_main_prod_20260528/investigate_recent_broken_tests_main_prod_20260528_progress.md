# Investigate Recent Broken Tests (Main + Prod) Progress

## Investigation (5 rounds × 4 agents, 2026-05-28)
### Work Done
Ran a 20-agent investigation (read-only: gh history + read-only Supabase queries + code/git trace). Full findings in `_research.md` (Rounds 1–5); concrete fix plan in `_planning.md`. Headline: the nightly has been 100% red since 2026-03-23 (~62-day silent outage); the original prod-migration-freeze cause was fixed by #1074 (May 24), but a residual layer of **test/config bugs** keeps it red. The current 34 failures are overwhelmingly test/config (admin specs on wrong host = 22; mock/local-only specs on prod = 3; test-data assumptions = 2; missing filter-uncheck = 1; firefox nav flake = 6) — **no app-code regressions**. Plus 3 pipeline issues: post-deploy smoke can never trigger (GitHub anti-recursion), non-evolution integration/E2E never run on main PRs, and a `variant_kind` migration fix-ordering risk for releasing #1116.

### Issues Encountered (intermediate agent errors caught + corrected)
- An agent claimed `production` was frozen at March 5 (pre-split) — it had read a **stale local `production` ref**. Verified `origin/production` is current (May 27, post-split). Corrected.
- An agent attributed an evolution failure to `variant_kind` prod drift — the filter code is on #1116 (main only), not on prod (#1114), so it's a future fix-ordering risk, not a current cause. Corrected.
- Agents disagreed on whether the post-deploy-smoke `if:` is broken — resolved: the `if:` is fine; the real Vercel `deployment_status` event never reaches the workflow (GitHub anti-recursion on GITHUB_TOKEN-created statuses).
- Discovered `@skip-prod` is currently excluded EVERYWHERE (unconditional `grepInvert` in playwright.config.ts:224), so the naive "@skip-prod the spec" fix would drop local/CI coverage — fix requires gating it on `isProduction`.

### User Clarifications
- 2026-05-28: User confirmed the drafted summary + requirements, and asked to additionally investigate how tests got broken on **staging** (the `main` branch / staging environment), not just production. Added as Requirement 4.

## Plan Review (2026-05-28)
`/plan-review` reached 5/5 consensus after 2 iterations. Iteration 1 (Sec 3/5, Arch 4/5, Test 4/5) caught that Phase 5 was inert as written (wrong `workflow_run` name + `if:` couldn't match the new trigger + migration-less releases uncovered), the tactics seed needed a `structural`-named tactic, and admin tagging should be describe-level. All fixed; iteration 2 = 5/5/5. Details in `_planning.md` § Review & Discussion.

## Execution (2026-05-28) — all 5 fix phases applied + verified
### Work Done (32 files changed)
- **Phase 1:** re-tagged 21 admin specs (`09-admin/*`) `@critical`→describe-level `@evolution` (param-form, name-string, dual-tag forms); host-isolation kept `@critical`.
- **Phase 2:** gated `playwright.config.ts:224` `grepInvert: /@skip-prod/` on `isProduction`; tagged `status-pill` (2 tests) + `host-isolation` `@skip-prod`; added both to the `e2e-nightly.yml` pre-flight audit list; fixed the stale `testing_overview.md` `@skip-prod` row.
- **Phase 3:** extended `ci.yml:49` `EVOLUTION_ONLY_PATHS` to include `09-admin/` + `00-host-isolation/` so admin-only main PRs run `e2e-evolution`.
- **Phase 4:** added `createTestTactic` to `evolution-test-data-factory.ts` (+`'tactic'` in the entity union & FK cleanup order); self-seeded tactics in `strategy-tactics-tab` (≥2) and `tactics-leaderboard` (one `[TEST_EVO] structural …`, total ≤5); fixed `invocation-detail` row-nav by unchecking "Hide test content" before the seeded-row assertion.
- **Phase 5:** `post-deploy-smoke.yml` now triggers on `push:[production]` (+ `workflow_dispatch`, `deployment_status` secondary), `if:` branches on `github.event_name`, Health Check is now a ~5-min wait-for-deploy poll, added `concurrency:` + push to the Slack-notify guard.

### Verification results
- `npm run lint` — green (only pre-existing warnings in untouched files; `check:stale-specs` passed).
- `npm run typecheck` — green.
- Tag routing (`playwright --grep --list`): 0 admin specs in `@critical`; all admin in `@evolution`; host-isolation kept `@critical`; `status-pill`+`host-isolation` run locally and are `@skip-prod`.
- `ci.yml` detect-changes dry-run: admin-only PR → `evolution-only`; public-only → `non-evolution-only` (no misclassification). Both workflow YAMLs validated.
- **Local E2E (Dev DB): 17/17 Phase-4 tests pass (56.2s)** — incl. the two fixed tests (`tactics-leaderboard › search filter narrows the list`, `invocation-detail › row nav`).

### Caveats / follow-ups
- **Scope decision:** `admin-confirmations` + `admin-evolution-subagents` were previously UNTAGGED (not part of the 22-failure set); left as-is rather than newly enrolling them into the prod nightly. Revisit separately if they should be `@evolution`.
- **Tier-2/Tier-3 still needed:** local pass uses `localhost` (host tier `'local'`, admin permitted) + Dev DB — it does NOT prove the re-routed admin specs pass on the deployed evolution host against prod data. Authoritative confirmation = the post-merge nightly (or an opt-in Tier-2 run against `ea-evolution.vercel.app`). Rollback = `git revert` the tag commit.
- **`variant_kind` migration fix-ordering** (Phase 5 item 2) is operational — apply `supabase/migrations/20260527000001-04` to prod before/with #1116's release; not a code change here.
- **Pre-existing (not introduced):** `global-teardown.ts` logs `⚠ cleanupAllTrackedEvolutionData not found in module (skipping)` — it looks for the function in a different module; per-spec `afterAll` + the bulk cleanup handle teardown. Out of scope.
