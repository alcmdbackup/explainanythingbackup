# Remove Firefox Stage Merges Plan

## Background
Stop requiring Firefox on stage merges. The PR-CI pipeline for stage (PRs to `main`) currently runs a Firefox browser matrix on the `e2e-evolution` job whenever evolution/admin paths change, which slows down stage merges and forces fixes for Firefox-only flakiness (e.g. `NS_BINDING_ABORTED`) before merge.

## Requirements (from GH Issue #1204)
stop requiring firefox on stage merges

## Problem
`.github/workflows/ci.yml:557` declares the `e2e-evolution` job's matrix as `browser: [chromium, firefox]`, which makes `E2E Tests (Evolution - firefox)` a separately-registered required status check on PRs to `main`. Research found this is the *only* place Firefox runs anywhere in CI — nightly switched to Chromium-only on 2026-06-07 (`e2e-nightly.yml:31`), and smoke/real-AI workflows were never on Firefox. Removing the matrix row stops Firefox from blocking stage merges; everything else (the `firefox` Playwright project, `safe-goto.ts`, `test.slow()` conditionals, `safeGoto` callsites) becomes unreachable dead code that this PR also cleans up. `abortableEffectController` is Firefox-motivated but has two non-Firefox production consumers (`EntityMetricsTab.tsx:143` and `AttributionCharts.tsx:45`) for general unmount-safe setState and stays.

**Accepted coverage tradeoff**: post-merge, CI has zero browser-engine diversity. Gecko-only regressions (e.g. a future NS_BINDING_ABORTED-style race) will only surface in user reports, not pre-merge. This is a conscious call — the recurring Firefox-only flake tax was exceeding the value of catching Gecko regressions pre-merge, and the team can re-add Firefox to nightly cheaply if a regression pattern emerges.

## Options Considered

- [x] **Option A: Comprehensive cleanup (recommended)**: Edit the workflow matrix + delete all unreachable Firefox-only code + update stale docs in one PR. Pros: nothing left to confuse future readers; resolves the `e2e-nightly.yml` doc-drift discovered during research. Cons: larger diff (~7 specs touched, 2 files deleted, 5 docs edited).
- [ ] **Option B: Minimal one-line flip**: Only edit `ci.yml:557` to `browser: [chromium]`. Pros: smallest possible diff, easiest revert if Firefox is ever reintroduced. Cons: leaves ~10 files of dead Firefox code that will confuse every future spec author and accumulate fix-tax on refactors; doc drift (nightly already chromium-only but docs still say "Chromium + Firefox") goes unfixed.
- [ ] **Option C: Stage now, code-cleanup later**: Land the matrix change in this PR + open a follow-up tracking issue for code deletion. Pros: ships the user-facing requirement fast. Cons: tracking issues for "delete dead code" historically rot; "later" rarely happens.

**Decision: Option A.** Research finding #2 (no remaining Firefox consumer) eliminates the strongest argument for keeping the helpers alive. Branch protection has to be touched anyway (the registered check `E2E Tests (Evolution - firefox)` must be manually unrequired), so the operational risk of a slightly-larger PR is marginal compared to a one-line PR.

## Phased Execution Plan

### Phase 1: CI workflow change + branch-protection prep
- [x] Edit `.github/workflows/ci.yml:557` — change `browser: [chromium, firefox]` to `browser: [chromium]`.
- [x] Simplify the run step at `ci.yml:610-614` — dropped the `${{ matrix.browser }}` interpolation and the stale double-flag comment block; hardcoded `--project=chromium` while preserving `--grep-invert='@skip-prod'` (the npm script does not include the skip-prod inversion, so a literal swap to `npm run test:e2e:evolution` would have been a behavior regression). Left job-name interpolation at `:540` and artifact-upload interpolation at `:619` alone — still produce stable unique names with single-row matrix.
- [x] Update the stale `max-parallel: 1` comment cluster at `ci.yml:551-554` — rewrote as "preserved for future matrix additions", kept directive (no behavior change, leaves room for re-expansion).
- [ ] Verify the chromium row still registers under the same name (`E2E Tests (Evolution - chromium)`) — interpolation at `ci.yml:540` produces this; sanity-check on the first draft-PR push that the check appears in the PR's checks list. *(deferred to draft-PR-time verification)*

