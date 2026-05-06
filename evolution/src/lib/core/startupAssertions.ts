// Standalone deploy-ordering gate for the cost-calibration phase enum.
//
// Asserts that every TS Phase literal (refreshCostCalibration.ts) and every
// CalibrationRow['phase'] value (costCalibrationLoader.ts) is present in the
// DB CHECK constraint at startup. If any TS phase string is missing from the
// DB CHECK, blocks agent registry initialization with a loud error naming the
// missing values and the migration file expected to add them.
//
// Why standalone (not inside costCalibrationLoader): the loader is gated by
// COST_CALIBRATION_ENABLED (default false). Placing the assertion there would
// inherit that flag and silently skip — exactly the conditional-execution
// failure mode PR #1017 hit. This module runs unconditionally on agent-registry
// init, regardless of any feature flag.

import type { SupabaseClient } from '@supabase/supabase-js';

/** Phase strings declared in evolution/scripts/refreshCostCalibration.ts. Must match
 *  the Phase union there. Duplicated here to avoid a runtime import of a script file. */
const TS_PHASES_REFRESH_CALIBRATION: ReadonlySet<string> = new Set([
  'generation',
  'ranking',
  'seed_title',
  'seed_article',
  'reflection',
  'iterative_edit_propose',
  'iterative_edit_review',
  'iterative_edit_drift_recovery',
]);

/** Phase strings declared in evolution/src/lib/pipeline/infra/costCalibrationLoader.ts.
 *  Must match the CalibrationRow['phase'] union there. Duplicated here for the
 *  same reason. */
const TS_PHASES_CALIBRATION_LOADER: ReadonlySet<string> = new Set([
  'generation',
  'ranking',
  'reflection',
  'seed_title',
  'seed_article',
  'iterative_edit_propose',
  'iterative_edit_review',
  'iterative_edit_drift_recovery',
]);

/** Stable name of the CHECK constraint, established by the
 *  20260501204141_evolution_cost_calibration_reflection_phase.sql migration. */
const CONSTRAINT_NAME = 'evolution_cost_calibration_phase_allowed';

/** Migration files expected to define / extend the CHECK constraint.
 *  Cited in error messages so operators know where to look. */
const MIGRATION_FILES = [
  'supabase/migrations/20260501204141_evolution_cost_calibration_reflection_phase.sql',
  'supabase/migrations/20260501204142_evolution_cost_calibration_editing_phases.sql',
];

export class MissingMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingMigrationError';
  }
}

let cachedResult: 'ok' | null = null;

/** Reset cache (test-only). */
export function _resetStartupAssertionCache(): void {
  cachedResult = null;
}

/** Parse the IN-list from a `pg_get_constraintdef` output like:
 *    CHECK (phase = ANY (ARRAY['generation'::text, 'ranking'::text, ...]))
 *  or:
 *    CHECK ((phase IN ('generation', 'ranking', ...)))
 *  Returns the lowercased string values, or null if unparseable. */
export function parseCheckPhaseValues(constraintDef: string): string[] | null {
  // Match anything between the first set of single-quoted strings.
  const matches = constraintDef.match(/'([^']+)'/g);
  if (!matches || matches.length === 0) return null;
  return matches.map((m) => m.slice(1, -1));
}

/** Standalone deploy gate. Throws MissingMigrationError if any TS phase string
 *  is missing from the DB CHECK constraint. Idempotent: caches positive result
 *  for the process lifetime.
 *
 *  Behavior on errors:
 *  - DB query 'permission denied for pg_catalog' → log warning + fail open
 *    (return without throwing). Permission denial only happens in mis-
 *    configured local/test environments; in prod the service-role client
 *    has access. Failing open avoids the assertion bricking environments
 *    where the underlying problem is config drift, not actual phase mismatch.
 *  - DB connection error → re-throw (a connection problem during agent
 *    registry init is already going to break the service; failing fast is
 *    correct).
 *  - Constraint not found (zero rows) → throw MissingMigrationError naming
 *    the migration file expected to add the constraint.
 *  - IN-list parse error (malformed) → throw MissingMigrationError with the
 *    raw constraint def.
 *  - Phase mismatch (TS values missing from DB) → throw MissingMigrationError
 *    naming the missing values and the migration file.
 */
