// Branded `CallSource` type + closed registry/factories that make LLM call attribution
// mandatory by construction: callLLM's 2nd arg accepts only `CallSource`, which can be
// produced solely via CALL_SOURCES / evolutionSource / testSource (Layer 0 of the
// attribution system). See docs/planning/build_llm_spending_tab_in_admin_dash_20260620/.

import type { AgentName } from '@evolution/lib/core/agentNames';

/** A raw string is NOT assignable to CallSource — callers must use the registry/factories. */
export type CallSource = string & { readonly __brand: 'CallSource' };

const brand = (s: string): CallSource => s as CallSource;

/**
 * Closed registry of every non-evolution call_source (1:1 with a feature), plus the two
 * evolution_* sources whose suffix is not an AgentName. Every member must be mapped in
 * `ENTITY_BY_SOURCE` (enforced by an exhaustiveness unit test in llmCostAttribution.test.ts).
 */
export const CALL_SOURCES = Object.freeze({
  // Search / generation pipeline
  generateTitleFromUserQuery: brand('generateTitleFromUserQuery'),
  extractLinkCandidates: brand('extractLinkCandidates'),
  generateNewExplanation: brand('generateNewExplanation'),
  evaluateTags: brand('evaluateTags'),
  explanationSummarization: brand('explanation_summarization'),
  sourceSummarization: brand('source_summarization'),
  findBestMatchFromList: brand('findBestMatchFromList'),
  // Content quality
  contentQualityEval: brand('content_quality_eval'),
  contentQualityCompareScore: brand('content_quality_compare_score'),
  contentQualityComparePair: brand('content_quality_compare_pair'),
  // Linking
  enhanceContentWithInlineLinks: brand('enhanceContentWithInlineLinks'),
  enhanceContentWithHeadingLinks: brand('enhanceContentWithHeadingLinks'),
  generateHeadingStandaloneTitles: brand('generateHeadingStandaloneTitles'),
  // Editor
  editorAiSuggestions: brand('editor_ai_suggestions'),
  editorApplySuggestions: brand('editor_apply_suggestions'),
  // Chat + import
  streamChatApi: brand('stream-chat-api'),
  importArticle: brand('importArticle'), // ← no URL/source suffix (normalized: bounded cardinality)
  // evolution_* sources whose suffix is NOT an AgentName (so the factory can't produce them)
  evolutionJudgeEval: brand('evolution_judge_eval'),
  evolutionPromptEditor: brand('evolution_prompt_editor'),
  evolutionWeightInference: brand('evolution_weight_inference'),
  matchViewerRejudge: brand('match_viewer_rejudge'),
} as const);

/**
 * Pipeline calls do `callLLM(prompt, evolutionSource(label), …)` where `label` is the
 * AgentName (claimAndExecuteRun). Reuse the real union so it never drifts.
 */
export type EvolutionAgent = AgentName;
export const evolutionSource = (agent: EvolutionAgent): CallSource => brand(`evolution_${agent}`);

/**
 * Test-only escape hatch — lets unit/integration/e2e tests use arbitrary sources without
 * weakening the production registry. The `require-llm-call-source` ESLint rule allows
 * `testSource(...)` only in test files.
 */
export const testSource = (s: string): CallSource => brand(s);

/** Shape a valid call_source must match (Layer 2 runtime guard). Allows alphanumerics,
 *  underscores, and hyphens (e.g. `stream-chat-api`); the optional `:suffix` segment appears
 *  in the `unattributed:<caller>` fallback assigned after the check. */
export const CALL_SOURCE_SHAPE = /^[a-z0-9_-]+(:[a-z0-9_-]+)?$/i;

/**
 * Derive the calling function/file from the stack — the Layer-2 last-resort fallback so an
 * unattributed call is never silently blank (it becomes `unattributed:<caller>`, which is
 * greppable). Returns 'anonymous' when the stack is missing or unparseable.
 */
export function captureCallerName(): string {
  const stack = new Error().stack;
  if (!stack) return 'anonymous';
  const lines = stack.split('\n').slice(1); // drop "Error"
  for (const raw of lines) {
    const line = raw.trim();
    // Skip frames inside this module, the llms wrapper, and node internals.
    if (
      line.includes('llmCallSource') ||
      line.includes('llms.ts') ||
      line.includes('llms.js') ||
      line.includes('node:') ||
      line.includes('node_modules')
    ) {
      continue;
    }
    // "at fnName (file:line:col)" → fnName; "at file:line:col" → basename
    const fnMatch = line.match(/^at\s+([^\s(]+)\s*\(/);
    if (fnMatch && fnMatch[1] && fnMatch[1] !== 'Object.<anonymous>') {
      return fnMatch[1];
    }
    const fileMatch = line.match(/([^/\\(]+):\d+:\d+\)?$/);
    if (fileMatch && fileMatch[1]) return fileMatch[1];
  }
  return 'anonymous';
}
