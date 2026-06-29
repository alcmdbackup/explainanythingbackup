// Pre-Registered Analysis Plan (PRAP) validator — pure functions consumed by
// /run_experiment_analysis Step 1 pre-flight to refuse runs whose _planning.md
// has a PRAP header but trivially empty/bypass content (decision_loop iter 2 fix).

const SECTION_HEADER = '## Pre-Registered Analysis Plan';
const NAMED_TESTS = [
  'test:',
  'Mann-Whitney',
  'McNemar',
  'Bootstrap',
  'Spearman',
  'permutation',
];

export interface PrapValidationResult {
  valid: boolean;
  missingMarkers: string[];
}

/** Extract the PRAP section body (between the PRAP H2 and the next H2 or EOF). Returns null if header absent. */
export function extractPrapBody(planningDocText: string): string | null {
  const lines = planningDocText.split('\n');
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim() === SECTION_HEADER) {
      startIdx = i + 1;
      break;
    }
  }
  if (startIdx === -1) return null;

  let endIdx = lines.length;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^## /.test(line)) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join('\n');
}

/** Validate PRAP body contains all minimum-content tokens (case-insensitive): arms, threshold, AND one named test. */
export function validatePrap(planningDocText: string): PrapValidationResult {
  const body = extractPrapBody(planningDocText);
  if (body === null) {
    return { valid: false, missingMarkers: ['header (## Pre-Registered Analysis Plan)'] };
  }
  const bodyLc = body.toLowerCase();
  const missing: string[] = [];
  if (!/\barms\b/i.test(body)) missing.push('arms');
  if (!/\bthreshold\b/i.test(body)) missing.push('threshold');
  const hasTest = NAMED_TESTS.some((t) => bodyLc.includes(t.toLowerCase()));
  if (!hasTest) missing.push(`named test (one of: ${NAMED_TESTS.join(', ')})`);
  return { valid: missing.length === 0, missingMarkers: missing };
}

// CLI mode: `npx tsx scripts/skills/prap-validator.ts <path-to-planning.md>`
// Exits 0 if valid, 1 if invalid. Prints JSON to stdout.
if (require.main === module) {
  const planPath: string | undefined = process.argv[2];
  if (!planPath) {
    console.error('Usage: prap-validator.ts <path-to-_planning.md>');
    process.exit(2);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs');
    const text = fs.readFileSync(planPath, 'utf8');
    const result = validatePrap(text);
    console.log(JSON.stringify(result));
    process.exit(result.valid ? 0 : 1);
  }
}
