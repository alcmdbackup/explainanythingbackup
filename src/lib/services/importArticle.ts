/**
 * Import Article Service
 *
 * Handles detection of AI source and reformatting of imported content.
 * Used by the import feature to process pasted AI-generated content.
 */

import { z } from 'zod';
import { callOpenAIModel, default_model } from './llms';
import { type ImportSource } from '@/lib/schemas/schemas';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';

const FILE_DEBUG = true;

/**
 * Heuristic patterns for detecting AI source
 */
const SOURCE_PATTERNS: Record<Exclude<ImportSource, 'generated'>, RegExp[]> = {
    chatgpt: [
        /^(Certainly!|Sure!|Of course!|Absolutely!)/i,
        /I'd be happy to help/i,
        /Here's (a|an|the|my)/i,
        /Let me (help|explain|break)/i,
        /Great question!/i,
    ],
    claude: [
        /I'll help you/i,
        /I can help with that/i,
        /Here's (a|an|my) (detailed|comprehensive|thorough)/i,
        /Let me (walk|guide) you through/i,
        /I'd be glad to/i,
    ],
    gemini: [
        /Here's (some information|what I found)/i,
        /Based on (my|the) (knowledge|information)/i,
        /I can provide/i,
    ],
    other: []
};

/**
 * Closing phrase patterns to help with detection
 */
const CLOSING_PATTERNS: RegExp[] = [
    /Let me know if you (have|need|want)/i,
    /Hope this helps!/i,
    /Feel free to ask/i,
    /Would you like me to/i,
    /Is there anything else/i,
];

/**
 * Detects the likely source of AI-generated content
 *
 * @param content - Raw pasted content from user
 * @returns Detected source with confidence, or 'other' if uncertain
 */
export function detectSource(content: string): ImportSource {
    const scores: Record<Exclude<ImportSource, 'generated' | 'other'>, number> = {
        chatgpt: 0,
        claude: 0,
        gemini: 0,
    };

    // Check opening patterns (weighted more heavily)
    const firstParagraph = content.slice(0, 500);

    for (const [source, patterns] of Object.entries(SOURCE_PATTERNS)) {
        if (source === 'other' || source === 'generated') continue;

        for (const pattern of patterns) {
            if (pattern.test(firstParagraph)) {
                scores[source as keyof typeof scores] += 2;
            }
            // Also check full content with lower weight
            if (pattern.test(content)) {
                scores[source as keyof typeof scores] += 1;
            }
        }
    }

    // Check closing patterns (any AI source)
    const hasClosingPattern = CLOSING_PATTERNS.some(p => p.test(content));
    if (hasClosingPattern) {
        // Boost all scores slightly since this confirms AI origin
        Object.keys(scores).forEach(key => {
            scores[key as keyof typeof scores] += 0.5;
        });
    }

    // Find highest scoring source
    const entries = Object.entries(scores) as [keyof typeof scores, number][];
    const sorted = entries.sort((a, b) => b[1] - a[1]);
    const [topSource, topScore] = sorted[0];
    const [, secondScore] = sorted[1];

    // Require minimum score and clear winner
    if (topScore >= 2 && topScore > secondScore) {
        return topSource;
    }

    return 'other';
}

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

    const response = await callOpenAIModel(
        prompt,
        `importArticle:${source}`,
        userId,
        default_model,
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
