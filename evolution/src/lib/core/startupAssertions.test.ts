// Phase 6.10 startup-assertion proof tests. Mocks the Supabase client to
// verify the deploy-gate behavior across all error paths without needing a
// real DB. The goal is to prove the assertion FIRES correctly when the DB
// CHECK is missing TS phase strings — closing the silent-reject failure
// mode PR #1017 hit.

import {
  assertCostCalibrationPhaseEnumsMatch,
  parseCheckPhaseValues,
  MissingMigrationError,
  _resetStartupAssertionCache,
} from './startupAssertions';

type RpcResult = { data: string | null; error: { message: string } | null };

function makeClient(rpcImpl: () => RpcResult, fallbackRows: Array<{ conname: string }> | null = []): import('@supabase/supabase-js').SupabaseClient {
  return {
    rpc: jest.fn().mockImplementation(async () => rpcImpl()),
    from: jest.fn().mockImplementation(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: fallbackRows, error: null }),
    })),
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

describe('parseCheckPhaseValues', () => {
  it('extracts values from a Postgres ANY-ARRAY constraint def', () => {
    const def = `CHECK ((phase = ANY (ARRAY['generation'::text, 'ranking'::text, 'reflection'::text])))`;
    expect(parseCheckPhaseValues(def)).toEqual(['generation', 'ranking', 'reflection']);
  });

  it('extracts values from a Postgres IN-list constraint def', () => {
    const def = `CHECK (phase IN ('generation', 'ranking', 'reflection'))`;
    expect(parseCheckPhaseValues(def)).toEqual(['generation', 'ranking', 'reflection']);
  });

  it('returns null for unparseable input', () => {
    expect(parseCheckPhaseValues('CHECK (phase IS NOT NULL)')).toBeNull();
  });

  it('handles single-value constraints', () => {
    expect(parseCheckPhaseValues(`CHECK (phase = 'generation')`)).toEqual(['generation']);
  });
});

describe('assertCostCalibrationPhaseEnumsMatch', () => {
  beforeEach(() => { _resetStartupAssertionCache(); });

  it('throws MissingMigrationError when the DB CHECK is missing a phase', async () => {
    const def = `CHECK ((phase = ANY (ARRAY['generation'::text, 'ranking'::text])))`;
    const client = makeClient(() => ({ data: def, error: null }));
    await expect(assertCostCalibrationPhaseEnumsMatch(client)).rejects.toThrow(MissingMigrationError);
  });

  it('passes silently when DB CHECK contains all expected phase strings', async () => {
    const def = `CHECK ((phase = ANY (ARRAY[
      'generation'::text, 'ranking'::text, 'seed_title'::text, 'seed_article'::text,
      'reflection'::text, 'iterative_edit_propose'::text, 'iterative_edit_review'::text,
      'iterative_edit_drift_recovery'::text
    ])))`;
    const client = makeClient(() => ({ data: def, error: null }));
    await expect(assertCostCalibrationPhaseEnumsMatch(client)).resolves.toBeUndefined();
  });

  it('passes when DB has EXTRA phase strings not in TS (DB-superset-of-TS allowed)', async () => {
    const def = `CHECK ((phase = ANY (ARRAY[
      'generation'::text, 'ranking'::text, 'seed_title'::text, 'seed_article'::text,
      'reflection'::text, 'iterative_edit_propose'::text, 'iterative_edit_review'::text,
      'iterative_edit_drift_recovery'::text, 'future_v1_1_phase'::text
    ])))`;
    const client = makeClient(() => ({ data: def, error: null }));
    await expect(assertCostCalibrationPhaseEnumsMatch(client)).resolves.toBeUndefined();
  });

  it('fails open with a warning on permission-denied errors', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const client = makeClient(() => ({ data: null, error: { message: 'permission denied for pg_constraint' } }));
    await expect(assertCostCalibrationPhaseEnumsMatch(client)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('fails open with a warning when both RPC and fallback SELECT fail (non-permission)', async () => {
    // PostgREST gates pg_catalog access in many deployments, so neither path
    // returns useful data — the assertion should fall open rather than brick
    // the API. Mirrors the CI Supabase project, which has neither the
    // pg_get_constraintdef_by_name RPC installed nor a PostgREST schema
    // exposing pg_constraint.
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const client = {
      rpc: jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'Could not find function pg_get_constraintdef_by_name in schema cache' },
      }),
      from: jest.fn().mockImplementation(() => ({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({
          data: null,
          error: { message: 'relation "pg_constraint" does not exist' },
        }),
      })),
    } as unknown as import('@supabase/supabase-js').SupabaseClient;
    await expect(assertCostCalibrationPhaseEnumsMatch(client)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('throws when the constraint def is malformed (no IN-list)', async () => {
    const client = makeClient(() => ({ data: 'CHECK (phase IS NOT NULL)', error: null }));
    await expect(assertCostCalibrationPhaseEnumsMatch(client)).rejects.toThrow(MissingMigrationError);
  });

  it('caches the success result for the process lifetime', async () => {
    const def = `CHECK ((phase = ANY (ARRAY[
      'generation'::text, 'ranking'::text, 'seed_title'::text, 'seed_article'::text,
      'reflection'::text, 'iterative_edit_propose'::text, 'iterative_edit_review'::text,
      'iterative_edit_drift_recovery'::text
    ])))`;
    const rpc = jest.fn().mockResolvedValue({ data: def, error: null });
    const client = { rpc, from: () => ({}) } as unknown as import('@supabase/supabase-js').SupabaseClient;
    await assertCostCalibrationPhaseEnumsMatch(client);
    await assertCostCalibrationPhaseEnumsMatch(client);
    expect(rpc).toHaveBeenCalledTimes(1); // second call hit the cache
  });
});

describe('MissingMigrationError', () => {
  it('has the canonical name property for instanceof checks', () => {
    const err = new MissingMigrationError('test');
    expect(err.name).toBe('MissingMigrationError');
    expect(err).toBeInstanceOf(Error);
  });
});
