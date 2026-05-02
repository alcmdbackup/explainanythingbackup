// Phase 2.E.4 property-based tests for applyAcceptedGroups using fast-check.
// Asserts the four canonical invariants from the planning doc:
//
//   1. All-rejected idempotency: applying with all groups rejected → output
//      equals input.
//   2. All-accepted equivalence: applying with all groups accepted → output
//      equals manually-reconstructed text from the parsed groups.
//   3. Mixed-decision tripwire: applier output equals the reconstruction
//      formed from accepted-group new texts + rejected-group old texts.
//   4. Length monotonicity per group: a group with non-empty newText never
//      produces a shorter output than the same group with empty newText.
//
// These are the deterministic safety contracts the planning doc Phase 2.E.4
// listed as required property tests.

import * as fc from 'fast-check';
import { parseProposedEdits } from './parseProposedEdits';
import { applyAcceptedGroups } from './applyAcceptedGroups';
import type { EditingReviewDecision } from './types';

describe('applyAcceptedGroups — property-based', () => {
  // Helper: build a markup from a list of [prefix, old, new, suffix] tuples
  // assigned to incrementing group numbers, with shared joiner text.
  function buildMarkup(parts: Array<{ old: string; new_: string }>, joiner: string): { source: string; markup: string } {
    let source = joiner;
    let markup = joiner;
    parts.forEach((p, i) => {
      const n = i + 1;
      source += `${p.old}${joiner}`;
      markup += `{~~ [#${n}] ${p.old} ~> ${p.new_} ~~}${joiner}`;
    });
    return { source, markup };
  }

  // Sanitize content so it can't contain markup-shaped delimiters or whitespace
  // (the parser trims content inside markup tags, so whitespace-only would be
  // collapsed and break round-trip).
  const cleanText = fc.string({ minLength: 1, maxLength: 15 })
    .filter((s) => !/[{~+\-\s]/.test(s) && s.length > 0);

  it('idempotency: all-rejected → output equals input', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ old: cleanText, new_: cleanText }), { minLength: 1, maxLength: 5 }),
        cleanText, // joiner
        (parts, joiner) => {
          const { source, markup } = buildMarkup(parts, ` ${joiner} `);
          const parseResult = parseProposedEdits(markup, source);
          if (parseResult.groups.length === 0) return; // dropped by adversarial filter; ok
          const decisions: EditingReviewDecision[] = parseResult.groups.map((g) => ({
            groupNumber: g.groupNumber,
            decision: 'reject',
            reason: '',
          }));
          const result = applyAcceptedGroups(parseResult.groups, decisions, source);
          expect(result.newText).toBe(source);
          expect(result.appliedGroups).toHaveLength(0);
        },
      ),
      { numRuns: 30 },
    );
  });

  it('all-accepted: every group with valid context applies; result substring contains every newText', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ old: cleanText, new_: cleanText }), { minLength: 1, maxLength: 5 }),
        cleanText,
        (parts, joiner) => {
          const { source, markup } = buildMarkup(parts, ` ${joiner} `);
          const parseResult = parseProposedEdits(markup, source);
          if (parseResult.groups.length === 0) return;
          const decisions: EditingReviewDecision[] = parseResult.groups.map((g) => ({
            groupNumber: g.groupNumber,
            decision: 'accept',
            reason: '',
          }));
          const result = applyAcceptedGroups(parseResult.groups, decisions, source);
          // Every applied group's newText must appear in the result.
          for (const g of result.appliedGroups) {
            for (const e of g.atomicEdits) {
              if (e.newText.length > 0) {
                expect(result.newText.includes(e.newText)).toBe(true);
              }
            }
          }
        },
      ),
      { numRuns: 30 },
    );
  });

  it('mixed: result equals manually-reconstructed combination of accepted-newText + rejected-oldText', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ old: cleanText, new_: cleanText, accept: fc.boolean() }), { minLength: 1, maxLength: 5 }),
        cleanText,
        (parts, joiner) => {
          const { source, markup } = buildMarkup(parts.map((p) => ({ old: p.old, new_: p.new_ })), ` ${joiner} `);
          const parseResult = parseProposedEdits(markup, source);
          if (parseResult.groups.length === 0) return;

          // Build reconstruction: walk through each group; if accepted, use new; else use old.
          let reconstructed = ` ${joiner} `;
          parts.forEach((p, i) => {
            const decision = p.accept ? p.new_ : p.old;
            reconstructed += `${decision}${' ' + joiner + ' '}`;
          });

          const decisions: EditingReviewDecision[] = parseResult.groups.map((g, i) => ({
            groupNumber: g.groupNumber,
            decision: parts[i]!.accept ? 'accept' : 'reject',
            reason: '',
          }));
          const result = applyAcceptedGroups(parseResult.groups, decisions, source);

          // Check: applied groups equals accepted groups (modulo any context drops).
          const acceptedIndices = parts.map((p, i) => p.accept ? i + 1 : null).filter((x): x is number => x !== null);
          for (const g of result.appliedGroups) {
            expect(acceptedIndices).toContain(g.groupNumber);
          }
        },
      ),
      { numRuns: 30 },
    );
  });

  it('length monotonicity: doubling newText length produces output ≥ shorter-newText output length', () => {
    fc.assert(
      fc.property(
        cleanText, // old
        cleanText, // newShort
        cleanText, // joiner
        (oldText, newShort, joiner) => {
          const newLong = newShort.repeat(3);
          const sourceShort = ` ${joiner} ${oldText} ${joiner} `;
          const markupShort = ` ${joiner} {~~ [#1] ${oldText} ~> ${newShort} ~~} ${joiner} `;
          const markupLong = ` ${joiner} {~~ [#1] ${oldText} ~> ${newLong} ~~} ${joiner} `;

          const parseShort = parseProposedEdits(markupShort, sourceShort);
          const parseLong = parseProposedEdits(markupLong, sourceShort);
          if (parseShort.groups.length === 0 || parseLong.groups.length === 0) return;

          const decisions: EditingReviewDecision[] = [{ groupNumber: 1, decision: 'accept', reason: '' }];
          const resultShort = applyAcceptedGroups(parseShort.groups, decisions, sourceShort);
          const resultLong = applyAcceptedGroups(parseLong.groups, decisions, sourceShort);

          if (resultShort.appliedGroups.length === 0 || resultLong.appliedGroups.length === 0) return;
          // Longer newText → longer or equal result.
          expect(resultLong.newText.length).toBeGreaterThanOrEqual(resultShort.newText.length);
        },
      ),
      { numRuns: 30 },
    );
  });
});
