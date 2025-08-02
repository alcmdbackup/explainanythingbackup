-- =============================================================================
-- SUPABASE AGGREGATE METRICS SETUP
-- =============================================================================
-- This file contains SQL scripts to set up the aggregate metrics system
-- Run these commands in your Supabase SQL editor

-- =============================================================================
-- 1. CREATE AGGREGATE METRICS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS "explanationMetrics" (
    id SERIAL PRIMARY KEY,
    explanationid INTEGER NOT NULL,
    total_saves INTEGER NOT NULL DEFAULT 0,
    total_views INTEGER NOT NULL DEFAULT 0,
    save_rate DECIMAL(5,4) NOT NULL DEFAULT 0.0000, -- 4 decimal places for precision
    last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT explanationMetrics_explanationid_unique UNIQUE (explanationid),
    CONSTRAINT explanationMetrics_total_saves_check CHECK (total_saves >= 0),
    CONSTRAINT explanationMetrics_total_views_check CHECK (total_views >= 0),
    CONSTRAINT explanationMetrics_save_rate_check CHECK (save_rate >= 0.0 AND save_rate <= 1.0)
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS explanationMetrics_explanationid_idx ON "explanationMetrics" (explanationid);
CREATE INDEX IF NOT EXISTS explanationMetrics_last_updated_idx ON "explanationMetrics" (last_updated);

-- =============================================================================
-- 2. STORED PROCEDURE: Refresh metrics for multiple explanations (batch operation)
-- =============================================================================

CREATE OR REPLACE FUNCTION refresh_explanation_metrics(explanation_ids INTEGER[])
RETURNS TABLE (
    id INTEGER,
    explanationid INTEGER,
    total_saves INTEGER,
    total_views INTEGER,
    save_rate DECIMAL(5,4),
    last_updated TIMESTAMPTZ
) 
LANGUAGE plpgsql
AS $$
BEGIN
    -- Batch calculate and upsert metrics for all explanation IDs
    INSERT INTO "explanationMetrics" (explanationid, total_saves, total_views, save_rate, last_updated)
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
        SELECT explanationid, COUNT(*) as save_count
        FROM "userLibrary"
        WHERE explanationid = ANY(explanation_ids)
        GROUP BY explanationid
    ) saves ON exp_id = saves.explanationid
    LEFT JOIN (
        -- Calculate views for each explanation  
        SELECT explanationid, SUM(value) as view_count
        FROM "userExplanationEvents"
        WHERE explanationid = ANY(explanation_ids)
        AND event_name = 'explanation_viewed'
        GROUP BY explanationid
    ) views ON exp_id = views.explanationid
    ON CONFLICT (explanationid) 
    DO UPDATE SET
        total_saves = EXCLUDED.total_saves,
        total_views = EXCLUDED.total_views,
        save_rate = EXCLUDED.save_rate,
        last_updated = EXCLUDED.last_updated;
    
    -- Return all updated records
    RETURN QUERY
    SELECT m.id, m.explanationid, m.total_saves, m.total_views, m.save_rate, m.last_updated
    FROM "explanationMetrics" m
    WHERE m.explanationid = ANY(explanation_ids)
    ORDER BY m.explanationid;
END;
$$;

-- =============================================================================
-- 3. STORED PROCEDURE: Refresh metrics for all explanations
-- =============================================================================

CREATE OR REPLACE FUNCTION refresh_all_explanation_metrics()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    all_explanation_ids INTEGER[];
    processed_count INTEGER := 0;
BEGIN
    -- Get all unique explanation IDs from both tables
    SELECT ARRAY(
        SELECT DISTINCT explanationid 
        FROM (
            SELECT explanationid FROM "userLibrary"
            UNION
            SELECT explanationid FROM "userExplanationEvents"
            WHERE event_name = 'explanation_viewed'
        ) AS all_explanations
        ORDER BY explanationid
    ) INTO all_explanation_ids;
    
    -- If no explanations found, return 0
    IF all_explanation_ids IS NULL OR array_length(all_explanation_ids, 1) IS NULL THEN
        RETURN 0;
    END IF;
    
    -- Refresh metrics for all explanations in one batch operation
    PERFORM refresh_explanation_metrics(all_explanation_ids);
    
    -- Return count of processed explanations
    processed_count := array_length(all_explanation_ids, 1);
    RETURN processed_count;
END;
$$;

-- =============================================================================
-- 4. STORED PROCEDURE: Increment view count efficiently
-- =============================================================================

