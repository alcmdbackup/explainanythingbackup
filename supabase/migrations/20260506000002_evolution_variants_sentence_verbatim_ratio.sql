-- Adds a per-variant sentence-overlap quality metric column to evolution_variants.
-- Computed at variant creation by every variant-producing agent (vanilla generate,
-- reflect_and_generate, all 3 criteria-based wrappers via inheritance through
-- GenerateFromPreviousArticleAgent, plus IterativeEditingAgent and the new
-- ProposerApproverCriteriaGenerateAgent at their direct apply touchpoints).
--
-- Range: [0.0, 1.0] — fraction of parent sentences that appear (verbatim or
-- near-verbatim via Levenshtein <= 2) in the child variant. Observational only;
-- no enforcement, no discard. Surfaces on the tactic leaderboard, variant detail
-- page, list pages, and Phase 7 staging analysis (Elo Δ × overlap percentile
-- bucketing per agent).
--
-- Forward-compatible: nullable ADD COLUMN. Pre-existing variants stay NULL and
-- are excluded from percentile computations. Code reads the field as optional.
-- Migration ordering vs code deploy is flexible — CI deploy-migrations applies
-- it before code on staging by default; if code ships first, the field stays NULL
-- until variants are created with the new wiring in place.

ALTER TABLE evolution_variants
  ADD COLUMN sentence_verbatim_ratio NUMERIC;

COMMENT ON COLUMN evolution_variants.sentence_verbatim_ratio IS
  'Fraction of parent sentences appearing in child (0.0=full rewrite, 1.0=verbatim copy). '
  'Computed at variant creation. Nullable; legacy variants stay NULL.';
