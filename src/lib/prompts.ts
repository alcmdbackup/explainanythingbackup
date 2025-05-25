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
        '1. Make sure we focus only on the most important topic, not subtopics',
        '2. Use only nouns and prepositions. No adjectives, verbs, adverbs, conjunctions, or other parts of speech.',
        '3. Start with the most important terms. Prioritize core concepts (e.g., “Quantum Computers” before “Construction”).',
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