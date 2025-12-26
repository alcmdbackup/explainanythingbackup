/**
 * Database Record Fixtures for Integration Testing
 *
 * Factory functions for creating realistic test database records
 * Reuses and extends test-helpers.ts mock builders
 */

import {
  createMockExplanation,
  createMockTopic,
  createMockTag,
  createMockVector,
} from '../utils/test-helpers';
import { TEST_PREFIX } from '../utils/integration-helpers';
import type { VectorSearchMetadata } from '@/lib/schemas/schemas';

/**
 * Creates a test topic with proper structure
 */
export function createTestTopic(overrides: Record<string, unknown> = {}) {
  const testId = `${TEST_PREFIX}${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  return createMockTopic({
    id: `${testId}-topic`,
    topic: 'Test Topic',
    description: 'A test topic for integration testing',
    ...overrides,
  });
}

/**
 * Creates a test explanation with proper structure
 */
export function createTestExplanation(topicId?: string, overrides: Record<string, unknown> = {}) {
  const testId = `${TEST_PREFIX}${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const finalTopicId = topicId || `${testId}-topic`;

  return createMockExplanation({
    id: `${testId}-explanation`,
    topic: finalTopicId,
    explanation: '# Test Content\n\nThis is a test explanation for integration testing.',
    audience: 'general',
    ...overrides,
  });
}

/**
 * Creates a test tag with proper structure
 */
export function createTestTag(tagName?: string, overrides: Record<string, unknown> = {}) {
  const testId = `${TEST_PREFIX}${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const finalTagName = tagName || 'test-tag';

  return createMockTag({
    id: `${testId}-tag-${finalTagName}`,
    name: finalTagName,
    ...overrides,
  });
}

/**
 * Creates a batch of test topics
 */
export function createTestTopics(count: number): ReturnType<typeof createTestTopic>[] {
  return Array.from({ length: count }, (_, i) =>
    createTestTopic({
      topic: `Test Topic ${i + 1}`,
    })
  );
}

/**
 * Creates a batch of test explanations
 */
export function createTestExplanations(
  count: number,
  topicId?: string
): ReturnType<typeof createTestExplanation>[] {
  return Array.from({ length: count }, (_, i) =>
    createTestExplanation(topicId, {
      explanation: `# Test Explanation ${i + 1}\n\nTest content for explanation ${i + 1}.`,
    })
  );
}

/**
 * Creates a batch of test tags
 */
export function createTestTags(tagNames: string[]): ReturnType<typeof createTestTag>[] {
  return tagNames.map((name) => createTestTag(name));
}

/**
 * Creates a complete test data set with topic, explanation, and tags
 */
export function createCompleteTestDataSet() {
  const testId = `${TEST_PREFIX}${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const topic = createTestTopic({
    id: `${testId}-topic`,
    topic: 'Quantum Computing',
  });

  const explanation = createTestExplanation(topic.id, {
    id: `${testId}-explanation`,
    explanation: '# Quantum Computing\n\nQuantum computing uses quantum mechanics for computation.',
  });

  const tags = createTestTags(['quantum-physics', 'advanced', 'computing']);

  return {
    topic,
    explanation,
    tags,
    testId,
  };
}

/**
 * Creates a test user query record
 */
export function createTestUserQuery(userId?: string, overrides: Record<string, unknown> = {}) {
  const testId = `${TEST_PREFIX}${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const finalUserId = userId || `${testId}-user`;

  return {
    query_id: `${testId}-query`,
    user_id: finalUserId,
    query_text: 'What is quantum entanglement?',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Creates a test user explanation event
 */
export function createTestUserEvent(
  userId?: string,
  explanationId?: string,
  overrides: Record<string, unknown> = {}
) {
  const testId = `${TEST_PREFIX}${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const finalUserId = userId || `${testId}-user`;
  const finalExplanationId = explanationId || `${testId}-explanation`;

  return {
    event_id: `${testId}-event`,
    user_id: finalUserId,
    explanation_id: finalExplanationId,
    event_type: 'view',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Creates test vector data for Pinecone with proper VectorSearchMetadata
 */
export function createTestVectorData(
  explanationId: string,
  dimension: number = 3072,
  overrides: Partial<VectorSearchMetadata> = {}
): { id: string; values: number[]; metadata: VectorSearchMetadata } {
  // Parse numeric ID from string if possible, otherwise use a default
  const numericId = parseInt(explanationId.replace(/\D/g, ''), 10) || 1;

  return {
    id: explanationId,
    values: createMockVector(dimension),
    metadata: {
      text: 'This is test content for vector matching',
      explanation_id: numericId,
      topic_id: numericId,
      startIdx: 0,
      length: 100,
      isAnchor: false,
      ...overrides,
    },
  };
}

/**
 * Creates a batch of test vector data
 */
export function createTestVectorBatch(
  count: number,
  dimension: number = 3072
): ReturnType<typeof createTestVectorData>[] {
  const testId = `${TEST_PREFIX}${Date.now()}`;

  return Array.from({ length: count }, (_, i) =>
    createTestVectorData(`${testId}-vector-${i}`, dimension, {
      text: `Test content for topic ${i + 1}`,
      explanation_id: i + 1,
      topic_id: i + 1,
    })
  );
}

/**
 * Preset tag definitions for testing tag conflict scenarios
 */
export const presetTestTags = {
  difficulty: ['basic', 'intermediate', 'advanced'],
  audience: ['general', 'technical', 'expert'],
  format: ['tutorial', 'reference', 'example'],
};

/**
 * Creates mutually exclusive tag pairs for conflict testing
 */
export function createConflictingTagPairs() {
  return [
    { tag1: 'basic', tag2: 'advanced', group: 'difficulty' },
    { tag1: 'general', tag2: 'expert', group: 'audience' },
    { tag1: 'tutorial', tag2: 'reference', group: 'format' },
  ];
}
