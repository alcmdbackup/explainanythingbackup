// Tests for EntityListPage: title, filters, table, pagination, and actions slot.

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
  it('renders title and item count', () => {
    render(<EntityListPage title="Runs" columns={columns} items={items} loading={false} totalCount={42} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Runs');
    expect(screen.getByText('42 items')).toBeInTheDocument();
  });

  it('renders singular count', () => {
    render(<EntityListPage title="Runs" columns={columns} items={items} loading={false} totalCount={1} />);
    expect(screen.getByText('1 item')).toBeInTheDocument();
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

  it('renders checkbox filter', () => {
    const onFilterChange = jest.fn();
    render(
      <EntityListPage
        title="Runs"
        columns={columns}
        items={items}
        loading={false}
        filters={[{ key: 'hideTest', label: 'Hide test content', type: 'checkbox', defaultChecked: true }]}
        filterValues={{ hideTest: 'true' }}
        onFilterChange={onFilterChange}
      />
    );
    const label = screen.getByTestId('filter-hideTest');
    expect(label).toBeInTheDocument();
    expect(screen.getByText('Hide test content')).toBeInTheDocument();
    const checkbox = label.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(onFilterChange).toHaveBeenCalledWith('hideTest', 'false');
  });

  it('renders unchecked checkbox when value is false', () => {
    const onFilterChange = jest.fn();
    render(
      <EntityListPage
        title="Runs"
        columns={columns}
        items={items}
        loading={false}
        filters={[{ key: 'hideTest', label: 'Hide test content', type: 'checkbox' }]}
        filterValues={{ hideTest: 'false' }}
        onFilterChange={onFilterChange}
      />
    );
    const label = screen.getByTestId('filter-hideTest');
    const checkbox = label.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(onFilterChange).toHaveBeenCalledWith('hideTest', 'true');
  });
});
