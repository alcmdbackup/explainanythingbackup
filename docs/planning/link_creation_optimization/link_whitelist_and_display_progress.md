# Link Whitelist System Implementation Progress

**Plan Document**: [`link_whitelist_and_display_plan.md`](./link_whitelist_and_display_plan.md)

## Progress Tracking

### Phase 1: Database & Schemas ✅ COMPLETE

**Completed**: 2025-12-21

| Step | Status | Notes |
|------|--------|-------|
| SQL Migration | ✅ Complete | `supabase/migrations/20251221080336_link_whitelist_system.sql` |
| Zod Schemas | ✅ Complete | Added to `/src/lib/schemas/schemas.ts` (lines 590-753) |
| Unit Tests | ✅ Complete | 19 new tests in `/src/lib/schemas/schemas.test.ts` (67 total) |
| Plan Updated | ✅ Complete | Corrected Drizzle references to Supabase pattern |

#### Summary

Created the foundational database layer for the link overlay system. The schema supports:
- **Whitelist management**: Canonical terms with standalone titles and optional descriptions
- **Alias support**: Multiple terms can map to the same canonical entry (e.g., "ML" → "Machine Learning")
- **Heading cache**: AI-generated standalone titles stored per-article to avoid repeated LLM calls
- **Per-article overrides**: Custom titles or disabled links for specific articles
- **Snapshot cache**: Single-row table with version number for efficient cache invalidation

#### Created Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `link_whitelist` | Core whitelist for key terms | `canonical_term`, `standalone_title`, `is_active` |
| `article_heading_links` | Cached AI-generated heading titles | `explanation_id`, `heading_text`, `standalone_title` |
| `link_whitelist_aliases` | Many-to-one aliases | `whitelist_id`, `alias_term` |
| `article_link_overrides` | Per-article customizations | `explanation_id`, `term`, `override_type` |
| `link_whitelist_snapshot` | Fast single-query fetch with version | `version`, `data` (JSONB) |

#### Created Types

| Type | Purpose |
|------|---------|
| `LinkWhitelistInsertType`, `LinkWhitelistFullType` | Whitelist CRUD |
| `LinkAliasInsertType`, `LinkAliasFullType` | Alias management |
| `ArticleHeadingLinkInsertType`, `ArticleHeadingLinkFullType` | Heading cache |
| `ArticleLinkOverrideInsertType`, `ArticleLinkOverrideFullType` | Override management |
| `WhitelistCacheEntryType`, `LinkWhitelistSnapshotType` | Cache structures |
| `ResolvedLinkType` | Link resolver output |
| `LinkOverrideType` enum | `custom_title` \| `disabled` |

#### Files Modified

- `supabase/migrations/20251221080336_link_whitelist_system.sql` (NEW - 156 lines)
- `/src/lib/schemas/schemas.ts` (MODIFIED - added ~165 lines)
- `/src/lib/schemas/schemas.test.ts` (MODIFIED - added 19 tests)

---

### Phase 2: Whitelist Service ✅ COMPLETE

**Completed**: 2025-12-21

| Step | Status | Notes |
|------|--------|-------|
| `/src/lib/services/linkWhitelist.ts` | ✅ Complete | CRUD + alias + cache functions |
| Unit Tests | ✅ Complete | 24 tests in `/src/lib/services/linkWhitelist.test.ts` |

#### Summary

Created the service layer for the link whitelist system with full CRUD operations, alias management, snapshot caching, and heading link cache functionality.

#### Functions Implemented

| Category | Function | Purpose |
|----------|----------|---------|
| **CRUD** | `createWhitelistTerm` | Create new whitelist entry with deduplication |
| **CRUD** | `getAllActiveWhitelistTerms` | Get all active terms ordered by name |
| **CRUD** | `updateWhitelistTerm` | Update existing term (auto-updates lowercase) |
| **CRUD** | `deleteWhitelistTerm` | Delete term (cascades to aliases) |
| **Aliases** | `addAliases` | Add multiple aliases with deduplication |
| **Aliases** | `removeAlias` | Remove single alias by ID |
| **Aliases** | `getAliasesForTerm` | Get all aliases for a whitelist term |
| **Lookup** | `getActiveWhitelistAsMap` | Build lookup Map including aliases |
| **Lookup** | `rebuildSnapshot` | Rebuild snapshot cache with version bump |
| **Lookup** | `getSnapshot` | Get current snapshot (rebuilds if missing) |
| **Heading Cache** | `getHeadingLinksForArticle` | Get cached heading titles for article |
| **Heading Cache** | `saveHeadingLinks` | Upsert heading titles for article |
| **Heading Cache** | `deleteHeadingLinksForArticle` | Delete all heading links for article |
| **Heading Cache** | `generateHeadingStandaloneTitles` | Generate AI titles (no DB save) |
| **Helper** | `getWhitelistTermById` | Get single term by ID |

