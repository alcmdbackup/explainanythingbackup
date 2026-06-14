# Remove Firefox Stage Merges Research

## Problem Statement
Stop requiring Firefox on stage merges. The PR-CI pipeline for stage (PRs to `main`) currently runs a Firefox browser matrix on the `e2e-evolution` job whenever evolution/admin paths change, which slows down stage merges and forces fixes for Firefox-only flakiness (e.g. NS_BINDING_ABORTED) before merge.

## Requirements (from GH Issue #1204)
stop requiring firefox on stage merges

## High Level Summary

The `e2e-evolution` PR-CI job's `browser: [chromium, firefox]` matrix (`.github/workflows/ci.yml:557`) is the **only** place Firefox currently runs anywhere in CI. The nightly suite already dropped Firefox on 2026-06-07 to halve real-LLM spend (`e2e-nightly.yml:28-31`), and `post-deploy-smoke.yml` / `e2e-real-ai-smoke.yml` are Chromium-only. So this task is functionally "remove Firefox from CI" — not just "remove from stage" — because there is no remaining non-stage consumer.

The minimum change is one line: flip the matrix to `[chromium]`. Everything else (the `firefox` Playwright project, `safe-goto.ts`, `test.slow()` conditionals, ESLint guidance about `safeGoto`) becomes dead code. The user can choose minimal-flip vs. comprehensive-cleanup during planning.

One non-code step is required: branch protection on `main` likely lists `E2E Tests (Evolution - firefox)` as an individual required status check (matrix rows register independently — see memory `[project_gh_branch_protection_check_registration.md]`). After the matrix change, that check name stops reporting forever and will block PRs until manually removed in repo settings. The user must do this — the local PAT lacks `administration:write` scope.

`abortableEffectController` (`evolution/src/lib/utils/abortableEffect.ts`) was motivated by Firefox but is referenced from production component code (`EntityMetricsTab.tsx:139-140`) for general React unmount safety. Keep it.

## Documents Read

### Core Workflow Docs (read during /initialize)
- `docs/docs_overall/getting_started.md`
- `docs/docs_overall/architecture.md`
- `docs/docs_overall/project_workflow.md`
- `docs/docs_overall/environments.md` — confirmed `e2e-evolution` Firefox matrix and Chromium-only nightly (`environments.md:275, 299`)
- `docs/docs_overall/testing_overview.md` — "Firefox-evolution PR matrix" paragraph at `testing_overview.md:392` documents the very thing being removed; nightly entry at `testing_overview.md:408` is stale (still says "Chromium + Firefox" though `e2e-nightly.yml` is already chromium-only)
- `docs/feature_deep_dives/testing_setup.md` — `safeGoto` section at `testing_setup.md:340-353`; nightly browser matrix entry at `testing_setup.md:536` also stale
- `docs/docs_overall/debugging.md` — NS_BINDING_ABORTED Firefox section at `debugging.md:5-26`

## Code Files Read

### Workflows (the change surface)
- `.github/workflows/ci.yml:540-623` — `e2e-evolution` job definition. Key lines:
  - `:540` job display name interpolates `${{ matrix.browser }}` — `E2E Tests (Evolution - chromium)` / `E2E Tests (Evolution - firefox)` are the registered check names
  - `:551` `max-parallel: 1` comment "both browsers run sequentially against the same staging"
  - `:557` `browser: [chromium, firefox]` — **the single edit needed**
  - `:604, :608` `npx playwright install --with-deps ${{ matrix.browser }}` — works as-is with single-row matrix
  - `:612-614` comment block explains the `--project=${{ matrix.browser }}` flag and warns against the double-flag pattern. Comment becomes obsolete with chromium-only matrix; consider replacing with hardcoded `npm run test:e2e:evolution`
  - `:619` artifact upload name `playwright-report-evolution-${{ matrix.browser }}` — interpolation still works
- `.github/workflows/e2e-nightly.yml:28-31` — comment says "firefox dropped to halve real spend"; matrix is `browser: [chromium]`. **Confirms no other consumer of the Firefox project exists.**
- `.github/workflows/e2e-real-ai-smoke.yml` — uses `--project=prod-ai` (Chromium under the hood). No Firefox.
- `.github/workflows/post-deploy-smoke.yml` — Chromium only.

### Playwright config & test infra
- `playwright.config.ts:157-165` — `name: 'firefox'` project definition. Dead after the workflow change; safe to delete.
- `src/lib/testing/safe-goto.ts` (~27 LOC) — wraps `page.goto` with one retry on NS_BINDING_ABORTED. Firefox-only failure mode. Dead after the change.
- `src/lib/testing/safe-goto.test.ts` — unit tests for above. Dead after the change.
- `evolution/src/lib/utils/abortableEffect.ts` (~33 LOC) — **KEEP**. Used in production component `evolution/src/components/evolution/tabs/EntityMetricsTab.tsx:139-140` for general unmount-safe setState; comment notes Firefox surfaced the issue but the guard is broadly useful.
- `evolution/src/lib/utils/abortableEffect.test.ts` — keep alongside.

