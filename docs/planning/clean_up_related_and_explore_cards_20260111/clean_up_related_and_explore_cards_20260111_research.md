# Clean Up Related and Explore Cards Research

## Problem Statement
The "Related" cards on `/results` page and the preview cards on `/explore` page have different implementations and designs. The goal is to standardize them to use the same component, with the only difference being that Related cards need to display match/diversity scores.

## High Level Summary

### Current State
| Aspect | Related Cards (results) | Explore Cards |
|--------|------------------------|---------------|
| **Location** | Inline in `page.tsx:991-1017` | `ExplanationCard.tsx` (73 lines) |
| **Section** | Lines 947-1027 (`showMatches &&`) | Full component file |
| **Layout** | Vertical list (`space-y-4`) | Masonry grid (1-4 columns) |
| **Styling** | `bg-[var(--surface-elevated)]` | `.gallery-card` glassmorphism |
| **Content** | Title + raw content preview | Title + `summary_teaser` |
| **Metadata** | Match % + Diversity % + "View →" | Timestamp + View count |
| **Reusable** | No (inline JSX) | Yes (component) |
| **Line clamp** | 3 lines | 4 lines (preview), 2 lines (title) |

### Key Differences
1. **Scores**: Related cards show match/diversity scores; Explore cards show timestamp/views
2. **Teaser**: Explore uses AI-generated `summary_teaser`; Related uses `current_content`
3. **Styling**: Explore has glassmorphism + entrance animation; Related is simpler
4. **"View" link**: Related has redundant "View →" text (card is already clickable)
5. **Click handling**: Related uses `onClick` handler; Explore uses `<Link>` component

## Documents Read
- `docs/docs_overall/architecture.md` - System design overview
- `docs/docs_overall/getting_started.md` - Documentation structure
- `docs/feature_deep_dives/explanation_summaries.md` - Summary teaser implementation
- `docs/feature_deep_dives/state_management.md` - Results page lifecycle

## Code Files Read

### Related Cards Implementation
**File:** `src/app/results/page.tsx` (lines 945-1027)

The Related section is rendered inline within `ResultsPageContent`. Key structure:

```typescript
// Lines 990-1017 - Individual card rendering
<div
    key={index}
    className="p-4 bg-[var(--surface-elevated)] rounded-page shadow-page hover:shadow-warm transition-all duration-200 border border-[var(--border-default)] hover:-translate-y-0.5 cursor-pointer"
    onClick={() => loadExplanation(match.explanation_id, false, userid)}
>
    {/* Score Badges */}
    <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-4">
            {/* Match Score - always shown */}
            <span className="text-xs font-sans font-medium px-2 py-1 bg-[var(--accent-gold)]/10 text-[var(--accent-gold)] rounded-page">
                {(match.ranking.similarity * 100).toFixed(0)}% match
            </span>

            {/* Diversity Score - conditional */}
            {match.ranking.diversity_score !== null && (
                <span className="text-xs font-sans font-medium px-2 py-1 bg-[var(--accent-copper)]/10 text-[var(--accent-copper)] rounded-page">
                    {(match.ranking.diversity_score * 100).toFixed(0)}% unique
                </span>
            )}
        </div>

        {/* Redundant "View →" link */}
        <span className="text-xs font-sans text-[var(--text-muted)] hover:text-[var(--accent-gold)]">
            View →
        </span>
    </div>

    {/* Title */}
    <h3 className="font-display font-semibold text-[var(--text-primary)] mb-2">
        {match.current_title || match.text}
    </h3>

    {/* Content Preview */}
    <p className="font-serif text-[var(--text-secondary)] text-sm line-clamp-3">
        {match.current_content || match.text}
    </p>
</div>
```

**Data Type:** `matchWithCurrentContentType` from `lib/schemas/schemas.ts:187-190`
```typescript
{
    text: string;
    explanation_id: number;
    topic_id: number;
    ranking: {
        similarity: number;           // 0-1 (displayed as %)
        diversity_score: number | null;  // 0-1 or null
    };
    current_title: string;
    current_content: string;
}
```

