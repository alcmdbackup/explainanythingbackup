# Source Citations - Research

## 1. Problem Statement
Users want clickable inline citations in articles and fact-specific citations for key claims. Investigation revealed two issues:
1. Clickable citations exist in code but don't work when viewing existing articles
2. Citation prompt produces sentence-level citations, not claim-level

## 2. High Level Summary
The codebase has a **complete source citation system** but with a critical bug: sources stored during generation are never loaded when viewing existing articles.

**Key Findings:**
- `CitationPlugin.tsx` implements clickable `[n]` citations with hover tooltips and scroll-to-bibliography
- `Bibliography.tsx` renders numbered sources with `id="source-{n}"` anchors
- **Bug:** `sources` state in `page.tsx` starts empty and is only populated from `sessionStorage` (for new articles), never from database
- Prompt in `prompts.ts:287-288` uses clause-level citation instructions

## 3. Documents Read
- `/docs/docs_overall/getting_started.md`
- `/docs/docs_overall/architecture.md`
- `/docs/docs_overall/product_overview.md`

## 4. Code Files Read

### Source Storage (Working)
| File | Purpose |
|------|---------|
| `supabase/migrations/20251222000000_create_source_tables.sql` | `source_cache` and `article_sources` tables |
| `src/lib/services/sourceCache.ts:298` | `getSourcesByExplanationId()` - fetches linked sources |
| `src/lib/services/sourceFetcher.ts` | URL content extraction with Mozilla Readability |

### Source Injection (Working)
| File | Purpose |
|------|---------|
| `src/lib/prompts.ts:253-294` | `createExplanationWithSourcesPrompt()` |
| `src/lib/services/returnExplanation.ts:570-587` | Converts sources to prompt format |
| `src/app/api/returnExplanation/route.ts:93-118` | API endpoint resolving URLs |

### Citation Display (Implemented but Broken)
| File | Line | Issue |
|------|------|-------|
| `src/app/results/page.tsx` | 55 | `sources` state starts empty |
| `src/app/results/page.tsx` | 750 | Only loads from `sessionStorage`, not database |
| `src/editorFiles/lexicalEditor/CitationPlugin.tsx` | 64-178 | Works but receives empty sources |
| `src/components/sources/Bibliography.tsx` | full | Works but receives empty sources |

### Hook Pattern (Reference)
| File | Purpose |
|------|---------|
| `src/hooks/useExplanationLoader.ts:29-59` | Has `onTagsLoad`, `onMatchesLoad` callbacks |

## 5. Root Cause Analysis

### Issue 1: Clickable Citations Not Working
**Root Cause:** Data flow broken when viewing existing articles.

```
Generation flow (works):
  sources → linkSourcesToExplanation() → article_sources table ✓

Viewing flow (broken):
  article_sources table → ??? → sources state EMPTY ✗
```

Evidence:
- `page.tsx:55`: `const [sources, setSources] = useState<SourceChipType[]>([])`
- `page.tsx:750`: Only populates from `sessionStorage.getItem('pendingSources')`
- `getSourcesByExplanationId()` exists but is never called when loading explanation

### Issue 2: Clause-Level vs Claim-Level Citations
**Root Cause:** Prompt instructs clause-level citation.

Current prompt (`prompts.ts:287-288`):
```
- IMPORTANT: Cite sources inline using [n] notation where n is the source number
- Place citations at the end of sentences or clauses that use information from that source
```

Produces: `Einstein developed relativity in 1905, revolutionizing physics. [1]`

User wants (key claims): `Einstein developed **relativity** [2] in **1905** [1], revolutionizing physics.`

## 6. Type Definitions

### SourceChipType (UI display)
```typescript
export const sourceChipSchema = z.object({
  url: z.string().url(),
  title: z.string().nullable(),
  favicon_url: z.string().nullable(),
  domain: z.string(),
  status: z.enum(['loading', 'success', 'failed']),
  error_message: z.string().nullable(),
});
```

### SourceCacheFullType (Database)
```typescript
export const sourceCacheFullSchema = z.object({
  id: z.number(),
  url: z.string(),
  title: z.string().nullable(),
  favicon_url: z.string().nullable(),
  domain: z.string(),
  extracted_text: z.string().nullable(),
  is_summarized: z.boolean(),
  fetch_status: z.enum(['pending', 'success', 'failed']),
  error_message: z.string().nullable(),
  // ... other fields
});
```

**Conversion needed:** `SourceCacheFullType` → `SourceChipType` when loading from DB
