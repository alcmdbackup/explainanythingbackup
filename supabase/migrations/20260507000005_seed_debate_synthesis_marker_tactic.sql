-- Seed the 'debate_synthesis' marker-tactic row in evolution_tactics so the leaderboard /
-- arena Tactic-column UUID resolver can resolve debate-synthesized variants.
-- (bring_back_debate_agent_20260506 Phase 1.6b + Phase 1.11 + Decision §9.)
--
-- Marker tactic semantics: this row exists as an entity-identity for metrics/admin UI;
-- it is NOT used by buildPromptForTactic — DebateAgent constructs its own customPrompt
-- from the judge verdict and dispatches the inner GFPA via .execute() with that prompt.
-- The MARKER_TACTICS registry in evolution/src/lib/core/tactics/index.ts is the canonical
-- list; syncSystemTactics.ts unions ALL_SYSTEM_TACTICS + MARKER_TACTICS at sync time so
-- this row stays in sync with the code-side registry.
--
-- Forward-only. ON CONFLICT DO NOTHING so the migration is idempotent against rare
-- syncSystemTactics double-inserts.

INSERT INTO evolution_tactics (name, label, agent_type, category, is_predefined, status)
VALUES (
  'debate_synthesis',
  'Debate-Synthesis',
  'debate_then_generate_from_previous_article',
  'meta',
  true,
  'active'
)
ON CONFLICT (name) DO NOTHING;
