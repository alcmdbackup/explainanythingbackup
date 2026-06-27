-- Phase 1 of build_website_for_evolutiOn_20260626: add `public_visible` flag to
-- evolution_strategies so the public /edit picker can curate which strategies
-- visitors are allowed to run.
--
-- Default false: every existing strategy stays invisible to the public until an
-- admin explicitly opts it in. The Phase 3 admin UI exposes a toggle column +
-- detail-page toggle, and updateStrategyAction enforces the server-side guard
-- that `config.budgetUsd <= 0.10` before allowing public_visible=true.
--
-- Composite partial index speeds up listPublicStrategiesAction's predicate
-- (status='active' AND public_visible=true).
--
-- ROLLBACK:
-- DROP INDEX IF EXISTS idx_strategies_public_visible_active;
-- ALTER TABLE evolution_strategies DROP COLUMN IF EXISTS public_visible;

ALTER TABLE evolution_strategies
  ADD COLUMN IF NOT EXISTS public_visible BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN evolution_strategies.public_visible IS
  'Whether this strategy appears in the public /edit picker. Default false; admin toggles on via /admin/evolution/strategies. Guard: config.budgetUsd <= $0.10 enforced server-side.';

CREATE INDEX IF NOT EXISTS idx_strategies_public_visible_active
  ON evolution_strategies (public_visible)
  WHERE public_visible = true AND status = 'active';
