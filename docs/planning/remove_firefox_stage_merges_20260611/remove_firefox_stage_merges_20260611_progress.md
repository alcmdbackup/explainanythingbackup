# Remove Firefox Stage Merges Progress

## Phase 1: CI workflow change
### Work Done
- `.github/workflows/ci.yml:557` matrix changed from `[chromium, firefox]` → `[chromium]`.
- Simplified the `e2e-evolution` run step (`:610-614`): dropped `${{ matrix.browser }}` interpolation and the stale double-flag comment; hardcoded `--project=chromium` while preserving `--grep-invert='@skip-prod'`. Job-name interpolation at `:540` and artifact-upload at `:619` left intact (stable unique names under single-row matrix, preserves room for future matrix expansion).
- Updated stale `max-parallel: 1` comment cluster (`:551-554`) to "preserved for future matrix additions"; kept the directive.

### Issues Encountered
- Original plan said to simplify `:610-614` to `npm run test:e2e:evolution`. Discovered mid-execution that the npm script (`playwright test --project=chromium --grep=@evolution`) **does not** include `--grep-invert='@skip-prod'`. A literal swap would have been a behavior regression — `@skip-prod` specs would have started running in CI staging. Resolved by keeping the inline command but hardcoding `chromium` instead of the matrix variable. Same simplification goal achieved without the regression.

### User Clarifications
- User chose "Execute Phases 1-3 now" at the /finalize entry-point AskUserQuestion (vs. shipping planning-only PR or aborting).

## Phase 2: Delete Firefox-only code
### Work Done
- Deleted `playwright.config.ts:157-165` (firefox project block).
- Deleted `src/lib/testing/safe-goto.ts` and `src/lib/testing/safe-goto.test.ts`; `rmdir`'d the now-empty `src/lib/testing/`.
- Removed `safeGoto` import + all 15 callsites across 7 specs (replaced with plain `page.goto`):
  - `09-admin/admin-evolution-variants.spec.ts` (1 call)
  - `09-admin/admin-evolution-navigation.spec.ts` (1 call)
  - `09-admin/admin-evolution-experiments-list.spec.ts` (1 call)
  - `09-admin/admin-evolution-judge-lab.spec.ts` (3 calls)
  - `09-admin/admin-evolution-judge-lab-test-sets.spec.ts` (4 calls)
  - `09-admin/admin-evolution-prompt-editor.spec.ts` (4 calls — these were defensive over-use on first-gotos, not chained nav)
  - `09-admin/admin-evolution-filter-consistency.spec.ts` (1 call)
- Verified zero `safeGoto`/`safe-goto` hits remain across `src/` and `evolution/`.
- Removed 3 `if (testInfo.project.name === 'firefox') test.slow();` blocks in `02-search-generate/search-generate.spec.ts`; also dropped the now-unused `testInfo` parameter from those 3 tests.
- Removed Firefox parenthetical at `09-admin/admin-strategy-wizard.spec.ts:279` (kept the broader Promise.all/URL-waiter race comment).
- Updated stale comment at `smoke.public.spec.ts:56` (nightly chromium/firefox → nightly chromium).
- Rewrote `EntityMetricsTab.tsx:137-140` comment to drop Firefox framing — now reads "Guards setState after unmount; server-action POST continues server-side." (matches the canonical phrasing at `AttributionCharts.tsx:44`).
- `abortableEffectController` kept — two production consumers remain (`EntityMetricsTab.tsx:143`, `AttributionCharts.tsx:45`).

### Issues Encountered
None. Phase 2 grep-verification clean.

### User Clarifications
None.

## Phase 3: Documentation updates
### Work Done
- `docs/docs_overall/environments.md`: nightly browser matrix `:275` → "Chromium"; redundant "(firefox dropped 2026-06-07…)" parenthetical at `:276` dropped; workflow-comparison CI column `:299` → "Chromium".
- `docs/docs_overall/testing_overview.md`: "Firefox-evolution PR matrix" paragraph at `:392` replaced with a one-line breadcrumb to this planning folder; nightly/browser entries at `:408, :436` → "Chromium".
- `docs/feature_deep_dives/testing_setup.md`: `safeGoto` section (`:340-353`) deleted; `abortableEffectController` section (`:369-380`) rewritten without Firefox framing; firefox row in Playwright Projects table (`:498`) deleted; nightly browsers (`:536`) → "Chromium"; "Firefox SSE" known-issue (`:719`) deleted.
- `docs/docs_overall/debugging.md`: NS_BINDING_ABORTED Firefox section (`:5-26`) deleted entirely.

### Issues Encountered
None. Final grep confirmed: 0 Firefox refs in environments.md / debugging.md / testing_setup.md, 1 intentional historical breadcrumb in testing_overview.md.

### User Clarifications
None.

## Phase 4: /finalize and PR
### Work Done
(to be populated by /finalize re-invocation)

### Issues Encountered
TBD

### User Clarifications
TBD
