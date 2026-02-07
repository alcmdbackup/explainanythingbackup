# Improve UX for Searching Research

## Problem Statement

The current UX interactions for A) importing articles from AI chatbots and B) adding source URLs on the Explain Anything home page are unsatisfying. This research documents the existing implementation to inform brainstorming around UX improvements.

## High Level Summary

The home page has two distinct content-creation entry points:
1. **Search with optional sources** - SearchBar with collapsible "+ Add sources" section
2. **Import from AI** - Button below SearchBar leading to a modal workflow

Both features are functional but the UX interactions feel disconnected. The "Add Sources" section collapses by default and may be overlooked. The "Import from AI" button is visually separated from the main search experience.

---

## Current Implementation

### Home Page Layout (`src/app/page.tsx`)

The home page is a centered hero layout with:
- Title: "Explain Anything"
- Subtitle: "Learn about any topic, simply explained"
- SearchBar component (variant="home")
- "Or import from AI" button (below SearchBar)
- ImportModal and ImportPreview modals

**State managed at page level:**
- `sources: SourceChipType[]` - tracks added source URLs
- `importModalOpen: boolean` - controls import modal visibility
- `previewData` - holds import preview data (title, content, source)

---

### SearchBar Component (`src/components/SearchBar.tsx`)

**Two variants:** `home` (large textarea) and `nav` (compact pill)

**Home variant features:**
- Textarea input (auto-expands, max 150 chars)
- Placeholder: "What would you like to learn?"
- Submit button (shows "Search" or loading dots)
- Gold border on focus

**Collapsible Sources Section:**
- Toggle button: "+ Add sources" / "{count} source(s) added"
- ChevronUp/ChevronDown icon indicates state
- When expanded: Shows SourceList in secondary surface color
- Helper text: "Add URLs to ground the explanation with citations"
- Auto-expands when sources are added

**Behavior:**
- Sources stored in sessionStorage with key `pendingSources`
- Only 'success' status sources passed to results page
- Enter submits (Shift+Enter for newline)
- Routes to `/results?q={query}` on submit

---

### Add Sources Components (`src/components/sources/`)

**SourceInput.tsx:**
- URL input field with http/https validation
- "+ Add" button with loading spinner
- Optimistic UI: Creates loading chip immediately
- Calls `/api/fetchSourceMetadata` endpoint
- Returns SourceChipType with status: loading → success/failed

**SourceChip.tsx:**
- Displays: favicon, title/domain, domain badge, warning icon (if failed), remove X
- States: loading (pulsing), success (normal), failed (red border)
- Gold border on hover for success chips

**SourceList.tsx:**
- Container for chips + input
- Max 5 sources
- Shows count: "{count}/5 sources"

**UX Flow:**
```
User enters URL → Validate format → Create loading chip (optimistic)
→ POST /api/fetchSourceMetadata → Update chip to success/failed
→ Chip displayed in SearchBar sources section
```

---

### Import Feature (`src/components/import/`)

**ImportModal.tsx:**
- Opens via "Or import from AI" button
- Large textarea for pasting content
- Source dropdown: ChatGPT, Claude, Gemini, Other AI
- Auto-detects source after 100+ chars typed
- States: idle → detecting → processing → error/success
- Requires authentication
- On success: passes data to ImportPreview

**ImportPreview.tsx:**
- Shows extracted title as h2
- Simple markdown rendering for content preview
- Source badge showing detected source
- Buttons: Back (returns to modal), Publish (saves article)
- Post-publish: Shows success message → 1 second delay → Routes to `/results?explanation_id={id}`

**Import UX Flow:**
```
Click "Or import from AI" → ImportModal opens
→ Paste content → Auto-detect source (optional manual override)
→ Click "Process" → Backend processes/formats content
→ ImportPreview shows formatted article
→ Click "Publish" → Article saved → Redirect to article page
```

---

## Key Files Summary

| File | Purpose |
|------|---------|
| `src/app/page.tsx` | Home page layout, state management |
| `src/components/SearchBar.tsx` | Main search input with sources section |
| `src/components/sources/SourceInput.tsx` | URL input for adding sources |
| `src/components/sources/SourceChip.tsx` | Individual source display |
| `src/components/sources/SourceList.tsx` | Container for source chips |
| `src/components/import/ImportModal.tsx` | Paste content modal |
| `src/components/import/ImportPreview.tsx` | Preview before publish |
| `src/app/api/fetchSourceMetadata/route.ts` | Backend for source URL fetching |

