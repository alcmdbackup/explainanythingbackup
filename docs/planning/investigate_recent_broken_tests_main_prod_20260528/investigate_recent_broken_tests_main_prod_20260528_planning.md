# Investigate Recent Broken Tests (Main + Prod) Plan

## Background
Recent CI has surfaced broken tests affecting both the staging (`main`) and production environments. The E2E Nightly (Production) run on 2026-05-28 failed across both Chromium and Firefox for the public `@critical` suite (explainanything.vercel.app) and the evolution `@evolution` suite (ea-evolution.vercel.app), shortly after the large May 27 production release (#1114, 55 PRs including migrations). This project investigates the root cause of these failures — separating genuine regressions from flakiness/infra issues — including how tests got broken on staging (which merged PRs introduced breakage and when), and produces fixes so PR CI, nightly, and post-deploy smoke all return green.

## Requirements (from GH Issue #1118)
1. Enumerate all currently-failing tests on staging (`main`) and production (PR CI, E2E Nightly, post-deploy smoke).
2. For each failing test, determine the root cause and classify it: genuine regression vs flaky vs infra/secret/environment.
3. Focus on the 2026-05-28 E2E Nightly (Production) failures — Chromium + Firefox, public `@critical` and evolution `@evolution` suites.
4. Investigate how tests got broken on staging (the `main` branch / staging environment): identify which merged PR(s) introduced the breakage and when CI started failing or began masking failures; confirm whether staging PR CI is currently green or hiding regressions.
5. Check whether the May 27 production release (#1114, includes migrations) caused prod-only schema/behavior drift behind the nightly failures.
6. Fix root causes per testing_overview.md rules — no retries, sleeps, or skips as "fixes".
7. Verify each fix locally (run the failing tests + a 5x stability check), then re-run full local checks before any push.
8. Confirm nightly and post-deploy smoke return green after fixes land.

## Problem
**Diagnosis complete (5 rounds × 4 agents).** The "E2E Nightly (Production)" suite has been 100% red since 2026-03-23 (last green: run `23397258100`, 2026-03-22) — a ~62-day silent outage. The original cause (prod Supabase migration freeze, queue aborted on a non-idempotent migration) was already fixed by #1074 on 2026-05-24, but a **residual layer of test/config bugs** keeps it red. The current 34 unexpected failures in run `26560963034` are **overwhelmingly test/config bugs, not app regressions**:
- **22** — admin specs tagged `@critical` run against the public host where post-split admin is host-gated (`adminAuth.isHostAcceptableForAdmin()` rejects public host → redirect → admin shell never renders). The hostname-split project explicitly deferred the `@critical`/`@evolution` re-tag (Phase 4 unfinished).
- **2** — `02-search-generate/status-pill` mock-dependent tests run against real prod (no `E2E_TEST_MODE` → mocked SSE `slow` scenario never fires).
- **1** — `00-host-isolation` local-only spec run against prod without the Vercel protection-bypass header.
- **2** — `tactics-tab`/`tactics-leaderboard` assume staging's ~24 `evolution_tactics`; prod has 1.
- **1** — `admin-evolution-invocation-detail` seeds a test-flagged row but never unchecks the default "Hide test content" filter (Rule 1 violation).
- **6** — Firefox `NS_BINDING_ABORTED` nav flake (firefox is informational — nothing gates on the nightly).

Plus three pipeline/infra issues that let prod-only breakage stay invisible: **post-deploy smoke can never trigger** (GitHub anti-recursion drops Vercel's `deployment_status`); **non-evolution integration/E2E never run on main PRs** (`base_ref`-gated); and the **`variant_kind` migration must apply to prod before #1116 ships** (fix-ordering; not a current red cause — #1116 is on main only).

## Options Considered
- [x] **Option D (CHOSEN): Hybrid multi-agent investigation.** Ran 5 rounds × 4 agents combining git/history bisect (B), environment/DB audit (C), and targeted reproduction/code-trace (A), classifying each failure before proposing fixes. This surfaced and corrected three wrong intermediate hypotheses (stale local `production` ref; `variant_kind` as a current cause; smoke `if:` as the bug) — validating the "classify before fixing" discipline.
- [x] ~~Option A (reproduce-first only)~~ — real-AI prod runs are slow/costly; used selectively for confirmation, not as the primary lens.
- [x] ~~Option B (bisect-only)~~ — correlational; needed code-trace + DB confirmation.
- [x] ~~Option C (env-audit-only)~~ — would have missed the dominant test/config (host-tagging) cause.

## Phased Execution Plan
Fixes are independent; order by impact. All are test/config/workflow changes — **no app code regressions to fix**. Honor testing_overview.md rules (no sleeps/`networkidle`/`test.skip`-as-crutch). Exact edit specs in research doc Round 5.

### Phase 1: Re-route admin specs to the evolution host (fixes 22 failures)
**Approach: tag each admin spec's TOP-LEVEL `describe` with `@evolution`** so the *entire file* runs on the evolution host (all admin functionality is evolution-host-only post-split) — this also avoids the "untagged sibling tests in the same file don't run via `@evolution` grep" gap that a per-test re-tag would leave.
- [x] For every spec under `src/__tests__/e2e/specs/09-admin/`, ensure the top-level `describe` carries `{ tag: '@evolution' }`, and remove ALL `@critical` tokens in the file (param-form, name-string, AND dual-tag array):
  - 12 dual-tagged `admin-evolution-*` describes: `{ tag: ['@evolution','@critical'] }` → `{ tag: '@evolution' }`.
  - 5 param-form `{ tag: '@critical' }` admin occurrences (`admin-strategy-registry:84` — describe already `@evolution`, so just REMOVE the inner `@critical`; `admin-prompt-registry:87`, `admin-auth:17`, `admin-candidates:16`, `admin-content:38`) — collapse to a describe-level `@evolution`.
  - 5 name-string tokens (`admin-prompt-registry:42`, `admin-strategy-crud:43`, `admin-whitelist:15`, `admin-reports:41`, `admin-users:15`): strip `@critical` from the title string; the file's describe-level `@evolution` covers them.
  - (Optional) clean misleading doc-comment `@critical` lines so future copy-paste doesn't reintroduce the bug.
- [x] Leave `00-host-isolation/host-isolation.spec.ts:32` as `@critical` (it's API-only/host-agnostic; handled in Phase 2 via `@skip-prod`).
- [x] Verify: `grep -rn "@critical" src/__tests__/e2e/specs/09-admin/` shows no title/tag tokens (doc-comments OK); `--grep "@critical" --list` shows zero admin specs; `--grep "@evolution" --list` shows ALL admin tests (not just the formerly-`@critical` ones). Public `@critical` suite = ~22 public-host tests, zero admin.

### Phase 2: Stop mock/local-only specs running against prod
- [x] Make `@skip-prod` exclusion prod-only: `playwright.config.ts:224` `grepInvert: /@skip-prod/` → `...(isProduction ? { grepInvert: /@skip-prod/ } : {})`. (Prod already excludes via nightly CLI `--grep-invert` + post-deploy `@smoke` grep.)
- [x] Tag `02-search-generate/status-pill.spec.ts` (the 2 `@critical` tests) and `00-host-isolation/host-isolation.spec.ts` `@skip-prod` — **only after** the config fix above, so they keep running locally/CI.
- [x] Confirm impact precisely: the config fix re-enables ~21 existing `@skip-prod` tests in the **full local `test:e2e`** run (and `test:e2e:critical` will now run the newly-tagged `status-pill`/`host-isolation` — this overlap is INTENDED, restoring their local/CI coverage). No `@skip-prod` test also carries `@smoke`, so post-deploy smoke is unaffected; `test:e2e:non-evolution` still excludes `@skip-prod` via its package.json `--grep-invert`; the prod nightly still excludes via its CLI `--grep-invert="@skip-prod"`. Net: prod exclusion preserved, local/CI coverage restored.
- [x] Add `status-pill.spec.ts` + `host-isolation.spec.ts` to the nightly pre-flight `@skip-prod` audit file list (`e2e-nightly.yml:151-156`) so this failure class (mock/local-only spec missing `@skip-prod`) is caught going forward. (Not optional — the audit is the regression guard for exactly this bug.)
- [x] Fix the now-stale `testing_overview.md:436` row (it claims `@skip-prod` runs in CI, which only becomes true after this config fix).

### Phase 3: Close the CI coverage gaps so re-tagged specs run on main PRs
- [x] `ci.yml:49` — append `|src/__tests__/e2e/specs/09-admin/|src/__tests__/e2e/specs/00-host-isolation/` to `EVOLUTION_ONLY_PATHS` so a main PR editing an admin spec classifies evolution/full → `e2e-evolution` runs it.
- [x] Verify a main PR editing only `09-admin/admin-users.spec.ts` triggers `e2e-evolution` (`test:e2e:evolution`, greps `@evolution`).
- [ ] (Decision) document/decide whether to also run `e2e-non-evolution` + `integration-non-evolution` on main PRs (currently production-only — the structural reason prod-only breakage hides).

### Phase 4: Fix the evolution-suite test bugs
- [x] `admin-evolution-invocation-detail` row-nav: uncheck "Hide test content" before asserting the seeded row (sibling pattern; no sleeps/skips).
- [x] Add `createTestTactic` helper to `src/__tests__/e2e/helpers/evolution-test-data-factory.ts`; self-seed `evolution_tactics` in `beforeAll`/cleanup in `afterAll` (removes the staging-tactic-set dependency; `syncSystemTactics` is upsert-only so seeds survive). Helper notes: `evolution_tactics` is NOT in the generated DB types yet — use the same `as unknown` cast the existing spec uses; set `status: 'active'` + unique `name` (so the tactics-tab `seed()` `WHERE status='active' LIMIT 2` finds them); register a `'tactic'` entry in the factory's `EvolutionEntityType` union + `FK_SAFE_DELETION_ORDER` for tracked cleanup.
  - `admin-evolution-strategy-tactics-tab`: seed ≥2 active tactics so the `seed()` ≥2-rows guard passes.
  - `admin-evolution-tactics-leaderboard`: the "search filter narrows the list" test types **`structural`** and asserts `1 ≤ rows ≤ 5` — so seed **at least one tactic whose name contains `structural`** (e.g. `[TEST_EVO] structural <suffix>`) and keep the total seeded set small (≤5) so the bounded assertion holds. Generic seeds alone will NOT fix this test.
- [x] Firefox `NS_BINDING_ABORTED`: accept for now (the nightly is informational — nothing `needs:` it, no `continue-on-error` required since nothing gates on it); optional follow-up = a single nav-retry on the abort (catch → re-`goto` → `waitForLoadState('domcontentloaded')`) rather than dropping the firefox row (which would forfeit cross-browser signal).

### Phase 5: Fix the broken test-pipeline plumbing
- [x] `post-deploy-smoke.yml` — make it actually fire on every prod release. The current `deployment_status` trigger never fires (GitHub anti-recursion on the `GITHUB_TOKEN`-created Vercel status). Replace the trigger with **`on: push: branches: [production]`** (Vercel deploys prod on this push) plus `workflow_dispatch`; keep `deployment_status` only as a harmless secondary. Concretely:
  - Trigger:
    ```yaml
    on:
      push:
        branches: [production]
      workflow_dispatch:
      deployment_status:   # secondary; currently inert (anti-recursion), kept harmless
    ```
  - **Update the job `if:`** so it does NOT skip the new event types (the current `if:` only references `deployment_status` fields → a `push`/`workflow_run` event leaves them null → job skipped). Branch on `github.event_name`:
    ```yaml
    if: |
      github.event_name == 'push' ||
      github.event_name == 'workflow_dispatch' ||
      (github.event_name == 'deployment_status' &&
        github.event.deployment_status.state == 'success' &&
        github.event.deployment.environment == 'Production' &&
        contains(github.event.deployment_status.target_url, 'vercel.app'))
    ```
  - **Extend the Health Check step into a wait-for-deploy poll** (the push fires immediately, before Vercel finishes building): raise `MAX_RETRIES`/delay to tolerate a multi-minute cold deploy (e.g. ~15 attempts × 20s ≈ 5 min) before running specs. (Note/limitation: the health poll confirms the apex is *healthy*, not that the *new* commit is live — acceptable for a smoke check; a follow-up refinement is to poll a `/api/health` version/SHA field until it matches the released commit. Document, don't block.) `workflow_run` on `"Deploy Supabase Migrations"` was rejected: that workflow only runs on migration-touching releases, so it'd give zero smoke coverage for migration-free releases.
- [ ] **Fix-ordering for the next release:** ensure migration `20260527000001_evolution_paragraph_kind_columns.sql` (+ siblings, idempotent/zero-touch) applies to prod **before/with** #1116's `variant_kind` filter code ships, or the variants admin page 500s on prod. Verify post-release via `npm run query:prod` that `evolution_variants.variant_kind` exists.

### Phase 6: Verify the whole thing goes green
- [x] Run the previously-failing specs locally (`npm run test:e2e:evolution`, `test:e2e:critical`) + 5x stability on each fixed spec.
- [x] Full local checks (lint + tsc + build + unit + ESM + integration + E2E critical) before push.
- [ ] After merge/release, re-trigger E2E Nightly via `workflow_dispatch` and confirm all matrix rows green; confirm post-deploy smoke actually fires + passes.

## Testing

### Unit Tests
- [x] None expected (no app-logic regression found). If the `createTestTactic` helper grows logic, colocate a `.test.ts`.

### Integration Tests
- [x] None expected (failures are E2E config/data, not server-action regressions).

### E2E Tests (the primary work — re-tag + fix, then must pass)
- [x] `src/__tests__/e2e/specs/09-admin/*` (admin + admin-evolution) — re-tagged `@evolution`, must pass on the evolution host.
- [ ] `src/__tests__/e2e/specs/02-search-generate/status-pill.spec.ts` — `@skip-prod`, still passes locally.
- [ ] `src/__tests__/e2e/specs/00-host-isolation/host-isolation.spec.ts` — `@skip-prod`, still passes locally.
- [x] `admin-evolution-invocation-detail.spec.ts`, `admin-evolution-strategy-tactics-tab.spec.ts`, `admin-evolution-tactics-leaderboard.spec.ts` — fixed (filter uncheck / self-seed), pass against prod data shape.

### Manual Verification
- [ ] Re-trigger E2E Nightly (Production) via `workflow_dispatch` post-fix; confirm all 4 matrix rows pass (or firefox-accepted).
- [ ] Confirm post-deploy smoke fires + passes on the next prod deploy.

## Verification

> **Key constraint shaping verification:** the only deployed-environment E2E signals are the **prod nightly** (`e2e-nightly.yml`) and **post-deploy smoke** — both run against the LIVE production deployment + **prod Supabase DB** (`qbxhivoezkfbjbsctdzo`), with real AI (NO `E2E_TEST_MODE`), prod `TEST_USER_*`, the Vercel bypass secret, and they **write to prod** (seed via service role — incl. `seed-admin-test-user.ts` — cleaned up via `[TEST]`/`[TEST_EVO]` prefixes + `afterAll`/global-teardown). The nightly checks out **`ref: production`**, so it only exercises specs already on `production`; a `workflow_dispatch` of it won't reflect un-released fixes. There is NO deployed-staging E2E (preview/staging use the Dev DB). Therefore most fixes are verified without prod; only prod-data-shape and trigger fixes need prod.

### Tier 1 — verify WITHOUT prod (deterministic; covers Phases 1–3)
- [x] **Admin re-tag is selection-only:** `npx playwright test --grep "@critical" --list` shows ZERO `09-admin/*` specs; `npx playwright test --grep "@evolution" --list` shows all admin specs.
- [x] Admin specs still pass locally: `npm run test:e2e:evolution` (localhost classifies as host tier `'local'`, which `adminAuth.isHostAcceptableForAdmin()` permits → admin renders).
- [x] **`@skip-prod` gating:** after the `playwright.config.ts:224` fix, `npm run test:e2e:critical` still RUNS + passes `status-pill` (2 tests) + `host-isolation` locally; then `BASE_URL=https://explainanything.vercel.app npx playwright test --grep "@critical" --list` confirms they are EXCLUDED when `isProduction`.
- [x] **detect-changes regex (`ci.yml:49`):** dry-run the classifier against a simulated changed-file list (only `09-admin/admin-users.spec.ts`) → expect `path=evolution-only`; or open a throwaway PR touching one admin spec and confirm `e2e-evolution` runs on the main PR.

### Tier 2 — replicate the nightly locally against the prod URLs (prod-data-specific fixes; pre-merge, OPT-IN)
Runs your branch's specs against the deployed prod app exactly as the nightly does — `BASE_URL` override disables the local webServer and `isProduction` auto-detects (`playwright.config.ts:77,90,168`):
- [ ] Evolution suite: `BASE_URL=https://ea-evolution.vercel.app <prod secrets…> npx playwright test --project=chromium --grep="@evolution" --grep-invert="@skip-prod"` → confirms `tactics` self-seed + `invocation-detail` filter fixes pass against prod's real data shape (1 tactic).
- [ ] **⚠️ Requires explicit go-ahead** — WRITES `[TEST_EVO]`/`[TEST]` content to the PROD DB (cleaned by `afterAll`/teardown). Per the no-shared-state-without-agreement rule, do not run against prod without sign-off.
- [ ] **⚠️ Requires prod secrets locally** (service role / `TEST_USER_*` / Vercel bypass) from the GitHub Production environment — `.env.local` points at Dev/staging; only `.env.prod.readonly` (read-only) is present. Supply them via a gitignored env file (e.g. `.env.prod.e2e`) or inline env — **never paste prod secrets into a tracked/committed file**, and be mindful they land in shell history.
- [ ] **Note on Tier-1 vs the 22 re-routed admin specs:** Tier-1's local run executes admin specs against `localhost` (host tier `'local'`, admin permitted) — this proves the specs work, but NOT that they pass on a host classified `'evolution'`. The 22 re-routed specs are only *authoritatively* confirmed green on the evolution host by Tier 3 (post-merge nightly) or an opt-in Tier-2 run against `ea-evolution.vercel.app`. Accept this as a known window, or run Tier-2 for the evolution suite before release to close it.

### Tier 3 — authoritative end-to-end (post-merge)
- [ ] After fixes reach `production` (normal release), trigger the nightly via `workflow_dispatch` (or wait for the 06:00 UTC schedule) → all 4 matrix rows green (firefox accepted if `NS_BINDING_ABORTED` persists).
- [ ] Confirm post-deploy smoke FIRES + passes on the next prod deploy (verifies the Phase-5 trigger fix).
- [ ] `workflow_dispatch` the smoke workflow directly to validate its matrix/health-check/specs independent of the trigger.

### Per-fix verification matrix
| Fix | Tier | Needs prod? |
|---|---|---|
| Admin re-tag (Phase 1) | 1 (`--list` + local evolution run) | No |
| `@skip-prod` gating + tags (Phase 2) | 1 (local + `--list` w/ prod BASE_URL) | No |
| detect-changes regex (Phase 3) | 1 (bash dry-run / throwaway PR) | No |
| invocation-detail filter (Phase 4) | 1 local (fix is data-independent) | No |
| tactics self-seed (Phase 4) | 1 local + 2 to confirm prod's 1-tactic case | Optional (Tier 2) |
| firefox accept (Phase 4) | 3 (nightly observation) | Yes (observe only) |
| smoke `workflow_run` trigger (Phase 5) | 3 (real deploy) + dispatch smoke job | Yes |
| migration fix-ordering (Phase 5) | `npm run query:prod` confirms columns exist before #1116 ships | Yes |

### Pre-push gate (every change)
- [x] Full /finalize local checks: lint + tsc + build + unit + ESM + integration + E2E critical (`npm run test:gate`).
- [ ] `npx playwright test <fixed-spec>` ×5 for stability on each fixed spec (catch residual flakiness; no retries/sleeps as crutches).

### Rollback
- [x] All changes are low-risk and git-revertable: the tag/config/workflow edits are reverted with a single `git revert` of the commit; no schema or app-logic change to undo.
- [x] Prod-touching steps are gated behind explicit opt-in: Tier-2 prod E2E (writes test data) requires sign-off; the prod migration applies via the normal `/mainToProd` release flow (not this PR); the smoke-trigger change only takes effect once on `production`.
- [x] If the re-routed admin specs fail on the evolution host post-merge (Tier 3), revert the Phase-1 tag commit (restores prior behavior — they'd be red on the public row again, i.e. no worse than today) and investigate the host-specific failure before re-applying.

## Files Modified
- **E2E spec tags (Phase 1):** `src/__tests__/e2e/specs/09-admin/*` admin + `admin-evolution-*` specs (~17 files) — `@critical`→`@evolution` (param-form, name-string, and dual-tag forms). Exact file:line list in research doc Round 5.
- **E2E spec tags (Phase 2):** `src/__tests__/e2e/specs/02-search-generate/status-pill.spec.ts` (2 tests) + `src/__tests__/e2e/specs/00-host-isolation/host-isolation.spec.ts` — add `@skip-prod`.
- **`playwright.config.ts`** — gate `grepInvert: /@skip-prod/` (line 224) behind `isProduction`.
- **`.github/workflows/ci.yml`** — extend `EVOLUTION_ONLY_PATHS` (line 49) to include `09-admin/` + `00-host-isolation/` spec dirs.
- **`.github/workflows/e2e-nightly.yml`** — (optional) add `status-pill`/`host-isolation` to the pre-flight `@skip-prod` audit file list (lines 151-156).
- **`src/__tests__/e2e/specs/09-admin/admin-evolution-invocation-detail.spec.ts`** — uncheck "Hide test content" before the seeded-row assertion.
- **`src/__tests__/e2e/helpers/evolution-test-data-factory.ts`** — add `createTestTactic` helper (+ extend entity-type union/cleanup).
- **`src/__tests__/e2e/specs/09-admin/admin-evolution-strategy-tactics-tab.spec.ts`** + **`admin-evolution-tactics-leaderboard.spec.ts`** — self-seed tactics in `beforeAll`, clean up in `afterAll`.
- **`.github/workflows/post-deploy-smoke.yml`** — replace trigger with `on: push: branches:[production]` (+ `workflow_dispatch`, `deployment_status` secondary); update job `if:` to branch on `github.event_name`; extend the Health Check into a multi-minute wait-for-deploy poll.
- **Docs:** `testing_overview.md`, `testing_setup.md`, `environments.md`, `pr_verification_gate.md` (see Documentation Updates).
- **No new migration file / no app-code changes.** The `variant_kind` fix is operational fix-ordering: apply existing `supabase/migrations/20260527000001-04_*.sql` (idempotent, zero-touch) to prod before/with #1116's release.

## Documentation Updates
- [x] `docs/docs_overall/testing_overview.md` — fix the stale `@skip-prod` row (:436); note post-split admin runs only on the evolution host (`@evolution`, not public `@critical`); record this failure class.
- [x] `docs/feature_deep_dives/testing_setup.md` — update `@critical`/`@evolution` suite description (admin moved to evolution host) + counts.
- [x] `docs/docs_overall/environments.md` — note the post-deploy-smoke trigger fix + the migration fix-ordering rule; reinforce release cadence (the 62-day outage root).
- [ ] `docs/feature_deep_dives/pr_verification_gate.md` — note the main-PR coverage gap (non-evolution integration/E2E production-only) if the Phase-3 decision changes it.
- [ ] `docs/docs_overall/debugging.md` / `debugging_skill.md` — only if a new debugging recipe is warranted (low priority).

## Review & Discussion

### Iteration 1 (2026-05-28) — scores: Security 3/5, Architecture 4/5, Testing 4/5 (consensus NOT reached)
Reviewers validated the plan against the actual codebase. Gaps fixed:
- **[CRITICAL — Security] Phase 5 `workflow_run` named the wrong workflow** (`"Supabase Migrations"` vs actual `name: "Deploy Supabase Migrations"`) → would silently never fire. **Resolved** by abandoning `workflow_run` entirely in favor of `on: push: branches:[production]` (fires on every prod release, not just migration releases).
- **[blocking — Arch/Sec] Phase 5 job `if:` only matched `deployment_status` fields** → a new-trigger event would be skipped. **Resolved**: `if:` now branches on `github.event_name`.
- **[important] Phase 5 migration-less releases** got zero smoke coverage under the workflow_run idea. **Resolved** by the `push: branches:[production]` trigger + extended health-poll.
- **[important — Arch] Tactics search-filter not fixed by generic seed** — `tactics-leaderboard` types `structural`; prod has none. **Resolved**: Phase 4 now requires seeding a `structural`-named tactic (total ≤5).
- **[Arch] Phase 1 partial-file tagging** — per-test re-tag left untagged sibling tests uncovered. **Resolved**: switched to describe-level `@evolution` tagging (whole admin file runs on evolution host).
- **[minor] Made the `@skip-prod` audit-list addition non-optional** (regression guard); reworded the misleading "CI `:critical` unaffected" (overlap is intended); added the `admin-strategy-registry` "just remove inner `@critical`" precision; added `createTestTactic` untyped-cast/`status:'active'`/union notes.
- **[minor — Testing] Added explicit callout** that Tier-1 local (`'local'` host) pass ≠ evolution-host pass; the 22 re-routed specs are authoritatively confirmed only by Tier-2/Tier-3. Added a **Rollback** subsection and a Tier-2 secrets-handling warning.
Confirmed-correct by reviewers (no change needed): migrations `20260527000001-04` are idempotent/zero-touch (safe to apply to prod); `playwright.config.ts:224` grepInvert gating is syntactically correct + `isProduction` in scope; `ci.yml:49` regex extension carries no misclassification risk and `e2e-evolution` runs on main PRs for evolution-only paths; `createTestTactic` fits the factory pattern and `syncSystemTactics` is upsert-only; the host-gating model + full tag inventory match the real files line-for-line.

### Iteration 2 (2026-05-28) — scores: Security 5/5, Architecture 5/5, Testing 5/5 ✅ CONSENSUS REACHED
All iteration-1 gaps verified resolved against the actual code (Phase-5 `push:[production]` trigger confirmed as the real Vercel/Supabase prod-deploy branch; `if:` now branches on `event_name`; describe-level `@evolution` tagging confirmed to cover all admin tests with the 22-token inventory matching line-for-line; tactics `structural`-seed matches the real `rows ≤ 5` assertion; migrations idempotent; `ci.yml:49` regex routes admin-only main PRs to `e2e-evolution`). No critical gaps; plan is ready for execution.

**Non-blocking polish to apply during execution (reviewer minors, none block):**
- Phase 5: also add `push` to the Slack-notify step's `cancelled()` guard (`post-deploy-smoke.yml:~182`, currently `event_name=='deployment_status'`) so a cancelled push-triggered run still alerts; failures already alert via `failure()`.
- Phase 5: add a `concurrency:` group to the smoke workflow (tidy — prevents a double-run if both `push` and a future `deployment_status` fire).
- Phase 1: `admin-auth.spec.ts` has TWO top-level describes — tag the `Admin Authentication` describe `@evolution`; the 2nd (`Admin Access Control`) holds only a host-agnostic `test.skip`, so no coverage gap, but tag it too for consistency.
- Phase 4: `evolution_tactics` has no tracked FK dependents, so its position in `FK_SAFE_DELETION_ORDER` is flexible; follow-up = regenerate DB types so `createTestTactic` can drop the `as unknown` cast.
- Phase 3: the "also run non-evolution integration/E2E on main PRs" question remains an open user decision (cost vs the prod-only-breakage blind spot) — documented, not resolved; not required for these fixes.
- Cosmetic: the `e2e-nightly.yml` audit-list citation is ~2 lines off (actual ~153-159); `e2e-critical` runs via the `chromium-critical` project (testMatch AND `grep:/@critical/`), which is what drops the re-tagged admin specs.
