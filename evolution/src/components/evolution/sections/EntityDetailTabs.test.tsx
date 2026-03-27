// Tests for EntityDetailTabs: tab rendering, active state, click handling.

import { render, screen, fireEvent } from '@testing-library/react';
import { EntityDetailTabs, type TabDef } from './EntityDetailTabs';

const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'runs', label: 'Runs' },
  { id: 'config', label: 'Config' },
];

describe('EntityDetailTabs', () => {
  it('renders all tab labels', () => {
    render(
      <EntityDetailTabs tabs={TABS} activeTab="overview" onTabChange={jest.fn()}>
        <div>content</div>
      </EntityDetailTabs>
    );
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('Runs')).toBeInTheDocument();
    expect(screen.getByText('Config')).toBeInTheDocument();
  });

  it('highlights active tab with accent-gold', () => {
    render(
      <EntityDetailTabs tabs={TABS} activeTab="runs" onTabChange={jest.fn()}>
        <div>content</div>
      </EntityDetailTabs>
    );
    const activeButton = screen.getByTestId('tab-runs');
    expect(activeButton.className).toContain('text-[var(--accent-gold)]');
    expect(activeButton.className).toContain('border-[var(--accent-gold)]');
  });

  it('calls onTabChange with tab ID when clicked', () => {
    const onTabChange = jest.fn();
    render(
      <EntityDetailTabs tabs={TABS} activeTab="overview" onTabChange={onTabChange}>
        <div>content</div>
      </EntityDetailTabs>
    );
    fireEvent.click(screen.getByText('Config'));
    expect(onTabChange).toHaveBeenCalledWith('config');
  });

  it('renders children', () => {
    render(
      <EntityDetailTabs tabs={TABS} activeTab="overview" onTabChange={jest.fn()}>
        <div data-testid="child">Tab content here</div>
      </EntityDetailTabs>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('F22: tab bar has role="tablist"', () => {
    render(
      <EntityDetailTabs tabs={TABS} activeTab="overview" onTabChange={jest.fn()}>
        <div>content</div>
      </EntityDetailTabs>
    );
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('F22: tab buttons have role="tab" and aria-selected', () => {
    render(
      <EntityDetailTabs tabs={TABS} activeTab="runs" onTabChange={jest.fn()}>
        <div>content</div>
      </EntityDetailTabs>
    );
    const tabButtons = screen.getAllByRole('tab');
    expect(tabButtons).toHaveLength(3);

    const runsTab = screen.getByTestId('tab-runs');
    expect(runsTab).toHaveAttribute('aria-selected', 'true');
    expect(runsTab).toHaveAttribute('aria-controls', 'tabpanel-runs');

    const overviewTab = screen.getByTestId('tab-overview');
    expect(overviewTab).toHaveAttribute('aria-selected', 'false');
  });

  it('F22: arrow key navigation moves to next tab', () => {
    const onTabChange = jest.fn();
    render(
      <EntityDetailTabs tabs={TABS} activeTab="overview" onTabChange={onTabChange}>
        <div>content</div>
      </EntityDetailTabs>
    );

    const overviewTab = screen.getByTestId('tab-overview');
    fireEvent.keyDown(overviewTab, { key: 'ArrowRight' });
    expect(onTabChange).toHaveBeenCalledWith('runs');
  });

  it('F22: arrow left wraps from first to last tab', () => {
    const onTabChange = jest.fn();
    render(
      <EntityDetailTabs tabs={TABS} activeTab="overview" onTabChange={onTabChange}>
        <div>content</div>
      </EntityDetailTabs>
    );

    const overviewTab = screen.getByTestId('tab-overview');
    fireEvent.keyDown(overviewTab, { key: 'ArrowLeft' });
    expect(onTabChange).toHaveBeenCalledWith('config');
  });
});
