// Research notes for the light_design_changes_explain_anything_20260524 project — tracks problem statement, requirements, findings, and reading list as design changes are explored.

# light_design_changes_explain_anything_20260524 Research

## Problem Statement
Two scoped UI changes on ExplainAnything:
1. A button on the explanation results/edit page is wrapping awkwardly to a 2nd row by itself (see `input_files/misaligned_buttons.png`).
2. The editor panel (LexicalEditor wrapper) feels visually plain — want a few stylistic variations to choose from.

## Requirements (from user)
- Fix the misaligned button(s) shown in `input_files/misaligned_buttons.png`.
- Generate a few variations to make the editor panel look better.

## High Level Summary

### Issue 1 — Misaligned button (diagnosed)
The "misaligned button" is the **flag / Report-content button** (`ReportContentButton`). In `src/app/results/page.tsx` lines 1174-1335, the top-level action row is:

```jsx
<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 atlas-animate-fade-up stagger-4">
  <div className="flex flex-wrap gap-2">
    {/* Rewrite, Save, Share, Publish, Plain Text, Edit — 6 main buttons */}
    {explanationId && <ReportContentButton ... />}   {/* lines 1317-1322 — INSIDE the same group */}
  </div>
  <div className="flex items-center gap-2">
    <label htmlFor="mode-select">Mode:</label>
    <select id="mode-select" ... />
  </div>
</div>
```

Because all 7 items share one `flex flex-wrap gap-2` container, the 6 main buttons fill the row at common widths and the flag button gets pushed alone to a second line — looking unintentional. The fix is structural (move the flag button out of the primary-action group), not just spacing.

### Issue 2 — Editor panel polish
The editor wrapper at `src/app/results/page.tsx` ~line 1401 is:
```jsx
<div data-testid="explanation-content" className="scholar-card p-6 atlas-animate-fade-up stagger-5">
  <LexicalEditor ... />
</div>
```

`.scholar-card` is restrained (white surface, 1px border, very subtle warm shadow). The Midnight Scholar design system already ships many richer panel treatments we can borrow (`.card-enhanced`, `.gallery-card`, `.paper-texture`, `.flourish-divider`, `.title-flourish`, etc.) without inventing new tokens. Three concrete variations are drafted below.

## Key Findings

### F1 — Action row structure (`src/app/results/page.tsx:1174-1335`)
- Outer: `flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 atlas-animate-fade-up stagger-4`.
- Left group (line 1176): `flex flex-wrap gap-2` containing 6 primary buttons + `ReportContentButton`.
- Right group (line 1326): `flex items-center gap-2` containing the MODE dropdown.
- Stable data-testids on buttons: `rewrite-button`, `rewrite-dropdown-toggle`, `save-to-library`, `publish-button`, `edit-button`, `format-toggle-button`, `report-content-button`, `mode-select`.

### F2 — ReportContentButton (`src/components/ReportContentButton.tsx:78-98`)
- Renders an icon-only button (flag SVG) with `data-testid="report-content-button"`.
- Currently does **not** accept a `className` prop — needs a small interface change to accept and forward one if the recommended fix is taken.

### F3 — Editor panel wrapper (`src/app/results/page.tsx:1401`)
- Class: `scholar-card p-6 atlas-animate-fade-up stagger-5`.
- `data-testid="explanation-content"` — must be preserved across all variations.

### F4 — Design system surfaces (from `src/app/globals.css`)
| Class | Treatment |
|-------|-----------|
| `.scholar-card` (l.1637) | base — `bg(surface-secondary)` + 1px border + subtle warm shadow + inset highlight |
| `.scholar-card-hover` (l.2090) | adds `translateY(-2px)` + warmer shadow on hover |
| `.card-enhanced` (l.2530) | gold/copper corner brackets via `::before`/`::after`; layered shadow |
| `.gallery-card` (l.2600) | glassmorphism — `backdrop-filter: blur(12px)` + gold→copper top bar + lift on hover |
| `.paper-texture` (l.1028) | SVG fractal noise overlay @ 3% (light) / 5% (dark) |
| `.flourish-divider` (l.1046) | centered divider w/ gradient lines |
| `.title-flourish` (l.1091) | double-line gold/copper underline |

### F5 — Design tokens & ESLint guardrails (eslint-rules/design-system.js)
9 rules enforce: `no-hardcoded-colors`, `no-arbitrary-text-sizes`, `prefer-design-system-fonts`, `prefer-warm-shadows`, `no-tailwind-color-classes`, `prefer-design-radius`, `enforce-heading-typography`, `enforce-prose-font`, `no-inline-typography`. All variations below comply.

Shadows: `shadow-warm-sm | shadow-warm | shadow-warm-md | shadow-warm-lg | shadow-warm-xl | shadow-page | shadow-page-deep | shadow-gold-glow | shadow-gold-glow-lg`.

Radii: `rounded-page` (0.375rem), `rounded-book` (0.5rem).

