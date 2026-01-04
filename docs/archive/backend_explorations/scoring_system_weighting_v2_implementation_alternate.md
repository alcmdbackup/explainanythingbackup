# Scoring System Weighting V2: Technical Implementation Plan

## Overview

This document outlines the technical implementation plan for the Similarity-Adjusted-Feedback (SAF) scoring system described in `scoring_system_weighting_v2.md`. The system enables articles to inherit scores from ancestors based on content similarity and feedback volume.

## Core Architecture

### 1. Database Schema Extensions

**New Tables:**
```sql
-- Article lineage relationships
CREATE TABLE explanation_lineage (
  id BIGSERIAL PRIMARY KEY,
  child_id BIGINT NOT NULL REFERENCES explanations(id) ON DELETE CASCADE,
  parent_id BIGINT NOT NULL REFERENCES explanations(id) ON DELETE CASCADE,
  similarity_score REAL NOT NULL CHECK (similarity_score >= 0 AND similarity_score <= 1),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(child_id, parent_id)
);

-- SAF cache for performance
CREATE TABLE explanation_saf_cache (
  id BIGSERIAL PRIMARY KEY,
  current_explanation_id BIGINT NOT NULL REFERENCES explanations(id) ON DELETE CASCADE,
  ancestor_explanation_id BIGINT NOT NULL REFERENCES explanations(id) ON DELETE CASCADE,
  saf_value REAL NOT NULL CHECK (saf_value >= 0),
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(current_explanation_id, ancestor_explanation_id)
);

-- Computed scores cache
CREATE TABLE explanation_computed_scores (
  id BIGSERIAL PRIMARY KEY,
  explanation_id BIGINT NOT NULL REFERENCES explanations(id) ON DELETE CASCADE UNIQUE,
  base_score REAL NOT NULL DEFAULT 0,
  exploration_bonus REAL NOT NULL DEFAULT 0,
  final_score REAL NOT NULL DEFAULT 0,
  total_saf REAL NOT NULL DEFAULT 0,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**Schema Updates:**
```sql
-- Add scoring fields to existing explanations table
ALTER TABLE explanations ADD COLUMN IF NOT EXISTS
  individual_score REAL DEFAULT 0; -- Base quality score before lineage weighting

-- Add feedback count tracking
ALTER TABLE explanationMetrics ADD COLUMN IF NOT EXISTS
  feedback_count INTEGER DEFAULT 0; -- Total interaction count for SAF calculation
```

### 2. New Service Layer Components

#### A. Lineage Service (`/lib/services/lineage.ts`)

**Core Functions:**
- `createLineageRelationship(childId, parentId, similarityScore)` - Establish parent-child relationship
- `getLineageAncestors(explanationId)` - Get all ancestors with similarity scores
- `calculateContentSimilarity(childId, parentId)` - Compute semantic similarity using existing vector infrastructure
- `validateLineageIntegrity()` - Prevent cycles and ensure valid relationships

**Key Implementation:**
```typescript
export async function calculateContentSimilarity(
  childId: number,
  parentId: number
): Promise<number> {
  // Leverage existing vectorsim.ts infrastructure
  const childVector = await loadFromPineconeUsingExplanationId(childId);
  const parentVector = await loadFromPineconeUsingExplanationId(parentId);

  if (!childVector?.values || !parentVector?.values) {
    throw new Error('Missing vector embeddings for similarity calculation');
  }

  // Cosine similarity calculation
  return calculateCosineSimilarity(childVector.values, parentVector.values);
}
```

#### B. SAF Service (`/lib/services/saf.ts`)

**Core Functions:**
- `calculateSAF(currentId, ancestorId)` - Compute SAF for explanation pair
- `calculateLineageSAF(explanationId)` - Get SAF values for all ancestors
- `refreshSAFCache(explanationId)` - Update cached SAF values
- `getTotalSAF(explanationId)` - Sum all SAF values in lineage

**Key Implementation:**
```typescript
export async function calculateSAF(
  currentId: number,
  ancestorId: number
): Promise<number> {
  // Get similarity from lineage table
  const similarity = await getLineageSimilarity(currentId, ancestorId);

  // Get feedback count from metrics
  const metrics = await getExplanationMetrics(ancestorId);
  const feedbackCount = metrics?.feedback_count || 0;

  // SAF = similarity * feedback_count
  return similarity * feedbackCount;
}

