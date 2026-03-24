// Tests for EntityListPage: title, filters, table, pagination, actions slot, showHeader, renderTable.

import { render, screen, fireEvent } from '@testing-library/react';
import { EntityListPage } from './EntityListPage';
import type { ColumnDef } from './EntityTable';

interface TestItem {
  id: string;
  name: string;
}

const columns: ColumnDef<TestItem>[] = [
  { key: 'name', header: 'Name', render: (item) => item.name },
];

const items: TestItem[] = [
  { id: '1', name: 'Item A' },
  { id: '2', name: 'Item B' },
];

describe('EntityListPage', () => {
  it('renders title and item count inside Card', () => {
    render(<EntityListPage title="Runs" columns={columns} items={items} loading={false} totalCount={42} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Runs');
    expect(screen.getByText('42 items')).toBeInTheDocument();
    expect(screen.getByTestId('entity-list-page')).toBeInTheDocument();
  });

  it('renders singular count', () => {
    render(<EntityListPage title="Runs" columns={columns} items={items} loading={false} totalCount={1} />);
    expect(screen.getByText('1 item')).toBeInTheDocument();
  });

  it('hides header when showHeader=false', () => {
    render(<EntityListPage title="Runs" showHeader={false} columns={columns} items={items} loading={false} totalCount={42} />);
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByText('42 items')).not.toBeInTheDocument();
  });

  it('renders select filter', () => {
    const onFilterChange = jest.fn();
    render(
      <EntityListPage
        title="Runs"
        columns={columns}
        items={items}
        loading={false}
        filters={[{ key: 'status', label: 'Status', type: 'select', options: [{ value: '', label: 'All' }, { value: 'active', label: 'Active' }] }]}
        onFilterChange={onFilterChange}
      />
    );
    const select = screen.getByTestId('filter-status');
    fireEvent.change(select, { target: { value: 'active' } });
    expect(onFilterChange).toHaveBeenCalledWith('status', 'active');
  });

  it('renders text filter with trim/truncation', () => {
    const onFilterChange = jest.fn();
    render(
      <EntityListPage
        title="Runs"
        columns={columns}
        items={items}
        loading={false}
        filters={[{ key: 'search', label: 'Search', type: 'text', placeholder: 'Search...' }]}
        onFilterChange={onFilterChange}
      />
    );
    const input = screen.getByTestId('filter-search');
    fireEvent.change(input, { target: { value: '  hello  ' } });
    expect(onFilterChange).toHaveBeenCalledWith('search', 'hello');
  });

  it('renders pagination controls', () => {
    const onPageChange = jest.fn();
    render(
      <EntityListPage
        title="Runs"
        columns={columns}
        items={items}
        loading={false}
        totalCount={60}
        page={2}
        pageSize={20}
        onPageChange={onPageChange}
      />
    );
    expect(screen.getByTestId('pagination')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Next ▶'));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it('renders actions slot', () => {
    render(
      <EntityListPage
        title="Strategies"
        columns={columns}
        items={items}
        loading={false}
        actions={<button>Create</button>}
      />
    );
    expect(screen.getByText('Create')).toBeInTheDocument();
  });

  it('passes items to EntityTable', () => {
    render(<EntityListPage title="Runs" columns={columns} items={items} loading={false} />);
    expect(screen.getByText('Item A')).toBeInTheDocument();
    expect(screen.getByText('Item B')).toBeInTheDocument();
  });

  it('renders checked checkbox filter and fires onChange with false on uncheck', () => {
    const onFilterChange = jest.fn();
    render(
      <EntityListPage
        title="Runs"
        columns={columns}
        items={items}
        loading={false}
        filters={[{ key: 'hideTest', label: 'Hide test', type: 'checkbox', defaultChecked: true }]}
        filterValues={{ hideTest: 'true' }}
        onFilterChange={onFilterChange}
      />
    );
    const checkbox = screen.getByTestId('filter-hideTest').querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(onFilterChange).toHaveBeenCalledWith('hideTest', 'false');
  });

  it('renders unchecked checkbox filter and fires onChange with true on check', () => {
    const onFilterChange = jest.fn();
    render(
      <EntityListPage
        title="Runs"
        columns={columns}
        items={items}
        loading={false}
        filters={[{ key: 'hideTest', label: 'Hide test', type: 'checkbox' }]}
        filterValues={{ hideTest: 'false' }}
        onFilterChange={onFilterChange}
      />
    );
    const checkbox = screen.getByTestId('filter-hideTest').querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(onFilterChange).toHaveBeenCalledWith('hideTest', 'true');
  });

  it('uses renderTable instead of EntityTable when provided', () => {
    render(
      <EntityListPage
        title="Runs"
        items={items}
        loading={false}
        renderTable={({ items: tableItems }) => (
          <div data-testid="custom-table">{tableItems.map((i) => (i as TestItem).name).join(',')}</div>
        )}
      />
    );
    expect(screen.getByTestId('custom-table')).toHaveTextContent('Item A,Item B');
    expect(screen.queryByTestId('entity-list-table')).not.toBeInTheDocument();
  });
});
