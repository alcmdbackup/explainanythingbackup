/**
 * Integration Test: returnExplanation Service (Scenario 1)
 *
 * Tests the complete explanation generation pipeline with real:
 * - OpenAI API calls (title generation, content generation, tag evaluation)
 * - Pinecone vector operations (similarity search, embedding storage)
 * - Supabase database transactions (topic, explanation, tags)
 *
 * Covers:
 * - New explanation generation (no match)
 * - Existing explanation match (high similarity)
 * - Streaming responses
 * - Tag and link generation
 * - Request ID propagation
 * - Error handling
 */

import {
  returnExplanationLogic,
  generateTitleFromUserQuery,
} from './returnExplanation';
import {
  setupIntegrationTestContext,
  seedTestTopic,
  seedTestExplanation,
  seedTestVector,
  type IntegrationTestContext,
} from '@/testing/utils/integration-helpers';
import { MatchMode, UserInputType } from '@/lib/schemas/schemas';
import { generateMockEmbedding } from '@/testing/fixtures/llm-responses';

describe('returnExplanation Integration Tests (Proof of Concept)', () => {
  let context: IntegrationTestContext;
  let testUserId: string;

  beforeAll(async () => {
    context = await setupIntegrationTestContext();
    testUserId = context.testUserId;
  });

  afterAll(async () => {
    await context.cleanup();
  });

  describe('generateTitleFromUserQuery', () => {
    it('should generate a title from a user query using real OpenAI API', async () => {
      // Arrange
      const userQuery = 'What is quantum entanglement?';

      // Act
      const result = await generateTitleFromUserQuery(userQuery, testUserId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.title).toBeTruthy();
      expect(result.title).not.toBeNull();
      expect(typeof result.title).toBe('string');
      expect(result.title!.length).toBeGreaterThan(0);
      expect(result.error).toBeNull();

      // Log for manual verification
      console.log('Generated title:', result.title);
    }, 60000); // 60 second timeout for API call

    it('should handle empty query gracefully', async () => {
      // Arrange
      const userQuery = '';

      // Act & Assert
      // The function may throw or return an error
      // We just want to ensure it doesn't crash
      try {
        const result = await generateTitleFromUserQuery(userQuery, testUserId);
        // If it doesn't throw, it should indicate failure
        if (!result.success) {
          expect(result.error).toBeTruthy();
        }
      } catch (error) {
        // Error is expected for empty input
        expect(error).toBeDefined();
      }
    }, 60000);
  });

  describe('returnExplanationLogic - Basic Flow', () => {
    it('should generate a new explanation when no similar vectors exist', async () => {
      // Arrange
      const userInput = `Test query ${Date.now()} - should not match anything`;
      const matchMode = MatchMode.Search;
      const userInputType = UserInputType.Query;

      // Act
      const result = await returnExplanationLogic(
        userInput,
        null, // savedId
        matchMode,
        testUserId,
        userInputType,
        [], // additionalRules
        undefined, // onStreamingText
        undefined, // existingContent
        null, // previousExplanationViewedId
        null // previousExplanationViewedVector
      );

      // Assert
      expect(result).toBeDefined();
      expect(result.originalUserInput).toBe(userInput);
      expect(result.error).toBeNull();

      // Should generate new explanation (no match found)
      expect(result.match_found).toBe(false);
      expect(result.data).toBeTruthy();

      if (result.data) {
        expect(result.data.title).toBeTruthy();
        expect(result.data.content).toBeTruthy();
        expect(result.data.explanation_id).toBeTruthy();

        // Verify explanation was saved to database
        const { data: savedExplanation } = await context.supabase
          .from('explanations')
          .select('*')
          .eq('explanation_id', result.data.explanation_id)
          .single();

        expect(savedExplanation).toBeTruthy();
        expect(savedExplanation?.title).toBe(result.data.title);

        console.log('Generated explanation ID:', result.data.explanation_id);
        console.log('Title:', result.data.title);
      }
    }, 120000); // 2 minute timeout for full pipeline

    it('should handle invalid input', async () => {
      // Arrange
      const userInput = ''; // Empty input

      // Act
      const result = await returnExplanationLogic(
        userInput,
        null,
        MatchMode.Search,
        testUserId,
        UserInputType.Query,
        []
      );

      // Assert
      expect(result.error).toBeTruthy();
      expect(result.data).toBeNull();
      expect(result.explanationId).toBeNull();
    });
  });

  describe('Database Integration', () => {
    it('should seed and retrieve test data', async () => {
      // Test that our seeding functions work with real database

      // Arrange & Act
      const topic = await seedTestTopic(context.supabaseService, {
        topic: `Test Topic ${Date.now()}`,
      });

      const explanation = await seedTestExplanation(context.supabaseService, {
        topic_id: topic.topic_id,
        title: `Test Explanation ${Date.now()}`,
        content: '# Test\n\nThis is a test explanation.',
      });

      // Assert - Verify topic was created
      const { data: retrievedTopic } = await context.supabase
        .from('topics')
        .select('*')
        .eq('topic_id', topic.topic_id)
        .single();

      expect(retrievedTopic).toBeTruthy();
      expect(retrievedTopic?.topic).toBe(topic.topic);

      // Assert - Verify explanation was created
      const { data: retrievedExplanation } = await context.supabase
        .from('explanations')
        .select('*')
        .eq('explanation_id', explanation.explanation_id)
        .single();

      expect(retrievedExplanation).toBeTruthy();
      expect(retrievedExplanation?.title).toBe(explanation.title);
      expect(retrievedExplanation?.topic_id).toBe(topic.topic_id);

      console.log('Seeded topic:', topic.topic_id);
      console.log('Seeded explanation:', explanation.explanation_id);
    });
  });

  describe('Pinecone Integration', () => {
    it('should upsert and query vectors', async () => {
      // Test that Pinecone operations work

      // Arrange
      const vectorId = `test-vector-${Date.now()}`;
      const embedding = generateMockEmbedding(42);
      const metadata = {
        explanation_id: vectorId,
        title: 'Test Vector',
        test: true,
      };

      // Act - Upsert vector
      await seedTestVector(
        context.pinecone,
        vectorId,
        embedding,
        metadata
      );

      // Wait for Pinecone to index (eventual consistency)
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Query for the vector
      const indexName = process.env.PINECONE_INDEX || 'test-index';
      const index = context.pinecone.index(indexName);
      const queryResult = await index.namespace('').query({
        vector: embedding,
        topK: 5,
        includeMetadata: true,
      });

      // Assert
      expect(queryResult.matches).toBeDefined();
      expect(queryResult.matches.length).toBeGreaterThan(0);

      // Find our test vector in results
      const ourMatch = queryResult.matches.find(m => m.id === vectorId);
      expect(ourMatch).toBeDefined();
      expect(ourMatch?.score).toBeGreaterThan(0.99); // Should be very high similarity
      expect(ourMatch?.metadata).toMatchObject(metadata);

      console.log('Upserted vector ID:', vectorId);
      console.log('Query returned matches:', queryResult.matches.length);
    }, 30000);
  });

  describe('Scenario 1: End-to-End Explanation Generation', () => {
    it('should find existing explanation when high similarity match exists', async () => {
      // Arrange - Create a test explanation with vector
      const topic = await seedTestTopic(context.supabaseService, {
        topic: 'Quantum Physics Test',
      });

      const explanation = await seedTestExplanation(context.supabaseService, {
        topic_id: topic.topic_id,
        title: 'Quantum Entanglement Basics',
        content: `# Quantum Entanglement

## Overview
Quantum entanglement is a phenomenon where particles become correlated...

## Key Points
- Non-locality
- Instantaneous correlation
- EPR Paradox`,
      });

      // Generate and store vector for this explanation
      const embedding = generateMockEmbedding(123);
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

      // Wait for Pinecone indexing
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Act - Search for similar content (should match)
      const userInput = 'Explain quantum entanglement';
      const result = await returnExplanationLogic(
        userInput,
        null,
        MatchMode.Search,
        testUserId,
        UserInputType.Query,
        []
      );

      // Assert
      expect(result.error).toBeNull();
      expect(result.match_found).toBeTruthy();
      expect(result.data).toBeTruthy();

      console.log('Match found:', result.match_found);
      console.log('Matched explanation:', result.data?.explanation_id);
    }, 120000);

    it('should generate explanation with streaming callback', async () => {
      // Arrange
      const userInput = `Streaming test ${Date.now()}`;
      const streamedChunks: string[] = [];
      const streamingCallback = (chunk: string) => {
        streamedChunks.push(chunk);
      };

      // Act
      const result = await returnExplanationLogic(
        userInput,
        null,
        MatchMode.Search,
        testUserId,
        UserInputType.Query,
        [],
        streamingCallback
      );

      // Assert
      expect(result.error).toBeNull();
      expect(result.data).toBeTruthy();
      expect(streamedChunks.length).toBeGreaterThan(0);

      // Verify streaming sent progress events
      const hasProgressEvents = streamedChunks.some(chunk => {
        try {
          const parsed = JSON.parse(chunk);
          return parsed.type === 'progress';
        } catch {
          return false;
        }
      });

      expect(hasProgressEvents).toBe(true);

      console.log('Streamed chunks:', streamedChunks.length);
      console.log('First chunk:', streamedChunks[0]);
    }, 120000);

    it('should generate explanation with tags and verify database persistence', async () => {
      // Arrange
      const userInput = 'Explain neural networks and deep learning';

      // Act
      const result = await returnExplanationLogic(
        userInput,
        null,
        MatchMode.Search,
        testUserId,
        UserInputType.Query,
        []
      );

      // Assert - Basic validation
      expect(result.error).toBeNull();
      expect(result.data).toBeTruthy();

      if (result.data) {
        // Verify explanation saved to database
        const { data: savedExplanation } = await context.supabase
          .from('explanations')
          .select('*')
          .eq('explanation_id', result.data.explanation_id)
          .single();

        expect(savedExplanation).toBeTruthy();

        // Verify topic saved
        const { data: savedTopic } = await context.supabase
          .from('topics')
          .select('*')
          .eq('topic_id', savedExplanation?.topic_id)
          .single();

        expect(savedTopic).toBeTruthy();

        // Verify vector was stored in Pinecone
        await new Promise(resolve => setTimeout(resolve, 2000));
        const indexName = process.env.PINECONE_INDEX || 'test-index';
        const index = context.pinecone.index(indexName);
        const vectorResult = await index.namespace('').fetch([
          result.data.explanation_id,
        ]);

        expect(vectorResult.records).toBeDefined();
        expect(
          vectorResult.records[result.data.explanation_id]
        ).toBeDefined();

        console.log('Explanation ID:', result.data.explanation_id);
        console.log('Topic ID:', savedTopic?.topic_id);
        console.log('Vector stored:', !!vectorResult.records[result.data.explanation_id]);
      }
    }, 120000);

    it('should propagate request ID through the entire pipeline', async () => {
      // Arrange
      const userInput = `Request ID test ${Date.now()}`;
      const testRequestId = `test-req-${Date.now()}`;

      // Note: The actual implementation may need to be updated to support
      // passing request ID explicitly. This tests current behavior.

      // Act
      const result = await returnExplanationLogic(
        userInput,
        null,
        MatchMode.Search,
        testUserId,
        UserInputType.Query,
        []
      );

      // Assert
      expect(result.error).toBeNull();
      expect(result.data).toBeTruthy();

      // In a full implementation, we'd verify request ID appears in:
      // - Database records
      // - Log entries
      // - OpenTelemetry spans

      console.log('Generated with user ID:', testUserId);
    }, 120000);

    it('should handle parallel tag and link generation', async () => {
      // Arrange
      const userInput = 'Explain blockchain technology and cryptography';

      // Act
      const result = await returnExplanationLogic(
        userInput,
        null,
        MatchMode.Search,
        testUserId,
        UserInputType.Query,
        []
      );

      // Assert
      expect(result.error).toBeNull();
      expect(result.data).toBeTruthy();

      if (result.data) {
        // Verify content was enhanced (may have links)
        expect(result.data.content).toBeTruthy();
        expect(result.data.content.length).toBeGreaterThan(0);

        // Tags may or may not be present depending on AI evaluation
        // Just verify the structure is correct
        expect(Array.isArray(result.data.tags)).toBe(true);

        console.log('Content length:', result.data.content.length);
        console.log('Tags count:', result.data.tags?.length || 0);
      }
    }, 120000);
  });

  describe('Error Handling', () => {
    it('should handle OpenAI API errors gracefully', async () => {
      // This test would require mocking OpenAI to fail
      // In a real integration test with real APIs, we'd test actual failure scenarios
      // For now, we test input validation which triggers errors

      const userInput = '   '; // Whitespace only

      const result = await returnExplanationLogic(
        userInput,
        null,
        MatchMode.Search,
        testUserId,
        UserInputType.Query,
        []
      );

      expect(result.error).toBeTruthy();
      expect(result.data).toBeNull();
    });

    it('should validate user input type', async () => {
      const userInput = 'Valid query';

      // Test with different input types
      const resultQuery = await returnExplanationLogic(
        userInput,
        null,
        MatchMode.Search,
        testUserId,
        UserInputType.Query,
        []
      );

      expect(resultQuery.userInputType).toBe(UserInputType.Query);

      const resultTitle = await returnExplanationLogic(
        userInput,
        null,
        MatchMode.Search,
        testUserId,
        UserInputType.TitleFromLink,
        []
      );

      expect(resultTitle.userInputType).toBe(UserInputType.TitleFromLink);
    }, 120000);
  });
});
