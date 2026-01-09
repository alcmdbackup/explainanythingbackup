# Source Citations - Planning

## 1. Background
The application generates explanatory articles that can be grounded in user-provided sources (URLs). The system fetches source content, injects it into LLM prompts, and the LLM generates content with `[n]` inline citations. A Bibliography component displays the sources at the bottom of articles.

## 2. Problem
Two issues were identified:
1. **Clickable citations don't work on existing articles** - Sources are stored in the database but never fetched when viewing an article via URL
2. **Citations are sentence-level, not claim-level** - The prompt produces citations at the end of sentences/clauses rather than after specific factual claims

## 3. Options Considered

### Option A: Minimal Fix (Rejected)
- Only fix source loading, keep current citation granularity
- **Pros**: Smaller scope
- **Cons**: Doesn't address user's fact-specific citation requirement

### Option B: Full Fix (Recommended)
- Fix source loading AND update prompt for claim-level citations
- **Pros**: Addresses both user requirements completely
- **Cons**: Slightly more work

### Option C: Major Refactor (Rejected)
- Build structured citation extraction with fact-mapping schema
- **Pros**: Maximum auditability
- **Cons**: Over-engineered for current needs

---

## 4. Phased Execution Plan

### Phase 1: Add Server Action for Source Fetching

**File:** `src/actions/actions.ts`

Add import near top of file (with other service imports):
```typescript
import { getSourcesByExplanationId } from '@/lib/services/sourceCache';
```

Add new server action (follow pattern from `getTagsForExplanationAction` at line 868):

```typescript
/**
 * Get sources linked to an explanation
 * Converts SourceCacheFullType to SourceChipType for UI consumption
 */
const _getSourcesForExplanationAction = withLogging(
  async function getSourcesForExplanationAction(params: {
    explanationId: number
  }): Promise<{
    success: boolean;
    data: SourceChipType[] | null;
    error: ErrorResponse | null;
  }> {
    const { explanationId } = params;

    try {
      // E2E test mode: return empty sources for mock IDs
      if (process.env.E2E_TEST_MODE === 'true' && explanationId >= 90000) {
        return { success: true, data: [], error: null };
      }

      const sources = await getSourcesByExplanationId(explanationId);

      // Convert SourceCacheFullType[] to SourceChipType[]
      // Note: pending -> loading, failed -> failed, success -> success
      const sourceChips: SourceChipType[] = sources.map(source => ({
        url: source.url,
        title: source.title,
        favicon_url: source.favicon_url,
        domain: source.domain,
        status: source.fetch_status === 'success' ? 'success'
              : source.fetch_status === 'pending' ? 'loading'
              : 'failed',
        error_message: source.error_message
      }));

      return { success: true, data: sourceChips, error: null };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: handleError(error, 'getSourcesForExplanationAction', { explanationId })
      };
    }
  },
  'getSourcesForExplanationAction',
  { enabled: FILE_DEBUG }
);

export const getSourcesForExplanationAction = serverReadRequestId(_getSourcesForExplanationAction);
```

**Phase 1 Acceptance:**
- Server action exists and returns `SourceChipType[]`
- Uses correct `withLogging` + `serverReadRequestId` pattern
- Handles E2E test mode
- TypeScript compiles without errors

---

### Phase 2: Extend useExplanationLoader Hook

**File:** `src/hooks/useExplanationLoader.ts`

1. Add import at top (add to existing imports from actions):
```typescript
import {
    getExplanationByIdAction,
    isExplanationSavedByUserAction,
    getTagsForExplanationAction,
    loadFromPineconeUsingExplanationIdAction,
    resolveLinksForDisplayAction,
    getSourcesForExplanationAction  // Add this
} from '@/actions/actions';
```

2. Add import for SourceChipType:
```typescript
import { ExplanationStatus, TagUIType, matchWithCurrentContentType, SourceChipType } from '@/lib/schemas/schemas';
```

3. Add to `UseExplanationLoaderOptions` interface (~line 40):
```typescript
/**
 * Callback invoked when sources are loaded for the explanation
 * Used to populate sources state in parent component
 */
onSourcesLoad?: (sources: SourceChipType[]) => void;
```

4. Destructure in hook (~line 97):
```typescript
const { userId = 'anonymous', onTagsLoad, onMatchesLoad, onClearPrompt, onSetOriginalValues, onSourcesLoad } = options;
```

5. In `loadExplanation` function, after loading tags (after line ~185):
```typescript
// Load sources linked to this explanation
if (onSourcesLoad) {
  const sourcesResult = await getSourcesForExplanationAction({ explanationId });
  if (sourcesResult.success && sourcesResult.data) {
    onSourcesLoad(sourcesResult.data);
  }
}
```

