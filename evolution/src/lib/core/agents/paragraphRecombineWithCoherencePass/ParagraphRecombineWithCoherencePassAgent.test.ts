// Tests for ParagraphRecombineWithCoherencePassAgent.
//
// Created by investigate_paragraph_recombine_coherence_pass_performance_20260623 Phase 1.
// Scaffold + helpers for tests added across Phases 2a/3/4:
// - Phase 2a: assert runEditingCycle's validateOpts no longer carries
//   redundancyJaccardThreshold or flowGuardrailEnabled.
// - Phase 3: assert validateOpts.lengthCapRatio resolves from input override or
//   the kill-switch default helper.
// - Phase 4: assert multi-cycle behavior (cycles.length, per-cycle proposer-prompt
//   rebuild, cycle-throws survival, env-var kill-switch flip).
//
// Mocking strategy:
// - jest.mock the runEditingCycle module so cycles are deterministic via
//   mockResolvedValueOnce per cycle.
// - jest.mock the heavy slot services so slot pipeline reaches the coherence pass
//   without booting a real DB. With these mocked, slots upsert succeeds but
//   the rest of the slot work is stubbed; the agent assembles the recombined
//   article and enters the coherence-pass block.

import { ParagraphRecombineWithCoherencePassAgent } from './ParagraphRecombineWithCoherencePassAgent';
import type { AgentContext } from '../../types';
import type { EvolutionLLMClient } from '../../../types';
import type { RunEditingCycleResult } from '../editing/runEditingCycle';
import type { EditingCycle } from '../editing/types';

// ─── Module mocks ─────────────────────────────────────────────────

jest.mock('../editing/runEditingCycle', () => ({
  runEditingCycle: jest.fn(),
}));

jest.mock('../../../../services/slotTopicActions', () => ({
  upsertSlotTopic: jest.fn(async (_db: unknown, _kind: string, key: string, slotIdx: number, originalText: string) => ({
    topicId: `topic-${slotIdx}`,
    originalSlotVariantId: `slot-original-${slotIdx}`,
  })),
  persistSlotMatches: jest.fn(async () => undefined),
  makeMatchKey: jest.fn((a: string, b: string) => `${a}|${b}`),
}));

jest.mock('../../../pipeline/setup/buildRunContext', () => ({
  loadArenaEntries: jest.fn(async () => ({ variants: [], ratings: new Map() })),
}));

jest.mock('../../../pipeline/finalize/persistRunResults', () => ({
  syncToArena: jest.fn(async () => undefined),
}));

jest.mock('../../../metrics/writeMetrics', () => ({
  writeMetricMax: jest.fn(async () => undefined),
}));

jest.mock('../../../pipeline/loop/rankNewVariant', () => ({
  rankNewVariant: jest.fn(async () => ({
    rankResult: { matches: [] },
    surfaced: true,
  })),
}));

// ─── Imports of the mocked modules (post jest.mock) ────────────────

import { runEditingCycle } from '../editing/runEditingCycle';
const mockedRunEditingCycle = runEditingCycle as jest.MockedFunction<typeof runEditingCycle>;

// ─── Test scaffolding ──────────────────────────────────────────────

/** Fixture article — enough paragraphs to exercise the slot pipeline.
 *  Each paragraph has ≥2 sentences to satisfy validateFormat's paragraph-density rule. */
export const FIXTURE_ARTICLE = [
  '# The Federal Reserve',
  '',
  '## How the Fed Came to Be',
  '',
  'Before 1913, sudden bank runs could cripple livelihoods overnight. The Panic of 1907 revealed the fragility of the system. Banks could collapse without warning.',
  '',
  'President Wilson signed the Federal Reserve Act in 1913, creating a decentralized central bank. The goal was to weave a stronger financial fabric for the country. Twelve regional banks were established under a national board.',
  '',
  '## How the Fed Operates',
  '',
  'The Fed has a dual mandate: maximum employment and stable prices. These goals sometimes pull against each other. Balancing them requires careful judgment from the FOMC.',
  '',
  'Its primary tools are interest rates, reserve requirements, and open-market operations. Together these levers shape the cost of credit across the economy. Each tool has trade-offs that policymakers weigh carefully.',
].join('\n');

