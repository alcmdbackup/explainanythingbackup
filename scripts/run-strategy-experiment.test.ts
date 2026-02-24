// Tests for strategy experiment CLI — arg parsing, plan generation, state file persistence.

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const SCRIPT = path.resolve(__dirname, 'run-strategy-experiment.ts');
const STATE_FILE = path.resolve(__dirname, '..', 'experiments', 'strategy-experiment.json');
const STATE_BACKUP = `${STATE_FILE}.test-backup`;

function runCLI(args: string[]): string {
  return execFileSync('npx', ['tsx', SCRIPT, ...args], {
    cwd: path.resolve(__dirname, '..'),
    timeout: 30_000,
    encoding: 'utf-8',
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('run-strategy-experiment CLI', () => {
  // Back up and restore state file around tests
  beforeAll(() => {
    if (fs.existsSync(STATE_FILE)) {
      fs.copyFileSync(STATE_FILE, STATE_BACKUP);
    }
  });

  afterAll(() => {
    // Restore original state
    if (fs.existsSync(STATE_BACKUP)) {
      fs.copyFileSync(STATE_BACKUP, STATE_FILE);
      fs.unlinkSync(STATE_BACKUP);
    } else if (fs.existsSync(STATE_FILE)) {
      fs.unlinkSync(STATE_FILE);
    }
  });

  describe('help', () => {
    it('shows usage with --help', () => {
      const output = runCLI(['--help']);
      expect(output).toContain('Strategy Experiment CLI');
      expect(output).toContain('plan');
      expect(output).toContain('run');
      expect(output).toContain('analyze');
      expect(output).toContain('status');
    });
  });

  describe('plan command', () => {
    it('shows L8 matrix for round 1', () => {
      const output = runCLI(['plan', '--round', '1']);
      expect(output).toContain('Round 1');
      expect(output).toContain('Screening');
      expect(output).toContain('deepseek');
      expect(output).toContain('gpt-5-mini');
      expect(output).toContain('iterativeEditing');
      // Should show 8 runs
      expect(output).toContain('Gen Model');
    });

    it('shows full factorial for round 2 with --vary', () => {
      const output = runCLI([
        'plan', '--round', '2',
        '--vary', 'iterations=3,5,8',
        '--lock', 'genModel=deepseek-chat',
      ]);
      expect(output).toContain('Round 2');
      expect(output).toContain('Refinement');
      expect(output).toContain('genModel');
      expect(output).toContain('Total runs: 3');
    });
  });

  describe('analyze command', () => {
    it('errors when no state file exists', () => {
      if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
      expect(() => runCLI(['analyze', '--round', '1'])).toThrow();
    });

    it('analyzes mock state file with completed runs', () => {
      // Write a synthetic state file with completed runs
      const mockState = {
        experimentId: 'test-experiment',
        prompt: 'Explain blockchain',
        rounds: [{
          round: 1,
          type: 'screening',
          design: 'L8',
          factors: {
            A: { name: 'genModel', label: 'Generation Model', low: 'deepseek-chat', high: 'gpt-5-mini' },
            B: { name: 'judgeModel', label: 'Judge Model', low: 'gpt-4.1-nano', high: 'gpt-5-nano' },
            C: { name: 'iterations', label: 'Iterations', low: 3, high: 8 },
            D: { name: 'editor', label: 'Editing Approach', low: 'iterativeEditing', high: 'treeSearch' },
            E: { name: 'supportAgents', label: 'Support Agents', low: 'off', high: 'on' },
          },
          runs: [
            { row: 1, runId: 'mock-1', status: 'completed', topElo: 1650, costUsd: 0.82 },
            { row: 2, runId: 'mock-2', status: 'completed', topElo: 1720, costUsd: 1.45 },
            { row: 3, runId: 'mock-3', status: 'completed', topElo: 1580, costUsd: 0.91 },
            { row: 4, runId: 'mock-4', status: 'completed', topElo: 1690, costUsd: 1.20 },
            { row: 5, runId: 'mock-5', status: 'completed', topElo: 1810, costUsd: 2.30 },
            { row: 6, runId: 'mock-6', status: 'completed', topElo: 1750, costUsd: 2.10 },
            { row: 7, runId: 'mock-7', status: 'completed', topElo: 1680, costUsd: 1.85 },
            { row: 8, runId: 'mock-8', status: 'completed', topElo: 1790, costUsd: 2.50 },
          ],
        }],
      };

      const dir = path.dirname(STATE_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify(mockState, null, 2));

      const output = runCLI(['analyze', '--round', '1']);
      expect(output).toContain('Experiment Analysis');
      expect(output).toContain('Main Effects');
      expect(output).toContain('Elo');
      expect(output).toContain('Recommendations');
      // Should show all 8 completed
      expect(output).toContain('8/8');
    });
  });

  describe('validatePrerequisites (path regression)', () => {
    it('run-evolution-local.ts exists at the path referenced by validatePrerequisites', () => {
      // Regression test: the script was moved from scripts/ to evolution/scripts/
      // but validatePrerequisites() was not updated, causing "not found" errors.
      const scriptPath = path.resolve(__dirname, '..', 'evolution', 'scripts', 'run-evolution-local.ts');
      expect(fs.existsSync(scriptPath)).toBe(true);
    });

    it('run command passes preflight validation (does not fail with path error)', () => {
      // The run command calls validatePrerequisites() which checks the script path.
      // This will fail later (LLM calls, state, etc.) but must NOT fail with "not found".
      try {
        runCLI(['run', '--round', '1', '--prompt', 'test']);
      } catch (e: unknown) {
        const err = e as { stderr?: Buffer | string; message?: string };
        const stderr = err.stderr?.toString() ?? err.message ?? '';
        expect(stderr).not.toContain('run-evolution-local.ts not found');
        expect(stderr).not.toContain('missing required flags');
      }
    });
  });

  describe('status command', () => {
    it('reports no state when no experiment exists', () => {
      // Remove state file for clean test
      if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
      const output = runCLI(['status']);
      expect(output).toContain('No experiment state found');
    });
  });
});
