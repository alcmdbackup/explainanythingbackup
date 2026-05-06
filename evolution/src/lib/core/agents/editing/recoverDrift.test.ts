// Tests for the drift-recovery LLM helper. Mocks the LLM call deterministically
// so we can verify magnitude classification, JSONL parsing, and patch
// application without booting a real provider.

import { classifyDriftMagnitude, recoverDrift } from './recoverDrift';
import type { EditingDriftRegion, EditingGroup } from './types';

function region(offset: number, drifted: string): EditingDriftRegion {
  return { offset, driftedText: drifted };
}

function group(n: number, atomicEdits: EditingGroup['atomicEdits']): EditingGroup {
  return { groupNumber: n, atomicEdits };
}

describe('classifyDriftMagnitude', () => {
  it('returns minor for small drift with no markup overlap', () => {
    expect(classifyDriftMagnitude([region(10, 'x')], [])).toBe('minor');
  });

  it('returns major when more than 3 regions', () => {
    const regions = [region(0, 'a'), region(10, 'b'), region(20, 'c'), region(30, 'd')];
    expect(classifyDriftMagnitude(regions, [])).toBe('major');
  });

  it('returns major when total drifted chars > 200', () => {
    const big = 'x'.repeat(201);
    expect(classifyDriftMagnitude([region(0, big)], [])).toBe('major');
  });

  it('returns major when a region overlaps any markupRange', () => {
    const groups = [group(1, [{
      groupNumber: 1, kind: 'replace',
      range: { start: 0, end: 0 }, markupRange: { start: 5, end: 20 },
      oldText: '', newText: '', contextBefore: '', contextAfter: '',
    }])];
    expect(classifyDriftMagnitude([region(10, 'inside')], groups)).toBe('major');
  });

  it('boundary: exactly 3 regions, 200 chars, no overlap → minor', () => {
    const regions = [region(0, 'a'.repeat(100)), region(50, 'b'.repeat(50)), region(100, 'c'.repeat(50))];
    expect(classifyDriftMagnitude(regions, [])).toBe('minor');
  });
});

describe('recoverDrift', () => {
  function deps(opts: {
    response: string;
    env?: Record<string, string | undefined>;
    cost?: number;
  }) {
    return {
      callLlm: jest.fn(async () => opts.response),
      measureCost: () => opts.cost ?? 0.001,
      env: opts.env ?? {},
    };
  }

  it('returns skipped_major_drift when EVOLUTION_DRIFT_RECOVERY_ENABLED=false', async () => {
    const r = await recoverDrift({
      regions: [region(0, 'x')],
      proposedMarkup: 'foo',
      currentText: 'foo',
      groups: [],
      deps: deps({ response: '', env: { EVOLUTION_DRIFT_RECOVERY_ENABLED: 'false' } }),
    });
    expect(r.outcome).toBe('skipped_major_drift');
    expect(r.costUsd).toBe(0);
  });

  it('returns skipped_major_drift when classifier says major', async () => {
    const r = await recoverDrift({
      regions: Array.from({ length: 5 }, (_, i) => region(i * 10, 'x')),
      proposedMarkup: 'foo',
      currentText: 'foo',
      groups: [],
      deps: deps({ response: '' }),
    });
    expect(r.outcome).toBe('skipped_major_drift');
  });

  it('classifies as recovered + applies benign patches in reverse-offset order', async () => {
    const proposed = 'aaa“bb”ccc'; // smart quotes drifted
    const current = 'aaa"bb"ccc'; // straight quotes
    const response = JSON.stringify({ offset: 3, classification: 'benign', patch: '"' }) + '\n'
                   + JSON.stringify({ offset: 6, classification: 'benign', patch: '"' });
    const r = await recoverDrift({
      regions: [region(3, '“'), region(6, '”')],
      proposedMarkup: proposed,
      currentText: current,
      groups: [],
      deps: deps({ response }),
    });
    expect(r.outcome).toBe('recovered');
    expect(r.patchedMarkup).toBeDefined();
  });

  it('returns unrecoverable_intentional when any region is classified intentional', async () => {
    const response = JSON.stringify({ offset: 3, classification: 'benign', patch: ' ' }) + '\n'
                   + JSON.stringify({ offset: 6, classification: 'intentional' });
    const r = await recoverDrift({
      regions: [region(3, 'a'), region(6, 'b')],
      proposedMarkup: 'xxxxxxxxxx',
      currentText: 'xxxxxxxxxx',
      groups: [],
      deps: deps({ response }),
    });
    expect(r.outcome).toBe('unrecoverable_intentional');
    expect(r.classifications?.some((c) => c.classification === 'intentional')).toBe(true);
  });

  it('defaults missing classifications to intentional (conservative)', async () => {
    // Empty response — no JSONL lines parsed.
    const r = await recoverDrift({
      regions: [region(3, 'a')],
      proposedMarkup: 'xxxxx',
      currentText: 'xxxxx',
      groups: [],
      deps: deps({ response: '' }),
    });
    expect(r.outcome).toBe('unrecoverable_intentional');
  });

  it('skips malformed JSONL lines', async () => {
    const response = 'not json\n' + JSON.stringify({ offset: 3, classification: 'benign', patch: 'x' });
    const r = await recoverDrift({
      regions: [region(3, 'a')],
      proposedMarkup: 'xxxxx',
      currentText: 'xxxxx',
      groups: [],
      deps: deps({ response }),
    });
    // The benign patch on offset 3 was parsed successfully → recovered.
    expect(r.outcome).toBe('recovered');
  });

  it('reports the recovery LLM call cost via measureCost', async () => {
    const r = await recoverDrift({
      regions: [region(3, 'a')],
      proposedMarkup: 'xxxxx',
      currentText: 'xxxxx',
      groups: [],
      deps: deps({ response: '', cost: 0.0042 }),
    });
    expect(r.costUsd).toBe(0.0042);
  });
});
