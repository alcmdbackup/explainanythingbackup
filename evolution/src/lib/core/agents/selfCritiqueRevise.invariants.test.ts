// Static-source invariant tests for SelfCritiqueReviseAgent.
// brainstorm_new_agents_with_reflection_20260630.

import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC_PATH = resolve(__dirname, 'selfCritiqueRevise.ts');

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

describe('SelfCritiqueReviseAgent invariants', () => {
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

  it('agent.name DB string is self_critique_revise', () => {
    expect(source).toMatch(/name\s*=\s*['"]self_critique_revise['"]/);
  });

  it('tactic marker is self_critique_driven', () => {
    expect(source).toMatch(/self_critique_driven/);
  });

  it('captures costBeforeReflection snapshot BEFORE reflection LLM call', () => {
    const executeBody = extractExecuteBody(source);
    const costBeforeIdx = executeBody.indexOf('costBeforeReflection');
    const llmCompleteIdx = executeBody.indexOf("llm.complete(prompt, 'self_critique'");
    expect(costBeforeIdx).toBeGreaterThan(-1);
    expect(llmCompleteIdx).toBeGreaterThan(-1);
    expect(costBeforeIdx).toBeLessThan(llmCompleteIdx);
  });

  it('uses ctx.invocationId || crypto.randomUUID() for nonce (fallback for empty-string DB-error path)', () => {
    const executeBody = extractExecuteBody(source);
    // Must use || (truthy check catches empty string), NOT ?? (only catches null/undefined).
    expect(executeBody).toMatch(/nonce\s*=\s*ctx\.invocationId\s*\|\|\s*(?:globalThis\.)?crypto\.randomUUID\(\)/);
    expect(executeBody).not.toMatch(/nonce\s*=\s*ctx\.invocationId\s*\?\?/);
  });

  it('runtime-asserts nonce matches strict UUID v4 shape', () => {
    // Regex should match strict UUID v4 shape (8-4-4-4-12 with hyphens), NOT the
    // over-permissive `/^[0-9a-f-]{16,}$/i` which would accept 16 hyphens or bare hex.
    expect(source).toMatch(/UUID_V4_REGEX\s*=\s*\/\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}\$\/i/);
  });

  it('does NOT import from node:crypto (would drag server-only chunk into client bundle)', () => {
    // The agent is registered in agentRegistry, which is transitively imported
    // by client-side EntityMetricsTab. Any `node:*` import breaks the Next.js build.
    // Use globalThis.crypto.randomUUID() (available in Node 20+ AND browsers) instead.
    expect(source).not.toMatch(/from\s+['"]node:crypto['"]/);
  });

  it('forwards GFPA failure signal — does not swallow it', () => {
    const executeBody = extractExecuteBody(source);
    // The return statement at the end of execute() should include failure: gfpaOutput.failure.
    expect(executeBody).toMatch(/failure:\s*gfpaOutput\.failure/);
  });

  it('registers attribution extractor at the file tail', () => {
    expect(source).toMatch(/registerAttributionExtractor\s*\(\s*['"]self_critique_revise['"]/);
  });

  it('does NOT emit Length/Redundancy/Flow guardrail markdown in customPrompt (regression guard)', () => {
    // These strings would indicate accidental re-introduction of the criteria-family
    // scope constraints that were explicitly dropped for free-form reflection.
    expect(source).not.toMatch(/\*\*Length\*\*/);
    expect(source).not.toMatch(/\*\*Redundancy\*\*/);
    expect(source).not.toMatch(/\*\*Flow\*\*/);
    expect(source).not.toMatch(/Preserve the original word count/);
  });

  it('persists partial detail via updateInvocation on all throw paths', () => {
    const executeBody = extractExecuteBody(source);
    // Count updateInvocation calls — should be at least 3 (reflection-throw, parser-
    // throw, GFPA-throw).
    const matches = executeBody.match(/updateInvocation\s*\(/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it('wraps customPrompt content in nonce-fenced UNTRUSTED_PLAN block', () => {
    // The customPrompt builder must use the nonce-fenced form, not a static fence.
    expect(source).toMatch(/<UNTRUSTED_PLAN_\$\{nonce\}>/);
    expect(source).toMatch(/<\/UNTRUSTED_PLAN_\$\{nonce\}>/);
  });

  it('emits warn log when sanitizationCount >= 1 (production canary)', () => {
    const executeBody = extractExecuteBody(source);
    expect(executeBody).toMatch(/sanitizationCount\s*>=?\s*1/);
    expect(executeBody).toMatch(/self_critique sanitization fired/);
  });

  it('performs output delimiter-mirror check on GFPA output', () => {
    const executeBody = extractExecuteBody(source);
    expect(executeBody).toMatch(/outputContainsFenceLeak/);
    expect(executeBody).toMatch(/output_fence_leak/);
  });

  it('checks output field variant?.text (matches GenerateFromPreviousOutput shape)', () => {
    const executeBody = extractExecuteBody(source);
    expect(executeBody).toMatch(/gfpaOutput\.result\?\.variant\?\.text/);
  });
});