### Explore Cards Implementation
**File:** `src/components/explore/ExplanationCard.tsx` (73 lines)

Reusable component with glassmorphism styling:

```typescript
'use client';

import Link from 'next/link';
import { EyeIcon } from '@heroicons/react/24/outline';
import { formatUserFriendlyDate } from '@/lib/utils/formatDate';
import { type ExplanationWithViewCount } from '@/lib/schemas/schemas';

interface ExplanationCardProps {
  explanation: ExplanationWithViewCount;
  index?: number;
  showViews?: boolean;
}

function stripTitleFromContent(content: string): string {
  return content.replace(/^#+\s.*(?:\r?\n|$)/, '').trim();
}

export default function ExplanationCard({
  explanation,
  index = 0,
  showViews = false,
}: ExplanationCardProps) {
  const preview = explanation.summary_teaser
    ? explanation.summary_teaser
    : stripTitleFromContent(explanation.content);

  return (
    <Link
      href={`/results?explanation_id=${explanation.id}`}
      className="block break-inside-avoid mb-6"
      data-testid="explanation-card"
    >
      <article
        className="gallery-card gallery-card-enter group cursor-pointer"
        style={{ '--card-index': index } as React.CSSProperties}
      >
        <div className="p-5">
          <h3 className="font-display text-lg font-semibold text-[var(--text-primary)] line-clamp-2 group-hover:text-[var(--accent-gold)] transition-colors duration-200">
            {explanation.explanation_title}
          </h3>
          <p className="font-serif text-sm text-[var(--text-secondary)] mt-3 line-clamp-4 leading-relaxed">
            {preview}
          </p>
        </div>
        <div className="px-5 pb-4 flex items-center justify-between text-xs text-[var(--text-muted)] font-sans">
          <time dateTime={explanation.timestamp}>
            {formatUserFriendlyDate(explanation.timestamp)}
          </time>
          {showViews && explanation.viewCount !== undefined && (
            <span className="flex items-center gap-1 text-[var(--accent-gold)]">
              <EyeIcon className="w-3.5 h-3.5" />
              {explanation.viewCount.toLocaleString()}
            </span>
          )}
        </div>
      </article>
    </Link>
  );
}
```

**Data Type:** `ExplanationWithViewCount` from `lib/schemas/schemas.ts:297`
```typescript
// ExplanationWithViewCount = ExplanationFullDbType & { viewCount?: number }
// Where ExplanationFullDbType includes:
{
    id: number;
    timestamp: string;
    explanation_title: string;
    content: string;
    primary_topic_id: number;
    secondary_topic_id?: number;
    status: ExplanationStatus;
    source?: ImportSource;
    summary_teaser?: string | null;      // AI-generated 50-200 char preview
    meta_description?: string | null;    // SEO description
    keywords?: string[] | null;          // Search terms
    viewCount?: number;                  // Added by query
}
```

### Gallery Card CSS
**File:** `src/app/globals.css` (lines 2386-2495)

```css
.gallery-card {
    /* Glassmorphism */
    background: rgba(var(--surface-secondary-rgb), 0.85);
    backdrop-filter: blur(12px);
    border-radius: 1rem;

    /* Shadow with copper accent */
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08),
                0 0 0 1px rgba(var(--accent-copper-rgb), 0.05),
                inset 0 1px 0 rgba(255, 255, 255, 0.1);

    /* Hover effect */
    transition: transform 0.3s, box-shadow 0.3s;
}

.gallery-card:hover {
    transform: translateY(-8px) scale(1.01);
    /* Enhanced shadow */
}

.gallery-card-enter {
    animation: cardEntrance 0.5s forwards;
    animation-delay: calc(var(--card-index) * 0.08s);
}
```

### Supporting Components
- **`src/components/explore/MasonryGrid.tsx`** - Responsive grid (1→4 columns)
- **`src/components/explore/ExploreGalleryPage.tsx`** - Page container with filters
- **`src/components/explore/FilterPills.tsx`** - Sort/period filtering

## Architecture Notes

