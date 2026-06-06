// Type contracts for the prompt-playground tool: a single-call rewrite harness that runs N
// {prompt, model, temperature} configs over one shared source input and returns raw outputs +
// per-config cost. No agent orchestration, no evolution-pipeline DB rows.

/** Which rewrite unit a playground run operates on. */
export type RewriteUnit = 'article' | 'paragraph';

/** Editable prompt for the whole-article rewrite (mirrors a generate-tactic's two parts;
 *  FORMAT_RULES is auto-appended by buildEvolutionPrompt). */
export interface ArticlePromptSpec {
  preamble: string;
  instructions: string;
}

/** Editable prompt for the paragraph rewrite (the per-rewrite directive injected into
 *  buildParagraphRewritePrompt's length/format scaffolding). */
export interface ParagraphPromptSpec {
  directive: string;
}

export type PromptSpec = ArticlePromptSpec | ParagraphPromptSpec;

/** One column in the comparison: a prompt + model + temperature to run against the shared input. */
export interface PlaygroundConfig {
  label: string;
  prompt: PromptSpec;
  model: string;
  /** Omit for provider default; clamped to the model's maxTemperature; ignored when the model
   *  reports a null/undefined maxTemperature. */
  temperature?: number;
}

/** A playground run: one shared source input + N configs. */
export interface PlaygroundRunInput {
  unit: RewriteUnit;
  /** The article (unit='article') or paragraph (unit='paragraph') every config rewrites. */
  sourceText: string;
  /** Optional article title used only for paragraph-mode prompt context. */
  title?: string;
  configs: PlaygroundConfig[];
}

/** Per-config execution outcome. A model refusal is NOT an error — it returns as text with
 *  status 'success' (and an optional looksLikeRefusal display hint). */
export type PlaygroundConfigStatus =
  | 'success'
  | 'budget'
  | 'killed'
  | 'timeout'
  | 'error';

export interface PlaygroundConfigResult {
  label: string;
  output: string | null;
  /** Per-call cost from the LLM usage callback (usage.estimatedCostUsd); 0 when no call ran. */
  costUsd: number;
  model: string;
  /** Temperature actually sent (after clamp); null when the model does not support temperature. */
  temperatureUsed: number | null;
  durationMs: number;
  status: PlaygroundConfigStatus;
  /** Display-only format check (never blocks output). */
  formatValid: boolean;
  formatIssues?: string[];
  /** Heuristic display hint: the output reads like a refusal (still status 'success'). */
  looksLikeRefusal?: boolean;
  errorMsg?: string;
}

export interface PlaygroundRunResult {
  configs: PlaygroundConfigResult[];
  totalCostUsd: number;
}
