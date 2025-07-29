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
- Highlight a few key terms in every paragraph using syntax @@$keyterm$@@. Denote start using @@$, and the end using $@@. As an example, consider this sentence: Tom Brady was the @@$quarterback$@@ who won @@$Super Bowl LV$@@. 
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