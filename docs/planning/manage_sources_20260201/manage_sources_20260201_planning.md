# Manage Sources Plan

## Background
ExplainAnything generates AI explanations grounded in user-provided source URLs. The current system supports adding sources before generation, extracting content, and rendering inline [n] citations with a bibliography. However, once sources are linked to an explanation, they become frozen — users cannot manage, edit, or discover sources after the fact. There's also no visibility into which sources are most valuable across the platform.

## Problem
Users want three capabilities that don't exist today:
1. **Manage source citations** — Edit, reorder, add, or remove sources on existing explanations, not just at generation time.
2. **Discover new sources** — Find relevant sources to cite based on topic, popularity, or what other similar explanations use.
3. **Display best sources across all articles** — Surface the most-cited, highest-quality sources platform-wide so users (and the system) can identify authoritative references.

The current write-once architecture has the database infrastructure for CRUD (article_sources junction, sourceCache service) but only exposes create and read operations. The global source_cache table is a natural foundation for cross-article analytics but no aggregation or ranking exists.

## Options Considered

### Capability 1: Manage Sources — Hybrid Approach (CHOSEN)

**What**: Allow bibliography-only edits (add/remove/reorder sources) AND offer an explicit "Regenerate with updated sources" action.

**Why hybrid over alternatives:**
- **Bibliography-only** is too limited — stale `[n]` citations in text with no way to fix them
- **Always regenerate** is too expensive — every minor reorder costs an LLM call
- **Hybrid** lets users do quick housekeeping (remove broken source, add a new one) without regeneration cost, and opt into full regeneration when they want content updated

**Rejected alternatives:**
- Bibliography-only editing: [n] citations become stale when sources are removed/reordered
- Always-regenerate: LLM cost for every edit, even trivial reordering

**Key design decisions:**
- UI lives on the **results page** as an edit mode in the bibliography section (similar to how TagBar toggles between view/edit)
- Reuse existing `SourceInput`, `SourceChip`, `SourceList` components in edit mode
- "Regenerate with sources" button appears only when sources have changed
- Position renumbering handled automatically (remove source [2] → [3] becomes [2], etc.)

**Service layer changes:**
- Expose `updateSourcesForExplanation(explanationId, sourceIds[])` — replaces all sources atomically via stored procedure (see Atomicity section)
- Expose `addSourceToExplanation(explanationId, sourceUrl)` — fetch + cache + link in one call
- Expose `removeSourceFromExplanation(explanationId, sourceCacheId)` — unlink + renumber via stored procedure
- Expose `reorderSources(explanationId, sourceIds[])` — update positions via stored procedure

**Server actions (each wrapped with `withLogging` + `serverReadRequestId`):**
- `updateSourcesForExplanationAction(params: { explanationId: number, sourceIds: number[] })`
- `addSourceToExplanationAction(params: { explanationId: number, sourceUrl: string })`
- `removeSourceFromExplanationAction(params: { explanationId: number, sourceCacheId: number })`
- `reorderSourcesAction(params: { explanationId: number, sourceIds: number[] })`

### Capability 2: Discover Sources — Popular by Topic + Similar-Article Sources (CHOSEN)

**Approach A: Popular sources by topic**
- Aggregate `article_sources` joined with `source_cache`, grouped by `source_cache_id`, filtered by topic
- Query: "Which sources are most cited across articles in this topic?"
- Pure DB query, no LLM cost
- Display as "Popular sources in [topic]" section

**Approach B: Similar-article sources**
- Given current explanation, find top 5 similar explanations via existing Pinecone vector search
- Fetch their linked sources via `getSourcesByExplanationId()`
- Deduplicate and rank by frequency across similar articles
- Display as "Sources used in similar articles" section
- **Graceful degradation**: If Pinecone is unavailable or the explanation has no embedding, show only popular-by-topic results without error

**Why both:**
- Popular-by-topic catches broadly authoritative sources (e.g., Wikipedia, official docs)
- Similar-article catches niche/specific sources relevant to this particular explanation
- Together they cover both breadth and depth of discovery

**Rejected alternatives:**
- AI-suggested sources: Requires web search integration or curated DB, complex and expensive
- Community-driven: Requires moderation workflow, slower feedback loop, lower priority

**Where discovery UI lives:**
- On the **results page**, in or near the bibliography section
- Collapsible "Discover Sources" panel below the bibliography
- Each suggested source shows: title, domain, favicon, citation count badge
- "Add" button on each to directly add to this explanation (triggers Capability 1 flow)

### Capability 3: Display Best Sources — Leaderboard + Inline Badges + Source Profiles (CHOSEN)

**Layer 1: Source leaderboard page (`/sources`)**
- New top-level page showing sources ranked by citation count
- Grouped by domain (e.g., "wikipedia.org — 47 citations across 31 articles")
- Sortable: by citation count, by domain, by recency
- Filterable: by topic, by time period (reuse FilterPills pattern but parameterized — new `SourceFilterPills` component accepting base path and filter types)
- New `SourceCard` component (not direct FeedCard reuse — different data shape)