### Test specs with Firefox-conditional code (dead after change)
- `src/__tests__/e2e/specs/02-search-generate/search-generate.spec.ts:84-85, 122-123, 257-258` — `if (testInfo.project.name === 'firefox') test.slow();` (3 occurrences)
- `src/__tests__/e2e/specs/09-admin/admin-evolution-variants.spec.ts:254` — comment + `safeGoto` usage
- `src/__tests__/e2e/specs/09-admin/admin-evolution-navigation.spec.ts:112` — comment + `safeGoto` usage
- `src/__tests__/e2e/specs/09-admin/admin-evolution-experiments-list.spec.ts:189` — comment + `safeGoto` usage
- `src/__tests__/e2e/specs/09-admin/admin-strategy-wizard.spec.ts:279` — Firefox-NS comment (no `safeGoto` import; just an explanatory comment)
- `src/__tests__/e2e/specs/smoke.public.spec.ts:56` — comment mentions nightly chromium/firefox testMatch; stale (nightly is chromium-only)

### Historical / planning (low priority for this PR)
- `src/__tests__/e2e/E2E_TESTING_PLAN.md:38, 329, 443-444, 466, 818` — older test plan doc; documents historic intent. Update only if doing comprehensive cleanup.

## Key Findings

1. **One-line change is sufficient** — `.github/workflows/ci.yml:557`: `browser: [chromium, firefox]` → `browser: [chromium]` stops Firefox from running on any stage merge.
2. **Firefox is already gone from every non-stage consumer** — nightly (`e2e-nightly.yml:31`), real-AI smoke, and post-deploy smoke are all Chromium-only. After this change, no CI surface runs Firefox at all.
3. **`safeGoto` and the `firefox` Playwright project become unreachable dead code.** Two valid PR scopes:
   - **Minimal**: edit `ci.yml:557` only; leave dead code in place (in case Firefox returns)
   - **Comprehensive**: also delete `playwright.config.ts:157-165`, `src/lib/testing/safe-goto.ts` + test, the three `test.slow()` conditionals in `search-generate.spec.ts`, and the four `safeGoto` callsites in `09-admin/*.spec.ts` (replace with regular `page.goto`).
4. **`abortableEffectController` must stay.** It's a Firefox-motivated guard, but production component code already depends on it (`EntityMetricsTab.tsx:139`). Removing it would regress general React unmount safety.
5. **Branch protection is the hidden long-pole.** Per memory `[project_gh_branch_protection_check_registration.md]`, GH branch protection registers each matrix row as a separate required check. After the matrix change, `E2E Tests (Evolution - firefox)` stops reporting and any PR listing it as required will block forever. Resolution is manual (Settings → Branches → Edit protection rule → remove the check); the local PAT lacks `administration:write` so we can't automate it.
6. **Doc updates needed alongside the workflow edit** to keep environments.md / testing_overview.md / testing_setup.md / debugging.md coherent with reality:
   - `environments.md:275` ("Browser matrix: Chromium + Firefox" — stale nightly entry, fix while here)
   - `environments.md:299` ("Browsers | Chromium (+ Firefox on `e2e-evolution`…)" — drop the parenthetical)
   - `testing_overview.md:392` (the "Firefox-evolution PR matrix" paragraph — delete or rewrite as "Firefox was retired YYYY-MM-DD")
   - `testing_overview.md:408, 436` (nightly browser entries — make Chromium-only)
   - `testing_setup.md:340-353` (safeGoto section — delete if removing helper, otherwise note it's historical)
   - `testing_setup.md:369-380` (abortableEffectController section — keep but drop Firefox framing)
   - `testing_setup.md:536, 719` (nightly browser line + Firefox SSE known-issue — both stale)
   - `debugging.md:5-26` (NS_BINDING_ABORTED Firefox section — delete or move to a historical-issues subheading)
7. **Two stale docs to fix opportunistically** even under the minimal path — `e2e-nightly.yml`'s Chromium-only state from 2026-06-07 was never propagated into `testing_overview.md:408`, `testing_setup.md:536`, etc. The Firefox-removal PR is the natural moment to fix them.

## Open Questions

1. **PR scope — minimal flip vs. comprehensive cleanup?** Recommendation: comprehensive, because nothing else runs Firefox and leaving dead code accumulates fix-tax (every refactor in `09-admin/*.spec.ts` will trip over `safeGoto` imports and ask "why is this here?"). But the user should decide in the planning phase.
2. **Branch protection — does it currently list `E2E Tests (Evolution - firefox)` as a required check?** Cannot determine from this environment (PAT scope). User must verify in the GH UI before merging the workflow change, otherwise the PR will land but every subsequent stage merge will hang on a never-reporting check.
3. **Is there any short-term plan to bring Firefox back** (e.g., a customer issue specifically affecting Firefox users)? If yes, prefer minimal-flip + a tracking issue. If no, comprehensive cleanup is cleaner.
