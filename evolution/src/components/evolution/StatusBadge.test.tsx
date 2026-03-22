// Tests for unified StatusBadge component.

import React from 'react';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  it('renders run-status completed', () => {
    render(<StatusBadge variant="run-status" status="completed" />);
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('renders entity-status active with correct styling', () => {
    render(<StatusBadge variant="entity-status" status="active" />);
    const badge = screen.getByText('Active');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-green-100');
  });

  it('renders pipeline-type v2', () => {
    render(<StatusBadge variant="pipeline-type" status="v2" />);
    expect(screen.getByText('V2')).toBeInTheDocument();
  });

  it('renders invocation-status true as Success', () => {
    render(<StatusBadge variant="invocation-status" status="true" />);
    expect(screen.getByText('Success')).toBeInTheDocument();
  });

  it('renders invocation-status false as Failed', () => {
    render(<StatusBadge variant="invocation-status" status="false" />);
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('renders winner true as Winner', () => {
    render(<StatusBadge variant="winner" status="true" />);
    expect(screen.getByText('Winner')).toBeInTheDocument();
  });

  it('renders nothing for winner false', () => {
    const { container } = render(<StatusBadge variant="winner" status="false" />);
    expect(container.innerHTML).toBe('');
  });

  it('renders unknown status with gray fallback', () => {
    render(<StatusBadge variant="run-status" status="unknown_status" />);
    const badge = screen.getByText('Unknown_status');
    expect(badge.className).toContain('bg-gray-100');
  });

  it('renders experiment-status variants', () => {
    render(<StatusBadge variant="experiment-status" status="running" />);
    expect(screen.getByText('Running')).toBeInTheDocument();
  });
});