### F6 — Test coverage / risk
| File | Risk | Notes |
|------|------|-------|
| `src/__tests__/e2e/specs/04-content-viewing/action-buttons.spec.ts` | HIGH | 17 tests; all use `data-testid` selectors → safe if we don't drop testids |
| `src/__tests__/e2e/specs/04-content-viewing/report-content.spec.ts` | HIGH | Asserts flag-button modal opens; z-index assertion on `report-modal-backdrop` |
| `src/components/ReportContentButton.test.tsx` | MEDIUM | className changes on button itself are safe |
| `src/app/results/page.test.tsx` | LOW | Mocks the editor; doesn't assert layout |

Bottom line: refactoring className strings + moving JSX without dropping any `data-testid` is **safe**.

## Proposed Fix — Button alignment

**Recommended (Option 1):** move `ReportContentButton` out of the primary-action group and place it in the right-side cluster next to the MODE dropdown. Hide on mobile to preserve narrow-viewport real estate.

Diff:
```diff
   <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 atlas-animate-fade-up stagger-4">
     <div className="flex flex-wrap gap-2">
-      {/* 6 primary buttons + flag */}
+      {/* 6 primary buttons only */}
-      {explanationId && (
-        <ReportContentButton explanationId={explanationId} disabled={isStreaming} />
-      )}
     </div>
     <div className="flex items-center gap-2">
+      {explanationId && (
+        <ReportContentButton
+          explanationId={explanationId}
+          disabled={isStreaming}
+          className="hidden sm:inline-flex"
+        />
+      )}
       <label htmlFor="mode-select" ...>Mode:</label>
       <select id="mode-select" ... />
     </div>
   </div>
```

Plus a 1-line addition to `ReportContentButton` props: accept optional `className` and forward to root button (preserves `data-testid`).

Why it's safe:
- All `data-testid` anchors preserved.
- Semantic improvement: flag is a secondary utility (like Mode), not a primary content action.
- Works at every breakpoint by design instead of by accident.

Alternates considered: (B) keep flag in-group with a `border-l` separator; (C) move flag to a 3-dot overflow menu. Both viable but Option 1 is cleanest. Decision deferred to user.

## Proposed Editor-Panel Variations

**Constraint (per user, 2026-05-24):** every variation must be **one cohesive block** — no internal "title section" with a different color, no top gradient bars, no internal flourish-dividers. Only whole-surface treatments and edge decorations are allowed.

The 4 candidates below are mutually exclusive surface treatments. All five (including `default`) preserve `data-testid="explanation-content"` and pass the design-system ESLint rules.

### V1 — "Parchment" (pure aged paper)
```jsx
<div data-testid="explanation-content"
     className="scholar-card paper-texture shadow-warm-lg p-6 atlas-animate-fade-up stagger-5">
  <LexicalEditor ... />
</div>
```
- `paper-texture` overlay across the whole panel (3% / 5% noise light/dark).
- `shadow-warm-lg` for generous warm depth.
- No internal partitions. The panel is uniformly "paper" top-to-bottom.
- **Needs no new CSS.**

### V2 — "Embossed Page" (recessed book page)
```jsx
<div data-testid="explanation-content"
     className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-6 shadow-page atlas-animate-fade-up stagger-5">
  <LexicalEditor ... />
</div>
```
- Uses `shadow-page` (inset shadow) + `var(--surface-elevated)` to feel **recessed** into the surrounding page — like a book page bound into a cover.
- One uniform surface, just sunken instead of raised.
- **Needs no new CSS.**