### Score Badges Pattern
The Related cards use a consistent badge pattern for scores:
- Background: 10% opacity of accent color
- Text: Full accent color
- Gold for match, copper for diversity
- Format: `{score * 100}% {label}`

### Preview Text Strategy
- **Explore**: Uses `summary_teaser` (AI-generated 50-200 chars), falls back to stripped content
- **Related**: Uses `current_content` directly (may be lengthy markdown)

### Click Behavior
- **Explore**: `<Link href="/results?explanation_id=...">` - native navigation
- **Related**: `onClick={() => loadExplanation(...)}` - programmatic loading

### State Management
- Related cards controlled by `showMatches` boolean in `ResultsPageContent`
- Toggle via "View related (N)" button, back via "← Back" button

---

## Additional Research Findings

### Match Data Flow (Backend → Card)

**Complete pipeline:**
```
User Query → /api/returnExplanation (POST)
    → returnExplanationLogic() generates title
    → [3 PARALLEL SEARCHES]
        ├─ findMatchesInVectorDb() - similarity
        ├─ findMatchesInVectorDb() - anchors
        └─ searchForSimilarVectors() - diversity
    → enhanceMatchesWithCurrentContentAndDiversity()
        └─ Fetches full content from DB for each match
        └─ Adds diversity_score to ranking
    → saveUserQuery() - persists matches
    → SSE stream 'complete' event includes matches
    → Client receives finalResult.matches
    → setMatches(matches) via onMatchesLoad callback
```

**Key Files in Pipeline:**
| File | Function | Purpose |
|------|----------|---------|
| `src/lib/services/vectorsim.ts` | `findMatchesInVectorDb()` | Pinecone similarity search |
| `src/lib/services/findMatches.ts` | `enhanceMatchesWithCurrentContentAndDiversity()` | Adds content + diversity |
| `src/hooks/useExplanationLoader.ts` | `loadExplanation()` | Triggers onMatchesLoad callback |
| `src/app/results/page.tsx` | `handleUserAction()` | Processes SSE stream, extracts matches |

**Match Enhancement Logic** (`findMatches.ts:213-295`):
```typescript
async function enhanceMatchesWithCurrentContentAndDiversity(
    similarTexts: VectorSearchResult[],
    diversityComparison: VectorSearchResult[] | null
): Promise<matchWithCurrentContentType[]> {
    return Promise.all(similarTexts.map(async (result) => {
        // Fetch full explanation from DB
        const explanation = await getExplanationById(result.metadata.explanation_id);

        // Find diversity score if available
        const diversityMatch = diversityComparison?.find(d =>
            d.metadata.explanation_id === result.metadata.explanation_id
        );

        return {
            text: result.metadata.text,
            explanation_id: result.metadata.explanation_id,
            topic_id: result.metadata.topic_id,
            current_title: explanation?.explanation_title || '',
            current_content: explanation?.content || '',
            ranking: {
                similarity: result.score ?? 0,
                diversity_score: diversityMatch?.score ?? null
            }
        };
    }));
}
```

### ExplanationCard Props Interface (Full)

**File:** `src/components/explore/ExplanationCard.tsx`

```typescript
interface ExplanationCardProps {
  explanation: ExplanationWithViewCount;  // Required
  index?: number;                          // Default: 0 (animation stagger)
  showViews?: boolean;                     // Default: false
}
```

**Utility Functions Used:**
1. **`stripTitleFromContent()`** - Local function, removes `# heading` from content
   ```typescript
   function stripTitleFromContent(content: string): string {
     return content.replace(/^#+\s.*(?:\r?\n|$)/, '').trim();
   }
   ```

2. **`formatUserFriendlyDate()`** - From `lib/utils/formatDate.ts`
   - Returns "X minutes ago" for <60 min
   - Returns "Today, 2:30 PM" for today
   - Returns "Yesterday, 3:45 PM" for yesterday
   - Returns "Jan 15, 2024, 3:45 PM" for older

**Conditional Rendering:**
- View count: `showViews && explanation.viewCount !== undefined`
- Preview text: Uses `summary_teaser` or falls back to `stripTitleFromContent(content)`

### Test Coverage Status

