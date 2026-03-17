// Agent classification, dependency validation, and selection utilities.
// Per-agent budget redistribution has been removed — only global budget enforcement remains.

import type { AgentName } from '../types';
import { z } from 'zod';

// ─── Agent classification ───────────────────────────────────────

/** Agents that always run — UI shows locked checkboxes, isEnabled() always returns true. */
export const REQUIRED_AGENTS: readonly AgentName[] = [
  'generation', 'ranking', 'proximity',
];

/** Agents the user can toggle on/off per strategy. */
export const OPTIONAL_AGENTS: readonly AgentName[] = [
  'reflection', 'iterativeEditing', 'treeSearch',
  'sectionDecomposition', 'debate', 'evolution',
  'outlineGeneration', 'metaReview', 'flowCritique',
];

/** Agents auto-disabled in single-article mode (matches supervisor getPhaseConfig). */
export const SINGLE_ARTICLE_DISABLED: readonly AgentName[] = [
  'generation', 'outlineGeneration', 'evolution',
];

// ─── Agent dependencies and mutual exclusivity ──────────────────

/** If key is enabled, all deps must also be enabled. */
export const AGENT_DEPENDENCIES: Partial<Record<AgentName, AgentName[]>> = {
  iterativeEditing: ['reflection'],
  treeSearch: ['reflection'],
  sectionDecomposition: ['reflection'],
  flowCritique: ['reflection'],
  evolution: ['ranking'],   // ranking is REQUIRED, so always satisfied
  metaReview: ['ranking'],  // ranking is REQUIRED, so always satisfied
};

// ─── Zod validation ─────────────────────────────────────────────

/**
 * Zod schema for validating enabledAgents input from DB/API.
 *
 * enabledAgents contains ONLY the OPTIONAL agents the user chose to enable.
 * REQUIRED_AGENTS are implicit — always enabled by isEnabled().
 * The enum accepts both required and optional names for forward compatibility,
 * but the UI only stores optional agent names.
 */
export const enabledAgentsSchema = z.array(
  z.enum([...REQUIRED_AGENTS, ...OPTIONAL_AGENTS] as [string, ...string[]])
).max(20).optional();

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

  return errors;
}
