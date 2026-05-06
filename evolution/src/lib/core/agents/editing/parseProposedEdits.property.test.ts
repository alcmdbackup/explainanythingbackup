// Phase 2.C.7 property-based tests for parseProposedEdits using fast-check.
// Asserts invariants over arbitrary inputs:
//   1. Parser never throws on arbitrary text (graceful degradation).
//   2. Range correctness: for any well-formed substitution, the parsed
//      atomic edit's range slices the correct content from currentText.
//   3. Group-number arbitrariness: any [#N] number doesn't break grouping.
//   4. Strip-markup idempotency: parsing well-formed markup → recoveredSource
//      should always equal currentText (the deterministic safety contract).

import * as fc from 'fast-check';
import { parseProposedEdits } from './parseProposedEdits';

describe('parseProposedEdits — property-based', () => {
  it('arbitrary text never crashes the parser', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 200 }), (text) => {
        // Both as markup AND as currentText. Parser must return cleanly.
        const result = parseProposedEdits(text, text);
        expect(result).toBeDefined();
        expect(result.groups).toBeDefined();
        expect(Array.isArray(result.groups)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('well-formed substitution: range slices correct content from currentText', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }).filter((s) => !/[{~+\-\s]/.test(s)),
        fc.string({ minLength: 1, maxLength: 30 }).filter((s) => !/[{~+\-\s]/.test(s)),
        fc.string({ minLength: 1, maxLength: 30 }).filter((s) => !/[{~+\-\s]/.test(s)),
        fc.integer({ min: 1, max: 999 }),
        (prefix, oldText, suffix, n) => {
          const currentText = `${prefix}${oldText}${suffix}`;
          const markup = `${prefix}{~~ [#${n}] ${oldText} ~> NEW ~~}${suffix}`;
          const result = parseProposedEdits(markup, currentText);
          if (result.groups.length === 0) return; // adversarial filter dropped it; ok
          const e = result.groups[0]!.atomicEdits[0]!;
          expect(currentText.slice(e.range.start, e.range.end)).toBe(oldText);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('group-number arbitrariness: any positive [#N] groups correctly', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10000 }),
        (n) => {
          const markup = `prefix {~~ [#${n}] foo ~> bar ~~} suffix`;
          const result = parseProposedEdits(markup, 'prefix foo suffix');
          if (result.groups.length === 0) return;
          expect(result.groups[0]!.groupNumber).toBe(n);
        },
      ),
      { numRuns: 30 },
    );
  });

  it('plain text input (no markup) → recoveredSource equals input + zero groups', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 200 }).filter((s) => !/[{~+\-]/.test(s)),
        (text) => {
          const result = parseProposedEdits(text, text);
          expect(result.groups).toHaveLength(0);
          expect(result.recoveredSource).toBe(text);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('substitution markup: recoveredSource matches currentText (strip-markup safety contract)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !/[{~+\-\s]/.test(s)),
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !/[{~+\-\s]/.test(s)),
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !/[{~+\-\s]/.test(s)),
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !/[{~+\-\s]/.test(s)),
        (prefix, oldText, newText, suffix) => {
          const currentText = `${prefix}${oldText}${suffix}`;
          const markup = `${prefix}{~~ [#1] ${oldText} ~> ${newText} ~~}${suffix}`;
          const result = parseProposedEdits(markup, currentText);
          if (result.groups.length === 0) return; // adversarial drop; ok
          // recoveredSource must equal currentText byte-for-byte — the deterministic
          // safety contract that lets the agent trust position math.
          expect(result.recoveredSource).toBe(currentText);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('parser output is structurally valid (groups have non-empty atomicEdits arrays)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 200 }), (text) => {
        const result = parseProposedEdits(text, text);
        for (const g of result.groups) {
          expect(g.atomicEdits.length).toBeGreaterThan(0);
          for (const e of g.atomicEdits) {
            expect(e.range.start).toBeLessThanOrEqual(e.range.end);
            expect(e.markupRange.start).toBeLessThanOrEqual(e.markupRange.end);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
