// Seed the `Public Edit Smoke` strategy used by the /edit E2E spec
// (Phase 1 / Phase 2 of build_website_for_evolutiOn_20260626).
//
// The strategy must be simultaneously:
//   - public_visible=true   (so the /edit picker lists it)
//   - is_test_content=false (so claim_evolution_run accepts it; the
//                            evolution_is_test_name trigger flags names
//                            matching [TEST]/[E2E]/[TEST_EVO]/timestamp
//                            patterns — `Public Edit Smoke` matches none)
//   - budgetUsd <= $0.10    (so the updateStrategyAction guard accepts
//                            public_visible=true)
//
// E2E uses route-mocked LLMs, so the model field is decorative; the budget
// being $0.001 ensures any accidental real-LLM run is bounded.
//
// Idempotent: ON CONFLICT (config_hash) DO NOTHING — safe to re-run.
//
// Usage:
//   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
//     npx tsx evolution/scripts/seedPublicEditE2EStrategy.ts

import { createClient } from '@supabase/supabase-js';
import { hashStrategyConfig, labelStrategyConfig } from '@evolution/lib/pipeline/setup/findOrCreateStrategy';
import type { StrategyConfig } from '@evolution/lib/pipeline/infra/types';

const NAME = 'Public Edit Smoke';

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required');
    process.exit(1);
  }

  const supabase = createClient(url, key);

  const config: StrategyConfig = {
    generationModel: 'mock',
    judgeModel: 'mock',
    iterationConfigs: [
      { agentType: 'generate', budgetPercent: 100 },
    ],
    budgetUsd: 0.001,
  };
  const configHash = hashStrategyConfig(config);
  const label = labelStrategyConfig(config);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- public_visible column added by migration 20260627000003
  const { data, error } = await (supabase as any)
    .from('evolution_strategies')
    .upsert(
      {
        name: NAME,
        label,
        description: 'Seeded E2E smoke strategy for the public /edit surface. Mocked LLM; $0.001 budget cap.',
        config,
        config_hash: configHash,
        pipeline_type: 'single',
        status: 'active',
        created_by: 'seed-script',
        public_visible: true,
      },
      { onConflict: 'config_hash', ignoreDuplicates: true },
    )
    .select('id, name, public_visible')
    .maybeSingle();

  if (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  }

  if (data) {
    console.log(`Seeded strategy: ${data.id} (${data.name}, public_visible=${data.public_visible})`);
  } else {
    console.log('Strategy already exists at this config_hash — no-op');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
