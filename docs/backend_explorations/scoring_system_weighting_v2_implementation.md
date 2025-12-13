# Scoring System Weighting V2: Technical Implementation Plan

## Overview
Implement the SAF (Similarity-Adjusted Feedback) scoring system to enable lineage-based scoring with exploration bonuses, leveraging existing vector similarity infrastructure and metrics system.

## Database Schema Changes

### New Tables
```sql
-- Article lineage tracking
CREATE TABLE explanation_lineage (
  id SERIAL PRIMARY KEY,
  explanation_id INTEGER REFERENCES explanations(id),
  parent_explanation_id INTEGER REFERENCES explanations(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Cached similarity scores using shingles/minhash
CREATE TABLE explanation_similarity_cache (
  id SERIAL PRIMARY KEY,
  current_explanation_id INTEGER REFERENCES explanations(id),
  ancestor_explanation_id INTEGER REFERENCES explanations(id),
  similarity_score DECIMAL(5,4) NOT NULL, -- 0.0000 to 1.0000
  similarity_method VARCHAR(50) DEFAULT 'minhash_jaccard',
  computed_at TIMESTAMP DEFAULT NOW(),
  content_hash_current TEXT, -- For cache invalidation
  content_hash_ancestor TEXT,
  UNIQUE(current_explanation_id, ancestor_explanation_id)
);

-- Enhanced scoring data
CREATE TABLE explanation_scores (
  id SERIAL PRIMARY KEY,
  explanation_id INTEGER REFERENCES explanations(id) UNIQUE,
  base_score DECIMAL(6,2) NOT NULL, -- 0-100 scale
  exploration_bonus DECIMAL(6,2) DEFAULT 0,
  final_score DECIMAL(6,2) NOT NULL,
  total_saf DECIMAL(10,4) NOT NULL,
  uncertainty_weight DECIMAL(4,3) DEFAULT 0.3,
  last_computed TIMESTAMP DEFAULT NOW()
);
```

## Core Services Implementation

### 1. Similarity Service (`src/lib/services/similarity.ts`)
```typescript
// Fast shingle-based similarity using existing patterns
export async function computeSimilarity(currentId: number, ancestorId: number): Promise<number>
export async function batchComputeSimilarities(currentId: number, ancestorIds: number[]): Promise<Map<number, number>>
export async function generateContentHash(content: string): Promise<string>
export async function invalidateSimilarityCache(explanationId: number): Promise<void>
```

### 2. Lineage Service (`src/lib/services/lineage.ts`)
```typescript
// Manage explanation ancestry chains
export async function createLineageLink(explanationId: number, parentId: number): Promise<void>
export async function getLineageChain(explanationId: number): Promise<number[]>
export async function updateLineageOnEdit(explanationId: number): Promise<void>
```

### 3. Scoring Service (`src/lib/services/scoring.ts`)
```typescript
// SAF scoring implementation
export async function computeExplanationScore(explanationId: number): Promise<ExplanationScore>
export async function batchComputeScores(explanationIds: number[]): Promise<ExplanationScore[]>
export async function refreshScoresForLineage(explanationId: number): Promise<void>
```

## Integration Points

### Existing Metrics Service Enhancement
- Extend `src/lib/services/metrics.ts` to include SAF feedback counting
- Leverage existing `explanation_metrics` table for feedback data
- Reuse patterns from `incrementExplanationViews/Saves`

### Vector Similarity Integration
- Optionally use existing `src/lib/services/vectorsim.ts` for initial similarity bootstrap
- Primary similarity via fast shingle/MinHash for performance
- Cache OpenAI embedding similarities for fallback

### API Routes
```typescript
// New endpoints following existing patterns
POST /api/scoring/compute-scores  // Batch score computation
POST /api/scoring/refresh-lineage // Refresh specific lineage
GET  /api/scoring/explanation/:id // Get score details
```

## Shingle Similarity Implementation

### Fast Similarity Algorithm
```typescript
// Using existing browser-compatible libraries
import { MinHash } from 'minhash';

export class ShingleSimilarity {
  static generateShingles(text: string, k: number = 3): Set<string>
  static createMinHashSignature(shingles: Set<string>): MinHash
  static computeJaccardSimilarity(sig1: MinHash, sig2: MinHash): number
}
```

### Performance Optimizations
- Cache MinHash signatures per explanation
- Batch similarity computations
- Background score refresh jobs
- Invalidate only affected lineages on content changes

## Schema Integration

### Enhanced Schemas (`src/lib/schemas/schemas.ts`)
```typescript
export const explanationScoreSchema = z.object({
  explanation_id: z.number(),
  base_score: z.number().min(0).max(100),
  exploration_bonus: z.number().min(0),
  final_score: z.number().min(0),
  total_saf: z.number().min(0),
  uncertainty_weight: z.number().min(0).max(1)
});

export const lineageSchema = z.object({
  explanation_id: z.number(),
  parent_explanation_id: z.number()
});
```

## Background Jobs & Maintenance

### Score Refresh Pipeline
```typescript
// Extend existing patterns from metrics service
export async function refreshScoresBackground(): Promise<void>
export async function scheduleLineageRefresh(explanationId: number): Promise<void>
```

### Cache Management
- TTL-based cache invalidation
- Content hash comparison for staleness detection
- Batch refresh during low-traffic periods

## Testing Strategy

### Unit Tests
- Shingle similarity accuracy tests
- SAF calculation validation
- Wilson interval bonus computation
- Cache invalidation logic

### Integration Tests
- End-to-end scoring pipeline
- Lineage chain updates
- Performance under load

## Deployment Phases

### Phase 1: Infrastructure
1. Database migrations
2. Core similarity service
3. Basic lineage tracking

### Phase 2: Scoring Engine
1. SAF computation service
2. Wilson exploration bonus
3. Score caching & refresh

### Phase 3: Integration
1. API endpoints
2. Frontend score display
3. Background refresh jobs

## Performance Considerations

- **Similarity computations**: O(1) with MinHash caching
- **Lineage queries**: Indexed ancestry chains
- **Score refresh**: Async background processing
- **Database load**: Batch operations and connection pooling

## Monitoring & Analytics

### Key Metrics
- Score computation latency
- Cache hit rates
- Similarity accuracy vs embeddings
- Exploration bonus effectiveness

### Existing Infrastructure Integration
- Leverage existing logging patterns
- Extend OpenTelemetry tracing
- Use current error handling approaches

---

**Implementation time estimate**: 2-3 weeks following existing architectural patterns and reusing current infrastructure for maximum compatibility and maintainability.