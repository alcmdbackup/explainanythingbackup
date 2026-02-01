// Quick check: verify source column exists and explanation_id is nullable.
import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data, error } = await supabase.from('content_evolution_runs').insert({
    status: 'pending',
    explanation_id: null,
    source: 'migration_test',
  }).select('id, source').single();

  if (error) {
    console.log('FAIL:', error.message);
    process.exit(1);
  }

  console.log('OK — migration applied. Cleaning up test row...');
  await supabase.from('content_evolution_runs').delete().eq('id', data.id);
  console.log('Done.');
}

main().catch(console.error);
