# Link Whitelist System Implementation Plan

## Summary
Implement a **link overlay system** where links are stored separately from article content. Links are resolved at render time, keeping content clean for embeddings and enabling bulk link updates without editing articles.

---

## Requirements (from user)
- **Structure**: Flat list with aliases (synonyms → same canonical link)
- **Separate link layer**: Links stored independently, not inline in content
- **Per-article overrides**: Global defaults with article-specific customization

> **Candidate Generation**: For AI suggestions, frequency analysis, and auto-approval pipeline, see:
> [`/docs/planning/link_candidate_generation/link_candidate_generation_plan.md`](../link_candidate_generation/link_candidate_generation_plan.md)

---

## Architecture: Link Overlay System

### Key Decisions
- **Headings**: Always auto-linked with AI-generated standalone titles (not dependent on whitelist)
- **Key terms**: Only linked if in whitelist (pure whitelist matching)
- **In-memory cache** with 5 min TTL for whitelist lookups
- **First occurrence only** per article for key terms (Wikipedia-style linking)
- **Heading titles cached** per article to avoid repeated AI calls

### Key Principles
1. **Content is plain text** - No link markup stored in article content
2. **Links resolved at render time** - Whitelist + overrides applied when displaying
3. **Clean embeddings** - Raw text without URL noise
4. **Term-based matching** - Case-insensitive term matching in content
5. **First occurrence only** - Each term linked only on first appearance

### Scalability: Whitelist Matching

**Problem**: Naive approach (regex per term) is O(terms × content_length) - won't scale.

**Solution**: Aho-Corasick algorithm for multi-pattern matching
- Build a trie from all whitelist terms (done once, cached)
- Single pass through content finds ALL matches: O(content_length + matches)
- Library: `ahocorasick` npm package or custom implementation

```typescript
import AhoCorasick from 'ahocorasick';

// Build once, cache with whitelist
const ac = new AhoCorasick([...whitelist.keys()]);

// Single pass finds all matches
const matches = ac.search(content.toLowerCase());
// Returns: [[position, [matchedTerms]], ...]
```

**Fallback for small whitelists** (<100 terms): Simple regex loop is fine.

### Caching Strategy (Vercel Serverless)

**Deployment**: Vercel serverless functions (no persistent memory across invocations)

#### Caching Options

| Option | Latency (cold) | Latency (warm) | Extra Cost | Complexity |
|--------|---------------|----------------|------------|------------|
| **Vercel KV** ⭐ | ~5ms | ~5ms | Low | Low |
| **Supabase-only** | ~80ms | ~80ms | None | Lowest |
| **Edge Config** | ~1ms | ~1ms | None | Medium |
| **ISR Static** | ~1ms | ~1ms | None | Medium |

---

#### Option 1: Vercel KV (Recommended)

```
Serverless Function → Vercel KV (edge) → PostgreSQL (fallback)
```

```typescript
import { kv } from '@vercel/kv';

interface WhitelistCache {
  version: number;
  data: Record<string, { canonical_term: string; standalone_title: string }>;
  terms: string[]; // For Aho-Corasick rebuild
}

const KV_KEY = 'link-whitelist-cache';
const KV_TTL_SECONDS = 300; // 5 minutes

async function getWhitelistCache(): Promise<WhitelistCache> {
  // Check Vercel KV first
  const cached = await kv.get<WhitelistCache>(KV_KEY);
  const currentVersion = await getWhitelistVersion();

  if (cached && cached.version === currentVersion) {
    return cached;
  }

  // Cache miss or stale - rebuild from DB
  const data = await getActiveWhitelistAsMap();
  const fresh: WhitelistCache = {
    version: currentVersion,
    data: Object.fromEntries(data),
    terms: [...data.keys()]
  };

  // Store in Vercel KV
  await kv.set(KV_KEY, fresh, { ex: KV_TTL_SECONDS });
  return fresh;
}

// Build Aho-Corasick matcher from cache (in-memory, per-invocation)
function buildMatcher(cache: WhitelistCache): AhoCorasick {
  return new AhoCorasick(cache.terms);
}
```

**Setup**: `npm i @vercel/kv` + configure in Vercel dashboard

---

#### Option 2: Supabase-Only (No External Cache)

```
Serverless Function → PostgreSQL (optimized query)
```

