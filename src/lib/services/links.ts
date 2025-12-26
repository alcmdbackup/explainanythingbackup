import { callOpenAIModel, default_model } from '@/lib/services/llms';
import { logger } from '@/lib/server_utilities';
import { createStandaloneTitlePrompt } from '@/lib/prompts';
import { multipleStandaloneTitlesSchema, type MultipleStandaloneTitlesType } from '@/lib/schemas/schemas';

/**
 * Encodes a URL parameter for use in standalone title links
 *
 * • Uses encodeURIComponent as base encoding
 * • Additionally encodes parentheses which break markdown link parsing
 * • Ensures all characters that could interfere with markdown syntax are properly encoded
 * • Used specifically for /standalone-title?t= URL parameters
 */
export function encodeStandaloneTitleParam(title: string): string {
  // First apply standard URL encoding
  let encoded = encodeURIComponent(title);

  // Additionally encode parentheses which break markdown link parsing
  // encodeURIComponent doesn't encode these by default but they break markdown
  encoded = encoded.replace(/\(/g, '%28').replace(/\)/g, '%29');

  return encoded;
}

/**
 * Service for creating standalone subsection titles with context from article titles
 * 
 * Example usage:
 * ```typescript
 * // Generate AI-enhanced heading mappings
 * const headingMappings = await enhanceContentWithHeadingLinks(
 *   content, "Machine Learning Fundamentals", userid
 * );
 * // Returns: { "## Training Process": "## [Training Process](/standalone-title?t=Machine%20Learning%20Training)" }
 * ```
 */

/**
 * Enhances markdown content by converting headings to clickable standalone links
 * 
 * • Parses markdown content for h2 and h3 headings using regex
 * • Generates AI-enhanced standalone titles for all headings in a single batch call
 * • Creates mappings from original headings to linked headings with encoded URLs
 * • Uses structured output from GPT-4o-mini for consistent JSON responses
 * • Gracefully handles errors by preserving original headings when generation fails
 * 
 * Used by: returnExplanation (to enhance content before saving to database)
 * Calls: createStandaloneTitlePrompt, callOpenAIModel, logger.debug, logger.error
 */
export async function createMappingsHeadingsToLinks(
  content: string, 
  articleTitle: string,
  userid: string, 
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

  // Extract heading data for processing
  const headingData = matches.map(match => ({
    fullMatch: match[0],
    hashes: match[1],
    text: match[2].trim()
  }));

  if (debug) {
    logger.debug(`Found ${headingData.length} headings to enhance with standalone links`, {
      articleTitle,
      headings: headingData.map(h => h.text)
    });
  }

  try {
    // Generate standalone titles using AI with structured output
    if (!articleTitle?.trim()) {
      throw new Error('Article title is required');
    }

    const prompt = createStandaloneTitlePrompt(articleTitle, headingData.map(h => h.text));

    if (debug) {
      logger.debug('Generating standalone subsection titles', {
        articleTitle,
        subsectionCount: headingData.length,
        promptLength: prompt.length
      });
    }

    const aiResponse = await callOpenAIModel(
      prompt, 
      'enhanceContentWithHeadingLinks', 
      userid, 
      default_model, 
      false,
      null,
      multipleStandaloneTitlesSchema,
      'multipleStandaloneTitles',
      debug
    );
    
    // Parse structured response and create mappings
    const parsedResponse: MultipleStandaloneTitlesType = JSON.parse(aiResponse);
    const standaloneeTitles = parsedResponse.titles.map(title => title.trim().replace(/^["']|["']$/g, ''));
    
    const headingMappings: Record<string, string> = {};
    
    // Create mappings from original headings to linked headings
    for (let i = 0; i < headingData.length; i++) {
      const { fullMatch, hashes, text } = headingData[i];
      const standaloneTitle = standaloneeTitles[i];
      
      if (standaloneTitle) {
        // Create markdown link: ## [Original Title](/standalone-title?t=encoded+title)
        const encodedTitle = encodeStandaloneTitleParam(standaloneTitle);
        const linkedHeading = `${hashes} [${text}](/standalone-title?t=${encodedTitle})`;

        headingMappings[fullMatch] = linkedHeading;
        
        if (debug) {
          logger.debug('Created heading mapping', {
            original: fullMatch,
            linked: linkedHeading,
            standalone: standaloneTitle
          });
        }
      }
    }
    
    if (debug) {
      logger.debug('Heading enhancement complete', {
        totalHeadings: headingData.length,
        successfulMappings: Object.keys(headingMappings).length,
        originalTitles: headingData.map(h => h.text),
        generatedTitles: standaloneeTitles
      });
    }
    
    return headingMappings;
    
  } catch (error) {
    if (debug) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error enhancing content with heading links: ${errorMessage}`);
    }
    
    // Fallback: return empty mappings if processing fails
    return {};
  }
}

/**
 * Creates a prompt for enhancing content with inline links to key concepts
 * 
 * • Generates structured instructions for LLM to identify key terms and concepts
 * • Specifies link format matching enhanceContentWithStandaloneLinks (/standalone-title?t=encoded+title)
 * • Instructs LLM to ignore headings (lines starting with #) and focus on inline content
 * • Provides clear guidelines for creating appropriate standalone titles
 * • Used with callOpenAIModel to automatically enhance content with relevant links
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
 * • Calls callOpenAIModel to process content and add appropriate inline links
 * • Returns enhanced content with clickable links to standalone explanations
 * • Preserves original formatting while adding 3-8 key concept links per section
 * 
 * Used by: content processing workflows requiring automated link enhancement
 * Calls: createLinksInContentPrompt, callOpenAIModel, logger.debug, logger.error
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
    const enhancedContent = await callOpenAIModel(prompt, 'enhanceContentWithInlineLinks', userid, default_model, false, null, null, null, debug);

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

/**
 * Cleans up content by removing **bold** patterns and replacing with just the term
 * 
 * • Finds all **term** patterns in the content
 * • Replaces each pattern with just the term inside (without the bold markers)
 * • Used after enhancement processing to clean up any remaining keyterm markers
 * • Ensures final content has clean, readable text without formatting artifacts
 * 
 * @param content - The content to clean up
 * @returns Content with **term** patterns replaced by just the term
 */
export function cleanupAfterEnhancements(content: string): string {
    // Regex to match **term** pattern and capture the term
    const keyTermPattern = /\*\*([^*]+)\*\*/g;
    
    // Replace all **term** with just the term
    return content.replace(keyTermPattern, '$1');
} 