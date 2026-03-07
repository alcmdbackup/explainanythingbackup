// Tests for evolution URL builder utility functions.

import { buildExplanationUrl, buildRunUrl, buildVariantUrl, buildVariantDetailUrl, buildInvocationUrl, buildExperimentUrl, buildArenaTopicUrl, buildPromptUrl, buildStrategyUrl } from './evolutionUrls';

describe('evolutionUrls', () => {
  describe('buildExplanationUrl', () => {
    it('constructs URL with explanation_id query param', () => {
      expect(buildExplanationUrl(42)).toBe('/results?explanation_id=42');
    });
  });

  describe('buildRunUrl', () => {
    it('constructs run detail URL', () => {
      expect(buildRunUrl('abc-123')).toBe('/admin/evolution/runs/abc-123');
    });
  });

  describe('buildVariantUrl', () => {
    it('constructs variant URL with tab and variant params', () => {
      expect(buildVariantUrl('run-1', 'var-1')).toBe(
        '/admin/evolution/runs/run-1?tab=variants&variant=var-1',
      );
    });
  });

  describe('buildVariantDetailUrl', () => {
    it('constructs variant detail URL', () => {
      expect(buildVariantDetailUrl('abc-123')).toBe('/admin/evolution/variants/abc-123');
    });
  });

  describe('buildInvocationUrl', () => {
    it('constructs invocation detail URL', () => {
      expect(buildInvocationUrl('inv-abc-123')).toBe('/admin/evolution/invocations/inv-abc-123');
    });
  });

  describe('buildExperimentUrl', () => {
    it('constructs experiment detail URL', () => {
      expect(buildExperimentUrl('exp-abc')).toBe('/admin/evolution/experiments/exp-abc');
    });
  });

  describe('buildArenaTopicUrl', () => {
    it('constructs arena topic detail URL', () => {
      expect(buildArenaTopicUrl('topic-123')).toBe('/admin/evolution/arena/topic-123');
    });
  });

  describe('buildPromptUrl', () => {
    it('is an alias for buildArenaTopicUrl', () => {
      expect(buildPromptUrl('topic-123')).toBe(buildArenaTopicUrl('topic-123'));
    });
  });

  describe('buildStrategyUrl', () => {
    it('constructs strategy detail URL', () => {
      expect(buildStrategyUrl('strat-abc')).toBe('/admin/evolution/strategies/strat-abc');
    });
  });
});
