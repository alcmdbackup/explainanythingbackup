// Wipeout-gate orchestration helpers — consumed by /run_experiment_analysis Step 3.
// Wraps detectArenaOnlyWipeouts.ts's JSON envelope output. The detector exits 1
// when wipeouts are found (intentional — used for cron alerting); the skill must
// tolerate this exit code via `|| true` and infer wipeouts from .wipeouts being
// non-empty, NOT from the exit code.

export interface WipeoutRow {
  run_id: string;
  strategy_id?: string;
  experiment_id?: string;
  status?: string;
  error_code?: string;
  stop_reason?: string | null;
  variant_count?: number;
  generate_invocation_count?: number;
  total_cost?: number;
  [k: string]: unknown;
}

export interface WipeoutEnvelope {
  target?: unknown;
  sinceHours?: number | null;
  count?: number;
  wipeouts?: WipeoutRow[];
}

/** Parse the detector's --json envelope; return the wipeouts array (empty on absent/malformed). */
export function parseWipeoutDetectorOutput(json: string): WipeoutRow[] {
  if (!json || typeof json !== 'string') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const env = parsed as WipeoutEnvelope;
  if (!Array.isArray(env.wipeouts)) return [];
  return env.wipeouts;
}

/** True when the hard gate should fire (≥1 wipeout detected). */
export function shouldFireHardGate(wipeouts: WipeoutRow[]): boolean {
  return wipeouts.length > 0;
}

// CLI mode: `npx tsx scripts/skills/wipeout-gate.ts <json-string>`
// Prints `{count, wipeouts}` to stdout. Exits 0 on no wipeouts, 1 if found
// (matches the detector's own convention so downstream callers can chain).
if (require.main === module) {
  const json = process.argv[2] ?? '';
  const rows = parseWipeoutDetectorOutput(json);
  console.log(JSON.stringify({ count: rows.length, wipeouts: rows }));
  process.exit(shouldFireHardGate(rows) ? 1 : 0);
}
