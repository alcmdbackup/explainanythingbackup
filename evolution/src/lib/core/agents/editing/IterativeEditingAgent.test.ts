// Phase 2.F.1: orchestration-level test for IterativeEditingAgent. Mocks the
// LLM client so we can verify the cycle loop's accept/reject/drift/exit paths
// without booting a real provider. Sample-article tests (Phase 2.F.2) live in
// integration tests against real fixture content.

import { IterativeEditingAgent } from './IterativeEditingAgent';
import type { AgentContext } from '../../types';
import type { Variant, EvolutionLLMClient } from '../../../types';

interface QueuedResponse { label: string; response: string }

function makeMockLlm(queue: QueuedResponse[]): EvolutionLLMClient {
  const completeFn = jest.fn(async (_prompt: string, label: string): Promise<string> => {
    const next = queue.shift();
    if (!next) throw new Error(`mockLlm: queue exhausted at label=${label}`);
    if (next.label !== label) throw new Error(`mockLlm: expected label=${next.label}, got=${label}`);
    return next.response;
  });
  return {
    complete: completeFn,
    completeStructured: jest.fn(),
  } as unknown as EvolutionLLMClient;
}

function makeCtx(opts: { llm: EvolutionLLMClient; iteration?: number }): AgentContext {
  let totalSpent = 0;
  return {
    db: null as unknown as AgentContext['db'],
    runId: 'run-test',
    iteration: opts.iteration ?? 1,
    executionOrder: 0,
    invocationId: 'inv-test',
    randomSeed: BigInt(1),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as unknown as AgentContext['logger'],
    costTracker: {
      getOwnSpent: () => { totalSpent += 0.001; return totalSpent; },
      recordSpend: jest.fn(),
      reserve: jest.fn(),
      release: jest.fn(),
    } as unknown as AgentContext['costTracker'],
    config: {
      generationModel: 'gpt-4.1',
      judgeModel: 'gpt-4.1',
      iterationConfigs: [{ agentType: 'iterative_editing', editingMaxCycles: 2 }],
    } as unknown as AgentContext['config'],
    promptId: null,
  };
}

function variant(id: string, text: string): Variant {
  return { id, text, parentIds: [] } as unknown as Variant;
}

