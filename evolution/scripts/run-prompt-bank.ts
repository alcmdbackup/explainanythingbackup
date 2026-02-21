// Batch generation script for the Hall of Fame prompt bank — reads config, builds coverage matrix,
// generates all missing entries across prompts × methods. Sequential execution with resume support.

import dotenv from 'dotenv';
import path from 'path';
import { execFileSync } from 'child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

import { PROMPT_BANK, type MethodConfig, type EvolutionMethod } from '../src/config/promptBankConfig';
import { formatCost } from '../../src/config/llmPricing';
import { generateOneshotArticle } from './lib/oneshotGenerator';
import { addEntryToHallOfFame } from './lib/hallOfFameUtils';

// ─── Types ────────────────────────────────────────────────────────

interface CLIArgs {
  dryRun: boolean;
  methods: string[];       // method labels to include (empty = all)
  prompts: string[];       // prompt indices or difficulty tiers (empty = all)
  maxCost: number;
  delay: number;
  skipEvolution: boolean;
}

interface CoverageCell {
  exists: boolean;
  entryId?: string;
}

interface CoverageRow {
  prompt: string;
  difficulty: string;
  domain: string;
  topicId: string | null;
  methods: Record<string, CoverageCell>;
}

// ─── CLI Argument Parsing ────────────────────────────────────────

export function parseArgs(argv: string[] = process.argv.slice(2)): CLIArgs {
  function getValue(name: string): string | undefined {
    const idx = argv.indexOf(`--${name}`);
    return idx !== -1 && idx + 1 < argv.length ? argv[idx + 1] : undefined;
  }

  function getFlag(name: string): boolean {
    return argv.includes(`--${name}`);
  }

  if (getFlag('help')) {
    console.log(`Usage: npx tsx scripts/run-prompt-bank.ts [options]

Options:
  --dry-run              Show what would be generated without making LLM calls
  --methods <list>       Comma-separated method labels to run (default: all)
  --prompts <list>       Comma-separated prompt indices or "easy"/"medium"/"hard" (default: all)
  --max-cost <n>         Total budget cap in USD (default: 25.00)
  --delay <ms>           Delay between API calls in ms (default: 2000)
  --skip-evolution       Skip evolution methods (oneshot only)
  --help                 Show help`);
    process.exit(0);
  }

  return {
    dryRun: getFlag('dry-run'),
    methods: getValue('methods')?.split(',').map((s) => s.trim()).filter(Boolean) ?? [],
    prompts: getValue('prompts')?.split(',').map((s) => s.trim()).filter(Boolean) ?? [],
    maxCost: parseFloat(getValue('max-cost') ?? '25.00'),
    delay: parseInt(getValue('delay') ?? '2000', 10),
    skipEvolution: getFlag('skip-evolution'),
  };
}

// ─── Validation ──────────────────────────────────────────────────