6. **CRITICAL:** Update useCallback dependency array (~line 313):
```typescript
// Change FROM:
}, [withRequestId, checkUserSaved, onTagsLoad, onMatchesLoad, onClearPrompt, onSetOriginalValues]);

// TO:
}, [withRequestId, checkUserSaved, onTagsLoad, onMatchesLoad, onClearPrompt, onSetOriginalValues, onSourcesLoad]);
```

**Phase 2 Acceptance:**
- Hook accepts `onSourcesLoad` callback
- Sources are fetched when loading explanation
- Callback is in useCallback dependency array
- TypeScript compiles without errors

---

### Phase 3: Wire Up Results Page

**File:** `src/app/results/page.tsx`

Find where `useExplanationLoader` is called (look for the options object) and add the sources callback:

```typescript
const explanationLoader = useExplanationLoader({
  userId: userData?.id,
  onTagsLoad: (tags) => dispatchTagAction({ type: 'SET_TAGS', payload: tags }),
  onMatchesLoad: setMatches,
  onClearPrompt: () => setUserInput(''),
  onSetOriginalValues: (content, title, status) => {
    // ... existing logic
  },
  onSourcesLoad: setSources,  // Add this line
});
```

**Phase 3 Acceptance:**
- Sources populate when viewing existing article
- Bibliography section appears
- Citations become clickable (gold-colored, scroll on click)

---

### Phase 4: Update Citation Prompt

**File:** `src/lib/prompts.ts` (lines 287-291)

Replace current citation instructions:

```typescript
// Current (lines 287-291):
- IMPORTANT: Cite sources inline using [n] notation where n is the source number (e.g., [1], [2])
- Place citations at the end of sentences or clauses that use information from that source
- Prefer direct information from VERBATIM sources; use SUMMARIZED sources for supporting context
- You may synthesize information across multiple sources
- If sources conflict, note the discrepancy and cite both

// New:
- IMPORTANT: Cite sources inline using [n] notation where n is the source number (e.g., [1], [2])
- CITATION PLACEMENT: Place citations immediately after KEY FACTUAL CLAIMS, not entire sentences:
  - Cite specific facts: dates, numbers, names, locations, statistics
  - Cite technical terms when introducing sourced definitions
  - Example: "Einstein developed **relativity** [2] in **1905** [1], fundamentally changing physics."
  - NOT: "Einstein developed relativity in 1905, fundamentally changing physics. [1][2]"
- Do NOT cite common knowledge or widely accepted facts that don't require verification
- Do NOT cite every clause - only cite specific, verifiable claims that come from the sources
- Prefer direct information from VERBATIM sources; use SUMMARIZED sources for supporting context
- You may synthesize information across multiple sources, citing each source where its information is used
- If sources conflict, note the discrepancy inline and cite both: "Source A claims X [1], while Source B states Y [2]"
```

**Phase 4 Acceptance:**
- New articles show citations after key facts
- Common knowledge statements are not cited
- Multiple citations appear within sentences where appropriate

---

## 5. Testing

### Unit Tests (Colocated Pattern)
**New:** `src/actions/getSourcesForExplanation.test.ts` (colocated with actions)

```typescript
import { getSourcesForExplanationAction } from './actions';
import { getSourcesByExplanationId } from '@/lib/services/sourceCache';

jest.mock('@/lib/services/sourceCache');
const mockGetSources = getSourcesByExplanationId as jest.MockedFunction<typeof getSourcesByExplanationId>;

describe('getSourcesForExplanationAction', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return sources for valid explanation ID', async () => {
    mockGetSources.mockResolvedValueOnce([{
      id: 1, url: 'https://example.com', title: 'Test', domain: 'example.com',
      favicon_url: null, extracted_text: 'content', is_summarized: false,
      fetch_status: 'success', error_message: null, /* ... */
    }]);
    const result = await getSourcesForExplanationAction({ explanationId: 123 });
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data![0].status).toBe('success');
  });

  it('should return empty array for explanation with no sources', async () => {
    mockGetSources.mockResolvedValueOnce([]);
    const result = await getSourcesForExplanationAction({ explanationId: 123 });
    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  it('should map pending status to loading', async () => {
    mockGetSources.mockResolvedValueOnce([{
      /* ... */ fetch_status: 'pending'
    }]);
    const result = await getSourcesForExplanationAction({ explanationId: 123 });
    expect(result.data![0].status).toBe('loading');
  });

  it('should map failed status to failed', async () => {
    mockGetSources.mockResolvedValueOnce([{
      /* ... */ fetch_status: 'failed', error_message: 'Timeout'
    }]);
    const result = await getSourcesForExplanationAction({ explanationId: 123 });
    expect(result.data![0].status).toBe('failed');
    expect(result.data![0].error_message).toBe('Timeout');
  });

  it('should handle database errors gracefully', async () => {
    mockGetSources.mockRejectedValueOnce(new Error('DB connection failed'));
    const result = await getSourcesForExplanationAction({ explanationId: 123 });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should return empty for E2E test mode mock IDs', async () => {
    process.env.E2E_TEST_MODE = 'true';
    const result = await getSourcesForExplanationAction({ explanationId: 90001 });
    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
    delete process.env.E2E_TEST_MODE;
  });
});
```

