# Import Articles Feature - Brainstorm

## Overview

Allow users to import quality AI-generated content from ChatGPT, Claude, or Gemini into ExplainAnything as properly formatted articles.

**Goal:** Quick content seeding - rapidly populate platform with quality content users found useful elsewhere.

---

## Key Decisions

| Aspect | Decision |
|--------|----------|
| Access | All logged-in users |
| Input methods | Text paste (MVP) + URL import (Phase 2) |
| Processing | Cleanup chat artifacts + AI reformat |
| Source detection | Auto-detect with fallback dropdown |
| Preview | Yes, editable before publish |
| Moderation | Direct publish (no queue) |
| Attribution | Store source in DB |

---

## User Flow

```
1. User clicks "Import" button (in nav or on home page)
2. Import modal opens with:
   - Large textarea for pasting content
   - Optional URL field (Phase 2)
   - Source dropdown (auto-detected, user can override)
3. User pastes content → clicks "Process"
4. System cleans up and reformats
5. Preview screen with editable Lexical editor
6. User reviews, makes edits if needed
7. User clicks "Publish"
8. Article goes live with auto-tagging, embeddings, etc.
```

---

## Input & Detection

### Text Paste (MVP)

User copies conversation output from AI tool and pastes into textarea.

**Source detection heuristics:**
- ChatGPT: "Certainly!", "Sure!", specific list formatting
- Claude: "I'll help you...", structured markdown style
- Gemini: Different phrasing patterns

**Fallback:** Dropdown selector if auto-detect confidence is low.

### URL Import (Phase 2)

User pastes share URL:
- ChatGPT: `chat.openai.com/share/...`, `chatgpt.com/share/...`
- Claude: `claude.ai/share/...`
- Gemini: `gemini.google.com/share/...`

Server-side fetch extracts content. May be blocked by some providers - graceful fallback to paste-only.

---

## Content Processing

### Step 1: Cleanup Chat Artifacts

**Patterns to remove:**

Opening phrases:
- "Sure!", "Certainly!", "I'd be happy to..."
- "Great question!", "Let me explain..."

Closing phrases:
- "Let me know if you have questions!"
- "Hope this helps!", "Feel free to ask..."

Meta-commentary:
- "As an AI...", "I should note that..."
- "Would you like me to continue?"

### Step 2: AI Reformatting

Single LLM call (GPT-4o-mini) to:
1. Remove remaining conversational cruft
2. Generate appropriate title
3. Ensure proper heading hierarchy (h1 title, h2/h3 sections)
4. Add intro paragraph if content jumps into details
5. Clean up markdown formatting

**Output format:**
```markdown
# [Generated Title]

[Introduction paragraph]

## [Section 1]
...

## [Section 2]
...
```

---

## Architecture

### Data Flow

```
User Input (paste/URL)
    ↓
detectSource() → ChatGPT/Claude/Gemini/Other
    ↓
[If URL: fetchShareUrl() → extract content]
    ↓
cleanupAndReformat() → LLM call
    ↓
Preview Screen (Lexical editor)
    ↓
User confirms → processImportPublish()
    ↓
[Existing pipeline:]
├─ createTopic()
├─ createExplanation(status: Published)
├─ processContentToStoreEmbedding()
├─ evaluateTags() + applyTagsToExplanation()
├─ extractLinkCandidates()
└─ Redirect to published article
```

### New Components

**UI:**
- `ImportModal.tsx` - Modal with paste area, URL input, source dropdown
- `ImportPreview.tsx` - Preview screen with Lexical editor integration
- Button in navigation + home page to trigger modal

**Services:**
- `lib/services/importArticle.ts`
  - `detectSource(content: string): Source`
  - `cleanupAndReformat(content: string, source: Source): Promise<FormattedArticle>`
  - `fetchShareUrl(url: string): Promise<string>` (Phase 2)

**Actions:**
- `actions/importActions.ts`
  - `processImport(input: string, inputType: 'paste' | 'url')`
  - `publishImportedArticle(content: string, title: string, source: Source)`

