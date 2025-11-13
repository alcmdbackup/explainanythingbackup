/**
 * Database Record Fixtures
 *
 * Test data for seeding the database in integration tests.
 * Includes realistic explanations, topics, tags, and related entities.
 */

import { v4 as uuidv4 } from 'uuid';

// ============================================
// TYPE DEFINITIONS
// ============================================

export interface TestTopic {
  topic_id: string;
  topic: string;
  created_at?: string;
}

export interface TestExplanation {
  explanation_id: string;
  topic_id: string;
  title: string;
  content: string;
  created_at?: string;
  created_by?: string;
}

export interface TestTag {
  tag_id: string;
  tag_name: string;
  is_preset?: boolean;
  created_at?: string;
  mutually_exclusive_group?: number;
}

export interface TestExplanationTag {
  explanation_tag_id: string;
  explanation_id: string;
  tag_id: string;
  was_ai_evaluated?: boolean;
  created_at?: string;
}

export interface TestUserQuery {
  query_id: string;
  user_id: string;
  query: string;
  matched_explanation_id?: string;
  created_at?: string;
}

// ============================================
// TOPICS
// ============================================

export const testTopics: TestTopic[] = [
  {
    topic_id: 'topic-quantum-physics',
    topic: 'Quantum Physics',
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    topic_id: 'topic-neural-networks',
    topic: 'Neural Networks',
    created_at: '2024-01-02T00:00:00Z',
  },
  {
    topic_id: 'topic-relativity',
    topic: 'Theory of Relativity',
    created_at: '2024-01-03T00:00:00Z',
  },
  {
    topic_id: 'topic-machine-learning',
    topic: 'Machine Learning',
    created_at: '2024-01-04T00:00:00Z',
  },
  {
    topic_id: 'topic-blockchain',
    topic: 'Blockchain Technology',
    created_at: '2024-01-05T00:00:00Z',
  },
];

// ============================================
// EXPLANATIONS
// ============================================

export const testExplanations: TestExplanation[] = [
  {
    explanation_id: 'exp-quantum-entanglement',
    topic_id: 'topic-quantum-physics',
    title: 'Quantum Entanglement',
    content: `# Quantum Entanglement

## Overview
Quantum entanglement is a physical phenomenon where pairs or groups of particles interact in ways such that the quantum state of each particle cannot be described independently.

## Key Concepts
- **Superposition**: Particles exist in multiple states simultaneously
- **Correlation**: Measuring one particle instantly affects its entangled partner
- **Non-locality**: Effects occur regardless of distance

## Applications
1. Quantum Computing
2. Quantum Cryptography
3. Quantum Teleportation

## Historical Context
First described by Einstein, Podolsky, and Rosen in 1935 as the "EPR Paradox."`,
    created_at: '2024-01-10T10:00:00Z',
  },
  {
    explanation_id: 'exp-neural-networks',
    topic_id: 'topic-neural-networks',
    title: 'Introduction to Neural Networks',
    content: `# Introduction to Neural Networks

## What is a Neural Network?
An artificial neural network is a computing system inspired by biological neural networks.

## Architecture
- **Input Layer**: Receives data
- **Hidden Layers**: Process information
- **Output Layer**: Produces results

## Learning Process
Neural networks learn through:
1. Forward propagation
2. Loss calculation
3. Backpropagation
4. Weight adjustment

## Common Types
- Feedforward Neural Networks
- Convolutional Neural Networks (CNNs)
- Recurrent Neural Networks (RNNs)
- Transformers`,
    created_at: '2024-01-11T11:00:00Z',
  },
  {
    explanation_id: 'exp-special-relativity',
    topic_id: 'topic-relativity',
    title: 'Special Relativity Explained',
    content: `# Special Relativity

## Einstein's Revolutionary Theory
Special relativity, published in 1905, revolutionized our understanding of space and time.

## Core Principles
1. **Principle of Relativity**: Laws of physics are the same in all inertial frames
2. **Speed of Light Constant**: Light speed is constant regardless of observer motion

## Key Effects
- **Time Dilation**: Moving clocks run slower
- **Length Contraction**: Moving objects appear shorter
- **Mass-Energy Equivalence**: E = mc²

## Implications
- Nothing can travel faster than light
- Space and time are interconnected (spacetime)
- Simultaneity is relative`,
    created_at: '2024-01-12T12:00:00Z',
  },
];

