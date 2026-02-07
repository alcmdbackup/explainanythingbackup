# Redesign Saved Look Like Explore Research

**Date**: 2026-01-21T20:29:36-0800
**Git Commit**: 00d236d656264f7f2b520a643961913ebc00920a
**Branch**: feat/redesign_saved_look_like_explore_20260121

## Problem Statement

The `/userlibrary` page (saved articles) currently uses a table-based layout (`ExplanationsTablePage`) while the `/explore` page uses a modern feed-style layout with `FeedCard` components. The user wants visual consistency by having saved articles use the same card component as explore, and removing the loading indicator.

## High Level Summary

### Current State Comparison

| Aspect | /userlibrary (Saved) | /explore |
|--------|---------------------|----------|
| **Layout** | Table with rows | Single-column feed (max-w-3xl) |
| **Card Component** | `ExplanationsTablePage` | `FeedCard` |
| **Data Display** | Title, preview, dates, views | Title, timestamp, preview, metrics |
| **Loading** | Custom spinner with "Loading your library..." | None visible in research |
| **Styling** | Table borders, alternating rows | `feed-card` CSS class with hover border effect |

### Key Finding: FeedCard Component

The `FeedCard` component (`src/components/explore/FeedCard.tsx`) is the ideal reuse candidate:

**Props it expects:**
```typescript
interface FeedCardProps {
  explanation: {
    id: number;
    explanation_title: string;
    content: string;
    summary_teaser?: string | null;
    timestamp: string;  // ISO format
  };
  metrics?: {
    total_views: number;
    total_saves: number;
  };
  index?: number;  // For animation stagger
}
```

**Data the saved page already has:**
- `id` ✓
- `explanation_title` ✓
- `content` ✓
- `timestamp` ✓
- `saved_timestamp` (not used by FeedCard but available)

**Data gaps:**
- `summary_teaser` - May not be in current query
- `total_views` / `total_saves` - Not currently fetched for saved items

### Loading Indicator to Remove

Located in `src/components/ExplanationsTablePage.tsx` lines 109-113:
```tsx
<div data-testid="library-loading" className="text-center py-16 scholar-card">
  <div className="w-16 h-16 mx-auto mb-4 border-4 border-[var(--accent-gold)]/30
                   border-t-[var(--accent-gold)] rounded-full animate-spin"></div>
  <p className="font-body text-[var(--text-muted)] text-lg">Loading your library...</p>
</div>
```

## Documents Read

- `docs/docs_overall/getting_started.md`
- `docs/docs_overall/architecture.md`
- `docs/docs_overall/project_workflow.md`

## Code Files Read

### Saved/User Library Page
- `src/app/userlibrary/page.tsx` - Main page component (46 lines)
- `src/components/ExplanationsTablePage.tsx` - Table display component (239 lines)
- `src/lib/services/userLibrary.ts` - Service layer for database queries
- `src/app/userlibrary/page.test.tsx` - Unit tests

### Explore Page Components
- `src/components/explore/ExploreGalleryPage.tsx` - Main explore container
- `src/components/explore/FeedCard.tsx` - Feed-style card component
- `src/components/explore/ExplanationCard.tsx` - Alternative gallery card
- `src/components/explore/index.ts` - Component exports

### Styling
- `src/app/globals.css` - Card CSS classes (lines 2600-2748)

### Tests
- `src/components/explore/FeedCard.test.tsx`
- `src/__tests__/e2e/helpers/pages/UserLibraryPage.ts` - E2E test helpers

## Detailed Findings

### 1. User Library Page (`src/app/userlibrary/page.tsx`)

The page is a client component that:
1. Fetches user ID from Supabase Auth on mount
2. Calls `getUserLibraryExplanationsAction(userId)` server action
3. Maps `saved_timestamp` to `dateSaved` property
4. Renders `ExplanationsTablePage` with title "My Library"

**Key state:**
```typescript
const [userExplanations, setUserExplanations] = useState<UserSavedExplanationType[]>([]);
const [error, setError] = useState<string | null>(null);
const [isLoading, setIsLoading] = useState(true);
```

### 2. ExplanationsTablePage (`src/components/ExplanationsTablePage.tsx`)

Currently renders:
- Header section with Navigation and page title
- Loading spinner (when `isLoading=true`)
- Error display (when `error` exists)
- Empty state (when no explanations)
- Table with sortable columns: Title, Preview, Created, Views (conditional), Saved (conditional)

### 3. FeedCard Component (`src/components/explore/FeedCard.tsx`)

Layout structure:
- Clickable article wrapping Next.js Link
- Timestamp display (formatted as "Month Day, Year")
- Title with line-clamp-2
- Preview text with line-clamp-3 (uses `summary_teaser` or stripped content)
- Engagement bar with view count, save count, share button

**CSS class:** `feed-card`
- Background: `var(--surface-secondary)`
- Border: `var(--border-default)`, changes to `var(--border-strong)` on hover
- Border radius: 0.75rem
- Animation: 0.4s entrance with staggered delay

### 4. Data Schema Comparison

**UserSavedExplanationType** (current saved page data):
```typescript
{
  id: number;
  explanation_title: string;
  content: string;
  primary_topic_id: number;
  secondary_topic_id?: number;
  status: ExplanationStatus;
  timestamp: string;
  saved_timestamp: string;  // When user saved
}
```

**FeedCard expects:**
```typescript
{
  id: number;
  explanation_title: string;
  content: string;
  summary_teaser?: string | null;
  timestamp: string;
}
```

### 5. Layout Differences

**Explore page layout:**
```tsx
<div className="max-w-3xl mx-auto space-y-4">
  {explanations.map((explanation, index) => (
    <FeedCard key={explanation.id} explanation={explanation} ... />
  ))}
</div>
```

**User Library current layout:**
- Full-width table with fixed columns
- Max-height 70vh with scrollable overflow

### 6. E2E Test Implications

The test helper `UserLibraryPage.ts` has methods:
- `waitForLoading()` - looks for `[data-testid="library-loading"]`
- `waitForLoadingToFinish()` - waits for spinner to disappear
- `isLoading()` - checks if spinner visible

These will need updating when the loading indicator is removed.

## Architecture Notes

### Component Reusability

`FeedCard` is exported from `src/components/explore/index.ts` and can be imported anywhere:
```typescript
import { FeedCard } from '@/components/explore';
```

### Server Action Pattern

The existing `getUserLibraryExplanationsAction` follows the project's action wrapping pattern and could be extended to include `summary_teaser` data if needed.

### Design System Compliance

Both components use the project's CSS variable system (`--surface-secondary`, `--accent-gold`, etc.) so styling will be consistent.
