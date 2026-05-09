/**
 * Pulls sample failing propose/approve invocations from staging:
 *   - 3 invocations with mirrorAbortReason = 'a_prime_format_invalid'
 *   - 3 invocations with mirrorAbortReason = 'mirror_parse_null'
 *   - 3 invocations where forward accepted edits were dropped via aggregator
 *
 * Prints relevant slices of execution_detail so we can debug what's breaking.
 */

import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

function loadEnv(): { url: string; serviceRoleKey: string } {
  for (const c of ['.env.local', '.env']) {
    const p = path.resolve(process.cwd(), c);
    if (fs.existsSync(p)) dotenv.config({ path: p, override: true });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing supabase env');
  return { url, serviceRoleKey: key };
}

function trim(s: string | undefined, n: number): string {
  if (!s) return '—';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

async function main() {
  const { url, serviceRoleKey } = loadEnv();
  const db = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

  // Find recent propose/approve runs.
  const { data: runs } = await db
    .from('evolution_runs')
    .select('id, evolution_strategies!inner(config, is_test_content)')
    .eq('status', 'completed')
    .eq('evolution_strategies.is_test_content', false)
    .order('created_at', { ascending: false })
    .limit(50);

  const paRuns = (runs ?? []).filter((r) => {
    const cfg = (r.evolution_strategies as unknown as { config: { iterationConfigs?: Array<{ agentType: string }> } } | null)?.config;
    return cfg?.iterationConfigs?.some((ic) => ic.agentType === 'proposer_approver_criteria_generate');
  }).slice(0, 5);

  if (paRuns.length === 0) {
    console.log('No propose/approve runs found.');
    return;
  }

  console.log(`Examining ${paRuns.length} propose/approve runs: ${paRuns.map((r) => r.id.slice(0, 8)).join(', ')}\n`);

  const { data: invocations } = await db
    .from('evolution_agent_invocations')
    .select('id, run_id, agent_name, execution_detail, success, error_message')
    .in('run_id', paRuns.map((r) => r.id))
    .eq('agent_name', 'proposer_approver_criteria_generate');

  const all = invocations ?? [];
  console.log(`Total propose/approve invocations: ${all.length}`);

  const aPrimeFails = all.filter((i) => {
    const d = i.execution_detail as Record<string, unknown> | null;
    return d?.mirrorAbortReason === 'a_prime_format_invalid';
  });
  const mirrorParseFails = all.filter((i) => {
    const d = i.execution_detail as Record<string, unknown> | null;
    return d?.mirrorAbortReason === 'mirror_parse_null';
  });
  console.log(`  a_prime_format_invalid: ${aPrimeFails.length}`);
  console.log(`  mirror_parse_null:      ${mirrorParseFails.length}`);
  console.log(`  no abort:               ${all.length - aPrimeFails.length - mirrorParseFails.length}`);
  console.log();

  // ── Sample 3 a_prime_format_invalid invocations ──────────────────────────
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  SAMPLE: a_prime_format_invalid');
  console.log('═══════════════════════════════════════════════════════════════════\n');
  for (const inv of aPrimeFails.slice(0, 3)) {
    const d = inv.execution_detail as Record<string, unknown> | null;
    const cycles = (d?.cycles as Array<Record<string, unknown>> | undefined) ?? [];
    const c0 = cycles[0] ?? {};
    console.log(`Invocation ${inv.id.slice(0, 8)} (run ${inv.run_id.slice(0, 8)})`);
    console.log(`  proposedGroupsRaw:   ${c0.proposedGroupsRaw ?? '—'}`);
    console.log(`  approverGroups:      ${c0.approverGroups ?? '—'}`);
    const fwd = (c0.forwardDecisions as Array<{ decision?: string }> | undefined) ?? [];
    const fwdAccepts = fwd.filter((d) => d.decision === 'accept').length;
    console.log(`  forwardDecisions:    ${fwd.length} total, ${fwdAccepts} accepted`);
    console.log(`  appliedGroups:       ${typeof c0.appliedGroups === 'number' ? c0.appliedGroups : Array.isArray(c0.appliedGroups) ? c0.appliedGroups.length : '—'}`);
    console.log(`  childText snippet:   ${trim(c0.childText as string | undefined, 200).replace(/\n/g, ' ')}`);
    console.log(`  proposerOutput head: ${trim(c0.proposerOutput as string | undefined, 200).replace(/\n/g, ' ')}`);
    console.log();
  }

  // ── Sample 3 mirror_parse_null invocations ────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  SAMPLE: mirror_parse_null');
  console.log('═══════════════════════════════════════════════════════════════════\n');
  for (const inv of mirrorParseFails.slice(0, 3)) {
    const d = inv.execution_detail as Record<string, unknown> | null;
    const cycles = (d?.cycles as Array<Record<string, unknown>> | undefined) ?? [];
    const c0 = cycles[0] ?? {};
    console.log(`Invocation ${inv.id.slice(0, 8)} (run ${inv.run_id.slice(0, 8)})`);
    console.log(`  proposedGroupsRaw:   ${c0.proposedGroupsRaw ?? '—'}`);
    console.log(`  approverGroups:      ${c0.approverGroups ?? '—'}`);
    const fwd = (c0.forwardDecisions as Array<{ decision?: string }> | undefined) ?? [];
    const fwdAccepts = fwd.filter((d) => d.decision === 'accept').length;
    console.log(`  forwardDecisions:    ${fwd.length} total, ${fwdAccepts} accepted`);
    console.log(`  mirrorRawOutput:     ${trim(c0.mirrorRawOutput as string | undefined, 800).replace(/\n/g, '\\n')}`);
    console.log();
  }

  // ── Print full execution_detail keys for one sample so we know what's there ──
  if (aPrimeFails.length > 0) {
    const sample = aPrimeFails[0]!;
    const d = sample.execution_detail as Record<string, unknown> | null;
    const cycles = (d?.cycles as Array<Record<string, unknown>> | undefined) ?? [];
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('  Full execution_detail keys (sample a_prime invocation)');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log(`  top-level: ${Object.keys(d ?? {}).join(', ')}`);
    if (cycles.length > 0) {
      console.log(`  cycles[0]: ${Object.keys(cycles[0]!).join(', ')}`);
    }
    console.log();
  }
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
