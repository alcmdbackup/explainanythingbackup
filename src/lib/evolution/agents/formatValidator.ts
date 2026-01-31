// Format validator checking article text against formatting rules.
// Controlled by FORMAT_VALIDATION_MODE env var: "reject" (default), "warn", or "off".

export interface FormatResult {
  valid: boolean;
  issues: string[];
}

function getValidationMode(): string {
  return process.env.FORMAT_VALIDATION_MODE ?? 'reject';
}

/** Validate article text format. Returns issues; empty issues + valid=true means compliant. */
export function validateFormat(text: string): FormatResult {
  const mode = getValidationMode();
  if (mode === 'off') return { valid: true, issues: [] };

  const issues: string[] = [];
  if (!text.trim()) return { valid: false, issues: ['Empty text'] };

  const lines = text.trim().split('\n');

  // Rule 1: Exactly one H1 title on the first non-empty line
  const h1Lines = lines.reduce<number[]>((acc, line, i) => {
    if (line.startsWith('# ') && !line.startsWith('## ')) acc.push(i);
    return acc;
  }, []);

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

  // Strip fenced code blocks before checking bullets/lists/tables
  let textNoCode = text.replace(/```[\s\S]*?```/g, '');
  textNoCode = textNoCode.replace(/```[\s\S]*$/g, '');

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
  const blocks = textNoCode
    .split('\n\n')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const paragraphs: string[] = [];
  for (const block of blocks) {
    if (block.startsWith('#')) continue;
    if (/^[-*_](\s*[-*_]){2,}\s*$/.test(block)) continue;
    if (/^\*[^*\n]+\*$/.test(block)) continue;
    if (block.trim().endsWith(':')) continue;
    paragraphs.push(block);
  }

  let shortCount = 0;
  for (const para of paragraphs) {
    const sentences = (para.match(/[.!?][""\u201d\u2019]?(?:\s|$)/g) ?? []).length;
    if (sentences < 2) shortCount++;
  }

  if (paragraphs.length > 0 && shortCount / paragraphs.length > 0.25) {
    issues.push(`${shortCount}/${paragraphs.length} paragraphs with <2 sentences`);
  }

  if (mode === 'warn') return { valid: true, issues };
  return { valid: issues.length === 0, issues };
}
