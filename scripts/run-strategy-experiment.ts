// CLI orchestrator for strategy experiments using fractional factorial design.
// Runs L8 orthogonal array experiments to find Elo-optimal pipeline configurations.
//
// Usage:
//   npx tsx scripts/run-strategy-experiment.ts plan --round 1
//   npx tsx scripts/run-strategy-experiment.ts run --round 1 --prompt "Explain blockchain"
//   npx tsx scripts/run-strategy-experiment.ts analyze --round 1
//   npx tsx scripts/run-strategy-experiment.ts status

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

import {
  generateL8Design,
  generateFullFactorial,
  mapFactorsToPipelineArgs,
  type ExperimentDesign,
  type ExperimentRunConfig,
  type FactorDefinition,
  type MultiLevelFactor,
  DEFAULT_ROUND1_FACTORS,
} from '../src/lib/evolution/experiment/factorial';
import {
  analyzeExperiment,
  type ExperimentRun,
  type AnalysisResult,
} from '../src/lib/evolution/experiment/analysis';

// ─── Types ────────────────────────────────────────────────────────

interface ExperimentState {
  experimentId: string;
  prompt?: string;
  rounds: RoundState[];
}

interface RoundState {
  round: number;
  type: 'screening' | 'refinement' | 'confirmation';
  design: 'L8' | 'full-factorial';
  factors: Record<string, FactorDefinition>;
  runs: ExperimentRun[];
  analysis?: AnalysisResult;
  lockedFactors?: Record<string, string | number>;
}

interface CLIArgs {
  command: 'plan' | 'run' | 'analyze' | 'status';
  round: number;
  prompt?: string;
  retryFailed: boolean;
  timeout: number;
  vary: Record<string, (string | number)[]>;
  lock: Record<string, string | number>;
}

// ─── Constants ────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(__dirname, '..');
const STATE_FILE = path.resolve(PROJECT_ROOT, 'experiments', 'strategy-experiment.json');
const DEFAULT_TIMEOUT = 20 * 60 * 1000; // 20 minutes

// ─── CLI Parsing ──────────────────────────────────────────────────

function parseArgs(): CLIArgs {
  const args = process.argv.slice(2);
  const command = args[0] as CLIArgs['command'];

  if (!command || !['plan', 'run', 'analyze', 'status'].includes(command)) {
    printUsage();
    process.exit(1);
  }

  function getValue(name: string): string | undefined {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
  }

  function getFlag(name: string): boolean {
    return args.includes(`--${name}`);
  }

  function getAllValues(name: string): string[] {
    const results: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === `--${name}` && i + 1 < args.length) {
        results.push(args[i + 1]);
      }
    }
    return results;
  }

  // Parse --vary "factor=level1,level2,..."
  const vary: Record<string, (string | number)[]> = {};
  for (const v of getAllValues('vary')) {
    const [name, levelsStr] = v.split('=');
    if (name && levelsStr) {
      vary[name] = levelsStr.split(',').map((s) => {
        const n = Number(s);
        return isNaN(n) ? s : n;
      });
    }
  }

  // Parse --lock "factor=value"
  const lock: Record<string, string | number> = {};
  for (const l of getAllValues('lock')) {
    const [name, value] = l.split('=');
    if (name && value) {
      const n = Number(value);
      lock[name] = isNaN(n) ? value : n;
    }
  }

  // EXP-5: Validate no key overlap between --vary and --lock
  const overlap = Object.keys(vary).filter((k) => k in lock);
  if (overlap.length > 0) {
    throw new Error(`--vary and --lock conflict: keys [${overlap.join(', ')}] appear in both`);
  }

  return {
    command,
    round: parseInt(getValue('round') ?? '1', 10),
    prompt: getValue('prompt'),
    retryFailed: getFlag('retry-failed'),
    timeout: parseInt(getValue('timeout') ?? String(DEFAULT_TIMEOUT), 10),
    vary,
    lock,
  };
}