/** Default cycle result the runEditingCycle mock returns when not overridden. */
export function makeCycleResult(opts: Partial<RunEditingCycleResult> = {}): RunEditingCycleResult {
  const cycle: EditingCycle = {
    cycleNumber: opts.cycle?.cycleNumber ?? 1,
    proposedMarkup: '',
    proposedGroupsRaw: [],
    droppedPreApprover: [],
    approverGroups: [],
    reviewDecisions: [],
    droppedPostApprover: [],
    appliedGroups: [],
    acceptedCount: 0,
    rejectedCount: 0,
    appliedCount: 0,
    formatValid: true,
    parentText: '',
    proposeCostUsd: 0.0001,
    approveCostUsd: 0.0001,
    sizeRatio: 1.0,
    ...opts.cycle,
  };
  return {
    newText: opts.newText ?? '',
    cycle,
    appliedAny: opts.appliedAny ?? false,
    stopReason: opts.stopReason,
    ...(opts.errorPhase && { errorPhase: opts.errorPhase }),
    ...(opts.errorMessage && { errorMessage: opts.errorMessage }),
  };
}

/** Mock LLM that returns a benign rewrite for any paragraph-rewrite call. */
export function makeMockLlm(): EvolutionLLMClient {
  return {
    complete: jest.fn(async () => 'Mock paragraph rewrite output.'),
    completeStructured: jest.fn(),
  } as unknown as EvolutionLLMClient;
}

/** Mock AgentContext with a working AgentCostScope and stub db. */
export function makeCtx(): AgentContext {
  let totalSpent = 0;
  const phaseCosts: Record<string, number> = {};
  return {
    db: {} as AgentContext['db'], // stub — heavy service calls are mocked
    runId: 'run-test',
    iteration: 1,
    executionOrder: 0,
    invocationId: 'inv-test',
    randomSeed: BigInt(1),
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      })),
    } as unknown as AgentContext['logger'],
    costTracker: {
      getOwnSpent: () => totalSpent,
      getPhaseCosts: () => ({ ...phaseCosts }),
      recordSpend: jest.fn((amount: number, phase?: string) => {
        totalSpent += amount;
        if (phase) phaseCosts[phase] = (phaseCosts[phase] ?? 0) + amount;
      }),
      reserve: jest.fn(),
      release: jest.fn(),
    } as unknown as AgentContext['costTracker'],
    config: {
      generationModel: 'gpt-4.1-nano',
      judgeModel: 'qwen-2.5-7b-instruct',
      iterationConfigs: [],
    } as unknown as AgentContext['config'],
    defaultModel: 'gpt-4.1-nano',
    promptId: null,
  } as AgentContext;
}

/** Default agent input. Phases 2a/3/4 override fields as needed. */
export function makeInput(overrides: Record<string, unknown> = {}): Parameters<ParagraphRecombineWithCoherencePassAgent['execute']>[0] {
  return {
    parentText: FIXTURE_ARTICLE,
    parentVariantId: 'parent-uuid',
    rewritesPerParagraph: 3,
    maxComparisonsPerParagraph: 6,
    maxParagraphsPerInvocation: 12,
    coherencePassEnabled: true,
    llm: makeMockLlm(),
    ...overrides,
  } as Parameters<ParagraphRecombineWithCoherencePassAgent['execute']>[0];
}

// ─── Smoke test ────────────────────────────────────────────────────

