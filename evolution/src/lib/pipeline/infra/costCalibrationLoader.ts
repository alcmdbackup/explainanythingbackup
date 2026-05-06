// Server-side loader for the evolution_cost_calibration table. Caches rows in memory
// with a 5-min TTL, serves misses via a row-missing → hardcoded-default fallback, and
// swallows DB errors (serving last-known-good or hardcoded defaults) so the hot path
// never throws. Guarded by COST_CALIBRATION_ENABLED env var (default 'false' for
// initial shadow-deploy rollout — hardcoded constants stay authoritative).
//
// Shadow-deploy rollout (cost_estimate_accuracy_analysis_20260414):
//   1. Populate table via evolution/scripts/refreshCostCalibration.ts (daily cron).
//   2. Verify values look right for a couple weeks while COST_CALIBRATION_ENABLED=false.
//   3. Flip env to 'true' and hardcoded constants become the fallback-only path.
//
// Dual-mode module: sync accessors are safe to import from client bundles
// (they only read in-memory cache, which stays empty in client contexts and
// the loader returns null → callers fall back to hardcoded defaults). Server-
// only imports (`createSupabaseServiceClient`, `logger`) are lazy-loaded only
// when `hydrateCalibrationCache` runs, which is never called from client code.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface CalibrationRow {
  tactic: string;
  generationModel: string;
  judgeModel: string;
  phase:
    | 'generation'
    | 'ranking'
    | 'reflection'
    | 'seed_title'
    | 'seed_article'
    | 'evaluate_and_suggest'
    | 'iterative_edit_propose'
    | 'iterative_edit_review'
    | 'iterative_edit_drift_recovery';
  avgOutputChars: number;
  avgInputOverheadChars: number;
  avgCostPerCall: number;
  nSamples: number;
  lastRefreshedAt: string;
}

const SENTINEL = '__unspecified__';
const DEFAULT_TTL_MS = 5 * 60 * 1000;

/**
 * B024: how long the loader stays in `'failed'` state before attempting another fetch.
 * During this window, `hydrateCalibrationCache()` returns the prior cache (or null) without
 * hitting the DB, preventing a stuck DB error from cascading into a thundering-herd retry.
 */
const FAILED_RETRY_MS = 30_000;

function sliceKey(tactic: string, generationModel: string, judgeModel: string, phase: string): string {
  return `${tactic}|${generationModel}|${judgeModel}|${phase}`;
}

// ─── Module-level singleton state ───────────────────────────────

/**
 * B024: 3-state machine replacing the old `inflight: Promise<void> | null`. Prevents a
 * microsecond-gap duplicate-fetch + cascading-retry path on transient DB errors. On error
 * the loader enters `'failed'` and blocks new fetches until `FAILED_RETRY_MS` elapses.
 */
type InflightState =
  | { status: 'idle' }
  | { status: 'running'; promise: Promise<void> }
  | { status: 'failed'; at: number };

interface LoaderState {
  cache: Map<string, CalibrationRow>;
  lastRefreshedAtMs: number | null;
  inflight: InflightState;
  hitCount: number;
  missCount: number;
  fallbackCount: number;
  lastMetricsFlushMs: number;
}

const state: LoaderState = {
  cache: new Map(),
  lastRefreshedAtMs: null,
  inflight: { status: 'idle' },
  hitCount: 0,
  missCount: 0,
  fallbackCount: 0,
  lastMetricsFlushMs: 0,
};

// ─── Env helpers ─────────────────────────────────────────────────

/** True when the loader should consult the DB cache (default: false for shadow-deploy). */
export function isCalibrationEnabled(): boolean {
  return process.env.COST_CALIBRATION_ENABLED === 'true';
}

function getTtlMs(): number {
  const raw = process.env.COST_CALIBRATION_TTL_MS;
  if (raw == null) return DEFAULT_TTL_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_MS;
}

// ─── Refresh (async) ────────────────────────────────────────────

async function refreshFromDb(supabase: SupabaseClient): Promise<void> {
  const { data, error } = await supabase
    .from('evolution_cost_calibration')
    .select('strategy, generation_model, judge_model, phase, avg_output_chars, avg_input_overhead_chars, avg_cost_per_call, n_samples, last_refreshed_at');
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[cost_calibration] refresh_failed', error.message);
    // B018: do NOT advance `lastRefreshedAtMs` on error — otherwise stale calibration serves
    // for the full TTL after a transient DB outage. Leave the timestamp alone so the next
    // caller retries on the next tick (gated by the B024 FAILED_RETRY_MS cooldown).
    throw error;
  }
  const next = new Map<string, CalibrationRow>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const tactic = String(row.strategy ?? SENTINEL);
    const generationModel = String(row.generation_model ?? SENTINEL);
    const judgeModel = String(row.judge_model ?? SENTINEL);
    const phase = String(row.phase ?? '') as CalibrationRow['phase'];
    if (!phase) continue;
    const avgOutputChars = Number(row.avg_output_chars);
    const avgInputOverheadChars = Number(row.avg_input_overhead_chars);
    const avgCostPerCall = Number(row.avg_cost_per_call);
    const nSamples = Number(row.n_samples);
    if (!Number.isFinite(avgOutputChars) || !Number.isFinite(avgCostPerCall)) continue;
    next.set(sliceKey(tactic, generationModel, judgeModel, phase), {
      tactic, generationModel, judgeModel, phase,
      avgOutputChars,
      avgInputOverheadChars: Number.isFinite(avgInputOverheadChars) ? avgInputOverheadChars : 0,
      avgCostPerCall,
      nSamples: Number.isFinite(nSamples) ? nSamples : 1,
      lastRefreshedAt: String(row.last_refreshed_at ?? ''),
    });
  }
  state.cache = next;
  state.lastRefreshedAtMs = Date.now();
}

