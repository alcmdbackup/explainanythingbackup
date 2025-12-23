# Import Sources V1 - Technical Implementation Plan

## Overview

This plan implements user-provided source URLs to ground AI explanations with inline citations. Based on `import_sources_design.md`.

---

## Phase 1: Database Schema

### 1.1 Create `source_cache` Table

```sql
-- Migration: create_source_cache_table
CREATE TABLE source_cache (
  id SERIAL PRIMARY KEY,
  url TEXT UNIQUE NOT NULL,
  url_hash TEXT GENERATED ALWAYS AS (encode(sha256(url::bytea), 'hex')) STORED,
  title TEXT,
  favicon_url TEXT,
  domain TEXT NOT NULL,
  extracted_text TEXT,
  is_summarized BOOLEAN DEFAULT FALSE,
  original_length INTEGER,
  fetch_status TEXT DEFAULT 'pending' CHECK (fetch_status IN ('pending', 'success', 'failed')),
  error_message TEXT,
  fetched_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_source_cache_url_hash ON source_cache(url_hash);
CREATE INDEX idx_source_cache_expires ON source_cache(expires_at);
```

### 1.2 Create `article_sources` Junction Table

```sql
-- Migration: create_article_sources_table
CREATE TABLE article_sources (
  id SERIAL PRIMARY KEY,
  explanation_id INTEGER NOT NULL REFERENCES explanations(id) ON DELETE CASCADE,
  source_cache_id INTEGER NOT NULL REFERENCES source_cache(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(explanation_id, source_cache_id),
  UNIQUE(explanation_id, position)
);

CREATE INDEX idx_article_sources_explanation ON article_sources(explanation_id);
```

### 1.3 RLS Policies

```sql
-- Enable RLS
ALTER TABLE source_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_sources ENABLE ROW LEVEL SECURITY;

-- source_cache: public read (shared cache), authenticated insert/update
CREATE POLICY "Anyone can read source cache" ON source_cache FOR SELECT USING (true);
CREATE POLICY "Authenticated users can insert sources" ON source_cache FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- article_sources: authenticated users only
CREATE POLICY "Authenticated users can manage article sources" ON article_sources USING (auth.role() = 'authenticated');
```

**Files to create:**
- `supabase/migrations/YYYYMMDD_create_source_cache.sql`
- `supabase/migrations/YYYYMMDD_create_article_sources.sql`

---

## Phase 2: Zod Schemas & Types

Add to `src/lib/schemas/schemas.ts`:

```typescript
// Source cache schemas
export const sourceCacheInsertSchema = z.object({
  url: z.string().url(),
  title: z.string().nullable(),
  favicon_url: z.string().url().nullable(),
  domain: z.string(),
  extracted_text: z.string().nullable(),
  is_summarized: z.boolean().default(false),
  original_length: z.number().int().nullable(),
  fetch_status: z.enum(['pending', 'success', 'failed']).default('pending'),
  error_message: z.string().nullable(),
  expires_at: z.string().datetime().nullable(),
});

export const sourceCacheFullSchema = sourceCacheInsertSchema.extend({
  id: z.number().int().positive(),
  url_hash: z.string(),
  fetched_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
});

// Article sources junction
export const articleSourceInsertSchema = z.object({
  explanation_id: z.number().int().positive(),
  source_cache_id: z.number().int().positive(),
  position: z.number().int().min(1).max(5),
});

// UI types for source chips
export const sourceChipSchema = z.object({
  url: z.string().url(),
  title: z.string().nullable(),
  favicon_url: z.string().nullable(),
  domain: z.string(),
  status: z.enum(['loading', 'success', 'failed']),
  error_message: z.string().nullable(),
});

export type SourceCacheInsertType = z.infer<typeof sourceCacheInsertSchema>;
export type SourceCacheFullType = z.infer<typeof sourceCacheFullSchema>;
export type ArticleSourceInsertType = z.infer<typeof articleSourceInsertSchema>;
export type SourceChipType = z.infer<typeof sourceChipSchema>;
```

---

## Phase 3: Backend Services

### 3.1 URL Fetching Service

**File:** `src/lib/services/sourceFetcher.ts`

```typescript
// Key functions:
export const fetchAndExtractSource = withLogging(async function(url: string): Promise<{
  success: boolean;
  data: SourceCacheInsertType | null;
  error: string | null;
}> {
  // 1. Validate URL
  // 2. Server-side fetch with 10s timeout
  // 3. Extract with readability (mozilla/readability)
  // 4. Extract metadata: title, favicon, domain
  // 5. Check length threshold (3000 words)
  // 6. If over threshold, summarize with cheaper model
  // 7. Return extracted data
});

export const getOrCreateCachedSource = withLogging(async function(url: string): Promise<{
  source: SourceCacheFullType | null;
  isFromCache: boolean;
}> {
  // 1. Check cache by URL hash
  // 2. If cached and not expired (7 days), return
  // 3. If not cached or expired, fetch and cache
  // 4. Return source data
});
```

