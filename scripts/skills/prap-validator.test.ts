/**
 * @jest-environment node
 */
// Tests for prap-validator.ts — the PRAP minimum-content gate consumed by
// /run_experiment_analysis Step 1. Bypass-prevention is the load-bearing
// property; grep-only would let an empty `## Pre-Registered Analysis Plan`
// header pass the gate.

import { extractPrapBody, validatePrap } from './prap-validator';

describe('extractPrapBody', () => {
  it('returns null when header is absent', () => {
    expect(extractPrapBody('# Plan\n\n## Background\nfoo')).toBeNull();
  });

  it('extracts body between PRAP header and next H2', () => {
    const doc = `# Plan
## Background
ignored
## Pre-Registered Analysis Plan
arms: control vs treatment
threshold: p < 0.05
test: Mann-Whitney one-sided
## Phased Execution Plan
also ignored`;
    const body = extractPrapBody(doc);
    expect(body).toContain('arms: control vs treatment');
    expect(body).toContain('Mann-Whitney');
    expect(body).not.toContain('Phased Execution Plan');
    expect(body).not.toContain('Background');
  });

  it('extracts body to EOF when PRAP is the last section', () => {
    const doc = `## Pre-Registered Analysis Plan\narms\nthreshold\nMann-Whitney`;
    expect(extractPrapBody(doc)).toContain('Mann-Whitney');
  });
});

describe('validatePrap — minimum-content gate', () => {
  it('rejects missing header', () => {
    const r = validatePrap('# Plan\n## Background\nfoo');
    expect(r.valid).toBe(false);
    expect(r.missingMarkers[0]).toMatch(/header/);
  });

  it('rejects empty PRAP section (trivial bypass attempt)', () => {
    const r = validatePrap('## Pre-Registered Analysis Plan\n\n## Next');
    expect(r.valid).toBe(false);
    expect(r.missingMarkers).toContain('arms');
    expect(r.missingMarkers).toContain('threshold');
    expect(r.missingMarkers.some((m) => m.startsWith('named test'))).toBe(true);
  });

  it('rejects PRAP with arms+threshold but no named test', () => {
    const doc = '## Pre-Registered Analysis Plan\narms: A vs B\nthreshold: 0.05\n';
    const r = validatePrap(doc);
    expect(r.valid).toBe(false);
    expect(r.missingMarkers.some((m) => m.startsWith('named test'))).toBe(true);
    expect(r.missingMarkers).not.toContain('arms');
    expect(r.missingMarkers).not.toContain('threshold');
  });

  it('accepts a full PRAP with all 3 markers', () => {
    const doc = `## Pre-Registered Analysis Plan
arms: control vs treatment
threshold: p < 0.10
test: Mann-Whitney one-sided`;
    const r = validatePrap(doc);
    expect(r).toEqual({ valid: true, missingMarkers: [] });
  });

  it('is case-insensitive for named test (e.g. MANN-WHITNEY)', () => {
    const doc = `## Pre-Registered Analysis Plan
arms
threshold
MANN-WHITNEY`;
    expect(validatePrap(doc).valid).toBe(true);
  });

  it('accepts each named test variant', () => {
    const variants = ['Mann-Whitney', 'McNemar', 'Bootstrap', 'Spearman', 'permutation', 'test:'];
    for (const v of variants) {
      const doc = `## Pre-Registered Analysis Plan\narms\nthreshold\n${v}`;
      expect(validatePrap(doc).valid).toBe(true);
    }
  });
});
