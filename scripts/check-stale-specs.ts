#!/usr/bin/env npx tsx
// Detects stale E2E specs that reference data-testid values no source file produces.
// Catches the class of bug where a feature is removed but its spec lives on (e.g.,
// admin-evolution-anchor-ranking.spec.ts referenced anchor-ranking-badge after the
// anchor concept was removed in #929).

import * as fs from 'fs';
import * as path from 'path';

// --- Constants ---

const REPO_ROOT = path.resolve(__dirname, '..');
const SPEC_GLOB_DIR = path.join(REPO_ROOT, 'src/__tests__/e2e/specs');
const SOURCE_DIRS = [
  'src/components',
  'src/app',
  'src/lib',
  'src/hooks',
  'src/editorFiles',
  'src/__tests__/e2e/helpers/pages',
  'evolution/src',
];
const ALLOWLIST_PATH = path.join(REPO_ROOT, 'scripts/check-stale-specs.allowlist');

// Match `data-testid="..."` literals (single or double quotes)
const TESTID_LITERAL_RE = /data-testid=["']([^"'$\n]+)["']/g;
// Match `data-testid={`...`}` template literals (anchored prefix only — we extract the
// part before any `${` interpolation so prefix matching works)
const TESTID_TEMPLATE_RE = /data-testid=\{`([^`$]+)/g;
// Match prop pass-through patterns like `testId="..."` and `testid="..."`. Components
// commonly accept a testId prop and forward it as `data-testid={props.testId}`, so the
// literal value lives at the prop call site, not in `data-testid="..."` form.
const TESTID_PROP_LITERAL_RE = /\btest[Ii]d=["']([^"'$\n]+)["']/g;
// Same for template-literal prop: `testId={`prefix-${id}`}`
const TESTID_PROP_TEMPLATE_RE = /\btest[Ii]d=\{`([^`$]+)/g;

// --- Public API (exported for unit tests) ---

/**
 * Recursively walk a directory and return all files matching the predicate.
 */
export function walkFiles(dir: string, predicate: (p: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    const stat = fs.statSync(cur);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(cur);
      for (const e of entries) stack.push(path.join(cur, e));
    } else if (stat.isFile() && predicate(cur)) {
      out.push(cur);
    }
  }
  return out;
}

/**
 * Extract every `data-testid="..."` literal from a string. Skips testids
 * containing `${` (interpolation).
 */
export function extractSpecTestids(content: string): string[] {
  const ids = new Set<string>();
  let m: RegExpExecArray | null;
  TESTID_LITERAL_RE.lastIndex = 0;
  while ((m = TESTID_LITERAL_RE.exec(content)) !== null) {
    const id = m[1];
    if (id === undefined) continue;
    if (id.includes('${')) continue;
    ids.add(id);
  }
  return [...ids];
}

/**
 * Extract every defined testid from a source file. Captures:
 *   - `data-testid="literal"` HTML attribute
 *   - `data-testid={`prefix-${id}`}` template (prefix only)
 *   - `testId="literal"` / `testid="literal"` prop pass-through (very common in
 *     wrapper components that internally render `data-testid={props.testId}`)
 *   - `testId={`prefix-${id}`}` template prop
 */
export function extractSourceTestids(content: string): { literals: Set<string>; prefixes: Set<string> } {
  const literals = new Set<string>();
  const prefixes = new Set<string>();
  let m: RegExpExecArray | null;

  TESTID_LITERAL_RE.lastIndex = 0;
  while ((m = TESTID_LITERAL_RE.exec(content)) !== null) {
    if (m[1] !== undefined) literals.add(m[1]);
  }
  TESTID_TEMPLATE_RE.lastIndex = 0;
  while ((m = TESTID_TEMPLATE_RE.exec(content)) !== null) {
    if (m[1] !== undefined) prefixes.add(m[1]);
  }
  TESTID_PROP_LITERAL_RE.lastIndex = 0;
  while ((m = TESTID_PROP_LITERAL_RE.exec(content)) !== null) {
    // testId="..." prop pass-through (very common in wrapper components)
    if (m[1] !== undefined) literals.add(m[1]);
  }
  TESTID_PROP_TEMPLATE_RE.lastIndex = 0;
  while ((m = TESTID_PROP_TEMPLATE_RE.exec(content)) !== null) {
    if (m[1] !== undefined) prefixes.add(m[1]);
  }
  return { literals, prefixes };
}

