# Redesign Saved Look Like Explore Plan

## Background

The `/userlibrary` page displays saved articles in a table format (`ExplanationsTablePage`) while the `/explore` page uses a modern feed-style layout with `FeedCard` components. Users expect visual consistency across the app. The library page also has a loading spinner that adds unnecessary visual noise.

## Problem

The saved articles page looks dated compared to explore. The table layout doesn't match the card-based design language used elsewhere. Users want to see their saved articles in the same feed-style cards as explore, with a "Saved X ago" indicator to distinguish library items. The loading indicator should be removed for a cleaner experience.

## Options Considered

### Date Display
1. ~~Saved date as primary~~ - Would differ too much from explore
2. ~~Both dates at top~~ - Too cluttered
3. **Published date at top, "Saved X ago" on right of engagement bar** ✓ - Keeps consistency with explore, adds library context subtly

### Component Approach
1. **Extend FeedCard with optional `savedDate` prop** ✓ - Minimal changes, one component
2. ~~Create separate LibraryCard~~ - Unnecessary duplication

### Metrics
1. **Full metrics via join with explanationMetrics** ✓ - Complete data
2. ~~Views only~~ - Incomplete
3. ~~Skip metrics~~ - Inconsistent with explore

## Phased Execution Plan

### Phase 1: Extend FeedCard Component

**File: `src/components/explore/FeedCard.tsx`**

1. Add `savedDate` prop to interface:
```typescript
interface FeedCardProps {
  explanation: {
    id: number;
    explanation_title: string;
    content: string;
    summary_teaser?: string | null;
    timestamp: string;
  };
  metrics?: {
    total_views: number;
    total_saves: number;
  };
  index?: number;
  savedDate?: string;  // NEW: ISO timestamp for when user saved the article
}
```

2. Add relative time formatting function with error handling:
```typescript
/**
 * Formats a saved timestamp as relative time (e.g., "Saved 2 days ago")
 * Returns empty string if timestamp is invalid to avoid runtime errors.
 * Self-contained - does not depend on formatTimestamp to avoid export issues.
 */
function formatRelativeTime(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    // Check for invalid date
    if (isNaN(date.getTime())) {
      return '';
    }
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Saved today';
    if (diffDays === 1) return 'Saved yesterday';
    if (diffDays < 7) return `Saved ${diffDays} days ago`;
    if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `Saved ${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
    }
    if (diffDays < 365) {
      const months = Math.floor(diffDays / 30);
      return `Saved ${months} ${months === 1 ? 'month' : 'months'} ago`;
    }
    // For dates older than a year, format inline (avoid depending on private formatTimestamp)
    return `Saved ${date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })}`;
  } catch {
    return '';
  }
}
```

3. Update engagement bar to show saved date on right (minimal change to existing layout):
```tsx
{/* Engagement bar - not part of link */}
{/* IMPORTANT: Keep existing flex structure, just add justify-between and wrap left items */}
<div className="flex items-center justify-between px-5 py-3 border-t border-[var(--border-default)] text-sm">
  {/* Wrap existing items in a div to group them on the left */}
  <div className="flex items-center gap-4">
    <span className="inline-flex items-center gap-1.5 text-[var(--text-muted)]">
      <EyeIcon className="w-4 h-4" />
      {formatNumber(metrics?.total_views ?? 0)}
    </span>
    <span className="inline-flex items-center gap-1.5 text-[var(--text-muted)]">
      <BookmarkIcon className="w-4 h-4" />
      {formatNumber(metrics?.total_saves ?? 0)}
    </span>
    <ShareButton url={shareUrl} variant="text" />
  </div>
  {/* Add saved date on the right - only renders when prop is provided */}
  {savedDate && (
    <span className="text-[var(--text-muted)] font-ui" data-testid="saved-date">
      {formatRelativeTime(savedDate)}
    </span>
  )}
</div>
```

**Note on layout change:** The current FeedCard engagement bar is:
```tsx
<div className="flex items-center gap-4 px-5 py-3 ...">
  <span>...</span>  {/* views */}
  <span>...</span>  {/* saves */}
  <ShareButton />
