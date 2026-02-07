-- Allow evolution variants without an explanation (e.g. local CLI runs on markdown files).
-- Mirrors the same change made to content_evolution_runs in migration 000008.

ALTER TABLE content_evolution_variants
  ALTER COLUMN explanation_id DROP NOT NULL;
