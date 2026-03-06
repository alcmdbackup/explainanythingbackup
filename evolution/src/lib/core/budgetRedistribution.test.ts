// Unit tests for budget redistribution and agent validation utilities.

import {
  validateAgentSelection,
  enabledAgentsSchema,
  REQUIRED_AGENTS,
  OPTIONAL_AGENTS,
} from './budgetRedistribution';

describe('validateAgentSelection', () => {
  it('returns empty errors for valid selection', () => {
    const errors = validateAgentSelection(['reflection', 'iterativeEditing']);
    expect(errors).toEqual([]);
  });

  it('returns error when iterativeEditing enabled without reflection', () => {
    const errors = validateAgentSelection(['iterativeEditing']);
    expect(errors).toContainEqual(expect.stringContaining('iterativeEditing requires reflection'));
  });

  it('returns error when treeSearch enabled without reflection', () => {
    const errors = validateAgentSelection(['treeSearch']);
    expect(errors).toContainEqual(expect.stringContaining('treeSearch requires reflection'));
  });

  it('allows treeSearch and iterativeEditing together (mutex removed)', () => {
    const errors = validateAgentSelection(['reflection', 'treeSearch', 'iterativeEditing']);
    expect(errors).toEqual([]);
  });

  it('returns empty errors for empty array (no optional agents)', () => {
    const errors = validateAgentSelection([]);
    expect(errors).toEqual([]);
  });

  it('no error for evolution depending on tournament (REQUIRED, always satisfied)', () => {
    const errors = validateAgentSelection(['evolution']);
    expect(errors).toEqual([]);
  });

  it('returns multiple errors for multiple dependency violations', () => {
    const errors = validateAgentSelection(['iterativeEditing', 'treeSearch']);
    // iterativeEditing requires reflection + treeSearch requires reflection (no mutex)
    expect(errors.length).toBe(2);
    expect(errors).toContainEqual(expect.stringContaining('iterativeEditing requires reflection'));
    expect(errors).toContainEqual(expect.stringContaining('treeSearch requires reflection'));
  });

  it('returns error when flowCritique enabled without reflection', () => {
    const errors = validateAgentSelection(['flowCritique']);
    expect(errors).toContainEqual(expect.stringContaining('flowCritique requires reflection'));
  });

  it('accepts flowCritique with reflection enabled', () => {
    const errors = validateAgentSelection(['reflection', 'flowCritique']);
    expect(errors).toEqual([]);
  });
});

describe('enabledAgentsSchema', () => {
  it('accepts valid agent names', () => {
    const result = enabledAgentsSchema.safeParse(['reflection', 'debate']);
    expect(result.success).toBe(true);
  });

  it('accepts undefined (optional)', () => {
    const result = enabledAgentsSchema.safeParse(undefined);
    expect(result.success).toBe(true);
  });

  it('rejects unknown agent names', () => {
    const result = enabledAgentsSchema.safeParse(['reflection', 'unknownAgent']);
    expect(result.success).toBe(false);
  });

  it('rejects non-array input', () => {
    const result = enabledAgentsSchema.safeParse('reflection');
    expect(result.success).toBe(false);
  });

  it('rejects arrays exceeding max length', () => {
    const oversized = Array(21).fill('reflection');
    const result = enabledAgentsSchema.safeParse(oversized);
    expect(result.success).toBe(false);
  });

  it('accepts empty array', () => {
    const result = enabledAgentsSchema.safeParse([]);
    expect(result.success).toBe(true);
  });

  it('accepts flowCritique (now a managed agent)', () => {
    const result = enabledAgentsSchema.safeParse(['flowCritique']);
    expect(result.success).toBe(true);
  });
});

describe('agent classification constants', () => {
  it('REQUIRED_AGENTS and OPTIONAL_AGENTS have no overlap', () => {
    const overlap = REQUIRED_AGENTS.filter(a => OPTIONAL_AGENTS.includes(a));
    expect(overlap).toEqual([]);
  });

  it('all agents are accounted for', () => {
    const all = new Set([...REQUIRED_AGENTS, ...OPTIONAL_AGENTS]);
    // Should have 13 managed agents total (including flowCritique)
    expect(all.size).toBe(13);
  });

  it('pairwise is NOT a managed agent (costs route through tournament/calibration overrides)', () => {
    const allManaged = [...REQUIRED_AGENTS, ...OPTIONAL_AGENTS];
    expect(allManaged).not.toContain('pairwise');
  });
});
