-- Un-archive existing archived rows after archive feature removal.
-- Ensures no rows are stuck in an unreachable state.

UPDATE evolution_strategies SET status = 'active' WHERE status = 'archived';
UPDATE evolution_prompts SET status = 'active' WHERE status = 'archived';
UPDATE evolution_runs SET archived = false WHERE archived = true;
