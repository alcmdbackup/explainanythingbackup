# Link Candidate Generation Plan (Revised)

## Summary

**LLM-based extraction pipeline** for generating link whitelist candidates:
1. **LLM (gpt-4.1-nano):** Extract link candidates from generated content (synchronous)
2. **TF-IDF tracking:** Track article frequency for approval prioritization (Phase 2)
3. **Human approval queue:** Admin reviews and approves/rejects candidates

All candidates stored in `link_candidates` table, then sent to **human approval queue** where admin sets **link target** (search by default, specific article, or custom URL).

---

## Decisions Made

| Question | Decision |
|----------|----------|
| Sync vs Async | **Sync for MVP** - accept ~500ms latency |
| Backfill scope | **New articles only** - backfill deferred |
| Rejection persistence | **Keep forever** - no auto-delete |

---

## Pipeline Overview

```
┌─────────────────────────────────────────────────────────────────┐
│           STAGE 1: CONTENT GENERATION (Existing)                │
├─────────────────────────────────────────────────────────────────┤
│  [User Query] → LLM 1 (gpt-4.1-mini) → Article Content          │
│       ↓                                                         │
│  Save article to database                                       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│     STAGE 2: CANDIDATE EXTRACTION (Synchronous, ~500ms)         │
├─────────────────────────────────────────────────────────────────┤
│  LLM 2 (gpt-4.1-nano) analyzes full article content             │
│       ↓                                                         │
│  Returns 5-15 link-worthy terms                                 │
│       ↓                                                         │
│  Store in link_candidates with source='llm'                     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                     HUMAN APPROVAL QUEUE                        │
├─────────────────────────────────────────────────────────────────┤
│  Admin reviews candidates (sorted by article frequency)         │
│       ↓                                                         │
│  Approved → link_whitelist (with link target)                   │
│  Rejected → marked as rejected (kept forever)                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Async Job Options (For Future Migration)

Current approach is **synchronous** for MVP. If latency becomes a problem, migrate to:

### Option A: Supabase Edge Functions + pg_cron
```sql
-- pg_cron job (runs every 5 minutes)
SELECT cron.schedule('extract-candidates', '*/5 * * * *', $$
  SELECT net.http_post(
    url := 'https://your-project.supabase.co/functions/v1/extract-candidates',
    headers := '{"Authorization": "Bearer service_role_key"}'::jsonb
  )
$$);
```

### Option B: Vercel Cron Jobs
```json
// vercel.json
{
  "crons": [{
    "path": "/api/cron/extract-candidates",
    "schedule": "*/5 * * * *"
  }]
}
```

---

## Term Extraction Algorithm

### Bold Term Extraction
```typescript
interface ExtractedTerm {
  term: string;           // Original casing
  termLower: string;      // Lowercase for matching
  source: 'bold' | 'heading';
  count: number;          // Occurrences in document
}

function extractBoldTerms(content: string): ExtractedTerm[] {
  // Match **bold** patterns (markdown)
  const boldRegex = /\*\*([^*]+)\*\*/g;
  const terms = new Map<string, ExtractedTerm>();

  let match;
  while ((match = boldRegex.exec(content)) !== null) {
    const term = match[1].trim();
    const termLower = term.toLowerCase();

    // Skip short terms and common words
    if (term.length < 3) continue;
    if (STOPWORDS.has(termLower)) continue;

    const existing = terms.get(termLower);
    if (existing) {
      existing.count++;
    } else {
      terms.set(termLower, { term, termLower, source: 'bold', count: 1 });
    }
  }

  return Array.from(terms.values());
}

function extractHeadingTerms(content: string): ExtractedTerm[] {
  // Match ## and ### headings
  const headingRegex = /^#{2,3}\s+(.+)$/gm;
  const terms: ExtractedTerm[] = [];

  let match;
  while ((match = headingRegex.exec(content)) !== null) {
    const term = match[1].trim();
    terms.push({
      term,
      termLower: term.toLowerCase(),
      source: 'heading',
      count: 1
    });
  }

  return terms;
}

