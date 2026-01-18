# Make Explore Feed Style Plan

## Background
The explore page currently uses a Pinterest-style masonry grid layout with glassmorphism cards. While visually appealing, this layout doesn't emphasize engagement metrics or provide easy sharing functionality. Users have requested a more Reddit-style feed that surfaces social proof (views, saves) and enables content sharing.

## Problem
The current explore page layout:
1. Uses multi-column masonry which de-emphasizes individual content
2. Only shows view counts when sorting by "top" - no saves visible
3. Has no share functionality anywhere in the app
4. Doesn't create a clear content hierarchy (title → preview → engagement)

## Options Considered

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| A: Layout Only | Just change masonry → single column | Fast, minimal changes | Doesn't add engagement bar |
| **B: New FeedCard** | Create dedicated feed card with engagement bar | Clean separation, uses existing data | New component to maintain |
| C: Full Voting | Add upvote/downvote system | True Reddit experience | Major backend work, scope creep |

**Selected: Option B** - Best balance of Reddit-style UX without backend changes.

## Phased Execution Plan

### Phase 1: ShareButton Component
Create a reusable share button component.

**Create `src/components/ShareButton.tsx`:**
```tsx
'use client';

import { useState } from 'react';
import { LinkIcon, CheckIcon } from '@heroicons/react/24/outline';

interface ShareButtonProps {
  url: string;
  variant?: 'icon' | 'text';
  className?: string;
}

export default function ShareButton({ url, variant = 'text', className = '' }: ShareButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleShare = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = url;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      onClick={handleShare}
      className={`inline-flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors ${className}`}
      aria-label={copied ? 'Link copied' : 'Share link'}
    >
      {copied ? (
        <CheckIcon className="w-4 h-4 text-green-500" />
      ) : (
        <LinkIcon className="w-4 h-4" />
      )}
      {variant === 'text' && (
        <span className="text-sm">{copied ? 'Copied!' : 'Share'}</span>
      )}
    </button>
  );
}
```

**Create `src/components/ShareButton.test.tsx`:**
- Test clipboard copy functionality
- Test copied state toggle
- Test click event propagation stopped
- Test both variants (icon/text)

---

### Phase 2: Data Layer Updates
Modify `getRecentExplanations()` to include metrics from `explanationMetrics` table.

**Verified:** The `explanationMetrics` table exists in Supabase with columns:
- `explanationid` (int, unique) - matches `explanations.id`
- `total_views` (int, default 0)
- `total_saves` (int, default 0)
- `save_rate` (numeric)

**Update `src/lib/schemas/schemas.ts`:**
```typescript
// Extend existing type - keep viewCount for backward compat, add total_saves
export type ExplanationWithMetrics = ExplanationWithViewCount & {
  total_saves?: number;
};
```

**Update `src/lib/services/explanations.ts` - `getRecentExplanations()`:**

Since there's no FK relationship between `explanations` and `explanationMetrics`, we'll fetch metrics separately and merge:

```typescript
// After fetching explanations, get their metrics
const explanationIds = data.map(e => e.id);

// Fetch metrics for these explanations
const { data: metricsData } = await supabase
  .from('explanationMetrics')
  .select('explanationid, total_views, total_saves')
  .in('explanationid', explanationIds);

// Create lookup map
const metricsMap = new Map(
  (metricsData || []).map(m => [m.explanationid, m])
);

// Merge metrics into explanations
return data.map(exp => {
  const metrics = metricsMap.get(exp.id);
  return {
    ...exp,
    viewCount: metrics?.total_views ?? 0,  // Keep viewCount for backward compat
    total_saves: metrics?.total_saves ?? 0,
  };
});
```

**Note:** The existing code uses `viewCount` field name, not `total_views`. We keep `viewCount` for backward compatibility with existing components.

---

### Phase 3: FeedCard Component
Create the Reddit-style card component.

