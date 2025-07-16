import { callGPT4omini } from '@/lib/services/llms';
import { logger } from '@/lib/server_utilities';

/**
 * Service for creating standalone subsection titles with context from article titles
 * 
 * Example usage:
 * ```typescript
 * // Generate AI-enhanced standalone title
 * const enhancedTitle = await generateStandaloneSubsectionTitle(
 *   "Machine Learning Fundamentals",
 *   "Training Process"
 * );
 * // Returns: "Machine Learning Model Training Process"
 * ```
 */

/**
 * Creates a prompt for generating standalone subsection titles
 * - Formats article and subsection titles into structured AI prompt
 * - Provides clear instructions for Wikipedia-style title creation
 * - Specifies output format and constraints for consistent results
 * - Used by generateStandaloneSubsectionTitle for AI processing
 * - Returns formatted prompt string ready for LLM consumption
 */
function createStandaloneTitlePrompt(
  articleTitle: string,
  subsectionTitle: string
): string {
  return `You are tasked with creating a Wikipedia-style standalone title.

Original Article Title: "${articleTitle}"
Original Subsection Title: "${subsectionTitle}"

Create a concise, descriptive title (2-6 words) that:
1. Makes complete sense without reading the original article
2. Follows Wikipedia title conventions (proper capitalization, clear and specific)
3. Captures the essence of what this subsection covers
4. Combines context from the article title with the subsection content
5. Is searchable and discoverable on its own

Return ONLY the title, no quotation marks or additional text.`;
}

/**
 * Generates an AI-enhanced standalone subsection title using GPT-4o-mini
 * - Takes raw article title and subsection title as direct inputs
 * - Uses createStandaloneTitlePrompt to generate structured prompt
 * - Calls callGPT4omini with specific instructions for title formatting
 * - Returns clean, descriptive title that makes sense without article context
 * - Used when creating cross-references or standalone content links
 */
export async function generateStandaloneSubsectionTitle(
  articleTitle: string,
  subsectionTitle: string,
  debug: boolean = false
): Promise<string> {
  if (!articleTitle?.trim() || !subsectionTitle?.trim()) {
    throw new Error('Both articleTitle and subsectionTitle are required');
  }

  try {
    // Create a prompt for the AI to create a standalone title
    const prompt = createStandaloneTitlePrompt(articleTitle, subsectionTitle);

    if (debug) {
      logger.debug('Generating standalone subsection title', {
        articleTitle,
        subsectionTitle,
        promptLength: prompt.length
      });
    }

    const aiTitle = await callGPT4omini(prompt, null, null, debug);
    
    // Clean the response (remove quotes, trim, etc.)
    const cleanTitle = aiTitle.trim().replace(/^["']|["']$/g, '');
    
    if (debug) {
      logger.debug('Generated standalone title', {
        original: subsectionTitle,
        aiGenerated: cleanTitle
      });
    }
    
    return cleanTitle;
    
  } catch (error) {
    if (debug) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error generating standalone subsection title: ${errorMessage}`);
    }
    
    // Fallback: return subsection title as-is if AI call fails
    return subsectionTitle.trim();
  }
} 