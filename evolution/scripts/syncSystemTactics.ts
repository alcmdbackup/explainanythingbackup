// Sync system-defined tactics from code registry to evolution_tactics DB table.
// Runs on deploy (CI step) and at batch runner startup (processRunQueue.ts).
// Idempotent: upserts by name, only touches is_predefined=true rows.

import { createClient } from '@supabase/supabase-js';
import { ALL_SYSTEM_TACTICS } from '../src/lib/core/tactics';

export interface SyncResult {
  upserted: number;
  errors: string[];
}

/**
 * Upsert all system-defined tactics to the evolution_tactics table.
 * Only updates is_predefined=true rows; custom tactics are never touched.
 */
export async function syncSystemTactics(
  supabaseUrl: string,
  supabaseKey: string,
): Promise<SyncResult> {
  const db = createClient(supabaseUrl, supabaseKey);
  const errors: string[] = [];
  let upserted = 0;

  for (const [name, def] of Object.entries(ALL_SYSTEM_TACTICS)) {
    const { error } = await db
      .from('evolution_tactics')
      .upsert({
        name,
        label: def.label,
        agent_type: 'generate_from_previous_article',
        category: def.category,
        is_predefined: true,
        status: 'active',
      }, { onConflict: 'name' });

    if (error) {
      errors.push(`Failed to upsert tactic '${name}': ${error.message}`);
    } else {
      upserted++;
    }
  }

  return { upserted, errors };
}

// CLI entry point: run directly via `npx tsx evolution/scripts/syncSystemTactics.ts`
if (require.main === module || process.argv[1]?.endsWith('syncSystemTactics.ts')) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  syncSystemTactics(url, key).then((result) => {
    console.log(`Synced ${result.upserted} system tactics`);
    if (result.errors.length > 0) {
      console.error('Errors:', result.errors);
      process.exit(1);
    }
  }).catch((err) => {
    console.error('Sync failed:', err);
    process.exit(1);
  });
}
