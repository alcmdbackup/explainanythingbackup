/**
 * Vector Response Fixtures for Integration Testing
 *
 * Provides mock Pinecone API responses for integration tests
 */

/**
 * Mock Pinecone query response with no matches
 */
export const pineconeNoMatchesResponse = {
  matches: [],
};

/**
 * Mock Pinecone query response with high similarity match
 */
export function createPineconeHighSimilarityMatch(explanationId: string) {
  return {
    matches: [
      {
        id: explanationId,
        score: 0.92,
        metadata: {
          topic: 'Quantum Physics',
          title: 'What is Quantum Entanglement?',
          content_preview: 'Quantum entanglement is a physical phenomenon...',
        },
        values: Array(3072).fill(0).map(() => Math.random()),
      },
    ],
  };
}

/**
 * Mock Pinecone query response with low similarity match
 */
export function createPineconeLowSimilarityMatch(explanationId: string) {
  return {
    matches: [
      {
        id: explanationId,
        score: 0.35,
        metadata: {
          topic: 'Quantum Physics',
          title: 'Quantum Computing Basics',
          content_preview: 'Quantum computing uses quantum mechanics...',
        },
        values: Array(3072).fill(0).map(() => Math.random()),
      },
    ],
  };
}

/**
 * Mock Pinecone query response with multiple matches
 */
export function createPineconeMultipleMatches(explanationIds: string[]) {
  return {
    matches: explanationIds.map((id, index) => ({
      id,
      score: 0.9 - (index * 0.1), // Descending scores
      metadata: {
        topic: 'Physics',
        title: `Test Explanation ${index + 1}`,
        content_preview: `Test content ${index + 1}...`,
      },
      values: Array(3072).fill(0).map(() => Math.random()),
    })),
  };
}

/**
 * Mock Pinecone upsert success response
 */
export const pineconeUpsertSuccessResponse = {
  upsertedCount: 1,
};

/**
 * Mock Pinecone upsert failure error
 */
export const pineconeUpsertFailure = new Error('Pinecone service unavailable');

/**
 * Mock Pinecone fetch response (for verification after upsert)
 */
export function createPineconeFetchResponse(explanationId: string, embedding: number[]) {
  return {
    records: {
      [explanationId]: {
        id: explanationId,
        values: embedding,
        metadata: {
          topic: 'Test Topic',
          title: 'Test Explanation',
        },
      },
    },
  };
}

/**
 * Generate random embedding vector
 */
export function generateRandomEmbedding(dimension: number = 3072): number[] {
  return Array(dimension).fill(0).map(() => Math.random() - 0.5);
}
