-- Atomic RPC for applying an evolution winner.
-- Wraps content_history insert + explanations update + variant winner flag in a single
-- transaction to prevent partial-write data corruption (HIGH-2).
-- Includes SCRIPT-2 (empty variant check) and SCRIPT-7 (skip history for prompt-based runs).
--
-- Rollback:
-- DROP FUNCTION IF EXISTS apply_evolution_winner;

CREATE OR REPLACE FUNCTION apply_evolution_winner(
  p_explanation_id    integer,       -- NULL for prompt-based runs
  p_variant_id        uuid,
  p_run_id            uuid,
  p_applied_by        uuid
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_variant_content   text;
  v_current_content   text;
BEGIN
  -- Step 0 (SCRIPT-2): Fetch and validate variant content
  SELECT variant_content INTO v_variant_content
    FROM content_evolution_variants
   WHERE id = p_variant_id;

  IF v_variant_content IS NULL OR trim(v_variant_content) = '' THEN
    RAISE EXCEPTION 'Empty or null variant content for variant %', p_variant_id;
  END IF;

  -- Step 1 (SCRIPT-7): Save history for rollback — skip for prompt-based runs
  IF p_explanation_id IS NOT NULL THEN
    SELECT content INTO v_current_content
      FROM explanations
     WHERE id = p_explanation_id;

    IF v_current_content IS NULL THEN
      RAISE EXCEPTION 'Explanation % not found', p_explanation_id;
    END IF;

    INSERT INTO content_history (
      explanation_id, previous_content, new_content, source, evolution_run_id, applied_by
    ) VALUES (
      p_explanation_id, v_current_content, v_variant_content,
      'evolution_pipeline', p_run_id, p_applied_by
    );

    -- Step 2: Update article content
    UPDATE explanations
       SET content = v_variant_content
     WHERE id = p_explanation_id;
  END IF;

  -- Step 3: Mark variant as winner
  UPDATE content_evolution_variants
     SET is_winner = true
   WHERE id = p_variant_id;

  RETURN jsonb_build_object(
    'success', true,
    'variant_id', p_variant_id,
    'explanation_id', p_explanation_id,
    'history_skipped', (p_explanation_id IS NULL)
  );
END;
$$;

COMMENT ON FUNCTION apply_evolution_winner IS
  'Atomically applies evolution winner: saves history, updates article, marks variant. '
  'Skips history+article update for prompt-based runs (NULL explanation_id).';
