# Link Candidate Generation Plan (Revised)

## Summary

**LLM returns link candidates directly** during content generation:
1. **Content generation LLM** returns both article content AND `link_candidates` array in structured format
2. **Occurrence tracking:** Count mentions per article for queue prioritization
3. **Human approval queue:** Admin reviews at `/admin/whitelist?tab=candidates`, approves → creates whitelist entry

All candidates stored in `link_candidates` table with occurrence counts for prioritization.

---

## Decisions Made

| Question | Decision |
|----------|----------|
| Candidate source | **LLM returns directly** (not bold extraction) |
| Extraction timing | **During content generation** (same LLM call) |
| Edit handling | **Re-count occurrences only** (no new candidates on edit) |
| Admin UI | **Tab in existing whitelist page** (`/admin/whitelist?tab=candidates`) |
| Rejection persistence | **Keep forever** - no auto-delete |

---

## Pipeline Overview

```
┌─────────────────────────────────────────────────────────────────┐
│              CONTENT GENERATION (Modified)                       │
├─────────────────────────────────────────────────────────────────┤
│  [User Query] → LLM (gpt-4.1-mini)                               │
│       ↓                                                          │
│  Returns JSON: { content, link_candidates }                      │
│       ↓                                                          │
│  Save article + candidates to database                           │
│       ↓                                                          │
│  Count occurrences of each candidate in content                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                     HUMAN APPROVAL QUEUE                         │
├─────────────────────────────────────────────────────────────────┤
│  Admin reviews candidates at /admin/whitelist?tab=candidates     │
│  (sorted by total occurrences DESC)                              │
│       ↓                                                          │
│  Approved → create link_whitelist entry (with standalone_title)  │
│  Rejected → marked as rejected (kept forever)                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## LLM Candidate Extraction

### Modified Content Generation Prompt

Add to the existing content generation prompt:

```typescript
`After generating the article, also return a list of 5-15 terms that would make good encyclopedia links.

These should be:
- Educational concepts readers might want to learn more about
- Terms that could be standalone encyclopedia articles
- NOT too generic (avoid "example", "process", "system")
- NOT the article's main topic

Return in this format:
{
  "content": "...article content...",
  "link_candidates": ["term1", "term2", ...]
}`
```

### Schema
```typescript
const contentWithCandidatesSchema = z.object({
  content: z.string(),
  link_candidates: z.array(z.string())
});
```

### No Separate LLM Call
Unlike the original plan which used a separate gpt-4.1-nano call, candidates are now returned as part of the main content generation response. This:
- Eliminates the ~500ms additional latency
- Removes extra API cost
- Simplifies the pipeline

---

## Database Schema

```sql
-- Status enum for candidates
CREATE TYPE candidate_status AS ENUM ('pending', 'approved', 'rejected');