```typescript
// Store serialized whitelist in single row for fast fetch
// Table: link_whitelist_snapshot (version, data JSONB, updated_at)

async function getWhitelistCache(): Promise<WhitelistCache> {
  const snapshot = await db
    .select()
    .from(linkWhitelistSnapshot)
    .limit(1);

  if (snapshot) {
    return {
      version: snapshot.version,
      data: snapshot.data,
      terms: Object.keys(snapshot.data)
    };
  }

  // Fallback: build from whitelist table
  return rebuildSnapshot();
}

// Trigger: Rebuild snapshot on whitelist changes
async function rebuildSnapshot() {
  const data = await getActiveWhitelistAsMap();
  const version = await getWhitelistVersion();
  await db.insert(linkWhitelistSnapshot).values({
    version,
    data: Object.fromEntries(data)
  }).onConflictDoUpdate(...);
  return { version, data: Object.fromEntries(data), terms: [...data.keys()] };
}
```

**Pro**: No extra services. **Con**: ~80ms per cold start.

---

#### Option 3: Edge Config (Ultra-fast, small data)

```
Serverless Function → Edge Config (<1ms) → PostgreSQL (on change)
```

```typescript
import { get } from '@vercel/edge-config';

async function getWhitelistCache(): Promise<WhitelistCache> {
  const cached = await get<WhitelistCache>('whitelist');
  if (cached) return cached;

  // Fallback to DB (shouldn't happen if sync is working)
  return await fetchFromDB();
}

// Webhook: Sync to Edge Config on whitelist change
// POST /api/sync-edge-config
export async function POST() {
  const data = await getActiveWhitelistAsMap();
  await edgeConfigClient.set('whitelist', {
    version: await getWhitelistVersion(),
    data: Object.fromEntries(data),
    terms: [...data.keys()]
  });
}
```

**Pro**: <1ms reads. **Con**: 8KB per-item limit, manual sync via webhook.

---

#### Option 4: ISR + Static JSON (Build-time)

```
Build/ISR → static JSON → revalidate on-demand
```

```typescript
// app/api/whitelist/route.ts
export const revalidate = 300; // 5 minutes

export async function GET() {
  const data = await getActiveWhitelistAsMap();
  return Response.json({
    version: await getWhitelistVersion(),
    data: Object.fromEntries(data),
    terms: [...data.keys()]
  });
}

// In linkResolver.ts
async function getWhitelistCache() {
  const res = await fetch('/api/whitelist', { next: { revalidate: 300 } });
  return res.json();
}

// On whitelist change: call revalidatePath('/api/whitelist')
```

**Pro**: Free, fast. **Con**: Updates not instant (up to 5 min delay).

---

#### Heading Link Cache (DB-based, no external cache needed)

```
article_heading_links table stores AI-generated titles per article
- Permanent cache until article content changes
- Invalidate: DELETE FROM article_heading_links WHERE explanation_id = ?
```

---

#### Recommended Setup

1. **Start with**: Supabase-only (Option 2) - simplest, no extra services
2. **Upgrade to**: Vercel KV (Option 1) if cold start latency becomes an issue
3. **Heading cache**: Always use DB (already planned)

### Flow
```
[Article Content (plain text)]
         ↓ render time
[Process Headings] → AI-generate standalone titles (cached per article)
         ↓
[Apply Whitelist] → find whitelisted key terms in text
         ↓
[Apply Overrides] → per-article customizations
         ↓
[Rendered with Links]
```

---

## Database Schema

### New Tables

