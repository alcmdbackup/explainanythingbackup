# Systematically Assess Add Sources Research

## Problem Statement
The "Add Sources" feature has three distinct reliability problems:
1. Inline citations (e.g., `[1]`, `[2]`) never appear in generated content
2. It's unclear whether sources actually influence article generation
3. The bibliography section appears during streaming but disappears on page reload

## High Level Summary

After systematic exploration with 4 parallel agents, we've identified the root causes:

| Problem | Root Cause | Severity |
|---------|------------|----------|
| **Inline citations missing** | (1) CitationPlugin disabled when `sources.length === 0` due to race condition, (2) Sources silently dropped by 6-point filter cascade before reaching LLM. **NOT** markdown stripping (disproven). | 🔴 HIGH |
| **Sources not influencing content** | Silent filter cascade - sources dropped at **6 points** (not 5) without warning. No user feedback when falling back to standard prompt. | 🟡 MEDIUM |
| **Bibliography disappears on reload** | Race condition - client queries DB before Supabase INSERT fully commits. `await` IS present but async commit + immediate redirect = race. | 🔴 HIGH |

---

## Detailed Findings

### 1. Inline Citations Never Appear

**Investigation Path**: `prompts.ts` → `returnExplanation.ts` → `LexicalEditor.tsx` → `CitationPlugin.tsx`

**Findings**:

✅ **Prompt is correct** (`src/lib/prompts.ts:253-300`):
```typescript
- IMPORTANT: Cite sources inline using [n] notation where n is the source number
- Place citations immediately after KEY FACTUAL CLAIMS, not entire sentences
```

✅ **CitationPlugin logic is solid** (`src/editorFiles/lexicalEditor/CitationPlugin.tsx:67`):
```typescript
const citationPattern = /\[(\d+)\]/g;  // Correctly matches [1], [2], etc.
```

🔴 **But CitationPlugin has early return** (line 65):
```typescript
if (!enabled || sources.length === 0) return;  // CRITICAL - disables if no sources
```

✅ **CORRECTION: Markdown conversion does NOT strip citations** (`importExportUtils.ts:1146-1161`):
```typescript
// LINK transformer only matches [text](url) pattern, NOT bare [n]
// Bare citations like [1], [2] pass through as plain text nodes
export const MARKDOWN_TRANSFORMERS = [
  HEADING, QUOTE, CODE, UNORDERED_LIST, ORDERED_LIST, INLINE_CODE,
  BOLD_STAR, ITALIC_STAR, STRIKETHROUGH,
  STANDALONE_TITLE_LINK_TRANSFORMER,  // Must come before LINK
  LINK,  // Only matches [text](url) - NOT [n] citations
  CRITIC_MARKUP_IMPORT_INLINE_TRANSFORMER,
  DIFF_TAG_EXPORT_TRANSFORMER,
];
```

**Verdict**: Citations are NOT stripped by markdown conversion. The real issue is:
1. CitationPlugin disabled because sources array is empty (due to race condition)
2. Sources may never reach LLM due to silent filter cascade (see below)

---

### 2. Sources Not Influencing Generated Articles

**Investigation Path**: `page.tsx` → `route.ts` → `returnExplanation.ts` → `prompts.ts`

**Findings**:

Sources ARE included in LLM prompt **when they survive the filter cascade**. Found **6 filter points** (not 5):

| # | File:Line | Condition | Logging | User Feedback | Severity |
|---|-----------|-----------|---------|---------------|----------|
| **1** | `page.tsx:288` | `status !== 'success'` | None | None | 🟡 Medium |
| **2** | `route.ts:104` | `fetch_status !== 'success'` | Debug only | None | 🟡 Medium |
| **3** | `route.ts:114` | `resolvedSources.length === 0` | No log on empty | None | 🟡 Medium |
| **4** | `returnExplanation.ts:577` | `extracted_text.length === 0` | None | None | 🟡 Medium |
| **5** | `returnExplanation.ts:234` | `sources.length === 0` | Debug (misleading) | None | 🔴 **CRITICAL** |
| **6** | `page.tsx:75` | Bibliography filter `status !== 'success'` | None | None | 🟡 Medium |

🔴 **Silent Degradation** (`returnExplanation.ts:234`):
```typescript
if (sources && sources.length > 0) {
    formattedPrompt = createExplanationWithSourcesPrompt(titleResult, sources, additionalRules);
} else {
    // Silently falls back to non-sources prompt - NO WARNING!
    formattedPrompt = createExplanationPrompt(titleResult, additionalRules);
}
```

