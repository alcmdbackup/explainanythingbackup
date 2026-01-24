# Improve UX for Searching Plan

## Background

The Explain Anything home page currently has two disconnected content-creation entry points: a SearchBar with a hidden collapsible "+ Add sources" section, and a separate "Or import from AI" button that opens a modal. Both features work but feel fragmented - users may not discover the sources feature, and import feels like a secondary option rather than a first-class workflow.

## Problem

1. **Discoverability** - The "+ Add sources" section is collapsed by default, so users don't know they can ground explanations with citations from URLs.
2. **Fragmented experience** - Search, Sources, and Import feel like three separate features instead of one unified content-creation flow.
3. **No tag preferences for initial generation** - Users can only set difficulty/length/style preferences when rewriting, not during initial search.

## Options Considered

1. **Mode-based approach** - Single input with toggle between Generate/Import modes
2. **Tabs approach** - Horizontal tabs with Search and Import as peers ✓ (selected)
3. **Smart detection** - Auto-detect intent from input (URL → source, long paste → import)

We chose tabs because it makes both entry points equally discoverable while keeping the UI clean and familiar.

---

## Design

### Overall Structure

Two tabs horizontally centered above the input area:
- **Search** (default) - Generate explanations with optional sources and tags
- **Import** - Paste AI content to publish (existing flow, now in tab)

Tabs use subtle styling: text links with underline indicator on active tab.

### Search Tab Layout

```
┌─────────────────────────────────────────────┐
│  [Search]  [Import]                         │  ← Tab bar
├─────────────────────────────────────────────┤
│  ┌───────────────────────────────────────┐  │
│  │ What would you like to learn?         │  │  ← Query textarea
│  │                                       │  │
│  └───────────────────────────────────────┘  │
│                                             │
│  Sources: [chip] [chip] [+ Add URL]         │  ← Inline, compact
│                                             │
│  Tags: [Intermediate ▼] [Standard ▼] [+ Add]│  ← Dropdown chips
│                                             │
│            [ Search ]                       │  ← Primary button
└─────────────────────────────────────────────┘
```

**Sources Row**
- Single horizontal row with inline label
- Source chips: favicon + domain (truncated) + remove ×
- `[+ Add URL]` expands to inline input when clicked
- Max 5 sources, counter shown when ≥3: `(3/5)`
- Failed sources show warning icon, muted styling

**Tags Row**
- Single horizontal row with inline label
- Two preset dropdowns always visible with defaults:
  - Difficulty: Beginner / **Intermediate** / Advanced
  - Length: Brief / **Standard** / Detailed
- `[+ Add tag]` opens tag search (same pattern as existing TagBar)
- Added simple tags appear as removable chips

### Import Tab Layout

```
┌─────────────────────────────────────────────┐
│  [Search]  [Import]                         │
├─────────────────────────────────────────────┤
│  ┌───────────────────────────────────────┐  │
│  │ Paste content from ChatGPT, Claude,   │  │  ← Larger textarea
│  │ or Gemini...                          │  │     (4-6 rows)
│  │                                       │  │
│  └───────────────────────────────────────┘  │
│                                             │
│  Source: [ChatGPT ▼]  (auto-detected)       │  ← AI source dropdown
│                                             │
│            [ Process ]                      │
└─────────────────────────────────────────────┘
```

- Textarea placeholder: "Paste content from ChatGPT, Claude, or Gemini..."
- After 100+ characters, auto-detection sets source dropdown
- Source dropdown: ChatGPT, Claude, Gemini, Other AI
- "(auto-detected)" hint shown when system detects, hidden if user overrides
- Process button → existing ImportPreview modal flow
- Tags on import: deferred to future iteration (auto-evaluation remains)

### Interaction States

**Loading States**
- Adding source URL: chip shows pulsing skeleton until metadata loads
- Search button: spinner + "Searching...", disabled
- Process button: spinner + "Processing...", disabled

**Error States**
- Failed source fetch: warning icon, muted red border, tooltip explains
- Search with all failed sources: inline warning with option to proceed
- Empty query: Search button disabled

**Validation**
- Query: 1-150 characters required
- Import: 100+ characters required for Process to enable
- Sources: URL format validation before fetch

**Keyboard Support**
- Enter in query → submit (Shift+Enter for newline)
- Enter in URL input → add source
- Tab navigates: query → sources → tags → button
- Escape closes dropdowns

### Visual Design

- Centered hero layout preserved, expands vertically as needed
- 8px gap between query and Sources row
- 8px gap between Sources and Tags row
- 16px gap before primary button
- Total added height: ~80-100px for sections
- On narrow screens, chips wrap to second line

---

## Architecture Integration Details

### Tags API Integration (Search Tab)

The `/api/returnExplanation` API already accepts an `additionalRules: string[]` parameter for tag-based generation. This parameter is currently used by rewrites (RewriteWithTags) but works for initial queries too.

