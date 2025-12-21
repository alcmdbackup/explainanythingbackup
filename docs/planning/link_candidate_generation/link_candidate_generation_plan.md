# Candidate Generation for Link Whitelist

## Summary

**Two-LLM Pipeline + TF-IDF:**
1. **LLM 1 (existing):** Generate article content
2. **LLM 2 (new, lighter):** Extract link candidates from generated content (async, background)
3. **TF-IDF corpus scan:** Complementary candidates from corpus-wide patterns

All candidates stored in `link_candidates` table, then sent to **human approval queue** where admin sets **link target** (search by default, specific article, or custom URL).

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
│     STAGE 2: CANDIDATE EXTRACTION (New, Background/Async)       │
├─────────────────────────────────────────────────────────────────┤
│  LLM 2 (gpt-4.1-nano, lighter) analyzes full article content    │
│       ↓                                                         │
│  Returns 5-15 link-worthy terms                                 │
│       ↓                                                         │
│  Store in link_candidates with source='llm_extraction'          │
└─────────────────────────────────────────────────────────────────┘
                              +
┌─────────────────────────────────────────────────────────────────┐
│         STAGE 3: TF-IDF CORPUS SCAN (Batch, Periodic)           │
├─────────────────────────────────────────────────────────────────┤
│  Periodic job scans term_corpus_stats                           │
│       ↓                                                         │
│  Identify high-scoring terms not yet in candidates              │
│       ↓                                                         │
│  Store in link_candidates with source='tfidf'                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                     HUMAN APPROVAL QUEUE                        │
├─────────────────────────────────────────────────────────────────┤
│  Admin reviews candidates from both sources                     │
│       ↓                                                         │
│  Approved → link_whitelist (with link target: search/article/url)│
│  Rejected → marked as rejected                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Two-LLM approach | Separate concerns: content quality vs link candidate extraction |
| Lighter model (nano) for extraction | Cheaper (~$0.0001/article), extraction is simpler task |
| Full content to LLM 2 | Better extraction quality with full context |
| Background/async extraction | No latency impact on user experience |
| TF-IDF as complementary | Catches cross-article patterns the per-article LLM might miss |
| No auto-approval | Human review ensures quality |
| Link target on approval | Admin chooses destination (search default, article, or custom URL) |

---

## Scalability: Incremental Term Tracking

### Why Incremental?

The naive approach (load all docs, extract terms, build stats) doesn't scale:

| Docs | Terms/Doc | Extractions | Memory |
|------|-----------|-------------|--------|
| 100 | 500 | 50K | OK |
| 1,000 | 500 | 500K | Slow |
| 10,000 | 500 | 5M | OOM risk |

### Solution: Track Stats Incrementally

Instead of recomputing on every scan, we:
1. **On article save**: Extract terms once, update running totals
2. **On article delete**: Decrement counts
3. **On candidate scan**: Just query pre-computed stats

---

## Database Schema for Term Tracking

```sql
-- Aggregate term statistics across corpus (updated incrementally)
CREATE TABLE term_corpus_stats (
  id SERIAL PRIMARY KEY,
  term VARCHAR(255) NOT NULL,              -- Original casing
  term_lower VARCHAR(255) NOT NULL UNIQUE, -- For lookups
  document_frequency INT DEFAULT 0,        -- # docs containing term (for IDF)
  total_occurrences INT DEFAULT 0,         -- Total count across all docs (for TF)
  bold_count INT DEFAULT 0,                -- Times found as bold (high signal)
  first_seen_explanation_id INT REFERENCES explanations(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_term_corpus_stats_doc_freq ON term_corpus_stats(document_frequency DESC);
CREATE INDEX idx_term_corpus_stats_term_lower ON term_corpus_stats(term_lower);

-- Per-article term occurrences (for decrementing on delete)
CREATE TABLE explanation_terms (
  id SERIAL PRIMARY KEY,
  explanation_id INT NOT NULL REFERENCES explanations(id) ON DELETE CASCADE,
  term_lower VARCHAR(255) NOT NULL,
  occurrence_count INT DEFAULT 1,
  is_bold BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(explanation_id, term_lower)
);

CREATE INDEX idx_explanation_terms_explanation ON explanation_terms(explanation_id);
CREATE INDEX idx_explanation_terms_term ON explanation_terms(term_lower);
```

---

## Stage 1: LLM Candidate Extraction (Background, After Article Save)

Uses a dedicated lighter LLM call to extract link candidates from generated content. Runs in background after article save - no latency impact on user experience.

