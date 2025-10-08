## 🧠 Goal

Design a **simplified article scoring system** where each article inherits credit from its immediate predecessor while maintaining **single-parameter simplicity** for rapid A/B testing.

---

## 1. **Core Scoring Model**

```
S_v = own_score_v + (inheritance_rate * similarity_factor * S_parent)
```

* **own_score_v** – direct engagement metrics (views, time on page, CTR, votes, etc.)
* **S_parent** – final score of immediate parent article (if any)
* **inheritance_rate** – global tunable parameter (e.g., 0.5)
* **similarity_factor** – content similarity between article and parent (0.0 to 1.0)

Computed in **topological order** (parents before children).

---

## 2. **Computing Similarity Factor**

**Shingle-Based Approach** (recommended for accuracy):
1. **Tokenize both articles** into 5-8 word shingles
2. **Find shared shingles** using rolling hash or exact matching
3. **Compute coverage**: `similarity_factor = shared_tokens / total_tokens_child`

**Sentence-Based Approach** (simpler, semantic):
1. **Split articles into sentences**
2. **Compute sentence embeddings** (e.g., sentence-transformers)
3. **Find best matches** using cosine similarity > threshold (e.g., 0.8)
4. **Compute coverage**: `similarity_factor = matched_sentences / total_sentences_child`

**Hybrid Strategy**:
- Use sentence embeddings to find candidate alignments (fast, semantic)
- Use shingles for precise similarity scoring within aligned regions

---

## 3. **Key Design Decisions**

**Two Parameters**: `inheritance_rate` (global) + `similarity_factor` (per-article)
- `inheritance_rate`: Easy to A/B test globally
- `similarity_factor`: Computed once per article, cached
- Start with inheritance_rate = 0.5

**Direct Parent Only**: No multiple parents, inherit only from immediate parent
- Maintains simplicity while adding content awareness
- Inheritance flows naturally through chains weighted by similarity
- Avoids complex multi-parent weighting

**Standard Metrics**: Use existing engagement metrics for `own_score`
- Views, time on page, click-through rate, user votes
- No need to invent complex quality measures
- Leverage proven behavioral signals

---

## 4. **Computation Details**

* Process articles in **topological order** (roots → leaves) so parent scores are available
* Root articles: `S_root = own_score_root` (no inheritance)
* Derived articles: `S_v = own_score_v + (inheritance_rate * similarity_factor * S_parent)`
* Cache similarity factors (computed once per article)
* Cache scores to avoid recomputation when inheritance_rate changes

---

## 5. **Benefits for A/B Testing at Scale**

**Fast Bootstrapping**: New article variants immediately get baseline score from parent + inheritance
- No need to wait for sufficient direct feedback
- Enables testing many variations quickly

**Comparable Scores**: All variants in same lineage have similar score ranges
- Fair comparison between alternatives
- Reduces variance in experiments

**Quick Iteration**: Change `inheritance_rate` globally to test inheritance strength
- Single parameter to experiment with
- Easy rollback if experiments fail

**Statistical Power**: Pool engagement data across lineage for faster significance
- Related articles share some signal
- Faster convergence to statistical significance

---

## 6. **Simple Implementation Schema**

```sql
-- Minimal schema addition
ALTER TABLE articles ADD COLUMN (
  parent_id BIGINT REFERENCES articles(id),  -- single parent only
  own_score REAL DEFAULT 0,                  -- from engagement metrics
  similarity_factor REAL DEFAULT 0,          -- cached similarity to parent
  inherited_score REAL DEFAULT 0,            -- cached, recomputed when parent changes
  final_score REAL GENERATED ALWAYS AS (own_score + inherited_score)
);

-- Index for topological traversal
CREATE INDEX idx_articles_parent ON articles(parent_id) WHERE parent_id IS NOT NULL;
```

**Recomputation**:
- `similarity_factor`: Computed once when article is created (shingle/sentence analysis)
- `inherited_score`: When `inheritance_rate` changes or parent scores update, traverse affected subtrees

---

**End result:**
A **simplified yet content-aware** scoring framework where each article's score reflects:

* Its **own engagement** (`own_score`)
* **Inherited reputation** weighted by content similarity (`inheritance_rate * similarity_factor * parent_score`)

This balances simplicity (2 parameters) with content awareness, ensuring inheritance is proportional to actual content overlap. Perfect for rapid experimentation and A/B testing at scale while preventing gaming through unrelated forks.
