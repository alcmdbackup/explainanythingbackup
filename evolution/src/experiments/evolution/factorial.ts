// L8 orthogonal array generation and factor-to-pipeline-config mapping.
// Generates Taguchi fractional factorial designs for systematic strategy experimentation.

import type { AgentName } from '@evolution/lib/types';
import { OPTIONAL_AGENTS } from '@evolution/lib/core/budgetRedistribution';

// ─── Types ────────────────────────────────────────────────────────

export interface FactorDefinition {
  name: string;
  label: string;
  low: string | number;
  high: string | number;
}

/** A single row in an L8 orthogonal array — values are -1 (low) or +1 (high). */
export type L8Row = [number, number, number, number, number, number, number];

/** Factor assignment: which column maps to which factor. */
export interface FactorAssignment {
  column: number;
  factor: FactorDefinition;
}

/** A concrete experiment run config derived from one L8 row. */
export interface ExperimentRunConfig {
  row: number;
  factors: Record<string, string | number>;
  pipelineArgs: {
    model: string;
    judgeModel: string;
    iterations: number;
    enabledAgents: string[];
  };
}

/** Full experiment design for a round. */
export interface ExperimentDesign {
  type: 'L8';
  factors: Record<string, FactorDefinition>;
  matrix: L8Row[];
  assignments: FactorAssignment[];
  runs: ExperimentRunConfig[];
  interactionColumns: { label: string; column: number }[];
}

// ─── L8 Orthogonal Array ──────────────────────────────────────────

/**
 * Standard Taguchi L8(2^7) orthogonal array.
 * 8 rows × 7 columns, each value ±1.
 * Columns 1-5 assigned to factors A-E.
 * Columns 6-7 estimate interactions (A×C and A×E by default).
 */
export const L8_ARRAY: readonly L8Row[] = [
  [-1, -1, -1, -1, -1, -1, -1],
  [-1, -1,  1, -1,  1,  1,  1],
  [-1,  1, -1,  1,  1,  1, -1],
  [-1,  1,  1,  1, -1, -1,  1],
  [ 1, -1, -1,  1,  1, -1,  1],
  [ 1, -1,  1,  1, -1,  1, -1],
  [ 1,  1, -1, -1, -1,  1,  1],
  [ 1,  1,  1, -1,  1, -1, -1],
];

// ─── Default Round 1 Factors ──────────────────────────────────────

/** Support agents toggled by Factor E. Reflection is always included (dependency). */
const SUPPORT_AGENTS_ON: AgentName[] = [
  'reflection', 'debate', 'evolution', 'sectionDecomposition', 'metaReview',
];

export const DEFAULT_ROUND1_FACTORS: Record<string, FactorDefinition> = {
  A: { name: 'genModel', label: 'Generation Model', low: 'deepseek-chat', high: 'gpt-5-mini' },
  B: { name: 'judgeModel', label: 'Judge Model', low: 'gpt-4.1-nano', high: 'gpt-5-nano' },
  C: { name: 'iterations', label: 'Iterations', low: 3, high: 8 },
  D: { name: 'editor', label: 'Editing Approach', low: 'iterativeEditing', high: 'treeSearch' },
  E: { name: 'supportAgents', label: 'Support Agents', low: 'off', high: 'on' },
};

// ─── Design Generation ───────────────────────────────────────────

/**
 * Build an L8 experiment design from factor definitions.
 * Assigns factors A-E to columns 1-5 and maps each row to concrete pipeline args.
 */
