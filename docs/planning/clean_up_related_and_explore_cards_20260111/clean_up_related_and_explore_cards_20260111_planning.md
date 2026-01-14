# Clean Up Related and Explore Cards Plan

## Background
The codebase has two implementations for displaying article preview cards: inline JSX in the Results page for "Related" cards (27 lines at `page.tsx:991-1017`) and a reusable `ExplanationCard` component for the Explore page. Both serve similar purposes but have diverged in styling, data handling, and behavior.

## Problem
The Related cards use simpler styling, raw content previews, and include a redundant "View →" link. The Explore cards use polished glassmorphism styling and AI-generated `summary_teaser` previews. This inconsistency creates visual fragmentation and maintenance burden. The goal is to unify both to use the same component while preserving the unique requirement that Related cards display match/diversity scores.

## Options Considered

### Option A: Extend ExplanationCard with optional props
Add `scores`, `onClick`, and `footer` props to the existing component. Related cards pass scores; Explore cards pass timestamp/views via footer.
- **Pros**: Single component, minimal new code
- **Cons**: Component grows in complexity

### Option B: Create wrapper components
Keep ExplanationCard minimal, create `RelatedCard` and `ExploreCard` wrappers that compose it with different footers.
- **Pros**: Separation of concerns
- **Cons**: More files, indirection

### Option C: Flexible footer slot pattern (CHOSEN)
Extend ExplanationCard with a `footer` ReactNode prop and explicit `href`/`onClick` props. Each context passes its own footer content. Component stays focused on card structure.
- **Pros**: Maximum flexibility, clear API, no magic behavior
- **Cons**: Callers must construct footer content

**Decision**: Option C provides the best balance of flexibility and simplicity.

## Phased Execution Plan

### Phase 1: Extend Match Schema and Service
**Goal**: Make match data compatible with ExplanationCard

**Files to modify**:
- `src/lib/schemas/schemas.ts` - Add `summary_teaser` and `timestamp` to `matchWithCurrentContentSchema`
- `src/lib/services/findMatches.ts` - Return additional fields from `enhanceMatchesWithCurrentContentAndDiversity()`

**Changes**:
```typescript
// schemas.ts - Extend match schema
export const matchWithCurrentContentSchema = matchSchema.extend({
    current_title: z.string(),
    current_content: z.string(),
    summary_teaser: z.string().nullable().optional(),  // NEW
    timestamp: z.string().optional(),                   // NEW
});
```

**Service modification** (`findMatches.ts:239-250`):
The `enhanceMatchesWithCurrentContentAndDiversity()` function already calls `getExplanationById()` which returns the full `ExplanationFullDbType` including `summary_teaser` and `timestamp`. Currently only `explanation_title` and `content` are extracted. Update the return object:

```typescript
// findMatches.ts - enhanceMatchesWithCurrentContentAndDiversity
// Line ~247: Update the return object in the map
return {
    text: result.metadata.text,
    explanation_id: result.metadata.explanation_id,
    topic_id: result.metadata.topic_id,
    current_title: explanation?.explanation_title || '',
    current_content: explanation?.content || '',
    summary_teaser: explanation?.summary_teaser ?? null,  // NEW - already available
    timestamp: explanation?.timestamp ?? '',               // NEW - already available
    ranking: {
        similarity: result.score ?? 0,
        diversity_score: diversityScore
    }
};
```

**Note**: These fields are nullable/optional in the schema because older explanations may not have `summary_teaser`. The component handles this gracefully via fallback to `stripTitleFromContent(content)`.

**Tests**:
- `src/lib/services/__tests__/findMatches.test.ts` - Add test for new fields in enhanced match

---

### Phase 2: Refactor ExplanationCard Component
**Goal**: Support both Explore and Related use cases

**Files to modify**:
- `src/components/explore/ExplanationCard.tsx`

**Backward compatibility strategy**:
The current ExplanationCard accepts `ExplanationWithViewCount` directly and always renders a Link. To maintain compatibility:
1. The new `explanation` prop uses a minimal interface (id, title, content, summary_teaser)
2. `ExplanationWithViewCount` satisfies this interface, so existing code continues to work
3. The `href` prop becomes optional - if not provided AND no onClick, component throws a dev-time error
4. Footer becomes optional - if not provided, no footer renders (breaking change, but Explore page will be updated in Phase 5)

**Migration approach**: Phase 2 and Phase 5 must be deployed together to avoid breaking Explore page.

