// Unit tests for verdict orientation + canonical pair helpers.

import {
  canonicalizePair,
  flipPairVerdict,
  orientToCanonical,
  signToVerdict,
  verdictToSign,
} from './verdicts';
import type { Verdict3 } from './types';

describe('flipPairVerdict', () => {
  it('swaps a<->b and leaves tie', () => {
    expect(flipPairVerdict('a')).toBe('b');
    expect(flipPairVerdict('b')).toBe('a');
    expect(flipPairVerdict('tie')).toBe('tie');
  });
  it('is an involution', () => {
    for (const v of ['a', 'b', 'tie'] as Verdict3[]) {
      expect(flipPairVerdict(flipPairVerdict(v))).toBe(v);
    }
  });
});

describe('orientToCanonical', () => {
  it('flips only when shown swapped (round-trips to same canonical verdict)', () => {
    // Reviewer saw canonical-B on the left and picked the left one ('a' on-screen).
    // Canonical-oriented that means canonical-B won -> 'b'.
    expect(orientToCanonical('a', true)).toBe('b');
    expect(orientToCanonical('a', false)).toBe('a');
    // Same underlying preference reaches the same canonical verdict regardless of layout:
    const swappedSave = orientToCanonical('a', true); // saw B-left, picked left
    const normalSave = orientToCanonical('b', false); // saw A-left, picked right (B)
    expect(swappedSave).toBe(normalSave);
  });
});

describe('canonicalizePair', () => {
  it('puts the smaller id first and reports swapped', () => {
    expect(canonicalizePair('aaa', 'bbb')).toEqual({ aId: 'aaa', bId: 'bbb', shownSwapped: false });
    expect(canonicalizePair('bbb', 'aaa')).toEqual({ aId: 'aaa', bId: 'bbb', shownSwapped: true });
  });
  it('throws on identical ids', () => {
    expect(() => canonicalizePair('x', 'x')).toThrow();
  });
});

describe('sign helpers', () => {
  it('round-trips verdict <-> sign for decisive verdicts', () => {
    expect(verdictToSign('a')).toBe(1);
    expect(verdictToSign('b')).toBe(-1);
    expect(verdictToSign('tie')).toBe(0);
    expect(signToVerdict(2)).toBe('a');
    expect(signToVerdict(-2)).toBe('b');
    expect(signToVerdict(0)).toBe('tie');
  });
});
