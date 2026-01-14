# Add Sources & Citations

## Overview

The "Add Sources" feature allows users to provide URLs that ground AI-generated explanations with inline citations. Sources serve as reference material for the LLM, which generates content citing these sources with `[n]` notation and a bibliography footer.

**Core loop**: User adds URLs → Content extracted & cached → LLM generates with citations → Bibliography displayed

## Key Files

### Services
- `src/lib/services/sourceFetcher.ts` - URL fetching, content extraction with Readability
- `src/lib/services/sourceCache.ts` - Global cache CRUD, article-source linking
- `src/lib/services/sourceSummarizer.ts` - Summarization for content exceeding 3000 words

### API Routes
- `src/app/api/fetchSourceMetadata/route.ts` - Client-facing endpoint for source preview

### UI Components
- `src/components/sources/SourceInput.tsx` - URL input with validation
- `src/components/sources/SourceChip.tsx` - Removable chip showing source metadata
- `src/components/sources/SourceList.tsx` - Container for source chips (max 5)
- `src/components/sources/Bibliography.tsx` - Footer references section
- `src/components/sources/CitationTooltip.tsx` - Hover preview for inline citations
- `src/components/sources/FailedSourcesModal.tsx` - Warning when sources fail to load

### Editor Integration
- `src/editorFiles/lexicalEditor/CitationPlugin.tsx` - Detects `[n]` patterns, makes interactive

### Prompts
- `src/lib/prompts.ts` - `createExplanationWithSourcesPrompt()` function

## Implementation

### Data Flow

```
User adds URL (Home/Results page)
         ↓
SourceInput.tsx → POST /api/fetchSourceMetadata
         ↓
sourceFetcher.ts: fetch + Readability extraction
         ↓
sourceCache.ts: cache in source_cache table (7-day expiry)
         ↓
SourceChip displayed with: favicon, title, domain
         ↓
User submits query (sourceUrls[] in request body)
         ↓
returnExplanation.ts: build prompt with source content
         ↓
LLM generates with [n] citations
         ↓
article_sources junction table links sources to explanation
         ↓
CitationPlugin makes [n] interactive
         ↓
Bibliography renders footer with numbered references
```

### Database Schema

**source_cache table**:
```sql
- id, url, url_hash (SHA256)
- title, favicon_url, domain
- extracted_text, is_summarized, original_length
- fetch_status ('pending' | 'success' | 'failed')
- error_message, fetched_at, expires_at
```

**article_sources junction**:
```sql
- explanation_id, source_cache_id, position (1-5)
```

### Filter Cascade

Sources pass through 6 filter points before reaching the LLM:

| # | Location | Condition |
|---|----------|-----------|
| 1 | page.tsx | `status === 'success'` |
| 2 | route.ts | `fetch_status === 'success'` |
| 3 | route.ts | `resolvedSources.length > 0` |
| 4 | returnExplanation.ts | `extracted_text.length > 0` |
| 5 | returnExplanation.ts | `sources.length > 0` (prompt selection) |
| 6 | Bibliography.tsx | `sources.length > 0` |

If all sources fail filters, system silently falls back to standard (non-sources) prompt.

### Citation Format

LLM prompt instructs:
- Use `[n]` notation for citations (n = 1-5)
- Place citations after key factual claims, not entire sentences
- Distinguish between verbatim quotes and summarized content

### Caching Strategy

- **Global cache**: Same URL = same cached content (shared across users)
- **7-day expiry**: Balances freshness vs efficiency
- **Summarization**: Content > 3000 words summarized during fetch (not per-request)

## Known Issues

1. **Race condition**: Bibliography may disappear on page reload due to timing between INSERT and client query
2. **Silent degradation**: Sources filtered without user feedback
3. **CitationPlugin disabled early**: If sources array empty, citations render as plain text

## Entry Points

### Home Page
- "+ Add Sources" link below search bar
- Sources stored in sessionStorage, passed to results page

### Results Page
- "Rewrite with Feedback" dropdown option
- Combined panel for tags + sources
- Sources passed to API for regeneration

## Dependencies

- `@mozilla/readability` - Content extraction
- `linkedom` - DOM parsing (lighter than jsdom)
