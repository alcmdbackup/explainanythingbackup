// Unit tests for evolution runner cron endpoint.
// Tests auth, FIFO ordering, atomic claiming, heartbeat cleanup, and error handling.

import { GET } from './route';

// Mock dependencies
jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn(),
}));

jest.mock('@/lib/server_utilities', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('@/lib/evolution/core/featureFlags', () => ({
  getFeatureFlags: jest.fn(),
}));

const mockEvolutionLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

const mockAgents = {
  generation: {},
  calibration: {},
  tournament: {},
  evolution: {},
  reflection: {},
  iterativeEditing: {},
  debate: {},
  proximity: {},
  metaReview: {},
  outlineGeneration: {},
  treeSearch: {},
  sectionDecomposition: {},
};

jest.mock('@/lib/evolution/core/seedArticle', () => ({
  generateSeedArticle: jest.fn().mockResolvedValue({
    title: 'Generated Title',
    content: '# Generated Title\n\nGenerated content...',
  }),
}));

jest.mock('@/lib/evolution/core/costTracker', () => ({
  createCostTracker: jest.fn().mockReturnValue({
    getTotalSpent: jest.fn().mockReturnValue(0),
    getAvailableBudget: jest.fn().mockReturnValue(5),
    reserveBudget: jest.fn(),
    recordSpend: jest.fn(),
    getAgentCost: jest.fn().mockReturnValue(0),
    getAllAgentCosts: jest.fn().mockReturnValue({}),
  }),
}));

jest.mock('@/lib/evolution/core/logger', () => ({
  createEvolutionLogger: jest.fn().mockReturnValue({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

jest.mock('@/lib/evolution/config', () => ({
  resolveConfig: jest.fn().mockReturnValue({ budgetCapUsd: 5 }),
}));

jest.mock('@/lib/evolution', () => ({
  executeFullPipeline: jest.fn(),
  createEvolutionLLMClient: jest.fn().mockReturnValue({
    complete: jest.fn(),
    completeStructured: jest.fn(),
  }),
  preparePipelineRun: jest.fn().mockReturnValue({
    ctx: {
      logger: mockEvolutionLogger,
      state: { pool: [], iteration: 0, originalText: 'test' },
      costTracker: {
        getTotalSpent: jest.fn().mockReturnValue(0),
        getAvailableBudget: jest.fn().mockReturnValue(5),
      },
    },
    agents: mockAgents,
    config: {},
    costTracker: {
      getTotalSpent: jest.fn().mockReturnValue(0),
      getAvailableBudget: jest.fn().mockReturnValue(5),
    },
    logger: mockEvolutionLogger,
  }),
}));

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { getFeatureFlags } from '@/lib/evolution/core/featureFlags';
import { executeFullPipeline } from '@/lib/evolution';
import { generateSeedArticle } from '@/lib/evolution/core/seedArticle';

const mockCreateSupabaseServiceClient = createSupabaseServiceClient as jest.MockedFunction<typeof createSupabaseServiceClient>;
const mockGetFeatureFlags = getFeatureFlags as jest.MockedFunction<typeof getFeatureFlags>;
const mockExecuteFullPipeline = executeFullPipeline as jest.MockedFunction<typeof executeFullPipeline>;
const mockGenerateSeedArticle = generateSeedArticle as jest.MockedFunction<typeof generateSeedArticle>;

describe('Evolution Runner Cron API', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv, CRON_SECRET: 'test-secret' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function createMockRequest(authHeader?: string): Request {
    const headersMap: Record<string, string> = {};
    if (authHeader) {
      headersMap['authorization'] = authHeader;
    }
    return {
      headers: {
        get: (name: string) => headersMap[name.toLowerCase()] ?? null,
      },
    } as unknown as Request;
  }

  function createMockSupabase(overrides: Record<string, unknown> = {}) {
    const chain: Record<string, jest.Mock> = {
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      single: jest.fn(),
      maybeSingle: jest.fn(),
    };
    return {
      from: jest.fn().mockReturnValue({ ...chain, ...overrides }),
      ...overrides,
    };
  }

  describe('Authorization', () => {
    it('returns 401 when CRON_SECRET is set but auth header is missing', async () => {
      const request = createMockRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });

    it('returns 401 when auth header does not match CRON_SECRET', async () => {
      const request = createMockRequest('Bearer wrong-secret');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });

    it('allows access when auth header matches CRON_SECRET', async () => {
      const mockSupabase = createMockSupabase();
      mockSupabase.from().maybeSingle.mockResolvedValue({ data: null, error: null });
      mockCreateSupabaseServiceClient.mockResolvedValue(mockSupabase as never);

      const request = createMockRequest('Bearer test-secret');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.message).toBe('No pending runs');
    });

    it('returns 500 when CRON_SECRET is not set (fail-closed)', async () => {
      delete process.env.CRON_SECRET;

      const request = createMockRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Server misconfiguration: CRON_SECRET not set');
    });
  });

  describe('No Pending Runs', () => {
    it('returns ok status when no pending runs exist', async () => {
      const mockSupabase = createMockSupabase();
      mockSupabase.from().maybeSingle.mockResolvedValue({ data: null, error: null });
      mockCreateSupabaseServiceClient.mockResolvedValue(mockSupabase as never);

      const request = createMockRequest('Bearer test-secret');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe('ok');
      expect(data.message).toBe('No pending runs');
      expect(data.timestamp).toBeDefined();
    });
  });

  describe('Run Claiming', () => {
    it('handles race condition when run is claimed by another runner', async () => {
      const mockSupabase = createMockSupabase();
      // First call: find pending run
      mockSupabase.from().maybeSingle
        .mockResolvedValueOnce({
          data: { id: 'run-123', explanation_id: 1, config: {}, budget_cap_usd: 5 },
          error: null,
        })
        // Second call: claim fails (another runner claimed it)
        .mockResolvedValueOnce({ data: null, error: null });

      mockCreateSupabaseServiceClient.mockResolvedValue(mockSupabase as never);

      const request = createMockRequest('Bearer test-secret');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.message).toBe('Run claimed by another runner');
      expect(data.runId).toBe('run-123');
    });
  });

  describe('Pipeline Execution', () => {
    it('executes full pipeline on successful claim', async () => {
      const mockSupabase = createMockSupabase();
      // Find pending run
      mockSupabase.from().maybeSingle
        .mockResolvedValueOnce({
          data: { id: 'run-123', explanation_id: 1, config: {}, budget_cap_usd: 5 },
          error: null,
        })
        // Claim succeeds
        .mockResolvedValueOnce({ data: { id: 'run-123' }, error: null });

      // Get explanation
      mockSupabase.from().single.mockResolvedValue({
        data: { id: 1, explanation_title: 'Test', content: 'Test content' },
        error: null,
      });

      mockCreateSupabaseServiceClient.mockResolvedValue(mockSupabase as never);
      mockGetFeatureFlags.mockReturnValue({} as never);
      mockExecuteFullPipeline.mockResolvedValue({ stopReason: 'completed', supervisorState: {} } as never);

      const request = createMockRequest('Bearer test-secret');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe('ok');
      expect(data.message).toBe('Run completed');
      expect(data.stopReason).toBe('completed');
      expect(mockExecuteFullPipeline).toHaveBeenCalled();
    });

    it('passes all 10 agents to executeFullPipeline', async () => {
      const mockSupabase = createMockSupabase();
      mockSupabase.from().maybeSingle
        .mockResolvedValueOnce({
          data: { id: 'run-123', explanation_id: 1, config: {}, budget_cap_usd: 5 },
          error: null,
        })
        .mockResolvedValueOnce({ data: { id: 'run-123' }, error: null });

      mockSupabase.from().single.mockResolvedValue({
        data: { id: 1, explanation_title: 'Test', content: 'Test content' },
        error: null,
      });

      mockCreateSupabaseServiceClient.mockResolvedValue(mockSupabase as never);
      mockGetFeatureFlags.mockReturnValue({} as never);
      mockExecuteFullPipeline.mockResolvedValue({ stopReason: 'completed', supervisorState: {} } as never);

      const request = createMockRequest('Bearer test-secret');
      await GET(request);

      // Verify executeFullPipeline was called with agents object containing all 9 agents
      expect(mockExecuteFullPipeline).toHaveBeenCalledWith(
        'run-123',
        expect.objectContaining({
          generation: expect.anything(),
          calibration: expect.anything(),
          tournament: expect.anything(),
          evolution: expect.anything(),
          reflection: expect.anything(),
          iterativeEditing: expect.anything(),
          debate: expect.anything(),
          proximity: expect.anything(),
          metaReview: expect.anything(),
          outlineGeneration: expect.anything(),
        }),
        expect.anything(), // ctx
        expect.anything(), // evolutionLogger
        expect.objectContaining({
          startMs: expect.any(Number),
          featureFlags: expect.anything(),
        }),
      );
    });

    it('handles pipeline failure gracefully', async () => {
      const mockSupabase = createMockSupabase();
      // Find pending run
      mockSupabase.from().maybeSingle
        .mockResolvedValueOnce({
          data: { id: 'run-123', explanation_id: 1, config: {}, budget_cap_usd: 5 },
          error: null,
        })
        // Claim succeeds
        .mockResolvedValueOnce({ data: { id: 'run-123' }, error: null });

      // Get explanation
      mockSupabase.from().single.mockResolvedValue({
        data: { id: 1, explanation_title: 'Test', content: 'Test content' },
        error: null,
      });

      mockCreateSupabaseServiceClient.mockResolvedValue(mockSupabase as never);
      mockGetFeatureFlags.mockReturnValue({} as never);
      mockExecuteFullPipeline.mockRejectedValue(new Error('Pipeline crashed'));

      const request = createMockRequest('Bearer test-secret');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.status).toBe('error');
      expect(data.error).toBe('Pipeline crashed');
    });
  });

  describe('Error Handling', () => {
    it('returns 500 on database query error', async () => {
      const mockSupabase = createMockSupabase();
      mockSupabase.from().maybeSingle.mockResolvedValue({
        data: null,
        error: { message: 'Connection refused' },
      });
      mockCreateSupabaseServiceClient.mockResolvedValue(mockSupabase as never);

      const request = createMockRequest('Bearer test-secret');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to query pending runs');
    });

    it('returns 404 when explanation is not found', async () => {
      const mockSupabase = createMockSupabase();
      // Find pending run
      mockSupabase.from().maybeSingle
        .mockResolvedValueOnce({
          data: { id: 'run-123', explanation_id: 999, config: {}, budget_cap_usd: 5 },
          error: null,
        })
        // Claim succeeds
        .mockResolvedValueOnce({ data: { id: 'run-123' }, error: null });

      // Explanation not found
      mockSupabase.from().single.mockResolvedValue({
        data: null,
        error: { message: 'Not found' },
      });

      mockCreateSupabaseServiceClient.mockResolvedValue(mockSupabase as never);
      mockGetFeatureFlags.mockReturnValue({} as never);

      const request = createMockRequest('Bearer test-secret');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.message).toBe('Explanation not found');
    });
  });

  describe('Prompt-based runs', () => {
    it('generates seed article when explanation_id is null but prompt_id is set', async () => {
      const mockSupabase = createMockSupabase();
      // Find pending run with null explanation_id + prompt_id
      mockSupabase.from().maybeSingle
        .mockResolvedValueOnce({
          data: { id: 'run-prompt', explanation_id: null, config: {}, budget_cap_usd: 5, prompt_id: 'topic-1' },
          error: null,
        })
        // Claim succeeds
        .mockResolvedValueOnce({ data: { id: 'run-prompt' }, error: null });

      // Fetch prompt text from hall_of_fame_topics
      mockSupabase.from().single.mockResolvedValue({
        data: { prompt: 'Explain quantum computing' },
        error: null,
      });

      mockCreateSupabaseServiceClient.mockResolvedValue(mockSupabase as never);
      mockGetFeatureFlags.mockReturnValue({} as never);
      mockExecuteFullPipeline.mockResolvedValue({ stopReason: 'completed', supervisorState: {} } as never);

      const request = createMockRequest('Bearer test-secret');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe('ok');
      expect(data.message).toBe('Run completed');
      expect(mockGenerateSeedArticle).toHaveBeenCalled();
      expect(mockExecuteFullPipeline).toHaveBeenCalled();
    });

    it('marks run failed when explanation_id is null and prompt_id is null', async () => {
      const mockSupabase = createMockSupabase();
      // Find pending run with null explanation_id + null prompt_id
      mockSupabase.from().maybeSingle
        .mockResolvedValueOnce({
          data: { id: 'run-bad', explanation_id: null, config: {}, budget_cap_usd: 5, prompt_id: null },
          error: null,
        })
        // Claim succeeds
        .mockResolvedValueOnce({ data: { id: 'run-bad' }, error: null });

      mockCreateSupabaseServiceClient.mockResolvedValue(mockSupabase as never);
      mockGetFeatureFlags.mockReturnValue({} as never);

      const request = createMockRequest('Bearer test-secret');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.message).toBe('Run has no explanation_id and no prompt_id');
      expect(mockExecuteFullPipeline).not.toHaveBeenCalled();
    });

    it('marks run failed when seed generation throws (claimed → failed, not orphaned)', async () => {
      const mockSupabase = createMockSupabase();
      mockSupabase.from().maybeSingle
        .mockResolvedValueOnce({
          data: { id: 'run-seed-fail', explanation_id: null, config: {}, budget_cap_usd: 5, prompt_id: 'topic-1' },
          error: null,
        })
        .mockResolvedValueOnce({ data: { id: 'run-seed-fail' }, error: null });

      // Fetch prompt succeeds
      mockSupabase.from().single.mockResolvedValue({
        data: { prompt: 'Explain quantum computing' },
        error: null,
      });

      mockCreateSupabaseServiceClient.mockResolvedValue(mockSupabase as never);
      mockGetFeatureFlags.mockReturnValue({} as never);
      mockGenerateSeedArticle.mockRejectedValueOnce(new Error('LLM timeout'));

      const request = createMockRequest('Bearer test-secret');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.message).toBe('Content resolution failed');
      expect(data.error).toContain('LLM timeout');
      // markRunFailed should have been called (update with status='failed')
      expect(mockSupabase.from().update).toHaveBeenCalled();
      expect(mockExecuteFullPipeline).not.toHaveBeenCalled();
    });

  });
});
