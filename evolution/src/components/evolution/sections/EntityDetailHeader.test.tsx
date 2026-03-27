// Tests for EntityDetailHeader: title, entity ID, status badge, cross-links, actions, and rename.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EntityDetailHeader } from './EntityDetailHeader';

describe('EntityDetailHeader', () => {
  it('renders title', () => {
    render(<EntityDetailHeader title="Test Strategy" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Test Strategy');
  });

  it('renders entity ID truncated with copy tooltip', () => {
    const longId = 'abcdef1234567890abcdef';
    render(<EntityDetailHeader title="Run" entityId={longId} />);
    const el = screen.getByTestId('entity-id');
    expect(el).toHaveAttribute('title', 'Click to copy full ID');
    expect(el.textContent).toContain('abcdef123456');
    expect(el.textContent).toContain('…');
  });

  it('renders short entity ID without truncation', () => {
    render(<EntityDetailHeader title="Run" entityId="abc123" />);
    const el = screen.getByTestId('entity-id');
    expect(el.textContent).toContain('abc123');
  });

  it('renders status badge when provided', () => {
    render(<EntityDetailHeader title="Run" statusBadge={<span data-testid="badge">Active</span>} />);
    expect(screen.getByTestId('badge')).toHaveTextContent('Active');
  });

  it('renders cross-link badges with correct hrefs', () => {
    render(
      <EntityDetailHeader
        title="Run"
        links={[
          { prefix: 'Experiment', label: 'Test Exp', href: '/experiments/1' },
          { prefix: 'Strategy', label: 'Test Strat', href: '/strategies/2' },
        ]}
      />
    );
    const crossLinks = screen.getByTestId('cross-links');
    const links = crossLinks.querySelectorAll('a');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveTextContent('Experiment: Test Exp');
    expect(links[0]).toHaveAttribute('href', '/experiments/1');
    expect(links[1]).toHaveTextContent('Strategy: Test Strat');
  });

  it('renders actions slot', () => {
    render(<EntityDetailHeader title="Run" actions={<button>Compare</button>} />);
    expect(screen.getByTestId('header-actions')).toBeInTheDocument();
    expect(screen.getByText('Compare')).toBeInTheDocument();
  });

  it('omits optional sections when not provided', () => {
    render(<EntityDetailHeader title="Minimal" />);
    expect(screen.queryByTestId('entity-id')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cross-links')).not.toBeInTheDocument();
    expect(screen.queryByTestId('header-actions')).not.toBeInTheDocument();
  });

  it('shows pencil icon when onRename is provided', () => {
    render(<EntityDetailHeader title="Renamable" onRename={jest.fn()} />);
    expect(screen.getByTestId('rename-pencil')).toBeInTheDocument();
  });

  it('does not show pencil icon when onRename is not provided', () => {
    render(<EntityDetailHeader title="Static" />);
    expect(screen.queryByTestId('rename-pencil')).not.toBeInTheDocument();
  });

  it('enters edit mode on pencil click', async () => {
    const user = userEvent.setup();
    render(<EntityDetailHeader title="Original" onRename={jest.fn()} />);
    await user.click(screen.getByTestId('rename-pencil'));
    expect(screen.getByTestId('rename-form')).toBeInTheDocument();
    expect(screen.getByTestId('rename-input')).toHaveValue('Original');
  });

  it('calls onRename with new name on save', async () => {
    const user = userEvent.setup();
    const onRename = jest.fn().mockResolvedValue(undefined);
    render(<EntityDetailHeader title="Original" onRename={onRename} />);
    await user.click(screen.getByTestId('rename-pencil'));
    const input = screen.getByTestId('rename-input');
    await user.clear(input);
    await user.type(input, 'New Name');
    await user.click(screen.getByTestId('rename-save'));
    await waitFor(() => expect(onRename).toHaveBeenCalledWith('New Name'));
  });

  it('exits edit mode on cancel', async () => {
    const user = userEvent.setup();
    render(<EntityDetailHeader title="Original" onRename={jest.fn()} />);
    await user.click(screen.getByTestId('rename-pencil'));
    await user.click(screen.getByTestId('rename-cancel'));
    expect(screen.queryByTestId('rename-form')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Original');
  });
});
