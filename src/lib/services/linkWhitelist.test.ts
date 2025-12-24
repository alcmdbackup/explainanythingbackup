/**
 * @jest-environment node
 */

import {
  createWhitelistTerm,
  getAllActiveWhitelistTerms,
  updateWhitelistTerm,
  deleteWhitelistTerm,
  addAliases,
  removeAlias,
  getActiveWhitelistAsMap,
  getSnapshot,
  getHeadingLinksForArticle,
  saveHeadingLinks,
  deleteHeadingLinksForArticle,
  generateHeadingStandaloneTitles,
  getAliasesForTerm,
  getWhitelistTermById
} from './linkWhitelist';
import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
import { callOpenAIModel } from '@/lib/services/llms';
import type { LinkWhitelistFullType, LinkAliasFullType } from '@/lib/schemas/schemas';

// Mock dependencies
jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServerClient: jest.fn()
}));

jest.mock('@/lib/services/llms');

jest.mock('@/lib/server_utilities', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
  }
}));

jest.mock('@/lib/prompts', () => ({
  createStandaloneTitlePrompt: jest.fn((articleTitle, headings) =>
    `Create standalone titles for headings in "${articleTitle}": ${headings.join(', ')}`
  )
}));

describe('LinkWhitelist Service', () => {
  const mockCallOpenAIModel = callOpenAIModel as jest.MockedFunction<typeof callOpenAIModel>;

  // Helper to create a fresh chainable mock that handles all method combinations
  function createMockSupabase() {
    const mock: any = {};
    const chainMethods = ['from', 'insert', 'select', 'single', 'eq', 'in', 'update', 'delete', 'order', 'upsert'];
    chainMethods.forEach(method => {
      mock[method] = jest.fn().mockReturnValue(mock);
    });
    return mock;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================================
  // WHITELIST CRUD OPERATIONS
  // ============================================================================

  describe('createWhitelistTerm', () => {
    const validTerm = {
      canonical_term: 'Machine Learning',
      standalone_title: 'Introduction to Machine Learning',
      description: 'A branch of AI',
      is_active: true
    };

    it('should return existing term if duplicate found', async () => {
      const mockSupabase = createMockSupabase();
      (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase);

      const existingTerm: LinkWhitelistFullType = {
        id: 1,
        ...validTerm,
        canonical_term_lower: 'machine learning',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      };

      mockSupabase.single.mockResolvedValue({ data: existingTerm, error: null });

      const result = await createWhitelistTerm(validTerm);

      expect(result).toEqual(existingTerm);
      expect(mockSupabase.insert).not.toHaveBeenCalled();
    });

    it('should throw on validation error', async () => {
      const invalidTerm = {
        canonical_term: '', // Invalid: empty
        standalone_title: 'Test',
        is_active: true
      };

      await expect(createWhitelistTerm(invalidTerm as any)).rejects.toThrow('Invalid whitelist term data');
    });
  });

  describe('getAllActiveWhitelistTerms', () => {
    it('should return all active terms', async () => {
      const mockSupabase = createMockSupabase();
      (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase);

      const terms: LinkWhitelistFullType[] = [
        {
          id: 1,
          canonical_term: 'Term 1',
          canonical_term_lower: 'term 1',
          standalone_title: 'Title 1',
          is_active: true,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z'
        },
        {
          id: 2,
          canonical_term: 'Term 2',
          canonical_term_lower: 'term 2',
          standalone_title: 'Title 2',
          is_active: true,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z'
        }
      ];

      mockSupabase.order.mockResolvedValue({ data: terms, error: null });

      const result = await getAllActiveWhitelistTerms();

      expect(result).toEqual(terms);
      expect(mockSupabase.from).toHaveBeenCalledWith('link_whitelist');
      expect(mockSupabase.eq).toHaveBeenCalledWith('is_active', true);
    });

    it('should return empty array when no terms found', async () => {
      const mockSupabase = createMockSupabase();
      (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase);

      mockSupabase.order.mockResolvedValue({ data: null, error: null });

      const result = await getAllActiveWhitelistTerms();

      expect(result).toEqual([]);
    });
  });

  describe('updateWhitelistTerm', () => {
    it('should throw on validation error', async () => {
      await expect(updateWhitelistTerm(1, { canonical_term: '' })).rejects.toThrow('Invalid whitelist update data');
    });
  });

  // ============================================================================
  // ALIAS MANAGEMENT
  // ============================================================================

  describe('addAliases', () => {
    it('should return empty array for empty aliases input', async () => {
      const result = await addAliases(1, []);
      expect(result).toEqual([]);
    });

    it('should skip existing aliases and return them', async () => {
      const mockSupabase = createMockSupabase();
      (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase);

      const existingAliases: LinkAliasFullType[] = [
        {
          id: 1,
          whitelist_id: 1,
          alias_term: 'ML',
          alias_term_lower: 'ml',
          created_at: '2024-01-01T00:00:00Z'
        }
      ];

      mockSupabase.in.mockResolvedValue({ data: existingAliases, error: null });

      const result = await addAliases(1, ['ML']);

      expect(result).toEqual(existingAliases);
      expect(mockSupabase.insert).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // WHITELIST LOOKUP MAP
  // ============================================================================

  describe('getActiveWhitelistAsMap', () => {
    it('should build lookup map with canonical terms', async () => {
      const mockSupabase = createMockSupabase();
      (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase);

      const terms: LinkWhitelistFullType[] = [
        {
          id: 1,
          canonical_term: 'Machine Learning',
          canonical_term_lower: 'machine learning',
          standalone_title: 'Introduction to Machine Learning',
          is_active: true,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z'
        }
      ];

      mockSupabase.eq.mockResolvedValueOnce({ data: terms, error: null });
      mockSupabase.in.mockResolvedValue({ data: [], error: null });

      const result = await getActiveWhitelistAsMap();

      expect(result.get('machine learning')).toEqual({
        canonical_term: 'Machine Learning',
        standalone_title: 'Introduction to Machine Learning'
      });
    });

    it('should include aliases mapped to canonical terms', async () => {
      const mockSupabase = createMockSupabase();
      (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase);

      const terms: LinkWhitelistFullType[] = [
        {
          id: 1,
          canonical_term: 'Machine Learning',
          canonical_term_lower: 'machine learning',
          standalone_title: 'Intro to ML',
          is_active: true,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z'
        }
      ];

      const aliases: LinkAliasFullType[] = [
        {
          id: 1,
          whitelist_id: 1,
          alias_term: 'ML',
          alias_term_lower: 'ml',
          created_at: '2024-01-01T00:00:00Z'
        }
      ];

      mockSupabase.eq.mockResolvedValueOnce({ data: terms, error: null });
      mockSupabase.in.mockResolvedValue({ data: aliases, error: null });

      const result = await getActiveWhitelistAsMap();

      // Both canonical term and alias should map to same entry
      expect(result.get('ml')).toEqual({
        canonical_term: 'Machine Learning',
        standalone_title: 'Intro to ML'
      });
      expect(result.get('machine learning')).toEqual({
        canonical_term: 'Machine Learning',
        standalone_title: 'Intro to ML'
      });
    });
  });

  describe('getSnapshot', () => {
    it('should return existing snapshot', async () => {
      const mockSupabase = createMockSupabase();
      (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase);

      const snapshot = {
        id: 1,
        version: 5,
        data: { 'test': { canonical_term: 'Test', standalone_title: 'Test Title' } },
        updated_at: '2024-01-01T00:00:00Z'
      };

      mockSupabase.single.mockResolvedValue({ data: snapshot, error: null });

      const result = await getSnapshot();

      expect(result).toEqual(snapshot);
    });
  });

  // ============================================================================
  // HEADING LINK CACHE
  // ============================================================================

  describe('getHeadingLinksForArticle', () => {
    it('should return map of heading titles', async () => {
      const mockSupabase = createMockSupabase();
      (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase);

      const headings = [
        { heading_text_lower: 'introduction', standalone_title: 'Introduction to Topic' },
        { heading_text_lower: 'conclusion', standalone_title: 'Conclusion of Topic' }
      ];

      mockSupabase.eq.mockResolvedValue({ data: headings, error: null });

      const result = await getHeadingLinksForArticle(123);

      expect(result.get('introduction')).toBe('Introduction to Topic');
      expect(result.get('conclusion')).toBe('Conclusion of Topic');
    });

    it('should return empty map when no headings found', async () => {
      const mockSupabase = createMockSupabase();
      (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase);

      mockSupabase.eq.mockResolvedValue({ data: [], error: null });

      const result = await getHeadingLinksForArticle(123);

      expect(result.size).toBe(0);
    });
  });

  describe('saveHeadingLinks', () => {
    it('should upsert heading links', async () => {
      const mockSupabase = createMockSupabase();
      (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase);

      mockSupabase.upsert.mockResolvedValue({ error: null });

      await saveHeadingLinks(123, {
        'Introduction': 'Introduction to Topic',
        'Conclusion': 'Conclusion of Topic'
      });

      expect(mockSupabase.from).toHaveBeenCalledWith('article_heading_links');
      expect(mockSupabase.upsert).toHaveBeenCalled();
    });

    it('should do nothing for empty headings', async () => {
      const mockSupabase = createMockSupabase();
      (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase);

      await saveHeadingLinks(123, {});

      expect(mockSupabase.upsert).not.toHaveBeenCalled();
    });
  });

  describe('deleteHeadingLinksForArticle', () => {
    it('should delete all heading links for an article', async () => {
      const mockSupabase = createMockSupabase();
      (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase);

      mockSupabase.eq.mockResolvedValue({ error: null });

      await deleteHeadingLinksForArticle(123);

      expect(mockSupabase.from).toHaveBeenCalledWith('article_heading_links');
      expect(mockSupabase.delete).toHaveBeenCalled();
      expect(mockSupabase.eq).toHaveBeenCalledWith('explanation_id', 123);
    });
  });

  // ============================================================================
  // AI HEADING TITLE GENERATION
  // ============================================================================

  describe('generateHeadingStandaloneTitles userId validation', () => {
    it('should throw error when userid is null', async () => {
      await expect(generateHeadingStandaloneTitles('## Test', 'Article', null as any)).rejects.toThrow('userId is required for generateHeadingStandaloneTitles');
    });

    it('should throw error when userid is undefined', async () => {
      await expect(generateHeadingStandaloneTitles('## Test', 'Article', undefined as any)).rejects.toThrow('userId is required for generateHeadingStandaloneTitles');
    });

    it('should throw error when userid is empty string', async () => {
      await expect(generateHeadingStandaloneTitles('## Test', 'Article', '')).rejects.toThrow('userId is required for generateHeadingStandaloneTitles');
    });
  });

  describe('generateHeadingStandaloneTitles', () => {
    it('should return empty object when no headings found', async () => {
      const content = 'This is plain text without any headings.';

      const result = await generateHeadingStandaloneTitles(content, 'Test Article', 'user123');

      expect(result).toEqual({});
      expect(mockCallOpenAIModel).not.toHaveBeenCalled();
    });

    it('should generate titles for h2 and h3 headings', async () => {
      const content = `## Introduction
Some text here.
### Background
More text.
## Conclusion`;

      mockCallOpenAIModel.mockResolvedValue(JSON.stringify({
        titles: ['Introduction to Testing', 'Background of Testing', 'Conclusion of Testing']
      }));

      const result = await generateHeadingStandaloneTitles(content, 'Testing Guide', 'user123');

      expect(Object.keys(result)).toHaveLength(3);
      expect(result['Introduction']).toBe('Introduction to Testing');
      expect(result['Background']).toBe('Background of Testing');
      expect(result['Conclusion']).toBe('Conclusion of Testing');
    });

    it('should handle AI response parsing errors gracefully', async () => {
      const content = '## Test';
      mockCallOpenAIModel.mockResolvedValue('invalid json');

      const result = await generateHeadingStandaloneTitles(content, 'Test', 'user123');

      expect(result).toEqual({});
    });

    it('should handle missing articleTitle', async () => {
      const content = '## Test';

      const result = await generateHeadingStandaloneTitles(content, '', 'user123');

      expect(result).toEqual({});
    });

    it('should handle LLM throwing error', async () => {
      const content = '## Test';
      mockCallOpenAIModel.mockRejectedValue(new Error('LLM Error'));

      const result = await generateHeadingStandaloneTitles(content, 'Test', 'user123');

      expect(result).toEqual({});
    });

    it('should strip quotes from titles', async () => {
      const content = '## Test';
      mockCallOpenAIModel.mockResolvedValue(JSON.stringify({
        titles: ['"Quoted Title"']
      }));

      const result = await generateHeadingStandaloneTitles(content, 'Test', 'user123');

      expect(result['Test']).toBe('Quoted Title');
    });
  });

  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================

  describe('getAliasesForTerm', () => {
    it('should return aliases for a whitelist term', async () => {
      const mockSupabase = createMockSupabase();
      (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase);

      const aliases: LinkAliasFullType[] = [
        {
          id: 1,
          whitelist_id: 1,
          alias_term: 'ML',
          alias_term_lower: 'ml',
          created_at: '2024-01-01T00:00:00Z'
        },
        {
          id: 2,
          whitelist_id: 1,
          alias_term: 'AI',
          alias_term_lower: 'ai',
          created_at: '2024-01-01T00:00:00Z'
        }
      ];

      mockSupabase.order.mockResolvedValue({ data: aliases, error: null });

      const result = await getAliasesForTerm(1);

      expect(result).toEqual(aliases);
      expect(mockSupabase.eq).toHaveBeenCalledWith('whitelist_id', 1);
    });
  });

  describe('getWhitelistTermById', () => {
    it('should return a whitelist term by ID', async () => {
      const mockSupabase = createMockSupabase();
      (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase);

      const term: LinkWhitelistFullType = {
        id: 1,
        canonical_term: 'Test',
        canonical_term_lower: 'test',
        standalone_title: 'Test Title',
        is_active: true,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      };

      mockSupabase.single.mockResolvedValue({ data: term, error: null });

      const result = await getWhitelistTermById(1);

      expect(result).toEqual(term);
    });

    it('should throw error if term not found', async () => {
      const mockSupabase = createMockSupabase();
      (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase);

      mockSupabase.single.mockResolvedValue({ data: null, error: null });

      await expect(getWhitelistTermById(999)).rejects.toThrow('Whitelist term not found for ID: 999');
    });
  });
});
