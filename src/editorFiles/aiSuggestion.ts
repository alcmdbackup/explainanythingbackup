import { z } from 'zod';

/**
 * Schema for AI suggestion structured output
 * 
 * • Enforces alternating pattern: either "... existing text ..." or actual edit content
 * • Validates that edits and existing text markers alternate properly
 * • Ensures the output starts and ends with content (not markers)
 * • Used by: AI suggestion generation to enforce consistent output format
 * • Calls: N/A (validation schema)
 */
export const aiSuggestionSchema = z.object({
  edits: z.array(z.string()).min(1).refine(
    (edits) => {
      // Must alternate between content and markers
      for (let i = 0; i < edits.length; i++) {
        const isMarker = edits[i] === "... existing text ...";
        const isEvenIndex = i % 2 === 0;
        
        // Even indices (0, 2, 4...) should be content
        // Odd indices (1, 3, 5...) should be markers
        if (isEvenIndex && isMarker) {
          return false;
        }
        if (!isEvenIndex && !isMarker) {
          return false;
        }
      }
      
      return true;
    },
    {
      message: "Edits must alternate between content and '... existing text ...' markers"
    }
  )
});

export type AISuggestionOutput = z.infer<typeof aiSuggestionSchema>;

/**
 * Creates a structured prompt for AI suggestions
 * 
 * • Generates prompt that enforces structured output format
 * • Uses Zod schema to validate alternating edit/content pattern
 * • Ensures consistent formatting for AI model responses
 * • Used by: AI suggestion generation with structured output validation
 * • Calls: N/A (prompt generation only)
 */
export function createAISuggestionPrompt(currentText: string): string {
  return `Make significant edits to the article below to improve its quality.

<output_format>
You must respond with a JSON object containing an "edits" array. 
The edits array will explain how to make described edits sequentially starting from beginning of content, while skipping unchanged "existing text"

Each element in the array must be either:
1. "... existing text ..." (to indicate unchanged content)
2. The actual edited text content

Example:
{
  "edits": [
    "Improved introduction paragraph here",
    "... existing text ...",
    "Enhanced middle section with better examples"
  ]
}

Or ending with marker:
{
  "edits": [
    "This improved introduction paragraph has been revised for better wording",
    "... existing text ...",
    "This middle paragraph text has now been edited for clarity",
    "... existing text ..."
  ]
}
</output_format>

<rules>
- You can start with either edited content or "... existing text ..." marker
- Alternate between content and "... existing text ..." markers
- You can end with either edited content or "... existing text ..." marker
- Preserve markdown formatting in your edits
- Make substantial improvements to content quality, clarity, and structure
- Each edit should be a complete, coherent section
</rules>

== Article to edit ==:
${currentText}`;
}

/**
 * Merges AI suggestion output array into a single string
 * 
 * • Combines alternating content and markers into readable format
 * • Each array element starts on a newline for clarity
 * • Preserves the structure of edits vs unchanged content
 * • Used by: AI suggestion processing to convert structured output to readable text
 * • Calls: N/A (string manipulation only)
 */
export function mergeAISuggestionOutput(output: AISuggestionOutput): string {
  return output.edits.join('\n');
}

/**
 * Validates AI suggestion output against schema
 * 
 * • Ensures output follows alternating pattern requirements
 * • Validates structure before processing
 * • Returns typed result or validation errors
 * • Used by: AI suggestion processing to ensure output quality
 * • Calls: aiSuggestionSchema.safeParse
 */
export function validateAISuggestionOutput(rawOutput: string): { success: true; data: AISuggestionOutput } | { success: false; error: z.ZodError } {
  try {
    const parsed = JSON.parse(rawOutput);
    const result = aiSuggestionSchema.safeParse(parsed);
    
    if (result.success) {
      return { success: true, data: result.data };
    } else {
      return { success: false, error: result.error };
    }
  } catch (error) {
    // If JSON parsing fails, create a mock ZodError
    const mockError = new z.ZodError([
      {
        code: 'custom',
        message: 'Invalid JSON format',
        path: []
      }
    ]);
    return { success: false, error: mockError };
  }
}

export function createApplyEditsPrompt(aiSuggestions: string, originalContent: string): string {
    const applyPrompt = `You are an edit application tool. Your job is to take the suggested edits and apply them to the original content.

You will receive:
1. AI suggestions that use the format "... existing text ..." to mark unchanged sections
2. The original content that needs to be edited

Your task is to:
1. Parse the AI suggestions to understand what edits to make
2. Apply those edits to the original content
3. Return the COMPLETE final text with all edits applied

IMPORTANT RULES:
- Return ONLY the final edited text, nothing else
- Do not include the "... existing text ..." markers in your output
- Preserve all formatting, spacing, and structure from the original
- Make sure the final text is complete and readable

== AI SUGGESTIONS ==
${aiSuggestions}

== ORIGINAL CONTENT ==
${originalContent}

== YOUR TASK ==
Apply the AI suggestions to the original content and return the complete final text.`;

    return applyPrompt;
}

/**
 * Handles getting AI suggestions for text improvement
 * @param currentText - The current text content
 * @param improvementType - The type of improvement requested
 * @param callOpenAIModel - Function to call the OpenAI model
 * @param logger - Logger utility for debugging
 * @returns Promise that resolves to the AI suggestion response
 */
export async function getAISuggestions(
    currentText: string, 
    callOpenAIModel: (prompt: string, call_source: string, userid: string, model: string, streaming: boolean, setText: ((text: string) => void) | null) => Promise<string>,
    logger: any
): Promise<string> {
    try {
        const prompt = createAISuggestionPrompt(currentText);
        
        logger.debug('AI Suggestion Request', {
            textLength: currentText.length,
            promptLength: prompt.length
        });

        const response = await callOpenAIModel(
            prompt,
            'editor_ai_suggestions',
            'test-user',
            'gpt-4o-mini',
            false,
            null
        );

        logger.debug('AI Suggestion Response', {
            responseLength: response.length,
            response: response
        });

        return response;
    } catch (error) {
        logger.error('AI Suggestion Error', {
            error: error instanceof Error ? error.message : String(error)
        });
        throw error;
    }
}
