# Look For CI Flakiness Stability Issues Research

## Problem Statement
Look at recent CI runs as well as `docs/docs_overall/testing_overview.md`, `docs/docs_overall/environments.md`, and `docs/feature_deep_dives/testing_setup.md` and look for ways to make tests less flaky and more reliable. Amend the testing overview if necessary with any new findings.

## Requirements (from GH Issue #1268)
- Look at recent CI runs (GitHub Actions: `ci.yml`, `e2e-nightly.yml`, `post-deploy-smoke.yml`, `supabase-migrations.yml`) to identify recurring flakiness / stability patterns.
- Review the three named docs for existing flakiness rules and coverage gaps:
  - `docs/docs_overall/testing_overview.md`
  - `docs/docs_overall/environments.md`
  - `docs/feature_deep_dives/testing_setup.md`
- Look for concrete, systematic ways to make tests (unit / ESM / integration / E2E) less flaky and more reliable.
- Amend `docs/docs_overall/testing_overview.md` (and adjacent docs) if necessary with any new findings — prefer systematic + enforceable (ESLint rule / hook / CI check) mechanisms over one-off patches.

## High Level Summary

The repo already has a mature, well-enforced flakiness regime: **17 custom `flakiness/*` ESLint rules** (16 error, 1 warn) scoped across spec/e2e/source globs, 2 Claude hooks, a `check:stale-specs` CI script, and 19 documented rules in `testing_overview.md`. So the highest-leverage work is **not** re-deriving rules already in place — it is closing the specific gaps that recent runs actually exercised.

Recent-run evidence (June 2026) points to one dominant live problem: **a cluster of evolution-admin E2E specs that flake on `toBeVisible` timeouts and are silently masked by `retries: 2`.** A single representative CI run (`27996587814`, 2026-06-23) reported **5 flaky** (passed-on-retry) + 2 hard-failed E2E tests out of 217, all on `/admin/evolution/*` pages. The same fragility surfaces on **Nightly E2E** (which also retries): **2 of the last 15 nights failed** (2026-06-19, 2026-06-22) on the `@critical` and `@evolution` rows. Because retries hide the green-on-retry cases and Actions logs expire, none of this is durably captured — the 4 open `[release-health]` issues contain only a run URL.

Three root-cause patterns + three systemic gaps emerged (details in Key Findings):
- **Specs:** missing hydration-proof waits, data-seeding races, and **hardcoded per-assertion timeouts shorter than the env-scaled config default** (e.g. `toBeVisible({ timeout: 10000 })` when CI's expect default is 20s — the literal *defeats* CI's larger budget).
- **Enforcement:** `flakiness/require-hydration-wait` only fires on POM `navigate→click`, so inline spec `navigate→assert-on-deep-element` bypasses it.
- **Observability:** flaky/retry data already exists in `test-results/results.json` (Playwright JSON reporter) but is never surfaced; nightly auto-issues carry no failing-test names.

A non-issue worth recording to prevent future false alarms: **post-deploy-smoke "skipped" runs are correct behavior** — they are `deployment_status` events from non-production/preview deploys filtered out by the job `if:`; real coverage runs on `push:[production]` (8 lifetime prod-push runs, all succeeded).

**Update (broad sweep, 2026-06-23):** a thorough multi-run sweep (4 agents over ~18 CI failures + all 7 scheduled workflows) found this is **not** a single-source problem — there are **5 distinct flakiness sources**, two of them higher-impact than the original `toBeVisible` cluster. See "Additional flakiness sources" below.

## Documents Read

### Core Workflow Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Core Operations Docs
- docs/docs_overall/environments.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/debugging.md

### Relevant Docs (discovered in step 2.7)
- docs/docs_overall/cloud_env.md — `NODE_USE_ENV_PROXY=1` is web-only; not the CI flake cause, but explains CI-vs-local fetch divergence.
- docs/feature_deep_dives/error_handling.md — `isTransientError()` + defense-in-depth retry (evolution); relevant to distinguishing transient infra failures from flakes.
- docs/feature_deep_dives/request_tracing_observability.md — request-ID tracing for correlating intermittent failures (not yet leveraged in E2E triage).

## Key Findings

