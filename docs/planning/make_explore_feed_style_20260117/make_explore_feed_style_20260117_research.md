# Make Explore Feed Style Research

## Problem Statement
Convert the explore page from a masonry grid layout to a Reddit-style card feed with:
- Full horizontal width cards
- Titles at top
- Feedback/engagement metrics at bottom

## High Level Summary

### Current Implementation
The explore page uses a **masonry grid layout** (Pinterest-style) with glassmorphism cards:

| Aspect | Current State |
|--------|---------------|
| Layout | `MasonryGrid` - CSS columns (1→4 based on screen width) |
| Card Style | Glassmorphism with backdrop blur, hover lift effects |
| Content | Title (2-line clamp), preview (4-line clamp) |
| Footer | Timestamp + optional view count |
| Interactions | Links to `/results?explanation_id=X` |

### Available Data for "Feedback" Display
From `explanationMetrics` table:
- `total_views` - Number of times viewed
- `total_saves` - Number of times saved to user libraries
- `save_rate` - Ratio of saves/views (0.0-1.0)

Currently the explore page only shows `viewCount` when sorting by "top".

### Key Files
| File | Purpose |
|------|---------|
| `src/components/explore/ExploreGalleryPage.tsx` | Main page component |
| `src/components/explore/ExplanationCard.tsx` | Card component |
| `src/components/explore/MasonryGrid.tsx` | Current masonry layout |
| `src/app/explanations/page.tsx` | Route handler |
| `src/app/globals.css` (lines 2562-2680) | `.gallery-card` styles |

### ExplanationCard Props
```typescript
{
  explanation: { id, explanation_title, content, summary_teaser }
  href?: string           // Link mode (navigate)
  onClick?: () => void    // Interactive mode
  index?: number          // For stagger animation
  footer?: ReactNode      // Custom footer content
  disableEntrance?: boolean
  ariaLabel?: string
}
```

### Current Card CSS (`.gallery-card`)
- Glassmorphism: `backdrop-filter: blur(12px)`
- Hover: `translateY(-8px) scale(1.01)`
- Gold gradient top border on hover
- Warm shadows with copper tint

## Documents Read
- `docs/docs_overall/getting_started.md`
- `docs/docs_overall/architecture.md`
- `docs/docs_overall/project_workflow.md`

## Code Files Read
- `src/components/explore/ExploreGalleryPage.tsx` - Main page layout
- `src/components/explore/ExplanationCard.tsx` - Card component
- `src/components/explore/MasonryGrid.tsx` - Layout wrapper
- `src/lib/services/userLibrary.ts` - Save/bookmark functionality
- `src/lib/services/metrics.ts` - View/save metrics tracking
- `src/lib/schemas/schemas.ts` - Data types including ExplanationMetricsType

## Target Design (Reddit Reference)
From the provided screenshot:
- Single-column, full-width cards
- Clear hierarchy: **Title → Content Preview → Tags → Engagement Bar**
- Engagement bar includes: upvotes, comments count, share button
- Clean separation between cards
- Author/timestamp info above title

## Design Considerations

### What We Have vs What Reddit Has
| Feature | ExplainAnything | Reddit |
|---------|-----------------|--------|
| Votes | ❌ None | ✅ Upvote/downvote |
| Comments | ❌ None | ✅ Comment count |
| Saves | ✅ userLibrary | ✅ Save button |
| Views | ✅ viewCount | ❌ Hidden |
| Share | ❌ None | ✅ Share button |

### Realistic "Feedback" Options for Bottom Bar
Given current data, we could display:
1. **Views** (total_views) - "1.2k views"
2. **Saves** (total_saves) - "42 saves" with bookmark icon
3. **Save Rate** - Could show as engagement percentage
4. **Share** - Add copy-link functionality
5. **Timestamp** - Already exists

No voting or comments system exists - would require new DB tables and significant backend work.

---

## Brainstorm Results

### Approach Selected: Option B - New FeedCard Component
Create a new `FeedCard.tsx` component specifically designed for the Reddit-style feed layout, separate from the existing `ExplanationCard.tsx` (which will remain for related cards on results page).

### Engagement Bar Contents
- **Views** - "1.2k views" with eye icon
- **Saves** - "42 saves" with bookmark icon
- **Share** - Button that copies link to clipboard with toast feedback

### Additional Scope
- Add Share button to `/results` page as well

### Card Layout Structure
```
┌─────────────────────────────────────────────────┐
│ [timestamp]                                     │
│ **Title** (bold, larger)                        │
│ Preview text truncated to 3-4 lines...          │
├─────────────────────────────────────────────────┤
│ 👁 1.2k views  │  📑 42 saves  │  🔗 Share      │
└─────────────────────────────────────────────────┘
```

### Files to Create/Modify
| File | Action |
|------|--------|
| `src/components/explore/FeedCard.tsx` | CREATE - New Reddit-style card |
| `src/components/explore/FeedCard.test.tsx` | CREATE - Tests for new component |
| `src/components/explore/ExploreGalleryPage.tsx` | MODIFY - Use FeedCard, remove MasonryGrid |
| `src/components/ShareButton.tsx` | CREATE - Reusable share button |
| `src/app/results/page.tsx` | MODIFY - Add ShareButton |
| `src/lib/services/explanations.ts` | MODIFY - Fetch metrics with explanations |
| `src/app/globals.css` | MODIFY - Add `.feed-card` styles |
