/**
 * @jest-environment node
 */
// Unit tests for perIpSpendingGate (Phase 1 of build_website_for_evolutiOn_20260626).
// Uses an in-memory KvAdapter mock — no Upstash dependency at unit-test level.

jest.mock('@/lib/server_utilities', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

import {
  PerIpSpendingGate,
  PerIpBudgetExceededError,
  getClientGeo,
  type KvAdapter,
} from './perIpSpendingGate';

function makeMemoryAdapter(initial: Record<string, number> = {}): KvAdapter & { _map: Map<string, number> } {
  const map = new Map<string, number>(Object.entries(initial));
  return {
    _map: map,
    async incrbyfloat(key, amount) {
      const cur = map.get(key) ?? 0;
      const next = cur + amount;
      map.set(key, next);
      return next;
    },
    async decrbyfloat(key, amount) {
      const cur = map.get(key) ?? 0;
      const next = cur - amount;
      map.set(key, next);
      return next;
    },
    async expire() {},
    async get(key) {
      return map.get(key) ?? 0;
    },
  };
}

describe('PerIpSpendingGate', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv };
    (process.env as Record<string, string | undefined>).E2E_TEST_MODE = undefined;
    (process.env as Record<string, string | undefined>).PUBLIC_EDIT_RATE_LIMIT_DISABLED = undefined;
    (process.env as Record<string, string | undefined>).LLM_GATE_FAIL_CLOSED_DISABLED = undefined;
    (process.env as Record<string, string | undefined>).NODE_ENV = undefined;
  });
  afterAll(() => { process.env = originalEnv; });

  it('reserves under cap successfully', async () => {
    const adapter = makeMemoryAdapter();
    const gate = new PerIpSpendingGate(adapter, 0.5, 5);
    const reserved = await gate.reserveForIp('1.2.3.4', 'US', 0.10);
    expect(reserved).toBe(0.10);
  });

  it('throws when per-IP cap is exceeded and rolls back the over-cap increment', async () => {
    const adapter = makeMemoryAdapter();
    const gate = new PerIpSpendingGate(adapter, 0.5, 5);
    // 5x $0.10 succeeds; 6th would push IP to $0.60 > $0.50 cap
    for (let i = 0; i < 5; i++) {
      await gate.reserveForIp('1.2.3.4', 'US', 0.10);
    }
    await expect(gate.reserveForIp('1.2.3.4', 'US', 0.10))
      .rejects.toBeInstanceOf(PerIpBudgetExceededError);
    // After rejection: IP total should be back to $0.50 (not $0.60)
    const today = new Date().toISOString().split('T')[0]!;
    expect(adapter._map.get(`edit:ip:1.2.3.4:${today}`)).toBeCloseTo(0.5, 5);
  });

  it('throws when per-region cap is exceeded and rolls back both buckets', async () => {
    const adapter = makeMemoryAdapter();
    // Whole-number cap + integer increments avoid float-arithmetic edge cases.
    const gate = new PerIpSpendingGate(adapter, 100, 3);
    await gate.reserveForIp('1.1.1.1', 'US', 1);
    await gate.reserveForIp('2.2.2.2', 'US', 1);
    await gate.reserveForIp('3.3.3.3', 'US', 1);
    // Region total now exactly 3 (== cap, still allowed). 4th call → 4 (> 3) rejects.
    await expect(gate.reserveForIp('4.4.4.4', 'US', 1))
      .rejects.toBeInstanceOf(PerIpBudgetExceededError);
    const today = new Date().toISOString().split('T')[0]!;
    expect(adapter._map.get(`edit:region:US:${today}`)).toBe(3);
    expect(adapter._map.get(`edit:ip:4.4.4.4:${today}`)).toBe(0);
  });

  it('releases a reservation on call failure', async () => {
    const adapter = makeMemoryAdapter();
    const gate = new PerIpSpendingGate(adapter, 0.5, 5);
    await gate.reserveForIp('1.2.3.4', 'US', 0.10);
    await gate.releaseForIp('1.2.3.4', 'US', 0.10);
    const today = new Date().toISOString().split('T')[0]!;
    expect(adapter._map.get(`edit:ip:1.2.3.4:${today}`)).toBeCloseTo(0, 5);
  });

  it('short-circuits to no-op when E2E_TEST_MODE=true', async () => {
    process.env.E2E_TEST_MODE = 'true';
    const adapter = makeMemoryAdapter();
    const gate = new PerIpSpendingGate(adapter, 0.5, 5);
    // Many calls — should all return estCost without touching the adapter
    for (let i = 0; i < 50; i++) {
      const r = await gate.reserveForIp('1.2.3.4', 'US', 0.10);
      expect(r).toBe(0.10);
    }
    expect(adapter._map.size).toBe(0); // no writes
  });

  it('short-circuits to no-op when PUBLIC_EDIT_RATE_LIMIT_DISABLED=true', async () => {
    process.env.PUBLIC_EDIT_RATE_LIMIT_DISABLED = 'true';
    const adapter = makeMemoryAdapter();
    const gate = new PerIpSpendingGate(adapter, 0.5, 5);
    await gate.reserveForIp('1.2.3.4', 'US', 0.10);
    expect(adapter._map.size).toBe(0);
  });

  it('fails CLOSED on KV error (throws PerIpBudgetExceededError)', async () => {
    const failing: KvAdapter = {
      async incrbyfloat() { throw new Error('upstash down'); },
      async decrbyfloat() { return 0; },
      async expire() {},
      async get() { return 0; },
    };
    const gate = new PerIpSpendingGate(failing, 0.5, 5);
    await expect(gate.reserveForIp('1.2.3.4', 'US', 0.10))
      .rejects.toBeInstanceOf(PerIpBudgetExceededError);
  });

  it('reverts to silent-allow on KV error when LLM_GATE_FAIL_CLOSED_DISABLED=true', async () => {
    process.env.LLM_GATE_FAIL_CLOSED_DISABLED = 'true';
    const failing: KvAdapter = {
      async incrbyfloat() { throw new Error('upstash down'); },
      async decrbyfloat() { return 0; },
      async expire() {},
      async get() { return 0; },
    };
    const gate = new PerIpSpendingGate(failing, 0.5, 5);
    const reserved = await gate.reserveForIp('1.2.3.4', 'US', 0.10);
    expect(reserved).toBe(0.10);
  });

  it('remainingForIp returns full cap minus used', async () => {
    const adapter = makeMemoryAdapter();
    const gate = new PerIpSpendingGate(adapter, 0.5, 5);
    await gate.reserveForIp('1.2.3.4', 'US', 0.20);
    const { ipRemaining, regionRemaining } = await gate.remainingForIp('1.2.3.4', 'US');
    expect(ipRemaining).toBeCloseTo(0.30, 5);
    expect(regionRemaining).toBeCloseTo(4.80, 5);
  });
});

