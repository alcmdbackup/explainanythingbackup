# Link Whitelist System

## Overview

The link whitelist system automatically links key terms and headings to related explanations. It uses a 6-table architecture with caching, aliases, and per-article overrides.

## Demo-mode bypass (LINKS_BYPASS_WHITELIST)

Setting `LINKS_BYPASS_WHITELIST=true` in env makes `resolveLinksForArticleImpl()` merge ALL `link_candidates` rows into the whitelist at render. Lets AI-suggested terms link inline without admin approval. Implemented for the public-demo launch; whitelist + candidate approval admin code remains intact for re-enable.

- Affects ONLY the display path (`_resolveLinksForDisplayAction`). The editor overlay (`_getLinkDataForLexicalOverlayAction`) is independent and not changed.
- Module-scope 5-minute TTL cache (`bypassMergedCache` in `linkResolver.ts`) avoids per-render DB hits.
- Whitelist entries take precedence on term-key collision.
- Bypass uses the term itself as `standalone_title` (since `link_candidates` has no `standalone_title` column — that column is in `link_whitelist` only, populated at admin-approval time). Click routes to `/standalone-title?t=<encoded-term>` which triggers a search-or-generate on the term.
- Re-enable strict whitelist: flip back to `LINKS_BYPASS_WHITELIST=false` (or unset). No code change needed.
- Test helper: `__resetBypassCacheForTests()` exported from `linkResolver.ts` for use in unit tests.

## Implementation

### Key Files
- `src/lib/services/linkWhitelist.ts` - Whitelist management
- `src/lib/services/linkResolver.ts` - Link resolution at render
- `src/lib/services/linkCandidates.ts` - Candidate approval workflow
- `src/lib/services/links.ts` - URL encoding & AI generation

### Database Tables

| Table | Purpose |
|-------|---------|
| `link_whitelist` | Canonical terms with URLs |
| `link_whitelist_aliases` | Alternative names for terms |
| `link_whitelist_snapshot` | JSON cache of active whitelist |
| `article_heading_links` | Per-article heading mappings |
| `article_link_overrides` | Per-article customizations |
| `link_candidates` | Pending terms for approval |

### Resolution Algorithm

1. **Headings First**: Pre-cached titles from `article_heading_links`
2. **Key Terms**: Matched from whitelist snapshot (longest-first)
3. **First Occurrence Only**: Each term linked once per article
4. **Exclusion Zones**: Heading regions excluded from term matching
5. **Word Boundaries**: Custom checking (preserves hyphens)
6. **Overlap Prevention**: No overlapping links

### Caching Strategy

- Single-row snapshot table (`id=1`) with version tracking
- Rebuilt on any whitelist mutation
- Combines active terms + resolved aliases at build time
- Case-insensitive matching via `_lower` columns

### Override Types

| Type | Behavior |
|------|----------|
| `disabled` | Term skipped entirely |
| `custom_title` | Uses custom standalone title |
| (none) | Uses whitelist default |

## Usage

### Resolving Links for Display

```typescript
import { resolveLinksForArticle } from '@/lib/services/linkResolver';

const links = await resolveLinksForArticle(
  explanationId,
  content
);

// Returns: ResolvedLinkType[]
// { term, startIndex, endIndex, standaloneTitle, type: 'heading'|'term' }
```

### Applying Links to Content

```typescript
import { applyLinksToContent } from '@/lib/services/linkResolver';

const enhancedContent = applyLinksToContent(content, links);
// Injects markdown links: [term](/standalone-title?t=encoded+title)
```

### Managing Whitelist Terms

```typescript
import {
  createWhitelistTerm,
  addAliases,
  getActiveWhitelistAsMap
} from '@/lib/services/linkWhitelist';

// Create term
await createWhitelistTerm({
  canonical_term: 'Machine Learning',
  standalone_title: 'Introduction to Machine Learning'
});

// Add aliases
await addAliases(termId, ['ML', 'machine-learning']);

// Get cached whitelist
const whitelist = await getActiveWhitelistAsMap();
```

### Candidate Workflow

```typescript
import {
  saveCandidatesFromLLM,
  approveCandidate,
  rejectCandidate
} from '@/lib/services/linkCandidates';

// AI extracts candidates during generation
await saveCandidatesFromLLM(candidates, explanationId, userid);

// Admin approves (creates whitelist entry)
await approveCandidate(candidateId, standaloneTitle);

// Or rejects
await rejectCandidate(candidateId);
```

### Saving Heading Links

```typescript
import {
  generateHeadingStandaloneTitles,
  saveHeadingLinks
} from '@/lib/services/linkWhitelist';

// AI generates standalone titles for h2/h3 headings
const headingTitles = await generateHeadingStandaloneTitles(content, userid);

// Save to cache
await saveHeadingLinks(explanationId, headingTitles);
```
