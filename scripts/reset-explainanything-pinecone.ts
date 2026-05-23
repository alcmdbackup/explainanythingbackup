#!/usr/bin/env npx tsx
/**
 * One-time Pinecone reset for the explainanything namespace(s). Mirrors the
 * SQL reset of explainanything tables. Evolution doesn't use Pinecone, so
 * this only ever touches the explainanything namespace.
 *
 * Safety:
 *   - --dry-run default. Lists target namespaces and their vector counts.
 *   - --prod required for execution AND a typed confirmation prompt.
 *   - Per-namespace prompt unless `--namespaces <a,b>` is given explicitly.
 *   - Reads PINECONE_API_KEY from .env.local (staging) or .env.evolution-prod (prod).
 *   - deleteAll is eventually consistent; we poll describeIndexStats until
 *     the namespace's vector count hits 0 (or timeout).
 *   - Idempotent: re-running after a partial completion is a no-op for cleared namespaces.
 *
 * Usage:
 *   npx tsx scripts/reset-explainanything-pinecone.ts                      # dry-run (default)
 *   npx tsx scripts/reset-explainanything-pinecone.ts --namespaces default # dry-run, scoped to one namespace
 *   npx tsx scripts/reset-explainanything-pinecone.ts --prod --apply       # interactive prompt + delete
 *   npx tsx scripts/reset-explainanything-pinecone.ts --prod --apply --confirm "RESET EXPLAINANYTHING PINECONE"
 */

import { Pinecone } from '@pinecone-database/pinecone';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as readline from 'readline';

const EXPECTED_CONFIRM = 'RESET EXPLAINANYTHING PINECONE';
const POLL_ATTEMPTS = 30;
const POLL_DELAY_MS = 2000;
const RETRY_BACKOFF_MS = [1000, 2000, 4000];

export interface ResetOptions {
  isDryRun: boolean;
  isProd: boolean;
  /** Explicit namespace list. When undefined, all non-empty namespaces are candidates. */
  namespaces?: string[];
  confirmString?: string;
  /** Test-only: skip the readline prompt and per-namespace y/n. */
  skipPromptForTest?: boolean;
}

export interface NamespaceResult {
  name: string;
  initialCount: number;
  deletedSuccessfully: boolean;
  finalCount: number;
  notes: string;
}

export interface ResetResult {
  indexName: string;
  isDryRun: boolean;
  namespaces: NamespaceResult[];
}

async function promptForConfirmation(expected: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`Type "${expected}" to proceed: `, (answer) => {
      rl.close();
      resolve(answer.trim() === expected);
    });
  });
}

