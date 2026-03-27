// Tests for reusable ConfirmDialog component.

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('renders title and message when open', () => {
    render(
      <ConfirmDialog open onClose={jest.fn()} title="Delete?" message="Are you sure?" onConfirm={jest.fn()} />,
    );
    expect(screen.getByText('Delete?')).toBeInTheDocument();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <ConfirmDialog open={false} onClose={jest.fn()} title="X" message="Y" onConfirm={jest.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('calls onConfirm and onClose on confirm click', async () => {
    const onConfirm = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();
    render(
      <ConfirmDialog open onClose={onClose} title="Delete?" message="Sure?" onConfirm={onConfirm} confirmLabel="Yes" />,
    );
    fireEvent.click(screen.getByText('Yes'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('renders danger variant with custom confirm label', () => {
    render(
      <ConfirmDialog open onClose={jest.fn()} title="Danger" message="Bad stuff" onConfirm={jest.fn()} danger confirmLabel="Destroy" />,
    );
    const btn = screen.getByText('Destroy');
    expect(btn.className).toContain('bg-[var(--status-error)]');
  });
});
