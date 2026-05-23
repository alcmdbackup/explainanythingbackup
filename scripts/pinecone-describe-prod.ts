#!/usr/bin/env npx tsx
/**
 * Read-only Pinecone inventory. Prints per-namespace vector counts for the
 * production index so we can baseline before the explainanything DB reset
 * (split_evolution_explainanythig_into_separate_websites_20260522 Phase 5).
 *
 * Safe to run any time; no mutations.
 *
 * Usage:
 *   npx tsx scripts/pinecone-describe-prod.ts            # uses .env.local (current env's index)
 *   npx tsx scripts/pinecone-describe-prod.ts --prod     # uses .env.prod.readonly
 */

import { Pinecone } from '@pinecone-database/pinecone';
import * as dotenv from 'dotenv';
import * as path from 'path';

interface NamespaceStat {
  name: string;
  vectorCount: number;
}

export interface IndexInventory {
  indexName: string;
  totalVectorCount: number;
  namespaces: NamespaceStat[];
}

/**
 * Read the named index's stats and return a serialisable summary. Exported
 * for unit-testing; the CLI entry just wraps this.
 */
export async function describeIndex(
  client: Pinecone,
  indexName: string,
): Promise<IndexInventory> {
  const index = client.index(indexName);
  // describeIndexStats returns { namespaces?: { [name]: { recordCount } }, totalRecordCount }
  const stats = await index.describeIndexStats();
  const namespaces: NamespaceStat[] = Object.entries(stats.namespaces ?? {}).map(
    ([name, info]) => ({
      name: name === '' ? '(default)' : name,
      vectorCount: (info as { recordCount?: number }).recordCount ?? 0,
    }),
  );
  return {
    indexName,
    totalVectorCount: stats.totalRecordCount ?? 0,
    namespaces,
  };
}

async function main(): Promise<void> {
  const isProd = process.argv.includes('--prod');
  const envFile = isProd ? '.env.prod.readonly' : '.env.local';
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

  console.log('Pinecone Index Inventory');
  console.log('========================');
  console.log(`Index: ${indexName}`);
  console.log(`Env:   ${isProd ? 'PRODUCTION (read-only)' : 'dev/staging'}`);
  console.log('');

  const client = new Pinecone({ apiKey });
  const inv = await describeIndex(client, indexName);

  console.log(`Total vectors: ${inv.totalVectorCount}`);
  console.log(`Namespaces: ${inv.namespaces.length}`);
  console.log('');
  for (const ns of inv.namespaces) {
    console.log(`  ${ns.name.padEnd(40)} ${ns.vectorCount.toLocaleString().padStart(12)} vectors`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
