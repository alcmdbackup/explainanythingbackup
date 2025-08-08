/**
 * Creates an explanation prompt by combining the base prompt template with user input
 * 
 * @param userInput - The topic or subject to be explained
 * @returns A formatted prompt string
 */
export function createExplanationPrompt(userInput: string): string {
    const basePrompt = `Write a clear, concise explanation of the topic below using modular paragraphs of 5-10 sentences each.

Output format:
- Title and content

Rules:
- Always format using Markdown. Content should not include anything larger than section headers (##)
- Highlight a few key terms in every paragraph using bold formatting **keyterm**. As an example, consider this sentence: Tom Brady was the **quarterback** who won **Super Bowl LV**. 
- For inline math using single dollars: $\frac{2}{5}$, for block math use double dollars 
$$(expession)$$
- Use lists and bullets sparingly


Topic: ${userInput}`;

    return basePrompt;
} 

/**
 * Creates a title prompt for generating article titles based on a user-supplied topic
 *
 * - Inserts the user topic under the Topic section, replacing the default question
 * - Returns a formatted prompt string with title rules and principles
 * - Used for generating title suggestions for a given topic
 * - Does not call any other functions
 * - Can be used by UI or backend to generate title prompts for LLMs
 */
export function createTitlePrompt(userInput: string): string {
    return [
        '### Prompt',
        '',
        '**Topic:**',
        '',
        `> *${userInput}*`,
        '',
        '**Task:**',
        'Guess the title for the encyclopedia article that would directly answer the user query above.',
        'Follow rules and principles below',
        '',
        '---',
        '',
        '### Title Rules',
        '',
        '1. Come up with a Wikipedia article title that could cover the prompt',
        '2. Prioritize the most concise title possible that clearly covers the prompt',
        //'1. Make sure we focus only on the most important topic, not subtopics',
        //'2. Use only nouns and prepositions. No adjectives, verbs, adverbs, conjunctions, or other parts of speech.',
        //'3. Make sure to use prepositions where appropriate',
        //'4. Start with the most important terms. Prioritize core concepts (e.g., “Quantum Computers” before “Construction”).',
        '',
        '---',
        '',
        '### Additional Principles',
        '',
        '| Principle        | Description                                               | Example                                                   |',
        '| ---------------- | --------------------------------------------------------- | --------------------------------------------------------- |',
        '| **Recognizable** | Instantly clear what the article is about                 | “United States” instead of “USA (nation‑state)”           |',
        '| **Natural**      | Use wording common in reliable sources, not forced syntax | “Barack Obama” rather than “Obama, Barack”                |',
        '| **Concise**      | Shorter is better, as long as it\'s clear                  | “World War II" instead of "The Second World War Conflict" |',
        '| **Precise**      | Specific enough to avoid confusion with similar topics    | "Mercury (element)" vs. "Mercury (planet)"                |',
        '| **Consistent**   | Matches naming patterns in the same topic area            | Use established Wikipedia or academic naming styles       |',
        '',
        '---',
        '',
    ].join('\n');
}

//- Use lists and bullet points where necessary

/**
 * Creates a prompt for generating multiple standalone subsection titles from multiple headings
 * 
 * • Takes article title and array of subsection titles as input
 * • Generates structured instructions for creating Wikipedia-style standalone titles
 * • Specifies output format as JSON array for structured response processing
 * • Instructs AI to create concise, descriptive titles that make sense without context
 * • Used with callOpenAIModel to batch process multiple headings efficiently
 * 
 * Used by: enhanceContentWithHeadingLinks for batch processing multiple headings
 * Calls: none (returns prompt string for LLM processing)
 */
export function createStandaloneTitlePrompt(
  articleTitle: string,
  subsectionTitles: string[]
): string {
  const titlesText = subsectionTitles.map((title, index) => `${index + 1}. "${title}"`).join('\n');
  
  return `You are tasked with creating Wikipedia-style standalone titles for multiple subsections.

Original Article Title: "${articleTitle}"

Original Subsection Titles:
${titlesText}

For each subsection title, create a concise, descriptive standalone title (2-6 words) that:
1. Makes complete sense without reading the original article
2. Follows Wikipedia title conventions (proper capitalization, clear and specific)
3. Captures the essence of what this subsection covers
4. Combines context from the article title with the subsection content
5. Is searchable and discoverable on its own

Return your response as a JSON object with a "titles" array containing the standalone titles in the same order as the input titles.

Example format:
{
  "titles": [
    "Machine Learning Model Training",
    "Neural Network Architecture",
    "Deep Learning Applications"
  ]
}`;
}

/**
 * Creates a prompt for LLM to select the best match from a list of potential sources
 * 
 * • Takes user query and formatted matches as input
 * • Generates instructions for LLM to select most relevant source
 * • Forces single integer response (0-5) for structured processing
 * • Returns 0 if no good match is found
 * • Used by findMatches service for intelligent match selection
 * 
 * @param userQuery - The original user query to match against
 * @param formattedMatches - Pre-formatted numbered list of potential matches
 * @returns A formatted prompt string for LLM processing
 */
export function createMatchSelectionPrompt(userQuery: string, formattedMatches: string): string {
  return `
User Query: "${userQuery}"

Below are the top 5 potential sources that might answer this query:

${formattedMatches}

Based on the user query, which ONE source (numbered 1-5) exactly matches the user query described above. 
Choose only the number of the most relevant source. If there is no match, then answer with 0.

Your response must be a single integer between 0 and 5.
`;
}

/**
 * Creates a prompt for LLM to evaluate explanation tags
 * 
 * • Takes explanation title and content as input
 * • Evaluates difficulty level (1-3), content length (4-6), and simple tags
 * • Forces structured JSON response for multiple tag assessments
 * • Evaluates based on content characteristics and teaching methods used
 * • Used by tagEvaluation service for comprehensive tag assessment
 * 
 * @param explanationTitle - The title of the explanation to evaluate
 * @param explanationContent - The full content of the explanation to evaluate
 * @returns A formatted prompt string for LLM processing
 */
export function createTagEvaluationPrompt(explanationTitle: string, explanationContent: string): string {
  return `
Please evaluate the following explanation for multiple tag categories:

Title: "${explanationTitle}"

Content: "${explanationContent}"

Evaluate the following aspects:

1. DIFFICULTY LEVEL (1-3):
- BEGINNER (1): Basic concepts, minimal prerequisites, simple language, introductory material
- NORMAL (2): Moderate complexity, some background knowledge helpful, standard terminology
- EXPERT (3): Advanced concepts, significant prerequisites, technical language, specialized knowledge required

2. CONTENT LENGTH (4-6):
- SHORT (4): Brief overview, key points only, under 500 words
- MEDIUM (5): Standard explanation, balanced detail, 500-1500 words
- LONG (6): Comprehensive coverage, extensive detail, over 1500 words

3. SIMPLE TAGS (array of tag IDs, or null):
Evaluate if the content contains these characteristics:
- has_example (7): Contains practical examples or case studies
- sequential (8): Presents information in step-by-step order
- has_metaphor (9): Uses analogies, metaphors, or comparisons
- instructional (10): Provides how-to instructions or procedures

Return your response as a JSON object with:
- difficultyLevel: integer (1-3)
- length: integer (4-6)
- simpleTags: array of integers (tag IDs) or null if none apply. Values here start at 7.

Example: {"difficultyLevel": 2, "length": 5, "simpleTags": [7, 8]}
`;
}