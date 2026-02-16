// Unit tests for the shared cron auth helper (fail-closed behavior).

import { requireCronAuth } from './cronAuth';

describe('requireCronAuth', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function createMockRequest(authHeader?: string): Request {
    const headersMap: Record<string, string> = {};
    if (authHeader) headersMap['authorization'] = authHeader;
    return {
      headers: { get: (name: string) => headersMap[name.toLowerCase()] ?? null },
    } as unknown as Request;
  }

  it('returns 500 when CRON_SECRET is not configured', () => {
    delete process.env.CRON_SECRET;

    const result = requireCronAuth(createMockRequest());
    expect(result).not.toBeNull();
    expect(result!.status).toBe(500);
  });

  it('returns 401 when CRON_SECRET is set but auth header is missing', () => {
    process.env.CRON_SECRET = 'my-secret';

    const result = requireCronAuth(createMockRequest());
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it('returns 401 when auth header does not match', () => {
    process.env.CRON_SECRET = 'my-secret';

    const result = requireCronAuth(createMockRequest('Bearer wrong'));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it('returns null (pass) when auth header matches CRON_SECRET', () => {
    process.env.CRON_SECRET = 'my-secret';

    const result = requireCronAuth(createMockRequest('Bearer my-secret'));
    expect(result).toBeNull();
  });

  it('returns 500 when CRON_SECRET is empty string', () => {
    process.env.CRON_SECRET = '';

    const result = requireCronAuth(createMockRequest());
    expect(result).not.toBeNull();
    expect(result!.status).toBe(500);
  });
});
