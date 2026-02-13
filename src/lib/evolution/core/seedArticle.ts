// Generates a seed article from a topic prompt using LLM calls.
// Shared utility used by the cron runner and CLI for prompt-based evolution runs.

import { createTitlePrompt, createExplanationPrompt } from '@/lib/prompts';
import { titleQuerySchema } from '@/lib/schemas/schemas';
import type { EvolutionLLMClient, EvolutionLogger } from '../types';

export interface SeedResult {
  title: string;
  content: string;
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
  const titlePromptText = createTitlePrompt(promptText);
  let titleRaw: string;
  try {
    titleRaw = await llmClient.complete(titlePromptText, 'seed_title');
  } catch (err) {
    throw new Error(
      `Seed title generation failed for prompt "${promptText.slice(0, 200)}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let title: string;
  try {
    const parsed = titleQuerySchema.parse(JSON.parse(titleRaw));
    title = parsed.title1;
  } catch {
    title = titleRaw.replace(/["\n]/g, '').trim().slice(0, 200);
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