describe('IterativeEditingAgent', () => {
  it('emits a final variant when at least one cycle accepts edits', async () => {
    const source = 'Hello world.';
    const proposedMarkup = 'Hello {~~ [#1] world ~> Earth ~~}.';
    const approverResponse = JSON.stringify({ groupNumber: 1, decision: 'accept', reason: 'better' });
    const llm = makeMockLlm([
      { label: 'iterative_edit_propose', response: proposedMarkup },
      { label: 'iterative_edit_review', response: approverResponse },
      // Cycle 2 — proposer says no more edits (returns markup with no edits at all)
      { label: 'iterative_edit_propose', response: 'Hello Earth.' },
    ]);
    const agent = new IterativeEditingAgent();
    const result = await agent.execute(
      { parent: variant('p1', source), perInvocationBudgetUsd: 1.0, llm } as unknown as Parameters<typeof agent.execute>[0],
      makeCtx({ llm }),
    );
    expect(result.detail.detailType).toBe('iterative_editing');
    expect(result.detail.cycles.length).toBeGreaterThanOrEqual(1);
    expect(result.result.finalVariant).not.toBeNull();
    expect(result.result.finalVariant?.text).toBe('Hello Earth.');
    expect(result.result.surfaced).toBe(true);
  });

  it('emits no final variant when all edits are rejected', async () => {
    const source = 'Hello world.';
    const proposedMarkup = 'Hello {~~ [#1] world ~> Earth ~~}.';
    const approverResponse = JSON.stringify({ groupNumber: 1, decision: 'reject', reason: 'no improvement' });
    const llm = makeMockLlm([
      { label: 'iterative_edit_propose', response: proposedMarkup },
      { label: 'iterative_edit_review', response: approverResponse },
    ]);
    const agent = new IterativeEditingAgent();
    const result = await agent.execute(
      { parent: variant('p1', source), perInvocationBudgetUsd: 1.0, llm } as unknown as Parameters<typeof agent.execute>[0],
      makeCtx({ llm }),
    );
    expect(result.detail.stopReason).toBe('all_edits_rejected');
    expect(result.result.finalVariant).toBeNull();
    expect(result.result.surfaced).toBe(false);
  });

  it('aborts cleanly when proposer drift fires (drift recovery disabled)', async () => {
    const source = 'Hello world.';
    // Proposer returns text with drift outside markup (extra "darling " inserted).
    const driftedMarkup = 'Hello darling world.';
    const llm = makeMockLlm([
      { label: 'iterative_edit_propose', response: driftedMarkup },
    ]);
    // Disable drift recovery so the agent can't try a recovery LLM call (we
    // didn't queue one). This forces it down the skipped_major_drift path.
    const original = process.env.EVOLUTION_DRIFT_RECOVERY_ENABLED;
    process.env.EVOLUTION_DRIFT_RECOVERY_ENABLED = 'false';
    try {
      const agent = new IterativeEditingAgent();
      const result = await agent.execute(
        { parent: variant('p1', source), perInvocationBudgetUsd: 1.0, llm } as unknown as Parameters<typeof agent.execute>[0],
        makeCtx({ llm }),
      );
      expect(['proposer_drift_major', 'proposer_drift_intentional', 'proposer_drift_unrecoverable']).toContain(result.detail.stopReason);
      expect(result.result.finalVariant).toBeNull();
    } finally {
      if (original === undefined) delete process.env.EVOLUTION_DRIFT_RECOVERY_ENABLED;
      else process.env.EVOLUTION_DRIFT_RECOVERY_ENABLED = original;
    }
  });

  it('records per-purpose cost split per Decisions §13 invariant I2', async () => {
    const source = 'Hello world.';
    const proposedMarkup = 'Hello {~~ [#1] world ~> Earth ~~}.';
    const approverResponse = JSON.stringify({ groupNumber: 1, decision: 'accept', reason: 'good' });
    const llm = makeMockLlm([
      { label: 'iterative_edit_propose', response: proposedMarkup },
      { label: 'iterative_edit_review', response: approverResponse },
      { label: 'iterative_edit_propose', response: 'Hello Earth.' },
    ]);
    const agent = new IterativeEditingAgent();
    const result = await agent.execute(
      { parent: variant('p1', source), perInvocationBudgetUsd: 1.0, llm } as unknown as Parameters<typeof agent.execute>[0],
      makeCtx({ llm }),
    );
    const cycle1 = result.detail.cycles[0]!;
    expect(cycle1.proposeCostUsd).toBeGreaterThan(0);
    expect(cycle1.approveCostUsd).toBeGreaterThan(0);
  });

  it('uses approverModel from config (Decisions §16) — distinct from editingModel', async () => {
    const source = 'Hello world.';
    const proposedMarkup = 'Hello {~~ [#1] world ~> Earth ~~}.';
    const approverResponse = JSON.stringify({ groupNumber: 1, decision: 'reject', reason: 'no' });
    const llm = makeMockLlm([
      { label: 'iterative_edit_propose', response: proposedMarkup },
      { label: 'iterative_edit_review', response: approverResponse },
    ]);
    const agent = new IterativeEditingAgent();
    const ctx = makeCtx({ llm });
    (ctx.config as unknown as Record<string, string>).editingModel = 'gpt-4.1';
    (ctx.config as unknown as Record<string, string>).approverModel = 'claude-sonnet-4-6';
    const result = await agent.execute(
      { parent: variant('p1', source), perInvocationBudgetUsd: 1.0, llm } as unknown as Parameters<typeof agent.execute>[0],
      ctx,
    );
    expect(result.detail.config.editingModel).toBe('gpt-4.1');
    expect(result.detail.config.approverModel).toBe('claude-sonnet-4-6');
  });

  it('respects editingMaxCycles per-iteration override', async () => {
    const source = 'Hello world.';
    const proposedMarkup1 = 'Hello {~~ [#1] world ~> Earth ~~}.';
    const proposedMarkup2 = 'Hello {~~ [#1] Earth ~> Mars ~~}.';
    const approverAccept = JSON.stringify({ groupNumber: 1, decision: 'accept', reason: 'good' });
    // 2 cycles × (propose + review) = 4 calls
    const llm = makeMockLlm([
      { label: 'iterative_edit_propose', response: proposedMarkup1 },
      { label: 'iterative_edit_review', response: approverAccept },
      { label: 'iterative_edit_propose', response: proposedMarkup2 },
      { label: 'iterative_edit_review', response: approverAccept },
    ]);
    const agent = new IterativeEditingAgent();
    const ctx = makeCtx({ llm });
    (ctx.config as { iterationConfigs: Array<{ agentType: string; editingMaxCycles?: number }> }).iterationConfigs[0]!.editingMaxCycles = 2;
    const result = await agent.execute(
      { parent: variant('p1', source), perInvocationBudgetUsd: 1.0, llm } as unknown as Parameters<typeof agent.execute>[0],
      ctx,
    );
    expect(result.detail.cycles.length).toBe(2);
    expect(result.detail.config.maxCycles).toBe(2);
  });

  it('source containing CriticMarkup delimiters → aborts with parse_failed', async () => {
    const source = 'Hello {++ world ++}.'; // article already has markup-shaped content
    const llm = makeMockLlm([]);
    const agent = new IterativeEditingAgent();
    const result = await agent.execute(
      { parent: variant('p1', source), perInvocationBudgetUsd: 1.0, llm } as unknown as Parameters<typeof agent.execute>[0],
      makeCtx({ llm }),
    );
    expect(result.detail.stopReason).toBe('parse_failed');
    expect(result.detail.errorMessage).toMatch(/CriticMarkup/);
    expect(result.result.surfaced).toBe(false);
  });

  it('per Decisions §14: final variant.parentIds points to the ORIGINAL input parent (not cycle-N-1 intermediate)', async () => {
    const source = 'foo bar.';
    const proposedMarkup1 = 'foo {~~ [#1] bar ~> baz ~~}.';
    const proposedMarkup2 = 'foo {~~ [#1] baz ~> qux ~~}.';
    const approverAccept = JSON.stringify({ groupNumber: 1, decision: 'accept', reason: '' });
    const llm = makeMockLlm([
      { label: 'iterative_edit_propose', response: proposedMarkup1 },
      { label: 'iterative_edit_review', response: approverAccept },
      { label: 'iterative_edit_propose', response: proposedMarkup2 },
      { label: 'iterative_edit_review', response: approverAccept },
    ]);
    const agent = new IterativeEditingAgent();
    const ctx = makeCtx({ llm });
    (ctx.config as { iterationConfigs: Array<{ agentType: string; editingMaxCycles?: number }> }).iterationConfigs[0]!.editingMaxCycles = 2;
    const result = await agent.execute(
      { parent: variant('p1', source), perInvocationBudgetUsd: 1.0, llm } as unknown as Parameters<typeof agent.execute>[0],
      ctx,
    );
    expect(result.result.finalVariant?.parentIds).toEqual(['p1']);
  });
});
