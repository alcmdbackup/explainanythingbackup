// Unit tests for the tactic registry — validates all system tactics, collision prevention, lookups.

import { SYSTEM_GENERATE_TACTICS, GENERATE_TACTIC_NAMES, type GenerateTacticName } from './generateTactics';
import { ALL_SYSTEM_TACTICS, ALL_TACTIC_NAMES, getTacticDef, isValidTactic, TACTICS_BY_CATEGORY, TACTIC_PALETTE, DEFAULT_TACTICS } from './index';

describe('SYSTEM_GENERATE_TACTICS', () => {
  it('has 24 system generate tactics', () => {
    expect(Object.keys(SYSTEM_GENERATE_TACTICS)).toHaveLength(24);
  });

  it.each(GENERATE_TACTIC_NAMES)('tactic "%s" has valid TacticDef', (name) => {
    const def = SYSTEM_GENERATE_TACTICS[name as GenerateTacticName];
    expect(def.label).toBeTruthy();
    expect(def.category).toBeTruthy();
    expect(def.preamble).toBeTruthy();
    expect(def.instructions).toBeTruthy();
    expect(def.preamble.length).toBeGreaterThan(10);
    expect(def.instructions.length).toBeGreaterThan(20);
  });

  it.each(GENERATE_TACTIC_NAMES)('tactic "%s" preamble starts with "You are"', (name) => {
    const def = SYSTEM_GENERATE_TACTICS[name as GenerateTacticName];
    expect(def.preamble).toMatch(/^You are /);
  });

  it('has no duplicate tactic names', () => {
    expect(new Set(GENERATE_TACTIC_NAMES).size).toBe(GENERATE_TACTIC_NAMES.length);
  });

  it('GENERATE_TACTIC_NAMES matches Object.keys', () => {
    expect(GENERATE_TACTIC_NAMES).toEqual(Object.keys(SYSTEM_GENERATE_TACTICS));
  });
});

describe('ALL_SYSTEM_TACTICS', () => {
  it('contains all generate tactics', () => {
    for (const name of GENERATE_TACTIC_NAMES) {
      expect(ALL_SYSTEM_TACTICS[name]).toBeDefined();
    }
  });

  it('ALL_TACTIC_NAMES has correct count', () => {
    expect(ALL_TACTIC_NAMES.length).toBe(GENERATE_TACTIC_NAMES.length);
  });
});

describe('getTacticDef', () => {
  it('returns TacticDef for known tactic', () => {
    const def = getTacticDef('structural_transform');
    expect(def).toBeDefined();
    expect(def!.label).toBe('Structural Transform');
  });

  it('returns undefined for unknown tactic', () => {
    expect(getTacticDef('nonexistent_tactic')).toBeUndefined();
  });
});

describe('isValidTactic', () => {
  it('returns true for known tactics', () => {
    expect(isValidTactic('structural_transform')).toBe(true);
    expect(isValidTactic('analogy_bridge')).toBe(true);
    expect(isValidTactic('compression_distill')).toBe(true);
  });

  it('returns false for unknown strings', () => {
    expect(isValidTactic('nonexistent')).toBe(false);
    expect(isValidTactic('')).toBe(false);
  });
});

describe('TACTICS_BY_CATEGORY', () => {
  it('has entries for all categories', () => {
    const categories = ['core', 'extended', 'depth', 'audience', 'structural', 'quality', 'meta'];
    for (const cat of categories) {
      expect(TACTICS_BY_CATEGORY[cat]).toBeDefined();
      expect(TACTICS_BY_CATEGORY[cat]!.length).toBeGreaterThan(0);
    }
  });

  it('core category has 3 tactics', () => {
    expect(TACTICS_BY_CATEGORY['core']).toHaveLength(3);
  });

  it('total tactics across categories equals ALL_TACTIC_NAMES', () => {
    const total = Object.values(TACTICS_BY_CATEGORY).reduce((s, arr) => s + arr.length, 0);
    expect(total).toBe(ALL_TACTIC_NAMES.length);
  });
});

describe('TACTIC_PALETTE', () => {
  it.each(GENERATE_TACTIC_NAMES)('has color for tactic "%s"', (name) => {
    expect(TACTIC_PALETTE[name]).toBeDefined();
    expect(TACTIC_PALETTE[name]).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('DEFAULT_TACTICS', () => {
  it('has 3 core tactics', () => {
    expect(DEFAULT_TACTICS).toEqual(['structural_transform', 'lexical_simplify', 'grounding_enhance']);
  });
});

describe('collision prevention', () => {
  it('no key overlap between agent tactic groups', () => {
    // Currently only GENERATE_TACTIC_NAMES. When EVOLVE_TACTIC_NAMES is added,
    // this test should verify no overlap between the arrays.
    const allKeys = [...GENERATE_TACTIC_NAMES];
    expect(new Set(allKeys).size).toBe(allKeys.length);
  });
});
