/**
 * Unit tests for source management Zod schemas.
 * Tests input validation for source CRUD operations.
 * @jest-environment node
 */

import {
  updateSourcesInputSchema,
  addSourceInputSchema,
  removeSourceInputSchema,
  reorderSourcesInputSchema,
  sourceCitationCountSchema,
} from './schemas';

describe('Source Management Schemas', () => {
  // ============================================================================
  // updateSourcesInputSchema
  // ============================================================================
  describe('updateSourcesInputSchema', () => {
    it('should accept valid input', () => {
      const result = updateSourcesInputSchema.safeParse({
        explanationId: 1,
        sourceIds: [1, 2, 3],
      });
      expect(result.success).toBe(true);
    });

    it('should accept empty sourceIds array (remove all)', () => {
      const result = updateSourcesInputSchema.safeParse({
        explanationId: 1,
        sourceIds: [],
      });
      expect(result.success).toBe(true);
    });

    it('should reject more than 5 sourceIds', () => {
      const result = updateSourcesInputSchema.safeParse({
        explanationId: 1,
        sourceIds: [1, 2, 3, 4, 5, 6],
      });
      expect(result.success).toBe(false);
    });

    it('should reject negative explanationId', () => {
      const result = updateSourcesInputSchema.safeParse({
        explanationId: -1,
        sourceIds: [1],
      });
      expect(result.success).toBe(false);
    });

    it('should reject non-integer sourceIds', () => {
      const result = updateSourcesInputSchema.safeParse({
        explanationId: 1,
        sourceIds: [1.5],
      });
      expect(result.success).toBe(false);
    });

    it('should reject zero explanationId', () => {
      const result = updateSourcesInputSchema.safeParse({
        explanationId: 0,
        sourceIds: [1],
      });
      expect(result.success).toBe(false);
    });
  });

  // ============================================================================
  // addSourceInputSchema
  // ============================================================================
  describe('addSourceInputSchema', () => {
    it('should accept valid HTTPS URL', () => {
      const result = addSourceInputSchema.safeParse({
        explanationId: 1,
        sourceUrl: 'https://example.com/article',
      });
      expect(result.success).toBe(true);
    });

    it('should accept valid HTTP URL', () => {
      const result = addSourceInputSchema.safeParse({
        explanationId: 1,
        sourceUrl: 'http://example.com/article',
      });
      expect(result.success).toBe(true);
    });

    it('should reject ftp:// URLs', () => {
      const result = addSourceInputSchema.safeParse({
        explanationId: 1,
        sourceUrl: 'ftp://example.com/file',
      });
      expect(result.success).toBe(false);
    });

    it('should reject data: URLs', () => {
      const result = addSourceInputSchema.safeParse({
        explanationId: 1,
        sourceUrl: 'data:text/html,<h1>test</h1>',
      });
      expect(result.success).toBe(false);
    });

    it('should reject javascript: URLs', () => {
      const result = addSourceInputSchema.safeParse({
        explanationId: 1,
        sourceUrl: 'javascript:alert(1)',
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid URL format', () => {
      const result = addSourceInputSchema.safeParse({
        explanationId: 1,
        sourceUrl: 'not-a-url',
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty string', () => {
      const result = addSourceInputSchema.safeParse({
        explanationId: 1,
        sourceUrl: '',
      });
      expect(result.success).toBe(false);
    });
  });

  // ============================================================================
  // removeSourceInputSchema
  // ============================================================================
  describe('removeSourceInputSchema', () => {
    it('should accept valid input', () => {
      const result = removeSourceInputSchema.safeParse({
        explanationId: 1,
        sourceCacheId: 42,
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing sourceCacheId', () => {
      const result = removeSourceInputSchema.safeParse({
        explanationId: 1,
      });
      expect(result.success).toBe(false);
    });

    it('should reject negative sourceCacheId', () => {
      const result = removeSourceInputSchema.safeParse({
        explanationId: 1,
        sourceCacheId: -1,
      });
      expect(result.success).toBe(false);
    });
  });

  // ============================================================================
  // reorderSourcesInputSchema
  // ============================================================================
  describe('reorderSourcesInputSchema', () => {
    it('should accept valid input with 1-5 sourceIds', () => {
      const result = reorderSourcesInputSchema.safeParse({
        explanationId: 1,
        sourceIds: [3, 1, 2],
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty sourceIds array', () => {
      const result = reorderSourcesInputSchema.safeParse({
        explanationId: 1,
        sourceIds: [],
      });
      expect(result.success).toBe(false);
    });

    it('should reject more than 5 sourceIds', () => {
      const result = reorderSourcesInputSchema.safeParse({
        explanationId: 1,
        sourceIds: [1, 2, 3, 4, 5, 6],
      });
      expect(result.success).toBe(false);
    });

    it('should accept exactly 5 sourceIds', () => {
      const result = reorderSourcesInputSchema.safeParse({
        explanationId: 1,
        sourceIds: [1, 2, 3, 4, 5],
      });
      expect(result.success).toBe(true);
    });
  });

  // ============================================================================
  // sourceCitationCountSchema
  // ============================================================================
  describe('sourceCitationCountSchema', () => {
    it('should parse valid citation count data', () => {
      const data = {
        source_cache_id: 1,
        total_citations: 47,
        unique_explanations: 31,
        domain: 'en.wikipedia.org',
        title: 'Quantum Computing',
        favicon_url: 'https://www.google.com/s2/favicons?domain=en.wikipedia.org&sz=32',
      };
      const result = sourceCitationCountSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept null title and favicon_url', () => {
      const data = {
        source_cache_id: 1,
        total_citations: 5,
        unique_explanations: 3,
        domain: 'example.com',
        title: null,
        favicon_url: null,
      };
      const result = sourceCitationCountSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject missing required fields', () => {
      const result = sourceCitationCountSchema.safeParse({
        source_cache_id: 1,
        // missing other fields
      });
      expect(result.success).toBe(false);
    });

    it('should reject non-integer citation counts', () => {
      const result = sourceCitationCountSchema.safeParse({
        source_cache_id: 1,
        total_citations: 3.5,
        unique_explanations: 2,
        domain: 'example.com',
        title: null,
        favicon_url: null,
      });
      expect(result.success).toBe(false);
    });
  });
});