**Layer 2: Inline citation badges**
- In every bibliography, each source shows a small badge: "Cited in N articles"
- Clicking badge navigates to source profile page
- Low implementation cost — single aggregate query when loading bibliography

**Layer 3: Source profile pages (`/sources/[id]`)**
- Detail page for each source showing:
  - Source metadata (title, domain, favicon, original URL)
  - All articles that cite this source (list with links)
  - Citation count over time (if we track timestamps)
  - Related sources (other sources frequently co-cited with this one)
- Reuse ExplanationCard component for article list

**Database support needed:**
- `get_source_citation_counts(p_period, p_limit)` RPC function (mirrors `get_explanation_view_counts`) with `SECURITY DEFINER` and `SET search_path = public`
- `get_co_cited_sources(p_source_id, p_limit)` RPC function with proper indexing and LIMIT to avoid O(n^2)
- Start without a materialized `source_metrics` table — use RPC aggregation directly from `article_sources` + `source_cache`. Add materialized table only if performance requires it (citation counts are lower frequency than view counts)
- No `increment_source_citations` needed initially — `get_source_citation_counts` computes counts on-the-fly via `COUNT(*)` on `article_sources GROUP BY source_cache_id`. If performance degrades, add a materialized `source_metrics` table with increment/refresh procedures (same pattern as `explanationMetrics`)

---

## Security & Data Integrity

### Authorization Model
**Explanations are community content** — the `explanations` table has no `userid` column. Creator info is tracked indirectly through `userQueries`, and the existing RLS policy allows any authenticated user to UPDATE any explanation (`USING (true)`). This is by design: tags, content edits, and saves all follow the same "any authenticated user" model.

**Source management follows the same pattern**: any authenticated user can manage sources on any explanation. This is consistent with:
- Tag management: `addTagsToExplanation()` requires only authentication, not ownership
- Explanation updates: RLS policy `"Enable update for authenticated users only"` uses `USING (true)`
- Library saves: `saveExplanationToLibrary()` checks auth but not explanation ownership

All source mutation server actions require authentication via `serverReadRequestId` (which extracts the verified userId from the session). No per-explanation ownership check is needed — this matches the existing architecture where ownership enforcement is an admin-level concern handled separately.

**Note**: If per-user ownership is ever needed (future scope), it would require adding a `creator_id` column to `explanations` with a backfill from `userQueries` — that is a larger architectural change outside this project's scope.

### RLS UPDATE Policy for article_sources
Add migration for UPDATE policy:

```sql
-- Migration: YYYYMMDDHHMMSS_add_article_sources_update_policy.sql
ALTER TABLE article_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can update article_sources" ON article_sources;
CREATE POLICY "Authenticated users can update article_sources"
  ON article_sources FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
```

### Atomicity via Stored Procedures
All source mutations that involve multiple row operations use stored procedures with transactions. Since these use `SECURITY DEFINER`, they bypass RLS — authorization is enforced at the service layer (authenticated user check) before calling these RPCs.

```sql
-- replace_explanation_sources(p_explanation_id INT, p_source_ids INT[])
-- Atomically: DELETE all existing → INSERT new with positions 1..N
-- Within single transaction, avoids UNIQUE constraint violations

CREATE OR REPLACE FUNCTION replace_explanation_sources(
  p_explanation_id INT,
  p_source_ids INT[]
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Guard: empty array = remove all sources
  IF array_length(p_source_ids, 1) IS NULL THEN
    DELETE FROM article_sources WHERE explanation_id = p_explanation_id;
    RETURN;
  END IF;

  -- Delete all existing sources for this explanation
  DELETE FROM article_sources WHERE explanation_id = p_explanation_id;

  -- Insert new sources with sequential positions (WITH ORDINALITY for safe row alignment)
  INSERT INTO article_sources (explanation_id, source_cache_id, position)
  SELECT p_explanation_id, source_id, ordinality::int
  FROM unnest(p_source_ids) WITH ORDINALITY AS t(source_id, ordinality);
END;
$$;

-- GRANT EXECUTE (matching existing pattern from get_explanation_view_counts)
GRANT EXECUTE ON FUNCTION replace_explanation_sources TO authenticated, anon, service_role;
```

Similarly for `remove_and_renumber_source` and `reorder_explanation_sources` — all use stored procedures with `SECURITY DEFINER`, `SET search_path = public`, and `GRANT EXECUTE` to authenticated/anon/service_role. All position renumbering happens atomically within a single transaction, avoiding UNIQUE(explanation_id, position) constraint violations.

**Note**: The RLS UPDATE policy on `article_sources` still serves a purpose — it protects against direct client-side UPDATE queries that don't go through stored procedures (defense in depth). The stored procedures bypass it via SECURITY DEFINER, which is the intended path.

### SSRF Mitigation
Add DNS-resolution-based IP check to `sourceFetcher.ts` before expanding URL-fetching surface. A hostname-only regex check is insufficient because attackers can register domains that resolve to private IPs (DNS rebinding).