describe('getClientGeo', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv };
    (process.env as Record<string, string | undefined>).NODE_ENV = undefined;
  });
  afterAll(() => { process.env = originalEnv; });

  it('returns "unknown" when x-vercel-id is absent (trust assertion)', () => {
    const headers = new Headers({ 'x-forwarded-for': '5.5.5.5', 'x-vercel-ip-country': 'DE' });
    expect(getClientGeo(headers)).toEqual({ ip: 'unknown', country: 'unknown' });
  });

  it('returns parsed IP + country when x-vercel-id is present', () => {
    const headers = new Headers({
      'x-vercel-id': 'iad1::abc',
      'x-forwarded-for': '5.5.5.5, 10.0.0.1',
      'x-vercel-ip-country': 'DE',
    });
    expect(getClientGeo(headers)).toEqual({ ip: '5.5.5.5', country: 'DE' });
  });

  it('honors x-test-client-ip/country when NODE_ENV=test', () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
    const headers = new Headers({
      'x-test-client-ip': '9.9.9.9',
      'x-test-client-country': 'CA',
    });
    expect(getClientGeo(headers)).toEqual({ ip: '9.9.9.9', country: 'CA' });
  });

  it('does NOT honor x-test-client-* when NODE_ENV is not test', () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    const headers = new Headers({
      'x-test-client-ip': '9.9.9.9',
      'x-vercel-id': 'iad1::abc',
      'x-forwarded-for': '1.1.1.1',
    });
    expect(getClientGeo(headers)).toEqual({ ip: '1.1.1.1', country: 'unknown' });
  });
});
