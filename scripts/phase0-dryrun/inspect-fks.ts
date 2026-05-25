// Diagnostic: list FKs pointing AT a given table, including their ON DELETE
// actions. We used this to debug reset.sql ordering — knowing which FKs are
// SET NULL vs NO ACTION vs CASCADE determines whether we need to pre-null
// referencing rows before the parent DELETE.
//
// Usage:
//   DATABASE_URL_FOR_COUNTS=$PROD_READONLY_DATABASE_URL \
//     npx tsx scripts/phase0-dryrun/inspect-fks.ts explanations

import { Client } from 'pg';

async function main(): Promise<void> {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: tsx inspect-fks.ts <target_table_name>');
    process.exit(1);
  }
  const dsn = process.env.DATABASE_URL_FOR_COUNTS;
  if (!dsn) {
    console.error('Set DATABASE_URL_FOR_COUNTS');
    process.exit(1);
  }
  const c = new Client({ connectionString: dsn });
  await c.connect();
  const { rows } = await c.query<{
    conname: string;
    conrelid: string;
    confdeltype: string;
    def: string;
  }>(
    `SELECT conname,
            conrelid::regclass::text AS conrelid,
            confdeltype,
            pg_get_constraintdef(oid) AS def
       FROM pg_constraint
      WHERE confrelid = $1::regclass AND contype = 'f'
      ORDER BY conrelid::regclass::text`,
    [target],
  );
  const actionMap: Record<string, string> = {
    a: 'NO ACTION',
    r: 'RESTRICT',
    c: 'CASCADE',
    n: 'SET NULL',
    d: 'SET DEFAULT',
  };
  console.log(`FKs pointing AT ${target}:`);
  for (const r of rows) {
    const action = actionMap[r.confdeltype] ?? r.confdeltype;
    console.log(`  ${r.conrelid.padEnd(28)} ${action.padEnd(12)} ${r.conname}`);
  }
  if (rows.length === 0) {
    console.log(`  (no FKs pointing at ${target})`);
  }
  await c.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