-- Candidates awaiting approval
CREATE TABLE link_candidates (
  id SERIAL PRIMARY KEY,
  term VARCHAR(255) NOT NULL,
  term_lower VARCHAR(255) NOT NULL UNIQUE,
  source VARCHAR(20) NOT NULL DEFAULT 'llm',  -- 'llm' | 'manual'
  status candidate_status NOT NULL DEFAULT 'pending',
  total_occurrences INT DEFAULT 0,  -- Denormalized sum across all articles
  article_count INT DEFAULT 0,      -- Denormalized distinct article count
  first_seen_explanation_id INT REFERENCES explanations(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_candidates_status ON link_candidates(status);
CREATE INDEX idx_candidates_term ON link_candidates(term_lower);
CREATE INDEX idx_candidates_occurrences ON link_candidates(total_occurrences DESC);

-- Per-article occurrence tracking (for edit recalculation)
CREATE TABLE candidate_occurrences (
  id SERIAL PRIMARY KEY,
  candidate_id INT REFERENCES link_candidates(id) ON DELETE CASCADE,
  explanation_id INT REFERENCES explanations(id) ON DELETE CASCADE,
  occurrence_count INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(candidate_id, explanation_id)
);

CREATE INDEX idx_co_candidate ON candidate_occurrences(candidate_id);
CREATE INDEX idx_co_explanation ON candidate_occurrences(explanation_id);
```

---

## Occurrence Counting

### Purpose
Show "X total occurrences across Y articles" to help admins prioritize which terms to approve first.

### Algorithm
```typescript
function countTermOccurrences(content: string, term: string): number {
  // Count ALL occurrences of term in content (case-insensitive)
  const regex = new RegExp(`\\b${escapeRegex(term)}\\b`, 'gi');
  const matches = content.match(regex);
  return matches ? matches.length : 0;
}
```

### Query for Admin Queue
```sql
SELECT
  c.*,
  COUNT(co.explanation_id) as article_count,
  COALESCE(SUM(co.occurrence_count), 0) as total_occurrences
FROM link_candidates c
LEFT JOIN candidate_occurrences co ON c.id = co.candidate_id
WHERE c.status = 'pending'
GROUP BY c.id
ORDER BY total_occurrences DESC, article_count DESC, c.created_at ASC;
```

---

## Edit Handling Strategy

### New Article Creation
```
LLM generates content + link_candidates array
    ↓
Save article to DB
    ↓
For each candidate: upsert into link_candidates, count occurrences
    ↓
Insert candidate_occurrences rows
```

### Edit Existing Article
```
Content Changed
    ↓
Get existing candidates linked to this article
    ↓
Re-count occurrences for each candidate in new content
    ↓
Update candidate_occurrences rows
    ↓
Recalculate total_occurrences & article_count aggregates
```

**Note:** Edits do NOT generate new candidates - only the initial creation does. Edits just re-count occurrences of existing candidates.

### Implementation
```typescript
// For new articles - store LLM-provided candidates
async function saveCandidatesFromLLM(
  explanationId: number,
  content: string,
  candidates: string[]
): Promise<void> {
  for (const term of candidates) {
    const count = countTermOccurrences(content, term);
    const candidate = await upsertCandidate(term, explanationId);
    await insertOccurrence(candidate.id, explanationId, count);
  }
  await recalculateCandidateAggregates();
}

// For edits - just re-count occurrences
async function updateOccurrencesForArticle(
  explanationId: number,
  content: string
): Promise<void> {
  const existingOccurrences = await getOccurrencesForExplanation(explanationId);

  for (const occ of existingOccurrences) {
    const candidate = await getCandidateById(occ.candidate_id);
    const newCount = countTermOccurrences(content, candidate.term);
    await updateOccurrence(occ.id, newCount);
  }

  await recalculateCandidateAggregates();
}
```

### Trigger Points
- `returnExplanationLogic()` - New article created → `saveCandidatesFromLLM()`
- `updateExplanationAndTopic()` - Manual edits → `updateOccurrencesForArticle()`

---

## Status Lifecycle

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   pending   │ ──► │  approved   │ ──► │ (whitelist) │
└─────────────┘     └─────────────┘     └─────────────┘
       │
       ▼
┌─────────────┐
│  rejected   │
└─────────────┘
```

**All candidates start as `pending`**. Admin reviews and either:
- **Approves** → creates `link_whitelist` entry with `standalone_title`
- **Rejects** → marked as rejected (kept forever for deduplication)

---

## Admin UI: Candidates Tab

Merged into existing whitelist admin at `/admin/whitelist?tab=candidates`.

### Tab Structure
```
/src/app/admin/whitelist/page.tsx       # MODIFY - add tabs
/src/components/admin/WhitelistContent.tsx  # KEEP - existing whitelist CRUD
/src/components/admin/CandidatesContent.tsx # NEW - candidates queue UI
```

### Table Columns
| Column | Description |
|--------|-------------|
| Term | The candidate term |
| Source | `llm` or `manual` |
| Total Occurrences | Sum of all mentions across articles |
| Articles | Distinct article count |
| First Seen | Date added |
| Actions | Approve / Reject |

### Approve Modal
When approving, admin enters:
1. **Standalone title** (required) - e.g., "Machine Learning" → "What is Machine Learning?"
2. Confirm creates `link_whitelist` entry

### Server Actions
```typescript
getAllCandidatesAction(status?: 'pending' | 'approved' | 'rejected')
approveCandidateAction(id: number, standaloneTitle: string)
rejectCandidateAction(id: number)
deleteCandidateAction(id: number)
```

---

## Implementation Phases

### Phase 1: Schema + Migration
| Task | File |
|------|------|
| Migration | `supabase/migrations/xxx_link_candidates.sql` |
| Zod schemas | `/src/lib/schemas/schemas.ts` |

### Phase 2: Candidate Service
| Task | File |
|------|------|
| CRUD + counting functions | `/src/lib/services/linkCandidates.ts` |
| Tests | `/src/lib/services/linkCandidates.test.ts` |

### Phase 3: Content Generation Integration
| Task | File |
|------|------|
| Modify prompt schema | `/src/lib/services/returnExplanation.ts` |
| Call saveCandidatesFromLLM | `/src/lib/services/returnExplanation.ts` |

### Phase 4: Edit Integration
| Task | File |
|------|------|
| Hook updateExplanationAndTopic | `/src/actions/actions.ts` |

### Phase 5: Server Actions
| Task | File |
|------|------|
| Add candidate actions | `/src/actions/actions.ts` |

### Phase 6: Admin UI
| Task | File |
|------|------|
| Add tabs to whitelist page | `/src/app/admin/whitelist/page.tsx` |
| Candidates component | `/src/components/admin/CandidatesContent.tsx` |

---

## Critical Files Summary

| File | Action |
|------|--------|
| `supabase/migrations/xxx_link_candidates.sql` | NEW |
| `/src/lib/schemas/schemas.ts` | MODIFY - add candidate schemas |
| `/src/lib/services/linkCandidates.ts` | NEW |
| `/src/lib/services/returnExplanation.ts` | MODIFY - return candidates from LLM |
| `/src/actions/actions.ts` | MODIFY - add candidate actions, hook edits |
| `/src/app/admin/whitelist/page.tsx` | MODIFY - add tabs |
| `/src/components/admin/CandidatesContent.tsx` | NEW |
