/**
 * @jest-environment node
 */
// Tests for summarize-test-results.ts — the nightly results.json surfacer.
// Validates failed/flaky extraction, transient-AI classification, multi-shard
// de-dup, graceful handling of malformed/missing files, and markdown output.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  classifyTransientAI,
  collectSpecs,
  extractEntries,
  parseReportFile,
  summarizeFiles,
  formatMarkdown,
} from './summarize-test-results';

// Minimal Playwright-JSON-report builders.
function specNode(file: string, line: number, title: string, status: string, errMsg?: string) {
  return {
    title,
    file,
    line,
    tests: [
      {
        status,
        results: errMsg ? [{ error: { message: errMsg } }] : [{}],
      },
    ],
  };
}
function report(specs: ReturnType<typeof specNode>[]) {
  // Wrap specs in a nested suite to mirror the real reporter's structure.
  return { suites: [{ suites: [{ specs }] }] };
}

describe('classifyTransientAI', () => {
  it('flags AI-service / quota / rate-limit errors', () => {
    expect(classifyTransientAI('Error communicating with AI service')).toBe(true);
    expect(classifyTransientAI('Request failed with status 429')).toBe(true);
    expect(classifyTransientAI('OpenRouter 402 insufficient credits')).toBe(true);
    expect(classifyTransientAI('Expected "completed", Received "failed"')).toBe(true);
  });
  it('does not flag ordinary assertion failures', () => {
    expect(classifyTransientAI('expect(received).toBe(expected) // 0.75 vs 0.25')).toBe(false);
    expect(classifyTransientAI('locator.toBeVisible() timed out')).toBe(false);
  });
});

describe('collectSpecs', () => {
  it('walks nested suites to find spec nodes', () => {
    const r = report([specNode('a.spec.ts', 1, 't', 'expected')]);
    expect(collectSpecs(r)).toHaveLength(1);
  });
  it('returns [] for empty/garbage input', () => {
    expect(collectSpecs(undefined)).toEqual([]);
    expect(collectSpecs({})).toEqual([]);
  });
});

describe('extractEntries', () => {
  it('separates failed (unexpected) from flaky, ignores passed/skipped', () => {
    const r = report([
      specNode('pass.spec.ts', 10, 'ok', 'expected'),
      specNode('skip.spec.ts', 11, 'skipped', 'skipped'),
      specNode('fail.spec.ts', 12, 'broke', 'unexpected', 'boom'),
      specNode('flake.spec.ts', 13, 'raced', 'flaky', 'timed out'),
    ]);
    const { failed, flaky } = extractEntries(r);
    expect(failed.map((e) => e.title)).toEqual(['broke']);
    expect(flaky.map((e) => e.title)).toEqual(['raced']);
    expect(failed[0]!.label).toBe('fail.spec.ts:12 › broke');
  });

  it('tags transient-AI failures', () => {
    const r = report([
      specNode('ai.spec.ts', 5, 'save to library', 'unexpected', 'Error communicating with AI service'),
    ]);
    expect(extractEntries(r).failed[0]!.transientAI).toBe(true);
  });

  it('produces empty arrays for an all-passing report', () => {
    const r = report([specNode('pass.spec.ts', 1, 'ok', 'expected')]);
    expect(extractEntries(r)).toEqual({ failed: [], flaky: [] });
  });
});

describe('parseReportFile', () => {
  it('returns {} for a missing file (graceful)', () => {
    expect(parseReportFile('/no/such/file-xyz.json')).toEqual({});
  });
  it('returns {} for malformed JSON (graceful)', () => {
    const p = path.join(os.tmpdir(), `bad-${process.pid}.json`);
    fs.writeFileSync(p, '{ not json');
    try {
      expect(parseReportFile(p)).toEqual({});
    } finally {
      fs.unlinkSync(p);
    }
  });
});

describe('summarizeFiles (multi-shard de-dup)', () => {
  it('de-dupes the same failing test reported by two shards', () => {
    const p1 = path.join(os.tmpdir(), `r1-${process.pid}.json`);
    const p2 = path.join(os.tmpdir(), `r2-${process.pid}.json`);
    const same = report([specNode('x.spec.ts', 9, 'dup', 'unexpected', 'err')]);
    fs.writeFileSync(p1, JSON.stringify(same));
    fs.writeFileSync(p2, JSON.stringify(same));
    try {
      expect(summarizeFiles([p1, p2]).failed).toHaveLength(1);
    } finally {
      fs.unlinkSync(p1);
      fs.unlinkSync(p2);
    }
  });
});

describe('formatMarkdown', () => {
  it('returns empty string when nothing failed/flaky', () => {
    expect(formatMarkdown({ failed: [], flaky: [] })).toBe('');
  });
  it('renders failed + flaky sections and a transient-AI note', () => {
    const r = report([
      specNode('a.spec.ts', 1, 'real bug', 'unexpected', 'assertion x'),
      specNode('b.spec.ts', 2, 'ai blip', 'flaky', 'Error communicating with AI service'),
    ]);
    const md = formatMarkdown(extractEntries(r));
    expect(md).toContain('**Failed (1):**');
    expect(md).toContain('**Flaky — passed on retry (1):**');
    expect(md).toContain('transient-AI?');
    expect(md).toContain('a.spec.ts:1 › real bug');
  });
});
