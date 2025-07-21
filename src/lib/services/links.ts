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
  userid: string,
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

    // Console log the input parameters for callGPT4omini
    console.log('callGPT4omini parameters for section title:', {
      prompt,
      operation: 'generateStandaloneSubsectionTitle',
      userid,
      param4: null,
      param5: null,
      debug
    });

    const aiTitle = await callGPT4omini(prompt, 'generateStandaloneSubsectionTitle', userid, null, null, debug);
    
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

/**
 * Enhances markdown content by converting headings to clickable standalone links
 * 
 * • Parses markdown content for h2 and h3 headings using regex
 * • Generates standalone titles for each heading using AI enhancement
 * • Replaces headings with markdown links pointing to standalone explanations
 * • Processes headings in reverse order to maintain string positions during replacement
 * • Gracefully handles errors by preserving original headings when generation fails
 * 
 * Used by: generateExplanation (to enhance content before saving to database)
 * Calls: generateStandaloneSubsectionTitle, logger.error
 */
export async function enhanceContentWithHeadingLinks(
  content: string, 
  articleTitle: string,
  userid:string, 
  debug: boolean = false
): Promise<Record<string, string>> {
  // Regex to match h2 and h3 headings: ## Title or ### Title
  const headingRegex = /^(#{2,3})\s+(.+)$/gm;
  const matches = [...content.matchAll(headingRegex)];
  
  if (matches.length === 0) {
    if (debug) {
      logger.debug('No headings found to enhance with standalone links');
    }
    return {}; // No headings to process
  }

  if (debug) {
    logger.debug(`Found ${matches.length} headings to enhance with standalone links`, {
      articleTitle,
      headings: matches.map(m => m[2].trim())
    });
  }

  // Generate all standalone titles in parallel
  const titleGenerationPromises = matches.map(async (match, index) => {
    const [, , headingText] = match;
    try {
      const standaloneTitle = await generateStandaloneSubsectionTitle(
        articleTitle,
        headingText.trim(),
        userid,
        debug
      );
      return { index, standaloneTitle, error: null };
    } catch (error) {
      if (debug) {
        logger.error('Failed to generate standalone title for heading', {
          headingText: headingText.trim(),
          error: error instanceof Error ? error.message : String(error)
        });
      }
      return { index, standaloneTitle: null, error };
    }
  });

  const titleResults = await Promise.all(titleGenerationPromises);
  
  const headingMappings: Record<string, string> = {};
  
  // Create mappings from original headings to linked headings
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const [fullMatch, hashes, headingText] = match;
    const titleResult = titleResults[i];
    
    if (titleResult.standaloneTitle && !titleResult.error) {
      // Create markdown link: ## [Original Title](/standalone-title?t=encoded+title)
      const encodedTitle = encodeURIComponent(titleResult.standaloneTitle);
      const linkedHeading = `${hashes} [${headingText.trim()}](/standalone-title?t=${encodedTitle})`;
      
      // Store mapping from original heading to linked heading
      headingMappings[fullMatch] = linkedHeading;
      
      if (debug) {
        logger.debug('Created heading mapping', {
          original: fullMatch,
          linked: linkedHeading,
          standalone: titleResult.standaloneTitle
        });
      }
    }
    // If title generation failed, no mapping is created (original heading will be kept)
  }
  
  if (debug) {
    logger.debug('Heading mappings generation complete', {
      totalHeadings: matches.length,
      successfulMappings: Object.keys(headingMappings).length
    });
  }
  
  return headingMappings;
} 

/**
 * Creates a prompt for enhancing content with inline links to key concepts
 * 
 * • Generates structured instructions for LLM to identify key terms and concepts
 * • Specifies link format matching enhanceContentWithStandaloneLinks (/standalone-title?t=encoded+title)
 * • Instructs LLM to ignore headings (lines starting with #) and focus on inline content
 * • Provides clear guidelines for creating appropriate standalone titles
 * • Used with callGPT4omini to automatically enhance content with relevant links
 * 
 * Used by: content enhancement workflows requiring inline link generation
 * Calls: none (returns prompt string for LLM processing)
 */
export function createLinksInContentPrompt(content: string): string {
  return `You are tasked with enhancing markdown content by adding links to key concepts and terms.

CONTENT TO ENHANCE:
${content}

INSTRUCTIONS:
1. Identify a select few important concepts, technical terms, and key ideas within the content
2. DO NOT modify or link any headings (lines that start with #)
3. Convert identified terms into markdown links using this exact format: [term](/standalone-title?t=encoded+title)
4. For each linked term, create an appropriate standalone title that:
   - Is 2-6 words long
   - Makes complete sense without context
   - Follows Wikipedia-style naming conventions
   - Is specific and searchable
   - URL encode the title for the ?t= parameter

EXAMPLES:
- "Lionel Messi is fantastic at shooting" → "Lionel Messi is fantastic at [shooting](/standalone-title?t=Shooting%20(soccer))"
- "The brain's neural networks process information" → "The brain's [neural networks](/standalone-title?t=Biological%20Neural%20Networks) process information"
- "Before training the model, data preprocessing is essential" → "Before training the model, [data preprocessing](/standalone-title?t=Machine%20Learning%20Data%20Preparation) is essential"

GUIDELINES:
- Only link terms that would benefit from additional explanation
- Only link the most absolutely critical terms, limit to 1-3 per paragraph
- Preserve all original formatting and structure
- Keep headings (# ## ###) exactly as they are
- Ensure the enhanced content reads naturally

Return the enhanced content with inline links added. Do not include any explanatory text, just return the processed content.`;
}

/**
 * Enhances markdown content by adding inline links to key concepts using AI
 * 
 * • Takes raw markdown content and identifies important terms and concepts
 * • Uses createLinksInContentPrompt to generate structured AI instructions
 * • Calls callGPT4omini to process content and add appropriate inline links
 * • Returns enhanced content with clickable links to standalone explanations
 * • Preserves original formatting while adding 3-8 key concept links per section
 * 
 * Used by: content processing workflows requiring automated link enhancement
 * Calls: createLinksInContentPrompt, callGPT4omini, logger.debug, logger.error
 */
export async function enhanceContentWithInlineLinks(
  content: string,
  userid: string,
  debug: boolean = false
): Promise<string> {
  if (!content?.trim()) {
    throw new Error('Content is required');
  }

  try {
    if (debug) {
      logger.debug('Enhancing content with inline links', {
        contentLength: content.length
      });
    }

    // Generate the prompt for AI to add inline links
    const prompt = createLinksInContentPrompt(content);

    // Call GPT-4o-mini to enhance the content
    const enhancedContent = await callGPT4omini(prompt, 'enhanceContentWithInlineLinks', userid, null, null, debug);

    if (debug) {
      logger.debug('Content enhanced with inline links', {
        originalLength: content.length,
        enhancedLength: enhancedContent.length
      });
    }

    return enhancedContent.trim();

  } catch (error) {
    if (debug) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error enhancing content with inline links: ${errorMessage}`);
    }
    
    // Fallback: return original content if AI enhancement fails
    return content;
  }
} 