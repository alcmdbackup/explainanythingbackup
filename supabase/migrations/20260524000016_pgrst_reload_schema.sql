-- Force PostgREST to reload its schema cache after the prior migration
-- (20260506000002) added evolution_variants.sentence_verbatim_ratio. The
-- ADD COLUMN ran but PostgREST's schema cache stayed stale on the staging
-- project, causing "Could not find the 'sentence_verbatim_ratio' column"
-- errors at runtime. Sending NOTIFY pgrst tells PostgREST to refresh.

NOTIFY pgrst, 'reload schema';