// ============================================
// TAGS
// ============================================

export const testTags: TestTag[] = [
  // Difficulty level tags (mutually exclusive)
  {
    tag_id: 'tag-beginner',
    tag_name: 'beginner',
    is_preset: true,
    mutually_exclusive_group: 1,
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    tag_id: 'tag-intermediate',
    tag_name: 'intermediate',
    is_preset: true,
    mutually_exclusive_group: 1,
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    tag_id: 'tag-advanced',
    tag_name: 'advanced',
    is_preset: true,
    mutually_exclusive_group: 1,
    created_at: '2024-01-01T00:00:00Z',
  },

  // Content type tags (mutually exclusive)
  {
    tag_id: 'tag-conceptual',
    tag_name: 'conceptual',
    is_preset: true,
    mutually_exclusive_group: 2,
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    tag_id: 'tag-technical',
    tag_name: 'technical',
    is_preset: true,
    mutually_exclusive_group: 2,
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    tag_id: 'tag-practical',
    tag_name: 'practical',
    is_preset: true,
    mutually_exclusive_group: 2,
    created_at: '2024-01-01T00:00:00Z',
  },

  // Subject tags (not mutually exclusive)
  {
    tag_id: 'tag-physics',
    tag_name: 'physics',
    is_preset: true,
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    tag_id: 'tag-computer-science',
    tag_name: 'computer-science',
    is_preset: true,
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    tag_id: 'tag-mathematics',
    tag_name: 'mathematics',
    is_preset: true,
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    tag_id: 'tag-quantum-mechanics',
    tag_name: 'quantum-mechanics',
    is_preset: true,
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    tag_id: 'tag-machine-learning',
    tag_name: 'machine-learning',
    is_preset: true,
    created_at: '2024-01-01T00:00:00Z',
  },

  // Custom (non-preset) tags
  {
    tag_id: 'tag-custom-epr',
    tag_name: 'epr-paradox',
    is_preset: false,
    created_at: '2024-01-15T10:00:00Z',
  },
  {
    tag_id: 'tag-custom-ai',
    tag_name: 'artificial-intelligence',
    is_preset: false,
    created_at: '2024-01-16T11:00:00Z',
  },
];

// ============================================
// EXPLANATION-TAG RELATIONSHIPS
// ============================================

export const testExplanationTags: TestExplanationTag[] = [
  // Quantum Entanglement tags
  {
    explanation_tag_id: uuidv4(),
    explanation_id: 'exp-quantum-entanglement',
    tag_id: 'tag-advanced',
    was_ai_evaluated: true,
    created_at: '2024-01-10T10:05:00Z',
  },
  {
    explanation_tag_id: uuidv4(),
    explanation_id: 'exp-quantum-entanglement',
    tag_id: 'tag-physics',
    was_ai_evaluated: true,
    created_at: '2024-01-10T10:05:00Z',
  },
  {
    explanation_tag_id: uuidv4(),
    explanation_id: 'exp-quantum-entanglement',
    tag_id: 'tag-quantum-mechanics',
    was_ai_evaluated: true,
    created_at: '2024-01-10T10:05:00Z',
  },
  {
    explanation_tag_id: uuidv4(),
    explanation_id: 'exp-quantum-entanglement',
    tag_id: 'tag-custom-epr',
    was_ai_evaluated: false,
    created_at: '2024-01-15T14:00:00Z',
  },

  // Neural Networks tags
  {
    explanation_tag_id: uuidv4(),
    explanation_id: 'exp-neural-networks',
    tag_id: 'tag-intermediate',
    was_ai_evaluated: true,
    created_at: '2024-01-11T11:05:00Z',
  },
  {
    explanation_tag_id: uuidv4(),
    explanation_id: 'exp-neural-networks',
    tag_id: 'tag-computer-science',
    was_ai_evaluated: true,
    created_at: '2024-01-11T11:05:00Z',
  },
  {
    explanation_tag_id: uuidv4(),
    explanation_id: 'exp-neural-networks',
    tag_id: 'tag-machine-learning',
    was_ai_evaluated: true,
    created_at: '2024-01-11T11:05:00Z',
  },

  // Special Relativity tags
  {
    explanation_tag_id: uuidv4(),
    explanation_id: 'exp-special-relativity',
    tag_id: 'tag-advanced',
    was_ai_evaluated: true,
    created_at: '2024-01-12T12:05:00Z',
  },
  {
    explanation_tag_id: uuidv4(),
    explanation_id: 'exp-special-relativity',
    tag_id: 'tag-physics',
    was_ai_evaluated: true,
    created_at: '2024-01-12T12:05:00Z',
  },
  {
    explanation_tag_id: uuidv4(),
    explanation_id: 'exp-special-relativity',
    tag_id: 'tag-mathematics',
    was_ai_evaluated: true,
    created_at: '2024-01-12T12:05:00Z',
  },
];

