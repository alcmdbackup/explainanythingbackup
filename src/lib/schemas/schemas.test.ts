import {
  MatchMode,
  UserInputType,
  AnchorSet,
  TagBarMode,
  ExplanationStatus,
  LinkOverrideType,
  allowedLLMModelSchema,
  explanationBaseSchema,
  matchSchema,
  PresetTagUISchema,
  SimpleOrPresetTagUISchema,
  llmCallTrackingSchema,
  explanationMetricsSchema,
  explanationInsertSchema,
  userQueryInsertSchema,
  matchWithCurrentContentSchema,
  linkWhitelistInsertSchema,
  linkAliasInsertSchema,
  articleHeadingLinkInsertSchema,
  articleLinkOverrideInsertSchema,
  linkWhitelistSnapshotSchema,
  resolvedLinkSchema,
} from './schemas';

describe('schemas', () => {
  describe('Enums', () => {
    describe('MatchMode', () => {
      it('should have correct enum values', () => {
        expect(MatchMode.Normal).toBe('normal');
        expect(MatchMode.SkipMatch).toBe('skipMatch');
        expect(MatchMode.ForceMatch).toBe('forceMatch');
      });
    });

    describe('UserInputType', () => {
      it('should have correct enum values', () => {
        expect(UserInputType.Query).toBe('query');
        expect(UserInputType.TitleFromLink).toBe('title from link');
        expect(UserInputType.TitleFromRegenerate).toBe('title from regenerate');
        expect(UserInputType.Rewrite).toBe('rewrite');
        expect(UserInputType.RewriteWithTags).toBe('rewrite with tags');
        expect(UserInputType.EditWithTags).toBe('edit with tags');
      });
    });

    describe('AnchorSet', () => {
      it('should have correct enum values', () => {
        expect(AnchorSet.Main).toBe('main');
      });
    });

    describe('TagBarMode', () => {
      it('should have correct enum values', () => {
        expect(TagBarMode.Normal).toBe('normal');
        expect(TagBarMode.RewriteWithTags).toBe('rewrite with tags');
        expect(TagBarMode.EditWithTags).toBe('edit with tags');
      });
    });

    describe('ExplanationStatus', () => {
      it('should have correct enum values', () => {
        expect(ExplanationStatus.Draft).toBe('draft');
        expect(ExplanationStatus.Published).toBe('published');
      });
    });
  });

  describe('allowedLLMModelSchema', () => {
    it('should accept valid LLM models', () => {
      expect(allowedLLMModelSchema.parse('gpt-4o-mini')).toBe('gpt-4o-mini');
      expect(allowedLLMModelSchema.parse('gpt-4.1-nano')).toBe('gpt-4.1-nano');
      expect(allowedLLMModelSchema.parse('gpt-5-mini')).toBe('gpt-5-mini');
      expect(allowedLLMModelSchema.parse('gpt-5-nano')).toBe('gpt-5-nano');
      expect(allowedLLMModelSchema.parse('gpt-4.1-mini')).toBe('gpt-4.1-mini');
    });

    it('should reject invalid LLM models', () => {
      expect(() => allowedLLMModelSchema.parse('gpt-3')).toThrow();
      expect(() => allowedLLMModelSchema.parse('gpt-4')).toThrow();
      expect(() => allowedLLMModelSchema.parse('claude-3')).toThrow();
      expect(() => allowedLLMModelSchema.parse('')).toThrow();
    });
  });

  describe('explanationBaseSchema', () => {
    it('should validate correct explanation base data', () => {
      const validData = {
        explanation_title: 'Test Title',
        content: 'Test content',
      };

      const result = explanationBaseSchema.parse(validData);

      expect(result).toEqual(validData);
    });

    it('should reject missing explanation_title', () => {
      const invalidData = {
        content: 'Test content',
      };

      expect(() => explanationBaseSchema.parse(invalidData)).toThrow();
    });

    it('should reject missing content', () => {
      const invalidData = {
        explanation_title: 'Test Title',
      };

      expect(() => explanationBaseSchema.parse(invalidData)).toThrow();
    });

    it('should reject non-string values', () => {
      const invalidData = {
        explanation_title: 123,
        content: true,
      };

      expect(() => explanationBaseSchema.parse(invalidData)).toThrow();
    });
  });

  describe('matchSchema', () => {
    it('should validate correct match data', () => {
      const validData = {
        text: 'Match text',
        explanation_id: 123,
        topic_id: 456,
        ranking: {
          similarity: 0.95,
          diversity_score: 0.8,
        },
      };

      const result = matchSchema.parse(validData);

      expect(result).toEqual(validData);
    });

    it('should accept null diversity_score', () => {
      const validData = {
        text: 'Match text',
        explanation_id: 123,
        topic_id: 456,
        ranking: {
          similarity: 0.95,
          diversity_score: null,
        },
      };

      const result = matchSchema.parse(validData);

      expect(result.ranking.diversity_score).toBeNull();
    });

    it('should reject invalid number types', () => {
      const invalidData = {
        text: 'Match text',
        explanation_id: '123', // string instead of number
        topic_id: 456,
        ranking: {
          similarity: 0.95,
          diversity_score: 0.8,
        },
      };

      expect(() => matchSchema.parse(invalidData)).toThrow();
    });

    it('should reject missing ranking', () => {
      const invalidData = {
        text: 'Match text',
        explanation_id: 123,
        topic_id: 456,
      };

      expect(() => matchSchema.parse(invalidData)).toThrow();
    });
  });

  describe('matchWithCurrentContentSchema', () => {
    it('should validate match with current content', () => {
      const validData = {
        text: 'Match text',
        explanation_id: 123,
        topic_id: 456,
        ranking: {
          similarity: 0.95,
          diversity_score: 0.8,
        },
        current_title: 'Current Title',
        current_content: 'Current content',
        summary_teaser: 'A preview of the match',
        timestamp: '2025-01-11T00:00:00Z',
      };

      const result = matchWithCurrentContentSchema.parse(validData);

      expect(result).toEqual(validData);
    });

    it('should reject missing current_title', () => {
      const invalidData = {
        text: 'Match text',
        explanation_id: 123,
        topic_id: 456,
        ranking: {
          similarity: 0.95,
          diversity_score: 0.8,
        },
        current_content: 'Current content',
      };

      expect(() => matchWithCurrentContentSchema.parse(invalidData)).toThrow();
    });

    it('should require summary_teaser and timestamp fields', () => {
      const missingFieldsMatch = {
        text: 'test text',
        explanation_id: 1,
        topic_id: 2,
        current_title: 'Test Title',
        current_content: 'Test content',
        ranking: { similarity: 0.95, diversity_score: 0.8 },
      };
      // These fields are now required, so parsing should throw
      expect(() => matchWithCurrentContentSchema.parse(missingFieldsMatch)).toThrow();
    });

    it('should accept complete match with summary_teaser and timestamp', () => {
      const completeMatch = {
        text: 'test text',
        explanation_id: 1,
        topic_id: 2,
        current_title: 'Test Title',
        current_content: 'Test content',
        summary_teaser: 'AI-generated preview',
        timestamp: '2025-01-11T12:00:00Z',
        ranking: { similarity: 0.95, diversity_score: null },
      };
      expect(() => matchWithCurrentContentSchema.parse(completeMatch)).not.toThrow();
    });

    it('should accept null summary_teaser (for older explanations without AI preview)', () => {
      const matchWithNullTeaser = {
        text: 'test text',
        explanation_id: 1,
        topic_id: 2,
        current_title: 'Test Title',
        current_content: 'Test content',
        summary_teaser: null,
        timestamp: '2025-01-11T12:00:00Z',
        ranking: { similarity: 0.95, diversity_score: 0.5 },
      };
      expect(() => matchWithCurrentContentSchema.parse(matchWithNullTeaser)).not.toThrow();
    });
  });

  describe('userQueryInsertSchema', () => {
    it('should validate correct user query insert data', () => {
      const validData = {
        matches: [],
        user_query: 'How does photosynthesis work?',
        explanation_id: 123,
        userid: 'user123',
        newExplanation: true,
        userInputType: UserInputType.Query,
        allowedQuery: true,
        previousExplanationViewedId: null,
      };

      const result = userQueryInsertSchema.parse(validData);

      expect(result).toEqual(validData);
    });

    it('should accept nullable explanation_id', () => {
      const validData = {
        matches: [],
        user_query: 'Test query',
        explanation_id: null,
        userid: 'user123',
        newExplanation: true,
        userInputType: UserInputType.Query,
        allowedQuery: true,
        previousExplanationViewedId: null,
      };

      const result = userQueryInsertSchema.parse(validData);

      expect(result.explanation_id).toBeNull();
    });

    it('should validate userInputType enum', () => {
      const validData = {
        matches: [],
        user_query: 'Test query',
        explanation_id: 123,
        userid: 'user123',
        newExplanation: false,
        userInputType: UserInputType.Rewrite,
        allowedQuery: true,
        previousExplanationViewedId: null,
      };

      const result = userQueryInsertSchema.parse(validData);

      expect(result.userInputType).toBe(UserInputType.Rewrite);
    });
  });

  describe('explanationInsertSchema', () => {
    it('should validate explanation insert with required fields', () => {
      const validData = {
        explanation_title: 'Test Title',
        content: 'Test content',
        primary_topic_id: 1,
      };

      const result = explanationInsertSchema.parse(validData);

      expect(result).toMatchObject(validData);
      expect(result.status).toBe(ExplanationStatus.Published); // default
    });

    it('should accept optional secondary_topic_id', () => {
      const validData = {
        explanation_title: 'Test Title',
        content: 'Test content',
        primary_topic_id: 1,
        secondary_topic_id: 2,
      };

      const result = explanationInsertSchema.parse(validData);

      expect(result.secondary_topic_id).toBe(2);
    });

    it('should default status to Published', () => {
      const validData = {
        explanation_title: 'Test Title',
        content: 'Test content',
        primary_topic_id: 1,
      };

      const result = explanationInsertSchema.parse(validData);

      expect(result.status).toBe(ExplanationStatus.Published);
    });

    it('should accept explicit status', () => {
      const validData = {
        explanation_title: 'Test Title',
        content: 'Test content',
        primary_topic_id: 1,
        status: ExplanationStatus.Draft,
      };

      const result = explanationInsertSchema.parse(validData);

      expect(result.status).toBe(ExplanationStatus.Draft);
    });
  });

  describe('llmCallTrackingSchema', () => {
    it('should validate correct LLM call tracking data', () => {
      const validData = {
        userid: 'user123',
        prompt: 'Test prompt',
        content: 'Response content',
        call_source: 'test',
        raw_api_response: '{}',
        model: 'gpt-4o-mini',
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        finish_reason: 'stop',
      };

      const result = llmCallTrackingSchema.parse(validData);

      expect(result).toEqual(validData);
    });

    it('should accept optional reasoning_tokens', () => {
      const validData = {
        userid: 'user123',
        prompt: 'Test prompt',
        content: 'Response content',
        call_source: 'test',
        raw_api_response: '{}',
        model: 'gpt-4o-mini',
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        reasoning_tokens: 25,
        finish_reason: 'stop',
      };

      const result = llmCallTrackingSchema.parse(validData);

      expect(result.reasoning_tokens).toBe(25);
    });

    it('should reject negative token counts', () => {
      const invalidData = {
        userid: 'user123',
        prompt: 'Test prompt',
        content: 'Response content',
        call_source: 'test',
        raw_api_response: '{}',
        model: 'gpt-4o-mini',
        prompt_tokens: -10,
        completion_tokens: 50,
        total_tokens: 150,
        finish_reason: 'stop',
      };

      expect(() => llmCallTrackingSchema.parse(invalidData)).toThrow();
    });

    it('should reject non-integer token counts', () => {
      const invalidData = {
        userid: 'user123',
        prompt: 'Test prompt',
        content: 'Response content',
        call_source: 'test',
        raw_api_response: '{}',
        model: 'gpt-4o-mini',
        prompt_tokens: 100.5,
        completion_tokens: 50,
        total_tokens: 150,
        finish_reason: 'stop',
      };

      expect(() => llmCallTrackingSchema.parse(invalidData)).toThrow();
    });

    it('should accept zero token counts', () => {
      const validData = {
        userid: 'user123',
        prompt: 'Test prompt',
        content: 'Response content',
        call_source: 'test',
        raw_api_response: '{}',
        model: 'gpt-4o-mini',
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        finish_reason: 'stop',
      };

      const result = llmCallTrackingSchema.parse(validData);

      expect(result.prompt_tokens).toBe(0);
      expect(result.completion_tokens).toBe(0);
      expect(result.total_tokens).toBe(0);
    });
  });

  describe('explanationMetricsSchema', () => {
    // Note: explanationMetricsSchema uses explanation_id (with underscore)
    // for consistency with stored procedure returns
    it('should validate correct explanation metrics data', () => {
      const validData = {
        explanation_id: 123,
        total_saves: 10,
        total_views: 100,
        save_rate: 0.1,
        last_updated: '2024-03-20T10:30:00Z',
      };

      const result = explanationMetricsSchema.parse(validData);

      expect(result).toMatchObject({
        explanation_id: 123,
        total_saves: 10,
        total_views: 100,
        save_rate: 0.1,
      });
    });

    it('should use default values', () => {
      const validData = {
        explanation_id: 123,
        last_updated: '2024-03-20T10:30:00Z',
      };

      const result = explanationMetricsSchema.parse(validData);

      expect(result.total_saves).toBe(0);
      expect(result.total_views).toBe(0);
      expect(result.save_rate).toBe(0);
    });

    it('should validate save_rate boundaries (0-1)', () => {
      const validData0 = {
        explanation_id: 123,
        save_rate: 0,
        last_updated: '2024-03-20T10:30:00Z',
      };

      const validData1 = {
        explanation_id: 123,
        save_rate: 1,
        last_updated: '2024-03-20T10:30:00Z',
      };

      expect(explanationMetricsSchema.parse(validData0).save_rate).toBe(0);
      expect(explanationMetricsSchema.parse(validData1).save_rate).toBe(1);
    });

    it('should reject save_rate outside 0-1 range', () => {
      const invalidDataNegative = {
        explanation_id: 123,
        save_rate: -0.1,
        last_updated: '2024-03-20T10:30:00Z',
      };

      const invalidDataTooHigh = {
        explanation_id: 123,
        save_rate: 1.1,
        last_updated: '2024-03-20T10:30:00Z',
      };

      expect(() => explanationMetricsSchema.parse(invalidDataNegative)).toThrow();
      expect(() => explanationMetricsSchema.parse(invalidDataTooHigh)).toThrow();
    });

    it('should reject negative total_saves and total_views', () => {
      const invalidData = {
        explanation_id: 123,
        total_saves: -1,
        total_views: 100,
        last_updated: '2024-03-20T10:30:00Z',
      };

      expect(() => explanationMetricsSchema.parse(invalidData)).toThrow();
    });

    it('should accept ISO 8601 date strings', () => {
      const validData = {
        explanation_id: 123,
        last_updated: '2024-03-20T10:30:00Z',
      };

      const result = explanationMetricsSchema.parse(validData);

      expect(result.last_updated).toBe('2024-03-20T10:30:00Z');
    });

    it('should accept Date objects', () => {
      const dateObj = new Date('2024-03-20T10:30:00Z');
      const validData = {
        explanation_id: 123,
        last_updated: dateObj,
      };

      const result = explanationMetricsSchema.parse(validData);

      expect(result.last_updated).toStrictEqual(dateObj);
    });

    it('should accept parseable date strings', () => {
      const validData = {
        explanation_id: 123,
        last_updated: '2024-03-20',
      };

      const result = explanationMetricsSchema.parse(validData);

      expect(result.last_updated).toBe('2024-03-20');
    });

    it('should reject invalid date strings', () => {
      const invalidData = {
        explanation_id: 123,
        last_updated: 'not-a-date',
      };

      expect(() => explanationMetricsSchema.parse(invalidData)).toThrow();
    });

    it('should accept optional id field', () => {
      const withId = {
        id: 456,
        explanation_id: 123,
        last_updated: '2024-03-20T10:30:00Z',
      };

      const result = explanationMetricsSchema.parse(withId);

      expect(result.id).toBe(456);
    });
  });

  describe('PresetTagUISchema', () => {
    const mockTag1 = {
      id: 1,
      tag_name: 'beginner',
      tag_description: 'For beginners',
      presetTagId: null,
      created_at: '2024-03-20T10:30:00Z',
    };

    const mockTag2 = {
      id: 2,
      tag_name: 'intermediate',
      tag_description: 'For intermediate users',
      presetTagId: null,
      created_at: '2024-03-20T10:30:00Z',
    };

    it('should validate preset tag UI with valid tag IDs', () => {
      const validData = {
        tags: [mockTag1, mockTag2],
        tag_active_current: true,
        tag_active_initial: false,
        currentActiveTagId: 1,
        originalTagId: 2,
      };

      const result = PresetTagUISchema.parse(validData);

      expect(result).toEqual(validData);
    });

    it('should reject when currentActiveTagId not in tags array', () => {
      const invalidData = {
        tags: [mockTag1, mockTag2],
        tag_active_current: true,
        tag_active_initial: false,
        currentActiveTagId: 999, // Not in tags array
        originalTagId: 2,
      };

      expect(() => PresetTagUISchema.parse(invalidData)).toThrow();
    });

    it('should reject when originalTagId not in tags array', () => {
      const invalidData = {
        tags: [mockTag1, mockTag2],
        tag_active_current: true,
        tag_active_initial: false,
        currentActiveTagId: 1,
        originalTagId: 999, // Not in tags array
      };

      expect(() => PresetTagUISchema.parse(invalidData)).toThrow();
    });

    it('should reject when both IDs not in tags array', () => {
      const invalidData = {
        tags: [mockTag1, mockTag2],
        tag_active_current: true,
        tag_active_initial: false,
        currentActiveTagId: 888,
        originalTagId: 999,
      };

      expect(() => PresetTagUISchema.parse(invalidData)).toThrow();
    });

    it('should accept same ID for current and original', () => {
      const validData = {
        tags: [mockTag1, mockTag2],
        tag_active_current: true,
        tag_active_initial: true,
        currentActiveTagId: 1,
        originalTagId: 1,
      };

      const result = PresetTagUISchema.parse(validData);

      expect(result.currentActiveTagId).toBe(result.originalTagId);
    });

    it('should reject non-integer tag IDs', () => {
      const invalidData = {
        tags: [mockTag1, mockTag2],
        tag_active_current: true,
        tag_active_initial: false,
        currentActiveTagId: 1.5,
        originalTagId: 2,
      };

      expect(() => PresetTagUISchema.parse(invalidData)).toThrow();
    });
  });

  describe('SimpleOrPresetTagUISchema', () => {
    it('should accept simple tag UI', () => {
      const simpleTag = {
        id: 1,
        tag_name: 'beginner',
        tag_description: 'For beginners',
        presetTagId: null,
        created_at: '2024-03-20T10:30:00Z',
        tag_active_current: true,
        tag_active_initial: false,
      };

      const result = SimpleOrPresetTagUISchema.parse(simpleTag);

      expect(result).toEqual(simpleTag);
    });

    it('should accept preset tag UI', () => {
      const presetTag = {
        tags: [
          {
            id: 1,
            tag_name: 'beginner',
            tag_description: 'For beginners',
            presetTagId: null,
            created_at: '2024-03-20T10:30:00Z',
          },
        ],
        tag_active_current: true,
        tag_active_initial: false,
        currentActiveTagId: 1,
        originalTagId: 1,
      };

      const result = SimpleOrPresetTagUISchema.parse(presetTag);

      expect(result).toEqual(presetTag);
    });

    it('should reject data matching neither schema', () => {
      const invalidData = {
        random_field: 'value',
      };

      expect(() => SimpleOrPresetTagUISchema.parse(invalidData)).toThrow();
    });
  });

  // =============================================================================
  // LINK WHITELIST SYSTEM SCHEMAS
  // =============================================================================

  describe('linkWhitelistInsertSchema', () => {
    it('should validate correct whitelist insert data', () => {
      const validData = {
        canonical_term: 'Machine Learning',
        standalone_title: 'Machine Learning (Computer Science)',
        description: 'A branch of AI',
        is_active: true,
      };

      const result = linkWhitelistInsertSchema.parse(validData);

      expect(result).toEqual(validData);
    });

    it('should use default is_active value', () => {
      const validData = {
        canonical_term: 'Machine Learning',
        standalone_title: 'Machine Learning (Computer Science)',
      };

      const result = linkWhitelistInsertSchema.parse(validData);

      expect(result.is_active).toBe(true);
    });

    it('should reject empty canonical_term', () => {
      const invalidData = {
        canonical_term: '',
        standalone_title: 'Some Title',
      };

      expect(() => linkWhitelistInsertSchema.parse(invalidData)).toThrow();
    });

    it('should accept optional description', () => {
      const validData = {
        canonical_term: 'Machine Learning',
        standalone_title: 'Machine Learning (Computer Science)',
      };

      const result = linkWhitelistInsertSchema.parse(validData);

      expect(result.description).toBeUndefined();
    });
  });

  describe('linkAliasInsertSchema', () => {
    it('should validate correct alias insert data', () => {
      const validData = {
        whitelist_id: 1,
        alias_term: 'ML',
      };

      const result = linkAliasInsertSchema.parse(validData);

      expect(result).toEqual(validData);
    });

    it('should reject non-positive whitelist_id', () => {
      const invalidData = {
        whitelist_id: 0,
        alias_term: 'ML',
      };

      expect(() => linkAliasInsertSchema.parse(invalidData)).toThrow();
    });

    it('should reject empty alias_term', () => {
      const invalidData = {
        whitelist_id: 1,
        alias_term: '',
      };

      expect(() => linkAliasInsertSchema.parse(invalidData)).toThrow();
    });
  });

  describe('articleHeadingLinkInsertSchema', () => {
    it('should validate correct heading link insert data', () => {
      const validData = {
        explanation_id: 123,
        heading_text: 'Training Process',
        standalone_title: 'Machine Learning Training Process',
      };

      const result = articleHeadingLinkInsertSchema.parse(validData);

      expect(result).toEqual(validData);
    });

    it('should reject non-positive explanation_id', () => {
      const invalidData = {
        explanation_id: -1,
        heading_text: 'Training Process',
        standalone_title: 'Machine Learning Training Process',
      };

      expect(() => articleHeadingLinkInsertSchema.parse(invalidData)).toThrow();
    });
  });

  describe('articleLinkOverrideInsertSchema', () => {
    it('should validate custom_title override', () => {
      const validData = {
        explanation_id: 123,
        term: 'neural networks',
        override_type: LinkOverrideType.CustomTitle,
        custom_standalone_title: 'Artificial Neural Networks',
      };

      const result = articleLinkOverrideInsertSchema.parse(validData);

      expect(result).toEqual(validData);
    });

    it('should validate disabled override', () => {
      const validData = {
        explanation_id: 123,
        term: 'neural networks',
        override_type: LinkOverrideType.Disabled,
      };

      const result = articleLinkOverrideInsertSchema.parse(validData);

      expect(result.override_type).toBe('disabled');
    });

    it('should reject invalid override_type', () => {
      const invalidData = {
        explanation_id: 123,
        term: 'neural networks',
        override_type: 'invalid_type',
      };

      expect(() => articleLinkOverrideInsertSchema.parse(invalidData)).toThrow();
    });
  });

  describe('linkWhitelistSnapshotSchema', () => {
    it('should validate correct snapshot data', () => {
      const validData = {
        id: 1,
        version: 5,
        data: {
          'machine learning': {
            canonical_term: 'Machine Learning',
            standalone_title: 'Machine Learning (Computer Science)',
          },
        },
        updated_at: '2024-03-20T10:30:00Z',
      };

      const result = linkWhitelistSnapshotSchema.parse(validData);

      expect(result.version).toBe(5);
      expect(result.data['machine learning'].canonical_term).toBe('Machine Learning');
    });

    it('should accept empty data object', () => {
      const validData = {
        id: 1,
        version: 0,
        data: {},
        updated_at: '2024-03-20T10:30:00Z',
      };

      const result = linkWhitelistSnapshotSchema.parse(validData);

      expect(result.data).toEqual({});
    });

    it('should reject negative version', () => {
      const invalidData = {
        id: 1,
        version: -1,
        data: {},
        updated_at: '2024-03-20T10:30:00Z',
      };

      expect(() => linkWhitelistSnapshotSchema.parse(invalidData)).toThrow();
    });
  });

  describe('resolvedLinkSchema', () => {
    it('should validate heading link', () => {
      const validData = {
        term: '## Training Process',
        startIndex: 0,
        endIndex: 20,
        standaloneTitle: 'Machine Learning Training',
        type: 'heading' as const,
      };

      const result = resolvedLinkSchema.parse(validData);

      expect(result.type).toBe('heading');
    });

    it('should validate term link', () => {
      const validData = {
        term: 'neural networks',
        startIndex: 50,
        endIndex: 65,
        standaloneTitle: 'Artificial Neural Networks',
        type: 'term' as const,
      };

      const result = resolvedLinkSchema.parse(validData);

      expect(result.type).toBe('term');
    });

    it('should reject invalid type', () => {
      const invalidData = {
        term: 'test',
        startIndex: 0,
        endIndex: 4,
        standaloneTitle: 'Test',
        type: 'invalid',
      };

      expect(() => resolvedLinkSchema.parse(invalidData)).toThrow();
    });

    it('should reject negative indices', () => {
      const invalidData = {
        term: 'test',
        startIndex: -1,
        endIndex: 4,
        standaloneTitle: 'Test',
        type: 'term',
      };

      expect(() => resolvedLinkSchema.parse(invalidData)).toThrow();
    });
  });
});