```sql
-- Core whitelist for KEY TERMS (not headings)
CREATE TABLE link_whitelist (
  id SERIAL PRIMARY KEY,
  canonical_term VARCHAR(255) NOT NULL UNIQUE,
  canonical_term_lower VARCHAR(255) NOT NULL UNIQUE,
  standalone_title VARCHAR(500) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cached heading links per article (AI-generated, cached to avoid repeated calls)
CREATE TABLE article_heading_links (
  id SERIAL PRIMARY KEY,
  explanation_id INTEGER REFERENCES explanations(id) ON DELETE CASCADE,
  heading_text VARCHAR(500) NOT NULL,
  heading_text_lower VARCHAR(500) NOT NULL,
  standalone_title VARCHAR(500) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(explanation_id, heading_text_lower)
);

-- Aliases (many-to-one → whitelist)
CREATE TABLE link_whitelist_aliases (
  id SERIAL PRIMARY KEY,
  whitelist_id INTEGER REFERENCES link_whitelist(id) ON DELETE CASCADE,
  alias_term VARCHAR(255) NOT NULL,
  alias_term_lower VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Per-article overrides
CREATE TABLE article_link_overrides (
  id SERIAL PRIMARY KEY,
  explanation_id INTEGER REFERENCES explanations(id) ON DELETE CASCADE,
  term VARCHAR(255) NOT NULL,
  term_lower VARCHAR(255) NOT NULL,
  override_type VARCHAR(50) NOT NULL,  -- 'custom_title' | 'disabled'
  custom_standalone_title VARCHAR(500),  -- NULL if disabled
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(explanation_id, term_lower)
);

-- NOTE: link_candidates table is defined in link_candidate_generation_plan.md

-- Version tracking for cache invalidation
CREATE TABLE link_whitelist_meta (
  key VARCHAR(50) PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT INTO link_whitelist_meta (key, value) VALUES ('version', 1);

-- Snapshot for fast single-query fetch (Supabase-only caching option)
CREATE TABLE link_whitelist_snapshot (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- Single row
  version INTEGER NOT NULL,
  data JSONB NOT NULL,  -- {term_lower: {canonical_term, standalone_title}, ...}
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger to bump version and rebuild snapshot on whitelist changes
CREATE OR REPLACE FUNCTION bump_whitelist_version() RETURNS TRIGGER AS $$
BEGIN
  UPDATE link_whitelist_meta SET value = value + 1 WHERE key = 'version';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER whitelist_version_bump
AFTER INSERT OR UPDATE OR DELETE ON link_whitelist
FOR EACH STATEMENT EXECUTE FUNCTION bump_whitelist_version();

CREATE TRIGGER alias_version_bump
AFTER INSERT OR UPDATE OR DELETE ON link_whitelist_aliases
FOR EACH STATEMENT EXECUTE FUNCTION bump_whitelist_version();

-- Note: Snapshot rebuild is done in application code after whitelist changes
-- (Can't easily call application code from DB trigger)
```

---

## Implementation Steps

### Step 1: Database & Schemas
**Files to modify:**
- `/src/lib/db/schemas.ts` - Add Drizzle table definitions
- `/src/lib/schemas/schemas.ts` - Add Zod validation schemas

**New types:**
- `LinkWhitelistInsertType`, `LinkWhitelistFullType`
- `LinkAliasInsertType`, `LinkAliasFullType`
- `ArticleHeadingLinkType` (cached AI-generated heading titles)
- `ArticleLinkOverrideType`

> Candidate types defined in [`link_candidate_generation_plan.md`](../link_candidate_generation/link_candidate_generation_plan.md)

---

### Step 2: Whitelist Service
**New file:** `/src/lib/services/linkWhitelist.ts`

```typescript
// CRUD for whitelist
createWhitelistTerm(term: LinkWhitelistInsertType): Promise<LinkWhitelistFullType>
getAllActiveWhitelistTerms(): Promise<LinkWhitelistFullType[]>
updateWhitelistTerm(id, updates): Promise<LinkWhitelistFullType>
deleteWhitelistTerm(id): Promise<void>

// Aliases
addAliases(whitelistId, aliases: string[]): Promise<LinkAliasFullType[]>
removeAlias(aliasId): Promise<void>

// Build lookup map (includes aliases)
getActiveWhitelistAsMap(): Promise<Map<string, {canonical_term, standalone_title}>>

// Heading link cache (stored in article_heading_links table)
getHeadingLinksForArticle(explanationId): Promise<Map<string, string>>
saveHeadingLinks(explanationId, headings: Record<string, string>): Promise<void>
generateHeadingStandaloneTitles(headings: string[], explanationId): Promise<Record<string, string>>
```

---

### Step 3: Link Resolver Service (NEW - Core of overlay system)
**New file:** `/src/lib/services/linkResolver.ts`