export async function calculateLineageSAF(explanationId: number): Promise<{
  ancestors: Array<{id: number, saf: number, similarity: number, feedback: number}>,
  totalSAF: number
}> {
  const ancestors = await getLineageAncestors(explanationId);
  const results = [];
  let totalSAF = 0;

  // Include current explanation with similarity = 1.0
  const currentMetrics = await getExplanationMetrics(explanationId);
  const currentSAF = 1.0 * (currentMetrics?.feedback_count || 0);
  results.push({
    id: explanationId,
    saf: currentSAF,
    similarity: 1.0,
    feedback: currentMetrics?.feedback_count || 0
  });
  totalSAF += currentSAF;

  // Calculate SAF for each ancestor
  for (const ancestor of ancestors) {
    const saf = await calculateSAF(explanationId, ancestor.id);
    results.push({
      id: ancestor.id,
      saf,
      similarity: ancestor.similarity,
      feedback: ancestor.feedback_count || 0
    });
    totalSAF += saf;
  }

  return { ancestors: results, totalSAF };
}
```

#### C. Wilson Intervals Service (`/lib/services/wilson.ts`)

**Core Functions:**
- `calculateWilsonBounds(positive, negative, confidence)` - Wilson confidence interval calculation
- `calculateExplorationBonus(baseScore, totalSAF, uncertaintyWeight)` - Exploration bonus using Wilson intervals

**Key Implementation:**
```typescript
export function calculateWilsonBounds(
  positive: number,
  negative: number,
  confidence: number = 0.95
): { lower: number, upper: number } {
  const n = positive + negative;
  if (n === 0) return { lower: 0, upper: 1 };

  const z = getZScore(confidence); // 1.96 for 95%
  const p = positive / n;

  const denominator = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denominator;
  const margin = (z / denominator) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));

  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin)
  };
}

export function calculateExplorationBonus(
  baseScore: number,
  totalSAF: number,
  uncertaintyWeight: number = 0.3
): number {
  const estimatedQuality = baseScore / 100; // Convert 0-100 to 0-1
  const effectivePositive = totalSAF * estimatedQuality;
  const effectiveNegative = totalSAF * (1 - estimatedQuality);

  const bounds = calculateWilsonBounds(effectivePositive, effectiveNegative);
  return uncertaintyWeight * (bounds.upper - bounds.lower);
}
```

#### D. Unified Scoring Service (`/lib/services/safScoring.ts`)

**Core Functions:**
- `calculateExplanationScore(explanationId)` - Complete score calculation
- `refreshExplanationScores(explanationIds)` - Bulk score updates
- `getExplanationScoreBreakdown(explanationId)` - Detailed score analysis

**Key Implementation:**
```typescript
export async function calculateExplanationScore(explanationId: number): Promise<{
  baseScore: number,
  explorationBonus: number,
  finalScore: number,
  totalSAF: number,
  weights: Array<{ancestorId: number, weight: number, score: number}>
}> {
  // Get lineage SAF values
  const { ancestors, totalSAF } = await calculateLineageSAF(explanationId);

  if (totalSAF === 0) {
    return {
      baseScore: 0,
      explorationBonus: 0,
      finalScore: 0,
      totalSAF: 0,
      weights: []
    };
  }

  // Calculate weighted base score
  let weightedScoreSum = 0;
  const weights = [];

  for (const ancestor of ancestors) {
    const weight = ancestor.saf / totalSAF;
    const ancestorScore = await getIndividualScore(ancestor.id);
    weightedScoreSum += ancestorScore * weight;

    weights.push({
      ancestorId: ancestor.id,
      weight,
      score: ancestorScore
    });
  }

  const baseScore = weightedScoreSum;

  // Calculate exploration bonus
  const explorationBonus = calculateExplorationBonus(baseScore, totalSAF);

  const finalScore = baseScore + explorationBonus;

  // Cache the result
  await updateComputedScoresCache(explanationId, {
    baseScore,
    explorationBonus,
    finalScore,
    totalSAF
  });

  return { baseScore, explorationBonus, finalScore, totalSAF, weights };
}
```

### 3. Integration with Existing Systems

#### A. Metrics Service Updates (`/lib/services/metrics.ts`)

**Enhanced Functions:**
- Update `incrementExplanationViews()` to also increment feedback_count
- Update `incrementExplanationSaves()` to also increment feedback_count
- Add `refreshSAFDependentScores(explanationId)` to update scores when feedback changes

#### B. Vector Similarity Integration

**Leverage Existing Infrastructure:**
- Use `loadFromPineconeUsingExplanationId()` for content similarity calculations
- Extend vector metadata to include lineage information
- Cache similarity calculations to avoid expensive recomputation

#### C. API Route Updates

**New Routes:**
- `POST /api/lineage/create` - Create parent-child relationship
- `GET /api/scoring/explanation/:id` - Get detailed score breakdown
- `POST /api/scoring/refresh` - Refresh scores for explanation set

**Updated Routes:**
- Enhance existing explanation routes to include SAF scores
- Update search/ranking to use new unified scores

### 4. Performance Optimizations

#### A. Caching Strategy

**Multi-Level Caching:**
```typescript
// 1. SAF values cache (explanation_saf_cache table)
// 2. Computed scores cache (explanation_computed_scores table)
// 3. In-memory caching for frequently accessed lineages
// 4. Redis caching for real-time score lookups

