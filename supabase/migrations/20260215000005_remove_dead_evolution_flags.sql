-- Remove dead evolution feature flag rows (dryRunOnly and promptBasedEvolutionEnabled).
-- These flags were never toggled from their defaults in production.
DELETE FROM feature_flags WHERE name IN ('evolution_dry_run_only', 'evolution_prompt_based_enabled');
