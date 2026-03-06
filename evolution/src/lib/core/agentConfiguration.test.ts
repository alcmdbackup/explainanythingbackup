// Unit tests for centralized agent configuration — selection, ordering, validation, and toggle logic.

import {
  REQUIRED_AGENTS,
  OPTIONAL_AGENTS,
  SINGLE_ARTICLE_DISABLED,
  AGENT_DEPENDENCIES,
  AGENT_EXECUTION_ORDER,
  EXPANSION_ALLOWED_AGENTS,
  isAgentActive,
  getActiveAgents,
  validateAgentSelection,
  toggleAgent,
} from './agentConfiguration';

describe('isAgentActive', () => {
  it('required agents are always active', () => {
    for (const agent of REQUIRED_AGENTS) {
      expect(isAgentActive(agent, [], false)).toBe(true);
    }
  });

  it('required agents disabled by singleArticle when in SINGLE_ARTICLE_DISABLED', () => {
    for (const agent of SINGLE_ARTICLE_DISABLED) {
      expect(isAgentActive(agent, undefined, true)).toBe(false);
    }
  });

  it('optional agents active when enabledAgents is undefined (backward compat)', () => {
    for (const agent of OPTIONAL_AGENTS) {
      expect(isAgentActive(agent, undefined, false)).toBe(true);
    }
  });

  it('optional agents active only when in enabledAgents list', () => {
    expect(isAgentActive('reflection', ['reflection'], false)).toBe(true);
    expect(isAgentActive('reflection', ['debate'], false)).toBe(false);
  });
});

describe('getActiveAgents', () => {
  it('EXPANSION phase only includes EXPANSION_ALLOWED + ranking', () => {
    const agents = getActiveAgents('EXPANSION', undefined, false);
    for (const agent of agents) {
      if (agent === 'ranking') continue;
      expect(EXPANSION_ALLOWED_AGENTS.has(agent)).toBe(true);
    }
  });

  it('COMPETITION phase includes all enabled agents', () => {
    const agents = getActiveAgents('COMPETITION', undefined, false);
    expect(agents.length).toBeGreaterThan(3);
    expect(agents).toContain('ranking');
    expect(agents).toContain('reflection');
  });

  it('respects enabledAgents filter', () => {
    const agents = getActiveAgents('COMPETITION', ['reflection'], false);
    expect(agents).toContain('reflection');
    expect(agents).not.toContain('debate');
    // Required agents always present
    expect(agents).toContain('proximity');
  });

  it('respects singleArticle mode', () => {
    const agents = getActiveAgents('COMPETITION', undefined, true);
    for (const disabled of SINGLE_ARTICLE_DISABLED) {
      expect(agents).not.toContain(disabled);
    }
  });

  it('preserves AGENT_EXECUTION_ORDER ordering', () => {
    const agents = getActiveAgents('COMPETITION', undefined, false);
    for (let i = 0; i < agents.length - 1; i++) {
      const idxA = AGENT_EXECUTION_ORDER.indexOf(agents[i]);
      const idxB = AGENT_EXECUTION_ORDER.indexOf(agents[i + 1]);
      expect(idxA).toBeLessThan(idxB);
    }
  });
});

describe('validateAgentSelection', () => {
  it('returns empty for valid selection', () => {
    expect(validateAgentSelection(['reflection', 'iterativeEditing'])).toEqual([]);
  });

  it('reports missing dependency', () => {
    const errors = validateAgentSelection(['iterativeEditing']);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('reflection');
  });

  it('does not report dependency on required agents', () => {
    // evolution depends on tournament (required), should not error
    const errors = validateAgentSelection(['evolution']);
    expect(errors).toEqual([]);
  });
});

describe('toggleAgent', () => {
  it('enables agent and its dependencies', () => {
    const result = toggleAgent([], 'iterativeEditing');
    expect(result).toContain('iterativeEditing');
    expect(result).toContain('reflection');
  });

  it('disables agent and its dependents', () => {
    const result = toggleAgent(['reflection', 'iterativeEditing', 'treeSearch'], 'reflection');
    expect(result).not.toContain('reflection');
    expect(result).not.toContain('iterativeEditing');
    expect(result).not.toContain('treeSearch');
  });

  it('does not auto-enable required dependencies', () => {
    // evolution depends on tournament (required) — should not appear in result
    const result = toggleAgent([], 'evolution');
    expect(result).toContain('evolution');
    expect(result).not.toContain('tournament');
  });
});

describe('constants consistency', () => {
  it('SINGLE_ARTICLE_DISABLED agents are a subset of REQUIRED + OPTIONAL', () => {
    const all = new Set([...REQUIRED_AGENTS, ...OPTIONAL_AGENTS]);
    for (const agent of SINGLE_ARTICLE_DISABLED) {
      expect(all.has(agent)).toBe(true);
    }
  });

  it('AGENT_DEPENDENCIES keys are valid agent names', () => {
    const all = new Set([...REQUIRED_AGENTS, ...OPTIONAL_AGENTS]);
    for (const key of Object.keys(AGENT_DEPENDENCIES)) {
      expect(all.has(key as never)).toBe(true);
    }
  });
});