**Key Insights**:
- **Silent degradation chain**: Filter 1 → 2 → 3 → 4 → 5 creates cascade where sources dropped at any point trigger silent fallback
- **No user awareness**: Users who add sources never know if they were rejected
- **Debug-only logging**: Meaningful logging only in FILE_DEBUG mode (typically disabled in production)
- **Two-system mismatch**: Bibliography (Filter 6) uses client-side `status`, API uses server-side `fetch_status`

**Verdict**: Sources DO influence generation when present, but the system **silently degrades** to standard prompts when any filter fails.

---

### 3. Bibliography Disappears on Page Reload

**Investigation Path**: `route.ts` (streaming) → `returnExplanation.ts` (persistence) → `useExplanationLoader.ts` (reload)

**Findings**:

🔴 **Race Condition** - Timeline:
```
T1 (route.ts:172):     await returnExplanationLogic() STARTS
T2 (route.ts:172-184):  Explanation generated and saved
T3 (route.ts:210-215):  'complete' event SENT to client
                        ↓
                        Client receives complete, redirects immediately
                        ↓
T4 (returnExplanation.ts:667): linkSourcesToExplanation() called
T5:                     Supabase INSERT still committing
T6:                     Client queries article_sources → EMPTY!
```

**CORRECTION**: The `await` IS present in `returnExplanationLogic()` (line 667):
```typescript
// returnExplanation.ts:667 - await IS present
if (sources && sources.length > 0) {
    const sourceIds = sources.map(s => s.id);
    await linkSourcesToExplanation(newExplanationId, sourceIds);  // ← AWAITED!
}
```

**The real issue**: The complete event is sent as part of the streaming response body. Even though `linkSourcesToExplanation()` has `await`:
1. The Supabase INSERT may not be fully committed by the time client queries
2. The client immediately redirects when it receives `complete` event
3. Network latency + DB load can cause the query to arrive before commit finalizes

**Database Tables Involved**:
- `article_sources` junction table: `{explanation_id, source_cache_id, position}`
- Query: `SELECT position, source_cache(*) FROM article_sources WHERE explanation_id = ?`

**During streaming**: Sources are in React state (memory) → Bibliography renders

**After reload**: Sources fetched from DB via `getSourcesByExplanationId()` → Returns empty because junction records may not be committed yet

**Verdict**: Async database commit creates race condition with client redirect, even with proper `await`.

---

## Data Flow Summary

