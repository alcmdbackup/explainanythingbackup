// Planning doc for the light_design_changes_explain_anything_20260524 project — concrete, executable plan to (a) fix a misaligned flag button on the results page and (b) ship 4 URL-selectable editor-panel variations so the user can A/B pick a final default.

# light_design_changes_explain_anything_20260524 Plan

## Background
Light visual-design pass on ExplainAnything. Two scoped, low-risk UI changes on the explanation results/edit page (`src/app/results/page.tsx`):
1. The flag / Report-Content button (`ReportContentButton`) wraps to a second row by itself because it sits inside the 7-item primary-action flex group. See `input_files/misaligned_buttons.png` and research doc §F1.
2. The editor-panel wrapper (`<div className="scholar-card p-6">` at line ~1401) is visually plain. Ship 4 single-block variations selectable via `?editorVariant=…` URL param so the user can A/B and pick a new default.

Full research: `light_design_changes_explain_anything_20260524_research.md`.

## Requirements (from user)
- Fix the misaligned buttons shown in `input_files/misaligned_buttons.png`.
- Generate a few variations to make the editor panel look better.
- Variations must be one cohesive block (no internal title section with different color, no top gradient bar, no internal flourish-divider).
- Variation selection via URL parameter.

## Problem
- **Button**: 7 items packed into one `flex flex-wrap gap-2` group (`src/app/results/page.tsx:1176`); 7th (flag) wraps alone on common widths. Looks unintentional.
- **Editor panel**: Current `.scholar-card p-6` is restrained to the point of feeling unfinished. The design system already ships richer single-block treatments (`paper-texture`, `card-enhanced`, `shadow-page`, glassmorphism) we can apply without inventing primitives.

## Resolved Decisions (research §Resolved)
- Mobile: hide flag button on `<sm` via `hidden sm:inline-flex`.
- Scope: button fix + editor-panel variations only.
- All required RGB CSS variables exist (`globals.css:67-68` light, `:176-177` dark).
- After user A/B-tests variations, `EDITOR_PANEL_VARIANTS.default` is updated to the chosen treatment (URL param becomes opt-out).

## Options Considered

### Button-fix options
- [x] **Option A — Move flag to right cluster (CHOSEN)**: Move `ReportContentButton` out of the 6-button primary group and into the right-side cluster next to the MODE dropdown. Add `className="hidden sm:inline-flex"`. Add a `className` prop to `ReportContentButton` so it can be styled by parents. *Best semantic match (flag = secondary utility, like Mode), works at every breakpoint by design, preserves every data-testid.*
- [ ] **Option B — Border separator in-place**: Leave flag in group; add `border-l border-[var(--border-default)] pl-2`. Rejected: separator only "makes sense" when flag wraps; on wide screens it looks accidental.
- [ ] **Option C — Overflow 3-dot menu**: Rejected: introduces a new component pattern not used elsewhere; overkill for one button.

### Editor-panel architecture
- [x] **Extract variant map to its own module (CHOSEN)**: New file `src/components/editor-panel-variants.ts` exports `EDITOR_PANEL_VARIANTS: Record<EditorPanelVariant, string>` and `DEFAULT_EDITOR_PANEL_VARIANT`. **Lite variant of the `src/components/ai-panel-variants.ts` pattern** — that module exports `Record<Variant, PanelVariantConfig>` of structured multi-slot config objects (container, header, textarea, etc.); ours is a single-slot map of raw className strings because the explanation-editor wrapper is a single div, not a multi-slot panel. Naming intentionally disambiguates from the existing `PANEL_VARIANTS` (which targets `AIEditorPanel`).
- [ ] **Inline in page.tsx**: Rejected: pollutes a 1600-line file; harder to find/extend.
- [ ] **Widen existing `PanelVariantContext`**: Rejected: that context is localStorage-persisted and is for the AI editor panel (different concern). Mixing would conflate two unrelated variant systems.

## Phased Execution Plan

