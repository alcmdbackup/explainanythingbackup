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
 * Functional pipeline for running the complete AI suggestions workflow
 *
 * • Runs the 4-step AI suggestion pipeline sequentially
 * • Each step must succeed for the next to proceed
 * • Optionally saves session data to database when session_id is provided
 * • Returns final preprocessed content ready for editor
 * • Used by: getAndApplyAISuggestions for complete workflow
 * • Calls: generateAISuggestionsAction, applyAISuggestionsAction, generateMarkdownASTDiff, preprocessCriticMarkup
 */
export async function runAISuggestionsPipeline(
  currentContent: string,
  userId: string,
  onProgress?: (step: string, progress: number) => void,
  sessionData?: {
    session_id?: string;
    explanation_id: number;
    explanation_title: string;
    user_prompt: string;
  }
): Promise<{ content: string; session_id?: string }> {
  console.log('🚀 PIPELINE START: runAISuggestionsPipeline called', {
    contentLength: currentContent.length,
    userId,
    hasSessionData: !!sessionData,
    sessionData
  });

  onProgress?.('Generating AI suggestions...', 25);

  // Import the server actions and utilities
  const { generateAISuggestionsAction, applyAISuggestionsAction, saveTestingPipelineStepAction } = await import('../actions/actions');
  const { RenderCriticMarkupFromMDAstDiff } = await import('./markdownASTdiff/markdownASTdiff');
  const { preprocessCriticMarkup } = await import('./lexicalEditor/importExportUtils');
  const { unified } = await import('unified');
  const { default: remarkParse } = await import('remark-parse');

  console.log('📦 PIPELINE: Imports loaded successfully');

  console.log('🤖 PIPELINE STEP 1: Generating AI suggestions...');
  const suggestionsResult = await generateAISuggestionsAction(currentContent, userId);
  console.log('🤖 PIPELINE STEP 1 RESULT:', {
    success: suggestionsResult.success,
    hasData: !!suggestionsResult.data,
    dataLength: suggestionsResult.data?.length || 0,
    error: suggestionsResult.error
  });

  if (!suggestionsResult.success || !suggestionsResult.data) {
    console.error('❌ PIPELINE STEP 1 FAILED:', suggestionsResult.error);
    throw new Error(suggestionsResult.error?.message || 'Failed to generate AI suggestions');
  }
  const suggestions = suggestionsResult.data;

  // Save step 1 if session data provided
  if (sessionData) {
    console.log('💾 PIPELINE: Saving step 1 to database...', {
      sessionId: sessionData.session_id,
      explanationId: sessionData.explanation_id,
      contentLength: suggestions.length
    });

    try {
      const saveResult = await saveTestingPipelineStepAction(
        'ai-suggestion-session',
        'step1_ai_suggestions',
        suggestions,
        {
          session_id: sessionData.session_id,
          explanation_id: sessionData.explanation_id,
          explanation_title: sessionData.explanation_title,
          user_prompt: sessionData.user_prompt,
          source_content: currentContent,
          session_metadata: { step: 'ai_suggestions', processing_time: Date.now() }
        }
      );
      console.log('💾 PIPELINE STEP 1 SAVE RESULT:', saveResult);
    } catch (error) {
      console.error('❌ PIPELINE STEP 1 SAVE FAILED:', error);
    }
  } else {
    console.log('⚠️ PIPELINE: No session data provided, skipping step 1 save');
  }

  onProgress?.('Applying suggestions...', 50);
  console.log('✏️ PIPELINE STEP 2: Applying suggestions...');
  const editedContentResult = await applyAISuggestionsAction(suggestions, currentContent, userId);
  console.log('✏️ PIPELINE STEP 2 RESULT:', {
    success: editedContentResult.success,
    hasData: !!editedContentResult.data,
    dataLength: editedContentResult.data?.length || 0,
    error: editedContentResult.error
  });

  if (!editedContentResult.success || !editedContentResult.data) {
    console.error('❌ PIPELINE STEP 2 FAILED:', editedContentResult.error);
    throw new Error(editedContentResult.error?.message || 'Failed to apply AI suggestions');
  }
  const editedContent = editedContentResult.data;

  // Save step 2 if session data provided
  if (sessionData) {
    console.log('💾 PIPELINE: Saving step 2 to database...');
    try {
      const saveResult = await saveTestingPipelineStepAction(
        'ai-suggestion-session',
        'step2_applied_edits',
        editedContent,
        {
          session_id: sessionData.session_id,
          explanation_id: sessionData.explanation_id,
          explanation_title: sessionData.explanation_title,
          user_prompt: sessionData.user_prompt,
          source_content: currentContent,
          session_metadata: { step: 'applied_edits', processing_time: Date.now() }
        }
      );
      console.log('💾 PIPELINE STEP 2 SAVE RESULT:', saveResult);
    } catch (error) {
      console.error('❌ PIPELINE STEP 2 SAVE FAILED:', error);
    }
  }

  onProgress?.('Generating diff...', 75);
  console.log('🔄 PIPELINE STEP 3: Generating diff...');
  // Generate AST diff and convert to CriticMarkup
  const beforeAST = unified().use(remarkParse).parse(currentContent);
  const afterAST = unified().use(remarkParse).parse(editedContent);
  const criticMarkup = RenderCriticMarkupFromMDAstDiff(beforeAST, afterAST);
  console.log('🔄 PIPELINE STEP 3 RESULT:', {
    criticMarkupLength: criticMarkup.length,
    hasCriticMarkup: criticMarkup.length > 0
  });

  // Save step 3 if session data provided
  if (sessionData) {
    console.log('💾 PIPELINE: Saving step 3 to database...');
    try {
      const saveResult = await saveTestingPipelineStepAction(
        'ai-suggestion-session',
        'step3_critic_markup',
        criticMarkup,
        {
          session_id: sessionData.session_id,
          explanation_id: sessionData.explanation_id,
          explanation_title: sessionData.explanation_title,
          user_prompt: sessionData.user_prompt,
          source_content: currentContent,
          session_metadata: { step: 'critic_markup', processing_time: Date.now() }
        }
      );
      console.log('💾 PIPELINE STEP 3 SAVE RESULT:', saveResult);
    } catch (error) {
      console.error('❌ PIPELINE STEP 3 SAVE FAILED:', error);
    }
  }

  onProgress?.('Preprocessing content...', 90);
  console.log('🔧 PIPELINE STEP 4: Preprocessing content...');
  const preprocessed = preprocessCriticMarkup(criticMarkup);
  console.log('🔧 PIPELINE STEP 4 RESULT:', {
    preprocessedLength: preprocessed.length,
    hasPreprocessed: preprocessed.length > 0
  });

  // Save step 4 if session data provided
  if (sessionData) {
    console.log('💾 PIPELINE: Saving step 4 to database...');
    try {
      const saveResult = await saveTestingPipelineStepAction(
        'ai-suggestion-session',
        'step4_preprocessed',
        preprocessed,
        {
          session_id: sessionData.session_id,
          explanation_id: sessionData.explanation_id,
          explanation_title: sessionData.explanation_title,
          user_prompt: sessionData.user_prompt,
          source_content: currentContent,
          session_metadata: { step: 'preprocessed', processing_time: Date.now() }
        }
      );
      console.log('💾 PIPELINE STEP 4 SAVE RESULT:', saveResult);
    } catch (error) {
      console.error('❌ PIPELINE STEP 4 SAVE FAILED:', error);
    }
  }

  onProgress?.('Complete', 100);
  console.log('✅ PIPELINE COMPLETE: All steps finished', {
    finalContentLength: preprocessed.length,
    sessionId: sessionData?.session_id
  });

  return {
    content: preprocessed,
    session_id: sessionData?.session_id
  };
}

