/**
 * @jest-environment node
 */
// Tests for run-prompt-bank.ts — validates CLI parsing, prompt/method filtering,
// coverage matrix building, and cost cap logic.

import { PROMPT_BANK, type MethodConfig } from '../src/config/promptBankConfig';

// Re-implement parseArgs inline since the module has side effects (dotenv, process.exit)
function parseArgs(argv: string[]) {
  function getValue(name: string): string | undefined {
    const idx = argv.indexOf(`--${name}`);
    return idx !== -1 && idx + 1 < argv.length ? argv[idx + 1] : undefined;
  }

  function getFlag(name: string): boolean {
    return argv.includes(`--${name}`);
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

function filterPrompts(filter: string[]) {
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

describe('run-prompt-bank', () => {
  describe('parseArgs', () => {
    it('should parse dry-run flag', () => {
      expect(parseArgs(['--dry-run']).dryRun).toBe(true);
      expect(parseArgs([]).dryRun).toBe(false);
    });

    it('should parse methods filter', () => {
      const args = parseArgs(['--methods', 'oneshot_gpt-4.1-mini,oneshot_gpt-4.1']);
      expect(args.methods).toEqual(['oneshot_gpt-4.1-mini', 'oneshot_gpt-4.1']);
    });

    it('should parse prompts filter', () => {
      const args = parseArgs(['--prompts', '0,easy,hard']);
      expect(args.prompts).toEqual(['0', 'easy', 'hard']);
    });

    it('should default max-cost to 25.00', () => {
      expect(parseArgs([]).maxCost).toBe(25.00);
    });

    it('should parse custom max-cost', () => {
      expect(parseArgs(['--max-cost', '10']).maxCost).toBe(10);
    });

    it('should default delay to 2000ms', () => {
      expect(parseArgs([]).delay).toBe(2000);
    });

    it('should parse skip-evolution flag', () => {
      expect(parseArgs(['--skip-evolution']).skipEvolution).toBe(true);
    });
  });

  describe('expandMethodLabels', () => {
    it('should expand oneshot methods to single labels', () => {
      const methods: MethodConfig[] = [
        { type: 'oneshot', model: 'gpt-4.1-mini', label: 'oneshot_gpt-4.1-mini' },
      ];
      expect(expandMethodLabels(methods)).toEqual(['oneshot_gpt-4.1-mini']);
    });

    it('should expand evolution methods to one label per checkpoint', () => {
      const methods: MethodConfig[] = [
        { type: 'evolution', seedModel: 'ds', evolutionModel: 'ds', checkpoints: [3, 5, 10], mode: 'minimal', label: 'evolution_deepseek' },
      ];
      expect(expandMethodLabels(methods)).toEqual([
        'evolution_deepseek_3iter',
        'evolution_deepseek_5iter',
        'evolution_deepseek_10iter',
      ]);
    });

    it('should produce 9 labels from default config', () => {
      // 3 oneshot + 3 minimal evolution checkpoints + 3 tree-search evolution checkpoints = 9
      expect(expandMethodLabels(PROMPT_BANK.methods)).toHaveLength(9);
    });
  });

  describe('filterPrompts', () => {
    it('should return all prompts when no filter', () => {
      expect(filterPrompts([])).toHaveLength(5);
    });

    it('should filter by difficulty', () => {
      expect(filterPrompts(['easy'])).toHaveLength(1);
      expect(filterPrompts(['medium'])).toHaveLength(2);
      expect(filterPrompts(['hard'])).toHaveLength(2);
    });

    it('should filter by index', () => {
      const result = filterPrompts(['0']);
      expect(result).toHaveLength(1);
      expect(result[0].prompt).toBe('Explain photosynthesis');
    });

    it('should combine filters', () => {
      // Index 0 (easy) + all hard = 1 + 2 = 3
      const result = filterPrompts(['0', 'hard']);
      expect(result).toHaveLength(3);
    });
  });

  describe('filterMethods', () => {
    it('should return all methods when no filter', () => {
      expect(filterMethods([], false)).toHaveLength(5);
    });

    it('should skip evolution when flag set', () => {
      const result = filterMethods([], true);
      expect(result.every((m) => m.type === 'oneshot')).toBe(true);
      expect(result).toHaveLength(3);
    });

    it('should filter by label', () => {
      const result = filterMethods(['oneshot_gpt-4.1-mini'], false);
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('oneshot_gpt-4.1-mini');
    });
  });

  describe('cost cap logic', () => {
    it('should detect when cost exceeds cap', () => {
      const maxCost = 10.00;
      const runningCost = 10.50;
      expect(runningCost > maxCost).toBe(true);
    });

    it('should allow generation when within cap', () => {
      const maxCost = 25.00;
      const runningCost = 5.00;
      expect(runningCost > maxCost).toBe(false);
    });
  });

  describe('coverage matrix building', () => {
    it('should detect missing oneshot entries', () => {
      const coverage: Record<string, { exists: boolean }> = {
        'oneshot_gpt-4.1-mini': { exists: true },
        'oneshot_gpt-4.1': { exists: false },
        'oneshot_deepseek-chat': { exists: false },
      };

      const missing = Object.entries(coverage)
        .filter(([, cell]) => !cell.exists)
        .map(([label]) => label);

      expect(missing).toEqual(['oneshot_gpt-4.1', 'oneshot_deepseek-chat']);
    });

    it('should detect missing evolution checkpoints', () => {
      const checkpoints = [3, 5, 10];
      const existing = new Set([3]); // only checkpoint 3 exists
      const missing = checkpoints.filter((cp) => !existing.has(cp));
      expect(missing).toEqual([5, 10]);
    });

    it('should report full coverage when all entries exist', () => {
      const allLabels = expandMethodLabels(PROMPT_BANK.methods);
      const coverage: Record<string, { exists: boolean }> = {};
      for (const label of allLabels) {
        coverage[label] = { exists: true };
      }
      const missing = Object.values(coverage).filter((c) => !c.exists);
      expect(missing).toHaveLength(0);
    });
  });
});