/** Ensure the cache is populated if within TTL. Multiple concurrent callers coalesce
 *  onto a single in-flight DB query (thundering-herd protection). Errors are swallowed
 *  and logged; subsequent callers can retry *after* a FAILED_RETRY_MS cooldown (B024). */
export async function hydrateCalibrationCache(supabase?: SupabaseClient): Promise<void> {
  if (!isCalibrationEnabled()) return;
  const now = Date.now();
  const fresh = state.lastRefreshedAtMs != null && now - state.lastRefreshedAtMs < getTtlMs();
  if (fresh) return;

  // B024: state-machine coalescing.
  if (state.inflight.status === 'running') return state.inflight.promise;
  if (state.inflight.status === 'failed' && now - state.inflight.at < FAILED_RETRY_MS) {
    // Still cooling down after a prior failure — don't retry yet.
    return;
  }

  const client = supabase ?? (await (await import('@/lib/utils/supabase/server')).createSupabaseServiceClient());
  const promise = refreshFromDb(client)
    .then(() => {
      state.inflight = { status: 'idle' };
    })
    .catch((err) => {
      state.inflight = { status: 'failed', at: Date.now() };
      // eslint-disable-next-line no-console
      console.warn('[cost_calibration] hydrate_error', err instanceof Error ? err.message : String(err));
    });
  state.inflight = { status: 'running', promise };
  return promise;
}

// ─── Sync accessors (hot-path safe) ─────────────────────────────

/** Return a calibration row if cached, otherwise null. Loader callers should fall back
 *  to their hardcoded default when this returns null. Never throws. */
export function getCalibrationRow(
  tactic: string,
  generationModel: string,
  judgeModel: string,
  phase: CalibrationRow['phase'],
): CalibrationRow | null {
  if (!isCalibrationEnabled()) {
    state.fallbackCount += 1;
    flushMetricsIfDue();
    return null;
  }
  // Try most-specific first, then widen by replacing dimensions with sentinel.
  // B022: fallback chain ends with a phase=SENTINEL pass so operators can populate
  // cross-phase default rows when finer-grained data isn't available. Until those rows
  // exist, the sentinel-phase lookups simply never match — safe to always try.
  const narrowLookups: Array<[string, string, string, string]> = [
    [tactic, generationModel, judgeModel, phase],
    [tactic, generationModel, SENTINEL, phase],
    [tactic, SENTINEL, SENTINEL, phase],
    [SENTINEL, generationModel, SENTINEL, phase],
    [SENTINEL, SENTINEL, SENTINEL, phase],
    // B022: phase-SENTINEL last-ditch widening.
    [tactic, generationModel, judgeModel, SENTINEL],
    [SENTINEL, generationModel, SENTINEL, SENTINEL],
    [SENTINEL, SENTINEL, SENTINEL, SENTINEL],
  ];
  for (const [s, g, j, p] of narrowLookups) {
    const hit = state.cache.get(sliceKey(s, g, j, p));
    if (hit) {
      state.hitCount += 1;
      flushMetricsIfDue();
      return hit;
    }
  }
  state.missCount += 1;
  flushMetricsIfDue();
  return null;
}

/** Convenience: returns `avgOutputChars` for a (tactic, generation_model) slice,
 *  or null when unavailable. Callers fall back to their hardcoded tactic map. */
export function getOutputChars(
  tactic: string,
  generationModel: string,
  judgeModel: string,
): number | null {
  const row = getCalibrationRow(tactic, generationModel, judgeModel, 'generation');
  return row?.avgOutputChars ?? null;
}

/** Reset for testing. */
export function _resetForTesting(): void {
  state.cache = new Map();
  state.lastRefreshedAtMs = null;
  state.inflight = { status: 'idle' };
  state.hitCount = 0;
  state.missCount = 0;
  state.fallbackCount = 0;
  state.lastMetricsFlushMs = 0;
}

// ─── Observability ───────────────────────────────────────────────

const METRICS_FLUSH_WINDOW_MS = 60_000;

function flushMetricsIfDue(): void {
  const now = Date.now();
  if (now - state.lastMetricsFlushMs < METRICS_FLUSH_WINDOW_MS) return;
  state.lastMetricsFlushMs = now;
  const total = state.hitCount + state.missCount + state.fallbackCount;
  if (total === 0) return;
  // console is universal (server + client) — keeps this module client-safe.
  // eslint-disable-next-line no-console
  console.debug('[cost_calibration] lookup', {
    hits: state.hitCount,
    misses: state.missCount,
    fallbacks: state.fallbackCount,
    cacheSize: state.cache.size,
    enabled: isCalibrationEnabled(),
  });
  state.hitCount = 0;
  state.missCount = 0;
  state.fallbackCount = 0;
}
