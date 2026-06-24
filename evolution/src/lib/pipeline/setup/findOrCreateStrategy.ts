// Strategy config utilities: full-config hashing (v2), labeling, and find-or-create by config hash.
// The v2 hash covers the ENTIRE validated StrategyConfig after a normalization pass that
// preserves the pipeline's deliberate equivalences (runtime-default folding, agent-type-gated
// stripping, set-ordering) while making any other field difference produce a distinct strategy.

import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StrategyConfig } from '../infra/types';
import { evolutionStrategyInsertSchema, isEditingAgentType } from '../../schemas';

// ─── Internal helpers ────────────────────────────────────────────

/** Shorten a model name for display (e.g. "gpt-4.1-mini" -> "4.1-mini").
 * Defensive against nullish — legacy strategies (e.g. migration-imported rows
 * with `mig-strategy-*` names) have null model fields and would otherwise
 * crash any UI that calls labelStrategyConfig on them (caught by the wizard's
 * error boundary as "Something went wrong"). */
function shortenModel(model: string | null | undefined): string {
  if (!model) return '?';
  return model
    .replace('gpt-', '')
    .replace('deepseek-', 'ds-')
    .replace('claude-', 'cl-');
}

/** Runtime defaults the pipeline applies when a paragraph_recombine / proposer_approver
 *  field is omitted. Folding omitted → default keeps "omitted" and "explicit-default"
 *  configs as ONE strategy (matches pre-v2 dedup behavior). Sources:
 *  - includesMirrorApprover ?? true  — proposerApproverCriteriaGenerate.ts:270
 *  - perInvocationCapUsd 0.05         — ParagraphRecombineAgent.ts:63 (DEFAULT_PER_INVOCATION_CAP_USD)
 *  - maxDispatches ?? 1               — runIterationLoop.ts:1293 */
const DEFAULT_PER_INVOCATION_CAP_USD = 0.05;
const DEFAULT_MAX_DISPATCHES = 1;

/** paragraph_recombine_agent_with_coherence_pass_evolution_20260620 — runtime defaults
 *  for the new agent's coherence-pass knobs. perInvocationCapUsd default is conditional
 *  on coherencePassEnabled: $0.10 when true (need headroom for the coherence pass call),
 *  $0.05 when explicitly false (same as plain paragraph_recombine). Other defaults are
 *  resolved at consumption (in the new agent's execute()) — only `coherencePassEnabled`
 *  participates in the conditional-cap fold. */
const DEFAULT_COHERENCE_PASS_ENABLED = true;
const DEFAULT_PER_INVOCATION_CAP_WITH_COHERENCE = 0.10;

type IterCfg = StrategyConfig['iterationConfigs'][number];
type AgentType = IterCfg['agentType'];

const CRITERIA_BASED = new Set<AgentType>([
  'criteria_and_generate',
  'single_pass_evaluate_criteria_and_generate',
  'proposer_approver_criteria_generate',
]);

/** Per-field validity gates, mirroring the iterationConfigSchema .refine() rules
 *  (schemas.ts ~L700-800). A field present on an agent type that does NOT accept it
 *  is a runtime-ignored value and MUST be stripped before hashing so it can't change
 *  strategy identity. Fields with no entry here (agentType, budgetPercent, and the J3
 *  budget-floor fractions) are always kept. */
/** Shared gate for fields used by BOTH paragraph_recombine AND the new
 *  paragraph_recombine_with_coherence_pass sibling (per-slot rewrite + ranking
 *  infrastructure is identical between the two). */
const PARAGRAPH_RECOMBINE_FAMILY = new Set<AgentType>([
  'paragraph_recombine',
  'paragraph_recombine_with_coherence_pass',
]);

const FIELD_GATES: Partial<Record<keyof IterCfg, (t: AgentType) => boolean>> = {
  sourceMode: (t) => t !== 'swiss' && t !== 'debate_and_generate',
  qualityCutoff: (t) => t !== 'swiss' && t !== 'debate_and_generate',
  generationGuidance: (t) => t === 'generate',
  reflectionTopN: (t) => t === 'reflect_and_generate',
  editingMaxCycles: (t) => isEditingAgentType(t) || t === 'proposer_approver_criteria_generate',
  editingEligibilityCutoff: (t) => isEditingAgentType(t) || t === 'proposer_approver_criteria_generate',
  editingProposerSoftCap: (t) => t === 'iterative_editing_rewrite',
  disableApproverFiltering: (t) => t === 'iterative_editing_rewrite',
  criteriaIds: (t) => CRITERIA_BASED.has(t),
  weakestK: (t) => CRITERIA_BASED.has(t),
  lengthCapRatio: (t) => t === 'proposer_approver_criteria_generate',
  includesMirrorApprover: (t) => t === 'proposer_approver_criteria_generate',
  debateJudgeReasoningEffort: (t) => t === 'debate_and_generate',
  rewritesPerParagraph: (t) => PARAGRAPH_RECOMBINE_FAMILY.has(t),
  maxComparisonsPerParagraph: (t) => PARAGRAPH_RECOMBINE_FAMILY.has(t),
  maxParagraphsPerInvocation: (t) => PARAGRAPH_RECOMBINE_FAMILY.has(t),
  paragraphRewriteModel: (t) => PARAGRAPH_RECOMBINE_FAMILY.has(t),
  perInvocationCapUsd: (t) => PARAGRAPH_RECOMBINE_FAMILY.has(t),
  maxDispatches: (t) => PARAGRAPH_RECOMBINE_FAMILY.has(t),
  // paragraph_recombine_agent_with_coherence_pass_evolution_20260620 — new coherence-pass-only fields.
  coherencePassEnabled: (t) => t === 'paragraph_recombine_with_coherence_pass',
  coherencePassProposerModel: (t) => t === 'paragraph_recombine_with_coherence_pass',
  coherencePassApproverModel: (t) => t === 'paragraph_recombine_with_coherence_pass',
  coherencePassRewriteTempFloor: (t) => t === 'paragraph_recombine_with_coherence_pass',
  coherencePassRewriteTempCeiling: (t) => t === 'paragraph_recombine_with_coherence_pass',
};

