# Minor Fix AI Suggestion Panel Plan

## Background
The /results page has several UI inconsistencies that affect visual polish and UX. These include mismatched title sizes, a flag modal that doesn't display properly, missing icons, and visual conflicts between the AI panel and navigation bar.

## Problem
1. Title on /results uses `atlas-display` (3.5rem) while Explore/Settings use `atlas-display-section` (2.25rem)
2. Flag modal uses non-existent CSS variables (`--bg-primary`, `--border-color`) causing display issues
3. Plain text/formatted toggle lacks icon unlike other action bar buttons
4. "Add tag" button uses larger padding than regular tags
5. AI panel's gold header conflicts with nav's gold border; needs black outline and higher z-index

## Options Considered
For each fix, the approach is straightforward CSS/class changes:
- Title: Change class from `atlas-display` to `atlas-display-section`
- Modal: Update CSS variables to design system standards, increase z-index
- Toggle: Add DocumentTextIcon from Heroicons
- Add tag: Reduce vertical padding in CSS
- AI panel: Add ring/outline styling, increase z-index to overlay nav border

## Phased Execution Plan

### Phase 1: Title Size Fix
**File:** `src/app/results/page.tsx:1061`
```tsx
// Change from:
<h1 data-testid="explanation-title" className="atlas-display atlas-animate-fade-up stagger-1">
// To:
<h1 data-testid="explanation-title" className="atlas-display-section atlas-animate-fade-up stagger-1">
```

### Phase 2: Flag Modal Fix
**File:** `src/components/ReportContentButton.tsx`
- Line 93: Change `z-50` to `z-[100]` to ensure it's above everything
- Line 94: Change `bg-[var(--bg-primary)]` to `bg-[var(--surface-primary)]`
- All instances of `--border-color` to `--border-default`
- All instances of `--bg-secondary` to `--surface-secondary`
- All instances of `--accent-primary` to `--accent-gold`
- All instances of `--border-hover` to `--accent-gold`

### Phase 3: Add Icon to Format Toggle
**File:** `src/app/results/page.tsx:1181-1189`
- Import `DocumentTextIcon` and `Bars3BottomLeftIcon` from Heroicons
- Add icon before text based on current mode state

```tsx
<button ...>
    {isMarkdownMode ? (
        <Bars3BottomLeftIcon className="w-4 h-4 mr-1" />
    ) : (
        <DocumentTextIcon className="w-4 h-4 mr-1" />
    )}
    {isMarkdownMode ? 'Plain Text' : 'Formatted'}
</button>
```

### Phase 4: Shrink Add Tag Button
**File:** `src/app/globals.css:1581-1594`
```css
/* Change from: */
.bookmark-tag {
  padding: 0.375rem 0.75rem 0.375rem 1rem;
}
/* To: */
.bookmark-tag {
  padding: 0.25rem 0.75rem 0.25rem 0.875rem;
}
```

### Phase 5: AI Panel Styling
**File:** `src/components/ai-panel-variants.ts`
- Add black outline/ring to container
- Add explicit z-index higher than nav

**File:** `src/components/AIEditorPanel.tsx`
- Add `z-20` to main container (above nav's implicit z-index)
- Add `ring-1 ring-black/20` or `border border-black/20` for outline

## Testing

### Unit Tests (new)
**File:** `src/components/__tests__/ReportContentButton.test.tsx`
- Test modal opens when button clicked
- Test modal closes on cancel
- Test form validation (reason required)
- Test success state display

### Integration Tests (new)
**File:** `src/testing/integration/report-content.integration.test.ts`
- Test report submission with valid data
- Test error handling

### E2E Tests (new)
**File:** `e2e/report-content.spec.ts`
- Test clicking flag button opens modal
- Test submitting report
- Test modal z-index (appears above other elements)
- None marked as critical

## Documentation Updates
No documentation updates needed - these are minor UI fixes.
