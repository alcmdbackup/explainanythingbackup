# Manage Sources

## Overview

The source management system extends the base "Add Sources" feature with CRUD operations, a discovery pipeline, a leaderboard, and a unified combobox UI. It allows users to add/remove/reorder sources on explanations, discover popular and co-cited sources, and browse a global source leaderboard.

**Core capabilities**:
- Add sources by URL or from discovered suggestions
- Remove and reorder sources (max 5 per explanation)
- Source leaderboard ranked by citation count
- Source profiles showing citation history and co-cited sources
- Unified SourceCombobox replacing separate input + discovery panel

## Key Files

### Services
- `src/lib/services/sourceCache.ts` - CRUD helpers (add/remove/reorder/replace sources), links sources to explanations
- `src/lib/services/sourceDiscovery.ts` - Discovery pipeline: popular sources by topic (Pinecone), co-cited sources (SQL join)
- `src/lib/services/sourceFetcher.ts` - URL fetching, content extraction

### Server Actions (`src/actions/actions.ts`)
- `addSourceToExplanationAction` - Add source by URL, creating cache entry if needed
- `removeSourceFromExplanationAction` - Remove a source from an explanation
- `reorderSourcesAction` - Reorder sources by position
- `updateExplanationSourcesAction` - Replace all sources atomically
- `getPopularSourcesByTopicAction` - Discovery: popular sources in a topic
- `getSimilarArticleSourcesAction` - Discovery: sources used in similar articles
- `getSourceCitationCountsAction` - Leaderboard data via RPC

### UI Components
- `src/components/sources/SourceCombobox.tsx` - Unified search + paste input (Radix Popover, ARIA combobox)
- `src/components/sources/SourceList.tsx` - Container that conditionally renders SourceCombobox or SourceInput
- `src/components/sources/SourceEditor.tsx` - Full source management panel with drag-to-reorder
- `src/components/sources/SourceLeaderboardPage.tsx` - `/sources` leaderboard with filter pills
- `src/components/sources/SourceProfile.tsx` - `/sources/[id]` profile page
- `src/components/sources/SourceCard.tsx` - Card component for leaderboard entries
- `src/components/sources/SourceFilterPills.tsx` - Domain/citation count filter UI

### Hooks
- `src/hooks/useSourceSubmit.ts` - Shared URL submission logic (validation, loading chip, metadata fetch)

### Pages
- `src/app/sources/page.tsx` - Source leaderboard (server component)
- `src/app/sources/[id]/page.tsx` - Source profile (server component)
- `src/app/sources/layout.tsx` - Shared layout for source pages

### Schemas (`src/lib/schemas/schemas.ts`)
- `updateSourcesInputSchema`, `addSourceInputSchema`, `removeSourceInputSchema`, `reorderSourcesInputSchema`
- `sourceCitationCountSchema` - Leaderboard RPC response shape

### Database Migration
- `supabase/migrations/20260201000003_source_management.sql` - RPC functions: `get_source_citation_counts`, `get_co_cited_sources`

## Implementation

### SourceCombobox (Phase 6)

The SourceCombobox is the unified input that replaces the separate SourceInput + DiscoverSourcesPanel. It combines URL pasting with discovered source browsing in a single dropdown.

**Architecture**: Built on Radix Popover for portal rendering (escapes `overflow-hidden` containers) and focus management.

**Input states**:
| State | Dropdown top row | Below |
|-------|-----------------|-------|
| Empty/focused | "Paste a URL to add" hint | Discovered sources |
| Text typed | "Add as URL: [text]" action | Filtered sources |
| URL detected | "Add [url]" highlighted action | Hidden |
| At max sources | Input disabled | — |

**Key design decisions**:
1. **Fetch on mount** — Discovery data fetched when component mounts, not on focus. Avoids 200-500ms Pinecone latency per click.
2. **`lastLoadedExplanationIdRef`** — Tracks which explanation was last loaded. Re-fetches when explanation changes (vs boolean `hasLoaded` which can't detect navigation).
3. **Discovered source → SourceChipType without fetch** — Constructs chip directly from existing data. No metadata fetch needed since discovery already has title/domain/favicon.
4. **Code-split via React.lazy** — SourceList loads SourceCombobox lazily so the SearchBar bundle doesn't include discovery code.

**ARIA combobox pattern**:
- Input: `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`
- Dropdown: `role="listbox"`
- Each row: `role="option"`, `aria-selected`, `aria-disabled`
- Full keyboard navigation: ArrowUp/Down, Enter, Escape, Home/End

### Source Discovery Pipeline

Two discovery vectors, merged and deduplicated by `source_cache_id`:

1. **Popular by topic** (`getPopularSourcesByTopic`): Finds explanations in the same topic via Pinecone vector search, then counts which sources are most frequently cited across those explanations.

2. **Similar article sources** (`getSimilarArticleSources`): Finds explanations similar to the current one via Pinecone, then returns sources used in those similar articles.

### Source Leaderboard (`/sources`)

Server-rendered page calling `get_source_citation_counts` RPC. Displays sources ranked by total citations with:
- Domain filter pills (click to filter by domain)
- Citation count badges
- Links to source profiles

### Source Profile (`/sources/[id]`)

Shows a single source's metadata, citation count, recent explanations that cite it, and co-cited sources via `get_co_cited_sources` RPC.

## Database

### RPC Functions (migration `20260201000002`)

**`get_source_citation_counts(p_limit, p_offset)`**: Returns sources ranked by citation count with domain, title, favicon. Used by leaderboard.

**`get_co_cited_sources(p_source_id, p_limit)`**: Given a source, finds other sources that appear in the same explanations. Used by source profiles.

## Navigation

The Sources leaderboard is accessible via the "Sources" link in the top navigation bar (`Navigation.tsx`), positioned between "Explore" and "Settings".

## Testing

- 286 source-related unit tests across 16 suites
- Integration tests in `source-management.integration.test.ts` (requires migration deployment)
- Components: SourceCombobox (34 tests), SourceInput (13), SourceList (16), SourceEditor, SourceCard, SourceProfile, DiscoverSourcesPanel, Bibliography
- Hook: useSourceSubmit (15 tests)
- Services: sourceCache, sourceDiscovery, sourceFetcher
- Schemas: sourceSchemas

## Known Issues

1. **Migration not deployed**: `get_source_citation_counts` and `get_co_cited_sources` RPCs require migration deployment. The `/sources` page shows "Failed to load sources" until deployed.
2. **DiscoverSourcesPanel deprecated**: Marked `@deprecated` but kept for reference. Should be deleted in follow-up.