### Database Changes

Add `source` column to `explanations` table:

```sql
ALTER TABLE explanations
ADD COLUMN source TEXT CHECK (source IN ('chatgpt', 'claude', 'gemini', 'other', 'generated'));
```

- `chatgpt`, `claude`, `gemini`, `other` = imported content
- `generated` = created via normal ExplainAnything flow
- `NULL` = legacy content

---

## Prompts

### Cleanup & Reformat Prompt

```
You are reformatting AI chat content into a clean educational article.

Input: Raw content copied from an AI assistant conversation.

Tasks:
1. Remove conversational artifacts:
   - Opening phrases ("Sure!", "I'd be happy to help...")
   - Closing phrases ("Let me know if...", "Hope this helps!")
   - Meta-commentary ("As an AI...", "I should note...")

2. Generate a clear, descriptive title

3. Structure as article:
   - Single h1 title at top
   - h2 for major sections
   - h3 for subsections if needed
   - Add brief intro paragraph if content jumps straight into details

4. Preserve all substantive content, examples, and code blocks

5. Clean up markdown formatting issues

Output format:
# [Title]

[Intro paragraph]

## [Section]
...
```

---

## UI Mockup

### Import Modal

```
┌─────────────────────────────────────────────┐
│  Import Article from AI                  ✕  │
├─────────────────────────────────────────────┤
│                                             │
│  Paste content from ChatGPT, Claude, or     │
│  Gemini below:                              │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │                                     │   │
│  │  [Large textarea for pasting]       │   │
│  │                                     │   │
│  │                                     │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  Source: [ChatGPT ▼] (auto-detected)        │
│                                             │
│  ──── OR paste share URL (coming soon) ──── │
│                                             │
│  [URL input - disabled for MVP]             │
│                                             │
│         [Cancel]    [Process →]             │
└─────────────────────────────────────────────┘
```

### Preview Screen

```
┌─────────────────────────────────────────────┐
│  Preview Import                             │
├─────────────────────────────────────────────┤
│                                             │
│  Source: Claude                             │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │                                     │   │
│  │  [Lexical Editor with formatted     │   │
│  │   article content - editable]       │   │
│  │                                     │   │
│  │                                     │   │
│  └─────────────────────────────────────┘   │
│                                             │
│     [← Back]              [Publish →]       │
└─────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: MVP
1. Import modal component
2. Paste input with source detection
3. LLM cleanup/reformat service
4. Preview with existing Lexical editor
5. Publish via existing pipeline
6. Database migration for `source` column

### Phase 2: URL Import
1. Add URL input field
2. Server-side fetch for share URLs
3. Content extraction for each provider
4. Graceful fallback if blocked

### Phase 3: Enhancements (optional)
- Duplicate detection before import
- Bulk import support
- Import history/tracking

---

## Open Questions (Resolved)

- [x] Goal: Quick content seeding
- [x] Access: All logged-in users
- [x] Input: Paste + URL (paste first)
- [x] Processing: Cleanup + AI reformat
- [x] Preview: Yes, editable
- [x] Moderation: Direct publish
- [x] Attribution: Store source in DB
- [x] UI location: Nav button + home page button → modal

---

## Related Files

**Existing code to reuse:**
- `src/actions/actions.ts` - `saveExplanationAndTopic()`
- `src/lib/services/explanations.ts` - `createExplanation()`
- `src/lib/services/tagEvaluation.ts` - `evaluateTags()`
- `src/lib/services/vectorsim.ts` - `processContentToStoreEmbedding()`
- `src/editorFiles/lexicalEditor/` - Lexical editor components

**New files to create:**
- `src/components/ImportModal.tsx`
- `src/components/ImportPreview.tsx`
- `src/lib/services/importArticle.ts`
- `src/actions/importActions.ts`
- `supabase/migrations/XXXXXX_add_source_column.sql`