**Create `src/components/explore/FeedCard.tsx`:**
```tsx
'use client';

import Link from 'next/link';
import { EyeIcon, BookmarkIcon } from '@heroicons/react/24/outline';
import ShareButton from '@/components/ShareButton';

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
}

function formatNumber(num: number): string {
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  }
  return num.toString();
}

function formatTimestamp(timestamp: string): string {
  try {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

function stripTitleFromContent(content: string): string {
  return content.replace(/^#\s+.+\n?/, '').trim();
}

export default function FeedCard({ explanation, metrics, index = 0 }: FeedCardProps) {
  const preview = explanation.summary_teaser || stripTitleFromContent(explanation.content);
  const href = `/results?explanation_id=${explanation.id}`;
  const shareUrl = typeof window !== 'undefined'
    ? `${window.location.origin}${href}`
    : href;

  return (
    <article
      className="feed-card"
      style={{ '--card-index': index } as React.CSSProperties}
    >
      {/* Clickable content area */}
      <Link href={href} className="block p-5 hover:bg-[var(--surface-elevated)]/50 transition-colors">
        <time className="text-sm text-[var(--text-muted)] font-sans">
          {formatTimestamp(explanation.timestamp)}
        </time>
        <h2 className="mt-1 text-lg font-display font-semibold text-[var(--text-primary)] line-clamp-2">
          {explanation.explanation_title}
        </h2>
        <p className="mt-2 text-[var(--text-secondary)] font-serif line-clamp-3">
          {preview}
        </p>
      </Link>

      {/* Engagement bar - not part of link */}
      <div className="flex items-center gap-4 px-5 py-3 border-t border-[var(--border-default)] text-sm">
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
    </article>
  );
}
```

**Add to `src/app/globals.css`:**
```css
/* Feed Card - Reddit-style full-width card */
.feed-card {
  background: var(--surface-secondary);
  border: 1px solid var(--border-default);
  border-radius: 0.75rem;
  overflow: hidden;
  transition: border-color 0.2s ease;
}

.feed-card:hover {
  border-color: var(--border-strong);
}

/* Entrance animation */
.feed-card {
  animation: feedCardEntrance 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards;
  animation-delay: calc(var(--card-index, 0) * 0.05s);
  opacity: 0;
}

@keyframes feedCardEntrance {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .feed-card {
    animation: none;
    opacity: 1;
  }
}
```

**Create `src/components/explore/FeedCard.test.tsx`:**
- Test renders title, preview, timestamp
- Test metrics display with formatting (1000 → "1k")
- Test link href is correct
- Test ShareButton receives correct URL
- Test entrance animation index
- Test handles missing metrics gracefully

---

### Phase 4: Integrate into Explore Page
Update ExploreGalleryPage to use new FeedCard.

**Update `src/components/explore/ExploreGalleryPage.tsx`:**
```tsx
// Remove MasonryGrid import
// Add FeedCard import
import FeedCard from './FeedCard';

// Replace MasonryGrid with single-column layout:
<div className="max-w-3xl mx-auto space-y-4">
  {explanations.map((explanation, index) => (
    <FeedCard
      key={explanation.id}
      explanation={explanation}
      metrics={{
        total_views: explanation.viewCount ?? 0,  // viewCount is the standard field name
        total_saves: explanation.total_saves ?? 0,
      }}
      index={index}
    />
  ))}
</div>
```

**Type Update:** Change `explanations: ExplanationWithViewCount[]` to `explanations: ExplanationWithMetrics[]` in props interface.

**Update `src/components/explore/index.ts`:**
- Export FeedCard

---

### Phase 5: Add Share to Results Page
Add ShareButton to the results page action bar.

**Update `src/app/results/page.tsx`:**
```tsx
import ShareButton from '@/components/ShareButton';

// In the action bar area (near Save button):
<ShareButton
  url={`${process.env.NEXT_PUBLIC_BASE_URL}/results?explanation_id=${explanationId}`}
  variant="text"
/>
```

---

### Phase 6: Polish & Test
- Run `npm run lint` and fix issues
- Run `npm run tsc` for type checking
- Run `npm run build` to verify production build
- Run `npm run test` for unit tests
- Run `npm run test:e2e` for E2E tests
- Visual QA in browser (light/dark mode)
- Update documentation

## Testing

### Clipboard API Mock Strategy

For ShareButton unit tests, mock the clipboard API:

