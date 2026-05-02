// Core applier tests — covers the all-rejected idempotency invariant, accepted
// edits applied right-to-left (positions don't shift), context-failsafe
// mismatch drops the group.

import { applyAcceptedGroups } from './applyAcceptedGroups';
import type { EditingGroup, EditingReviewDecision } from './types';

function group(n: number, edits: EditingGroup['atomicEdits']): EditingGroup {
  return { groupNumber: n, atomicEdits: edits };
}

describe('applyAcceptedGroups', () => {
  it('all-rejected → output equals input (idempotency)', () => {
    const source = 'Hello world.';
    const groups = [group(1, [{
      groupNumber: 1, kind: 'replace',
      range: { start: 6, end: 11 }, markupRange: { start: 0, end: 0 },
      oldText: 'world', newText: 'Earth',
      contextBefore: 'Hello ', contextAfter: '.',
    }])];
    const decisions: EditingReviewDecision[] = [{ groupNumber: 1, decision: 'reject', reason: 'no' }];
    const r = applyAcceptedGroups(groups, decisions, source);
    expect(r.newText).toBe(source);
    expect(r.appliedGroups).toHaveLength(0);
  });

  it('accepted edit applied correctly', () => {
    const source = 'Hello world.';
    const groups = [group(1, [{
      groupNumber: 1, kind: 'replace',
      range: { start: 6, end: 11 }, markupRange: { start: 0, end: 0 },
      oldText: 'world', newText: 'Earth',
      contextBefore: 'Hello ', contextAfter: '.',
    }])];
    const decisions: EditingReviewDecision[] = [{ groupNumber: 1, decision: 'accept', reason: 'good' }];
    const r = applyAcceptedGroups(groups, decisions, source);
    expect(r.newText).toBe('Hello Earth.');
    expect(r.appliedGroups).toHaveLength(1);
  });

  it('context-mismatch → drops the group', () => {
    const source = 'Hello world.';
    const groups = [group(1, [{
      groupNumber: 1, kind: 'replace',
      range: { start: 6, end: 11 }, markupRange: { start: 0, end: 0 },
      oldText: 'world', newText: 'Earth',
      contextBefore: 'WRONG ', contextAfter: '.', // mismatched contextBefore
    }])];
    const decisions: EditingReviewDecision[] = [{ groupNumber: 1, decision: 'accept', reason: 'good' }];
    const r = applyAcceptedGroups(groups, decisions, source);
    expect(r.newText).toBe(source);
    expect(r.droppedPostApprover).toHaveLength(1);
    expect(r.droppedPostApprover[0]!.reason).toBe('context_mismatch');
  });

  it('multiple accepted edits applied right-to-left without position shift', () => {
    const source = '0123456789';
    const groups = [
      group(1, [{
        groupNumber: 1, kind: 'replace',
        range: { start: 0, end: 1 }, markupRange: { start: 0, end: 0 },
        oldText: '0', newText: 'AAAA',
        contextBefore: '', contextAfter: '12345',
      }]),
      group(2, [{
        groupNumber: 2, kind: 'replace',
        range: { start: 8, end: 10 }, markupRange: { start: 0, end: 0 },
        oldText: '89', newText: 'BB',
        contextBefore: '4567', contextAfter: '',
      }]),
    ];
    const decisions: EditingReviewDecision[] = [
      { groupNumber: 1, decision: 'accept', reason: '' },
      { groupNumber: 2, decision: 'accept', reason: '' },
    ];
    const r = applyAcceptedGroups(groups, decisions, source);
    expect(r.newText).toBe('AAAA1234567BB');
    expect(r.appliedGroups).toHaveLength(2);
  });

  it('overlapping accepted groups → drops the later group', () => {
    const source = 'abcdef';
    const groups = [
      group(1, [{
        groupNumber: 1, kind: 'replace',
        range: { start: 0, end: 3 }, markupRange: { start: 0, end: 0 },
        oldText: 'abc', newText: 'AAA',
        contextBefore: '', contextAfter: 'def',
      }]),
      group(2, [{
        groupNumber: 2, kind: 'replace',
        range: { start: 2, end: 5 }, markupRange: { start: 0, end: 0 },
        oldText: 'cde', newText: 'CCC',
        contextBefore: 'ab', contextAfter: 'f',
      }]),
    ];
    const decisions: EditingReviewDecision[] = [
      { groupNumber: 1, decision: 'accept', reason: '' },
      { groupNumber: 2, decision: 'accept', reason: '' },
    ];
    const r = applyAcceptedGroups(groups, decisions, source);
    expect(r.newText).toBe('AAAdef');
    expect(r.droppedPostApprover[0]!.reason).toBe('range_overlap_with_earlier_group');
  });
});
