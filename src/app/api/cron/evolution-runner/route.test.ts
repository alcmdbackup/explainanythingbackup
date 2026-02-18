// Unit tests for evolution runner cron endpoint.
// Tests auth, RPC claiming, resume detection, heartbeat cleanup, and error handling.

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

jest.mock('@/lib/utils/cronAuth', () => ({
  requireCronAuth: jest.fn().mockReturnValue(null), // default: auth passes
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
  createEvolutionLogger: jest.fn().mockReturnValue(mockEvolutionLogger),
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
import { requireCronAuth } from '@/lib/utils/cronAuth';
import { executeFullPipeline } from '@/lib/evolution';
import { generateSeedArticle } from '@/lib/evolution/core/seedArticle';
import { NextResponse } from 'next/server';

const mockCreateSupabaseServiceClient = createSupabaseServiceClient as jest.MockedFunction<typeof createSupabaseServiceClient>;
const mockRequireCronAuth = requireCronAuth as jest.MockedFunction<typeof requireCronAuth>;
const mockExecuteFullPipeline = executeFullPipeline as jest.MockedFunction<typeof executeFullPipeline>;
const mockGenerateSeedArticle = generateSeedArticle as jest.MockedFunction<typeof generateSeedArticle>;

describe('Evolution Runner Cron API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireCronAuth.mockReturnValue(null); // auth passes by default
  });

  function createMockRequest(): Request {
    return {
      headers: {
        get: () => 'Bearer test-secret',
      },
    } as unknown as Request;
  }

  /** Build mock supabase that handles the runner's query pattern:
   *  1. supabase.rpc('claim_evolution_run') → returns claimed row(s)
   *  2. supabase.from('explanations').select().eq().single() → content resolution
   *  3. supabase.from('content_evolution_runs').update().eq().in() → status updates
   *  4. supabase.from('content_evolution_runs').update().eq() → heartbeat / runner cleanup
   */
  function buildRunnerMock(opts: {
    claimedRun?: Record<string, unknown> | null;
    claimError?: { message: string } | null;
    explanationData?: Record<string, unknown> | null;
    explanationError?: { message: string } | null;
    topicData?: Record<string, unknown> | null;
    topicError?: { message: string } | null;
  } = {}) {
    const {
      claimedRun = null,
      claimError = null,
      explanationData = null,
      explanationError = null,
      topicData = null,
      topicError = null,
    } = opts;

    const updateMock = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        in: jest.fn().mockResolvedValue({ error: null }),
      }),
    });

    const singleMock = jest.fn().mockResolvedValue({
      data: explanationData,
      error: explanationError,
    });

    const fromMock = jest.fn().mockImplementation((table: string) => {
      if (table === 'explanations') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: singleMock,
            }),
          }),
        };
      }
      if (table === 'hall_of_fame_topics') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: topicData,
                error: topicError,
              }),
            }),
          }),
        };
      }
      // content_evolution_runs
      return {
        update: updateMock,
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
      };
    });

    const rpcMock = jest.fn().mockResolvedValue({
      data: claimedRun ? [claimedRun] : [],
      error: claimError,
    });

    return { fromMock, rpcMock, updateMock, singleMock };
  }

  describe('Authorization', () => {
    it('returns auth error when requireCronAuth rejects', async () => {
      mockRequireCronAuth.mockReturnValue(
        NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      );

      const response = await GET(createMockRequest());
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });
  });

  describe('No Pending Runs', () => {
    it('returns ok status when RPC returns no rows', async () => {
      const { fromMock, rpcMock } = buildRunnerMock();
      mockCreateSupabaseServiceClient.mockResolvedValue({ from: fromMock, rpc: rpcMock } as never);

      const response = await GET(createMockRequest());
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe('ok');
      expect(data.message).toBe('No pending runs');
    });
  });

  describe('RPC Claim Error', () => {
    it('returns 500 when claim RPC fails', async () => {
      const { fromMock, rpcMock } = buildRunnerMock({
        claimError: { message: 'Connection refused' },
      });
      mockCreateSupabaseServiceClient.mockResolvedValue({ from: fromMock, rpc: rpcMock } as never);

      const response = await GET(createMockRequest());
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to claim run');
    });
  });

  describe('Pipeline Execution', () => {
    it('executes full pipeline on successful claim', async () => {
      const { fromMock, rpcMock } = buildRunnerMock({
        claimedRun: { id: 'run-123', explanation_id: 1, config: {}, budget_cap_usd: 5, continuation_count: 0 },
        explanationData: { id: 1, explanation_title: 'Test', content: 'Test content' },
      });
      mockCreateSupabaseServiceClient.mockResolvedValue({ from: fromMock, rpc: rpcMock } as never);
      mockExecuteFullPipeline.mockResolvedValue({ stopReason: 'completed', supervisorState: {} } as never);

      const response = await GET(createMockRequest());
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe('ok');
      expect(mockExecuteFullPipeline).toHaveBeenCalled();
    });

    it('handles pipeline failure gracefully', async () => {
      const { fromMock, rpcMock } = buildRunnerMock({
        claimedRun: { id: 'run-123', explanation_id: 1, config: {}, budget_cap_usd: 5, continuation_count: 0 },
        explanationData: { id: 1, explanation_title: 'Test', content: 'Test content' },
      });
      mockCreateSupabaseServiceClient.mockResolvedValue({ from: fromMock, rpc: rpcMock } as never);
      mockExecuteFullPipeline.mockRejectedValue(new Error('Pipeline crashed'));

      const response = await GET(createMockRequest());
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.status).toBe('error');
      expect(data.error).toBe('Pipeline crashed');
    });
  });

  describe('Error Handling', () => {
    it('returns 404 when explanation is not found', async () => {
      const { fromMock, rpcMock } = buildRunnerMock({
        claimedRun: { id: 'run-123', explanation_id: 999, config: {}, budget_cap_usd: 5, continuation_count: 0 },
        explanationError: { message: 'Not found' },
      });
      mockCreateSupabaseServiceClient.mockResolvedValue({ from: fromMock, rpc: rpcMock } as never);

      const response = await GET(createMockRequest());
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.message).toBe('Explanation not found');
    });
  });

  describe('Prompt-based runs', () => {
    it('generates seed article when explanation_id is null but prompt_id is set', async () => {
      const { fromMock, rpcMock } = buildRunnerMock({
        claimedRun: { id: 'run-prompt', explanation_id: null, config: {}, budget_cap_usd: 5, prompt_id: 'topic-1', continuation_count: 0 },
        topicData: { prompt: 'Explain quantum computing' },
      });
      mockCreateSupabaseServiceClient.mockResolvedValue({ from: fromMock, rpc: rpcMock } as never);
      mockExecuteFullPipeline.mockResolvedValue({ stopReason: 'completed', supervisorState: {} } as never);

      const response = await GET(createMockRequest());
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe('ok');
      expect(mockGenerateSeedArticle).toHaveBeenCalled();
      expect(mockExecuteFullPipeline).toHaveBeenCalled();
    });

    it('marks run failed when explanation_id and prompt_id are both null', async () => {
      const { fromMock, rpcMock } = buildRunnerMock({
        claimedRun: { id: 'run-bad', explanation_id: null, config: {}, budget_cap_usd: 5, prompt_id: null, continuation_count: 0 },
      });
      mockCreateSupabaseServiceClient.mockResolvedValue({ from: fromMock, rpc: rpcMock } as never);

      const response = await GET(createMockRequest());
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.message).toBe('Run has no explanation_id and no prompt_id');
      expect(mockExecuteFullPipeline).not.toHaveBeenCalled();
    });

    it('marks run failed when seed generation throws', async () => {
      const { fromMock, rpcMock } = buildRunnerMock({
        claimedRun: { id: 'run-seed-fail', explanation_id: null, config: {}, budget_cap_usd: 5, prompt_id: 'topic-1', continuation_count: 0 },
        topicData: { prompt: 'Explain quantum computing' },
      });
      mockCreateSupabaseServiceClient.mockResolvedValue({ from: fromMock, rpc: rpcMock } as never);
      mockGenerateSeedArticle.mockRejectedValueOnce(new Error('LLM timeout'));

      const response = await GET(createMockRequest());
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.message).toBe('Content resolution failed');
      expect(data.error).toContain('LLM timeout');
      expect(mockExecuteFullPipeline).not.toHaveBeenCalled();
    });
  });

  describe('Continuation-passing', () => {
    it('treats continuation_timeout as non-terminal (runner clears via buildResponse)', async () => {
      const { fromMock, rpcMock } = buildRunnerMock({
        claimedRun: { id: 'run-cont', explanation_id: 1, config: {}, budget_cap_usd: 5, continuation_count: 0 },
        explanationData: { id: 1, explanation_title: 'Test', content: 'Test content' },
      });
      mockCreateSupabaseServiceClient.mockResolvedValue({ from: fromMock, rpc: rpcMock } as never);
      mockExecuteFullPipeline.mockResolvedValue({ stopReason: 'continuation_timeout' } as never);

      const response = await GET(createMockRequest());
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.message).toBe('Run yielded for continuation');
      expect(data.stopReason).toBe('continuation_timeout');
    });
  });
});
