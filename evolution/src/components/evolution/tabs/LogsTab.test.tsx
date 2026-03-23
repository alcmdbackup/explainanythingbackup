// Tests for shared LogsTab component.

import { render, screen, waitFor } from '@testing-library/react';
import { LogsTab } from './LogsTab';

const mockLogs = [
  {
    id: 1,
    created_at: '2026-03-23T10:00:00Z',
    level: 'info',
    agent_name: 'generation',
    iteration: 1,
    variant_id: null,
    message: 'Starting generation',
    context: null,
    entity_type: 'run',
    entity_id: 'run-1',
  },
  {
    id: 2,
    created_at: '2026-03-23T10:01:00Z',
    level: 'warn',
    agent_name: 'ranking',
    iteration: 1,
    variant_id: null,
    message: 'Triage eliminated 2 variants',
    context: { eliminated: 2 },
    entity_type: 'invocation',
    entity_id: 'inv-1',
  },
];

jest.mock('@evolution/services/logActions', () => ({
  getEntityLogsAction: jest.fn(() =>
    Promise.resolve({ success: true, data: { items: mockLogs, total: 2 } }),
  ),
}));

describe('LogsTab', () => {
  it('renders log entries after loading', async () => {
    render(<LogsTab entityType="run" entityId="run-1" />);
    await waitFor(() => {
      expect(screen.getByText('Starting generation')).toBeInTheDocument();
    });
    expect(screen.getByText('Triage eliminated 2 variants')).toBeInTheDocument();
  });

  it('shows entity type badges', async () => {
    render(<LogsTab entityType="run" entityId="run-1" />);
    await waitFor(() => {
      expect(screen.getByText('run')).toBeInTheDocument();
    });
    expect(screen.getByText('invocation')).toBeInTheDocument();
  });

  it('shows total count', async () => {
    render(<LogsTab entityType="run" entityId="run-1" />);
    await waitFor(() => {
      expect(screen.getByText('2 logs')).toBeInTheDocument();
    });
  });

  it('renders filter controls', async () => {
    render(<LogsTab entityType="run" entityId="run-1" />);
    await waitFor(() => {
      expect(screen.getByLabelText('Filter by level')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Filter by entity type')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by agent name')).toBeInTheDocument();
  });

  it('has data-testid for testing', async () => {
    render(<LogsTab entityType="run" entityId="run-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('logs-tab')).toBeInTheDocument();
    });
  });
});
