// Shared format rules injected into all text-generation prompts.
// Enforces prose-only output (no bullets, lists, or tables).

export const FORMAT_RULES = `
=== OUTPUT FORMAT RULES (MANDATORY — violations cause rejection) ===
Start with a single H1 title using the Markdown "# Title" syntax. Use Markdown headings at the ## or ### level to introduce each new section or topic shift. Write in complete paragraphs of two or more sentences each, separated by blank lines. Never use bullet points, numbered lists, or tables anywhere in the output. Every block of body text must be a full paragraph.
===================================================================
`;
