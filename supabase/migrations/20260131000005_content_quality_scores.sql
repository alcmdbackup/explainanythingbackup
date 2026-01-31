-- Per-article per-dimension quality scores from LLM evaluation.
-- Part of Phase D: Quality Evals system.

CREATE TABLE content_quality_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  explanation_id INT NOT NULL REFERENCES explanations(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL
    CHECK (dimension IN (
      'clarity', 'structure', 'engagement', 'conciseness',
      'coherence', 'specificity', 'point_of_view', 'overall'
    )),
  score NUMERIC(3, 2) NOT NULL
    CHECK (score >= 0 AND score <= 1),
  rationale TEXT NOT NULL,
  model TEXT NOT NULL,
  eval_run_id UUID,
  estimated_cost_usd NUMERIC(10, 4) NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Fast lookup: latest scores per article per dimension
CREATE INDEX idx_quality_scores_explanation
  ON content_quality_scores (explanation_id, dimension, created_at DESC);

-- For eval run aggregation
CREATE INDEX idx_quality_scores_run
  ON content_quality_scores (eval_run_id)
  WHERE eval_run_id IS NOT NULL;
