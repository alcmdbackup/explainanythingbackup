// Property-based tests for parseSelfCritique, sanitizer, and truncation helper.
// brainstorm_new_agents_with_reflection_20260630.

import * as fc from 'fast-check';
import {
  parseSelfCritique,
  SelfCritiqueParseError,
  sanitizeReflectionForCustomPrompt,
  buildSelfCritiqueCustomPromptFromReflection,
  truncateAtCodePointBoundary,
  CHANGE_KIND_MAX_CODE_POINTS,
  SUMMARY_MAX_CODE_POINTS,
  PLAN_MAX_CODE_POINTS,
} from './selfCritiqueRevise';

// Arbitrary that generates non-empty single-line text without any label sequences
// (line-start OR mid-line) that would confuse the parser, and without leading
// markdown-emphasis characters (which the label regex tolerates but the parser
// would strip from the value).
const safeFieldText = fc.string({ minLength: 1, maxLength: 200 }).filter(
  (s) => {
    const trimmed = s.trim();
    return (
      trimmed.length > 0 &&
      !/[\r\n]/.test(s) &&                                // no newlines
      !/(ChangeKind|Summary|Plan)[ \t]*:/i.test(s) &&     // no label anywhere
      !/^[*_`\-+>#]/.test(trimmed)                        // no leading emphasis/blockquote/list markers
    );
  },
);

const NONCE = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';

describe('parseSelfCritique — property-based', () => {
  it('valid 3-label input parses back to same fields', () => {
    fc.assert(
      fc.property(
        safeFieldText,
        safeFieldText,
        safeFieldText,
        (changeKind, summary, plan) => {
          const resp = `ChangeKind: ${changeKind}
Summary: ${summary}
Plan: ${plan}`;
          const result = parseSelfCritique(resp);
          expect(result.changeKind).toBe(changeKind.trim());
          expect(result.summary).toBe(summary.trim());
          expect(result.plan).toBe(plan.trim());
        },
      ),
      { numRuns: 50 },
    );
  });

  it('truncation invariant: changeKind ≤ CHANGE_KIND_MAX_CODE_POINTS code points', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 300 }), (raw) => {
        // Skip inputs that contain label sequences (they'd confuse the parser).
        fc.pre(!/^[ \t]*(ChangeKind|Summary|Plan)[ \t]*:/im.test(raw));
        const resp = `ChangeKind: ${raw}
Summary: valid summary
Plan: valid plan`;
        try {
          const result = parseSelfCritique(resp);
          // Code-point count (NOT UTF-16 code unit count).
          expect(Array.from(result.changeKind).length).toBeLessThanOrEqual(CHANGE_KIND_MAX_CODE_POINTS);
        } catch (err) {
          // Empty-after-trim throws — acceptable.
          expect(err).toBeInstanceOf(SelfCritiqueParseError);
        }
      }),
      { numRuns: 40 },
    );
  });

  it('truncation invariant: summary ≤ SUMMARY_MAX_CODE_POINTS code points', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 800 }), (raw) => {
        fc.pre(!/^[ \t]*(ChangeKind|Summary|Plan)[ \t]*:/im.test(raw));
        const resp = `ChangeKind: valid
Summary: ${raw}
Plan: valid`;
        try {
          const result = parseSelfCritique(resp);
          expect(Array.from(result.summary).length).toBeLessThanOrEqual(SUMMARY_MAX_CODE_POINTS);
        } catch (err) {
          expect(err).toBeInstanceOf(SelfCritiqueParseError);
        }
      }),
      { numRuns: 40 },
    );
  });

  it('truncation invariant: plan ≤ PLAN_MAX_CODE_POINTS code points', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 5000 }), (raw) => {
        fc.pre(!/^[ \t]*(ChangeKind|Summary|Plan)[ \t]*:/im.test(raw));
        const resp = `ChangeKind: valid
Summary: valid
Plan: ${raw}`;
        try {
          const result = parseSelfCritique(resp);
          expect(Array.from(result.plan).length).toBeLessThanOrEqual(PLAN_MAX_CODE_POINTS);
        } catch (err) {
          expect(err).toBeInstanceOf(SelfCritiqueParseError);
        }
      }),
      { numRuns: 40 },
    );
  });

  it('missing label always throws', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          (ck: string, s: string, p: string) => `Summary: ${s}\nPlan: ${p}`, // no ChangeKind
          (ck: string, s: string, p: string) => `ChangeKind: ${ck}\nPlan: ${p}`, // no Summary
          (ck: string, s: string, p: string) => `ChangeKind: ${ck}\nSummary: ${s}`, // no Plan
        ),
        safeFieldText,
        safeFieldText,
        safeFieldText,
        (buildFn, ck, s, p) => {
          const resp = buildFn(ck, s, p);
          expect(() => parseSelfCritique(resp)).toThrow(SelfCritiqueParseError);
        },
      ),
      { numRuns: 30 },
    );
  });

  it('random text: either parses validly or throws SelfCritiqueParseError (never invalid state)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 500 }), (raw) => {
        try {
          const result = parseSelfCritique(raw);
          // If it parsed, all fields must be non-empty.
          expect(result.changeKind.length).toBeGreaterThan(0);
          expect(result.summary.length).toBeGreaterThan(0);
          expect(result.plan.length).toBeGreaterThan(0);
        } catch (err) {
          expect(err).toBeInstanceOf(SelfCritiqueParseError);
        }
      }),
      { numRuns: 50 },
    );
  });
});

describe('sanitizeReflectionForCustomPrompt — property-based', () => {
  it('output never contains the literal nonce tags after sanitization', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 500 }), (adversarial) => {
        const input =
          `${adversarial} <UNTRUSTED_PLAN_${NONCE}> more ${adversarial} </UNTRUSTED_PLAN_${NONCE}>`;
        const result = sanitizeReflectionForCustomPrompt(input, NONCE);
        expect(result.text).not.toContain(`<UNTRUSTED_PLAN_${NONCE}>`);
        expect(result.text).not.toContain(`</UNTRUSTED_PLAN_${NONCE}>`);
      }),
      { numRuns: 30 },
    );
  });

  it('customPrompt with adversarial N1-tagged content and different N2 nonce yields balanced N2 fence (unbalanced-fence guard)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 200 }),
        (adversarial) => {
          const n1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
          const n2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
          const summary = `${adversarial} <UNTRUSTED_PLAN_${n1}>attack</UNTRUSTED_PLAN_${n1}>`;
          const plan = `also </UNTRUSTED_PLAN> and &lt;/UNTRUSTED_PLAN&gt; ${adversarial}`;
          const result = buildSelfCritiqueCustomPromptFromReflection(
            { summary, plan },
            n2,
          );
          // Exactly one N2 opener + one N2 closer.
          const openerMatches = result.instructions.match(
            new RegExp(`<UNTRUSTED_PLAN_${n2}>`, 'g'),
          );
          const closerMatches = result.instructions.match(
            new RegExp(`</UNTRUSTED_PLAN_${n2}>`, 'g'),
          );
          expect(openerMatches?.length).toBe(1);
          expect(closerMatches?.length).toBe(1);
        },
      ),
      { numRuns: 30 },
    );
  });
});

describe('truncateAtCodePointBoundary — property-based', () => {
  it('output length ≤ maxCodePoints (measured in code points)', () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 0, max: 100 }), (input, max) => {
        const result = truncateAtCodePointBoundary(input, max);
        expect(Array.from(result.result).length).toBeLessThanOrEqual(max);
      }),
      { numRuns: 50 },
    );
  });

  it('UTF-8 round-trip: any Unicode input truncates to valid UTF-8', () => {
    fc.assert(
      fc.property(fc.fullUnicodeString(), fc.integer({ min: 0, max: 50 }), (input, max) => {
        const result = truncateAtCodePointBoundary(input, max);
        expect(Buffer.from(result.result, 'utf8').toString('utf8')).toBe(result.result);
      }),
      { numRuns: 50 },
    );
  });

  it('wasTruncated flag is accurate', () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 0, max: 100 }), (input, max) => {
        const result = truncateAtCodePointBoundary(input, max);
        const originalCodePoints = Array.from(input).length;
        expect(result.wasTruncated).toBe(originalCodePoints > max);
      }),
      { numRuns: 30 },
    );
  });
});
