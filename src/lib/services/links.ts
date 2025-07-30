import { callOpenAIModel } from '@/lib/services/llms';
import { logger } from '@/lib/server_utilities';
import { createStandaloneTitlePrompt } from '@/lib/prompts';
import { multipleStandaloneTitlesSchema, type MultipleStandaloneTitlesType } from '@/lib/schemas/schemas';

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
 * Used by: generateExplanation (to enhance content before saving to database)
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
      "gpt-4o-mini", 
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
        const encodedTitle = encodeURIComponent(standaloneTitle);
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
 * Creates a prompt for generating standalone titles for key terms
 * 
 * • Takes structured key term data (term and sentence context) instead of full content
 * • Generates AI instructions to create appropriate standalone titles for each term
 * • Returns structured JSON response with mappings from original terms to standalone titles
 * • Uses same link format as enhanceContentWithHeadingLinks (/standalone-title?t=encoded+title)
 * • Designed to work with structured input for better AI performance and consistency
 * 
 * Used by: enhanceContentWithKeyTermLinks function for batch processing of key terms
 * Calls: none (returns prompt string for LLM processing)
 */
export function createKeyTermMappingPrompt(
  keyTermData: Array<{ term: string; sentence: string }>
): string {
  const termsJson = JSON.stringify(keyTermData, null, 2);
  
  return `You are tasked with creating standalone titles for key terms extracted from educational content.

KEY TERMS WITH CONTEXT:
${termsJson}

INSTRUCTIONS:
1. For each key term, create an appropriate standalone title that:
   - Is 2-6 words long
   - Makes complete sense without context
   - Follows Wikipedia-style naming conventions
   - Is specific and searchable
   - Would be useful for someone learning about this topic

2. Return a JSON object with this exact structure:
{
  "titles": [
    "Standalone Title 1",
    "Standalone Title 2",
    ...
  ]
}

EXAMPLES:
- For term "quarterback" in context "Tom Brady was the quarterback who won Super Bowl LV"
  → Standalone title: "Quarterback (American Football)"
- For term "neural networks" in context "The brain's neural networks process information"  
  → Standalone title: "Biological Neural Networks"
- For term "data preprocessing" in context "Before training the model, data preprocessing is essential"
  → Standalone title: "Machine Learning Data Preparation"

GUIDELINES:
- Create titles that would make sense as Wikipedia article titles
- Be specific enough to distinguish from other uses of the term
- Focus on the educational value and context provided
- Maintain consistency in naming style
- Each title should be self-contained and descriptive

Return only the JSON object with the standalone titles array.`;
}

/**
 * Enhances markdown content by converting @@$keyterm$@@ patterns to clickable links
 * 
 * • Parses content for key terms marked with @@$term$@@ pattern using exact regex matching
 * • Extracts each term with its full sentence context for better AI understanding
 * • Generates AI-enhanced standalone titles for all key terms in a single batch call
 * • Creates mappings from original @@$term$@@ patterns to markdown links with encoded URLs
 * • Uses structured output from GPT-4o-mini for consistent JSON responses
 * • Gracefully handles errors by preserving original patterns when generation fails
 * 
 * Used by: generateExplanation (to enhance content with key term links before saving)
 * Calls: createKeyTermMappingPrompt, callOpenAIModel, logger.debug, logger.error
 */
export async function createMappingsKeytermsToLinks(
  content: string,
  userid: string,
  debug: boolean = false
): Promise<Record<string, string>> {
  // Regex to match @@$keyterm$@@ pattern exactly
  const keyTermRegex = /@@\$([^$]+)\$@@/g;
  const matches = [...content.matchAll(keyTermRegex)];
  
  if (matches.length === 0) {
    if (debug) {
      logger.debug('No key terms found to enhance with standalone links');
    }
    return {}; // No key terms to process
  }

  // Extract key term data with sentence context
  const keyTermData = matches.map(match => {
    const fullMatch = match[0]; // @@$term$@@
    const term = match[1]; // the actual term
    const matchIndex = match.index || 0;
    
    // Find the sentence containing this term
    // Split content into sentences and find which one contains our match
    const sentences = content.split(/[.!?]+/);
    let sentence = '';
    let currentIndex = 0;
    
    for (const sent of sentences) {
      const sentenceEnd = currentIndex + sent.length;
      if (matchIndex >= currentIndex && matchIndex <= sentenceEnd) {
        sentence = sent.trim();
        break;
      }
      currentIndex = sentenceEnd + 1; // +1 for the delimiter
    }
    
    // Fallback: if sentence detection fails, use surrounding context
    if (!sentence) {
      const start = Math.max(0, matchIndex - 100);
      const end = Math.min(content.length, matchIndex + 100);
      sentence = content.slice(start, end).trim();
    }
    
    return {
      fullMatch,
      term,
      sentence: sentence || 'No context available'
    };
  });

  if (debug) {
    logger.debug(`Found ${keyTermData.length} key terms to enhance with standalone links`, {
      terms: keyTermData.map(kt => kt.term)
    });
  }

  try {
    // Generate standalone titles using AI with structured output
    const prompt = createKeyTermMappingPrompt(
      keyTermData.map(kt => ({ term: kt.term, sentence: kt.sentence }))
    );

    if (debug) {
      logger.debug('Generating standalone titles for key terms', {
        keyTermCount: keyTermData.length,
        promptLength: prompt.length
      });
    }

    const aiResponse = await callOpenAIModel(
      prompt,
      'enhanceContentWithKeyTermLinks',
      userid,
      "gpt-4o-mini",
      multipleStandaloneTitlesSchema,
      'multipleStandaloneTitles',
      debug
    );
    
    // Parse structured response and create mappings
    const parsedResponse: MultipleStandaloneTitlesType = JSON.parse(aiResponse);
    const standaloneTitles = parsedResponse.titles.map(title => title.trim().replace(/^["']|["']$/g, ''));
    
    const keyTermMappings: Record<string, string> = {};
    
    // Create mappings from original @@$term$@@ patterns to markdown links
    for (let i = 0; i < keyTermData.length; i++) {
      const { fullMatch, term } = keyTermData[i];
      const standaloneTitle = standaloneTitles[i];
      
      if (standaloneTitle) {
        // Create markdown link: [term](/standalone-title?t=encoded+title)
        const encodedTitle = encodeURIComponent(standaloneTitle);
        const linkedTerm = `[${term}](/standalone-title?t=${encodedTitle})`;
        
        keyTermMappings[fullMatch] = linkedTerm;
        
        if (debug) {
          logger.debug('Created key term mapping', {
            original: fullMatch,
            linked: linkedTerm,
            standalone: standaloneTitle
          });
        }
      }
    }
    
    if (debug) {
      logger.debug('Key term enhancement complete', {
        totalKeyTerms: keyTermData.length,
        successfulMappings: Object.keys(keyTermMappings).length,
        originalTerms: keyTermData.map(kt => kt.term),
        generatedTitles: standaloneTitles
      });
    }
    
    return keyTermMappings;
    
  } catch (error) {
    if (debug) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error enhancing content with key term links: ${errorMessage}`);
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
    const enhancedContent = await callOpenAIModel(prompt, 'enhanceContentWithInlineLinks', userid, "gpt-4o-mini", null, null, debug);

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