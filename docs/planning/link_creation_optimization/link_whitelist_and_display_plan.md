# Link Whitelist System Implementation Plan

## Summary
Implement a **link overlay system** where links are stored separately from article content. Links are resolved at render time, keeping content clean for embeddings and enabling bulk link updates without editing articles.

**Execution Tracking**: [`link_whitelist_and_display_progress.md`](./link_whitelist_and_display_progress.md)

### Design Choices
- **Caching**: Vercel KV (edge caching, ~5ms latency)
- **Matching**: Aho-Corasick algorithm (100+ terms expected)
- **Lexical Diff Overlay**: Deferred (focus on core system first)

---

## Requirements (from user)
- **Structure**: Flat list with aliases (synonyms → same canonical link)
- **Separate link layer**: Links stored independently, not inline in content
- **Per-article overrides**: Global defaults with article-specific customization

> **Candidate Generation**: For AI suggestions, frequency analysis, and auto-approval pipeline, see:
> [`/docs/planning/link_candidate_generation/link_candidate_generation_plan.md`](../link_candidate_generation/link_candidate_generation_plan.md)

---

## Scope Clarification

This plan covers **heading links only**:
- Headings are always auto-linked with AI-generated standalone titles
- Standalone titles are **pre-generated during explanation creation** (not render time)
- Stored in `article_heading_links` table

**Term/keyword links are handled separately** in:
[`/docs/planning/link_candidate_generation/link_candidate_generation_plan.md`](../link_candidate_generation/link_candidate_generation_plan.md)

---

## Architecture: Link Overlay System

### Key Decisions
- **Headings**: Always auto-linked with AI-generated standalone titles
  - Titles generated at **creation time** in `postprocessNewExplanationContent`
  - Stored immediately in `article_heading_links` table
  - Render time just fetches from DB (no AI calls)
- **Key terms**: Only linked if in whitelist (pure whitelist matching) - see candidate generation plan
- **In-memory cache** with 5 min TTL for whitelist lookups
- **First occurrence only** per article for key terms (Wikipedia-style linking)

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

#### Whitelist Cache: Vercel KV

> Alternative caching options (Supabase-only, Edge Config, ISR) are documented in [Appendix A](#appendix-a-alternative-caching-options).

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

  // Get current version from DB snapshot
  const snapshot = await db.select().from(linkWhitelistSnapshot).limit(1);
  const currentVersion = snapshot[0]?.version ?? 0;

  if (cached && cached.version === currentVersion) {
    return cached;
  }

  // Cache miss or stale - use snapshot data directly
  if (snapshot[0]) {
    const fresh: WhitelistCache = {
      version: snapshot[0].version,
      data: snapshot[0].data,
      terms: Object.keys(snapshot[0].data)
    };
    await kv.set(KV_KEY, fresh, { ex: KV_TTL_SECONDS });
    return fresh;
  }

  // No snapshot exists - rebuild
  return rebuildSnapshot();
}

// Build Aho-Corasick matcher from cache (in-memory, per-invocation)
function buildMatcher(cache: WhitelistCache): AhoCorasick {
  return new AhoCorasick(cache.terms);
}
```

**Setup**: `npm i @vercel/kv` + configure in Vercel dashboard

---

#### Heading Link Cache (DB-based)

```
article_heading_links table stores AI-generated titles per article
- Permanent cache until article content changes
- Invalidate: DELETE FROM article_heading_links WHERE explanation_id = ?
```

#### Heading Cache Invalidation

**Trigger**: On article content update in `updateExplanationAndTopic`

**Implementation** (add to `/src/actions/actions.ts`):

```typescript
// In updateExplanationAndTopic, BEFORE the update:
const oldExplanation = await getExplanationById(explanationId);

// After update, if content changed:
if (updates.content) {
  const oldHeadings = extractHeadings(oldExplanation.content);
  const newHeadings = extractHeadings(updates.content);

  if (!headingsMatch(oldHeadings, newHeadings)) {
    await db.delete(articleHeadingLinks)
      .where(eq(articleHeadingLinks.explanation_id, explanationId));
  }
}
```

**Helper function** (add to `/src/lib/services/linkResolver.ts`):

```typescript
export function extractHeadings(content: string): string[] {
  const regex = /^#{2,3}\s+(.+)$/gm;
  const headings: string[] = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    headings.push(match[1].toLowerCase());
  }
  return headings;
}