---

## Documents Read

- `docs/planning/import_sources/import_sources_brainstorm.md`
- `docs/planning/import_sources/import_sources_design.md`
- `docs/planning/import_sources/import_sources_tech_plan.md`
- `docs/planning/import_articles/import_articles_brainstorm.md`
- `docs/planning/import_articles/import_articles_plan.md`
- `docs/feature_deep_dives/search_generation_pipeline.md`
- `docs/feature_deep_dives/add_sources_citations.md`

---

## Code Files Read

- `src/app/page.tsx` - Home page component
- `src/components/SearchBar.tsx` - SearchBar with sources section
- `src/components/sources/SourceInput.tsx` - URL input component
- `src/components/sources/SourceChip.tsx` - Source chip display
- `src/components/sources/SourceList.tsx` - Source chips container
- `src/components/import/ImportModal.tsx` - Import content modal
- `src/components/import/ImportPreview.tsx` - Import preview modal
- `src/app/api/fetchSourceMetadata/route.ts` - Source metadata API
- `src/lib/schemas/schemas.ts` - SourceChipType definition (lines 1043-1087)

---

## Observations for UX Discussion

### Current State

1. **Two separate entry points** - Search and Import feel like distinct features rather than part of a unified content-creation experience

2. **Hidden sources section** - The "+ Add sources" toggle collapses by default; users may not discover it

3. **Import is secondary** - "Or import from AI" text positioning suggests it's an alternative rather than equal option

4. **Modal-based import** - Import workflow requires modal context switch away from main page

5. **No visual connection** - Sources and Import don't share visual language or interaction patterns

### Technical Constraints

- Sources limited to max 5 URLs
- Source fetching is async with loading states
- Import requires authentication
- Import auto-detects source but allows manual override
- Both workflows ultimately create content that goes through the standard pipeline (tagging, embeddings, etc.)

---

## Deep Dive: System Integration

### 1. Source Data Flow (Home → Results → LLM)

```
HOME PAGE (page.tsx)
  ↓ User adds sources via SourceList
  ↓ sources state: SourceChipType[]
  ↓
SEARCH BAR (SearchBar.tsx)
  ↓ User submits search
  ↓ Filter: status === 'success'
  ↓ sessionStorage.setItem('pendingSources', JSON.stringify(validSources))
  ↓
RESULTS PAGE (results/page.tsx)
  ↓ processParams() useEffect
  ↓ sessionStorage.getItem('pendingSources')
  ↓ setSources(sourcesFromStorage)
  ↓ Pass sourceUrls to handleUserAction
  ↓
FETCH TO API (/api/returnExplanation)
  ↓ requestBody: { ..., sourceUrls: [...] }
  ↓
API ROUTE (returnExplanation/route.ts)
  ↓ getOrCreateCachedSource(url) for each URL
  ↓ Returns: SourceCacheFullType[] (with extracted_text)
  ↓
GENERATION SERVICE (returnExplanation.ts)
  ↓ Convert to SourceForPromptType[]
  ↓ Choose prompt: createExplanationWithSourcesPrompt()
  ↓ LLM generates explanation with [n] citations
  ↓ linkSourcesToExplanation(explanationId, sourceIds)
  ↓
STREAMING RESPONSE
  ↓ Sources included in 'complete' event
  ↓ setSources(data.result.sources)
  ↓
DISPLAY
  ├─ LexicalEditor: clickable [n] citations
  └─ Bibliography: numbered source list
```

**Key Files:**
- `src/lib/services/sourceCache.ts` - Global source cache with 7-day expiry
- `src/lib/services/sourceFetcher.ts` - URL content extraction with Readability
- `src/lib/prompts.ts` - `createExplanationWithSourcesPrompt()` includes citation instructions

---

### 2. Import Article Pipeline

```
publishImportedArticle(title, content, source, userId)
    ↓
    ├─→ createTopic(topic_title: title)
    ↓
    ├─→ createExplanation(validatedData) with source field
    ↓
    └─→ POST-SAVE PIPELINE:
        ├─→ processContentToStoreEmbedding() [BLOCKING]
        │   └─ Splits text, creates OpenAI embeddings, upserts to Pinecone
        │   └─ Metadata: { explanation_id, topic_id, isAnchor: true }
        │
        ├─→ evaluateTags() + applyTagsToExplanation() [NON-BLOCKING]
        │   └─ LLM evaluates difficulty, length, simple tags
        │
        └─→ refreshExplanationMetrics() [NON-BLOCKING]
            └─ Initializes views/saves counters
```

