// Unit tests for SideBySideWordDiff: left column shows removed words, right column shows
// added words, unchanged words appear in both.
// enable_side_by_side_variant_comparisons_vs_parent_20260531.

import { render, screen } from '@testing-library/react';
import { SideBySideWordDiff } from './SideBySideWordDiff';

describe('SideBySideWordDiff', () => {
  it('renders both columns with stable test ids', () => {
    render(<SideBySideWordDiff parent="The Fed was created in 1913." variant="The Federal Reserve was created in 1913." />);
    expect(screen.getByTestId('sxs-diff')).toBeInTheDocument();
    expect(screen.getByTestId('sxs-parent')).toBeInTheDocument();
    expect(screen.getByTestId('sxs-variant')).toBeInTheDocument();
  });

  it('shows removed words only on the parent side and added words only on the variant side', () => {
    render(<SideBySideWordDiff parent="alpha removedword omega" variant="alpha addedword omega" />);
    const parentCol = screen.getByTestId('sxs-parent');
    const variantCol = screen.getByTestId('sxs-variant');

    // Removed word present on parent (struck through), absent on variant.
    expect(parentCol).toHaveTextContent('removedword');
    expect(variantCol).not.toHaveTextContent('removedword');

    // Added word present on variant, absent on parent.
    expect(variantCol).toHaveTextContent('addedword');
    expect(parentCol).not.toHaveTextContent('addedword');

    // Unchanged words appear in both columns.
    expect(parentCol).toHaveTextContent('alpha');
    expect(parentCol).toHaveTextContent('omega');
    expect(variantCol).toHaveTextContent('alpha');
    expect(variantCol).toHaveTextContent('omega');
  });

  it('applies strikethrough styling to removed text on the parent side', () => {
    render(<SideBySideWordDiff parent="keep dropme" variant="keep" />);
    const removed = screen.getByText('dropme');
    expect(removed.className).toContain('line-through');
  });

  it('does not show the expand toggle for short content, shows it for long content', () => {
    const { rerender } = render(<SideBySideWordDiff parent="short" variant="short text" previewLength={600} />);
    expect(screen.queryByTestId('sxs-expand-toggle')).not.toBeInTheDocument();

    const longText = 'word '.repeat(400);
    rerender(<SideBySideWordDiff parent={longText} variant={longText + 'extra'} previewLength={100} />);
    expect(screen.getByTestId('sxs-expand-toggle')).toBeInTheDocument();
  });
});