**Dependencies to add:**
- `@mozilla/readability` - Content extraction
- `linkedom` - DOM parsing (lighter than jsdom)

### 3.2 Source Cache Service

**File:** `src/lib/services/sourceCache.ts`

```typescript
export const insertSourceCache = withLogging(async function(...));
export const getSourceByUrl = withLogging(async function(...));
export const getSourcesByExplanationId = withLogging(async function(...));
export const linkSourcesToExplanation = withLogging(async function(
  explanationId: number,
  sourceIds: number[]
): Promise<void>);
```

### 3.3 Content Summarization

**File:** `src/lib/services/sourceSummarizer.ts`

```typescript
export const summarizeSourceContent = withLogging(async function(
  content: string,
  maxWords: number = 3000,
  userid: string
): Promise<{
  summarized: string;
  isVerbatim: boolean;
  originalLength: number;
}> {
  // Use gpt-4.1-nano for cost efficiency
  // Mark verbatim vs summarized sections
});
```

---

## Phase 4: LLM Prompt Integration

### 4.1 Update Prompts

**File:** `src/lib/prompts.ts`

Add new prompt creator:

```typescript
export function createExplanationWithSourcesPrompt(
  userQuery: string,
  sources: Array<{
    index: number;
    title: string;
    domain: string;
    content: string;
    isVerbatim: boolean;
  }>
): string {
  // Include source content in prompt
  // Instruct LLM to use [n] notation for citations
  // Distinguish verbatim vs summarized content
}
```

### 4.2 Update returnExplanation Service

**File:** `src/lib/services/returnExplanation.ts`

Modify `returnExplanationLogic` to:
1. Accept optional `sources: SourceCacheFullType[]` parameter
2. Pass sources to prompt if provided
3. Store article-source associations after generation

---

## Phase 5: API Route Updates

### 5.1 New Source Metadata Endpoint

**File:** `src/app/api/fetchSourceMetadata/route.ts`

```typescript
// POST /api/fetchSourceMetadata
// Body: { url: string }
// Returns: { success, data: SourceChipType, error }
// Used by: Client to preview source before generation
```

### 5.2 Update returnExplanation Route

**File:** `src/app/api/returnExplanation/route.ts`

Add `sources` to request body schema. Pass to service.

---

## Phase 6: UI Components

### 6.1 SourceInput Component

**File:** `src/components/sources/SourceInput.tsx`

```typescript
interface SourceInputProps {
  onSourceAdded: (source: SourceChipType) => void;
  disabled?: boolean;
}

// - URL input field with "Add" button
// - Validates URL format
// - Calls /api/fetchSourceMetadata on submit
// - Shows loading state while fetching
```

### 6.2 SourceChip Component

**File:** `src/components/sources/SourceChip.tsx`

```typescript
interface SourceChipProps {
  source: SourceChipType;
  onRemove: () => void;
  showWarning?: boolean;
}

// - Displays: favicon, title, domain
// - Warning icon for failed fetches
// - Remove button (X)
// - Styling: matches TagBar bookmark style
```

### 6.3 SourceList Component

**File:** `src/components/sources/SourceList.tsx`

```typescript
interface SourceListProps {
  sources: SourceChipType[];
  onRemove: (index: number) => void;
  maxSources?: number; // default 5
}

// - Renders list of SourceChips
// - Shows count (e.g., "3/5 sources")
// - Handles empty state
```

### 6.4 Bibliography Component

**File:** `src/components/sources/Bibliography.tsx`

```typescript
interface BibliographyProps {
  sources: Array<{ index: number; title: string; domain: string; url: string }>;
}

// - Footer section for rendered article
// - Numbered references: [n] Title - domain.com (link)
// - Styling: scholarly bibliography appearance
```

### 6.5 CitationTooltip Component

**File:** `src/components/sources/CitationTooltip.tsx`

```typescript
// - Hover tooltip for inline [n] citations
// - Shows source title + domain
// - Uses Radix UI Tooltip primitive
```

---

## Phase 7: Home Page Integration

### 7.1 Update SearchBar

**File:** `src/components/SearchBar.tsx`

Add collapsible source input area:

```typescript
// - "+ Add Sources" link below search bar (home variant only)
// - Clicking expands SourceList + SourceInput
// - Sources state passed up to parent
// - Submit includes sources in navigation
```

### 7.2 Update Home Page

**File:** `src/app/page.tsx`

```typescript
// - Manage sources state: useState<SourceChipType[]>([])
// - Pass sources to SearchBar
// - Include sources in query params or session storage
// - Navigate with source IDs
```

---

## Phase 8: Results Page Integration

### 8.1 Rewrite with Feedback Panel

**File:** `src/components/RewriteWithFeedback.tsx`

