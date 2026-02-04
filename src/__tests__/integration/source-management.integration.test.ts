/**
 * Integration Test: Source Management
 *
 * Tests source management RPC stored procedures against real database.
 * Validates: replace_explanation_sources, remove_and_renumber_source,
 * reorder_explanation_sources, get_source_citation_counts, get_co_cited_sources.
 */

import {
  setupTestDatabase,
  teardownTestDatabase,
  createTestContext,
  cleanupTestSourceCache,
  cleanupTestArticleSources,
} from '@/testing/utils/integration-helpers';
import { SupabaseClient } from '@supabase/supabase-js';
import { createTestSourceCache } from '@/testing/fixtures/database-records';

describe('Source Management Integration Tests', () => {
  let supabase: SupabaseClient;
  let cleanup: () => Promise<void>;
  let testId: string;

  // Track IDs for cleanup
  const createdExplanationIds: number[] = [];
  const createdSourceCacheIds: number[] = [];

  beforeAll(async () => {
    supabase = await setupTestDatabase();
    console.log('Source management integration tests: Database setup complete');
  });

  afterAll(async () => {
    // Clean up article_sources first (FK constraint)
    await cleanupTestArticleSources(supabase, createdExplanationIds);
    await cleanupTestSourceCache(supabase);
    await teardownTestDatabase(supabase);
    console.log('Source management integration tests: Database cleanup complete');
  });

  beforeEach(async () => {
    const context = await createTestContext();
    testId = context.testId;
    cleanup = context.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  // Helper: create a topic + explanation in DB
  const createExplanationInDb = async () => {
    const { data: topic } = await supabase
      .from('topics')
      .insert({
        topic_title: `[TEST] Topic ${testId}-${Date.now()}`,
        topic_description: 'Test topic for source management',
      })
      .select()
      .single();
    if (!topic) throw new Error('Failed to create topic');

    const { data: explanation } = await supabase
      .from('explanations')
      .insert({
        explanation_title: `[TEST] Explanation ${testId}-${Date.now()}`,
        primary_topic_id: topic.id,
        content: 'Test content for source management',
        status: 'published',
      })
      .select()
      .single();
    if (!explanation) throw new Error('Failed to create explanation');
    createdExplanationIds.push(explanation.id);
    return explanation;
  };

  // Helper: create source_cache entries in DB
  const createSourceInDb = async (overrides = {}) => {
    const sourceData = createTestSourceCache(overrides);
    const { data, error } = await supabase
      .from('source_cache')
      .insert({
        ...sourceData,
        fetched_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw new Error(`Failed to create source: ${error.message}`);
    createdSourceCacheIds.push(data.id);
    return data;
  };

  // ============================================================================
  // replace_explanation_sources RPC
  // ============================================================================
  describe('replace_explanation_sources', () => {
    it('should atomically replace all sources for an explanation', async () => {
      const explanation = await createExplanationInDb();
      const source1 = await createSourceInDb();
      const source2 = await createSourceInDb();
      const source3 = await createSourceInDb();

      // Link initial sources
      const { error: initError } = await supabase.rpc('replace_explanation_sources', {
        p_explanation_id: explanation.id,
        p_source_ids: [source1.id, source2.id],
      });
      expect(initError).toBeNull();

      // Replace with different set
      const { error: replaceError } = await supabase.rpc('replace_explanation_sources', {
        p_explanation_id: explanation.id,
        p_source_ids: [source3.id, source1.id],
      });
      expect(replaceError).toBeNull();

      // Verify new state
      const { data: links } = await supabase
        .from('article_sources')
        .select('source_cache_id, position')
        .eq('explanation_id', explanation.id)
        .order('position');

      expect(links).toHaveLength(2);
      expect(links![0]).toEqual({ source_cache_id: source3.id, position: 1 });
      expect(links![1]).toEqual({ source_cache_id: source1.id, position: 2 });
    });

    it('should remove all sources when given empty array', async () => {
      const explanation = await createExplanationInDb();
      const source1 = await createSourceInDb();

      // Link source
      await supabase.rpc('replace_explanation_sources', {
        p_explanation_id: explanation.id,
        p_source_ids: [source1.id],
      });

      // Remove all
      const { error } = await supabase.rpc('replace_explanation_sources', {
        p_explanation_id: explanation.id,
        p_source_ids: [],
      });
      expect(error).toBeNull();

      // Verify empty
      const { data: links } = await supabase
        .from('article_sources')
        .select('*')
        .eq('explanation_id', explanation.id);
      expect(links).toHaveLength(0);
    });
  });

  // ============================================================================
  // remove_and_renumber_source RPC
  // ============================================================================
  describe('remove_and_renumber_source', () => {
    it('should remove source and renumber remaining positions', async () => {
      const explanation = await createExplanationInDb();
      const source1 = await createSourceInDb();
      const source2 = await createSourceInDb();
      const source3 = await createSourceInDb();

      // Link 3 sources at positions 1, 2, 3
      await supabase.rpc('replace_explanation_sources', {
        p_explanation_id: explanation.id,
        p_source_ids: [source1.id, source2.id, source3.id],
      });

      // Remove middle source (position 2)
      const { error } = await supabase.rpc('remove_and_renumber_source', {
        p_explanation_id: explanation.id,
        p_source_cache_id: source2.id,
      });
      expect(error).toBeNull();

      // Verify renumbering: source1=1, source3=2
      const { data: links } = await supabase
        .from('article_sources')
        .select('source_cache_id, position')
        .eq('explanation_id', explanation.id)
        .order('position');

      expect(links).toHaveLength(2);
      expect(links![0]).toEqual({ source_cache_id: source1.id, position: 1 });
      expect(links![1]).toEqual({ source_cache_id: source3.id, position: 2 });
    });

    it('should raise exception for non-existent source', async () => {
      const explanation = await createExplanationInDb();

      const { error } = await supabase.rpc('remove_and_renumber_source', {
        p_explanation_id: explanation.id,
        p_source_cache_id: 99999,
      });

      expect(error).toBeTruthy();
    });
  });

  // ============================================================================
  // reorder_explanation_sources RPC
  // ============================================================================
  describe('reorder_explanation_sources', () => {
    it('should reorder sources atomically', async () => {
      const explanation = await createExplanationInDb();
      const source1 = await createSourceInDb();
      const source2 = await createSourceInDb();
      const source3 = await createSourceInDb();

      // Link in initial order
      await supabase.rpc('replace_explanation_sources', {
        p_explanation_id: explanation.id,
        p_source_ids: [source1.id, source2.id, source3.id],
      });

      // Reorder: 3, 1, 2
      const { error } = await supabase.rpc('reorder_explanation_sources', {
        p_explanation_id: explanation.id,
        p_source_ids: [source3.id, source1.id, source2.id],
      });
      expect(error).toBeNull();

      // Verify new order
      const { data: links } = await supabase
        .from('article_sources')
        .select('source_cache_id, position')
        .eq('explanation_id', explanation.id)
        .order('position');

      expect(links).toHaveLength(3);
      expect(links![0]).toEqual({ source_cache_id: source3.id, position: 1 });
      expect(links![1]).toEqual({ source_cache_id: source1.id, position: 2 });
      expect(links![2]).toEqual({ source_cache_id: source2.id, position: 3 });
    });

    it('should raise exception on source count mismatch', async () => {
      const explanation = await createExplanationInDb();
      const source1 = await createSourceInDb();
      const source2 = await createSourceInDb();

      // Link 2 sources
      await supabase.rpc('replace_explanation_sources', {
        p_explanation_id: explanation.id,
        p_source_ids: [source1.id, source2.id],
      });

      // Try to reorder with wrong count
      const { error } = await supabase.rpc('reorder_explanation_sources', {
        p_explanation_id: explanation.id,
        p_source_ids: [source1.id],
      });

      expect(error).toBeTruthy();
    });
  });

  // ============================================================================
  // get_source_citation_counts RPC
  // ============================================================================
  describe('get_source_citation_counts', () => {
    it('should return citation counts aggregated across explanations', async () => {
      // Create 2 explanations that share a source
      const explanation1 = await createExplanationInDb();
      const explanation2 = await createExplanationInDb();
      const sharedSource = await createSourceInDb();
      const uniqueSource = await createSourceInDb();

      // Link shared source to both explanations
      await supabase.rpc('replace_explanation_sources', {
        p_explanation_id: explanation1.id,
        p_source_ids: [sharedSource.id, uniqueSource.id],
      });
      await supabase.rpc('replace_explanation_sources', {
        p_explanation_id: explanation2.id,
        p_source_ids: [sharedSource.id],
      });

      // Query citation counts
      const { data, error } = await supabase.rpc('get_source_citation_counts', {
        p_period: 'all',
        p_limit: 100,
      });
      expect(error).toBeNull();
      expect(data).toBeTruthy();

      // Find our shared source in results
      const sharedResult = data.find(
        (r: { source_cache_id: number }) => r.source_cache_id === sharedSource.id
      );
      expect(sharedResult).toBeTruthy();
      // total_citations: 2 (one link per explanation)
      // unique_explanations: 2
      expect(Number(sharedResult.total_citations)).toBe(2);
      expect(Number(sharedResult.unique_explanations)).toBe(2);
    });
  });

  // ============================================================================
  // get_co_cited_sources RPC
  // ============================================================================
  describe('get_co_cited_sources', () => {
    it('should find sources frequently co-cited with a given source', async () => {
      const explanation = await createExplanationInDb();
      const sourceA = await createSourceInDb();
      const sourceB = await createSourceInDb();

      // Link both sources to same explanation
      await supabase.rpc('replace_explanation_sources', {
        p_explanation_id: explanation.id,
        p_source_ids: [sourceA.id, sourceB.id],
      });

      // Query co-cited with sourceA
      const { data, error } = await supabase.rpc('get_co_cited_sources', {
        p_source_id: sourceA.id,
        p_limit: 10,
      });
      expect(error).toBeNull();
      expect(data).toBeTruthy();

      // sourceB should appear as co-cited with sourceA
      const coCited = data.find(
        (r: { source_cache_id: number }) => r.source_cache_id === sourceB.id
      );
      expect(coCited).toBeTruthy();
      expect(Number(coCited.co_citation_count)).toBe(1);
    });
  });
});
