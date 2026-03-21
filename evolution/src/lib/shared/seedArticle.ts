// Generates a seed article from a topic prompt using LLM calls.
// Shared utility used by the cron runner and CLI for prompt-based evolution runs.

import { createTitlePrompt, createExplanationPrompt } from '@/lib/prompts';
import { titleQuerySchema } from '@/lib/schemas/schemas';
import type { EvolutionLLMClient, EvolutionLogger } from '../types';

export interface SeedResult {
  title: string;
  content: string;
}

/** Generate a title from a prompt using any LLM caller. Handles JSON parsing with plain-text fallback. */
export async function generateTitle(
  prompt: string,
  callFn: (prompt: string) => Promise<string>,
): Promise<string> {
  const titlePrompt = createTitlePrompt(prompt);
  const raw = await callFn(titlePrompt);
  try {
    const parsed = titleQuerySchema.parse(JSON.parse(raw));
    return parsed.title1;
  } catch {
    return raw.replace(/["\n]/g, '').trim().slice(0, 200);
  }
}

/**
 * Generate a seed article from a topic prompt.
 * Makes two LLM calls: one for title generation, one for article content.
 */
export async function generateSeedArticle(
  promptText: string,
  llmClient: EvolutionLLMClient,
  logger: EvolutionLogger,
): Promise<SeedResult> {
  // Generate title
  logger.info('Generating seed title...', {});
  let title: string;
  try {
    title = await generateTitle(promptText, (p) => llmClient.complete(p, 'seed_title'));
  } catch (err) {
    throw new Error(
      `Seed title generation failed for prompt "${promptText.slice(0, 200)}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  logger.info('Seed title generated', { title });

  // Generate article
  logger.info('Generating seed article...', { title });
  let articleContent: string;
  try {
    const articlePrompt = createExplanationPrompt(title, []);
    articleContent = await llmClient.complete(articlePrompt, 'seed_article');
  } catch (err) {
    throw new Error(
      `Seed article generation failed for "${title}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const fullContent = `# ${title}\n\n${articleContent}`;
  logger.info('Seed article generated', { words: fullContent.split(/\s+/).length });

  return { title, content: fullContent };
}
