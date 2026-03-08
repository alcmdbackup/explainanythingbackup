// Tests for prompt detail page rendering.

import { render, screen } from '@testing-library/react';
import PromptDetailPage from './page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/prompts/prompt-123',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ promptId: 'prompt-123' }),
}));

jest.mock('@evolution/services/promptRegistryActions', () => ({
  getPromptsAction: jest.fn(),
}));

jest.mock('@evolution/services/eloBudgetActions', () => ({
  getPromptRunsAction: jest.fn(),
}));

import { getPromptsAction } from '@evolution/services/promptRegistryActions';
import { getPromptRunsAction } from '@evolution/services/eloBudgetActions';

describe('PromptDetailPage', () => {
  beforeEach(() => {
    (getPromptsAction as jest.Mock).mockResolvedValue({
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
    });
    (getPromptRunsAction as jest.Mock).mockResolvedValue({ success: true, data: [] });
  });
  it('renders prompt title as heading', async () => {
    render(<PromptDetailPage />);
    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Test Prompt');
  });

  it('renders breadcrumb with Prompts link', async () => {
    render(<PromptDetailPage />);
    const link = await screen.findByText('Prompts');
    expect(link.closest('a')).toHaveAttribute('href', '/admin/evolution/prompts');
  });

  it('renders run history section', async () => {
    render(<PromptDetailPage />);
    const heading = await screen.findByRole('heading', { level: 2 });
    expect(heading).toHaveTextContent('Run History');
  });

  it('renders view arena link', async () => {
    render(<PromptDetailPage />);
    const link = await screen.findByText('View Arena');
    expect(link).toBeInTheDocument();
  });
});
