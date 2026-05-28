// Static-source invariant tests for SinglePassEvaluateCriteriaAndGenerateAgent.
// rename_agents_subagents_evolution_20260508 Phase 1 follow-up.

import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC_PATH = resolve(__dirname, 'singlePassEvaluateCriteriaAndGenerate.ts');

function readSource(): string {
  return readFileSync(SRC_PATH, 'utf-8');
}

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

describe('SinglePassEvaluateCriteriaAndGenerateAgent invariants', () => {
  let source: string;
  beforeAll(() => { source = readSource(); });

  it('no nested .run() calls inside execute() body (must use .execute())', () => {
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

  it('agent.name DB string is single_pass_evaluate_criteria_and_generate', () => {
    expect(source).toMatch(/name\s*=\s*['"]single_pass_evaluate_criteria_and_generate['"]/);
  });

  it('includes the three guardrail directives (length / redundancy / flow) in the customPrompt', () => {
    // The single-pass agent's hypothesis is "prompt-only guardrails" — the directives
    // must be present in the source.
    expect(source.toLowerCase()).toMatch(/length/);
    expect(source.toLowerCase()).toMatch(/redundancy/);
    expect(source.toLowerCase()).toMatch(/flow/);
  });
});