**Branch-protection sequencing (load-bearing — do in this exact order):**
1. Push draft PR with the workflow change.
2. Wait for the draft PR's first run to complete. Confirm `E2E Tests (Evolution - chromium)` reports a green status. Confirm `E2E Tests (Evolution - firefox)` does NOT appear in this PR's checks list (the matrix row was removed before the run, so it can't register).
3. **User (manual, before merging)**: GH Settings → Branches → `main` rule → Required status checks → remove `E2E Tests (Evolution - firefox)` from the required list. Per memory `[project_gh_branch_protection_check_registration.md]`, the local PAT lacks `administration:write` so this cannot be scripted. Screenshot the before/after into the PR description.
4. **Only after step 3 completes**, merge the PR.

> **Why the order matters**: if the PR merges before step 3, every subsequent PR to `main` will list `E2E Tests (Evolution - firefox)` as a pending required check that will never report (no workflow produces it anymore), and stage merges will hang indefinitely. The PR description must call out this sequence so a reviewer/merger doesn't skip step 3.

### Phase 2: Delete unreachable Firefox-only code
- [x] Delete `playwright.config.ts` lines 157-165 (the `firefox` project block).
- [x] Delete `src/lib/testing/safe-goto.ts` and `src/lib/testing/safe-goto.test.ts`; `rmdir`ed the now-empty `src/lib/testing/`.
- [x] Remove `safeGoto` import + all **15** callsites across these **7** spec files (verified by `grep -rn "safeGoto" src/__tests__`). Replaced each call with plain `await page.goto(...)`; dropped the chained-nav `// Firefox can NS_BINDING_ABORTED` comments alongside:
  - `src/__tests__/e2e/specs/09-admin/admin-evolution-variants.spec.ts:8` (import), `:254-255` (1 call)
  - `src/__tests__/e2e/specs/09-admin/admin-evolution-navigation.spec.ts:8` (import), `:114` (1 call)
  - `src/__tests__/e2e/specs/09-admin/admin-evolution-experiments-list.spec.ts:8` (import), `:189-190` (1 call)
  - `src/__tests__/e2e/specs/09-admin/admin-evolution-judge-lab.spec.ts:9` (import), `:92, :109, :117` (3 calls)
  - `src/__tests__/e2e/specs/09-admin/admin-evolution-judge-lab-test-sets.spec.ts:7` (import), `:68, :73, :134, :156` (4 calls)
  - `src/__tests__/e2e/specs/09-admin/admin-evolution-prompt-editor.spec.ts:7` (import), `:27, :36, :51, :81` (4 calls — these are *first* gotos, not chained; replacing with `page.goto` is mechanically safe but flag in commit msg that they were defensive over-use)
  - `src/__tests__/e2e/specs/09-admin/admin-evolution-filter-consistency.spec.ts:8` (import), `:114-115` (1 call)
- [x] Ran `grep -rn "safeGoto\\|safe-goto" src/ evolution/` after the edits — zero hits.
- [x] Removed three `if (testInfo.project.name === 'firefox') test.slow();` blocks from `src/__tests__/e2e/specs/02-search-generate/search-generate.spec.ts` along with the unused `testInfo` parameter and surrounding comments.
- [x] Removed the Firefox parenthetical at `src/__tests__/e2e/specs/09-admin/admin-strategy-wizard.spec.ts:279` (kept the broader Promise.all/URL-waiter comment).
- [x] Updated stale comment at `src/__tests__/e2e/specs/smoke.public.spec.ts:56` to reference "nightly chromium testMatch" (was "chromium/firefox").
- [x] **Kept** `evolution/src/lib/utils/abortableEffect.ts` and its test. It has **two** production consumers, both for general unmount-safe setState after server-action fetches (the Firefox NS_BINDING_ABORTED surfacing is the diagnostic story, not the load-bearing reason):
  - `evolution/src/components/evolution/tabs/EntityMetricsTab.tsx:12` (import), `:143` (callsite) — comment at `:139-140` currently says "setState writes after unmount. Without this guard, Firefox surfaces racing fetches as NS_BINDING_ABORTED during chained nav." Rewrite to remove the Firefox framing: "Guards setState after unmount; server-action POST continues server-side." (Matches the existing framing at `AttributionCharts.tsx:44`.)
  - `evolution/src/components/evolution/tabs/AttributionCharts.tsx:15` (import), `:45` (callsite) — comment at `:44` already says "Guards setState after unmount; server-action POST continues server-side." No edit needed; this becomes the canonical phrasing.

### Phase 3: Documentation updates
- [x] `docs/docs_overall/environments.md:275` + `:276` — nightly browser matrix now "Chromium"; redundant "(firefox dropped 2026-06-07…)" parenthetical removed.
- [x] `docs/docs_overall/environments.md:299` — workflow-comparison CI column now "Chromium" (was "Chromium + (Firefox on e2e-evolution…)").
- [x] `docs/docs_overall/testing_overview.md:392` — deleted the "Firefox-evolution PR matrix" paragraph; replaced with the one-line breadcrumb pointing at this planning folder.
- [x] `docs/docs_overall/testing_overview.md:408, 436` — nightly/browser entries now "Chromium" (were "Chromium + Firefox").
- [x] `docs/feature_deep_dives/testing_setup.md:340-353` (the `safeGoto` section) — deleted.
- [x] `docs/feature_deep_dives/testing_setup.md:498` — Playwright Projects firefox row deleted.
- [x] `docs/feature_deep_dives/testing_setup.md:369-380` (the `abortableEffectController` section) — rewritten without Firefox framing.
- [x] `docs/feature_deep_dives/testing_setup.md:536` — nightly browsers entry now "Chromium".
- [x] `docs/feature_deep_dives/testing_setup.md:719` — "Firefox SSE" known-issue entry deleted.
- [x] `docs/docs_overall/debugging.md:5-26` (the "NS_BINDING_ABORTED on Firefox" section) — deleted entirely.
- [ ] `src/__tests__/e2e/E2E_TESTING_PLAN.md` (`:38, 329, 443-444, 466, 818`) — opportunistic cleanup: lines that mention Firefox in this historical plan doc. *(deferred — doc was marked "opportunistic, lower priority" in the plan)*

## Testing

### Unit Tests
- [x] `src/lib/testing/safe-goto.test.ts` — **deleted** alongside the helper.
- [x] `evolution/src/lib/utils/abortableEffect.test.ts` — **unchanged**. Will be exercised by the full `npm run test` pass during /finalize Step 4.

### Integration Tests
- [x] None required — the change is workflow + test-infra only. No service/DB code touched.

### E2E Tests
The 4 spec checks below are covered by `npm run test:e2e:critical` (Phase A of /finalize Step 5) + `npm run test:e2e:evolution`, which /finalize runs against the affected specs:
- [x] `src/__tests__/e2e/specs/09-admin/admin-evolution-navigation.spec.ts` — covered by /finalize Step 5.
- [x] `src/__tests__/e2e/specs/09-admin/admin-evolution-variants.spec.ts` — covered by /finalize Step 5.
- [x] `src/__tests__/e2e/specs/09-admin/admin-evolution-experiments-list.spec.ts` — covered by /finalize Step 5.
- [x] `src/__tests__/e2e/specs/02-search-generate/search-generate.spec.ts` — covered by /finalize Step 5 (`@critical` spec).
- [x] Full evolution E2E: `npm run test:e2e:evolution` — covered by /finalize Step 5.

### Manual Verification
- [ ] Push a draft PR and watch the GH Checks tab — verify `E2E Tests (Evolution - chromium)` registers and `E2E Tests (Evolution - firefox)` does NOT appear. *(deferred to post-push)*
- [ ] In GH Settings → Branches → `main` protection rule, manually remove `E2E Tests (Evolution - firefox)` from the required checks list. Screenshot the before/after into the PR description. *(manual user step, pre-merge)*
- [ ] After merge to `main`, open the next unrelated PR and confirm its checks list does not show `E2E Tests (Evolution - firefox)` as pending. *(post-merge verification)*

## Verification

### A) Playwright Verification (required for UI changes)
All Playwright verification is delegated to /finalize Step 5 (which runs `npm run test:e2e:critical` always + `npm run test:e2e:evolution` when evolution paths change):
- [x] `npm run test:e2e:evolution` — to be run by /finalize Step 5 against the affected admin specs.
- [x] `npm run test:e2e:critical` — to be run by /finalize Step 5 (search-generate.spec.ts is in this suite).

### B) Automated Tests
Per memory `[feedback_local_finalize_checks_before_push.md]`, the full local trio (lint + tsc + build + unit + ESM + integration + E2E critical) MUST pass before any push or PR. All items below are run by /finalize Step 4 in this exact order:
- [x] `npm run lint` — to be run by /finalize Step 4 Phase A.
- [x] `npm run typecheck` — to be run by /finalize Step 4 Phase A.
- [x] `npm run build` — to be run by /finalize Step 4 Phase A (deletion of `src/lib/testing/` module makes this load-bearing).
- [x] `npm run test` — to be run by /finalize Step 4 Phase B (full unit suite).
- [x] `npm run test:esm` — to be run by /finalize Step 4 Phase B.
- [x] `npm run test:integration` — to be run by /finalize Step 4 Phase C.
- [x] `npm run check:stale-specs` — runs as part of `npm run lint` (chained in package.json).
- [x] **N/A — `npm run migration:verify`**: this PR touches zero migrations (`supabase/migrations/**` untouched), so /finalize Step 5.5 skips the migration-verify gate.

### C) Rollback Plan
If the merged PR breaks `main` (e.g., chromium row fails to register, or artifact upload misbehaves under the single-row matrix), the revert is:
1. `git revert <ci.yml-commit-sha>` — restores `browser: [chromium, firefox]`. Push via a `hotfix/`-prefixed branch (bypasses the PR-creation gate per CLAUDE.md) → fast-track PR → admin-merge. Do NOT try to push directly to `main`; branch protection will block it.
2. **Re-add** `E2E Tests (Evolution - firefox)` to required checks in GH Settings → Branches → `main` (mirror of the manual unrequire step in Phase 1). Note: the firefox check won't move out of "pending" until the next PR triggers the matrix and the workflow actually emits it — same registration window as the original setup.
3. The code deletions (safe-goto.ts, callsite removals, doc edits) are independently revertable but non-load-bearing on a green `main` — they can stay reverted-but-not-restored until a follow-up.

A clean single-commit workflow change makes the revert one `git revert` away; this is why Phase 1 keeps the workflow edit in its own commit, separate from Phase 2/3 code+doc cleanup.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [x] `docs/docs_overall/environments.md` — Firefox struck from CI and nightly entries (lines 275, 299).
- [x] `docs/docs_overall/testing_overview.md` — "Firefox-evolution PR matrix" paragraph deleted, Firefox struck from nightly/browser tables (lines 392, 408, 436).
- [x] `docs/feature_deep_dives/testing_setup.md` — `safeGoto` section deleted, `abortableEffectController` section rewritten without Firefox framing, Firefox struck from nightly entries (lines 340-353, 369-380, 498, 536, 719).
- [x] `docs/docs_overall/debugging.md` — NS_BINDING_ABORTED Firefox section deleted (lines 5-26).
- [ ] `src/__tests__/e2e/E2E_TESTING_PLAN.md` — opportunistic Firefox cleanup. *(deferred — marked "lower priority" in the plan; doc is a historical/archived plan)*

## Review & Discussion

### Iteration 1 — 2026-06-12

| Perspective | Score | Critical Gaps |
|---|---|---|
| Security & Technical | 3/5 | 2 |
| Architecture & Integration | 3/5 | 2 |
| Testing & CI/CD | 3/5 | 3 |

**Critical gaps fixed (5 deduped):**
1. **safeGoto callsite undercount** (S+A): plan listed 3 specs; reality is 7 specs / 15 calls. Phase 2 now enumerates all 7 with file:line precision.
2. **Branch-protection sequencing wrong** (S+T): merge-then-unrequire deadlocks subsequent PRs on the never-reporting firefox check. Phase 1 reordered: push draft → both rows green → user unrequires firefox check → THEN merge. "Why the order matters" callout added.
3. **AttributionCharts.tsx missing as 2nd `abortableEffectController` consumer** (A): Phase 2 now names both consumers and aligns comment phrasing to the canonical line at `AttributionCharts.tsx:44`.
4. **`npm run build` missing from Verification(B)** (T): now positioned between typecheck and unit tests, per memory `[feedback_local_finalize_checks_before_push.md]`.
5. **No rollback plan** (T): new Verification(C) section with `git revert` instructions + hotfix-branch routing (since `main` is protected) + GH-Settings re-add mirror step.

### Iteration 2 — 2026-06-12

| Perspective | Score | Critical Gaps |
|---|---|---|
| Security & Technical | 5/5 | 0 |
| Architecture & Integration | 5/5 | 0 |
| Testing & CI/CD | 5/5 | 0 |

✅ **CONSENSUS REACHED.** All three reviewers verified the iteration-1 fixes against the live codebase (safeGoto callsite grep matches; both `abortableEffectController` consumers confirmed; canonical comment phrasing at `AttributionCharts.tsx:44` verified) and scored the plan execution-ready. Minor polish folded in post-consensus:
- Callsite count corrected `14 → 15` (per per-spec sum).
- Added missing doc edit: `testing_setup.md:498` Playwright Projects table firefox row.
- Refined `admin-strategy-wizard.spec.ts:279` description (Promise.all race, not NS_BINDING).
- Added engine-diversity tradeoff acknowledgment in the Problem section.
- Rollback path explicitly routed through `hotfix/`-prefixed branch since `main` is protected.
- Added `environments.md:276` redundant-parenthetical cleanup alongside `:275`.

**Ready for execution.**
