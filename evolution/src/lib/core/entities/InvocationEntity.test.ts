// Tests for the LEGACY_AGENT_NAME_ALIASES URL-alias backward-compat layer.
// Per Phase 6.1.1a fix (Decisions §5 + Round 3 review pass-2 T9): user-saved
// URLs with the V1 ?agentName=iterativeEditing must continue to match the
// renamed iterative_editing rows after the V2 rename.

import { LEGACY_AGENT_NAME_ALIASES, normalizeLegacyAgentName } from './InvocationEntity';

describe('LEGACY_AGENT_NAME_ALIASES', () => {
  it('contains the iterativeEditing → iterative_editing rename', () => {
    expect(LEGACY_AGENT_NAME_ALIASES.iterativeEditing).toBe('iterative_editing');
  });

  it('the map values are V2 canonical names (snake_case, no Agent suffix)', () => {
    for (const canonical of Object.values(LEGACY_AGENT_NAME_ALIASES)) {
      expect(canonical).toMatch(/^[a-z_]+$/);
      expect(canonical).not.toMatch(/Agent$/i);
    }
  });
});

describe('normalizeLegacyAgentName', () => {
  it('rewrites iterativeEditing → iterative_editing', () => {
    expect(normalizeLegacyAgentName('iterativeEditing')).toBe('iterative_editing');
  });

  it('passes through canonical names unchanged', () => {
    expect(normalizeLegacyAgentName('iterative_editing')).toBe('iterative_editing');
    expect(normalizeLegacyAgentName('generation')).toBe('generation');
    expect(normalizeLegacyAgentName('reflection')).toBe('reflection');
  });

  it('passes through unknown values unchanged (defensive)', () => {
    expect(normalizeLegacyAgentName('not_a_real_agent')).toBe('not_a_real_agent');
    expect(normalizeLegacyAgentName('')).toBe('');
  });

  it('legacy and canonical names resolve to the same SQL filter target', () => {
    // The whole point: ?agentName=iterativeEditing and ?agentName=iterative_editing
    // must produce identical query results post-rename.
    expect(normalizeLegacyAgentName('iterativeEditing')).toBe(normalizeLegacyAgentName('iterative_editing'));
  });
});
