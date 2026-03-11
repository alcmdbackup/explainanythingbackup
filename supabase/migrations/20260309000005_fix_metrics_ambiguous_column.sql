-- Fix ambiguous "explanationid" column reference in refresh_explanation_metrics.
-- The RETURNS TABLE defined "explanationid" which clashed with column names
-- in subquery tables (userLibrary, userExplanationEvents), causing
-- "column reference 'explanationid' is ambiguous" errors.
-- Fix: qualify all column references in subqueries with table aliases.

CREATE OR REPLACE FUNCTION public.refresh_explanation_metrics(explanation_ids integer[])
 RETURNS TABLE(id integer, explanationid integer, total_saves integer, total_views integer, save_rate numeric, last_updated timestamp with time zone)
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- Batch calculate and upsert metrics for all explanation IDs
    INSERT INTO "explanationMetrics" ("explanationid", total_saves, total_views, save_rate, last_updated)
    SELECT
        exp_id,
        COALESCE(saves.save_count, 0) as total_saves,
        COALESCE(views.view_count, 0) as total_views,
        CASE
            WHEN COALESCE(views.view_count, 0) > 0 THEN
                ROUND((COALESCE(saves.save_count, 0)::DECIMAL / views.view_count::DECIMAL), 4)
            ELSE 0.0000
        END as save_rate,
        NOW() as last_updated
    FROM unnest(explanation_ids) AS exp_id
    LEFT JOIN (
        -- Calculate saves for each explanation
        SELECT ul."explanationid" AS eid, COUNT(*) as save_count
        FROM "userLibrary" ul
        WHERE ul."explanationid" = ANY(explanation_ids)
        GROUP BY ul."explanationid"
    ) saves ON exp_id = saves.eid
    LEFT JOIN (
        -- Calculate views for each explanation
        SELECT uee."explanationid" AS eid, SUM(uee.value) as view_count
        FROM "userExplanationEvents" uee
        WHERE uee."explanationid" = ANY(explanation_ids)
        AND uee.event_name = 'explanation_viewed'
        GROUP BY uee."explanationid"
    ) views ON exp_id = views.eid
    ON CONFLICT ("explanationid")
    DO UPDATE SET
        total_saves = EXCLUDED.total_saves,
        total_views = EXCLUDED.total_views,
        save_rate = EXCLUDED.save_rate,
        last_updated = EXCLUDED.last_updated;

    -- Return all updated records
    RETURN QUERY
    SELECT m.id, m."explanationid", m.total_saves, m.total_views, m.save_rate, m.last_updated
    FROM "explanationMetrics" m
    WHERE m."explanationid" = ANY(explanation_ids)
    ORDER BY m."explanationid";
END;
$function$;
