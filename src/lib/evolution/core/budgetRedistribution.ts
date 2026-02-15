// Budget redistribution and agent validation utilities for per-strategy agent selection.
// Handles proportional budget scaling when agents are disabled and dependency/mutex validation.

import type { AgentName } from './pipeline';
import { z } from 'zod';

// ─── Agent classification ───────────────────────────────────────

/** Agents that always run — UI shows locked checkboxes, isEnabled() always returns true. */
export const REQUIRED_AGENTS: readonly AgentName[] = [
  'generation', 'calibration', 'tournament', 'proximity',
];

/** Agents the user can toggle on/off per strategy. */
export const OPTIONAL_AGENTS: readonly AgentName[] = [
  'reflection', 'iterativeEditing', 'treeSearch',
  'sectionDecomposition', 'debate', 'evolution',
  'outlineGeneration', 'metaReview',
];
// Note: flowCritique excluded — uses different gating pattern (opt-in feature flag, not PipelineAgent)

/** All agents managed by enabledAgents (subject to redistribution filtering). */
const MANAGED_AGENTS = new Set<string>([
  ...REQUIRED_AGENTS,
  ...OPTIONAL_AGENTS,
]);

/** Agents auto-disabled in single-article mode (matches supervisor getPhaseConfig). */
const SINGLE_ARTICLE_DISABLED: readonly AgentName[] = [
  'generation', 'outlineGeneration', 'evolution',
];

// ─── Agent dependencies and mutual exclusivity ──────────────────

/** If key is enabled, all deps must also be enabled. */
export const AGENT_DEPENDENCIES: Partial<Record<AgentName, AgentName[]>> = {
  iterativeEditing: ['reflection'],
  treeSearch: ['reflection'],
  sectionDecomposition: ['reflection'],
  evolution: ['tournament'],   // tournament is REQUIRED, so always satisfied
  metaReview: ['tournament'],  // tournament is REQUIRED, so always satisfied
};

/** Pairs of agents that cannot both be enabled. */
export const MUTEX_AGENTS: [AgentName, AgentName][] = [
  ['treeSearch', 'iterativeEditing'],
];

// ─── Zod validation ─────────────────────────────────────────────

/**
 * Zod schema for validating enabledAgents input from DB/API.
 *
 * enabledAgents contains ONLY the OPTIONAL agents the user chose to enable.
 * REQUIRED_AGENTS are implicit — always enabled by isEnabled() and computeEffectiveBudgetCaps().
 * The enum accepts both required and optional names for forward compatibility,
 * but the UI only stores optional agent names.
 */
export const enabledAgentsSchema = z.array(
  z.enum([...REQUIRED_AGENTS, ...OPTIONAL_AGENTS] as [string, ...string[]])
).max(20).optional();

// ─── Budget redistribution ──────────────────────────────────────

/**
 * Compute effective budget caps by removing disabled agents and
 * scaling up remaining agents proportionally to preserve the original managed sum.
 *
 * When enabledAgents is undefined (backward compat), returns defaultCaps unchanged.
 *
 * Agents NOT in MANAGED_AGENTS (e.g. flowCritique) are passed through unchanged —
 * they have their own gating pattern and shouldn't be affected by enabledAgents.
 */
export function computeEffectiveBudgetCaps(
  defaultCaps: Record<string, number>,
  enabledAgents: AgentName[] | undefined,
  singleArticle: boolean,
): Record<string, number> {
  // Backward compat: undefined = all agents enabled, no redistribution
  if (!enabledAgents && !singleArticle) return { ...defaultCaps };

  // Separate managed agents (subject to enabledAgents) from unmanaged (pass-through)
  const managedCaps: Record<string, number> = {};
  const unmanagedCaps: Record<string, number> = {};
  for (const [agent, cap] of Object.entries(defaultCaps)) {
    if (MANAGED_AGENTS.has(agent)) managedCaps[agent] = cap;
    else unmanagedCaps[agent] = cap;  // e.g. flowCritique — kept unchanged
  }

  const originalManagedSum = Object.values(managedCaps).reduce((a, b) => a + b, 0);

  // Determine active agents: required agents always active, optional subject to enabledAgents
  let activeAgents = Object.keys(managedCaps);
  const enabledSet = enabledAgents ? new Set<string>(enabledAgents) : null;
  const disabledInSingleArticle = singleArticle ? new Set<string>(SINGLE_ARTICLE_DISABLED) : null;

  activeAgents = activeAgents.filter(a => {
    const isRequired = REQUIRED_AGENTS.includes(a as AgentName);
    const isEnabledIfOptional = !enabledSet || enabledSet.has(a);
    const isNotDisabledForMode = !disabledInSingleArticle || !disabledInSingleArticle.has(a);
    return (isRequired || isEnabledIfOptional) && isNotDisabledForMode;
  });

  // Filter caps to active agents only
  const activeCaps: Record<string, number> = {};
  for (const agent of activeAgents) {
    if (agent in managedCaps) activeCaps[agent] = managedCaps[agent];
  }

  // Scale up proportionally to preserve original managed sum
  const remainingSum = Object.values(activeCaps).reduce((a, b) => a + b, 0);
  // COST-3: Handle empty enabledAgents (no active caps to scale)
  if (remainingSum === 0) return { ...activeCaps, ...unmanagedCaps };

  const scaleFactor = originalManagedSum / remainingSum;
  const result: Record<string, number> = {};
  for (const [agent, cap] of Object.entries(activeCaps)) {
    result[agent] = cap * scaleFactor;
  }

  // COST-3: Assert scaled sum ≈ originalManagedSum (within floating-point epsilon)
  const scaledSum = Object.values(result).reduce((a, b) => a + b, 0);
  if (Math.abs(scaledSum - originalManagedSum) > 1e-9) {
    // Log but don't throw — numerical imprecision shouldn't crash the pipeline
    console.warn(`Budget redistribution sum drift: expected ${originalManagedSum}, got ${scaledSum}`);
  }

  // Merge back unmanaged agents (unchanged)
  return { ...result, ...unmanagedCaps };
}

// ─── Agent selection validation ─────────────────────────────────

/**
 * Validate agent dependencies and mutual exclusivity.
 * Returns list of validation errors (empty = valid).
 */
export function validateAgentSelection(enabledAgents: AgentName[]): string[] {
  const errors: string[] = [];
  const enabledSet = new Set<AgentName>(enabledAgents);

  // Check dependencies
  for (const agent of enabledAgents) {
    const deps = AGENT_DEPENDENCIES[agent];
    if (deps) {
      for (const dep of deps) {
        if (!enabledSet.has(dep) && !REQUIRED_AGENTS.includes(dep)) {
          errors.push(`${agent} requires ${dep} to be enabled`);
        }
      }
    }
  }

  // Check mutex
  for (const [a, b] of MUTEX_AGENTS) {
    if (enabledSet.has(a) && enabledSet.has(b)) {
      errors.push(`${a} and ${b} cannot both be enabled`);
    }
  }

  return errors;
}
