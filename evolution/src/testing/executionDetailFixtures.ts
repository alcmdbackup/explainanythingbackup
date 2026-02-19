// Sample AgentExecutionDetail fixtures for all 12 agent types.
// Used across Phase 2 agent tests, Phase 3 server action tests, and Phase 4 component tests.

import type {
  GenerationExecutionDetail,
  CalibrationExecutionDetail,
  TournamentExecutionDetail,
  IterativeEditingExecutionDetail,
  ReflectionExecutionDetail,
  DebateExecutionDetail,
  SectionDecompositionExecutionDetail,
  EvolutionExecutionDetail,
  TreeSearchExecutionDetail,
  OutlineGenerationExecutionDetail,
  ProximityExecutionDetail,
  MetaReviewExecutionDetail,
} from '@evolution/lib/types';

export const generationDetailFixture: GenerationExecutionDetail = {
  detailType: 'generation',
  strategies: [
    { name: 'structural_transform', promptLength: 1200, status: 'success', variantId: 'gen-abc-001', textLength: 1500 },
    { name: 'lexical_simplify', promptLength: 1100, status: 'format_rejected', formatIssues: ['Missing H1 title'] },
    { name: 'grounding_enhance', promptLength: 1300, status: 'error', error: 'LLM timeout' },
  ],
  feedbackUsed: true,
  totalCost: 0.0042,
};

export const calibrationDetailFixture: CalibrationExecutionDetail = {
  detailType: 'calibration',
  entrants: [
    {
      variantId: 'cal-ent-001',
      opponents: ['cal-opp-001', 'cal-opp-002', 'cal-opp-003'],
      matches: [
        { opponentId: 'cal-opp-001', winner: 'cal-ent-001', confidence: 0.85, cacheHit: false },
        { opponentId: 'cal-opp-002', winner: 'cal-opp-002', confidence: 0.72, cacheHit: true },
        { opponentId: 'cal-opp-003', winner: 'cal-ent-001', confidence: 0.91, cacheHit: false },
      ],
      earlyExit: true,
      ratingBefore: { mu: 25, sigma: 8.33 },
      ratingAfter: { mu: 28.5, sigma: 6.1 },
    },
  ],
  avgConfidence: 0.826,
  totalMatches: 3,
  totalCost: 0.018,
};

export const tournamentDetailFixture: TournamentExecutionDetail = {
  detailType: 'tournament',
  budgetPressure: 0.35,
  budgetTier: 'low',
  rounds: [
    {
      roundNumber: 1,
      pairs: [
        { variantA: 'trn-a-001', variantB: 'trn-b-001' },
        { variantA: 'trn-a-002', variantB: 'trn-b-002' },
      ],
      matches: [
        {
          variationA: 'trn-a-001', variationB: 'trn-b-001',
          winner: 'trn-a-001', confidence: 0.78, turns: 2,
          dimensionScores: { clarity: 'A', engagement: 'B' },
        },
        {
          variationA: 'trn-a-002', variationB: 'trn-b-002',
          winner: 'trn-b-002', confidence: 0.65, turns: 2,
          dimensionScores: { clarity: 'B', engagement: 'A' },
        },
      ],
      multiTurnUsed: 0,
    },
  ],
  exitReason: 'convergence',
  convergenceStreak: 5,
  staleRounds: 0,
  totalComparisons: 8,
  flowEnabled: false,
  totalCost: 0.045,
};

export const iterativeEditingDetailFixture: IterativeEditingExecutionDetail = {
  detailType: 'iterativeEditing',
  targetVariantId: 'ie-target-001',
  config: { maxCycles: 3, maxConsecutiveRejections: 3, qualityThreshold: 7.5 },
  cycles: [
    {
      cycleNumber: 1,
      target: { dimension: 'clarity', description: 'Improve sentence clarity in intro', score: 5.2, source: 'rubric' },
      verdict: 'ACCEPT',
      confidence: 0.82,
      formatValid: true,
      newVariantId: 'ie-new-001',
    },
    {
      cycleNumber: 2,
      target: { dimension: 'engagement', description: 'Add compelling hook', score: 4.8, source: 'rubric' },
      verdict: 'REJECT',
      confidence: 0.55,
      formatValid: true,
    },
  ],
  initialCritique: { dimensionScores: { clarity: 5.2, engagement: 4.8, precision: 7.1, voice_fidelity: 6.3, conciseness: 6.8 } },
  finalCritique: { dimensionScores: { clarity: 7.4, engagement: 4.8, precision: 7.1, voice_fidelity: 6.3, conciseness: 6.8 } },
  stopReason: 'max_cycles',
  consecutiveRejections: 1,
  totalCost: 0.032,
};

export const reflectionDetailFixture: ReflectionExecutionDetail = {
  detailType: 'reflection',
  variantsCritiqued: [
    {
      variantId: 'ref-v-001',
      status: 'success',
      avgScore: 6.8,
      dimensionScores: { clarity: 7, engagement: 6, precision: 8, voice_fidelity: 6, conciseness: 7 },
      goodExamples: { clarity: ['Clear topic sentences in each paragraph'] },
      badExamples: { engagement: ['Opening lacks a compelling hook'] },
      notes: { clarity: 'Generally well-structured with minor issues' },
    },
    {
      variantId: 'ref-v-002',
      status: 'parse_failed',
      error: 'JSON parse error at position 245',
    },
  ],
  dimensions: ['clarity', 'engagement', 'precision', 'voice_fidelity', 'conciseness'],
  totalCost: 0.012,
};