```typescript
interface ResolvedLink {
  term: string;
  startIndex: number;
  endIndex: number;
  standaloneTitle: string;
  type: 'heading' | 'term';
}

// In-memory cache with 5 min TTL for whitelist
let whitelistCache: { data: Map<string, WhitelistEntry>; expiry: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getCachedWhitelist(): Promise<Map<string, WhitelistEntry>> {
  if (!whitelistCache || Date.now() > whitelistCache.expiry) {
    whitelistCache = {
      data: await getActiveWhitelistAsMap(),
      expiry: Date.now() + CACHE_TTL_MS
    };
  }
  return whitelistCache.data;
}

/**
 * Resolve links for an article at render time
 * 1. Process HEADINGS: Always linked, AI-generated titles (cached in DB)
 * 2. Process KEY TERMS: Only if in whitelist
 * 3. First occurrence only per key term
 * 4. Apply overrides
 */
export async function resolveLinksForArticle(
  explanationId: number,
  content: string
): Promise<ResolvedLink[]> {
  const links: ResolvedLink[] = [];

  // === STEP 1: HEADINGS (always linked) ===
  const headingLinks = await resolveHeadingLinks(explanationId, content);
  links.push(...headingLinks);

  // === STEP 2: KEY TERMS (whitelist only, using Aho-Corasick) ===
  const { data: whitelist, matcher } = await getWhitelistCache();
  const overrides = await getOverridesForArticle(explanationId);
  const matchedTerms = new Set<string>();

  // Single-pass matching with Aho-Corasick
  const contentLower = content.toLowerCase();
  const allMatches = matcher.search(contentLower);
  // Returns: [[endPosition, [matchedTerms]], ...]

  // Sort matches by position, then by term length (longest first for overlaps)
  const sortedMatches = allMatches
    .flatMap(([endPos, terms]) => terms.map(term => ({
      term,
      startIndex: endPos - term.length + 1,
      endIndex: endPos + 1
    })))
    .sort((a, b) => a.startIndex - b.startIndex || (b.endIndex - b.startIndex) - (a.endIndex - a.startIndex));

  for (const match of sortedMatches) {
    const termLower = match.term;

    // First occurrence only
    if (matchedTerms.has(termLower)) continue;

    // Check word boundaries (Aho-Corasick doesn't enforce them)
    if (!isWordBoundary(content, match.startIndex, match.endIndex)) continue;

    // Skip if overlaps with heading or already-matched term
    if (links.some(l => overlaps(l, match.startIndex, match.endIndex))) continue;

    const override = overrides.get(termLower);
    if (override?.override_type === 'disabled') {
      matchedTerms.add(termLower);
      continue;
    }

    links.push({
      term: content.slice(match.startIndex, match.endIndex), // Preserve original case
      startIndex: match.startIndex,
      endIndex: match.endIndex,
      standaloneTitle: override?.custom_standalone_title || whitelist.get(termLower)!.standalone_title,
      type: 'term'
    });
    matchedTerms.add(termLower);
  }

  return links.sort((a, b) => a.startIndex - b.startIndex);
}

/**
 * Resolve heading links with caching
 * - Check DB cache for existing standalone titles
 * - Generate via AI for uncached headings
 * - Store in article_heading_links table
 */
async function resolveHeadingLinks(explanationId: number, content: string): Promise<ResolvedLink[]> {
  const headingRegex = /^(#{2,3})\s+(.+)$/gm;
  const headings: { match: RegExpExecArray; text: string }[] = [];

  let match;
  while ((match = headingRegex.exec(content)) !== null) {
    headings.push({ match, text: match[2] });
  }

  if (headings.length === 0) return [];

  // Check cache for existing titles
  const cachedTitles = await getHeadingLinksForArticle(explanationId);
  const uncachedHeadings = headings.filter(h => !cachedTitles.has(h.text.toLowerCase()));

  // Generate titles for uncached headings via AI
  if (uncachedHeadings.length > 0) {
    const newTitles = await generateHeadingStandaloneTitles(
      uncachedHeadings.map(h => h.text),
      explanationId
    );
    // Store in DB cache
    await saveHeadingLinks(explanationId, newTitles);
    // Merge into cachedTitles
    for (const [heading, title] of Object.entries(newTitles)) {
      cachedTitles.set(heading.toLowerCase(), title);
    }
  }

  // Build resolved links
  return headings.map(h => ({
    term: h.match[0], // Full "## Heading" text
    startIndex: h.match.index,
    endIndex: h.match.index + h.match[0].length,
    standaloneTitle: cachedTitles.get(h.text.toLowerCase())!,
    type: 'heading' as const
  }));
}

/**
 * Apply resolved links to content for display
 * Returns markdown with links inserted
 */
export function applyLinksToContent(content: string, links: ResolvedLink[]): string {
  // Apply from end to start to preserve positions
  let result = content;
  for (const link of [...links].reverse()) {
    const before = result.slice(0, link.startIndex);
    const after = result.slice(link.endIndex);
    const encoded = encodeStandaloneTitleParam(link.standaloneTitle);
    result = `${before}[${link.term}](/standalone-title?t=${encoded})${after}`;
  }
  return result;
}
```

---

### Step 4: Per-Article Override Service
**New file:** `/src/lib/services/articleLinkOverrides.ts`

