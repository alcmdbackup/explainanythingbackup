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

## 4. Key Design Decision: Fire-and-Forget Pattern

**Decision**: Summary generation uses **fire-and-forget** pattern.
- Articles always publish successfully regardless of summary generation outcome
- Missing summaries gracefully fallback to truncated content in UI
- Errors are logged but never block the publish flow

**Rationale**:
- Summaries are enhancement, not critical data
- User experience prioritizes fast publish over complete metadata
- Backfill script handles any failures

## 5. Phased Execution Plan

### Phase 1: Database Schema
Add columns to `explanations` table:

**Create**: `supabase/migrations/YYYYMMDDHHMMSS_add_summary_fields.sql`
```sql
-- Add summary fields to explanations table
ALTER TABLE explanations ADD COLUMN summary_teaser TEXT;
ALTER TABLE explanations ADD COLUMN meta_description VARCHAR(160);
ALTER TABLE explanations ADD COLUMN keywords TEXT[];

-- GIN index for keyword array search
CREATE INDEX idx_explanations_keywords ON explanations USING GIN (keywords);

-- Partial index for articles needing summaries (for backfill queries)
CREATE INDEX idx_explanations_missing_summary
  ON explanations (id)
  WHERE summary_teaser IS NULL AND status = 'published';

COMMENT ON COLUMN explanations.summary_teaser IS '1-2 sentence preview, 30-50 words';
COMMENT ON COLUMN explanations.meta_description IS 'SEO description, max 160 chars';
COMMENT ON COLUMN explanations.keywords IS 'Array of 5-10 search terms';
```

**Modify**: `src/lib/schemas/schemas.ts`
```typescript
// Add to ExplanationFullDbSchema
export const ExplanationFullDbSchema = explanationInsertSchema.extend({
    id: z.number(),
    timestamp: z.string(),
    // New summary fields (nullable for backwards compatibility)
    summary_teaser: z.string().nullable().optional(),
    meta_description: z.string().max(160).nullable().optional(),
    keywords: z.array(z.string()).nullable().optional(),
});

// New schema for LLM structured output
export const explanationSummarySchema = z.object({
    summary_teaser: z.string()
        .min(50).max(200)
        .describe('1-2 sentence teaser summarizing the article, 30-50 words'),
    meta_description: z.string()
        .min(50).max(160)
        .describe('SEO-optimized description for search engines and social cards'),
    keywords: z.array(z.string().min(2).max(30))
        .min(5).max(10)
        .describe('Relevant search terms for this article'),
});
export type ExplanationSummary = z.infer<typeof explanationSummarySchema>;
```

**Files modified:**
- New migration: `supabase/migrations/YYYYMMDDHHMMSS_add_summary_fields.sql`
- Modify: `src/lib/schemas/schemas.ts` (add fields to schema + new explanationSummarySchema)

**Test checkpoint:**
```bash
npx supabase db push
npm run type-check
```

---

### Phase 2: Summarizer Service
**Create**: `src/lib/services/explanationSummarizer.ts`

```typescript
/**
 * Generates AI summaries for explanations using gpt-4.1-nano.
 * Fire-and-forget: errors are logged but never thrown to caller.
 */

import { callOpenAIModel, lighter_model } from './llms';
import { explanationSummarySchema, type ExplanationSummary } from '../schemas/schemas';
import { updateExplanationSummary } from './explanations';
import { logger } from '../observability/logger';

const SUMMARIZER_PROMPT = `You are summarizing an educational article for display on an explore page.

Article Title: {title}

Article Content:
{content}

Generate:
1. summary_teaser: A compelling 1-2 sentence preview (30-50 words) that captures the key insight
2. meta_description: An SEO-optimized description (max 160 chars) for search engines
3. keywords: 5-10 relevant search terms (single words or short phrases)

Focus on what makes this article valuable to readers.`;

export async function generateAndSaveExplanationSummary(
    explanationId: number,
    title: string,
    content: string,
    userid: string
): Promise<void> {
    try {
        const prompt = SUMMARIZER_PROMPT
            .replace('{title}', title)
            .replace('{content}', content.slice(0, 4000)); // Limit context

        const result = await callOpenAIModel(
            prompt,
            'explanation_summarization',
            userid,
            lighter_model,
            false,
            null,
            explanationSummarySchema,
            'ExplanationSummary'
        );

        const parsed = explanationSummarySchema.safeParse(JSON.parse(result));

        if (!parsed.success) {
            logger.warn('Summary schema validation failed', {
                explanationId,
                errors: parsed.error.errors,
            });
            return;
        }

        await updateExplanationSummary(explanationId, parsed.data);

        logger.info('Generated explanation summary', {
            explanationId,
            keywordCount: parsed.data.keywords.length,
        });
    } catch (error) {
        // Fire-and-forget: log but don't throw
        logger.error('Failed to generate explanation summary', {
            explanationId,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
```

