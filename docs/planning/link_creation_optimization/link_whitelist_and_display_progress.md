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

### Phase 5: Heading Link Generation ⏳ PENDING

| Step | Status | Notes |
|------|--------|-------|
| Modify `postprocessNewExplanationContent` | ⏳ Pending | Generate at creation time |
| Save heading links to DB | ⏳ Pending | In `saveExplanationAndTopic` |

---

### Phase 6: Content Display ⏳ PENDING

| Step | Status | Notes |
|------|--------|-------|
| Modify `/src/app/results/page.tsx` | ⏳ Pending | Apply links at render time |

---

### Phase 7: Stop Inline Link Generation ⏳ PENDING

| Step | Status | Notes |
|------|--------|-------|
| Remove `createMappingsHeadingsToLinks` calls | ⏳ Pending | |
| Remove `createMappingsKeytermsToLinks` calls | ⏳ Pending | |

---

### Phase 8: Server Actions ⏳ PENDING

| Step | Status | Notes |
|------|--------|-------|
| Add whitelist CRUD actions | ⏳ Pending | ~9 new actions |
| Add heading cache invalidation | ⏳ Pending | In `updateExplanationAndTopic` |

---

### Phase 9: Admin UI ⏳ PENDING

| Step | Status | Notes |
|------|--------|-------|
| `/src/app/admin/whitelist/page.tsx` | ⏳ Pending | Main page with tabs |
| `WhitelistTable.tsx` | ⏳ Pending | CRUD component |

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
