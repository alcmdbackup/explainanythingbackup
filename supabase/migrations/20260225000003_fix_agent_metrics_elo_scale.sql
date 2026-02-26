commit 2dd6387f7e4d630ea222cc01d1294c3e8aefb52f
Author: ac <abel@minddojo.org>
Date:   Wed Feb 25 20:43:06 2026 -0800

    untracked files on feat/agent_comparison_analysis_evolution_20260225: f75d7cbf plan: complete research and reviewed execution plan for agent metrics fix

diff --git a/supabase/migrations/20260225000001_fix_agent_metrics_elo_scale.sql b/supabase/migrations/20260225000001_fix_agent_metrics_elo_scale.sql
new file mode 100644
index 00000000..02579425
--- /dev/null
+++ b/supabase/migrations/20260225000001_fix_agent_metrics_elo_scale.sql
@@ -0,0 +1,69 @@
+-- Fix agent metrics Elo computation: avg_elo was stored as raw OpenSkill mu (~25 scale)
+-- instead of ordinalToEloScale(getOrdinal()) (~1200 scale). Backfill from the correct
+-- elo_score values already persisted in evolution_variants.
+--
+-- NOTE: evolution_variants.agent_name stores STRATEGY names (e.g., 'structural_transform'),
+-- not agent names. See persistence.ts:77. The CASE expression below mirrors getAgentForStrategy().
+
+-- Step 0: Snapshot current values for rollback capability
+CREATE TABLE IF NOT EXISTS _backup_agent_metrics_pre_elo_fix AS
+SELECT id, run_id, agent_name, avg_elo, elo_gain, elo_per_dollar
+FROM evolution_run_agent_metrics;
+
+-- Step 1: Derive correct Elo-scale values from evolution_variants
+-- Using a CTE with the strategy-to-agent mapping to avoid repeating the CASE
+WITH strategy_agent_map AS (
+  SELECT
+    v.run_id,
+    CASE
+      WHEN v.agent_name IN ('structural_transform', 'lexical_simplify', 'grounding_enhance')
+        THEN 'generation'
+      WHEN v.agent_name IN ('mutate_clarity', 'mutate_structure', 'crossover', 'creative_exploration')
+        THEN 'evolution'
+      WHEN v.agent_name = 'debate_synthesis' THEN 'debate'
+      WHEN v.agent_name = 'original_baseline' THEN 'original'
+      WHEN v.agent_name IN ('outline_generation', 'mutate_outline') THEN 'outlineGeneration'
+      WHEN v.agent_name LIKE 'critique_edit_%' THEN 'iterativeEditing'
+      WHEN v.agent_name LIKE 'section_decomposition_%' THEN 'sectionDecomposition'
+      WHEN v.agent_name LIKE 'tree_search_%' THEN 'treeSearch'
+      ELSE NULL
+    END AS mapped_agent,
+    v.elo_score
+  FROM evolution_variants v
+  WHERE v.agent_name IS NOT NULL
+),
+derived AS (
+  SELECT
+    run_id,
+    mapped_agent AS agent_name,
+    AVG(elo_score) AS avg_elo,
+    AVG(elo_score) - 1200 AS elo_gain
+  FROM strategy_agent_map
+  WHERE mapped_agent IS NOT NULL
+  GROUP BY run_id, mapped_agent
+)
+UPDATE evolution_run_agent_metrics m
+SET
+  avg_elo = d.avg_elo,
+  elo_gain = d.elo_gain,
+  elo_per_dollar = CASE
+    WHEN m.cost_usd > 0 THEN d.elo_gain / m.cost_usd
+    ELSE NULL
+  END
+FROM derived d
+WHERE m.run_id = d.run_id
+  AND m.agent_name = d.agent_name;
+
+-- Step 2: Fix stale comment in column description
+COMMENT ON COLUMN evolution_run_agent_metrics.elo_per_dollar IS
+  'Elo points gained per dollar spent: (avg_elo - 1200) / cost_usd, where avg_elo is on the 0-3000 Elo scale';
+
+-- Rollback:
+-- SELECT count(*) FROM _backup_agent_metrics_pre_elo_fix; -- verify backup exists
+-- UPDATE evolution_run_agent_metrics m
+-- SET avg_elo = b.avg_elo, elo_gain = b.elo_gain, elo_per_dollar = b.elo_per_dollar
+-- FROM _backup_agent_metrics_pre_elo_fix b WHERE m.id = b.id;
+-- DROP TABLE _backup_agent_metrics_pre_elo_fix;
+--
+-- After confirming the migration is correct, clean up the backup table:
+-- DROP TABLE IF EXISTS _backup_agent_metrics_pre_elo_fix;