async function promptYesNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} [y/N]: `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

async function deleteWithRetry(
  index: ReturnType<Pinecone['index']>,
  namespace: string,
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
    try {
      await index.namespace(namespace).deleteAll();
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < RETRY_BACKOFF_MS.length) {
        await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt]));
      }
    }
  }
  throw lastErr;
}

async function pollUntilEmpty(
  index: ReturnType<Pinecone['index']>,
  namespace: string,
  signal?: { aborted: boolean },
): Promise<number> {
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    if (signal?.aborted) break;
    const stats = await index.describeIndexStats();
    const remaining = (stats.namespaces?.[namespace] as { recordCount?: number } | undefined)?.recordCount ?? 0;
    if (remaining === 0) return 0;
    await new Promise((r) => setTimeout(r, POLL_DELAY_MS));
  }
  // Last check
  const finalStats = await index.describeIndexStats();
  return (finalStats.namespaces?.[namespace] as { recordCount?: number } | undefined)?.recordCount ?? 0;
}

/**
 * Run the reset. Exported for tests; the CLI wraps it with the env / confirmation flow.
 */
export async function runReset(
  client: Pinecone,
  indexName: string,
  opts: ResetOptions,
): Promise<ResetResult> {
  const index = client.index(indexName);
  const stats = await index.describeIndexStats();
  const allNamespaces = Object.entries(stats.namespaces ?? {}).map(([name, info]) => ({
    name,
    count: (info as { recordCount?: number }).recordCount ?? 0,
  }));

  const targets = opts.namespaces
    ? allNamespaces.filter((n) => opts.namespaces!.includes(n.name))
    : allNamespaces;

  const results: NamespaceResult[] = [];

  for (const t of targets) {
    if (opts.isDryRun) {
      results.push({
        name: t.name,
        initialCount: t.count,
        deletedSuccessfully: false,
        finalCount: t.count,
        notes: 'dry-run; no deletion',
      });
      continue;
    }

    // Per-namespace confirmation in interactive mode.
    if (!opts.skipPromptForTest && !opts.namespaces) {
      const ok = await promptYesNo(
        `  Delete ${t.count.toLocaleString()} vectors in namespace "${t.name || '(default)'}"?`,
      );
      if (!ok) {
        results.push({
          name: t.name,
          initialCount: t.count,
          deletedSuccessfully: false,
          finalCount: t.count,
          notes: 'skipped per user',
        });
        continue;
      }
    }

    try {
      await deleteWithRetry(index, t.name);
      const finalCount = await pollUntilEmpty(index, t.name);
      results.push({
        name: t.name,
        initialCount: t.count,
        deletedSuccessfully: finalCount === 0,
        finalCount,
        notes: finalCount === 0 ? 'deleted' : 'still has vectors after poll timeout',
      });
    } catch (err) {
      results.push({
        name: t.name,
        initialCount: t.count,
        deletedSuccessfully: false,
        finalCount: t.count,
        notes: `error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return { indexName, isDryRun: opts.isDryRun, namespaces: results };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isApply = args.includes('--apply');
  const isProd = args.includes('--prod');
  const force = args.includes('--force');
  const isDryRun = !isApply;
  const nsIdx = args.indexOf('--namespaces');
  const namespaces = nsIdx >= 0 ? args[nsIdx + 1]?.split(',').map((s) => s.trim()) : undefined;
  const confirmIdx = args.indexOf('--confirm');
  const confirmString = confirmIdx >= 0 ? args[confirmIdx + 1] : undefined;

  const envFile = isProd ? '.env.evolution-prod' : '.env.local';
  dotenv.config({ path: path.resolve(process.cwd(), envFile) });

  const apiKey = process.env.PINECONE_API_KEY;
  const indexName = process.env.PINECONE_INDEX_NAME_ALL;

  if (!apiKey) {
    console.error(`Missing PINECONE_API_KEY in ${envFile}`);
    process.exit(1);
  }
  if (!indexName) {
    console.error(`Missing PINECONE_INDEX_NAME_ALL in ${envFile}`);
    process.exit(1);
  }

  // Refuse to run --apply outside production unless --force.
  if (isApply && !isProd && process.env.NODE_ENV !== 'production' && !force) {
    console.error('Apply mode requires --prod (or --force in test/staging contexts).');
    process.exit(1);
  }

  console.log('Pinecone Explainanything Reset');
  console.log('==============================');
  console.log(`Index: ${indexName}`);
  console.log(`Env:   ${isProd ? 'PRODUCTION' : 'dev/staging'}`);
  console.log(`Mode:  ${isDryRun ? 'DRY RUN' : 'APPLY (will delete)'}`);
  if (namespaces) console.log(`Namespaces (explicit): ${namespaces.join(', ')}`);
  console.log('');

  if (isApply) {
    console.log(`Confirmation required. Type the exact phrase: "${EXPECTED_CONFIRM}"`);
    const confirmed = confirmString === EXPECTED_CONFIRM
      || await promptForConfirmation(EXPECTED_CONFIRM);
    if (!confirmed) {
      console.error('Confirmation did not match. Aborting.');
      process.exit(1);
    }
  }

  const client = new Pinecone({ apiKey });
  const result = await runReset(client, indexName, {
    isDryRun, isProd, namespaces, confirmString,
  });

  console.log('');
  console.log('Results:');
  for (const ns of result.namespaces) {
    const status = ns.deletedSuccessfully
      ? 'OK  '
      : ns.notes.startsWith('dry-run') ? 'DRY ' : 'WARN';
    console.log(
      `  [${status}] ${ns.name.padEnd(30)} ` +
      `initial=${ns.initialCount.toLocaleString().padStart(10)} ` +
      `final=${ns.finalCount.toLocaleString().padStart(10)}  ${ns.notes}`,
    );
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
