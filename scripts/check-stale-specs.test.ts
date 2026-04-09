/**
 * @jest-environment node
 */
// Tests for check-stale-specs.ts — validates the testid extraction regexes,
// allowlist matching, and the regression case for admin-evolution-anchor-ranking
// (the original bug class this script catches).

import {
  extractSpecTestids,
  extractSourceTestids,
  isTestidDefined,
  isAllowlisted,
} from './check-stale-specs';

describe('extractSpecTestids', () => {
  it('extracts simple data-testid literals', () => {
    const content = `
      const button = page.locator('[data-testid="submit-button"]');
      const input = page.getByTestId('search-input');
    `;
    const ids = extractSpecTestids(content);
    expect(ids).toContain('submit-button');
  });

  it('handles single quotes', () => {
    const content = `await page.locator("[data-testid='close-modal']").click();`;
    const ids = extractSpecTestids(content);
    expect(ids).toContain('close-modal');
  });

  it('skips interpolated testids containing ${', () => {
    const content = `
      const cell = page.locator(\`[data-testid="row-\${id}"]\`);
      const fixed = page.locator('[data-testid="static-id"]');
    `;
    const ids = extractSpecTestids(content);
    expect(ids).toContain('static-id');
    expect(ids).not.toContain('row-${id}');
  });

  it('returns unique ids only', () => {
    const content = `
      const a = page.locator('[data-testid="duplicate"]');
      const b = page.locator('[data-testid="duplicate"]');
    `;
    expect(extractSpecTestids(content)).toEqual(['duplicate']);
  });
});

describe('extractSourceTestids', () => {
  it('extracts data-testid literals as literals', () => {
    const content = `<button data-testid="submit-btn">Submit</button>`;
    const { literals, prefixes } = extractSourceTestids(content);
    expect(literals.has('submit-btn')).toBe(true);
    expect(prefixes.size).toBe(0);
  });

  it('extracts template literal prefixes', () => {
    const content = '<tr data-testid={`row-${id}`} />';
    const { prefixes } = extractSourceTestids(content);
    expect(prefixes.has('row-')).toBe(true);
  });

  it('extracts testId prop literals (prop pass-through)', () => {
    const content = `<MetricGrid testId="dashboard-metrics" />`;
    const { literals } = extractSourceTestids(content);
    expect(literals.has('dashboard-metrics')).toBe(true);
  });

  it('extracts testId prop template literals', () => {
    const content = '<EntityList testId={`entity-${type}`} />';
    const { prefixes } = extractSourceTestids(content);
    expect(prefixes.has('entity-')).toBe(true);
  });
});

describe('isTestidDefined', () => {
  const literals = new Set(['login-button', 'cancel-modal']);
  const prefixes = new Set(['row-', 'cell-status-']);

  it('returns true for exact literal match', () => {
    expect(isTestidDefined('login-button', literals, prefixes)).toBe(true);
  });

  it('returns true when spec id matches a source prefix', () => {
    expect(isTestidDefined('row-42', literals, prefixes)).toBe(true);
    expect(isTestidDefined('cell-status-123', literals, prefixes)).toBe(true);
  });

  it('returns false when spec id matches neither', () => {
    expect(isTestidDefined('orphaned-id', literals, prefixes)).toBe(false);
  });

  it('does NOT match a prefix that comes after the spec id (no false matches)', () => {
    expect(isTestidDefined('cell', literals, prefixes)).toBe(false);
  });
});

describe('isAllowlisted', () => {
  const allowlist = ['todo-feature-', 'planned-ui-'];

  it('returns true for prefix match', () => {
    expect(isAllowlisted('todo-feature-button', allowlist)).toBe(true);
    expect(isAllowlisted('planned-ui-table', allowlist)).toBe(true);
  });

  it('returns false for non-match', () => {
    expect(isAllowlisted('orphaned-id', allowlist)).toBe(false);
  });

  it('returns false for empty allowlist', () => {
    expect(isAllowlisted('any-id', [])).toBe(false);
  });
});

// Regression case: the script must catch the admin-evolution-anchor-ranking
// situation that originally motivated its creation. A spec that references
// `data-testid="anchor-ranking-badge"` with no source defining it should fail.
describe('regression: admin-evolution-anchor-ranking class', () => {
  it('flags a spec testid that has no source definition', () => {
    const sourceLiterals = new Set(['existing-button']);
    const sourcePrefixes = new Set<string>();

    // Simulate the orphaned spec — references a testid for a removed feature
    const specContent = `
      const badge = page.locator('[data-testid="anchor-ranking-badge"]');
    `;
    const specIds = extractSpecTestids(specContent);

    expect(specIds).toContain('anchor-ranking-badge');
    expect(isTestidDefined('anchor-ranking-badge', sourceLiterals, sourcePrefixes)).toBe(false);
  });

  it('does NOT flag the same testid if it exists in source', () => {
    const sourceLiterals = new Set(['anchor-ranking-badge', 'other-id']);
    const sourcePrefixes = new Set<string>();

    expect(isTestidDefined('anchor-ranking-badge', sourceLiterals, sourcePrefixes)).toBe(true);
  });
});
