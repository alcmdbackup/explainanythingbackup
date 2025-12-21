/**
 * @jest-environment node
 */

import {
  isWordBoundary,
  overlaps,
  extractHeadings,
  headingsMatch,
  getOverridesForArticle,
  resolveLinksForArticle,
  applyLinksToContent
} from './linkResolver';
import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
import { getSnapshot, getHeadingLinksForArticle } from './linkWhitelist';
import type { ResolvedLinkType } from '@/lib/schemas/schemas';
import { LinkOverrideType } from '@/lib/schemas/schemas';

// Mock dependencies
jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServerClient: jest.fn()
}));

jest.mock('./linkWhitelist', () => ({
  getSnapshot: jest.fn(),
  getHeadingLinksForArticle: jest.fn()
}));

jest.mock('./links', () => ({
  encodeStandaloneTitleParam: jest.fn((title: string) => encodeURIComponent(title))
}));

describe('LinkResolver Service', () => {
  // Helper to create a fresh chainable mock
  function createMockSupabase() {
    const mock: any = {};
    const chainMethods = ['from', 'select', 'eq', 'single', 'insert', 'update', 'delete', 'upsert'];
    chainMethods.forEach(method => {
      mock[method] = jest.fn().mockReturnValue(mock);
    });
    return mock;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================

  describe('isWordBoundary', () => {
    it('should return true for term at start of content', () => {
      const content = 'machine learning is great';
      expect(isWordBoundary(content, 0, 16)).toBe(true);
    });

    it('should return true for term at end of content', () => {
      const content = 'this is machine learning';
      expect(isWordBoundary(content, 8, 24)).toBe(true);
    });

    it('should return true for term in middle with spaces', () => {
      const content = 'the machine learning model';
      expect(isWordBoundary(content, 4, 20)).toBe(true);
    });

    it('should return true for term followed by punctuation', () => {
      const content = 'machine learning, is great';
      expect(isWordBoundary(content, 0, 16)).toBe(true);
    });

    it('should return true for term preceded by punctuation', () => {
      const content = '(machine learning) is great';
      expect(isWordBoundary(content, 1, 17)).toBe(true);
    });

    it('should return false for term inside a word (hyphenated)', () => {
      const content = 'deep-machine-learning model';
      // "machine" is at index 5-12
      expect(isWordBoundary(content, 5, 12)).toBe(false);
    });

    it('should return false for term as substring of larger word', () => {
      const content = 'premachine learning';
      // "machine" starts at index 3
      expect(isWordBoundary(content, 3, 10)).toBe(false);
    });

    it('should return false for term followed by letter', () => {
      const content = 'machinelearning';
      expect(isWordBoundary(content, 0, 7)).toBe(false);
    });
  });

  describe('overlaps', () => {
    const link: ResolvedLinkType = {
      term: 'test',
      startIndex: 10,
      endIndex: 20,
      standaloneTitle: 'Test Title',
      type: 'term'
    };

    it('should return false for range before link', () => {
      expect(overlaps(link, 0, 9)).toBe(false);
    });

    it('should return false for range after link', () => {
      expect(overlaps(link, 21, 30)).toBe(false);
    });

    it('should return false for range exactly adjacent before', () => {
      expect(overlaps(link, 0, 10)).toBe(false);
    });

    it('should return false for range exactly adjacent after', () => {
      expect(overlaps(link, 20, 30)).toBe(false);
    });

    it('should return true for range overlapping start', () => {
      expect(overlaps(link, 5, 15)).toBe(true);
    });

    it('should return true for range overlapping end', () => {
      expect(overlaps(link, 15, 25)).toBe(true);
    });

    it('should return true for range inside link', () => {
      expect(overlaps(link, 12, 18)).toBe(true);
    });

    it('should return true for range containing link', () => {
      expect(overlaps(link, 5, 25)).toBe(true);
    });
  });

  describe('extractHeadings', () => {
    it('should extract h2 headings', () => {
      const content = '## First Heading\n\nSome text\n\n## Second Heading';
      const result = extractHeadings(content);
      expect(result).toEqual(['first heading', 'second heading']);
    });

    it('should extract h3 headings', () => {
      const content = '### Sub Heading\n\nText here';
      const result = extractHeadings(content);
      expect(result).toEqual(['sub heading']);
    });

    it('should extract mixed h2 and h3', () => {
      const content = '## Main\n\n### Sub\n\n## Another Main';
      const result = extractHeadings(content);
      expect(result).toEqual(['main', 'sub', 'another main']);
    });

    it('should return empty array for no headings', () => {
      const content = 'Just some text without headings';
      const result = extractHeadings(content);
      expect(result).toEqual([]);
    });

    it('should not extract h1 headings', () => {
      const content = '# Title\n\n## Heading';
      const result = extractHeadings(content);
      expect(result).toEqual(['heading']);
    });

    it('should not extract h4+ headings', () => {
      const content = '#### Deep Heading\n\n## Normal';
      const result = extractHeadings(content);
      expect(result).toEqual(['normal']);
    });
  });

  describe('headingsMatch', () => {
    it('should return true for identical arrays', () => {
      expect(headingsMatch(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(true);
    });

    it('should return true for empty arrays', () => {
      expect(headingsMatch([], [])).toBe(true);
    });

    it('should return false for different lengths', () => {
      expect(headingsMatch(['a', 'b'], ['a', 'b', 'c'])).toBe(false);
    });

    it('should return false for different content', () => {
      expect(headingsMatch(['a', 'b'], ['a', 'c'])).toBe(false);
    });

    it('should return false for same content different order', () => {
      expect(headingsMatch(['a', 'b'], ['b', 'a'])).toBe(false);
    });
  });

  // ============================================================================
  // OVERRIDE FUNCTIONS
  // ============================================================================

  describe('getOverridesForArticle', () => {
    it('should return empty map when no overrides exist', async () => {
      const mockSupabase = createMockSupabase();
      (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase);
      mockSupabase.eq.mockResolvedValue({ data: [], error: null });

      const result = await getOverridesForArticle(123);

      expect(result.size).toBe(0);
      expect(mockSupabase.from).toHaveBeenCalledWith('article_link_overrides');
    });

    it('should return map of overrides keyed by term_lower', async () => {
      const mockSupabase = createMockSupabase();
      (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase);

      const overrides = [
        {
          id: 1,
          explanation_id: 123,
          term: 'Machine Learning',
          term_lower: 'machine learning',
          override_type: 'disabled',
          custom_standalone_title: null,
          created_at: '2024-01-01'
        },
        {
          id: 2,
          explanation_id: 123,
          term: 'Neural Networks',
          term_lower: 'neural networks',
          override_type: 'custom_title',
          custom_standalone_title: 'Artificial Neural Networks',
          created_at: '2024-01-01'
        }
      ];
      mockSupabase.eq.mockResolvedValue({ data: overrides, error: null });

      const result = await getOverridesForArticle(123);

      expect(result.size).toBe(2);
      expect(result.get('machine learning')?.override_type).toBe('disabled');
      expect(result.get('neural networks')?.custom_standalone_title).toBe('Artificial Neural Networks');
    });

    it('should throw on database error', async () => {
      const mockSupabase = createMockSupabase();
      (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase);
      mockSupabase.eq.mockResolvedValue({ data: null, error: new Error('DB error') });

      await expect(getOverridesForArticle(123)).rejects.toThrow('DB error');
    });
  });

  // ============================================================================
  // MAIN RESOLVER
  // ============================================================================

  describe('resolveLinksForArticle', () => {
    const mockGetSnapshot = getSnapshot as jest.MockedFunction<typeof getSnapshot>;
    const mockGetHeadingLinks = getHeadingLinksForArticle as jest.MockedFunction<typeof getHeadingLinksForArticle>;

    beforeEach(() => {
      // Default: no overrides
      const mockSupabase = createMockSupabase();
      (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase);
      mockSupabase.eq.mockResolvedValue({ data: [], error: null });
    });

    it('should resolve heading links', async () => {
      const content = '## Introduction\n\nSome text here';

      mockGetHeadingLinks.mockResolvedValue(new Map([
        ['introduction', 'Machine Learning Introduction']
      ]));
      mockGetSnapshot.mockResolvedValue({
        id: 1,
        version: 1,
        data: {},
        updated_at: '2024-01-01'
      });

      const result = await resolveLinksForArticle(123, content);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('heading');
      expect(result[0].term).toBe('## Introduction');
      expect(result[0].standaloneTitle).toBe('Machine Learning Introduction');
    });

    it('should resolve term links from whitelist', async () => {
      const content = 'Learn about machine learning today';

      mockGetHeadingLinks.mockResolvedValue(new Map());
      mockGetSnapshot.mockResolvedValue({
        id: 1,
        version: 1,
        data: {
          'machine learning': {
            canonical_term: 'Machine Learning',
            standalone_title: 'Introduction to Machine Learning'
          }
        },
        updated_at: '2024-01-01'
      });

      const result = await resolveLinksForArticle(123, content);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('term');
      expect(result[0].term).toBe('machine learning');
      expect(result[0].standaloneTitle).toBe('Introduction to Machine Learning');
    });

    it('should only link first occurrence of term', async () => {
      const content = 'Machine learning is great. Machine learning is the future.';

      mockGetHeadingLinks.mockResolvedValue(new Map());
      mockGetSnapshot.mockResolvedValue({
        id: 1,
        version: 1,
        data: {
          'machine learning': {
            canonical_term: 'Machine Learning',
            standalone_title: 'ML Intro'
          }
        },
        updated_at: '2024-01-01'
      });

      const result = await resolveLinksForArticle(123, content);

      expect(result).toHaveLength(1);
      expect(result[0].startIndex).toBe(0);
    });

    it('should skip disabled terms', async () => {
      const mockSupabase = createMockSupabase();
      (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase);
      mockSupabase.eq.mockResolvedValue({
        data: [{
          id: 1,
          explanation_id: 123,
          term: 'machine learning',
          term_lower: 'machine learning',
          override_type: 'disabled',
          custom_standalone_title: null,
          created_at: '2024-01-01'
        }],
        error: null
      });

      const content = 'Learn about machine learning today';

      mockGetHeadingLinks.mockResolvedValue(new Map());
      mockGetSnapshot.mockResolvedValue({
        id: 1,
        version: 1,
        data: {
          'machine learning': {
            canonical_term: 'Machine Learning',
            standalone_title: 'ML Intro'
          }
        },
        updated_at: '2024-01-01'
      });

      const result = await resolveLinksForArticle(123, content);

      expect(result).toHaveLength(0);
    });

    it('should apply custom title from override', async () => {
      const mockSupabase = createMockSupabase();
      (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase);
      mockSupabase.eq.mockResolvedValue({
        data: [{
          id: 1,
          explanation_id: 123,
          term: 'machine learning',
          term_lower: 'machine learning',
          override_type: 'custom_title',
          custom_standalone_title: 'Custom ML Title',
          created_at: '2024-01-01'
        }],
        error: null
      });

      const content = 'Learn about machine learning today';

      mockGetHeadingLinks.mockResolvedValue(new Map());
      mockGetSnapshot.mockResolvedValue({
        id: 1,
        version: 1,
        data: {
          'machine learning': {
            canonical_term: 'Machine Learning',
            standalone_title: 'Default ML Title'
          }
        },
        updated_at: '2024-01-01'
      });

      const result = await resolveLinksForArticle(123, content);

      expect(result).toHaveLength(1);
      expect(result[0].standaloneTitle).toBe('Custom ML Title');
    });

    it('should not link terms inside headings', async () => {
      const content = '## Machine Learning Guide\n\nLearn about machine learning.';

      mockGetHeadingLinks.mockResolvedValue(new Map([
        ['machine learning guide', 'ML Guide Title']
      ]));
      mockGetSnapshot.mockResolvedValue({
        id: 1,
        version: 1,
        data: {
          'machine learning': {
            canonical_term: 'Machine Learning',
            standalone_title: 'ML Intro'
          }
        },
        updated_at: '2024-01-01'
      });

      const result = await resolveLinksForArticle(123, content);

      // Should have 2 links: heading + term in body
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('heading');
      expect(result[1].type).toBe('term');
      expect(result[1].startIndex).toBeGreaterThan(result[0].endIndex);
    });

    it('should prioritize longer terms over shorter', async () => {
      const content = 'deep learning is a subset of machine learning';

      mockGetHeadingLinks.mockResolvedValue(new Map());
      mockGetSnapshot.mockResolvedValue({
        id: 1,
        version: 1,
        data: {
          'learning': {
            canonical_term: 'Learning',
            standalone_title: 'Learning Basics'
          },
          'deep learning': {
            canonical_term: 'Deep Learning',
            standalone_title: 'Deep Learning Introduction'
          },
          'machine learning': {
            canonical_term: 'Machine Learning',
            standalone_title: 'ML Introduction'
          }
        },
        updated_at: '2024-01-01'
      });

      const result = await resolveLinksForArticle(123, content);

      // Should match "deep learning" and "machine learning", not just "learning"
      expect(result).toHaveLength(2);
      expect(result.find(r => r.term === 'deep learning')).toBeDefined();
      expect(result.find(r => r.term === 'machine learning')).toBeDefined();
    });

    it('should return links sorted by position', async () => {
      const content = 'neural networks and machine learning';

      mockGetHeadingLinks.mockResolvedValue(new Map());
      mockGetSnapshot.mockResolvedValue({
        id: 1,
        version: 1,
        data: {
          'machine learning': {
            canonical_term: 'Machine Learning',
            standalone_title: 'ML'
          },
          'neural networks': {
            canonical_term: 'Neural Networks',
            standalone_title: 'NN'
          }
        },
        updated_at: '2024-01-01'
      });

      const result = await resolveLinksForArticle(123, content);

      expect(result).toHaveLength(2);
      expect(result[0].term).toBe('neural networks');
      expect(result[1].term).toBe('machine learning');
      expect(result[0].startIndex).toBeLessThan(result[1].startIndex);
    });
  });

  // ============================================================================
  // CONTENT APPLICATION
  // ============================================================================

  describe('applyLinksToContent', () => {
    it('should return original content when no links', () => {
      const content = 'Just some text';
      const result = applyLinksToContent(content, []);
      expect(result).toBe(content);
    });

    it('should apply term link correctly', () => {
      const content = 'Learn about machine learning today';
      const links: ResolvedLinkType[] = [{
        term: 'machine learning',
        startIndex: 12,
        endIndex: 28,
        standaloneTitle: 'Introduction to Machine Learning',
        type: 'term'
      }];

      const result = applyLinksToContent(content, links);

      expect(result).toBe('Learn about [machine learning](/standalone-title?t=Introduction%20to%20Machine%20Learning) today');
    });

    it('should apply heading link correctly', () => {
      const content = '## Introduction\n\nSome text';
      const links: ResolvedLinkType[] = [{
        term: '## Introduction',
        startIndex: 0,
        endIndex: 15,
        standaloneTitle: 'ML Introduction',
        type: 'heading'
      }];

      const result = applyLinksToContent(content, links);

      expect(result).toBe('## [Introduction](/standalone-title?t=ML%20Introduction)\n\nSome text');
    });

    it('should apply multiple links preserving positions', () => {
      const content = 'neural networks and machine learning';
      const links: ResolvedLinkType[] = [
        {
          term: 'neural networks',
          startIndex: 0,
          endIndex: 15,
          standaloneTitle: 'NN',
          type: 'term'
        },
        {
          term: 'machine learning',
          startIndex: 20,
          endIndex: 36,
          standaloneTitle: 'ML',
          type: 'term'
        }
      ];

      const result = applyLinksToContent(content, links);

      expect(result).toBe('[neural networks](/standalone-title?t=NN) and [machine learning](/standalone-title?t=ML)');
    });

    it('should handle h3 headings correctly', () => {
      const content = '### Sub Section\n\nDetails here';
      const links: ResolvedLinkType[] = [{
        term: '### Sub Section',
        startIndex: 0,
        endIndex: 15,
        standaloneTitle: 'Sub Section Details',
        type: 'heading'
      }];

      const result = applyLinksToContent(content, links);

      expect(result).toBe('### [Sub Section](/standalone-title?t=Sub%20Section%20Details)\n\nDetails here');
    });
  });
});
