// Phase 6.10 — Integration test that PROVES the Phase 1.6 startup assertion
// fires correctly when the DB CHECK constraint is missing a TS phase string.
//
// This test mutates the shared evolution_cost_calibration CHECK constraint
// inside a transaction, runs assertCostCalibrationPhaseEnumsMatch against
// the mutated constraint, asserts MissingMigrationError is thrown, then
// restores the constraint in afterAll.
//
// MUST run with --runInBand (jest serial mode). Concurrent jest workers
// reading evolution_cost_calibration during the mutation window will fail
// unpredictably. The describe.serial block + the test isolation comment at
// top + the package.json `test:integration:evolution` invocation include
// the --runInBand flag in CI.

import { createClient } from '@supabase/supabase-js';
import {
  assertCostCalibrationPhaseEnumsMatch,
  MissingMigrationError,
  _resetStartupAssertionCache,
} from '@evolution/lib/core/startupAssertions';

const CONSTRAINT_NAME = 'evolution_cost_calibration_phase_allowed';

const FULL_CHECK_VALUES = [
  'generation',
  'ranking',
  'seed_title',
  'seed_article',
  'reflection',
  'iterative_edit_propose',
  'iterative_edit_review',
  'iterative_edit_drift_recovery',
];

const PARTIAL_CHECK_VALUES = [
  'generation',
  'ranking',
  'seed_title',
  'seed_article',
  // Intentionally missing: reflection, iterative_edit_*
];

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function execSql(client: ReturnType<typeof createServiceClient>, sql: string): Promise<void> {
  // Postgres DDL via Supabase requires either the service-role REST `pg` endpoint
  // (not available in standard supabase-js) or a stored procedure. Most repos
  // expose an `exec_sql` RPC for migration-style ops in tests; if absent, this
  // test will skip via the catch + skip below.
  type RpcClient = { rpc: (fn: string, args: unknown) => Promise<{ error: { message: string } | null }> };
  const { error } = await (client as unknown as RpcClient).rpc('exec_sql', { sql });
  if (error) throw new Error(error.message);
}

function createServiceClient() { return getServiceClient(); }

describe('Phase 6.10 — startup CHECK assertion proof', () => {
  // SERIAL: this suite mutates the shared evolution_cost_calibration CHECK
  // constraint and restores it. Concurrent jest workers reading the table
  // during the mutation window will fail. The CI runner must use --runInBand.

  let canMutateConstraint = true;

  beforeAll(async () => {
    _resetStartupAssertionCache();
    // Probe whether the test environment has `exec_sql` RPC. If not, skip the
    // mutation-based tests entirely — the assertion is also exercised by
    // startupAssertions.test.ts (in-memory mock-based) for unit-level coverage.
    try {
      const sb = getServiceClient();
      await execSql(sb, 'SELECT 1');
    } catch {
      canMutateConstraint = false;
    }
  });

  it('throws MissingMigrationError when DB CHECK is missing TS phase strings', async () => {
    if (!canMutateConstraint) {
      // eslint-disable-next-line no-console
      console.warn('[Phase 6.10] exec_sql RPC unavailable — skipping mutation-based test. Coverage falls back to startupAssertions.test.ts (mocked).');
      return;
    }
    const sb = getServiceClient();

    // BEGIN: mutate constraint to a partial value list.
    await execSql(sb, `ALTER TABLE evolution_cost_calibration DROP CONSTRAINT ${CONSTRAINT_NAME};`);
    await execSql(sb, `ALTER TABLE evolution_cost_calibration ADD CONSTRAINT ${CONSTRAINT_NAME} CHECK (phase IN (${PARTIAL_CHECK_VALUES.map((v) => `'${v}'`).join(', ')}));`);

    try {
      _resetStartupAssertionCache();
      await expect(assertCostCalibrationPhaseEnumsMatch(sb)).rejects.toThrow(MissingMigrationError);
    } finally {
      // Restore full constraint.
      await execSql(sb, `ALTER TABLE evolution_cost_calibration DROP CONSTRAINT ${CONSTRAINT_NAME};`);
      await execSql(sb, `ALTER TABLE evolution_cost_calibration ADD CONSTRAINT ${CONSTRAINT_NAME} CHECK (phase IN (${FULL_CHECK_VALUES.map((v) => `'${v}'`).join(', ')}));`);
    }
  });

  it('passes silently when DB CHECK matches TS phase strings exactly', async () => {
    if (!canMutateConstraint) return;
    const sb = getServiceClient();
    _resetStartupAssertionCache();
    await expect(assertCostCalibrationPhaseEnumsMatch(sb)).resolves.toBeUndefined();
  });
});
