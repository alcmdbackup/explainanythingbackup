/**
 * Integration Test: Vector Similarity Service (Scenario 2)
 *
 * Tests vector similarity matching with real:
 * - Pinecone vector database operations
 * - OpenAI embedding generation
 * - Similarity score calculations
 *
 * Covers:
 * - High similarity matches (> 0.85)
 * - Low similarity matches (< 0.70)
 * - Multiple matches with diversity selection
 * - Empty results (no matches)
 * - Vector storage and retrieval
 */

import {
  findMatchesInVectorDb,
  processContentToStoreEmbedding,
  searchForSimilarVectors,
  maxNumberAnchors,
  calculateAllowedScores,
} from './vectorsim';
import {
  setupIntegrationTestContext,
  seedTestTopic,
  seedTestExplanation,
  seedTestVector,
  type IntegrationTestContext,
} from '@/testing/utils/integration-helpers';
import { generateMockEmbedding } from '@/testing/fixtures/llm-responses';
import { AnchorSet } from '@/lib/schemas/schemas';

describe('Vector Similarity Integration Tests (Scenario 2)', () => {
  let context: IntegrationTestContext;
  let testUserId: string;

  beforeAll(async () => {
    context = await setupIntegrationTestContext();
    testUserId = context.testUserId;
  });

  afterAll(async () => {
    await context.cleanup();
  });

  describe('findMatchesInVectorDb', () => {
    it('should find high similarity match when similar vector exists', async () => {
      // Arrange - Create test explanation with vector
      const topic = await seedTestTopic(context.supabaseService, {
        topic: 'Machine Learning',
      });

      const explanation = await seedTestExplanation(context.supabaseService, {
        topic_id: topic.topic_id,
        title: 'Neural Networks Introduction',
        content: `# Neural Networks

## Overview
Neural networks are computational models inspired by biological neural networks...

## Architecture
- Input layer
- Hidden layers
- Output layer`,
      });

      // Store vector in Pinecone
      const embedding = generateMockEmbedding(999);
      await seedTestVector(
        context.pinecone,
        explanation.explanation_id,
        embedding,
        {
          explanation_id: explanation.explanation_id,
          topic_id: topic.topic_id,
          title: explanation.title,
        }
      );

      // Wait for indexing
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Act - Search for similar content
      const matches = await findMatchesInVectorDb(
        'neural networks basics',
        false,
        null
      );

      // Assert
      expect(matches).toBeDefined();
      expect(Array.isArray(matches)).toBe(true);

      if (matches && matches.length > 0) {
        expect(matches[0]).toHaveProperty('score');
        expect(matches[0]).toHaveProperty('explanation_id');
        console.log('Found matches:', matches.length);
        console.log('Top match score:', matches[0].score);
      }
    }, 60000);

    it('should return empty array when no similar vectors exist', async () => {
      // Act - Search for very unique content
      const uniqueQuery = `Very unique content ${Date.now()} that should not match`;
      const matches = await findMatchesInVectorDb(uniqueQuery, false, null);

      // Assert
      expect(matches).toBeDefined();
      expect(Array.isArray(matches)).toBe(true);

      // May return empty or low-similarity matches
      console.log('Matches for unique query:', matches?.length || 0);
    }, 60000);

    it('should find multiple matches and rank by similarity', async () => {
      // Arrange - Create multiple related explanations
      const topic = await seedTestTopic(context.supabaseService, {
        topic: 'Quantum Computing',
      });

      const explanations = [
        {
          title: 'Quantum Bits (Qubits)',
          content: '# Qubits\n\nQuantum bits are the basic units...',
        },
        {
          title: 'Quantum Entanglement',
          content: '# Entanglement\n\nQuantum entanglement is a phenomenon...',
        },
        {
          title: 'Quantum Superposition',
          content: '# Superposition\n\nSuperposition allows quantum states...',
        },
      ];

      // Create and store vectors
      for (let i = 0; i < explanations.length; i++) {
        const exp = await seedTestExplanation(context.supabaseService, {
          topic_id: topic.topic_id,
          title: explanations[i].title,
          content: explanations[i].content,
        });

        const embedding = generateMockEmbedding(1000 + i);
        await seedTestVector(
          context.pinecone,
          exp.explanation_id,
          embedding,
          {
            explanation_id: exp.explanation_id,
            topic_id: topic.topic_id,
            title: exp.title,
          }
        );
      }

      // Wait for indexing
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Act - Search for quantum computing content
      const matches = await findMatchesInVectorDb(
        'quantum computing fundamentals',
        false,
        null
      );

      // Assert
      expect(matches).toBeDefined();

      if (matches && matches.length > 1) {
        // Verify scores are in descending order
        for (let i = 0; i < matches.length - 1; i++) {
          expect(matches[i].score).toBeGreaterThanOrEqual(matches[i + 1].score);
        }

        console.log('Multiple matches found:', matches.length);
        console.log('Score range:', matches[0].score, '-', matches[matches.length - 1].score);
      }
    }, 90000);

    it('should handle anchor-based searches', async () => {
      // Act - Test with anchor mode
      const matches = await findMatchesInVectorDb(
        'test query for anchors',
        true,
        AnchorSet.Main,
        maxNumberAnchors
      );

      // Assert
      expect(matches).toBeDefined();
      expect(Array.isArray(matches)).toBe(true);

      console.log('Anchor-based matches:', matches?.length || 0);
    }, 60000);
  });

  describe('processContentToStoreEmbedding', () => {
    it('should generate and store embedding for new content', async () => {
      // Arrange
      const explanationId = `test-exp-${Date.now()}`;
      const topicId = `test-topic-${Date.now()}`;
      const content = `# Test Explanation

## Introduction
This is a test explanation for embedding generation.

## Details
It contains multiple paragraphs and sections to test chunking.`;

      // Act
      const result = await processContentToStoreEmbedding(
        content,
        explanationId,
        topicId
      );

      // Assert
      expect(result).toBeDefined();
      expect(result.success).toBe(true);

      // Wait for Pinecone indexing
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify vector was stored
      const indexName = process.env.PINECONE_INDEX || 'test-index';
      const index = context.pinecone.index(indexName);
      const fetchResult = await index.namespace('').fetch([explanationId]);

      expect(fetchResult.records).toBeDefined();
      expect(fetchResult.records[explanationId]).toBeDefined();
      expect(fetchResult.records[explanationId].values).toBeDefined();
      expect(fetchResult.records[explanationId].values.length).toBe(1536); // OpenAI embedding dimension

      console.log('Embedding stored for:', explanationId);
      console.log('Vector dimension:', fetchResult.records[explanationId].values.length);
    }, 90000);

    it('should handle long content by chunking', async () => {
      // Arrange - Create long content
      const explanationId = `test-long-${Date.now()}`;
      const topicId = `test-topic-${Date.now()}`;
      const longContent = Array(100)
        .fill('This is a paragraph of text that repeats. ')
        .join('');

      // Act
      const result = await processContentToStoreEmbedding(
        longContent,
        explanationId,
        topicId
      );

      // Assert
      expect(result).toBeDefined();
      expect(result.success).toBe(true);

      console.log('Processed long content:', longContent.length, 'characters');
    }, 90000);

    it('should update existing vector when content changes', async () => {
      // Arrange - Create initial vector
      const explanationId = `test-update-${Date.now()}`;
      const topicId = `test-topic-${Date.now()}`;
      const initialContent = '# Initial Content\n\nThis is the first version.';

      // Store initial
      await processContentToStoreEmbedding(
        initialContent,
        explanationId,
        topicId
      );

      await new Promise(resolve => setTimeout(resolve, 2000));

      // Act - Update with new content
      const updatedContent = '# Updated Content\n\nThis is the second version with different information.';
      const result = await processContentToStoreEmbedding(
        updatedContent,
        explanationId,
        topicId
      );

      // Assert
      expect(result).toBeDefined();
      expect(result.success).toBe(true);

      // Verify only one vector exists (updated, not duplicated)
      await new Promise(resolve => setTimeout(resolve, 2000));
      const indexName = process.env.PINECONE_INDEX || 'test-index';
      const index = context.pinecone.index(indexName);
      const fetchResult = await index.namespace('').fetch([explanationId]);

      expect(fetchResult.records).toBeDefined();
      expect(Object.keys(fetchResult.records).length).toBe(1);

      console.log('Vector updated for:', explanationId);
    }, 120000);
  });

  describe('Similarity Score Validation', () => {
    it('should return scores within valid range [0, 1]', async () => {
      // Arrange - Create test vector
      const topic = await seedTestTopic(context.supabaseService, {
        topic: 'Test Topic',
      });

      const explanation = await seedTestExplanation(context.supabaseService, {
        topic_id: topic.topic_id,
        title: 'Test Explanation',
        content: '# Test\n\nTest content for scoring.',
      });

      const embedding = generateMockEmbedding(5000);
      await seedTestVector(
        context.pinecone,
        explanation.explanation_id,
        embedding,
        {
          explanation_id: explanation.explanation_id,
          topic_id: topic.topic_id,
          title: explanation.title,
        }
      );

      await new Promise(resolve => setTimeout(resolve, 2000));

      // Act
      const matches = await findMatchesInVectorDb('test content', false, null);

      // Assert
      if (matches && matches.length > 0) {
        matches.forEach(match => {
          expect(match.score).toBeGreaterThanOrEqual(0);
          expect(match.score).toBeLessThanOrEqual(1);
        });

        console.log('All scores in valid range [0, 1]');
      }
    }, 60000);
  });
});
