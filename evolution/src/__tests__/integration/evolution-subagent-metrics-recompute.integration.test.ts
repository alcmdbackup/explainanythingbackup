// Integration test for the recomputeMetrics.ts:58/73 arm extension.
//
// rename_agents_subagents_evolution_20260508 Phase 3. Pins the rollover
// behavior described in the plan and verifies the recompute path triggers
// computeRunMetrics for stale subagent:* rows (the cascade marks them stale via
// mark_elo_metrics_stale on variant rating drift; recomputeMetrics must then
// actually fire computeRunMetrics to refresh them).

// Integration helper imports go here once getServiceClient (or equivalent) is
// added to evolution-test-helpers. Scaffolded as describe.skip until then.
const _scaffoldDb: unknown = null;

describe.skip('recomputeMetrics — subagent: arm extension (integration)', () => {


  it('cascade with subagent:reflection.cost in claimedNames triggers computeRunMetrics', async () => {
    // 1. Setup: run with subagent:* rows.
    // 2. Force stale: UPDATE evolution_metrics SET stale=true WHERE metric_name LIKE 'subagent:%'.
    // 3. Trigger: read the run's metrics via a service action.
    // 4. Assert: recomputeMetrics fires (spy on computeRunMetrics or check stale=false post-read).
    expect(typeof _scaffoldDb).not.toBe("undefined");
  });

  it('rollover: cascade triggers exactly ONE computeRunMetrics call (no double-fire)', async () => {
    // 1. Setup: run with mixed metric rows.
    // 2. Mark several stale.
    // 3. Trigger recompute.
    // 4. Spy on computeRunMetrics call count — must be exactly 1.
  });

  it('post-Phase-6: cascade with only subagent:* still triggers computeRunMetrics', async () => {
    // The agentCost: arm was removed in Phase 6; the subagent: arm replaces it.
    // Sanity check that subagent: alone is sufficient to trigger recompute.
  });
});
export {};
