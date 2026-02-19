// Unit tests for evolutionBatchActions: validates input clamping and error handling for batch dispatch.

// Mock dependencies before importing
jest.mock('@/lib/services/adminAuth', () => ({
  requireAdmin: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  withLogging: (fn: Function, _name: string) => fn,
}));
jest.mock('@/lib/server_utilities', () => ({
  logger: { info: jest.fn(), error: jest.fn() },
}));

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('dispatchEvolutionBatchAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GITHUB_TOKEN = 'test-token';
    process.env.GITHUB_REPO = 'TestOrg/test-repo';
  });

  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_REPO;
  });

  it('returns error when GITHUB_TOKEN is missing', async () => {
    delete process.env.GITHUB_TOKEN;

    const { dispatchEvolutionBatchAction } = await import('./evolutionBatchActions');
    const result = await dispatchEvolutionBatchAction({ parallel: 3, maxRuns: 10, dryRun: false });

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('GITHUB_TOKEN not configured');
  });

  it('dispatches workflow with correct parameters', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    const { dispatchEvolutionBatchAction } = await import('./evolutionBatchActions');
    const result = await dispatchEvolutionBatchAction({ parallel: 3, maxRuns: 10, dryRun: true });

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/TestOrg/test-repo/actions/workflows/evolution-batch.yml/dispatches',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"parallel":"3"'),
      }),
    );
  });

  it('clamps parallel to 1-10 range', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    const { dispatchEvolutionBatchAction } = await import('./evolutionBatchActions');
    await dispatchEvolutionBatchAction({ parallel: 25, maxRuns: 10, dryRun: false });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.inputs.parallel).toBe('10');
  });

  it('clamps maxRuns to 1-100 range', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    const { dispatchEvolutionBatchAction } = await import('./evolutionBatchActions');
    await dispatchEvolutionBatchAction({ parallel: 3, maxRuns: 200, dryRun: false });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.inputs['max-runs']).toBe('100');
  });

  it('returns error on GitHub API failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403, text: async () => 'Forbidden' });

    const { dispatchEvolutionBatchAction } = await import('./evolutionBatchActions');
    const result = await dispatchEvolutionBatchAction({ parallel: 3, maxRuns: 10, dryRun: false });

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('GitHub API error (403)');
  });
});