### Phase 1: Button-alignment fix
- [x] Add `className?: string` prop to `ReportContentButton` interface in `src/components/ReportContentButton.tsx`. **Merge, don't replace** the existing button className — use `className={`${BASE_CLASSES} ${className ?? ''}`.trim()}` pattern so the baseline flag-button styling (`rounded-page`, `bg-[var(--surface-secondary)]`, `h-9`, etc.) is preserved when callers pass extra classes. Preserve `data-testid="report-content-button"`.
- [x] In `src/app/results/page.tsx` around lines 1317-1322: remove the `<ReportContentButton …/>` block from inside the `<div className="flex flex-wrap gap-2">` group (lines 1176-1323).
- [x] In the right-side container at `src/app/results/page.tsx:1326` (`<div className="flex items-center gap-2">`), insert the flag button BEFORE the `<label htmlFor="mode-select">` element, wrapped in `<span className="hidden sm:inline-flex">` for responsive visibility. **Implementation note**: originally passed `className="hidden sm:inline-flex"` directly via the new prop, but E2E proved `inline-flex` in `BASE_BUTTON_CLASSES` overrode `hidden` (CSS source-order conflict on the `display` property). Wrapping in a `<span>` makes the display chain unambiguous. The `className?` prop on `ReportContentButton` is kept (still a generally useful API; unit tests for the forwarding behavior remain valid).
- [ ] **(deferred to user)** Manually verify in browser at widths 360px / 640px / 768px / 1024px / 1440px in both light and dark mode that no button wraps alone and that the flag is reachable on ≥640px. Pay attention to the right cluster at 640-768px where 3 items (flag + Mode label + select) now share a row that previously held 2 items — confirm `gap-2` reads as intentional, not crowded.
- [x] Targeted E2E coverage: new `@critical` spec `editor-panel-variants.spec.ts` covers viewport behavior; existing `action-buttons.spec.ts` and `report-content.spec.ts` confirmed safe (data-testid-only selectors).

### Phase 2: Editor-panel variant infrastructure
- [x] Create `src/components/editor-panel-variants.ts`:
  ```typescript
  export type EditorPanelVariant = 'default' | 'parchment' | 'embossed' | 'vellum' | 'bracketed';

  export const EDITOR_PANEL_VARIANTS: Record<EditorPanelVariant, string> = {
    default:   'scholar-card p-6',
    parchment: 'scholar-card paper-texture shadow-warm-lg p-6',
    embossed:  'bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-6 shadow-page',
    vellum:    'vellum-editor rounded-book p-6 shadow-warm-md',
    bracketed: 'scholar-card card-enhanced p-8 shadow-warm-lg',
  };

  export const DEFAULT_EDITOR_PANEL_VARIANT: EditorPanelVariant = 'default';

  export function resolveEditorPanelVariant(raw: string | null | undefined): EditorPanelVariant {
    // Defensive: avoid `raw in EDITOR_PANEL_VARIANTS` because the `in` operator
    // also matches inherited Object.prototype keys (toString, __proto__, etc.),
    // which would let ?editorVariant=toString slip past the whitelist and
    // produce className="undefined …". Use hasOwnProperty.call instead.
    if (raw && Object.prototype.hasOwnProperty.call(EDITOR_PANEL_VARIANTS, raw)) {
      return raw as EditorPanelVariant;
    }
    if (raw && process.env.NODE_ENV !== 'production' && typeof console !== 'undefined') {
      // Aid A/B testing — silent fallback hides typos. Dev-only to avoid prod console noise.
      console.warn(`[editor-panel-variants] Unknown editorVariant="${raw}"; using ${DEFAULT_EDITOR_PANEL_VARIANT}.`);
    }
    return DEFAULT_EDITOR_PANEL_VARIANT;
  }
  ```
- [x] Add `.vellum-editor` CSS to `src/app/globals.css` (~16 lines, light + dark):
  ```css
  .vellum-editor {
    background: rgba(var(--surface-secondary-rgb), 0.85);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: 1px solid rgba(var(--border-default-rgb), 0.6);
    box-shadow:
      0 1px 3px rgba(var(--accent-copper-rgb), 0.08),
      inset 0 1px 0 rgba(255, 255, 255, 0.4);
    transition: box-shadow 0.2s ease-out;
  }
  .dark .vellum-editor {
    background: rgba(var(--surface-secondary-rgb), 0.8);
    box-shadow:
      0 1px 3px rgba(0, 0, 0, 0.2),
      inset 0 1px 0 rgba(255, 255, 255, 0.06);
  }
  ```
