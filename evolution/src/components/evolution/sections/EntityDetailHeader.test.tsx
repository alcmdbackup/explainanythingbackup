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
    expect(el).toHaveAttribute('title', `Click to copy: ${longId}`);
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
    // Fix #25 (use_playwright_find_ux_issues_bugs_20260501): chip prefix is no
    // longer rendered as a colon-prefixed label string. Both prefix and label
    // text are still visible (prefix in a small uppercase muted span).
    expect(links[0]).toHaveTextContent('Experiment');
    expect(links[0]).toHaveTextContent('Test Exp');
    expect(links[0]).toHaveAttribute('href', '/experiments/1');
    expect(links[1]).toHaveTextContent('Strategy');
    expect(links[1]).toHaveTextContent('Test Strat');
  });

  // fixes_to_evolution_admin_dashboard__20260503 Issue 3 — variant detail
  // header gains a "Produced by <agent_name>" link slot. Confirms the slot
  // can hold a third entry alongside Run + Explanation, that the prefix and
  // label both render, and that the href is correct.
  it('renders Produced-by invocation link alongside Run + Explanation slots', () => {
    render(
      <EntityDetailHeader
        title="Variant abc123"
        links={[
          { prefix: 'Run', label: 'run-uuid8', href: '/admin/evolution/runs/run-uuid8' },
          { prefix: 'Explanation', label: '#42', href: '/results?explanation_id=42' },
          {
            prefix: 'Produced by',
            label: 'evaluate_criteria_then_generate_from_previous_article',
            href: '/admin/evolution/invocations/inv-uuid',
          },
        ]}
      />
    );
    const crossLinks = screen.getByTestId('cross-links');
    const links = crossLinks.querySelectorAll('a');
    expect(links).toHaveLength(3);
    expect(links[2]).toHaveTextContent('Produced by');
    expect(links[2]).toHaveTextContent('evaluate_criteria_then_generate_from_previous_article');
    expect(links[2]).toHaveAttribute('href', '/admin/evolution/invocations/inv-uuid');
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
