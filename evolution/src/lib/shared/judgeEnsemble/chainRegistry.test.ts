// Unit tests for the built-in ensemble chain registry (Phase 4 prod wiring).

import { resolveEnsembleConfig, listEnsembleConfigIds } from './chainRegistry';

describe('chainRegistry', () => {
  it('resolves a built-in id to a chain + aggregation rule', () => {
    const cfg = resolveEnsembleConfig('cheap-escalation-v1');
    expect(cfg).not.toBeNull();
    expect(cfg!.chain.id).toBe('cheap-escalation-v1');
    expect(cfg!.chain.cap).toBe(3);
    expect(cfg!.chain.models.article.length).toBeGreaterThan(0);
    expect(cfg!.chain.models.paragraph.length).toBeGreaterThan(0);
    expect(cfg!.rule.id).toBe('first_decisive');
    expect(cfg!.rule.version).toBe(1);
  });

  it('returns null for an unknown id', () => {
    expect(resolveEnsembleConfig('does-not-exist')).toBeNull();
  });

  it('lists the known ids', () => {
    expect(listEnsembleConfigIds()).toContain('cheap-escalation-v1');
  });
});
