# Manage Sources Research

## Problem Statement
Users currently have no way to manage source citations for explanations after creation, discover new sources to cite, or see which sources are most used/valuable across the platform. The existing sources system is write-once: users add URLs before generation, but there's no ongoing management, discovery, or cross-article visibility.

## High Level Summary
The current sources infrastructure provides a solid foundation (global cache, citation rendering, LLM integration) but lacks management, discovery, and analytics layers. Three parallel explorations reveal that the codebase has mature patterns for CRUD management (admin panel, whitelist, tags), discovery/ranking (explore page, metrics, Elo), and database aggregation (stored procedures, materialized metrics) — all directly reusable for source management features.

## Documents Read
- `docs/feature_deep_dives/add_sources_citations.md` — full deep dive on current sources system
- `docs/docs_overall/architecture.md` — system design, data flow, tech stack
- `docs/docs_overall/getting_started.md` — documentation structure
- `docs/docs_overall/project_workflow.md` — project execution workflow

## Code Files Read

### Source Services
- `src/lib/services/sourceFetcher.ts` (225 lines) — URL fetching, Readability extraction, paywall detection, 10s timeout
  - Key exports: `fetchAndExtractSource()`, `extractDomain()`, `getFaviconUrl()`, `detectPaywall()`
  - Validates URLs (HTTP/HTTPS only), extracts with @mozilla/readability, checks minimum content length
  - Determines if summarization needed (>3000 words)

- `src/lib/services/sourceCache.ts` (398 lines) — Database CRUD for source_cache + article_sources junction table
  - Key exports: `getOrCreateCachedSource()`, `insertSourceCache()`, `getSourceByUrl()`, `linkSourcesToExplanation()`, `getSourcesByExplanationId()`, `unlinkSourcesFromExplanation()`
  - Core caching logic: check cache → fetch if missing/expired → summarize if long → return
  - Two-step query pattern for fetching sources by explanation (workaround for PostgREST)
  - Max 5 sources per explanation, positions 1-5

- `src/lib/services/sourceSummarizer.ts` (120 lines) — LLM-based summarization for long content
  - Key exports: `summarizeSourceContent()`
  - Uses gpt-4.1-nano (LIGHTER_MODEL) for cost efficiency
  - Falls back to truncation if LLM fails

### Schemas
- `src/lib/schemas/schemas.ts` (lines 972-1089) — Zod schemas and types
  - `FetchStatus` enum: pending | success | failed
  - `sourceCacheInsertSchema` / `sourceCacheFullSchema` — database types
  - `articleSourceInsertSchema` / `articleSourceFullSchema` — junction table types
  - `sourceChipSchema` — UI display type (url, title, favicon_url, domain, status, error_message)
  - `sourceForPromptSchema` — LLM prompt type (index, title, domain, content, isVerbatim)

### API Routes
- `src/app/api/fetchSourceMetadata/route.ts` (140 lines) — POST endpoint for source preview
  - Validates request body (Zod), authenticates user, calls fetchAndExtractSource()
  - Returns SourceChipType on success/failure

### UI Components (src/components/sources/)
- `SourceInput.tsx` (165 lines) — URL input, validation, optimistic loading chip, calls /api/fetchSourceMetadata
- `SourceChip.tsx` (104 lines) — Compact chip with favicon, title, domain; loading/success/failed states
- `SourceList.tsx` (95 lines) — Container for source chips, count display ("X/5 sources"), integrates SourceInput
- `Bibliography.tsx` (105 lines) — Footer references section, numbered list with external links
- `CitationTooltip.tsx` (138 lines) — Hover tooltip for [n] citations, click-to-scroll
- `FailedSourcesModal.tsx` (116 lines) — Dialog when submitting with failed sources

### Editor Integration
- `src/editorFiles/lexicalEditor/CitationPlugin.tsx` (274 lines) — Makes [n] citations interactive
  - Pattern: `/\[(\d+)\]/g` finds citation markers
  - TreeWalker DOM traversal, converts to interactive spans
  - Portal-rendered tooltips, scroll-to-bibliography on click

