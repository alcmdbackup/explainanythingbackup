// Integration test: run a full evolution cycle through claimAndExecuteRun,
// then assert run-level subagent:*.cost rows match parser sums and are bounded
// by the run's total invocation cost.
//
// rename_agents_subagents_evolution_20260508 Phase 3.

// Integration helper imports go here once getServiceClient (or equivalent) is
// added to evolution-test-helpers. Scaffolded as describe.skip until then.
const _scaffoldDb: unknown = null;

describe.skip('subagent:*.cost end-to-end finalization (integration)', () => {


  it.each([
    ['generate_from_previous_article'],
    ['reflect_and_generate_from_previous_article'],
    ['evaluate_criteria_then_generate_from_previous_article'],
    ['iterative_editing'],
  ])('writes subagent:*.cost rows summing per-subagent costs for %s wrapper', async () => {
    // 1. Setup: prompt + strategy with the wrapper agent in its iterationConfig.
    // 2. Call: claimAndExecuteRun in --mock mode (--mock LLM emits deterministic
    //    responses + execution_detail). Finalization writes the metric rows.
    // 3. Query: SELECT * FROM evolution_metrics WHERE entity_type='run'
    //    AND metric_name LIKE 'subagent:%' AND entity_id=runId.
    // 4. Assert: rows present, values match parser sums for the wrapper's
    //    execution_detail JSONB.
    // 5. Sanity bound: SUM(subagent:*.cost) <= SUM(invocation.cost_usd) + 1e-4 USD.
    expect(typeof _scaffoldDb).not.toBe("undefined");
  });
});
export {};