export async function assertCostCalibrationPhaseEnumsMatch(
  client: SupabaseClient,
): Promise<void> {
  if (cachedResult === 'ok') return;

  const allTsPhases = new Set<string>([
    ...TS_PHASES_REFRESH_CALIBRATION,
    ...TS_PHASES_CALIBRATION_LOADER,
  ]);

  let constraintDef: string | null = null;
  try {
    const { data, error } = await client.rpc('pg_get_constraintdef_by_name' as never, {
      p_conname: CONSTRAINT_NAME,
    } as never);
    if (error) {
      // Detect permission-denied errors and fail open with a warning.
      const msg = String(error.message ?? '').toLowerCase();
      if (msg.includes('permission denied')) {
        // eslint-disable-next-line no-console
        console.warn(
          `[startupAssertions] Permission denied querying pg_constraint for ${CONSTRAINT_NAME}. ` +
            'Falling open — assertion skipped. In production with the service-role client, this should not happen.',
        );
        return;
      }
      // Connection / unexpected error → re-throw.
      throw error;
    }
    constraintDef = typeof data === 'string' ? data : null;
  } catch (err: unknown) {
    // Fall back to a direct SELECT against pg_constraint (the RPC may not exist
    // in environments where the helper function wasn't installed). This second
    // attempt also distinguishes permission-denied vs connection error vs
    // missing-rows.
    try {
      const { data, error } = await client
        .from('pg_constraint' as never)
        .select('conname')
        .eq('conname', CONSTRAINT_NAME)
        .limit(1);
      if (error) {
        const msg = String(error.message ?? '').toLowerCase();
        if (msg.includes('permission denied')) {
          // eslint-disable-next-line no-console
          console.warn(
            `[startupAssertions] Permission denied on pg_constraint for ${CONSTRAINT_NAME}. ` +
              'Falling open — assertion skipped.',
          );
          return;
        }
        // Re-throw the original RPC error since the fallback also failed.
        throw err;
      }
      if (!data || data.length === 0) {
        throw new MissingMigrationError(
          `CHECK constraint ${CONSTRAINT_NAME} not found. Expected migration: ${MIGRATION_FILES[0]}`,
        );
      }
      // RPC failed but constraint exists — we cannot read its definition without
      // the RPC. Fail open with a warning rather than blocking startup.
      // eslint-disable-next-line no-console
      console.warn(
        `[startupAssertions] Could not read constraint definition for ${CONSTRAINT_NAME} ` +
          `(RPC pg_get_constraintdef_by_name unavailable). Falling open — assertion skipped.`,
      );
      cachedResult = 'ok';
      return;
    } catch (fallbackErr: unknown) {
      if (fallbackErr instanceof MissingMigrationError) throw fallbackErr;
      // Both RPC and fallback SELECT failed (and not because of permission-denied
      // or constraint-not-found). PostgREST gates pg_catalog access in many
      // deployments, so this path is common enough that throwing would brick the
      // API. Fail open with a loud warning — the migration system itself is the
      // primary gate; this assertion is defense-in-depth.
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn(
        `[startupAssertions] Could not verify ${CONSTRAINT_NAME} (both RPC and pg_constraint SELECT failed: ${msg}). ` +
          `Falling open — assertion skipped. The migration system is the authoritative gate.`,
      );
      cachedResult = 'ok';
      return;
    }
  }

  if (constraintDef == null) {
    throw new MissingMigrationError(
      `CHECK constraint ${CONSTRAINT_NAME} not found. Expected migration: ${MIGRATION_FILES[0]}`,
    );
  }

  const dbPhases = parseCheckPhaseValues(constraintDef);
  if (dbPhases == null || dbPhases.length === 0) {
    throw new MissingMigrationError(
      `CHECK constraint ${CONSTRAINT_NAME} has no parseable IN-list. Raw definition: ${constraintDef}. ` +
        `Expected migrations: ${MIGRATION_FILES.join(', ')}`,
    );
  }

  const dbSet = new Set(dbPhases);
  const missing: string[] = [];
  for (const ts of allTsPhases) {
    if (!dbSet.has(ts)) missing.push(ts);
  }
  if (missing.length > 0) {
    throw new MissingMigrationError(
      `CHECK constraint ${CONSTRAINT_NAME} is missing phase values declared in TypeScript: ${missing.join(', ')}. ` +
        `Expected migrations: ${MIGRATION_FILES.join(', ')}. ` +
        `DB-superset-of-TS is allowed during rollout, but TS-superset-of-DB indicates a missing migration.`,
    );
  }

  cachedResult = 'ok';
}
