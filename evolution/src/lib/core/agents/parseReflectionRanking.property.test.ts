// Property-based tests for parseReflectionRanking — fast-check generators exercise
// random tactic permutations, mixed casing, surrounding whitespace, reasoning-line
// variations, and shuffled rank ordering. Companion to the example-based suite in
// reflectAndGenerateFromPreviousArticle.test.ts.

import * as fc from 'fast-check';
import {
  parseReflectionRanking,
  ReflectionParseError,
} from './reflectAndGenerateFromPreviousArticle';
import { ALL_TACTIC_NAMES } from '../tactics';

const tacticArb = fc.constantFrom(...ALL_TACTIC_NAMES);

/** Round-trip: any well-formed serialization of a tactic list parses back to the same names. */
function serialize(
  tactics: string[],
  opts: { caseTransform: (s: string) => string; reasoningPrefix: string },
): string {
  return tactics
    .map((t, i) => `${i + 1}. Tactic: ${opts.caseTransform(t)}\n   ${opts.reasoningPrefix}: arbitrary reasoning text for ${t}`)
    .join('\n\n');
}

describe('parseReflectionRanking — property-based', () => {
  it('round-trip: a serialized ranking always parses back to the same tactic names', () => {
    fc.assert(
      fc.property(
        fc.array(tacticArb, { minLength: 1, maxLength: 10 }).map((arr) => Array.from(new Set(arr))),
        fc.constantFrom(
          (s: string) => s,
          (s: string) => s.toUpperCase(),
          (s: string) => s[0]!.toUpperCase() + s.slice(1),
          (s: string) => s.split('_').map((w) => w[0]!.toUpperCase() + w.slice(1)).join('_'),
        ),
        fc.constantFrom('Reasoning', 'reasoning', 'Why', 'Justification'),
        (tactics, caseTransform, reasoningPrefix) => {
          const text = serialize(tactics, { caseTransform, reasoningPrefix });
          const result = parseReflectionRanking(text);
          // Parser normalizes to lowercase + underscore; the round-trip recovers the
          // canonical names regardless of casing in the input.
          expect(result.map((r) => r.tactic).sort()).toEqual([...tactics].sort());
        },
      ),
      { numRuns: 50 },
    );
  });

  it('parser only returns names that pass the validator (drops unknowns)', () => {
    fc.assert(
      fc.property(
        fc.array(tacticArb, { minLength: 1, maxLength: 12 }).map((arr) => Array.from(new Set(arr))),
        (tactics) => {
          const text = serialize(tactics, {
            caseTransform: (s) => s,
            reasoningPrefix: 'Reasoning',
          });
          const result = parseReflectionRanking(text);
          // Every returned tactic must be in the canonical name list.
          for (const r of result) {
            expect(ALL_TACTIC_NAMES).toContain(r.tactic);
          }
        },
      ),
      { numRuns: 30 },
    );
  });

  it('unknown-name resilience: garbage interleaved with valid names always extracts the valid ones', () => {
    fc.assert(
      fc.property(
        fc.array(tacticArb, { minLength: 1, maxLength: 5 }).map((arr) => Array.from(new Set(arr))),
        fc.array(fc.string({ minLength: 3, maxLength: 20 }).filter(
          (s) => !ALL_TACTIC_NAMES.includes(s.toLowerCase()) && /^[a-zA-Z_]+$/.test(s),
        ), { minLength: 0, maxLength: 5 }),
        (validTactics, garbage) => {
          // Interleave valid + garbage names in a numbered list.
          const all = [...validTactics, ...garbage];
          const text = all
            .map((t, i) => `${i + 1}. Tactic: ${t}\n   Reasoning: text`)
            .join('\n\n');
          const result = parseReflectionRanking(text);
          // Every valid tactic that appeared shows up in result; every result is valid.
          const resultNames = new Set(result.map((r) => r.tactic));
          for (const valid of validTactics) {
            expect(resultNames.has(valid)).toBe(true);
          }
          for (const r of result) {
            expect(ALL_TACTIC_NAMES).toContain(r.tactic);
          }
        },
      ),
      { numRuns: 30 },
    );
  });

  it('all-garbage input: throws ReflectionParseError', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 3, maxLength: 15 }).filter(
          (s) => !ALL_TACTIC_NAMES.includes(s.toLowerCase()) && /^[a-zA-Z_]+$/.test(s),
        ), { minLength: 1, maxLength: 4 }),
        (garbage) => {
          const text = garbage
            .map((g, i) => `${i + 1}. Tactic: ${g}\n   Reasoning: text`)
            .join('\n\n');
          expect(() => parseReflectionRanking(text)).toThrow(ReflectionParseError);
        },
      ),
      { numRuns: 20 },
    );
  });
});
