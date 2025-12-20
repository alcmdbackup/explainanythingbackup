# Link Whitelist System Implementation Plan

## Summary
Implement a **link overlay system** where links are stored separately from article content. Links are resolved at render time, keeping content clean for embeddings and enabling bulk link updates without editing articles.

---

## Requirements (from user)
- **Candidate identification**: AI suggestions + frequency analysis
- **Structure**: Flat list with aliases (synonyms → same canonical link)
- **Retroactive**: Batch job on demand
- **Separate link layer**: Links stored independently, not inline in content
- **Per-article overrides**: Global defaults with article-specific customization

---

## Architecture: Link Overlay System

### Key Principles
1. **Content is plain text** - No link markup stored in article content
2. **Links resolved at render time** - Whitelist + overrides applied when displaying
3. **Clean embeddings** - Raw text without URL noise
4. **Term-based matching** - Case-insensitive term matching in content

### Flow
```
[Article Content (plain text)]
         ↓ render time
[Apply Whitelist] → find whitelisted terms in text
         ↓
[Apply Overrides] → per-article customizations
         ↓
[Rendered with Links]
```

---

## Database Schema

### New Tables

```sql
-- Core whitelist (global defaults)
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

-- Candidate queue for review
CREATE TABLE link_candidates (
  id SERIAL PRIMARY KEY,
  term VARCHAR(255) NOT NULL UNIQUE,
  term_lower VARCHAR(255) NOT NULL UNIQUE,
  occurrence_count INTEGER DEFAULT 1,
  first_seen_explanation_id INTEGER REFERENCES explanations(id),
  suggested_standalone_title VARCHAR(500),
  status VARCHAR(50) DEFAULT 'pending',  -- pending/approved/rejected
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
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
- `ArticleLinkOverrideType`
- `LinkCandidateType`

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
}

/**
 * Resolve links for an article at render time
 * 1. Load whitelist map
 * 2. Load per-article overrides
 * 3. Scan content for whitelisted terms
 * 4. Apply overrides (custom titles or disable)
 * 5. Return link positions for rendering
 */
export async function resolveLinksForArticle(
  explanationId: number,
  content: string
): Promise<ResolvedLink[]> {
  const whitelist = await getActiveWhitelistAsMap();
  const overrides = await getOverridesForArticle(explanationId);

  const links: ResolvedLink[] = [];

  // Sort whitelist by term length (longest first) to match phrases before words
  const sortedTerms = [...whitelist.keys()].sort((a, b) => b.length - a.length);

  for (const termLower of sortedTerms) {
    // Find all occurrences (case-insensitive)
    const regex = new RegExp(`\\b${escapeRegex(termLower)}\\b`, 'gi');
    let match;

    while ((match = regex.exec(content)) !== null) {
      // Check if position already covered by longer match
      if (links.some(l => overlaps(l, match.index, match.index + match[0].length))) {
        continue;
      }

      const override = overrides.get(termLower);

      if (override?.override_type === 'disabled') {
        continue; // Skip this term for this article
      }

      links.push({
        term: match[0], // preserve original case
        startIndex: match.index,
        endIndex: match.index + match[0].length,
        standaloneTitle: override?.custom_standalone_title || whitelist.get(termLower)!.standalone_title
      });
    }
  }

  return links.sort((a, b) => a.startIndex - b.startIndex);
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
- Keep heading link logic if headings should still be stored as links

---

### Step 6: Candidate Identification Service
**New file:** `/src/lib/services/linkCandidates.ts`

```typescript
// Frequency Analysis
async function analyzeCorpusForCandidates(): Promise<void> {
  // 1. Get all published explanations
  // 2. Tokenize content, extract noun phrases / key terms
  // 3. Count frequency across articles
  // 4. Terms appearing 3+ times → add to candidates table
  // 5. Skip terms already whitelisted
}

// AI Suggestions
async function generateCandidateSuggestions(candidateIds: number[]): Promise<void>

// Approve/Reject
async function approveCandidate(id, reviewerId, overrideTitle?): Promise<LinkWhitelistFullType>
async function rejectCandidate(id, reviewerId): Promise<void>
```

---

### Step 7: Migration - Clean Existing Inline Links
**New file:** `/src/lib/services/linkMigration.ts`

One-time migration to convert existing articles:
```typescript
export async function migrateInlineLinksToOverlay(): Promise<{processed, updated}>
  // 1. Find articles with [term](/standalone-title?t=...) patterns
  // 2. Extract term + standalone_title from each link
  // 3. Add to whitelist if not exists
  // 4. Replace link with plain term in content
  // 5. Regenerate embeddings with clean content
}
```

---

### Step 8: Server Actions
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
- `getCandidatesAction`
- `approveCandidateAction`
- `rejectCandidateAction`
- `scanCorpusForCandidatesAction`

---

### Step 9: Admin UI
**New files:** `/src/app/admin/whitelist/`

```
/src/app/admin/whitelist/
├── page.tsx              # Main page with tabs
├── WhitelistTable.tsx    # CRUD for whitelist terms + aliases
├── CandidatesTable.tsx   # Review pending candidates
└── MigrationPanel.tsx    # One-time migration tool
```

**Per-article UI** (in article editor):
- Show which terms will be linked
- Toggle to disable specific terms
- Option to set custom title per term

---

## Critical Files

| File | Change |
|------|--------|
| `/src/lib/db/schemas.ts` | Add 4 new tables |
| `/src/lib/schemas/schemas.ts` | Add Zod schemas |
| `/src/lib/services/linkWhitelist.ts` | NEW - Whitelist CRUD |
| `/src/lib/services/linkResolver.ts` | NEW - Core overlay logic |
| `/src/lib/services/articleLinkOverrides.ts` | NEW - Per-article overrides |
| `/src/lib/services/linkCandidates.ts` | NEW - Candidate mgmt |
| `/src/lib/services/linkMigration.ts` | NEW - One-time migration |
| `/src/lib/services/links.ts` | REMOVE inline link generation |
| `/src/app/results/page.tsx` | Apply links at render time |
| `/src/actions/actions.ts` | Add ~13 new actions |
| `/src/app/admin/whitelist/*` | NEW - Admin UI |

---

## Testing

1. **Unit tests** for linkResolver (term matching, overlap handling, override application)
2. **Unit tests** for whitelist service (CRUD, alias resolution)
3. **Unit tests** for migration (inline link extraction, content cleaning)
4. **E2E tests** for admin UI (add term, approve candidate)
5. **E2E tests** for article display (verify links render correctly)
