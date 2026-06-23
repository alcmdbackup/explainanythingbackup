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
- [x] **Option B (CHOSEN): Docs + new enforcement + fix the live specs.** Add (1) a `flakiness/*` lint rule for sub-default hardcoded expect timeouts and (2) a CI surfacer that parses `test-results/results.json` to embed failing + flaky test names into the nightly `release-health` issue; fix the 3 root-cause specs to validate the rules against real cases; amend `testing_overview.md` + adjacent docs. Durable + self-validating.
- [ ] **Option A: Docs-only amendment.** Add findings/rules to `testing_overview.md` as prose only. Rejected: rules without enforcement drift (the repo's own convention is doc-rule + ESLint/CI enforcement).
- [ ] **Option C: Quarantine/auto-detect harness.** Full flaky-detection + quarantine tooling from run history. Rejected for this project as over-scope; the chosen results.json surfacer is the lightweight first step toward it.

### Resolved Open Questions (from `_research.md`)
1. **Scope** → Option B + fix specs.
2. **Fix live specs?** → Yes (validates the new rule + clears the nightly).
3. **Nightly triage depth** → Embed failing + flaky test names in the `release-health` issue body only. No CI step-summary annotation on green runs, no log-retention bump. *Known limitation:* the issue is created `if: failure()`, so flakes on a **green** nightly still won't surface — accepted for this scope.
4. **Timeout-rule threshold** → Flag hardcoded `{ timeout: N }` with `N <= 10000` on Playwright web-first assertions / `waitFor` in `*.spec.ts(x)` (≤ local expect default = zero headroom, actively shrinks CI/prod budget). `eslint-disable` escape hatch for deliberate long-poll cases (those use `N` *larger* than the default anyway, so they won't trip it).

## Phased Execution Plan

> Phase 0 (research/evidence) is complete — see `_research.md`. Each phase below ends with the CLAUDE.md check trio (lint + tsc + build) + the phase's own tests before moving on.

### Phase 1: New ESLint rule — `flakiness/no-subdefault-expect-timeout`
- [ ] Add `eslint-rules/no-subdefault-expect-timeout.js`: flag a hardcoded `timeout: N` option literal with `N <= 10000` passed to Playwright web-first assertions (`.toBeVisible/.toHaveText/.toContainText/.toHaveCount/...`) and `locator.waitFor(...)` inside `*.spec.ts(x)`. Message: rely on the env-scaled `expect` config default (10s/20s/60s) or use a literal larger than the default for genuine long-polls. Allow `eslint-disable`.
- [ ] Register it in `eslint-rules/index.js` and add to the spec-glob block in `eslint.config.mjs` (`**/*.spec.ts(x)`), severity `error`.
- [ ] Unit test `eslint-rules/no-subdefault-expect-timeout.test.ts` (RuleTester): valid (no timeout / `timeout: 30000` / disabled) + invalid (`timeout: 10000`, `timeout: 5000`) fixtures.
- [ ] Run `npm run lint` — expect it to fire on the existing offenders (e.g. `admin-prompt-registry.spec.ts:61`), confirming real-world catch. Fix those inline (folds into Phase 3).

### Phase 2: Nightly flaky/failure surfacer (results.json → release-health issue)
- [ ] Add `scripts/summarize-test-results.ts`: read one-or-more `test-results/results.json` files, output markdown listing **failed** and **flaky** (passed-on-retry) test titles (`spec:line › title`), de-duplicated across matrix shards. Exit 0 always (reporting only).
- [ ] Unit test `scripts/summarize-test-results.test.ts`: fixtures for a failed test, a flaky test, all-passed (empty output), and a malformed/missing file (graceful empty).
- [ ] Wire into `.github/workflows/e2e-nightly.yml`: each `e2e` matrix row uploads its `test-results/results.json` as an artifact (per-row name); `notify-release-health` (`if: failure()`) downloads the artifacts, runs the summarizer, and appends the test list to the issue **body** (create) / **comment** (recurrence). Keep the existing run-URL + triage-link text.
- [ ] Verify the YAML with `actionlint` if available; otherwise dry-run the summarizer locally against a saved `results.json` fixture.

### Phase 3: Fix the 3 live root-cause specs (validates Phases 1–2)
- [ ] `admin-evolution-paragraph-recombine.spec.ts:64` — add a hydration-proof wait (data-dependent element, e.g. the slots-tab content / invocation header) before the `[role="tab"]` `toBeVisible` assertions; drop the sub-default `{ timeout: 15000 }`→rely on config or use a proof wait.
- [ ] `admin-prompt-registry.spec.ts:42-61` — await the created prompt landing in the list (`await expect(getByText(title)).toBeVisible()` with config default) **before** resetting the filter; remove the `{ timeout: 10000 }` literal.
- [ ] `admin-evolution-judge-lab-test-sets.spec.ts:74` — add `resetFilters()` (EvolutionListPage) after the test-sets list `goto` before asserting the seeded `[TEST_EVO]` row (confirm the list has the default "Hide test content" filter first).
- [ ] (If quick) re-check `admin-evolution-matches.spec.ts:65` — confirm the 15s action wait is a real hydration proof, not a sub-default cap; adjust only if it trips the new rule.
- [ ] Run each fixed spec locally **5×** for stability (per local-first CI retry policy) on the tmux server.

### Phase 4: Amend docs
- [ ] `testing_overview.md` — add **Rule 20** (no sub-default hardcoded assertion timeouts) with rationale + the Enforcement Summary row (`flakiness/no-subdefault-expect-timeout`); extend the Rule 18 note to cover inline-spec `navigate→assert` (not just POM `navigate→click`); add a short "Surfacing nightly failures" subsection describing the results.json → release-health-issue enrichment.
- [ ] `testing_setup.md` — note the JSON reporter's flaky-capture and the new `scripts/summarize-test-results.ts`.
- [ ] `environments.md` — update the `e2e-nightly.yml` / `notify-release-health` description (issue body now lists failing+flaky test names); record that post-deploy-smoke "skipped" `deployment_status` runs are expected behavior.

## Testing

### Unit Tests
- [ ] `eslint-rules/no-subdefault-expect-timeout.test.ts` — RuleTester: valid (no `timeout`, `timeout: 30000`, eslint-disabled) + invalid (`timeout: 10000`, `timeout: 5000`) on `toBeVisible`/`toHaveText`/`waitFor`.
- [ ] `scripts/summarize-test-results.test.ts` — fixtures: 1 failed test, 1 flaky (passed-on-retry) test, all-passed → empty, malformed/missing file → graceful empty, multi-shard de-dup.

### Integration Tests
- [ ] None — this project is lint-rule + CI-script + spec/doc changes; no service/DB logic added. (Confirmed in `_research.md`.)

### E2E Tests
- [ ] No new specs. Modify the 3 root-cause specs (Phase 3) and re-run each **5×** locally for stability:
  - `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-paragraph-recombine.spec.ts --repeat-each=5`
  - `... admin-prompt-registry.spec.ts --repeat-each=5`
  - `... admin-evolution-judge-lab-test-sets.spec.ts --repeat-each=5`

### Manual Verification
- [ ] `npm run lint` fires `flakiness/no-subdefault-expect-timeout` on a seeded `{ timeout: 9000 }` violation and on the real offenders before they're fixed.
- [ ] Run `scripts/summarize-test-results.ts` against a saved nightly `results.json` fixture and eyeball the failed/flaky markdown output.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] No UI source changes. The only Playwright work is re-running the 3 fixed specs 5× on the local tmux server (see E2E Tests above) — all green.

### B) Automated Tests
- [ ] `npm test -- eslint-rules/no-subdefault-expect-timeout.test.ts scripts/summarize-test-results.test.ts`
- [ ] `npm run lint` (new rule loads + passes repo-wide after Phase 3 fixes), `npm run typecheck`, plus the standard `/finalize` check trio (build/unit/ESM/integration/E2E-critical).
- [ ] `actionlint .github/workflows/e2e-nightly.yml` (if available) after the Phase 2 YAML edits.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `docs/docs_overall/testing_overview.md` — PRIMARY amend target: add new flakiness rules + Enforcement Summary rows.
- [ ] `docs/feature_deep_dives/testing_setup.md` — update if a finding concerns fixtures/mocking/test infra.
- [ ] `docs/docs_overall/environments.md` — update if a finding concerns CI/CD workflow config or secrets.
- [ ] `docs/docs_overall/cloud_env.md` — update if a finding concerns web/CI proxy/network reliability.
- [ ] `docs/feature_deep_dives/error_handling.md` — update if a finding concerns transient-error/retry classification.
- [ ] `docs/feature_deep_dives/request_tracing_observability.md` — update if observability is leveraged to diagnose flakes.

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
