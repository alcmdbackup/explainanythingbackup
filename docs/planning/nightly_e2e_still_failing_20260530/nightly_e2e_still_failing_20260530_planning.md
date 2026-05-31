# Nightly E2E Still Failing Plan

## Background
Nightly E2E has failed 5 consecutive nights (5/26–5/30) despite landed fix PRs. Only the `firefox+@evolution` matrix row fails; chromium passes on the same host. The proximate cause is a Next.js 15 RSC navigation race that Firefox surfaces as `NS_BINDING_ABORTED` (Chromium silently coalesces). The deeper cause is process: PR #1124 explicitly *accepted* these failures as "informational" and deferred the mitigation; PR #1130's wizard fix touched the wrong file. See `_research.md` for full forensics.

## Requirements (from GH Issue #1139)
- Diagnose why prior fix attempts (#1124, #1127, #1129, #1130) didn't stop the nightly bleeding — **done in research doc**
- Produce a defense-in-depth fix: test-side mitigation **plus** app-side state-guard repair **plus** CI/visibility/promotion guardrails so this failure class cannot silently recur
- All 6 failing tests (`admin-evolution-navigation`, `admin-evolution-experiments-list`, `admin-evolution-filter-consistency`, `admin-evolution-variants`, `admin-strategy-wizard` × 2) green on Firefox 10×-repeat run

## Problem
Three independent failure clusters (research doc Clusters A/B/C) layered on a structural process gap (Firefox failures treated as advisory). Test-side fixes alone leave the underlying Next.js 15 race in product code, and CI alone wouldn't have caught these because the failing job was permitted to be red. Fixes at the **test**, **product**, **CI**, and **promotion-gate** layers each independently break the failure mode.

## Options Considered
- [ ] **Option A: Test-side only (P6)**: `safeGoto` helper + checkbox/wizard barriers. Lowest risk, closes 5 of 6. Leaves underlying race in product.
- [ ] **Option B: Test-side + Firefox PR-gate (P6+P1)**: A plus add Firefox to existing `e2e-evolution` CI job.
- [ ] **Option C: Full stack (P6+P1+P5a+P4)**: B plus auto-file release-health issue + block `/mainToProd` when nightly red.
- [x] **Option D: Defense-in-depth (Option C + AbortController state-guard retrofit)**: Option C plus `AbortController` in `EntityMetricsTab.tsx` and `AttributionCharts.tsx` as a state-guard pattern (NOT a "real fetch abort" — Server Action POSTs cannot be cancelled from the client; the controller prevents `setState` after unmount and ignores stale responses). **Chosen** per user direction.

## Scope Clarifications (lessons from Iteration-1 + Iteration-2 review)

- **`AbortController` retrofit scope**: Next.js Server Actions are POST RPCs; the client cannot ask the server to stop work. What we CAN do is (a) discard the response on unmount via `signal.aborted` guard and (b) prevent `setState` after unmount. This is the React-cleanup pattern used at `src/app/admin/evolution/strategies/new/page.tsx:483-539` today (short-circuits a debounced action). We are NOT claiming the server-side work is cancelled. **No `src/lib/utils/clientFetch.ts` exists today and no React `AbortController` convention exists across the codebase** (verified via grep) — Phase 2 establishes the convention with a new shared helper at **`evolution/src/lib/utils/abortableEffect.ts`** (located in the `evolution/` package since both consumers live there — Iteration-2 Arch M5).
- **Deterministic vs flaky failures**: `admin-evolution-navigation.spec.ts:83` is the only DETERMINISTIC failure (4/4 retries failed identically per research.md Test #1). The `safeGoto` 1-retry helper alone **WILL NOT fix it** — both attempts would race the same RSC abort. Phase 2 state-guard is the mandatory fix; Phase 7 splits verification into Stage 1 (flaky) and Stage 2 (deterministic). **Pre-flight verified**: the deterministic test's flow (`/admin/evolution/experiments` → experiment detail → `/admin/evolution/strategies` → strategy detail) traverses pages that mount `EntityMetricsTab` AND `AttributionCharts` (confirmed via grep: `src/app/admin/evolution/{experiments,strategies,runs}/[id]/*.tsx` all import these). Phase 2 retrofit does cover the race surface.
- **Wizard fix uses `Promise.all([waitForURL, click])`, NOT `waitForResponse`**: Iteration-2 Sec critical #1 surfaced that Next.js 15 Server Actions POST to the page URL with a `Next-Action` HTTP header (not the action name in URL). The `waitForResponse((r) => r.url().includes('createStrategyAction'))` predicate from Iteration-1 would have NEVER matched and broken the test harder. Phase 1 instead uses the simpler `Promise.all([adminPage.waitForURL(/.../, { timeout: 20000 }), createBtn.click()])` pattern — drains the redirect deterministically without needing to filter Server Action POSTs.
- **POM-ize the checkbox conditional**: filter-consistency has TWO `if (isChecked) uncheck` blocks (lines 96-98 AND 111-113). Both replaced with idempotent `setChecked(false)` behind a POM helper, mirroring `AdminContentPage.resetFilters()` (file body at `AdminContentPage.ts:158-160`). We create `EvolutionListPage` as the new POM (no evolution-admin POM exists today). Note: `AdminContentPage.resetFilters` does NOT include a post-`setChecked` `expect().not.toBeChecked` — `setChecked` already auto-waits — so `EvolutionListPage.resetFilters` follows the same single-call pattern for true symmetry (Iteration-2 Arch M2).
- **Override JSON schema matches existing `ci-gate-override.json`**: Iteration-2 Sec critical #2 + Arch A2 + Test surfaced that the Iteration-1 schema diverged. Phase 5 now writes `.claude/nightly-red-override.json` with the **identical** schema (`schema_version: 1`, `branch`, `commit`, `reason`, `approved_at`, `approved_by`) plus nightly-specific keys under nested `context: { nightly_run_id, nightly_conclusion }`. Schema verified at `.claude/hooks/block-pr-create-without-gate.sh:110-132`.

## Phased Execution Plan

### Phase 0: One-time repository setup (verify before Phase 1 commit)
- [x] `gh label list --json name --jq '.[].name' | grep -qx release-health || gh label create release-health --color FFA500 --description "Nightly/post-deploy health alerts"` (exact-name match — Iteration-3 Sec/Arch minor: unanchored grep on the human-readable `gh label list` output could match `release-health-old`/etc.) — required by Phase 4 idempotency lookup; the workflow itself ALSO contains an idempotent `gh label create ... || true` fallback so first-nightly success isn't gated on this manual step (Iteration-2 Arch A4 + Test M2).
- [x] Confirm repo Actions settings allow `permissions:` block to grant `issues: write` (default true on GitHub repos; required for Phase 4).
- [x] Optional: `npx playwright install firefox` locally if you intend to run Phase 6's local Firefox `test:gate` phase.

### Phase 1: Test-side mitigation — `safeGoto` helper + barriers + POM
- [x] Create `src/__tests__/e2e/helpers/safe-goto.ts` exporting `async function safeGoto(page: Page, url: string, opts?: Parameters<Page['goto']>[1]): Promise<Response | null>`. Behavior:
  - Try `page.goto(url, opts)`.
  - On thrown error whose `message` matches `/NS_BINDING_ABORTED/`, await `page.waitForLoadState('domcontentloaded').catch(() => {})` (lets the in-flight RSC nav settle), then retry the goto **once**.
  - Re-throw non-NS errors unchanged. Re-throw the second NS failure unchanged (no infinite retry).
  - **Observability**: emit `console.warn('[safeGoto] NS_BINDING_ABORTED retry on ' + url)` on retry so CI logs show suppressed aborts (per Iteration-1 Security minor #2). Annotate with `// eslint-disable-next-line flakiness/no-silent-catch -- documented retry contract` on the catch + on the `waitForLoadState().catch()`.
  - File-leading comment per CLAUDE.md describing the helper in 1–2 sentences.
  - **Unit test location** (Iteration-2 Test critical TC-1): Jest excludes `src/__tests__/e2e/**` (verified at `jest.config.js:82`). Place the unit test at **`src/lib/testing/safe-goto.test.ts`** with the helper itself relocated to **`src/lib/testing/safe-goto.ts`**. E2E specs import via `import { safeGoto } from '@/lib/testing/safe-goto'` — same source-of-truth, but the test runs under Jest. The test uses a hand-rolled mock object typed as `Pick<Page, 'goto' | 'waitForLoadState'>` — does NOT import `Page` from `@playwright/test` (incompatible with jsdom).
- [x] Create `src/__tests__/e2e/helpers/pages/admin/EvolutionListPage.ts` extending `AdminBasePage`. Override `resetFilters()` to call **only** `await this.page.locator('[data-testid="filter-filterTestContent"] input[type="checkbox"]').setChecked(false);` (single call — `setChecked` is auto-waiting + idempotent per Playwright; mirrors `AdminContentPage.resetFilters` at `AdminContentPage.ts:158-160` for true symmetry, Iteration-2 Arch M2). Add `enableHideTestFilter()` calling `.setChecked(true)` for the re-check step at filter-consistency.spec.ts:107.
- [x] Codemod chained-goto sites to use `safeGoto`. Each line below is the chained-goto being replaced (NOT the test's initial goto):
  - `src/__tests__/e2e/specs/09-admin/admin-evolution-navigation.spec.ts:112` — `await safeGoto(adminPage, '/admin/evolution/strategies', { timeout: 30000 })`
  - `src/__tests__/e2e/specs/09-admin/admin-evolution-experiments-list.spec.ts:189`
  - `src/__tests__/e2e/specs/09-admin/admin-evolution-variants.spec.ts:254`
  - Audit `admin-evolution-filter-consistency.spec.ts` — replace any chained-goto in the same way. Leave initial-page `goto` calls untouched (initial nav is not racing anything).
- [x] Replace filter-consistency conditional checkbox handling at BOTH occurrences (lines 96-98 AND 111-113): instantiate `const listPage = new EvolutionListPage(adminPage);` at the top of the test, then replace both `if (isChecked) uncheck` blocks with `await listPage.resetFilters();`. Replace the bare `await hideTestCheckbox.check()` at line 105 with `await listPage.enableHideTestFilter();`.
- [x] Apply the same POM idiom in `admin-strategy-wizard.spec.ts:159-163` (replace `if (await isChecked()) click()` with `await listPage.resetFilters();`).
- [x] For `admin-strategy-wizard.spec.ts:245` (URL-stuck wizard at line 282): replace lone `createBtn.click()` at line 280 with the `Promise.all([waitForURL, click])` pattern. This drains the redirect deterministically without depending on Next.js Server Action internals (Iteration-2 Sec critical #1 — Server Action POSTs go to the page URL with a `Next-Action` header, NOT a URL-matchable action name; `waitForResponse((r) => r.url().includes('createStrategyAction'))` would never match). Pattern:
  ```ts
  await Promise.all([
    adminPage.waitForURL(/\/admin\/evolution\/strategies\/[0-9a-f-]+/, { timeout: 20000 }),
    createBtn.click(),
  ]);
  // existing `await expect(adminPage).toHaveURL(...)` at line 282 is now redundant but kept for assertion-locality
  ```
  This works because the existing assertion at line 282 already specifies the same URL pattern; the `Promise.all` just ensures Playwright is listening for the URL change BEFORE the click fires (avoiding the race where click + redirect complete before the assertion attaches).
- [x] **Lint sanity**: confirm the helper's `console.warn` + annotated catches pass `flakiness/no-silent-catch`. The plan does NOT use `waitForTimeout` anywhere (avoids `flakiness/no-wait-for-timeout`); does NOT use `waitForLoadState('networkidle')` (avoids `flakiness/no-networkidle`).

### Phase 2: App-side state-guard retrofit (AbortController for unmount safety)
- [x] **Pre-flight verification** (Iteration-2 Test critical TC-3): confirmed that `src/app/admin/evolution/{experiments/[experimentId]/ExperimentDetailContent.tsx, strategies/[strategyId]/page.tsx, runs/[runId]/page.tsx}` all mount `EntityMetricsTab` AND `AttributionCharts` (grep verified). The deterministic test's `experiments → detail → strategies → detail` traversal therefore unmounts these exact components mid-fetch on each `goto`. Phase 2 retrofit covers the race surface. If the deterministic test STILL fails 4/4 after Phase 2 lands, escalate by inspecting Playwright trace.zip's network timeline to identify a different component holding the in-flight request.
- [x] Create `evolution/src/lib/utils/abortableEffect.ts` exporting a small helper:
  ```ts
  // Returns { signal, cancelled } that React effects can use to (a) pass signal
  // to fetch-style callers and (b) gate post-await setState with !cancelled.
  // Establishes the project convention; no equivalent exists today.
  export function abortableEffectController() {
    const controller = new AbortController();
    return {
      signal: controller.signal,
      get cancelled() { return controller.signal.aborted; },
      abort() { controller.abort(); }
    };
  }
  ```
  Unit test: success path, abort flips `cancelled`, double-abort is safe.
- [x] `evolution/src/components/evolution/tabs/EntityMetricsTab.tsx:119-132` (note: `tabs/` not `sections/`): wrap the `useEffect` fetch in `abortableEffectController()`. `getEntityMetricsAction` is the 2-arg `(entityType, entityId)` Server Action defined at `evolution/src/services/metricsActions.ts:49-75` — **it does NOT accept an `AbortSignal` arg** (Iteration-2 Test critical TC-2). Phase 2 scope is **state-guard ONLY**: keep the existing 2-arg call, gate the post-await `setState` with `if (!cancelled) setMetrics(result)`, return `() => abort()` from the effect. Add `// TODO(perf): plumb AbortSignal through getEntityMetricsAction if response cancellation becomes important — separate PR` as a comment so the limitation is visible.
- [x] `evolution/src/components/evolution/tabs/AttributionCharts.tsx:42-57`: refactor the existing `let cancelled = false` pattern (lines 43-56) to use the shared `abortableEffectController()` for consistency. Keep the reset-on-mount idiom for `useRef`-tracked mount state **unconditionally** (testing_setup.md:357 documents the React Strict Mode behavior — Iteration-2 Arch M1 corrects the earlier "§9" cite which doesn't exist; the warning lives in the "Local vs CI Execution" section).
- [x] Confirm `evolution/src/components/evolution/sections/EntityDetailTabs.tsx:106-111` doc-comment race description still accurately reflects post-fix state; update if needed.
- [x] **Explicit non-goal**: this phase does NOT claim to cancel the server-side work. Server Actions are POST RPCs whose execution continues even after the client navigates away. The retrofit's value is preventing stale state writes into unmounted React trees and giving the response a clean discard path so Firefox stops emitting `NS_BINDING_ABORTED` errors that propagate to Playwright.

### Phase 3: Firefox in PR CI for evolution-path PRs (P1)
- [x] `.github/workflows/ci.yml` `e2e-evolution` job (~line 536-608): add
  ```yaml
  strategy:
    fail-fast: false
    matrix:
      browser: [chromium, firefox]
  ```
- [x] **Cache key disambiguation**: change line 588 to `key: playwright-${{ runner.os }}-${{ steps.playwright-version.outputs.version }}-${{ matrix.browser }}` (mirrors e2e-nightly.yml:80).
- [x] **Install command parameterization**: lines 592 and 596 change `chromium` to `${{ matrix.browser }}` (mirrors e2e-nightly.yml:84, 88).
- [x] **Artifact name disambiguation**: line 604 change `name: playwright-report-evolution` to `name: playwright-report-evolution-${{ matrix.browser }}`.
- [x] **Test command — inline, not via `npm run`** (Iteration-2 Arch critical A1): the existing `npm run test:e2e:evolution` script hardcodes `--project=chromium` (`package.json:29`). Appending `--project=${{ matrix.browser }}` to that invocation would yield a double-`--project` flag and run both browsers per matrix row. **Fix**: replace the `npm run test:e2e:evolution` call in ci.yml's e2e-evolution job with an inline `npx playwright test --project=${{ matrix.browser }} --grep=@evolution --grep-invert='@skip-prod'` invocation (preserves all flags + adds the browser matrix). Do NOT modify the `npm run` script — other callers (local `/finalize`, manual dev) rely on the chromium default.
- [x] Keep `detect-changes` path gating unchanged. Matrix runs are intra-workflow so `concurrency:` (ci.yml:11-13) is unaffected.
- [x] Verify `playwright.config.ts` firefox project (line ~160) has no `testMatch` exclusions that would skip the failing specs.
- [x] Update doc tables: `environments.md` and `testing_overview.md` workflow-comparison rows + `testing_setup.md:486` "E2E Behavior by Target Branch" block.

### Phase 4: Auto-file release-health GitHub issue on nightly failure (P5a)
- [x] `.github/workflows/e2e-nightly.yml`: add top-level `permissions:` block (currently has none):
  ```yaml
  permissions:
    contents: read
    issues: write
  ```
- [x] Add a final job `notify-release-health` with `needs: [e2e]` and `if: failure()`:
  ```yaml
  notify-release-health:
    needs: [e2e]
    if: failure()
    runs-on: ubuntu-latest
    # Workflow-level permissions:{contents:read, issues:write} apply; no job-level
    # override needed (Iteration-2 Sec minor: job-level permissions OVERRIDE
    # workflow-level, so omitting here preserves both scopes).
    steps:
      - name: Ensure release-health label exists
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        # Idempotent — first run creates the label, subsequent runs no-op
        run: gh label create release-health --color FFA500 --description "Nightly/post-deploy health alerts" --repo "${{ github.repository }}" 2>/dev/null || true
      - name: Find or create release-health issue
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
        run: |
          set -euo pipefail
          # Idempotent by date. e2e-nightly matrix has max-parallel:1
          # (e2e-nightly.yml:19-20), so matrix rows cannot race this step.
          # `needs: [e2e]` ensures we run once after all rows complete.
          TODAY=$(date -u +%F)
          TITLE="[release-health] Nightly E2E failed — ${TODAY}"
          # Use label+creation-date filter for the lookup (Iteration-2 Test M4 —
          # title-substring search treats brackets and em-dash specially and can
          # false-positive; label+date is stable).
          EXISTING=$(gh issue list \
            --label release-health \
            --state open \
            --search "created:${TODAY}" \
            --json number,title \
            --jq "[.[] | select(.title == \"${TITLE}\")][0].number // empty")
          BODY=$(cat <<EOF
          Run: ${RUN_URL}
          Matrix: ${{ github.workflow }} on ${{ github.head_ref || github.ref_name }}

          Failing matrix rows visible in run page. Triage: docs/docs_overall/debugging.md
          EOF
          )
          if [ -n "${EXISTING}" ]; then
            gh issue comment "${EXISTING}" --body "Failure recurred: ${RUN_URL}"
          else
            gh issue create --title "${TITLE}" --body "${BODY}" --label release-health
          fi
  ```
- [x] **Title strategy**: dated title = one issue per failed day. Multi-day streaks produce multiple issues so the streak is visible at-a-glance in the issues list; same-day repeats comment instead.
- [x] **No `continue-on-error`**: removed per Iteration-2 Sec minor #4 — the workflow is already failed (that's why notify ran), so allowing the notify step's failure to be visible on the run page is informative rather than cascading.

### Phase 5: Block `/mainToProd` promotion when latest nightly is red (P4)
- [x] `.claude/commands/mainToProd.md`: insert a **new "### 0. Nightly Health Precheck"** section at the top of the step sequence (existing `### 1. Setup` and Steps 2..N retain their numbers). Distinct name avoids the "two adjacent Setup steps" naming collision (Iteration-2 Arch A3). **Ordering note** (Iteration-3 Arch minor): the precheck QUERY runs at Step 0 (fail-fast before any branch work), but the override file `git add` of `.claude/nightly-red-override.json` must happen AFTER Step 1's `git stash` + `git checkout -b deploy/...` so the file lands on the deploy branch and is included in the deploy commit at Step 5. Implement as: Step 0 = query + abort decision (no file writes); if override is set, defer the `jq -n ... > .claude/nightly-red-override.json` + `git add` to Step 1.5 (inserted between Setup and Merge Main). The new step runs (Step 0 portion shown first; the file-write block is the Step 1.5 portion):
  ```bash
  LATEST=$(gh run list --workflow=e2e-nightly.yml --branch=main --limit=1 \
    --json conclusion,databaseId,headSha,createdAt \
    --jq '.[0]')
  if [ -z "${LATEST}" ]; then
    echo "ERR: could not fetch latest nightly via gh — promotion BLOCKED (fail-CLOSED for prod promotion). Set PROMOTE_DESPITE_NIGHTLY_RED=true with REASON to override." >&2
    [ "${PROMOTE_DESPITE_NIGHTLY_RED:-}" != "true" ] && exit 1
  fi
  CONCLUSION=$(echo "${LATEST}" | jq -r .conclusion)
  if [ "${CONCLUSION}" != "success" ]; then
    if [ "${PROMOTE_DESPITE_NIGHTLY_RED:-}" != "true" ]; then
      echo "ABORT: latest nightly is ${CONCLUSION} (run $(echo "${LATEST}" | jq -r .databaseId)). Set PROMOTE_DESPITE_NIGHTLY_RED=true with REASON to override." >&2
      exit 1
    fi
    # Persistent audit trail — schema matches .claude/ci-gate-override.json
    # exactly (verified at .claude/hooks/block-pr-create-without-gate.sh:110-132)
    # so any future shared validator can consume both files. AUDIT-ONLY today:
    # no hook reads nightly-red-override.json — schema parity is forward-compat.
    # Uses `jq -n --arg` to defend against quote/newline injection in REASON
    # (matches the existing `.claude/commands/approve-pr.md` idiom).
    REASON="${NIGHTLY_OVERRIDE_REASON:-unspecified}"
    BRANCH=$(git rev-parse --abbrev-ref HEAD)
    COMMIT=$(git rev-parse HEAD)
    EMAIL=$(git config user.email)
    NIGHTLY_RUN_ID=$(echo "${LATEST}" | jq -r .databaseId)
    jq -n \
      --arg branch "$BRANCH" \
      --arg commit "$COMMIT" \
      --arg reason "$REASON" \
      --arg at "$(date -u -Iseconds)" \
      --arg by "$EMAIL" \
      --argjson run_id "$NIGHTLY_RUN_ID" \
      --arg conclusion "$CONCLUSION" \
      '{schema_version: 1, branch: $branch, commit: $commit, reason: $reason, approved_at: $at, approved_by: $by, context: {nightly_run_id: $run_id, nightly_conclusion: $conclusion}}' \
      > .claude/nightly-red-override.json
    git add .claude/nightly-red-override.json
    echo "WARN: nightly-red override recorded at .claude/nightly-red-override.json (reason: ${REASON})" >&2
  fi
  ```
- [x] **Fail-CLOSED on `gh` unavailability**: production promotion is a higher risk class than the CI-monitor hook; missing `gh` blocks the promotion unless `PROMOTE_DESPITE_NIGHTLY_RED=true` is also explicitly set.
- [x] **Persistent audit**: the override file uses the **exact** `ci-gate-override.json` schema (`schema_version: 1`, `branch`, `commit`, `reason`, `approved_at`, `approved_by`) plus extra context under nested `context: {nightly_run_id, nightly_conclusion}` (Iteration-2 Sec critical #2 + Arch A2 — earlier draft used divergent keys; fixed). The file is added to the deploy commit so post-mortems can `git log -- .claude/nightly-red-override.json` to trace why a red nightly was bypassed.
- [x] Document the override flag + `NIGHTLY_OVERRIDE_REASON` env var in `.claude/commands/mainToProd.md` skill description.

### Phase 6: Add Firefox to local `test:gate` (P3, opt-in)
- [x] `scripts/run-test-gate.sh`: add a new Phase D (after current Phase C) that runs `npx playwright test --project=firefox --grep=@evolution --grep-invert='@skip-prod' --reporter=line`. Phase letter verified by reading the script before editing (Iteration-1 Arch minor #4).
- [x] If Firefox binary is not installed (detect via `npx playwright --version` + `~/.cache/ms-playwright/firefox-*` glob), print: `"INFO: Firefox not installed locally; skipping firefox-evolution gate. Install via 'npx playwright install firefox' to enable this check."` and exit 0 for the phase (does NOT block test-gate success — server-side P1 is the authoritative enforcement).
- [x] **No gate schema change required**: `block-pr-create-without-gate.sh:225` only reads `.tests | length` from `test-pass.json` (verified — does NOT validate specific test names per Iteration-2 Arch M4). So adding a new local phase requires no hook change.
- [x] **Update `tests:` array audit accuracy** (Iteration-3 Test minor): `scripts/run-test-gate.sh:83` hardcodes `tests: ["lint","typecheck","test:esm","test","test:integration","test:e2e:critical"]`. When Phase D actually runs Firefox locally, append `"test:e2e:firefox-evolution"` to the array so `test-pass.json` accurately reflects what was verified. When Firefox install is missing and Phase D no-ops, leave the array unchanged.
- [x] Gate the new phase locally on `evolution/` file changes (mirror CI's `detect-changes` heuristic) so non-evolution PRs don't pay the firefox cost on every `/finalize`.

### Phase 7: Verification — split deterministic vs flaky
- [x] **Stage 1 — Phase 1 only (test-side helpers landed)**: locally via `ensure-server.sh`, run all flaky tests 10× on Firefox:
  ```bash
  npx playwright test --project=firefox --grep=@evolution --repeat-each=10 \
    src/__tests__/e2e/specs/09-admin/admin-evolution-experiments-list.spec.ts \
    src/__tests__/e2e/specs/09-admin/admin-evolution-filter-consistency.spec.ts \
    src/__tests__/e2e/specs/09-admin/admin-evolution-variants.spec.ts \
    src/__tests__/e2e/specs/09-admin/admin-strategy-wizard.spec.ts
  ```
  **Pass criterion** (Iteration-2 Test M1): **40/40 Firefox runs green** (4 flaky specs × 10 repeats), then separately re-run the same 4 specs with `--project=chromium --repeat-each=5` and require **20/20 chromium runs green** to ensure no regression. Any single failure across either set blocks Phase 2 merge.
- [x] **Stage 2 — Phase 2 added (deterministic test target)**: run the deterministic one separately:
  ```bash
  npx playwright test --project=firefox --repeat-each=10 \
    src/__tests__/e2e/specs/09-admin/admin-evolution-navigation.spec.ts
  ```
  **Pass criterion**: 10/10 green. If <10/10, `safeGoto`'s retry is masking a still-broken app state — escalate to Phase 2 sub-task: verify EntityMetricsTab/AttributionCharts cleanup actually fires on unmount (add temporary `console.log` in the cleanup, observe in Firefox DevTools).
- [x] **Stage 3 — post-merge**: trigger nightly manually via `gh workflow run e2e-nightly.yml` after PR lands on main → verify all 4 matrix rows green. Then `/mainToProd` (Phase 5 now active) to promote.
- [x] **Rollback plan** (Iteration-2 Test M3 + Iteration-3 Test minor): Phases 1, 3, 4, 5, 6 are additive / leaf helpers — `git revert <merge-commit-SHA>` cleanly reverses them. Phase 2 has coupling: the helper at `evolution/src/lib/utils/abortableEffect.ts` has 2 consumers (`EntityMetricsTab.tsx`, `AttributionCharts.tsx`). Rollback options for Phase 2: (a) revert the merge-commit SHA so helper + both consumers atomically revert; (b) **hot-patch alternative** — replace the helper body with a no-op `return { signal: new AbortController().signal, get cancelled() { return false; }, abort() {} }` so consumer imports keep compiling while the cleanup becomes inert. **Caveat for option (b)**: the getter creates a fresh `AbortController` per call, so `signal` reference identity differs across calls — safe today (consumers only read `cancelled`) but document in the rollback PR description as "safe only as long as consumers do not capture-and-compare signal references."
- [x] **Stage 2 escalation also inspects trace.zip** (Iteration-3 Test minor): if the deterministic test fails after Phase 2, the escalation path uses BOTH temporary `console.log` in component cleanup AND the saved Playwright trace.zip network timeline (the trace artifact is downloadable from the failing run via `gh run download`). Console.log alone may be masked by React Strict Mode double-invocation; the trace shows the actual aborted request.

## Testing

### Unit Tests
- [x] `src/lib/testing/safe-goto.test.ts` (Jest, jsdom — moved from `src/__tests__/e2e/...` which Jest excludes per `jest.config.js:82`). Hand-roll a mock typed as `Pick<Page, 'goto' | 'waitForLoadState'>`. Cases:
  - (a) success path: `goto` resolves → forwards args and return value; no retry attempted
  - (b) NS_BINDING_ABORTED on first call: catches, `waitForLoadState('domcontentloaded')` invoked, second `goto` resolves
  - (c) non-NS error: thrown unchanged, no retry
  - (d) NS_BINDING_ABORTED on both attempts: re-throws the second error
  - (e) options forwarded to both attempts
  - (f) `console.warn` called exactly once on retry
- [x] `evolution/src/lib/utils/abortableEffect.test.ts`: success path, `abort()` flips `cancelled`, double-abort is idempotent, `signal` is a real `AbortSignal`.
- [x] `evolution/src/components/evolution/tabs/EntityMetricsTab.test.tsx` (Iteration-2 Test critical TC-2 — corrected): mock `getEntityMetricsAction` with its **actual 2-arg signature** `(entityType, entityId)`; do NOT fabricate an `opts.signal` arg the production code doesn't pass. Single case: **render → unmount BEFORE the mocked promise resolves → resolve the promise → assert no React `act()` warning and no state-update-after-unmount warning are emitted** (verifies the `cancelled` guard prevents `setMetrics(result)`). Use a manually controllable Promise: `let resolve; const promise = new Promise(r => { resolve = r; }); mockGetEntityMetricsAction.mockReturnValue(promise);`.
- [x] `evolution/src/components/evolution/tabs/AttributionCharts.test.tsx`: same single-case coverage (unmount-before-resolve → no warning); create file if missing.

### Integration Tests
- [x] None required — this work is test infrastructure + UI component changes. Existing `evolution-actions.integration.test.ts` covers the server actions.

### E2E Tests
- [x] All 6 originally-failing specs (Phase 7 stages 1 & 2) must pass deterministically.
- [x] No new E2E specs; the helper's behavior is fully covered by unit tests.

### Manual Verification
- [ ] Open `https://ea-evolution.vercel.app/admin/evolution/runs` in Firefox, click into a run, click back, repeat 10× with DevTools Network panel open — zero `NS_BINDING_ABORTED` entries.
- [ ] Same exercise for strategies, experiments, variants list pages.
- [ ] Create a `[TEST] Wizard Defense Plan` strategy with `reflect_and_generate` agent type via the wizard on Firefox; verify it lands in the list within 15s.

## Verification

### A) Playwright Verification (required for UI changes)
- [x] Local via `ensure-server.sh` (Phase 7 Stage 1): firefox + chromium 10×-repeat flaky-suite green.
- [x] Local via `ensure-server.sh` (Phase 7 Stage 2): firefox + chromium 10×-repeat deterministic test green.
- [ ] Manual Firefox session for 10 navigation round-trips per detail-page kind (runs/strategies/experiments/variants); zero `NS_BINDING_ABORTED` in DevTools.

### B) Automated Tests
- [x] `npm run lint` — must pass (verify `safeGoto`'s `eslint-disable` annotations land cleanly)
- [x] `npm run typecheck`
- [x] `npm run test -- safe-goto abortableEffect EntityMetricsTab AttributionCharts` (unit tests for the new helpers + retrofitted components)
- [x] `npm run test:e2e:evolution --project=firefox` (single pass, sanity)
- [x] `npm run test:gate` (full local gate including new Phase D)
- [ ] Manual `gh workflow run e2e-nightly.yml` post-merge → verify all 4 matrix rows green
- [x] Verify `/mainToProd` Phase-5 precheck fires when nightly is red (test by running on a known-red day; expect ABORT message + non-zero exit)

## Documentation Updates
The following docs were identified as relevant and will need updates:
- [x] `docs/docs_overall/environments.md` — CI matrix table: add Firefox to `e2e-evolution`; `/mainToProd` cadence: add the nightly-red precheck note; alerting paragraph: add the auto-filed `release-health` issue (currently mentions only Slack)
- [x] `docs/docs_overall/testing_overview.md` — Workflow Comparison browsers column → "Chromium + Firefox (evolution paths only)"; new flake-rule entry: "Use `safeGoto()` for any chained `page.goto()` after a prior click/nav on evolution detail pages"
- [x] `docs/feature_deep_dives/testing_setup.md` — document `safeGoto` in "E2E Patterns"; add a section on `EvolutionListPage` POM next to `AdminContentPage`; document the `abortableEffectController` convention as a new "React patterns" section; update "E2E Behavior by Target Branch" table at testing_setup.md:486 (not "Workflow Comparison" — verified)
- [x] `docs/docs_overall/debugging.md` — add an "NS_BINDING_ABORTED on Firefox" troubleshooting entry pointing at `safeGoto` + the AbortController retrofit
- [x] `_research.md` — fix the `sections/` → `tabs/` path errors in the EntityMetricsTab / AttributionCharts references

## Review & Discussion
[Populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]

### Iteration 1 (security 3/5, architecture 3/5, testing 3/5)
Agents converged on 6 critical themes:
1. **Wrong file paths** (`sections/` → `tabs/`) — fixed in Phase 2 and Scope Clarifications
2. **`AbortController` cannot cancel Server Action POSTs** — Scope Clarifications now explicit; phase reframed as state-guard + new `abortableEffectController` helper since no convention exists
3. **CI cache-key/install/artifact collision** — Phase 3 now spells out all three matrix-key fixes per nightly.yml precedent
4. **Wizard `waitForLoadState('domcontentloaded')` is a no-op** at line 280 because already awaited at line 247 — Phase 1 initially used `waitForResponse` (later fixed in Iteration 2 to `Promise.all([waitForURL, click])`)
5. **Deterministic vs flaky** — Phase 7 splits into Stage 1 (flaky, Phase 1 only) and Stage 2 (deterministic, requires Phase 2)
6. **Phase 4/5 missing `permissions:`, idempotency commands, persistent audit** — Phases 4 and 5 got full YAML/bash with `permissions:`, idempotency, dated-title strategy, and `.claude/nightly-red-override.json`

### Iteration 2 (security 3/5, architecture 4/5, testing 4/5)
New critical issues surfaced after Iteration-1 revisions, all now fixed:
1. **`waitForResponse('createStrategyAction')` would never match** (Sec) — Server Action POSTs go to page URL with `Next-Action` header, not action name. Replaced with `Promise.all([waitForURL, click])`.
2. **`nightly-red-override.json` schema diverged from `ci-gate-override.json`** despite plan claim (Sec/Arch/Test) — corrected to use exact schema (`schema_version`, `branch`, `commit`, `reason`, `approved_at`, `approved_by`) + nested `context` for nightly-specific keys.
3. **Phase 3 `--project` double-flag** (Arch) — `npm run test:e2e:evolution` already specifies `--project=chromium`. Replaced with inline `npx playwright test` in ci.yml.
4. **`safe-goto.test.ts` in Jest-excluded directory** (Test) — moved helper and test to `src/lib/testing/`.
5. **`EntityMetricsTab` test mock had fabricated signature** (Test) — real `getEntityMetricsAction` is 2-arg, accepts no signal. Test now verifies only the post-await `cancelled` guard via controllable Promise.
6. **Phase 2 might not cover deterministic test** (Test) — pre-flight confirmed via grep that the deterministic test's pages all mount `EntityMetricsTab` + `AttributionCharts`; documented as Phase 2 first sub-task.
7. **Phase 5 step naming collision** (Arch) — "Setup precheck" → "Nightly Health Precheck" to avoid duplicating existing Step 1 "Setup".
8. **`release-health` label creation risk** (Arch/Test) — moved into the workflow itself as idempotent `gh label create … || true`, plus a Phase 0 checklist.

Minor issues also addressed: `EvolutionListPage.resetFilters` true symmetry with `AdminContentPage` (no extra `expect`), fabricated `Known Issues §9` citation corrected to `testing_setup.md:357`, `abortableEffect.ts` moved to `evolution/src/lib/utils/` (closer to its only consumers), `gh issue list` search uses `created:DATE` label filter (em-dash robustness), redundant job-level `permissions:` dropped, `continue-on-error` dropped from notify job, Phase 6 schema-bump-consideration replaced with verified statement, Phase 7 pass-criteria disambiguated (40/40 Firefox + 20/20 chromium), Phase 2 rollback documents both atomic-revert and hot-patch-no-op options.

### Iteration 3 (security 5/5, architecture 5/5, testing 5/5) — ✅ CONSENSUS
All iteration-2 critical gaps verified resolved against the codebase. No remaining critical blockers. Minor polish folded in:
- Corrected `evolution/src/actions/metricsActions.ts:13-17` → `evolution/src/services/metricsActions.ts:49-75` (the `actions/` directory does not exist; `getEntityMetricsAction` is exported at line 75 via `withLogging` wrapper around `_getEntityMetricsImpl` at lines 49-71)
- Phase 5 override file uses `jq -n --arg` (matches `.claude/commands/approve-pr.md` idiom) instead of heredoc — defends against quote/newline injection in `REASON` AND avoids heredoc-indentation portability traps
- Phase 0 label-existence grep uses `gh label list --json name --jq '.[].name' | grep -qx release-health` for exact match
- Phase 5 step ordering: query at Step 0 (fail-fast), file write at Step 1.5 (after `git stash` + `git checkout -b deploy/...`) so the override lands on the deploy branch
- Phase 6 explicitly updates `scripts/run-test-gate.sh:83` `tests:` array entry when Firefox runs (test-pass.json audit accuracy)
- Phase 2 hot-patch caveat: getter returns fresh `AbortController.signal` per call; safe today (consumers only read `cancelled`) but document in rollback PR
- Phase 7 Stage 2 escalation: inspect Playwright trace.zip alongside `console.log` (trace shows actual aborted request; console may be masked by Strict Mode double-invoke)
