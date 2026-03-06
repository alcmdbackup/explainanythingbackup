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
      topic_title: `[TEST] Topic ${testId}-${Date.now()}`,
      topic_description: 'Test topic description',
    };
    const { data, error } = await supabase.from('topics').insert(mockTopic).select().single();
    if (error) throw new Error(`Failed to create topic: ${error.message}`);
    return data;
  };

  const createExplanationInDb = async (topicId: number) => {
    const mockExplanation = {
      explanation_title: `[TEST] Explanation ${testId}-${Date.now()}`,
      primary_topic_id: topicId,
      content: 'Test explanation content for tag management tests',
      status: 'published',
    };
    const { data, error } = await supabase.from('explanations').insert(mockExplanation).select().single();
    if (error) throw new Error(`Failed to create explanation: ${error.message}`);
    return data;
  };

  const createTagInDb = async (tagName: string, presetTagId: number | null = null) => {
    const mockTag = {
      tag_name: `[TEST] ${tagName}-${testId}-${Date.now()}`,
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
      const explanation = await createExplanationInDb(topic.id);
      const tag1 = await createTagInDb('javascript');
      const tag2 = await createTagInDb('tutorial');

      const results = await addTagsToExplanation(explanation.id, [tag1.id, tag2.id]);

      expect(results).toHaveLength(2);
      expect(results[0].explanation_id).toBe(explanation.id);
      expect(results[0].isDeleted).toBe(false);

      const { data: dbRelationships } = await supabase
        .from('explanation_tags')
        .select('*')
        .eq('explanation_id', explanation.id)
        .eq('isDeleted', false);

      expect(dbRelationships).toHaveLength(2);
    });

    it('should throw error when adding conflicting preset tags', async () => {
      const topic = await createTopicInDb();
      const explanation = await createExplanationInDb(topic.id);
      const tag1 = await createTagInDb('basic', 1);
      const tag2 = await createTagInDb('advanced', 1);

      await expect(
        addTagsToExplanation(explanation.id, [tag1.id, tag2.id])
      ).rejects.toThrow('multiple preset tags of the same type cannot be added');
    });
  });

  describe('Removing Tags from Explanation', () => {
    it('should soft delete tags (set isDeleted to true)', async () => {
      const topic = await createTopicInDb();
      const explanation = await createExplanationInDb(topic.id);
      const tag1 = await createTagInDb('nodejs');
      const tag2 = await createTagInDb('api');

      await addTagsToExplanation(explanation.id, [tag1.id, tag2.id]);
      await removeTagsFromExplanation(explanation.id, [tag1.id]);

      const { data: relationships } = await supabase
        .from('explanation_tags')
        .select('*')
        .eq('explanation_id', explanation.id)
        .eq('tag_id', tag1.id)
        .single();

      expect(relationships.isDeleted).toBe(true);

      const { data: activeTag } = await supabase
        .from('explanation_tags')
        .select('*')
        .eq('explanation_id', explanation.id)
        .eq('tag_id', tag2.id)
        .single();

      expect(activeTag.isDeleted).toBe(false);
    });

    it('should not return soft-deleted tags in getTagsForExplanation', async () => {
      const topic = await createTopicInDb();
      const explanation = await createExplanationInDb(topic.id);
      const tag1 = await createTagInDb('python');
      const tag2 = await createTagInDb('django');

      await addTagsToExplanation(explanation.id, [tag1.id, tag2.id]);
      await removeTagsFromExplanation(explanation.id, [tag1.id]);

      const tags = await getTagsForExplanation(explanation.id);

      expect(tags).toHaveLength(1);
      // Type narrowing for union type - simple tag has tag_name directly
      const firstTag = tags[0];
      expect('tag_name' in firstTag && firstTag.tag_name).toContain('django');
    });
  });

  describe('Reactivating Soft-Deleted Tags', () => {
    it('should reactivate soft-deleted tag when added again', async () => {
      const topic = await createTopicInDb();
      const explanation = await createExplanationInDb(topic.id);
      const tag = await createTagInDb('react');

      await addTagsToExplanation(explanation.id, [tag.id]);
      await removeTagsFromExplanation(explanation.id, [tag.id]);

      const { data: deletedRelationship } = await supabase
        .from('explanation_tags')
        .select('*')
        .eq('explanation_id', explanation.id)
        .eq('tag_id', tag.id)
        .single();

      expect(deletedRelationship.isDeleted).toBe(true);

      const results = await addTagsToExplanation(explanation.id, [tag.id]);

      expect(results).toHaveLength(1);
      expect(results[0].isDeleted).toBe(false);
      expect(results[0].id).toBe(deletedRelationship.id);

      const { data: reactivatedRelationship } = await supabase
        .from('explanation_tags')
        .select('*')
        .eq('explanation_id', explanation.id)
        .eq('tag_id', tag.id)
        .single();

      expect(reactivatedRelationship.isDeleted).toBe(false);
      expect(reactivatedRelationship.id).toBe(deletedRelationship.id);
    });
  });

  describe('Bulk Tag Operations', () => {
    it('should handle adding multiple tags efficiently', async () => {
      const topic = await createTopicInDb();
      const explanation = await createExplanationInDb(topic.id);
      // Create tags sequentially to avoid race condition where getTagsById
      // query runs before all tags are visible in the database
      const tags = [];
      for (let i = 0; i < 5; i++) {
        tags.push(await createTagInDb(`tag-${i}`));
      }
      const tagIds = tags.map((t) => t.id);

      const startTime = Date.now();
      const results = await addTagsToExplanation(explanation.id, tagIds);
      const duration = Date.now() - startTime;

      expect(results).toHaveLength(5);
      expect(duration).toBeLessThan(5000); // Allow more time for actual DB operations

      const { data: dbRelationships } = await supabase
        .from('explanation_tags')
        .select('*')
        .eq('explanation_id', explanation.id)
        .eq('isDeleted', false);

      expect(dbRelationships).toHaveLength(5);
    });

    it('should handle removing multiple tags efficiently', async () => {
      const topic = await createTopicInDb();
      const explanation = await createExplanationInDb(topic.id);
      const tags = await Promise.all(
        Array.from({ length: 5 }, (_, i) => createTagInDb(`remove-tag-${i}`))
      );
      const tagIds = tags.map((t) => t.id);

      await addTagsToExplanation(explanation.id, tagIds);

      const toRemove = tagIds.slice(0, 3);
      await removeTagsFromExplanation(explanation.id, toRemove);

      const activeTags = await getTagsForExplanation(explanation.id);
      expect(activeTags).toHaveLength(2);
    });
  });

  describe('Tag UI Format Conversion', () => {
    it('should return tags in correct UI format', async () => {
      const topic = await createTopicInDb();
      const explanation = await createExplanationInDb(topic.id);
      const simpleTag = await createTagInDb('javascript', null);
      const presetTag = await createTagInDb('beginner', 1);

      await addTagsToExplanation(explanation.id, [simpleTag.id, presetTag.id]);

      const tags = await getTagsForExplanation(explanation.id);

      expect(tags).toHaveLength(2);

      // Simple tags have tag_name directly, preset tags have tags array
      const simpleTagResult = tags.find((t) => 'tag_name' in t && t.tag_name.includes('javascript'));
      expect(simpleTagResult).toBeDefined();
      if (simpleTagResult && 'tag_name' in simpleTagResult) {
        expect(simpleTagResult.tag_name).toContain('javascript');
        expect(simpleTagResult.presetTagId).toBeNull();
      }

      const presetTagResult = tags.find((t) => 'tags' in t && t.tags.some(tag => tag.tag_name.includes('beginner')));
      expect(presetTagResult).toBeDefined();
      if (presetTagResult && 'tags' in presetTagResult) {
        expect(presetTagResult.tags).toBeDefined();
        expect(presetTagResult.tags.some(tag => tag.presetTagId === 1)).toBe(true);
      }
    });
  });
});
