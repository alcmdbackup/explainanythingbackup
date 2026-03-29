// Tests for the shared TableSkeleton loading component.

import { render, screen } from '@testing-library/react';
import { TableSkeleton } from './TableSkeleton';

describe('TableSkeleton', () => {
  it('renders default 5 rows and 5 columns', () => {
    render(<TableSkeleton />);
    const rows = screen.getByTestId('table-skeleton').querySelectorAll('tbody tr');
    expect(rows).toHaveLength(5);
    const cells = rows[0]!.querySelectorAll('td');
    expect(cells).toHaveLength(5);
  });

  it('renders custom row and column count', () => {
    render(<TableSkeleton rows={3} columns={8} />);
    const rows = screen.getByTestId('table-skeleton').querySelectorAll('tbody tr');
    expect(rows).toHaveLength(3);
    const cells = rows[0]!.querySelectorAll('td');
    expect(cells).toHaveLength(8);
  });

  it('uses custom testId', () => {
    render(<TableSkeleton testId="my-skeleton" />);
    expect(screen.getByTestId('my-skeleton')).toBeInTheDocument();
  });

  it('renders animate-pulse skeleton divs', () => {
    const { container } = render(<TableSkeleton rows={1} columns={1} />);
    const pulseDivs = container.querySelectorAll('.animate-pulse');
    expect(pulseDivs.length).toBeGreaterThan(0);
  });
});
