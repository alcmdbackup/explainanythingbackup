-- B001-S5: deterministic clone discriminator via (parent_strategy_id, clone_index)
--
-- Background: cloneStrategyAction previously generated config_hash via
-- `${configHash}_clone_${Date.now()}`. Two admins cloning the same source in the
-- same millisecond produced identical hashes → UNIQUE constraint violation OR
-- broke find-or-create lookups. The Phase 5 fix switched to crypto.randomUUID()
-- so clones are immediately distinct. This migration adds the lineage columns
-- so a future cloneStrategyAction iteration can use the deterministic
-- (parent_strategy_id, clone_index) discriminator described in the plan.

BEGIN;

-- Lineage columns: nullable so existing strategies (no parent) keep working.
ALTER TABLE evolution_strategies
  ADD COLUMN IF NOT EXISTS parent_strategy_id UUID REFERENCES evolution_strategies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS clone_index INT NULL;

-- Partial UNIQUE: serializes concurrent clones of the same source. Only enforces
-- when both columns are set (clones), not for original strategies.
CREATE UNIQUE INDEX IF NOT EXISTS uq_strategy_clone_lineage
  ON evolution_strategies (parent_strategy_id, clone_index)
  WHERE parent_strategy_id IS NOT NULL AND clone_index IS NOT NULL;

COMMENT ON COLUMN evolution_strategies.parent_strategy_id IS
  'Source strategy this row was cloned from. NULL for original strategies. (B001-S5)';
COMMENT ON COLUMN evolution_strategies.clone_index IS
  'Monotonic clone counter scoped per parent_strategy_id. Used to derive a deterministic config_hash discriminator that does not depend on Date.now(). (B001-S5)';

COMMIT;
