// Shared test utilities for evolution component tests.
// Provides navigation mocks and fixture factories used across all test files.

import type { EvolutionRun } from '@evolution/services/evolutionActions';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockSearchParams = new URLSearchParams();

export function mockNextNavigation(initialSearchParams?: URLSearchParams) {
  mockSearchParams = initialSearchParams ?? new URLSearchParams();
  mockPush.mockClear();
  mockReplace.mockClear();
  mockBack.mockClear();

  jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack, prefetch: jest.fn() }),
    useParams: () => ({}),
    useSearchParams: () => mockSearchParams,
    usePathname: () => '/test',
  }));

  return { mockPush, mockReplace, mockBack, mockSearchParams };
}

export function getMockRouter() {
  return { mockPush, mockReplace, mockBack, mockSearchParams };
}

export function createRunFixture(overrides: Partial<EvolutionRun> = {}): EvolutionRun {
  return {
    id: 'run-001',
    status: 'completed',
    phase: 'COMPETITION',
    current_iteration: 10,
    total_cost_usd: 1.5,
    budget_cap_usd: 5.0,
    prompt_id: 'prompt-001',
    strategy_config_id: 'strategy-001',
    experiment_id: 'exp-001',
    explanation_id: 1,
    started_at: '2026-01-01T00:00:00Z',
    completed_at: '2026-01-01T01:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    error_message: null,
    ...overrides,
  } as EvolutionRun;
}

export interface VariantFixture {
  id: string;
  run_id: string;
  agent_name: string;
  elo_rating: number;
  generation: number;
  is_winner: boolean;
  invocation_id: string | null;
  created_at: string;
  content?: string;
}

export function createVariantFixture(overrides: Partial<VariantFixture> = {}): VariantFixture {
  return {
    id: 'variant-001',
    run_id: 'run-001',
    agent_name: 'improver',
    elo_rating: 1200,
    generation: 1,
    is_winner: false,
    invocation_id: 'inv-001',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}