/**
 * A spec testid is satisfied by source if either:
 *   - it appears as an exact literal in any source file, OR
 *   - some source template-prefix is a prefix of the spec testid
 *     (e.g., source `row-${id}` covers spec `row-42`).
 */
export function isTestidDefined(
  specId: string,
  sourceLiterals: Set<string>,
  sourcePrefixes: Set<string>
): boolean {
  if (sourceLiterals.has(specId)) return true;
  for (const prefix of sourcePrefixes) {
    if (specId.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Load the allowlist file. Each line is a testid prefix to skip.
 * Lines starting with `#` are comments, blank lines are ignored.
 */
export function loadAllowlist(allowlistPath: string): string[] {
  if (!fs.existsSync(allowlistPath)) return [];
  return fs
    .readFileSync(allowlistPath, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));
}

/**
 * Returns true if the spec testid is covered by an allowlist prefix.
 */
export function isAllowlisted(specId: string, allowlist: string[]): boolean {
  return allowlist.some(prefix => specId.startsWith(prefix));
}

interface ScanResult {
  orphans: Map<string, string[]>; // testid → list of spec files
  totalSpecs: number;
  totalSourceFiles: number;
  totalSpecTestids: number;
}

/**
 * Run the full scan. Pure function — no side effects, takes paths as input.
 */
export function scanForStaleSpecs(
  specGlobDir: string,
  sourceDirs: string[],
  allowlist: string[]
): ScanResult {
  const orphans = new Map<string, string[]>();

  // Step 1: collect spec files (only `*.spec.ts` directly under specs/, not helpers)
  const specFiles = walkFiles(specGlobDir, p => p.endsWith('.spec.ts'));

  // Step 2: collect source files from each source dir
  const sourceFiles: string[] = [];
  for (const dir of sourceDirs) {
    const abs = path.isAbsolute(dir) ? dir : path.join(REPO_ROOT, dir);
    sourceFiles.push(
      ...walkFiles(
        abs,
        p =>
          (p.endsWith('.ts') || p.endsWith('.tsx')) &&
          !p.endsWith('.test.ts') &&
          !p.endsWith('.test.tsx') &&
          !p.endsWith('.spec.ts') &&
          !p.endsWith('.spec.tsx')
      )
    );
  }

  // Step 3: extract source testids (literals + template prefixes)
  const sourceLiterals = new Set<string>();
  const sourcePrefixes = new Set<string>();
  for (const file of sourceFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const { literals, prefixes } = extractSourceTestids(content);
    for (const l of literals) sourceLiterals.add(l);
    for (const p of prefixes) sourcePrefixes.add(p);
  }

  // Step 4: scan each spec file for testids and check against source
  let totalSpecTestids = 0;
  for (const specFile of specFiles) {
    const content = fs.readFileSync(specFile, 'utf8');
    const ids = extractSpecTestids(content);
    totalSpecTestids += ids.length;
    for (const id of ids) {
      if (isAllowlisted(id, allowlist)) continue;
      if (!isTestidDefined(id, sourceLiterals, sourcePrefixes)) {
        const rel = path.relative(REPO_ROOT, specFile);
        if (!orphans.has(id)) orphans.set(id, []);
        orphans.get(id)!.push(rel);
      }
    }
  }

  return {
    orphans,
    totalSpecs: specFiles.length,
    totalSourceFiles: sourceFiles.length,
    totalSpecTestids,
  };
}

// --- CLI entry point ---

function main(): void {
  const allowlist = loadAllowlist(ALLOWLIST_PATH);
  const result = scanForStaleSpecs(SPEC_GLOB_DIR, SOURCE_DIRS, allowlist);

  console.log(`Scanned ${result.totalSpecs} spec files, ${result.totalSourceFiles} source files`);
  console.log(`Total unique testids in specs: ${result.totalSpecTestids}`);
  console.log(`Allowlist entries: ${allowlist.length}`);

  if (result.orphans.size === 0) {
    console.log('✓ No stale specs detected');
    process.exit(0);
  }

  console.error(`\n✗ Found ${result.orphans.size} orphaned testids:\n`);
  const sorted = [...result.orphans.entries()].sort();
  for (const [id, files] of sorted) {
    console.error(`  ${id}`);
    for (const file of files) {
      console.error(`    in: ${file}`);
    }
  }
  console.error(
    `\nFix by either (a) deleting/updating the spec, or (b) adding the testid prefix to ${path.relative(REPO_ROOT, ALLOWLIST_PATH)} with a comment explaining why.`
  );
  process.exit(1);
}

// Only run main when invoked directly (not when imported by tests)
if (require.main === module) {
  main();
}
