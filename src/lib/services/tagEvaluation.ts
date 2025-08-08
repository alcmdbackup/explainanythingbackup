'use server'

import { callOpenAIModel } from '@/lib/services/llms';
import { logger } from '@/lib/server_utilities';
import { tagEvaluationSchema } from '@/lib/schemas/schemas';
import { createTagEvaluationPrompt } from '@/lib/prompts';

const FILE_DEBUG = false;

// Custom error types for better error handling
type ErrorResponse = {
    code: string;
    message: string;
    details?: any;
};



/**
 * Evaluates multiple tags for an explanation using AI
 * 
 * • Takes explanation title and content as input for AI analysis
 * • Creates structured prompt for comprehensive tag evaluation
 * • Calls OpenAI GPT-4 model with tagEvaluationSchema for validation
 * • Returns difficulty level (1-3), length (4-6), and simple tags array
 * • Used by generateExplanation service for automatic multi-tag assignment
 * • Calls createTagEvaluationPrompt and callOpenAIModel functions
 */
export async function evaluateTags(
  explanationTitle: string,
  explanationContent: string,
  userid: string
): Promise<{
  difficultyLevel: number | null,
  length: number | null,
  simpleTags: number[] | null,
  error: ErrorResponse | null
}> {
  try {
    // Create the prompt for tag evaluation
    const evaluationPrompt = createTagEvaluationPrompt(explanationTitle, explanationContent);
    
    // Call the LLM with the schema to force structured response
    logger.debug('Calling GPT-4 for tag evaluation', { 
      prompt_length: evaluationPrompt.length,
      title: explanationTitle 
    });
    
    const result = await callOpenAIModel(
      evaluationPrompt, 
      'evaluateTags', 
      userid, 
      "gpt-4o-mini",
      false,      
      null,                  // streaming parameter
      tagEvaluationSchema, 
      'tagEvaluation'
    );
    
    // Parse the result
    const parsedResult = tagEvaluationSchema.safeParse(JSON.parse(result));

    if (!parsedResult.success) {
      logger.debug('Tag evaluation schema validation failed', { 
        errors: parsedResult.error.errors 
      });
      return {
        difficultyLevel: null,
        length: null,
        simpleTags: null,
        error: {
          code: 'INVALID_RESPONSE',
          message: 'AI response for tag evaluation did not match expected format',
          details: parsedResult.error
        }
      };
    }
    
    const { difficultyLevel, length, simpleTags } = parsedResult.data;
    
    logger.debug('Successfully evaluated explanation tags', {
      difficulty_level: difficultyLevel,
      length: length,
      simple_tags: simpleTags,
      title: explanationTitle
    });
    
    return { 
      difficultyLevel, 
      length,
      simpleTags,
      error: null 
    };
  } catch (error) {
    logger.error('Error in evaluateTags', {
      error_message: error instanceof Error ? error.message : 'Unknown error',
      title: explanationTitle
    });
    
    return {
      difficultyLevel: null,
      length: null,
      simpleTags: null,
      error: {
        code: 'TAG_EVALUATION_ERROR',
        message: 'Failed to evaluate explanation tags',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    };
  }
} 