**Location:** Add `extractLinkCandidates()` call in `returnExplanation.ts` after saving

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
// Helper to extract headings from content
function extractHeadings(content: string): string[] {
  const headingRegex = /^(#{2,3})\s+(.+)$/gm;
  const headings: string[] = [];
  let match;
  while ((match = headingRegex.exec(content)) !== null) {
    headings.push(match[2].trim());
  }
  return headings;
}

// Called after article save - runs in background
async function extractLinkCandidates(
  explanationId: number,
  title: string,
  content: string
): Promise<void> {
  const headings = extractHeadings(content);

  const prompt = createCandidateExtractionPrompt(title, headings, content);

  // Use lighter/cheaper model
  const response = await callOpenAIModel(
    prompt,
    'link_candidate_extraction',
    'system',
    'gpt-4.1-nano',  // Lighter model
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

  // Store candidates for later processing
  const candidates = parsed.data.candidates.map(term => ({
    term,
    term_lower: term.toLowerCase(),
    source: 'llm_extraction',
    first_seen_explanation_id: explanationId,
    status: 'pending'
  }));

  await insertLinkCandidatesAtomic(candidates);
}
```

### Integration with Article Save

```typescript
// In returnExplanation.ts after saving
async function saveExplanation(...) {
  const saved = await createExplanation(explanation);

  // Run candidate extraction in background (don't await)
  extractLinkCandidates(saved.id, saved.title, saved.content)
    .catch(err => logger.error('Background candidate extraction failed', { err }));

  return saved;
}
```

### Cost Analysis

| Call | Model | Tokens | Cost |
|------|-------|--------|------|
| Content generation | gpt-4.1-mini | ~2000 | ~$0.003 |
| Candidate extraction | gpt-4.1-nano | ~500 in, ~50 out | ~$0.0001 |
| **Total per article** | | | **~$0.003** |

The second call adds negligible cost (~3% increase)

---

## Stage 2: TF-IDF - Incremental Stats Update

> **See [Fix 1: Race Conditions](#fix-1-race-conditions-in-term-stats-updates) for the production-ready atomic version.**

### On Article Save/Update

```typescript
async function updateTermStatsOnSave(
  explanationId: number,
  content: string
): Promise<void> {
  const extractedTerms = extractTermsFromContent(content);

  // Get existing terms for this article (if updating)
  const existingTerms = await getExplanationTerms(explanationId);
  const existingMap = new Map(existingTerms.map(t => [t.term_lower, t]));
  const newMap = new Map(extractedTerms.map(t => [t.termLower, t]));

  // Terms to add (in new, not in existing)
  for (const [termLower, term] of newMap) {
    if (!existingMap.has(termLower)) {
      await upsertTermCorpusStats(term, explanationId, 'increment');
      await insertExplanationTerm(explanationId, term);
    } else {
      // Update occurrence count if changed
      const existing = existingMap.get(termLower)!;
      if (existing.occurrence_count !== term.count) {
        const delta = term.count - existing.occurrence_count;
        await updateTermOccurrences(termLower, delta);
        await updateExplanationTermCount(explanationId, termLower, term.count);
      }
    }
  }

  // Terms to remove (in existing, not in new)
  for (const [termLower, existing] of existingMap) {
    if (!newMap.has(termLower)) {
      await upsertTermCorpusStats(
        { termLower, count: existing.occurrence_count, source: existing.is_bold ? 'bold' : 'noun' },
        explanationId,
        'decrement'
      );
      await deleteExplanationTerm(explanationId, termLower);
    }
  }
}

async function upsertTermCorpusStats(
  term: ExtractedTerm,
  explanationId: number,
  operation: 'increment' | 'decrement'
): Promise<void> {
  const delta = operation === 'increment' ? 1 : -1;
  const occurrenceDelta = operation === 'increment' ? term.count : -term.count;
  const boldDelta = term.source === 'bold' ? delta : 0;

  await supabase.rpc('upsert_term_corpus_stats', {
    p_term: term.term,
    p_term_lower: term.termLower,
    p_doc_freq_delta: delta,
    p_occurrence_delta: occurrenceDelta,
    p_bold_delta: boldDelta,
    p_first_seen_id: operation === 'increment' ? explanationId : null
  });
}
```

### Database Function for Atomic Upsert

```sql
CREATE OR REPLACE FUNCTION upsert_term_corpus_stats(
  p_term VARCHAR(255),
  p_term_lower VARCHAR(255),
  p_doc_freq_delta INT,
  p_occurrence_delta INT,
  p_bold_delta INT,
  p_first_seen_id INT
) RETURNS VOID AS $$
BEGIN
  INSERT INTO term_corpus_stats (term, term_lower, document_frequency, total_occurrences, bold_count, first_seen_explanation_id)
  VALUES (p_term, p_term_lower, GREATEST(0, p_doc_freq_delta), GREATEST(0, p_occurrence_delta), GREATEST(0, p_bold_delta), p_first_seen_id)
  ON CONFLICT (term_lower) DO UPDATE SET
    document_frequency = GREATEST(0, term_corpus_stats.document_frequency + p_doc_freq_delta),
    total_occurrences = GREATEST(0, term_corpus_stats.total_occurrences + p_occurrence_delta),
    bold_count = GREATEST(0, term_corpus_stats.bold_count + p_bold_delta),
    updated_at = NOW();

  -- Clean up terms with zero documents
  DELETE FROM term_corpus_stats WHERE term_lower = p_term_lower AND document_frequency <= 0;
END;
$$ LANGUAGE plpgsql;
```

### On Article Delete

Handled automatically by `ON DELETE CASCADE` on `explanation_terms`, but we need a trigger to update `term_corpus_stats`:

```sql
CREATE OR REPLACE FUNCTION decrement_term_stats_on_delete()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE term_corpus_stats
  SET
    document_frequency = GREATEST(0, document_frequency - 1),
    total_occurrences = GREATEST(0, total_occurrences - OLD.occurrence_count),
    bold_count = GREATEST(0, bold_count - CASE WHEN OLD.is_bold THEN 1 ELSE 0 END),
    updated_at = NOW()
  WHERE term_lower = OLD.term_lower;

  -- Clean up zero-doc terms
  DELETE FROM term_corpus_stats WHERE term_lower = OLD.term_lower AND document_frequency <= 0;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_decrement_term_stats
BEFORE DELETE ON explanation_terms
FOR EACH ROW EXECUTE FUNCTION decrement_term_stats_on_delete();
```

---

## Stage 2: TF-IDF - Composite Scoring (Query-Based)

No more in-memory processing. Just query the pre-computed stats.

```typescript
interface TermStatsRow {
  term: string;
  term_lower: string;
  document_frequency: number;
  total_occurrences: number;
  bold_count: number;
  first_seen_explanation_id: number;
}

async function getTermStatsForScoring(minDocFreq: number = 3): Promise<TermStatsRow[]> {
  const { data, error } = await supabase
    .from('term_corpus_stats')
    .select('*')
    .gte('document_frequency', minDocFreq)
    .order('document_frequency', { ascending: false });

  if (error) throw error;
  return data;
}

async function getTotalDocumentCount(): Promise<number> {
  const { count, error } = await supabase
    .from('explanations')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'published');

  if (error) throw error;
  return count ?? 0;
}

function calculateScores(
  terms: TermStatsRow[],
  totalDocuments: number
): ScoredTerm[] {
  if (terms.length === 0) return [];

  // Calculate TF-IDF
  const withTfIdf = terms.map(term => {
    const idf = Math.log(totalDocuments / term.document_frequency);
    const avgTf = term.total_occurrences / term.document_frequency;
    const avgTfIdf = avgTf * idf;
    return { ...term, idf, avgTfIdf, compositeScore: 0 };
  });

  // Normalize and weight
  const maxDocFreq = Math.max(...withTfIdf.map(t => t.document_frequency));
  const maxTfIdf = Math.max(...withTfIdf.map(t => t.avgTfIdf));
  const maxBold = Math.max(...withTfIdf.map(t => t.bold_count));
  const maxOccur = Math.max(...withTfIdf.map(t => t.total_occurrences));

  return withTfIdf.map(term => {
    const normDocFreq = maxDocFreq > 0 ? term.document_frequency / maxDocFreq : 0;
    const normTfIdf = maxTfIdf > 0 ? term.avgTfIdf / maxTfIdf : 0;
    const normBold = maxBold > 0 ? term.bold_count / maxBold : 0;
    const normOccur = maxOccur > 0 ? term.total_occurrences / maxOccur : 0;

    // Weights: TF-IDF 35%, DocFreq 25%, BoldCount 25%, TotalOccur 15%
    term.compositeScore =
      0.35 * normTfIdf +
      0.25 * normDocFreq +
      0.25 * normBold +
      0.15 * normOccur;

    return term;
  }).sort((a, b) => b.compositeScore - a.compositeScore);
}
```

**How TF-IDF Works:**
- **TF (Term Frequency):** `total_occurrences / document_frequency` = avg occurrences per doc
- **IDF (Inverse Document Frequency):** `log(total_docs / document_frequency)` = rarer terms score higher
- **TF-IDF:** `TF × IDF` = important terms that aren't everywhere

**Scoring Rationale:**
- **TF-IDF (35%):** Identifies corpus-important but not ubiquitous terms
- **DocFreq (25%):** Rewards terms appearing across many articles
- **BoldCount (25%):** Bold = author explicitly marked as important
- **TotalOccur (15%):** Raw frequency signal

---

## Stage 3: LLM Evaluation for TF-IDF Candidates (Optional, Async Batch Job)

**Note:** LLM extraction candidates (from Stage 1) go directly to approval queue since the extraction LLM already evaluates quality. This stage is **only for TF-IDF candidates** if additional quality filtering is desired.

Runs as async batch job - no latency impact on article generation.

> **See [Fix 2: LLM Error Handling](#fix-2-llm-error-handling) for retry logic and validation.**

### Prompt with Article Context

```typescript
interface EvaluationInput {
  title: string;
  headings: string[];
  candidates: string[];
}

export function createLinkEvaluationPrompt(input: EvaluationInput): string {
  return `You are evaluating terms for an educational encyclopedia's link system.

## Article Context
**Title:** ${input.title}
**Sections:** ${input.headings.join(', ')}

## Candidate Terms
${input.candidates.map((t, i) => `${i + 1}. ${t}`).join('\n')}

## Task
For each term, decide if it would be a good link in this article:
- Y = Yes, readers would benefit from a link to learn more about this term
- N = No, too generic, too specific to this article, or not educational

Respond with JSON: {"decisions": ["Y", "N", "Y", ...]}`;
}

const linkEvaluationSchema = z.object({
  decisions: z.array(z.enum(['Y', 'N']))
});
```

### Batch Job Flow

```typescript
// Runs periodically (e.g., every hour or on-demand)
async function evaluatePendingCandidates(): Promise<{
  articlesProcessed: number;
  candidatesEvaluated: number;
}> {
  // Get articles with pending candidates
  const articlesWithPending = await getArticlesWithPendingCandidates();
  let totalEvaluated = 0;

  for (const article of articlesWithPending) {
    const { title, headings } = await getArticleContext(article.id);
    const candidates = await getPendingCandidatesForArticle(article.id);

    if (candidates.length === 0) continue;

    // LLM evaluation with article context
    const prompt = createLinkEvaluationPrompt({
      title,
      headings,
      candidates: candidates.map(c => c.term)
    });

    const response = await callOpenAIModel(
      prompt, 'link_evaluation', 'system', 'gpt-4o-mini',
      false, null, linkEvaluationSchema, 'linkEvaluation'
    );

    // Parse and validate (with safeParse + length check)
    const decisions = parseEvaluationResponse(response, candidates.length);

    // Update candidate statuses
    for (let i = 0; i < candidates.length; i++) {
      const newStatus = decisions[i] === 'Y'
        ? 'pending_approval'  // Goes to human queue
        : 'rejected';
      await updateCandidateStatus(candidates[i].id, newStatus);
    }

    totalEvaluated += candidates.length;
  }

  return {
    articlesProcessed: articlesWithPending.length,
    candidatesEvaluated: totalEvaluated
  };
}

// Helper to extract headings from content
function extractHeadings(content: string): string[] {
  const headingRegex = /^(#{2,3})\s+(.+)$/gm;
  const headings: string[] = [];
  let match;
  while ((match = headingRegex.exec(content)) !== null) {
    headings.push(match[2].trim());
  }
  return headings;
}
```

### Cost Analysis

| Per Article | Tokens | Cost (gpt-4o-mini) |
|-------------|--------|-------------------|
| Input: title + headings + ~10 terms | ~500 | ~$0.000075 |
| Output: 10 decisions | ~50 | ~$0.00003 |
| **Total per article** | | **~$0.0001** |

Monthly cost for 1000 articles: **~$0.10**

---

## Stage 4: Human Approval Queue

All LLM-approved candidates go to a human review queue. No auto-approval.

> **See [Fix 3: Check-then-Insert Race](#fix-3-check-then-insert-race-condition) for atomic insert patterns.**

### Database Schema for Candidates

```sql
CREATE TABLE link_candidates (
  id SERIAL PRIMARY KEY,
  term VARCHAR(255) NOT NULL,
  term_lower VARCHAR(255) NOT NULL,
  source VARCHAR(20) NOT NULL,  -- 'llm_extraction' | 'tfidf'
  tfidf_score NUMERIC(6,4),     -- NULL for llm_extraction
  first_seen_explanation_id INT REFERENCES explanations(id),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- 'pending' → awaiting human review (direct from LLM extraction)
    -- 'pending_evaluation' → TF-IDF candidates awaiting optional LLM eval
    -- 'approved' → moved to link_whitelist
    -- 'rejected' → not suitable
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(term_lower)
);

CREATE INDEX idx_link_candidates_status ON link_candidates(status);
CREATE INDEX idx_link_candidates_explanation ON link_candidates(first_seen_explanation_id);
```

### Candidate Lifecycle

```
[LLM extraction]  → pending (direct to human queue)
                         ↓
                   [Human review]
                    ↓           ↓
               approved      rejected
                    ↓
            [link_whitelist]

[TF-IDF scan]    → pending_evaluation (optional)
                         ↓
              [LLM evaluation batch] (optional)
                    ↓           ↓
                 pending      rejected
                    ↓
              [Human review]
                    ↓           ↓
               approved      rejected
                    ↓
            [link_whitelist]
```

### Admin Queue Queries

```sql
-- Candidates pending human approval
SELECT * FROM link_candidates
WHERE status = 'pending_approval'
ORDER BY created_at DESC;

-- Approve a candidate
UPDATE link_candidates SET status = 'approved', updated_at = NOW()
WHERE id = $1;

-- Then insert into whitelist
INSERT INTO link_whitelist (canonical_term, canonical_term_lower, standalone_title, type, is_active)
SELECT term, term_lower, term, 'term', true
FROM link_candidates WHERE id = $1;

-- Reject a candidate
UPDATE link_candidates SET status = 'rejected', updated_at = NOW()
WHERE id = $1;
```

### Admin Actions

| Action | Description |
|--------|-------------|
| **Approve** | Move to `link_whitelist`, set link target |
| **Reject** | Set status = 'rejected' (won't resurface) |
| **Edit** | Modify term text before approving |
| **Bulk approve** | Approve multiple with default (search) links |

### Link Target Options

When approving a candidate, admin selects where the link should point:

| Target Type | Example | Use Case |
|-------------|---------|----------|
| **Search (default)** | `/results?q=machine+learning` | Term doesn't have dedicated article yet |
| **Existing article** | `/results?id=123` | Term has a matching explanation |
| **Custom URL** | `/topic/ai` | Link to topic page or external resource |

```sql
-- Updated link_whitelist schema
CREATE TABLE link_whitelist (
  id SERIAL PRIMARY KEY,
  canonical_term VARCHAR(255) NOT NULL,
  canonical_term_lower VARCHAR(255) NOT NULL UNIQUE,

  -- Link target (one of these will be set)
  target_type VARCHAR(20) NOT NULL DEFAULT 'search',  -- 'search' | 'article' | 'url'
  target_explanation_id INT REFERENCES explanations(id),  -- if target_type = 'article'
  target_url VARCHAR(500),  -- if target_type = 'url', or generated search URL

  display_text VARCHAR(255),  -- Optional: override display text
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Approval Flow

```typescript
interface ApproveCandiateInput {
  candidateId: number;
  targetType: 'search' | 'article' | 'url';
  targetExplanationId?: number;  // Required if targetType = 'article'
  targetUrl?: string;            // Required if targetType = 'url'
  displayText?: string;          // Optional override
}

async function approveCandidate(input: ApproveCandiateInput): Promise<void> {
  const candidate = await getCandidateById(input.candidateId);

  // Generate target URL based on type
  let targetUrl: string;
  switch (input.targetType) {
    case 'search':
      targetUrl = `/results?q=${encodeURIComponent(candidate.term)}`;
      break;
    case 'article':
      targetUrl = `/results?id=${input.targetExplanationId}`;
      break;
    case 'url':
      targetUrl = input.targetUrl!;
      break;
  }

  // Insert into whitelist
  await insertWhitelistTerm({
    canonical_term: candidate.term,
    canonical_term_lower: candidate.term_lower,
    target_type: input.targetType,
    target_explanation_id: input.targetExplanationId ?? null,
    target_url: targetUrl,
    display_text: input.displayText ?? null,
    is_active: true
  });

  // Update candidate status
  await updateCandidateStatus(input.candidateId, 'approved');
}
```

### Bulk Approve with Search Default

For efficiency, bulk approve uses search as default target:

```typescript
async function bulkApproveWithSearchDefault(candidateIds: number[]): Promise<number> {
  const candidates = await getCandidatesByIds(candidateIds);

  const whitelistEntries = candidates.map(c => ({
    canonical_term: c.term,
    canonical_term_lower: c.term_lower,
    target_type: 'search',
    target_url: `/results?q=${encodeURIComponent(c.term)}`,
    is_active: true
  }));

  await insertWhitelistTermsAtomic(whitelistEntries);
  await updateCandidateStatuses(candidateIds, 'approved');

  return candidates.length;
}
```

---

## Integration Points

### Hook into Article Save

```typescript
// In returnExplanation.ts or wherever articles are saved
async function saveExplanation(explanation: ExplanationInsertType): Promise<ExplanationFullDbType> {
  const saved = await createExplanation(explanation);

  // Update term stats incrementally
  await updateTermStatsOnSave(saved.id, saved.content);

  return saved;
}
```

### Hook into Article Update

```typescript
async function updateExplanation(id: number, updates: Partial<ExplanationInsertType>): Promise<ExplanationFullDbType> {
  const updated = await updateExplanationInDb(id, updates);

  if (updates.content) {
    await updateTermStatsOnSave(id, updates.content);
  }

  return updated;
}
```

---

## Implementation Files

| File | Change |
|------|--------|
| `supabase/migrations/xxx_link_candidates.sql` | NEW - link_candidates table + term_corpus_stats |
| `/src/lib/services/linkCandidates.ts` | NEW - `extractLinkCandidates()`, LLM extraction, TF-IDF scan, queue |
| `/src/lib/services/returnExplanation.ts` | MODIFY - Call `extractLinkCandidates()` after save (background) |
| `/src/lib/services/termTracking.ts` | NEW - Incremental TF-IDF stats update |
| `/src/lib/prompts.ts` | Add `createCandidateExtractionPrompt`, `createLinkEvaluationPrompt` |
| `/src/lib/schemas/schemas.ts` | Add `candidateExtractionSchema`, `linkCandidateSchema`, `linkEvaluationSchema` |
| `/src/actions/actions.ts` | Add queue admin actions |
| `/src/app/admin/link-candidates/page.tsx` | NEW - Admin UI for approval queue (optional) |

---

## Configuration

```typescript
const CANDIDATE_CONFIG = {
  // TF-IDF scan settings
  MIN_DOC_FREQUENCY: 3,           // Min articles a term must appear in
  TOP_N_FOR_TFIDF: 100,           // Max terms per TF-IDF scan
  COMPOSITE_WEIGHTS: {
    tfIdf: 0.35,
    docFreq: 0.25,
    boldCount: 0.25,
    totalOccur: 0.15
  },

  // LLM evaluation batch settings
  EVALUATION_BATCH_SIZE: 50,      // Terms per LLM call
  MAX_RETRIES: 2,                 // Retry attempts on LLM failure

  // Batch job scheduling
  EVALUATION_INTERVAL: '1 hour',  // How often to run evaluation batch
  TFIDF_SCAN_INTERVAL: '1 day'    // How often to run TF-IDF scan
};
```

---

## Migration: Backfill Existing Articles

One-time script to populate `term_corpus_stats` from existing articles:

```typescript
async function backfillTermStats(): Promise<{ processed: number; terms: number }> {
  const explanations = await getAllPublishedExplanations();
  let termsAdded = 0;

  for (const exp of explanations) {
    const terms = extractTermsFromContent(exp.content);

    for (const term of terms) {
      await upsertTermCorpusStats(term, exp.id, 'increment');
      await insertExplanationTerm(exp.id, term);
      termsAdded++;
    }
  }

  return { processed: explanations.length, terms: termsAdded };
}
```

---

## Testing Considerations

1. **Unit tests** for term extraction (bold + noun)
2. **Unit tests** for TF-IDF calculation
3. **Unit tests** for composite scoring
4. **Integration test** for incremental updates (save → stats updated)
5. **Integration test** for delete cascade (delete → stats decremented)
6. **Integration test** with mock LLM responses
7. **E2E test** for full pipeline (can use `skipLlm: true` for CI)

---

## Concurrency & Error Handling Fixes

### Fix 1: Race Conditions in Term Stats Updates

**Problem:** `updateTermStatsOnSave` has no transaction handling. Concurrent saves corrupt counts.

**Solution:** Move entire update logic into a single atomic PostgreSQL function.

```sql
-- Atomic term stats update (replaces multiple TypeScript calls)
CREATE OR REPLACE FUNCTION update_explanation_term_stats(
  p_explanation_id INT,
  p_terms JSONB  -- Array of {term, termLower, source, count}
) RETURNS VOID AS $$
DECLARE
  existing_terms JSONB;
  new_term JSONB;
  term_lower VARCHAR(255);
  old_term RECORD;
BEGIN
  -- Get existing terms for this explanation (single query)
  SELECT jsonb_agg(jsonb_build_object(
    'term_lower', et.term_lower,
    'occurrence_count', et.occurrence_count,
    'is_bold', et.is_bold
  )) INTO existing_terms
  FROM explanation_terms et
  WHERE et.explanation_id = p_explanation_id;

  existing_terms := COALESCE(existing_terms, '[]'::jsonb);

  -- Delete all existing terms for this explanation
  DELETE FROM explanation_terms WHERE explanation_id = p_explanation_id;

  -- Decrement corpus stats for removed terms
  FOR old_term IN
    SELECT * FROM jsonb_to_recordset(existing_terms)
    AS x(term_lower VARCHAR(255), occurrence_count INT, is_bold BOOLEAN)
  LOOP
    UPDATE term_corpus_stats SET
      document_frequency = GREATEST(0, document_frequency - 1),
      total_occurrences = GREATEST(0, total_occurrences - old_term.occurrence_count),
      bold_count = GREATEST(0, bold_count - CASE WHEN old_term.is_bold THEN 1 ELSE 0 END),
      updated_at = NOW()
    WHERE term_corpus_stats.term_lower = old_term.term_lower;
  END LOOP;

  -- Insert new terms and increment corpus stats
  FOR new_term IN SELECT * FROM jsonb_array_elements(p_terms)
  LOOP
    term_lower := new_term->>'termLower';

    -- Insert into explanation_terms
    INSERT INTO explanation_terms (explanation_id, term_lower, occurrence_count, is_bold)
    VALUES (
      p_explanation_id,
      term_lower,
      (new_term->>'count')::INT,
      (new_term->>'source') = 'bold'
    );

    -- Upsert into term_corpus_stats
    INSERT INTO term_corpus_stats (term, term_lower, document_frequency, total_occurrences, bold_count, first_seen_explanation_id)
    VALUES (
      new_term->>'term',
      term_lower,
      1,
      (new_term->>'count')::INT,
      CASE WHEN (new_term->>'source') = 'bold' THEN 1 ELSE 0 END,
      p_explanation_id
    )
    ON CONFLICT (term_lower) DO UPDATE SET
      document_frequency = term_corpus_stats.document_frequency + 1,
      total_occurrences = term_corpus_stats.total_occurrences + (new_term->>'count')::INT,
      bold_count = term_corpus_stats.bold_count + CASE WHEN (new_term->>'source') = 'bold' THEN 1 ELSE 0 END,
      updated_at = NOW();
  END LOOP;

  -- Cleanup zero-doc terms
  DELETE FROM term_corpus_stats WHERE document_frequency <= 0;
END;
$$ LANGUAGE plpgsql;
```

**Updated TypeScript call:**

```typescript
async function updateTermStatsOnSave(
  explanationId: number,
  content: string
): Promise<void> {
  const extractedTerms = extractTermsFromContent(content);

  // Single atomic RPC call - no race conditions
  const { error } = await supabase.rpc('update_explanation_term_stats', {
    p_explanation_id: explanationId,
    p_terms: JSON.stringify(extractedTerms)
  });

  if (error) {
    logger.error('Failed to update term stats', { explanationId, error });
    throw error;
  }
}
```

---

### Fix 2: LLM Error Handling

**Problems:**
- Array length mismatch causes silent corruption
- JSON.parse throws on malformed output
- No retry logic

**Solution:** Use safeParse, validate array length, graceful fallback.

```typescript
import { z } from 'zod';

const candidateEvaluationSchema = z.object({
  decisions: z.array(z.enum(['Y', 'N']))
});

async function evaluateCandidatesWithLLM(
  candidates: ScoredTerm[]
): Promise<{ term: ScoredTerm; approved: boolean }[]> {
  const BATCH_SIZE = 50;
  const MAX_RETRIES = 2;
  const results: { term: ScoredTerm; approved: boolean }[] = [];

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const prompt = createCandidateEvaluationPrompt(
      batch.map(c => ({ term: c.term, docFreq: c.document_frequency, score: c.compositeScore }))
    );

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await callOpenAIModel(
          prompt, 'candidate_evaluation', 'system', 'gpt-4o-mini',
          false, null, candidateEvaluationSchema, 'candidateEvaluation'
        );

        // Safe JSON parse
        let parsed: unknown;
        try {
          parsed = JSON.parse(response);
        } catch (jsonError) {
          throw new Error(`Malformed JSON response: ${response.slice(0, 100)}`);
        }

        // Safe schema validation
        const validated = candidateEvaluationSchema.safeParse(parsed);
        if (!validated.success) {
          throw new Error(`Schema validation failed: ${validated.error.message}`);
        }

        // Validate array length matches input
        if (validated.data.decisions.length !== batch.length) {
          throw new Error(
            `Array length mismatch: expected ${batch.length}, got ${validated.data.decisions.length}`
          );
        }

        // Success - add results
        batch.forEach((candidate, idx) => {
          results.push({ term: candidate, approved: validated.data.decisions[idx] === 'Y' });
        });

        break; // Exit retry loop on success

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn(`LLM evaluation attempt ${attempt + 1} failed`, {
          batchStart: i,
          batchSize: batch.length,
          error: lastError.message
        });

        if (attempt === MAX_RETRIES) {
          // Graceful fallback: reject entire batch on persistent failure
          logger.error('LLM evaluation failed after retries, rejecting batch', {
            batchStart: i,
            batchSize: batch.length
          });
          batch.forEach(candidate => {
            results.push({ term: candidate, approved: false });
          });
        }
      }
    }
  }

  return results;
}
```

---

### Fix 3: Check-then-Insert Race Condition

**Problem:** `getExistingWhitelistTerms()` check before insert allows duplicates under concurrent scans.

**Solution:** Use UPSERT with ON CONFLICT DO NOTHING.

```typescript
async function insertWhitelistTermsAtomic(
  terms: Array<{
    canonical_term: string;
    canonical_term_lower: string;
    standalone_title: string;
    type: string;
  }>
): Promise<{ inserted: number; skipped: number }> {
  if (terms.length === 0) return { inserted: 0, skipped: 0 };

  // Use upsert - duplicates are silently ignored
  const { data, error } = await supabase
    .from('link_whitelist')
    .upsert(
      terms.map(t => ({
        canonical_term: t.canonical_term,
        canonical_term_lower: t.canonical_term_lower,
        standalone_title: t.standalone_title,
        type: t.type,
        is_active: true
      })),
      {
        onConflict: 'canonical_term_lower',
        ignoreDuplicates: true  // Don't error on conflicts
      }
    )
    .select();

  if (error) {
    logger.error('Failed to insert whitelist terms', { error });
    throw error;
  }

  const inserted = data?.length ?? 0;
  return { inserted, skipped: terms.length - inserted };
}

async function insertCandidatesAtomic(
  candidates: Array<{
    term: string;
    term_lower: string;
    occurrence_count: number;
    first_seen_explanation_id: number;
  }>
): Promise<{ inserted: number; skipped: number }> {
  if (candidates.length === 0) return { inserted: 0, skipped: 0 };

  const { data, error } = await supabase
    .from('link_candidates')
    .upsert(
      candidates.map(c => ({
        term: c.term,
        term_lower: c.term_lower,
        occurrence_count: c.occurrence_count,
        first_seen_explanation_id: c.first_seen_explanation_id,
        status: 'pending'
      })),
      {
        onConflict: 'term_lower',
        ignoreDuplicates: true
      }
    )
    .select();

  if (error) {
    logger.error('Failed to insert candidates', { error });
    throw error;
  }

  const inserted = data?.length ?? 0;
  return { inserted, skipped: candidates.length - inserted };
}
```

**Updated scanCorpusForTfIdfCandidates (no auto-approval):**

```typescript
export async function scanCorpusForTfIdfCandidates(options?: {
  minDocFrequency?: number;
  topN?: number;
}): Promise<{ termsScanned: number; candidatesAdded: number }> {
  const { minDocFrequency = 3, topN = 100 } = options ?? {};

  const termStats = await getTermStatsForScoring(minDocFrequency);
  const totalDocs = await getTotalDocumentCount();
  const scored = calculateScores(termStats, totalDocs);

  // Filter out terms already in candidates or whitelist
  const existing = await getExistingTerms();
  const newCandidates = scored
    .filter(t => !existing.has(t.term_lower))
    .slice(0, topN);

  // Insert as TF-IDF candidates (all go to pending_evaluation)
  const result = await insertCandidatesAtomic(
    newCandidates.map(t => ({
      term: t.term,
      term_lower: t.term_lower,
      source: 'tfidf',
      tfidf_score: t.compositeScore,
      first_seen_explanation_id: t.first_seen_explanation_id,
      status: 'pending_evaluation'
    }))
  );

  return {
    termsScanned: termStats.length,
    candidatesAdded: result.inserted
  };
}
```

---

## Summary of Fixes

| Issue | Solution | Pattern Used |
|-------|----------|--------------|
| Race conditions | Single atomic PostgreSQL function | Same as `increment_explanation_saves` in metrics.ts |
| LLM array mismatch | Validate length before processing | Same as `tagEvaluationSchema.safeParse` pattern |
| LLM JSON errors | safeParse + retry loop | Same as existing LLM error handling |
| Check-then-insert | UPSERT with ignoreDuplicates | Same as `ON CONFLICT` in metrics functions |
