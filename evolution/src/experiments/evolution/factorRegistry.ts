// Centralized factor type registry for experiment design and UI population.
// Delegates to existing codebase sources — never maintains parallel valid-value lists.

import { allowedLLMModelSchema } from '@/lib/schemas/schemas';
import { getModelPricing } from '@/config/llmPricing';
import {
  OPTIONAL_AGENTS,
  AGENT_DEPENDENCIES,
  validateAgentSelection,
} from '@evolution/lib/core/budgetRedistribution';
import type { AgentName } from '@evolution/lib/types';

// ─── Types ────────────────────────────────────────────────────────

export type FactorType = 'model' | 'integer' | 'agent_set' | 'enum';

export interface FactorTypeDefinition {
  key: string;
  label: string;
  type: FactorType;
  getValidValues(): (string | number)[];
  orderValues(values: (string | number)[]): (string | number)[];
  expandAroundWinner(winner: string | number): (string | number)[];
  validate(value: string | number): boolean;
  estimateCostImpact(value: string | number): number;
}

// ─── Helpers ──────────────────────────────────────────────────────

/** Cheapest input price across all allowed models, used as cost-impact denominator. */
function getCheapestInputPrice(): number {
  const allowedModels = allowedLLMModelSchema.options;
  let min = Infinity;
  for (const model of allowedModels) {
    const pricing = getModelPricing(model);
    if (pricing.inputPer1M < min) min = pricing.inputPer1M;
  }
  return min > 0 ? min : 0.05; // fallback safety
}

/** Index-neighbor expansion: returns up to 3 unique values centered on winner. */
function expandByIndex(
  ordered: (string | number)[],
  winner: string | number,
): (string | number)[] {
  const idx = ordered.indexOf(winner);
  if (idx === -1) {
    // Winner not in list — bracket it with nearest neighbors
    if (typeof winner === 'number') {
      const lower = (ordered as number[]).filter(v => v < winner).pop() ?? winner;
      const upper = (ordered as number[]).find(v => v > winner) ?? winner;
      return [...new Set([lower, winner, upper])];
    }
    return [winner]; // Can't bracket strings meaningfully
  }
  const neighbors = [
    ordered[Math.max(0, idx - 1)],
    ordered[idx],
    ordered[Math.min(ordered.length - 1, idx + 1)],
  ];
  return [...new Set(neighbors)];
}

// ─── Model Factor ─────────────────────────────────────────────────

function createModelFactor(key: string, label: string): FactorTypeDefinition {
  return {
    key,
    label,
    type: 'model',
    getValidValues() {
      return [...allowedLLMModelSchema.options];
    },
    orderValues(values) {
      return [...values].sort((a, b) => {
        const pa = getModelPricing(String(a));
        const pb = getModelPricing(String(b));
        return pa.inputPer1M - pb.inputPer1M;
      });
    },
    expandAroundWinner(winner) {
      const ordered = this.orderValues([...this.getValidValues()]);
      return expandByIndex(ordered, winner);
    },
    validate(value) {
      return allowedLLMModelSchema.safeParse(value).success;
    },
    estimateCostImpact(value) {
      const pricing = getModelPricing(String(value));
      return pricing.inputPer1M / getCheapestInputPrice();
    },
  };
}

// ─── Iterations Factor ────────────────────────────────────────────

const ITERATION_LEVELS: readonly number[] = [2, 3, 5, 8, 10, 15, 20, 30];

const iterationsFactor: FactorTypeDefinition = {
  key: 'iterations',
  label: 'Iterations',
  type: 'integer',
  getValidValues() {
    return [...ITERATION_LEVELS];
  },
  orderValues(values) {
    return [...values].sort((a, b) => Number(a) - Number(b));
  },
  expandAroundWinner(winner) {
    return expandByIndex([...ITERATION_LEVELS], Number(winner));
  },
  validate(value) {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 && n <= 30;
  },
  estimateCostImpact(value) {
    // Cost scales roughly linearly with iterations; baseline = min iterations (2)
    return Number(value) / ITERATION_LEVELS[0];
  },
};

// ─── Agent Set Factor ─────────────────────────────────────────────

const agentSetFactor: FactorTypeDefinition = {
  key: 'supportAgents',
  label: 'Support Agents',
  type: 'agent_set',
  getValidValues() {
    return ['off', 'on'];
  },
  orderValues(values) {
    return [...values].sort((a, b) => (a === 'off' ? -1 : b === 'off' ? 1 : 0));
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  expandAroundWinner(_winner) {
    // Binary factor — always return both levels for refinement
    return ['off', 'on'];
  },
  validate(value) {
    if (value === 'off' || value === 'on') return true;
    // Also accept array of agent names for granular mode
    if (Array.isArray(value)) {
      return validateAgentSelection(value as AgentName[]).length === 0;
    }
    return false;
  },
  estimateCostImpact(value) {
    return value === 'on' ? 2.5 : 1.0; // agents roughly 2.5× cost
  },
};

// ─── Editor Factor ────────────────────────────────────────────────

const EDITOR_OPTIONS: readonly string[] = ['iterativeEditing', 'treeSearch'];

const editorFactor: FactorTypeDefinition = {
  key: 'editor',
  label: 'Editing Approach',
  type: 'enum',
  getValidValues() {
    return [...EDITOR_OPTIONS];
  },
  orderValues(values) {
    // iterativeEditing (cheaper) first
    return [...values].sort((a, b) => {
      const order = { iterativeEditing: 0, treeSearch: 1 };
      return (order[String(a) as keyof typeof order] ?? 99) -
             (order[String(b) as keyof typeof order] ?? 99);
    });
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  expandAroundWinner(_winner) {
    // Binary factor — always return both
    return [...EDITOR_OPTIONS];
  },
  validate(value) {
    return EDITOR_OPTIONS.includes(String(value));
  },
  estimateCostImpact(value) {
    return value === 'treeSearch' ? 1.5 : 1.0;
  },
};

// ─── Registry ─────────────────────────────────────────────────────

const entries: [string, FactorTypeDefinition][] = [
  ['genModel', createModelFactor('genModel', 'Generation Model')],
  ['judgeModel', createModelFactor('judgeModel', 'Judge Model')],
  ['iterations', iterationsFactor],
  ['supportAgents', agentSetFactor],
  ['editor', editorFactor],
];

/** Single source of truth for all factor metadata. Used by UI, validation, and round derivation. */
export const FACTOR_REGISTRY: ReadonlyMap<string, FactorTypeDefinition> = new Map(entries);

// Re-export for external use
export { OPTIONAL_AGENTS, AGENT_DEPENDENCIES, ITERATION_LEVELS, EDITOR_OPTIONS };
