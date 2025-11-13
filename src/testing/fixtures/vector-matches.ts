/**
 * Vector Match Fixtures
 *
 * Recorded Pinecone API responses for integration test validation.
 * Includes various match scenarios: high similarity, low similarity,
 * multiple matches, and empty results.
 */

import type { QueryResponse } from '@pinecone-database/pinecone';
import { generateMockEmbedding } from './llm-responses';

// ============================================
// TYPE DEFINITIONS
// ============================================

export interface VectorMatch {
  id: string;
  score: number;
  metadata?: Record<string, any>;
  values?: number[];
}

// ============================================
// HIGH SIMILARITY MATCHES
// ============================================

/**
 * High similarity match (score > 0.85) - should return existing explanation
 */
export const highSimilarityMatch: QueryResponse = {
  matches: [
    {
      id: 'explanation-12345',
      score: 0.92,
      values: generateMockEmbedding(100),
      metadata: {
        explanation_id: 'explanation-12345',
        topic_id: 'topic-67890',
        title: 'Quantum Entanglement Explained',
        created_at: '2024-01-15T10:30:00Z',
      },
    },
  ],
  namespace: '',
  usage: {
    readUnits: 5,
  },
};

/**
 * Multiple high similarity matches - should test diversity selection
 */
export const multipleHighSimilarityMatches: QueryResponse = {
  matches: [
    {
      id: 'explanation-11111',
      score: 0.95,
      values: generateMockEmbedding(101),
      metadata: {
        explanation_id: 'explanation-11111',
        topic_id: 'topic-11111',
        title: 'Quantum Entanglement: A Deep Dive',
        created_at: '2024-01-10T08:00:00Z',
      },
    },
    {
      id: 'explanation-22222',
      score: 0.91,
      values: generateMockEmbedding(102),
      metadata: {
        explanation_id: 'explanation-22222',
        topic_id: 'topic-22222',
        title: 'Understanding Quantum Entanglement',
        created_at: '2024-01-12T14:30:00Z',
      },
    },
    {
      id: 'explanation-33333',
      score: 0.88,
      values: generateMockEmbedding(103),
      metadata: {
        explanation_id: 'explanation-33333',
        topic_id: 'topic-33333',
        title: 'Quantum Entanglement Basics',
        created_at: '2024-01-14T16:45:00Z',
      },
    },
  ],
  namespace: '',
  usage: {
    readUnits: 5,
  },
};

// ============================================
// LOW SIMILARITY MATCHES
// ============================================

/**
 * Low similarity match (score < 0.70) - should generate new explanation
 */
export const lowSimilarityMatch: QueryResponse = {
  matches: [
    {
      id: 'explanation-99999',
      score: 0.55,
      values: generateMockEmbedding(200),
      metadata: {
        explanation_id: 'explanation-99999',
        topic_id: 'topic-99999',
        title: 'Photosynthesis Process',
        created_at: '2024-01-05T12:00:00Z',
      },
    },
  ],
  namespace: '',
  usage: {
    readUnits: 5,
  },
};

/**
 * Medium similarity match (score between 0.70-0.85) - edge case
 */
export const mediumSimilarityMatch: QueryResponse = {
  matches: [
    {
      id: 'explanation-44444',
      score: 0.78,
      values: generateMockEmbedding(150),
      metadata: {
        explanation_id: 'explanation-44444',
        topic_id: 'topic-44444',
        title: 'Quantum Mechanics Introduction',
        created_at: '2024-01-08T09:30:00Z',
      },
    },
  ],
  namespace: '',
  usage: {
    readUnits: 5,
  },
};

// ============================================
// EMPTY RESULTS
// ============================================

/**
 * No matches found - should generate new explanation
 */
export const noMatches: QueryResponse = {
  matches: [],
  namespace: '',
  usage: {
    readUnits: 5,
  },
};

// ============================================
// DIVERSE MATCHES FOR TESTING
// ============================================

/**
 * Matches with varying topics for diversity testing
 */
