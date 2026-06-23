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

A non-issue worth recording to prevent future false alarms: **post-deploy-smoke "skipped" runs are correct behavior** — they are `deployment_status` events from non-production/preview deploys filtered out by the job `if:`; real coverage runs on `push:[production]`.

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

### Doc-amendment targets (the deliverable)
- `testing_overview.md` — add a rule (+ Enforcement Summary row) for sub-default hardcoded timeouts; extend Rule 18 note to cover inline-spec navigate→assert; add a short "Surfacing retry-masked flakes" subsection if the results.json surfacer is built.
- `testing_setup.md` — note the `results.json` flaky-capture + any new surfacer script.
- `environments.md` — note any change to `notify-release-health` issue body; record that post-deploy-smoke "skipped" deployment_status runs are expected.

## Open Questions
1. **Scope** — Docs-only amendment (Option A), or docs + at least one new enforced rule / CI surfacer (Option B)? The strongest systematic wins are gaps #2 (new lint rule) and #3 (results.json surfacer). Recommend Option B with the timeout-lint + the flaky surfacer; defer the hydration-rule extension (#1) if AST work proves heavy.
2. **Fix the live flakes now?** — Should this project also fix the 3 root-cause specs (paragraph-recombine hydration wait, prompt-registry await+timeout, judge-lab filter reset), or only add enforcement + docs and leave spec fixes to owners? Fixing them validates the new rules against real cases.
3. **Nightly triage** — Is embedding failing-test names into the release-health issue enough, or is a longer Actions log-retention bump also wanted?
4. **Timeout-rule threshold** — what literal counts as "too short"? Proposal: flag any hardcoded `{ timeout: N }` on `expect`/`toBeVisible`/`waitFor` where `N < 15000`, with an eslint-disable escape hatch for justified long-poll cases.

## Code Files Read
- `eslint.config.mjs` — flat-config registration + file-glob scoping of all `flakiness/*` rules (the scope table).
- `eslint-rules/*.js` (index + individual rules) — what each rule catches; confirmed `require-hydration-wait` targets POM navigate→click.
- `playwright.config.ts` — retries (0/2/3), expect timeouts (10s/20s/60s), JSON reporter → `test-results/results.json`.
- `.github/workflows/e2e-nightly.yml` — `notify-release-health` job: issue body is run-URL only.
- `.github/workflows/post-deploy-smoke.yml` — trigger + job `if:`; confirms "skipped" deployment_status runs are expected.
- `src/__tests__/e2e/specs/09-admin/admin-evolution-paragraph-recombine.spec.ts`, `admin-prompt-registry.spec.ts`, `admin-evolution-judge-lab-test-sets.spec.ts`, `admin-evolution-matches.spec.ts` — flaky assertion sites.
- `.claude/hooks/check-workflow-ready.sh`, `check-test-patterns.sh`; `scripts/check-stale-specs.ts` — existing non-lint enforcement.
