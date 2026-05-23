/**
 * Pull parent text from a few propose/approve invocations that failed with
 * a_prime_format_invalid, run validateFormat on each, and print which rule
 * is closest-to-failing. Helps narrow which rule the post-apply article is
 * crossing.
 */

import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { validateFormat } from '../src/lib/shared/enforceVariantFormat';

function loadEnv() {
  for (const c of ['.env.local', '.env']) {
    const p = path.resolve(process.cwd(), c);
    if (fs.existsSync(p)) dotenv.config({ path: p, override: true });
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing env');
  return { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
}

async function main() {
  const { url, key } = loadEnv();
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: runs } = await db
    .from('evolution_runs')
    .select('id, evolution_strategies!inner(config, is_test_content)')
    .eq('status', 'completed')
    .eq('evolution_strategies.is_test_content', false)
    .order('created_at', { ascending: false })
    .limit(50);
  const paRunIds = (runs ?? []).filter((r) => {
    const cfg = (r.evolution_strategies as unknown as { config: { iterationConfigs?: Array<{ agentType: string }> } } | null)?.config;
    return cfg?.iterationConfigs?.some((ic) => ic.agentType === 'proposer_approver_criteria_generate');
  }).slice(0, 5).map((r) => r.id);

  const { data: invocations } = await db
    .from('evolution_agent_invocations')
    .select('id, run_id, execution_detail')
    .eq('agent_name', 'proposer_approver_criteria_generate')
    .in('run_id', paRunIds);

  const aPrimeFails = (invocations ?? []).filter((i) => {
    const d = i.execution_detail as Record<string, unknown> | null;
    return d?.mirrorAbortReason === 'a_prime_format_invalid';
  }).slice(0, 5);

  console.log(`Examining ${aPrimeFails.length} a_prime_format_invalid invocations\n`);

  // Find variants produced by those invocations to reach their parents.
  const failIds = aPrimeFails.map((i) => i.id);
  const { data: variants } = await db
    .from('evolution_variants')
    .select('id, agent_invocation_id, parent_variant_id')
    .in('agent_invocation_id', failIds);

  const parentIds = (variants ?? []).map((v) => v.parent_variant_id).filter((id): id is string => id != null);
  const { data: parents } = await db
    .from('evolution_variants')
    .select('id, variant_content')
    .in('id', parentIds);
  const parentById = new Map((parents ?? []).map((p) => [p.id, p]));
  const invToParent = new Map<string, string>();
  for (const v of variants ?? []) {
    if (v.agent_invocation_id && v.parent_variant_id) invToParent.set(v.agent_invocation_id, v.parent_variant_id);
  }

  for (const inv of aPrimeFails) {
    const parentId = invToParent.get(inv.id);
    const parent = parentId ? parentById.get(parentId) : null;
    if (!parent?.variant_content) {
      console.log(`Invocation ${inv.id.slice(0, 8)}: no parent text (no variant emitted by this invocation, or parent missing)`);
      continue;
    }
    console.log('═'.repeat(70));
    console.log(`Invocation ${inv.id.slice(0, 8)} (run ${inv.run_id.slice(0, 8)})`);
    console.log('═'.repeat(70));

    const parentText: string = parent.variant_content;
    console.log(`  Parent text length: ${parentText.length} chars`);

    const parentResult = validateFormat(parentText);
    console.log(`  Parent format valid: ${parentResult.valid}`);
    if (parentResult.issues.length > 0) {
      console.log(`  Parent issues: ${parentResult.issues.join(' | ')}`);
    }

    const paragraphs = parentText.split(/\n\n+/).map((p) => p.trim()).filter((p) => p.length > 0);
    const sentenceCounts = paragraphs.map((p) => {
      const matches = p.match(/[.!?](?=\s|$)/g);
      return matches ? matches.length : 0;
    });
    const shortParagraphs = sentenceCounts.filter((c) => c < 2).length;
    console.log(`  Paragraphs total: ${paragraphs.length}`);
    console.log(`  Paragraphs with <2 sentences: ${shortParagraphs} (${((shortParagraphs / paragraphs.length) * 100).toFixed(0)}%)`);

    if (shortParagraphs > 0) {
      console.log(`  Short paragraphs (first 3):`);
      let shown = 0;
      for (let i = 0; i < paragraphs.length && shown < 3; i++) {
        if (sentenceCounts[i]! < 2) {
          const trimmed = paragraphs[i]!.length > 100 ? paragraphs[i]!.slice(0, 100) + '…' : paragraphs[i]!;
          console.log(`    [${i}] (${sentenceCounts[i]} sent): ${trimmed}`);
          shown++;
        }
      }
    }

    const firstLine = parentText.trim().split('\n')[0]!;
    console.log(`  First line: ${firstLine.length > 80 ? firstLine.slice(0, 80) + '…' : firstLine}`);

    const sectionLines = parentText.split('\n').filter((l) => l.startsWith('## ') || l.startsWith('### ')).length;
    console.log(`  Section headings: ${sectionLines}`);

    console.log();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
