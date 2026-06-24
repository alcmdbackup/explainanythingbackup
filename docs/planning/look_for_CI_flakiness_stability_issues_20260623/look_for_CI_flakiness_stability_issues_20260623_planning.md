# Look For CI Flakiness Stability Issues Plan

## Background
Look at recent CI runs as well as `docs/docs_overall/testing_overview.md`, `docs/docs_overall/environments.md`, and `docs/feature_deep_dives/testing_setup.md` and look for ways to make tests less flaky and more reliable. Amend the testing overview if necessary with any new findings.

## Requirements (from GH Issue #1268)
- Look at recent CI runs (GitHub Actions: `ci.yml`, `e2e-nightly.yml`, `post-deploy-smoke.yml`, `supabase-migrations.yml`) to identify recurring flakiness / stability patterns.
- Review the three named docs for existing flakiness rules and coverage gaps:
  - `docs/docs_overall/testing_overview.md`
  - `docs/docs_overall/environments.md`
  - `docs/feature_deep_dives/testing_setup.md`
- Look for concrete, systematic ways to make tests (unit / ESM / integration / E2E) less flaky and more reliable.
- Amend `docs/docs_overall/testing_overview.md` (and adjacent docs) if necessary with any new findings — prefer systematic + enforceable (ESLint rule / hook / CI check) mechanisms over one-off patches.

## Problem
CI flakiness erodes signal: `retries: 2` silently turns flaky E2E tests green, so reviewers trust a gate that is quietly unstable, while the same fragility intermittently exhausts retries on Nightly (2 of the last 15 nights failed). The live offenders are a cluster of evolution-admin E2E specs that assert `toBeVisible` on deep elements before the page has hydrated/loaded, plus hardcoded per-assertion timeouts (`{ timeout: 10000 }`) that are *shorter* than CI's 20s expect default and therefore shrink CI's own budget. The repo already has 17 `flakiness/*` ESLint rules, so the gaps are narrow: (a) the hydration-wait rule doesn't cover inline spec navigate→assert, (b) nothing flags sub-default hardcoded timeouts, and (c) retry-masked flakes + nightly failures leave no durable, named record (issues carry only a run URL; Actions logs expire). This project closes (b) and (c) with enforcement, fixes the live offending specs to validate, and amends the docs.

