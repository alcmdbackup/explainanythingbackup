-- Partial unique index on evolution_prompts.prompt for paragraph topics.
-- Per D14 of rank_individual_paragraphs_evolution_20260525.
--
-- Required for upsertSlotTopic's ON CONFLICT (prompt) WHERE prompt_kind='paragraph'
-- DO NOTHING semantics. Scoped to paragraph topics so article-topic duplicate
-- behavior is unchanged (article topics historically allow duplicate `prompt`
-- text; preserving that).
--
-- Verified via grep across all prior migrations: NO unique constraint exists
-- today on evolution_prompts.prompt or .name. This is a net-new constraint
-- needed for paragraph_recombine's per-(parent_variant_id, slot_index) topic
-- identity (D10).
--
-- Existing duplicates check: not possible because prompt_kind='paragraph' itself
-- is new (default 'article'), so no rows can violate the partial index at
-- creation time.

CREATE UNIQUE INDEX IF NOT EXISTS uq_evolution_prompts_paragraph_topic
  ON evolution_prompts(prompt)
  WHERE prompt_kind = 'paragraph';
