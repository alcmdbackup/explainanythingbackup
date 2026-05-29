# Investigate Recent Broken Tests (Main + Prod) Research

## Problem Statement
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

## High Level Summary
The "E2E Nightly (Production)" suite is red, but Round 1 showed this is **not** a fresh May-27 break: every nightly run in the available 60-run window is `failure` from **~2026-03-30 through 2026-05-28** (~62 days) — a long-standing silent outage (Slack alerting went unread, matching environments.md's documented 62-day drift incident). On top of that baseline, Round 1 confirmed **two genuinely new problems** from the May-27 release plus several structural CI blind spots. The failures cluster into independent causes (multiple bugs, not one), summarized below.

## Round 1 Findings (2026-05-28) — 4 agents, ground truth

### A. Exact failing tests (recovered from Playwright artifacts; GH logs had rotated)
Run `26560963034` matrix outcomes:
| Browser | Host | Result | unexpected/flaky/skipped/total |
|---|---|---|---|
| chromium | public (@critical) | failure | 25 / 0 / 12 / 78 |
| firefox | public (@critical) | cancelled (45-min job timeout, sequential queue) | n/a |
| chromium | evolution (@evolution) | failure | 3 / 2 / 31 / 151 |
| firefox | evolution (@evolution) | failure | 6 / 2 / 36 / 151 |

- **public/chromium (25 failures):** almost entirely `specs/09-admin/*` — admin shell never renders (`aside` sidebar / table headings absent within 60–120s) across nearly all admin + admin-evolution specs. Plus `00-host-isolation` `/api/health` → **expect 200, got 404**; plus `02-search-generate/status-pill` (×2). Helper at `src/__tests__/e2e/helpers/pages/admin/AdminBasePage.ts:41`.
- **evolution/chromium (3):** `admin-evolution-strategy-tactics-tab` (fixture error: needs ≥2 `evolution_tactics` rows), `admin-evolution-invocation-detail` (row nav link not visible), `admin-evolution-tactics-leaderboard` (search filter `waitForFunction` 10s).
- **evolution/firefox (6):** the 3 above + `admin-evolution-navigation`/`-variants`/`-experiments-list` failing with Firefox-only `page.goto: NS_BINDING_ABORTED` (browser nav flake).
- **Regression window:** NO last-green in 60 runs — red since ~2026-03-30. Baseline outage predates the May-22 hostname split and May-27 release.

### B. Staging / main CI health — "green but hiding regressions"
- main PR CI passes on merge (after retries), BUT two structural blind spots:
  1. **`integration-non-evolution` + `e2e-non-evolution` are SKIPPED on every PR to `main`** — their `if:` requires `base_ref == 'production'` (ci.yml ~L414-417, L601-604). They only run on the main→production release PR. Combined with unit `--changedSince=origin/main`, a non-evolution regression can merge to main with its integration/E2E coverage entirely skipped, surfacing only later in the prod nightly.
  2. **Post-deploy smoke can effectively NEVER run.** All 40 recent runs `skipped`: the `if:` (post-deploy-smoke.yml ~L14-17) needs `state==success` AND `environment=='Production'` AND `target_url` contains `vercel.app` simultaneously. Real `vercel.app`+`success` deploys are `environment=Preview`; the `Production` env "deployments" are GitHub-Actions phantom deployments with github.com URLs + failure state. No deployment satisfies all three → staging/prod gets zero post-deploy smoke coverage.
- Migrations workflow (`supabase-migrations.yml`): green. `lint-migrations-idempotent` still warn-only (continue-on-error).

### C. May-27 release (#1114) analysis — suspects for the NEW failures
`762477d4` is a squash release commit (102-file diff, +4745/-2281); nightly workflow files unchanged → regression is in app/spec code.
- **2 net-new migrations:** `20260524000006_evolution_logs_subagent_name.sql` (ADD subagent_name + mirror trigger), `20260524000007_evolution_logs_drop_agent_name.sql` (**DROP COLUMN agent_name CASCADE**, `-- @destructive-ddl-approved`).
- **Suspect — public @critical:** guest auto-login refactor (PR #1110) — deleted `ServiceUnavailableNotice.tsx` + `GUEST_AUTOLOGIN_FAILED_RECENTLY` cookie; failed guest `signInWithPassword` now redirects to `/login`. `smoke.public.spec.ts` rewritten to assert `not.toHaveURL(/\/login/)`. Prod-only path (gated `E2E_TEST_MODE !== 'true'`), so CI never exercises it → would pass CI, fail nightly. Sensitive to prod GUEST_PASSWORD drift.
- **Suspect — @evolution:** Subagents-default-tab UI change (PR #1109) — `invocation-detail` specs updated; `agent_name`→`subagent_name` rename + DROP COLUMN migration read live by `admin-evolution-logs`/`-subagents`.

### D. DB / env state — CONFIRMED prod migration drift
- `npm run query:prod` / `query:staging` both usable here (`.env.*.readonly` present). `readonly_local` cannot read `supabase_migrations` schema or `auth.users`.
- **Confirmed drift:** prod = 418 columns, staging = 420. Missing on prod: `evolution_prompts.prompt_kind` and `evolution_variants.variant_kind` → from `supabase/migrations/20260527000001_evolution_paragraph_kind_columns.sql` (+ likely siblings `..02–..04`). **The May-27 paragraph_kind migration did NOT land on prod** despite being on staging. All 42 base tables otherwise identical; core tables present.
- Guest env vars present in `.env.local` (not verified against prod auth.users). 6 `[TEST]%` explanations on prod (low).

### Open questions carried into Round 2
1. Why do 25 **public-host @critical** admin specs fail to render the admin shell? Hypothesis: after the hostname split, admin routes 404 on the public host — are @critical-tagged admin specs wrongly run against `explainanything.vercel.app` instead of the evolution host? (test/matrix config bug) vs admin auth not establishing vs missing Vercel bypass.
2. `/api/health` 404 in Playwright context (`00-host-isolation`) — Vercel bypass header/cookie not applied to the test request context?
3. Do the evolution failures (tactics seed-data, invocation-detail, firefox nav) reflect test bugs/flakiness vs real regressions? Does the prod `paragraph_kind` drift actually break any @evolution test, or is it latent?
4. When EXACTLY did nightly first go red (~Mar 30?) and what changed then — was it ever green, or has the matrix/grep been misconfigured since a date?
5. Is the public guest auto-login currently broken on prod (GUEST_PASSWORD drift), and does it cause the `search-generate/status-pill` failures?

## Round 2 Findings (2026-05-28) — 4 agents, root-cause + classify

### Corrected timeline (Agent C) — nightly WAS green, broke 2026-03-23
Pulling 100 runs (not 60) revealed a clean green→red transition:
- **Last green nightly:** 2026-03-22 06:20 UTC (run `23397258100`).
- **First red of the permanent streak:** 2026-03-23 06:30 UTC (run `23424526948`); 100% red since (27 success / 73 failure in window, all successes pre-Mar-23).
- **Original cause:** the 2026-03-23 `main→production` merge (#785, `e3311436`) shipped evolution-schema-dependent code while the **production Supabase DB stayed frozen at the 2026-03-05 schema** — the migration queue aborted on the first non-idempotent migration `20260322000003_add_budget_check_constraint.sql` (`chk_budget_cap` already existed). 73 migrations went unapplied. This is the documented "62-day silent outage" (Slack alert was broken; nothing gates on the nightly).
- **Prior postmortem exists:** `docs/planning/smoke_test_and_nightly_e2e_failing_20260523/` already diagnosed this, fixed the idempotency (PR #1074, merged 2026-05-24) and rebuilt the dual-host matrix + Slack gate. It **predicted the 2026-05-24 nightly would be the first green in ~2 months — it was NOT.** This project continues that work: the bulk schema fix removed the 62-day cause but a residual second layer of failures remains.

### IMPORTANT correction to a Round-2 agent error (verified by me)
Round 2's admin-failure agent claimed `production` is frozen at `ce02a50d` (2026-03-05) and pre-split. **That was based on a stale LOCAL `production` ref.** Verified directly: `origin/production` = `762477d4` (May 27) and **contains the split code** (`src/config/hostnames.ts` exists; `src/middleware.ts` has `classifyHost` + per-host 404s). So the nightly checks out **current post-split prod code**. The agent's *fix direction* still holds, but its "pre-split / stale-deploy" reasoning is discarded.

### Root-cause catalog (the residual current failures)
The current red is **multiple independent bugs**, not one. Classified:

| # | Failure cluster | Root cause | Class | Fix direction |
|---|---|---|---|---|
| 1 | 25 public `@critical` admin specs — admin shell never renders | Admin `@critical` specs run against the **public host** (`explainanything.vercel.app`) where post-split admin is host-gated: `adminAuth.ts:isHostAcceptableForAdmin()` returns false on the public host → `requireAdmin` redirects → admin shell never mounts → `AdminBasePage.ts:41` `aside` timeout. The split plan wrongly assumed `@critical` admin specs could stay on the public row. | **Test/matrix config bug** | Move admin coverage to the evolution-host row (re-tag admin specs `@evolution`, or add a 3rd matrix row running `09-admin @critical` against `ea-evolution.vercel.app`), or grep `@critical AND NOT admin` on the public row. |
| 2 | `00-host-isolation /api/health` → 404 (public @critical) | Spec is **local-only by design** (its header says "runs against local dev server"); it builds custom `request.newContext()` with `extraHTTPHeaders:{host}` + `maxRedirects:0` but **never injects the Vercel deployment-protection bypass** header/cookie (unlike `fixtures/auth.ts`/`global-setup.ts`). Against the protected apex, Vercel's edge returns a non-200 protection response. `/api/health` IS served (it's in `ALWAYS_ALLOWED_PREFIXES`). | **Test bug** | Inject the Vercel bypass into the host-isolation contexts, or `@skip-prod`/exclude from prod matrix. |
| 3 | `02-search-generate/status-pill` ×2 (public @critical) | Specs depend on the mocked SSE `slow` scenario that only fires when `E2E_TEST_MODE=true`; the nightly runs with NO `E2E_TEST_MODE` against real prod → the `streaming`/`hint` pill states never assert → timeout. (NOT guest-login — these use `authenticatedPage`/`TEST_USER`, not guest auto-login.) | **Test bug** (mock-dependent spec vs real prod) | Tag `@skip-prod` (same belt-and-suspenders pattern as other mock-dependent specs). |
| 4 | `admin-evolution-variants` list 500/blank (evolution, both browsers) | **Real regression × prod drift:** PR #1116 added a `variant_kind` filter — `variants/page.tsx:167` defaults `variantKind:'article'` → `listVariantsAction` runs `.eq('variant_kind','article')` (`evolutionActions.ts:742-744`), but `evolution_variants.variant_kind` is **missing on prod** (migration `20260527000001_evolution_paragraph_kind_columns.sql` not applied). Query throws → blank table. | **Real regression (infra: prod migration drift)** | Apply migration `20260527000001` (+ siblings) to prod; investigate why it didn't deploy with #1114. |
| 5 | `admin-evolution-strategy-tactics-tab` (needs ≥2 tactics); `admin-evolution-tactics-leaderboard` (search filter) | Specs assume staging's ~24 `evolution_tactics`; **prod has 1** (`debate_synthesis`). beforeAll throws / filter finds no `structural*` match → timeout. | **Test-data dependency** | Seed own tactic rows, or `@skip-prod`. |
| 6 | `admin-evolution-invocation-detail` row-nav (evolution chromium) | NOT drift (`listInvocationsAction` doesn't read kind columns). Seed-row visibility / `is_test_content` default-filter / timing. | **Test/flaky** | Add wait-for-row / reset filter; investigate. |
| 7 | Firefox `NS_BINDING_ABORTED` on `page.goto` — navigation/variants/experiments-list (evolution firefox) | Known firefox-specific aborted-navigation flake. Firefox **is a blocking matrix row** (no `continue-on-error`). | **Flaky (browser-specific)** | Accept-as-flaky / fix nav waits / consider dropping firefox from gating. |

### Structural CI blind spots (independent bugs that let regressions reach prod silently)
| # | Bug | Detail | Fix direction |
|---|---|---|---|
| 8 | **Post-deploy smoke can never trigger** | `post-deploy-smoke.yml` job `if:` requires `state==success` AND `environment=='Production'` AND `target_url` contains `vercel.app` simultaneously; no real deploy satisfies all three (real vercel.app+success deploys are `environment=Preview`; the `Production` "deployments" are GH-Actions phantoms with github.com URLs). All 40 recent runs `skipped`. | Change `if:` to `state=='success' && contains(target_url,'.vercel.app')` (USER to decide preview-vs-prod precision tradeoff — see open items). |
| 9 | **Non-evolution integration + E2E skipped on every main PR** | `integration-non-evolution` + `e2e-non-evolution` `if:` requires `base_ref=='production'`; with unit `--changedSince`, a non-evolution regression can merge to main with its integration/E2E coverage never running → surfaces only in prod nightly. | Decide whether to also run them on main PRs (cost tradeoff) — at minimum document the gap. |
| 10 | **`20260527000001` paragraph_kind migration not applied to prod** | Despite #1074 fixing the queue, the latest May-27 migration didn't land on prod (columns still missing). Need to confirm why (queue re-aborted? not pushed? errored?). | Re-run / investigate `supabase-migrations.yml` prod deploy for #1114. |

### Items requiring the USER (cannot self-verify safely)
- **Prod `GUEST_PASSWORD` sync** across Supabase + Vercel + GitHub secrets + `.env.local` — cannot read prod `auth.users`; must not touch secrets. Affects public guest auto-login / `smoke.public.spec.ts`.
- Decision on smoke `if:` precision (smoke-on-every-deploy vs prod-promotion-only).
- Whether/how to apply the pending prod migration (prod deploy is user/process-controlled via `/mainToProd`).

## Round 3 Findings (2026-05-28) — 4 agents, confirm/reproduce

### CONFIRMED: admin `@critical` specs run on the wrong host (dominant cause — 22 of 25 public failures)
Exact chain (cited): nightly public row (`e2e-nightly.yml:24-26`) = `base_url: explainanything.vercel.app`, `grep '@critical'`, `--grep-invert '@skip-prod'`, checkout `ref: production` (current/post-split). On the public host `classifyHost()`→`'public'` → `adminAuth.ts:33-36 isHostAcceptableForAdmin()`→false → `admin/layout.tsx:20-22 redirect('/')` → `AdminBasePage.ts:40-41` navigates `/admin`, lands on `/`, `aside` never visible → timeout.
- **Mis-routed specs** (tagged `@critical`, render admin shell): pure-`@critical` non-evolution admin: `admin-auth`, `admin-candidates`, `admin-content`, `admin-prompt-registry` (incl. an **inline-title** `@critical` at `:42`), `admin-strategy-registry`, `admin-strategy-crud` (**inline-title** `@critical` at `:43`). Plus 12 `admin-evolution-*` specs **dual-tagged `['@evolution','@critical']`** that leak onto the public row.
- `00-host-isolation` is `@critical` on the public row but is correctly host-scoped (API-only, no admin shell) — its failure is separate (see below).
- **The split project explicitly left this unfinished:** `split_..._progress.md:120-121` marks "`@critical` E2E against public host / `@evolution` against evolution host" as ⏳ deferred (Phase 4). So the re-tagging was intended but never completed.
- **Fix:** make admin specs match only `@evolution` (drop `@critical`; fix the 2 inline-title tokens). Tag-level fix preferred over workflow grep, because dual-tagged specs leak under any pure-`@critical` grep.

### CONFIRMED: status-pill ×2 and host-isolation are test bugs → `@skip-prod`
- `status-pill.spec.ts` 2 `@critical` tests assert `data-pill-state='streaming'/'hint'` driven by the mocked SSE `slow` scenario in `app/api/returnExplanation/test-mode.ts` which only runs when `E2E_TEST_MODE==='true'` (`route.ts:23`). Nightly sets NO `E2E_TEST_MODE` (`e2e-nightly.yml:55`) → states never materialize against real prod AI → timeout. (The 3rd, self-mocking test is NOT `@critical` and is prod-safe.)
- `host-isolation.spec.ts` is local-only by design (header: "runs against local dev server"); its `request.newContext()` (`:23-30`) omits the Vercel protection-bypass cookie that `fixtures/auth.ts:144-150` injects → prod edge returns non-200 for `/api/health` (which IS in `ALWAYS_ALLOWED_PREFIXES`, so the app is correct).
- **Fix:** tag both `@skip-prod`. The nightly's `--grep-invert '@skip-prod'` (`:180`) then excludes them. (Note: the pre-flight audit at `e2e-nightly.yml:142-170` only checks a hardcoded 6-file list — adding these tags won't trip it; consider adding both files to that audit list too.)

### CORRECTION: `variant_kind` prod drift is NOT a current nightly cause (it's a future fix-ordering risk)
Round 2 attributed an evolution failure to the `variant_kind` column drift. **Refuted by Round 3:**
- Migrations `20260527000001-04` AND the `variant_kind` filter (`evolutionActions.ts:743-745`) were **both introduced by PR #1116** (`41cdbb9a`, merged to **main only**, 2026-05-28 06:13). They are **not on `origin/production` (#1114)**.
- The nightly checked out `production` (#1114) which has neither the filter nor the column → no 500 from this path on prod today. The nightly's `admin-evolution-variants` failure was **Firefox `NS_BINDING_ABORTED` only** (chromium/evolution did NOT fail variants).
- #1116's push-to-main deployed the migrations to **staging** (why staging has the columns); the prod deploy job is gated `if: github.ref=='refs/heads/production'` (`supabase-migrations.yml:169`) → prod skipped, correctly, because #1116 isn't released yet.
- **So this is a fix-ordering requirement for the NEXT release:** when #1116 ships to prod, the migration must apply before/with the filter code. The migrations are idempotent + zero-touch (`ADD COLUMN IF NOT EXISTS ... NOT NULL DEFAULT 'article'`, no backfill) — safe to apply. Not a current red-nightly cause.

### Completeness + firefox + the search for masked failures
- **Complete failing set confirmed** (decoded from all artifacts): public/chromium 25, evolution/chromium 3, evolution/firefox 6. **Nothing beyond the known set.** (evolution/chromium also had 2 flaky-but-passed: criteria-wizard, wizard-tactics.)
- **Firefox is informational:** `fail-fast:false`, `max-parallel:1`, no `continue-on-error`; nothing `needs:` the nightly and no workflow references it → purely informational, nothing gates on it. The firefox/public job was **cancelled at 45-min `timeout-minutes`** because `max-parallel:1` serialized it behind the slow chromium suites (not a distinct failure).
- `admin-evolution-invocation-detail` (evolution/chromium) is NOT drift-related (`listInvocationsAction` doesn't read kind columns) — seed-row visibility / `is_test_content` filter / timing; root-cause carried to Round 4.

### UNRESOLVED CONTRADICTION → Round 4: does the post-deploy-smoke `if:` actually work?
Round 1 & Round 2 agents concluded `post-deploy-smoke.yml`'s `if:` (`state==success && environment=='Production' && contains(target_url,'vercel.app')`) can NEVER match. **Round 3 Agent D refuted this:** it found a real `vercel[bot]` deploy (`4844089914`, `environment=Production`) with a success status whose `target_url=https://explainanything-…vercel.app` — which the **current** `if:` WOULD match; and the github.com phantoms (env=Production, github.com URL) are correctly excluded by the `vercel.app` check. Agent D warns the earlier "drop the environment check" proposal is over-broad (preview deploys also emit success+`.vercel.app`, so it'd fire smoke on every PR preview). **But all 40 recent smoke runs are still `skipped`** — so if the `if:` can match, WHY are they all skipped? Must resolve by inspecting the actual `deployment_status` event that triggered each skipped run (is it always a github.com phantom? do real vercel[bot] prod success events even reach the workflow?). The fix differs: tweak `if:` vs fix the trigger/integration.

## Round 4 Findings (2026-05-28) — 4 agents, cross-check + fill gaps

### RESOLVED: why post-deploy smoke never runs — it's the TRIGGER, not the `if:`
Definitive: the real `vercel[bot]` Production deploy (`4844089914`, sha `762477d4`) HAS a success status with `target_url=…vercel.app` that the **current `if:` would match** — but that event **never triggers the workflow**. GitHub suppresses workflow runs for `deployment_status` events created by the default `GITHUB_TOKEN` (anti-recursion), and Vercel's GitHub App posts via that token. The only events that DO trigger smoke runs come from the `alcmd15492` PAT (the deploy workflow's own phantom statuses: `in_progress`/`failure`, github.com `target_url`) — which correctly skip. Confirmed: zero smoke runs have a vercel[bot] Production sha as their `head_sha`; all triggered runs are `alcmd15492`.
- **Fix (NOT loosening `if:`):** replace the unreliable `deployment_status` trigger with an explicit hand-off — a `workflow_run` trigger keyed on the production-deploy workflow `completed+success`, or call smoke as a `needs:` job at the end of the prod-promotion workflow, or have the PAT (not GITHUB_TOKEN) POST a `success`/`Production`/`vercel.app` deployment status post-promotion. Keep the `environment=='Production'` clause (preview deploys also emit success+`.vercel.app`).

### CRITICAL CORRECTION: `@skip-prod` is currently excluded EVERYWHERE (not just prod)
`playwright.config.ts:224` sets `grepInvert: /@skip-prod/` **unconditionally** (top-level, not gated by `isProduction`) since commit `526098aa` (2026-05-03, comment "B116: always exclude @skip-prod tests"). So a `@skip-prod` test is dropped from **local `/finalize`, CI, nightly, AND post-deploy** — everywhere. The docs are stale (`testing_overview.md:436` still says CI runs them).
- **Consequence:** simply tagging `status-pill` (×2) + `host-isolation` `@skip-prod` would silently remove real coverage from local + CI, not just prod. `host-isolation` is genuine public-host 404-isolation coverage; the status-pill streaming/hint states are valuable locally.
- **Correct fix options:** (1) gate `grepInvert: /@skip-prod/` behind `isProduction` in `playwright.config.ts` so `@skip-prod` means "skip on prod only" (matches the doc intent), THEN tag the specs; or (2) give the specs a runtime guard that skips only when running against real prod (no `E2E_TEST_MODE` / prod BASE_URL), keeping them in local/CI. Decision needed; option (1) is cleaner and fixes the doc/behavior mismatch globally.

### Last evolution failure root-caused: `admin-evolution-invocation-detail` row-nav
Deterministic test bug (NOT flaky, NOT drift): the invocations list defaults "Hide test content" ON (`invocations/page.tsx:19,105`); `listInvocationsAction` excludes runs whose strategy `is_test_content=true`. The spec seeds a timestamp-named strategy (`e2e-invocations-<ts>-strategy`) which the BEFORE trigger `evolution_is_test_name()` flags as test content → the seeded row is hidden → row link never visible (`spec:139` timeout). Sibling specs (variants/cost-split/runs) explicitly uncheck the filter first; this one doesn't (violates testing_overview.md Rule 1).
- **Fix:** uncheck "Hide test content" before asserting (match sibling pattern); no sleeps/skips.

### Tactics specs: self-seed preferred over `@skip-prod`
Prod has 1 `evolution_tactics` row; staging ~24. `evolution_tactics` is service-role insertable (canonical set in `evolution/src/lib/core/tactics/index.ts` `DEFAULT_TACTICS`/`syncSystemTactics`). Add a `createTestTactic`-style `beforeAll`/`afterAll` seed (no helper exists yet) rather than `@skip-prod` — avoids a prod coverage gap.

### Re-tag fix is SOUND but bigger + has a coverage-gap subtlety
- **Sound:** post-split there is NO admin surface on the public host (`adminAuth.ts:33` rejects public/unknown), so admin was never public-host-runnable. Re-tagging admin → `@evolution` loses no public coverage; the public `@critical` suite retains ~22 genuine public-host tests (auth/session, unauth, search/generate, library, content-viewing, sources, host-isolation).
- **Bigger than first thought — name-string `@critical` tokens:** `admin-users.spec.ts:15`, `admin-whitelist.spec.ts:15`, `admin-reports.spec.ts:41` carry `@critical` **in the test-name string** (matched by `--grep`), plus param-form tokens at `admin-prompt-registry.spec.ts:42` and `admin-strategy-crud.spec.ts:43`. All must be caught or the fix is incomplete.
- **Coverage-gap subtlety (RISK #4 — must address):** removing `@critical` from the ~8 non-evolution admin specs WITHOUT adding `@evolution` drops them from main-PR CI entirely (`e2e-critical` runs only `@critical` on main; `e2e-non-evolution` runs only on production PRs). AND `detect-changes` classifies by file PATH: specs like `admin-strategy-registry`/`admin-users`/`admin-whitelist`/`admin-reports`/`admin-auth`/`admin-candidates`/`admin-content` do NOT match the evolution path regex, so even when tagged `@evolution` a PR touching only them classifies `non-evolution-only` → neither `e2e-evolution` (needs evolution/full path) nor `e2e-non-evolution` (production-only) runs them on a main PR. **Fix must add `@evolution` AND ensure these specs reliably run on main PRs** (extend `detect-changes` evolution paths to include `src/__tests__/e2e/specs/09-admin/**`, or a dedicated admin matrix row).

## Investigation conclusion (after 4 rounds)
**The current nightly red is overwhelmingly TEST/CONFIG bugs, not app regressions.** Breakdown of the 34 unexpected failures:
- 22 = admin `@critical` specs run against the public host where admin is host-gated (split Phase 4 re-tagging never completed). **Test/matrix config.**
- 2 = `status-pill` mock-dependent specs run against real prod (no `E2E_TEST_MODE`). **Test config.**
- 1 = `host-isolation` local-only spec run against prod without Vercel bypass. **Test config.**
- 2 = `tactics-tab`/`tactics-leaderboard` assume staging's tactic set; prod has 1. **Test-data.**
- 1 = `invocation-detail` missing "show test content" before asserting seeded row. **Test bug (Rule 1).**
- 6 = Firefox `NS_BINDING_ABORTED` nav flake (firefox is informational; nothing gates on the nightly). **Flaky.**
The only app-adjacent items are **latent/forward-looking**: the `variant_kind` migration must apply to prod before #1116 ships (fix-ordering), and two genuine infra bugs in the test pipeline itself — **post-deploy smoke can't trigger** (anti-recursion) and **non-evolution integration/E2E never run on main PRs** (base_ref-gated), which is the structural reason prod-only breakage stays invisible until the (unwatched) nightly. The original 62-day red (Mar 23→May 24) was the prod migration freeze, already fixed by #1074; this project resolves the residual layer.

## Round 5 Findings (2026-05-28) — 4 agents, concrete validated fix specs
(Full edit-level detail lives in the planning doc's fix plan; key decisions below.)

1. **Admin re-tag (the 22 failures):** exhaustive token list produced — 12 dual-tagged `admin-evolution-*` describes (`['@evolution','@critical']`→`'@evolution'`), 5 param-form `{tag:'@critical'}` admin specs (→`'@evolution'`, ADDING `@evolution`), and 5 **name-string** `@critical` tokens (`admin-prompt-registry:42`, `admin-strategy-crud:43`, `admin-whitelist:15`, `admin-reports:41`, `admin-users:15` → move into `{tag:'@evolution'}`, strip token from title). Plus optional doc-comment cleanup. **`host-isolation.spec.ts:32` KEEPS `@critical`** (API-only/host-agnostic) — it gets `@skip-prod` instead. Verified: after edits the public `@critical` suite contains ZERO admin specs and retains ~22 genuine public-host tests.
2. **`@skip-prod` mechanism:** chosen fix = make `playwright.config.ts:224` `grepInvert: /@skip-prod/` conditional on `isProduction` (which is already in scope at L90). Prod exclusion is already handled by the nightly CLI `--grep-invert="@skip-prod"` and post-deploy's positive `@smoke-*` grep, so the unconditional config line is redundant-for-prod and is the bug. Impact: 9 files / ~21 test-level `@skip-prod` tags would newly run in **local `test:e2e`** only — CI `:critical`/`:smoke` unaffected (no overlap), and `:non-evolution` already excludes `@skip-prod` via package.json. Then tag `status-pill` (2 tests) + `host-isolation` `@skip-prod`. Update stale `testing_overview.md:436`.
3. **detect-changes coverage (RISK #4):** one-line fix — append `|src/__tests__/e2e/specs/09-admin/|src/__tests__/e2e/specs/00-host-isolation/` to `EVOLUTION_ONLY_PATHS` (`ci.yml:49`) so a main PR editing a re-tagged admin spec classifies evolution-only → `e2e-evolution` runs it. Confirmed admin works under CI's `localhost` server (`classifyHost`→`'local'`, which `isHostAcceptableForAdmin` permits) — the host gate is not a factor locally.
4. **smoke trigger:** add a `workflow_run` trigger on the `"Supabase Migrations"` workflow `completed`+`branches:[production]`, keep `deployment_status` as secondary; the existing health-check step gates "deploy live". (No GH-side Vercel deploy exists — Vercel deploys on push-to-`production`; the migrations workflow is the reliable prod-side signal.) Do NOT loosen the `if:`.
5. **invocation-detail:** insert an uncheck-"Hide test content" step before the seeded-row assertion (sibling pattern). **tactics specs:** add a `createTestTactic` helper to `evolution-test-data-factory.ts` and self-seed ≥2 tactics in `beforeAll`/cleanup in `afterAll` (confirmed `syncSystemTactics` is upsert-only, never deletes, so seeded rows survive). **firefox `NS_BINDING_ABORTED`:** accept now (nightly is informational); optional later fix = single nav-retry on the abort rather than dropping the firefox row.

### Initial observations (gathered during /initialize)
- Only one recently-failed GitHub Actions run as of 2026-05-28: **E2E Nightly (Production)**, run `26560963034`, created `2026-05-28T07:26:46Z` on `main`.
  - Failed jobs: `e2e (chromium, public, @critical)`, `e2e (chromium, evolution, @evolution)`, `e2e (firefox, evolution, @evolution)`; the `firefox public @critical` job was `cancelled` (likely matrix fail-fast / cancellation).
  - The nightly YAML runs from `main` but checks out `production` code and tests against the **live production deployments** (real AI, no `E2E_TEST_MODE`).
- Recent `production` branch history shows a large release on May 27: `762477d4 Release: main → production (May 27 - 55 PRs, includes migrations) (#1114)`, plus `cce30cb0` (#1106) and `2ad4ede0` (#1098). Migration-bearing releases are the classic source of prod-only drift (see environments.md §Database Migrations — the 62-day silent drift incident).
- `--log-failed` for the nightly run returned no content (logs likely expired/rotated), so specific failing test names still need to be pulled from a fresh nightly run, the GitHub Actions UI, or by reproducing locally/against prod.
- Post-Deploy Smoke runs on `main` show as `skipped` (they fire on Vercel deploy success, gated per-host), not failing — needs confirmation whether smoke is genuinely green or just not triggered.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/debugging.md
- docs/feature_deep_dives/debugging_skill.md
- docs/docs_overall/environments.md
- docs/docs_overall/cloud_env.md
- docs/feature_deep_dives/pr_verification_gate.md

## Code Files Read
- [none yet — populate during /research]
