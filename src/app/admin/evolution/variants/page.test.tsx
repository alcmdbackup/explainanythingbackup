// Tests for variants list page rendering.

import { render, screen } from '@testing-library/react';
import VariantsListPage from './page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/variants',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@evolution/services/evolutionActions', () => ({
  listVariantsAction: jest.fn().mockResolvedValue({ success: true, data: { items: [], total: 0 } }),
}));

describe('VariantsListPage', () => {
  it('renders page heading', () => {
    render(<VariantsListPage />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Variants');
  });

  it('renders breadcrumb with Dashboard link', () => {
    render(<VariantsListPage />);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('renders filter controls', () => {
    render(<VariantsListPage />);
    expect(screen.getByTestId('variant-run-filter')).toBeInTheDocument();
    expect(screen.getByTestId('variant-agent-filter')).toBeInTheDocument();
    expect(screen.getByTestId('variant-winner-filter')).toBeInTheDocument();
  });

  it('renders refresh button', () => {
    render(<VariantsListPage />);
    expect(screen.getByRole('button', { name: /refresh|loading/i })).toBeInTheDocument();
  });
});
