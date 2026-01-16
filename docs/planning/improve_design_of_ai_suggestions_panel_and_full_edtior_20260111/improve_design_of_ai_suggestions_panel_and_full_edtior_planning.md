# Improve Design of AI Suggestions Panel and Full Editor Plan

## Background

The AI suggestions panel (AIEditorPanel) and Advanced AI Editor modal currently have a cluttered layout. Quick actions take prominent position at the top, the output mode toggle consumes ~100px of vertical space, and the visual hierarchy doesn't emphasize the primary elements (prompt and sources).

## Problem

Users need a cleaner, more focused interface where:
1. The prompt textarea is the primary focus
2. Output mode selection is compact and accessible
3. Quick actions are available but unobtrusive
4. The header reflects the current mode contextually

## Design Decisions

### 1. Dynamic Header
- **Current:** Static "Edit article" (sidebar) / "Advanced AI Editor" (modal)
- **New:** Dynamic based on output mode:
  - Suggest mode: "Suggest edits"
  - Rewrite mode: "Rewrite article"

### 2. Compact Output Mode Toggle
- **Current:** ~100px tall with label, two tall buttons with icons, help text
- **New:** ~32px segmented pill `[Suggest | Rewrite]`
  - Inline layout with "Mode:" label
  - No icons, tooltips on hover instead
  - Selected: gold/15 background + copper text
  - Unselected: muted text

### 3. Text Link Quick Actions
- **Current:** Prominent buttons with icons at top of panel
- **New:** Subtle text links below prompt textarea
  - Format: `Simplify · Expand · Fix grammar · Make formal`
  - Muted text, copper on hover
  - No backgrounds, borders, or icons

### 4. New Layout Order

**AIEditorPanel:**
```
Header: [Quill] "Suggest edits" / "Rewrite article"  [expand]
Mode: [Suggest | Rewrite]
Prompt textarea
Simplify · Expand · Fix grammar · Make formal
Sources (optional)
[Submit Button]
```

**AdvancedAIEditorModal:**
```
Header: "Suggest edits" / "Rewrite article"  [X]
Mode: [Suggest | Rewrite]
Prompt textarea
Sources
Tags (conditional)
[Cancel] [Apply]
```

## Phased Execution Plan

### Phase 1: OutputModeToggle Redesign
1. Add `compact` prop to OutputModeToggle (default: false for backwards compat)
2. Redesign component as inline segmented pill
3. Update styling: remove icons, use text-only buttons
4. Add title attributes for tooltips
5. Run existing tests, update as needed

### Phase 2: AIEditorPanel Layout
1. Add dynamic header based on outputMode prop
2. Move OutputModeToggle from after sources → after header
3. Convert quick actions from buttons to text links
4. Move quick actions from top → below prompt
5. Remove "Quick Actions" label
6. Update tests for new layout

### Phase 3: AdvancedAIEditorModal Layout
1. Add dynamic header based on outputMode state
2. Move OutputModeToggle from after sources → after header
3. Update tests for new layout

### Phase 4: Cleanup
1. Remove unused icon components if no longer needed
2. Run full test suite (lint, tsc, unit, integration)
3. Manual visual verification

## Testing

### Unit Tests to Update
- `OutputModeToggle.test.tsx` - Update for new structure
- `AIEditorPanel.test.tsx` - Update layout expectations, quick action selectors
- `AdvancedAIEditorModal.test.tsx` - Update layout expectations

### Manual Verification
- Visual inspection of both light and dark modes
- Verify hover states on quick action text links
- Verify output mode toggle selection states
- Verify dynamic header changes when toggling modes

## Documentation Updates

None required - this is an internal UI refinement.

## Files Modified

| File | Changes |
|------|---------|
| `src/components/OutputModeToggle.tsx` | Redesign to segmented pill (~32px) |
| `src/components/AIEditorPanel.tsx` | Reorder sections, dynamic header, text link quick actions |
| `src/components/AdvancedAIEditorModal.tsx` | Reorder sections, dynamic header |

---

## Phase 5: Design Variants System (Added 2026-01-14)

### Background

After completing the initial layout improvements, we added a configurable design variant system to allow users to switch between 5 distinct visual styles for the AI suggestion panel.

### Design Decisions

#### 5 Panel Variants

| Variant | Description |
|---------|-------------|
| **Classic Scholar** | Refined scholarly aesthetic with subtle borders and warm shadows (default) |
| **Floating Parchment** | Ethereal borderless design using negative space and subtle dividers |
| **Candlelit Alcove** | Warm atmospheric glow with radial gradients and ambient lighting |
| **Serif Manuscript** | Typography-driven editorial elegance with transparent backgrounds |
| **Glass Library** | Glassmorphism with backdrop blur and atmospheric effects |

#### Architecture

- **Configuration-driven styles**: Variant styles defined as objects in `ai-panel-variants.ts`
- **Context-based state**: `PanelVariantContext` manages selection with localStorage persistence
- **Graceful fallback**: `usePanelVariantOptional()` allows component to work outside provider

#### UI Changes

- Variant selector dropdown added to panel header (below title, above mode toggle)
- Panel width increased from 340px → 360px for better spacing
- Borders lightened throughout (using `/50`, `/40` opacity modifiers)
- Header sizing increased for better visual hierarchy

### Files Created

| File | Purpose |
|------|---------|
| `src/components/ai-panel-variants.ts` | 5 variant configurations with style objects |
| `src/contexts/PanelVariantContext.tsx` | State management with localStorage persistence |
| `src/components/PanelVariantSelector.tsx` | Standalone dropdown component (optional use) |

### Files Modified

| File | Changes |
|------|---------|
| `src/components/AIEditorPanel.tsx` | Variant-based styling, inline selector in header |
| `src/app/results/page.tsx` | Wrapped with PanelVariantProvider |