**Two-layer approach:**
1. **Hostname pre-check** — fast reject of obviously private hostnames (localhost, 0.0.0.0)
2. **DNS resolution check** — resolve hostname to IP, then check the resolved IP against private ranges

```typescript
import { lookup } from 'dns/promises';

const PRIVATE_IP_PATTERNS = [
  /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
  /^169\.254\./, /^0\./, /^::1$/, /^fc/i, /^fd/i,
];

const BLOCKED_HOSTNAMES = [/^localhost$/i, /^0\.0\.0\.0$/];

async function validateUrlNotPrivate(url: string): Promise<void> {
  const hostname = new URL(url).hostname;

  // Layer 1: Block obviously private hostnames
  if (BLOCKED_HOSTNAMES.some(p => p.test(hostname))) {
    throw new Error('URL points to a blocked hostname');
  }

  // Layer 2: Resolve DNS and check the actual IP
  try {
    const { address } = await lookup(hostname);
    if (PRIVATE_IP_PATTERNS.some(p => p.test(address))) {
      throw new Error('URL resolves to a private IP address');
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('private IP')) throw err;
    // DNS resolution failure — let the fetch attempt handle it
  }
}
```

Called at the top of `fetchAndExtractSource()` before any HTTP request. Also add protocol validation at the Zod schema level: `addSourceInputSchema` uses `.refine(url => url.startsWith('http'))` to reject `ftp:`, `data:`, `javascript:` URLs at the input boundary.

This is an existing vulnerability that Phase 1 must fix before adding new URL-fetching entry points.

### Input Validation (Zod Schemas)
New Zod schemas in `src/lib/schemas/schemas.ts`:

```typescript
export const updateSourcesInputSchema = z.object({
  explanationId: z.number().int().positive(),
  sourceIds: z.array(z.number().int().positive()).max(5),
});

export const addSourceInputSchema = z.object({
  explanationId: z.number().int().positive(),
  sourceUrl: z.string().url().refine(
    url => url.startsWith('http://') || url.startsWith('https://'),
    'Only HTTP/HTTPS URLs are allowed'
  ),
});

export const removeSourceInputSchema = z.object({
  explanationId: z.number().int().positive(),
  sourceCacheId: z.number().int().positive(),
});

export const reorderSourcesInputSchema = z.object({
  explanationId: z.number().int().positive(),
  sourceIds: z.array(z.number().int().positive()).min(1).max(5),
});

// Source citation count type (from RPC)
export const sourceCitationCountSchema = z.object({
  source_cache_id: z.number().int(),
  total_citations: z.number().int(),
  unique_explanations: z.number().int(),
  domain: z.string(),
  title: z.string().nullable(),
  favicon_url: z.string().nullable(),
});
export type SourceCitationCountType = z.infer<typeof sourceCitationCountSchema>;
```

All server actions validate input with `.safeParse()` before calling service functions.

---

## Phased Execution Plan

### Phase 1: Database & Service Foundation
**Migration: `YYYYMMDDHHMMSS_source_management.sql`**
- Add UPDATE RLS policy on `article_sources`
- Create stored procedures (all with `SECURITY DEFINER`, `SET search_path = public`, `GRANT EXECUTE TO authenticated, anon, service_role`):
  - `replace_explanation_sources(p_explanation_id, p_source_ids[])` — atomic delete+insert with `WITH ORDINALITY`
  - `remove_and_renumber_source(p_explanation_id, p_source_cache_id)` — remove + renumber positions in transaction
  - `reorder_explanation_sources(p_explanation_id, p_source_ids[])` — atomic position update
  - `get_source_citation_counts(p_period, p_limit)` — aggregate `COUNT(*)` from `article_sources GROUP BY source_cache_id` with time filtering via `article_sources.created_at`
  - `get_co_cited_sources(p_source_id, p_limit)` — find frequently co-cited sources with LIMIT and index on `article_sources(source_cache_id)`
- Add index: `CREATE INDEX idx_article_sources_source_cache ON article_sources(source_cache_id)` for co-citation query performance
- Rollback SQL at top of migration:
  ```sql
  -- ROLLBACK: DROP FUNCTION IF EXISTS replace_explanation_sources, remove_and_renumber_source,
  --   reorder_explanation_sources, get_source_citation_counts, get_co_cited_sources;
  -- ROLLBACK: DROP INDEX IF EXISTS idx_article_sources_source_cache;
  -- ROLLBACK: DROP POLICY IF EXISTS "Authenticated users can update article_sources" ON article_sources;
  ```

**Service layer (`src/lib/services/sourceCache.ts` extensions):**
- `updateSourcesForExplanation(explanationId, sourceIds[])` — Zod validate + call `replace_explanation_sources` RPC
- `addSourceToExplanation(explanationId, sourceUrl)` — fetch/cache via `getOrCreateCachedSource` + call RPC to link
- `removeSourceFromExplanation(explanationId, sourceCacheId)` — call `remove_and_renumber_source` RPC
- `reorderSources(explanationId, sourceIds[])` — call `reorder_explanation_sources` RPC
- All wrapped with `withLogging()`, require authenticated user via server action context

