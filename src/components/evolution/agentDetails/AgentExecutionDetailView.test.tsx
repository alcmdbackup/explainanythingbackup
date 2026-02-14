// Tests for AgentExecutionDetailView router and individual detail components.

import { render, screen } from '@testing-library/react';
import { AgentExecutionDetailView } from './AgentExecutionDetailView';
import type { AgentExecutionDetail } from '@/lib/evolution/types';

describe('AgentExecutionDetailView', () => {
  it('routes generation detail type correctly', () => {
    const detail: AgentExecutionDetail = {
      detailType: 'generation',
      totalCost: 0.05,
      strategies: [
        { name: 'narrative', status: 'success', variantId: 'v-abc', textLength: 1200, promptLength: 500 },
        { name: 'analytical', status: 'format_rejected', formatIssues: ['too short'], promptLength: 480 },
      ],
      feedbackUsed: true,
    };

    render(<AgentExecutionDetailView detail={detail} />);
    expect(screen.getByTestId('generation-detail')).toBeInTheDocument();
    expect(screen.getByText('narrative')).toBeInTheDocument();
    expect(screen.getByText('1200 chars')).toBeInTheDocument();
    expect(screen.getByText('1 format issue')).toBeInTheDocument();
  });

  it('routes calibration detail type correctly', () => {
    const detail: AgentExecutionDetail = {
      detailType: 'calibration',
      totalCost: 0.03,
      entrants: [
        {
          variantId: 'v-001',
          opponents: ['v-002'],
          matches: [{ opponentId: 'v-002', winner: 'v-001', confidence: 0.85, cacheHit: false }],
          earlyExit: false,
          ratingBefore: { mu: 25, sigma: 8.3 },
          ratingAfter: { mu: 28, sigma: 7.1 },
        },
      ],
      avgConfidence: 0.85,
      totalMatches: 1,
    };

    render(<AgentExecutionDetailView detail={detail} />);
    expect(screen.getByTestId('calibration-detail')).toBeInTheDocument();
    expect(screen.getByText(/μ.*25\.0.*→.*28\.0/)).toBeInTheDocument();
  });

  it('routes tournament detail type correctly', () => {
    const detail: AgentExecutionDetail = {
      detailType: 'tournament',
      totalCost: 0.1,
      budgetPressure: 0.45,
      budgetTier: 'medium',
      rounds: [
        {
          roundNumber: 1,
          pairs: [{ variantA: 'v-a', variantB: 'v-b' }],
          matches: [],
          multiTurnUsed: 0,
        },
      ],
      exitReason: 'convergence',
      convergenceStreak: 3,
      staleRounds: 0,
      totalComparisons: 5,
      flowEnabled: true,
    };

    render(<AgentExecutionDetailView detail={detail} />);
    expect(screen.getByTestId('tournament-detail')).toBeInTheDocument();
    expect(screen.getByText('convergence')).toBeInTheDocument();
  });

  it('routes iterativeEditing detail type correctly', () => {
    const detail: AgentExecutionDetail = {
      detailType: 'iterativeEditing',
      totalCost: 0.04,
      targetVariantId: 'v-target',
      config: { maxCycles: 5, maxConsecutiveRejections: 3, qualityThreshold: 0.8 },
      cycles: [
        {
          cycleNumber: 1,
          target: { dimension: 'clarity', description: 'Improve clarity', score: 0.6, source: 'critique' },
          verdict: 'ACCEPT',
          confidence: 0.9,
          formatValid: true,
          newVariantId: 'v-new',
        },
      ],
      initialCritique: { dimensionScores: { clarity: 0.6, depth: 0.8 } },
      stopReason: 'threshold_met',
      consecutiveRejections: 0,
    };

    render(<AgentExecutionDetailView detail={detail} />);
    expect(screen.getByTestId('iterative-editing-detail')).toBeInTheDocument();
    expect(screen.getByText('threshold_met')).toBeInTheDocument();
  });

  it('routes reflection detail type correctly', () => {
    const detail: AgentExecutionDetail = {
      detailType: 'reflection',
      totalCost: 0.02,
      variantsCritiqued: [
        {
          variantId: 'v-ref',
          status: 'success',
          avgScore: 0.75,
          dimensionScores: { clarity: 0.8, depth: 0.7 },
        },
      ],
      dimensions: ['clarity', 'depth'],
    };

    render(<AgentExecutionDetailView detail={detail} />);
    expect(screen.getByTestId('reflection-detail')).toBeInTheDocument();
    expect(screen.getByText('0.75 avg')).toBeInTheDocument();
  });

  it('routes debate detail type correctly', () => {
    const detail: AgentExecutionDetail = {
      detailType: 'debate',
      totalCost: 0.06,
      variantA: { id: 'v-a', ordinal: 1 },
      variantB: { id: 'v-b', ordinal: 2 },
      transcript: [
        { role: 'advocate_a' as const, content: 'Variant A is stronger because...' },
        { role: 'advocate_b' as const, content: 'Variant B has better...' },
      ],
      judgeVerdict: {
        winner: 'A',
        reasoning: 'A was more compelling',
        strengthsFromA: ['Good structure'],
        strengthsFromB: ['Better examples'],
        improvements: ['Combine both'],
      },
      synthesisVariantId: 'v-synth',
      synthesisTextLength: 2000,
      formatValid: true,
    };

    render(<AgentExecutionDetailView detail={detail} />);
    expect(screen.getByTestId('debate-detail')).toBeInTheDocument();
    expect(screen.getByText('A was more compelling')).toBeInTheDocument();
  });

  it('routes sectionDecomposition detail type correctly', () => {
    const detail: AgentExecutionDetail = {
      detailType: 'sectionDecomposition',
      totalCost: 0.03,
      targetVariantId: 'v-tgt',
      weakness: { dimension: 'depth', description: 'Lacks detail' },
      sections: [
        { index: 0, heading: 'Introduction', eligible: true, improved: true, charCount: 500 },
        { index: 1, heading: 'Body', eligible: true, improved: false, charCount: 1200 },
      ],
      sectionsImproved: 1,
      totalEligible: 2,
      formatValid: true,
      newVariantId: 'v-new',
    };

    render(<AgentExecutionDetailView detail={detail} />);
    expect(screen.getByTestId('section-decomposition-detail')).toBeInTheDocument();
    expect(screen.getByText('Introduction')).toBeInTheDocument();
  });

  it('routes evolution detail type correctly', () => {
    const detail: AgentExecutionDetail = {
      detailType: 'evolution',
      totalCost: 0.04,
      parents: [{ id: 'v-p1', ordinal: 1 }],
      mutations: [
        { strategy: 'crossover', status: 'success', variantId: 'v-m1', textLength: 900 },
        { strategy: 'mutate', status: 'format_rejected' },
      ],
      creativeExploration: false,
      feedbackUsed: true,
    };

    render(<AgentExecutionDetailView detail={detail} />);
    expect(screen.getByTestId('evolution-detail')).toBeInTheDocument();
    expect(screen.getByText('crossover')).toBeInTheDocument();
  });

  it('routes treeSearch detail type correctly', () => {
    const detail: AgentExecutionDetail = {
      detailType: 'treeSearch',
      totalCost: 0.08,
      rootVariantId: 'v-root',
      config: { beamWidth: 3, branchingFactor: 2, maxDepth: 4 },
      result: {
        treeSize: 12,
        maxDepth: 3,
        prunedBranches: 2,
        revisionPath: [
          { type: 'improve', dimension: 'clarity', description: 'Simplify language' },
        ],
      },
      bestLeafVariantId: 'v-leaf',
      addedToPool: true,
    };

    render(<AgentExecutionDetailView detail={detail} />);
    expect(screen.getByTestId('tree-search-detail')).toBeInTheDocument();
    expect(screen.getByText('beam=3')).toBeInTheDocument();
  });

  it('routes outlineGeneration detail type correctly', () => {
    const detail: AgentExecutionDetail = {
      detailType: 'outlineGeneration',
      totalCost: 0.05,
      steps: [
        { name: 'outline', score: 0.9, costUsd: 0.01, inputLength: 100, outputLength: 500 },
        { name: 'expand', score: 0.7, costUsd: 0.02, inputLength: 500, outputLength: 2000 },
      ],
      weakestStep: 'expand',
      variantId: 'v-out',
    };

    render(<AgentExecutionDetailView detail={detail} />);
    expect(screen.getByTestId('outline-generation-detail')).toBeInTheDocument();
    expect(screen.getByText('outline')).toBeInTheDocument();
  });

  it('routes proximity detail type correctly', () => {
    const detail: AgentExecutionDetail = {
      detailType: 'proximity',
      totalCost: 0.002,
      newEntrants: 3,
      existingVariants: 5,
      diversityScore: 0.823,
      totalPairsComputed: 15,
    };

    render(<AgentExecutionDetailView detail={detail} />);
    expect(screen.getByTestId('proximity-detail')).toBeInTheDocument();
    expect(screen.getByText('0.823')).toBeInTheDocument();
  });

  it('routes metaReview detail type correctly', () => {
    const detail: AgentExecutionDetail = {
      detailType: 'metaReview',
      totalCost: 0.01,
      successfulStrategies: ['narrative'],
      recurringWeaknesses: ['lacks depth'],
      patternsToAvoid: [],
      priorityImprovements: ['add examples'],
      analysis: {
        strategyOrdinals: { narrative: 1, analytical: 2 },
        bottomQuartileCount: 2,
        poolDiversity: 0.65,
        ordinalRange: 15,
        activeStrategies: 4,
        topVariantAge: 3,
      },
    };

    render(<AgentExecutionDetailView detail={detail} />);
    expect(screen.getByTestId('meta-review-detail')).toBeInTheDocument();
    expect(screen.getByText('narrative')).toBeInTheDocument();
  });
});