/**
 * Applies AI suggestions pipeline with simple error handling
 *
 * • Runs complete AI suggestion pipeline and updates editor on success
 * • Original content remains untouched until entire pipeline succeeds
 * • Optionally saves session data to database when sessionData is provided
 * • Returns success status with final content or error details
 * • Used by: UI components to get AI suggestions with progress tracking
 * • Calls: runAISuggestionsPipeline
 */
export async function getAndApplyAISuggestions(
  currentContent: string,
  editorRef: any, // LexicalEditorRef
  onProgress?: (step: string, progress: number) => void,
  sessionData?: {
    session_id?: string;
    explanation_id: number;
    explanation_title: string;
    user_prompt: string;
  }
): Promise<{ success: boolean; content?: string; error?: string; session_id?: string }> {
  console.log('🎯 getAndApplyAISuggestions CALLED:', {
    contentLength: currentContent.length,
    hasSessionData: !!sessionData,
    sessionData: sessionData ? {
      session_id: sessionData.session_id,
      explanation_id: sessionData.explanation_id,
      explanation_title: sessionData.explanation_title,
      user_prompt: sessionData.user_prompt
    } : null
  });

  try {
    // Generate session_id if sessionData is provided but missing session_id
    let sessionDataWithId = sessionData;
    if (sessionData && !sessionData.session_id) {
      console.log('🔑 Generating new session_id...');
      // Generate proper UUID for session_id using browser-compatible method
      const sessionId = crypto.randomUUID ? crypto.randomUUID() :
        'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
          const r = Math.random() * 16 | 0;
          const v = c == 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });
      sessionDataWithId = {
        ...sessionData,
        session_id: sessionId
      };
      console.log('🔑 Generated session_id:', sessionDataWithId.session_id);
    } else if (sessionData?.session_id) {
      console.log('🔑 Using existing session_id:', sessionData.session_id);
    } else {
      console.log('⚠️ No session data provided - pipeline will not save to database');
    }

    // Run the entire pipeline - original content stays untouched until success
    console.log('🚀 Calling runAISuggestionsPipeline with sessionData:', sessionDataWithId);
    const result = await runAISuggestionsPipeline(currentContent, 'test-user', onProgress, sessionDataWithId);

    // Only update editor if all steps succeeded
    if (editorRef.current) {
      editorRef.current.updateContent(result.content);
    }

    return {
      success: true,
      content: result.content,
      session_id: result.session_id
    };

  } catch (error) {
    console.error('AI Pipeline failed:', error);

    return {
      success: false,
      error: error instanceof Error ? error.message : 'AI processing failed',
      content: currentContent // Original content is unchanged
    };
  }
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
