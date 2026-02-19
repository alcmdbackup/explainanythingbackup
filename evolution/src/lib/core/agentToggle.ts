// Pure utility for toggling agents with dependency enforcement.
// Extracted from strategy form to enable unit testing without React.

import type { AgentName } from './pipeline';
import { REQUIRED_AGENTS, AGENT_DEPENDENCIES } from './budgetRedistribution';

/**
 * Toggle an agent on/off, enforcing dependency auto-enable and
 * dependent auto-disable.
 * Returns a new array (does not mutate input).
 */
export function toggleAgent(current: string[], agent: string): string[] {
  const enabled = new Set(current);

  if (enabled.has(agent)) {
    enabled.delete(agent);
    // Also remove agents that depend on this one
    for (const [dependent, deps] of Object.entries(AGENT_DEPENDENCIES)) {
      if (deps?.includes(agent as AgentName) && enabled.has(dependent)) {
        enabled.delete(dependent);
      }
    }
  } else {
    enabled.add(agent);
    // Auto-enable dependencies
    const deps = AGENT_DEPENDENCIES[agent as keyof typeof AGENT_DEPENDENCIES];
    if (deps) {
      for (const dep of deps) {
        if (!REQUIRED_AGENTS.includes(dep as AgentName)) {
          enabled.add(dep);
        }
      }
    }
  }

  return [...enabled];
}