**⚠️ DEPLOYMENT REQUIREMENT**: Phases 2, 4, and 5 must be in the same commit/PR. They cannot be deployed separately:
- Phase 2 alone → breaks Explore page (expects footer)
- Phase 4 alone → won't compile (depends on Phase 2 changes)
- Phase 5 alone → incompatible with old component signature

Recommended: Complete Phases 1-5 as a single PR, with Phases 6-8 (tests) in follow-up.

**New interface**:
```typescript
interface ExplanationCardProps {
  explanation: {
    id: number;
    explanation_title: string;
    content: string;
    summary_teaser?: string | null;
  };
  href?: string;                    // Renders as <Link>
  onClick?: () => void;             // Renders as clickable <div>
  index?: number;                   // Animation stagger (default: 0)
  footer?: React.ReactNode;         // Custom footer content
  disableEntrance?: boolean;        // Skip entrance animation
  ariaLabel?: string;               // Accessible label for onClick variant
}
```

**XSS Prevention**: When constructing href URLs, use URLSearchParams for safety:
```typescript
// Safe URL construction pattern (for both Explore and Results pages)
const safeHref = `/results?${new URLSearchParams({
  explanation_id: explanation.id.toString()
}).toString()}`;
```

**Implementation details**:
- Wrapper element: `Link` if `href` provided, `div` with `role="button"` if `onClick`
- Preview: Use `summary_teaser` if available, fallback to `stripTitleFromContent(content)`
- Footer: Only render if `footer` prop provided
- Animation: Skip `gallery-card-enter` class when `disableEntrance=true`

**Accessibility requirements for onClick variant** (WCAG 2.1 AA):
- Add `role="button"` to the wrapper div
- Add `tabIndex={0}` for keyboard focus
- Add `onKeyDown` handler for Enter and Space keys:
  ```typescript
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick?.();
    }
  }}
  ```
- Add `aria-label` prop to allow callers to customize (e.g., `aria-label="View explanation: {title}"`)
- Follows existing patterns in codebase (see CitationTooltip, TagBar)

**Error handling for onClick** (wraps BOTH click and keyboard handlers):
```typescript
// Safe onClick wrapper used for both handlers
const handleClick = useCallback(() => {
  try {
    onClick?.();
  } catch (error) {
    console.error('ExplanationCard onClick failed:', error);
    // Don't rethrow - user stays focused on card
  }
}, [onClick]);

// Keyboard handler with same safety
const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    handleClick();
  }
}, [handleClick]);

// Usage on wrapper div:
<div
  role="button"
  tabIndex={0}
  onClick={handleClick}
  onKeyDown={handleKeyDown}
  aria-label={ariaLabel ?? `View explanation: ${explanation.explanation_title}`}
>
```

---

### Phase 3: Create ScoreBadges Helper Component
**Goal**: Encapsulate score badge rendering for Related cards

**Files to create**:
- `src/components/ui/ScoreBadges.tsx` (in ui folder - shared utility component, not explore-specific)

```typescript
interface ScoreBadgesProps {
  similarity: number;           // 0-1
  diversity?: number | null;    // 0-1 or null
}

export function ScoreBadges({ similarity, diversity }: ScoreBadgesProps) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs font-sans font-medium px-2 py-1 bg-[var(--accent-gold)]/10 text-[var(--accent-gold)] rounded-page">
        {(similarity * 100).toFixed(0)}% match
      </span>
      {diversity != null && (
        <span className="text-xs font-sans font-medium px-2 py-1 bg-[var(--accent-copper)]/10 text-[var(--accent-copper)] rounded-page">
          {(diversity * 100).toFixed(0)}% unique
        </span>
      )}
    </div>
  );
}
```

---

### Phase 4: Update Results Page
**Goal**: Replace inline Related cards with ExplanationCard component

**Files to modify**:
- `src/app/results/page.tsx` (lines 988-1024)

**Before** (inline JSX):
```typescript
matches.map((match, index) => (
    <div key={index} className="p-4 bg-[var(--surface-elevated)]..." onClick={...}>
        {/* 27 lines of inline card markup */}
    </div>
))
```

**After** (component):
```typescript
import ExplanationCard from '@/components/explore/ExplanationCard';
import { ScoreBadges } from '@/components/ui/ScoreBadges';

matches.map((match, index) => (
    <ExplanationCard
        key={index}
        explanation={{
            id: match.explanation_id,
            explanation_title: match.current_title,
            content: match.current_content,
            summary_teaser: match.summary_teaser,
        }}
        onClick={() => loadExplanation(match.explanation_id, false, userid)}
        disableEntrance
        footer={
            <ScoreBadges
                similarity={match.ranking.similarity}
                diversity={match.ranking.diversity_score}
            />
        }
    />
))
```

