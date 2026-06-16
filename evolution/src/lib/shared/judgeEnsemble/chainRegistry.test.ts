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

  it('resolves the gemini tie-breaker config (gemini lead → gpt-4o-mini [→ deepseek-v4-pro])', () => {
    const cfg = resolveEnsembleConfig('gemini-tiebreak-v1');
    expect(cfg).not.toBeNull();
    // gemini-2.5-flash-lite leads both modes (the incumbent judge); gpt-4o-mini is the partner.
    expect(cfg!.chain.models.article).toEqual(['google/gemini-2.5-flash-lite', 'gpt-4o-mini']);
    expect(cfg!.chain.models.paragraph).toEqual(['google/gemini-2.5-flash-lite', 'gpt-4o-mini', 'deepseek-v4-pro']);
    expect(cfg!.rule.id).toBe('first_decisive');
  });

  it('returns null for an unknown id', () => {
    expect(resolveEnsembleConfig('does-not-exist')).toBeNull();
  });

  it('lists the known ids', () => {
    expect(listEnsembleConfigIds()).toEqual(expect.arrayContaining(['cheap-escalation-v1', 'gemini-tiebreak-v1']));
  });
});
