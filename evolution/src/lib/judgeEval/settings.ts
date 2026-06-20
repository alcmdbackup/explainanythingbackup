// Settings-key + prompt-variant hashing and the hard cost-ceiling guard for the
// judge-evaluation tool. The guard is the load-bearing blast-radius control: judge-eval
// has no per-user cap (only the guest user is capped), so a runaway sweep could drain the
// shared global evolution budget. assertWithinJudgeEvalCap() is called by BOTH the server
// action and the CLI before any LLM call. Pure except for process.env reads.

import { createHash } from 'crypto';
import type { JudgeKindFilter, JudgeReasoningEffort } from './schemas';

const BUILTIN_SENTINEL = '__builtin__';

/** sha256 of the custom rubric override (or a builtin sentinel). Mode-independent because a
 *  run may span both article + paragraph kinds; per-call comparison_mode is tracked on calls. */
export function buildPromptVariantHash(customPrompt?: string | null): string {
  const text = customPrompt?.trim() || BUILTIN_SENTINEL;
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

export interface SettingsKeyInput {
  judgeModel: string;
  temperature: number;
  reasoningEffort: JudgeReasoningEffort | null;
  promptVariantHash: string;
  kindFilter: JudgeKindFilter;
  testSetId: string;
}

/** Canonical idempotency key — same settings on the same test set collapse to one run. */
export function buildSettingsKey(i: SettingsKeyInput): string {
  const canonical = [
    i.judgeModel,
    i.temperature.toFixed(2),
    i.reasoningEffort ?? 'none',
    i.promptVariantHash,
    i.kindFilter,
    i.testSetId,
  ].join('|');
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

export interface EscalationSettingsKeyInput {
  /** Ordered judge models per mode (the chain composition). */
  chainModels: { article: string[]; paragraph: string[] };
  aggregationRule: string;
  aggregationRuleVersion: number;
  cap: number;
  temperature: number;
  reasoningEffort: JudgeReasoningEffort | null;
  promptVariantHash: string;
  kindFilter: JudgeKindFilter;
  testSetId: string;
}

/** Idempotency key for an ESCALATION sweep (chain + rule + version), distinct from single-judge keys
 *  (the `escalation` prefix guarantees no collision with a `buildSettingsKey` value). */
export function buildEscalationSettingsKey(i: EscalationSettingsKeyInput): string {
  const canonical = [
    'escalation',
    `${i.aggregationRule}@${i.aggregationRuleVersion}`,
    `cap${i.cap}`,
    i.chainModels.article.join(','),
    i.chainModels.paragraph.join(','),
    i.temperature.toFixed(2),
    i.reasoningEffort ?? 'none',
    i.promptVariantHash,
    i.kindFilter,
    i.testSetId,
  ].join('|');
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

export interface AgreementSettingsKeyInput {
  judgeModel: string;
  temperature: number;
  reasoningEffort: JudgeReasoningEffort | null;
  judgeRubricId: string;
  kindFilter: JudgeKindFilter;
  repeats: number;
  testSetId: string;
}

/** Idempotency key for an AGREEMENT sweep (holistic + rubric paired). The `agreement` prefix
 *  guarantees no collision with single-judge (`buildSettingsKey`) or escalation keys. */
export function buildAgreementSettingsKey(i: AgreementSettingsKeyInput): string {
  const canonical = [
    'agreement',
    i.judgeModel,
    i.temperature.toFixed(2),
    i.reasoningEffort ?? 'none',
    i.judgeRubricId,
    i.kindFilter,
    String(i.repeats),
    i.testSetId,
  ].join('|');
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

export interface CapInput {
  /** Distinct settings cells in the sweep (models × temps × reasoning × prompt variants). */
  cells: number;
  /** Test-set members that match the kind_filter. */
  matchingPairs: number;
  repeats: number;
  estimatedCostUsd: number;
  /** Max judges per match for an escalation sweep (WORST-case multiplier: every match runs the full
   *  chain). Omit / 1 = single-judge (byte-identical to before). */
  chainCap?: number;
}

export interface CapResult {
  plannedCalls: number;
  maxCalls: number;
  maxUsd: number;
}

export class JudgeEvalDisabledError extends Error {
  constructor() {
    super('Judge Lab is disabled (JUDGE_EVAL_ENABLED=false).');
    this.name = 'JudgeEvalDisabledError';
  }
}

export class JudgeEvalCapExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JudgeEvalCapExceededError';
  }
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const DEFAULT_JUDGE_EVAL_MAX_CALLS = 20000;
export const DEFAULT_JUDGE_EVAL_MAX_USD = 5;

/** 2 LLM calls per repeat (forward + reverse). For an escalation sweep, `chainCap` is the WORST-case
 *  judges-per-match (every match runs the full chain), so the gate never undercounts. `chainCap=1`
 *  (default) is byte-identical to the single-judge estimate. */
export function plannedCalls(
  cells: number,
  matchingPairs: number,
  repeats: number,
  chainCap = 1,
): number {
  return cells * matchingPairs * repeats * 2 * chainCap;
}

/**
 * Reject (before any LLM spend) when the feature is disabled or the sweep would exceed the
 * hard, non-overridable ceiling. Throws JudgeEvalDisabledError / JudgeEvalCapExceededError.
 */
export function assertWithinJudgeEvalCap(input: CapInput): CapResult {
  if (process.env.JUDGE_EVAL_ENABLED === 'false') {
    throw new JudgeEvalDisabledError();
  }
  const maxCalls = envInt('JUDGE_EVAL_MAX_CALLS', DEFAULT_JUDGE_EVAL_MAX_CALLS);
  const maxUsd = envInt('JUDGE_EVAL_MAX_USD', DEFAULT_JUDGE_EVAL_MAX_USD);
  const calls = plannedCalls(input.cells, input.matchingPairs, input.repeats, input.chainCap ?? 1);

  if (calls > maxCalls) {
    throw new JudgeEvalCapExceededError(
      `Sweep would make ${calls} LLM calls, exceeding JUDGE_EVAL_MAX_CALLS=${maxCalls}. ` +
        `Reduce models/temperatures/repeats or use a smaller test set.`,
    );
  }
  if (input.estimatedCostUsd > maxUsd) {
    throw new JudgeEvalCapExceededError(
      `Sweep estimated at $${input.estimatedCostUsd.toFixed(2)}, exceeding JUDGE_EVAL_MAX_USD=$${maxUsd}.`,
    );
  }
  return { plannedCalls: calls, maxCalls, maxUsd };
}
