// Per-IP + per-region spending gate for the public /edit surface (Phase 1 of
// build_website_for_evolutiOn_20260626).
//
// Architecture:
// - Keys are `edit:ip:{ip}:{YYYY-MM-DD}` and `edit:region:{country}:{YYYY-MM-DD}`.
// - Values are cents-spent-today (NUMERIC). Reserved via INCRBYFLOAT with 24h TTL.
// - Eager reservation: reserve $est at submit time; release/decrement on call failure.
//   NOT auto-released on downstream per-user/global cap failures (over-projection is
//   the defense; max-leak bounded by evolution_runs.budget_cap_usd).
// - Fail-CLOSED on Upstash error (consistent with LLMSpendingGate Phase 0 contract).
//   `LLM_GATE_FAIL_CLOSED_DISABLED='true'` reverts to silent-allow for the staged rollout.
// - Test bypass: `E2E_TEST_MODE='true'` OR `PUBLIC_EDIT_RATE_LIMIT_DISABLED='true'`
//   short-circuits to no-op so CI workers (shared egress IP) don't trip the cap mid-suite.
//
// KvAdapter interface: the gate calls a small (incrbyfloat, decrbyfloat, expire) adapter
// so unit tests inject a Map-backed in-memory implementation without spinning up Upstash.

import { logger } from '@/lib/server_utilities';

/** Minimal KV interface the gate depends on. */
export interface KvAdapter {
  /** Atomic increment by amount; returns the new total. */
  incrbyfloat(key: string, amount: number): Promise<number>;
  /** Atomic decrement (clamped at 0 by caller convention; the adapter just subtracts). */
  decrbyfloat(key: string, amount: number): Promise<number>;
  /** Set TTL in seconds. Best-effort. */
  expire(key: string, seconds: number): Promise<void>;
  /** Read current value (for the affordability-check helper); 0 when missing. */
  get(key: string): Promise<number>;
}

/** Structured error for per-IP / per-region rejection. */
export class PerIpBudgetExceededError extends Error {
  readonly scope: 'ip' | 'region';
  readonly key: string;
  readonly current: number;
  readonly cap: number;
  constructor(scope: 'ip' | 'region', key: string, current: number, cap: number) {
    super(`Daily ${scope} budget exceeded: $${current.toFixed(2)} of $${cap.toFixed(2)} cap`);
    this.scope = scope;
    this.key = key;
    this.current = current;
    this.cap = cap;
    this.name = 'PerIpBudgetExceededError';
  }
}

function todayKey(): string {
  return new Date().toISOString().split('T')[0]!;
}

function ipKey(ip: string): string {
  return `edit:ip:${ip}:${todayKey()}`;
}

function regionKey(country: string): string {
  return `edit:region:${country}:${todayKey()}`;
}

function testBypassEnabled(): boolean {
  return (
    process.env.E2E_TEST_MODE === 'true' ||
    process.env.PUBLIC_EDIT_RATE_LIMIT_DISABLED === 'true'
  );
}

function failClosedDisabled(): boolean {
  return process.env.LLM_GATE_FAIL_CLOSED_DISABLED === 'true';
}

const DAY_SECONDS = 86_400;

export class PerIpSpendingGate {
  constructor(
    private adapter: KvAdapter,
    private ipCapUsd: number,
    private regionCapUsd: number,
  ) {}