| Component | Unit Tests | E2E Tests | Snapshot Tests |
|-----------|-----------|-----------|----------------|
| **ExplanationCard** | ❌ None | ❌ None | ❌ None |
| **Results page** | ✅ 440 lines | ✅ viewing.spec.ts | ❌ None |
| **Explore page** | ✅ 272 lines | ❌ None | ❌ None |
| **MasonryGrid** | ❌ None | ❌ None | ❌ None |
| **FilterPills** | ❌ None | ❌ None | ❌ None |

**Existing Test Files:**
- `src/app/results/page.test.tsx` (440 lines) - Covers hooks, state, loading
- `src/app/explanations/page.test.tsx` (272 lines) - Server-side fetch, params
- `src/__tests__/e2e/specs/04-content-viewing/viewing.spec.ts` - E2E for results
- `src/__tests__/e2e/helpers/pages/ResultsPage.ts` (734 lines) - Page object model

**Gap:** No tests for ExplanationCard, gallery components, or the "Related" section rendering

### Data Structure Mapping Challenge

To unify the components, data must be mapped between types:

| Source Field (`matchWithCurrentContentType`) | Target Field (`ExplanationWithViewCount`) | Status |
|---------------------------------------------|-------------------------------------------|--------|
| `match.explanation_id` | `explanation.id` | ✅ Direct mapping |
| `match.current_title` | `explanation.explanation_title` | ✅ Direct mapping |
| `match.current_content` | `explanation.content` | ✅ Direct mapping |
| `match.ranking.similarity` | **New prop needed** | ❌ Score badge |
| `match.ranking.diversity_score` | **New prop needed** | ❌ Score badge (nullable) |
| N/A | `explanation.timestamp` | ⚠️ Not in match data |
| N/A | `explanation.summary_teaser` | ⚠️ Not in match data |
| N/A | `explanation.viewCount` | ⚠️ Not in match data |

**Key Observation:** The `enhanceMatchesWithCurrentContentAndDiversity()` function in `findMatches.ts:213-295` already fetches the full `Explanation` object from the database but only returns `current_title` and `current_content`. The `timestamp` and `summary_teaser` fields are available but not included in the returned object.

**Implementation Options:**
1. **Extend ExplanationCard props** - Add optional `scores?: { similarity: number; diversity: number | null }` prop
2. **Extend match schema** - Add `timestamp` and `summary_teaser` to `matchWithCurrentContentSchema`
3. **Create unified type** - New type that works for both use cases

---

## Conclusion

### What Needs to Change

1. **ExplanationCard Component** (`src/components/explore/ExplanationCard.tsx`)
   - Add optional `scores` prop for match/diversity display
   - Render score badges when scores are provided
   - Remove timestamp/views when showing scores (or make footer configurable)

2. **Match Schema** (`src/lib/schemas/schemas.ts:187-190`)
   - Extend `matchWithCurrentContentSchema` to include `timestamp` and `summary_teaser`

3. **Match Enhancement** (`src/lib/services/findMatches.ts:213-295`)
   - Include `timestamp` and `summary_teaser` in returned object

4. **Results Page** (`src/app/results/page.tsx:991-1017`)
   - Replace inline card JSX with `ExplanationCard` component
   - Pass match data mapped to `ExplanationWithViewCount` format
   - Pass scores as separate prop
   - Remove redundant "View →" link

5. **Click Handler**
   - Current: `onClick={() => loadExplanation(match.explanation_id, false, userid)}`
   - ExplanationCard uses `<Link>` which navigates to `/results?explanation_id=...`
   - Need to decide: keep programmatic loading or switch to Link navigation

### Files to Modify
| File | Changes |
|------|---------|
| `src/components/explore/ExplanationCard.tsx` | Add scores prop, conditional score badges |
| `src/lib/schemas/schemas.ts` | Extend matchWithCurrentContentSchema |
| `src/lib/services/findMatches.ts` | Return additional fields |
| `src/app/results/page.tsx` | Replace inline JSX with component |

### Tests to Add
- Unit tests for ExplanationCard (currently none)
- Unit tests for score badge rendering
- Update results page tests for new component usage