**SSRF fix (`src/lib/services/sourceFetcher.ts`):**
- Add `isPrivateUrl()` check at top of `fetchAndExtractSource()`
- Reject private/reserved IPs with descriptive error message

**Server actions (`src/actions/actions.ts`):**
- `updateSourcesForExplanationAction` — Zod validate + call service
- `addSourceToExplanationAction` — Zod validate + call service
- `removeSourceFromExplanationAction` — Zod validate + call service
- `reorderSourcesAction` — Zod validate + call service

**Zod schemas (`src/lib/schemas/schemas.ts`):**
- `updateSourcesInputSchema`, `addSourceInputSchema`, `removeSourceInputSchema`, `reorderSourcesInputSchema`
- `sourceCitationCountSchema` + type

**Tests (following project directory conventions):**
- `src/lib/services/sourceCache.test.ts` — Unit tests for existing + new service functions (mock Supabase, `@jest-environment node`)
  - Test `getOrCreateCachedSource` (existing, untested)
  - Test `insertSourceCache` URL deduplication (existing, untested)
  - Test `updateSourcesForExplanation` with valid/invalid inputs
  - Test `addSourceToExplanation` happy path + fetch failure
  - Test `removeSourceFromExplanation` with renumbering
  - Test `reorderSources` with position validation
  - Test authentication required (no userId → rejection)
- Extend existing `src/lib/services/sourceFetcher.test.ts` — Add SSRF tests
  - Test `validateUrlNotPrivate` against all private ranges (127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x, localhost, IPv6)
  - Test DNS rebinding scenario (hostname resolving to private IP)
  - Test that `fetchAndExtractSource` rejects private URLs