  /**
   * Reserve `estCost` against both the per-IP and per-region buckets. Throws on
   * either cap exhaustion (PerIpBudgetExceededError) or KV error (also throws
   * under fail-CLOSED contract; reverts to silent allow under the kill switch).
   * Returns the reserved USD amount (echoed from estCost) for the caller to
   * pass back to release/record.
   */
  async reserveForIp(ip: string, country: string, estCost: number): Promise<number> {
    if (testBypassEnabled()) return estCost;
    if (estCost <= 0) return 0;

    const ipK = ipKey(ip);
    const regK = regionKey(country);

    try {
      const ipTotal = await this.adapter.incrbyfloat(ipK, estCost);
      await this.adapter.expire(ipK, DAY_SECONDS);
      if (ipTotal > this.ipCapUsd) {
        // Roll back so the cap isn't permanently inflated by the rejection itself
        await this.adapter.decrbyfloat(ipK, estCost);
        logger.info('gate.per_ip_exhausted', { ip, ipTotal, ipCap: this.ipCapUsd });
        throw new PerIpBudgetExceededError('ip', ipK, ipTotal, this.ipCapUsd);
      }

      const regTotal = await this.adapter.incrbyfloat(regK, estCost);
      await this.adapter.expire(regK, DAY_SECONDS);
      if (regTotal > this.regionCapUsd) {
        await this.adapter.decrbyfloat(regK, estCost);
        await this.adapter.decrbyfloat(ipK, estCost);
        logger.info('gate.per_region_exhausted', { country, regTotal, regionCap: this.regionCapUsd });
        throw new PerIpBudgetExceededError('region', regK, regTotal, this.regionCapUsd);
      }

      return estCost;
    } catch (err) {
      if (err instanceof PerIpBudgetExceededError) throw err;
      logger.error('gate.fail_closed_rejected', {
        site: 'perIpSpendingGate.reserveForIp',
        ip,
        country,
        errorMessage: err instanceof Error ? err.message : String(err),
        cause: 'gate_check_failed',
      });
      if (failClosedDisabled()) {
        logger.warn('perIpSpendingGate reserve failed; LLM_GATE_FAIL_CLOSED_DISABLED set — allowing', { ip, country });
        return estCost;
      }
      throw new PerIpBudgetExceededError('ip', ipK, 0, this.ipCapUsd);
    }
  }

