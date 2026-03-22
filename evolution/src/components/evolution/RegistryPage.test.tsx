// Tests for RegistryPage: data loading, filters, pagination, dialogs, header action.

import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { RegistryPage, type RegistryPageConfig } from './RegistryPage';

jest.mock('sonner', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

jest.mock('@evolution/components/evolution', () => ({
  EvolutionBreadcrumb: ({ items }: { items: Array<{ label: string }> }) => (
    <nav data-testid="breadcrumb">{items.map((i) => i.label).join(' > ')}</nav>
  ),
  EntityListPage: ({
    items,
    loading,
    totalCount,
    filterValues,
    onFilterChange,
    page,
    pageSize,
    onPageChange,
    columns,
    filters,
    getRowHref,
    emptyMessage,
  }: {
    items: Array<{ id: string }>;
    loading: boolean;
    totalCount: number;
    filterValues: Record<string, string>;
    onFilterChange: (key: string, value: string) => void;
    page: number;
    pageSize: number;
    onPageChange: (p: number) => void;
    columns: Array<{ key: string; header: string }>;
    filters: Array<{ key: string; label: string }>;
    getRowHref?: (row: { id: string }) => string;
    emptyMessage: string;
  }) => (
    <div data-testid="entity-list">
      <span data-testid="item-count">{items.length}</span>
      <span data-testid="total-count">{totalCount}</span>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="page">{page}</span>
      {filters.map((f) => (
        <button key={f.key} data-testid={`filter-${f.key}`} onClick={() => onFilterChange(f.key, 'active')}>
          {f.label}
        </button>
      ))}
      {totalCount > pageSize && (
        <button data-testid="next-page" onClick={() => onPageChange(page + 1)}>Next</button>
      )}
      {items.length === 0 && <div data-testid="empty">{emptyMessage}</div>}
    </div>
  ),
}));

jest.mock('./FormDialog', () => ({
  FormDialog: ({ open, title, onSubmit, onClose }: {
    open: boolean; title: string; onSubmit: (v: Record<string, unknown>) => Promise<void>; onClose: () => void;
  }) =>
    open ? (
      <div data-testid="form-dialog">
        <span>{title}</span>
        <button data-testid="form-submit" onClick={() => onSubmit({})}>Submit</button>
        <button data-testid="form-close" onClick={onClose}>Close</button>
      </div>
    ) : null,
}));

jest.mock('./ConfirmDialog', () => ({
  ConfirmDialog: ({ open, title, onConfirm, onClose }: {
    open: boolean; title: string; onConfirm: () => Promise<void>; onClose: () => void;
  }) =>
    open ? (
      <div data-testid="confirm-dialog">
        <span>{title}</span>
        <button data-testid="confirm-yes" onClick={onConfirm}>Confirm</button>
        <button data-testid="confirm-close" onClick={onClose}>Close</button>
      </div>
    ) : null,
}));

interface TestItem {
  id: string;
  name: string;
  status: string;
}

const mockLoadData = jest.fn();

function makeConfig(overrides: Partial<RegistryPageConfig<TestItem>> = {}): RegistryPageConfig<TestItem> {
  return {
    title: 'Strategies',
    breadcrumbs: [{ label: 'Admin', href: '/admin' }],
    columns: [
      { key: 'name', header: 'Name', render: (row: TestItem) => row.name },
      { key: 'status', header: 'Status', render: (row: TestItem) => row.status },
    ],
    filters: [{ key: 'status', label: 'Status', type: 'select' as const, options: [{ value: 'active', label: 'Active' }] }],
    loadData: mockLoadData,
    ...overrides,
  };
}

const ITEMS: TestItem[] = [
  { id: '1', name: 'Alpha', status: 'active' },
  { id: '2', name: 'Beta', status: 'archived' },
];

describe('RegistryPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadData.mockResolvedValue({ items: ITEMS, total: 2 });
  });

  it('loads and displays data', async () => {
    render(<RegistryPage config={makeConfig()} />);
    await waitFor(() => {
      expect(screen.getByTestId('item-count')).toHaveTextContent('2');
    });
    expect(mockLoadData).toHaveBeenCalledWith({}, 1, 50);
  });

  it('renders breadcrumb with title', async () => {
    render(<RegistryPage config={makeConfig()} />);
    await waitFor(() => {
      expect(screen.getByTestId('breadcrumb')).toHaveTextContent('Admin > Strategies');
    });
  });

  it('renders page title', async () => {
    render(<RegistryPage config={makeConfig()} />);
    await waitFor(() => {
      expect(screen.getByText('Strategies')).toBeInTheDocument();
    });
  });

  it('renders header action button when configured', async () => {
    const onClick = jest.fn();
    render(<RegistryPage config={makeConfig({ headerAction: { label: 'Add Strategy', onClick } })} />);
    await waitFor(() => {
      expect(screen.getByText('Add Strategy')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Add Strategy'));
    expect(onClick).toHaveBeenCalled();
  });

  it('does not render header action when not configured', async () => {
    render(<RegistryPage config={makeConfig()} />);
    await waitFor(() => {
      expect(screen.getByTestId('entity-list')).toBeInTheDocument();
    });
    expect(screen.queryByText('Add Strategy')).not.toBeInTheDocument();
  });

  it('shows empty message when no items', async () => {
    mockLoadData.mockResolvedValue({ items: [], total: 0 });
    render(<RegistryPage config={makeConfig()} />);
    await waitFor(() => {
      expect(screen.getByTestId('empty')).toBeInTheDocument();
    });
  });

  it('uses custom empty message', async () => {
    mockLoadData.mockResolvedValue({ items: [], total: 0 });
    render(<RegistryPage config={makeConfig({ emptyMessage: 'Nothing here yet' })} />);
    await waitFor(() => {
      expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
    });
  });

  it('reloads data when filter changes', async () => {
    render(<RegistryPage config={makeConfig()} />);
    await waitFor(() => {
      expect(screen.getByTestId('entity-list')).toBeInTheDocument();
    });

    mockLoadData.mockClear();
    await act(async () => {
      fireEvent.click(screen.getByTestId('filter-status'));
    });

    await waitFor(() => {
      expect(mockLoadData).toHaveBeenCalledWith({ status: 'active' }, 1, 50);
    });
  });

  it('resets page to 1 when filter changes', async () => {
    mockLoadData.mockResolvedValue({ items: ITEMS, total: 100 });
    render(<RegistryPage config={makeConfig({ pageSize: 10 })} />);
    await waitFor(() => {
      expect(screen.getByTestId('next-page')).toBeInTheDocument();
    });

    // Go to page 2
    await act(async () => {
      fireEvent.click(screen.getByTestId('next-page'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('page')).toHaveTextContent('2');
    });

    // Change filter — should reset to page 1
    await act(async () => {
      fireEvent.click(screen.getByTestId('filter-status'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('page')).toHaveTextContent('1');
    });
  });

  it('renders FormDialog when open', async () => {
    render(
      <RegistryPage
        config={makeConfig()}
        formDialog={{
          open: true,
          onClose: jest.fn(),
          title: 'Create Strategy',
          fields: [],
          onSubmit: jest.fn(),
        }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('form-dialog')).toBeInTheDocument();
    });
    expect(screen.getByText('Create Strategy')).toBeInTheDocument();
  });

  it('does not render FormDialog when closed', async () => {
    render(
      <RegistryPage
        config={makeConfig()}
        formDialog={{
          open: false,
          onClose: jest.fn(),
          title: 'Create Strategy',
          fields: [],
          onSubmit: jest.fn(),
        }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('entity-list')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('form-dialog')).not.toBeInTheDocument();
  });

  it('renders ConfirmDialog when open', async () => {
    render(
      <RegistryPage
        config={makeConfig()}
        confirmDialog={{
          open: true,
          onClose: jest.fn(),
          title: 'Delete?',
          message: 'Are you sure?',
          onConfirm: jest.fn(),
        }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
    });
    expect(screen.getByText('Delete?')).toBeInTheDocument();
  });

  it('reloads data after form submit', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    render(
      <RegistryPage
        config={makeConfig()}
        formDialog={{
          open: true,
          onClose: jest.fn(),
          title: 'Create',
          fields: [],
          onSubmit,
        }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('form-dialog')).toBeInTheDocument();
    });

    mockLoadData.mockClear();
    await act(async () => {
      fireEvent.click(screen.getByTestId('form-submit'));
    });

    await waitFor(() => {
      expect(mockLoadData).toHaveBeenCalled();
    });
  });

  it('shows error toast when loadData throws', async () => {
    const { toast } = jest.requireMock('sonner');
    mockLoadData.mockRejectedValue(new Error('Network error'));
    render(<RegistryPage config={makeConfig()} />);
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to load data');
    });
  });
});
