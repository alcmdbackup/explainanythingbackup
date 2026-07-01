// Unit tests for the shared /edit publicly-submittable filter.
// improvements_to_edit_page_evolution_20260630 Phase 4.

import {
  assertStrategyPubliclySubmittable,
  filterPubliclySubmittable,
  MOCK_MODEL_NAMES,
  NotPubliclySubmittableError,
  type StrategyRow,
} from './publicStrategyFilter';

const ORIG_ENV = process.env.PUBLIC_EDIT_WIDEN_FILTER;

function makeRow(overrides: Partial<StrategyRow> = {}): StrategyRow {
  return {
    status: 'active',
    is_test_content: false,
    public_visible: true,
    config: { generationModel: 'gpt-4.1-mini' },
    ...overrides,
  };
}

afterEach(() => {
  if (ORIG_ENV === undefined) delete process.env.PUBLIC_EDIT_WIDEN_FILTER;
  else process.env.PUBLIC_EDIT_WIDEN_FILTER = ORIG_ENV;
});

describe('assertStrategyPubliclySubmittable — legacy filter (widen=false)', () => {
  beforeEach(() => { delete process.env.PUBLIC_EDIT_WIDEN_FILTER; });

  it('accepts public+active+non-test+real-model', () => {
    expect(() => assertStrategyPubliclySubmittable(makeRow())).not.toThrow();
  });

  it('rejects archived', () => {
    expect(() => assertStrategyPubliclySubmittable(makeRow({ status: 'archived' })))
      .toThrow(NotPubliclySubmittableError);
    try { assertStrategyPubliclySubmittable(makeRow({ status: 'archived' })); }
    catch (e) { expect((e as NotPubliclySubmittableError).code).toBe('STATUS'); }
  });

  it('rejects test-content', () => {
    try { assertStrategyPubliclySubmittable(makeRow({ is_test_content: true })); }
    catch (e) { expect((e as NotPubliclySubmittableError).code).toBe('TEST_CONTENT'); }
  });

  it('rejects mock model', () => {
    try { assertStrategyPubliclySubmittable(makeRow({ config: { generationModel: 'mock' } })); }
    catch (e) { expect((e as NotPubliclySubmittableError).code).toBe('MOCK_MODEL'); }
  });

  it('rejects missing generationModel', () => {
    try { assertStrategyPubliclySubmittable(makeRow({ config: {} })); }
    catch (e) { expect((e as NotPubliclySubmittableError).code).toBe('MOCK_MODEL'); }
  });

  it('rejects non-public_visible in legacy mode', () => {
    try { assertStrategyPubliclySubmittable(makeRow({ public_visible: false })); }
    catch (e) { expect((e as NotPubliclySubmittableError).code).toBe('PUBLIC_VISIBLE'); }
  });

  it('rejects null public_visible in legacy mode', () => {
    try { assertStrategyPubliclySubmittable(makeRow({ public_visible: null })); }
    catch (e) { expect((e as NotPubliclySubmittableError).code).toBe('PUBLIC_VISIBLE'); }
  });
});

describe('assertStrategyPubliclySubmittable — widened filter (widen=true)', () => {
  beforeEach(() => { process.env.PUBLIC_EDIT_WIDEN_FILTER = 'true'; });

  it('accepts public+active+non-test+real-model', () => {
    expect(() => assertStrategyPubliclySubmittable(makeRow())).not.toThrow();
  });

  it('accepts non-public_visible when widen=true', () => {
    expect(() => assertStrategyPubliclySubmittable(makeRow({ public_visible: false }))).not.toThrow();
    expect(() => assertStrategyPubliclySubmittable(makeRow({ public_visible: null }))).not.toThrow();
  });

  it('still rejects mock model', () => {
    try { assertStrategyPubliclySubmittable(makeRow({ config: { generationModel: 'mock' }, public_visible: false })); }
    catch (e) { expect((e as NotPubliclySubmittableError).code).toBe('MOCK_MODEL'); }
  });

  it('still rejects test-content', () => {
    try { assertStrategyPubliclySubmittable(makeRow({ is_test_content: true, public_visible: false })); }
    catch (e) { expect((e as NotPubliclySubmittableError).code).toBe('TEST_CONTENT'); }
  });

  it('still rejects archived', () => {
    try { assertStrategyPubliclySubmittable(makeRow({ status: 'archived', public_visible: true })); }
    catch (e) { expect((e as NotPubliclySubmittableError).code).toBe('STATUS'); }
  });
});

describe('filterPubliclySubmittable', () => {
  beforeEach(() => { process.env.PUBLIC_EDIT_WIDEN_FILTER = 'true'; });

  it('returns only submittable rows, preserving order', () => {
    const rows = [
      makeRow({ config: { generationModel: 'gpt-4.1-mini' } }),        // ok
      makeRow({ status: 'archived' }),                                  // reject
      makeRow({ config: { generationModel: 'mock' } }),                 // reject
      makeRow({ config: { generationModel: 'claude-sonnet-4' } }),      // ok
      makeRow({ is_test_content: true }),                               // reject
    ];
    const kept = filterPubliclySubmittable(rows);
    expect(kept.length).toBe(2);
    expect(kept[0]!.config?.generationModel).toBe('gpt-4.1-mini');
    expect(kept[1]!.config?.generationModel).toBe('claude-sonnet-4');
  });
});

describe('MOCK_MODEL_NAMES', () => {
  it('covers the expected names', () => {
    expect(MOCK_MODEL_NAMES.has('mock')).toBe(true);
    expect(MOCK_MODEL_NAMES.has('test-mock')).toBe(true);
    expect(MOCK_MODEL_NAMES.has('gpt-4.1-mini')).toBe(false);
  });
});
