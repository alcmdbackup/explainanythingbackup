/**
 * Integration Test: Tag Management Integration
 *
 * Tests tag management with real database operations
 * This validates:
 * - Adding tags to explanations
 * - Preset tag conflict detection
 * - Soft delete pattern for tag removal
 * - Tag retrieval with UI format conversion
 * - Bulk tag operations
 */

import { setupTestDatabase, teardownTestDatabase, createTestContext } from '@/testing/utils/integration-helpers';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  addTagsToExplanation,
  removeTagsFromExplanation,
  getTagsForExplanation,
} from '@/lib/services/explanationTags';

describe('Tag Management Integration Tests', () => {
  let supabase: SupabaseClient;
  let testId: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    supabase = await setupTestDatabase();
    console.log('Tag management integration tests: Database setup complete');
  });

  afterAll(async () => {
    await teardownTestDatabase(supabase);
    console.log('Tag management integration tests: Database cleanup complete');
  });

  beforeEach(async () => {
    const context = await createTestContext();
    testId = context.testId;
    cleanup = context.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  const createTopicInDb = async () => {
    const mockTopic = {
      topic_id: `${testId}-topic-${Date.now()}`,
      topic_name: 'Test Topic',
    };
    const { data, error } = await supabase.from('topics').insert(mockTopic).select().single();
    if (error) throw new Error(`Failed to create topic: ${error.message}`);
    return data;
  };

  const createExplanationInDb = async (topicId: string) => {
    const mockExplanation = {
      explanation_id: `${testId}-explanation-${Date.now()}`,
      topic_id: topicId,
      title: 'Test Explanation',
      content: 'Test content',
    };
    const { data, error } = await supabase.from('explanations').insert(mockExplanation).select().single();
    if (error) throw new Error(`Failed to create explanation: ${error.message}`);
    return data;
  };

  const createTagInDb = async (tagName: string, presetTagId: number | null = null) => {
    const mockTag = {
      tag_id: `${testId}-tag-${tagName}-${Date.now()}`,
      tag_name: tagName,
      tag_description: `Description for ${tagName}`,
      presetTagId,
    };
    const { data, error } = await supabase.from('tags').insert(mockTag).select().single();
    if (error) throw new Error(`Failed to create tag: ${error.message}`);
    return data;
  };

  describe('Adding Tags to Explanation', () => {
    it('should add valid tags to an explanation', async () => {
      const topic = await createTopicInDb();
      const explanation = await createExplanationInDb(topic.topic_id);
      const tag1 = await createTagInDb('javascript');
      const tag2 = await createTagInDb('tutorial');

      const results = await addTagsToExplanation(explanation.explanation_id, [tag1.tag_id, tag2.tag_id]);

      expect(results).toHaveLength(2);
      expect(results[0].explanation_id).toBe(explanation.explanation_id);
      expect(results[0].isDeleted).toBe(false);

      const { data: dbRelationships } = await supabase
        .from('explanation_tags')
        .select('*')
        .eq('explanation_id', explanation.explanation_id)
        .eq('isDeleted', false);

      expect(dbRelationships).toHaveLength(2);
    });

    it('should throw error when adding conflicting preset tags', async () => {
      const topic = await createTopicInDb();
      const explanation = await createExplanationInDb(topic.topic_id);
      const tag1 = await createTagInDb('basic', 1);
      const tag2 = await createTagInDb('advanced', 1);

      await expect(
        addTagsToExplanation(explanation.explanation_id, [tag1.tag_id, tag2.tag_id])
      ).rejects.toThrow('multiple preset tags of the same type cannot be added');
    });
  });

  describe('Removing Tags from Explanation', () => {
    it('should soft delete tags (set isDeleted to true)', async () => {
      const topic = await createTopicInDb();
      const explanation = await createExplanationInDb(topic.topic_id);
      const tag1 = await createTagInDb('nodejs');
      const tag2 = await createTagInDb('api');

      await addTagsToExplanation(explanation.explanation_id, [tag1.tag_id, tag2.tag_id]);
      await removeTagsFromExplanation(explanation.explanation_id, [tag1.tag_id]);

      const { data: relationships } = await supabase
        .from('explanation_tags')
        .select('*')
        .eq('explanation_id', explanation.explanation_id)
        .eq('tag_id', tag1.tag_id)
        .single();

      expect(relationships.isDeleted).toBe(true);

      const { data: activeTag } = await supabase
        .from('explanation_tags')
        .select('*')
        .eq('explanation_id', explanation.explanation_id)
        .eq('tag_id', tag2.tag_id)
        .single();

      expect(activeTag.isDeleted).toBe(false);
    });

    it('should not return soft-deleted tags in getTagsForExplanation', async () => {
      const topic = await createTopicInDb();
      const explanation = await createExplanationInDb(topic.topic_id);
      const tag1 = await createTagInDb('python');
      const tag2 = await createTagInDb('django');

      await addTagsToExplanation(explanation.explanation_id, [tag1.tag_id, tag2.tag_id]);
      await removeTagsFromExplanation(explanation.explanation_id, [tag1.tag_id]);

      const tags = await getTagsForExplanation(explanation.explanation_id);

      expect(tags).toHaveLength(1);
      expect(tags[0].tagName).toBe('django');
    });
  });

  describe('Reactivating Soft-Deleted Tags', () => {
    it('should reactivate soft-deleted tag when added again', async () => {
      const topic = await createTopicInDb();
      const explanation = await createExplanationInDb(topic.topic_id);
      const tag = await createTagInDb('react');

      await addTagsToExplanation(explanation.explanation_id, [tag.tag_id]);
      await removeTagsFromExplanation(explanation.explanation_id, [tag.tag_id]);

      const { data: deletedRelationship } = await supabase
        .from('explanation_tags')
        .select('*')
        .eq('explanation_id', explanation.explanation_id)
        .eq('tag_id', tag.tag_id)
        .single();

      expect(deletedRelationship.isDeleted).toBe(true);

      const results = await addTagsToExplanation(explanation.explanation_id, [tag.tag_id]);

      expect(results).toHaveLength(1);
      expect(results[0].isDeleted).toBe(false);
      expect(results[0].id).toBe(deletedRelationship.id);

      const { data: reactivatedRelationship } = await supabase
        .from('explanation_tags')
        .select('*')
        .eq('explanation_id', explanation.explanation_id)
        .eq('tag_id', tag.tag_id)
        .single();

      expect(reactivatedRelationship.isDeleted).toBe(false);
      expect(reactivatedRelationship.id).toBe(deletedRelationship.id);
    });
  });

  describe('Bulk Tag Operations', () => {
    it('should handle adding multiple tags efficiently', async () => {
      const topic = await createTopicInDb();
      const explanation = await createExplanationInDb(topic.topic_id);
      const tags = await Promise.all(
        Array.from({ length: 5 }, (_, i) => createTagInDb(`tag-${i}`))
      );
      const tagIds = tags.map((t) => t.tag_id);

      const startTime = Date.now();
      const results = await addTagsToExplanation(explanation.explanation_id, tagIds);
      const duration = Date.now() - startTime;

      expect(results).toHaveLength(5);
      expect(duration).toBeLessThan(2000);

      const { data: dbRelationships } = await supabase
        .from('explanation_tags')
        .select('*')
        .eq('explanation_id', explanation.explanation_id)
        .eq('isDeleted', false);

      expect(dbRelationships).toHaveLength(5);
    });

    it('should handle removing multiple tags efficiently', async () => {
      const topic = await createTopicInDb();
      const explanation = await createExplanationInDb(topic.topic_id);
      const tags = await Promise.all(
        Array.from({ length: 5 }, (_, i) => createTagInDb(`remove-tag-${i}`))
      );
      const tagIds = tags.map((t) => t.tag_id);

      await addTagsToExplanation(explanation.explanation_id, tagIds);

      const toRemove = tagIds.slice(0, 3);
      await removeTagsFromExplanation(explanation.explanation_id, toRemove);

      const activeTags = await getTagsForExplanation(explanation.explanation_id);
      expect(activeTags).toHaveLength(2);
    });
  });

  describe('Tag UI Format Conversion', () => {
    it('should return tags in correct UI format', async () => {
      const topic = await createTopicInDb();
      const explanation = await createExplanationInDb(topic.topic_id);
      const simpleTag = await createTagInDb('javascript', null);
      const presetTag = await createTagInDb('beginner', 1);

      await addTagsToExplanation(explanation.explanation_id, [simpleTag.tag_id, presetTag.tag_id]);

      const tags = await getTagsForExplanation(explanation.explanation_id);

      expect(tags).toHaveLength(2);

      const simpleTagResult = tags.find((t) => t.tagName === 'javascript');
      expect(simpleTagResult).toBeDefined();
      expect(simpleTagResult?.type).toBe('simple');

      const presetTagResult = tags.find((t) => t.tagName === 'beginner');
      expect(presetTagResult).toBeDefined();
      expect(presetTagResult?.type).toBe('preset');
      if (presetTagResult?.type === 'preset') {
        expect(presetTagResult.presetTagId).toBe(1);
      }
    });
  });
});