function printUsage() {
  console.log(`Strategy Experiment CLI

Commands:
  plan      Preview experiment design + cost estimates
  run       Execute experiment round
  analyze   Re-analyze completed round
  status    Show experiment status

Options:
  --round <n>          Round number (default: 1)
  --prompt <text>      Topic prompt for experiment runs
  --retry-failed       Retry failed runs from a previous attempt
  --timeout <ms>       Per-run timeout in ms (default: ${DEFAULT_TIMEOUT})
  --vary <f=l1,l2>     (Round 2+) Factor with multiple levels
  --lock <f=value>     (Round 2+) Lock factor at specific value
  --help               Show this help

Examples:
  npx tsx scripts/run-strategy-experiment.ts plan --round 1
  npx tsx scripts/run-strategy-experiment.ts run --round 1 --prompt "Explain blockchain"
  npx tsx scripts/run-strategy-experiment.ts analyze --round 1
  npx tsx scripts/run-strategy-experiment.ts plan --round 2 --vary "iterations=3,5,8,12" --lock "genModel=deepseek-chat"`);
}

// ─── State File ───────────────────────────────────────────────────

function loadState(): ExperimentState | null {
  if (!fs.existsSync(STATE_FILE)) return null;
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
}

function saveState(state: ExperimentState): void {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Atomic write: write to temp then rename
  const tmpFile = `${STATE_FILE}.tmp.${process.pid}`;
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2));
  fs.renameSync(tmpFile, STATE_FILE);
}

// ─── Pre-flight Validation ────────────────────────────────────────