</div>
```

We change to `justify-between` and wrap existing items. When `savedDate` is NOT provided (explore page), the right side is empty and items stay left-aligned. When `savedDate` IS provided (library), it appears on the right. This is a safe additive change that doesn't affect explore page layout.

### Phase 2: Update Data Fetching

**File: `src/lib/services/userLibrary.ts`**

Update `getUserLibraryExplanationsImpl` (lines 134-178) to:
1. Add `summary_teaser` to the select query
2. Fetch metrics from `explanationMetrics` table
3. Merge metrics into returned data

Current query uses correct FK syntax: `explanations!userLibrary_explanationid_fkey` (with `!`)

```typescript
async function getUserLibraryExplanationsImpl(userid: string) {
  assertUserId(userid, 'getUserLibraryExplanations');
  const supabase = await createSupabaseServerClient();

  // Step 1: Fetch library entries with explanations (add summary_teaser)
  const { data, error } = await supabase
    .from('userLibrary')
    .select(`
      explanationid,
      created,
      explanations!userLibrary_explanationid_fkey (
        id,
        explanation_title,
        content,
        summary_teaser,
        primary_topic_id,
        timestamp,
        secondary_topic_id,
        status
      )
    `)
    .eq('userid', userid);

  if (error) {
    logger.error('Error fetching user library explanations', { error: error.message, userid });
    throw error;
  }

  if (!data || data.length === 0) return [];

  // Step 2: Fetch metrics for all explanation IDs
  const explanationIds = data.map((row: any) => row.explanationid);
  const { data: metricsData, error: metricsError } = await supabase
    .from('explanationMetrics')
    .select('explanationid, total_views, total_saves')
    .in('explanationid', explanationIds);

  if (metricsError) {
    logger.warn('Failed to fetch metrics for library explanations', { error: metricsError.message });
    // Continue without metrics rather than failing entirely
  }

  // Step 3: Create metrics lookup map
  const metricsMap = new Map<number, { total_views: number; total_saves: number }>();
  if (metricsData) {
    for (const m of metricsData) {
      metricsMap.set(m.explanationid, {
        total_views: m.total_views ?? 0,
        total_saves: m.total_saves ?? 0,
      });
    }
  }

  // Step 4: Transform and merge data
  return data.map((row: any) => {
    const explanation = row.explanations || {};
    const metrics = metricsMap.get(row.explanationid) || { total_views: 0, total_saves: 0 };
    return {
      id: explanation.id,
      explanation_title: explanation.explanation_title,
      content: explanation.content,
      summary_teaser: explanation.summary_teaser ?? null,
      primary_topic_id: explanation.primary_topic_id,
      timestamp: explanation.timestamp,
      saved_timestamp: row.created,
      secondary_topic_id: explanation.secondary_topic_id,
      status: explanation.status,
      total_views: metrics.total_views,
      total_saves: metrics.total_saves,
    };
  });
}
```

**File: `src/lib/schemas/schemas.ts`**

Extend existing `UserSavedExplanationType` to include metrics (don't create new type):

```typescript
// Extend existing schema to include metrics for library display
export const userSavedExplanationWithMetricsSchema = userSavedExplanationSchema.extend({
  summary_teaser: z.string().nullable().optional(),
  total_views: z.number().int().min(0).default(0),
  total_saves: z.number().int().min(0).default(0),
});

export type UserSavedExplanationWithMetrics = z.infer<typeof userSavedExplanationWithMetricsSchema>;
```

### Phase 3: Rewrite User Library Page

**File: `src/app/userlibrary/page.tsx`**

Replace table with FeedCard layout. Use existing `supabase_browser` import (matches current pattern):

```tsx
'use client';

import { useState, useEffect } from 'react';
import { type UserSavedExplanationWithMetrics } from '@/lib/schemas/schemas';
import { getUserLibraryExplanationsAction } from '@/actions/actions';
import { logger } from '@/lib/client_utilities';
import { FeedCard } from '@/components/explore';
import Navigation from '@/components/Navigation';
import { supabase_browser } from '@/lib/supabase';

