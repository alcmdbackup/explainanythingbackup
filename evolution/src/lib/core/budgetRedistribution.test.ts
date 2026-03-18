// Tests for budgetRedistribution: agent selection validation, required/optional agents, budget logic.

import type { AgentName } from '../types';
import {
  REQUIRED_AGENTS,
  OPTIONAL_AGENTS,
  SINGLE_ARTICLE_DISABLED,
  AGENT_DEPENDENCIES,
  enabledAgentsSchema,
  validateAgentSelection,
} from './budgetRedistribution';

describe('budgetRedistribution', () => {
  // ─── Constants ──────────────────────────────────────────────────

  test('REQUIRED_AGENTS contains generation, ranking, proximity', () => {
    expect(REQUIRED_AGENTS).toContain('generation');
    expect(REQUIRED_AGENTS).toContain('ranking');
    expect(REQUIRED_AGENTS).toContain('proximity');
    expect(REQUIRED_AGENTS).toHaveLength(3);
  });

  test('OPTIONAL_AGENTS contains expected toggleable agents', () => {
    expect(OPTIONAL_AGENTS).toContain('reflection');
    expect(OPTIONAL_AGENTS).toContain('iterativeEditing');
    expect(OPTIONAL_AGENTS).toContain('treeSearch');
    expect(OPTIONAL_AGENTS).toContain('evolution');
    expect(OPTIONAL_AGENTS).toContain('debate');
    expect(OPTIONAL_AGENTS.length).toBeGreaterThanOrEqual(6);
  });

  test('REQUIRED and OPTIONAL agents do not overlap', () => {
    const overlap = REQUIRED_AGENTS.filter(a => OPTIONAL_AGENTS.includes(a));
    expect(overlap).toHaveLength(0);
  });

  test('SINGLE_ARTICLE_DISABLED lists agents disabled in single-article mode', () => {
    expect(SINGLE_ARTICLE_DISABLED).toContain('generation');
    expect(SINGLE_ARTICLE_DISABLED).toContain('outlineGeneration');
    expect(SINGLE_ARTICLE_DISABLED).toContain('evolution');
  });

  // ─── validateAgentSelection ─────────────────────────────────────

  test('returns no errors for empty enabledAgents', () => {
    expect(validateAgentSelection([])).toEqual([]);
  });

  test('returns no errors when all dependencies are satisfied', () => {
    const agents: AgentName[] = ['reflection', 'iterativeEditing', 'treeSearch'];
    expect(validateAgentSelection(agents)).toEqual([]);
  });

  test('returns error when iterativeEditing enabled without reflection', () => {
    const errors = validateAgentSelection(['iterativeEditing'] as AgentName[]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/iterativeEditing requires reflection/);
  });

  test('returns error for each unsatisfied dependency', () => {
    const agents: AgentName[] = ['iterativeEditing', 'treeSearch', 'sectionDecomposition', 'flowCritique'];
    const errors = validateAgentSelection(agents);
    // All four depend on reflection which is missing
    expect(errors).toHaveLength(4);
    errors.forEach(e => expect(e).toContain('reflection'));
  });

  test('does not flag dependencies on REQUIRED agents (e.g. evolution->ranking)', () => {
    // evolution depends on ranking, but ranking is REQUIRED so no error
    const errors = validateAgentSelection(['evolution'] as AgentName[]);
    expect(errors).toEqual([]);
  });

  test('does not flag metaReview since its dependency (ranking) is required', () => {
    const errors = validateAgentSelection(['metaReview'] as AgentName[]);
    expect(errors).toEqual([]);
  });

  // ─── enabledAgentsSchema (Zod) ─────────────────────────────────

  test('schema accepts valid optional agent list', () => {
    const result = enabledAgentsSchema.safeParse(['reflection', 'debate']);
    expect(result.success).toBe(true);
  });

  test('schema rejects unknown agent names', () => {
    const result = enabledAgentsSchema.safeParse(['nonexistentAgent']);
    expect(result.success).toBe(false);
  });

  test('schema accepts undefined (optional field)', () => {
    const result = enabledAgentsSchema.safeParse(undefined);
    expect(result.success).toBe(true);
  });
});