```typescript
// In ShareButton.test.tsx setup
const mockWriteText = jest.fn().mockResolvedValue(undefined);
Object.assign(navigator, {
  clipboard: {
    writeText: mockWriteText,
  },
});

// Test success case
it('copies URL to clipboard', async () => {
  render(<ShareButton url="https://example.com/test" />);
  await userEvent.click(screen.getByRole('button'));
  expect(mockWriteText).toHaveBeenCalledWith('https://example.com/test');
});

// Test fallback (clipboard unavailable)
it('uses execCommand fallback when clipboard API fails', async () => {
  mockWriteText.mockRejectedValueOnce(new Error('Clipboard unavailable'));
  const execCommandSpy = jest.spyOn(document, 'execCommand');

  render(<ShareButton url="https://example.com/test" />);
  await userEvent.click(screen.getByRole('button'));

  expect(execCommandSpy).toHaveBeenCalledWith('copy');
});
```

### Unit Tests to Create
| File | Tests |
|------|-------|
| `ShareButton.test.tsx` | Clipboard copy, fallback path, state toggle, variants, a11y |
| `FeedCard.test.tsx` | Rendering, metrics formatting, link behavior, keyboard nav |

### Unit Tests to Modify
| File | Changes |
|------|---------|
| `ExploreGalleryPage.test.tsx` | Update to expect FeedCard instead of ExplanationCard |

### E2E Tests to Add

Add to existing explore page E2E test file or create new:

**`tests/e2e/explore-feed.spec.ts`:**
```typescript
import { test, expect } from '@playwright/test';

test.describe('Explore Feed', () => {
  test('displays feed cards with engagement metrics', async ({ page }) => {
    await page.goto('/explanations');

    // Verify feed layout (single column, not masonry)
    const feedCards = page.locator('.feed-card');
    await expect(feedCards.first()).toBeVisible();

    // Verify engagement bar is visible
    const engagementBar = feedCards.first().locator('[class*="border-t"]');
    await expect(engagementBar).toContainText(/\d+/); // Has numbers (views/saves)
  });

  test('share button copies link to clipboard', async ({ page, context }) => {
    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await page.goto('/explanations');

    // Click share button on first card
    const shareButton = page.locator('.feed-card').first().getByRole('button', { name: /share/i });
    await shareButton.click();

    // Verify "Copied!" feedback
    await expect(shareButton).toContainText('Copied!');

    // Verify clipboard contains URL
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toContain('/results?explanation_id=');
  });

  test('clicking card navigates to results page', async ({ page }) => {
    await page.goto('/explanations');

    // Click on card content (not engagement bar)
    const cardLink = page.locator('.feed-card a').first();
    await cardLink.click();

    // Should navigate to results page
    await expect(page).toHaveURL(/\/results\?explanation_id=\d+/);
  });
});
```

### Manual Verification
1. Navigate to `/explanations` - verify single-column feed layout
2. Verify cards show views, saves, share button
3. Click Share - verify "Copied!" feedback and clipboard contains correct URL
4. Click card - verify navigates to results page
5. On results page - verify Share button works
6. Test dark mode
7. Test mobile responsive (cards should be full-width)

## Rollback Plan

If issues are discovered after deployment:

**Immediate Rollback (< 5 min):**
1. Revert to previous commit: `git revert HEAD`
2. Push to trigger redeploy

**Component-Level Rollback:**
If only FeedCard has issues but ShareButton works:
1. In `ExploreGalleryPage.tsx`, switch back to `ExplanationCard` + `MasonryGrid`
2. FeedCard and ShareButton remain in codebase but unused

**Data Layer Rollback:**
The metrics fetch is additive (existing query unchanged). To rollback:
1. Remove metrics merge logic from `getRecentExplanations()`
2. Return type falls back to `ExplanationWithViewCount`

**No Database Changes:** This feature has no migrations, so no DB rollback needed.

## Documentation Updates

| File | Updates |
|------|---------|
| `docs/feature_deep_dives/explore_page.md` | Update layout description, add FeedCard docs |
| `docs/docs_overall/design_style_guide.md` | Add `.feed-card` to component list (optional) |