export default function UserLibraryPage() {
  const [explanations, setExplanations] = useState<UserSavedExplanationWithMetrics[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const { data: userData, error: userError } = await supabase_browser.auth.getUser();
        if (userError || !userData?.user?.id) {
          throw new Error('Could not get user information. Please log in.');
        }
        const result = await getUserLibraryExplanationsAction(userData.user.id);
        setExplanations(result);
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : 'Failed to load library';
        logger.error('Failed to load user library explanations:', { error: errorMessage });
        setError(errorMessage);
      }
    }
    load();
  }, []);

  return (
    <main className="min-h-screen bg-[var(--surface-primary)]">
      <Navigation showSearchBar />

      <div className="pt-8 pb-16">
        <header className="max-w-3xl mx-auto px-4 mb-8">
          <h1 className="atlas-display-section text-[var(--text-primary)]">
            My Library
          </h1>
        </header>

        {error && (
          <div className="max-w-3xl mx-auto px-4 mb-6" data-testid="library-error">
            <p className="text-[var(--destructive)] bg-[var(--surface-elevated)] p-4 rounded-md border-l-4 border-l-[var(--destructive)]">
              {error}
            </p>
          </div>
        )}

        {explanations.length === 0 && !error ? (
          <div className="max-w-3xl mx-auto px-4 text-center py-16" data-testid="library-empty-state">
            <svg className="w-16 h-16 mx-auto mb-4 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
            </svg>
            <p className="text-lg font-display text-[var(--text-primary)]">Nothing saved yet</p>
            <p className="text-[var(--text-muted)] mt-1">Save explanations you want to revisit.</p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-4 space-y-4">
            {explanations.map((exp, index) => (
              <FeedCard
                key={exp.id}
                explanation={{
                  id: exp.id,
                  explanation_title: exp.explanation_title,
                  content: exp.content,
                  summary_teaser: exp.summary_teaser,
                  timestamp: exp.timestamp,
                }}
                metrics={{
                  total_views: exp.total_views,
                  total_saves: exp.total_saves,
                }}
                savedDate={exp.saved_timestamp}
                index={index}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
```

**Key changes:**
- Remove `isLoading` state entirely (no loading indicator)
- Remove `ExplanationsTablePage` import
- Use `FeedCard` with `savedDate` prop
- Keep `supabase_browser` import (matches existing pattern)
- Preserve `data-testid` attributes for E2E tests

### Phase 4: Update Tests

**File: `src/components/explore/FeedCard.test.tsx`**

Add comprehensive tests for `savedDate` and `formatRelativeTime`:

```typescript
describe('savedDate prop', () => {
  it('renders without savedDate (existing behavior unchanged)', () => {
    render(<FeedCard explanation={mockExplanation} />);
    expect(screen.queryByTestId('saved-date')).not.toBeInTheDocument();
  });

  it('renders savedDate on right side of engagement bar', () => {
    render(<FeedCard explanation={mockExplanation} savedDate="2026-01-19T12:00:00Z" />);
    expect(screen.getByTestId('saved-date')).toBeInTheDocument();
  });

  it('displays "Saved today" for same-day timestamps', () => {
    const today = new Date().toISOString();
    render(<FeedCard explanation={mockExplanation} savedDate={today} />);
    expect(screen.getByText('Saved today')).toBeInTheDocument();
  });

  it('displays "Saved yesterday" for 1-day-old timestamps', () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    render(<FeedCard explanation={mockExplanation} savedDate={yesterday} />);
    expect(screen.getByText('Saved yesterday')).toBeInTheDocument();
  });

  it('displays "Saved X days ago" for 2-6 day old timestamps', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
    render(<FeedCard explanation={mockExplanation} savedDate={threeDaysAgo} />);
    expect(screen.getByText('Saved 3 days ago')).toBeInTheDocument();
  });

  it('displays "Saved X weeks ago" for 7-29 day old timestamps', () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString();
    render(<FeedCard explanation={mockExplanation} savedDate={twoWeeksAgo} />);
    expect(screen.getByText('Saved 2 weeks ago')).toBeInTheDocument();
  });

  it('displays "Saved X months ago" for 30-364 day old timestamps', () => {
    const twoMonthsAgo = new Date(Date.now() - 60 * 86400000).toISOString();
    render(<FeedCard explanation={mockExplanation} savedDate={twoMonthsAgo} />);
    expect(screen.getByText('Saved 2 months ago')).toBeInTheDocument();
  });

  it('handles invalid date gracefully (returns empty string)', () => {
    render(<FeedCard explanation={mockExplanation} savedDate="invalid-date" />);
    // Should render the span but with empty content
    const savedDateEl = screen.queryByTestId('saved-date');
    expect(savedDateEl?.textContent).toBe('');
  });

  it('uses singular form for 1 week/month', () => {
    const oneWeekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    render(<FeedCard explanation={mockExplanation} savedDate={oneWeekAgo} />);
    expect(screen.getByText('Saved 1 week ago')).toBeInTheDocument();
  });
});
```

**File: `src/app/userlibrary/page.test.tsx`**

Update tests to match new FeedCard-based structure:

```typescript
describe('UserLibraryPage', () => {
  // Remove all loading state tests - no longer applicable

  describe('rendering', () => {
    it('should render FeedCard components for saved explanations', async () => {
      mockGetUserLibraryExplanationsAction.mockResolvedValue(mockExplanations);
      render(<UserLibraryPage />);
      await waitFor(() => {
        expect(screen.getAllByTestId('feed-card')).toHaveLength(mockExplanations.length);
      });
    });

    it('should pass savedDate prop to FeedCard', async () => {
      mockGetUserLibraryExplanationsAction.mockResolvedValue(mockExplanations);
      render(<UserLibraryPage />);
      await waitFor(() => {
        expect(screen.getAllByTestId('saved-date')).toHaveLength(mockExplanations.length);
      });
    });
  });

  describe('empty state', () => {
    it('should show empty state when no saved explanations', async () => {
      mockGetUserLibraryExplanationsAction.mockResolvedValue([]);
      render(<UserLibraryPage />);
      await waitFor(() => {
        expect(screen.getByTestId('library-empty-state')).toBeInTheDocument();
      });
    });
  });

  describe('error state', () => {
    it('should show error message when fetch fails', async () => {
      mockGetUserLibraryExplanationsAction.mockRejectedValue(new Error('Network error'));
      render(<UserLibraryPage />);
      await waitFor(() => {
        expect(screen.getByTestId('library-error')).toBeInTheDocument();
      });
    });
  });
});
```

**File: `src/lib/services/userLibrary.test.ts`**

Add mandatory tests for metrics fetching:

```typescript
describe('getUserLibraryExplanations with metrics', () => {
  it('should fetch and merge metrics from explanationMetrics table', async () => {
    // Mock userLibrary query
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ data: mockLibraryData, error: null }),
    });
    // Mock explanationMetrics query
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnThis(),
      in: jest.fn().mockResolvedValue({ data: mockMetricsData, error: null }),
    });

    const result = await getUserLibraryExplanations('user-123');
    expect(result[0].total_views).toBe(100);
    expect(result[0].total_saves).toBe(10);
  });

  it('should return zero metrics when explanationMetrics query fails', async () => {
    // Mock userLibrary query success
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ data: mockLibraryData, error: null }),
    });
    // Mock explanationMetrics query failure
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnThis(),
      in: jest.fn().mockResolvedValue({ data: null, error: { message: 'Query failed' } }),
    });

    const result = await getUserLibraryExplanations('user-123');
    expect(result[0].total_views).toBe(0);
    expect(result[0].total_saves).toBe(0);
  });

  it('should include summary_teaser in returned data', async () => {
    const dataWithTeaser = [{
      ...mockLibraryData[0],
      explanations: { ...mockLibraryData[0].explanations, summary_teaser: 'Test teaser' }
    }];
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ data: dataWithTeaser, error: null }),
    });
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnThis(),
      in: jest.fn().mockResolvedValue({ data: [], error: null }),
    });

    const result = await getUserLibraryExplanations('user-123');
    expect(result[0].summary_teaser).toBe('Test teaser');
  });
});
```

**File: `src/__tests__/e2e/helpers/pages/UserLibraryPage.ts`**

Update E2E helpers for card-based layout:

```typescript
// REMOVE these methods (no longer applicable):
// - waitForLoading()
// - waitForLoadingToFinish()
// - isLoading()
// - clickSortByTitle()
// - clickSortByDate()
// - getSortIndicator()

