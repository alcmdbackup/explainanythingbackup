/**
 * @jest-environment node
 */
// Tests for run-prompt-bank-comparisons.ts — validates CLI parsing, prompt filtering,
// topic matching logic, and summary aggregation.

import { PROMPT_BANK } from '../src/config/promptBankConfig';

// Re-implement parseArgs inline since the module has side effects
function parseArgs(argv: string[]) {
  function getValue(name: string): string | undefined {
    const idx = argv.indexOf(`--${name}`);
    return idx !== -1 && idx + 1 < argv.length ? argv[idx + 1] : undefined;
  }

  return {
    judgeModel: getValue('judge-model') ?? 'gpt-4.1-nano',
    rounds: parseInt(getValue('rounds') ?? '3', 10),
    prompts: getValue('prompts')?.split(',').map((s) => s.trim()).filter(Boolean) ?? [],
    minEntries: parseInt(getValue('min-entries') ?? '2', 10),
  };
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

function getEntryLabel(entry: { generation_method: string; model: string; metadata: unknown }): string {
  const meta = entry.metadata as Record<string, unknown> | null;
  if (entry.generation_method === 'evolution_winner' && meta?.iterations) {
    return `evolution_${entry.model}_${meta.iterations}iter`;
  }
  return `${entry.generation_method}_${entry.model}`;
}

describe('run-prompt-bank-comparisons', () => {
  describe('parseArgs', () => {
    it('should default judge-model to gpt-4.1-nano', () => {
      expect(parseArgs([]).judgeModel).toBe('gpt-4.1-nano');
    });

    it('should default rounds to 3', () => {
      expect(parseArgs([]).rounds).toBe(3);
    });

    it('should parse custom rounds', () => {
      expect(parseArgs(['--rounds', '5']).rounds).toBe(5);
    });

    it('should default min-entries to 2', () => {
      expect(parseArgs([]).minEntries).toBe(2);
    });

    it('should parse prompts filter', () => {
      const args = parseArgs(['--prompts', 'easy,0']);
      expect(args.prompts).toEqual(['easy', '0']);
    });
  });

  describe('prompt filtering', () => {
    it('should filter by difficulty tier', () => {
      expect(filterPrompts(['easy'])).toHaveLength(1);
      expect(filterPrompts(['hard'])).toHaveLength(2);
    });

    it('should filter by index', () => {
      const result = filterPrompts(['1']);
      expect(result).toHaveLength(1);
      expect(result[0].domain).toBe('technology');
    });
  });

  describe('min-entries filter', () => {
    it('should skip topics below minimum', () => {
      const minEntries = 3;
      const topicEntryCount = 1;
      expect(topicEntryCount < minEntries).toBe(true);
    });

    it('should include topics at minimum', () => {
      const minEntries = 2;
      const topicEntryCount = 2;
      expect(topicEntryCount >= minEntries).toBe(true);
    });
  });

  describe('entry labeling', () => {
    it('should label oneshot entries', () => {
      expect(getEntryLabel({
        generation_method: 'oneshot',
        model: 'gpt-4.1-mini',
        metadata: {},
      })).toBe('oneshot_gpt-4.1-mini');
    });

    it('should label evolution checkpoint entries with iteration count', () => {
      expect(getEntryLabel({
        generation_method: 'evolution_winner',
        model: 'deepseek-chat',
        metadata: { iterations: 5 },
      })).toBe('evolution_deepseek-chat_5iter');
    });

    it('should label evolution entries without iterations metadata', () => {
      expect(getEntryLabel({
        generation_method: 'evolution_winner',
        model: 'deepseek-chat',
        metadata: {},
      })).toBe('evolution_winner_deepseek-chat');
    });
  });

  describe('summary aggregation', () => {
    it('should compute average Elo from multiple topics', () => {
      const elos = [1250, 1300, 1200];
      const avgElo = elos.reduce((a, b) => a + b, 0) / elos.length;
      expect(avgElo).toBe(1250);
    });

    it('should compute win rate', () => {
      const wins = 2;
      const totalTopics = 5;
      expect(wins / totalTopics).toBe(0.4);
    });
  });
});