### LLM Integration
- `src/lib/prompts.ts` — `createExplanationWithSourcesPrompt()` formats sources for LLM with citation instructions
- `src/lib/services/returnExplanation.ts` — Orchestrates generation with optional sources
  - If sources present: uses sources prompt, links sources to explanation after save
  - If not: falls back to standard prompt

### Server Actions
- `src/actions/actions.ts` — `getSourcesForExplanationAction()` fetches sources for display
- `src/editorFiles/actions/actions.ts` — `generateAISuggestionsAction()` accepts optional sources for context

## Database Schema

### source_cache table (global, shared across users)
| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| url | text UNIQUE | |
| url_hash | text | SHA256 (generated stored) |
| title | text nullable | |
| favicon_url | text nullable | |
| domain | text | |
| extracted_text | text nullable | |
| is_summarized | boolean | |
| original_length | integer | |
| fetch_status | text | CHECK: 'pending' / 'success' / 'failed' |
| error_message | text nullable | |
| fetched_at | timestamptz | |
| expires_at | timestamptz | 7-day default |
| created_at | timestamptz | |

Indexes: `idx_source_cache_url_hash`, `idx_source_cache_expires`

### article_sources junction table
| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| explanation_id | integer FK | CASCADE delete |
| source_cache_id | integer FK | CASCADE delete |
| position | integer | CHECK 1-5, UNIQUE per explanation |
| created_at | timestamptz | |

Constraints: UNIQUE(explanation_id, source_cache_id), UNIQUE(explanation_id, position)
Index: `idx_article_sources_explanation`

### RLS Policies
- **source_cache**: Public SELECT, Authenticated INSERT/UPDATE
- **article_sources**: Public SELECT, Authenticated INSERT/DELETE

---

## Existing Patterns for Reuse

### 1. CRUD Management Patterns (from Admin Panel, Whitelist, Tags)

**Admin panel** (`src/app/admin/`, `src/components/admin/`):
- Tab-based layout with URL search params for tab state
- `ExplanationTable.tsx` — full-featured data table with search, sort, filter, pagination, bulk selection
- `ExplanationDetailModal.tsx` — detail modal with FocusTrap
- Scholarly theme: `scholar-card`, `var(--surface-primary)`, `var(--text-primary)`

**Link whitelist** (`src/lib/services/linkWhitelist.ts`, `src/components/admin/WhitelistContent.tsx`):
- CRUD service pattern: functions wrapped with `withLogging()`, Zod validation via `.safeParse()`
- Modal-based create/edit/delete with nested sub-item management (aliases)
- Cache invalidation via `rebuildSnapshot()` after mutations
- Status badges, action buttons, error banners with dismiss

**Tag management** (`src/lib/services/explanationTags.ts`, `src/components/TagBar.tsx`):
- Post-creation management: `addTagsToExplanation()`, `removeTagsFromExplanation()`, `replaceTagsForExplanationWithValidation()`
- Soft delete pattern (`isDeleted` flag, reactivation on re-add)
- Two-phase commit UI: local state changes → apply to server on button click
- Reducer-based state management (`tagModeReducer.ts`)

**User library** (`src/lib/services/userLibrary.ts`):
- Simple add/remove junction pattern with side-effect metrics increments
- Feed card display (reuses explore page components)

### 2. Discovery & Ranking Patterns

**Explore page** (`src/app/explanations/page.tsx`, `src/components/explore/`):
- Reddit-style single-column feed with `FeedCard.tsx`
- Two sort modes: "New" (chronological) and "Top" (view-count based)
- Time period filtering: hour, today, week, month, all
- `FilterPills.tsx` for sort/period toggle UI
- Metrics display: total_views + total_saves badges

**Metrics aggregation** (`src/lib/services/metrics.ts`):
- `explanationMetrics` table: total_views, total_saves, save_rate (precomputed)
- Stored procedures: `increment_explanation_views()`, `increment_explanation_saves()`, `refresh_explanation_metrics()`
- RPC function: `get_explanation_view_counts(p_period, p_limit)` for time-windowed aggregation
- Atomic increment pattern with UPSERT

