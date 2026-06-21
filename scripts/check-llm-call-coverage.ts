// CI coverage guard: every LLM call must route through the attributed chokepoint
// (callLLM → saveLlmCallTracking) so its spend is captured. This catches the bypass class
// that the `require-llm-call-source` ESLint rule CANNOT see — direct provider-SDK calls
// (`chat.completions.create` / `messages.create`) and direct `llmCallTracking` inserts in
// files that import the SDK under a LOCAL `callLLM` helper (the rule skips local helpers).
//
// It fails on any NEW file matching a bypass pattern that is not in ALLOWLIST. The allowlist
// is the documented audit record of currently-accepted bypasses (the chokepoint itself, a
// documented self-tracker, and dev-only benchmark/local-run scripts). Adding a new uncaptured
// LLM-call path fails CI until it is either routed through callLLM or consciously allowlisted.
//
// Run: npm run check:llm-coverage  (wired into `npm run lint`).

import fs from 'fs';
import path from 'path';

/** Patterns that indicate an LLM call / spend write OUTSIDE the attributed chokepoint. */
const BYPASS_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'openai-sdk-direct', re: /\.chat\.completions\.create\s*\(/ },
  { name: 'anthropic-sdk-direct', re: /\.messages\.create\s*\(/ },
  // from('llmCallTracking') ... .insert( — a direct spend-row write bypassing saveLlmCallTracking.
  { name: 'tracking-insert-direct', re: /from\(\s*['"]llmCallTracking['"]\s*\)[\s\S]{0,120}?\.insert\s*\(/ },
];

/**
 * Files allowed to contain bypass patterns. KEEP THIS LIST SHORT and documented — each entry is
 * an accepted exception, not a TODO. Paths are repo-relative (POSIX separators).
 */
export const ALLOWLIST = new Set<string>([
  // THE attributed chokepoint — the one place the SDK is called + the canonical tracking write.
  'src/lib/services/llms.ts',
  // Documented self-tracker: multi-provider direct-SDK content tool. Tracks via its own
  // trackLLMCall (bounded call_source, loud catch, is_test derived). debug_llm_spending_…_20260621.
  'evolution/scripts/lib/oneshotGenerator.ts',
  // Dev-only local evolution runner (not a deployed spend path).
  'evolution/scripts/run-evolution-local.ts',
  // Ad-hoc model benchmark / probe scripts (dev-only, run by hand; no production spend path).
  'evolution/scripts/test-qwen3-thinking.ts',
  'evolution/scripts/test-oss20b-thinking.ts',
  'evolution/scripts/test-judge-models-v2.ts',
  'evolution/scripts/benchmark-latency.ts',
]);

/** True for files we never scan (tests, mocks, type defs). */
export function isExempt(relPath: string): boolean {
  return (
    /\.test\.ts$/.test(relPath) ||
    /\.spec\.ts$/.test(relPath) ||
    /(^|\/)__tests__\//.test(relPath) ||
    /(^|\/)testing\//.test(relPath) ||
    /(^|\/)mocks\//.test(relPath) ||
    /\.d\.ts$/.test(relPath)
  );
}

export interface Violation { file: string; pattern: string }

/** Pure core: given {path, content} entries, return bypass violations (excludes allowlist/exempt). */
export function findViolations(files: { path: string; content: string }[]): Violation[] {
  const violations: Violation[] = [];
  for (const { path: relPath, content } of files) {
    if (ALLOWLIST.has(relPath) || isExempt(relPath)) continue;
    for (const { name, re } of BYPASS_PATTERNS) {
      if (re.test(content)) violations.push({ file: relPath, pattern: name });
    }
  }
  return violations;
}

function walk(dir: string, root: string, out: { path: string; content: string }[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(abs, root, out);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push({ path: path.relative(root, abs).split(path.sep).join('/'), content: fs.readFileSync(abs, 'utf8') });
    }
  }
}

function main(): void {
  const root = process.cwd();
  const files: { path: string; content: string }[] = [];
  for (const sub of ['src', 'evolution']) {
    const dir = path.join(root, sub);
    if (fs.existsSync(dir)) walk(dir, root, files);
  }
  const violations = findViolations(files);
  if (violations.length > 0) {
    console.error('✗ LLM-call coverage guard: found un-attributed LLM-call / spend-write path(s):');
    for (const v of violations) {
      console.error(`  ${v.file}  [${v.pattern}]`);
    }
    console.error('\nRoute the call through callLLM (src/lib/services/llms.ts) so its spend is tracked,');
    console.error('or — if it is a genuine accepted exception — add it to ALLOWLIST in scripts/check-llm-call-coverage.ts with a comment.');
    process.exit(1);
  }
  console.log(`✓ LLM-call coverage guard: scanned ${files.length} files, no un-attributed bypass paths.`);
}

// Only run when invoked directly (not when imported by the unit test).
if (require.main === module) {
  main();
}