**Modify**: `src/lib/services/explanations.ts` - add update function:
```typescript
import type { ExplanationSummary } from '../schemas/schemas';

export async function updateExplanationSummary(
    explanationId: number,
    summary: ExplanationSummary
): Promise<void> {
    const supabase = await createSupabaseServerClient();

    const { error } = await supabase
        .from('explanations')
        .update({
            summary_teaser: summary.summary_teaser,
            meta_description: summary.meta_description,
            keywords: summary.keywords,
        })
        .eq('id', explanationId);

    if (error) {
        throw error;
    }
}
```

**Files modified:**
- New: `src/lib/services/explanationSummarizer.ts`
- Modify: `src/lib/services/explanations.ts` (add updateExplanationSummary)

**Test checkpoint:**
```bash
npm run type-check
npm run test -- explanationSummarizer
```

---

### Phase 3: Integration into Publish Flow
**Modify**: `src/lib/services/returnExplanation.ts`

Location: After `saveCandidatesFromLLM()` in the post-save operations block

```typescript
// Import at top of file
import { generateAndSaveExplanationSummary } from './explanationSummarizer';

// In returnExplanationLogic(), after saveCandidatesFromLLM call:
// Fire-and-forget: don't await, don't block publish
generateAndSaveExplanationSummary(
    newExplanationId,
    titleResult,
    newExplanationData!.content,
    userid
).catch(err => {
    // Already logged in service, but add context
    logger.debug('Summary generation initiated (fire-and-forget)', {
        explanationId: newExplanationId,
    });
});
```

**Files modified:**
- `src/lib/services/returnExplanation.ts` (add import + fire-and-forget call)

**Test checkpoint:**
```bash
npm run type-check
npm run build
# Manual test: create new explanation, verify summary fields populated after ~2s
```

---

### Phase 4: Update UI Components
**Modify**: `src/components/explore/ExplanationCard.tsx`

```typescript
export default function ExplanationCard({explanation, index = 0, showViews = false}) {
    // Prefer summary_teaser, fallback to stripped content
    const preview = explanation.summary_teaser
        ? explanation.summary_teaser
        : stripTitleFromContent(explanation.content);

    // Rest of component unchanged...
}
```

**Modify**: `src/lib/services/explanations.ts` - update `getRecentExplanations()`:
```typescript
// In the .select() call, add summary fields:
.select(`
    id,
    explanation_title,
    content,
    timestamp,
    primary_topic_id,
    secondary_topic_id,
    status,
    summary_teaser,
    meta_description,
    keywords
`)
```

**Files modified:**
- `src/components/explore/ExplanationCard.tsx`
- `src/lib/services/explanations.ts` (update select in getRecentExplanations)

**Test checkpoint:**
```bash
npm run type-check
npm run build
npm run test:integration -- explore
# Visual test: check /explore page renders summaries
```

---

### Phase 5: Backfill Script
**Create**: `scripts/backfill-summaries.ts`

```typescript
/**
 * One-time backfill script for existing explanations without summaries.
 *
 * Usage:
 *   npx tsx scripts/backfill-summaries.ts [--dry-run] [--batch-size=10] [--delay-ms=1000]
 */

import { createClient } from '@supabase/supabase-js';
import { generateAndSaveExplanationSummary } from '../src/lib/services/explanationSummarizer';

const BATCH_SIZE = parseInt(process.argv.find(a => a.startsWith('--batch-size='))?.split('=')[1] || '10');
const DELAY_MS = parseInt(process.argv.find(a => a.startsWith('--delay-ms='))?.split('=')[1] || '1000');
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
    const supabase = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get count first
    const { count } = await supabase
        .from('explanations')
        .select('*', { count: 'exact', head: true })
        .is('summary_teaser', null)
        .eq('status', 'published');

    console.log(`Found ${count} explanations needing summaries`);

    if (DRY_RUN) {
        console.log('Dry run - no changes made');
        return;
    }

    let processed = 0;
    let errors = 0;

    while (true) {
        const { data: batch } = await supabase
            .from('explanations')
            .select('id, explanation_title, content')
            .is('summary_teaser', null)
            .eq('status', 'published')
            .limit(BATCH_SIZE);

        if (!batch || batch.length === 0) break;

        for (const explanation of batch) {
            try {
                await generateAndSaveExplanationSummary(
                    explanation.id,
                    explanation.explanation_title,
                    explanation.content,
                    'backfill-script'
                );
                processed++;
                console.log(`[${processed}/${count}] Processed: ${explanation.id}`);
            } catch (err) {
                errors++;
                console.error(`Failed: ${explanation.id}`, err);
            }
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }

    console.log(`\nComplete: ${processed} processed, ${errors} errors`);
}

main().catch(console.error);
```