/** Sort generationGuidance by tactic — it is an unordered weighted SET
 *  (refine enforces unique tactics), so order must not affect the hash. */
function sortGuidance(g: unknown): unknown {
  if (!Array.isArray(g)) return g;
  return [...g].sort((a, b) => {
    const ta = (a as { tactic?: string })?.tactic ?? '';
    const tb = (b as { tactic?: string })?.tactic ?? '';
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
}

/** Normalize one iteration config: resolve runtime defaults, strip agent-type-ignored
 *  fields, drop empty criteriaIds, sort set-like arrays. */
function normalizeIteration(iter: IterCfg): Record<string, unknown> {
  const out: Record<string, unknown> = { ...iter };

  // D1.1 — runtime-default folding (omitted ≡ explicit-default).
  if (out.agentType === 'proposer_approver_criteria_generate' && out.includesMirrorApprover === undefined) {
    out.includesMirrorApprover = true;
  }
  if (out.agentType === 'paragraph_recombine') {
    if (out.maxDispatches === undefined) out.maxDispatches = DEFAULT_MAX_DISPATCHES;
    if (out.perInvocationCapUsd === undefined) out.perInvocationCapUsd = DEFAULT_PER_INVOCATION_CAP_USD;
  }
  // paragraph_recombine_agent_with_coherence_pass_evolution_20260620 — runtime-default
  // folding for the new agent. coherencePassEnabled defaults to true; perInvocationCapUsd
  // defaults conditionally on coherencePassEnabled ($0.10 with coherence, $0.05 without).
  // This is critical for `config_hash` dedup: strategies omitting both fields should hash
  // identically to strategies that set the defaults explicitly, AND strategies that differ
  // only in coherencePassEnabled MUST produce distinct hashes (the project's A/B design).
  if (out.agentType === 'paragraph_recombine_with_coherence_pass') {
    if (out.maxDispatches === undefined) out.maxDispatches = DEFAULT_MAX_DISPATCHES;
    if (out.coherencePassEnabled === undefined) out.coherencePassEnabled = DEFAULT_COHERENCE_PASS_ENABLED;
    if (out.perInvocationCapUsd === undefined) {
      out.perInvocationCapUsd = out.coherencePassEnabled
        ? DEFAULT_PER_INVOCATION_CAP_WITH_COHERENCE
        : DEFAULT_PER_INVOCATION_CAP_USD;
    }
  }

  // D6 — strip fields the runtime ignores for this agent type.
  for (const key of Object.keys(out) as (keyof IterCfg)[]) {
    const gate = FIELD_GATES[key];
    if (gate && out[key] !== undefined && !gate(out.agentType as AgentType)) {
      delete out[key];
    }
  }

  // D1.3 — criteriaIds: drop empty (≡ omitted), else sort (order-insensitive set).
  if (Array.isArray(out.criteriaIds)) {
    if (out.criteriaIds.length === 0) delete out.criteriaIds;
    else out.criteriaIds = [...(out.criteriaIds as string[])].sort();
  }

  // D1.5 — generationGuidance is an unordered weighted set.
  if (out.generationGuidance !== undefined) out.generationGuidance = sortGuidance(out.generationGuidance);

  return out;
}

/** Normalize the whole config: strip deprecated budget-floor aliases (D1.4), sort
 *  top-level generationGuidance (D1.5), normalize each iteration. */
function normalizeConfig(config: StrategyConfig): Record<string, unknown> {
  const out: Record<string, unknown> = { ...config };

  // D1.4 — preprocessBudgetFloor (schemas.ts:483-486) mirrors minBudgetAfter*Fraction into
  // these deprecated aliases on every parse, but createStrategyAction hand-builds without them.
  // Strip the aliases so the parse-path and action-path configs hash identically.
  delete (out as Record<string, unknown>).budgetBufferAfterParallel;
  delete (out as Record<string, unknown>).budgetBufferAfterSequential;

  if (out.generationGuidance !== undefined) out.generationGuidance = sortGuidance(out.generationGuidance);

  out.iterationConfigs = config.iterationConfigs.map(normalizeIteration);
  return out;
}

/** Deep, stable canonicalization for hashing: sort object keys, drop undefined/null,
 *  round every numeric leaf to a 0.001 floor via toFixed(3) (recursing into nested
 *  objects + array elements) so sub-0.001 differences don't create a new strategy.
 *  Array order is preserved (callers pre-sort order-insensitive arrays). */
function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toFixed(3) : String(value);
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      const cv = canonicalize(obj[key]);
      if (cv !== undefined) out[key] = cv;
    }
    return out;
  }
  return value; // string | boolean
}