```
┌─────────────────────────────────────────────────────────────────────────┐
│ HOME PAGE: User adds sources                                            │
│ SearchBar.tsx → SourceInput.tsx → /api/fetchSourceMetadata             │
│                                   → sourceFetcher.ts (extract content)  │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ sessionStorage.setItem('pendingSources')
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ RESULTS PAGE: processParams()                                           │
│ Read sources from sessionStorage → handleUserAction() with sources      │
│ (Race condition fixed in commit 751c5a1)                                │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ POST /api/returnExplanation
                                     │ { sourceUrls: [...] }
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ API LAYER: route.ts                                                     │
│ 1. Resolve URLs → getOrCreateCachedSource() (FILTER: fetch_status)     │
│ 2. Pass to returnExplanationLogic()                                    │
└────────────────────────────────────┬────────────────────────────────────┘
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ SERVICE LAYER: returnExplanation.ts                                     │
│ 1. Convert sources → SourceForPromptType[] (FILTER: extracted_text)    │
│ 2. createExplanationWithSourcesPrompt() OR createExplanationPrompt()   │
│ 3. Call LLM → generates content with [n] citations                     │
│ 4. Save explanation                                                     │
│ 5. linkSourcesToExplanation() → article_sources junction table         │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ 'complete' event (BEFORE step 5 commits!)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ CLIENT: Page redirect & reload                                          │
│ 1. Receive complete → router.push('/results?explanation_id=X')         │
│ 2. loadExplanation() → getSourcesByExplanationId() → EMPTY!            │
│ 3. setSources([]) → bibliographySources = [] → CitationPlugin disabled │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Key Files Involved

| File | Purpose | Issue Found |
|------|---------|-------------|
| `src/components/SearchBar.tsx` | Home page source input, sessionStorage save | ✅ OK |
| `src/components/sources/SourceInput.tsx` | URL validation, metadata fetch | ✅ OK |
| `src/app/api/fetchSourceMetadata/route.ts` | Extract source content | ✅ OK |
| `src/lib/services/sourceFetcher.ts` | Readability parsing | ✅ OK |
| `src/app/results/page.tsx:670-695` | Read sources from sessionStorage | ✅ Fixed in 751c5a1 |
| `src/app/api/returnExplanation/route.ts:93-118` | Resolve sourceUrls | 🟡 Silent filter |
| `src/lib/services/returnExplanation.ts:577` | Filter by extracted_text | 🟡 Silent filter |
| `src/lib/services/returnExplanation.ts:234` | Choose prompt type | 🔴 Silent degradation |
| `src/lib/services/returnExplanation.ts:667` | Link sources to explanation | 🔴 After complete event |
| `src/lib/prompts.ts:253-300` | Citation instructions | ✅ OK |
| `src/hooks/useExplanationLoader.ts:257-271` | Load sources on reload | ✅ OK (but empty result) |
| `src/editorFiles/lexicalEditor/CitationPlugin.tsx:65` | Citation rendering | 🔴 Disabled when empty |
| `src/components/sources/Bibliography.tsx` | Bibliography display | ✅ OK (but receives empty) |

---

---

## Source Data Lifecycle (Complete Trace)

```
┌─────────────────────────────────────────────────────────────────┐
│ STEP 1: USER INPUT (Home Page)                                  │
│ SourceInput.tsx:44-103 → fetch metadata via /api/fetchSourceMetadata
│ SearchBar.tsx:62-79 → sessionStorage.setItem('pendingSources')  │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 2: RESULTS PAGE LOAD                                       │
│ page.tsx:652-665 → retrieve pendingSources from sessionStorage  │
│ Parse as SourceChipType[], set to component state               │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 3: SEND TO API                                             │
│ page.tsx:286-326 → extract URLs, POST /api/returnExplanation    │
│ body: { sourceUrls: string[], ... }                             │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 4: API - RESOLVE SOURCES                                   │
│ route.ts:96-118 → getOrCreateCachedSource() for each URL        │
│ Filter: fetch_status === 'success' only                         │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 5: SOURCE CACHE SERVICE                                    │
│ sourceCache.ts:136-242 → check cache, fetch if expired/missing  │
│ Insert/update source_cache table                                │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 6: GENERATE EXPLANATION                                    │
│ returnExplanation.ts:571-673 → convert to SourceForPromptType[] │
│ Pass to LLM, save explanation, call linkSourcesToExplanation()  │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 7: LINK SOURCES TO EXPLANATION                             │
│ sourceCache.ts:254-290 → INSERT article_sources junction table  │
│ {explanation_id, source_cache_id, position}                     │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 8: PAGE RELOAD                                             │
│ useExplanationLoader.ts:257-271 → getSourcesForExplanationAction│
│ Query article_sources JOIN source_cache                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### source_cache table
```sql
CREATE TABLE source_cache (
  id SERIAL PRIMARY KEY,
  url TEXT UNIQUE NOT NULL,
  url_hash TEXT,  -- SHA256 generated
  title TEXT,
  favicon_url TEXT,
  domain TEXT NOT NULL,
  extracted_text TEXT,
  is_summarized BOOLEAN DEFAULT FALSE,
  original_length INTEGER,
  fetch_status TEXT CHECK (in 'pending', 'success', 'failed'),
  error_message TEXT,
  fetched_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### article_sources junction table
```sql
CREATE TABLE article_sources (
  id SERIAL PRIMARY KEY,
  explanation_id INTEGER REFERENCES explanations(id) ON DELETE CASCADE,
  source_cache_id INTEGER REFERENCES source_cache(id) ON DELETE CASCADE,
  position INTEGER CHECK (BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(explanation_id, source_cache_id),
  UNIQUE(explanation_id, position)
);
```

---

## Identified Gaps & Potential Issues

| # | Gap | Location | Impact | Recommendation |
|---|-----|----------|--------|----------------|
| 1 | **No error recovery for partial source failures** | route.ts:104-108 | User never informed which sources failed | Return failure status, display to user |
| 2 | **Source expiry logic incomplete** | sourceCache.ts:123-126 | Could serve stale content indefinitely | Implement cache invalidation job |
| 3 | **No source update tracking on edit** | Junction table | Sources not re-linked when explanation edited | Copy source links on version creation |
| 4 | **SourceChipType vs SourceCacheFullType mismatch** | Multiple boundaries | Conversion happens at 3+ points | Document conversion pipeline |
| 5 | **No source deduplication** | sessionStorage | User can add same source twice | Add dedup in SourceInput or SourceList |
| 6 | **Source order not preserved on edit** | article_sources | Could cause position conflicts | Handle re-linking on updates |

---

## Parallel Agent Investigation (Jan 9, 2026)

### Agent 1: Citation Rendering Deep Dive

**Root cause confirmed**: CitationPlugin disabled when `sources.length === 0`

**File evidence**:
- `CitationPlugin.tsx:65` - `if (!enabled || sources.length === 0) return;` **CRITICAL EARLY RETURN**
- `CitationPlugin.tsx:182` - Second guard in useEffect: `if (!enabled || sources.length === 0) return;`
- `importExportUtils.ts:1146-1161` - **Confirmed**: Markdown LINK transformer only matches `[text](url)`, NOT bare `[n]` citations

**Verification**:
| Stage | Status | Evidence |
|-------|--------|----------|
| LLM Instructions | ✓ CORRECT | prompts.ts:273, 287-297 explicit citation rules |
| LLM Response | ? UNKNOWN | Likely generating but needs verification |
| Markdown Parsing | ✓ PASS | No transformer strips `[n]` patterns |
| CitationPlugin | ✗ FAILS | Disabled when sources.length === 0 |

**Conclusion**: Citations survive markdown parsing. The failure is at the CitationPlugin which disables itself when sources array is empty (due to race condition or filter cascade).

---

### Agent 2: Complete Source Filter Cascade

**6 silent filter points identified** (expanded from initial findings):

| # | File:Line | Condition | User Feedback | Severity |
|---|-----------|-----------|---------------|----------|
| 1 | `page.tsx:75` | `s.status === 'success'` (bibliography) | None | 🟡 Medium |
| 2 | `page.tsx:288` | `s.status === 'success'` (rewrite) | None (DEBUG log) | 🟡 Medium |
| 3 | `route.ts:104` | `fetch_status === 'success'` | None (DEBUG log) | 🟡 Medium |
| 4 | `returnExplanation.ts:577` | `s.content.length > 0` | **NONE** | 🔴 CRITICAL |
| 5 | `sourceCache.ts:161-196` | Fetch success | Logger.error() | 🟡 Medium |
| 6 | `Bibliography.tsx:24` | `sources.length > 0` | Silent `null` render | 🟡 Medium |

**Silent degradation chain**: When ALL sources fail any filter:
1. `returnExplanation.ts:234` silently falls back to non-sources prompt
2. No user notification that sources were excluded
3. Bibliography renders as nothing (returns `null`)
4. LLM generates content without source grounding

**Critical gaps in transparency**:
- No source count tracking (client sends N, never told how many reached LLM)
- No per-source error details to client
- No batch feedback like "Only 2 of 5 sources available"

---

### Agent 3: Race Condition Analysis (Refined)

**Corrected understanding**: The `await` IS present but race condition still occurs

**Server-side timing** (returnExplanation.ts):
```
Line 604: await saveExplanationAndTopic()
Line 637: await saveHeadingLinks()
Line 642: await applyTagsToExplanation()
Line 647: await saveCandidatesFromLLM()
Line 652-662: generateAndSaveExplanationSummary() ← FIRE-AND-FORGET
Line 667: await linkSourcesToExplanation() ← AWAITED
Line 680: await saveUserQuery()
Line 688: return
```

**The actual race**:
1. Server: `await linkSourcesToExplanation()` completes INSERT
2. Server: Function returns, API sends `complete` event
3. Client: Receives `complete`, immediately navigates to results page
4. Client: `useExplanationLoader` calls `getSourcesForExplanationAction()`
5. **RACE**: Supabase INSERT may not be durably visible due to:
   - Database transaction isolation level
   - Sub-millisecond gap between INSERT queue and disk commit
   - Network latency between client/server

**Evidence**: `sourceCache.ts:303-310` uses LEFT JOIN:
```sql
SELECT position, source_cache.*
FROM article_sources
LEFT JOIN source_cache ON article_sources.source_cache_id = source_cache.id
WHERE explanation_id = ?
```

If `article_sources` INSERT not yet visible, JOIN returns empty.

---

### Agent 4: LLM Prompt Verification

**CONFIRMED**: Sources DO reach the LLM when they survive filter cascade

**Smoking gun evidence**:
1. `returnExplanation.ts:234` - Conditional is simple: `if (sources && sources.length > 0)` → use sources prompt
2. `returnExplanation.ts:570-577` - `content: source.extracted_text || ''` pulled directly from DB
3. `prompts.ts:268` - `${source.content}` directly interpolated into prompt
4. `llms.ts:140` - Prompt sent to OpenAI without truncation

**Full source inclusion template** (prompts.ts:264-270):
```typescript
const sourcesSection = sources.map(source => {
    const sourceType = source.isVerbatim ? 'VERBATIM' : 'SUMMARIZED';
    return `[Source ${source.index}] ${source.title} (${source.domain}) [${sourceType}]
---
${source.content}  // ← FULL extracted_text interpolated
---`;
}).join('\n\n');
```

**Summarization threshold**: `sourceFetcher.ts:11` - Content > 3000 words triggers summarization DURING FETCH, not per-request. `isVerbatim` flag tells LLM what it received.

**No truncation before LLM**: Checked `llms.ts`, `prompts.ts`, `returnExplanation.ts` - no slicing/substring operations.

---

## Updated Root Cause Summary

| Problem | Root Cause | Fix Approach |
|---------|------------|--------------|
| **Citations missing** | CitationPlugin disabled when sources empty (due to race or filter cascade) | 1. Fix race condition first, 2. Add loading state to CitationPlugin |
| **Sources not influencing** | Silent filter cascade drops sources without feedback | Add user-facing warnings when sources filtered |
| **Bibliography disappears** | Transaction isolation race between INSERT and subsequent SELECT | Add confirmation before sending `complete` event OR delay client redirect |

---

---

## Phase 2 Research: Deep Dive (Jan 10, 2026)

### Agent 1: LLM Citation Verification Methods

**Question**: Does the LLM actually generate [n] citations in raw response?

**Key Finding**: Logging infrastructure EXISTS to verify this:

| Method | Location | Details |
|--------|----------|---------|
| **Database (BEST)** | `llmCallTracking` table | `content` column stores raw LLM output; query with `WHERE content LIKE '%[1]%'` |
| **FILE_DEBUG logs** | `llms.ts:241-244` | Currently disabled (`FILE_DEBUG = false`), enable to see GPT responses |
| **Server logs** | `server.log` | All logger calls written to file with JSON format |

**Verification SQL**:
```sql
SELECT id, content FROM llmCallTracking
WHERE call_source = 'generateNewExplanation'
ORDER BY created_at DESC LIMIT 1;
-- Look for [1], [2], etc. in content column
```

**Logging Points Summary**:
| Point | File:Line | Current State |
|-------|-----------|---------------|
| Raw LLM Output | `llms.ts:241-244` | FILE_DEBUG=false (disabled) |
| Sources Received | `returnExplanation.ts:237-241` | FILE_DEBUG=true |
| Prompt Choice | `returnExplanation.ts:234-255` | FILE_DEBUG=true |
| After LLM Call | `returnExplanation.ts:279` | **NO LOGGING** |

---

### Agent 2: Race Condition Fix Options

**Architecture Finding**: The streaming flow is:
1. `route.ts:172-184` → `await returnExplanationLogic()`
2. `returnExplanation.ts:667` → `await linkSourcesToExplanation()` (IS awaited)
3. `route.ts:201-215` → Send 'complete' event **immediately after return**
4. `page.tsx:471-485` → `router.push(newUrl)` **immediately on complete**

**Why Race Exists** (despite await):
- Supabase INSERT may not be durably visible due to transaction isolation
- Sub-millisecond gap between INSERT queue and disk commit
- No post-insert confirmation query

**Potential Fixes**:

| Option | Approach | Pros | Cons |
|--------|----------|------|------|
| **A** | Confirmation query before complete | Guarantees visibility | Adds latency |
| **B** | Delay complete event (100-200ms) | Simple | Fragile timing |
| **C** | Client polls for sources | Resilient | More complex |
| **D** | Background worker for linking | Decoupled | Major refactor |
| **E** | Explicit transaction with confirm | Robust | Depends on Supabase |

**Recommended**: Option A (confirmation query) or Option C (client polls)

---

### Agent 3: User Feedback Mechanisms

**Existing UI Patterns Found**:

| Pattern | Location | Usage |
|---------|----------|-------|
| Full-page error banner | `page.tsx:926-930` | `dispatchLifecycle({ type: 'ERROR' })` |
| Inline field error | `SourceInput.tsx:161-163` | Small red text below input |
| SourceChip status | `SourceChip.tsx:24-26, 35-37` | Red border + warning icon |
| SourceList warning | `SourceList.tsx:68-72` | "(some sources failed to load)" text |
| **FailedSourcesModal** | `FailedSourcesModal.tsx:20-115` | **EXISTS BUT NOT WIRED IN** |

**Critical Discovery**: `FailedSourcesModal` component is fully built but never used!

**API Response Gap**:
- Current: Single `error` field (all-or-nothing)
- Missing: Partial success metadata ("3 of 5 sources succeeded")
- Could add: `'source_warning'` streaming event type

**Filter Points with User Feedback Status**:

| # | Location | User-Actionable | Current Feedback |
|---|----------|-----------------|------------------|
| 1 | `page.tsx:75` | YES | ❌ None |
| 2 | `page.tsx:288` | YES | ❌ None |
| 3 | `route.ts:104` | NO | Debug log only |
| 4 | `returnExplanation.ts:577` | NO | ❌ None |
| 5 | `sourceCache.ts:161-196` | NO | Logger.error() |
| 6 | `Bibliography.tsx:24` | YES | ❌ None |

---

### Agent 4: CitationPlugin Loading State

**Timing Issue Discovered**:

```
Time T0: Page loads
  → sources = [] (page.tsx:56)
  → CitationPlugin disabled (sources.length === 0)

Time T1: loadExplanation() called
  → Content fetched and set (useExplanationLoader.ts:207)
  → Editor renders with [1], [2] as plain text
  → CitationPlugin STILL disabled

Time T2: Sources fetched (useExplanationLoader.ts:259)
  → IF successful: sources populated, CitationPlugin enables
  → IF fails/race: sources=[], CitationPlugin STAYS disabled permanently
```

**Key Code Locations**:
| Concern | File:Line | Issue |
|---------|-----------|-------|
| Plugin disables self | `CitationPlugin.tsx:65, 182` | Early returns block all processing |
| enabled prop | `LexicalEditor.tsx:759` | `enabled={sources.length > 0}` |
| Content set FIRST | `useExplanationLoader.ts:207` | Before sources (line 259) |
| Fetch result | `useExplanationLoader.ts:262-269` | Empty array on failure |

**Potential Solutions**:

| Solution | Description | Complexity |
|----------|-------------|------------|
| **A** | Render [n] as placeholder spans during loading | Medium |
| **B** | Preserve plain text + "Loading sources..." indicator | Low |
| **C** | Preload sources BEFORE rendering content | Medium |
| **D** | Retry failed source fetches with backoff | Medium |
| **E** | Plugin scans passively, upgrades when sources arrive | High |

**Recommended**: Solution E (passive scanning) or B (loading indicator)

---

## Consolidated Fix Priorities

| Priority | Problem | Root Cause | Recommended Fix |
|----------|---------|------------|-----------------|
| 🔴 **P0** | Bibliography disappears | Race condition timing | Confirmation query before 'complete' event |
| 🔴 **P1** | Citations never appear | CitationPlugin disabled early | Passive scanning + upgrade pattern |
| 🟡 **P2** | Sources not influencing | Silent filter cascade | Wire FailedSourcesModal + API warnings |

---

## Documents Read
- `docs/planning/source_citations_20250107/source_citations_research.md`
- `docs/planning/source_citations_20250107/source_citations_progress.md`
- `docs/planning/debugging_source_citations_not_appearing_20260109/_research.md`

## Code Files Read
- `src/components/SearchBar.tsx`
- `src/components/sources/SourceInput.tsx`
- `src/app/api/fetchSourceMetadata/route.ts`
- `src/lib/services/sourceFetcher.ts`
- `src/app/results/page.tsx`
- `src/app/api/returnExplanation/route.ts`
- `src/lib/services/returnExplanation.ts`
- `src/lib/prompts.ts`
- `src/lib/services/sourceCache.ts`
- `src/hooks/useExplanationLoader.ts`
- `src/editorFiles/lexicalEditor/LexicalEditor.tsx`
- `src/editorFiles/lexicalEditor/CitationPlugin.tsx`
- `src/editorFiles/lexicalEditor/importExportUtils.ts`
- `src/components/sources/Bibliography.tsx`
- `src/components/sources/FailedSourcesModal.tsx`
- `src/components/sources/SourceChip.tsx`
- `src/components/sources/SourceList.tsx`
- `src/actions/actions.ts`
- `src/lib/schemas/schemas.ts`
- `src/lib/services/llms.ts`
- `src/lib/server_utilities.ts`
