# Simplify Rewrite and Edit Workflow

## Initial Instructions

> I want to simplify the way that editing and rewriting work.
>
> I want there to be 3 buttons under action menu:
> - Rewrite
> - Rewrite with feedback
> - Edit with feedback
>
> Feedback should take the form of either A) specifying tags as to how rewriting or editing should be done or B) providing links to supplement the article.
> There should be a single apply button that applies both sources and tag feedback and initiates regenerating the article - both for rewrites and edits.

## Background References

- `docs/feature_deep_dives/tag_system.md` - Tag system with AI-powered tagging
- `docs/planning/lexical_editor_framework/lexical_state_tracking_refactor.md` - Editor state management
- `docs/docs_overall/architecture.md` - System architecture
- `docs/planning/link_creation_optimization/link_whitelist_and_display_plan.md` - Link overlay system
- `docs/docs_overall/product_overview.md` - Product features
- `docs/docs_overall/white_paper.md` - Product philosophy

---

## Summary

Replace the current split button (Rewrite + dropdown) with a single **Action** dropdown containing 3 options. Consolidate "tags-only" options into "with feedback" options that include both tags AND sources.

## Current State

- Split button: "Rewrite" main button + dropdown with "Rewrite with tags", "Edit with tags", "Rewrite with feedback"
- `TagBarMode` enum: `Normal`, `RewriteWithTags`, `EditWithTags`
- `FeedbackPanel` component already supports both tags and sources

## Target State

Single Action dropdown:
```
[Action ▾]
├── Rewrite              → Immediate regeneration (SkipMatch mode)
├── Rewrite with feedback → Opens FeedbackPanel (tags + sources)
└── Edit with feedback    → Opens FeedbackPanel (tags + sources)
```

### Key Behaviors

| Option | Panel Opens? | Result |
|--------|--------------|--------|
| Rewrite | No | Immediate regeneration from original query |
| Rewrite with feedback | Yes | User configures tags + sources, then Apply regenerates |
| Edit with feedback | Yes | User configures tags + sources, then Apply edits current content |

---

## Implementation Steps

### Step 1: Rename Types (schemas.ts)

```typescript
// Before
enum TagBarMode { Normal = 0, RewriteWithTags = 1, EditWithTags = 2 }

// After
enum FeedbackMode { Normal = 0, RewriteWithFeedback = 1, EditWithFeedback = 2 }
```

**File:** `src/lib/schemas/schemas.ts`

### Step 2: Update Reducer (tagModeReducer.ts)

- Rename `TagModeState` → `FeedbackModeState`
- Rename `TagModeAction` → `FeedbackModeAction`
- Rename action types: `ENTER_REWRITE_MODE` → `ENTER_REWRITE_FEEDBACK_MODE`, etc.
- Update selector function names

**File:** `src/reducers/tagModeReducer.ts`

### Step 3: Update TagBar Component

- Update imports to use new names
- Update mode checks: `TagBarMode.RewriteWithTags` → `FeedbackMode.RewriteWithFeedback`

**File:** `src/components/TagBar.tsx`

### Step 4: Update FeedbackPanel Component

- Update mode imports and checks
- Panel title based on mode: "Rewrite with Feedback" / "Edit with Feedback"

**File:** `src/components/FeedbackPanel.tsx`

### Step 5: Replace Action Buttons in Results Page

**File:** `src/app/results/page.tsx`

Remove:
- Split button (Rewrite + dropdown toggle)
- Dropdown with "Rewrite with tags", "Edit with tags", "Rewrite with feedback"

Add:
```tsx
<div className="relative">
  <button onClick={() => setShowActionMenu(!showActionMenu)}>
    Action ▾
  </button>
  {showActionMenu && (
    <div className="dropdown-menu">
      <button onClick={handleRewrite}>Rewrite</button>
      <button onClick={handleRewriteWithFeedback}>Rewrite with feedback</button>
      <button onClick={handleEditWithFeedback}>Edit with feedback</button>
    </div>
  )}
</div>
```

Wire handlers:
- `handleRewrite`: Call `handleUserAction(...)` with `UserInputType.RewriteWithTags` (no feedback panel)
- `handleRewriteWithFeedback`: `dispatchTagAction({ type: 'ENTER_REWRITE_FEEDBACK_MODE' })` + `setShowFeedbackPanel(true)`
- `handleEditWithFeedback`: `dispatchTagAction({ type: 'ENTER_EDIT_FEEDBACK_MODE' })` + `setShowFeedbackPanel(true)`

### Step 6: Update Tests

**Files:**
- `src/lib/schemas/schemas.test.ts`
- `src/reducers/tagModeReducer.test.ts`
- `src/components/TagBar.test.tsx`
- `src/app/results/page.test.tsx`
- `src/__tests__/e2e/helpers/pages/ResultsPage.ts`

Update:
- Enum/type references
- Test IDs: `rewrite-with-tags` → removed, `rewrite-with-feedback` kept
- Selector patterns

---

## Files to Modify

| File | Change Type |
|------|-------------|
| `src/lib/schemas/schemas.ts` | Rename enum |
| `src/reducers/tagModeReducer.ts` | Rename types, actions |
| `src/components/TagBar.tsx` | Update mode refs |
| `src/components/FeedbackPanel.tsx` | Update mode refs |
| `src/app/results/page.tsx` | Replace UI, wire handlers |
| `src/lib/schemas/schemas.test.ts` | Update tests |
| `src/reducers/tagModeReducer.test.ts` | Update tests |
| `src/components/TagBar.test.tsx` | Update tests |
| `src/app/results/page.test.tsx` | Update tests |
| `src/__tests__/e2e/helpers/pages/ResultsPage.ts` | Update E2E helpers |

---

## Verification

1. Run `npm run type-check` after each step
2. Run `npm test` to verify unit tests pass
3. Run `npm run test:e2e -- --project=chromium-unauth` for E2E
4. Manual testing of all 3 action menu options
