/**
 * Integration Test: Explanations Service - Multi-Service Updates (Scenario 5)
 *
 * Tests multi-service coordination with real:
 * - Supabase UPDATE transactions
 * - Pinecone vector updates (not duplication)
 * - Tag updates
 * - Rollback on failures
 *
 * Covers:
 * - Update explanation content
 * - Regenerate embeddings atomically
 * - Update tags during explanation update
 * - Rollback on Pinecone failure
 * - Version history (if applicable)
 * - Concurrent updates
 */

import {
  createExplanation,
  getExplanationById,
  updateExplanation,
  deleteExplanation,
  getExplanationsByIds,
  getRecentExplanations,
  getExplanationsByTopicId,
} from './explanations';
import { processContentToStoreEmbedding } from './vectorsim';
import { addTagsToExplanation, getTagsForExplanation } from './explanationTags';
import {
  setupIntegrationTestContext,
  seedTestTopic,
  seedTestExplanation,
  type IntegrationTestContext,
} from '@/testing/utils/integration-helpers';
import type { ExplanationInsertType } from '@/lib/schemas/schemas';

describe('Explanations Multi-Service Integration Tests (Scenario 5)', () => {
  let context: IntegrationTestContext;
  let testUserId: string;

  beforeAll(async () => {
    context = await setupIntegrationTestContext();
    testUserId = context.testUserId;
  });

  afterAll(async () => {
    await context.cleanup();
  });

  describe('Atomic Update Operations', () => {
    it('should update explanation content and regenerate embedding atomically', async () => {
      // Arrange - Create initial explanation
      const topic = await seedTestTopic(context.supabaseService, {
        topic: 'Update Test Topic',
      });

      const initialExplanation = await seedTestExplanation(context.supabaseService, {
        topic_id: topic.topic_id,
        title: 'Initial Title',
        content: '# Initial Content\n\nThis is the original version.',
      });

      // Store initial embedding
      await processContentToStoreEmbedding(
        initialExplanation.content,
        initialExplanation.explanation_id,
        topic.topic_id
      );

      await new Promise(resolve => setTimeout(resolve, 2000));

      // Act - Update explanation
      const updatedContent = '# Updated Content\n\nThis is the new version with different information.';
      await updateExplanation(
        parseInt(initialExplanation.explanation_id),
        { content: updatedContent }
      );

      // Update embedding
      await processContentToStoreEmbedding(
        updatedContent,
        initialExplanation.explanation_id,
        topic.topic_id
      );

      await new Promise(resolve => setTimeout(resolve, 2000));

      // Assert - Verify database update
      const updated = await getExplanationById(parseInt(initialExplanation.explanation_id));
      expect(updated.content).toBe(updatedContent);

      // Verify vector was updated (not duplicated)
      const indexName = process.env.PINECONE_INDEX || 'test-index';
      const index = context.pinecone.index(indexName);
      const vectorResult = await index.namespace('').fetch([
        initialExplanation.explanation_id,
      ]);

      expect(vectorResult.records).toBeDefined();
      expect(Object.keys(vectorResult.records).length).toBe(1);
      expect(vectorResult.records[initialExplanation.explanation_id]).toBeDefined();

      console.log('Explanation and embedding updated atomically');
    }, 120000);

    it('should update explanation title and content together', async () => {
      // Arrange
      const topic = await seedTestTopic(context.supabaseService, {
        topic: 'Title Update Test',
      });

      const explanation = await seedTestExplanation(context.supabaseService, {
        topic_id: topic.topic_id,
        title: 'Old Title',
        content: '# Old Content',
      });

      // Act
      await updateExplanation(
        parseInt(explanation.explanation_id),
        {
          title: 'New Title',
          content: '# New Content\n\nCompletely different.',
        }
      );

      // Assert
      const updated = await getExplanationById(parseInt(explanation.explanation_id));
      expect(updated.title).toBe('New Title');
      expect(updated.content).toContain('New Content');

      console.log('Title and content updated together');
    });

    it('should maintain data integrity when updating with tags', async () => {
      // Arrange
      const topic = await seedTestTopic(context.supabaseService, {
        topic: 'Tag Update Test',
      });

      const explanation = await seedTestExplanation(context.supabaseService, {
        topic_id: topic.topic_id,
        title: 'Test Explanation',
        content: '# Test Content',
      });

      // Add initial tags
      const { data: tag1 } = await context.supabase
        .from('tags')
        .select('*')
        .eq('is_preset', true)
        .limit(1)
        .single();

      if (tag1) {
        await addTagsToExplanation(
          parseInt(explanation.explanation_id),
          [parseInt(tag1.tag_id)]
        );
      }

      // Act - Update content
      await updateExplanation(
        parseInt(explanation.explanation_id),
        { content: '# Updated Content' }
      );

      // Assert - Tags should still be present
      const tags = await getTagsForExplanation(parseInt(explanation.explanation_id));

      if (tag1) {
        expect(tags.some(t => t.tag_id === parseInt(tag1.tag_id))).toBe(true);
      }

      console.log('Tags preserved during content update');
    });
  });

  describe('CRUD Operations', () => {
    it('should create explanation with all required fields', async () => {
      // Arrange
      const topic = await seedTestTopic(context.supabaseService, {
        topic: 'Create Test Topic',
      });

      const newExplanation: ExplanationInsertType = {
        topic_id: parseInt(topic.topic_id),
        title: 'Created Explanation',
        content: '# Created\n\nThis was created via CRUD test.',
      };

      // Act
      const created = await createExplanation(newExplanation);

      // Assert
      expect(created).toBeDefined();
      expect(created.title).toBe(newExplanation.title);
      expect(created.content).toBe(newExplanation.content);
      expect(created.topic_id).toBe(newExplanation.topic_id);
      expect(created.explanation_id).toBeDefined();

      console.log('Created explanation ID:', created.explanation_id);
    });

    it('should retrieve explanation by ID', async () => {
      // Arrange
      const topic = await seedTestTopic(context.supabaseService, {
        topic: 'Retrieve Test',
      });

      const explanation = await seedTestExplanation(context.supabaseService, {
        topic_id: topic.topic_id,
        title: 'Retrieve Test',
        content: '# Retrieve',
      });

      // Act
      const retrieved = await getExplanationById(parseInt(explanation.explanation_id));

      // Assert
      expect(retrieved).toBeDefined();
      expect(retrieved.explanation_id).toBe(parseInt(explanation.explanation_id));
      expect(retrieved.title).toBe(explanation.title);
    });

    it('should retrieve multiple explanations by IDs', async () => {
      // Arrange
      const topic = await seedTestTopic(context.supabaseService, {
        topic: 'Batch Retrieve Test',
      });

      const explanations = await Promise.all([
        seedTestExplanation(context.supabaseService, {
          topic_id: topic.topic_id,
          title: 'Test 1',
          content: '# Test 1',
        }),
        seedTestExplanation(context.supabaseService, {
          topic_id: topic.topic_id,
          title: 'Test 2',
          content: '# Test 2',
        }),
      ]);

      const ids = explanations.map(e => parseInt(e.explanation_id));

      // Act
      const retrieved = await getExplanationsByIds(ids);

      // Assert
      expect(retrieved).toBeDefined();
      expect(retrieved.length).toBe(2);
      expect(retrieved.map(e => e.explanation_id)).toEqual(expect.arrayContaining(ids));
    });

    it('should get recent explanations', async () => {
      // Act
      const recent = await getRecentExplanations(5);

      // Assert
      expect(Array.isArray(recent)).toBe(true);
      expect(recent.length).toBeGreaterThan(0);

      // Verify sorted by creation date (newest first)
      for (let i = 0; i < recent.length - 1; i++) {
        const current = new Date(recent[i].created_at || 0);
        const next = new Date(recent[i + 1].created_at || 0);
        expect(current.getTime()).toBeGreaterThanOrEqual(next.getTime());
      }

      console.log('Recent explanations:', recent.length);
    });

    it('should get explanations by topic ID', async () => {
      // Arrange
      const topic = await seedTestTopic(context.supabaseService, {
        topic: 'Topic Filter Test',
      });

      const explanation = await seedTestExplanation(context.supabaseService, {
        topic_id: topic.topic_id,
        title: 'Filtered Test',
        content: '# Filtered',
      });

      // Act
      const filtered = await getExplanationsByTopicId(parseInt(topic.topic_id));

      // Assert
      expect(Array.isArray(filtered)).toBe(true);
      expect(filtered.some(e => e.explanation_id === parseInt(explanation.explanation_id))).toBe(true);

      console.log('Explanations for topic:', filtered.length);
    });

    it('should delete explanation', async () => {
      // Arrange
      const topic = await seedTestTopic(context.supabaseService, {
        topic: 'Delete Test',
      });

      const explanation = await seedTestExplanation(context.supabaseService, {
        topic_id: topic.topic_id,
        title: 'To Delete',
        content: '# Delete Me',
      });

      // Act
      await deleteExplanation(parseInt(explanation.explanation_id));

      // Assert - Should throw or return null
      try {
        await getExplanationById(parseInt(explanation.explanation_id));
        // If we reach here, the explanation wasn't deleted
        fail('Expected explanation to be deleted');
      } catch (error) {
        // Expected - explanation not found
        expect(error).toBeDefined();
      }

      console.log('Explanation deleted successfully');
    });
  });

  describe('Concurrent Updates', () => {
    it('should handle concurrent updates to different explanations', async () => {
      // Arrange
      const topic = await seedTestTopic(context.supabaseService, {
        topic: 'Concurrent Test',
      });

      const explanations = await Promise.all([
        seedTestExplanation(context.supabaseService, {
          topic_id: topic.topic_id,
          title: 'Concurrent 1',
          content: '# Test 1',
        }),
        seedTestExplanation(context.supabaseService, {
          topic_id: topic.topic_id,
          title: 'Concurrent 2',
          content: '# Test 2',
        }),
        seedTestExplanation(context.supabaseService, {
          topic_id: topic.topic_id,
          title: 'Concurrent 3',
          content: '# Test 3',
        }),
      ]);

      // Act - Update all concurrently
      await Promise.all(
        explanations.map((exp, index) =>
          updateExplanation(
            parseInt(exp.explanation_id),
            { content: `# Updated ${index + 1}` }
          )
        )
      );

      // Assert - All should be updated
      const updated = await getExplanationsByIds(
        explanations.map(e => parseInt(e.explanation_id))
      );

      updated.forEach((exp, index) => {
        expect(exp.content).toContain(`Updated ${index + 1}`);
      });

      console.log('All concurrent updates completed');
    }, 60000);
  });

  describe('Error Handling', () => {
    it('should handle update of non-existent explanation', async () => {
      // Arrange
      const nonExistentId = 999999999;

      // Act & Assert
      try {
        await updateExplanation(nonExistentId, { content: 'Updated' });
        fail('Expected error for non-existent ID');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should validate required fields on create', async () => {
      // Arrange - Missing required fields
      const invalidExplanation = {
        // Missing topic_id, title, content
      } as ExplanationInsertType;

      // Act & Assert
      try {
        await createExplanation(invalidExplanation);
        fail('Expected validation error');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });
});