// ADD/UPDATE these methods:

/** Wait for FeedCard components to appear */
async waitForCards(timeout = 30000): Promise<void> {
  await this.page.waitForSelector('[data-testid="feed-card"]', {
    state: 'attached',
    timeout,
  });
}

/** Get count of displayed cards */
async getCardCount(): Promise<number> {
  return this.page.locator('[data-testid="feed-card"]').count();
}

/** Wait for library page to be ready (cards, empty, or error) */
async waitForLibraryReady(timeout = 30000): Promise<'cards' | 'empty' | 'error'> {
  const result = await Promise.race([
    this.page.waitForSelector('[data-testid="feed-card"]', { timeout })
      .then(() => 'cards' as const),
    this.page.waitForSelector('[data-testid="library-empty-state"]', { timeout })
      .then(() => 'empty' as const),
    this.page.waitForSelector('[data-testid="library-error"]', { timeout })
      .then(() => 'error' as const),
  ]);
  return result;
}

/** Click on a card by index to navigate to results */
async clickCardByIndex(index: number): Promise<void> {
  const cards = this.page.locator('[data-testid="feed-card"]');
  await cards.nth(index).click();
}
```

**File: `src/__tests__/e2e/specs/03-library/library.spec.ts`**

Update E2E specs for new card-based UI:

```typescript
// Tests to UPDATE:

test('should show loading state when navigating to library', async () => {
  // REMOVE this test entirely - no loading state anymore
});

test('should display user library page after authentication', async () => {
  await libraryPage.navigate();
  const state = await libraryPage.waitForLibraryReady();

  // Should show cards, empty state, OR error
  expect(['cards', 'empty', 'error']).toContain(state);
});

test('should have sortable table headers when content loads', async () => {
  // REMOVE this test - no table headers in card layout
});

test('should allow sorting by title', async () => {
  // REMOVE this test - no sorting in card layout
});

test('should allow sorting by date', async () => {
  // REMOVE this test - no sorting in card layout
});

test('should navigate to results page when clicking card', async ({ authenticatedPage }) => {
  await libraryPage.navigate();
  await libraryPage.waitForLibraryReady();

  const cardCount = await libraryPage.getCardCount();
  expect(cardCount).toBeGreaterThan(0);

  await libraryPage.clickCardByIndex(0);

  await authenticatedPage.waitForURL(/\/results\?explanation_id=/, { timeout: 10000 });
  expect(authenticatedPage.url()).toContain('/results?explanation_id=');
});

test('should show saved date on cards', async ({ authenticatedPage }) => {
  await libraryPage.navigate();
  await libraryPage.waitForLibraryReady();

  // Cards should have saved-date element
  const savedDates = authenticatedPage.locator('[data-testid="saved-date"]');
  expect(await savedDates.count()).toBeGreaterThan(0);
});