function validatePrerequisites(): void {
  // Verify run-evolution-local.ts supports --judge-model and --enabled-agents
  const scriptPath = path.resolve(PROJECT_ROOT, 'scripts', 'run-evolution-local.ts');
  if (!fs.existsSync(scriptPath)) {
    console.error('Error: scripts/run-evolution-local.ts not found');
    process.exit(1);
  }

  try {
    const helpOutput = execFileSync('npx', ['tsx', scriptPath, '--help'], {
      cwd: PROJECT_ROOT,
      env: process.env,
      timeout: 30_000,
      encoding: 'utf-8',
    });

    const missingFlags: string[] = [];
    if (!helpOutput.includes('--judge-model')) missingFlags.push('--judge-model');
    if (!helpOutput.includes('--enabled-agents')) missingFlags.push('--enabled-agents');

    if (missingFlags.length > 0) {
      console.error(`Error: run-evolution-local.ts missing required flags: ${missingFlags.join(', ')}`);
      console.error('Phase 1 plumbing must be complete before running experiments.');
      process.exit(1);
    }
  } catch (error) {
    console.error('Error: Failed to verify run-evolution-local.ts flags');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// ─── Plan Command ─────────────────────────────────────────────────

function commandPlan(cliArgs: CLIArgs): void {
  const { round } = cliArgs;

  if (round === 1) {
    const design = generateL8Design();
    console.log('\n┌─────────────────────────────────────────────┐');
    console.log('│  Strategy Experiment — Round 1 (Screening)   │');
    console.log('└─────────────────────────────────────────────┘\n');

    console.log('Factors:');
    for (const [key, factor] of Object.entries(design.factors)) {
      console.log(`  ${key}: ${factor.label} — Low: ${factor.low}, High: ${factor.high}`);
    }

    console.log('\nL8 Run Matrix:');
    console.log('  Run | Gen Model    | Judge     | Iters | Editor        | Support');
    console.log('  ----|--------------|-----------|-------|---------------|--------');
    for (const run of design.runs) {
      const f = run.factors;
      console.log(
        `   ${String(run.row).padEnd(2)}` +
        ` | ${String(f.genModel).padEnd(12)}` +
        ` | ${String(f.judgeModel).padEnd(9)}` +
        ` | ${String(f.iterations).padEnd(5)}` +
        ` | ${String(f.editor).padEnd(13)}` +
        ` | ${String(f.supportAgents)}`
      );
    }

    console.log('\nInteraction columns:', design.interactionColumns.map((c) => c.label).join(', '));
    console.log('\nEstimated total cost: ~$16 (cheap runs ~$0.50-1.50, expensive ~$3-5)');
    console.log('Budget per run: $5.00 ceiling (cost varies naturally)\n');
  } else {
    // Round 2+: use --vary and --lock to build a design
    const varyFactors = Object.entries(cliArgs.vary);
    if (varyFactors.length === 0) {
      console.error('Error: Round 2+ requires --vary flags to specify factors and levels');
      process.exit(1);
    }

    const multiFactors: MultiLevelFactor[] = varyFactors.map(([name, levels]) => ({
      name,
      label: name,
      levels,
    }));

    const combos = generateFullFactorial(multiFactors);
    console.log(`\n┌─────────────────────────────────────────────┐`);
    console.log(`│  Strategy Experiment — Round ${round} (Refinement) │`);
    console.log(`└─────────────────────────────────────────────┘\n`);

    if (Object.keys(cliArgs.lock).length > 0) {
      console.log('Locked factors:');
      for (const [name, value] of Object.entries(cliArgs.lock)) {
        console.log(`  ${name} = ${value}`);
      }
      console.log('');
    }

    console.log(`Varying factors: ${multiFactors.map((f) => `${f.name} (${f.levels.join(', ')})`).join(', ')}`);
    console.log(`Total runs: ${combos.length}\n`);

    for (let i = 0; i < combos.length; i++) {
      const merged = { ...cliArgs.lock, ...combos[i] };
      console.log(`  Run ${i + 1}: ${JSON.stringify(merged)}`);
    }
    console.log('');
  }
}

// ─── Run Command ──────────────────────────────────────────────────

function commandRun(cliArgs: CLIArgs): void {
  const { round, prompt, timeout } = cliArgs;

  if (!prompt) {
    console.error('Error: --prompt required for run command');
    process.exit(1);
  }

  // Pre-flight check
  validatePrerequisites();

  // Load or create state
  let state = loadState() ?? {
    experimentId: `strategy-experiment-${new Date().toISOString().slice(0, 10)}`,
    prompt,
    rounds: [],
  };

  // Find or create round
  let roundState = state.rounds.find((r) => r.round === round);

  if (!roundState) {
    if (round === 1) {
      const design = generateL8Design();
      roundState = {
        round,
        type: 'screening',
        design: 'L8',
        factors: design.factors,
        runs: design.runs.map((r) => ({
          row: r.row,
          runId: '',
          status: 'pending' as const,
        })),
      };
    } else {
      // Round 2+: build from --vary and --lock
      const multiFactors: MultiLevelFactor[] = Object.entries(cliArgs.vary).map(([name, levels]) => ({
        name, label: name, levels,
      }));
      const combos = generateFullFactorial(multiFactors);
      const factors: Record<string, FactorDefinition> = {};
      for (const [name, levels] of Object.entries(cliArgs.vary)) {
        factors[name] = { name, label: name, low: levels[0], high: levels[levels.length - 1] };
      }
      roundState = {
        round,
        type: 'refinement',
        design: 'full-factorial',
        factors,
        runs: combos.map((_, i) => ({
          row: i + 1,
          runId: '',
          status: 'pending' as const,
        })),
        lockedFactors: cliArgs.lock,
      };
    }
    state.rounds.push(roundState);
    saveState(state);
  }

  // Determine which runs to execute
  const runsToExecute = cliArgs.retryFailed
    ? roundState.runs.filter((r) => r.status === 'failed' || r.status === 'pending')
    : roundState.runs.filter((r) => r.status !== 'completed');

  if (runsToExecute.length === 0) {
    console.log('All runs completed. Use --retry-failed to re-run failed runs.');
    return;
  }

  // Build the design to get pipeline args
  const design = round === 1
    ? generateL8Design(roundState.factors)
    : null;

  const combos = round !== 1
    ? generateFullFactorial(
        Object.entries(cliArgs.vary).map(([name, levels]) => ({ name, label: name, levels })),
      )
    : null;

  console.log(`\n┌─────────────────────────────────────────────┐`);
  console.log(`│  Running Round ${round} — ${runsToExecute.length} of ${roundState.runs.length} runs  │`);
  console.log(`└─────────────────────────────────────────────┘\n`);

  for (const run of runsToExecute) {
    const runIdx = roundState.runs.indexOf(run);

    // Get pipeline args for this run
    let pipelineArgs: ExperimentRunConfig['pipelineArgs'];
    if (design) {
      pipelineArgs = design.runs[run.row - 1].pipelineArgs;
    } else if (combos) {
      const merged = { ...cliArgs.lock, ...combos[run.row - 1] };
      pipelineArgs = mapFactorsToPipelineArgs(merged);
    } else {
      console.error(`Cannot determine pipeline args for run ${run.row}`);
      continue;
    }

    console.log(`  [${run.row}/${roundState.runs.length}] Running: model=${pipelineArgs.model}, judge=${pipelineArgs.judgeModel}, iters=${pipelineArgs.iterations}, agents=[${pipelineArgs.enabledAgents.join(',')}]`);

    // Mark as running
    roundState.runs[runIdx] = { ...run, status: 'running' };
    saveState(state);

    const childArgs = [
      'tsx', 'scripts/run-evolution-local.ts',
      '--prompt', prompt,
      '--model', pipelineArgs.model,
      '--judge-model', pipelineArgs.judgeModel,
      '--iterations', String(pipelineArgs.iterations),
      '--enabled-agents', pipelineArgs.enabledAgents.join(','),
      '--bank',
      '--full',
    ];

    try {
      const startMs = Date.now();
      const output = execFileSync('npx', childArgs, {
        cwd: PROJECT_ROOT,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        encoding: 'utf-8',
      });

      const durationMs = Date.now() - startMs;

      // Parse run ID and results from output
      const runIdMatch = output.match(/Run ID:\s+([a-f0-9-]+)/);
      const costMatch = output.match(/Total cost:\s+\$([0-9.]+)/);
      const eloMatch = output.match(/#1\s+\[(\d+)\]/);

      // Warn on parse failures so users know results may be incomplete
      const parseWarnings: string[] = [];
      if (!runIdMatch) parseWarnings.push('Run ID');
      if (!costMatch) parseWarnings.push('cost');
      if (!eloMatch) parseWarnings.push('top Elo');
      if (parseWarnings.length > 0) {
        console.warn(`    ⚠ Could not parse: ${parseWarnings.join(', ')} — output format may have changed`);
      }

      roundState.runs[runIdx] = {
        row: run.row,
        runId: runIdMatch?.[1] ?? '',
        status: 'completed',
        topElo: eloMatch ? parseInt(eloMatch[1], 10) : undefined,
        costUsd: costMatch ? parseFloat(costMatch[1]) : undefined,
      };

      console.log(`  [${run.row}/${roundState.runs.length}] ✓ Completed in ${(durationMs / 1000).toFixed(0)}s — Elo: ${roundState.runs[runIdx].topElo ?? '?'}, Cost: $${roundState.runs[runIdx].costUsd?.toFixed(2) ?? '?'}`);
    } catch (error) {
      roundState.runs[runIdx] = {
        row: run.row,
        runId: '',
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
      console.error(`  [${run.row}/${roundState.runs.length}] ✗ Failed: ${error instanceof Error ? error.message.slice(0, 100) : String(error).slice(0, 100)}`);
    }

    // Persist after each run (resume support)
    saveState(state);
  }

  // Auto-analyze if all runs are done
  const completed = roundState.runs.filter((r) => r.status === 'completed');
  if (completed.length === roundState.runs.length) {
    console.log('\nAll runs completed — running analysis...\n');
    if (design) {
      const result = analyzeExperiment(design, roundState.runs);
      roundState.analysis = result;
      saveState(state);
      printAnalysis(result);
    }
  } else {
    console.log(`\n${completed.length}/${roundState.runs.length} runs completed. Use 'analyze' after remaining runs finish.`);
  }
}

// ─── Analyze Command ──────────────────────────────────────────────

function commandAnalyze(cliArgs: CLIArgs): void {
  const state = loadState();
  if (!state) {
    console.error('Error: No experiment state file found. Run "plan" first.');
    process.exit(1);
  }

  const roundState = state.rounds.find((r) => r.round === cliArgs.round);
  if (!roundState) {
    console.error(`Error: Round ${cliArgs.round} not found in experiment state.`);
    process.exit(1);
  }

  const design = generateL8Design(roundState.factors);
  const result = analyzeExperiment(design, roundState.runs);
  roundState.analysis = result;
  saveState(state);
  printAnalysis(result);
}

function printAnalysis(result: AnalysisResult): void {
  console.log('┌─────────────────────────────────────────────┐');
  console.log('│  Experiment Analysis                         │');
  console.log('└─────────────────────────────────────────────┘\n');

  if (result.warnings.length > 0) {
    console.log('Warnings:');
    for (const w of result.warnings) console.log(`  ⚠ ${w}`);
    console.log('');
  }

  console.log(`Completed: ${result.completedRuns}/${result.totalRuns} runs\n`);

  console.log('Main Effects (Elo):');
  for (const f of result.factorRanking) {
    const sign = f.eloEffect > 0 ? '+' : '';
    const bar = '█'.repeat(Math.min(20, Math.round(f.importance / 5)));
    console.log(`  ${f.factor} ${f.factorLabel.padEnd(20)} ${sign}${Math.round(f.eloEffect).toString().padStart(4)} Elo  ${bar}`);
  }

  console.log('\nMain Effects (Elo/$):');
  for (const f of result.factorRanking) {
    const epd = f.eloPerDollarEffect;
    const sign = epd > 0 ? '+' : '';
    console.log(`  ${f.factor} ${f.factorLabel.padEnd(20)} ${sign}${Math.round(epd).toString().padStart(4)} Elo/$`);
  }

  if (result.interactions.length > 0) {
    console.log('\nInteraction Effects:');
    for (const i of result.interactions) {
      console.log(`  ${i.label}: ${i.elo > 0 ? '+' : ''}${Math.round(i.elo)} Elo, ${i.eloPerDollar > 0 ? '+' : ''}${Math.round(i.eloPerDollar)} Elo/$`);
    }
  }

  console.log('\nRecommendations:');
  for (const rec of result.recommendations) {
    console.log(`  → ${rec}`);
  }
  console.log('');
}

// ─── Status Command ───────────────────────────────────────────────

function commandStatus(): void {
  const state = loadState();
  if (!state) {
    console.log('No experiment state found. Run "plan" to get started.');
    return;
  }

  console.log(`\nExperiment: ${state.experimentId}`);
  if (state.prompt) console.log(`Prompt: "${state.prompt}"`);
  console.log(`Rounds: ${state.rounds.length}\n`);

  for (const round of state.rounds) {
    const completed = round.runs.filter((r) => r.status === 'completed').length;
    const failed = round.runs.filter((r) => r.status === 'failed').length;
    const pending = round.runs.filter((r) => r.status === 'pending' || r.status === 'running').length;

    console.log(`  Round ${round.round} (${round.type}, ${round.design}):`);
    console.log(`    Runs: ${completed} completed, ${failed} failed, ${pending} pending (${round.runs.length} total)`);

    if (round.analysis) {
      console.log(`    Top factor: ${round.analysis.factorRanking[0]?.factorLabel ?? 'N/A'} (${Math.round(round.analysis.factorRanking[0]?.eloEffect ?? 0)} Elo)`);
    }
    console.log('');
  }
}

// ─── Main ─────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.length === 0) {
    printUsage();
    process.exit(0);
  }

  const cliArgs = parseArgs();

  switch (cliArgs.command) {
    case 'plan':
      commandPlan(cliArgs);
      break;
    case 'run':
      commandRun(cliArgs);
      break;
    case 'analyze':
      commandAnalyze(cliArgs);
      break;
    case 'status':
      commandStatus();
      break;
  }
}

main();