function validateApiKeys(methods: MethodConfig[]): void {
  const needed = new Set<string>();

  for (const m of methods) {
    if (m.type === 'oneshot') {
      if (m.model.startsWith('deepseek-')) needed.add('DEEPSEEK_API_KEY');
      else if (m.model.startsWith('claude-')) needed.add('ANTHROPIC_API_KEY');
      else needed.add('OPENAI_API_KEY');
    } else {
      // Evolution uses both seed and evolution models
      if (m.seedModel.startsWith('deepseek-') || m.evolutionModel.startsWith('deepseek-')) needed.add('DEEPSEEK_API_KEY');
      if (m.seedModel.startsWith('claude-') || m.evolutionModel.startsWith('claude-')) needed.add('ANTHROPIC_API_KEY');
      if (!m.seedModel.startsWith('deepseek-') && !m.seedModel.startsWith('claude-')) needed.add('OPENAI_API_KEY');
    }
  }

  needed.add('NEXT_PUBLIC_SUPABASE_URL');
  needed.add('SUPABASE_SERVICE_ROLE_KEY');

  const missing = [...needed].filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`Error: Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
}

// ─── Method Label Expansion ──────────────────────────────────────

/** Expand methods to comparable labels. Evolution methods expand to one label per checkpoint. */
function expandMethodLabels(methods: MethodConfig[]): string[] {
  const labels: string[] = [];
  for (const m of methods) {
    if (m.type === 'oneshot') {
      labels.push(m.label);
    } else {
      for (const cp of m.checkpoints) {
        labels.push(`${m.label}_${cp}iter`);
      }
    }
  }
  return labels;
}

// ─── Coverage Matrix ─────────────────────────────────────────────

async function buildCoverageMatrix(
  supabase: SupabaseClient,
  methods: MethodConfig[],
  prompts: typeof PROMPT_BANK.prompts,
): Promise<CoverageRow[]> {
  const allLabels = expandMethodLabels(methods);
  const rows: CoverageRow[] = [];

  for (const p of prompts) {
    const normalizedPrompt = p.prompt.trim().toLowerCase();

    // Find topic by prompt (case-insensitive)
    const { data: topic } = await supabase
      .from('evolution_hall_of_fame_topics')
      .select('id')
      .ilike('prompt', normalizedPrompt)
      .is('deleted_at', null)
      .single();

    const methodCoverage: Record<string, CoverageCell> = {};
    for (const label of allLabels) {
      methodCoverage[label] = { exists: false };
    }

    if (topic) {
      // Fetch all entries for this topic
      const { data: entries } = await supabase
        .from('evolution_hall_of_fame_entries')
        .select('id, generation_method, model, metadata')
        .eq('topic_id', topic.id)
        .is('deleted_at', null);

      for (const entry of entries ?? []) {
        for (const m of methods) {
          if (m.type === 'oneshot' && entry.generation_method === 'oneshot' && entry.model === m.model) {
            methodCoverage[m.label] = { exists: true, entryId: entry.id };
          } else if (m.type === 'evolution' && entry.generation_method === 'evolution_winner') {
            const meta = entry.metadata as Record<string, unknown> | null;
            const iterations = meta?.iterations;
            const entryIsOutline = meta?.outline_mode === true;
            const methodIsOutline = m.outline === true;
            if (typeof iterations === 'number' && m.checkpoints.includes(iterations) && entryIsOutline === methodIsOutline) {
              const label = `${m.label}_${iterations}iter`;
              methodCoverage[label] = { exists: true, entryId: entry.id };
            }
          }
        }
      }
    }

    rows.push({
      prompt: p.prompt,
      difficulty: p.difficulty,
      domain: p.domain,
      topicId: topic?.id ?? null,
      methods: methodCoverage,
    });
  }

  return rows;
}

// ─── Display ─────────────────────────────────────────────────────

function printCoverageMatrix(rows: CoverageRow[], allLabels: string[]): void {
  const totalEntries = rows.reduce(
    (sum, r) => sum + Object.values(r.methods).filter((c) => c.exists).length, 0,
  );
  const totalSlots = rows.length * allLabels.length;

  console.log(`\n  Coverage: ${totalEntries}/${totalSlots} entries\n`);

  // Header
  const promptCol = 'Prompt'.padEnd(50);
  const methodHeaders = allLabels.map((l) => l.slice(0, 12).padEnd(13)).join('');
  console.log(`  ${promptCol} ${methodHeaders}`);
  console.log(`  ${'─'.repeat(50)} ${'─'.repeat(allLabels.length * 13)}`);

  // Rows
  for (const row of rows) {
    const label = `[${row.difficulty[0]}] ${row.prompt}`.slice(0, 50).padEnd(50);
    const cells = allLabels.map((l) => {
      const cell = row.methods[l];
      return (cell?.exists ? '  ✓  ' : '  ·  ').padEnd(13);
    }).join('');
    console.log(`  ${label} ${cells}`);
  }
  console.log();
}

// ─── Prompt Filtering ────────────────────────────────────────────

function filterPrompts(filter: string[]): typeof PROMPT_BANK.prompts {
  if (filter.length === 0) return PROMPT_BANK.prompts;

  const difficulties = ['easy', 'medium', 'hard'];
  return PROMPT_BANK.prompts.filter((p, idx) => {
    return filter.some((f) => {
      if (difficulties.includes(f)) return p.difficulty === f;
      const num = parseInt(f, 10);
      if (!isNaN(num)) return idx === num;
      return false;
    });
  });
}

function filterMethods(filter: string[], skipEvolution: boolean): MethodConfig[] {
  let methods = PROMPT_BANK.methods;
  if (skipEvolution) {
    methods = methods.filter((m) => m.type === 'oneshot');
  }
  if (filter.length === 0) return methods;
  return methods.filter((m) => filter.includes(m.label));
}

// ─── Sleep ───────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  console.log('\n┌─────────────────────────────────────────┐');
  console.log('│  Prompt Bank — Batch Generation          │');
  console.log('└─────────────────────────────────────────┘\n');

  const prompts = filterPrompts(args.prompts);
  const methods = filterMethods(args.methods, args.skipEvolution);

  console.log(`  Prompts:     ${prompts.length}`);
  console.log(`  Methods:     ${methods.length} (${expandMethodLabels(methods).length} comparable)`);
  console.log(`  Max cost:    ${formatCost(args.maxCost)}`);
  console.log(`  Dry run:     ${args.dryRun ? 'yes' : 'no'}`);

  validateApiKeys(methods);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  // Build coverage matrix
  const allLabels = expandMethodLabels(methods);
  const coverage = await buildCoverageMatrix(supabase, methods, prompts);
  printCoverageMatrix(coverage, allLabels);

  // Count missing entries
  const missing: Array<{ prompt: string; method: MethodConfig; checkpoints?: number[] }> = [];
  for (const row of coverage) {
    for (const m of methods) {
      if (m.type === 'oneshot') {
        if (!row.methods[m.label]?.exists) {
          missing.push({ prompt: row.prompt, method: m });
        }
      } else {
        // Evolution: collect missing checkpoints
        const missingCps = m.checkpoints.filter(
          (cp) => !row.methods[`${m.label}_${cp}iter`]?.exists,
        );
        if (missingCps.length > 0) {
          missing.push({ prompt: row.prompt, method: m, checkpoints: missingCps });
        }
      }
    }
  }

  if (missing.length === 0) {
    console.log('  All entries are generated. Nothing to do.\n');
    return;
  }

  console.log(`  Missing entries: ${missing.length}`);

  if (args.dryRun) {
    console.log('\n  Dry run — would generate:');
    for (const m of missing) {
      if (m.method.type === 'oneshot') {
        console.log(`    "${m.prompt}" × ${m.method.label}`);
      } else {
        console.log(`    "${m.prompt}" × ${m.method.label} [checkpoints: ${m.checkpoints!.join(',')}]`);
      }
    }
    console.log();
    return;
  }

  // Generate missing entries
  let shuttingDown = false;
  let totalCost = 0;
  let generated = 0;
  let skipped = 0;

  process.on('SIGINT', () => { shuttingDown = true; console.log('\n  Graceful shutdown requested...'); });
  process.on('SIGTERM', () => { shuttingDown = true; console.log('\n  Graceful shutdown requested...'); });

  const totalEntries = missing.reduce((sum, m) => {
    if (m.method.type === 'evolution') return sum + (m.checkpoints?.length ?? 0);
    return sum + 1;
  }, 0);
  let entryIdx = 0;

  for (const task of missing) {
    if (shuttingDown) break;

    if (task.method.type === 'oneshot') {
      entryIdx++;
      console.log(`  [${entryIdx}/${totalEntries}] "${task.prompt}" × ${task.method.label}...`);

      try {
        const result = await generateOneshotArticle(task.prompt, task.method.model, supabase);
        await addEntryToHallOfFame(supabase, {
          prompt: task.prompt,
          title: result.title,
          content: result.content,
          generation_method: 'oneshot',
          model: task.method.model,
          total_cost_usd: result.totalCostUsd,
          metadata: {
            model: task.method.model,
            generation_time_ms: result.durationMs,
            prompt_tokens: result.promptTokens,
            completion_tokens: result.completionTokens,
            call_source: `oneshot_${task.method.model}`,
            prompt_templates: ['createTitlePrompt', 'createExplanationPrompt'],
          },
        });

        totalCost += result.totalCostUsd;
        generated++;
        console.log(`  [${entryIdx}/${totalEntries}] ✓ "${task.prompt}" × ${task.method.label} (${formatCost(result.totalCostUsd)})`);
      } catch (error) {
        console.error(`  [${entryIdx}/${totalEntries}] ✗ Failed: ${error instanceof Error ? error.message : String(error)}`);
        skipped++;
      }

      if (totalCost > args.maxCost) {
        console.error(`\n  ✗ Cost cap exceeded (${formatCost(totalCost)} > ${formatCost(args.maxCost)}). Stopping.`);
        break;
      }

      if (!shuttingDown && args.delay > 0) await sleep(args.delay);
    } else {
      // Evolution: spawn child process
      const evoMethod = task.method as EvolutionMethod;
      const missingCps = task.checkpoints!;
      entryIdx += missingCps.length;
      console.log(`  [${entryIdx}/${totalEntries}] "${task.prompt}" × ${evoMethod.label} [${missingCps.join(',')}]...`);

      try {
        const maxCp = Math.max(...missingCps);
        const childArgs = [
          'tsx', 'scripts/run-evolution-local.ts',
          '--prompt', task.prompt,
          '--model', evoMethod.evolutionModel,
          '--seed-model', evoMethod.seedModel,
          '--iterations', String(maxCp),
          '--bank',
          '--bank-checkpoints', missingCps.join(','),
          ...(evoMethod.mode === 'full' ? ['--full'] : []),
          ...(evoMethod.outline ? ['--outline'] : []),
        ];

        const projectRoot = path.resolve(__dirname, '..');
        const timeout = evoMethod.mode === 'full' ? 1_200_000 : 600_000;

        execFileSync('npx', childArgs, {
          cwd: projectRoot,
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout,
          maxBuffer: 10 * 1024 * 1024,
        });

        generated += missingCps.length;
        console.log(`  [${entryIdx}/${totalEntries}] ✓ "${task.prompt}" × ${evoMethod.label} [${missingCps.join(',')}]`);
      } catch (error) {
        console.error(`  [${entryIdx}/${totalEntries}] ✗ Evolution failed: ${error instanceof Error ? error.message : String(error)}`);
        skipped++;
      }

      if (!shuttingDown && args.delay > 0) await sleep(args.delay);
    }
  }

  // Summary
  console.log('\n┌─────────────────────────────────────────┐');
  console.log('│  Batch Generation Complete                │');
  console.log('└─────────────────────────────────────────┘\n');
  console.log(`  Generated:   ${generated}`);
  console.log(`  Skipped:     ${skipped}`);
  console.log(`  Total cost:  ${formatCost(totalCost)} (oneshot only — evolution costs tracked in child)`);
  console.log();
}

main().catch((error) => {
  console.error('Fatal error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
