-- Tracks content changes for rollback support.
-- Created before applying evolution winners or manual edits.

CREATE TABLE content_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  explanation_id INT NOT NULL REFERENCES explanations(id) ON DELETE CASCADE,
  previous_content TEXT NOT NULL,
  new_content TEXT NOT NULL,
  source TEXT NOT NULL
    CHECK (source IN ('evolution_pipeline', 'manual_edit', 'import')),
  evolution_run_id UUID REFERENCES content_evolution_runs(id) ON DELETE SET NULL,
  applied_by UUID NOT NULL,
  applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_content_history_explanation
  ON content_history (explanation_id, applied_at DESC);
