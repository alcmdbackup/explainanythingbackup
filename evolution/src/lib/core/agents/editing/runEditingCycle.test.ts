// Helper-level unit tests for runEditingCycle (the per-cycle helper extracted from
// IterativeEditingAgent in paragraph_recombine_agent_with_coherence_pass_evolution_20260620 Phase 4).
//
// Targeted coverage: each opts permutation + the I1/I2/I3 contracts. Behavior preservation
// for IterativeEditingAgent is covered by the existing IterativeEditingAgent.test.ts /
// IterativeEditingRewriteAgent.test.ts suites (which still pass post-refactor).

import { runEditingCycle, type RunEditingCycleArgs } from './runEditingCycle';
import type { AgentCostScope } from '../../../pipeline/infra/trackBudget';
import type { EvolutionLLMClient } from '../../../types';

// ─── Helpers ──────────────────────────────────────────────────────

/** Minimal cost scope that tracks per-recordSpend calls so tests can assert I2. */
function makeMockScope(): AgentCostScope & { calls: { recordSpend: number[] } } {
  const calls = { recordSpend: [] as number[] };
  let totalSpent = 0;
  const scope = {
    reserve: () => 0,
    recordSpend: (_phase: string, actualCost: number) => {
      totalSpent += actualCost;
      calls.recordSpend.push(actualCost);
    },
    release: () => {},
    getTotalSpent: () => totalSpent,
    getPhaseCosts: () => ({} as Record<string, number>),
    getAvailableBudget: () => Infinity,
    getOwnSpent: () => totalSpent,
    calls,
  };
  return scope as unknown as AgentCostScope & { calls: { recordSpend: number[] } };
}

