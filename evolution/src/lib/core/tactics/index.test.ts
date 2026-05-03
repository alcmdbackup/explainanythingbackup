// Tests for tactics index: TACTIC_PALETTE coverage, MARKER_TACTICS shape, and the
// load-bearing invariant that getTacticDef() returns undefined for marker names.

import { TACTIC_PALETTE, MARKER_TACTICS, getTacticDef, isValidTactic } from './index';

describe('TACTIC_PALETTE', () => {
  it('includes criteria_driven marker color (indigo)', () => {
    expect(TACTIC_PALETTE['criteria_driven']).toBeDefined();
    expect(TACTIC_PALETTE['criteria_driven']).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});

describe('MARKER_TACTICS', () => {
  it('contains exactly one entry (criteria_driven)', () => {
    expect(MARKER_TACTICS).toHaveLength(1);
  });

  it('criteria_driven entry has correct shape', () => {
    const entry = MARKER_TACTICS.find((t) => t.name === 'criteria_driven');
    expect(entry).toBeDefined();
    expect(entry?.label).toBe('Criteria-Driven');
    expect(entry?.agent_type).toBe('evaluate_criteria_then_generate_from_previous_article');
    expect(entry?.category).toBe('meta');
  });
});

describe('getTacticDef vs MARKER_TACTICS (load-bearing invariant)', () => {
  it('getTacticDef("criteria_driven") returns undefined (marker, not prompt-driving)', () => {
    expect(getTacticDef('criteria_driven')).toBeUndefined();
  });

  it('getTacticDef returns a real def for system tactics', () => {
    expect(getTacticDef('lexical_simplify')).toBeDefined();
    expect(getTacticDef('structural_transform')).toBeDefined();
  });

  it('getTacticDef returns undefined for unknown name', () => {
    expect(getTacticDef('totally_made_up')).toBeUndefined();
  });
});

describe('isValidTactic', () => {
  it('returns true for system tactic', () => {
    expect(isValidTactic('lexical_simplify')).toBe(true);
  });

  it('returns false for marker tactic', () => {
    // criteria_driven is in TACTIC_PALETTE + MARKER_TACTICS, but isValidTactic
    // checks getTacticDef — markers don't drive prompts so they aren't "valid" for
    // reflection-style ranking parsers that target prompt-driving tactics only.
    expect(isValidTactic('criteria_driven')).toBe(false);
  });

  it('returns false for unknown name', () => {
    expect(isValidTactic('xyz')).toBe(false);
  });
});
