// Tests for EvolutionErrorBoundary: error display, try again button, reset callback.

import { render, screen, fireEvent } from '@testing-library/react';
import EvolutionErrorBoundary from './EvolutionErrorBoundary';

describe('EvolutionErrorBoundary', () => {
  const mockReset = jest.fn();
  const defaultError = new Error('Something broke');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders "Something went wrong" heading', () => {
    render(<EvolutionErrorBoundary error={defaultError} reset={mockReset} />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('displays the error message', () => {
    render(<EvolutionErrorBoundary error={defaultError} reset={mockReset} />);
    expect(screen.getByText('Something broke')).toBeInTheDocument();
  });

  it('renders "Try again" button', () => {
    render(<EvolutionErrorBoundary error={defaultError} reset={mockReset} />);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('calls reset when "Try again" is clicked', () => {
    render(<EvolutionErrorBoundary error={defaultError} reset={mockReset} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mockReset).toHaveBeenCalledTimes(1);
  });

  it('displays different error messages', () => {
    render(<EvolutionErrorBoundary error={new Error('Custom error text')} reset={mockReset} />);
    expect(screen.getByText('Custom error text')).toBeInTheDocument();
  });

  it('has centered text layout', () => {
    const { container } = render(<EvolutionErrorBoundary error={defaultError} reset={mockReset} />);
    expect(container.firstChild).toHaveClass('text-center');
  });
});
