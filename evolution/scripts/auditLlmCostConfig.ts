// One-shot audit script — prints staging llm_cost_config rows for Phase 4 of
// reduce_e2e_testing_llm_costs_20260621. Compare results against
// docs/docs_overall/llm_provider_limits.md recommended values.
//
// Usage: NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx evolution/scripts/auditLlmCostConfig.ts

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    process.exit(2);
  }
  const db = createClient<Database>(url, key);

  const r = await db.from('llm_cost_config').select('*');
  if (r.error) {
    console.error(r.error.message);
    process.exit(1);
  }
  console.log(JSON.stringify(r.data, null, 2));
}

main().catch(e => {
  console.error('audit fatal:', e);
  process.exit(1);
});
