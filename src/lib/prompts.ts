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

//- Use lists and bullet points where necessary