### V3 — "Vellum" (subtle frosted glass, no top bar)
```jsx
<div data-testid="explanation-content"
     className="vellum-editor rounded-book p-6 shadow-warm-md atlas-animate-fade-up stagger-5">
  <LexicalEditor ... />
</div>
```
Plus a small `.vellum-editor` rule in `globals.css` (~12 lines): translucent surface (`rgba(var(--surface-secondary-rgb), 0.85)`) + `backdrop-filter: blur(8px)` + warm border. No top accent bar, **no hover transform** (editing surface shouldn't lift). One uniform glass block.

### V4 — "Bracketed" (corner-bracket edges)
```jsx
<div data-testid="explanation-content"
     className="scholar-card card-enhanced p-8 shadow-warm-lg atlas-animate-fade-up stagger-5">
  <LexicalEditor ... />
</div>
```
- Reuses existing `card-enhanced` to add gold/copper bracket flourishes at the **outer corners only** (decoration, not internal partition).
- `p-8` for more breathing room around prose.
- **Needs no new CSS.** ESLint-safe because `card-enhanced` is already in the system.

### URL-Param Selector

Pattern already established in `src/app/results/page.tsx:51` — `useSearchParams()` is in use (`searchParams.get('mode')`, `searchParams.get('explanation_id')`, etc.). Add one more lookup:

```typescript
// near the top of ResultsPageContent
const editorVariant = searchParams.get('editorVariant') ?? 'default';

const EDITOR_PANEL_VARIANTS: Record<string, string> = {
  default:   'scholar-card p-6',
  parchment: 'scholar-card paper-texture shadow-warm-lg p-6',
  embossed:  'bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-6 shadow-page',
  vellum:    'vellum-editor rounded-book p-6 shadow-warm-md',
  bracketed: 'scholar-card card-enhanced p-8 shadow-warm-lg',
};
const editorPanelClass =
  EDITOR_PANEL_VARIANTS[editorVariant] ?? EDITOR_PANEL_VARIANTS.default;
```

At the wrapper:
```jsx
<div data-testid="explanation-content"
     className={`${editorPanelClass} atlas-animate-fade-up stagger-5`}>
  <LexicalEditor ... />
</div>
```

Compare live by appending the param to the URL:
- `/results?explanation_id=…&editorVariant=parchment`
- `/results?explanation_id=…&editorVariant=embossed`
- `/results?explanation_id=…&editorVariant=vellum`
- `/results?explanation_id=…&editorVariant=bracketed`
- Omit the param (or any unknown value) → falls back to `default`.

**Implementation notes:**
- Recommended: extract the map into a new file `src/components/editor-panel-variants.ts` mirroring the existing `src/components/ai-panel-variants.ts` pattern (one file ⇒ one canonical list, easier to add/remove variants).
- The existing `PanelVariantProvider` in `src/contexts/PanelVariantContext.tsx` is for `AIEditorPanel` (different concern, localStorage-persisted) — keep separate; **do not** widen it to cover the explanation editor.
- Tests: no existing test asserts the editor-panel className string, so the new class map is additive and safe.

### CSS Additions Required
Only V3 needs new CSS. Draft (`src/app/globals.css`):
```css
.vellum-editor {
  background: rgba(var(--surface-secondary-rgb), 0.85);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(var(--border-default-rgb), 0.6);
  box-shadow:
    0 1px 3px rgba(180, 115, 51, 0.08),
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
Notes: ESLint `no-hardcoded-colors` applies to **style props in JSX**, not to `globals.css` — these rgba values are acceptable in CSS, but where possible they reference `--*-rgb` variables. If any of `--surface-secondary-rgb` or `--border-default-rgb` isn't defined yet, confirm during implementation (likely defined — `card-enhanced` and `gallery-card` already use them).

## Documents Read
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md
- docs/docs_overall/design_style_guide.md
- docs/feature_deep_dives/lexical_editor_plugins.md
- docs/feature_deep_dives/admin_panel.md
- evolution/docs/README.md
- evolution/docs/architecture.md
- evolution/docs/arena.md

## Code Files Read
- `src/app/results/page.tsx` — lines 1100-1450 (action row + editor panel wrapper)
- `src/components/ReportContentButton.tsx` — full file (no className prop today)
- `src/components/ui/button.tsx` — Button variants & sizes
- `src/components/ui/card.tsx` — Card primitive (uses `paper-texture + card-enhanced`)
- `src/components/AIEditorPanel.tsx` + `src/components/ai-panel-variants.ts` — reference for polished panel chrome
- `src/components/Navigation.tsx` — reference for `scholar-nav`/`dark-nav`
- `src/components/home/HomeSearchPanel.tsx` — reference panel
- `src/components/sources/DiscoverSourcesPanel.tsx` — reference panel
- `src/app/globals.css` — `.scholar-card`, `.card-enhanced`, `.gallery-card`, `.paper-texture`, `.flourish-divider`, `.title-flourish` rules
- `tailwind.config.ts` — warm shadow scale, animation keyframes
- `eslint-rules/design-system.js` + sibling rule files — confirmed 9 rules
- `src/__tests__/e2e/specs/04-content-viewing/action-buttons.spec.ts` — 17 e2e tests
- `src/__tests__/e2e/specs/04-content-viewing/report-content.spec.ts` — modal tests
- `src/components/ReportContentButton.test.tsx` — 18 unit tests
- `src/app/results/page.test.tsx` — page-level unit tests (mostly mocked)

## Input Artifacts
- `input_files/misaligned_buttons.png` — confirms: row 1 = Rewrite/Save/Share/Publish/Plain Text/Edit + MODE; row 2 = lone flag button under "Rewrite". Diagnosed in F1.

## Resolved Decisions (user, 2026-05-24)
1. **Mobile behavior for the flag button** — RESOLVED: hide on `<sm` via `hidden sm:inline-flex`.
2. **Scope** — RESOLVED: no other design changes in scope for this project. Just the button fix + editor-panel variations.
3. **`globals.css` additions** — RESOLVED: all required RGB CSS variables already exist (`--surface-secondary-rgb`, `--border-default-rgb`, `--accent-gold-rgb`, `--accent-copper-rgb`) — verified at `src/app/globals.css:67-68` (light) and `:176-177` (dark). V3 Vellum CSS can be added as drafted with no token prep work.
4. **Default after selection** — RESOLVED: once the user picks a favorite variation after live A/B-ing the URL-param options, `EDITOR_PANEL_VARIANTS.default` will be updated to point at the chosen treatment (URL param becomes opt-out instead of opt-in).

## Outstanding (pending user input during plan/execute)
- Which of V1-V4 the user prefers as the new default — determined by visually comparing `?editorVariant=parchment|embossed|vellum|bracketed` once implemented.