- [x] Placed the new CSS right after the `.dark .gallery-card:hover` rule (`globals.css:2654`), co-located with other glassmorphism rules.

### Phase 3: Wire up URL-param selection on results page
- [x] In `src/app/results/page.tsx`, import the new module:
  ```typescript
  import { EDITOR_PANEL_VARIANTS, resolveEditorPanelVariant } from '@/components/editor-panel-variants';
  ```
- [x] Inside `ResultsPageContent()`, near the existing `searchParams.get('mode')` usage (line ~191), resolve the variant:
  ```typescript
  const editorPanelVariant = resolveEditorPanelVariant(searchParams.get('editorVariant'));
  const editorPanelClass = EDITOR_PANEL_VARIANTS[editorPanelVariant];
  ```
  No `useMemo` — `EDITOR_PANEL_VARIANTS[key]` is an O(1) Record lookup on a static object; memoization deps comparison costs more than the lookup itself. Plain const.
- [x] Replace the wrapper at `src/app/results/page.tsx:1401`:
  ```diff
  - <div data-testid="explanation-content" className="scholar-card p-6 atlas-animate-fade-up stagger-5">
  + <div data-testid="explanation-content" className={`${editorPanelClass} atlas-animate-fade-up stagger-5`}>
  ```
- [ ] **(deferred to user A/B)** Verify each variant by visiting:
  - `/results?explanation_id=<id>` (default)
  - `/results?explanation_id=<id>&editorVariant=parchment`
  - `/results?explanation_id=<id>&editorVariant=embossed`
  - `/results?explanation_id=<id>&editorVariant=vellum`
  - `/results?explanation_id=<id>&editorVariant=bracketed`
  - `/results?explanation_id=<id>&editorVariant=garbage` (should fall back to default; console.warn fires)
  - `/results?explanation_id=<id>&editorVariant=toString` (Object.prototype attack — must also fall back to default)
  - `/results?explanation_id=<id>&editorVariant=__proto__` (same)
- [ ] **(deferred)** **User picks a favorite** → in `editor-panel-variants.ts`, reassign `DEFAULT_EDITOR_PANEL_VARIANT` to that key (single-line change). The named variant stays available at its original URL (`?editorVariant=<key>`); the default pointer just moves. **Do not** move class strings between keys — that would break bookmarked variant URLs. Commit as a separate small change. Per resolved decision #4.

## Testing

### Unit Tests
- [x] **New**: `src/components/editor-panel-variants.test.ts` — coverage matrix:
  - `resolveEditorPanelVariant` returns the matching key for each valid input (`'default'`, `'parchment'`, `'embossed'`, `'vellum'`, `'bracketed'`).
  - Returns `DEFAULT_EDITOR_PANEL_VARIANT` for: `null`, `undefined`, `''`, `'unknown'`, **`'toString'`, `'__proto__'`, `'hasOwnProperty'`, `'constructor'`** (Object.prototype attack surface — these MUST fall back to default, proving the `hasOwnProperty.call` guard works).
  - Every key in `EDITOR_PANEL_VARIANTS` is reachable via `resolveEditorPanelVariant(key)` (round-trip check).
  - Every value in `EDITOR_PANEL_VARIANTS` is a non-empty string and contains `p-` (padding token) — guards against accidental padding drop in future edits.
  - `DEFAULT_EDITOR_PANEL_VARIANT` is a valid key (`DEFAULT_EDITOR_PANEL_VARIANT in EDITOR_PANEL_VARIANTS` is truthy).
  - Console.warn fires for non-empty unknown strings but NOT for `null`/`undefined`/`''`.
- [x] **Existing, must update**: `src/components/ReportContentButton.test.tsx` — add 2 tests:
  - Render without `className` prop → root button (`screen.getByTestId('report-content-button')`) has no spurious extra classes vs. baseline.
  - Render with `className="hidden sm:inline-flex"` → `expect(screen.getByTestId('report-content-button').className).toContain('hidden')` and `.toContain('sm:inline-flex')`. Use `data-testid` (not `getByRole`), since `hidden` may hide the element from accessibility queries.
