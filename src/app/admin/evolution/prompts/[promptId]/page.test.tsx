// Tests for prompt detail page rendering with EntityDetailHeader and EntityDetailTabs.

import { render, screen } from '@testing-library/react';
import PromptDetailPage from './page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/prompts/prompt-123',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ promptId: 'prompt-123' }),
}));

jest.mock('@evolution/services/promptRegistryActions', () => ({
  getPromptsAction: jest.fn().mockResolvedValue({
    success: true,
    data: [{
      id: 'prompt-123',
      title: 'Test Prompt',
      prompt: 'Explain quantum computing',
      difficulty_tier: 'medium',
      domain_tags: ['science'],
      status: 'active',
      deleted_at: null,
      created_at: '2026-01-01T00:00:00Z',
    }],
  }),
}));

jest.mock('@evolution/services/eloBudgetActions', () => ({
  getPromptRunsAction: jest.fn().mockResolvedValue({ success: true, data: [] }),
}));

jest.mock('@evolution/services/evolutionActions', () => ({
  getEvolutionRunsAction: jest.fn().mockResolvedValue({ success: true, data: [] }),
}));

describe('PromptDetailPage', () => {
  it('renders prompt title in EntityDetailHeader', async () => {
    render(<PromptDetailPage />);
    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Test Prompt');
  });

  it('renders breadcrumb with Prompts link', async () => {
    render(<PromptDetailPage />);
    const link = await screen.findByText('Prompts');
    expect(link.closest('a')).toHaveAttribute('href', '/admin/evolution/prompts');
  });

  it('renders entity detail header', async () => {
    render(<PromptDetailPage />);
    await screen.findByTestId('entity-detail-header');
  });

  it('renders tab bar with Overview, Content, Runs', async () => {
    render(<PromptDetailPage />);
    await screen.findByTestId('tab-bar');
    expect(screen.getByTestId('tab-overview')).toBeInTheDocument();
    expect(screen.getByText('Content')).toBeInTheDocument();
    expect(screen.getByTestId('tab-runs')).toBeInTheDocument();
  });

  it('renders view arena link', async () => {
    render(<PromptDetailPage />);
    const link = await screen.findByText('View Arena');
    expect(link).toBeInTheDocument();
  });
});
