# Explanation Summaries System

## Overview

AI-generated summaries for explanations, providing:
- **Explore Page Teasers**: 30-50 word previews for explore page cards
- **SEO Meta Descriptions**: Max 160 char descriptions for search engines
- **Keywords**: 5-10 search terms for internal search matching

## Architecture

### Database Schema

```sql
-- Added to explanations table
ALTER TABLE explanations ADD COLUMN summary_teaser TEXT;
ALTER TABLE explanations ADD COLUMN meta_description VARCHAR(160);
ALTER TABLE explanations ADD COLUMN keywords TEXT[];

-- GIN index for keyword array search
CREATE INDEX idx_explanations_keywords ON explanations USING GIN (keywords);

-- Partial index for backfill queries
CREATE INDEX idx_explanations_missing_summary
  ON explanations (id)
  WHERE summary_teaser IS NULL AND status = 'published';
```

### Zod Schema

```typescript
// src/lib/schemas/schemas.ts
export const explanationSummarySchema = z.object({
    summary_teaser: z.string().min(50).max(200),
    meta_description: z.string().min(50).max(160),
    keywords: z.array(z.string().min(2).max(30)).min(5).max(10),
});
```

## Generation Flow

### Fire-and-Forget Pattern

Summaries are generated asynchronously after article publish:

```
Article Published → saveCandidatesFromLLM() → generateAndSaveExplanationSummary() → Return to User
                                                    ↓ (async, non-blocking)
                                              Call gpt-4.1-nano → Save to DB
```

**Key Design Decision**: Summary generation uses fire-and-forget pattern.
- Articles always publish successfully regardless of summary generation outcome
- Missing summaries gracefully fallback to truncated content in UI
- Errors are logged but never block the publish flow

### Integration Point

Located in `src/lib/services/returnExplanation.ts`:

```typescript
// After saveCandidatesFromLLM...
generateAndSaveExplanationSummary(
    newExplanationId,
    titleResult,
    newExplanationData!.content,
    userid
).catch(err => {
    logger.debug('Summary generation initiated (fire-and-forget)', {
        explanationId: newExplanationId,
    });
});
```

## Summarizer Service

Located at `src/lib/services/explanationSummarizer.ts`:

- Uses `gpt-4.1-nano` for cost efficiency
- Truncates content to 4000 characters to limit token usage
- Validates response against `explanationSummarySchema`
- Logs errors but never throws to caller

## UI Integration

### ExplanationCard

```typescript
// src/components/explore/ExplanationCard.tsx
const preview = explanation.summary_teaser
    ? explanation.summary_teaser
    : stripTitleFromContent(explanation.content);
```

### SEO Metadata

```typescript
// src/components/SEOHead.tsx - Client-side metadata injection
// src/hooks/useExplanationLoader.ts - Exposes metaDescription and keywords
```

## Backfill Script

For existing articles without summaries:

```bash
# Dry run
npx tsx scripts/backfill-summaries.ts --dry-run

# Small batch test
npx tsx scripts/backfill-summaries.ts --batch-size=2

# Full run
npx tsx scripts/backfill-summaries.ts --batch-size=10 --delay-ms=1000
```

Options:
- `--dry-run`: Show what would be processed without changes
- `--batch-size=N`: Process N explanations per batch (default: 10)
- `--delay-ms=N`: Wait N ms between batches for rate limiting (default: 1000)

## Testing

Unit tests: `src/lib/services/explanationSummarizer.test.ts`

Covers:
- Valid summary generation
- LLM API error handling (fire-and-forget)
- Malformed JSON handling
- Schema validation failures
- Content truncation
- Database error handling
