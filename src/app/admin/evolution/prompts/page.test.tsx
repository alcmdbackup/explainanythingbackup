// Tests for prompts list page: rows render as links to detail pages, no expand state.

import { render, screen } from '@testing-library/react';
import PromptRegistryPage from './page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/prompts',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('next/link', () => {
  function MockLink({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) {
    return <a href={href} {...props}>{children}</a>;
  }
  MockLink.displayName = 'MockLink';
  return MockLink;
});

jest.mock('@evolution/services/promptRegistryActions', () => ({
  getPromptsAction: jest.fn().mockResolvedValue({
    success: true,
    data: [
      {
        id: 'prompt-1',
        title: 'Test Prompt Alpha',
        prompt: 'Explain quantum computing',
        difficulty_tier: 'medium',
        domain_tags: ['science'],
        status: 'active',
        deleted_at: null,
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'prompt-2',
        title: 'Test Prompt Beta',
        prompt: 'Explain photosynthesis',
        difficulty_tier: null,
        domain_tags: [],
        status: 'archived',
        deleted_at: null,
        created_at: '2026-01-02T00:00:00Z',
      },
    ],
  }),
  createPromptAction: jest.fn(),
  updatePromptAction: jest.fn(),
  archivePromptAction: jest.fn(),
  deletePromptAction: jest.fn(),
}));

describe('PromptRegistryPage', () => {
  it('renders prompt rows with links to detail pages', async () => {
    render(<PromptRegistryPage />);
    const link1 = await screen.findByTestId('prompt-link-prompt-1');
    expect(link1).toHaveAttribute('href', '/admin/evolution/prompts/prompt-1');
    expect(link1).toHaveTextContent('Test Prompt Alpha');

    const link2 = screen.getByTestId('prompt-link-prompt-2');
    expect(link2).toHaveAttribute('href', '/admin/evolution/prompts/prompt-2');
    expect(link2).toHaveTextContent('Test Prompt Beta');
  });

  it('does not render expand/collapse controls', async () => {
    render(<PromptRegistryPage />);
    await screen.findByTestId('prompt-row-prompt-1');
    expect(screen.queryByTestId('prompt-runs-prompt-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('prompt-runs-prompt-2')).not.toBeInTheDocument();
  });

  it('renders prompts table with expected columns', async () => {
    render(<PromptRegistryPage />);
    await screen.findByTestId('prompts-table');
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Prompt')).toBeInTheDocument();
    expect(screen.getByText('Difficulty')).toBeInTheDocument();
    expect(screen.getByText('Tags')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getByText('Actions')).toBeInTheDocument();
  });

  it('renders action buttons per row', async () => {
    render(<PromptRegistryPage />);
    await screen.findByTestId('edit-prompt-prompt-1');
    expect(screen.getByTestId('archive-prompt-prompt-1')).toBeInTheDocument();
    expect(screen.getByTestId('delete-prompt-prompt-1')).toBeInTheDocument();
  });
});
