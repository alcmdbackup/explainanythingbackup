# Versioned Articles with Document + Block DAGs

## Overview

This design separates versioning at **two layers**:

* **Document DAG**: article-level revisions (commits) and merges.
* **Block DAG**: fine-grained paragraph/sentence lineage and edit provenance across articles.

Together, they let you: (1) do git-style merges/diffs at the article level, and (2) trace which exact paragraphs came from where—even after edits, splits, and concatenations.

---

# Components

## Document DAG (article revisions & merges)

* **Definition**: Each article revision is a node; edges point to its parent revisions (single-parent for linear edits, multi-parent for merges).
* **Payload**: An article revision is an **ordered list of block refs with metadata** (title, tags, author, timestamp, etc.).
* **Merge semantics**: If you “merge 50% of A and 50% of B” to make C:

  * Create `rev_C` with `parent_rev_ids = [rev_A, rev_B]`.
  * Populate `rev_C.blocks` by selecting blocks (or edited derivatives) from both lineages.

### Minimal example

```json
{
  "rev_id": "rev_C",
  "parent_rev_ids": ["rev_A", "rev_B"],
  "metadata": { "editor": "abel", "ts": "2025-10-07T01:23:45Z" },
  "blocks": [
    { "block_id": "blk_x1", "attrs": {"role":"intro"} },
    { "block_id": "blk_y2_prime", "attrs": {"role":"body"} }
  ]
}
```

---

## Block DAG (paragraph/sentence provenance)

* **Chunking**: Split articles into **stable units** (paragraphs or sentences). Choose the smallest unit you need to track/merge reliably (sentences = more granular merges; paragraphs = faster, fewer IDs).
* **IDs**: Each block is stored **CAS-style**:
  `block_id = hash(norm_text)` (where `norm_text` applies normalization, e.g., Unicode NFC, trimmed whitespace, normalized quotes).
* **Edges**: Track transformations between blocks:

  * Edit: if block `B'` is an edited derivative of `B`, add
    `EDGE: B → B'  (op="edit", sim=0.91, mapping=range_map)`
  * Split/concatenate: record **multiple parents** for a child block (or children for a parent).

### Minimal edge examples

```json
[
  { "src": "blk_b", "dst": "blk_b_prime", "op": "edit", "sim": 0.91,
    "mapping": [{"src":[0,120], "dst":[0,118]}] },

  { "src": "blk_p", "dst": "blk_q1", "op": "split" },
  { "src": "blk_p", "dst": "blk_q2", "op": "split" },

  { "src": "blk_a1", "dst": "blk_c", "op": "concat" },
  { "src": "blk_a2", "dst": "blk_c", "op": "concat" }
]
```

---

# How the two DAGs work together

* The **Document DAG** says *which blocks* (by ID) appear in each revision and in what order.
* The **Block DAG** explains *how those blocks came to be*: edits, splits, merges, and cross-article reuse.
* A merge at the document level chooses or synthesizes a sequence of blocks; each chosen/edited block updates the Block DAG so provenance remains traceable.

---

# Storage & schema sketch

## Content-addressed storage

* **Blocks**: store `block_id → normalized_text + metadata`.
* **Revisions**: store `rev_id → { parent_rev_ids[], blocks[], metadata }`.

## Relational tables (minimal)

```sql
-- Article heads (document-level entry point)
CREATE TABLE article_heads (
  article_id BIGINT PRIMARY KEY,
  head_rev_id TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Revisions (Document DAG)
CREATE TABLE revisions (
  rev_id TEXT PRIMARY KEY,
  parent_rev_ids TEXT[] NOT NULL,
  article_id BIGINT NOT NULL,
  metadata JSONB NOT NULL,
  blocks TEXT[] NOT NULL                 -- ordered block_ids
);

-- Blocks (Block DAG nodes)
CREATE TABLE blocks (
  block_id TEXT PRIMARY KEY,
  norm_text TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'
);

-- Block lineage (Block DAG edges)
CREATE TABLE block_edges (
  src_block_id TEXT NOT NULL,
  dst_block_id TEXT NOT NULL,
  op TEXT NOT NULL,                      -- 'edit' | 'split' | 'concat' | ...
  sim REAL,                              -- optional similarity score
  mapping JSONB,                         -- optional range map
  PRIMARY KEY (src_block_id, dst_block_id)
);
```

---

# Core operations

## Write/edit a revision

1. Load current head: `head_rev_id`.
2. Diff old vs new text to propose block operations (reuse existing blocks where hashes match; create new blocks for changes).
3. Write new/edited blocks (CAS).
4. Insert `revisions` row with `parent_rev_ids=[head_rev_id]` and ordered `blocks`.
5. Insert `block_edges` for edits/splits/concats.
6. Update `article_heads.head_rev_id` (optimistic concurrency).

## Merge two revisions (A, B → C)

1. Align A.blocks vs B.blocks (paragraph or sentence level).
2. Decide per-span: pick A, pick B, or synthesize edit (producing new block(s)).
3. Create `rev_C` with `parent_rev_ids=[rev_A, rev_B]`.
4. Emit `block_edges` for any newly synthesized/edit blocks to preserve provenance.

## Read & provenance queries

* **Show article**: fetch `article_heads.head_rev_id` → `revisions.blocks` → render `blocks.norm_text` in order.
* **Where did this paragraph come from?** Walk incoming edges to find ancestors (across articles).
* **Who reused my text?** Walk outgoing edges from a canonical block to its descendants.

---

# Practical guidance & context

* **Chunk size trade-off**: Sentences give precise provenance and merge control but increase IDs/edges; paragraphs are cheaper but blur fine edits.
* **Hash stability**: Normalize text (whitespace, punctuation, Unicode) **before hashing** to avoid spurious new IDs for trivial changes.
* **Similarity & mapping**: Store a lightweight similarity (`sim`) and optional `range_map` for edits so you can later re-compute or improve diffs without re-parsing raw text.
* **Cross-article lineage**: The Block DAG is global; the same `block_id` can be referenced by multiple articles/revisions, and edits can cross article boundaries.
* **GC & durability**: Since revisions reference blocks by ID, a simple mark-and-sweep (reachable from all heads) keeps storage compact. Keep a safety window before pruning orphaned blocks/edges.
* **Indexing**: Add GIN indexes on `revisions.blocks` and JSONB fields you query (e.g., tags) for fast lookups; consider a search index for full-text content.

---

# Glossary

* **Document DAG**: Graph of article revisions (nodes) and parent links (edges), supporting merges.
* **Block DAG**: Graph of paragraph/sentence nodes with edges representing transformations (edit/split/concat) and similarity.
* **CAS (Content-Addressed Storage)**: Objects are addressed by a hash of (normalized) content, enabling deduplication and integrity checks.
* **Provenance**: The lineage of a block—where it came from, how it changed, and where it went.