// KEEP these tests (still applicable):
// - should display page title when content loads
// - should have search bar in navigation
// - should handle search from library page
```

## Testing

### CRITICAL: Test Update Execution Order

**Tests MUST be updated in this order to prevent cascading failures:**

1. **First: E2E Helper (`UserLibraryPage.ts`)** - Update helpers BEFORE specs
   - Remove: `waitForLoading()`, `waitForLoadingToFinish()`, `isLoading()`, `clickSortByTitle()`, `clickSortByDate()`, `getSortIndicator()`
   - Add: `waitForCards()`, `getCardCount()`, `clickCardByIndex()`
   - Update: `waitForLibraryReady()` to use `feed-card` selector

2. **Second: E2E Specs (`library.spec.ts`)** - Update specs to match new helpers
   - Remove tests: loading state, sorting tests (5 tests total)
   - Update selectors: table → feed-card
   - Add test: saved date display

3. **Third: Unit Tests** - Add new tests
   - `FeedCard.test.tsx` - Add savedDate tests
   - `userLibrary.test.ts` - Add metrics tests
   - `userlibrary/page.test.tsx` - Rewrite for cards

4. **Fourth: Component/Service Changes** - Implement the actual changes

### Unit Tests (MANDATORY)
- `FeedCard.test.tsx` - Add savedDate prop tests (9 new tests for relative time formatting)
- `userlibrary/page.test.tsx` - Rewrite for FeedCard structure (remove loading tests, add card tests)
- `userLibrary.test.ts` - Add metrics fetching tests (4 new tests including null safety)

### Additional Null Safety Tests for formatRelativeTime

```typescript
// Add to FeedCard.test.tsx savedDate tests
it('handles empty string gracefully', () => {
  render(<FeedCard explanation={mockExplanation} savedDate="" />);
  // Empty string is falsy, so savedDate span should not render
  expect(screen.queryByTestId('saved-date')).not.toBeInTheDocument();
});

it('handles non-ISO date formats gracefully', () => {
  render(<FeedCard explanation={mockExplanation} savedDate="January 1, 2026" />);
  // Non-ISO format should still parse via Date constructor
  expect(screen.getByTestId('saved-date')).toBeInTheDocument();
});

// Note: null and undefined won't reach formatRelativeTime due to
// conditional rendering: {savedDate && ...}
```

### Additional Null Safety Tests for Metrics Fetching

```typescript
// Add to userLibrary.test.ts
it('should handle null metricsData gracefully', async () => {
  mockSupabase.from.mockReturnValueOnce({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockResolvedValue({ data: mockLibraryData, error: null }),
  });
  mockSupabase.from.mockReturnValueOnce({
    select: jest.fn().mockReturnThis(),
    in: jest.fn().mockResolvedValue({ data: null, error: null }), // null, not error
  });

  const result = await getUserLibraryExplanations('user-123');
  expect(result[0].total_views).toBe(0);
  expect(result[0].total_saves).toBe(0);
});
```

### E2E Tests
- Update `UserLibraryPage.ts` helper - Remove table methods, add card methods
- Update `library.spec.ts` - Remove sorting tests, update selectors for cards
- Run full E2E suite to catch any other affected specs

### Manual Verification
1. Navigate to /userlibrary with saved articles
2. Verify cards match explore page style visually
3. Verify "Saved X ago" shows correctly on each card (check today, days ago, weeks ago)
4. Verify metrics (views/saves) display correctly
5. Verify no loading spinner appears on navigation
6. Test empty state (new user with no saves)
7. Test error state (network failure simulation)
8. Verify clicking card navigates to /results?explanation_id=X

## Documentation Updates

- `docs/feature_deep_dives/saved_articles.md` - Create if doesn't exist, document new card-based UI
- `docs/docs_overall/design_style_guide.md` - Note FeedCard reuse pattern if not already documented

## Files Modified Summary

| File | Change |
|------|--------|
| `src/components/explore/FeedCard.tsx` | Add `savedDate` prop, `formatRelativeTime` function with error handling |
| `src/lib/services/userLibrary.ts` | Add `summary_teaser` to query, fetch/merge metrics from `explanationMetrics` |
| `src/lib/schemas/schemas.ts` | Extend `UserSavedExplanationType` with metrics fields |
| `src/app/userlibrary/page.tsx` | Rewrite to use FeedCard, remove loading state, keep `supabase_browser` |
| `src/components/explore/FeedCard.test.tsx` | Add 8 tests for savedDate/formatRelativeTime |
| `src/app/userlibrary/page.test.tsx` | Rewrite for FeedCard structure |
| `src/lib/services/userLibrary.test.ts` | Add 3 tests for metrics fetching |
| `src/__tests__/e2e/helpers/pages/UserLibraryPage.ts` | Remove table methods, add card methods |
| `src/__tests__/e2e/specs/03-library/library.spec.ts` | Update specs for card-based UI |

## Rollback Plan

If issues arise after deployment:
1. Revert the branch merge
2. All changes are contained in these 9 files
3. No database schema changes required
4. No environment variable changes
