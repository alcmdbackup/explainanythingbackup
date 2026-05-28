// Tests for tactics index: TACTIC_PALETTE coverage, MARKER_TACTICS shape, and the
// load-bearing invariant that getTacticDef() returns undefined for marker names.

import { TACTIC_PALETTE, MARKER_TACTICS, getTacticDef, isValidTactic } from './index';

describe('TACTIC_PALETTE', () => {
  it('includes criteria_driven marker color (indigo)', () => {
    expect(TACTIC_PALETTE['criteria_driven']).toBeDefined();
    expect(TACTIC_PALETTE['criteria_driven']).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('includes debate_synthesis marker color (rose) — bring_back_debate_agent_20260506 §9', () => {
    expect(TACTIC_PALETTE['debate_synthesis']).toBeDefined();
    expect(TACTIC_PALETTE['debate_synthesis']).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});

describe('MARKER_TACTICS', () => {
  it('contains the 5 marker tactic entries (3 criteria-driven + debate_synthesis + paragraph_recombine)', () => {
    expect(MARKER_TACTICS).toHaveLength(5);
    const names = MARKER_TACTICS.map((t) => t.name).sort();
    expect(names).toEqual([
      'criteria_driven',
      'criteria_driven_propose_approve',
      'criteria_driven_single_pass',
      'debate_synthesis',
      'paragraph_recombine',
    ]);
  });

  it('criteria_driven entry has correct shape', () => {
    const entry = MARKER_TACTICS.find((t) => t.name === 'criteria_driven');
    expect(entry).toBeDefined();
    expect(entry?.label).toBe('Criteria-Driven');
    expect(entry?.agent_type).toBe('evaluate_criteria_then_generate_from_previous_article');
    expect(entry?.category).toBe('meta');
  });

  it('criteria_driven_single_pass entry has correct shape', () => {
    const entry = MARKER_TACTICS.find((t) => t.name === 'criteria_driven_single_pass');
    expect(entry).toBeDefined();
    expect(entry?.agent_type).toBe('single_pass_evaluate_criteria_and_generate');
    expect(entry?.category).toBe('meta');
  });

  it('criteria_driven_propose_approve entry has correct shape', () => {
    const entry = MARKER_TACTICS.find((t) => t.name === 'criteria_driven_propose_approve');
    expect(entry).toBeDefined();
    expect(entry?.agent_type).toBe('proposer_approver_criteria_generate');
    expect(entry?.category).toBe('meta');
  });

  it('debate_synthesis entry has correct shape', () => {
    const entry = MARKER_TACTICS.find((t) => t.name === 'debate_synthesis');
    expect(entry).toBeDefined();
    expect(entry?.label).toBe('Debate-Synthesis');
    expect(entry?.agent_type).toBe('debate_then_generate_from_previous_article');
    expect(entry?.category).toBe('meta');
  });
});

describe('getTacticDef vs MARKER_TACTICS (load-bearing invariant)', () => {
  it('getTacticDef("criteria_driven") returns undefined (marker, not prompt-driving)', () => {
    expect(getTacticDef('criteria_driven')).toBeUndefined();
  });

  it('getTacticDef("debate_synthesis") returns undefined (marker, not prompt-driving)', () => {
    expect(getTacticDef('debate_synthesis')).toBeUndefined();
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