#### Files Created

- `/src/lib/services/linkWhitelist.ts` (NEW - ~400 lines)
- `/src/lib/services/linkWhitelist.test.ts` (NEW - 24 tests)

---

### Phase 3: Link Resolver Service ✅ COMPLETE

**Completed**: 2025-12-21

| Step | Status | Notes |
|------|--------|-------|
| `/src/lib/services/linkResolver.ts` | ✅ Complete | Core overlay logic |
| `/src/lib/services/links.ts` | ✅ Complete | Exported `encodeStandaloneTitleParam` |
| Unit Tests | ✅ Complete | 43 tests in `/src/lib/services/linkResolver.test.ts` |

#### Summary

Created the core link resolver service that resolves links at render time using the whitelist and heading cache from Phases 1-2. Also includes per-article override handling (originally planned as separate Phase 4).

#### Functions Implemented

| Category | Function | Purpose |
|----------|----------|---------|
| **Core** | `resolveLinksForArticle` | Main resolver - processes headings + whitelist terms |
| **Core** | `applyLinksToContent` | Apply resolved links to markdown content |
| **Overrides** | `getOverridesForArticle` | Fetch per-article overrides from DB |
| **Helpers** | `isWordBoundary` | Check word boundaries for matching |
| **Helpers** | `overlaps` | Check if ranges overlap |
| **Helpers** | `extractHeadings` | Extract h2/h3 headings from content |
| **Helpers** | `headingsMatch` | Compare heading arrays |

#### Algorithm

1. **Process headings first** (always linked, cached AI-generated titles)
2. **Build exclusion zones** from heading positions
3. **Match whitelist terms** (longer terms first, first occurrence only)
4. **Apply overrides** (disabled or custom_title)
5. **Sort by position** and return

#### Files Modified/Created

- `/src/lib/services/linkResolver.ts` (NEW - ~250 lines)
- `/src/lib/services/linkResolver.test.ts` (NEW - 43 tests)
- `/src/lib/services/links.ts` (MODIFIED - exported `encodeStandaloneTitleParam`)

---

### Phase 4: Override Service ✅ COMPLETE (Merged into Phase 3)

| Step | Status | Notes |
|------|--------|-------|
| `getOverridesForArticle` | ✅ Complete | Included in `linkResolver.ts` |

**Note**: Per-article override handling was incorporated directly into `linkResolver.ts` rather than creating a separate service file, as it's tightly coupled with link resolution logic.

---

### Phase 5: Heading Link Generation ✅ COMPLETE

**Completed**: 2025-12-21

| Step | Status | Notes |
|------|--------|-------|
| Modify `postprocessNewExplanationContent` | ✅ Complete | Now uses `generateHeadingStandaloneTitles`, returns `headingTitles` |
| Modify `generateNewExplanation` | ✅ Complete | Passes through `headingTitles` |
| Save heading links to DB | ✅ Complete | `saveHeadingLinks` called in `returnExplanationLogic` |
| Update tests | ✅ Complete | Updated mocks and assertions |

#### Summary

Modified the explanation creation flow to generate heading standalone titles at creation time and save them to the `article_heading_links` table, instead of embedding links directly into content.

#### Key Changes

| Function | Change |
|----------|--------|
| `postprocessNewExplanationContent` | Replaced `createMappingsHeadingsToLinks` with `generateHeadingStandaloneTitles`, removed heading embedding loop, returns `headingTitles` |
| `generateNewExplanation` | Added `headingTitles` to return type and passes it through |
| `returnExplanationLogic` | Calls `saveHeadingLinks(newExplanationId, headingTitles)` after saving explanation |

#### Files Modified

- `/src/lib/services/returnExplanation.ts` (MODIFIED - updated 3 functions)
- `/src/lib/services/returnExplanation.test.ts` (MODIFIED - updated mocks and assertions)

#### Behavior Change

- **Before**: Headings embedded as `## [Heading](/standalone-title?t=encoded)` in content
- **After**: Content has plain headings `## Heading`, titles stored in `article_heading_links` table

---

### Phase 6: Content Display ✅ COMPLETE

**Completed**: 2025-12-21

| Step | Status | Notes |
|------|--------|-------|
| Add `resolveLinksForDisplayAction` | ✅ Complete | Server action in `/src/actions/actions.ts` |
| Update `useExplanationLoader.ts` | ✅ Complete | Calls action after loading explanation |

#### Summary

Implemented render-time link resolution by adding a server action that wraps `resolveLinksForArticle()` and `applyLinksToContent()`, called from the `useExplanationLoader` hook when loading explanations.

#### Key Changes

