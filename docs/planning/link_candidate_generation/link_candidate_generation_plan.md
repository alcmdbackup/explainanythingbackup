# Candidate Generation for Link Whitelist

## Summary

Multi-stage pipeline combining **bold term extraction**, **noun phrase NLP**, **frequency analysis**, **TF-IDF scoring**, and **LLM evaluation** with **auto-approval for top 10%**.

Uses **incremental tracking** via database tables to avoid reprocessing the entire corpus on each scan.

---

## Pipeline Overview

```
[Article Save/Update] → [Extract Terms] → [Update term_corpus_stats]
                                        ↓
[Candidate Scan Request]
        ↓
[Query term_corpus_stats] → Already computed, no extraction needed
        ↓
[TF-IDF + Composite Scoring] → Rank by importance
        ↓
[LLM Evaluation] → Quality filtering
        ↓
[Auto-Approval] → Top 10% → whitelist, rest → pending queue
```

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

## Stage 1: Term Extraction (Unchanged)

Runs once per article save, not on every scan.

```typescript
import nlp from 'compromise';

interface ExtractedTerm {
  term: string;
  termLower: string;
  source: 'bold' | 'noun';
  count: number;  // Occurrences in this doc
}

function extractTermsFromContent(content: string): ExtractedTerm[] {
  const termCounts = new Map<string, ExtractedTerm>();

  // 1. Bold terms (high signal)
  const boldRegex = /\*\*([^*]+)\*\*/g;
  let match;
  while ((match = boldRegex.exec(content)) !== null) {
    const term = match[1].trim();
    const termLower = term.toLowerCase();
    if (termLower.length > 2 && !isStopword(termLower)) {
      const existing = termCounts.get(termLower);
      if (existing) {
        existing.count++;
      } else {
        termCounts.set(termLower, { term, termLower, source: 'bold', count: 1 });
      }
    }
  }

  // 2. Noun phrases via compromise.js
  const plainText = content.replace(/\*\*[^*]+\*\*/g, '');
  const doc = nlp(plainText);
  const nouns = doc.nouns().out('array') as string[];

  for (const noun of nouns) {
    const term = noun.trim();
    const termLower = term.toLowerCase();
    if (termLower.length > 2 && !isStopword(termLower) && term.split(/\s+/).length <= 4) {
      const existing = termCounts.get(termLower);
      if (existing) {
        existing.count++;
      } else {
        termCounts.set(termLower, { term, termLower, source: 'noun', count: 1 });
      }
    }
  }

  return [...termCounts.values()];
}

const STOPWORDS = new Set(['the', 'this', 'that', 'these', 'those', 'example',
  'case', 'way', 'thing', 'time', 'year', 'day', 'number', 'part', 'place',
  'point', 'fact', 'kind', 'type', 'form', 'area', 'level', 'order', 'end']);

function isStopword(term: string): boolean {
  return STOPWORDS.has(term) || term.split(' ').every(w => STOPWORDS.has(w) || w.length <= 2);
}
```

**Dependency:** `npm install compromise` (lightweight, ~200KB)

---

## Stage 2: Incremental Stats Update

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

## Stage 3: TF-IDF + Composite Scoring (Query-Based)

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

## Stage 4: LLM Evaluation

```typescript
export function createCandidateEvaluationPrompt(
  candidates: { term: string; docFreq: number; score: number }[]
): string {
  return `Evaluate terms for an educational encyclopedia's link whitelist.

## Criteria
- **Educational value**: Helps readers learn something useful
- **Standalone concept**: Could be its own article
- **Not too generic**: Avoid "example", "system", "process"
- **Not too specific**: Avoid single-context jargon

## Candidates
${candidates.map((c, i) =>
  `${i + 1}. "${c.term}" (${c.docFreq} articles, score: ${c.score.toFixed(2)})`
).join('\n')}