export function generateL8Design(
  factors: Record<string, FactorDefinition> = DEFAULT_ROUND1_FACTORS,
): ExperimentDesign {
  const factorKeys = Object.keys(factors);
  if (factorKeys.length > 7) {
    throw new Error(`L8 supports at most 7 factors, got ${factorKeys.length}`);
  }

  const assignments: FactorAssignment[] = factorKeys.map((key, i) => ({
    column: i,
    factor: factors[key],
  }));

  const runs: ExperimentRunConfig[] = L8_ARRAY.map((row, rowIdx) => {
    const resolvedFactors: Record<string, string | number> = {};
    for (let i = 0; i < factorKeys.length; i++) {
      const factor = factors[factorKeys[i]];
      resolvedFactors[factor.name] = row[i] === -1 ? factor.low : factor.high;
    }
    return {
      row: rowIdx + 1,
      factors: resolvedFactors,
      pipelineArgs: mapFactorsToPipelineArgs(resolvedFactors),
    };
  });

  const interactionColumns = [
    { label: 'A×C', column: 5 },
    { label: 'A×E', column: 6 },
  ].filter((ic) => ic.column >= factorKeys.length); // Only report unassigned columns

  return {
    type: 'L8',
    factors,
    matrix: [...L8_ARRAY],
    assignments,
    runs,
    interactionColumns,
  };
}

// ─── Factor → Pipeline Args Mapping ──────────────────────────────

/**
 * Map resolved factor values to concrete pipeline CLI arguments.
 * Handles the enabledAgents dependency logic (reflection always included).
 */
export function mapFactorsToPipelineArgs(
  factors: Record<string, string | number>,
): ExperimentRunConfig['pipelineArgs'] {
  const editor = String(factors.editor ?? 'iterativeEditing');
  const supportOn = factors.supportAgents === 'on';

  // Reflection is always included (dependency of both editing approaches)
  const enabledAgents: string[] = supportOn
    ? [editor, ...SUPPORT_AGENTS_ON]
    : [editor, 'reflection'];

  // Validate all agent names against known optional agents
  const knownAgents = new Set<string>(OPTIONAL_AGENTS as readonly string[]);
  const unknown = enabledAgents.filter((a) => !knownAgents.has(a));
  if (unknown.length > 0) {
    throw new Error(`Unknown agent name(s): ${unknown.join(', ')}. Valid: ${[...knownAgents].join(', ')}`);
  }

  return {
    model: String(factors.genModel ?? 'deepseek-chat'),
    judgeModel: String(factors.judgeModel ?? 'gpt-4.1-nano'),
    iterations: Number(factors.iterations ?? 3),
    enabledAgents,
  };
}

// ─── Orthogonality Verification ──────────────────────────────────

/**
 * Verify that two columns of an L8 array are orthogonal (dot product = 0).
 * Used in tests to confirm the design's statistical properties.
 */
export function verifyOrthogonality(matrix: readonly L8Row[], col1: number, col2: number): boolean {
  if (col1 === col2) return false;
  let dotProduct = 0;
  for (const row of matrix) {
    dotProduct += row[col1] * row[col2];
  }
  return dotProduct === 0;
}

/**
 * Verify all column pairs in the L8 array are orthogonal.
 */
export function verifyFullOrthogonality(matrix: readonly L8Row[]): boolean {
  const numCols = matrix[0]?.length ?? 0;
  for (let i = 0; i < numCols; i++) {
    for (let j = i + 1; j < numCols; j++) {
      if (!verifyOrthogonality(matrix, i, j)) return false;
    }
  }
  return true;
}

// ─── Arbitrary Factorial Design (for Round 2+) ───────────────────

export interface MultiLevelFactor {
  name: string;
  label: string;
  levels: (string | number)[];
}

/**
 * Generate a full factorial design from multi-level factors.
 * Used for Round 2+ when specific factors are varied at 3+ levels.
 */
export function generateFullFactorial(
  factors: MultiLevelFactor[],
): Record<string, string | number>[] {
  if (factors.length === 0) return [{}];

  const [first, ...rest] = factors;
  const subDesign = generateFullFactorial(rest);

  const result: Record<string, string | number>[] = [];
  for (const level of first.levels) {
    for (const sub of subDesign) {
      result.push({ [first.name]: level, ...sub });
    }
  }
  return result;
}