| Function/File | Change |
|---------------|--------|
| `resolveLinksForDisplayAction` | New server action - resolves + applies links |
| `useExplanationLoader.loadExplanation` | Calls action after fetching, falls back to raw content on error |

#### Files Modified

- `/src/actions/actions.ts` (MODIFIED - added ~20 lines)
- `/src/hooks/useExplanationLoader.ts` (MODIFIED - added ~10 lines)

---

### Phase 7: Stop Inline Link Generation ✅ COMPLETE

**Completed**: 2025-12-21

| Step | Status | Notes |
|------|--------|-------|
| Remove `createMappingsHeadingsToLinks` calls | ✅ Complete | Replaced with `generateHeadingStandaloneTitles` in Phase 5 |
| Remove `createMappingsKeytermsToLinks` calls | ✅ Complete | Removed from returnExplanation.ts |
| Delete `createMappingsKeytermsToLinks` function | ✅ Complete | Deleted from links.ts |
| Update tests | ✅ Complete | Updated links.test.ts and returnExplanation.test.ts |

#### Key Changes
- Removed `createMappingsKeytermsToLinks` import and usage from `postprocessNewExplanationContent`
- Deleted `createMappingsKeytermsToLinks` and `createKeyTermMappingPrompt` functions from links.ts
- Content is now stored plain - key term links resolved at render time via linkResolver

---

### Phase 8: Server Actions ✅ COMPLETE

**Completed**: 2025-12-21

| Step | Status | Notes |
|------|--------|-------|
| Add whitelist CRUD actions | ✅ Complete | 5 actions: create, getAll, getById, update, delete |
| Add alias CRUD actions | ✅ Complete | 3 actions: addAliases, removeAlias, getAliasesForTerm |
| Add override CRUD actions | ✅ Complete | 3 actions: set, remove, get |

#### Actions Added to `/src/actions/actions.ts`
- `createWhitelistTermAction`
- `getAllWhitelistTermsAction`
- `getWhitelistTermByIdAction`
- `updateWhitelistTermAction`
- `deleteWhitelistTermAction`
- `addAliasesAction`
- `removeAliasAction`
- `getAliasesForTermAction`
- `setArticleLinkOverrideAction`
- `removeArticleLinkOverrideAction`
- `getArticleLinkOverridesAction`

#### Also Added to `/src/lib/services/linkResolver.ts`
- `setOverride()` - Set/upsert an override for a term
- `removeOverride()` - Delete an override

---

### Phase 9: Admin UI ✅ COMPLETE

**Completed**: 2025-12-21

| Step | Status | Notes |
|------|--------|-------|
| `/src/app/admin/layout.tsx` | ✅ Complete | Auth check with hardcoded admin emails |
| `/src/app/admin/page.tsx` | ✅ Complete | Redirects to /admin/whitelist |
| `/src/app/admin/whitelist/page.tsx` | ✅ Complete | Main page with Navigation |
| `/src/components/admin/WhitelistContent.tsx` | ✅ Complete | Full CRUD UI with table, form modal, alias manager |

#### Access Control
- Hardcoded admin emails in `ADMIN_EMAILS` constant
- Currently: `['abecha@gmail.com']`
- Unauthorized users redirected to home

#### Features Implemented
- Table view with term, standalone title, status columns
- Add/Edit term modal with form validation
- Alias management modal with add/remove
- Active/Inactive status toggle
- Delete confirmation

---

### Phase 10 (DEFERRED): Lexical-Level Link Overlay

| Step | Status | Notes |
|------|--------|-------|
| `LinkOverlayPlugin.tsx` | ⏳ Deferred | For AI suggestions diff context |
| Integration with AI pipeline | ⏳ Deferred | Apply after CriticMarkup import |

---

## Implementation Notes

- **Codebase Pattern**: Uses Supabase directly (not Drizzle ORM)
- **Migrations**: Raw SQL in `supabase/migrations/`
- **Validation**: Zod schemas in `/src/lib/schemas/schemas.ts`

## Summary

**Core Implementation Complete (Phases 1-9)**

The link whitelist system is fully implemented:
- Database tables and schemas for whitelist, aliases, overrides, and heading cache
- Service layer with full CRUD operations and caching
- Link resolver that applies links at render time
- Server actions exposing all functionality to the UI
- Admin UI at `/admin/whitelist` with email-based access control

**Key Behavior Changes:**
- Content is stored without embedded key term links (plain text)
- Heading standalone titles generated at creation time, stored in DB
- Links resolved at render time via `resolveLinksForArticle()`
- Old `createMappingsKeytermsToLinks` removed entirely

**Remaining (Deferred):**
- Phase 10: Lexical-level link overlay for AI suggestions with CriticMarkup diffs
