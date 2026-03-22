// Tests for FormDialog component - verifies open/close, field rendering, validation, and submit.

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

  it('renders nothing when open is false', () => {
    const { container } = render(<FormDialog {...baseProps} open={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders title, fields, and buttons when open', () => {
    render(<FormDialog {...baseProps} />);
    expect(screen.getByText('Test Dialog')).toBeInTheDocument();
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Body')).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
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
});