**Vector similarity** (`src/lib/services/vectorsim.ts`, `src/lib/services/findMatches.ts`):
- Pinecone with text-embedding-3-large (3072 dimensions)
- `findMatchesInVectorDb()` returns top K matches with scores
- `enhanceMatchesWithCurrentContentAndDiversity()` enriches with full explanation data + diversity scores
- `findBestMatchFromList()` uses LLM to select best match

**Article bank Elo** (`src/lib/services/articleBankActions.ts`, `src/lib/evolution/core/elo.ts`):
- Standard Elo with confidence weighting and adaptive K-factor
- Cross-topic aggregation: avg_elo, avg_cost, avg_elo_per_dollar, win_rate by method
- Tables: article_bank_topics, article_bank_entries, article_bank_elo, article_bank_comparisons

**Explanation summaries** (`src/lib/services/explanationSummarizer.ts`):
- AI-generated teasers (50-200 chars) for explore page cards
- Uses gpt-4.1-nano, fire-and-forget pattern
- Fields: summary_teaser, meta_description, keywords

### 3. Database & Migration Patterns

**Migration naming**: `YYYYMMDDHHMMSS_<description>.sql`

**Table creation pattern**:
```sql
CREATE TABLE [IF NOT EXISTS] table_name (...);
CREATE INDEX [IF NOT EXISTS] idx_... ON table_name(...);
ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;
CREATE POLICY "..." ON table_name FOR ... ;
```

**Idempotent repairs**: `DROP POLICY IF EXISTS` + `CREATE POLICY` for clean re-application

**Junction tables in codebase**:
| Table | Pattern | Key Features |
|-------|---------|-------------|
| article_sources | Ordered many-to-many | Position 1-5, dual unique constraints |
| explanation_tags | Soft-delete many-to-many | isDeleted flag, reactivation |
| userLibrary | Simple many-to-many | No ordering, metrics side-effects |
| link_whitelist_aliases | Parent-child | CASCADE delete, case-insensitive index |
| article_link_overrides | Per-article config | Composite unique, CHECK constraint |

**Aggregation patterns**:
- Precomputed metrics table (explanationMetrics) with stored procedure refresh
- Atomic increment functions (increment_views, increment_saves)
- Time-windowed RPC aggregation (get_explanation_view_counts)
- UPSERT for idempotent writes

**Supabase client patterns**:
- Browser client: `createBrowserClient()` with conditional storage (localStorage vs sessionStorage)
- Server client: `createServerClient()` using Next.js cookies
- Service client: `createClient()` with SERVICE_ROLE_KEY (bypasses RLS)
- Query pattern: `.select()` after INSERT, handle PGRST116 for "no rows", `.single()` enforcement

---

## Key Architectural Observations

1. **Global cache is a strength** — Same URL fetched once, shared across all users. Natural foundation for cross-article source analytics via `GROUP BY source_cache_id` on article_sources.

2. **No source management** — Once sources are linked to an explanation, users can't edit, reorder, add, or remove them. `unlinkSourcesFromExplanation()` exists but isn't exposed to users.

3. **No source discovery** — No way to browse popular sources, see what sources others have used, or get source recommendations.

4. **No source analytics** — No tracking of which sources are most cited, most linked, highest quality, etc.

5. **Max 5 sources per explanation** — Hard limit in both schema (position 1-5) and UI (SourceList).

6. **Write-once pattern** — Sources are added at generation time and then frozen. The article_sources junction supports CRUD but only CREATE and READ are exposed.

7. **Citation format is LLM-dependent** — [n] notation works but relies on prompt engineering. No validation that citations actually match provided sources.

8. **Silent degradation** — If all sources fail, system silently falls back to non-sources prompt without user feedback.

9. **Rich reusable patterns** — Admin panel tables, tag management CRUD, explore page ranking, metrics aggregation, and Elo scoring all provide battle-tested patterns directly applicable to source management.

10. **Database infrastructure is mature** — Stored procedures, atomic increments, UPSERT patterns, RLS policies, and partial indexes are all established patterns ready for extension.
