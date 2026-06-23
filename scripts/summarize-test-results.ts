#!/usr/bin/env npx tsx
// Summarizes Playwright JSON report(s) (test-results/results.json) into a compact
// markdown list of FAILED + FLAKY (passed-on-retry) tests, de-duplicated across
// matrix shards. Used by e2e-nightly.yml's notify-release-health job to embed the
// actual failing-test names into the [release-health] issue, so triage survives
// GitHub Actions log expiry (S2/gap #3). Also tags likely transient real-AI /
// quota failures so triagers can tell AI-backend-down from a code regression.
//
// Always exits 0 — this is a reporting aid, never a gate.

import * as fs from 'fs';

// --- Types (subset of the Playwright JSON reporter shape) ---

interface PwResult {
  status?: string;
  error?: { message?: string };
  errors?: Array<{ message?: string }>;
}
interface PwTest {
  status?: string; // 'expected' | 'unexpected' | 'flaky' | 'skipped'
  results?: PwResult[];
}
interface PwSpec {
  title?: string;
  file?: string;
  line?: number;
  tests?: PwTest[];
  suites?: PwSuite[];
  specs?: PwSpec[];
}
interface PwSuite {
  suites?: PwSuite[];
  specs?: PwSpec[];
}
interface PwReport {
  suites?: PwSuite[];
}

export interface TestEntry {
  label: string; // `file:line › title`
  file: string;
  line: number;
  title: string;
  error: string;
  transientAI: boolean;
}

// Patterns that indicate a transient real-AI / infra failure (S2) rather than a
// deterministic code regression — surfaced so nightly triage isn't misled.
const TRANSIENT_AI_RE =
  /error communicating with ai service|\b402\b|\b429\b|\b503\b|quota|rate limit|service unavailable|insufficient.*credit|econnreset|etimedout|fetch failed|received "failed"|received: "failed"|status.*['"]?failed/i;

export function classifyTransientAI(text: string): boolean {
  return TRANSIENT_AI_RE.test(text || '');
}

/** Recursively collect spec nodes (those carrying a `tests` array) from a report. */
export function collectSpecs(node: PwReport | PwSuite | PwSpec | undefined): PwSpec[] {
  if (!node || typeof node !== 'object') return [];
  const out: PwSpec[] = [];
  const spec = node as PwSpec;
  if (Array.isArray(spec.tests) && (spec.title || spec.file)) {
    out.push(spec);
  }
  const children = [
    ...(((node as PwSuite).suites) || []),
    ...(((node as PwSuite).specs) || []),
  ];
  for (const child of children) {
    out.push(...collectSpecs(child));
  }
  return out;
}

function firstErrorText(test: PwTest): string {
  for (const r of test.results || []) {
    if (r.error?.message) return r.error.message;
    const firstErr = r.errors?.[0]?.message;
    if (firstErr) return firstErr;
  }
  return '';
}

/** Extract failed + flaky entries from a single parsed report object. */
export function extractEntries(report: PwReport): { failed: TestEntry[]; flaky: TestEntry[] } {
  const failed: TestEntry[] = [];
  const flaky: TestEntry[] = [];
  for (const spec of collectSpecs(report)) {
    const file = spec.file || '?';
    const line = spec.line || 0;
    const title = spec.title || '(untitled)';
    for (const test of spec.tests || []) {
      if (test.status !== 'unexpected' && test.status !== 'flaky') continue;
      const error = (firstErrorText(test).split('\n')[0] ?? '').slice(0, 300);
      const entry: TestEntry = {
        label: `${file}:${line} › ${title}`,
        file,
        line,
        title,
        error,
        transientAI: classifyTransientAI(error),
      };
      (test.status === 'flaky' ? flaky : failed).push(entry);
    }
  }
  return { failed, flaky };
}

/** Parse a results.json file path; returns empty report on any read/parse error. */
export function parseReportFile(filePath: string): PwReport {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as PwReport;
  } catch {
    return {};
  }
}

function dedupe(entries: TestEntry[]): TestEntry[] {
  const seen = new Map<string, TestEntry>();
  for (const e of entries) {
    if (!seen.has(e.label)) seen.set(e.label, e);
  }
  return [...seen.values()];
}

/** Merge entries from multiple reports (matrix shards), de-duplicated by label. */
export function summarizeFiles(filePaths: string[]): { failed: TestEntry[]; flaky: TestEntry[] } {
  const allFailed: TestEntry[] = [];
  const allFlaky: TestEntry[] = [];
  for (const fp of filePaths) {
    const { failed, flaky } = extractEntries(parseReportFile(fp));
    allFailed.push(...failed);
    allFlaky.push(...flaky);
  }
  return { failed: dedupe(allFailed), flaky: dedupe(allFlaky) };
}

function renderList(entries: TestEntry[]): string {
  return entries
    .map((e) => {
      const tag = e.transientAI ? ' _(transient-AI?)_' : '';
      const err = e.error ? ` — \`${e.error.replace(/`/g, "'")}\`` : '';
      return `- \`${e.label}\`${tag}${err}`;
    })
    .join('\n');
}

export function formatMarkdown(summary: { failed: TestEntry[]; flaky: TestEntry[] }): string {
  const { failed, flaky } = summary;
  if (failed.length === 0 && flaky.length === 0) return '';
  const parts: string[] = [];
  if (failed.length) {
    parts.push(`**Failed (${failed.length}):**\n${renderList(failed)}`);
  }
  if (flaky.length) {
    parts.push(`**Flaky — passed on retry (${flaky.length}):**\n${renderList(flaky)}`);
  }
  const transient = [...failed, ...flaky].filter((e) => e.transientAI).length;
  if (transient) {
    parts.push(
      `> ${transient} entry(ies) tagged \`transient-AI?\` — likely real-AI/quota/infra (402/429/AI-service), not a code regression. See testing_overview.md "Known nightly real-AI flake class".`,
    );
  }
  return parts.join('\n\n');
}

// --- CLI ---
// Usage: npx tsx scripts/summarize-test-results.ts <results.json> [more.json ...]
// Prints markdown to stdout (empty string if nothing failed/flaky). Always exit 0.
function main(): void {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    process.stdout.write('');
    return;
  }
  const md = formatMarkdown(summarizeFiles(files));
  process.stdout.write(md);
}

// Run only when invoked directly (not when imported by the test).
if (require.main === module) {
  main();
}