/** Mock LLM that returns deterministic responses keyed by AgentName label. Tracks per-label call count. */
function makeMockLlm(responses: Partial<Record<string, string | (() => string | Promise<string>) | Error>>): {
  llm: EvolutionLLMClient;
  calls: Record<string, number>;
} {
  const calls: Record<string, number> = {};
  const llm: EvolutionLLMClient = {
    async complete(_prompt, label) {
      calls[label] = (calls[label] ?? 0) + 1;
      const r = responses[label];
      if (r instanceof Error) throw r;
      if (typeof r === 'function') return await (r as () => string | Promise<string>)();
      if (typeof r === 'string') return r;
      throw new Error(`mock LLM has no response for label '${label}'`);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async completeStructured() { throw new Error('structured not implemented in this mock'); },
  };
  return { llm, calls };
}

const SAMPLE_ARTICLE = '# Title\n\n## Section\n\nThe first sentence states the topic. The second sentence elaborates with detail. The third sentence concludes the paragraph.\n\n## Section Two\n\nAnother paragraph follows. It also has multiple sentences to satisfy the format validator.';

// ─── Tests ────────────────────────────────────────────────────────

describe('runEditingCycle — invariants', () => {
  it('I1: helper does not instantiate any Agent class (no nested .run())', () => {
    // Static check on the source file. The helper is allowed to call llm.complete() and pure helpers only.
    const fs = require('fs');
    const path = require('path');
    const src: string = fs.readFileSync(path.resolve(__dirname, 'runEditingCycle.ts'), 'utf-8');
    expect(src).not.toMatch(/\.run\s*\(/);
    expect(src).not.toMatch(/new\s+\w+Agent\s*\(/);
  });

  it('I2: helper internally captures costBeforeProposeCall + costBeforeApproveCall', () => {
    const fs = require('fs');
    const path = require('path');
    const src: string = fs.readFileSync(path.resolve(__dirname, 'runEditingCycle.ts'), 'utf-8');
    expect(src).toContain('costBeforeProposeCall');
    expect(src).toContain('costBeforeApproveCall');
  });

  it('I3: header documents the partial-cycle-on-failure pattern', () => {
    const fs = require('fs');
    const path = require('path');
    const src: string = fs.readFileSync(path.resolve(__dirname, 'runEditingCycle.ts'), 'utf-8');
    expect(src.slice(0, 2000)).toMatch(/I3\./);
  });
});

describe('runEditingCycle — per-cycle entry budget gate', () => {
  it('returns invocation_budget_near_exhaustion when scope is >= 0.9 × budget', async () => {
    const scope = makeMockScope();
    // Bump scope to 95% of a $0.10 budget.
    scope.recordSpend('iterative_edit_propose', 0.095, 0);
    const { llm, calls } = makeMockLlm({});
    const result = await runEditingCycle({
      text: SAMPLE_ARTICLE,
      llm,
      costScope: scope,
      perInvocationBudgetUsd: 0.10,
      cycleNumber: 1,
      proposerLabel: 'iterative_edit_propose',
      approverLabel: 'iterative_edit_review',
      models: { editing: 'gpt-4.1-nano', approver: 'qwen-2.5-7b-instruct' },
      driftRecovery: 'snap',
      proposerSystemPrompt: 'sys',
      proposerUserPrompt: 'user',
    });
    expect(result.stopReason).toBe('invocation_budget_near_exhaustion');
    expect(result.newText).toBe(SAMPLE_ARTICLE);
    expect(calls['iterative_edit_propose']).toBeUndefined(); // gate fired before any LLM call
  });
});

describe('runEditingCycle — Mode A vs Mode B switching', () => {
  it('Mode A (rewriteMode undefined) treats proposer output as marked-up directly', async () => {
    // Proposer emits an article with no actual edits (no CriticMarkup spans) → no_edits_proposed.
    const { llm, calls } = makeMockLlm({
      iterative_edit_propose: SAMPLE_ARTICLE, // no edits inside
      iterative_edit_review: '',
    });
    const scope = makeMockScope();
    const result = await runEditingCycle({
      text: SAMPLE_ARTICLE,
      llm,
      costScope: scope,
      perInvocationBudgetUsd: 0.10,
      cycleNumber: 1,
      proposerLabel: 'iterative_edit_propose',
      approverLabel: 'iterative_edit_review',
      models: { editing: 'gpt-4.1-nano', approver: 'qwen-2.5-7b-instruct' },
      driftRecovery: 'snap',
      proposerSystemPrompt: 'sys',
      proposerUserPrompt: 'user',
    });
    expect(calls['iterative_edit_propose']).toBe(1);
    expect(result.stopReason).toBe('no_edits_proposed');
    expect(result.cycle.proposeCostUsd).toBeDefined();
    expect(result.modeBContext).toBeUndefined();
  });

  // NOTE: a full Mode B happy-path test would exercise computeMarkupFromRewrite, which
  // depends on the unified/remark ESM-only packages. Those don't load cleanly in jest's
  // CommonJS unit-test context — they're tested in the integration tier instead. The
  // proposer_format_violation test below verifies the Mode B path is taken (split → fail).
});

describe('runEditingCycle — LLM error handling (I3)', () => {
  it('returns helper_threw + errorPhase=propose when proposer call throws', async () => {
    const { llm } = makeMockLlm({
      iterative_edit_propose: new Error('OpenAI 500'),
    });
    const scope = makeMockScope();
    const result = await runEditingCycle({
      text: SAMPLE_ARTICLE,
      llm,
      costScope: scope,
      perInvocationBudgetUsd: 0.10,
      cycleNumber: 1,
      proposerLabel: 'iterative_edit_propose',
      approverLabel: 'iterative_edit_review',
      models: { editing: 'gpt-4.1-nano', approver: 'qwen-2.5-7b-instruct' },
      driftRecovery: 'snap',
      proposerSystemPrompt: 'sys',
      proposerUserPrompt: 'user',
    });
    expect(result.stopReason).toBe('helper_threw');
    expect(result.errorPhase).toBe('propose');
    expect(result.errorMessage).toContain('OpenAI 500');
    expect(result.newText).toBe(SAMPLE_ARTICLE);
  });

  it('returns proposer_format_violation when Mode B output is empty (no rationale, no rewrite)', async () => {
    // splitRationaleAndRewrite returns parseFailed=true with rewrite='' when input is empty.
    const { llm } = makeMockLlm({
      iterative_edit_propose: '',
    });
    const scope = makeMockScope();
    const result = await runEditingCycle({
      text: SAMPLE_ARTICLE,
      llm,
      costScope: scope,
      perInvocationBudgetUsd: 0.10,
      cycleNumber: 1,
      proposerLabel: 'iterative_edit_propose',
      approverLabel: 'iterative_edit_review',
      models: { editing: 'gpt-4.1-nano', approver: 'qwen-2.5-7b-instruct' },
      driftRecovery: 'snap',
      proposerSystemPrompt: 'sys',
      proposerUserPrompt: 'user',
      rewriteMode: { proposerSoftCap: 3, coalesceAndCap: true },
    });
    expect(result.stopReason).toBe('proposer_format_violation');
  });
});

describe('runEditingCycle — driftRecovery: skip path (coherence pass usage)', () => {
  it('skips drift handling — returned cycle has no driftRecovery field', async () => {
    // Pass markup that strips cleanly (no drift in either case) to keep the test
    // focused on the driftRecovery: 'skip' code path. Verify the returned cycle
    // does NOT carry a driftRecovery field even though the proposer markup contained
    // an edit.
    const markupWithEdit = '# Title\n\n## Section\n\n{++ NEW WORD ++}The first sentence states the topic. The second sentence elaborates with detail. The third sentence concludes the paragraph.\n\n## Section Two\n\nAnother paragraph follows. It also has multiple sentences to satisfy the format validator.';
    const { llm } = makeMockLlm({
      coherence_pass_propose: markupWithEdit,
      coherence_pass_review: '{"groupNumber": 1, "decision": "accept", "reason": "ok"}',
    });
    const scope = makeMockScope();
    const result = await runEditingCycle({
      text: SAMPLE_ARTICLE,
      llm,
      costScope: scope,
      perInvocationBudgetUsd: 0.10,
      cycleNumber: 1,
      proposerLabel: 'coherence_pass_propose',
      approverLabel: 'coherence_pass_review',
      models: { editing: 'gpt-4.1-nano', approver: 'qwen-2.5-7b-instruct' },
      driftRecovery: 'skip',
      proposerSystemPrompt: 'sys',
      proposerUserPrompt: 'user',
    });
    expect(result.cycle.driftRecovery).toBeUndefined();
  });
});

describe('runEditingCycle — validateOpts boundary tests (coherence pass tight settings)', () => {
  it('default (validateOpts undefined) uses SIZE_RATIO_HARD_CAP=1.5 — legacy IterativeEditingAgent behavior', async () => {
    // 1.5× growth is allowed under defaults. Markup that grows the article by ~10% is fine.
    const markupSmallGrowth = '# Title\n\n## Section\n\nThe first sentence states the topic.{++  Inserted clause. ++} The second sentence elaborates with detail. The third sentence concludes the paragraph.\n\n## Section Two\n\nAnother paragraph follows. It also has multiple sentences to satisfy the format validator.';
    const { llm } = makeMockLlm({
      iterative_edit_propose: markupSmallGrowth,
      iterative_edit_review: '{"groupNumber": 1, "decision": "accept", "reason": "ok"}',
    });
    const scope = makeMockScope();
    const result = await runEditingCycle({
      text: SAMPLE_ARTICLE,
      llm,
      costScope: scope,
      perInvocationBudgetUsd: 0.10,
      cycleNumber: 1,
      proposerLabel: 'iterative_edit_propose',
      approverLabel: 'iterative_edit_review',
      models: { editing: 'gpt-4.1-nano', approver: 'qwen-2.5-7b-instruct' },
      driftRecovery: 'snap',
      proposerSystemPrompt: 'sys',
      proposerUserPrompt: 'user',
    });
    expect(result.appliedAny).toBe(true);
  });
});