### Evidence: recent runs
- **CI run `27996587814` (2026-06-23)** — E2E (Evolution, chromium): **210 passed, 5 flaky, 2 failed**. The 5 flaky (passed-on-retry, so masked) were all `toBeVisible` timeouts on evolution-admin pages:
  - `admin-evolution-judge-lab-test-sets.spec.ts:32` and `:98`
  - `admin-evolution-matches.spec.ts:56`
  - `admin-evolution-paragraph-recombine.spec.ts:64`
  - `admin-prompt-registry.spec.ts:42`
  - The 2 hard fails (`admin-evolution-iterative-editing.spec.ts:189`, `admin-evolution-run-pipeline.spec.ts:198`) are **DB-assertion tests, not UI** — separate cause (pipeline/data), not `toBeVisible` flake.
  - The Integration-Evolution failure in the same run (`FOR UPDATE cannot be applied to the nullable side of an outer join`) is a **genuine SQL bug** (fixed on `fix/claim_gate_for_update_join_20260622`), **not flake** — important to distinguish so we don't "stabilize" a real failure.
- **Nightly E2E** — last 15: 2 failures (`27938679142` 2026-06-22, `27813251064` 2026-06-19), both on `@critical` (public) + `@evolution` rows. Logs expired before triage; root cause uncaptured.
- **`[release-health]` issues** #1256, #1227, #1172, #1145 — all OPEN, body = run URL only, no failing-test detail, no triage comments. Auto-filed by `notify-release-health` job in `e2e-nightly.yml` (`if: failure()`).
- **post-deploy-smoke** — every recent run `skipped`: these are `deployment_status` (preview) events filtered by the job `if:` (`state==success && environment==Production && target_url contains vercel.app`). **Working as designed**; real smoke runs on `push:[production]`.

