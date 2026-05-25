// Phase 0 dry-run helper: compare pre/post count JSON files against the Phase 5
// expectation. Exits non-zero if any expectation is violated.
//
// Usage:
//   tsx scripts/phase0-dryrun/diff-counts.ts /tmp/counts-pre.json /tmp/counts-post.json
//
// Expectations:
//   - explainanything_truncated tables: pre = any, post = 0
//   - explanations_deleted:           pre = any, post = 0
//   - evolution_preserved tables:     pre = post (exact match)
//   - shared_preserved tables:        pre = post (exact match)
//   - untouched_reference tables:     pre = post (exact match)

import { readFileSync } from 'fs';

type CountFile = Record<string, Record<string, number | string>>;

function load(path: string): CountFile {
  return JSON.parse(readFileSync(path, 'utf-8')) as CountFile;
}

function check(pre: CountFile, post: CountFile): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  let ok = true;

  const expectZeroBuckets = ['explainanything_truncated', 'explanations_deleted'];
  const expectEqualBuckets = ['evolution_preserved', 'shared_preserved', 'untouched_reference'];

  for (const bucket of expectZeroBuckets) {
    const postBucket = post[bucket] ?? {};
    for (const [table, postCount] of Object.entries(postBucket)) {
      if (typeof postCount === 'number' && postCount !== 0) {
        lines.push(`FAIL  ${bucket}.${table}: expected 0, got ${postCount}`);
        ok = false;
      } else if (typeof postCount === 'string') {
        lines.push(`SKIP  ${bucket}.${table}: ${postCount}`);
      } else {
        lines.push(`OK    ${bucket}.${table}: 0`);
      }
    }
  }

  for (const bucket of expectEqualBuckets) {
    const preBucket = pre[bucket] ?? {};
    const postBucket = post[bucket] ?? {};
    for (const table of Object.keys(preBucket)) {
      const p = preBucket[table];
      const q = postBucket[table];
      if (typeof p === 'number' && typeof q === 'number') {
        if (p !== q) {
          lines.push(`FAIL  ${bucket}.${table}: pre=${p} post=${q} (delta=${q - p})`);
          ok = false;
        } else {
          lines.push(`OK    ${bucket}.${table}: ${p} == ${q}`);
        }
      } else {
        lines.push(`SKIP  ${bucket}.${table}: pre=${p} post=${q}`);
      }
    }
  }

  return { ok, lines };
}

function main(): void {
  const [, , prePath, postPath] = process.argv;
  if (!prePath || !postPath) {
    console.error('Usage: tsx diff-counts.ts <pre.json> <post.json>');
    process.exit(1);
  }
  const pre = load(prePath);
  const post = load(postPath);
  const { ok, lines } = check(pre, post);
  for (const line of lines) console.log(line);
  console.log('');
  console.log(ok ? 'DRY-RUN VERIFICATION: PASS ✓' : 'DRY-RUN VERIFICATION: FAIL ✗');
  process.exit(ok ? 0 : 1);
}

main();
