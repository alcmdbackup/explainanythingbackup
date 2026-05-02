// Tests for ATTRIBUTION_EXTRACTORS registry — Phase 8 of
// develop_reflection_and_generateFromParentArticle_agent_evolution_20260430.
//
// Verifies the side-effect imports at the bottom of each agent file successfully
// register their dimension extractors before computeEloAttributionMetrics runs.

import {
  ATTRIBUTION_EXTRACTORS,
  registerAttributionExtractor,
  _resetAttributionExtractorsForTesting,
} from './attributionExtractors';

// Importing the agents barrel triggers each agent file's registerAttributionExtractor()
// at module load. This mirrors the production load chain (claimAndExecuteRun →
// runIterationLoop → agentRegistry → agent files).
import '../core/agents';

describe('ATTRIBUTION_EXTRACTORS registry', () => {
  it('GenerateFromPreviousArticleAgent extractor is registered', () => {
    const extractor = ATTRIBUTION_EXTRACTORS['generate_from_previous_article'];
    expect(extractor).toBeDefined();
  });

  it('ReflectAndGenerateFromPreviousArticleAgent extractor is registered', () => {
    const extractor = ATTRIBUTION_EXTRACTORS['reflect_and_generate_from_previous_article'];
    expect(extractor).toBeDefined();
  });

  it('GFPA extractor returns detail.tactic', () => {
    const extractor = ATTRIBUTION_EXTRACTORS['generate_from_previous_article']!;
    expect(extractor({ tactic: 'lexical_simplify' })).toBe('lexical_simplify');
    expect(extractor({})).toBeNull();
    expect(extractor(null)).toBeNull();
    expect(extractor({ tactic: '' })).toBeNull();
  });

  it('Wrapper extractor returns detail.tactic', () => {
    const extractor = ATTRIBUTION_EXTRACTORS['reflect_and_generate_from_previous_article']!;
    expect(extractor({ tactic: 'structural_transform' })).toBe('structural_transform');
    expect(extractor({})).toBeNull();
  });

  it('registerAttributionExtractor is idempotent on same name', () => {
    const beforeCount = Object.keys(ATTRIBUTION_EXTRACTORS).length;
    registerAttributionExtractor('generate_from_previous_article', () => 'override');
    expect(Object.keys(ATTRIBUTION_EXTRACTORS).length).toBe(beforeCount);
    // Restore
    registerAttributionExtractor('generate_from_previous_article', (detail) => {
      const tactic = (detail as { tactic?: unknown })?.tactic;
      return typeof tactic === 'string' && tactic.length > 0 ? tactic : null;
    });
  });

  it('_resetForTesting clears the registry', () => {
    expect(Object.keys(ATTRIBUTION_EXTRACTORS).length).toBeGreaterThan(0);
    _resetAttributionExtractorsForTesting();
    expect(Object.keys(ATTRIBUTION_EXTRACTORS).length).toBe(0);
    // Re-register manually to restore for subsequent tests in the same file.
    registerAttributionExtractor('test', () => null);
    expect(Object.keys(ATTRIBUTION_EXTRACTORS).length).toBe(1);
  });
});
