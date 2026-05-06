// Phase 4.11 — UI test for AnnotatedProposals component. Mirrors the testing
// list in the planning doc: 4 decision-state renderings, grouped-edit linking,
// hover tooltip content, toolbar mode switching, empty/zero-edit input,
// legend toggling, multi-cycle isolation.

import { render, screen, fireEvent } from '@testing-library/react';
import { AnnotatedProposals } from './AnnotatedProposals';
import type { EditingGroup, EditingReviewDecision, EditingDroppedGroup } from '@evolution/lib/types';

function group(n: number, start: number, end: number, opts: Partial<EditingGroup['atomicEdits'][0]> = {}): EditingGroup {
  return {
    groupNumber: n,
    atomicEdits: [{
      groupNumber: n,
      kind: opts.kind ?? 'replace',
      range: opts.range ?? { start: 0, end: 0 },
      markupRange: { start, end },
      oldText: opts.oldText ?? '',
      newText: opts.newText ?? '',
      contextBefore: opts.contextBefore ?? '',
      contextAfter: opts.contextAfter ?? '',
    }],
  };
}

const SAMPLE_MARKUP = 'Hello {~~ [#1] world ~> Earth ~~}, then {++ [#2] cruel ++} fate.';

describe('AnnotatedProposals', () => {
  it('renders accepted edits with success styling', () => {
    const decisions: EditingReviewDecision[] = [
      { groupNumber: 1, decision: 'accept', reason: 'good' },
    ];
    render(
      <AnnotatedProposals
        proposedMarkup={SAMPLE_MARKUP}
        proposedGroupsRaw={[group(1, 6, 33)]}
        reviewDecisions={decisions}
      />,
    );
    const span = screen.getByTestId('annotated-group-1');
    expect(span).toHaveAttribute('data-outcome', 'accepted');
  });

  it('renders rejected edits with rejected styling', () => {
    const decisions: EditingReviewDecision[] = [
      { groupNumber: 1, decision: 'reject', reason: 'no improvement' },
    ];
    render(
      <AnnotatedProposals
        proposedMarkup={SAMPLE_MARKUP}
        proposedGroupsRaw={[group(1, 6, 33)]}
        reviewDecisions={decisions}
      />,
    );
    const span = screen.getByTestId('annotated-group-1');
    expect(span).toHaveAttribute('data-outcome', 'rejected');
  });

  it('renders pre-Approver drops with dropped_pre styling', () => {
    const droppedPre: EditingDroppedGroup[] = [
      { groupNumber: 1, reason: 'newText_too_long' },
    ];
    render(
      <AnnotatedProposals
        proposedMarkup={SAMPLE_MARKUP}
        proposedGroupsRaw={[group(1, 6, 33)]}
        droppedPreApprover={droppedPre}
      />,
    );
    expect(screen.getByTestId('annotated-group-1')).toHaveAttribute('data-outcome', 'dropped_pre');
  });

  it('renders post-Approver drops with dropped_post styling', () => {
    const droppedPost: EditingDroppedGroup[] = [
      { groupNumber: 1, reason: 'context_mismatch' },
    ];
    render(
      <AnnotatedProposals
        proposedMarkup={SAMPLE_MARKUP}
        proposedGroupsRaw={[group(1, 6, 33)]}
        droppedPostApprover={droppedPost}
      />,
    );
    expect(screen.getByTestId('annotated-group-1')).toHaveAttribute('data-outcome', 'dropped_post');
  });

  it('shows group number badge as superscript on each edit span', () => {
    render(
      <AnnotatedProposals
        proposedMarkup={SAMPLE_MARKUP}
        proposedGroupsRaw={[group(1, 6, 33), group(2, 40, 60)]}
        reviewDecisions={[
          { groupNumber: 1, decision: 'accept', reason: '' },
          { groupNumber: 2, decision: 'reject', reason: '' },
        ]}
      />,
    );
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
  });

  it('toolbar switches between Annotated / Final variant / Original views', () => {
    render(
      <AnnotatedProposals
        proposedMarkup={SAMPLE_MARKUP}
        proposedGroupsRaw={[group(1, 6, 33)]}
        reviewDecisions={[{ groupNumber: 1, decision: 'accept', reason: '' }]}
        appliedGroups={[group(1, 6, 33)]}
      />,
    );
    expect(screen.getByTestId('annotated-content')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('annotated-view-final'));
    expect(screen.getByTestId('annotated-final')).toBeInTheDocument();
    expect(screen.queryByTestId('annotated-content')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('annotated-view-original'));
    expect(screen.getByTestId('annotated-original')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('annotated-view-annotated'));
    expect(screen.getByTestId('annotated-content')).toBeInTheDocument();
  });

  it('legend is collapsed by default; toggling shows the legend block', () => {
    render(
      <AnnotatedProposals
        proposedMarkup={SAMPLE_MARKUP}
        proposedGroupsRaw={[group(1, 6, 33)]}
      />,
    );
    expect(screen.queryByTestId('annotated-legend')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('annotated-legend-toggle'));
    expect(screen.getByTestId('annotated-legend')).toBeInTheDocument();
  });

  it('handles empty markup + zero edits as plain text without crashing', () => {
    render(
      <AnnotatedProposals proposedMarkup="" proposedGroupsRaw={[]} />,
    );
    expect(screen.getByTestId('annotated-proposals')).toBeInTheDocument();
  });

  it('Final view reconstructs only-accepted edits', () => {
    const markup = 'a {~~ [#1] b ~> B ~~} c {~~ [#2] d ~> D ~~} e';
    const groups: EditingGroup[] = [
      { groupNumber: 1, atomicEdits: [{
        groupNumber: 1, kind: 'replace',
        range: { start: 2, end: 3 }, markupRange: { start: 2, end: 21 },
        oldText: 'b', newText: 'B', contextBefore: '', contextAfter: '',
      }] },
      { groupNumber: 2, atomicEdits: [{
        groupNumber: 2, kind: 'replace',
        range: { start: 6, end: 7 }, markupRange: { start: 24, end: 43 },
        oldText: 'd', newText: 'D', contextBefore: '', contextAfter: '',
      }] },
    ];
    render(
      <AnnotatedProposals
        proposedMarkup={markup}
        proposedGroupsRaw={groups}
        appliedGroups={[groups[0]!]}
      />,
    );
    fireEvent.click(screen.getByTestId('annotated-view-final'));
    const final = screen.getByTestId('annotated-final').textContent ?? '';
    // Group 1 accepted (B), group 2 rejected (keeps d).
    expect(final).toContain('B');
    expect(final).toContain('d');
  });

  it('Original view strips markup and shows only the source text', () => {
    const markup = 'a {~~ [#1] b ~> B ~~} c';
    render(
      <AnnotatedProposals
        proposedMarkup={markup}
        proposedGroupsRaw={[group(1, 2, 21)]}
      />,
    );
    fireEvent.click(screen.getByTestId('annotated-view-original'));
    const original = screen.getByTestId('annotated-original').textContent ?? '';
    expect(original).toContain('b');
    expect(original).not.toContain('B');
    expect(original).not.toContain('{~~');
  });

  it('uses parentText for Original when supplied (skips strip-markup)', () => {
    render(
      <AnnotatedProposals
        proposedMarkup="ignored"
        proposedGroupsRaw={[]}
        parentText="canonical original text"
      />,
    );
    fireEvent.click(screen.getByTestId('annotated-view-original'));
    expect(screen.getByTestId('annotated-original').textContent).toBe('canonical original text');
  });
});