export function headingsMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((h, i) => h === b[i]);
}
```

**Cost**: One extra DB query per save (fetch old content). Negligible since saves already trigger embedding regeneration.

---

### Flow

```
=== CREATION TIME ===
[Generate Explanation]
         ↓
[postprocessNewExplanationContent]
         ├─ generateHeadingStandaloneTitles() → AI call
         ├─ evaluateTags()
         └─ REMOVE: createMappingsKeytermsToLinks (see candidate generation plan)
         ↓
[Save PLAIN content to DB] → no embedded links
         ↓
[saveHeadingLinks()] → store titles in article_heading_links table

=== RENDER TIME ===
[Fetch article_heading_links from DB] → no AI calls
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

-- Snapshot for fast single-query fetch (includes version for cache invalidation)
CREATE TABLE link_whitelist_snapshot (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- Single row
  version INTEGER NOT NULL,
  data JSONB NOT NULL,  -- {term_lower: {canonical_term, standalone_title}, ...}
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- NOTE: No DB triggers for version bumping - handled atomically in application code
-- via rebuildSnapshot() to avoid race conditions between version bump and data rebuild
```

---

## Implementation Steps

### Step 1: Database & Schemas
**Files to create/modify:**
- `supabase/migrations/YYYYMMDDHHMMSS_link_whitelist_system.sql` - SQL migration for new tables
- `/src/lib/schemas/schemas.ts` - Add Zod validation schemas

> **Note**: This codebase uses Supabase client directly (not Drizzle ORM). Database tables are defined via SQL migrations.

**New types:**
- `LinkWhitelistInsertType`, `LinkWhitelistFullType`
- `LinkAliasInsertType`, `LinkAliasFullType`
- `ArticleHeadingLinkInsertType`, `ArticleHeadingLinkFullType` (cached AI-generated heading titles)
- `ArticleLinkOverrideInsertType`, `ArticleLinkOverrideFullType`
- `LinkWhitelistSnapshotType`, `WhitelistCacheEntryType`
- `ResolvedLinkType`
- `LinkOverrideType` enum

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
 * Check if match is at word boundaries
 * Boundaries: whitespace, punctuation (except hyphen), start/end of string
 * Hyphens are NOT boundaries to avoid matching inside compound terms
 */
function isWordBoundary(content: string, startIndex: number, endIndex: number): boolean {
  // Boundary chars: whitespace and punctuation EXCEPT hyphen
  const isBoundary = (char: string) => /[\s.,;:!?()\[\]{}'\"<>\/]/.test(char);

  const beforeOk = startIndex === 0 || isBoundary(content[startIndex - 1]);
  const afterOk = endIndex >= content.length || isBoundary(content[endIndex]);

  return beforeOk && afterOk;
}

function overlaps(link: ResolvedLink, start: number, end: number): boolean {
  return !(end <= link.startIndex || start >= link.endIndex);
}

/**
 * Resolve links for an article at render time
 * 1. Process HEADINGS first: Always linked, AI-generated titles (cached in DB)
 * 2. Process KEY TERMS: Only if in whitelist, excluding heading regions
 * 3. First occurrence only per key term
 * 4. Apply overrides
 */
export async function resolveLinksForArticle(
  explanationId: number,
  content: string
): Promise<ResolvedLink[]> {
  const links: ResolvedLink[] = [];

  // === STEP 1: HEADINGS (always linked, processed first) ===
  const headingLinks = await resolveHeadingLinks(explanationId, content);
  links.push(...headingLinks);

  // Build exclusion zones from heading positions to prevent double-linking
  const headingRanges = headingLinks.map(h => ({ start: h.startIndex, end: h.endIndex }));

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

    // Skip if inside a heading region (prevents double-linking)
    if (headingRanges.some(r => match.startIndex >= r.start && match.endIndex <= r.end)) {
      continue;
    }

    // Check word boundaries (Aho-Corasick doesn't enforce them)
    if (!isWordBoundary(content, match.startIndex, match.endIndex)) continue;

    // Skip if overlaps with already-matched term
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
 * Resolve heading links - NO AI calls at render time
 * Titles are pre-generated at creation time and stored in article_heading_links
 */
async function resolveHeadingLinks(explanationId: number, content: string): Promise<ResolvedLink[]> {
  const headingRegex = /^(#{2,3})\s+(.+)$/gm;
  const headings: { match: RegExpExecArray; text: string }[] = [];

  let match;
  while ((match = headingRegex.exec(content)) !== null) {
    headings.push({ match, text: match[2] });
  }

  if (headings.length === 0) return [];

  // Fetch ALL cached titles from DB (created at explanation creation time)
  const cachedTitles = await getHeadingLinksForArticle(explanationId);

  // Build resolved links - titles should always exist (created at save time)
  return headings.map(h => ({
    term: h.match[0],
    startIndex: h.match.index,
    endIndex: h.match.index + h.match[0].length,
    standaloneTitle: cachedTitles.get(h.text.toLowerCase()) ?? h.text, // fallback to raw heading
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

### Step 5.5: Lexical-Level Link Overlay (for Diff/Edit Context)

> **⚠️ DEFERRED**: This step is implemented LAST, after all other steps are complete and tested.
> Focus on the core markdown-level overlay system first (Steps 1-8).

When content contains CriticMarkup diff annotations (from AI suggestions), links must be applied **after** Lexical import so they don't appear as part of the diff.

#### When to Use Which Approach

| Context | Overlay Method | Reason |
|---------|---------------|--------|
| **Normal display** (read-only) | Markdown-level (`applyLinksToContent`) | Simpler, content has no diffs |
| **AI suggestions editing** (has DiffTagNode) | Lexical-level (`applyLinkOverlayToEditor`) | Links shouldn't be "diffed" |
| **Regular editing** (no diffs) | Either works | Lexical-level more flexible |

#### Flow: AI Suggestions with Links

```
=== AI SUGGESTIONS FLOW ===
[Original content] → [AI generates edits]
         ↓
[CriticMarkup: {++inserted++} {--deleted--}]
         ↓
[$convertFromMarkdownString()] → Lexical tree with DiffTagNode
         ↓
[applyLinkOverlayToEditor()] → wrap terms in LinkNode INSIDE DiffTagNode
         ↓
[Editor displays: links are clickable, diffs are highlighted, links NOT part of diff]
```

#### Implementation: Lexical-Level Overlay

**New file:** `/src/editorFiles/lexicalEditor/LinkOverlayPlugin.tsx`

```typescript
import { $dfs } from '@lexical/utils';
import { $getRoot, $isTextNode, $createTextNode, TextNode, LexicalEditor } from 'lexical';
import { $createStandaloneTitleLinkNode, $isStandaloneTitleLinkNode } from './StandaloneTitleLinkNode';
import type { WhitelistCache } from '@/lib/services/linkResolver';

/**
 * Apply link overlay to Lexical editor state
 * - Traverses all text nodes (including inside DiffTagNode)
 * - Wraps matching whitelist terms in StandaloneTitleLinkNode
 * - First occurrence only per term
 * - Skips text already inside LinkNode
 */
export function applyLinkOverlayToEditor(
  editor: LexicalEditor,
  whitelist: Map<string, { canonical_term: string; standalone_title: string }>
): void {
  editor.update(() => {
    const root = $getRoot();
    const matchedTerms = new Set<string>();

    // Traverse all nodes depth-first
    const nodes = $dfs(root);

    for (const { node } of nodes) {
      if (!$isTextNode(node)) continue;

      // Skip if already inside a link (avoid double-linking)
      const parent = node.getParent();
      if (parent && $isStandaloneTitleLinkNode(parent)) continue;

      const textContent = node.getTextContent();
      const textLower = textContent.toLowerCase();

      // Check each whitelist term (sorted by length desc for longest match first)
      const sortedTerms = [...whitelist.entries()]
        .sort((a, b) => b[0].length - a[0].length);

      for (const [termLower, entry] of sortedTerms) {
        if (matchedTerms.has(termLower)) continue;

        const matchIndex = textLower.indexOf(termLower);
        if (matchIndex === -1) continue;

        if (!isWordBoundary(textContent, matchIndex, matchIndex + termLower.length)) continue;

        // Found match - split and wrap
        wrapTextInLink(node, matchIndex, termLower.length, entry.standalone_title);
        matchedTerms.add(termLower);
        break; // One match per text node per pass
      }
    }
  });
}

function wrapTextInLink(
  textNode: TextNode,
  matchIndex: number,
  matchLength: number,
  standaloneTitle: string
): void {
  const textContent = textNode.getTextContent();
  const matchedText = textContent.substring(matchIndex, matchIndex + matchLength);
  const beforeText = textContent.substring(0, matchIndex);
  const afterText = textContent.substring(matchIndex + matchLength);

  // Create link node
  const encodedTitle = encodeURIComponent(standaloneTitle);
  const url = `/standalone-title?t=${encodedTitle}`;
  const linkNode = $createStandaloneTitleLinkNode(url);
  linkNode.append($createTextNode(matchedText));

  // Critical order: insertBefore → insertAfter → replace
  if (beforeText) textNode.insertBefore($createTextNode(beforeText));
  if (afterText) textNode.insertAfter($createTextNode(afterText));
  textNode.replace(linkNode);
}

function isWordBoundary(content: string, start: number, end: number): boolean {
  const isBoundary = (char: string) => /[\s.,;:!?()\[\]{}'\"<>\/]/.test(char);
  const beforeOk = start === 0 || isBoundary(content[start - 1]);
  const afterOk = end >= content.length || isBoundary(content[end]);
  return beforeOk && afterOk;
}
```

#### Integration with AI Suggestions Pipeline

**File:** `/src/editorFiles/aiSuggestion.ts` (in `runAISuggestionsPipeline`)

After CriticMarkup is generated and before returning to editor:

```typescript
// After Step 4 (preprocessCriticMarkup):
const preprocessed = preprocessCriticMarkup(criticMarkup);

// Step 5: Apply link overlay (if whitelist available)
// Note: This happens in the editor component after import, not here
// Return the preprocessed content; overlay applied in LexicalEditorComponent

return {
  content: preprocessed,
  session_id: sessionData?.session_id
};
```

**File:** `/src/editorFiles/lexicalEditor/LexicalEditorComponent.tsx`

After importing content with CriticMarkup:

```typescript
import { applyLinkOverlayToEditor } from './LinkOverlayPlugin';
import { getWhitelistCache } from '@/lib/services/linkResolver';

// After $convertFromMarkdownString():
editor.update(async () => {
  // ... existing import logic ...

  // Apply link overlay if content has diff tags
  if (hasDiffContent) {
    const cache = await getWhitelistCache();
    applyLinkOverlayToEditor(editor, cache.data);
  }
});
```

#### Shared Logic with Markdown-Level Overlay

Both approaches share:
- Whitelist cache (`getWhitelistCache()`)
- Word boundary checking (`isWordBoundary()`)
- First-occurrence tracking
- Standalone title encoding

Only the final application differs:
- Markdown: String manipulation with `applyLinksToContent()`
- Lexical: Node manipulation with `applyLinkOverlayToEditor()`

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

### Step 6.5: Generate Heading Links at Creation Time
**File:** `/src/lib/services/returnExplanation.ts`

Replace `createMappingsHeadingsToLinks` with heading title generation (no embedding):

```typescript
// In postprocessNewExplanationContent:
const [headingTitles, tagEvaluation] = await Promise.all([
  generateHeadingStandaloneTitles(rawContent, titleResult, userid),
  evaluateTags(titleResult, rawContent, userid)
]);

// Don't embed links - keep content plain
const enhancedContent = cleanupAfterEnhancements(rawContent);

return {
  enhancedContent,
  tagEvaluation,
  headingTitles, // NEW: pass through for later storage
  error: null
};
```

**File:** `/src/actions/actions.ts` (in `saveExplanationAndTopic`)

After saving explanation, store heading links:

```typescript
const savedExplanation = await saveExplanation(explanationData);

// Store heading links in DB
if (headingTitles && Object.keys(headingTitles).length > 0) {
  await saveHeadingLinks(savedExplanation.id, headingTitles);
}
```

**Key benefit**: AI call happens once at creation (same timing as before), but result goes to DB instead of being embedded in content. Render time has zero AI calls.

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
| `supabase/migrations/YYYYMMDDHHMMSS_link_whitelist_system.sql` | SQL migration for 5 tables (whitelist, aliases, heading_links, overrides, snapshot) |
| `/src/lib/schemas/schemas.ts` | Add Zod schemas + types |
| `/src/lib/services/linkWhitelist.ts` | NEW - Whitelist CRUD |
| `/src/lib/services/linkResolver.ts` | NEW - Core overlay logic (markdown-level) |
| `/src/lib/services/articleLinkOverrides.ts` | NEW - Per-article overrides |
| `/src/editorFiles/lexicalEditor/LinkOverlayPlugin.tsx` | NEW - Lexical-level overlay for diff context **(DEFERRED - implement last)** |
| `/src/editorFiles/lexicalEditor/LexicalEditorComponent.tsx` | Call `applyLinkOverlayToEditor` after diff import **(DEFERRED - implement last)** |
| `/src/lib/services/returnExplanation.ts` | REMOVE inline link generation calls |
| `/src/lib/services/links.ts` | REMOVE `createMappingsKeytermsToLinks` and `createMappingsHeadingsToLinks` |
| `/src/app/results/page.tsx` | Apply links at render time (markdown-level) |
| `/src/actions/actions.ts` | Add ~9 new actions + heading cache invalidation in `updateExplanationAndTopic` |
| `/src/app/admin/whitelist/*` | NEW - Admin UI |

> Candidate-related files defined in [`link_candidate_generation_plan.md`](../link_candidate_generation/link_candidate_generation_plan.md)

---

## Testing

### Core System (implement first)
1. **Unit tests** for linkResolver (term matching, overlap handling, override application, first-occurrence logic)
2. **Unit tests** for whitelist service (CRUD, alias resolution, caching)
3. **E2E tests** for admin UI (add/edit/delete whitelist terms)
4. **E2E tests** for article display (verify links render correctly)

### Lexical Diff Overlay (DEFERRED - implement last)
5. **Unit tests** for LinkOverlayPlugin:
   - `wrapTextInLink` with match at start/middle/end of text node
   - Skipping text inside existing LinkNode
   - First-occurrence tracking across multiple text nodes
   - Links inside DiffTagNode (ins/del/update) render correctly
6. **Integration tests** for AI suggestions + links:
   - Import CriticMarkup → apply overlay → verify LinkNode inside DiffTagNode
   - Accept/reject diff → verify links remain/are removed correctly
   - Export back to markdown → verify links preserved in CriticMarkup

> Candidate testing defined in [`link_candidate_generation_plan.md`](../link_candidate_generation/link_candidate_generation_plan.md)

---

## Implementation Order

### Core System (Steps 1-8)
1. **Step 1**: Database (migration + Zod schemas)
2. **Step 2**: Whitelist service (`linkWhitelist.ts`)
3. **Step 3**: Link resolver service (`linkResolver.ts`)
4. **Step 4**: Override service (`articleLinkOverrides.ts`)
5. **Step 6.5**: Generate heading links at creation time (before removing old code)
6. **Step 5**: Content display modifications (`results/page.tsx`)
7. **Step 6**: Stop inline link generation (`returnExplanation.ts`)
8. **Step 7**: Server actions (`actions.ts`)
9. **Step 8**: Admin UI (`/admin/whitelist/*`)
10. Clean up old code in `links.ts`

### Deferred (Step 5.5 - implement last)
11. Lexical-level link overlay (`LinkOverlayPlugin.tsx`)
12. Integration with AI suggestions pipeline (`LexicalEditorComponent.tsx`)

**Note**: Keep old link generation working until new system is verified.

---

## Appendix A: Alternative Caching Options

| Option | Latency (cold) | Latency (warm) | Extra Cost | Complexity |
|--------|---------------|----------------|------------|------------|
| **Vercel KV** ⭐ | ~5ms | ~5ms | Low | Low |
| **Supabase-only** | ~80ms | ~80ms | None | Lowest |
| **Edge Config** | ~1ms | ~1ms | None | Medium |
| **ISR Static** | ~1ms | ~1ms | None | Medium |

### Option: Supabase-Only (No External Cache)

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

// Called explicitly after whitelist CRUD operations (atomic transaction)
async function rebuildSnapshot(): Promise<WhitelistCache> {
  return await db.transaction(async (tx) => {
    // Get current version, increment atomically
    const current = await tx.select().from(linkWhitelistSnapshot).limit(1);
    const newVersion = (current[0]?.version ?? 0) + 1;

    // Build fresh data within same transaction
    const data = await getActiveWhitelistAsMap(tx);

    // Upsert with new version - atomic with data rebuild
    await tx.insert(linkWhitelistSnapshot)
      .values({ id: 1, version: newVersion, data: Object.fromEntries(data), updated_at: new Date() })
      .onConflictDoUpdate({
        target: linkWhitelistSnapshot.id,
        set: { version: newVersion, data: Object.fromEntries(data), updated_at: new Date() }
      });

    return { version: newVersion, data: Object.fromEntries(data), terms: [...data.keys()] };
  });
}
```

**Pro**: No extra services. **Con**: ~80ms per cold start.

---

### Option: Edge Config (Ultra-fast, small data)

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

### Option: ISR + Static JSON (Build-time)

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

### Migration Path

1. **Start with**: Supabase-only - simplest, no extra services
2. **Upgrade to**: Vercel KV if cold start latency becomes an issue
