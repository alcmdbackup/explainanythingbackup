# Explore Summaries Planning

## 1. Background
The /explore page displays article cards with truncated raw markdown content. Users can't quickly understand what each article covers, SEO metadata is missing, and internal search has no keyword data. Adding AI-generated structured summaries will improve discoverability, SEO, and search relevance.

## 2. Problem
- **Discoverability**: 4-line truncated content doesn't convey article value
- **SEO/Sharing**: No meta descriptions for social cards or search engines
- **Search**: No keyword extraction for better internal search matching
- **Cost**: Need very cheap solution (~fractions of a cent per article)

## 3. Options Considered

### Option A: Generate on-publish + backfill (SELECTED)
- Add summary fields to `explanations` table
- Generate via `gpt-4.1-nano` when article is published
- One-time backfill script for existing articles
- **Pros**: Simple, predictable cost, no background jobs
- **Cons**: Need manual backfill run

### Option B: Background job queue
- Use Supabase Edge Functions or external queue
- **Pros**: Handles failures gracefully
- **Cons**: More infrastructure, overkill for this use case

### Option C: On-demand with caching
- Generate when first requested
- **Pros**: Lazy, no backfill needed
- **Cons**: Slower first load, unpredictable costs

## 4. Phased Execution Plan

### Phase 1: Database Schema
Add columns to `explanations` table:
```sql
ALTER TABLE explanations ADD COLUMN summary_teaser TEXT;
ALTER TABLE explanations ADD COLUMN meta_description TEXT;
ALTER TABLE explanations ADD COLUMN keywords TEXT[];
```

**Files modified:**
- New migration: `supabase/migrations/YYYYMMDDHHMMSS_add_summary_fields.sql`
- Update types: `src/lib/schemas/schemas.ts` (add fields to `ExplanationFullDbType`)

### Phase 2: Summarizer Service
Create `src/lib/services/explanationSummarizer.ts`:

```typescript
export interface ExplanationSummary {
  summary_teaser: string;      // 1-2 sentences, ~30-50 words
  meta_description: string;    // SEO-optimized, ~150-160 chars
  keywords: string[];          // 5-10 relevant terms
}

export async function generateExplanationSummary(
  title: string,
  content: string,
  userid: string
): Promise<ExplanationSummary>
```

- Use `lighter_model` (`gpt-4.1-nano`) from existing LLM layer
- Structured output via Zod schema for consistent format
- Follow pattern from `sourceSummarizer.ts`

**Files modified:**
- New: `src/lib/services/explanationSummarizer.ts`
- New schema: Add `explanationSummarySchema` to `src/lib/schemas/schemas.ts`

### Phase 3: Integration into Publish Flow
Hook into `returnExplanationLogic()` after `saveExplanationAndTopic()`:

```typescript
// After line 646 in returnExplanation.ts
// Add to the parallel post-save tasks:
const summaryPromise = generateAndSaveExplanationSummary(
  newExplanationId,
  titleResult,
  newExplanationData!.content,
  userid
);

// Add to Promise.all or fire-and-forget
```

**Files modified:**
- `src/lib/services/returnExplanation.ts` (add summary generation call)
- `src/lib/services/explanations.ts` (add `updateExplanationSummary()` function)

### Phase 4: Update UI Components
Modify `ExplanationCard` to use `summary_teaser` when available:

```typescript
// In ExplanationCard.tsx
const preview = explanation.summary_teaser
  ? explanation.summary_teaser
  : stripTitleFromContent(explanation.content);
```

**Files modified:**
- `src/components/explore/ExplanationCard.tsx`
- `src/lib/schemas/schemas.ts` (ensure `ExplanationWithViewCount` includes summary fields)

### Phase 5: Backfill Script
Create one-time script `scripts/backfill-summaries.ts`:
- Query all explanations where `summary_teaser IS NULL`
- Process in batches of 10 with rate limiting
- Log progress and errors
- Can be run via `npx tsx scripts/backfill-summaries.ts`

**Files created:**
- `scripts/backfill-summaries.ts`

### Phase 6: SEO Meta Tags (optional follow-up)
Add meta tags to `/results` page using `meta_description`:
- Update `/src/app/results/page.tsx` to set `<meta name="description">`

## 5. Testing

### Unit Tests
- `src/lib/services/explanationSummarizer.test.ts`
  - Test prompt construction
  - Test schema validation
  - Test error handling

### Integration Tests
- Test that new explanations get summaries generated
- Test backfill script on test data

### Manual Testing on Stage
- Create new article, verify summary fields populated
- Check /explore page shows teaser
- Verify SEO meta tags render correctly

## 6. Documentation Updates
- Update `docs/docs_overall/architecture.md` with summary generation flow
- Add entry to `docs/feature_deep_dives/` explaining the summarization system
