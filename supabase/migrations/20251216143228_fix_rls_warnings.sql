-- Fix RLS warnings from Supabase advisors
-- 1. Add policies to testing_edits_pipeline (RLS enabled but no policies)

-- SELECT: use USING clause
create policy "Enable read for authenticated users"
on public.testing_edits_pipeline for select
to authenticated
using (true);

-- INSERT: use WITH CHECK clause
create policy "Enable insert for authenticated users"
on public.testing_edits_pipeline for insert
to authenticated
with check (true);

-- UPDATE: USING applies to both row selection and new values when WITH CHECK omitted
create policy "Enable update for authenticated users"
on public.testing_edits_pipeline for update
to authenticated
using (true);

-- DELETE: use USING clause
create policy "Enable delete for authenticated users"
on public.testing_edits_pipeline for delete
to authenticated
using (true);

-- 2. Fix function search paths (security definer functions should set search_path)
alter function public.refresh_explanation_metrics set search_path = '';
alter function public.refresh_all_explanation_metrics set search_path = '';
alter function public.increment_explanation_views set search_path = '';
alter function public.increment_explanation_saves set search_path = '';