**Data flow for Search with Tags:**
```
HomeSearchPanel
    ↓ User selects tags (Difficulty: Advanced, Length: Brief)
    ↓ Convert selections to tagDescriptions: string[]
    │   e.g., ["difficulty: advanced", "length: brief"]
    ↓
sessionStorage.setItem('pendingTags', JSON.stringify(tagDescriptions))
sessionStorage.setItem('pendingSources', JSON.stringify(sources))
    ↓
router.push('/results?q={query}')
    ↓
Results page processParams() useEffect
    ↓ sessionStorage.getItem('pendingTags')
    ↓ sessionStorage.getItem('pendingSources')
    ↓
handleUserAction(query, UserInputType.Query, mode, userid, tagDescriptions, null, null, sources)
    ↓
POST /api/returnExplanation { userInput, additionalRules: tagDescriptions, sourceUrls }
    ↓
returnExplanation.ts: generateNewExplanation(titleResult, additionalRules, ...)
    ↓ createExplanationPrompt or createExplanationWithSourcesPrompt includes rules
```

**Key implementation points:**
- Store tags in sessionStorage alongside sources (same pattern)
- Results page already supports `additionalRules` parameter
- No API changes needed - just wiring

### HomeTagSelector State Shape

HomeTagSelector uses a simplified state compared to the full TagModeState:

```typescript
// HomeTagSelector state (simplified)
interface HomeTagState {
  difficulty: 'beginner' | 'intermediate' | 'advanced';  // default: 'intermediate'
  length: 'brief' | 'standard' | 'detailed';             // default: 'standard'
  simpleTags: string[];                                   // default: []
}

// Convert to additionalRules for API
function homeTagStateToRules(state: HomeTagState): string[] {
  const rules: string[] = [];
  if (state.difficulty !== 'intermediate') {
    rules.push(`difficulty: ${state.difficulty}`);
  }
  if (state.length !== 'standard') {
    rules.push(`length: ${state.length}`);
  }
  // Simple tags are passed as-is
  rules.push(...state.simpleTags);
  return rules;
}
```

This is much simpler than the full TagModeState because:
- No initial/current tracking (no existing content to compare against)
- No TagBarMode (always in "add" mode)
- No tag_active_initial/tag_active_current (fresh generation)
- Only captures user preferences, not evaluation results

---

## Phased Execution Plan

### Phase 1: Tab Infrastructure
- Create tab component with Search/Import switching
- Update `src/app/page.tsx` to use tabs
- Move existing SearchBar content into Search tab
- Move existing Import button + modal trigger into Import tab
- Verify existing functionality preserved

### Phase 2: Compact Sources Section
- Create inline sources row component
- Always visible (no collapse toggle)
- Reuse existing SourceChip, SourceInput components
- Add inline URL input expansion behavior

### Phase 3: Home Tag Selector
- Create `HomeTagSelector` component with dropdown chips
- Difficulty preset: Beginner/Intermediate/Advanced
- Length preset: Brief/Standard/Detailed
- "+ Add tag" for simple tags
- Wire to Search tab, pass selections to generation API

### Phase 4: Import Tab Enhancement
- Add AI source dropdown with auto-detection
- Wire to existing ImportPreview modal flow
- (Tags on import deferred to future iteration)

### Phase 5: Polish & Testing
- Loading/error states
- Keyboard navigation
- Responsive layout
- E2E tests for new flows

---

## Files to Modify/Create

| File | Action | Purpose |
|------|--------|---------|
| `src/app/page.tsx` | Modify | Add tabs, restructure layout |
| `src/components/home/HomeTabs.tsx` | Create | Tab switching component |
| `src/components/home/HomeSearchPanel.tsx` | Create | Search tab content |
| `src/components/home/HomeImportPanel.tsx` | Create | Import tab content |
| `src/components/home/HomeTagSelector.tsx` | Create | Compact dropdown tag selector (Search tab only) |
| `src/components/home/HomeSourcesRow.tsx` | Create | Inline sources with add input |
| `src/components/SearchBar.tsx` | Modify | Extract reusable parts |

**Reuse existing:**
- `SourceChip`, `SourceInput`, `SourceList` components
- `ImportModal`, `ImportPreview` components
- TagBar dropdown/chip patterns

---

## Testing

### Unit Tests (in `__tests__` folders alongside components)
- `src/components/home/__tests__/HomeTagSelector.test.tsx` - dropdown selection, default values
- `src/components/home/__tests__/HomeSourcesRow.test.tsx` - add/remove sources, inline input
- `src/components/home/__tests__/HomeTabs.test.tsx` - tab switching, state preservation

### E2E Tests (`e2e/home-tabs.spec.ts`)
- Search with sources and tags → verify API receives all params
- Import flow works from Import tab → existing modal flow
- Tab switching preserves state within session
- Keyboard navigation through all elements
- Accessibility: tab focus order, ARIA roles for tabs

### Regression Tests
- Run existing E2E suite to verify no regressions in:
  - Navigation search functionality
  - Import modal flow
  - Source chip behavior
  - Results page tag handling

### Manual Verification
- Visual review on desktop and mobile widths
- Test with 0, 3, and 5 sources for layout
- Test all tag dropdown combinations
- Verify existing import flow still works
- Screen reader testing for tab navigation

---

## Documentation Updates

- `docs/feature_deep_dives/add_sources_citations.md` - Update entry points section
- `docs/docs_overall/architecture.md` - Update home page description if significant
