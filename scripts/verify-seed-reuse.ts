#!/usr/bin/env npx tsx
// Post-deploy verification script: asserts that a completed run reused the persisted seed
// row instead of creating a duplicate baseline variant.
//
// Usage:   npx tsx scripts/verify-seed-reuse.ts --run-id=<uuid> --target=staging|prod
// Exit:    0 = all assertions passed
//          1 = at least one assertion failed (failures printed)
//          2 = usage error (missing/invalid args)
//          3 = DB connection / query error

import { Client } from 'pg';
import * as dns from 'dns';
import * as dotenv from 'dotenv';
import * as path from 'path';

dns.setDefaultResultOrder('ipv4first');

interface Args { runId: string; target: 'staging' | 'prod' }

function parseArgs(argv: string[]): Args | { error: string } {
  const args = argv.slice(2);
  let runId: string | undefined;
  let target: string | undefined;
  for (const a of args) {
    if (a.startsWith('--run-id=')) runId = a.slice('--run-id='.length);
    else if (a.startsWith('--target=')) target = a.slice('--target='.length);
  }
  if (!runId) return { error: 'Missing --run-id=<uuid>' };
  if (target !== 'staging' && target !== 'prod') return { error: 'Missing or invalid --target (staging|prod)' };
  return { runId, target };
}

async function getDbUrl(target: 'staging' | 'prod'): Promise<string> {
  const envFile = target === 'staging' ? '.env.staging.readonly' : '.env.prod.readonly';
  const envVar = target === 'staging' ? 'STAGING_READONLY_DATABASE_URL' : 'PROD_READONLY_DATABASE_URL';
  dotenv.config({ path: path.resolve(process.cwd(), envFile) });
  const url = process.env[envVar];
  if (!url) throw new Error(`${envVar} not set in ${envFile}`);
  return url;
}

interface Assertion { name: string; pass: boolean; detail?: string }

async function runAssertions(runId: string, db: Client): Promise<Assertion[]> {
  const out: Assertion[] = [];

  // 1. Run is completed
  const r1 = await db.query(`SELECT status, prompt_id FROM evolution_runs WHERE id = $1`, [runId]);
  if (r1.rowCount === 0) {
    out.push({ name: 'run exists', pass: false, detail: 'no row found' });
    return out;
  }
  const run = r1.rows[0] as { status: string; prompt_id: string | null };
  out.push({ name: 'run.status = completed', pass: run.status === 'completed', detail: `status=${run.status}` });

  // 2. No seed_variant row INSERTed for this run (reused seed routes through arenaUpdates, not INSERT).
  const r2 = await db.query(
    `SELECT count(*)::int AS n FROM evolution_variants WHERE run_id = $1 AND agent_name = 'seed_variant'`,
    [runId],
  );
  const insertedSeedRows = (r2.rows[0] as { n: number }).n;
  out.push({
    name: 'no seed_variant INSERT for run (reused seed routes through arenaUpdates)',
    pass: insertedSeedRows === 0,
    detail: `inserted=${insertedSeedRows}`,
  });

  // 3. Seed row exists for the prompt with generation_method='seed' AND synced_to_arena=true.
  if (run.prompt_id) {
    const r3 = await db.query(
      `SELECT id, mu, sigma, arena_match_count FROM evolution_variants
        WHERE prompt_id = $1 AND generation_method = 'seed' AND synced_to_arena = true AND archived_at IS NULL
        LIMIT 1`,
      [run.prompt_id],
    );
    out.push({
      name: 'seed row exists for prompt (generation_method=seed, synced_to_arena=true)',
      pass: r3.rowCount === 1,
      detail: r3.rowCount === 1 ? `id=${r3.rows[0].id} mu=${r3.rows[0].mu} arena_match_count=${r3.rows[0].arena_match_count}` : 'no seed row',
    });
  } else {
    out.push({ name: 'seed row check skipped (run has no prompt_id)', pass: true });
  }

  return out;
}

async function main() {
  const parsed = parseArgs(process.argv);
  if ('error' in parsed) {
    console.error(`Usage error: ${parsed.error}`);
    console.error(`Usage: npx tsx scripts/verify-seed-reuse.ts --run-id=<uuid> --target=staging|prod`);
    process.exit(2);
  }
  const { runId, target } = parsed;

  let db: Client;
  try {
    const url = await getDbUrl(target);
    db = new Client({ connectionString: url, statement_timeout: 30000 });
    await db.connect();
  } catch (e) {
    console.error(`DB connection error: ${(e as Error).message}`);
    process.exit(3);
  }

  let assertions: Assertion[];
  try {
    assertions = await runAssertions(runId, db);
  } catch (e) {
    console.error(`DB query error: ${(e as Error).message}`);
    await db.end();
    process.exit(3);
  } finally {
    await db.end().catch(() => {});
  }

  let failed = 0;
  for (const a of assertions) {
    const tag = a.pass ? 'PASS' : 'FAIL';
    const detail = a.detail ? ` — ${a.detail}` : '';
    console.log(`[${tag}] ${a.name}${detail}`);
    if (!a.pass) failed++;
  }
  process.exit(failed === 0 ? 0 : 1);
}

main();
