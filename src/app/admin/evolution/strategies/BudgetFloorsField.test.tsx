// Tests for BudgetFloorsField-equivalent functionality in the new strategy creation wizard.
// The budget floor controls now live in strategies/new/page.tsx as inline form fields.

import { render, screen, fireEvent } from '@testing-library/react';

// Mock Next.js navigation
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

jest.mock('@evolution/services/strategyRegistryActions', () => ({
  createStrategyAction: jest.fn().mockResolvedValue({ success: true, data: { id: 'new-id' } }),
}));

import NewStrategyPage from './new/page';

describe('NewStrategyPage budget floor controls', () => {
  beforeEach(() => {
    mockPush.mockReset();
  });

  it('renders agent multiple mode by default in advanced settings', async () => {
    render(<NewStrategyPage />);
    // Open advanced settings
    const advanced = screen.getByText(/advanced settings/i);
    fireEvent.click(advanced);

    const modeSelect = screen.getByDisplayValue('Multiple of agent cost');
    expect(modeSelect).toBeInTheDocument();
  });

  it('shows parallel and sequential floor inputs', () => {
    render(<NewStrategyPage />);
    const advanced = screen.getByText(/advanced settings/i);
    fireEvent.click(advanced);

    expect(screen.getByLabelText(/parallel floor/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/sequential floor/i)).toBeInTheDocument();
  });

  it('switches to fraction mode', () => {
    render(<NewStrategyPage />);
    const advanced = screen.getByText(/advanced settings/i);
    fireEvent.click(advanced);

    const modeSelect = screen.getByDisplayValue('Multiple of agent cost');
    fireEvent.change(modeSelect, { target: { value: 'fraction' } });
    expect(screen.getByDisplayValue('Fraction of budget')).toBeInTheDocument();
  });

  it('clears floor values when switching mode', () => {
    render(<NewStrategyPage />);
    const advanced = screen.getByText(/advanced settings/i);
    fireEvent.click(advanced);

    // Enter a parallel floor value
    const parallelInput = screen.getByLabelText(/parallel floor/i);
    fireEvent.change(parallelInput, { target: { value: '0.3' } });
    expect(parallelInput).toHaveValue(0.3);

    // Switch mode — values should reset
    const modeSelect = screen.getByDisplayValue('Multiple of agent cost');
    fireEvent.change(modeSelect, { target: { value: 'fraction' } });

    const parallelInputAfter = screen.getByLabelText(/parallel floor/i);
    expect(parallelInputAfter).toHaveValue(null);
  });
});