Combines existing TagBar functionality with sources:

```typescript
interface RewriteWithFeedbackProps {
  tagState: TagModeState;
  dispatchTagAction: Dispatch<TagModeAction>;
  sources: SourceChipType[];
  onSourcesChange: (sources: SourceChipType[]) => void;
  onApply: (tagDescriptions: string[], sources: SourceChipType[]) => void;
}

// - Section 1: Tag preferences (existing TagBar UI)
// - Section 2: Source URLs (SourceList + SourceInput)
// - Apply button triggers rewrite with both
```

### 8.2 Update Results Page

**File:** `src/app/results/page.tsx`

1. Add sources state management
2. Update `handleUserAction` to accept sources
3. Display Bibliography for articles with sources
4. Add citation tooltip triggers in editor

### 8.3 Citation Rendering in Editor

**File:** `src/editorFiles/lexicalEditor/plugins/CitationPlugin.tsx`

```typescript
// - Detects [n] patterns in content
// - Wraps in interactive span
// - Hover shows CitationTooltip
// - Click scrolls to Bibliography
```

---

## Phase 9: Error Handling

### 9.1 Failed Fetch Modal

**File:** `src/components/sources/FailedSourcesModal.tsx`

```typescript
// - Shows when user submits with failed sources
// - Lists failed URLs
// - Options: "Remove failed" or "Proceed anyway"
// - Calls onConfirm with decision
```

### 9.2 Error Codes

Add to `src/lib/errorHandling.ts`:

```typescript
SOURCE_FETCH_TIMEOUT: 'source_fetch_timeout',
SOURCE_FETCH_FAILED: 'source_fetch_failed',
SOURCE_CONTENT_EMPTY: 'source_content_empty',
SOURCE_PAYWALL_DETECTED: 'source_paywall_detected',
```

---

## Phase 10: Testing

### 10.1 Unit Tests

- `sourceFetcher.test.ts` - URL fetching, extraction
- `sourceCache.test.ts` - Cache CRUD operations
- `SourceChip.test.tsx` - Component rendering, interactions
- `SourceInput.test.tsx` - URL validation, submission

### 10.2 Integration Tests

- `sources-generation.integration.test.ts` - Full pipeline with sources

### 10.3 E2E Tests

**File:** `__tests__/e2e/specs/06-sources/sources.spec.ts`

- Add sources on home page, verify generation
- Rewrite with sources on results page
- Failed source handling
- Citation display and interactions

---

## Implementation Order

1. **Database** - Migrations first (no dependencies)
2. **Schemas** - Types for all layers
3. **Backend services** - sourceFetcher, sourceCache
4. **API route** - fetchSourceMetadata endpoint
5. **UI components** - SourceChip, SourceInput, SourceList
6. **Home page** - Add sources before generation
7. **Results page** - RewriteWithFeedback panel
8. **Citation display** - Bibliography, tooltips
9. **Error handling** - Failed fetch modal
10. **Testing** - All test levels

---

## Key Files to Modify

| File | Changes |
|------|---------|
| `src/lib/schemas/schemas.ts` | Add source schemas |
| `src/lib/services/returnExplanation.ts` | Accept sources param |
| `src/lib/prompts.ts` | Add citation prompt |
| `src/app/api/returnExplanation/route.ts` | Add sources to body |
| `src/components/SearchBar.tsx` | Add sources input area |
| `src/app/page.tsx` | Manage sources state |
| `src/app/results/page.tsx` | Sources in rewrite flow |

## New Files to Create

| File | Purpose |
|------|---------|
| `supabase/migrations/*_source_cache.sql` | DB schema |
| `src/lib/services/sourceFetcher.ts` | URL extraction |
| `src/lib/services/sourceCache.ts` | Cache operations |
| `src/lib/services/sourceSummarizer.ts` | Content summarization |
| `src/app/api/fetchSourceMetadata/route.ts` | Metadata endpoint |
| `src/components/sources/SourceInput.tsx` | URL input |
| `src/components/sources/SourceChip.tsx` | Source chip |
| `src/components/sources/SourceList.tsx` | Chip container |
| `src/components/sources/Bibliography.tsx` | Footer refs |
| `src/components/sources/CitationTooltip.tsx` | Hover preview |
| `src/components/RewriteWithFeedback.tsx` | Combined panel |
| `src/editorFiles/lexicalEditor/plugins/CitationPlugin.tsx` | Citation links |

---

## Dependencies to Add

```bash
npm install @mozilla/readability linkedom
```

---

## Design Decisions

1. **Session storage** - Sources passed from home to results via `sessionStorage`. Better for large data, survives page refresh.

2. **Summarization model** - Use `gpt-4.1-nano` for cost-efficient summarization of long content.

3. **No manual cache refresh** - Sources auto-expire after 7 days per spec. Simpler UX.