### Integration Tests
**New:** `src/__tests__/integration/source-citation.integration.test.ts`

```typescript
describe('Source Citation Integration', () => {
  it('should fetch sources linked to explanation from database', async () => {
    // Create test explanation with sources
    // Verify getSourcesByExplanationId returns correct data
    // Verify type conversion works end-to-end
  });
});
```

### E2E Tests
**New helper methods in:** `src/__tests__/e2e/helpers/pages/ResultsPage.ts`

```typescript
async hasBibliography(): Promise<boolean> {
  return this.page.locator('[data-testid="bibliography"]').isVisible();
}

async getBibliographySourceCount(): Promise<number> {
  const items = await this.page.locator('[data-testid="bibliography"] li').count();
  return items;
}

async clickCitation(index: number): Promise<void> {
  await this.page.locator(`.citation-link[data-citation-index="${index}"]`).first().click();
}
```

**New E2E spec:** `src/__tests__/e2e/specs/04-content-viewing/sources.spec.ts`

```typescript
test.describe('Source Citations', () => {
  test('should display bibliography for article with sources', async ({ page }) => {
    // Load article known to have sources
    // Verify bibliography visible
    // Verify source count matches
  });

  test('should scroll to bibliography when citation clicked', async ({ page }) => {
    // Click [1] citation
    // Verify source-1 element is in viewport
  });
});
```

### Manual Verification
1. **Existing article with sources:**
   - Navigate to article URL directly
   - Verify Bibliography section appears
   - Verify `[n]` citations are gold and clickable
   - Click citation → scrolls to bibliography entry

2. **New article with sources:**
   - Create article with 2-3 source URLs
   - Verify citations appear after key facts, not just at sentence end
   - Verify common knowledge is not cited

---

## 6. Documentation Updates

### Files to Update
- `/docs/feature_deep_dives/source_handling.md` (if exists) - Add citation loading section

### Files NOT Updated
- Architecture docs - No architectural changes

---

## 7. All Code Modified (Summary)

### Production Code
| File | Type | Description |
|------|------|-------------|
| `src/actions/actions.ts` | ADD | `getSourcesForExplanationAction` (+ import) |
| `src/hooks/useExplanationLoader.ts` | MODIFY | Add `onSourcesLoad` callback, update imports, update deps |
| `src/app/results/page.tsx` | MODIFY | Wire up `onSourcesLoad: setSources` |
| `src/lib/prompts.ts` | MODIFY | Update citation instructions (lines 287-291) |
| `src/components/sources/Bibliography.tsx` | MODIFY | Add `data-testid="bibliography"` |

### Test Code
| File | Type | Description |
|------|------|-------------|
| `src/actions/getSourcesForExplanation.test.ts` | NEW | Unit tests for action (colocated) |
| `src/__tests__/integration/source-citation.integration.test.ts` | NEW | Integration tests |
| `src/__tests__/e2e/helpers/pages/ResultsPage.ts` | MODIFY | Add source helper methods |
| `src/__tests__/e2e/specs/04-content-viewing/sources.spec.ts` | NEW | E2E citation tests |

### Config
- No config changes needed

### Documentation
| File | Type |
|------|------|
| `docs/planning/source_citations_20250107/` | NEW - This planning folder |

---

## 8. Subagent Evaluation Summary

Three subagents evaluated this plan. Key issues addressed:

1. **Architecture Agent**: Identified wrong action wrapper pattern → Fixed to use `withLogging` + `serverReadRequestId`
2. **Testing Agent**: Identified wrong test directory → Fixed to colocated pattern
3. **Implementation Agent**: Identified missing dependency array update → Added to Phase 2

All critical issues have been addressed in this revision.