**Files created:**
- `scripts/backfill-summaries.ts`

**Test checkpoint:**
```bash
# Dry run first
npx tsx scripts/backfill-summaries.ts --dry-run

# Small batch test
npx tsx scripts/backfill-summaries.ts --batch-size=2

# Full run (on staging first!)
npx tsx scripts/backfill-summaries.ts
```

---

### Phase 6: SEO Meta Tags
**Modify**: `src/app/results/[id]/page.tsx` (or wherever article detail page lives)

```typescript
import { Metadata } from 'next';

export async function generateMetadata({ params }): Promise<Metadata> {
    const explanation = await getExplanationById(params.id);

    return {
        title: explanation.explanation_title,
        description: explanation.meta_description || explanation.summary_teaser?.slice(0, 160),
        keywords: explanation.keywords?.join(', '),
        openGraph: {
            title: explanation.explanation_title,
            description: explanation.meta_description || explanation.summary_teaser,
        },
    };
}
```

**Files modified:**
- `src/app/results/[id]/page.tsx`

---

## 6. Testing

### Unit Tests
**Create**: `src/lib/services/explanationSummarizer.test.ts`
```typescript
describe('explanationSummarizer', () => {
    describe('generateAndSaveExplanationSummary', () => {
        it('generates valid summary from article content', async () => {
            // Mock callOpenAIModel to return valid response
        });

        it('handles LLM API errors gracefully (fire-and-forget)', async () => {
            // Mock callOpenAIModel to throw, verify no exception propagated
        });

        it('handles malformed JSON gracefully', async () => {
            // Mock invalid JSON response
        });

        it('handles schema validation failures gracefully', async () => {
            // Mock response that fails schema validation
        });
    });
});
```

### Integration Tests
**Create**: `src/lib/services/explanationSummarizer.integration.test.ts`
```typescript
describe('explanationSummarizer integration', () => {
    it('new explanations get summaries generated via publish flow', async () => {
        // Create explanation via returnExplanationLogic
        // Wait briefly for fire-and-forget to complete
        // Verify summary fields populated
    });
});
```

### E2E Tests
**Modify/Create**: `tests/e2e/explore.spec.ts`
```typescript
test('explore page shows summary teasers when available', async ({ page }) => {
    await page.goto('/explore');
    // Verify cards show summary text instead of truncated markdown
});

test('article page has SEO meta tags', async ({ page }) => {
    await page.goto('/results/[known-id]');
    const description = await page.locator('meta[name="description"]').getAttribute('content');
    expect(description).toBeTruthy();
});
```

### Manual Testing on Stage
- Create new article, verify summary fields populated
- Check /explore page shows teaser
- Verify SEO meta tags render correctly

---

## 7. Complete File Manifest

### New Files
| File | Phase |
|------|-------|
| `supabase/migrations/YYYYMMDDHHMMSS_add_summary_fields.sql` | 1 |
| `src/lib/services/explanationSummarizer.ts` | 2 |
| `scripts/backfill-summaries.ts` | 5 |
| `src/lib/services/explanationSummarizer.test.ts` | 6 |
| `src/lib/services/explanationSummarizer.integration.test.ts` | 6 |

### Modified Files
| File | Phase | Changes |
|------|-------|---------|
| `src/lib/schemas/schemas.ts` | 1 | Add summary fields to schema, new explanationSummarySchema |
| `src/lib/services/explanations.ts` | 2, 4 | Add updateExplanationSummary(), update getRecentExplanations select |
| `src/lib/services/returnExplanation.ts` | 3 | Add import + fire-and-forget call |
| `src/components/explore/ExplanationCard.tsx` | 4 | Use summary_teaser with fallback |
| `src/app/results/[id]/page.tsx` | 6 | Add generateMetadata for SEO |
| `tests/e2e/explore.spec.ts` | 6 | Add summary/SEO tests |

---

## 8. Execution Checklist

After each phase:
- [ ] `npm run type-check` passes
- [ ] `npm run build` passes
- [ ] `npm run lint` passes
- [ ] Phase-specific tests pass
- [ ] Commit changes

Final verification:
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] All E2E tests pass
- [ ] Manual test on staging
- [ ] Documentation updated (`docs/docs_overall/architecture.md`, `docs/feature_deep_dives/`)

---

## 9. Documentation Updates
- Update `docs/docs_overall/architecture.md` with summary generation flow
- Add entry to `docs/feature_deep_dives/` explaining the summarization system
