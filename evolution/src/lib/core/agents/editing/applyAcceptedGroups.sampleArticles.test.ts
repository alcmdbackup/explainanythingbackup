// Phase 2.E.5 sample-article golden-master test for the applier. Drives the
// parser + applier across realistic-content fixtures and verifies the
// invariants the planning doc calls out:
//   - all-rejected → output equals input (idempotency)
//   - all-accepted → output equals expectedNewText
//   - mixed → output equals expectedNewText with rejected groups preserved as oldText

import { parseProposedEdits } from './parseProposedEdits';
import { applyAcceptedGroups } from './applyAcceptedGroups';
import { SAMPLE_SCENARIOS } from './__fixtures__/sample-articles';
import type { EditingReviewDecision } from './types';

describe('applyAcceptedGroups — sample articles', () => {
  for (const scenario of SAMPLE_SCENARIOS) {
    const tag = `${scenario.name}/${scenario.subtype}`;

    it(`${tag}: applier produces expectedNewText`, () => {
      const parseResult = parseProposedEdits(scenario.proposedMarkup, scenario.original);
      const decisions: EditingReviewDecision[] = [
        ...scenario.acceptGroups.map((n) => ({ groupNumber: n, decision: 'accept' as const, reason: '' })),
        ...scenario.rejectGroups.map((n) => ({ groupNumber: n, decision: 'reject' as const, reason: '' })),
      ];
      const result = applyAcceptedGroups(parseResult.groups, decisions, scenario.original);
      expect(result.newText).toBe(scenario.expectedNewText);
    });

    if (scenario.subtype === 'allAccept') {
      it(`${tag}: applier reports all groups applied`, () => {
        const parseResult = parseProposedEdits(scenario.proposedMarkup, scenario.original);
        const decisions: EditingReviewDecision[] = scenario.acceptGroups.map((n) => ({
          groupNumber: n, decision: 'accept', reason: '',
        }));
        const result = applyAcceptedGroups(parseResult.groups, decisions, scenario.original);
        expect(result.appliedGroups.length).toBe(scenario.acceptGroups.length);
      });
    }
  }

  it('all-rejected idempotency holds across all scenarios', () => {
    for (const scenario of SAMPLE_SCENARIOS) {
      const parseResult = parseProposedEdits(scenario.proposedMarkup, scenario.original);
      // Build decisions list from ALL groups in the proposer output, marking each rejected.
      const allGroupNumbers = parseResult.groups.map((g) => g.groupNumber);
      const decisions: EditingReviewDecision[] = allGroupNumbers.map((n) => ({
        groupNumber: n, decision: 'reject', reason: '',
      }));
      const result = applyAcceptedGroups(parseResult.groups, decisions, scenario.original);
      expect(result.newText).toBe(scenario.original);
    }
  });

  it('parser strip-markup matches source byte-for-byte for every scenario', () => {
    // The deterministic safety contract — the parser's recoveredSource (markup
    // stripped) must equal the original source for every well-formed scenario.
    for (const scenario of SAMPLE_SCENARIOS) {
      const parseResult = parseProposedEdits(scenario.proposedMarkup, scenario.original);
      expect(parseResult.recoveredSource).toBe(scenario.original);
    }
  });
});