  /** Release a reservation (LLM call failed before reaching provider). Best-effort. */
  async releaseForIp(ip: string, country: string, reservedCost: number): Promise<void> {
    if (testBypassEnabled()) return;
    if (reservedCost <= 0) return;

    try {
      await this.adapter.decrbyfloat(ipKey(ip), reservedCost);
      await this.adapter.decrbyfloat(regionKey(country), reservedCost);
    } catch (err) {
      logger.warn('perIpSpendingGate release failed (continuing)', {
        ip,
        country,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Reconcile (success path). Identical to releaseForIp at this layer — the
   *  reservation IS the actual under the eager-projection contract. Distinct
   *  method name for call-site clarity. */
  async recordActualForIp(ip: string, country: string, reservedCost: number): Promise<void> {
    // Under eager-reservation, actual cost is whatever we reserved — no second
    // adjustment needed. Method retained for symmetry with LLMSpendingGate.
    void ip;
    void country;
    void reservedCost;
  }

  /** Read remaining budgets for the affordability pre-check in submitPublicEditAction. */
  async remainingForIp(ip: string, country: string): Promise<{ ipRemaining: number; regionRemaining: number }> {
    if (testBypassEnabled()) {
      return { ipRemaining: this.ipCapUsd, regionRemaining: this.regionCapUsd };
    }
    try {
      const [ipUsed, regUsed] = await Promise.all([
        this.adapter.get(ipKey(ip)),
        this.adapter.get(regionKey(country)),
      ]);
      return {
        ipRemaining: Math.max(0, this.ipCapUsd - ipUsed),
        regionRemaining: Math.max(0, this.regionCapUsd - regUsed),
      };
    } catch (err) {
      logger.warn('perIpSpendingGate.remainingForIp failed', {
        ip,
        country,
        error: err instanceof Error ? err.message : String(err),
      });
      // Under fail-CLOSED, return zero remaining so the affordability check rejects.
      if (!failClosedDisabled()) return { ipRemaining: 0, regionRemaining: 0 };
      return { ipRemaining: this.ipCapUsd, regionRemaining: this.regionCapUsd };
    }
  }
}

// ─── Upstash adapter (production) ──────────────────────────────────

/** Singleton gate instance backed by Upstash. Lazy-init so unit tests using a
 *  custom KvAdapter can construct the gate directly without env vars. */
let singletonGate: PerIpSpendingGate | null = null;

export function getPerIpSpendingGate(): PerIpSpendingGate {
  if (singletonGate) return singletonGate;

  // Lazy-imported so the import is only resolved when the gate is actually used
  // (avoids forcing every server-action consumer to install @upstash/redis).
  const ipCap = Number(process.env.PUBLIC_EDIT_PER_IP_DAILY_USD_CAP ?? '0.50');
  const regionCap = Number(process.env.PUBLIC_EDIT_PER_REGION_DAILY_USD_CAP ?? '5');

  singletonGate = new PerIpSpendingGate(getUpstashAdapter(), ipCap, regionCap);
  return singletonGate;
}

export function resetPerIpSpendingGate(): void {
  singletonGate = null;
}

let upstashAdapter: KvAdapter | null = null;

function getUpstashAdapter(): KvAdapter {
  if (upstashAdapter) return upstashAdapter;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    // Without Upstash credentials, fall back to a no-op adapter that always
    // returns 0. Combined with fail-CLOSED, this means caps would reject under
    // production load — but it lets local-dev / CI without UPSTASH_* vars boot.
    // Production deployments MUST set both env vars.
    logger.warn('UPSTASH_REDIS_REST_URL/TOKEN not set; perIpSpendingGate using no-op adapter');
    upstashAdapter = {
      async incrbyfloat() { return 0; },
      async decrbyfloat() { return 0; },
      async expire() {},
      async get() { return 0; },
    };
    return upstashAdapter;
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Redis } = require('@upstash/redis') as typeof import('@upstash/redis');
  const redis = new Redis({ url, token });

  upstashAdapter = {
    async incrbyfloat(key, amount) {
      const result = await redis.incrbyfloat(key, amount);
      return typeof result === 'string' ? parseFloat(result) : Number(result);
    },
    async decrbyfloat(key, amount) {
      // Upstash exposes incrbyfloat only — use negative amount for decrement
      const result = await redis.incrbyfloat(key, -amount);
      return typeof result === 'string' ? parseFloat(result) : Number(result);
    },
    async expire(key, seconds) {
      await redis.expire(key, seconds);
    },
    async get(key) {
      const v = await redis.get<string | number | null>(key);
      if (v === null || v === undefined) return 0;
      return typeof v === 'string' ? parseFloat(v) : Number(v);
    },
  };
  return upstashAdapter;
}

// ─── getClientGeo helper ───────────────────────────────────────────

export interface ClientGeo {
  ip: string;
  country: string;
}

/**
 * Extract client IP + country from a Next.js request via Vercel-set headers.
 * - `x-forwarded-for` for IP (first value if comma-separated)
 * - `x-vercel-ip-country` for country
 *
 * Trust assertion: requires `x-vercel-id` (Vercel-only) to be present. When
 * absent (off-Vercel route, attacker bypassing the edge), returns
 * `{ip: 'unknown', country: 'unknown'}` so the per-IP cap collapses to a
 * single shared bucket — defense in depth against forged `x-forwarded-for`.
 *
 * For tests: honors `x-test-client-ip` + `x-test-client-country` ONLY when
 * `NODE_ENV === 'test'`.
 */
export function getClientGeo(headers: Headers): ClientGeo {
  if (process.env.NODE_ENV === 'test') {
    const ip = headers.get('x-test-client-ip');
    const country = headers.get('x-test-client-country');
    if (ip || country) {
      return { ip: ip ?? 'test-unknown', country: country ?? 'TEST' };
    }
  }

  // Trust assertion — Vercel-only request must carry x-vercel-id
  if (!headers.get('x-vercel-id')) {
    return { ip: 'unknown', country: 'unknown' };
  }

  const xff = headers.get('x-forwarded-for');
  const ip = xff ? xff.split(',')[0]!.trim() : 'unknown';
  const country = headers.get('x-vercel-ip-country') ?? 'unknown';
  return { ip, country };
}
