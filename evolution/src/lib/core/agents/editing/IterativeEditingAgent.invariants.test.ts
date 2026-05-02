// Static-source invariant tests for IterativeEditingAgent. Per Decisions §13
// + Round 3 review pass-2 fix (A8 — narrow regex to forbid only nested
// .run() calls, not new XAgent() which IS the legal wrapper-delegate
// pattern).
//
// Mirrors evolution/src/lib/core/agents/reflectAndGenerateFromPreviousArticle.invariants.test.ts.

import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC_PATH = resolve(__dirname, 'IterativeEditingAgent.ts');

function readSource(): string {
  return readFileSync(SRC_PATH, 'utf-8');
}

/** Slice out the body of `async execute(...)` from start brace to matching close. */
function extractExecuteBody(source: string): string {
  const sigIdx = source.indexOf('async execute(');
  if (sigIdx === -1) throw new Error('execute() not found');
  // Find the opening brace.
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

describe('IterativeEditingAgent invariants', () => {
  let source: string;
  beforeAll(() => { source = readSource(); });

  it('I1+I2+I3: LOAD-BEARING INVARIANTS comment block exists at top of file', () => {
    expect(source.slice(0, 1500)).toMatch(/LOAD-BEARING INVARIANTS/);
    expect(source).toMatch(/I1\./);
    expect(source).toMatch(/I2\./);
    expect(source).toMatch(/I3\./);
  });

  it('I1: no nested `.run(` calls inside execute() body', () => {
    // The forbidden pattern is `.run(` inside execute() — that creates a NESTED
    // Agent.run() scope and splits cost attribution. `new SomeAgent().execute(...)`
    // IS legal per the wrapper-delegate pattern (mirror of PR #1017's
    // reflectAndGenerateFromPreviousArticle.ts:414); we ONLY forbid `.run(`.
    const executeBody = extractExecuteBody(source);
    expect(executeBody).not.toMatch(/\.run\s*\(/);
  });

  it('I2: each LLM helper call site is preceded by a costBefore* capture', () => {
    const executeBody = extractExecuteBody(source);
    // Expect at least three costBefore* captures (Proposer + Approver + drift-recovery).
    const costBeforeMatches = executeBody.match(/costBefore[A-Z][A-Za-z]*Call/g) ?? [];
    expect(costBeforeMatches.length).toBeGreaterThanOrEqual(3);
  });

  it('I3: cycle loop body is wrapped in try/catch', () => {
    const executeBody = extractExecuteBody(source);
    expect(executeBody).toMatch(/try\s*\{/);
    expect(executeBody).toMatch(/catch\s*\(/);
  });

  it('uses the wrapper-passed input.llm — never instantiates a separate EvolutionLLMClient', () => {
    const executeBody = extractExecuteBody(source);
    // No `new EvolutionLLMClient(` or `createEvolutionLLMClient(` inside execute().
    expect(executeBody).not.toMatch(/new\s+EvolutionLLMClient\s*\(/);
    expect(executeBody).not.toMatch(/createEvolutionLLMClient\s*\(/);
  });

  it('declares the LOAD-BEARING INVARIANT references in execute() comments at the call sites', () => {
    const executeBody = extractExecuteBody(source);
    // Per the comment block, key invariants should be referenced near their call sites.
    // We don't pin to exact wording — just confirm Decisions §13 / I1 / I2 show up
    // as comment markers near the LLM call sites.
    expect(executeBody).toMatch(/I[12]/);
  });
});
