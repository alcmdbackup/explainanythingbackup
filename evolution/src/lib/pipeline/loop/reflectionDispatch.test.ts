// Unit tests for resolveReflectionEnabled — the pure helper that drives the
// orchestrator's per-iteration reflection-dispatch decision. Companion to the
// end-to-end coverage in evolution-reflection-agent.integration.test.ts; this
// suite asserts the AND-gate truth table without booting evolveArticle.

import { resolveReflectionEnabled } from './reflectionDispatch';

describe('resolveReflectionEnabled', () => {
  it('returns true when agentType=reflect_and_generate and env unset', () => {
    expect(resolveReflectionEnabled(
      { agentType: 'reflect_and_generate' },
      {},
    )).toBe(true);
  });

  it('returns true when agentType=reflect_and_generate and env=true', () => {
    expect(resolveReflectionEnabled(
      { agentType: 'reflect_and_generate' },
      { EVOLUTION_REFLECTION_ENABLED: 'true' },
    )).toBe(true);
  });

  it('returns true for any non-"false" env value (string-contract)', () => {
    // Mirrors EVOLUTION_TOPUP_ENABLED's exact-match `!== 'false'` semantics —
    // typos / unset / any other value all keep the feature ON.
    for (const env of ['', '1', 'no', 'False', 'FALSE', 'disabled', 'truthy']) {
      expect(resolveReflectionEnabled(
        { agentType: 'reflect_and_generate' },
        { EVOLUTION_REFLECTION_ENABLED: env },
      )).toBe(true);
    }
  });

  it('kill-switch: env=false falls reflect_and_generate back to vanilla GFPA dispatch', () => {
    expect(resolveReflectionEnabled(
      { agentType: 'reflect_and_generate' },
      { EVOLUTION_REFLECTION_ENABLED: 'false' },
    )).toBe(false);
  });

  it('returns false for agentType=generate regardless of env', () => {
    expect(resolveReflectionEnabled(
      { agentType: 'generate' },
      {},
    )).toBe(false);
    expect(resolveReflectionEnabled(
      { agentType: 'generate' },
      { EVOLUTION_REFLECTION_ENABLED: 'true' },
    )).toBe(false);
    expect(resolveReflectionEnabled(
      { agentType: 'generate' },
      { EVOLUTION_REFLECTION_ENABLED: 'false' },
    )).toBe(false);
  });

  it('returns false for agentType=swiss regardless of env', () => {
    expect(resolveReflectionEnabled(
      { agentType: 'swiss' },
      {},
    )).toBe(false);
    expect(resolveReflectionEnabled(
      { agentType: 'swiss' },
      { EVOLUTION_REFLECTION_ENABLED: 'true' },
    )).toBe(false);
  });
});
