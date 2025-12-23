# Vector Search & Embedding

## Overview

Vector search enables semantic similarity matching using OpenAI embeddings stored in Pinecone. Content is chunked, embedded, and indexed for fast retrieval based on meaning rather than keywords.

## Implementation

### Key Files
- `src/lib/services/vectorsim.ts` - All vector operations

### Configuration

| Setting | Value |
|---------|-------|
| Model | `text-embedding-3-large` |
| Dimensions | 3072 |
| Batch Size | 100 vectors |
| Concurrent Batches | 3 |

### Main Functions

| Function | Purpose |
|----------|---------|
| `findMatchesInVectorDb()` | Complete query: embed text + search |
| `searchForSimilarVectors()` | Search Pinecone for similar vectors |
| `processContentToStoreEmbedding()` | Process markdown → chunks → embeddings → store |
| `calculateAllowedScores()` | Compute relevance scores from matches |
| `loadFromPineconeUsingExplanationId()` | Retrieve vector by explanation ID |

### Embedding Storage

Each vector includes metadata:
```typescript
{
  text: string,           // Chunk content
  startIdx: number,       // Position in original
  length: number,         // Chunk length
  explanation_id: string,
  topic_id: string,
  isAnchor: boolean,      // Anchor set membership
  anchorSet: string       // Anchor set identifier
}
```

### Score Calculation

```typescript
// Anchor score: sum of similarities / max anchors
anchorScore = sum(anchorSimilarities) / maxNumberAnchors;

// Explanation score: avg of top 3, padded with 0s
explanationScore = avg(top3Scores);

// Combined score
averageScore = (anchorScore + explanationScore) / 2;

// Title allowed if anchor score >= 0
allowedTitle = anchorScore >= 0;
```

### Chunking Strategy

The `splitTextWithMetadata()` function:
1. Splits text into manageable chunks
2. Tracks position in original content
3. Preserves metadata for reconstruction

## Usage

### Searching for Similar Content

```typescript
import { findMatchesInVectorDb } from '@/lib/services/vectorsim';

const matches = await findMatchesInVectorDb(
  query,           // Text to search for
  isAnchor,        // Filter by anchor flag
  anchorSet,       // Filter by anchor set
  topK,            // Number of results (default: 5)
  namespace        // Pinecone namespace (default: 'default')
);
```

### Storing New Content

```typescript
import { processContentToStoreEmbedding } from '@/lib/services/vectorsim';

const result = await processContentToStoreEmbedding(
  markdown,        // Content to embed
  explanation_id,  // Associated explanation
  topic_id,        // Associated topic
  debug,           // Debug mode flag
  namespace        // Pinecone namespace
);

// Result
{ success: boolean, chunkCount: number, namespace: string }
```

### Calculating Match Quality

```typescript
import { calculateAllowedScores } from '@/lib/services/vectorsim';

const scores = calculateAllowedScores(anchorMatches, explanationMatches);
// { anchorScore, explanationScore, allowedTitle }
```

### Loading Existing Vector

```typescript
import { loadFromPineconeUsingExplanationId } from '@/lib/services/vectorsim';

const vector = await loadFromPineconeUsingExplanationId(
  explanationId,
  namespace
);
```
