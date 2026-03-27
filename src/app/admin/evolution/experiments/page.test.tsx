// Tests for experiments list page using EntityListPage pattern.

import { render, screen, waitFor } from '@testing-library/react';
import ExperimentsListPage from './page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/experiments',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@evolution/services/experimentActions', () => ({
  listExperimentsAction: jest.fn().mockResolvedValue({
    success: true,
    data: [
      {
        id: 'abc12345-6789-0def-ghij-klmnopqrstuv',
        name: 'Test Experiment',
        status: 'completed',
        created_at: '2026-02-01T00:00:00Z',
        runCount: 3,
      },
    ],
  }),
  cancelExperimentAction: jest.fn(),
}));

jest.mock('@evolution/lib/utils/evolutionUrls', () => ({
  buildExperimentUrl: (id: string) => `/admin/evolution/experiments/${id}`,
}));

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

describe('ExperimentsListPage', () => {
  it('renders breadcrumb with Evolution link', () => {
    render(<ExperimentsListPage />);
    expect(screen.getByText('Evolution')).toBeInTheDocument();
  });

  it('renders EntityListPage wrapper', () => {
    render(<ExperimentsListPage />);
    expect(screen.getByTestId('entity-list-page')).toBeInTheDocument();
  });

  it('renders experiment rows with name and link', async () => {
    render(<ExperimentsListPage />);
    await waitFor(() => {
      expect(screen.getByText('Test Experiment')).toBeInTheDocument();
    });
    // EntityTable renders rows as links via getRowHref
    const link = screen.getByRole('link', { name: /Test Experiment/i });
    expect(link).toHaveAttribute('href', '/admin/evolution/experiments/abc12345-6789-0def-ghij-klmnopqrstuv');
  });

  it('renders status filter', () => {
    render(<ExperimentsListPage />);
    expect(screen.getByTestId('filter-status')).toBeInTheDocument();
  });

  it('renders hide test content checkbox (checked by default)', () => {
    render(<ExperimentsListPage />);
    const label = screen.getByTestId('filter-filterTestContent');
    const checkbox = label.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('F31: status filter has all 5 options (All, Draft, Running, Completed, Cancelled)', () => {
    render(<ExperimentsListPage />);
    const select = screen.getByTestId('filter-status');
    const options = select.querySelectorAll('option');
    const labels = Array.from(options).map(o => o.textContent);
    expect(labels).toEqual(['All', 'Draft', 'Running', 'Completed', 'Cancelled']);
    expect(options).toHaveLength(5);
  });
});
