# Improve Design of AI Suggestions Panel and Full Editor Progress

## Phase 1: OutputModeToggle Redesign
### Work Done
- Redesigned OutputModeToggle from ~100px tall vertical layout to ~32px compact segmented pill
- Changed from stacked icon+text buttons to inline text-only buttons
- Removed visible help text, added tooltips via `title` attribute
- Changed labels: "Inline Diff" → "Suggest", kept "Rewrite"
- Updated tests to check for title attributes instead of visible text

### Files Modified
- `src/components/OutputModeToggle.tsx` - Complete redesign
- `src/components/OutputModeToggle.test.tsx` - Updated "Description text" → "Tooltip descriptions" tests

### Issues Encountered
- Tests failed checking for visible help text that moved to tooltips
- Solution: Updated tests to check `title` attribute instead

### Verification
- Lint: Pass
- TypeScript: Pass
- Unit tests: 12/12 pass

## Phase 2: AIEditorPanel Layout
### Work Done
- Added dynamic header: "Suggest edits" (inline-diff) / "Rewrite article" (rewrite)
- Moved OutputModeToggle from after sources to header section (below title)
- Converted Quick Actions from prominent buttons to subtle text links
- Moved Quick Actions from top → below prompt textarea
- Format: `Simplify · Expand · Fix grammar · Make formal` with interpunct separators
- Removed "Quick Actions" label
- Updated tests: changed "Edit article" → "Suggest edits" text checks
- Added new test for dynamic "Rewrite article" header

### Files Modified
- `src/components/AIEditorPanel.tsx` - Layout reorder, dynamic header, text link quick actions
- `src/components/AIEditorPanel.test.tsx` - Updated header text tests, added outputMode test

### Issues Encountered
- Tests failed checking for "Edit article" (now dynamic "Suggest edits")
- Solution: Updated tests to check for "Suggest edits", added test for rewrite mode

### Verification
- Lint: Pass
- TypeScript: Pass
- Unit tests: 32/32 pass

## Phase 3: AdvancedAIEditorModal Layout
### Work Done
- Added dynamic header: "Suggest edits" (inline-diff) / "Rewrite article" (rewrite)
- Moved OutputModeToggle from content area to header section
- Changed font-serif → font-display for header consistency
- Added self-start to close button for proper alignment with multi-line header

### Files Modified
- `src/components/AdvancedAIEditorModal.tsx` - Dynamic header, OutputModeToggle moved to header
- `src/components/AdvancedAIEditorModal.test.tsx` - Created new test file

### Issues Encountered
- No tests existed for this component
- Solution: Created new test file with dynamic header tests

### Verification
- Lint: Pass
- TypeScript: Pass
- Unit tests: 7/7 pass (new file)

## Phase 4: Cleanup
### Work Done
- Ran production build: Pass
- Ran full unit test suite (excluding integration tests)

### Verification
- Lint: Pass
- TypeScript: Pass
- Build: Pass
- Unit tests: 51/51 pass for modified components (OutputModeToggle, AIEditorPanel, AdvancedAIEditorModal)
- Full unit tests: 2282/2295 pass (1 pre-existing ESM failure with unified module)

## Summary of All Changes

### Files Modified
| File | Changes |
|------|---------|
| `src/components/OutputModeToggle.tsx` | Redesigned from ~100px to ~32px segmented pill |
| `src/components/OutputModeToggle.test.tsx` | Updated tests for tooltip descriptions |
| `src/components/AIEditorPanel.tsx` | Dynamic header, moved toggle, text link quick actions |
| `src/components/AIEditorPanel.test.tsx` | Updated header tests, added outputMode test |
| `src/components/AdvancedAIEditorModal.tsx` | Dynamic header, moved toggle to header |
| `src/components/AdvancedAIEditorModal.test.tsx` | Created new test file |

### Design Changes Applied
1. **Dynamic Header**: "Suggest edits" / "Rewrite article" based on outputMode
2. **Compact Toggle**: ~32px segmented pill with "Mode: [Suggest | Rewrite]"
3. **Text Link Quick Actions**: `Simplify · Expand · Fix grammar · Make formal` below prompt
4. **Layout Reorder**: Mode toggle at top, quick actions below prompt
5. **Visual Hierarchy**: Emphasis on prompt and sources, subtle quick actions
6. **Tags Section**: Added TagSelector to AIEditorPanel (mirrors AdvancedAIEditorModal)