**Also remove**: The redundant "View →" link (card is already clickable)

---

### Phase 5: Update Explore Page Usage
**Goal**: Ensure Explore page still works with new interface

**Files to modify**:
- `src/components/explore/ExploreGalleryPage.tsx`

**Changes**:
```typescript
// Note: Use URLSearchParams for safe URL construction (XSS prevention)
const safeHref = `/results?${new URLSearchParams({ explanation_id: exp.id.toString() }).toString()}`;

<ExplanationCard
    explanation={exp}
    href={safeHref}
    index={idx}
    footer={
        <>
            <time dateTime={exp.timestamp}>
                {formatUserFriendlyDate(exp.timestamp)}
            </time>
            {showViews && exp.viewCount !== undefined && (
                <span className="flex items-center gap-1 text-[var(--accent-gold)]">
                    <EyeIcon className="w-3.5 h-3.5" />
                    {exp.viewCount.toLocaleString()}
                </span>
            )}
        </>
    }
/>
```

---

### Phase 6: Add Unit Tests
**Goal**: Test the new component behavior

**Files to create** (colocated with components, per project convention):
- `src/components/explore/ExplanationCard.test.tsx`
- `src/components/ui/ScoreBadges.test.tsx`

**Test cases for ExplanationCard**:
- Renders title and preview text
- Uses summary_teaser when available
- Falls back to stripped content when no teaser
- Renders as Link when href provided
- Renders as div with onClick when onClick provided
- Shows footer when provided
- Skips entrance animation when disableEntrance=true
- Keyboard accessibility for onClick variant (Enter key triggers onClick)
- Keyboard accessibility for onClick variant (Space key triggers onClick)

**Test cases for ScoreBadges**:
- Renders similarity score
- Renders diversity score when provided
- Hides diversity badge when null

### Phase 7: Integration Tests
**Goal**: Verify data flows correctly from service to component

**Test file locations** (colocated with source, per project convention):

1. **`src/lib/services/findMatches.test.ts`** - Add tests for enhanced match fields:
   - `enhanceMatchesWithCurrentContentAndDiversity` returns `summary_teaser` when available
   - `enhanceMatchesWithCurrentContentAndDiversity` returns `null` for `summary_teaser` when not available
   - `enhanceMatchesWithCurrentContentAndDiversity` returns `timestamp` field

2. **`src/lib/schemas/schemas.test.ts`** - Add tests for schema validation:
   - Schema validation passes for enhanced match type with new fields
   - **Backward compatibility**: Old match data (without `summary_teaser`/`timestamp`) still parses correctly

**Schema backward compatibility test** (add to existing `src/lib/schemas/schemas.test.ts`):
```typescript
describe('matchWithCurrentContentSchema backward compatibility', () => {
  it('accepts old match format without summary_teaser and timestamp', () => {
    const oldFormatMatch = {
      text: 'test text',
      explanation_id: 1,
      topic_id: 2,
      current_title: 'Test Title',
      current_content: 'Test content',
      ranking: { similarity: 0.95, diversity_score: 0.8 }
    };
    expect(() => matchWithCurrentContentSchema.parse(oldFormatMatch)).not.toThrow();
  });

  it('accepts new match format with summary_teaser and timestamp', () => {
    const newFormatMatch = {
      text: 'test text',
      explanation_id: 1,
      topic_id: 2,
      current_title: 'Test Title',
      current_content: 'Test content',
      summary_teaser: 'AI-generated preview',
      timestamp: '2025-01-11T12:00:00Z',
      ranking: { similarity: 0.95, diversity_score: null }
    };
    expect(() => matchWithCurrentContentSchema.parse(newFormatMatch)).not.toThrow();
  });
});
```

---

## Testing

### Unit Tests
- ExplanationCard component (new)
- ScoreBadges component (new)
- Schema validation for extended match type

### Manual Verification
1. Navigate to /explore - cards should look identical to before
2. Search for something on /results - click "View related"
3. Related cards should now have glassmorphism styling
4. Match/diversity scores display correctly
5. Clicking a Related card loads the explanation (no page navigation)
6. No "View →" link visible
7. Hover effects work on both card types
8. Dark mode works correctly

### E2E Tests
**Existing tests** (must pass):
- `src/__tests__/e2e/specs/04-content-viewing/viewing.spec.ts` - Core viewing functionality

**New E2E test file to create**:
- `src/__tests__/e2e/specs/04-content-viewing/related-cards.spec.ts`