function extractTermsFromContent(content: string): ExtractedTerm[] {
  const boldTerms = extractBoldTerms(content);
  const headingTerms = extractHeadingTerms(content);

  // Merge, preferring bold source if both
  const merged = new Map<string, ExtractedTerm>();

  for (const term of [...headingTerms, ...boldTerms]) {
    const existing = merged.get(term.termLower);
    if (!existing || term.source === 'bold') {
      merged.set(term.termLower, term);
    }
  }

  return Array.from(merged.values());
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all',
  'can', 'her', 'was', 'one', 'our', 'out', 'has', 'have',
  'been', 'some', 'then', 'them', 'these', 'this', 'that',
  'with', 'from', 'will', 'would', 'could', 'should',
  'example', 'process', 'system', 'method', 'approach'
]);
```

### Why Bold Terms?
- Authors naturally bold important concepts
- High signal-to-noise ratio
- No NLP libraries needed
- Fast extraction

---

## TF-IDF: Approval Prioritization (Phase 2)

TF-IDF is **not for generating candidates** - it's for **prioritizing the approval queue**.

### Purpose
When reviewing candidates, show "Appears in X articles" to help admins prioritize which terms to approve first. High-frequency terms are more valuable to approve.

### Schema
```sql
-- Track which articles contain each candidate (for frequency count)
CREATE TABLE candidate_article_occurrences (
  id SERIAL PRIMARY KEY,
  candidate_id INT REFERENCES link_candidates(id) ON DELETE CASCADE,
  explanation_id INT REFERENCES explanations(id) ON DELETE CASCADE,
  occurrence_count INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(candidate_id, explanation_id)
);

CREATE INDEX idx_cao_candidate ON candidate_article_occurrences(candidate_id);
```

### Query for Admin Queue
```sql
-- Get candidates with article frequency for prioritization
SELECT
  c.*,
  COUNT(cao.explanation_id) as article_count,
  SUM(cao.occurrence_count) as total_occurrences