class SAFCacheManager {
  async getSAFValue(currentId: number, ancestorId: number): Promise<number> {
    // Check in-memory cache first
    // Then database cache
    // Finally compute and cache
  }

  async invalidateLineage(explanationId: number): Promise<void> {
    // Invalidate all cached values for explanation and descendants
  }
}
```

#### B. Batch Processing

**Bulk Operations:**
- Batch SAF calculations for lineage chains
- Bulk score updates when feedback changes
- Background processing for large lineage refreshes

#### C. Database Optimizations

**Indexes:**
```sql
-- Lineage traversal optimization
CREATE INDEX idx_lineage_child ON explanation_lineage(child_id);
CREATE INDEX idx_lineage_parent ON explanation_lineage(parent_id);

-- SAF cache optimization
CREATE INDEX idx_saf_current ON explanation_saf_cache(current_explanation_id);
CREATE INDEX idx_saf_ancestor ON explanation_saf_cache(ancestor_explanation_id);

-- Score lookup optimization
CREATE INDEX idx_computed_scores_updated ON explanation_computed_scores(last_updated);
```

### 5. Migration & Deployment Strategy

#### A. Database Migration

**Phase 1: Schema Setup**
```sql
-- Create new tables with constraints
-- Add new columns to existing tables
-- Create indexes for performance
```

**Phase 2: Data Population**
```sql
-- Populate feedback_count from existing userExplanationEvents
-- Initialize individual_score from existing metrics
-- Create initial lineage relationships (if any exist)
```

#### B. Service Deployment

**Phase 1: Infrastructure**
- Deploy new service modules
- Set up caching infrastructure
- Configure monitoring

**Phase 2: Integration**
- Update existing services to use new scoring
- Migrate API routes
- Update frontend components

#### C. Testing Strategy

**Unit Tests:**
- SAF calculation accuracy
- Wilson interval calculations
- Lineage relationship validation

**Integration Tests:**
- End-to-end score calculation
- Performance under load
- Cache invalidation scenarios

**A/B Testing:**
- Gradual rollout with uncertainty_weight parameter tuning
- Compare against existing scoring metrics
- Monitor for performance impact

### 6. Monitoring & Observability

#### A. Key Metrics

**Performance Metrics:**
- SAF calculation latency
- Score computation time
- Cache hit rates
- Database query performance

**Business Metrics:**
- Score distribution changes
- Lineage relationship patterns
- Exploration bonus effectiveness
- User engagement correlation

#### B. Alerting

**Critical Alerts:**
- SAF calculation failures
- Score computation timeouts
- Cache invalidation errors
- Lineage cycle detection

#### C. Dashboards

**Operational Dashboard:**
- Real-time scoring performance
- Cache utilization
- Error rates and response times

**Business Dashboard:**
- Score distribution analysis
- Lineage relationship insights
- A/B testing results

### 7. Implementation Timeline

**Week 1: Foundation**
- Database schema implementation
- Core service skeleton (lineage, SAF, wilson)
- Unit test framework setup

**Week 2: Core Logic**
- SAF calculation implementation
- Wilson intervals service
- Basic lineage management

**Week 3: Integration**
- Unified scoring service
- Metrics service updates
- Caching implementation

**Week 4: API & Testing**
- API route implementation
- Integration testing
- Performance optimization

**Week 5: Deployment**
- Migration scripts
- Monitoring setup
- Gradual rollout

## Key Benefits

1. **Rapid Feedback**: New articles inherit meaningful scores immediately
2. **Fair Comparison**: Similar content gets similar baseline scores
3. **Exploration**: Wilson bonus encourages evaluation of newer content
4. **Performance**: Multi-level caching ensures fast score lookups
5. **Flexibility**: Single uncertainty_weight parameter for easy A/B testing

## Risk Mitigation

1. **Cycles**: Strict lineage validation prevents circular dependencies
2. **Performance**: Aggressive caching and background processing
3. **Gaming**: Similarity requirements prevent trivial forks
4. **Complexity**: Gradual rollout with extensive monitoring
5. **Accuracy**: Comprehensive testing against existing metrics

This implementation leverages the existing robust infrastructure while adding the sophisticated SAF-based scoring system that enables rapid A/B testing and fair content evaluation.