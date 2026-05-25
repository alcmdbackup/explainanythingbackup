// Progress log for the light_design_changes_explain_anything_20260524 project — phase-by-phase work record, issues encountered, and user clarifications.

# light_design_changes_explain_anything_20260524 Progress

## Phase 1: Button-alignment fix — DONE (2026-05-24)
### Work Done
- Added `className?: string` prop to `ReportContentButtonProps` in `src/components/ReportContentButton.tsx`.
- Extracted button's long className to a `BASE_BUTTON_CLASSES` const; root button now renders `className={`${BASE_BUTTON_CLASSES} ${className ?? ''}`.trim()}` (merge, not replace).
- Removed the `ReportContentButton` JSX from inside the `flex flex-wrap gap-2` left group on `src/app/results/page.tsx`.
- Re-inserted it as the first child of the right-side cluster (`flex items-center gap-2`) with `className="hidden sm:inline-flex"` so it's hidden on `<sm` viewports.
- `data-testid="report-content-button"` preserved.
- Added 2 unit tests to `src/components/ReportContentButton.test.tsx` (baseline-classes preserved with no className; merge works when className passed).

### Issues Encountered
- None. All 16 ReportContentButton tests pass.

### User Clarifications
- Input screenshot is `input_files/misaligned_buttons.png` (file, not a folder).

## Phase 2: Editor-panel variant infrastructure — DONE (2026-05-24)
### Work Done
- Created `src/components/editor-panel-variants.ts` exporting `EditorPanelVariant`, `EDITOR_PANEL_VARIANTS`, `DEFAULT_EDITOR_PANEL_VARIANT`, and `resolveEditorPanelVariant`.
- Resolver uses `Object.prototype.hasOwnProperty.call(EDITOR_PANEL_VARIANTS, raw)` to defeat Object.prototype-key attacks (`toString`, `__proto__`, etc.).
- Dev-only `console.warn` fires for unknown non-empty strings (gated by `process.env.NODE_ENV !== 'production'`).
- Added `.vellum-editor` CSS rule (light + dark) to `src/app/globals.css`, placed right after the `.dark .gallery-card:hover` rule.
- Wrote `src/components/editor-panel-variants.test.ts` — 23 tests covering: every value is non-empty + has a `p-*` padding token; DEFAULT is a valid key; round-trip resolution for all 5 keys; null/undefined/'' fallback; unknown string fallback; **6 Object.prototype-key attack inputs** (`toString`, `__proto__`, `hasOwnProperty`, `constructor`, `valueOf`, `isPrototypeOf`); console.warn discrimination (fires for unknown strings, NOT for null/undefined/''/valid).