// ─── Public API ──────────────────────────────────────────────────

/** Stable JSON string of the fully-normalized + canonicalized config. */
function stableStringify(config: StrategyConfig): string {
  return JSON.stringify(canonicalize(normalizeConfig(config)));
}

/**
 * Generate a stable hash for a strategy config. v2 hashes the ENTIRE config
 * (after normalization), so any meaningful field difference yields a distinct
 * strategy — unlike v1, which hashed only a whitelist and silently deduped
 * configs that differed in an unhashed field. The `v2:` prefix isolates v2 from
 * legacy v1 hashes (12 bare hex chars) so they can never collide.
 */
export function hashStrategyConfig(config: StrategyConfig): string {
  return 'v2:' + createHash('sha256').update(stableStringify(config)).digest('hex').slice(0, 12);
}

/** Auto-generated label: "Gen: model | Judge: model | 2×gen + 3×swiss". */
export function labelStrategyConfig(config: StrategyConfig): string {
  const genCount = config.iterationConfigs.filter((ic) => ic.agentType === 'generate').length;
  const reflectCount = config.iterationConfigs.filter((ic) => ic.agentType === 'reflect_and_generate').length;
  const criteriaCount = config.iterationConfigs.filter((ic) => ic.agentType === 'criteria_and_generate').length;
  const singlePassCount = config.iterationConfigs.filter((ic) => ic.agentType === 'single_pass_evaluate_criteria_and_generate').length;
  const proposerApproverCount = config.iterationConfigs.filter((ic) => ic.agentType === 'proposer_approver_criteria_generate').length;
  const editCount = config.iterationConfigs.filter((ic) => ic.agentType === 'iterative_editing' || ic.agentType === 'iterative_editing_rewrite').length;
  const swissCount = config.iterationConfigs.filter((ic) => ic.agentType === 'swiss').length;
  const iterLabel = [
    genCount > 0 ? `${genCount}×gen` : '',
    reflectCount > 0 ? `${reflectCount}×reflect` : '',
    criteriaCount > 0 ? `${criteriaCount}×criteria` : '',
    singlePassCount > 0 ? `${singlePassCount}×single-pass-criteria` : '',
    proposerApproverCount > 0 ? `${proposerApproverCount}×proposer-approver` : '',
    editCount > 0 ? `${editCount}×edit` : '',
    swissCount > 0 ? `${swissCount}×swiss` : '',
  ].filter(Boolean).join(' + ');

  const parts = [
    `Gen: ${shortenModel(config.generationModel)}`,
    `Judge: ${shortenModel(config.judgeModel)}`,
    iterLabel,
  ];

  if (config.budgetUsd != null) {
    parts.push(`Budget: $${config.budgetUsd.toFixed(2)}`);
  }

  return parts.join(' | ');
}

/** Strip the `v2:` (or any `prefix:`) marker so the bare hex can be sliced for display. */
function hashHex(hash: string): string {
  const colon = hash.indexOf(':');
  return colon >= 0 ? hash.slice(colon + 1) : hash;
}

/**
 * Find-or-create a strategy row by config hash. Uses INSERT ... ON CONFLICT for race safety.
 * Throws on error (strategy_id is required for all runs).
 */
export async function upsertStrategy(
  db: SupabaseClient,
  config: StrategyConfig,
): Promise<string> {
  const hash = hashStrategyConfig(config);
  const label = labelStrategyConfig(config);
  // Strip the `v2:` prefix before slicing so the name reads "Strategy abc123 (...)", not "Strategy v2:abc".
  const name = `Strategy ${hashHex(hash).slice(0, 6)} (${config.generationModel.split('-').pop()}, ${config.iterationConfigs.length}it)`;

  const payload = evolutionStrategyInsertSchema.parse({ name, label, config, config_hash: hash });
  const { data, error } = await db
    .from('evolution_strategies')
    .upsert(
      payload,
      { onConflict: 'config_hash' },
    )
    .select('id')
    .single();

  if (error) {
    // Preserve the original Supabase error (code, details, hint) via Error.cause.
    throw new Error(`Strategy upsert failed: ${error.message}`, { cause: error });
  }
  if (!data?.id) {
    throw new Error('Strategy upsert returned no ID');
  }
  return data.id;
}
