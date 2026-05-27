// Static-source invariant tests for EvaluateCriteriaThenGenerateFromPreviousArticleAgent.
// rename_agents_subagents_evolution_20260508 Phase 1 follow-up — created in the same
// shape as reflectAndGenerateFromPreviousArticle.invariants.test.ts.
//
// Invariants pinned:
//  - The wrapper delegates to inner GenerateFromPreviousArticleAgent.execute() — NOT .run()
//    (load-bearing for cost-scope unity).
//  - No `.run(` inside execute().
//  - No separate EvolutionLLMClient instantiation inside execute() (uses input.llm).

import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC_PATH = resolve(__dirname, 'evaluateCriteriaThenGenerateFromPreviousArticle.ts');

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

describe('EvaluateCriteriaThenGenerateFromPreviousArticleAgent invariants', () => {
  let source: string;
  beforeAll(() => { source = readSource(); });

  it('declares LOAD-BEARING comment markers', () => {
    expect(source).toMatch(/LOAD-BEARING/);
  });

  it('no nested .run() calls inside execute() body (must use .execute())', () => {
    // Strip line-comments before scanning so doc comments mentioning `.run()` don't
    // false-positive — we only care about actual call expressions.
    const executeBody = extractExecuteBody(source).replace(/\/\/.*$/gm, '');
    expect(executeBody).not.toMatch(/\.run\s*\(/);
  });

  it('uses the wrapper-passed input.llm — never instantiates a separate EvolutionLLMClient', () => {
    const executeBody = extractExecuteBody(source);
    expect(executeBody).not.toMatch(/new\s+EvolutionLLMClient\s*\(/);
    expect(executeBody).not.toMatch(/createEvolutionLLMClient\s*\(/);
  });

  it('delegates to inner GenerateFromPreviousArticleAgent.execute() — load-bearing', () => {
    const executeBody = extractExecuteBody(source);
    expect(executeBody.replace(/\n/g, ' ')).toMatch(/GenerateFromPreviousArticleAgent[^)]*\)\s*\.execute\(/);
  });

  it('agent.name DB string is evaluate_criteria_then_generate_from_previous_article', () => {
    expect(source).toMatch(/name\s*=\s*['"]evaluate_criteria_then_generate_from_previous_article['"]/);
  });
});
