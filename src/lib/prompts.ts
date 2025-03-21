/**
 * Creates an explanation prompt by combining the base prompt template with user input
 * 
 * @param userInput - The topic or subject to be explained
 * @returns A formatted prompt string
 */
export function createExplanationPrompt(userInput: string): string {
    const basePrompt = `Write a clear, concise explanation of the topic below.

Rules:
- Always format using Markdown
- For inline math using single dollars: $\frac{2}{5}$, for block math use double dollars 
$$(expession)$$
- Make sure to have a title, and section headers
- Use lists and bullet points where necessary

Topic: ${userInput}`;

    return basePrompt;
} 