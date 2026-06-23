// Static-source invariant tests for ProposerApproverCriteriaGenerateAgent.
// rename_agents_subagents_evolution_20260508 Phase 1 follow-up.
//
// This agent is a quasi-wrapper: it orchestrates multiple LLM calls (eval, propose,
// forward-approve, mirror-approve) + a rankNewVariant() helper. It does NOT call
// another Agent's .execute() since the work is bespoke, but it MUST still avoid
// nested .run() calls and must use the wrapper-passed input.llm.

import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC_PATH = resolve(__dirname, 'proposerApproverCriteriaGenerate.ts');

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

describe('ProposerApproverCriteriaGenerateAgent invariants', () => {
  let source: string;
  beforeAll(() => { source = readSource(); });

  it('no nested .run() calls inside execute() body (must use .execute() or helpers)', () => {
    const executeBody = extractExecuteBody(source).replace(/\/\/.*$/gm, '');
    expect(executeBody).not.toMatch(/\.run\s*\(/);
  });

  it('uses the wrapper-passed input.llm — never instantiates a separate EvolutionLLMClient', () => {
    const executeBody = extractExecuteBody(source);
    expect(executeBody).not.toMatch(/new\s+EvolutionLLMClient\s*\(/);
    expect(executeBody).not.toMatch(/createEvolutionLLMClient\s*\(/);
  });

  it('agent.name DB string is proposer_approver_criteria_generate', () => {
    expect(source).toMatch(/name\s*=\s*['"]proposer_approver_criteria_generate['"]/);
  });

  it('emits the three distinct AgentName labels (proposer / forward / mirror)', () => {
    // The propose/forward/mirror cost split lives in execution_detail.cycles[0].
    // Each LLM call must use its dedicated AgentName label so writeMetricMax routes
    // the cost to proposer_approver_criteria_cost correctly.
    expect(source).toMatch(/criteria_proposer/);
    expect(source).toMatch(/criteria_forward_approver/);
    expect(source).toMatch(/criteria_mirror_approver/);
  });

  it('mirror short-circuit path exists (forward-rejected groups skip mirror)', () => {
    // The plan's cost projection assumes mirror short-circuits forward-rejected
    // groups — if removed, mirror cost projection becomes off by the rejection rate.
    expect(source.toLowerCase()).toMatch(/short.?circuit|forward.?reject|mirror.{0,40}null/i);
  });

  // I3 invariant: every helper LLM-call catch block MUST persist partial
  // execution_detail (via updateInvocation) BEFORE re-throwing, so the
  // invocation row preserves forensic context. Bug-sweep fix 2026-06-23
  // landed updateInvocation calls in the eval+suggest, proposer, and
  // forward-approver catch paths.
  it('I3: eval+suggest catch persists partial detail before re-throwing EvaluateAndSuggestLLMError', () => {
    // Find the `throw new EvaluateAndSuggestLLMError(` site (skip the import).
    const throwSite = source.search(/throw\s+new\s+EvaluateAndSuggestLLMError\s*\(/);
    expect(throwSite).toBeGreaterThan(-1);
    // The 800 chars BEFORE the throw should contain an updateInvocation call.
    const window = source.slice(Math.max(0, throwSite - 800), throwSite);
    expect(window).toMatch(/updateInvocation\s*\(/);
  });

  it('I3: proposer catch persists partial detail before re-throwing', () => {
    // Locate the "Proposer LLM call failed" throw site, then walk back 800
    // chars to confirm an updateInvocation call landed in the same catch.
    const proposerThrowIdx = source.indexOf('Proposer LLM call failed');
    expect(proposerThrowIdx).toBeGreaterThan(-1);
    const window = source.slice(Math.max(0, proposerThrowIdx - 800), proposerThrowIdx);
    expect(window).toMatch(/updateInvocation\s*\(/);
  });

  it('I3: forward-approver catch persists partial detail before re-throwing', () => {
    const fwdThrowIdx = source.indexOf('Forward approver LLM call failed');
    expect(fwdThrowIdx).toBeGreaterThan(-1);
    const window = source.slice(Math.max(0, fwdThrowIdx - 1000), fwdThrowIdx);
    expect(window).toMatch(/updateInvocation\s*\(/);
  });

  it('I3: mirror-approver cost is captured in a finally so partial spend is always recorded', () => {
    // Locate the mirror catch block; its end must be followed by a `finally`
    // block that updates approveMirrorCostUsd from the cost tracker.
    const mirrorCatchIdx = source.indexOf('Mirror approver LLM call failed');
    expect(mirrorCatchIdx).toBeGreaterThan(-1);
    // The 600 chars AFTER the catch body should contain a finally that
    // reassigns approveMirrorCostUsd from the cost tracker.
    const window = source.slice(mirrorCatchIdx, Math.min(source.length, mirrorCatchIdx + 1200));
    expect(window).toMatch(/finally\s*\{/);
    expect(window).toMatch(/approveMirrorCostUsd\s*=/);
  });
});