**Source Field Storage:**
- Database column: `explanations.source` with CHECK constraint
- Values: `'chatgpt' | 'claude' | 'gemini' | 'other' | 'generated'`
- Indexed for efficient filtering queries

**Key Files:**
- `src/actions/importActions.ts` - `publishImportedArticle` orchestration
- `src/lib/services/vectorsim.ts` - `processContentToStoreEmbedding()`
- `src/lib/services/tagEvaluation.ts` - `evaluateTags()`

---

### 3. Results Page Source/Tag Management

**State Management:**
- `sources: SourceChipType[]` - Current sources for display/editing
- `tagState: TagModeState` - Tag reducer for modifications
- `pageLifecycle: PageLifecycleState` - Phase tracking (idle → streaming → viewing)

**Rewrite with Feedback Flow:**
```
AIEditorPanel / AdvancedAIEditorModal
    ↓
    ├─ User modifies sources (add/remove)
    ├─ User modifies tags (TagBar)
    ├─ User enters prompt
    ↓
onApply → handleUserAction(
    prompt,
    UserInputType.RewriteWithTags,
    mode,
    userid,
    tagDescriptions,  ← Tag preferences
    explanationId,
    explanationVector,
    sources           ← Source URLs
)
    ↓
API generates new content with citations
```

**Key Components:**
- `src/components/AIEditorPanel.tsx` - Quick rewrite with sources
- `src/components/AdvancedAIEditorModal.tsx` - Combined tags + sources + prompt
- `src/reducers/tagModeReducer.ts` - Tag modification tracking
- `src/reducers/pageLifecycleReducer.ts` - Page state machine

---

### 4. All Navigation Entry Points

```
┌─ Home (/)
│  ├─ SearchBar (variant="home")
│  │  ├─ Source Input (collapsible)
│  │  └─ onSearch → /results?q={query}
│  └─ "Or import from AI" → ImportModal
│
├─ Navigation (Global Header)
│  ├─ SearchBar (variant="nav") - compact pill
│  │  └─ onSearch → /results?q={query}
│  ├─ Import Button → ImportModal
│  ├─ Home Link → /
│  ├─ Saved Link → /userlibrary
│  ├─ Explore Link → /explanations
│  └─ Settings Link → /settings
│
├─ Results (/results)
│  ├─ URL Parameters: q, explanation_id, userQueryId, t, mode
│  ├─ SearchBar (variant="nav") → handleSearchSubmit
│  ├─ Rewrite Button → handleUserAction(Rewrite)
│  └─ Advanced AI Editor Modal → tags + sources + prompt
│
├─ Explore (/explanations)
│  ├─ Filter Tabs (New/Top) + Time Period
│  ├─ SearchBar (variant="nav") → /results?q={query}
│  └─ FeedCard → /results?explanation_id={id}
│
└─ User Library (/userlibrary)
   └─ Saved explanations table
```

**SearchBar Variants:**
| Variant | Element | Size | Sources | Location |
|---------|---------|------|---------|----------|
| `home` | `<textarea>` | Large, centered | Yes (collapsible) | Home page |
| `nav` | `<input>` | Compact pill | No | Header, Results, Explore |

**Import Entry Points:**
1. "Or import from AI" link on home page
2. Import button in global navigation header

---

## Additional Code Files Read (Deep Dive)

- `src/app/results/page.tsx` - Results page with source state management
- `src/lib/services/returnExplanation.ts` - Generation with sources
- `src/lib/services/sourceCache.ts` - Source caching service
- `src/actions/importActions.ts` - Import publish pipeline
- `src/components/AIEditorPanel.tsx` - Rewrite UI
- `src/components/AdvancedAIEditorModal.tsx` - Combined feedback modal
- `src/components/TagBar.tsx` - Tag modification UI
- `src/components/Navigation.tsx` - Global header with search
- `src/components/explore/ExploreGalleryPage.tsx` - Explore page layout
- `src/reducers/tagModeReducer.ts` - Tag state management
- `src/reducers/pageLifecycleReducer.ts` - Page lifecycle states
- `src/hooks/useExplanationLoader.ts` - Explanation loading with sources
