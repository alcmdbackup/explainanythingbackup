// Tests for shared utilities: validateUuid(), UUID_REGEX, UUID_V4_REGEX, isTestContentName(), applyTestContentNameFilter(), applyTestContentColumnFilter().

import { validateUuid, UUID_REGEX, UUID_V4_REGEX, isTestContentName, applyTestContentNameFilter, applyTestContentColumnFilter, TEST_NAME_FIXTURES } from './shared';

describe('validateUuid', () => {
  const VALID_V4 = '550e8400-e29b-41d4-a716-446655440000';
  const VALID_V3 = '550e8400-e29b-31d4-a716-446655440000'; // version 3

  it('accepts a valid v4 UUID in loose mode', () => {
    expect(validateUuid(VALID_V4)).toBe(true);
  });

  it('accepts a valid v4 UUID in strict mode', () => {
    expect(validateUuid(VALID_V4, true)).toBe(true);
  });

  it('accepts a valid v3 UUID in loose mode', () => {
    expect(validateUuid(VALID_V3)).toBe(true);
  });

  it('rejects a v3 UUID in strict mode (version digit is not 4)', () => {
    expect(validateUuid(VALID_V3, true)).toBe(false);
  });

  it('rejects an invalid format', () => {
    expect(validateUuid('not-a-uuid')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(validateUuid('')).toBe(false);
  });

  it('accepts uppercase UUIDs (case-insensitive)', () => {
    expect(validateUuid(VALID_V4.toUpperCase())).toBe(true);
  });

  it('rejects UUID with wrong variant in strict mode', () => {
    // variant digit must be 8, 9, a, or b for v4
    const wrongVariant = '550e8400-e29b-41d4-0716-446655440000';
    expect(validateUuid(wrongVariant, true)).toBe(false);
  });
});

describe('UUID_REGEX', () => {
  it('matches any UUID version', () => {
    expect(UUID_REGEX.test('550e8400-e29b-31d4-a716-446655440000')).toBe(true);
  });

  it('rejects non-UUID strings', () => {
    expect(UUID_REGEX.test('hello')).toBe(false);
  });
});

describe('UUID_V4_REGEX', () => {
  it('matches v4 UUIDs', () => {
    expect(UUID_V4_REGEX.test('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('rejects non-v4 UUIDs', () => {
    expect(UUID_V4_REGEX.test('550e8400-e29b-31d4-a716-446655440000')).toBe(false);
  });
});

describe('isTestContentName', () => {
  it('matches exact "test" (case-insensitive)', () => {
    expect(isTestContentName('test')).toBe(true);
    expect(isTestContentName('Test')).toBe(true);
    expect(isTestContentName('TEST')).toBe(true);
  });

  it('matches [TEST] prefix', () => {
    expect(isTestContentName('[TEST] My Strategy')).toBe(true);
    expect(isTestContentName('[test] lowercase')).toBe(true);
  });

  it('matches [E2E] prefix', () => {
    expect(isTestContentName('[E2E] Anchor Strategy 1774967596078')).toBe(true);
    expect(isTestContentName('[e2e] lowercase')).toBe(true);
  });

  it('matches [TEST_EVO] prefix', () => {
    expect(isTestContentName('[TEST_EVO] Strategy suffix')).toBe(true);
    expect(isTestContentName('[test_evo] lowercase')).toBe(true);
  });

  it('matches timestamp-based auto-generated names', () => {
    expect(isTestContentName('nav2-1774498767678-strat')).toBe(true);
    expect(isTestContentName('nav2-1774498767678-exp')).toBe(true);
  });

  it('does NOT match legitimate content starting with "test"', () => {
    expect(isTestContentName('Testing strategies for climate change')).toBe(false);
    expect(isTestContentName('Testimonial page')).toBe(false);
  });

  it('does NOT match regular names', () => {
    expect(isTestContentName('Federal reserve')).toBe(false);
    expect(isTestContentName('March 26, 2026 - B')).toBe(false);
  });

  it('handles null/undefined/empty', () => {
    expect(isTestContentName(null)).toBe(false);
    expect(isTestContentName(undefined)).toBe(false);
    expect(isTestContentName('')).toBe(false);
  });

  // Anti-drift: every fixture must agree with the TS helper. The integration test
  // (src/__tests__/integration/evolution_is_test_name.integration.test.ts) asserts
  // the same fixtures against the Postgres function — together they prevent the TS
  // and SQL implementations from drifting apart.
  describe('TEST_NAME_FIXTURES match isTestContentName', () => {
    it.each(TEST_NAME_FIXTURES)('$name ($reason) → isTest=$isTest', ({ name, isTest }) => {
      expect(isTestContentName(name)).toBe(isTest);
    });
  });
});

describe('applyTestContentNameFilter', () => {
  it('chains .not() calls for all test prefixes', () => {
    const notCalls: [string, string, string][] = [];
    const mockQuery: { not: jest.Mock } = {
      not: jest.fn((...args: [string, string, string]) => {
        notCalls.push(args);
        return mockQuery;
      }),
    };

    const result = applyTestContentNameFilter(mockQuery);

    expect(result).toBe(mockQuery);
    expect(notCalls).toEqual([
      ['name', 'ilike', '%[TEST]%'],
      ['name', 'ilike', '%[E2E]%'],
      ['name', 'ilike', '%[TEST_EVO]%'],
      ['name', 'ilike', 'test'],
    ]);
  });
});

describe('applyTestContentColumnFilter', () => {
  it('applies .eq(is_test_content, false) to the query', () => {
    const eqCalls: [string, boolean][] = [];
    const mockQuery: { eq: jest.Mock } = {
      eq: jest.fn((...args: [string, boolean]) => {
        eqCalls.push(args);
        return mockQuery;
      }),
    };

    const result = applyTestContentColumnFilter(mockQuery);

    expect(result).toBe(mockQuery);
    expect(eqCalls).toEqual([['is_test_content', false]]);
  });
});
