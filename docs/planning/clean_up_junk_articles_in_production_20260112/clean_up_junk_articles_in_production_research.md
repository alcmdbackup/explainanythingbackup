# Clean Up Junk Articles in Production Research

**Date**: 2026-01-12T15:27:34Z
**Git Commit**: b4246954105258425c5b1bdd1ddc2ce48c854808
**Branch**: fix/clean_up_junk_articles_in_production

## Problem Statement

Clean up existing junk/test articles from production database and implement safeguards to prevent generation of new junk content going forward.

## High Level Summary

The codebase has several mechanisms for content quality but lacks explicit "junk detection" or content review systems. Key findings:

1. **Existing Test Content Filtering**: Title prefixes `[TEST]` and `test-` are filtered from discovery pages but the data remains in DB
2. **No Automatic Cleanup**: `deleteExplanation` does NOT automatically clean up Pinecone vectors - manual cleanup required
3. **Cleanup Script Exists**: `scripts/cleanup-test-content.ts` provides batch deletion with pattern matching
4. **Quality Markers Available**: Status field (`draft`/`published`), source field, engagement metrics (views/saves)
5. **Prevention Gap**: No minimum content length, keyword analysis, or confidence scoring before content is saved

## Documents Read

- `docs/docs_overall/getting_started.md` - Documentation navigation
- `docs/docs_overall/architecture.md` - System design and data flow
- `docs/docs_overall/project_workflow.md` - Development workflow

## Code Files Read

### Data Model & Schema
- `src/lib/schemas/schemas.ts` - Zod schemas for explanations, metrics, events
- `src/lib/services/explanations.ts` - CRUD operations for explanations
- `supabase/migrations/20251109053825_fix_drift.sql` - Core table definitions

### Content Generation Pipeline
- `src/lib/services/returnExplanation.ts` - Main generation orchestration
- `src/app/api/returnExplanation/route.ts` - API endpoint
- `src/lib/prompts.ts` - LLM prompt templates
- `src/actions/actions.ts` - Server actions for saving

### Quality & Moderation Systems
- `src/lib/services/tagEvaluation.ts` - Automatic tag assignment
- `src/lib/services/importArticle.ts` - Import validation (50-100k chars)
- `src/lib/services/findMatches.ts` - Test content filtering
- `src/lib/services/metrics.ts` - Engagement tracking

### Vector Store Integration
- `src/lib/services/vectorsim.ts` - Pinecone operations including `deleteVectorsByExplanationId()`

### Cleanup Operations
- `scripts/cleanup-test-content.ts` - Batch test content cleanup
- `src/__tests__/e2e/setup/global-teardown.ts` - E2E test cleanup

---

## Detailed Findings

### 1. Explanation Data Model

**Database Table**: `explanations`

| Column | Type | Notes |
|--------|------|-------|
| `id` | bigint | Primary key |
| `explanation_title` | text | Used for test filtering |
| `content` | text | Markdown content |
| `status` | varchar(20) | `'draft'` or `'published'` (default: published) |
| `source` | text | `'generated'`, `'chatgpt'`, `'claude'`, `'gemini'`, `'other'`, or null |
| `summary_teaser` | text | NULL for older content |
| `meta_description` | varchar(160) | SEO description |
| `keywords` | text[] | SEO keywords array |
| `timestamp` | timestamp | Creation time |

**Status Field Usage**:
- Discovery queries filter to `status = 'published'`
- Drafts are hidden from Explore/search pages
- Only published content can be saved to user library

### 2. Existing Junk Detection Mechanisms

#### Test Content Filtering (In `explanations.ts` and `findMatches.ts`)

```typescript
const TEST_CONTENT_PREFIX = '[TEST]';
const LEGACY_TEST_PREFIX = 'test-';
```

**Applied in**:
- `getRecentExplanations()` - Excludes from Explore page
- `filterTestContent()` - Excludes from Related recommendations

**Critical Gap**: This ONLY filters display - the data stays in database and Pinecone.

