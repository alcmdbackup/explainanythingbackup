/**
 * Import Article Service
 *
 * Handles detection of AI source and reformatting of imported content.
 * Used by the import feature to process pasted AI-generated content.
 */

import { z } from 'zod';
import { callLLM, DEFAULT_MODEL } from './llms';
import { type ImportSource } from '@/lib/schemas/schemas';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';

// Re-export the client-safe detectSource so server-side code can still import from here
export { detectSource } from './importSourceDetect';

const FILE_DEBUG = true;

/**
 * Schema for LLM reformatting response
 */
const reformatResponseSchema = z.object({
    title: z.string().describe('A clear, descriptive title for the article'),
    content: z.string().describe('The cleaned and reformatted article content in markdown'),
});

type ReformatResponse = z.infer<typeof reformatResponseSchema>;

/**
 * Prompt template for content cleanup and reformatting
 */
const REFORMAT_PROMPT = `You are reformatting AI chat content into a clean educational article.

Input: Raw content copied from an AI assistant conversation.

Tasks:
1. Remove conversational artifacts:
   - Opening phrases ("Sure!", "I'd be happy to help...", "Certainly!")
   - Closing phrases ("Let me know if...", "Hope this helps!", "Feel free to ask...")
   - Meta-commentary ("As an AI...", "I should note...", "Would you like me to continue?")

2. Generate a clear, descriptive title that captures the main topic

3. Structure as article:
   - h2 (##) for major sections
   - h3 (###) for subsections if needed
   - Add brief intro paragraph if content jumps straight into details
   - Do NOT include the title in the content (it will be added separately)

4. Preserve all substantive content, examples, and code blocks

5. Clean up markdown formatting issues

Content to reformat:
---
{content}
---

Respond with a JSON object containing "title" and "content" fields.`;

/**
 * Cleans up and reformats imported AI content using LLM
 *
 * @param content - Raw content to process
 * @param source - Detected or user-specified source
 * @param userId - User ID for tracking
 * @returns Formatted article with title and content
 */
async function cleanupAndReformatImpl(
    content: string,
    source: ImportSource,
    userId: string
): Promise<ReformatResponse> {
    const prompt = REFORMAT_PROMPT.replace('{content}', content);

    const response = await callLLM(
        prompt,
        `importArticle:${source}`,
        userId,
        DEFAULT_MODEL,
        false,
        null,
        reformatResponseSchema,
        'reformatResponse',
        FILE_DEBUG
    );

    // Parse the JSON response
    const parsed = JSON.parse(response);
    const validated = reformatResponseSchema.parse(parsed);

    return validated;
}

/**
 * Validates that content is suitable for import
 *
 * @param content - Content to validate
 * @returns Object with isValid flag and optional error message
 */
export function validateImportContent(content: string): { isValid: boolean; error?: string } {
    const trimmed = content.trim();

    if (!trimmed) {
        return { isValid: false, error: 'Content is empty' };
    }

    if (trimmed.length < 50) {
        return { isValid: false, error: 'Content is too short (minimum 50 characters)' };
    }

    if (trimmed.length > 100000) {
        return { isValid: false, error: 'Content is too long (maximum 100,000 characters)' };
    }

    return { isValid: true };
}

// Wrap async function with automatic logging for entry/exit/timing
export const cleanupAndReformat = withLogging(
    cleanupAndReformatImpl,
    'cleanupAndReformat',
    { logErrors: true }
);