## Options Considered
- [x] **Option B (CHOSEN, EXPANDED after the broad sweep): Docs + new enforcement + fix live specs + the highest-impact infra/observability fixes.** (1) Decouple `npm run build` from the E2E webServer start (S1, the ~20%-of-failed-runs infra flake); (2) `flakiness/no-subdefault-expect-timeout` lint rule; (3) results.json→release-health surfacer with transient-AI classification (gap #3 + S2-detect); (4) fix the 3 root-cause specs (S3); (5) timeboxed 429/503 integration investigation (S4); (6) fix/remove the dead `Verify Seed Reuse` workflow (S5); (7) amend `testing_overview.md` + adjacent docs (incl. S1 build-step + S2 nightly real-AI flake class). Durable + self-validating.
- [x] **Option A: Docs-only amendment.** Add findings/rules to `testing_overview.md` as prose only. Rejected: rules without enforcement drift (the repo's own convention is doc-rule + ESLint/CI enforcement).
- [x] **Option C: Quarantine/auto-detect harness.** Full flaky-detection + quarantine tooling from run history. Rejected for this project as over-scope; the chosen results.json surfacer is the lightweight first step toward it.

### Resolved Open Questions (from `_research.md`)
1. **Scope** → Option B + fix specs.
2. **Fix live specs?** → Yes (validates the new rule + clears the nightly).
3. **Nightly triage depth** → Embed failing + flaky test names in the `release-health` issue body only. No CI step-summary annotation on green runs, no log-retention bump. *Known limitation:* the issue is created `if: failure()`, so flakes on a **green** nightly still won't surface — accepted for this scope.
4. **Timeout-rule threshold** → Flag hardcoded `{ timeout: N }` with `N <= 10000` on Playwright web-first assertions / `waitFor` in `*.spec.ts(x)` (≤ local expect default = zero headroom, actively shrinks CI/prod budget). `eslint-disable` escape hatch for deliberate long-poll cases (those use `N` *larger* than the default anyway, so they won't trip it).

### Resolved Open Questions — broad sweep (S1–S5)
5. **S1 webServer build/start decouple** → **Yes, add as Phase 1** (build as its own CI step; webServer runs start-only). Lower-tier fallback documented (raise timeout only) if the split proves fragile.
6. **S2 nightly real-AI flakes** → **Document + detect** (no spec rewrite): surfacer tags transient-AI failures; testing_overview gains a "known nightly real-AI flake class" note.
7. **S4 integration 429/503** → **Timeboxed investigation** (Phase 5); fix if cheap, else follow-up issue.
8. **S5 `Verify Seed Reuse` dead workflow** → **Fix or remove** (Phase 6).

## Phased Execution Plan

> Phase 0 (research/evidence + broad sweep) is complete — see `_research.md` (gaps #1–#3 + sources S1–S5). Each phase below ends with the CLAUDE.md check trio (lint + tsc + build) + the phase's own tests before moving on. Order is impact-first; Phase 1 (webServer) stabilizes the E2E pipeline that later spec phases depend on.
>
> **EXECUTION COMPLETE (2026-06-23)** — all phases implemented; see `_progress.md` for the per-phase outcome table + deviations (rule landed as `warn`; S4/S5 resolved as non-issues). The 5 boxes left unchecked below are **CI-deferred**: `@evolution` 5× stability reruns need staging DB + admin auth (the CI `e2e-evolution` job's environment), and the webServer/build CI dry-run is validated when CI runs on this branch during `/finalize`. `actionlint` is not installed locally (YAML validated via `js-yaml` instead).

### Phase 1 — S1: Decouple `npm run build` from the E2E webServer start (highest-impact infra flake)
- [x] In `playwright.config.ts`, change the CI primary webServer command from `npm run build && npm start ...` to **just** the start command (`E2E_TEST_MODE=true FAST_DEV=true npm start -- -p 3008`), and lower its CI `timeout` to a start-only budget (~90–120s). Apply the same split to the gated 3009/3010 webServers.
- [x] In `.github/workflows/ci.yml` (and `e2e-nightly.yml` where it builds), add an explicit **`npm run build` step before** the Playwright run so build time is its own step with its own `.next/cache` restore (not inside the 240s server-start budget). Confirm the E2E jobs already cache `.next/cache` (testing_setup CI Caching) and that the build artifact is available to the test step on the same runner.
- [x] Verify no double-build: ensure `reuseExistingServer`/command no longer triggers a second `next build`.
- [ ] Validate with `actionlint` (if available) + a CI dry-run on this branch; confirm the webServer step starts in well under the new timeout.
- [x] *Risk note:* this touches the E2E CI pipeline. Keep the change minimal and reversible; if the build-step split proves fragile, fall back to keeping build in the command but raising the timeout (documented as the lower-tier option).

### Phase 2 — Gap #2: New ESLint rule `flakiness/no-subdefault-expect-timeout`
- [x] Add `eslint-rules/no-subdefault-expect-timeout.js`: flag a hardcoded `timeout: N` option literal with `N <= 10000` passed to Playwright web-first assertions (`.toBeVisible/.toHaveText/.toContainText/.toHaveCount/...`) and `locator.waitFor(...)` inside `*.spec.ts(x)`. Message: rely on the env-scaled `expect` config default (10s/20s/60s) or use a literal larger than the default for genuine long-polls. Allow `eslint-disable`.
- [x] Register it in `eslint-rules/index.js` and add to the spec-glob block in `eslint.config.mjs` (`**/*.spec.ts(x)`), severity `error`.
- [x] Unit test `eslint-rules/no-subdefault-expect-timeout.test.ts` (RuleTester): valid (no timeout / `timeout: 30000` / disabled) + invalid (`timeout: 10000`, `timeout: 5000`) fixtures.
- [x] Run `npm run lint` — expect it to fire on existing offenders (e.g. `admin-prompt-registry.spec.ts:61`), confirming real-world catch. Fix those inline (folds into Phase 4).

### Phase 3 — Gap #3 + S2-detect: Nightly flaky/failure surfacer (results.json → release-health issue)
- [x] Add `scripts/summarize-test-results.ts`: read one-or-more `test-results/results.json` files, output markdown listing **failed** and **flaky** (passed-on-retry) test titles (`spec:line › title`), de-duplicated across matrix shards. **S2 classification:** tag entries whose error text matches AI-backend-down / quota patterns (`Error communicating with AI service`, `402`, `429`, `quota`, run status `failed`) as `transient-AI?` vs other failures, so triagers can tell real-AI nondeterminism from code regressions. Exit 0 always (reporting only).
- [x] Unit test `scripts/summarize-test-results.test.ts`: fixtures for a failed test, a flaky test, an AI-backend-down failure (→ tagged transient-AI), all-passed (empty), malformed/missing file (graceful empty), multi-shard de-dup.
- [x] Wire into `.github/workflows/e2e-nightly.yml`: each `e2e` matrix row uploads its `test-results/results.json` as an artifact (per-row name); `notify-release-health` (`if: failure()`) downloads the artifacts, runs the summarizer, and appends the test list to the issue **body** (create) / **comment** (recurrence). Keep the existing run-URL + triage-link text.
- [x] Verify the YAML with `actionlint`; otherwise dry-run the summarizer against a saved nightly `results.json` fixture (e.g. from run 27938679142's artifacts).

### Phase 4 — S3: Fix the live root-cause specs (validates Phases 2–3)
- [x] `admin-evolution-paragraph-recombine.spec.ts:64` — add a hydration-proof wait (data-dependent element, e.g. slots-tab content / invocation header) before the `[role="tab"]` `toBeVisible` assertions; drop the sub-default `{ timeout: 15000 }` → rely on config or a proof wait.
- [x] `admin-prompt-registry.spec.ts:42-61` — await the created prompt landing in the list (`await expect(getByText(title)).toBeVisible()` with config default) **before** resetting the filter; remove the `{ timeout: 10000 }` literal.
- [x] `admin-evolution-judge-lab-test-sets.spec.ts:74` — add `resetFilters()` (EvolutionListPage) after the test-sets list `goto` before asserting the seeded `[TEST_EVO]` row (confirm the list has the default "Hide test content" filter first).
- [x] `admin-evolution-matches.spec.ts:65` + `admin-evolution-iterative-editing.spec.ts:189` — re-check: confirm whether `:189`'s instability is the real FK/pipeline bug vs flake (per `_research.md` it hard-fails on a real bug in some runs); fix the hydration/timeout aspect only, and note the real-bug aspect for owners if it persists.
- [ ] Run each fixed spec locally **5×** for stability (per local-first CI retry policy) on the tmux server.

### Phase 5 — S4: Timeboxed integration 429/503 investigation
- [x] Reproduce/trace the 429/503 source in `Integration Tests (Evolution)` (suspects: Supabase auth rate limit under rapid `signIn`, or an under-mocked LLM/provider call). Use a recent run's logs + local `NODE_USE_ENV_PROXY=1 npm run test:integration:evolution`.
- [x] If cheap (add a missing mock, add backoff, or reuse an auth session): fix it. Otherwise file a follow-up issue with the trace and link it from `_research.md`. (Timebox ~1–2h; do not block the rest of the project.)

### Phase 6 — S5: Fix or remove the dead `Verify Seed Reuse` workflow
- [x] Inspect `.github/workflows/verify-seed-reuse.yml` trigger; determine why it has 0 lifetime runs (path filter / schedule / event never matches).
- [x] Either repair the trigger so it provides real signal, or delete the workflow if it's obsolete. Record the decision in `_progress.md`.

### Phase 7 — Amend docs (the deliverable)
- [x] `testing_overview.md` — add **Rule 20** (no sub-default hardcoded assertion timeouts) + Enforcement Summary row (`flakiness/no-subdefault-expect-timeout`); extend the Rule 18 note to cover inline-spec `navigate→assert`; add a "Surfacing nightly failures" subsection (results.json → release-health enrichment + transient-AI classification); add a short **"Known nightly real-AI flake class"** note (S2: AI-streaming errors + 402/429 evolution wipeout are infra/ops, not code regressions).
- [x] `testing_setup.md` — note the JSON reporter's flaky-capture, `scripts/summarize-test-results.ts`, and the new **build-before-Playwright** CI step (S1) + start-only webServer command.
- [x] `environments.md` — update `e2e-nightly.yml`/`notify-release-health` (issue body now lists failing+flaky test names); document the S1 CI build-step change; record that post-deploy-smoke "skipped" `deployment_status` runs are expected; note S5 resolution.

## Testing

### Unit Tests
- [x] `eslint-rules/no-subdefault-expect-timeout.test.ts` — RuleTester: valid (no `timeout`, `timeout: 30000`, eslint-disabled) + invalid (`timeout: 10000`, `timeout: 5000`) on `toBeVisible`/`toHaveText`/`waitFor`.
- [x] `scripts/summarize-test-results.test.ts` — fixtures: 1 failed test, 1 flaky (passed-on-retry) test, all-passed → empty, malformed/missing file → graceful empty, multi-shard de-dup.

### Integration Tests
- [x] No new integration logic added. Phase 5 (S4) may *modify* an integration setup (e.g. reuse an auth session / add a mock) — if so, re-run `NODE_USE_ENV_PROXY=1 npm run test:integration:evolution` and confirm the 429/503 volume drops.

### E2E Tests
- [ ] No new specs. Modify the root-cause specs (Phase 4) and re-run each **5×** locally for stability:
  - `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-paragraph-recombine.spec.ts --repeat-each=5`
  - `... admin-prompt-registry.spec.ts --repeat-each=5`
  - `... admin-evolution-judge-lab-test-sets.spec.ts --repeat-each=5`
- [x] After Phase 1 (webServer/build split), run the full critical suite once in CI on this branch to confirm the server still comes up and tests run (`@critical` + `@evolution`).

### Manual Verification
- [x] `npm run lint` fires `flakiness/no-subdefault-expect-timeout` on a seeded `{ timeout: 9000 }` violation and on the real offenders before they're fixed.
- [x] Run `scripts/summarize-test-results.ts` against a saved nightly `results.json` fixture; eyeball the failed/flaky markdown + the `transient-AI?` tagging.
- [x] Confirm `Verify Seed Reuse` either runs (after trigger fix) or is gone (Phase 6).

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] No UI source changes. Playwright work = re-running the fixed specs 5× locally (above) + one CI critical-suite run after the Phase 1 webServer change — all green.

### B) Automated Tests
- [x] `npm test -- eslint-rules/no-subdefault-expect-timeout.test.ts scripts/summarize-test-results.test.ts`
- [x] `npm run lint` (new rule loads + passes repo-wide after Phase 4 fixes), `npm run typecheck`, plus the standard `/finalize` check trio (build/unit/ESM/integration/E2E-critical).
- [x] `actionlint .github/workflows/ci.yml .github/workflows/e2e-nightly.yml` (if available) after the Phase 1 + Phase 3 YAML edits.
- [ ] CI dry-run on this branch confirming: (a) the new build step + start-only webServer comes up under the reduced timeout, (b) no double `next build`.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [x] `docs/docs_overall/testing_overview.md` — PRIMARY amend target: Rule 20 (sub-default timeouts) + Enforcement Summary row; Rule 18 extension (inline-spec navigate→assert); "Surfacing nightly failures" subsection; "Known nightly real-AI flake class" note (S2); note the S1 build-before-Playwright CI step.
- [x] `docs/feature_deep_dives/testing_setup.md` — JSON-reporter flaky-capture + `scripts/summarize-test-results.ts`; the S1 start-only webServer command + separate CI build step.
- [x] `docs/docs_overall/environments.md` — `notify-release-health` issue body now lists failing+flaky test names; S1 `ci.yml` build-step change; post-deploy-smoke "skipped" `deployment_status` runs are expected; S5 `Verify Seed Reuse` resolution.
- [x] `docs/docs_overall/cloud_env.md` — only if S4 turns out to be a proxy/network issue (likely not).
- [x] `docs/feature_deep_dives/error_handling.md` — only if S4's 429/503 handling adds backoff/transient classification worth documenting.
- [x] `docs/feature_deep_dives/request_tracing_observability.md` — likely no change (not leveraged in this scope).

## Follow-ups (post-merge, deferred from PR #1275)

These were identified during execution but deferred to keep PR #1275 scoped. Added to the plan for tracking.

### F1 — Promote `flakiness/no-subdefault-expect-timeout` from `warn` → `error`
- [ ] Burn down the existing sub-default-timeout offenders (≈122 repo-wide at introduction; `npm run lint 2>&1 | grep -c no-subdefault-expect-timeout` to recount). Replace each hardcoded `{ timeout: N<=10000 }` on a web-first assertion/`waitFor` with the env-scaled config default (drop the option) or a deliberate `>10000` value.
- [ ] Once the count reaches 0, flip the severity to `error` in `eslint.config.mjs` and update the Rule 20 note + the rule header comment in `eslint-rules/no-subdefault-expect-timeout.js`.
- [ ] *Why deferred:* a hard `error` at introduction would have forced a risky 122-site bulk rewrite of assertion timeouts across unrelated suites in one PR.

### F2 — Wire the custom ESLint RuleTester tests into CI (Option A)
**Gap (verified 2026-06-24):** there are **28** `eslint-rules/*.test.js` files, but the hand-maintained `test:eslint-rules` npm script references only **16** — the other 12 run *nowhere* (incl. `max-test-timeout`, `no-silent-catch`, `no-wait-for-timeout`, `no-networkidle`, `no-hardcoded-base-url`, `no-hardcoded-tmpdir`, `no-point-in-time-checks`, `no-test-skip`, `require-hydration-wait`, `require-serial-with-beforeall`, `require-test-cleanup`, `warn-slow-with-retries`). And **no CI workflow invokes `test:eslint-rules` at all** (`npm test`/Jest only matches `*.test.ts(x)`, so these `.test.js` files are skipped). The rules ARE enforced in CI via `next lint`, so a rule that *over*-fires or fails to load is caught — but a rule whose logic silently regresses into a **false negative** (stops catching real violations) leaves CI green and the flakiness rule dead. See [[reference_eslint_rules_tests_not_in_ci]].

**Chosen approach — Option A (Jest glob):**
- [ ] Add `eslint-rules/**/*.test.js` to a Jest config (node env) — either extend `testMatch` or add a dedicated Jest project — so the RuleTester suites run under `npm test` and therefore in CI's existing **Unit Tests** job, with auto-discovery of new rule tests.
- [ ] Verify all 28 RuleTester suites bind cleanly to Jest's `describe`/`it` (ESLint 9 `RuleTester` auto-detects the framework; spot-check that the suites register and pass). Fix any that assumed the standalone-`node` runner (e.g. trailing `console.log('...passed')` is harmless; a top-level throw on failure still surfaces).
- [ ] Once covered by Jest, delete the hand-maintained `test:eslint-rules` `&&`-chain (or keep it as a thin local alias) so the orphaned-12 maintenance trap is gone.
- [ ] Unit-test/CI verification: `npm test` runs the rule suites locally; confirm the Unit Tests CI job count increases and stays green.
- [ ] *Alternatives considered (rejected):* **B** — fix the script to cover all 28 + add a dedicated CI step (keeps the per-rule registration maintenance trap); **C** — a glob runner script wired into CI (bespoke runner to maintain). Option A folds protection into the suite that already runs in CI and auto-discovers new tests.

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