**E2E Test Skeleton** (follows viewing.spec.ts patterns):
```typescript
/**
 * E2E Tests for Related Cards functionality
 *
 * Tests for Related cards in Results page using unified ExplanationCard component.
 * Uses test-data-factory for isolated, reliable test data.
 */
import { test, expect } from '../../fixtures/auth';
import { ResultsPage } from '../../helpers/pages/ResultsPage';
import {
  createTestExplanationInLibrary,
  type TestExplanation,
} from '../../helpers/test-data-factory';

test.describe('Related Cards', () => {
  test.describe.configure({ retries: 1 });
  test.setTimeout(60000);

  let testExplanation: TestExplanation;

  test.beforeAll(async () => {
    // Create test data that will generate matches
    testExplanation = await createTestExplanationInLibrary({
      title: 'Related Cards Test',
      content: '<h1>Related Test</h1><p>Content that should match with existing explanations.</p>',
      status: 'published',
    });
  });

  test.afterAll(async () => {
    await testExplanation.cleanup();
  });

  test('Related cards display with glassmorphism styling', { tag: '@critical' }, async ({ authenticatedPage }) => {
    const resultsPage = new ResultsPage(authenticatedPage);
    // TODO: Navigate to results with matches, verify .gallery-card class applied
  });

  test('Clicking Related card loads explanation without navigation', async ({ authenticatedPage }) => {
    const resultsPage = new ResultsPage(authenticatedPage);
    // TODO: Click Related card, verify URL unchanged, content loads via SSE
  });

  test('Match percentage badge displays correctly', async ({ authenticatedPage }) => {
    // TODO: Verify badge shows "XX% match" format
  });

  test('Keyboard navigation works for Related cards', { tag: '@a11y' }, async ({ authenticatedPage }) => {
    const resultsPage = new ResultsPage(authenticatedPage);
    // Tab to card, verify focus visible
    // Press Enter, verify explanation loads
    // Tab to next card, press Space, verify loads
  });
});
```

**Test cases for related-cards.spec.ts**:
- Related cards display with glassmorphism styling after search (`@critical`)
- Clicking a Related card loads the explanation without page navigation
- Match percentage badge displays correctly
- Diversity percentage badge displays when available
- Related cards are keyboard navigable - Tab to focus, Enter to activate (`@a11y`)
- Related cards are keyboard navigable - Tab to focus, Space to activate (`@a11y`)
- Related cards display preview text (summary_teaser when available)
- Related card displays fallback preview for explanation without summary_teaser

**E2E Test Data Strategy**:
- Use `createTestExplanationInLibrary()` with `summary_teaser` field populated for most tests
- Create at least 2 related test explanations with overlapping content to guarantee matches
- One test uses explanation WITHOUT `summary_teaser` to verify fallback behavior
- E2E tests run with test DB that has existing seed data for similarity matching
- Test explanations prefixed with `[TEST]` are auto-filtered from production discovery
- `ResultsPage` page object class already exists at `src/__tests__/e2e/helpers/pages/ResultsPage.ts` (734 lines)

## Rollback Plan

If issues are discovered after deployment:

1. **Immediate rollback**: Revert the commit containing Phases 2-5 changes
   - `git revert <commit-hash>` for the component/page changes
   - Schema changes (Phase 1) are additive and don't need rollback

2. **Partial rollback** (if only Related cards affected):
   - Keep ExplanationCard changes
   - Revert only Phase 4 (Results page changes)
   - Related cards fall back to original inline JSX

3. **Feature flag alternative** (if needed for gradual rollout):
   - Add `USE_UNIFIED_CARDS` environment variable
   - Conditionally render old vs new in Results page
   - Remove flag after validation

**Monitoring**: After deployment, check:
- Sentry for new errors on /results and /explore pages
- Browser console for React hydration errors
- Visual regression in both light/dark modes

## Documentation Updates

- `docs/feature_deep_dives/explanation_summaries.md` - Note that summary_teaser is now used in Related cards
- No other doc updates needed (component is internal implementation detail)

## Summary

| Phase | Files Changed | Estimated Complexity |
|-------|--------------|---------------------|
| 1. Schema/Service | 2 files | Low |
| 2. ExplanationCard | 1 file | Medium |
| 3. ScoreBadges | 1 new file | Low |
| 4. Results Page | 1 file | Medium |
| 5. Explore Page | 1 file | Low |
| 6. Unit Tests | 2 new files | Medium |
| 7. Integration Tests | 1 file | Low |
| 8. E2E Tests | 1 new file | Medium |

**Total**: ~7 files modified, ~4 new files created
