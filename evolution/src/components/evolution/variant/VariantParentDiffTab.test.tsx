// Unit tests for VariantParentDiffTab: renders the side-by-side diff when a parent exists,
// an explicit empty state when parentless, the "Paragraph N" header and cross-run pill.
// enable_side_by_side_variant_comparisons_vs_parent_20260531.

import { render, screen, waitFor } from '@testing-library/react';
import { VariantParentDiffTab } from './VariantParentDiffTab';
import { getVariantParentDiffAction } from '@evolution/services/variantDetailActions';

jest.mock('@evolution/services/variantDetailActions', () => ({
  getVariantParentDiffAction: jest.fn(),
}));

const mockAction = getVariantParentDiffAction as jest.Mock;
const VID = 'aaaaaaaa-1111-2222-3333-444444444444';

describe('VariantParentDiffTab', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders the side-by-side diff when a parent exists', async () => {
    mockAction.mockResolvedValue({
      success: true,
      data: {
        variantId: VID,
        variantKind: 'article',
        variantContent: 'the new article text',
        parent: { id: 'p1', content: 'the old article text', elo: 1200, uncertainty: 40, runId: 'r1' },
        crossRun: false,
        slotContext: null,
      },
    });
    render(<VariantParentDiffTab variantId={VID} />);
    await waitFor(() => expect(screen.getByTestId('sxs-diff')).toBeInTheDocument());
    expect(screen.getByTestId('sxs-parent')).toHaveTextContent('old');
    expect(screen.getByTestId('sxs-variant')).toHaveTextContent('new');
  });

  it('renders the "Paragraph N" header for paragraph variants', async () => {
    mockAction.mockResolvedValue({
      success: true,
      data: {
        variantId: VID,
        variantKind: 'paragraph',
        variantContent: 'rewritten paragraph',
        parent: { id: 'o1', content: 'original paragraph', elo: 1200, uncertainty: 40, runId: 'r1' },
        crossRun: false,
        slotContext: { paragraphNumber: 3 },
      },
    });
    render(<VariantParentDiffTab variantId={VID} />);
    await waitFor(() => expect(screen.getByTestId('variant-parent-diff-slot')).toBeInTheDocument());
    expect(screen.getByTestId('variant-parent-diff-slot')).toHaveTextContent('Paragraph 3');
  });

  it('renders the cross-run pill when crossRun is true', async () => {
    mockAction.mockResolvedValue({
      success: true,
      data: {
        variantId: VID,
        variantKind: 'article',
        variantContent: 'child',
        parent: { id: 'p1', content: 'parent', elo: 1200, uncertainty: 40, runId: 'abcdef12-0000-0000-0000-000000000000' },
        crossRun: true,
        slotContext: null,
      },
    });
    render(<VariantParentDiffTab variantId={VID} />);
    await waitFor(() => expect(screen.getByTestId('variant-parent-diff-cross-run')).toBeInTheDocument());
    expect(screen.getByTestId('variant-parent-diff-cross-run')).toHaveTextContent('other run');
  });

  it('renders the "Original paragraph" empty state for a parentless paragraph variant', async () => {
    mockAction.mockResolvedValue({
      success: true,
      data: {
        variantId: VID,
        variantKind: 'paragraph',
        variantContent: 'the original paragraph',
        parent: null,
        crossRun: false,
        slotContext: { paragraphNumber: 1 },
      },
    });
    render(<VariantParentDiffTab variantId={VID} />);
    await waitFor(() => expect(screen.getByTestId('variant-parent-diff-empty')).toBeInTheDocument());
    expect(screen.getByTestId('variant-parent-diff-empty')).toHaveTextContent('Original paragraph');
    expect(screen.queryByTestId('sxs-diff')).not.toBeInTheDocument();
  });

  it('renders the "Seed · no parent" empty state for a parentless article variant', async () => {
    mockAction.mockResolvedValue({
      success: true,
      data: {
        variantId: VID,
        variantKind: 'article',
        variantContent: 'seed article',
        parent: null,
        crossRun: false,
        slotContext: null,
      },
    });
    render(<VariantParentDiffTab variantId={VID} />);
    await waitFor(() => expect(screen.getByTestId('variant-parent-diff-empty')).toBeInTheDocument());
    expect(screen.getByTestId('variant-parent-diff-empty')).toHaveTextContent('Seed · no parent');
  });
});
