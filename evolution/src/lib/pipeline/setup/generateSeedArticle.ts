// Seed article generation for prompt-based V2 runs. 2 LLM calls: title → article.

import { FORMAT_RULES, validateFormat } from '../../shared/enforceVariantFormat';
import type { EntityLogger } from '../infra/createEntityLogger';
import type { AgentName } from '../../core/agentNames';

const SEED_TIMEOUT_MS = 60_000;

/** Wrap an LLM call with a 60s timeout. Clears timer handle on completion. */
async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`Seed ${label} timed out after 60s`)), SEED_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function buildTitlePrompt(topic: string): string {
  return `You are an expert writer. Given the topic below, generate a concise, descriptive title for an encyclopedia-style article.

Topic: ${topic}

Respond with ONLY the title text, nothing else. No quotes, no prefixes, no explanation.`;
}

function buildArticlePrompt(title: string): string {
  return `Write a clear, comprehensive explanation of the topic below.

Title: ${title}

Rules:
- Output the content only (the title has already been provided)
- Use Markdown with ## section headers
- Write in complete paragraphs of 2+ sentences each
- Highlight key terms using **bold** formatting
- Be thorough but concise (800-1500 words)
${FORMAT_RULES}
Output ONLY the article content, no title.`;
}

/** Generate a title from a prompt using any LLM caller. Handles JSON parsing with plain-text fallback. */
export async function generateTitle(
  prompt: string,
  callFn: (prompt: string) => Promise<string>,
): Promise<string> {
  const raw = await callFn(buildTitlePrompt(prompt));
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      return ((parsed.title1 ?? parsed.title ?? '') as string).toString() || raw.replace(/["\n]/g, '').trim().slice(0, 200);
    }
    if (typeof parsed === 'string') return parsed;
    return raw.replace(/["\n]/g, '').trim().slice(0, 200);
  } catch {
    return raw.replace(/["\n]/g, '').trim().slice(0, 200);
  }
}

export interface SeedResult {
  title: string;
  content: string;
}

/**
 * Generate a seed article from a topic prompt via 2 LLM calls.
 * Uses raw LLM provider (not V2 EvolutionLLMClient — pre-pipeline, no cost tracking).
 *
 * The optional `model` argument lets callers force the strategy's `generationModel`
 * instead of falling through to whatever default the raw provider picks (which is
 * `deepseek-chat` in `claimAndExecuteRun.ts`). Tests that configure a strategy with
 * a different model — and that don't have DeepSeek credentials configured — would
 * otherwise hit a `DEEPSEEK_API_KEY not found` error before the pipeline even starts.
 */
export async function generateSeedArticle(
  promptText: string,
  llm: { complete(prompt: string, label: AgentName, opts?: { model?: string }): Promise<string> },
  logger?: EntityLogger,
  model?: string,
): Promise<SeedResult> {
  const opts = model ? { model } : undefined;
  logger?.debug('Starting seed title generation', { phaseName: 'seed_setup', model });
  let title = await withTimeout(
    generateTitle(promptText, (p) => llm.complete(p, 'seed_title', opts)),
    'title generation',
  );
  if (!title) title = promptText.slice(0, 100);
  logger?.debug('Seed title generated', { titleLength: title.length, phaseName: 'seed_setup' });

  // Generate article
  logger?.debug('Starting seed article generation', { phaseName: 'seed_setup', model });
  const articleContent = await withTimeout(
    llm.complete(buildArticlePrompt(title), 'seed_article', opts),
    'article generation',
  );

  const content = `# ${title}\n\n${articleContent}`;
  const formatResult = validateFormat(content);
  if (!formatResult.valid) {
    logger?.warn('Seed article format validation issues', { issues: formatResult.issues, phaseName: 'seed_setup' });
  }
  logger?.info('Seed article complete', { title, contentLength: content.length, phaseName: 'seed_setup' });
  return { title, content };
}
