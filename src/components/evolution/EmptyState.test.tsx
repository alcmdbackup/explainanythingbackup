// Tests for the shared EmptyState component.

import { render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders message', () => {
    render(<EmptyState message="No data found" />);
    expect(screen.getByText('No data found')).toBeInTheDocument();
  });

  it('renders suggestion when provided', () => {
    render(<EmptyState message="No runs" suggestion="Start a pipeline" />);
    expect(screen.getByText('Start a pipeline')).toBeInTheDocument();
  });

  it('does not render suggestion when not provided', () => {
    render(<EmptyState message="No runs" />);
    const el = screen.getByTestId('empty-state');
    expect(el.querySelectorAll('p')).toHaveLength(1);
  });

  it('renders custom icon', () => {
    render(<EmptyState message="Empty" icon="📭" />);
    expect(screen.getByText('📭')).toBeInTheDocument();
  });

  it('renders action element', () => {
    render(<EmptyState message="Empty" action={<button>Create</button>} />);
    expect(screen.getByText('Create')).toBeInTheDocument();
  });

  it('uses custom testId', () => {
    render(<EmptyState message="Empty" testId="my-empty" />);
    expect(screen.getByTestId('my-empty')).toBeInTheDocument();
  });
});
