// Static-source invariant tests for DebateThenGenerateFromPreviousArticleAgent.
// (bring_back_debate_agent_20260506 Phase 2.10.)
//
// Mirrors evolution/src/lib/core/agents/editing/IterativeEditingAgent.invariants.test.ts
// with one added invariant (I4) specific to wrapper agents that delegate LLM calls.

import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC_PATH = resolve(__dirname, 'DebateAgent.ts');

function readSource(): string {
  return readFileSync(SRC_PATH, 'utf-8');
}

/** Slice out the body of `async execute(...)` from start brace to matching close. */
function extractExecuteBody(source: string): string {
  const sigIdx = source.indexOf('async execute(');
  if (sigIdx === -1) throw new Error('execute() not found');
  const openIdx = source.indexOf('{', sigIdx);
  if (openIdx === -1) throw new Error('execute() body open brace not found');
  let depth = 1;
  let i = openIdx + 1;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  return source.slice(openIdx, i);
}

/** Strip line + block comments so invariant regexes don't match documentation prose
 *  that explains the invariant (e.g., `// NOT ctx.llm` is documentation, not a violation). */
function stripComments(source: string): string {
  // Block comments first, then line comments. Be conservative: process line-by-line so
  // string literals containing `//` aren't mangled (heuristic — sufficient for our agent files).
  const noBlock = source.replace(/\/\*[\s\S]*?\*\//g, '');
  return noBlock
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

describe('DebateAgent invariants', () => {
  let source: string;
  beforeAll(() => { source = readSource(); });

  it('LOAD-BEARING INVARIANTS comment block exists at top of file with I1-I4', () => {
    expect(source.slice(0, 2500)).toMatch(/LOAD-BEARING INVARIANTS/);
    expect(source).toMatch(/I1\./);
    expect(source).toMatch(/I2\./);
    expect(source).toMatch(/I3\./);
    expect(source).toMatch(/I4\./);
  });

  it('I1: no nested `.run(` calls inside execute() body', () => {
    // The forbidden pattern is `.run(` — that creates a NESTED Agent.run() scope
    // and splits cost attribution. `new GenerateFromPreviousArticleAgent().execute(...)`
    // IS legal per the wrapper-delegate pattern.
    // Strip comments first so documentation prose (e.g., "NOT .run()") doesn't false-positive.
    const executeBody = stripComments(extractExecuteBody(source));
    expect(executeBody).not.toMatch(/\.run\s*\(/);
  });

  it('I2: each LLM helper call site is preceded by a costBefore* capture', () => {
    const executeBody = extractExecuteBody(source);
    // At least one snapshot for the combined judge call (Option C — only 1 wrapper-level
    // LLM call; synthesis cost-tracking is handled inside inner GFPA's own snapshots).
    const costBeforeMatches = executeBody.match(/costBefore[A-Z][A-Za-z]*/g) ?? [];
    expect(costBeforeMatches.length).toBeGreaterThanOrEqual(1);
  });

  it('I3: catch blocks at every failure point preserve partial detail before throw', () => {
    const executeBody = extractExecuteBody(source);
    expect(executeBody).toMatch(/try\s*\{/);
    expect(executeBody).toMatch(/catch\s*\(/);
    // persistPartialDetail (or updateInvocation) should be invoked from catch blocks.
    expect(executeBody).toMatch(/persistPartialDetail|updateInvocation/);
  });

  it('I4: synthesis-LLM proxy injected via innerInput.llm (NOT ctx.llm)', () => {
    const executeBody = extractExecuteBody(source);
    // The proxy must be passed to inner GFPA via innerInput.llm. Check both:
    //  (a) `synthesisLlmProxy` is constructed AND
    //  (b) `llm: synthesisLlmProxy` appears in the GFPA input.
    expect(executeBody).toMatch(/synthesisLlmProxy/);
    expect(executeBody).toMatch(/llm:\s*synthesisLlmProxy/);
  });

  it('I4: proxy wraps BOTH complete and completeStructured', () => {
    const executeBody = extractExecuteBody(source);
    // Both methods must be defined on the proxy object literal.
    expect(executeBody).toMatch(/complete:\s*\(/);
    expect(executeBody).toMatch(/completeStructured:\s*\(/);
  });

  it('I4: proxy rewrites generation → debate_synthesis', () => {
    const executeBody = extractExecuteBody(source);
    // The rewrite literal must appear inside execute().
    expect(executeBody).toMatch(/'generation'\s*\?\s*'debate_synthesis'/);
  });

  it('uses the wrapper-passed input.llm — never instantiates a separate EvolutionLLMClient', () => {
    const executeBody = extractExecuteBody(source);
    expect(executeBody).not.toMatch(/new\s+EvolutionLLMClient\s*\(/);
    expect(executeBody).not.toMatch(/createEvolutionLLMClient\s*\(/);
  });

  it('reads input.llm (NOT ctx.llm) for the wrapper-level combined judge call', () => {
    const executeBody = stripComments(extractExecuteBody(source));
    // Verify the agent reads from input.llm.
    expect(executeBody).toMatch(/input\.llm/);
    // Negative: must NOT mutate or read ctx.llm anywhere (comments stripped above).
    expect(executeBody).not.toMatch(/ctx\.llm/);
  });

  it('persistPartialDetail covers all active failurePoint enum values via partial-detail catch blocks', () => {
    // After the 2026-05-09 winner-field removal, judge_tie is no longer a live code
    // path — the schema retains it for backward-compat with rows persisted before
    // the change but new code paths never emit it. Walk source and confirm each
    // active failure point appears at least once.
    const failurePoints = [
      'combined_call',
      'parse',
      'synthesis',
      'synthesis_empty',
      'synthesis_no_op',
      'budget',
    ];
    // (gate + selection are dispatch-site failure points handled in runIterationLoop, not in
    // the agent itself — agent receives variantA + variantB pre-selected per Decision §16.)
    // (judge_tie removed from active code paths 2026-05-09 — see schema comment.)
    for (const fp of failurePoints) {
      expect(source).toMatch(new RegExp(`'${fp}'`));
    }
  });
});