- `src/lib/schemas/sourceSchemas.test.ts` — Zod schema validation tests (`@jest-environment node`)
  - Test all new input schemas with valid + invalid data
  - Test URL protocol refinement (reject ftp://, data://, javascript://)
  - Test `sourceCitationCountSchema` parsing
- `src/__tests__/integration/source-management.integration.test.ts` — Integration tests against real DB
  - Test `replace_explanation_sources` RPC atomicity
  - Test `remove_and_renumber_source` RPC position renumbering
  - Test `get_source_citation_counts` with seeded data (seed N article_sources rows, assert count = N)
  - Test `get_co_cited_sources` with seeded data

**Test fixtures (`src/testing/fixtures/database-records.ts`):**
- Add `createTestSourceCache(overrides?)` factory — uses URL domain `test-source-{uuid}.example.com` for discoverable cleanup
- Add `createTestArticleSource(explanationId, sourceCacheId, position)` factory function

**Test cleanup (`src/testing/integration-helpers.ts`):**
- Add cleanup for `source_cache` rows where `domain LIKE 'test-source-%.example.com'` (test fixture URLs use this pattern)
- Add cleanup for `article_sources` rows by explanation_id (same pattern as `explanation_tags` cleanup)

**CI update (`package.json`):**
- Update `test:integration:critical` script pattern from `auth-flow|explanation-generation|streaming-api|error-handling|vector-matching` to `auth-flow|explanation-generation|streaming-api|error-handling|vector-matching|source-management`

### Phase 2: Source Management UI (Results Page)
**Components:**
- `src/components/sources/SourceEditor.tsx` — Edit mode wrapper (reuses SourceInput, SourceChip, SourceList)
  - Props: `explanationId`, `sources[]`, `onSourcesChanged`
  - State: local edited sources (reducer pattern, like TagBar)
  - Apply button → calls `updateSourcesForExplanationAction`
  - Cancel button → reverts to original
- Edit mode toggle added to `src/components/sources/Bibliography.tsx`
- "Regenerate with updated sources" button (conditionally shown when sources differ from original)

**Tests:**
- `src/components/sources/SourceEditor.test.tsx` — Unit tests (mock server actions, `@jest-environment jsdom`)
  - Test edit mode toggle
  - Test add/remove/reorder in local state
  - Test apply calls correct action
  - Test cancel reverts state
  - Test regenerate button visibility logic
- `src/__tests__/integration/source-editor.integration.test.ts` — Integration test for full add/remove/reorder flow
- E2E page object: `src/__tests__/e2e/helpers/pages/SourceEditorPage.ts` with methods: `toggleSourceEditMode()`, `addSourceInEditor()`, `removeSourceInEditor()`, `getSourceChips()`, `clickRegenerateWithSources()`
- Required `data-testid` attributes: `source-edit-toggle`, `source-editor-panel`, `source-chip-{id}`, `source-remove-btn-{id}`, `source-apply-btn`, `source-cancel-btn`, `source-regenerate-btn`

### Phase 3: Source Leaderboard Page
**Files:**
- `src/app/sources/page.tsx` — Server component, fetches top sources
- `src/app/sources/layout.tsx` — Layout with navigation
- `src/components/sources/SourceCard.tsx` — New component (domain, title, citation count, favicon)
- `src/components/sources/SourceFilterPills.tsx` — Parameterized filter pills (not direct FilterPills reuse)

**Service:**
- `src/lib/services/sourceDiscovery.ts` — `getTopSources(filters)`, `getSourcesByDomain(domain)`
- Wrapped with `withLogging()`, server actions in `actions.ts`

**Tests:**
- `src/lib/services/sourceDiscovery.test.ts` — Unit tests for service (`@jest-environment node`)
- `src/components/sources/SourceCard.test.tsx` — Component unit tests (`@jest-environment jsdom`)
- `src/__tests__/e2e/specs/sources-leaderboard.spec.ts` — E2E test for page load, sort, filter
- Page object: `src/__tests__/e2e/helpers/pages/SourceLeaderboardPage.ts`
- Required `data-testid` attributes: `source-card-{id}`, `source-filter-pills`, `source-sort-select`, `sources-list`

### Phase 4: Source Discovery (Results Page)
**Components:**
- `src/components/sources/DiscoverSourcesPanel.tsx` — Collapsible panel
  - Two sections: "Popular in [topic]" and "Used in similar articles"
  - "Add" button on each source → triggers `addSourceToExplanationAction`

**Service:**
- `src/lib/services/sourceDiscovery.ts` — `getPopularSourcesByTopic(topicId, limit)`, `getSimilarArticleSources(explanationId, limit)`
- `getSimilarArticleSources` wraps Pinecone call in try/catch — returns empty array on failure (graceful degradation)

**Tests:**
- `src/lib/services/sourceDiscovery.test.ts` — extend with discovery unit tests
  - Test popular-by-topic with seeded data
  - Test similar-article with mocked Pinecone (success + failure fallback)
- `src/components/sources/DiscoverSourcesPanel.test.tsx` — Component tests (`@jest-environment jsdom`)
- `src/__tests__/integration/source-discovery.integration.test.ts` — Integration test with real DB for popular-by-topic query
- Required `data-testid` attributes: `discover-sources-panel`, `discover-sources-toggle`, `popular-sources-section`, `similar-sources-section`, `source-add-btn-{id}`

### Phase 5: Inline Badges + Source Profiles
**Files:**
- Update `src/components/sources/Bibliography.tsx` — Add citation count badges
- `src/app/sources/[id]/page.tsx` — Source profile page
- `src/components/sources/SourceProfile.tsx` — Profile display component

**Tests:**
- `src/components/sources/Bibliography.test.tsx` — Test badge rendering with mock citation counts (`@jest-environment jsdom`)
- `src/components/sources/SourceProfile.test.tsx` — Component tests (`@jest-environment jsdom`)
- `src/__tests__/e2e/specs/source-profile.spec.ts` — E2E for profile page load, citing articles list, co-cited sources
- Page object: `src/__tests__/e2e/helpers/pages/SourceProfilePage.ts`
- Required `data-testid` attributes: `citation-badge-{id}`, `source-profile-header`, `citing-articles-list`, `co-cited-sources-list`

---

## Rollback Strategy

Each phase's migration includes rollback SQL in comments at the top of the file. Rollback order is reverse of execution:

- **Phase 5**: Remove `/sources/[id]` page, remove badges from Bibliography (UI-only, no DB rollback)
- **Phase 4**: Remove DiscoverSourcesPanel component, remove discovery service functions (UI + service only)
- **Phase 3**: Remove `/sources` page, SourceCard, SourceFilterPills (UI + service only)
- **Phase 2**: Remove SourceEditor, revert Bibliography to read-only (UI-only)
- **Phase 1**: Run rollback SQL — drop stored procedures, drop UPDATE policy, revert sourceFetcher SSRF check (though SSRF fix should be kept regardless)

Each phase is independently deployable and rollbackable without affecting other phases.

---

## Testing
- **Unit tests (colocated, `@jest-environment node` for services, `jsdom` for components):**
  - `src/lib/services/sourceCache.test.ts` — existing + new service functions
  - `src/lib/services/sourceFetcher.test.ts` — extend with SSRF/DNS rebinding tests
  - `src/lib/services/sourceDiscovery.test.ts` — discovery queries
  - `src/lib/schemas/sourceSchemas.test.ts` — Zod validation
  - `src/components/sources/SourceEditor.test.tsx` — edit mode component
  - `src/components/sources/SourceCard.test.tsx` — leaderboard card
  - `src/components/sources/DiscoverSourcesPanel.test.tsx` — discovery panel
  - `src/components/sources/SourceProfile.test.tsx` — profile component
  - `src/components/sources/Bibliography.test.tsx` — citation badges
- **Integration tests (`src/__tests__/integration/`):**
  - `source-management.integration.test.ts` — CRUD operations, RPC atomicity, position renumbering
  - `source-discovery.integration.test.ts` — popular-by-topic, citation count aggregation
  - Backfill verification: seed N article_sources rows, call `get_source_citation_counts`, assert count = N
- **E2E tests (`src/__tests__/e2e/specs/`):**
  - `sources-leaderboard.spec.ts` — page load, sort, filter
  - `source-profile.spec.ts` — profile page, citing articles, co-cited sources
- **E2E page objects (`src/__tests__/e2e/helpers/pages/`):**
  - `SourceLeaderboardPage.ts`, `SourceProfilePage.ts`, `SourceEditorPage.ts`
- **Test fixtures** (`src/testing/fixtures/database-records.ts`):
  - `createTestSourceCache()` — URLs use `test-source-{uuid}.example.com` domain
  - `createTestArticleSource()` — links test source to test explanation
- **Test cleanup** (`src/testing/integration-helpers.ts`):
  - `source_cache` cleanup: `DELETE WHERE domain LIKE 'test-source-%.example.com'`
  - `article_sources` cleanup: `DELETE WHERE explanation_id IN (test explanation ids)` (same pattern as `explanation_tags`)
- **CI** (`package.json`):
  - Update `test:integration:critical` pattern: `auth-flow|explanation-generation|streaming-api|error-handling|vector-matching|source-management`

## Documentation Updates
- `docs/feature_deep_dives/manage_sources.md` — New deep dive (already created)
- `docs/feature_deep_dives/add_sources_citations.md` — Update with management capabilities
- `docs/docs_overall/architecture.md` — Update feature index if significant new tables/services added

---

## Phase 6: Unified Source Combobox — Search + Paste in One Input

### Summary
Remove `DiscoverSourcesPanel` from the article body. Replace the separate URL paste input (`SourceInput`) and discovery panel with a single **`SourceCombobox`** component — a unified input that lets users paste a URL to add OR search/browse discovered sources from a dropdown. Integrated into both the AI sidebar (`AIEditorPanel`) and the expanded modal (`AdvancedAIEditorModal`).

### UX Design

#### Wireframe — Sidebar (collapsed)
```
  Reference Sources (optional)
  ┌──────────┐ ┌──────────┐
  │ W Saturn ×│ │ 🌐 NASA ×│
  └──────────┘ └──────────┘
  2/5 sources
  ┌─────────────────────────────┐
  │ 🔍 Search or paste URL...   │
  └─────────────────────────────┘
```

#### Wireframe — On focus (empty input), dropdown opens
```
  ┌─────────────────────────────┐
  │ 🔍                          │
  ├─────────────────────────────┤
  │  🔗 Paste a URL to add      │  ← hint row (muted, not clickable)
  │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
  │  SIMILAR ARTICLES            │
  │  🌐 Solar System - wikip… + │
  │  🌐 Gas Giants - space.c… + │
  │  🌐 Cassini Mission - na… ✓ │  ← already added (disabled)
  │  🌐 Planetary Rings - sc… + │
  └──────────────────────────────┘
```

#### Wireframe — Typing a keyword filters discoveries
```
  ┌─────────────────────────────┐
  │ 🔍 planet                   │
  ├─────────────────────────────┤
  │  🔗 Paste a URL to add      │
  │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
  │  🌐 Planetary Rings - sc… + │  ← filtered match
  └──────────────────────────────┘
```

#### Wireframe — Pasting/typing a URL, hint becomes action
```
  ┌──────────────────────────────────┐
  │ 🔍 https://example.com/article   │
  ├──────────────────────────────────┤
  │  ＋ Add https://example.com/a… → │  ← highlighted, clickable/Enter
  └──────────────────────────────────┘
```

#### Input state detection logic
| Input state       | Hint row                          | Below hint              |
|-------------------|-----------------------------------|-------------------------|
| Empty / focused   | `🔗 Paste a URL to add`           | Discovered sources list |
| Text typed        | `🔗 Paste a URL to add`           | Filtered sources        |
| URL detected      | `＋ Add [url] →` (highlighted)    | Nothing else            |
| At max sources    | Input disabled                    | —                       |

URL detection: input starts with `http://` or `https://`.

### Prerequisite: Extract `useSourceSubmit` hook

Before creating SourceCombobox, extract URL submission logic from `SourceInput.tsx` (lines 35-102) into a shared hook to avoid duplication:

#### `src/hooks/useSourceSubmit.ts` (NEW)
```typescript
function useSourceSubmit(onSourceAdded: (source: SourceChipType) => void) {
  // Extracted from SourceInput: validateUrl, createLoadingChip,
  // fetchMetadata via /api/fetchSourceMetadata, error handling
  return { submitUrl, isSubmitting, error, clearError };
}
```

Then refactor `SourceInput.tsx` to use `useSourceSubmit` internally (thin wrapper: input + button + hook). This ensures SourceCombobox reuses the same logic for its URL-add path.

### Files to Create

#### 1. `src/components/sources/SourceCombobox.tsx`
Unified search + paste input replacing both `SourceInput` and `DiscoverSourcesPanel`.

**Built on Radix Popover** (`@radix-ui/react-popover`, already in project's Radix ecosystem) for the dropdown. Radix handles:
- Portal rendering (escapes `overflow-hidden` on AIEditorPanel container)
- Focus management (no blur-before-click bug)
- Click-outside dismissal
- Escape key to close

**Props:**
```typescript
interface SourceComboboxProps {
  explanationId?: number;        // enables discovery (fetch on mount/change)
  topicId?: number | null;       // enables popular-by-topic section
  onSourceAdded: (source: SourceChipType) => void;
  existingUrls: string[];
  maxSources: number;
  currentCount: number;
  disabled?: boolean;
}
```

**Behavior:**
- Placeholder: "Search or paste URL..."
- On focus: opens Radix Popover dropdown
- Discovery data fetched on mount (when `explanationId` provided), NOT on focus — avoids 200-500ms Pinecone latency on every click
- Tracks `lastLoadedExplanationId` instead of boolean `hasLoaded` — re-fetches when explanation changes
- Dropdown always shows both rows: (1) "Add as URL" action at top when input non-empty, (2) filtered discovered sources below
- No binary mode switching — eliminates flickering during URL typing
- URL validation happens on submit (Enter/click), not during typing
- Uses `useSourceSubmit` hook for URL add path
- For discovered sources: clicking "+" creates `SourceChipType` directly from `DiscoveredSource` data (no fetch needed)
- Dropdown closes on Escape, after adding a source, or click-outside (handled by Radix)
- Respects `disabled` and max sources

**ARIA roles:**
- Input: `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`
- Dropdown: `role="listbox"`
- Each source row: `role="option"`, `aria-selected`, `aria-disabled` for already-added
- Arrow key navigation between options, Enter to select/add
- Home/End key support

**Internal state:**
- `inputValue: string`
- `isOpen: boolean` (Radix Popover open state)
- `discoveredSources: DiscoveredSource[]`
- `isLoadingDiscovery: boolean`
- `lastLoadedExplanationId: number | null` (re-fetch guard keyed by explanation)
- `activeIndex: number` (keyboard nav highlight)

**No binary mode — unified dropdown:**
| Input state     | Top row                              | Below                   |
|-----------------|--------------------------------------|-------------------------|
| Empty / focused | `🔗 Paste a URL to add` (hint)      | Discovered sources list |
| Text typed      | `＋ Add as URL: "[text]"` (clickable) | Filtered sources        |
| At max sources  | Input disabled                       | —                       |

#### 2. `src/hooks/__tests__/useSourceSubmit.test.ts` (NEW)
Tests for the extracted hook: URL validation, loading chip creation, metadata fetch, error handling.

#### 3. `src/components/sources/__tests__/SourceCombobox.test.tsx` (NEW)
Tests covering:
- Renders with placeholder "Search or paste URL..."
- On focus: opens dropdown via Radix Popover, shows hint row
- Discovery: fetches on mount when explanationId provided, shows sources
- Discovery: re-fetches when explanationId changes (not stale)
- Discovery: skips fetch when no explanationId
- Filtering: typing text filters discovered sources by title/domain
- Non-empty input shows "Add as URL" action at top + filtered discoveries below (no binary switch)
- Add URL: Enter key / click triggers useSourceSubmit with loading chip
- Add discovered: clicking "+" passes SourceChipType with status 'success'
- Already added: "+" disabled for URLs in existingUrls, `aria-disabled="true"`
- Keyboard nav: ArrowDown/ArrowUp moves `aria-activedescendant`, Enter selects
- Disabled: input disabled when disabled prop or at max sources
- Escape: closes dropdown
- Graceful degradation: empty discovery results show "No suggestions yet"
- ARIA: combobox role, listbox role, option roles present

### Files to Modify

#### 4. `src/components/sources/SourceInput.tsx`
- Refactor to use `useSourceSubmit` hook internally (reduces to thin wrapper: input + button + hook)
- No external API change — existing consumers unaffected

#### 5. `src/components/sources/SourceList.tsx`
- **Import** `SourceCombobox` via `React.lazy()` for code-splitting:
```tsx
const SourceCombobox = React.lazy(() => import('./SourceCombobox'));
```
- **Add optional prop** `explanationId?: number` and `topicId?: number | null`
- When `explanationId` is provided, render `<SourceCombobox>` inside `<Suspense>` with `<SourceInput>` as fallback
- When `explanationId` is not provided, render existing `<SourceInput>`

```tsx
{showInput && (
  explanationId ? (
    <Suspense fallback={<SourceInput onSourceAdded={handleSourceAdded} disabled={disabled} maxSources={maxSources} currentCount={sources.length} />}>
      <SourceCombobox
        explanationId={explanationId}
        topicId={topicId}
        onSourceAdded={handleSourceAdded}
        existingUrls={sources.map(s => s.url)}
        maxSources={maxSources}
        currentCount={sources.length}
        disabled={disabled}
      />
    </Suspense>
  ) : (
    <SourceInput
      onSourceAdded={handleSourceAdded}
      disabled={disabled}
      maxSources={maxSources}
      currentCount={sources.length}
    />
  )
)}
```

#### 6. `src/components/AIEditorPanel.tsx`
- **Pass `explanationId`** to existing `<SourceList>`:
```tsx
<SourceList
  sources={sources}
  onSourceAdded={...}
  onSourceRemoved={...}
  maxSources={5}
  disabled={isStreaming || isLoading}
  explanationId={sessionData?.explanation_id}  // NEW
/>
```

#### 7. `src/components/AdvancedAIEditorModal.tsx`
- **Pass `explanationId`** to existing `<SourceList>`:
```tsx
<SourceList
  sources={sources}
  onSourceAdded={...}
  onSourceRemoved={...}
  maxSources={5}
  disabled={isLoading}
  explanationId={explanationId}  // NEW
/>
```

#### 8. `src/app/results/page.tsx`
**Remove:**
- Line 6: remove `addSourceToExplanationAction` from import
- Line 21: remove `import DiscoverSourcesPanel`
- Lines 144-152: remove `handleAddDiscoveredSource` callback
- Lines ~1438-1445: remove first `<DiscoverSourcesPanel>` render (Lexical branch)
- Lines ~1460-1467: remove second `<DiscoverSourcesPanel>` render (RawMarkdown branch)

#### 9. `src/components/sources/DiscoverSourcesPanel.tsx`
- Add `@deprecated` JSDoc — keep file for now, delete in follow-up

#### 10. `src/components/sources/index.ts`
- Add `export { default as SourceCombobox } from './SourceCombobox';`

#### 11. Test updates
- `src/components/sources/__tests__/SourceList.test.tsx` (**CREATE** — no existing tests): baseline tests for current behavior + conditional SourceCombobox/SourceInput rendering
- `src/components/sources/__tests__/SourceInput.test.tsx` (**CREATE** — no existing tests): baseline regression tests before refactoring to useSourceSubmit
- `AIEditorPanel.test.tsx`: verify explanationId passed through to SourceList
- `AdvancedAIEditorModal.test.tsx`: verify explanationId passed through to SourceList

### All SourceList Consumers (4 total)

| Consumer | File | Has `explanationId`? | Combobox? |
|----------|------|---------------------|-----------|
| AIEditorPanel | `src/components/AIEditorPanel.tsx:597` | Yes (sessionData) | Yes |
| AdvancedAIEditorModal | `src/components/AdvancedAIEditorModal.tsx:190` | Yes (prop) | Yes |
| **SearchBar** | `src/components/SearchBar.tsx:182` | **No** | No — falls back to SourceInput |
| **SourceEditor** | `src/components/sources/SourceEditor.tsx:165` | Yes (prop) | Yes — pass through |

### Key Design Decisions

1. **Radix Popover for dropdown**: Handles portal rendering (escapes `overflow-hidden`), focus management (no blur-before-click bug), click-outside dismissal, and Escape key — no custom dropdown implementation needed
2. **ARIA combobox pattern**: `role="combobox"` on input, `role="listbox"` on dropdown, `role="option"` on rows, arrow key navigation with `aria-activedescendant`
3. **No binary mode switching**: Always show "Add as URL" at top when input non-empty + filtered discoveries below — eliminates flickering during typing. URL validation on submit, not during typing
4. **`useSourceSubmit` hook**: Extract from SourceInput to share URL submission logic (validation, loading chips, metadata fetch, errors) — zero duplication between SourceInput and SourceCombobox
5. **`lastLoadedExplanationId` instead of `hasLoaded` boolean**: Re-fetches discovery data when explanation changes, prevents stale suggestions
6. **Fetch on mount, not on focus**: Discovery data loads when component mounts (or explanationId changes), ready when user focuses input — avoids 200-500ms Pinecone latency on every click
7. **`React.lazy()` for SourceCombobox**: Code-split so SearchBar bundle path doesn't load discovery code
8. **Discovered sources → SourceChipType without fetch**: `DiscoveredSource` already has url/domain/title/favicon — construct chip directly
9. **Sources stay ephemeral in sidebar**: discovered sources add as reference sources for AI context; article persistence is via "Edit Sources" panel
10. **Create baseline tests first**: SourceList.test.tsx and SourceInput.test.tsx must exist before refactoring

### Implementation Order
1. Create `useSourceSubmit` hook + tests, refactor SourceInput to use it
2. Create baseline tests: `SourceList.test.tsx`, `SourceInput.test.tsx`
3. Create `SourceCombobox.tsx` + tests (using Radix Popover + useSourceSubmit)
4. Modify `SourceList.tsx` with React.lazy conditional rendering
5. Pass `explanationId` in `AIEditorPanel.tsx`, `AdvancedAIEditorModal.tsx`, `SourceEditor.tsx`
6. Remove `DiscoverSourcesPanel` from `results/page.tsx`
7. Mark `DiscoverSourcesPanel` deprecated, update barrel export
8. Lint / tsc / build / run all tests

### Verification
1. `npx eslint` on all changed files
2. `npx tsc --noEmit`
3. `npx jest` for useSourceSubmit, SourceInput, SourceCombobox, SourceList, AIEditorPanel, AdvancedAIEditorModal, results page tests
4. Playwright: navigate to results page for explanation 138 — verify DiscoverSourcesPanel gone from article body, click into sidebar source input, verify Radix dropdown with discoveries and URL hint appears, test keyboard nav
