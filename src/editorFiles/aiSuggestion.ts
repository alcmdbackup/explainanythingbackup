/**
 * AI Suggestion functionality for the editor
 * Creates prompts for AI-powered text editing suggestions
 */

/**
 * Creates a prompt for AI text editing suggestions
 * @param currentText - The current text content to be edited
 * @param improvementType - The type of improvement requested (grammar, style, clarity, etc.)
 * @returns A formatted prompt string for the AI model
 */
export function createAISuggestionPrompt(currentText: string): string {
    const basePrompt = `Make significant edits to the article below to improve its quality.

<output_format> When writing the edits, specify each edit in sequence, using the special marker ... existing text ... to represent unchanged passages in between edited sections.

For example:

... existing text ...
FIRST_EDIT
... existing text ...
SECOND_EDIT
... existing text ...
THIRD_EDIT
... existing text ...
</output_format>

<individual_edit>
Replace each FIRST_EDIT, SECOND_EDIT... above with the updated text along with some unchanged text before and after to help identify the change later 
Make sure each edit is unambiguous about what should change and where it should be applied.
</individual_edit>

<existing_text_marker>
Only return ... existing text ... markers and the updated text, do not return anything else. Do not actually print FIRST_EDIT, SECOND_EDIT, etc - you need to replace this with the updated text for the edits
DO NOT omit spans of pre-existing text without replacing them with the ... existing text ... marker. If you omit the marker, the model may inadvertently delete those parts of the article.
</existing_text_marker>

<markdown_formatting>
Preserve any markdown formatting included in edits as appropriate>
</markdown_formatting>

== Article to edit ==: 

${currentText}`;

    return basePrompt;
}

/**
 * Creates a prompt to apply AI suggestions to the original content
 * @param aiSuggestions - The output from createAISuggestionPrompt() after running through callOpenAIModel()
 * @param originalContent - The original content on which edits were suggested
 * @returns A formatted prompt string to apply the suggested edits
 */
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
