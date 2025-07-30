'use server'

import { callOpenAIModel } from '@/lib/services/llms';
import { logger } from '@/lib/server_utilities';
import { difficultyEvaluationSchema } from '@/lib/schemas/schemas';
import { createDifficultyEvaluationPrompt } from '@/lib/prompts';

const FILE_DEBUG = false;

// Custom error types for better error handling
type ErrorResponse = {
    code: string;
    message: string;
    details?: any;
};



/**
 * Key points:
 * - Uses LLM to evaluate explanation difficulty level
 * - Returns integer 1-3 representing beginner/normal/expert
 * - Validates response against difficultyEvaluationSchema
 * - Used by explanation management for content categorization
 * - Calls createDifficultyEvaluationPrompt and callOpenAIModel
 */
export async function evaluateExplanationDifficulty(
  explanationTitle: string,
  explanationContent: string,
  userid: string
): Promise<{
  difficultyLevel: number | null,
  error: ErrorResponse | null
}> {
  try {
    // Create the prompt for difficulty evaluation
    const evaluationPrompt = createDifficultyEvaluationPrompt(explanationTitle, explanationContent);
    
    // Call the LLM with the schema to force an integer response
    logger.debug('Calling GPT-4 for difficulty evaluation', { 
      prompt_length: evaluationPrompt.length,
      title: explanationTitle 
    });
    
    const result = await callOpenAIModel(
      evaluationPrompt, 
      'evaluateExplanationDifficulty', 
      userid, 
      "gpt-4o-mini",
      difficultyEvaluationSchema, 
      'difficultyEvaluation'
    );
    
    // Parse the result
    const parsedResult = difficultyEvaluationSchema.safeParse(JSON.parse(result));

    if (!parsedResult.success) {
      logger.debug('Difficulty evaluation schema validation failed', { 
        errors: parsedResult.error.errors 
      });
      return {
        difficultyLevel: null,
        error: {
          code: 'INVALID_RESPONSE',
          message: 'AI response for difficulty evaluation did not match expected format',
          details: parsedResult.error
        }
      };
    }
    
    const difficultyLevel = parsedResult.data.difficultyLevel;
    
    logger.debug('Successfully evaluated explanation difficulty', {
      difficulty_level: difficultyLevel,
      title: explanationTitle
    });
    
    return { 
      difficultyLevel, 
      error: null 
    };
  } catch (error) {
    logger.error('Error in evaluateExplanationDifficulty', {
      error_message: error instanceof Error ? error.message : 'Unknown error',
      title: explanationTitle
    });
    
    return {
      difficultyLevel: null,
      error: {
        code: 'DIFFICULTY_EVALUATION_ERROR',
        message: 'Failed to evaluate explanation difficulty',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    };
  }
} 