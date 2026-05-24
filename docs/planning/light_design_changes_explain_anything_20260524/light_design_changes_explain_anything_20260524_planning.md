// Planning doc for the light_design_changes_explain_anything_20260524 project — captures brainstorm, options considered, and the phased plan for fixing button misalignment and proposing editor-panel design variations.

# light_design_changes_explain_anything_20260524 Plan

## Background
Light visual-design pass on ExplainAnything. Two scoped items: (1) a button-alignment bug surfaced in `input_files/misaligned_buttons.png`, and (2) a few exploratory design variations for the editor panel to evaluate which feel best within the Midnight Scholar design system.

## Requirements (from user)
- Look at `input_files/misaligned_buttons.png` and fix the misaligned buttons shown there.
- Generate a few variations to make the editor panel look better.

## Problem
The current UI has at least one visible alignment defect on a button cluster (per screenshot). Separately, the editor panel works functionally but could feel more polished and on-brand with the Midnight Scholar aesthetic. Both are low-risk, scoped UI changes — no logic changes expected.

## Options Considered
- [ ] **Option A: Inspect-and-patch**: Locate the offending button cluster from the screenshot, fix only the alignment, and ship.
- [ ] **Option B: Inspect-and-patch + design-token audit**: Same as A, plus a small audit of nearby components to catch similar issues in one pass.

## Phased Execution Plan

### Phase 1: Reproduce + locate
- [ ] Open `input_files/misaligned_buttons.png` and identify which page / component the buttons belong to.
- [ ] Grep the codebase for that component and confirm the alignment issue locally (Playwright + dev server).

### Phase 2: Fix button alignment
- [ ] Apply minimal flex/grid/spacing fix using design-system tokens (no hardcoded values).
- [ ] Verify in light + dark mode and at common widths.

### Phase 3: Editor-panel variations
- [ ] Identify the "editor panel" target (Lexical editor surface vs. surrounding chrome) and confirm with user.
- [ ] Generate 2-3 variation mockups (HTML/CSS or screenshots) for review.
- [ ] User picks a direction; apply chosen variation.

## Testing

### Unit Tests
- [ ] _N/A unless component logic changes_

### Integration Tests
- [ ] _N/A_

### E2E Tests
- [ ] Add or update a Playwright snapshot/visual check for the fixed button area if appropriate.

### Manual Verification
- [ ] Side-by-side compare against `input_files/misaligned_buttons.png` after fix.
- [ ] Click through editor panel in both themes after variation lands.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Headless Playwright screenshot of the fixed button cluster (light + dark).
- [ ] Headless Playwright screenshot of the new editor panel.

### B) Automated Tests
- [ ] `npm run lint` (design-system ESLint rules must pass).
- [ ] `npm run tsc`, `npm run build`.

## Documentation Updates
- [ ] `docs/docs_overall/design_style_guide.md` — only if a new token or pattern is introduced.

## Review & Discussion
_Populated by /plan-review with agent scores, reasoning, and gap resolutions._
