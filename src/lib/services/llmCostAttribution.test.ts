// Unit tests for cost attribution: source→entity/category mapping (incl. exhaustiveness
// over CALL_SOURCES) and the test/mock classifier.

import { CALL_SOURCES, evolutionSource } from '@/lib/services/llmCallSource';
import {
  attributeCallSource,
  isTestLlmCall,
  TEST_USER_IDS,
} from '@/lib/services/llmCostAttribution';

describe('attributeCallSource', () => {
  it('routes evolution_* sources to the evolution category', () => {
    expect(attributeCallSource(evolutionSource('generation')).category).toBe('evolution');
    expect(attributeCallSource(evolutionSource('generation')).entity).toBe('Evolution: generation');
    expect(attributeCallSource(CALL_SOURCES.evolutionJudgeEval).category).toBe('evolution');
  });

  it('maps known non-evolution sources to their label', () => {
    expect(attributeCallSource(CALL_SOURCES.evaluateTags)).toEqual({
      entity: 'Tag evaluation',
      category: 'non_evolution',
    });
  });

  it('handles the unattributed fallback', () => {
    expect(attributeCallSource('unattributed:someFn')).toEqual({
      entity: 'Unattributed',
      category: 'non_evolution',
    });
  });

  it('degrades gracefully for unknown sources', () => {
    expect(attributeCallSource('legacy_unknown_source')).toEqual({
      entity: 'legacy_unknown_source',
      category: 'non_evolution',
    });
  });

  // Exhaustiveness: adding a CALL_SOURCES member without an entity mapping fails CI.
  // The fallback for a non-evolution source returns the raw source string, so a mapped
  // member must differ from its raw value.
  it('maps every CALL_SOURCES member to a non-fallback entity', () => {
    for (const source of Object.values(CALL_SOURCES)) {
      const { entity } = attributeCallSource(source);
      expect(entity).not.toBe(source);
    }
  });
});

describe('isTestLlmCall', () => {
  const realRow = {
    userid: 'a1b2c3d4-0000-4000-8000-000000000abc',
    callSource: CALL_SOURCES.evaluateTags,
    content: 'real model output',
  };

  it('flags rows from known test/system userids', () => {
    for (const uid of TEST_USER_IDS) {
      expect(isTestLlmCall({ ...realRow, userid: uid })).toBe(true);
    }
  });

  it('flags the integration_test / generation factory sources', () => {
    expect(isTestLlmCall({ ...realRow, callSource: 'integration_test' })).toBe(true);
    expect(isTestLlmCall({ ...realRow, callSource: 'generation' })).toBe(true);
  });

  it('flags the mock content fingerprint', () => {
    expect(isTestLlmCall({ ...realRow, content: 'Unexpected call' })).toBe(true);
  });

  it('does NOT flag a real prod-shaped row (when not in a test env)', () => {
    const prevE2e = process.env.E2E_TEST_MODE;
    const prevNode = process.env.NODE_ENV;
    // jest sets NODE_ENV=test; simulate prod for this assertion.
    (process.env as Record<string, string>).NODE_ENV = 'production';
    delete process.env.E2E_TEST_MODE;
    try {
      expect(isTestLlmCall(realRow)).toBe(false);
    } finally {
      (process.env as Record<string, string>).NODE_ENV = prevNode as string;
      if (prevE2e !== undefined) process.env.E2E_TEST_MODE = prevE2e;
    }
  });
});
