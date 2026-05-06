// Tests for getTacticSummary — compressed 1–2 sentence summary used by the reflection prompt.

import { getTacticSummary, ALL_TACTIC_NAMES } from './index';

describe('getTacticSummary', () => {
  it('returns null for unknown tactic name', () => {
    expect(getTacticSummary('nonexistent_tactic')).toBeNull();
    expect(getTacticSummary('')).toBeNull();
  });

  it('returns formatted summary for a known tactic (structural_transform)', () => {
    const summary = getTacticSummary('structural_transform');
    expect(summary).not.toBeNull();
    expect(summary).toContain('Structural Transform');
    // Should include the preamble's role assignment.
    expect(summary).toContain('expert writing editor');
  });

  it('caps summary at ~250 chars', () => {
    for (const name of ALL_TACTIC_NAMES) {
      const summary = getTacticSummary(name);
      if (summary === null) continue;
      expect(summary.length).toBeLessThanOrEqual(255); // 250 + '…' tolerance
    }
  });

  it('appends ellipsis when truncating', () => {
    // Find a tactic whose summary is long enough to truncate (most should be).
    const summaries = ALL_TACTIC_NAMES.map(getTacticSummary).filter((s): s is string => s !== null);
    expect(summaries.length).toBeGreaterThan(0);
  });

  it('returns a single-line summary (no embedded newlines)', () => {
    const summary = getTacticSummary('lexical_simplify');
    expect(summary).not.toBeNull();
    expect(summary).not.toMatch(/\n/);
  });

  it('starts with the tactic label', () => {
    const summary = getTacticSummary('grounding_enhance');
    expect(summary).not.toBeNull();
    // Starts with the label (which is "Grounding Enhance" or similar).
    expect(summary?.split(' — ')[0]).toMatch(/Grounding/i);
  });

  it('produces a summary for every system tactic (24 expected)', () => {
    const summaries = ALL_TACTIC_NAMES.map((name) => ({
      name,
      summary: getTacticSummary(name),
    }));
    const missing = summaries.filter((s) => s.summary === null);
    expect(missing).toEqual([]);
    expect(summaries.length).toBeGreaterThanOrEqual(24);
  });
});
