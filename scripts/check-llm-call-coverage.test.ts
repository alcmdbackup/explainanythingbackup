/**
 * @jest-environment node
 */
// Unit test for the LLM-call coverage guard (scripts/check-llm-call-coverage.ts).

import { findViolations, isExempt, ALLOWLIST } from './check-llm-call-coverage';

describe('check-llm-call-coverage', () => {
  it('flags a NEW file that calls the OpenAI SDK directly', () => {
    const v = findViolations([
      { path: 'src/lib/services/somethingNew.ts', content: 'const r = await client.chat.completions.create({});' },
    ]);
    expect(v).toHaveLength(1);
    expect(v[0]!.pattern).toBe('openai-sdk-direct');
  });

  it('flags a NEW file that calls the Anthropic SDK directly', () => {
    const v = findViolations([
      { path: 'src/lib/services/somethingNew.ts', content: 'await anthropic.messages.create({});' },
    ]);
    expect(v.map(x => x.pattern)).toContain('anthropic-sdk-direct');
  });

  it('flags a NEW direct llmCallTracking insert (bypassing saveLlmCallTracking)', () => {
    const v = findViolations([
      { path: 'src/lib/services/somethingNew.ts', content: "await supabase.from('llmCallTracking').insert({ model: 'x' });" },
    ]);
    expect(v.map(x => x.pattern)).toContain('tracking-insert-direct');
  });

  it('does NOT flag a read-only select from llmCallTracking', () => {
    const v = findViolations([
      { path: 'src/lib/services/userAdmin.ts', content: "await supabase.from('llmCallTracking').select('estimated_cost_usd');" },
    ]);
    expect(v).toHaveLength(0);
  });

  it('does NOT flag the allowlisted chokepoint or documented self-tracker', () => {
    const v = findViolations([
      { path: 'src/lib/services/llms.ts', content: 'client.chat.completions.create({})' },
      { path: 'evolution/scripts/lib/oneshotGenerator.ts', content: "supabase.from('llmCallTracking').insert({})" },
    ]);
    expect(v).toHaveLength(0);
  });

  it('does NOT flag test/mock files', () => {
    expect(isExempt('src/lib/services/foo.test.ts')).toBe(true);
    expect(isExempt('src/testing/mocks/openai.ts')).toBe(true);
    expect(isExempt('src/__tests__/integration/foo.ts')).toBe(true);
    expect(isExempt('src/lib/services/foo.ts')).toBe(false);
  });

  it('allowlist contains the chokepoint', () => {
    expect(ALLOWLIST.has('src/lib/services/llms.ts')).toBe(true);
  });

  it('run-evolution-local.ts is NOT allowlisted (routes through callLLM now)', () => {
    // Regression anchor: it was removed from the allowlist when it stopped using a direct-SDK
    // provider (llm_costs_too_low_in_dash_20260623). If a direct bypass is reintroduced there,
    // the guard must flag it.
    expect(ALLOWLIST.has('evolution/scripts/run-evolution-local.ts')).toBe(false);
  });

  it('flags a new direct-SDK pipeline provider file', () => {
    const violations = findViolations([
      { path: 'evolution/scripts/some-new-runner.ts', content: 'await client.chat.completions.create({})' },
    ]);
    expect(violations.some((v) => v.file === 'evolution/scripts/some-new-runner.ts')).toBe(true);
  });
});
