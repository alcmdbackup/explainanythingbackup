// Unit tests for budget redistribution and agent validation utilities.

import {
  computeEffectiveBudgetCaps,
  validateAgentSelection,
  enabledAgentsSchema,
  REQUIRED_AGENTS,
  OPTIONAL_AGENTS,
} from './budgetRedistribution';

/** Default budget caps matching DEFAULT_EVOLUTION_CONFIG.budgetCaps. */
const DEFAULT_CAPS: Record<string, number> = {
  generation: 0.20,
  calibration: 0.15,
  tournament: 0.20,
  evolution: 0.10,
  reflection: 0.05,
  debate: 0.05,
  iterativeEditing: 0.05,
  treeSearch: 0.10,
  outlineGeneration: 0.10,
  sectionDecomposition: 0.10,
  flowCritique: 0.05,
};

const DEFAULT_SUM = Object.values(DEFAULT_CAPS).reduce((a, b) => a + b, 0); // 1.15

describe('computeEffectiveBudgetCaps', () => {
  it('returns defaultCaps unchanged when enabledAgents undefined and singleArticle false', () => {
    const result = computeEffectiveBudgetCaps(DEFAULT_CAPS, undefined, false);
    expect(result).toEqual(DEFAULT_CAPS);
    // Should be a shallow copy, not same reference
    expect(result).not.toBe(DEFAULT_CAPS);
  });

  it('preserves original managed sum when some agents disabled', () => {
    const result = computeEffectiveBudgetCaps(
      DEFAULT_CAPS,
      ['reflection', 'debate'],  // only 2 optional agents enabled
      false,
    );
    const managedSum = Object.values(result).reduce((sum, v) => sum + v, 0);
    // Should preserve the original managed sum (all agents are now managed)
    expect(managedSum).toBeCloseTo(DEFAULT_SUM, 10);
  });

  it('removes disabled optional agents from result', () => {
    const result = computeEffectiveBudgetCaps(
      DEFAULT_CAPS,
      ['reflection'],  // only reflection enabled
      false,
    );
    expect(result).not.toHaveProperty('debate');
    expect(result).not.toHaveProperty('evolution');
    expect(result).not.toHaveProperty('iterativeEditing');
    // Required agents always present
    expect(result).toHaveProperty('generation');
    expect(result).toHaveProperty('calibration');
    expect(result).toHaveProperty('tournament');
    // Enabled optional agent present
    expect(result).toHaveProperty('reflection');
  });

  it('keeps required agents even with empty enabledAgents array', () => {
    const result = computeEffectiveBudgetCaps(DEFAULT_CAPS, [], false);
    expect(Object.keys(result)).toContain('generation');
    expect(Object.keys(result)).toContain('calibration');
    expect(Object.keys(result)).toContain('tournament');
    // flowCritique is now managed — excluded when not in enabledAgents
    expect(Object.keys(result)).not.toContain('flowCritique');
  });

  it('single-article mode removes generation/outline/evolution', () => {
    const result = computeEffectiveBudgetCaps(DEFAULT_CAPS, undefined, true);
    expect(result).not.toHaveProperty('generation');
    expect(result).not.toHaveProperty('outlineGeneration');
    expect(result).not.toHaveProperty('evolution');
    // Other agents still present
    expect(result).toHaveProperty('calibration');
    expect(result).toHaveProperty('reflection');
  });

  it('single-article + custom enabledAgents applies both filters', () => {
    const result = computeEffectiveBudgetCaps(
      DEFAULT_CAPS,
      ['reflection', 'generation'],  // generation listed but overridden by single-article
      true,
    );
    expect(result).not.toHaveProperty('generation');
    expect(result).toHaveProperty('reflection');
    expect(result).toHaveProperty('calibration');
  });

  it('excludes flowCritique when not in enabledAgents', () => {
    const result = computeEffectiveBudgetCaps(DEFAULT_CAPS, ['reflection'], false);
    expect(result).not.toHaveProperty('flowCritique');
  });

  it('includes flowCritique when in enabledAgents', () => {
    const result = computeEffectiveBudgetCaps(DEFAULT_CAPS, ['reflection', 'flowCritique'], false);
    expect(result).toHaveProperty('flowCritique');
    // Should be scaled up proportionally
    expect(result.flowCritique).toBeGreaterThan(DEFAULT_CAPS.flowCritique);
  });

  it('passes through unmanaged agents unchanged', () => {
    const capsWithCustom = { ...DEFAULT_CAPS, customAgent: 0.08 };
    const result = computeEffectiveBudgetCaps(capsWithCustom, ['reflection'], false);
    expect(result.customAgent).toBe(0.08);
  });

  it('scales up proportionally so active managed agents preserve original sum', () => {
    // Disable evolution (0.10) — remaining managed should scale up
    const result = computeEffectiveBudgetCaps(
      DEFAULT_CAPS,
      OPTIONAL_AGENTS.filter(a => a !== 'evolution') as any,
      false,
    );
    const managedSum = Object.values(result).reduce((sum, v) => sum + v, 0);
    expect(managedSum).toBeCloseTo(DEFAULT_SUM, 10);
    // Each agent should be scaled up
    expect(result.generation).toBeGreaterThan(DEFAULT_CAPS.generation);
  });
});

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
});
