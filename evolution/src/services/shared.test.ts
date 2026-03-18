// Tests for shared utilities: validateUuid(), UUID_REGEX, UUID_V4_REGEX.

import { validateUuid, UUID_REGEX, UUID_V4_REGEX } from './shared';

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