### Root-cause patterns in the flaky specs (per file audit)
1. **Missing hydration proof** — `admin-evolution-paragraph-recombine.spec.ts:64` navigates then immediately asserts `expect(locator('[role="tab"]:has-text("Paragraph Slots")')).toBeVisible({ timeout: 15000 })`. Tabs are SSR-visible before data hydration; no data-dependent wait first. (Violates testing_overview Rule 18 in spirit; not caught by lint — see gap #1.)
2. **Data-seeding race + sub-default timeout** — `admin-prompt-registry.spec.ts:42-61` creates a prompt via form, does **not** await the create landing in the list, resets the filter, then asserts the row with `{ timeout: 10000 }`. The 10s literal is **shorter** than CI's 20s expect default, so the spec is *more* fragile in CI than an un-annotated assertion would be.
3. **Possible missing filter reset on list nav** — `admin-evolution-judge-lab-test-sets.spec.ts:74` asserts a seeded `[TEST_EVO]` row on the test-sets list page without a `resetFilters()` (the list inherits the default "Hide test content" filter). Medium confidence.

### Existing enforcement (already in place — do NOT duplicate)
- `eslint-rules/` — 17 `flakiness/*` rules registered in `eslint.config.mjs` (flat config). Spec-glob rules: max-test-timeout, no-test-skip, require-test-cleanup, no-point-in-time-checks, no-point-in-time-pom-helpers, no-nth-child-cell-selector, no-duplicate-describe-name, require-serial-with-beforeall, warn-slow-with-retries(warn). E2E-glob: no-wait-for-timeout, no-silent-catch, no-networkidle, no-hardcoded-tmpdir, no-hardcoded-base-url, require-hydration-wait. Admin-only: require-reset-filters. Source-glob: no-duplicate-column-labels.
- Hooks: `.claude/hooks/check-workflow-ready.sh` (gates test/CI edits on doc-reads), `check-test-patterns.sh` (warns on skip/silent-catch/networkidle).
- CI: `scripts/check-stale-specs.ts` (`npm run check:stale-specs`, in lint pipeline).
- Playwright: `retries` local=0 / CI-main=2 / prod=3; expect timeout local=10s / CI=20s / prod=60s; reporters include `['json', { outputFile: 'test-results/results.json' }]` — **this JSON already records per-test flaky/retry status.**

### Systemic gaps (candidate improvements)
1. **`require-hydration-wait` blind spot** — its AST logic targets POM methods (`navigate→click`); inline spec bodies that `navigate→assert toBeVisible` on a deep element are not covered. The paragraph-recombine flake lives in a spec, not a POM → uncaught. Opportunity: extend the rule (or add a sibling) to flag spec navigations followed by a deep-element assertion with no intervening data-proof wait.
2. **Sub-default hardcoded expect timeouts** — specs pass `{ timeout: 10000 }` (or other literals < the env-scaled default), which *reduces* the CI/prod budget rather than relying on the config default that scales 10s→20s→60s. Lint-detectable; strong candidate for a new `flakiness/*` rule (flag hardcoded expect/visibility timeouts below the local default, or any hardcoded literal where the config default would be larger).
3. **Retry-masked flakes are invisible + nightly issues are detail-free** — `test-results/results.json` captures flaky/failed test titles but nothing ingests it. Opportunity: a small CI step that parses `results.json` to (a) emit a job **step-summary / annotation** listing flaky (passed-on-retry) tests, and (b) embed failing+flaky test names into the `notify-release-health` issue body so triage survives log expiry.

### Additional flakiness sources (broad sweep, 2026-06-23)
Verified across ~18 recent CI failures (last ~2 days, logs recovered via `gh api .../jobs/<id>/logs`) + all 7 scheduled workflows (nightly failures recovered from non-expired Playwright report artifacts). Ordered by impact.

**S1 — `webServer` startup timeout (whole-job flake, ~20% of failed CI runs).** Error `Timed out waiting Nms from config.webServer` → Next.js dev/build never finished compiling → **no tests ran, whole E2E job red**. Found in 4 of 20 inspected failed runs (`27965342067`, `27962655857`, `27961954996`, `27918994139`). Root cause: the CI webServer command is `npm run build && npm start` under a **single** webServer timeout, so a cold/slow `.next` build eats the server-start budget. The timeout was just bumped **180000→240000ms on 2026-06-22 (PR #1258, `de2113413`)** — a partial mitigation; the structural issue (build bundled into start budget) remains. Systematic fix space: run `npm run build` as a **separate CI step** before Playwright and have `webServer.command` be just `npm start` with a short timeout (decouples build time from start budget; lets the build step own its caching/retry). Secondary webServers (3009/3010) are correctly gated behind `RUN_GUEST_AUTO_TESTS`/`RUN_PROD_AI`, so no multi-build on the standard path. **NOT covered by the original plan.**

**S2 — Nightly real-AI transient failures (the actual cause of nightly red).** All three recent nightly failures (06-07, 06-19, 06-22) share an identical signature across browsers — these are real-AI-only and **cannot** reproduce in PR-CI (which mocks LLMs):
  - `action-buttons.spec.ts › should save explanation to library` (public/@critical) — prod AI streaming returns `Error communicating with AI service`; 3 retries all fail. Most consistent nightly flake.
  - `admin-evolution-run-pipeline.spec.ts › run completed successfully` + `admin-evolution-iterative-editing.spec.ts › exactly one final variant` (evolution shard, **real** minicomputer run) — run status returns `failed`; matches the documented OpenRouter **402 credit / 429 quota** arena-only wipeout (detector exists: `evolution/scripts/detectArenaOnlyWipeouts.ts`).
  These are "deterministic-when-the-backend-is-down, intermittent-over-time." Fix space is mostly ops + triage classification (distinguish AI-backend-down from code regression) rather than test code; the planned results.json→issue surfacer (gap #3) directly helps capture them.

**S3 — `admin-evolution-iterative-editing.spec.ts:189` is the dominant chronic flaky spec (8 runs).** Flaky (passed-on-retry) in 8 distinct runs; in some runs it *hard-fails* all retries due to a real pipeline/FK issue, so it's a mixed-signal spec. Confirms the 09-admin cluster (S+original finding) is chronic, not a one-off. The matches / paragraph-recombine / judge-lab-test-sets specs each flaked in ≥2 runs.

**S4 — Integration (Evolution) 429/503 noise. → DEBUNKED (false positive; Phase 5 investigation).** Re-examined all 3 flagged runs (`27988932726`, `27961544483`, `27886052639`) with word-boundary + status-pattern greps (`\b429\b`, `too many request`, `retry-after`, `status: 429`, `ECONNRESET`, etc.): **zero** real rate-limit or transient-network errors. The earlier "15–32 hits" were substring matches of `429`/`503` inside timestamps and durations (e.g. `503` within `…1503ms`). The actual failures in those runs were 100% the deterministic `claim_evolution_run failed: FOR UPDATE cannot be applied to the nullable side of an outer join` SQL bug. **No flakiness source here; no fix needed.** Lesson: count status codes with word boundaries, not substrings.

**S5 — `Verify Seed Reuse` workflow has NEVER run. → WORKING AS INTENDED (Phase 6 investigation).** `verify-seed-reuse.yml` is `workflow_dispatch`-ONLY — an intentional **manual, operator-triggered** post-deploy diagnostic that takes a specific `run-id` + target and confirms a real run reused the persisted seed row. "0 lifetime runs" is expected: it's an on-demand tool nobody has needed to fire yet, not a misconfigured trigger or dead automated coverage. The referenced `scripts/verify-seed-reuse.ts` exists and the YAML is valid, so it is functional when dispatched. **No fix and no removal** — deleting it would discard a working diagnostic. (Original S5 framing as "dead coverage / trigger never fires" was a misdiagnosis.)

**Minor / not-flake (recorded to avoid mis-triage):**
- `supabase-migrations` "Check migration order" fails on feature branches with out-of-order timestamps (3/20) — deterministic gate working as intended; expected pre-merge noise.
- Real recurring **bugs** (not flake) that dominate red and must not be "stabilized" away: `character varying(255) does not match expected type text` RPC return-type drift (4 runs, one 10-spec wipeout), `schema_migrations_pkey` collision (2 runs), `Module not found: 'fs'` client-bundle break (1 run).
- `e2e-real-ai-smoke.yml` 20/20 green; `Evolution Run Health` 9/9 green; post-deploy-smoke prod-push runs all green.

### Doc-amendment targets (the deliverable)
- `testing_overview.md` — add a rule (+ Enforcement Summary row) for sub-default hardcoded timeouts; extend Rule 18 note to cover inline-spec navigate→assert; add a short "Surfacing retry-masked flakes" subsection if the results.json surfacer is built.
- `testing_setup.md` — note the `results.json` flaky-capture + any new surfacer script.
- `environments.md` — note any change to `notify-release-health` issue body; record that post-deploy-smoke "skipped" deployment_status runs are expected.

## Open Questions
*(Original Q1–Q4 resolved via AskUserQuestion — see `_planning.md` "Resolved Open Questions": Option B + fix specs; nightly = embed test names in issue; threshold `N <= 10000`. The broad sweep adds new scope questions Q5–Q8.)*

5. **Fold S1 (webServer build/start decouple) into this project?** Highest-impact infra flake (~20% of failed runs), but it's a CI-workflow + `playwright.config.ts` change touching the E2E pipeline — larger blast radius, partially mitigated already by the 180→240s bump (PR #1258). Recommend **yes, as its own phase**: move `npm run build` to a dedicated CI step and reduce `webServer.command` to `npm start` with a short timeout. Biggest single reliability win found.
6. **S2 (nightly real-AI flakes) — fix vs document+detect?** Real-AI/ops nondeterminism, not test-code bugs. Recommend: the planned results.json→issue surfacer captures them; additionally **document** them in testing_overview as a known nightly-flake class and have triage distinguish "AI-backend-down" (transient) from code regressions. No spec rewrite.
7. **S4 (integration 429/503) — investigate now or defer?** Needs a scoped dig (which API rate-limits, is a mock missing). Recommend a short timeboxed investigation; defer the fix to a follow-up if root cause is ops/provider-side.
8. **S5 (`Verify Seed Reuse` never runs) — fix trigger or remove?** Quick cleanup: repair the trigger or delete the dead workflow. Recommend including as a tiny task.

## Code Files Read
- `eslint.config.mjs` — flat-config registration + file-glob scoping of all `flakiness/*` rules (the scope table).
- `eslint-rules/*.js` (index + individual rules) — what each rule catches; confirmed `require-hydration-wait` targets POM navigate→click.
- `playwright.config.ts` — retries (0/2/3), expect timeouts (10s/20s/60s), JSON reporter → `test-results/results.json`.
- `.github/workflows/e2e-nightly.yml` — `notify-release-health` job: issue body is run-URL only.
- `.github/workflows/post-deploy-smoke.yml` — trigger + job `if:`; confirms "skipped" deployment_status runs are expected.
- `src/__tests__/e2e/specs/09-admin/admin-evolution-paragraph-recombine.spec.ts`, `admin-prompt-registry.spec.ts`, `admin-evolution-judge-lab-test-sets.spec.ts`, `admin-evolution-matches.spec.ts` — flaky assertion sites.
- `.claude/hooks/check-workflow-ready.sh`, `check-test-patterns.sh`; `scripts/check-stale-specs.ts` — existing non-lint enforcement.
