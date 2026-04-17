// Integration test for seed-concurrent-race (Phase 2: seed decoupled from pool).
// The optimistic-concurrency UPDATE path was removed — seed variant is now persisted
// in pre-iteration setup (claimAndExecuteRun) and never enters the pool.

it('placeholder: seed concurrent race tests removed (seed decoupled from pool)', () => {
  expect(true).toBe(true);
});