CREATE OR REPLACE FUNCTION increment_explanation_views(p_explanation_id INTEGER)
RETURNS TABLE (
    id INTEGER,
    explanation_id INTEGER,
    total_saves INTEGER,
    total_views INTEGER,
    save_rate DECIMAL(5,4),
    last_updated TIMESTAMPTZ
) 
LANGUAGE plpgsql
AS $$
BEGIN
    -- Simply increment existing view count by 1 and recalculate save rate
    INSERT INTO "explanationMetrics" (explanationid, total_saves, total_views, save_rate, last_updated)
    VALUES (p_explanation_id, 0, 1, 0.0000, NOW())
    ON CONFLICT (explanationid) 
    DO UPDATE SET
        total_views = "explanationMetrics".total_views + 1,
        save_rate = CASE 
            WHEN "explanationMetrics".total_views + 1 > 0 THEN 
                ROUND(("explanationMetrics".total_saves::DECIMAL / ("explanationMetrics".total_views + 1)::DECIMAL), 4)
            ELSE 0.0000
        END,
        last_updated = NOW();
    
    -- Return the updated record
    RETURN QUERY
    SELECT m.id, m.explanationid AS explanation_id, m.total_saves, m.total_views, m.save_rate, m.last_updated
    FROM "explanationMetrics" m
    WHERE m.explanationid = p_explanation_id;
END;
$$;

-- =============================================================================
-- 5. STORED PROCEDURE: Increment save count efficiently
-- =============================================================================

CREATE OR REPLACE FUNCTION increment_explanation_saves(p_explanation_id INTEGER)
RETURNS TABLE (
    id INTEGER,
    explanation_id INTEGER,
    total_saves INTEGER,
    total_views INTEGER,
    save_rate DECIMAL(5,4),
    last_updated TIMESTAMPTZ
) 
LANGUAGE plpgsql
AS $$
BEGIN
    -- Simply increment existing save count by 1 and recalculate save rate
    INSERT INTO "explanationMetrics" (explanationid, total_saves, total_views, save_rate, last_updated)
    VALUES (p_explanation_id, 1, 0, 0.0000, NOW())
    ON CONFLICT (explanationid) 
    DO UPDATE SET
        total_saves = "explanationMetrics".total_saves + 1,
        save_rate = CASE 
            WHEN "explanationMetrics".total_views > 0 THEN 
                ROUND((("explanationMetrics".total_saves + 1)::DECIMAL / "explanationMetrics".total_views::DECIMAL), 4)
            ELSE 0.0000
        END,
        last_updated = NOW();
    
    -- Return the updated record
    RETURN QUERY
    SELECT m.id, m.explanationid AS explanation_id, m.total_saves, m.total_views, m.save_rate, m.last_updated
    FROM "explanationMetrics" m
    WHERE m.explanationid = p_explanation_id;
END;
$$;

-- =============================================================================
-- 6. AUTOMATIC TRIGGERS (NOT RECOMMENDED - CAUSES DOUBLE COUNTING)
-- =============================================================================
-- NOTE: These triggers are NOT needed since we handle metric updates in application code
-- Having both application-level updates AND database triggers would cause double counting
-- 
-- If you want database-only updates (without application code), uncomment below:
--
-- CREATE OR REPLACE FUNCTION update_metrics_on_save_change()
-- RETURNS TRIGGER LANGUAGE plpgsql AS $$
-- BEGIN
--     IF TG_OP = 'INSERT' THEN
--         PERFORM increment_explanation_saves(NEW.explanationid);
--         RETURN NEW;
--     ELSIF TG_OP = 'DELETE' THEN  
--         PERFORM refresh_explanation_metrics(OLD.explanationid);
--         RETURN OLD;
--     END IF;
--     RETURN NULL;
-- END; $$;
--
-- CREATE TRIGGER userLibrary_metrics_trigger
--     AFTER INSERT OR DELETE ON "userLibrary"
--     FOR EACH ROW EXECUTE FUNCTION update_metrics_on_save_change();

-- =============================================================================
-- 7. EXAMPLE QUERIES AND USAGE
-- =============================================================================

/*
-- Refresh metrics for a single explanation
SELECT * FROM refresh_explanation_metrics(ARRAY[123]);

-- Refresh metrics for multiple explanations (batch operation)
SELECT * FROM refresh_explanation_metrics(ARRAY[123, 456, 789]);

-- Refresh all explanation metrics
SELECT refresh_all_explanation_metrics();

-- Get top explanations by save rate
SELECT 
    explanationid,
    total_saves,
    total_views,
    save_rate,
    last_updated
FROM "explanationMetrics"
WHERE total_views > 10  -- Only consider explanations with meaningful view counts
ORDER BY save_rate DESC, total_saves DESC
LIMIT 10;

-- Get metrics for multiple explanations
SELECT * FROM "explanationMetrics" 
WHERE explanationid IN (1, 2, 3, 4, 5);

-- Performance analytics query
SELECT 
    CASE 
        WHEN save_rate >= 0.1 THEN 'High Engagement (10%+)'
        WHEN save_rate >= 0.05 THEN 'Medium Engagement (5-10%)'
        WHEN save_rate >= 0.01 THEN 'Low Engagement (1-5%)'
        ELSE 'Very Low Engagement (<1%)'
    END as engagement_tier,
    COUNT(*) as explanation_count,
    AVG(save_rate) as avg_save_rate,
    AVG(total_views) as avg_views,
    AVG(total_saves) as avg_saves
FROM "explanationMetrics"
WHERE total_views > 0
GROUP BY engagement_tier
ORDER BY avg_save_rate DESC;
*/