export const debateDetailFixture: DebateExecutionDetail = {
  detailType: 'debate',
  variantA: { id: 'deb-a-001', ordinal: 32.5 },
  variantB: { id: 'deb-b-001', ordinal: 28.1 },
  transcript: [
    { role: 'advocate_a', content: 'Variant A excels in clarity and structure...' },
    { role: 'advocate_b', content: 'Variant B has superior engagement and voice...' },
    { role: 'judge', content: 'After careful consideration, Variant A wins on precision...' },
  ],
  judgeVerdict: {
    winner: 'A',
    reasoning: 'Variant A demonstrates stronger technical precision while maintaining readability.',
    strengthsFromA: ['Clear structure', 'Precise terminology'],
    strengthsFromB: ['Engaging opening', 'Natural voice'],
    improvements: ['Combine A structure with B engagement style'],
  },
  synthesisVariantId: 'deb-synth-001',
  synthesisTextLength: 2100,
  formatValid: true,
  totalCost: 0.028,
};

export const sectionDecompositionDetailFixture: SectionDecompositionExecutionDetail = {
  detailType: 'sectionDecomposition',
  targetVariantId: 'sd-target-001',
  weakness: { dimension: 'clarity', description: 'Section transitions are abrupt' },
  sections: [
    { index: 0, heading: null, eligible: false, improved: false, charCount: 45 },
    { index: 1, heading: 'Introduction', eligible: true, improved: true, charCount: 350 },
    { index: 2, heading: 'Methods', eligible: true, improved: false, charCount: 280 },
    { index: 3, heading: 'Results', eligible: true, improved: true, charCount: 420 },
  ],
  sectionsImproved: 2,
  totalEligible: 3,
  formatValid: true,
  newVariantId: 'sd-new-001',
  totalCost: 0.022,
};

export const evolutionDetailFixture: EvolutionExecutionDetail = {
  detailType: 'evolution',
  parents: [
    { id: 'evo-p-001', ordinal: 30.2 },
    { id: 'evo-p-002', ordinal: 27.8 },
  ],
  mutations: [
    { strategy: 'mutate_clarity', status: 'success', variantId: 'evo-m-001', textLength: 1800 },
    { strategy: 'mutate_structure', status: 'format_rejected', error: 'Multiple H1 titles' },
    { strategy: 'crossover', status: 'success', variantId: 'evo-m-002', textLength: 2100 },
  ],
  creativeExploration: true,
  creativeReason: 'low_diversity',
  overrepresentedStrategies: ['structural_transform'],
  feedbackUsed: true,
  totalCost: 0.025,
};

export const treeSearchDetailFixture: TreeSearchExecutionDetail = {
  detailType: 'treeSearch',
  rootVariantId: 'ts-root-001',
  config: { beamWidth: 3, branchingFactor: 3, maxDepth: 3 },
  result: {
    treeSize: 12,
    maxDepth: 3,
    prunedBranches: 4,
    revisionPath: [
      { type: 'refine', dimension: 'clarity', description: 'Simplify complex sentences' },
      { type: 'restructure', description: 'Reorganize paragraph order for logical flow' },
    ],
  },
  bestLeafVariantId: 'ts-leaf-001',
  addedToPool: true,
  totalCost: 0.065,
};

export const outlineGenerationDetailFixture: OutlineGenerationExecutionDetail = {
  detailType: 'outlineGeneration',
  steps: [
    { name: 'outline', score: 0.85, costUsd: 0.003, inputLength: 500, outputLength: 800 },
    { name: 'expand', score: 0.72, costUsd: 0.008, inputLength: 800, outputLength: 2200 },
    { name: 'polish', score: 0.88, costUsd: 0.006, inputLength: 2200, outputLength: 2100 },
    { name: 'verify', score: 1.0, costUsd: 0, inputLength: 2100, outputLength: 0 },
  ],
  weakestStep: 'expand',
  variantId: 'og-var-001',
  totalCost: 0.017,
};

export const proximityDetailFixture: ProximityExecutionDetail = {
  detailType: 'proximity',
  newEntrants: 3,
  existingVariants: 7,
  diversityScore: 0.68,
  totalPairsComputed: 21,
  totalCost: 0,
};

export const metaReviewDetailFixture: MetaReviewExecutionDetail = {
  detailType: 'metaReview',
  successfulStrategies: ['structural_transform', 'critique_edit_clarity'],
  recurringWeaknesses: ['lexical_simplify variants underperform'],
  patternsToAvoid: ['grounding_enhance with short source texts'],
  priorityImprovements: ['Increase pool diversity', 'Explore crossover strategies'],
  analysis: {
    strategyOrdinals: { structural_transform: 32.1, lexical_simplify: 22.4, grounding_enhance: 25.8 },
    bottomQuartileCount: 3,
    poolDiversity: 0.45,
    ordinalRange: 18.5,
    activeStrategies: 5,
    topVariantAge: 1,
  },
  totalCost: 0,
};

/** All 12 fixtures in an array for iteration in tests. */
export const allExecutionDetailFixtures = [
  generationDetailFixture,
  calibrationDetailFixture,
  tournamentDetailFixture,
  iterativeEditingDetailFixture,
  reflectionDetailFixture,
  debateDetailFixture,
  sectionDecompositionDetailFixture,
  evolutionDetailFixture,
  treeSearchDetailFixture,
  outlineGenerationDetailFixture,
  proximityDetailFixture,
  metaReviewDetailFixture,
] as const;