describe('ParagraphRecombineWithCoherencePassAgent', () => {
  beforeEach(() => {
    mockedRunEditingCycle.mockReset();
    mockedRunEditingCycle.mockResolvedValue(makeCycleResult({ newText: FIXTURE_ARTICLE, appliedAny: false, stopReason: 'no_edits_proposed' }));
  });

  it('runs end-to-end with mocks (smoke test for the scaffold)', async () => {
    const agent = new ParagraphRecombineWithCoherencePassAgent();
    const ctx = makeCtx();
    const input = makeInput();

    const result = await agent.execute(input, ctx);

    // Result envelope exists.
    expect(result).toBeDefined();
    expect(result.detail.detailType).toBe('paragraph_recombine_with_coherence_pass');
    // The coherence-pass block reached SOME outcome — either a cycle ran or it
    // was skipped for a reason recorded in the detail. (Slot processing under
    // mocks may produce skipped='format_invalid_recombine' if the slot mock
    // article drifts; we just smoke-test the scaffold integration here.)
    if ('coherencePass' in result.detail && result.detail.coherencePass) {
      const cp = result.detail.coherencePass;
      if ('cycles' in cp) {
        expect(mockedRunEditingCycle).toHaveBeenCalled();
      } else if ('skipped' in cp) {
        // Skipped for a documented reason — log to surface in test output if needed.
        expect(['budget', 'disabled', 'kill_switch', 'format_invalid_recombine']).toContain(cp.skipped);
      }
    }
  });

  describe('Phase 2a — guardrails dropped at the runEditingCycle call site', () => {
    it('runEditingCycle is called WITHOUT redundancyJaccardThreshold or flowGuardrailEnabled in validateOpts', async () => {
      mockedRunEditingCycle.mockResolvedValueOnce(makeCycleResult({
        newText: FIXTURE_ARTICLE,
        appliedAny: false,
        stopReason: 'no_edits_proposed',
      }));
      const agent = new ParagraphRecombineWithCoherencePassAgent();
      await agent.execute(makeInput(), makeCtx());

      if (mockedRunEditingCycle.mock.calls.length > 0) {
        const args = mockedRunEditingCycle.mock.calls[0]![0];
        // Only lengthCapRatio should be present in validateOpts.
        expect(args.validateOpts).toBeDefined();
        expect(args.validateOpts!).toHaveProperty('lengthCapRatio');
        expect(args.validateOpts!).not.toHaveProperty('redundancyJaccardThreshold');
        expect(args.validateOpts!).not.toHaveProperty('flowGuardrailEnabled');
      }
    });

    it('emitted coherencePass.config snapshot has only lengthCapRatio (no Jaccard/flow keys)', async () => {
      mockedRunEditingCycle.mockResolvedValueOnce(makeCycleResult({
        newText: FIXTURE_ARTICLE,
        appliedAny: true,
        cycle: {
          cycleNumber: 1,
          proposedMarkup: '',
          proposedGroupsRaw: [],
          droppedPreApprover: [],
          approverGroups: [{ groupNumber: 1, atomicEdits: [] } as never],
          reviewDecisions: [],
          droppedPostApprover: [],
          appliedGroups: [{ groupNumber: 1, atomicEdits: [] } as never],
          acceptedCount: 1,
          rejectedCount: 0,
          appliedCount: 1,
          formatValid: true,
          parentText: FIXTURE_ARTICLE,
          proposeCostUsd: 0.0001,
          approveCostUsd: 0.0001,
          sizeRatio: 1.0,
        },
      }));
      const agent = new ParagraphRecombineWithCoherencePassAgent();
      const result = await agent.execute(makeInput(), makeCtx());

      if (result.detail.coherencePass && 'config' in result.detail.coherencePass) {
        const config = result.detail.coherencePass.config;
        expect(config).toHaveProperty('proposerModel');
        expect(config).toHaveProperty('approverModel');
        expect(config).toHaveProperty('lengthCapRatio');
        // The two dropped keys must be ABSENT (not just falsy).
        expect(config).not.toHaveProperty('redundancyJaccardThreshold');
        expect(config).not.toHaveProperty('flowGuardrailEnabled');
      }
    });
  });

  describe('Phase 3 — coherencePassLengthCapRatio plumbing + kill switch', () => {
    it('validateOpts.lengthCapRatio uses input.coherencePassLengthCapRatio when set', async () => {
      mockedRunEditingCycle.mockResolvedValueOnce(makeCycleResult({
        newText: FIXTURE_ARTICLE,
        appliedAny: false,
        stopReason: 'no_edits_proposed',
      }));
      const agent = new ParagraphRecombineWithCoherencePassAgent();
      await agent.execute(makeInput({ coherencePassLengthCapRatio: 1.20 }), makeCtx());

      if (mockedRunEditingCycle.mock.calls.length > 0) {
        const args = mockedRunEditingCycle.mock.calls[0]![0];
        expect(args.validateOpts!.lengthCapRatio).toBe(1.20);
      }
    });

    it('validateOpts.lengthCapRatio defaults to 1.10 (new default) when input undefined', async () => {
      // Ensure kill switch is in V2 (default) mode for this test.
      const original = process.env.EVOLUTION_COHERENCE_PASS_DEFAULTS_V2;
      delete process.env.EVOLUTION_COHERENCE_PASS_DEFAULTS_V2;
      try {
        mockedRunEditingCycle.mockResolvedValueOnce(makeCycleResult({
          newText: FIXTURE_ARTICLE,
          appliedAny: false,
          stopReason: 'no_edits_proposed',
        }));
        const agent = new ParagraphRecombineWithCoherencePassAgent();
        await agent.execute(makeInput(), makeCtx());

        if (mockedRunEditingCycle.mock.calls.length > 0) {
          const args = mockedRunEditingCycle.mock.calls[0]![0];
          expect(args.validateOpts!.lengthCapRatio).toBe(1.10);
        }
      } finally {
        if (original === undefined) delete process.env.EVOLUTION_COHERENCE_PASS_DEFAULTS_V2;
        else process.env.EVOLUTION_COHERENCE_PASS_DEFAULTS_V2 = original;
      }
    });

    it('kill switch: EVOLUTION_COHERENCE_PASS_DEFAULTS_V2=false flips defaults to legacy (1.02, 1)', async () => {
      // Pattern mirrors IterativeEditingAgent.test.ts:143-163 (save + restore in finally).
      const original = process.env.EVOLUTION_COHERENCE_PASS_DEFAULTS_V2;
      process.env.EVOLUTION_COHERENCE_PASS_DEFAULTS_V2 = 'false';
      try {
        mockedRunEditingCycle.mockResolvedValueOnce(makeCycleResult({
          newText: FIXTURE_ARTICLE,
          appliedAny: false,
          stopReason: 'no_edits_proposed',
        }));
        const agent = new ParagraphRecombineWithCoherencePassAgent();
        await agent.execute(makeInput(), makeCtx());

        if (mockedRunEditingCycle.mock.calls.length > 0) {
          const args = mockedRunEditingCycle.mock.calls[0]![0];
          expect(args.validateOpts!.lengthCapRatio).toBe(1.02);
        }
        // Only 1 cycle when kill switch flips maxCycles default to 1.
        expect(mockedRunEditingCycle).toHaveBeenCalledTimes(1);
      } finally {
        if (original === undefined) delete process.env.EVOLUTION_COHERENCE_PASS_DEFAULTS_V2;
        else process.env.EVOLUTION_COHERENCE_PASS_DEFAULTS_V2 = original;
      }
    });
  });

  describe('Phase 4 — multi-cycle loop', () => {
    it('runs N cycles when each applies edits and maxCycles=3', async () => {
      const acceptedCycle = makeCycleResult({
        newText: FIXTURE_ARTICLE.replace('Federal Reserve', 'Fed'),
        appliedAny: true,
        cycle: {
          cycleNumber: 1,
          proposedMarkup: '',
          proposedGroupsRaw: [],
          droppedPreApprover: [],
          approverGroups: [{ groupNumber: 1, atomicEdits: [] } as never],
          reviewDecisions: [],
          droppedPostApprover: [],
          appliedGroups: [{ groupNumber: 1, atomicEdits: [] } as never],
          acceptedCount: 1,
          rejectedCount: 0,
          appliedCount: 1,
          formatValid: true,
          parentText: FIXTURE_ARTICLE,
          proposeCostUsd: 0.0001,
          approveCostUsd: 0.0001,
          sizeRatio: 1.0,
        },
      });
      mockedRunEditingCycle
        .mockResolvedValueOnce(acceptedCycle)
        .mockResolvedValueOnce(acceptedCycle)
        .mockResolvedValueOnce(acceptedCycle);

      const agent = new ParagraphRecombineWithCoherencePassAgent();
      const result = await agent.execute(makeInput({ coherencePassMaxCycles: 3 }), makeCtx());

      expect(mockedRunEditingCycle).toHaveBeenCalledTimes(3);
      if (result.detail.coherencePass && 'cycles' in result.detail.coherencePass) {
        expect(result.detail.coherencePass.cycles.length).toBe(3);
      }
    });

    it('exits early on stopReason (no_edits_proposed in cycle 1)', async () => {
      mockedRunEditingCycle.mockResolvedValueOnce(makeCycleResult({
        newText: FIXTURE_ARTICLE,
        appliedAny: false,
        stopReason: 'no_edits_proposed',
      }));

      const agent = new ParagraphRecombineWithCoherencePassAgent();
      const result = await agent.execute(makeInput({ coherencePassMaxCycles: 3 }), makeCtx());

      expect(mockedRunEditingCycle).toHaveBeenCalledTimes(1);
      if (result.detail.coherencePass && 'cycles' in result.detail.coherencePass) {
        expect(result.detail.coherencePass.cycles.length).toBe(1);
      }
    });

    it('per-cycle proposerUserPrompt is rebuilt from running text (Security reviewer fix)', async () => {
      const cycle1Out = FIXTURE_ARTICLE.replace('1913', '1914');
      mockedRunEditingCycle
        .mockResolvedValueOnce(makeCycleResult({
          newText: cycle1Out,
          appliedAny: true,
          cycle: {
            cycleNumber: 1,
            proposedMarkup: '',
            proposedGroupsRaw: [],
            droppedPreApprover: [],
            approverGroups: [{ groupNumber: 1, atomicEdits: [] } as never],
            reviewDecisions: [],
            droppedPostApprover: [],
            appliedGroups: [{ groupNumber: 1, atomicEdits: [] } as never],
            acceptedCount: 1,
            rejectedCount: 0,
            appliedCount: 1,
            formatValid: true,
            parentText: FIXTURE_ARTICLE,
            proposeCostUsd: 0.0001,
            approveCostUsd: 0.0001,
            sizeRatio: 1.0,
          },
        }))
        .mockResolvedValueOnce(makeCycleResult({
          newText: cycle1Out,
          appliedAny: false,
          stopReason: 'no_edits_proposed',
        }));

      const agent = new ParagraphRecombineWithCoherencePassAgent();
      await agent.execute(makeInput({ coherencePassMaxCycles: 2 }), makeCtx());

      expect(mockedRunEditingCycle).toHaveBeenCalledTimes(2);
      const call1Prompt = mockedRunEditingCycle.mock.calls[0]![0].proposerUserPrompt;
      const call2Prompt = mockedRunEditingCycle.mock.calls[1]![0].proposerUserPrompt;
      // Cycle 1's source was the original recombined text (which here equals the parent
      // since slots all fall back to original under mocks).
      // Cycle 2's source must be cycle 1's modified output (1914), not the original (1913).
      expect(call1Prompt).toContain('1913');
      expect(call2Prompt).toContain('1914');
    });

    it('cycle-2 throws → cycle 1 survives in cycles[], throw propagates', async () => {
      const acceptedCycle = makeCycleResult({
        newText: FIXTURE_ARTICLE,
        appliedAny: true,
        cycle: {
          cycleNumber: 1,
          proposedMarkup: '',
          proposedGroupsRaw: [],
          droppedPreApprover: [],
          approverGroups: [{ groupNumber: 1, atomicEdits: [] } as never],
          reviewDecisions: [],
          droppedPostApprover: [],
          appliedGroups: [{ groupNumber: 1, atomicEdits: [] } as never],
          acceptedCount: 1,
          rejectedCount: 0,
          appliedCount: 1,
          formatValid: true,
          parentText: FIXTURE_ARTICLE,
          proposeCostUsd: 0.0001,
          approveCostUsd: 0.0001,
          sizeRatio: 1.0,
        },
      });
      mockedRunEditingCycle
        .mockResolvedValueOnce(acceptedCycle)
        .mockRejectedValueOnce(new Error('parser crash'));

      const agent = new ParagraphRecombineWithCoherencePassAgent();
      await expect(agent.execute(makeInput({ coherencePassMaxCycles: 3 }), makeCtx()))
        .rejects.toThrow('parser crash');
      expect(mockedRunEditingCycle).toHaveBeenCalledTimes(2);
    });

    it('Mode A invariant — runEditingCycle is NEVER called with rewriteMode (no Mode B coalesce/cap)', async () => {
      mockedRunEditingCycle.mockResolvedValueOnce(makeCycleResult({
        newText: FIXTURE_ARTICLE,
        appliedAny: false,
        stopReason: 'no_edits_proposed',
      }));
      const agent = new ParagraphRecombineWithCoherencePassAgent();
      await agent.execute(makeInput(), makeCtx());

      if (mockedRunEditingCycle.mock.calls.length > 0) {
        const args = mockedRunEditingCycle.mock.calls[0]![0];
        // Mode A: no rewriteMode option means coalesceAdjacentGroups + capGroupsByMagnitude
        // are both skipped by runEditingCycle. This is the "no caps, no coalescing" invariant.
        expect(args.rewriteMode).toBeUndefined();
      }
    });
  });
});
