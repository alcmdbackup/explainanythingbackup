// Tests for EntityTable: headers, rows, sorting, loading/empty states, and row links.

import { render, screen, fireEvent } from '@testing-library/react';
import { EntityTable, type ColumnDef } from './EntityTable';

interface TestItem {
  id: string;
  name: string;
  score: number;
}

const columns: ColumnDef<TestItem>[] = [
  { key: 'name', header: 'Name', render: (item) => item.name },
  { key: 'score', header: 'Score', align: 'right', sortable: true, render: (item) => item.score },
];

const items: TestItem[] = [
  { id: '1', name: 'Alpha', score: 100 },
  { id: '2', name: 'Beta', score: 200 },
];

describe('EntityTable', () => {
  it('renders column headers', () => {
    render(<EntityTable columns={columns} items={items} />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Score')).toBeInTheDocument();
  });

  it('renders rows with correct data', () => {
    render(<EntityTable columns={columns} items={items} />);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
  });

  it('renders clickable row links via getRowHref', () => {
    render(
      <EntityTable columns={columns} items={items} getRowHref={(item) => `/items/${item.id}`} />
    );
    const links = screen.getAllByRole('link');
    expect(links.length).toBeGreaterThanOrEqual(2);
    expect(links[0]).toHaveAttribute('href', '/items/1');
  });

  it('shows sort indicator on sortable column', () => {
    render(<EntityTable columns={columns} items={items} sortKey="score" sortDir="desc" />);
    expect(screen.getByText('▼')).toBeInTheDocument();
  });

  it('calls onSort when sortable header clicked', () => {
    const onSort = jest.fn();
    render(<EntityTable columns={columns} items={items} onSort={onSort} />);
    fireEvent.click(screen.getByText('Score'));
    expect(onSort).toHaveBeenCalledWith('score');
  });

  it('shows TableSkeleton when loading', () => {
    render(<EntityTable columns={columns} items={[]} loading testId="test" />);
    expect(screen.getByTestId('test-skeleton')).toBeInTheDocument();
  });

  it('shows EmptyState when items empty', () => {
    render(<EntityTable columns={columns} items={[]} emptyMessage="No data" testId="test" />);
    expect(screen.getByTestId('test-empty')).toBeInTheDocument();
    expect(screen.getByText('No data')).toBeInTheDocument();
  });

  it('applies hover class to rows', () => {
    const { container } = render(<EntityTable columns={columns} items={items} />);
    const rows = container.querySelectorAll('tbody tr');
    expect(rows[0].className).toContain('hover:bg-[var(--surface-secondary)]');
  });
});
