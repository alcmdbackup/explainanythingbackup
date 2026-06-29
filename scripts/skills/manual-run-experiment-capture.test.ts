/**
 * @jest-environment node
 */
// Tests for manual-run-experiment-capture.ts. Covers (a) regex against 3 real
// seed-script output shapes (new / Reusing / Reusing existing), (b) the
// _status.json idempotency three-way (write/noop/error), and (c) branch-prefix
// stripping for all 5 known prefixes + the no-match fallback.

import {
  extractExperimentId,
  validateStatusJsonExperimentId,
  resolveProjectFolderFromBranch,
  isValidUuid,
} from './manual-run-experiment-capture';

const UUID_A = 'a1b2c3d4-e5f6-4789-9abc-def012345678';
const UUID_B = '12345678-90ab-4cde-8f01-234567890abc';

describe('extractExperimentId — regex covers 3 known seed-script output shapes', () => {
  it('extracts from "experiment_id = <uuid>" (new-experiment shape)', () => {
    const stdout = `[seed] Building config...
experiment_id      = ${UUID_A}
strategy_id (arm A) = aaaa-bbbb-cccc-dddd-eeee-ffff-1111-2222`;
    expect(extractExperimentId(stdout)).toBe(UUID_A);
  });

  it('extracts from "Reusing existing experiment <uuid>" (older --append phrasing)', () => {
    const stdout = `[seed] --append mode
Reusing existing experiment ${UUID_A}`;
    expect(extractExperimentId(stdout)).toBe(UUID_A);
  });

  it('extracts from "Reusing experiment <uuid>" (seedEloAgentComparisonExperiment_20260626.ts:258)', () => {
    const stdout = `[seed] --append mode
Reusing experiment ${UUID_A}`;
    expect(extractExperimentId(stdout)).toBe(UUID_A);
  });

  it('prefers new-experiment line when both shapes are present', () => {
    const stdout = `Reusing experiment ${UUID_B}
experiment_id = ${UUID_A}`;
    expect(extractExperimentId(stdout)).toBe(UUID_A);
  });

  it('returns null on unrecognized output shape (caller errors explicitly)', () => {
    expect(extractExperimentId('[seed] something went wrong, no id printed')).toBeNull();
  });

  it('returns null on empty/null input', () => {
    expect(extractExperimentId('')).toBeNull();
    expect(extractExperimentId(null as unknown as string)).toBeNull();
  });

  it('does NOT match a SQL-trailing line like "WHERE experiment_id=\'<uuid>\'"', () => {
    // Without the canonical "experiment_id = <uuid>" assignment shape AND without
    // a "Reusing experiment" prefix, this must NOT extract. (The UUID is in the
    // line but not in a recognized shape.) This bounds the brittleness called out
    // as residual minor issue #5 in the plan-review iteration-3 verdict.
    const stdout = `[debug] SELECT cost FROM runs WHERE experiment_id='${UUID_A}'`;
    expect(extractExperimentId(stdout)).toBeNull();
  });
});

describe('validateStatusJsonExperimentId — idempotency three-way', () => {
  it('returns "write" when current is absent (null/undefined/empty)', () => {
    expect(validateStatusJsonExperimentId(null, UUID_A)).toBe('write');
    expect(validateStatusJsonExperimentId(undefined, UUID_A)).toBe('write');
    expect(validateStatusJsonExperimentId('', UUID_A)).toBe('write');
  });

  it('returns "noop" when current equals captured', () => {
    expect(validateStatusJsonExperimentId(UUID_A, UUID_A)).toBe('noop');
  });

  it('returns "noop" for case-insensitive equality', () => {
    expect(validateStatusJsonExperimentId(UUID_A.toUpperCase(), UUID_A)).toBe('noop');
  });

  it('returns "error" when current differs from captured (conflict gate)', () => {
    expect(validateStatusJsonExperimentId(UUID_A, UUID_B)).toBe('error');
  });
});

describe('resolveProjectFolderFromBranch — strip 5 known prefixes', () => {
  const cases: Array<[string, string | null]> = [
    ['feat/foo_20260628', 'docs/planning/foo_20260628'],
    ['fix/bar_20260628', 'docs/planning/bar_20260628'],
    ['chore/baz_20260628', 'docs/planning/baz_20260628'],
    ['docs/qux_20260628', 'docs/planning/qux_20260628'],
    ['hotfix/quux_20260628', 'docs/planning/quux_20260628'],
  ];
  for (const [branch, expected] of cases) {
    it(`maps ${branch} → ${expected}`, () => {
      expect(resolveProjectFolderFromBranch(branch)).toBe(expected);
    });
  }

  it('returns null for branches with no recognized prefix (main, production, etc.)', () => {
    expect(resolveProjectFolderFromBranch('main')).toBeNull();
    expect(resolveProjectFolderFromBranch('production')).toBeNull();
    expect(resolveProjectFolderFromBranch('release-2026-06-28')).toBeNull();
  });

  it('returns null for empty branch name', () => {
    expect(resolveProjectFolderFromBranch('')).toBeNull();
    expect(resolveProjectFolderFromBranch('feat/')).toBeNull();
  });
});

describe('isValidUuid', () => {
  it('accepts canonical 8-4-4-4-12 hex UUIDs', () => {
    expect(isValidUuid(UUID_A)).toBe(true);
    expect(isValidUuid(UUID_B)).toBe(true);
  });

  it('rejects non-UUID strings', () => {
    expect(isValidUuid('not-a-uuid')).toBe(false);
    expect(isValidUuid('a1b2c3d4-e5f6-4789-9abc')).toBe(false); // too short
    expect(isValidUuid('a1b2c3d4e5f64789abcdef012345678')).toBe(false); // no dashes
  });
});