// ============================================
// USER QUERIES
// ============================================

export const testUserQueries: TestUserQuery[] = [
  {
    query_id: uuidv4(),
    user_id: 'test-user-1',
    query: 'What is quantum entanglement?',
    matched_explanation_id: 'exp-quantum-entanglement',
    created_at: '2024-01-10T14:00:00Z',
  },
  {
    query_id: uuidv4(),
    user_id: 'test-user-1',
    query: 'How do neural networks learn?',
    matched_explanation_id: 'exp-neural-networks',
    created_at: '2024-01-11T15:00:00Z',
  },
  {
    query_id: uuidv4(),
    user_id: 'test-user-2',
    query: 'Explain special relativity',
    matched_explanation_id: 'exp-special-relativity',
    created_at: '2024-01-12T16:00:00Z',
  },
  {
    query_id: uuidv4(),
    user_id: 'test-user-2',
    query: 'What is blockchain technology?',
    // No match - should trigger new explanation generation
    created_at: '2024-01-13T17:00:00Z',
  },
];

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Creates a custom test topic
 */
export function createTestTopic(topic: string): TestTopic {
  return {
    topic_id: `topic-${uuidv4()}`,
    topic,
    created_at: new Date().toISOString(),
  };
}

/**
 * Creates a custom test explanation
 */
export function createTestExplanation(
  title: string,
  content: string,
  topicId?: string
): TestExplanation {
  return {
    explanation_id: `exp-${uuidv4()}`,
    topic_id: topicId || `topic-${uuidv4()}`,
    title,
    content,
    created_at: new Date().toISOString(),
  };
}

/**
 * Creates a custom test tag
 */
export function createTestTag(
  tagName: string,
  isPreset: boolean = false
): TestTag {
  return {
    tag_id: `tag-${uuidv4()}`,
    tag_name: tagName,
    is_preset: isPreset,
    created_at: new Date().toISOString(),
  };
}

/**
 * Creates an explanation-tag relationship
 */
export function createTestExplanationTag(
  explanationId: string,
  tagId: string,
  wasAiEvaluated: boolean = true
): TestExplanationTag {
  return {
    explanation_tag_id: uuidv4(),
    explanation_id: explanationId,
    tag_id: tagId,
    was_ai_evaluated: wasAiEvaluated,
    created_at: new Date().toISOString(),
  };
}

/**
 * Creates a test user query
 */
export function createTestUserQuery(
  userId: string,
  query: string,
  matchedExplanationId?: string
): TestUserQuery {
  return {
    query_id: uuidv4(),
    user_id: userId,
    query,
    matched_explanation_id: matchedExplanationId,
    created_at: new Date().toISOString(),
  };
}

// ============================================
// PRESET DATA COLLECTIONS
// ============================================

/**
 * Get all preset tags (for seeding)
 */
export function getPresetTags(): TestTag[] {
  return testTags.filter(tag => tag.is_preset);
}

/**
 * Get tags by mutually exclusive group
 */
export function getTagsByGroup(groupNumber: number): TestTag[] {
  return testTags.filter(tag => tag.mutually_exclusive_group === groupNumber);
}

/**
 * Get difficulty level tags (group 1)
 */
export function getDifficultyTags(): TestTag[] {
  return getTagsByGroup(1);
}

/**
 * Get content type tags (group 2)
 */
export function getContentTypeTags(): TestTag[] {
  return getTagsByGroup(2);
}

/**
 * Get subject tags (not mutually exclusive)
 */
export function getSubjectTags(): TestTag[] {
  return testTags.filter(
    tag => tag.is_preset && !tag.mutually_exclusive_group
  );
}
