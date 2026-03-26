// Tests for prompts list page rendering and RegistryPage integration.

import { render, screen, waitFor } from '@testing-library/react';
import PromptsPage from './page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/prompts',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@evolution/services/arenaActions', () => ({
  listPromptsAction: jest.fn().mockResolvedValue({
    success: true,
    data: {
      items: [{
        id: '22222222-2222-2222-2222-222222222222',
        name: 'Test Prompt',
        prompt: 'Explain quantum computing in simple terms that a high school student could understand.',
        status: 'active',
        deleted_at: null,
        archived_at: null,
        created_at: '2026-02-15T00:00:00Z',
      }],
      total: 1,
    },
  }),
  createPromptAction: jest.fn().mockResolvedValue({ success: true, data: {} }),
  updatePromptAction: jest.fn().mockResolvedValue({ success: true, data: {} }),
  archivePromptAction: jest.fn().mockResolvedValue({ success: true, data: { archived: true } }),
  deletePromptAction: jest.fn().mockResolvedValue({ success: true, data: { deleted: true } }),
}));

describe('PromptsPage', () => {
  it('renders page title', () => {
    render(<PromptsPage />);
    const headings = screen.getAllByText('Prompts');
    expect(headings.length).toBeGreaterThanOrEqual(1);
  });

  it('renders breadcrumb with Evolution link', () => {
    render(<PromptsPage />);
    expect(screen.getByText('Evolution')).toBeInTheDocument();
  });

  it('renders New Prompt button', () => {
    render(<PromptsPage />);
    expect(screen.getByText('New Prompt')).toBeInTheDocument();
  });

  it('loads and displays prompt data', async () => {
    render(<PromptsPage />);
    await waitFor(() => {
      expect(screen.getByText('Test Prompt')).toBeInTheDocument();
    });
  });

  it('shows status filter', () => {
    render(<PromptsPage />);
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
  });

  it('displays prompt text', async () => {
    render(<PromptsPage />);
    await waitFor(() => {
      expect(screen.getByText(/Explain quantum computing/)).toBeInTheDocument();
    });
  });

  it('renders prompt creation form area', () => {
    render(<PromptsPage />);
    expect(screen.getByText('New Prompt')).toBeInTheDocument();
  });

  it('displays prompt status badge', async () => {
    render(<PromptsPage />);
    await waitFor(() => {
      expect(screen.getByText('active')).toBeInTheDocument();
    });
  });

  it('renders prompts breadcrumb item', () => {
    render(<PromptsPage />);
    const breadcrumb = screen.getByTestId('evolution-breadcrumb');
    expect(breadcrumb).toHaveTextContent('Prompts');
  });
});
