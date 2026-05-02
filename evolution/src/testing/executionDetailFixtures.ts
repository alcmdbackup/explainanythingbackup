// Sample AgentExecutionDetail fixtures for all 10 agent types.
// Used across agent tests, server action tests, and component tests.

import type {
  GenerationExecutionDetail,
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

export const iterativeEditingDetailFixture: IterativeEditingExecutionDetail = {
  detailType: 'iterative_editing',
  parentVariantId: 'ie-parent-001',
  config: {
    maxCycles: 3,
    editingModel: 'gpt-4.1',
    approverModel: 'claude-sonnet-4-6',
    driftRecoveryModel: 'gpt-4.1-nano',
    perInvocationBudgetUsd: 0.05,
  },
  cycles: [
    {
      cycleNumber: 1,
      proposedMarkup:
        'The original article text. {++ [#1] An inserted clarifying sentence. ++} More original content. {~~ [#2] old phrase ~> new phrase ~~} closing.',
      proposedGroupsRaw: [
        {
          groupNumber: 1,
          atomicEdits: [{
            groupNumber: 1,
            kind: 'insert',
            range: { start: 28, end: 28 },
            markupRange: { start: 28, end: 73 },
            oldText: '',
            newText: 'An inserted clarifying sentence.',
            contextBefore: 'The original article text. ',
            contextAfter: ' More original content.',
          }],
        },
        {
          groupNumber: 2,
          atomicEdits: [{
            groupNumber: 2,
            kind: 'replace',
            range: { start: 60, end: 70 },
            markupRange: { start: 100, end: 130 },
            oldText: 'old phrase',
            newText: 'new phrase',
            contextBefore: 'More original content. ',
            contextAfter: ' closing.',
          }],
        },
      ],
      droppedPreApprover: [],
      approverGroups: [
        { groupNumber: 1, atomicEdits: [{
          groupNumber: 1, kind: 'insert',
          range: { start: 28, end: 28 }, markupRange: { start: 28, end: 73 },
          oldText: '', newText: 'An inserted clarifying sentence.',
          contextBefore: 'The original article text. ', contextAfter: ' More original content.',
        }] },
        { groupNumber: 2, atomicEdits: [{
          groupNumber: 2, kind: 'replace',
          range: { start: 60, end: 70 }, markupRange: { start: 100, end: 130 },
          oldText: 'old phrase', newText: 'new phrase',
          contextBefore: 'More original content. ', contextAfter: ' closing.',
        }] },
      ],
      reviewDecisions: [
        { groupNumber: 1, decision: 'accept', reason: 'improves clarity without altering meaning' },
        { groupNumber: 2, decision: 'reject', reason: 'no measurable improvement; rejecting for stability' },
      ],
      droppedPostApprover: [],
      appliedGroups: [
        { groupNumber: 1, atomicEdits: [{
          groupNumber: 1, kind: 'insert',
          range: { start: 28, end: 28 }, markupRange: { start: 28, end: 73 },
          oldText: '', newText: 'An inserted clarifying sentence.',
          contextBefore: 'The original article text. ', contextAfter: ' More original content.',
        }] },
      ],
      acceptedCount: 1,
      rejectedCount: 1,
      appliedCount: 1,
      formatValid: true,
      newVariantId: 'ie-cycle1-childtext',
      parentText: 'The original article text. More original content. old phrase closing.',
      childText:
        'The original article text. An inserted clarifying sentence. More original content. old phrase closing.',
      proposeCostUsd: 0.012,
      approveCostUsd: 0.0008,
      sizeRatio: 1.45,
    },
    {
      cycleNumber: 2,
      proposedMarkup:
        'The original article text. An inserted clarifying sentence. More original content. {-- [#1] old phrase --} closing.',
      proposedGroupsRaw: [{ groupNumber: 1, atomicEdits: [{
        groupNumber: 1, kind: 'delete',
        range: { start: 90, end: 100 }, markupRange: { start: 90, end: 115 },
        oldText: 'old phrase', newText: '',
        contextBefore: 'More original content. ', contextAfter: ' closing.',
      }] }],
      droppedPreApprover: [],
      approverGroups: [{ groupNumber: 1, atomicEdits: [{
        groupNumber: 1, kind: 'delete',
        range: { start: 90, end: 100 }, markupRange: { start: 90, end: 115 },
        oldText: 'old phrase', newText: '',
        contextBefore: 'More original content. ', contextAfter: ' closing.',
      }] }],
      reviewDecisions: [{ groupNumber: 1, decision: 'reject', reason: 'deletion would remove meaningful content' }],
      droppedPostApprover: [],
      appliedGroups: [],
      acceptedCount: 0,
      rejectedCount: 1,
      appliedCount: 0,
      formatValid: true,
      parentText:
        'The original article text. An inserted clarifying sentence. More original content. old phrase closing.',
      proposeCostUsd: 0.013,
      approveCostUsd: 0.0008,
      sizeRatio: 1.0,
    },
  ],
  stopReason: 'all_edits_rejected',
  finalVariantId: 'ie-final-001',
  totalCost: 0.0266,
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
  variantA: { id: 'deb-a-001', mu: 32.5 },
  variantB: { id: 'deb-b-001', mu: 28.1 },
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
    { id: 'evo-p-001', mu: 30.2 },
    { id: 'evo-p-002', mu: 27.8 },
  ],
  mutations: [
    { tactic: 'mutate_clarity', status: 'success', variantId: 'evo-m-001', textLength: 1800 },
    { tactic: 'mutate_structure', status: 'format_rejected', error: 'Multiple H1 titles' },
    { tactic: 'crossover', status: 'success', variantId: 'evo-m-002', textLength: 2100 },
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
    strategyMus: { structural_transform: 32.1, lexical_simplify: 22.4, grounding_enhance: 25.8 },
    bottomQuartileCount: 3,
    poolDiversity: 0.45,
    muRange: 18.5,
    activeStrategies: 5,
    topVariantAge: 1,
  },
  totalCost: 0,
};

/** All 10 fixtures in an array for iteration in tests. */
export const allExecutionDetailFixtures = [
  generationDetailFixture,
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