FROM link_candidates c
LEFT JOIN candidate_article_occurrences cao ON c.id = cao.candidate_id
WHERE c.status = 'pending'
GROUP BY c.id
ORDER BY article_count DESC, c.created_at ASC;
```

---

## Status Lifecycle (Simplified)

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

**All candidates start as `pending`**, regardless of source. Admin reviews and either approves (→ whitelist) or rejects.

### Database Enum
```sql
CREATE TYPE candidate_status AS ENUM ('pending', 'approved', 'rejected');
```

---

## Database Schema

```sql
-- Candidates awaiting approval
CREATE TABLE link_candidates (
  id SERIAL PRIMARY KEY,
  term VARCHAR(255) NOT NULL,
  term_lower VARCHAR(255) NOT NULL UNIQUE,
  source VARCHAR(20) NOT NULL DEFAULT 'llm',  -- 'llm' | 'manual'
  status candidate_status NOT NULL DEFAULT 'pending',
  first_seen_explanation_id INT REFERENCES explanations(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_candidates_status ON link_candidates(status);
CREATE INDEX idx_candidates_term ON link_candidates(term_lower);

-- RLS Policies
ALTER TABLE link_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read for authenticated users"
ON link_candidates FOR SELECT TO authenticated USING (true);

CREATE POLICY "Enable insert for authenticated users"
ON link_candidates FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Enable update for authenticated users"
ON link_candidates FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Enable delete for authenticated users"
ON link_candidates FOR DELETE TO authenticated USING (true);
```

---

## LLM Candidate Extraction

### Prompt
```typescript
export function createCandidateExtractionPrompt(
  title: string,
  headings: string[],
  content: string
): string {
  return `Extract terms that would make good encyclopedia links.

## Article
**Title:** ${title}
**Sections:** ${headings.join(', ')}

## Content
${content}

## Task
Identify 5-15 terms that:
- Are educational concepts readers might want to learn more about
- Could be standalone encyclopedia articles
- Are NOT too generic (avoid "example", "process", "system")
- Are NOT the article's main topic

Return JSON: {"candidates": ["term1", "term2", ...]}`;
}
```

### Schema
```typescript
const candidateExtractionSchema = z.object({
  candidates: z.array(z.string())
});
```

### Implementation
```typescript
// Called synchronously after article save
async function extractLinkCandidates(
  explanationId: number,
  title: string,
  content: string
): Promise<void> {
  const headings = extractHeadings(content);
  const prompt = createCandidateExtractionPrompt(title, headings, content);

  try {
    const response = await callOpenAIModel(
      prompt,
      'link_candidate_extraction',
      'system',
      'gpt-4.1-nano',
      false,
      null,
      candidateExtractionSchema,
      'candidateExtraction'
    );

    const parsed = candidateExtractionSchema.safeParse(JSON.parse(response));
    if (!parsed.success) {
      logger.warn('Failed to parse candidate extraction response');
      return;
    }

    const candidates = parsed.data.candidates.map(term => ({
      term,
      term_lower: term.toLowerCase(),
      source: 'llm',
      first_seen_explanation_id: explanationId,
      status: 'pending'
    }));

    await insertCandidatesAtomic(candidates);
  } catch (error) {
    logger.error('Candidate extraction failed', { error, explanationId });
    // Don't throw - extraction failure shouldn't block article save
  }
}
```

### Integration with Article Save
```typescript
// In returnExplanation.ts after saving
async function saveExplanation(...) {
  const saved = await createExplanation(explanation);

  // Synchronous extraction (~500ms)
  await extractLinkCandidates(saved.id, saved.title, saved.content);

  return saved;
}
```

### Cost Analysis

| Call | Model | Tokens | Cost |
|------|-------|--------|------|
| Content generation | gpt-4.1-mini | ~2000 | ~$0.003 |
| Candidate extraction | gpt-4.1-nano | ~500 in, ~50 out | ~$0.0001 |
| **Total per article** | | | **~$0.003** |

The extraction call adds negligible cost (~3% increase).

---

## Admin UI: Candidates Queue

Follow existing patterns from `/src/components/admin/WhitelistContent.tsx`.

### File Structure
```
/src/app/admin/candidates/page.tsx          # Dynamic import wrapper
/src/components/admin/CandidatesContent.tsx  # Main component
```

### CandidatesContent.tsx Structure
```typescript
type ModalMode = 'approve' | 'edit' | null;

interface CandidatesContentState {
  candidates: LinkCandidateFullType[];
  selectedCandidate: LinkCandidateFullType | null;
  modalMode: ModalMode;
  loading: boolean;
  error: string | null;
  saving: boolean;
  // Approval form
  targetType: 'search' | 'article' | 'url';
  targetUrl: string;
  displayText: string;
}
```

### Table Columns
| Column | Description |
|--------|-------------|
| Term | The candidate term |
| Source | `llm` or `manual` |
| Articles | Count from TF-IDF (Phase 2) |
| First Seen | Date added |
| Actions | Approve / Reject / Edit |

### Approve Modal
When approving, admin selects:
1. **Link target type**: Search (default) / Existing article / Custom URL
2. **Display text** (optional override)

### Server Actions
```typescript
// In /src/actions/actions.ts
getAllCandidatesAction(status?: 'pending' | 'approved' | 'rejected')
createCandidateAction(term: string, source?: 'manual')
approveCandidateAction(id: number, targetType: string, targetUrl?: string)
rejectCandidateAction(id: number)
deleteCandidateAction(id: number)
```

---

## Implementation Phases

### Phase 1: MVP (Core LLM Extraction)
**Goal:** Extract candidates from new articles, store for review

| Task | File | Notes |
|------|------|-------|
| Migration | `supabase/migrations/xxx_link_candidates.sql` | Tables + RLS |
| Schemas | `/src/lib/schemas/schemas.ts` | Zod types |
| Extraction service | `/src/lib/services/linkCandidates.ts` | `extractLinkCandidates()` |
| Prompt | `/src/lib/prompts.ts` | `createCandidateExtractionPrompt()` |
| Integration | `/src/lib/services/returnExplanation.ts` | Call extraction after save |
| Server actions | `/src/actions/actions.ts` | CRUD + approve/reject |
| Admin UI | `/src/components/admin/CandidatesContent.tsx` | Table + approve modal |
| Admin route | `/src/app/admin/candidates/page.tsx` | Page wrapper |
| Tests | `/src/lib/services/linkCandidates.test.ts` | Unit + integration tests |

### Phase 2: TF-IDF Prioritization
**Goal:** Show article frequency in admin queue

| Task | File | Notes |
|------|------|-------|
| Occurrences table | Migration | `candidate_article_occurrences` |
| Track occurrences | `linkCandidates.ts` | On extraction, upsert occurrence |
| Query with counts | `linkCandidates.ts` | Join for admin display |
| UI update | `CandidatesContent.tsx` | Add "Articles" column |

### Phase 3: Optimization (Future)
**Goal:** Handle edge cases, migrate to async if needed

| Task | Notes |
|------|-------|
| Batch re-extraction | Handle content edits |
| Async migration | Move to Edge Functions if latency is a problem |
| Backfill (optional) | Process existing articles if desired later |

---

## Test Cases

### Unit Tests: Term Extraction
```typescript
// /src/lib/services/linkCandidates.test.ts

describe('extractBoldTerms', () => {
  it('extracts single bold term', () => {
    const content = 'Learn about **machine learning** today.';
    const terms = extractBoldTerms(content);
    expect(terms).toHaveLength(1);
    expect(terms[0].term).toBe('machine learning');
    expect(terms[0].count).toBe(1);
  });

  it('counts multiple occurrences', () => {
    const content = '**React** is great. I love **React**.';
    const terms = extractBoldTerms(content);
    expect(terms).toHaveLength(1);
    expect(terms[0].count).toBe(2);
  });

  it('skips short terms', () => {
    const content = '**AI** is a **big** deal.';
    const terms = extractBoldTerms(content);
    expect(terms).toHaveLength(0);
  });

  it('skips stopwords', () => {
    const content = 'This is **the** example.';
    const terms = extractBoldTerms(content);
    expect(terms).toHaveLength(0);
  });

  it('preserves original casing', () => {
    const content = '**JavaScript** is popular.';
    const terms = extractBoldTerms(content);
    expect(terms[0].term).toBe('JavaScript');
    expect(terms[0].termLower).toBe('javascript');
  });
});

describe('extractHeadingTerms', () => {
  it('extracts h2 headings', () => {
    const content = '## Introduction\nSome text\n## Conclusion';
    const terms = extractHeadingTerms(content);
    expect(terms).toHaveLength(2);
    expect(terms[0].term).toBe('Introduction');
  });

  it('extracts h3 headings', () => {
    const content = '### Subsection\nDetails here';
    const terms = extractHeadingTerms(content);
    expect(terms).toHaveLength(1);
  });

  it('ignores h1 and h4+', () => {
    const content = '# Title\n## Section\n#### Deep';
    const terms = extractHeadingTerms(content);
    expect(terms).toHaveLength(1);
    expect(terms[0].term).toBe('Section');
  });
});
```

### Unit Tests: Candidate Service
```typescript
describe('insertCandidatesAtomic', () => {
  it('inserts new candidates', async () => {
    const result = await insertCandidatesAtomic([
      { term: 'React', term_lower: 'react', source: 'llm' }
    ]);
    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it('skips duplicates via upsert', async () => {
    await insertCandidatesAtomic([{ term: 'React', term_lower: 'react', source: 'llm' }]);
    const result = await insertCandidatesAtomic([
      { term: 'React', term_lower: 'react', source: 'llm' }
    ]);
    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(1);
  });
});

describe('approveCandidate', () => {
  it('moves candidate to whitelist with search target', async () => {
    const candidate = await createCandidate('Machine Learning');
    await approveCandidate(candidate.id, 'search');

    const whitelist = await getWhitelistTermByLower('machine learning');
    expect(whitelist).not.toBeNull();
    expect(whitelist.target_type).toBe('search');
  });

  it('updates candidate status to approved', async () => {
    const candidate = await createCandidate('Neural Network');
    await approveCandidate(candidate.id, 'search');

    const updated = await getCandidateById(candidate.id);
    expect(updated.status).toBe('approved');
  });
});
```

### Integration Tests: LLM Extraction
```typescript
describe('extractLinkCandidates (integration)', () => {
  it('extracts candidates from article content', async () => {
    const mockContent = `
## Introduction
Learn about **machine learning** and **neural networks**.

## Applications
**Deep learning** powers modern AI systems.
    `;

    mockOpenAI.mockResolvedValueOnce({
      candidates: ['machine learning', 'neural networks', 'deep learning', 'AI systems']
    });

    await extractLinkCandidates(123, 'Test Article', mockContent);

    const candidates = await getAllCandidates('pending');
    expect(candidates.length).toBeGreaterThanOrEqual(3);
  });

  it('handles LLM failure gracefully', async () => {
    mockOpenAI.mockRejectedValueOnce(new Error('API Error'));

    await expect(
      extractLinkCandidates(123, 'Test', 'Content')
    ).resolves.not.toThrow();
  });
});
```

### E2E Tests: Admin Queue
```typescript
describe('Admin Candidates Queue', () => {
  beforeEach(async () => {
    await loginAsAdmin();
    await page.goto('/admin/candidates');
  });

  it('displays pending candidates', async () => {
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByText('machine learning')).toBeVisible();
  });

  it('approves candidate with search target', async () => {
    await page.getByRole('row', { name: /machine learning/i })
      .getByRole('button', { name: 'Approve' }).click();

    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Confirm' }).click();

    await expect(page.getByText('Approved successfully')).toBeVisible();
  });

  it('rejects candidate', async () => {
    await page.getByRole('row', { name: /test term/i })
      .getByRole('button', { name: 'Reject' }).click();

    await expect(page.getByRole('row', { name: /test term/i })).not.toBeVisible();
  });

  it('shows article count for prioritization', async () => {
    // Phase 2 test
    await expect(
      page.getByRole('row', { name: /popular term/i }).getByText('5 articles')
    ).toBeVisible();
  });
});
```

---

## Critical Files Summary

| File | Action | Phase |
|------|--------|-------|
| `supabase/migrations/xxx_link_candidates.sql` | NEW | 1 |
| `/src/lib/schemas/schemas.ts` | MODIFY | 1 |
| `/src/lib/services/linkCandidates.ts` | NEW | 1 |
| `/src/lib/prompts.ts` | MODIFY | 1 |
| `/src/lib/services/returnExplanation.ts` | MODIFY | 1 |
| `/src/actions/actions.ts` | MODIFY | 1 |
| `/src/app/admin/candidates/page.tsx` | NEW | 1 |
| `/src/components/admin/CandidatesContent.tsx` | NEW | 1 |
| `/src/lib/services/linkCandidates.test.ts` | NEW | 1 |