### Issues Encountered
- Initial code included an `// eslint-disable-next-line no-console` directive that lint flagged as unused (no-console isn't enabled in this project). Removed it.

### User Clarifications
- None.

## Phase 3: Wire URL param on results page — DONE (2026-05-24)
### Work Done
- Imported `EDITOR_PANEL_VARIANTS` and `resolveEditorPanelVariant` from the new module in `src/app/results/page.tsx`.
- Inside `ResultsPageContent()`, added 2 lines that read `searchParams.get('editorVariant')`, resolve it, and look up the className.
- Replaced the editor wrapper className at line ~1406 (was `scholar-card p-6 atlas-animate-fade-up stagger-5`) with `${editorPanelClass} atlas-animate-fade-up stagger-5`.
- All `data-testid="explanation-content"` preserved.
- 37 page.test.tsx tests still pass.

### Issues Encountered
- None.

### User Clarifications
- User will A/B test the variations after deploy by visiting `?editorVariant=parchment|embossed|vellum|bracketed` and then tell me which becomes the new `DEFAULT_EDITOR_PANEL_VARIANT`.

## E2E Coverage — DONE (2026-05-24)
### Work Done
- Created `src/__tests__/e2e/specs/04-content-viewing/editor-panel-variants.spec.ts` with 5 `@critical` tests:
  - 3 URL-param tests (parchment renders paper-texture; garbage falls back to default; toString attack does NOT produce className="undefined").
  - 2 viewport tests (375px → flag hidden; 1280px → flag visible).
- Used existing `authenticatedPage` fixture from `src/__tests__/e2e/fixtures/auth` and `ResultsPage` POM for `waitForStreamingComplete`.
- Set viewport BEFORE `goto` to avoid layout shift during streaming.

### Issues Encountered
- **First E2E run silent death.** Initial `npm run test:e2e:critical` returned via the harness's background-task wrapper but produced 0 bytes of output and never triggered a completion notification. Re-running explicitly with `tee`-to-log produced visible output and revealed the real bugs below. Suspect an early process hand-off issue when the harness auto-backgrounded a long-running command. Not a code bug.
- **Display-property conflict on flag button (FIXED).** The `hidden sm:inline-flex` className passed to `ReportContentButton` was being overridden by the `inline-flex` baked into `BASE_BUTTON_CLASSES` — Tailwind generates both as `display: …` rules and CSS source order made `inline-flex` win, leaving the button visible at 375px. Fix: wrap the `<ReportContentButton>` JSX in `<span className="hidden sm:inline-flex">…</span>` in `src/app/results/page.tsx` so the display chain is unambiguous (span controls visibility, button keeps its own `inline-flex` for icon layout). The `className?` prop on `ReportContentButton` stays — it's still a generally useful API and the existing 2 forwarding tests are still valid — but for this specific use case the wrapper is the correct primitive.

### User Clarifications
- None.

## Verification — DONE (2026-05-24)
### Local checks (all green)
- `npm run lint` — 0 errors. Pre-existing warnings on unrelated files (no-tailwind-color-classes on test/debug components, unused eslint-disable directives in llms.test.ts).
- `npm run test:eslint-rules` — all 14 rule unit suites pass.
- `npm run typecheck` — clean.
- `npm run build` — exit 0. (PageNotFoundError on `/_document` in collect-page-data is a benign App Router quirk.)
- `npx jest` (full unit suite) — 6666 passed, 16 skipped, 384 of 385 suites pass.
- `npm run test:e2e:critical -- editor-panel-variants.spec.ts` — **5/5 pass in 26.6s** (after the wrapper-span fix above).
- `npm run test:esm` — 156/156 pass.

### Out-of-scope warnings (pre-existing)
- The Playwright global-teardown Step 6b logs an ESM import error from `src/__tests__/e2e/helpers/evolution-test-data-factory.ts` (`Cannot use import statement outside a module`). The teardown still completes (`✅ E2E Global Teardown: Complete`) and exit code stays 0. Not introduced by this PR — same error appears in unrelated tests. Should be tracked as a separate cleanup ticket.

### Manual verification (deferred to user)
- User picks variant by A/B'ing `?editorVariant=parchment|embossed|vellum|bracketed`, then I update `DEFAULT_EDITOR_PANEL_VARIANT` accordingly (single-line change, separate commit).
- Documentation updates (`design_style_guide.md`, `lexical_editor_plugins.md`) deferred until variant choice is made.

## Scope Addition: AI Editor Panel Variants — DONE (2026-05-24)
### Work Done
User asked for **6 single-block variants of the AI Editor Panel** (right-side sidebar), with URL-param selection on top of the existing localStorage `PanelVariantContext`. This is an additive scope expansion to the original "light design changes" — same branch, separate commit.

- Refactored `src/components/ai-panel-variants.ts`:
  - Kept the legacy `lined-paper` variant unchanged (preserves user localStorage prefs).
  - Added a `makeOneBlockVariant({...})` helper that produces a full 18-slot `PanelVariantConfig` from a small override object — keeps each new variant declaration to ~10 lines of distinctive styling instead of duplicating ~50 lines of shared slots.
  - Added 6 new one-block variants:
    | Key | Identity |
    |---|---|
    | `parchment` | paper-texture + warm shadow + copper-accent icon |
    | `vellum` | frosted glassmorphism (backdrop blur 8px) |
    | `focused-minimal` | 3px gold left edge, outline submit button |
    | `embossed` | `surface-elevated` + `shadow-page` recessed feel |
    | `ink-stamped` | paper-texture + dark monochrome submit button |
    | `gilded-edge` | refined gold→copper right-edge gradient |
  - Added `resolvePanelVariant(raw)` using `Object.prototype.hasOwnProperty.call` (rejects `toString`/`__proto__`/etc. attack inputs and produces dev-only `console.warn`).
- Updated `src/contexts/PanelVariantContext.tsx`:
  - Now resolves variant as **URL `?panelVariant=…` → localStorage → default** (URL wins).
  - Replaced the existing `stored in PANEL_VARIANTS` localStorage check with `hasOwnProperty.call` (the same out-of-scope follow-up flagged during plan review iteration 2 — fixed inline since we were touching the file).
  - Uses `useSearchParams` (page already runs under Suspense so no hydration issues).
- Added 3 small CSS classes to `src/app/globals.css`:
  - `.vellum-panel` — translucent + backdrop blur (side-panel sibling of `.vellum-editor`).
  - `.focused-minimal-panel` — 3px gold left edge.
  - `.gilded-edge-panel` — pseudo-element gold→copper gradient right edge.
- Wrote `src/components/ai-panel-variants.test.ts` — 31 tests covering registry integrity (every slot non-empty per variant, IDs match keys, exactly 7 variants, legacy keeps gold banner, new ones do NOT have colored headers), `resolvePanelVariant` round-trip + null/undefined/empty/unknown fallback + 6 Object.prototype attack inputs, and console.warn discrimination.
- Wrote `src/__tests__/e2e/specs/04-content-viewing/ai-panel-variants.spec.ts` — 4 `@critical` tests covering URL-param wiring (parchment, vellum, garbage→default, toString attack→default).

### Issues Encountered
- None on implementation. Lint, typecheck, and unit tests all clean.

### User Clarifications
- 6 variants total (user picked from 2/3/4 options — answered "6 directions").
- Each must be a single cohesive block — no colored header banner like the legacy `lined-paper`.
- URL param + localStorage fallback (not URL-only — preserves existing per-user preference).
- Existing `lined-paper` stays for backward-compat; not deleted.

### Variant URLs (for live A/B)
```
http://localhost:3485/results?explanation_id=<YOUR_ID>                              # default = lined-paper (legacy)
http://localhost:3485/results?explanation_id=<YOUR_ID>&panelVariant=parchment
http://localhost:3485/results?explanation_id=<YOUR_ID>&panelVariant=vellum
http://localhost:3485/results?explanation_id=<YOUR_ID>&panelVariant=focused-minimal
http://localhost:3485/results?explanation_id=<YOUR_ID>&panelVariant=embossed
http://localhost:3485/results?explanation_id=<YOUR_ID>&panelVariant=ink-stamped
http://localhost:3485/results?explanation_id=<YOUR_ID>&panelVariant=gilded-edge
```
Combine with editorVariant for paired styling: `?editorVariant=parchment&panelVariant=parchment`.

## User-Requested Design Tweaks — DONE (2026-05-25)
After live A/B'ing the variants on another machine, user requested:
1. **Set `embossed` as default for both `editorVariant` AND `panelVariant`.** Done — `DEFAULT_EDITOR_PANEL_VARIANT` and `DEFAULT_PANEL_VARIANT` both reassigned. `lined-paper` is still available at `?panelVariant=lined-paper` for backward compat.
2. **Move flag/report button back inline next to Edit** (was hidden on mobile + right-aligned next to MODE). Reverted the `<span className="hidden sm:inline-flex">` wrapper; flag now renders immediately after the Edit button inside the primary action group at all viewports.
3. **Fix invisible "Mode:" / "Suggest" / "Rewrite" text in the OutputModeToggle.** Root cause: toggle hardcoded `text-[var(--text-on-primary)]` (white) and `border-white/30 bg-white/15` — designed only for the legacy `lined-paper` gold-banner header. On every one-block variant the header has the body background, so white text/borders became invisible. Switched to body-aware tokens: `text-[var(--text-secondary)]` for the "Mode:" label and inactive buttons, `text-[var(--text-primary)]` on hover, `border-[var(--border-default)]` + `bg-[var(--surface-secondary)]/40` for the container, `ring-[var(--accent-gold)]/30` for focus. Active button kept its inverted `bg-text-primary text-background` (already contrast-safe everywhere).
4. **Remove QuillIcon in front of "Suggest edits"/"Rewrite article" + bump header font size.** Deleted the `<QuillIcon>` JSX from `AIEditorPanel.tsx` and the now-unused `QuillIcon` SVG component definition. Bumped `headerTitle` from `text-xl` → `text-3xl` in every variant config (both legacy `linedPaper` and the `makeOneBlockVariant` shared default).

### Test updates
- `editor-panel-variants.spec.ts`: dropped the "ReportContentButton — responsive visibility" describe block (375px / 1280px viewport tests) — flag is now visible at all viewports, so those assertions don't apply. Updated the `garbage` fallback assertion: default is now `embossed` (`bg-[var(--surface-elevated)]` + `shadow-page`) not `scholar-card`.
- `ai-panel-variants.spec.ts`: updated `garbage` and `toString` fallback assertions to expect the new `embossed` default (`shadow-page`) instead of legacy `lined-paper`.
- `ai-panel-variants.test.ts` registry tests unchanged — `linedPaper` still has its gold banner (the test asserts that as a backward-compat check); the new variants still satisfy the "no colored header" constraint.

### Files Touched (tweaks turn)
- `src/components/editor-panel-variants.ts` (DEFAULT → embossed)
- `src/components/ai-panel-variants.ts` (DEFAULT → embossed, headerTitle text-3xl in both legacy + makeOneBlockVariant)
- `src/components/AIEditorPanel.tsx` (removed QuillIcon JSX + definition)
- `src/components/OutputModeToggle.tsx` (body-aware tokens replace text-on-primary/white)
- `src/app/results/page.tsx` (flag button back inline after Edit)
- `src/__tests__/e2e/specs/04-content-viewing/editor-panel-variants.spec.ts` (dropped viewport tests, updated default-fallback assertion)
- `src/__tests__/e2e/specs/04-content-viewing/ai-panel-variants.spec.ts` (updated default-fallback assertions to embossed)

## Files Touched
| File | Change |
|------|--------|
| `src/components/ReportContentButton.tsx` | + `className?` prop + `BASE_BUTTON_CLASSES` const + merge in className |
| `src/components/ReportContentButton.test.tsx` | + 2 className-forwarding tests |
| `src/app/results/page.tsx` | imports + 2-line variant resolution + moved flag JSX + wrapper className |
| `src/components/editor-panel-variants.ts` | NEW — variant registry + resolver |
| `src/components/editor-panel-variants.test.ts` | NEW — 23 tests |
| `src/app/globals.css` | + `.vellum-editor` rule (16 lines, light + dark) |
| `src/__tests__/e2e/specs/04-content-viewing/editor-panel-variants.spec.ts` | NEW — 5 `@critical` tests |
| `src/components/ai-panel-variants.ts` | refactored + 6 new variants + resolver |
| `src/components/ai-panel-variants.test.ts` | NEW — 31 tests |
| `src/contexts/PanelVariantContext.tsx` | URL > localStorage > default + hasOwnProperty guard |
| `src/app/globals.css` | + `.vellum-panel`, `.focused-minimal-panel`, `.gilded-edge-panel` |
| `src/__tests__/e2e/specs/04-content-viewing/ai-panel-variants.spec.ts` | NEW — 4 `@critical` tests |
