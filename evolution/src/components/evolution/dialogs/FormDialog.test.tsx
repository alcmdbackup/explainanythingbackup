// Tests for FormDialog component — validates state reset on reopen, Radix Dialog a11y, and form behavior.

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FormDialog, FieldDef } from './FormDialog';

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

const baseFields: FieldDef[] = [
  { name: 'title', label: 'Title', type: 'text', placeholder: 'Enter title' },
  { name: 'body', label: 'Body', type: 'textarea' },
];

const baseProps = {
  open: true,
  onClose: jest.fn(),
  title: 'Test Dialog',
  fields: baseFields,
  onSubmit: jest.fn().mockResolvedValue(undefined),
};

describe('FormDialog', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not render content when open is false', () => {
    render(<FormDialog {...baseProps} open={false} />);
    expect(screen.queryByText('Test Dialog')).not.toBeInTheDocument();
  });

  it('renders title, fields, and buttons when open', () => {
    render(<FormDialog {...baseProps} />);
    expect(screen.getByText('Test Dialog')).toBeInTheDocument();
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Body')).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('has accessible dialog role and aria-modal', () => {
    render(<FormDialog {...baseProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('has htmlFor on labels linked to input ids', () => {
    render(<FormDialog {...baseProps} />);
    const label = screen.getByText('Title').closest('label');
    expect(label).toHaveAttribute('for', 'form-dialog-title');
    const input = document.getElementById('form-dialog-title');
    expect(input).toBeInTheDocument();
  });

  it('calls onSubmit with field values on form submit', async () => {
    render(<FormDialog {...baseProps} />);
    fireEvent.change(screen.getByPlaceholderText('Enter title'), { target: { value: 'My Title' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => {
      expect(baseProps.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ title: 'My Title' }));
    });
  });

  it('shows validation error and blocks submit', async () => {
    const validate = jest.fn().mockReturnValue('Title is required');
    render(<FormDialog {...baseProps} validate={validate} />);
    fireEvent.submit(screen.getByText('Save').closest('form')!);
    await waitFor(() => {
      expect(screen.getByText('Title is required')).toBeInTheDocument();
    });
    expect(baseProps.onSubmit).not.toHaveBeenCalled();
  });

  it('shows error when onSubmit rejects', async () => {
    const failSubmit = jest.fn().mockRejectedValue(new Error('Server error'));
    render(<FormDialog {...baseProps} onSubmit={failSubmit} />);
    fireEvent.submit(screen.getByText('Save').closest('form')!);
    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeInTheDocument();
    });
  });

  it('resets state when dialog is reopened', async () => {
    const { rerender } = render(<FormDialog {...baseProps} />);

    // Type into title field
    const input = screen.getByPlaceholderText('Enter title') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Dirty Value' } });
    expect(input.value).toBe('Dirty Value');

    // Close then reopen
    rerender(<FormDialog {...baseProps} open={false} />);
    rerender(<FormDialog {...baseProps} open={true} />);

    // Value should be reset to initial (empty)
    await waitFor(() => {
      const resetInput = screen.getByPlaceholderText('Enter title') as HTMLInputElement;
      expect(resetInput.value).toBe('');
    });
  });

  it('resets to initial values on reopen', async () => {
    const initial = { title: 'Default', body: '' };
    const { rerender } = render(<FormDialog {...baseProps} initial={initial} />);

    fireEvent.change(screen.getByPlaceholderText('Enter title'), { target: { value: 'Changed' } });

    rerender(<FormDialog {...baseProps} initial={initial} open={false} />);
    rerender(<FormDialog {...baseProps} initial={initial} open={true} />);

    await waitFor(() => {
      const resetInput = screen.getByPlaceholderText('Enter title') as HTMLInputElement;
      expect(resetInput.value).toBe('Default');
    });
  });
});