- [x] **Existing, smoke-check (confirmed safe)**: `src/app/results/page.test.tsx` — mocks `LexicalEditor` and never asserts on the `scholar-card`/`explanation-content` className. No update needed; all 37 tests still pass.

### Integration Tests
- [ ] _N/A_ — no service/DB integration affected.

### E2E Tests
- [ ] **Existing, must remain green** — run unchanged: `src/__tests__/e2e/specs/04-content-viewing/action-buttons.spec.ts` (17 tests, all `data-testid`-anchored; verified zero DOM-hierarchy assertions on the flag button).
- [ ] **Existing, must remain green** — run unchanged: `src/__tests__/e2e/specs/04-content-viewing/report-content.spec.ts` (flag-button modal + z-index assertions; runs at default viewport ≥640px so `hidden sm:inline-flex` doesn't affect it).
- [x] **Required new — `@critical`**: added `src/__tests__/e2e/specs/04-content-viewing/editor-panel-variants.spec.ts` covering:
  - Navigate to `/results?…&editorVariant=parchment`; assert `data-testid="explanation-content"` className contains `paper-texture` (tagged `@critical` so PR CI's `test:e2e:critical` job catches URL-param regressions).
  - Navigate to `/results?…&editorVariant=garbage`; assert wrapper className contains `scholar-card` (default fallback).
  - Navigate to `/results?…&editorVariant=toString`; assert wrapper className does NOT contain `undefined` (regression test for Object.prototype attack).
- [x] **Required new — `@critical`**: added a 2nd `describe` block in `editor-panel-variants.spec.ts` for flag-button responsive behavior with 2 viewport-targeted assertions:
  - Set viewport BEFORE goto: `await page.setViewportSize({ width: 375, height: 667 }); await page.goto('/results?…')` → `await expect(page.getByTestId('report-content-button')).not.toBeVisible()`.
  - Set viewport at 1280x720 → `await expect(page.getByTestId('report-content-button')).toBeVisible()`.
  - Tag `@critical` so the `hidden sm:inline-flex` breakpoint behavior is guarded by PR CI (not just manual QA).
  - **Note for implementer**: `setViewportSize` has no prior usage in `src/__tests__/e2e/specs/`. Add a 1-line comment explaining intent. The `chromium-critical` Playwright project uses `Desktop Chrome` device — only viewport size changes, the user-agent stays desktop (fine for CSS-class assertions).
  - Use the existing `authenticatedPage` fixture from `src/__tests__/e2e/fixtures/auth` (same fixture `report-content.spec.ts` uses).

### Manual Verification
- [ ] Side-by-side compare against `input_files/misaligned_buttons.png` after the button fix — no button wraps alone, layout looks intentional at 360 / 640 / 1024 / 1440 px.
- [ ] Click each of the 4 editor variants in light + dark mode; verify the panel reads as one block (no internal title section), no hover-lift on `vellum`, brackets only on `bracketed`.
- [ ] Confirm typing into the editor doesn't trigger panel-level animations under any variant.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Headless Playwright screenshot of the fixed action row at 1280px width (light + dark) — store under `docs/planning/light_design_changes_explain_anything_20260524/screenshots/` for the PR.
- [ ] Headless Playwright screenshot at 375px width showing the flag button hidden and 1280px showing it visible — proves the `hidden sm:inline-flex` behavior.
- [ ] Headless Playwright screenshot of the editor panel under each variant (default, parchment, embossed, vellum, bracketed) at 1280px (light + dark) — same folder.
- [ ] Note: this repo has **no existing `toHaveScreenshot` visual-regression baselines**. Screenshots above are documentation-only (for the PR description), not automated visual diffs. Conscious decision — adding a baseline for a temporary A/B picker is not worth the maintenance cost.

### B) Automated Tests
- [x] `npm run lint` — must pass; the design-system ESLint rules will catch any hardcoded colors / arbitrary text sizes I introduce. The `bg-[var(--surface-elevated)]` arbitrary-value pattern (in the Embossed variant string) is allowed because `no-tailwind-color-classes` only matches Tailwind palette names (red/green/etc.), not CSS-var values — verified by reading `eslint-rules/no-tailwind-color-classes.js`.
- [x] `npm run typecheck` — must pass; new `editor-panel-variants.ts` adds a typed union. (Script is `typecheck`, NOT `tsc` — verified in `package.json`.)
- [x] `npm run test:eslint-rules` — must pass; runs all 14 custom design-system rule unit tests in isolation. The variant className strings in `editor-panel-variants.ts` are exactly the kind of design-system-relevant text these rules guard, so running them is mandatory.
- [x] `npm run build` — must pass.
- [x] `npm run test` — unit tests, including new `editor-panel-variants.test.ts` and updated `ReportContentButton.test.tsx`.
- [x] `npm run test:e2e:critical` — **5/5 pass in 26.6s**. New spec is tagged `@critical` so this command exercises it.
- [ ] Full E2E suite (`npm run test:e2e`) encouraged before PR per CLAUDE.md (feedback_local_finalize_checks_before_push memory).

## Documentation Updates
- [ ] `docs/docs_overall/design_style_guide.md` — add a short subsection under "Component Patterns" referencing `EDITOR_PANEL_VARIANTS` and listing the 5 variants once a default is chosen (defer until variant lands).
- [ ] `docs/feature_deep_dives/lexical_editor_plugins.md` — add a 2-line note that the wrapper className is variant-driven via `?editorVariant=…`.

## Rollback Plan
All changes are visual/structural in a single page file plus one new variants module + ~16 lines of CSS. **Revert in reverse commit order** to avoid dangling references (e.g., reverting the variants module before the default-change leaves `DEFAULT_EDITOR_PANEL_VARIANT` referencing a deleted key):
1. `git revert <default-change-commit>` (if applied) — restores the original `default` variant pointer. Must revert first.
2. `git revert <variants-commit>` — restores `<div className="scholar-card p-6">` wrapper; removes `.vellum-editor` CSS; deletes `editor-panel-variants.ts`.
3. `git revert <button-fix-commit>` — restores original action-row layout.

No DB migrations, no env-var changes, no GitHub workflow changes, no external integrations affected.

## Review & Discussion

### Iteration 2 (2026-05-24) — ✅ CONSENSUS
| Perspective | Score |
|-------------|-------|
| Security & Technical | 5/5 |
| Architecture & Integration | 5/5 |
| Testing & CI/CD | 5/5 |

All reviewers voted 5/5 with zero critical gaps. Plan is ready for execution.

**Additional polish applied** (from iter-2 minor issues):
- Spelled out `className` merge pattern in Phase 1 (avoid losing baseline `ReportContentButton` styles).
- Gated `console.warn` with `NODE_ENV !== 'production'` to keep prod consoles quiet.
- Moved viewport assertions into the new `editor-panel-variants.spec.ts` (not `report-content.spec.ts`, which is intentionally non-`@critical`), with `setViewportSize`-before-goto sequencing + `authenticatedPage` fixture noted.

**Carried-over follow-up (out of scope):** `src/contexts/PanelVariantContext.tsx:32` has the same `stored in PANEL_VARIANTS` Object.prototype-key vulnerability — should be hardened separately. Not in this PR.

### Iteration 1 (2026-05-24)
| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 4/5 | 1 |
| Architecture & Integration | 4/5 | 0 |
| Testing & CI/CD | 4/5 | 3 |

**Critical gaps fixed:**
1. [Security] `resolveEditorPanelVariant` switched from `in` to `Object.prototype.hasOwnProperty.call()` to defeat Object.prototype-key attacks (`toString`, `__proto__`, etc.). Added explicit test cases.
2. [Testing] `npm run tsc` → `npm run typecheck` (correct package.json script).
3. [Testing] URL-param E2E spec promoted from optional to required and tagged `@critical` so PR CI catches regressions.
4. [Testing] Added Playwright viewport tests at 375px (flag hidden) and 1280px (flag visible) so `hidden sm:inline-flex` is CI-guarded.

**Key minor issues fixed:** "lite variant" framing for `editor-panel-variants.ts`, naming-disambiguation note vs `PANEL_VARIANTS`, dropped useMemo hedge, added `console.warn` for unknown variants, expanded variants unit-test matrix, specified className-forwarding test approach, added 640-768px right-cluster spacing check, added `npm run test:eslint-rules` to verification, noted "no visual baselines today" decision, reversed rollback order.

