-- Judge Lab match-history persistence (improve_judge_lab_evolution_20260707_v3).
-- Adds, additively and idempotently, the full per-call judge AUDIT payload (the exact rendered
-- forward/reverse input prompts, the verbatim reasoning trace text + its format) and a frozen
-- ground-truth SNAPSHOT (mu/sigma/gap_kind/baseline_confidence/expected_winner/variant ids) to
-- judge_eval_calls, so the match history is queryable after the fact independent of the mutable
-- pair-bank. All columns nullable (legacy rows + degraded/errored cases). The deny-all + service_role
-- RLS on judge_eval_calls already covers these columns; the judge_eval_settings_leaderboard VIEW
-- aggregates only light columns, so it is unaffected (no DROP/RECREATE needed).

-- Audit payload (verbatim). reasoning_trace_format mirrors src/lib/services/llms.ts (3 states);
-- NULL = thinking not requested / no usage callback fired.
ALTER TABLE judge_eval_calls
  ADD COLUMN IF NOT EXISTS forward_prompt TEXT,
  ADD COLUMN IF NOT EXISTS reverse_prompt TEXT,
  ADD COLUMN IF NOT EXISTS forward_reasoning TEXT,
  ADD COLUMN IF NOT EXISTS reverse_reasoning TEXT,
  ADD COLUMN IF NOT EXISTS reasoning_trace_format TEXT
    CHECK (reasoning_trace_format IN ('verbatim', 'summary', 'unavailable'));

-- Ground-truth snapshot, frozen at write time. mu/sigma are OpenSkill-scale (~25/~8) and
-- baseline_confidence is a probability — all stored as UNCONSTRAINED numeric (no precision/scale)
-- so values are never truncated (cf. the existing confidence NUMERIC(2,1), which must NOT be copied).
ALTER TABLE judge_eval_calls
  ADD COLUMN IF NOT EXISTS mu_a NUMERIC,
  ADD COLUMN IF NOT EXISTS mu_b NUMERIC,
  ADD COLUMN IF NOT EXISTS sigma_a NUMERIC,
  ADD COLUMN IF NOT EXISTS sigma_b NUMERIC,
  ADD COLUMN IF NOT EXISTS baseline_confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS gap_kind TEXT CHECK (gap_kind IN ('large', 'close')),
  ADD COLUMN IF NOT EXISTS expected_winner TEXT CHECK (expected_winner IN ('A', 'B')),
  ADD COLUMN IF NOT EXISTS variant_a_id UUID,
  ADD COLUMN IF NOT EXISTS variant_b_id UUID;

COMMENT ON COLUMN judge_eval_calls.forward_prompt IS 'Exact rendered judge input for the forward pass (rubric incl. custom override + injected Text A/Text B).';
COMMENT ON COLUMN judge_eval_calls.forward_reasoning IS 'Verbatim/summary reasoning trace text for the forward pass when the provider surfaces it; see reasoning_trace_format.';
COMMENT ON COLUMN judge_eval_calls.reasoning_trace_format IS 'verbatim|summary|unavailable (NULL = thinking not requested). Mirrors LLMUsageMetadata.reasoningTraceFormat.';
COMMENT ON COLUMN judge_eval_calls.gap_kind IS 'Snapshot of the pair-bank ground-truth gap_kind at sweep time (durable against bank re-seeding).';
