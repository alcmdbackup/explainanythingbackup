'use server'

import { callGPT4omini } from '@/lib/services/llms';
import { logger } from '@/lib/server_utilities';
import { difficultyEvaluationSchema } from '@/lib/schemas/schemas';

const FILE_DEBUG = false;

// Custom error types for better error handling
type ErrorResponse = {
    code: string;
    message: string;
    details?: any;
};

/**
 * Key points:
 * - Creates a prompt for LLM to evaluate explanation difficulty
 * - Provides clear criteria for beginner, normal, and expert levels
 * - Forces single integer response (1-3)
 * - Used by evaluateExplanationDifficulty for difficulty assessment
 */
function createDifficultyEvaluationPrompt(explanationTitle: string, explanationContent: string): string {
  return `
Please evaluate the difficulty level of the following explanation:

Title: "${explanationTitle}"

Content: "${explanationContent}"

Difficulty Levels:
- BEGINNER (1): Basic concepts, minimal prerequisites, simple language, introductory material
- NORMAL (2): Moderate complexity, some background knowledge helpful, standard terminology
- EXPERT (3): Advanced concepts, significant prerequisites, technical language, specialized knowledge required

Evaluate only based on the depth & technicality of the explanation, not the inherent difficult of the subject matter. 

Your response must be a single integer: 1 for beginner, 2 for normal, or 3 for expert.
`;
}

/**
 * Key points:
 * - Uses LLM to evaluate explanation difficulty level
 * - Returns integer 1-3 representing beginner/normal/expert
 * - Validates response against difficultyEvaluationSchema
 * - Used by explanation management for content categorization
 * - Calls createDifficultyEvaluationPrompt and callGPT4omini
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
    
    const result = await callGPT4omini(
      evaluationPrompt, 
      'evaluateExplanationDifficulty', 
      userid, 
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