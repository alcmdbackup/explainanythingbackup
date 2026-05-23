import { checkProposerDrift } from './checkProposerDrift';

describe('checkProposerDrift', () => {
  it('returns drift: false when recoveredSource matches currentText exactly', () => {
    expect(checkProposerDrift('Hello world.', 'Hello world.')).toEqual({ drift: false });
  });

  it('tolerates collapsed whitespace runs', () => {
    expect(checkProposerDrift('Hello   world.', 'Hello world.').drift).toBe(false);
  });

  it('tolerates mixed CRLF / LF line endings', () => {
    expect(checkProposerDrift('a\r\nb', 'a\nb').drift).toBe(false);
  });

  it('detects single-character text drift', () => {
    const r = checkProposerDrift('Hello world.', 'Hello world!');
    expect(r.drift).toBe(true);
    if (r.drift) expect(typeof r.firstDiffOffset).toBe('number');
  });

  it('detects insertion outside markup', () => {
    const r = checkProposerDrift('Hello darling world.', 'Hello world.');
    expect(r.drift).toBe(true);
  });

  it('detects deletion outside markup', () => {
    const r = checkProposerDrift('Hello.', 'Hello world.');
    expect(r.drift).toBe(true);
  });

  it('reports a regions array on drift', () => {
    const r = checkProposerDrift('xy', 'ab');
    expect(r.drift).toBe(true);
    if (r.drift) {
      expect(r.regions.length).toBeGreaterThanOrEqual(1);
      expect(typeof r.regions[0]!.offset).toBe('number');
      expect(typeof r.regions[0]!.driftedText).toBe('string');
    }
  });

  it('handles empty inputs', () => {
    expect(checkProposerDrift('', '').drift).toBe(false);
    expect(checkProposerDrift('a', '').drift).toBe(true);
    expect(checkProposerDrift('', 'a').drift).toBe(true);
  });

  it('tolerates leading/trailing whitespace differences within a line', () => {
    expect(checkProposerDrift('a\n  b\n', 'a\nb\n').drift).toBe(false);
  });

  it('reports a sample window around the first diff', () => {
    const r = checkProposerDrift('aaaXbbb', 'aaaYbbb');
    expect(r.drift).toBe(true);
    if (r.drift) expect(r.sample.length).toBeGreaterThan(0);
  });

  it('region.driftedText covers the entire mismatched suffix (no 200-char cap)', () => {
    // Drift starts late in a long article — driftedText must include the full
    // remaining suffix so snapDriftToSource patches the whole drift, not just
    // the first 200 chars.
    const prefix = 'a'.repeat(900);
    const aSuffix = 'X'.repeat(400);
    const bSuffix = 'Y'.repeat(400);
    const r = checkProposerDrift(prefix + aSuffix, prefix + bSuffix);
    expect(r.drift).toBe(true);
    if (r.drift) {
      expect(r.regions[0]!.offset).toBe(900);
      expect(r.regions[0]!.driftedText.length).toBe(400);
    }
  });

  it('uses RAW offsets (matches recoveredSource indexing) so snap can splice currentText.slice at the same offset', () => {
    // After my fix, offset is computed against raw strings, not normalized.
    // So a region at offset 5 in the raw recoveredSource maps to position 5
    // in currentText for splicing purposes.
    const r = checkProposerDrift('hello WRONG', 'hello right');
    expect(r.drift).toBe(true);
    if (r.drift) expect(r.regions[0]!.offset).toBe(6);
  });
});
