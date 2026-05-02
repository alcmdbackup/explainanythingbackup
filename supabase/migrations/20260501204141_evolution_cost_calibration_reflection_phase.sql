-- Adds 'reflection' to the evolution_cost_calibration.phase CHECK constraint
-- (PR #1017 added 'reflection' to the TS phase enum but never shipped this migration,
--  causing reflection cost rows to be silently rejected by the upserter).
--
-- Also renames the auto-generated CHECK constraint to an explicit, stable name so
-- the Phase 1.6 startup assertion can query it by `conname` reliably. The previous
-- inline column constraint had no explicit name; Postgres synthesized it as
-- evolution_cost_calibration_phase_check, but that name is fragile if a future
-- ALTER changes the rules. The new name evolution_cost_calibration_phase_allowed
-- is the stable handle used by the startup assertion.
--
-- Forward-only. Independent rollback path from the editing-phases migration
-- (1.5b in the bring_back_editing_agents_evolution plan, Decisions §18).

ALTER TABLE evolution_cost_calibration
  DROP CONSTRAINT IF EXISTS evolution_cost_calibration_phase_check;

ALTER TABLE evolution_cost_calibration
  ADD CONSTRAINT evolution_cost_calibration_phase_allowed
  CHECK (phase IN (
    'generation',
    'ranking',
    'seed_title',
    'seed_article',
    'reflection'
  ));
