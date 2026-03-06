// Single source of truth for agent classification, selection, ordering, and validation.
// Consolidates logic previously fragmented across supervisor.ts, budgetRedistribution.ts, costEstimator.ts, and agentToggle.ts.

import type { AgentName, PipelinePhase } from '../types';
import { z } from 'zod';

// ─── Agent classification ───────────────────────────────────────

/** Agents that always run — UI shows locked checkboxes, isEnabled() always returns true. */
export const REQUIRED_AGENTS: readonly AgentName[] = [
  'generation', 'calibration', 'tournament', 'proximity',
];
const REQUIRED_SET = new Set<string>(REQUIRED_AGENTS);

/** Agents the user can toggle on/off per strategy. */
export const OPTIONAL_AGENTS: readonly AgentName[] = [
  'reflection', 'iterativeEditing', 'treeSearch',
  'sectionDecomposition', 'debate', 'evolution',
  'outlineGeneration', 'metaReview', 'flowCritique',
];

/** Agents auto-disabled in single-article mode. */
export const SINGLE_ARTICLE_DISABLED: readonly AgentName[] = [
  'generation', 'outlineGeneration', 'evolution',
];
const SINGLE_ARTICLE_DISABLED_SET = new Set<string>(SINGLE_ARTICLE_DISABLED);

// ─── Agent dependencies ─────────────────────────────────────────

/** If key is enabled, all deps must also be enabled. */
export const AGENT_DEPENDENCIES: Partial<Record<AgentName, AgentName[]>> = {
  iterativeEditing: ['reflection'],
  treeSearch: ['reflection'],
  sectionDecomposition: ['reflection'],
  flowCritique: ['reflection'],
  evolution: ['tournament'],
  metaReview: ['tournament'],
};

// ─── Execution order ────────────────────────────────────────────

/** Agents or sentinels that can appear in the active list. */
export type ExecutableAgent = AgentName | 'ranking';

/**
 * Canonical execution order. Uses 'ranking' sentinel instead of separate
 * calibration/tournament entries — the pipeline dispatch swaps the actual
 * agent by phase (calibration in EXPANSION, tournament in COMPETITION).
 */
export const AGENT_EXECUTION_ORDER: ExecutableAgent[] = [
  'generation', 'outlineGeneration', 'reflection', 'flowCritique',
  'iterativeEditing', 'treeSearch', 'sectionDecomposition',
  'debate', 'evolution',
  'ranking',
  'proximity', 'metaReview',
];

/** Agents allowed during EXPANSION phase. */
export const EXPANSION_ALLOWED_AGENTS: Set<ExecutableAgent> = new Set([
  'generation', 'ranking', 'proximity',
]);

// ─── Agent selection functions ──────────────────────────────────

/**
 * Check if a single agent is active given the current config.
 * Used by costEstimator, supervisor, and anywhere else that needs agent filtering.
 */
export function isAgentActive(
  agentName: string,
  enabledAgents: readonly string[] | undefined,
  singleArticle: boolean,
): boolean {
  if (singleArticle && SINGLE_ARTICLE_DISABLED_SET.has(agentName)) return false;
  if (REQUIRED_SET.has(agentName)) return true;
  if (!enabledAgents) return true;
  return enabledAgents.includes(agentName);
}

/**
 * Compute the ordered list of agents to execute for a given phase.
 * Replaces multiple separate filtering functions with a single source of truth.
 */
export function getActiveAgents(
  phase: PipelinePhase,
  enabledAgents: readonly string[] | undefined,
  singleArticle: boolean,
): ExecutableAgent[] {
  return AGENT_EXECUTION_ORDER.filter(name => {
    if (name === 'ranking') return true;
    if (phase === 'EXPANSION' && !EXPANSION_ALLOWED_AGENTS.has(name)) return false;
    return isAgentActive(name, enabledAgents, singleArticle);
  });
}

// ─── Validation ─────────────────────────────────────────────────

/**
 * Zod schema for validating enabledAgents input from DB/API.
 */
export const enabledAgentsSchema = z.array(
  z.enum([...REQUIRED_AGENTS, ...OPTIONAL_AGENTS] as [string, ...string[]])
).max(20).optional();

/**
 * Validate agent dependencies. Returns list of errors (empty = valid).
 */
export function validateAgentSelection(enabledAgents: AgentName[]): string[] {
  const errors: string[] = [];
  const enabledSet = new Set<AgentName>(enabledAgents);

  for (const agent of enabledAgents) {
    const deps = AGENT_DEPENDENCIES[agent];
    if (!deps) continue;
    for (const dep of deps) {
      if (!enabledSet.has(dep) && !REQUIRED_SET.has(dep)) {
        errors.push(`${agent} requires ${dep} to be enabled`);
      }
    }
  }

  return errors;
}

// ─── Toggle utility ─────────────────────────────────────────────

/**
 * Toggle an agent on/off, enforcing dependency auto-enable and
 * dependent auto-disable. Returns a new array (does not mutate input).
 */
export function toggleAgent(current: string[], agent: string): string[] {
  const enabled = new Set(current);

  if (enabled.has(agent)) {
    enabled.delete(agent);
    // Auto-disable dependents that require this agent
    for (const [dependent, deps] of Object.entries(AGENT_DEPENDENCIES)) {
      if (deps?.includes(agent as AgentName) && enabled.has(dependent)) {
        enabled.delete(dependent);
      }
    }
  } else {
    enabled.add(agent);
    // Auto-enable dependencies (skip required agents — they're always active)
    const deps = AGENT_DEPENDENCIES[agent as keyof typeof AGENT_DEPENDENCIES];
    if (deps) {
      for (const dep of deps) {
        if (!REQUIRED_SET.has(dep)) {
          enabled.add(dep);
        }
      }
    }
  }

  return [...enabled];
}