## Response
For each, respond "Y" (whitelist) or "N" (reject).
JSON: {"decisions": ["Y", "N", "Y", ...]}`;
}

const candidateEvaluationSchema = z.object({
  decisions: z.array(z.enum(['Y', 'N']))
});

async function evaluateCandidatesWithLLM(
  candidates: ScoredTerm[]
): Promise<{ term: ScoredTerm; approved: boolean }[]> {
  const BATCH_SIZE = 50;
  const results: { term: ScoredTerm; approved: boolean }[] = [];

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const prompt = createCandidateEvaluationPrompt(
      batch.map(c => ({ term: c.term, docFreq: c.document_frequency, score: c.compositeScore }))
    );

    const response = await callOpenAIModel(
      prompt, 'candidate_evaluation', 'system', 'gpt-4.1-mini',
      false, null, candidateEvaluationSchema, 'candidateEvaluation'
    );

    const parsed = candidateEvaluationSchema.parse(JSON.parse(response));
    batch.forEach((candidate, idx) => {
      results.push({ term: candidate, approved: parsed.decisions[idx] === 'Y' });
    });
  }

  return results;
}
```

---

## Stage 5: Auto-Approval Logic

```typescript
interface ScanResult {
  termsInCorpus: number;
  termsAboveThreshold: number;
  llmApproved: number;
  autoApproved: number;
  addedToPending: number;
}

export async function scanCorpusForCandidates(options?: {
  minDocFrequency?: number;    // Default: 3
  topNForLlm?: number;         // Default: 100
  autoApprovePercent?: number; // Default: 10 (top 10%)
}): Promise<ScanResult> {
  const {
    minDocFrequency = 3,
    topNForLlm = 100,
    autoApprovePercent = 10
  } = options ?? {};

  // Query pre-computed stats (fast!)
  const termStats = await getTermStatsForScoring(minDocFrequency);
  const totalDocs = await getTotalDocumentCount();

  // Score and rank
  const scored = calculateScores(termStats, totalDocs);
  const topCandidates = scored.slice(0, topNForLlm);

  // LLM evaluation
  const evaluated = await evaluateCandidatesWithLLM(topCandidates);
  const approved = evaluated.filter(e => e.approved);

  // Auto-approve top 10%
  const autoApproveCount = Math.ceil(approved.length * autoApprovePercent / 100);
  const autoApproved = approved.slice(0, autoApproveCount);
  const pending = approved.slice(autoApproveCount);

  // Skip existing whitelist terms
  const existing = await getExistingWhitelistTerms();

  // Insert auto-approved → whitelist
  let autoApprovedCount = 0;
  for (const { term } of autoApproved) {
    if (!existing.has(term.term_lower)) {
      await insertWhitelistTerm({
        canonical_term: term.term,
        canonical_term_lower: term.term_lower,
        standalone_title: term.term,
        type: 'term',
        is_active: true
      });
      autoApprovedCount++;
    }
  }

  // Insert pending → candidates queue
  let pendingCount = 0;
  for (const { term } of pending) {
    if (!existing.has(term.term_lower)) {
      await insertCandidate({
        term: term.term,
        term_lower: term.term_lower,
        occurrence_count: term.total_occurrences,
        first_seen_explanation_id: term.first_seen_explanation_id,
        status: 'pending'
      });
      pendingCount++;
    }
  }

  return {
    termsInCorpus: termStats.length,
    termsAboveThreshold: topCandidates.length,
    llmApproved: approved.length,
    autoApproved: autoApprovedCount,
    addedToPending: pendingCount
  };
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
| `supabase/migrations/xxx_term_tracking.sql` | NEW - Tables + functions |
| `/src/lib/services/termTracking.ts` | NEW - Incremental update logic |
| `/src/lib/services/linkCandidates.ts` | NEW - Scan + scoring + LLM eval |
| `/src/lib/services/explanations.ts` | MODIFY - Call termTracking on save |
| `/src/lib/prompts.ts` | Add `createCandidateEvaluationPrompt` |
| `/src/lib/schemas/schemas.ts` | Add schemas |
| `/src/actions/actions.ts` | Add `scanCorpusForCandidatesAction` |
| `package.json` | Add `compromise` dependency |

---

## Configuration

```typescript
const CANDIDATE_CONFIG = {
  MIN_DOC_FREQUENCY: 3,
  TOP_N_FOR_LLM: 100,
  AUTO_APPROVE_PERCENT: 10,
  COMPOSITE_WEIGHTS: {
    tfIdf: 0.35,
    docFreq: 0.25,
    boldCount: 0.25,
    totalOccur: 0.15
  },
  BATCH_SIZE: 50
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
