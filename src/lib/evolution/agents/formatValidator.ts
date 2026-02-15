// Format validator checking article text against formatting rules.
// Controlled by FORMAT_VALIDATION_MODE env var: "reject" (default), "warn", or "off".

export interface FormatResult {
  valid: boolean;
  issues: string[];
}

function getValidationMode(): string {
  return process.env.FORMAT_VALIDATION_MODE ?? 'reject';
}

function findH1Lines(lines: string[]): number[] {
  const h1Lines: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('# ') && !lines[i].startsWith('## ')) {
      h1Lines.push(i);
    }
  }
  return h1Lines;
}

/** Validate article text format. Returns issues; empty issues + valid=true means compliant. */
export function validateFormat(text: string): FormatResult {
  const mode = getValidationMode();
  if (mode === 'off') return { valid: true, issues: [] };

  const issues: string[] = [];
  if (!text.trim()) return { valid: false, issues: ['Empty text'] };

  const lines = text.trim().split('\n');

  // Rule 1: Exactly one H1 title on the first non-empty line
  const h1Lines = findH1Lines(lines);

  if (h1Lines.length === 0) {
    issues.push('Missing H1 title');
  } else if (h1Lines.length > 1) {
    issues.push(`Multiple H1 titles (lines ${h1Lines.join(', ')})`);
  } else if (h1Lines[0] !== 0) {
    const firstNonempty = lines.findIndex((l) => l.trim().length > 0);
    if (h1Lines[0] !== firstNonempty) {
      issues.push('H1 title is not on the first line');
    }
  }

  // Rule 2: Must have section headings (## or ###)
  const hasSectionHeadings = lines.some((l) => l.startsWith('## ') || l.startsWith('### '));
  if (!hasSectionHeadings) {
    issues.push('No section headings (## or ###)');
  }

  // Strip fenced code blocks before checking bullets/lists/tables.
  // PARSE-6: First strip matched pairs, then only strip a truly unclosed trailing fence.
  let textNoCode = text.replace(/```[\s\S]*?```/g, '');
  // Only strip from an unclosed fence to EOF if one actually exists after pair removal
  const remainingFences = (textNoCode.match(/```/g) ?? []).length;
  if (remainingFences > 0) {
    textNoCode = textNoCode.replace(/```[\s\S]*$/, '');
  }

  // Strip horizontal rules before bullet check
  const textNoHr = textNoCode.replace(/^\s*[-*_](\s*[-*_]){2,}\s*$/gm, '');

  // Rule 3a: No bullet points or numbered lists
  if (/^\s*[-*+]\s/m.test(textNoHr)) {
    issues.push('Contains bullet points');
  }
  if (/^\s*\d+[.)]\s/m.test(textNoHr)) {
    issues.push('Contains numbered lists');
  }

  // Rule 3b: No tables
  if (/^\|.+\|/m.test(textNoCode)) {
    issues.push('Contains tables');
  }

  // Rule 4: Paragraphs must have 2+ sentences (with 25% tolerance)
  const blocks = textNoCode.split('\n\n').map((p) => p.trim()).filter((p) => p.length > 0);

  const paragraphs: string[] = [];
  for (const block of blocks) {
    // Skip non-paragraph blocks: headings, rules, emphasis lines, labels
    if (block.startsWith('#')) continue;
    if (/^[-*_](\s*[-*_]){2,}\s*$/.test(block)) continue;
    if (/^\*[^*\n]+\*$/.test(block)) continue;
    if (block.trim().endsWith(':')) continue;
    paragraphs.push(block);
  }

  // Count paragraphs with fewer than 2 sentences
  let shortCount = 0;
  for (const para of paragraphs) {
    const sentencePattern = /[.!?][""\u201d\u2019]?(?:\s|$)/g;
    const sentences = (para.match(sentencePattern) ?? []).length;
    if (sentences < 2) shortCount++;
  }

  if (paragraphs.length > 0 && shortCount / paragraphs.length > 0.25) {
    issues.push(`${shortCount}/${paragraphs.length} paragraphs with <2 sentences`);
  }

  if (mode === 'warn') return { valid: true, issues };
  return { valid: issues.length === 0, issues };
}
