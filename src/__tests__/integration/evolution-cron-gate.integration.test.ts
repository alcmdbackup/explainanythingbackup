// Integration test for evolution cron gate: verifies GET endpoint skips when EVOLUTION_CRON_ENABLED is not set.
// Uses real route handler imports — no HTTP server needed.

import { GET } from '@/app/api/evolution/run/route';

// Mock dependencies that the route imports
jest.mock('@/lib/utils/cronAuth', () => ({
  requireCronAuth: jest.fn().mockReturnValue(null),
}));
jest.mock('@/lib/services/adminAuth', () => ({
  requireAdmin: jest.fn(),
}));
jest.mock('@evolution/services/evolutionRunnerCore', () => ({
  claimAndExecuteEvolutionRun: jest.fn().mockResolvedValue({ claimed: false }),
}));
jest.mock('@/lib/server_utilities', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { claimAndExecuteEvolutionRun } from '@evolution/services/evolutionRunnerCore';

const mockClaimAndExecute = claimAndExecuteEvolutionRun as jest.MockedFunction<typeof claimAndExecuteEvolutionRun>;

describe('Evolution Cron Gate Integration', () => {
  const originalEnv = process.env.EVOLUTION_CRON_ENABLED;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.EVOLUTION_CRON_ENABLED;
    } else {
      process.env.EVOLUTION_CRON_ENABLED = originalEnv;
    }
    jest.clearAllMocks();
  });

  it('GET returns skipped response when EVOLUTION_CRON_ENABLED is not set', async () => {
    delete process.env.EVOLUTION_CRON_ENABLED;

    const request = new Request('http://localhost/api/evolution/run', { method: 'GET' });
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.skipped).toBe(true);
    expect(data.reason).toContain('EVOLUTION_CRON_ENABLED');
    expect(mockClaimAndExecute).not.toHaveBeenCalled();
  });

  it('GET proceeds to claim when EVOLUTION_CRON_ENABLED=true', async () => {
    process.env.EVOLUTION_CRON_ENABLED = 'true';
    mockClaimAndExecute.mockResolvedValue({ claimed: false });

    const request = new Request('http://localhost/api/evolution/run', { method: 'GET' });
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.skipped).toBeUndefined();
    expect(mockClaimAndExecute).toHaveBeenCalled();
  });

  it('GET skipped response when EVOLUTION_CRON_ENABLED=false', async () => {
    process.env.EVOLUTION_CRON_ENABLED = 'false';

    const request = new Request('http://localhost/api/evolution/run', { method: 'GET' });
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.skipped).toBe(true);
    expect(mockClaimAndExecute).not.toHaveBeenCalled();
  });
});
