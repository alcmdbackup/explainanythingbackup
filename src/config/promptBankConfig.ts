// Curated prompt bank config for fair cross-method article quality comparison.
// Defines canonical prompts and the generation methods to compare.

export type Difficulty = 'easy' | 'medium' | 'hard';
export type Domain = 'science' | 'history' | 'technology' | 'economics' | 'philosophy';

export interface PromptBankEntry {
  prompt: string;
  difficulty: Difficulty;
  domain: Domain;
}

export type GenerationMethodType = 'oneshot' | 'evolution';

export interface OneshotMethod {
  type: 'oneshot';
  model: string;
  label: string; // e.g. "oneshot_gpt-4.1-mini"
}

export interface EvolutionMethod {
  type: 'evolution';
  seedModel: string;
  evolutionModel: string;
  checkpoints: number[]; // e.g. [3, 5, 10] — runs to max, snapshots best variant at each
  mode: 'minimal' | 'full'; // minimal = 2 agents (generation + calibration), full = 7 agents
  label: string; // e.g. "evolution_deepseek"
}

export type MethodConfig = OneshotMethod | EvolutionMethod;

export interface PromptBankConfig {
  prompts: PromptBankEntry[];
  methods: MethodConfig[];
  comparison: {
    judgeModel: string;
    rounds: number;
  };
}

export const PROMPT_BANK: PromptBankConfig = {
  prompts: [
    // Easy (1) — fundamental concept
    { prompt: 'Explain photosynthesis', difficulty: 'easy', domain: 'science' },

    // Medium (2) — multi-faceted concepts, moderate depth
    { prompt: 'Explain how blockchain technology works', difficulty: 'medium', domain: 'technology' },
    { prompt: 'Explain the causes of World War I', difficulty: 'medium', domain: 'history' },

    // Hard (2) — cross-disciplinary, requires nuanced explanation
    { prompt: 'Explain the philosophical implications of Gödel\'s incompleteness theorems', difficulty: 'hard', domain: 'philosophy' },
    { prompt: 'Explain how the Federal Reserve\'s monetary policy affects global markets', difficulty: 'hard', domain: 'economics' },
  ],

  methods: [
    { type: 'oneshot', model: 'gpt-4.1-mini', label: 'oneshot_gpt-4.1-mini' },
    { type: 'oneshot', model: 'gpt-4.1', label: 'oneshot_gpt-4.1' },
    { type: 'oneshot', model: 'deepseek-chat', label: 'oneshot_deepseek-chat' },
    { type: 'evolution', seedModel: 'deepseek-chat', evolutionModel: 'deepseek-chat', checkpoints: [3, 5, 10], mode: 'minimal', label: 'evolution_deepseek' },
  ],

  comparison: {
    judgeModel: 'gpt-4.1-nano',
    rounds: 3,
  },
};