export const diverseTopicMatches: QueryResponse = {
  matches: [
    {
      id: 'explanation-topic1',
      score: 0.89,
      values: generateMockEmbedding(301),
      metadata: {
        explanation_id: 'explanation-topic1',
        topic_id: 'topic-physics',
        title: 'Quantum Entanglement in Physics',
        created_at: '2024-01-10T10:00:00Z',
      },
    },
    {
      id: 'explanation-topic2',
      score: 0.87,
      values: generateMockEmbedding(302),
      metadata: {
        explanation_id: 'explanation-topic2',
        topic_id: 'topic-computing',
        title: 'Quantum Computing Applications',
        created_at: '2024-01-11T11:00:00Z',
      },
    },
    {
      id: 'explanation-topic3',
      score: 0.85,
      values: generateMockEmbedding(303),
      metadata: {
        explanation_id: 'explanation-topic3',
        topic_id: 'topic-philosophy',
        title: 'Philosophical Implications of Quantum Theory',
        created_at: '2024-01-12T12:00:00Z',
      },
    },
  ],
  namespace: '',
  usage: {
    readUnits: 5,
  },
};

// ============================================
// ERROR SCENARIOS
// ============================================

/**
 * Malformed match data (missing metadata)
 */
export const malformedMatch: QueryResponse = {
  matches: [
    {
      id: 'explanation-bad',
      score: 0.90,
      values: generateMockEmbedding(400),
      // Missing metadata
    },
  ],
  namespace: '',
  usage: {
    readUnits: 5,
  },
};

/**
 * Match with incomplete metadata
 */
export const incompleteMetadataMatch: QueryResponse = {
  matches: [
    {
      id: 'explanation-incomplete',
      score: 0.88,
      values: generateMockEmbedding(401),
      metadata: {
        explanation_id: 'explanation-incomplete',
        // Missing topic_id and title
      },
    },
  ],
  namespace: '',
  usage: {
    readUnits: 5,
  },
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Creates a custom vector match with specified parameters
 */
export function createVectorMatch(
  explanationId: string,
  score: number,
  options: {
    topicId?: string;
    title?: string;
    seed?: number;
    additionalMetadata?: Record<string, any>;
  } = {}
): VectorMatch {
  const { topicId, title, seed = 0, additionalMetadata = {} } = options;

  return {
    id: explanationId,
    score,
    values: generateMockEmbedding(seed),
    metadata: {
      explanation_id: explanationId,
      topic_id: topicId || `topic-${explanationId}`,
      title: title || `Test Explanation ${explanationId}`,
      created_at: new Date().toISOString(),
      ...additionalMetadata,
    },
  };
}

/**
 * Creates a query response with multiple matches
 */
export function createQueryResponse(matches: VectorMatch[]): QueryResponse {
  return {
    matches: matches.map(match => ({
      id: match.id,
      score: match.score,
      values: match.values,
      metadata: match.metadata,
    })),
    namespace: '',
    usage: {
      readUnits: 5,
    },
  };
}

/**
 * Creates matches with controlled score distribution
 */
export function createMatchesWithScores(scores: number[]): QueryResponse {
  return createQueryResponse(
    scores.map((score, index) =>
      createVectorMatch(`explanation-${index}`, score, {
        seed: 1000 + index,
        title: `Test Explanation ${index}`,
      })
    )
  );
}

/**
 * Creates matches from the same topic (low diversity)
 */
export function createSameTopicMatches(count: number, topicId: string): QueryResponse {
  const matches: VectorMatch[] = [];

  for (let i = 0; i < count; i++) {
    matches.push(
      createVectorMatch(`explanation-same-${i}`, 0.9 - i * 0.02, {
        topicId,
        title: `Explanation ${i} on ${topicId}`,
        seed: 2000 + i,
      })
    );
  }

  return createQueryResponse(matches);
}

/**
 * Creates matches from different topics (high diversity)
 */
export function createDiverseMatches(count: number): QueryResponse {
  const matches: VectorMatch[] = [];

  for (let i = 0; i < count; i++) {
    matches.push(
      createVectorMatch(`explanation-diverse-${i}`, 0.9 - i * 0.02, {
        topicId: `topic-diverse-${i}`,
        title: `Diverse Explanation ${i}`,
        seed: 3000 + i,
      })
    );
  }

  return createQueryResponse(matches);
}

// ============================================
// TEST SCENARIOS
// ============================================

export const testScenarios = {
  // Should return existing explanation
  highSimilarity: highSimilarityMatch,

  // Should generate new explanation
  lowSimilarity: lowSimilarityMatch,
  noResults: noMatches,

  // Edge cases
  mediumSimilarity: mediumSimilarityMatch,

  // Multiple matches
  multipleMatches: multipleHighSimilarityMatches,
  diverseTopics: diverseTopicMatches,

  // Error cases
  malformed: malformedMatch,
  incompleteMetadata: incompleteMetadataMatch,
};