#### Import Content Validation (In `importArticle.ts`)

```typescript
// validateImportContent function
- Minimum: 50 characters
- Maximum: 100,000 characters
- Rejects empty/whitespace content
```

**Gap**: Generated content has NO minimum length requirement.

### 3. Content Generation Pipeline

**Flow**:
1. User query → Title generation via LLM
2. Vector search for existing matches
3. `calculateAllowedScores()` → Check if query is allowed
4. If no match → Generate new content via LLM
5. Schema validation (`explanationBaseSchema` - only checks title/content exist)
6. Post-process: heading titles, tag evaluation, link candidates
7. Save to DB and Pinecone

**Quality Checks During Generation**:
- ✅ Query allowance scoring (anchor similarity check)
- ✅ LLM response schema validation
- ✅ Tag evaluation (difficulty, length, features)
- ❌ No minimum content length
- ❌ No content quality scoring
- ❌ No keyword/relevance analysis
- ❌ No human review queue

### 4. Engagement Metrics Available

**Table**: `explanationMetrics`

| Metric | Purpose |
|--------|---------|
| `total_views` | Count of views (0 = no engagement) |
| `total_saves` | Count of user saves (0 = not valued) |
| `save_rate` | Ratio saves/views (0.0 = low quality signal) |

**Can Identify Junk By**:
- `total_views = 0` AND old `timestamp` → Never viewed
- `save_rate = 0.0` with many views → Viewed but not valued
- No summary_teaser → Older content (index exists for backfill)

### 5. Vector Store Cleanup

**Critical Finding**: Explanation deletion does NOT automatically clean Pinecone vectors.

**Manual cleanup required**:
```typescript
// In vectorsim.ts
async function deleteVectorsByExplanationId(explanationId: number, namespace = 'default')
```

**Existing cleanup script** (`scripts/cleanup-test-content.ts`):
- Matches patterns: `[TEST]%`, `test-%`, `e2e-test-%`
- Protected terms: "unit testing", "test-driven development", etc.
- Cascading deletes in FK order
- Supports dry-run mode

### 6. Database Deletion Strategy

| Table | Delete Type | Notes |
|-------|------------|-------|
| explanations | Hard Delete | Manual only |
| explanation_tags | Soft Delete | `isDeleted = true` |
| explanationMetrics | Hard Delete | Via FK cascade |
| userLibrary | Hard Delete | Via FK cascade |
| Pinecone vectors | Manual | Must call `deleteVectorsByExplanationId()` |

**Cleanup Order** (from cleanup script):
1. article_link_overrides
2. article_heading_links
3. article_sources
4. candidate_occurrences
5. link_candidates
6. explanation_tags
7. explanationMetrics
8. userLibrary
9. userQueries
10. **Pinecone vectors**
11. explanations

---

## Summary: Available Junk Identification Criteria

### Direct Markers
1. Title prefix `[TEST]` or `test-` → Known test content
2. `status = 'draft'` → Never published
3. `source IN ('chatgpt', 'claude', 'gemini', 'other')` → Imported (may need review)

### Engagement-Based
4. `total_views = 0` for >X days → No engagement
5. `total_saves = 0` with views → Not valued
6. `save_rate < threshold` → Low quality signal

### Missing Metadata
7. `summary_teaser IS NULL` → Older content (partial index exists)
8. `keywords IS NULL` → No SEO optimization

---

## Recommendations for Planning

### Phase 1: Identify Existing Junk
- Query production DB for test-prefixed content
- Query for low/zero engagement content
- Analyze source field distribution

### Phase 2: Clean Existing Junk
- Extend cleanup script for production use
- Ensure Pinecone cleanup is included
- Add dry-run verification step

### Phase 3: Prevent Future Junk
Options to consider:
- Add minimum content length to generated content
- Add status = 'draft' for imported content initially
- Add quality scoring before publish
- Add rate limiting per user
- Add moderation queue for imported content