```typescript
// Get overrides for an article
getOverridesForArticle(explanationId: number): Promise<Map<string, ArticleLinkOverrideType>>

// Set custom title for a term in specific article
setCustomTitle(explanationId, term, customTitle): Promise<void>

// Disable a term for specific article
disableTerm(explanationId, term): Promise<void>

// Remove override (revert to global default)
removeOverride(explanationId, term): Promise<void>
```

---

### Step 5: Modify Content Display (not storage)
**File:** `/src/app/results/page.tsx` or relevant display component

```typescript
// When loading article for display:
const rawContent = explanation.content; // Plain text, no links
const links = await resolveLinksForArticle(explanation.id, rawContent);
const displayContent = applyLinksToContent(rawContent, links);
// Pass displayContent to LexicalEditor
```

**Remove from `/src/lib/services/links.ts`:**
- `createMappingsKeytermsToLinks()` - no longer needed for storage
- `createMappingsHeadingsToLinks()` - headings now use overlay system too
- Keep `encodeStandaloneTitleParam()` - used by link resolver

---

> **Step 6: Candidate Identification** - See [`link_candidate_generation_plan.md`](../link_candidate_generation/link_candidate_generation_plan.md)

---

### Step 6: Stop Inline Link Generation
**File:** `/src/lib/services/returnExplanation.ts`

In `postprocessNewExplanationContent()`, remove:
```typescript
// DELETE these calls:
const [headingMappings, keyTermMappings, ...] = await Promise.all([
    createMappingsHeadingsToLinks(rawContent, titleResult, userid),
    createMappingsKeytermsToLinks(rawContent, userid),
    ...
]);

// DELETE the mapping application loops:
for (const [original, linked] of Object.entries(headingMappings)) { ... }
for (const [original, linked] of Object.entries(keyTermMappings)) { ... }
```

Content is now stored as plain text. Links are applied at render time via the overlay system.

---

### Step 7: Server Actions
**File:** `/src/actions/actions.ts`

Add actions:
- `createWhitelistTermAction`
- `updateWhitelistTermAction`
- `deleteWhitelistTermAction`
- `getAllWhitelistTermsAction`
- `addAliasesAction`
- `removeAliasAction`
- `setArticleLinkOverrideAction`
- `removeArticleLinkOverrideAction`
- `getArticleLinkOverridesAction`

> Candidate actions defined in [`link_candidate_generation_plan.md`](../link_candidate_generation/link_candidate_generation_plan.md)

---

### Step 8: Admin UI
**New files:** `/src/app/admin/whitelist/`

```
/src/app/admin/whitelist/
├── page.tsx              # Main page with tabs
└── WhitelistTable.tsx    # CRUD for whitelist terms + aliases
```

> CandidatesTable defined in [`link_candidate_generation_plan.md`](../link_candidate_generation/link_candidate_generation_plan.md)

**Per-article UI** (in article editor):
- Show which terms will be linked
- Toggle to disable specific terms
- Option to set custom title per term

---

## Critical Files

| File | Change |
|------|--------|
| `/src/lib/db/schemas.ts` | Add 6 tables + triggers (whitelist, aliases, heading_links, overrides, meta, snapshot) |
| `/src/lib/schemas/schemas.ts` | Add Zod schemas |
| `/src/lib/services/linkWhitelist.ts` | NEW - Whitelist CRUD |
| `/src/lib/services/linkResolver.ts` | NEW - Core overlay logic |
| `/src/lib/services/articleLinkOverrides.ts` | NEW - Per-article overrides |
| `/src/lib/services/returnExplanation.ts` | REMOVE inline link generation calls |
| `/src/lib/services/links.ts` | REMOVE `createMappingsKeytermsToLinks` and `createMappingsHeadingsToLinks` |
| `/src/app/results/page.tsx` | Apply links at render time |
| `/src/actions/actions.ts` | Add ~9 new actions |
| `/src/app/admin/whitelist/*` | NEW - Admin UI |

> Candidate-related files defined in [`link_candidate_generation_plan.md`](../link_candidate_generation/link_candidate_generation_plan.md)

---

## Testing

1. **Unit tests** for linkResolver (term matching, overlap handling, override application, first-occurrence logic)
2. **Unit tests** for whitelist service (CRUD, alias resolution, caching)
3. **E2E tests** for admin UI (add/edit/delete whitelist terms)
4. **E2E tests** for article display (verify links render correctly)

> Candidate testing defined in [`link_candidate_generation_plan.md`](../link_candidate_generation/link_candidate_generation_plan.md)
