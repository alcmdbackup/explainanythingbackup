import { z } from 'zod';
import { patchChangeSchema, ChangeKind } from './editorSchemas';

/**
 * Prompt for LLM to suggest edits to content
 * • Asks LLM to analyze content and suggest specific patch changes
 * • Requests structured output in patchChangeSchema format
 * • Provides context about the editing operation types
 * • Used by: Editor components for AI-powered edit suggestions
 * Calls: None (prompt definition)
 */
export const createEditorSuggestionPrompt = (content: string, userRequest?: string): string => {
    const basePrompt = `You are an expert content editor. Analyze the following content and suggest specific edits to improve it.

Content to edit:
"""
${content}
"""

${userRequest ? `User's specific request: ${userRequest}` : 'Please suggest improvements for clarity, grammar, structure, and overall quality.'}

Provide your suggestions as a JSON array of patch changes. Each patch change should be a specific, actionable edit that can be applied to the text.

Available change types:
- "insert": Add new text at a specific position
- "delete": Remove text from a specific range  
- "replace": Replace text in a specific range with new content

Guidelines:
1. Use grapheme-safe positioning (startG and endG should be character positions)
2. For insert operations, startG and endG should be the same position
3. For delete operations, specify the range to remove
4. For replace operations, specify the range to replace and provide newText
5. Include a brief summary of what each change accomplishes
6. Focus on the most impactful improvements first
7. Keep changes specific and actionable

Return a JSON object with a patches array in this exact format:
{
  "patches": [
    {
      "id": "unique-patch-id",
      "kind": "insert|delete|replace",
      "startG": 0,
      "endG": 0,
      "newText": "text to insert/replace (required for insert/replace)",
      "summary": "Brief description of what this change accomplishes"
    }
  ]
}`;

    return basePrompt;
};


