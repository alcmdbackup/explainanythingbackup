#!/usr/bin/env npx tsx
/**
 * Audit (and optionally clean) orphaned rows in `evolution_arena_comparisons`
 * whose `entry_a` or `entry_b` no longer matches any row in `evolution_variants`.
 *
 * Why this script exists: migration 20260409000001 intentionally dropped the
 * DB-level FKs from `evolution_arena_comparisons.entry_a/b → evolution_variants(id)`
 * to allow in-run inserts before variants are persisted. App-layer enforcement
 * lives in `evolution/src/lib/core/entities/VariantEntity.ts:65`. Any orphans
 * predating that enforcement need a one-time audit before the explainanything
 * production DB reset to avoid leftover dangling rows during the migration window.
 *
 * Usage:
 *   npx tsx evolution/scripts/audit-arena-comparison-orphans.ts              # dry-run on staging (default)
 *   npx tsx evolution/scripts/audit-arena-comparison-orphans.ts --apply      # delete orphans (typed confirmation required)
 *   npx tsx evolution/scripts/audit-arena-comparison-orphans.ts --prod       # use prod env
 *   npx tsx evolution/scripts/audit-arena-comparison-orphans.ts --apply --prod --confirm "DELETE ORPHAN ARENA COMPARISONS"
 *
 * Safety:
 *   - Dry-run by default. Lists orphans, does NOT mutate.
 *   - --apply requires typed confirmation string ("DELETE ORPHAN ARENA COMPARISONS").
 *   - Reads service-role key from `.env.local` (staging) or `.env.evolution-prod` (prod).
 *   - Never logs the service-role key.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as readline from 'readline';

export interface OrphanRow {
  id: string;
  entry_a: string;
  entry_b: string;
  reason: 'entry_a_missing' | 'entry_b_missing' | 'both_missing';
}

export interface AuditResult {
  totalChecked: number;
  orphans: OrphanRow[];
  deleted: number;
  isDryRun: boolean;
}

export interface AuditOptions {
  isDryRun: boolean;
  isProd: boolean;
  confirmString?: string;
  /** Test-only: skip the readline prompt by injecting the typed confirmation. */
  skipPromptForTest?: boolean;
}

const EXPECTED_CONFIRM = 'DELETE ORPHAN ARENA COMPARISONS';

export async function findOrphans(db: SupabaseClient): Promise<OrphanRow[]> {
  // Page through evolution_arena_comparisons; for each row check whether
  // entry_a and entry_b exist in evolution_variants.
  const orphans: OrphanRow[] = [];
  const PAGE_SIZE = 1000;
  let offset = 0;

  // Pre-fetch the set of valid variant ids in batches to avoid one query per row.
  const validIds = new Set<string>();
  let variantOffset = 0;
  while (true) {
    const { data, error } = await db
      .from('evolution_variants')
      .select('id')
      .range(variantOffset, variantOffset + PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to read evolution_variants: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) validIds.add(row.id);
    if (data.length < PAGE_SIZE) break;
    variantOffset += PAGE_SIZE;
  }

  while (true) {
    const { data, error } = await db
      .from('evolution_arena_comparisons')
      .select('id, entry_a, entry_b')
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to read evolution_arena_comparisons: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      const aMissing = !validIds.has(row.entry_a);
      const bMissing = !validIds.has(row.entry_b);
      if (aMissing || bMissing) {
        orphans.push({
          id: row.id,
          entry_a: row.entry_a,
          entry_b: row.entry_b,
          reason: aMissing && bMissing
            ? 'both_missing'
            : aMissing ? 'entry_a_missing' : 'entry_b_missing',
        });
      }
    }
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return orphans;
}

export async function deleteOrphans(db: SupabaseClient, orphans: OrphanRow[]): Promise<number> {
  if (orphans.length === 0) return 0;
  // Delete in chunks of 100 to keep each statement small.
  let deleted = 0;
  for (let i = 0; i < orphans.length; i += 100) {
    const chunk = orphans.slice(i, i + 100).map((o) => o.id);
    const { error, count } = await db
      .from('evolution_arena_comparisons')
      .delete({ count: 'exact' })
      .in('id', chunk);
    if (error) throw new Error(`Failed to delete chunk: ${error.message}`);
    deleted += count ?? chunk.length;
  }
  return deleted;
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

export async function runAudit(
  db: SupabaseClient,
  opts: AuditOptions,
): Promise<AuditResult> {
  const totalChecked = await (async () => {
    const { count } = await db
      .from('evolution_arena_comparisons')
      .select('id', { count: 'exact', head: true });
    return count ?? 0;
  })();

  const orphans = await findOrphans(db);

  if (opts.isDryRun) {
    return { totalChecked, orphans, deleted: 0, isDryRun: true };
  }

  // Apply path requires typed confirmation, unless skipped for tests.
  if (!opts.skipPromptForTest) {
    const confirmed = opts.confirmString === EXPECTED_CONFIRM
      || await promptForConfirmation(EXPECTED_CONFIRM);
    if (!confirmed) {
      throw new Error('Confirmation string did not match. Aborting.');
    }
  }

  const deleted = await deleteOrphans(db, orphans);
  return { totalChecked, orphans, deleted, isDryRun: false };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isDryRun = !args.includes('--apply');
  const isProd = args.includes('--prod');
  const confirmIdx = args.indexOf('--confirm');
  const confirmString = confirmIdx >= 0 ? args[confirmIdx + 1] : undefined;

  const envFile = isProd ? '.env.evolution-prod' : '.env.local';
  dotenv.config({ path: path.resolve(process.cwd(), envFile) });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(`Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in ${envFile}`);
    process.exit(1);
  }

  console.log('Arena Comparison Orphan Audit');
  console.log('==============================');
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no mutation)' : 'APPLY (will delete)'}`);
  console.log(`Env:  ${isProd ? 'PRODUCTION' : 'staging/dev'}`);
  console.log('');

  if (isProd && !isDryRun) {
    console.log('PRODUCTION + APPLY mode — destructive.');
    console.log('Waiting 10s before prompting; Ctrl+C to abort.');
    await new Promise((r) => setTimeout(r, 10_000));
  }

  const db = createClient(url, key, { auth: { persistSession: false } });
  const result = await runAudit(db, { isDryRun, isProd, confirmString });

  console.log(`Total arena comparisons checked: ${result.totalChecked}`);
  console.log(`Orphans found: ${result.orphans.length}`);
  if (result.orphans.length > 0 && result.orphans.length <= 50) {
    for (const o of result.orphans) {
      console.log(`  ${o.id} (${o.reason})`);
    }
  }
  if (!result.isDryRun) {
    console.log(`Deleted: ${result.deleted}`);
  }
}

// Only run main when invoked as a script, not when imported by tests.
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
