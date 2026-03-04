// Tests for evolution URL builder utility functions.

import { buildExplanationUrl, buildRunUrl, buildVariantUrl, buildExplorerUrl, buildVariantDetailUrl, buildExperimentUrl, buildArenaTopicUrl, buildPromptUrl, buildStrategyUrl } from './evolutionUrls';

describe('evolutionUrls', () => {
  describe('buildExplanationUrl', () => {
    it('constructs URL with explanation_id query param', () => {
      expect(buildExplanationUrl(42)).toBe('/results?explanation_id=42');
    });
  });

  describe('buildRunUrl', () => {
    it('constructs run detail URL', () => {
      expect(buildRunUrl('abc-123')).toBe('/admin/quality/evolution/run/abc-123');
    });
  });

  describe('buildVariantUrl', () => {
    it('constructs variant URL with tab and variant params', () => {
      expect(buildVariantUrl('run-1', 'var-1')).toBe(
        '/admin/quality/evolution/run/run-1?tab=variants&variant=var-1',
      );
    });
  });

  describe('buildVariantDetailUrl', () => {
    it('constructs variant detail URL', () => {
      expect(buildVariantDetailUrl('abc-123')).toBe('/admin/quality/evolution/variant/abc-123');
    });
  });

  describe('buildExperimentUrl', () => {
    it('constructs experiment detail URL', () => {
      expect(buildExperimentUrl('exp-abc')).toBe('/admin/quality/optimization/experiment/exp-abc');
    });
  });

  describe('buildArenaTopicUrl', () => {
    it('constructs arena topic detail URL', () => {
      expect(buildArenaTopicUrl('topic-123')).toBe('/admin/quality/arena/topic-123');
    });
  });

  describe('buildPromptUrl', () => {
    it('is an alias for buildArenaTopicUrl', () => {
      expect(buildPromptUrl('topic-123')).toBe(buildArenaTopicUrl('topic-123'));
    });
  });

  describe('buildStrategyUrl', () => {
    it('constructs strategy detail URL', () => {
      expect(buildStrategyUrl('strat-abc')).toBe('/admin/quality/strategies/strat-abc');
    });
  });

  describe('buildExplorerUrl', () => {
    it('returns base URL when no filters', () => {
      expect(buildExplorerUrl()).toBe('/admin/quality/explorer');
    });

    it('returns base URL for empty filters', () => {
      expect(buildExplorerUrl({})).toBe('/admin/quality/explorer');
    });

    it('appends simple string filters', () => {
      const url = buildExplorerUrl({ view: 'matrix', metric: 'avgElo' });
      expect(url).toContain('/admin/quality/explorer?');
      expect(url).toContain('view=matrix');
      expect(url).toContain('metric=avgElo');
    });

    it('joins array filters with commas', () => {
      const url = buildExplorerUrl({ prompts: ['id-1', 'id-2'], strategies: ['s-1'] });
      expect(url).toContain('prompts=id-1%2Cid-2');
      expect(url).toContain('strategies=s-1');
    });

    it('omits empty arrays and empty strings', () => {
      const url = buildExplorerUrl({ prompts: [], view: '', unit: 'run' });
      expect(url).toBe('/admin/quality/explorer?unit=run');
    });
  });
});
