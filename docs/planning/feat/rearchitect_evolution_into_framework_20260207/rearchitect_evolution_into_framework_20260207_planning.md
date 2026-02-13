# Rearchitect Evolution Into Framework Plan

## Background
Systematically rework the evolution pipeline into a new framework built around core primitives: prompt, strategy (run config), run, hall of fame, pipeline type, agent, and article. The key relationship is prompt + strategy = run, with every run feeding its top 3 outputs into a hall of fame. This enables multi-dimensional dashboards that slice by prompt, strategy, run, pipeline type, agent, and article, with clear units of analysis (run, article, task — where task is an agent operating on an article). The goal is to move from the current monolithic evolution system to a composable, analyzable framework where every dimension is a first-class entity.

## Problem
The evolution pipeline has strong execution infrastructure (12 agents, phase-aware supervisor, checkpoint/resume, budget enforcement) but lacks the data model to support systematic experimentation and analysis. Runs are triggered with ad-hoc configs (`queueEvolutionRunAction({ explanationId, budgetCapUsd? })`) — there is no enforced linkage between a run and a pre-defined prompt or strategy. The article bank serves as a proto-hall-of-fame but only stores single winners (not top 3), and "By Prompt" and "By Pipeline Type" are completely absent as dashboard dimensions. The result is a system that can generate well but cannot systematically compare across prompts, strategies, or pipeline types — making it impossible to answer questions like "Which strategy works best for hard prompts?" or "Does the full pipeline consistently outperform minimal for science topics?".

## Framework Goals

### G-1: Structured Generation
Every generation run is prompt × strategy, executed by a defined pipeline type with configured agents. No ad-hoc generation — every output is traceable to its inputs and config.

### G-2: Robust Analysis
All dimensions (prompt, strategy, run, pipeline type, agent, article) are first-class queryable entities. Dashboards slice across any dimension. Units of analysis (run, article, task) provide per-task attribution, not just aggregates.

### G-3: Iteration Based on Findings
Analysis feeds back into generation. Underperforming strategies/agents/prompts are identified and adjusted. The hall of fame accumulates best outputs across runs for cross-generation comparison and regression detection. The loop: **generate → analyze → adjust → generate**.

## Design Constraints

### DC-1: Enforced Pre-defined Strategies and Prompts
Every run must reference a pre-existing strategy and prompt by ID. Ad-hoc creation at run-trigger time is not allowed.

- **Prompt registry**: A `prompts` table (or repurposed `article_bank_topics`) holding curated prompts. Each prompt has an ID, text, difficulty tier, domain tags, and active/archived status. Runs FK to `prompt_id`.
- **Strategy registry**: A `strategies` table (or formalized `strategy_configs`) holding named configurations. Each strategy defines model choices, iteration count, budget cap, agent selection, and pipeline type. Runs FK to `strategy_id`.
- **Run trigger contract**: `queueRun({ promptId, strategyId, explanationId? })` — no inline config overrides. The strategy IS the config. `explanationId` is optional (already nullable per migration `20260131000008`): prompt-only runs (for article bank experiments) pass `promptId` + `strategyId` without an explanation; article-specific runs also pass `explanationId` to link the evolved article. During the transition period (Phases 2-3), `promptId` and `strategyId` are also optional to maintain backward compatibility with existing callers.
- **CLI enforcement**: `--prompt-id <id>` or `--prompt <text>` that resolves to an existing prompt (error if not found). No free-form prompt creation.
- **Admin UI**: CRUD pages for both registries. Run queue dialog selects from dropdowns, not free-text fields.
- **Migration path**: Existing `strategy_configs` rows become seed data. Existing `article_bank_topics` prompts become seed data. Existing runs without strategy/prompt FKs get backfilled or marked as legacy.

### DC-2: Unified Dimensional View
A single dashboard page replaces the current siloed dashboards. Users select dimension filters (prompt, strategy, pipeline type, agent — one or many) and a unit of analysis (run, article, or task), and the view shows results matching ALL selected filters.

- **Dimension filters**: Two filter levels — entity selectors and attribute filters:
  - **Entity selectors**: Multi-select dropdowns for prompt, strategy, pipeline type, agent, date range. Multiple values per dimension (OR within, AND across). Optional run ID and variant ID text inputs for targeted comparison (e.g., "compare runs X, Y, Z side-by-side").
  - **Attribute filters** (collapsible panel): Filter by entity properties without knowing IDs. Prompt attributes: difficulty tier (multi-select: easy/medium/hard), domain tags (multi-select chips). Strategy attributes: model (multi-select), budget range (min/max). Attribute filters resolve to entity IDs server-side — selecting `difficulty_tier = 'hard'` finds matching prompt IDs and applies them as an entity filter. Attribute filters compose with entity selectors (AND).
- **Unit of analysis toggle**: Switch between three views of the same filtered data. Every view provides links to the other two views (see cross-unit drill-down principle below):
  - **Run view**: Each row is a run. Columns: prompt, strategy, pipeline type, cost, duration, final Elo, variant count, status. Expand → articles by iteration stage + agent task list (each linking to Task view with debug). Click any article → Article view.
  - **Article view**: Each row is a variant from `content_evolution_variants` — ALL articles, not just hall-of-fame top 3. Columns: content preview, Elo, agent (clickable → Task view), iteration, parent article, run link (clickable → Run view), prompt. Expand → full content + lineage chain + creating task with "View agent debug" link.
  - **Task view**: Each row is an agent × run. Columns: agent name, run (clickable → Run view), prompt, cost, variants added, Elo gain, Elo/dollar. Expand → input/output articles (each clickable → Article view) + agent debug panel (see agent debug drill-down below).
- **Article visibility principle**: Every unit of analysis shows its input and output articles. A run shows articles per stage. A task shows the agent's input → output articles. An article shows its parent and children. No unit is just a row of numbers — articles are always accessible.
- **Aggregation bar**: Summary stats that update with the current filter set (total runs, avg Elo, total cost, avg cost/run, top strategy, top agent).
- **Visualization mode toggle**: Three modes — Table (default) | Matrix | Trend. Sits beside the unit-of-analysis toggle. Table mode uses the run/article/task unit views described above. Matrix and Trend modes provide aggregate visualizations:
  - **Matrix mode**: Pivot grid with two selectable dimensions (rows × columns) and a metric (avg Elo, total cost, run count, avg Elo/dollar, success rate). Example: rows = prompts, columns = strategies, cells = avg Elo. Color-coded heatmap cells (green = high, red = low; inverted for cost metrics). Click any cell → switches to Table mode filtered to that dimension intersection. Dimensional selectors for row/column default to prompt × strategy but allow any pair from {prompt, strategy, pipeline type, agent}. Constraint: row ≠ column. Respects all active filters from the filter bar.
  - **Trend mode**: Time-series line chart. X-axis = time (day/week/month bucket selector). Y-axis = selectable metric (avg Elo, total cost, run count, success rate). Lines grouped by a selectable dimension (prompt, strategy, pipeline type, agent — default: strategy). Limited to top 10 dimension values by run count; remaining aggregated into "Other" dashed line. Hover shows tooltip with exact values. Click any data point → switches to Table mode filtered to that time bucket + group value. Respects all active filters from the filter bar.
- **Cross-unit drill-down principle**: From any unit view, you can always reach the other two units and agent details. The three units form a navigable triangle — Run ↔ Article ↔ Task — with agent debug accessible from any context where an agent is mentioned:
  - **From Run** → Click run row to see full run detail. Expand row shows: (a) articles grouped by iteration stage, (b) **agent task list** — every agent that operated during this run, with cost, variants added, Elo gain, and a clickable link that scrolls/switches to that agent's task row in Task view with the agent debug panel open.
  - **From Article** → Click article row to see full article content. Expand row shows: (a) parent/child lineage chain, (b) **creating task** — the agent name, run link, cost for that agent × run, and a "View agent debug" link that opens the task view filtered to that agent × run with the debug panel expanded.
  - **From Task** → Click task row to open agent debug panel (see below). Links in the row: (a) **run link** → navigates to run detail or switches to Run view filtered to that run, (b) **article links** → each input/output article is clickable, switching to Article view filtered to that variant with lineage expanded.
  - **Agent name links**: Everywhere an agent name appears (run expand, article expand, task rows, article "created by" column), clicking the agent name navigates to Task view filtered by that agent across all runs (seeing the agent's aggregate performance).
- **Agent debug drill-down**: From the task view, expanding an agent × run row shows a full debug panel with everything that agent did. Data extracted from `evolution_checkpoints.state_snapshot` JSONB for the relevant iteration(s). Each agent type gets a tailored debug view:
  - **CalibrationRanker / Tournament**: Match history table (variant A vs B, winner, confidence, dimension scores per match). Rating changes (mu/sigma before→after). Opponent selection rationale.
  - **ReflectionAgent**: Critique cards per variant — dimensional scores (1-10) as bar chart, good/bad example quotes, per-dimension notes.
  - **DebateAgent**: Full debate transcript — Advocate A argument, Advocate B argument, Judge verdict, synthesis comparison. Side-by-side view of input variants.
  - **MetaReviewAgent**: Strategy effectiveness leaderboard (successful/weak/failing), recurring weaknesses list, priority improvements, patterns to avoid.
  - **TreeSearchAgent**: Interactive tree visualization (d3-dag) — nodes show variant preview + evaluation score, edges show revision action type, pruned branches grayed out, best path highlighted.
  - **SectionDecompositionAgent**: Article sections table — heading, original body preview, edited body preview, accept/reject verdict, improvement dimension.
  - **OutlineGenerationAgent**: Step pipeline view — outline→expand→polish with per-step score (0-1), weakest step flagged, intermediate outputs viewable.
  - **IterativeEditingAgent**: Edit cycle log — target dimension, edit applied, judge verdict (accept/reject), confidence. Shows cycles 1-3 progression.
  - **GenerationAgent / EvolutionAgent**: Strategy variants table — strategy name, output article preview, Elo score. For EvolutionAgent: parent selection, operator (mutate/crossover/creative).
  - **ProximityAgent**: Diversity trend chart + top-10 pairwise similarity heatmap.
  - **LLM calls**: For any agent, a collapsible section showing all LLM calls from `llmCallTracking` (model, tokens, cost, timestamp) filtered by `call_source` pattern and run time window.
- **Server actions**: Three actions power the Explorer (all require `requireAdmin()` + `createSupabaseServiceClient()`):
  - **`getUnifiedExplorerAction`**: Table mode. Accepts entity filters (`promptIds`, `strategyIds`, `pipelineTypes`, `agentNames`, `runIds`, `variantIds`), attribute filters (`difficultyTiers`, `domainTags`, `models`, `budgetRange`), `dateRange`, and `unitOfAnalysis`. Attribute filters resolve to entity IDs via subqueries, then intersect with any explicit entity IDs. **Security: All filter values MUST use parameterized queries (Supabase `.in()` / `.filter()` or `$1`-style placeholders) — never string-interpolated SQL.** Backed by JOINs across `content_evolution_runs`, `content_evolution_variants`, `strategy_configs`, `article_bank_topics`, and `evolution_run_agent_metrics`. Article data from `content_evolution_variants` (all variants, including prompt-only runs — `explanation_id` is already nullable per migration `20260131000009`), enriched with `article_bank_entries` rank where available.
  - **`getExplorerMatrixAction`**: Matrix mode. Accepts `{ rowDimension, colDimension, metric, ...sharedFilters }`. Returns `{ rows: { id, label }[], cols: { id, label }[], cells: { rowId, colId, value, runCount }[] }`. Sparse — only cells with data returned. Backed by GROUP BY on both dimensions with aggregate metric calculation.
  - **`getExplorerTrendAction`**: Trend mode. Accepts `{ groupByDimension, metric, timeBucket: 'day'|'week'|'month', ...sharedFilters }`. Returns `{ series: { dimensionId, dimensionLabel, points: { date, value }[] }[] }`. Limited to top 10 dimension values; rest aggregated as "Other". Backed by `date_trunc()` grouping with per-dimension aggregation.

### DC-3: Evolution Dashboard Organization

The evolution dashboard is a separate admin sub-app with its own sidebar navigation (`EvolutionSidebar.tsx`), overview page (`/admin/evolution-dashboard`), and path-based sidebar switching (`SidebarSwitcher.tsx` renders the evolution sidebar for any path under `/admin/quality/` or `/admin/evolution-dashboard/`). All new pages in this plan are under `/admin/quality/`, so the sidebar auto-switch works without changes to path matching.

**Quality Scores removal**: The Quality Scores page (`/admin/quality`) evaluates existing articles via LLM scoring (clarity, structure, engagement, etc.) — it is not evolution-specific. The ReflectionAgent already produces equivalent per-variant dimensional critiques visible through the Explorer's agent debug panel. Quality Scores is removed from the evolution sidebar and moved to the main `AdminSidebar.tsx`. `SidebarSwitcher.tsx` updated: remove `pathname === '/admin/quality'` from the evolution path condition (the `startsWith('/admin/quality/')` with trailing slash still covers all evolution sub-pages).

**Current state (6 pages, 6 sidebar items):**

```
Evolution Dashboard
├── 📊 Overview              /admin/evolution-dashboard         — Stat cards + quick links
├── 🔄 Pipeline Runs         /admin/quality/evolution           — Run list, queue dialog, status filters
│   ├── Run Detail            /admin/quality/evolution/run/[id] — 6-tab detail (timeline, variants, etc.)
│   └── Ops Dashboard         /admin/quality/evolution/dashboard — Timeseries charts, aggregate metrics
├── 🎯 Elo Optimization      /admin/quality/optimization        — Strategy leaderboard, agent ROI, Pareto
├── 📚 Article Bank           /admin/quality/article-bank        — Topic list → topic detail (4 tabs)
└── ⭐ Quality Scores         /admin/quality                     — Content quality scoring (REMOVING)
```

**After framework (8 sidebar items — 3 added, 1 removed):**

```
Evolution Dashboard
├── 📊 Overview              /admin/evolution-dashboard         — Stat cards (add prompt + strategy counts) + quick links
├── 🔍 Explorer          (+) /admin/quality/explorer            — Unified dimensional view (DC-2): filter by prompt/strategy/pipeline/agent, toggle run/article/task view
├── 🔄 Runs                  /admin/quality/evolution           — Run list (add prompt + pipeline type columns), queue dialog (add prompt + strategy dropdowns)
│   ├── Run Detail            /admin/quality/evolution/run/[id] — Existing 6-tab detail (unchanged)
│   └── Ops Dashboard         /admin/quality/evolution/dashboard — Existing timeseries (unchanged)
├── 💬 Prompts            (+) /admin/quality/prompts             — CRUD for prompts: text, difficulty tier, domain tags, status, run count
├── ⚙️ Strategies         (+) /admin/quality/strategies           — CRUD for strategies: models, iterations, budget, pipeline type, agent selection
├── 🎯 Optimization          /admin/quality/optimization        — Strategy leaderboard (add pipeline type filter chip)
└── 📚 Article Bank           /admin/quality/article-bank        — Topic list → topic detail (add rank badges for hall-of-fame entries)
```

**Page purposes:**

| Page | Purpose | Primary users |
|------|---------|---------------|
| Overview | At-a-glance health: success rate, spend, bank size. Entry point to all others. | Everyone |
| Explorer | Cross-dimensional analysis. "Which strategy works best for science prompts?" The primary analysis tool. | Analysts, researchers |
| Runs | Operational: queue runs (with prompt + strategy dropdowns), monitor status, retry failures. | Operators |
| Prompts | Manage the set of prompts used for runs. Curate difficulty and domain tags. | Content designers |
| Strategies | Define reusable strategy configs (models, budget, agents). Ensures reproducibility. | ML engineers |
| Optimization | Deep-dive into strategy/agent performance: Pareto efficiency, ROI rankings. | ML engineers |
| Article Bank | Hall of fame: top 3 outputs per prompt across all runs. Cross-prompt Elo comparisons. | Content reviewers |

**Navigation flow:**
- **Overview** → Quick links to all 7 other pages
- **Explorer** → Cross-unit drill-down links into Run Detail, and back
- **Runs** → Queue dialog uses Prompts + Strategies dropdowns
- **Prompts** ↔ **Explorer**: Click prompt → Explorer filtered by that prompt
- **Strategies** ↔ **Explorer**: Click strategy → Explorer filtered by that strategy
- **Optimization** ↔ **Explorer**: Supplementary views; optimization for deep per-strategy analysis, explorer for cross-dimensional

**Files to modify:**
- `src/components/admin/EvolutionSidebar.tsx` — Remove Quality Scores nav item, add 3 new (Explorer, Prompts, Strategies), rename Pipeline Runs → Runs. Final: 8 items.
- `src/app/admin/evolution-dashboard/page.tsx` — Remove Quality Scores QuickLinkCard, add 3 new + 2 stat cards (prompt count, strategy count)
- `src/components/admin/SidebarSwitcher.tsx` — Remove `pathname === '/admin/quality'` from evolution path condition (moves Quality Scores to main admin sidebar)
- `src/components/admin/AdminSidebar.tsx` — Add Quality Scores nav item

## Options Considered

### O-1: Prompt Registry — Repurpose `article_bank_topics` vs new table

**Option A (Recommended): Repurpose `article_bank_topics` as the prompt registry.** Add columns: `difficulty_tier TEXT`, `domain_tags TEXT[]`, `status TEXT` (active/archived). Runs FK to `article_bank_topics.id` as `prompt_id`. Existing entries become seed data automatically.
- Pro: No new table; already has case-insensitive unique prompt matching (`LOWER(TRIM(prompt))`); article bank entries naturally link to prompts; existing 5 `promptBankConfig.ts` prompts already exist as topics.
- Con: Conceptually couples "prompt registry" with "article bank topic" — but in this framework they ARE the same thing (every prompt that produces runs should be comparable in the bank).

**Option B: New `prompts` table.** Separate table with its own identity. `article_bank_topics` would FK to `prompts.id`.
- Pro: Clean separation of concerns.
- Con: More migration work; need to keep two tables in sync; article bank topics already serve this role.

**Decision: Option A.** The article bank topic IS the prompt — if you run a prompt through the framework, its outputs should be comparable in the bank. Renaming the conceptual relationship (topic = prompt) is simpler than maintaining two tables.

### O-2: Strategy Registry — Formalize existing `strategy_configs` vs new table

**Option A (Recommended): Evolve existing `strategy_configs`.** Add: `is_predefined BOOLEAN DEFAULT false` to distinguish manually-curated from auto-created. Add `pipeline_type TEXT`. Existing rows (auto-created) are preserved. New rows via admin UI are marked `is_predefined = true`.
- Pro: No new table; existing aggregated metrics (avg_elo, elo_per_dollar, run_count) preserved; SHA-256 dedup still works; optimization dashboard continues to work.
- Con: Mixed pre-defined and auto-created entries (filtered by `is_predefined` in admin UI).

**Option B: New `strategies` table, deprecate `strategy_configs`.**
- Pro: Clean semantics.
- Con: Lose existing aggregated metrics; all dashboard queries need rewriting; unnecessary churn.

**Decision: Option A.** The existing table has good bones: hash-based identity, auto-generated labels, aggregated performance metrics. Adding `is_predefined` is a one-column migration.

### O-3: Pipeline Type — Column enum vs separate table

**Option A (Recommended): Add `pipeline_type TEXT` column** to `content_evolution_runs` and `strategy_configs`. Values: `'full'`, `'minimal'`, `'batch'`.
- Pro: Simple; directly queryable; no joins; covers the known pipeline types.

**Option B: New `pipeline_types` lookup table with FK.**
- Pro: Extensible for future pipeline types.
- Con: Over-engineering for 2-3 values that are fundamentally code-level constructs.

**Decision: Option A.** Pipeline type is an enum with 2-3 values, not a rich entity that needs its own table.

### O-4: Hall of Fame — Extend article bank vs separate system

**Option A (Recommended): Extend article bank to store top 3.** Add `rank INT` column to `article_bank_entries`. After run completion, auto-insert top 3 variants (rank 1, 2, 3) into the bank. Swiss-style Elo comparisons continue to work across all bank entries.
- Pro: Builds on existing infrastructure (Elo ratings, comparison matches, leaderboard); no duplicate storage.
- Con: 3x more entries per run; need to filter by rank in some queries.

**Option B: New `hall_of_fame` table separate from article bank.**
- Pro: Conceptual clarity.
- Con: Duplicates article storage; separate Elo/comparison system needed; article bank already IS the hall of fame.

**Decision: Option A.** The article bank is the proto-hall-of-fame. Extending it to top 3 completes the design.

### O-5: Enforcement — Strict from day 1 vs gradual migration

**Option A: Strict. All entry points require `promptId` + `strategyId` immediately.**
- Pro: Clean enforcement; no legacy code paths.
- Con: All 8 entry points must update simultaneously; existing runs fail validation.

**Option B (Recommended): Gradual.** Phase 1: add columns as nullable. Phase 2: auto-populate for new runs. Phase 3: backfill existing. Phase 4: make NOT NULL.
- Pro: Incremental deployment; backward compatible during transition; existing runs don't break.
- Con: Temporary period of mixed ad-hoc + structured runs.

**Decision: Option B.** The framework has 8 entry points across admin UI, cron, CLI, and batch. Gradual migration avoids a big-bang cutover.

## Phased Execution Plan

### Phase 1: Data Model Migrations
**Goal**: All new columns and constraints in place, nullable, backward compatible.

**Prerequisites confirmed**: `explanation_id` is already nullable on both `content_evolution_runs` (migration `20260131000008`) and `content_evolution_variants` (migration `20260131000009`). This means prompt-only runs (no explanation) are already supported at the schema level.

**Migration 1a: Prompt metadata on `article_bank_topics`**
- Add `difficulty_tier TEXT` (null = unrated)
- Add `domain_tags TEXT[]` (empty array default)
- Add `status TEXT DEFAULT 'active'` CHECK IN ('active', 'archived')
- **Note**: `article_bank_topics` also has a `deleted_at` column for soft-delete. The `status` column is orthogonal: `status='archived'` means "not available for new runs" (visible in admin but not in run-queue dropdowns), while `deleted_at IS NOT NULL` means "fully hidden." Queries for the run-queue dropdown filter: `WHERE status = 'active' AND deleted_at IS NULL`.
- Rollback: `ALTER TABLE article_bank_topics DROP COLUMN IF EXISTS difficulty_tier, DROP COLUMN IF EXISTS domain_tags, DROP COLUMN IF EXISTS status;`

**Migration 1b: Prompt FK on runs**
- Add `prompt_id UUID REFERENCES article_bank_topics(id)` to `content_evolution_runs` (nullable)
- Index: `idx_evolution_runs_prompt ON content_evolution_runs(prompt_id)`
- Rollback: `DROP INDEX IF EXISTS idx_evolution_runs_prompt; ALTER TABLE content_evolution_runs DROP COLUMN IF EXISTS prompt_id;`

**Migration 1c: Strategy formalization**
- Add `is_predefined BOOLEAN DEFAULT false` to `strategy_configs`
- Add `pipeline_type TEXT` to `strategy_configs` CHECK IN ('full', 'minimal', 'batch')
- **Note**: `pipeline_type` is NOT included in `hashStrategyConfig()` — it is a column-level annotation on the same hash-deduped row. `strategy_configs.config_hash` has a UNIQUE constraint, so two strategies with identical runtime config always share the same row regardless of `pipeline_type`. The `pipeline_type` on `strategy_configs` indicates the default/intended pipeline for that config (set on first insert, updatable via admin UI). The authoritative source for "which pipeline ran this run" is the run-level `content_evolution_runs.pipeline_type` column (Migration 1d), not the strategy-level column. Queries that slice by pipeline type should filter on the run column, not the strategy column.
- Rollback: `ALTER TABLE strategy_configs DROP COLUMN IF EXISTS is_predefined, DROP COLUMN IF EXISTS pipeline_type;`

**Migration 1d: Pipeline type on runs**
- Add `pipeline_type TEXT` to `content_evolution_runs` CHECK IN ('full', 'minimal', 'batch')
- Rollback: `ALTER TABLE content_evolution_runs DROP COLUMN IF EXISTS pipeline_type;`

**Migration 1e: Hall of fame rank + generation_method expansion**
- Add `rank INT` to `article_bank_entries` CHECK (rank >= 1 AND rank <= 3). NULL rank = legacy single-winner entry (pre-migration).
- Add UNIQUE index: `idx_bank_entries_run_rank ON article_bank_entries(evolution_run_id, rank) WHERE evolution_run_id IS NOT NULL` — enables upsert dedup for top-3 feeding.
- **ALTER CHECK constraint**: Drop existing `generation_method` CHECK and replace with: `CHECK (generation_method IN ('oneshot', 'evolution_winner', 'evolution_baseline', 'evolution_top3'))` — needed for Phase 4 rank 2-3 entries.
- Rollback: `ALTER TABLE article_bank_entries DROP COLUMN IF EXISTS rank; DROP INDEX IF EXISTS idx_bank_entries_run_rank; UPDATE article_bank_entries SET generation_method = 'evolution_winner' WHERE generation_method = 'evolution_top3'; ALTER TABLE article_bank_entries DROP CONSTRAINT IF EXISTS article_bank_entries_generation_method_check; ALTER TABLE article_bank_entries ADD CONSTRAINT article_bank_entries_generation_method_check CHECK (generation_method IN ('oneshot', 'evolution_winner', 'evolution_baseline'));`

**Migration 1f: Composite indexes for explorer queries**
- `idx_evolution_runs_explorer ON content_evolution_runs(prompt_id, pipeline_type, strategy_config_id)` — covers the unified explorer's multi-dimensional filters.
- Rollback: `DROP INDEX IF EXISTS idx_evolution_runs_explorer;`

**TypeScript type updates**
- Update `EvolutionRun` interface in `evolutionActions.ts` with new columns
- Add `PromptMetadata` interface (difficulty_tier, domain_tags, status)
- Update `StrategyConfig` interface with `is_predefined`, `pipeline_type`
- **Note**: `is_predefined` and `pipeline_type` are NOT added to the `hashStrategyConfig()` input — hash remains based on runtime config fields only

### Phase 2: Prompt Registry
**Goal**: Prompts are a first-class entity with CRUD and run-level linking.

- **Server actions** in new `src/lib/services/promptRegistryActions.ts` (**Auth**: all call `requireAdmin()` + `createSupabaseServiceClient()`, matching `evolutionActions.ts`):
  - `getPromptsAction({ status?, includeDeleted? })` — List prompts, filtered by status. Default: active only, deleted excluded.
  - `createPromptAction({ prompt, difficultyTier?, domainTags?, status? })` — Create with validation (case-insensitive unique check against existing prompts).
  - `updatePromptAction({ id, prompt?, difficultyTier?, domainTags?, status? })` — Update metadata. Prompt text change triggers re-check of uniqueness.
  - `archivePromptAction({ id })` — Sets `status = 'archived'`. Prompt hidden from run-queue dropdowns but visible in admin and Explorer filters. Existing runs referencing this prompt unaffected.
  - `deletePromptAction({ id })` — Soft-delete via `deleted_at = NOW()`. **Guard**: fails if prompt has any associated runs (`content_evolution_runs.prompt_id`). For prompts with runs, use archive instead. Prompts with `deleted_at` set are fully hidden from all UI surfaces.
- **Auto-link at pipeline completion**: In `finalizePipelineRun()`, if `prompt_id` is not already set on the run, attempt to resolve it: (1) check if the run's config JSONB contains a prompt field, match against `article_bank_topics.prompt` (case-insensitive), (2) if the run has `explanation_id`, look up the explanation title and match. If no match found, `prompt_id` stays NULL (logged as warning, not an error — graceful during transition period).
- **CLI update**: `run-evolution-local.ts` — `--prompt` resolves against `article_bank_topics` by text match; new `--prompt-id` flag accepts UUID directly; error if prompt not found
- **Backfill migration**: TypeScript script at `scripts/backfill-prompt-ids.ts` (callable via `npx tsx scripts/backfill-prompt-ids.ts`) wrapping SQL logic for testability. Exports a `backfillPromptIds(supabase)` function that tests can call directly. Priority order: (1) via `article_bank_entries.topic_id` where `evolution_run_id` is set, (2) via run config JSONB prompt field matching `article_bank_topics.prompt` text, (3) remaining runs left with `prompt_id = NULL` (logged as warning, not error). Script must be idempotent (re-running does not duplicate or overwrite). Returns `{ linked: number, unlinked: number }` for verification.
- **Admin UI**: Prompt registry page under `/admin/quality/prompts` — table with difficulty tier, domain tags, status, run count. Add to evolution sidebar + overview quick links (see DC-3).

### Phase 3: Strategy Formalization
**Goal**: Strategies are pre-defined before runs, not auto-created after. Full lifecycle management (create, view, edit, clone, archive, delete) with a guided creation flow.

**Migration 3a: Strategy lifecycle columns**
- Add `status TEXT DEFAULT 'active'` to `strategy_configs` CHECK IN ('active', 'archived')
- Add `created_by TEXT` to `strategy_configs` — 'system' for auto-created, 'admin' for UI-created
- **Note**: `description TEXT` already exists on `strategy_configs` (from migration `20260205000005`). No schema change needed — existing column is reused for strategy descriptions.
- **Note**: Only `is_predefined = true` strategies can be archived. Auto-created (`is_predefined = false`) strategies are immutable records of what actually ran.
- **Note**: `status` and `created_by` are NOT added to `hashStrategyConfig()` input — hash remains based on runtime config fields only.
- Rollback: `ALTER TABLE strategy_configs DROP COLUMN IF EXISTS status, DROP COLUMN IF EXISTS created_by;`

**Server actions** in new `src/lib/services/strategyRegistryActions.ts` (**Auth**: all call `requireAdmin()` + `createSupabaseServiceClient()`):
- `getStrategiesAction({ status?, isPredefined?, pipelineType? })` — List strategies with optional filters. Returns config fields + aggregated metrics (avg_elo, run_count, elo_per_dollar from existing columns).
- `getStrategyDetailAction({ id })` — Full strategy config with per-agent budget breakdowns, run history summary, performance stats.
- `createStrategyAction({ label, description, config, pipelineType, agentSelection })` — Create predefined strategy. Computes `config_hash` — if an auto-created strategy with the same hash exists, promotes it to predefined (sets `is_predefined = true`, updates label/description) rather than creating a duplicate. New strategies get `is_predefined = true`, `created_by = 'admin'`, `status = 'active'`.
- `updateStrategyAction({ id, label?, description?, config?, pipelineType?, agentSelection? })` — Update a predefined strategy. **Guard**: only `is_predefined = true` strategies can be edited. Config changes recompute `config_hash` — if new hash collides with another row, error with suggestion to clone instead. Updating config on a strategy with completed runs creates a new version (new row) rather than mutating history.
- `cloneStrategyAction({ sourceId, label, description? })` — Deep-copy a strategy's config into a new predefined row with a new label. Useful for creating variants of known-good strategies. Source can be predefined or auto-created.
- `archiveStrategyAction({ id })` — Sets `status = 'archived'`. **Guard**: only `is_predefined = true`. Archived strategies hidden from run-queue dropdown but visible in admin, Explorer, and historical run data.
- `deleteStrategyAction({ id })` — Hard delete. **Guard**: only `is_predefined = true` AND `run_count = 0` (no runs have used it). For strategies with runs, use archive instead.
- `getStrategyPresetsAction()` — Returns 3 built-in preset templates (see creation flow below). Not stored in DB — computed from `DEFAULT_EVOLUTION_CONFIG` with overrides.

**Strategy creation flow** (guided 4-step form at `/admin/quality/strategies/new`):

Full-page form (not a modal — adequate space for complex config). Each step validates before allowing next. Users can navigate back to previous steps. A live cost estimate panel updates as settings change.

- **Step 1 — Start**: Choose starting point:
  - **From preset**: Three presets derived from `DEFAULT_EVOLUTION_CONFIG`:
    - *Economy* — DeepSeek generation, gpt-4.1-nano judging, 2 iterations, $1.00 budget, minimal pipeline, core agents only (Generation, Calibration, Tournament)
    - *Balanced* (default) — gpt-4.1-mini generation, gpt-4.1-nano judging, 3 iterations, $3.00 budget, full pipeline, all standard agents
    - *Quality* — gpt-4.1 generation, gpt-4.1-mini judging, 5 iterations, $5.00 budget, full pipeline, all agents including TreeSearch
  - **From existing**: Dropdown of active predefined strategies → clone config
  - **From auto-created**: Dropdown of auto-created strategies sorted by avg Elo → clone config. Useful for promoting "accidentally good" configs to predefined.
  - **Blank**: Empty config (advanced users only)

- **Step 2 — Core Settings**:
  - Label (text input, required)
  - Description (textarea, optional — purpose/hypothesis for this strategy)
  - Pipeline type (radio: Full / Minimal / Batch)
  - Iterations (number input, 1-10, with guidance text: "2-3 for quick experiments, 5+ for quality optimization")
  - Budget cap (currency input with preset buttons: $1, $3, $5, $10)
  - Live cost estimate panel: "Estimated cost per run: ~$X.XX" based on agent baselines from `agent_cost_baselines` table

- **Step 3 — Models & Agents**:
  - **Models section**:
    - Generation model (dropdown from `LLM_PRICING` keys, shows cost/1K tokens beside each option)
    - Judging model (dropdown, same list)
    - Cost impact indicator: "Switching to gpt-4.1 increases estimated cost by ~$X.XX/run"
  - **Agent section**: Checklist of all 12 agents grouped by phase (Expansion / Competition / Analysis):
    - Each agent row: checkbox (enable/disable), name, one-line description, avg cost from baselines
    - Phase assignment shown as read-only tags (derived from agent type)
    - Feature-flag-gated agents (e.g., TreeSearch) shown with flag icon and note
    - Per-agent budget cap slider (percentage of total, 5%-50%, default from `DEFAULT_EVOLUTION_CONFIG.agentBudgetCaps`)
    - Budget allocation bar: visual stacked bar showing how budget is split across enabled agents. Warning if total exceeds 100% or any agent has < 5%.

- **Step 4 — Review & Create**:
  - Summary card: all settings in read-only view
  - Estimated cost per run (from agent baselines × iterations × model costs)
  - Comparison callout (if cloned): "Compared to [source strategy]: +1 iteration, switched generation model from X to Y, added TreeSearch agent"
  - "Create Strategy" button → calls `createStrategyAction`
  - On success → redirect to strategy detail page with "Strategy created" toast

**Strategy edit flow** (`/admin/quality/strategies/[id]/edit`):

Same 4-step form pre-populated with existing config. Step 1 is skipped (already have a starting point). On save:
- If strategy has 0 completed runs → update in place via `updateStrategyAction`
- If strategy has completed runs → show confirmation: "This strategy has N completed runs. Saving will create a new version (the original remains for historical reference)." → creates new row, archives old.

**Strategy detail page** (`/admin/quality/strategies/[id]`):

Read-only view of strategy config with performance data:
- Config summary (models, iterations, budget, pipeline type, enabled agents)
- Performance stats: avg Elo across runs, Elo/dollar, success rate, total runs
- Run history: last 10 runs using this strategy (clickable → Run detail)
- "Edit" button → edit flow. "Clone" button → creation flow Step 2 pre-populated. "Archive" button (with confirmation).

**Pre-defined strategy seeding**: Existing `strategy_configs` rows seeded as `is_predefined = false`, `status = 'active'`, `created_by = 'system'`; admin-created ones get `is_predefined = true`, `created_by = 'admin'`.

**Run trigger update**: `queueEvolutionRunAction` signature → `{ promptId, strategyId }` (both optional during transition). When `strategyId` provided, use its config instead of `DEFAULT_EVOLUTION_CONFIG`. When omitted, fall back to current behavior.

**linkStrategyConfig change**: When `strategyId` already set on the run, skip auto-creation; only update aggregates. When not set, continue current auto-link behavior.

**Queue dialog update**: Admin run-queue dialog offers prompt dropdown + strategy dropdown (filtered to `status = 'active'` and `is_predefined = true`). Strategy dropdown shows label + pipeline type + estimated cost. Add to evolution sidebar + overview quick links (see DC-3).

### Phase 4: Pipeline Type + Hall of Fame
**Goal**: Pipeline type tracked per run; top 3 auto-fed into bank.

- **Pipeline type auto-population**: `executeFullPipeline` sets `pipeline_type = 'full'`, `executeMinimalPipeline` sets `pipeline_type = 'minimal'`, batch runner sets `pipeline_type = 'batch'`
- **Top-3 bank feeding**: In `finalizePipelineRun()`, after variants are persisted:
  1. Get top 3 variants by rating
  2. Resolve or create `article_bank_topics` entry for the run's prompt
  3. Upsert into `article_bank_entries` with `rank = 1, 2, 3` (or fewer if the run produced < 3 variants), `generation_method = 'evolution_winner'` for rank 1, `'evolution_top3'` for ranks 2-3. Queries for hall-of-fame entries must filter `WHERE rank IS NOT NULL` to exclude legacy NULL-rank entries.
  4. Initialize Elo ratings for new bank entries
- **Bank entry dedup**: Use `evolution_run_id` + `rank` as a natural key to prevent duplicate entries on re-runs

### Phase 5: Unified Dimensional Explorer
**Goal**: One page to slice by any dimension combination and view in any unit of analysis. Replaces the need for separate "By Prompt" and "By Pipeline Type" dashboards.

**Server actions in `src/lib/services/unifiedExplorerActions.ts`** (new file, follows existing pattern from `evolutionVisualizationActions.ts`):

**`getUnifiedExplorerAction`** (Table mode)
- Input: `{ promptIds?: string[], strategyIds?: string[], pipelineTypes?: string[], agentNames?: string[], runIds?: string[], variantIds?: string[], difficultyTiers?: string[], domainTags?: string[], models?: string[], budgetRange?: { min?: number, max?: number }, dateRange?: { from: string, to: string }, unitOfAnalysis: 'run' | 'article' | 'task', sortBy?: string, limit?: number, offset?: number }`
- `runIds` / `variantIds` enable targeted comparison of specific entities (e.g., "compare these 3 runs side-by-side")
- Attribute filter resolution (server-side, **all parameterized — no string interpolation**): `difficultyTiers` → `.in('difficulty_tier', tiers)` on `article_bank_topics`, `domainTags` → `.overlaps('domain_tags', tags)` (array overlap), `models` → `.in('config->model', models)` on `strategy_configs`, `budgetRange` → `.gte('config->budgetCapUsd', min).lte('config->budgetCapUsd', max)`. Results intersected with any explicit entity IDs.
- Backed by JOINs across `content_evolution_runs` (with `prompt_id`, `strategy_config_id`, `pipeline_type`) + `content_evolution_variants` (for article view — ALL variants) + `evolution_run_agent_metrics` (for task view)
- Article data: queries `content_evolution_variants` for all generated articles (not just `article_bank_entries`). LEFT JOIN to `article_bank_entries` to enrich with hall-of-fame rank where available.
- Returns typed result set matching the selected unit of analysis. Main query returns article metadata only (preview, ID, Elo, agent); full content loaded lazily via `getExplorerArticleDetailAction` on row expand.

**`getExplorerMatrixAction`** (Matrix mode)
- Input: `{ rowDimension: 'prompt' | 'strategy' | 'pipelineType' | 'agent', colDimension: 'prompt' | 'strategy' | 'pipelineType' | 'agent', metric: 'avgElo' | 'totalCost' | 'runCount' | 'avgEloDollar' | 'successRate', ...sharedFilters }` where `sharedFilters` matches filter params from `getUnifiedExplorerAction` (entity + attribute filters, date range)
- Returns `{ rows: { id: string, label: string }[], cols: { id: string, label: string }[], cells: { rowId: string, colId: string, value: number, runCount: number }[] }`
- Sparse cells — only combinations with data are returned (frontend fills missing with "no data" gray)
- Constraint: `rowDimension !== colDimension` — error if equal
- JOINs `content_evolution_runs` with dimension tables, GROUP BY both dimensions, computes aggregate metric per cell

**`getExplorerTrendAction`** (Trend mode)
- Input: `{ groupByDimension: 'prompt' | 'strategy' | 'pipelineType' | 'agent', metric: 'avgElo' | 'totalCost' | 'runCount' | 'successRate', timeBucket: 'day' | 'week' | 'month', ...sharedFilters }`
- Returns `{ series: { dimensionId: string, dimensionLabel: string, points: { date: string, value: number }[] }[] }`
- `date_trunc(timeBucket, created_at)` grouping, partitioned by selected dimension. One series per dimension value.
- Limited to top 10 dimension values by run count; remaining aggregated into "Other" series
- Empty time buckets included as zero-value points (no gaps in chart)

**Server action: `getExplorerArticleDetailAction`**
- Input: `{ runId: string, variantId?: string, agentName?: string }`
- Returns article content for expansion rows: variant content, parent content, lineage chain, Elo, agent
- Separate from main query to keep initial load fast (articles loaded on expand)

**UI: `/admin/quality/explorer` page**
- **Filter bar** (top): Two rows:
  - **Row 1 — Entity selectors**: Multi-select dropdowns for prompt, strategy, pipeline type, agent + date range picker. Optional run ID / variant ID text inputs (comma-separated, for targeted comparison). Filters are AND across dimensions, OR within a dimension.
  - **Row 2 — Attribute filters** (collapsible, hidden by default): Prompt difficulty tier (multi-select: easy/medium/hard/unrated), prompt domain tags (multi-select chips populated from existing tags), strategy model (multi-select populated from `strategy_configs`), strategy budget range (min/max number inputs). Attribute filters compose with entity selectors (AND). Active attribute filter count shown as badge on the toggle.
  - All filters URL-persisted via query params. Attribute filters encoded as `dt=hard&tags=science,math&model=gpt-4.1-mini&budgetMin=1&budgetMax=5`.
- **View mode + Unit toggle** (below filter bar): Two toggle groups:
  - **View mode**: Table (default) | Matrix | Trend. Switches the visualization type.
  - **Unit of analysis** (Table mode only): Run | Article | Task. Switches which table/columns are shown. Hidden when Matrix or Trend mode is active.
  - **Matrix controls** (Matrix mode only): Row dimension dropdown + Column dimension dropdown + Metric dropdown. Defaults: rows = prompt, columns = strategy, metric = avg Elo.
  - **Trend controls** (Trend mode only): Group-by dimension dropdown + Metric dropdown + Time bucket selector (day/week/month). Defaults: group by strategy, metric = avg Elo, bucket = week.
- **Aggregation bar**: Updates with current filter. Shows: total count, avg Elo, total cost, avg cost per unit, top-performing strategy, top-performing agent.
- **Results table**: Columns depend on unit:
  - **Run**: prompt, strategy, pipeline type, status, cost, duration, final Elo, variant count, created date. Click → run detail. **Expand row** → two panels:
    - **Articles by stage**: iteration 0 (original input), iteration 1..N (variants produced per iteration with agent name and Elo), final winner highlighted. Each article clickable → Article view.
    - **Agent tasks**: table of every agent that operated during this run (from `evolution_run_agent_metrics`), with columns: agent name, cost, variants added, Elo gain, Elo/dollar. Each row clickable → opens Task view filtered to that agent × run with debug panel expanded.
  - **Article**: ALL variants from `content_evolution_variants`, not just hall-of-fame entries. Columns: content preview (truncated), Elo, agent that created it (clickable → Task view for that agent), iteration born, parent article preview, run link (clickable → Run view), prompt. Hall-of-fame badge (1st/2nd/3rd) when variant is a bank entry. **Expand row** → three panels:
    - **Content**: Full article content with parent article side-by-side (diff highlighting optional).
    - **Lineage**: Chain from this variant back to the original (parent → grandparent → ... → iteration 0). Each node clickable → Article view for that variant.
    - **Creating task**: Agent name, run, cost, Elo gain for that agent × run. "View agent debug" button → opens Task view filtered to that agent × run with debug panel expanded. If the article was produced by a multi-step agent (e.g., TreeSearch, OutlineGeneration), shows the intermediate step that produced this specific variant.
  - **Task**: agent name, run link (clickable → Run view filtered to that run), prompt, cost, variants added, Elo gain, Elo/dollar. **Expand row** → three panels:
    - **Input/Output articles**: Input article(s) the agent received (parent variants with content preview and Elo) → Output article(s) it produced (child variants with content preview and Elo). Each article clickable → Article view filtered to that variant with lineage expanded. Shown as before→after pair.
    - **Agent debug panel**: Tailored debug view per agent type (see DC-2 agent debug drill-down for per-agent specs). Data extracted from `evolution_checkpoints.state_snapshot` JSONB.
    - **LLM calls**: Collapsible table of all LLM calls for this agent × run (model, tokens, cost, timestamp) from `llmCallTracking`.
- **Matrix visualization** (Matrix mode): Heatmap grid. Row headers from `rowDimension`, column headers from `colDimension`. Cell background on green-red gradient (green=high for Elo/success metrics, green=low for cost metrics). Cell text: metric value + run count in smaller text. Empty cells shown as gray with "—". If > 8 columns, horizontal scroll with sticky row headers. Click any cell → Table mode filtered to that row × column intersection.
- **Trend visualization** (Trend mode): Multi-line chart (Recharts `LineChart`). Distinct color per series from categorical palette. Legend below chart (clickable to show/hide series). Y-axis auto-scales. X-axis shows date labels at bucket boundaries. Tooltip on hover shows all series values. "Other" series (aggregated tail) shown as dashed gray line. Click data point → Table mode filtered to that time bucket + dimension value.
- **Cross-unit navigation**: All unit views implement the DC-2 cross-unit drill-down principle. Every clickable entity (run link, article preview, agent name) navigates to the corresponding unit view with appropriate filters pre-applied. Agent name clicks anywhere → Task view filtered by that agent across all runs. URL query params encode the current view state (unit, filters, expanded row) so links are shareable and back-navigable.

**Evolution dashboard navigation updates** (see DC-3 for full site map):
- Add Explorer to evolution sidebar + overview quick links. All 3 new pages (Explorer, Prompt Registry, Strategies) and their sidebar/overview entries should be completed by end of Phase 5.

**Existing page updates** (lightweight, done alongside explorer):
- Run management page (`/admin/quality/evolution`): Add prompt and pipeline type columns to run list
- Strategy leaderboard (`/admin/quality/optimization`): Add pipeline type filter chip
- Article bank leaderboard (`/admin/quality/article-bank/[topicId]`): Show rank badge (1st, 2nd, 3rd) on hall-of-fame entries

### Phase 6: Enforcement + Iteration Loop
**Goal**: Close the loop. No more ad-hoc runs. Analysis feeds generation.

- **NOT NULL enforcement**: Migration to make `prompt_id` and `strategy_config_id` NOT NULL on `content_evolution_runs`. **Pre-requisite**: Drain the run queue — no runs in `pending`, `claimed`, or `running` status. The migration includes a safety gate: `DO $$ BEGIN IF EXISTS (SELECT 1 FROM content_evolution_runs WHERE (prompt_id IS NULL OR strategy_config_id IS NULL) AND status IN ('completed', 'failed', 'paused') LIMIT 1) THEN RAISE EXCEPTION 'Backfill incomplete: NULL prompt_id or strategy_config_id rows still exist among completed runs.'; END IF; IF EXISTS (SELECT 1 FROM content_evolution_runs WHERE status IN ('pending', 'claimed', 'running') LIMIT 1) THEN RAISE EXCEPTION 'Queue not drained: in-flight runs exist. Wait for completion and backfill before applying.'; END IF; END $$;`
- Rollback: `ALTER TABLE content_evolution_runs ALTER COLUMN prompt_id DROP NOT NULL; ALTER TABLE content_evolution_runs ALTER COLUMN strategy_config_id DROP NOT NULL;`
- **Entry point audit**: All 8 entry points validated to require prompt + strategy. The 8 entry points are: (1) admin UI queue dialog, (2) `queueEvolutionRunAction`, (3) `triggerEvolutionRunAction`, (4) `evolution-runner.ts` batch runner, (5) `run-evolution-local.ts` CLI, (6) `run-batch.ts` batch matrix, (7) `evolution-runner` cron, (8) `content-quality-eval` auto-queue cron.
- **Remove ad-hoc paths**: Delete `resolveConfig()` override merging; config comes from strategy only
- **Cross-run analysis**: New `StrategyAnalyzer` utility that identifies underperforming strategies per prompt (based on hall-of-fame Elo trends) and suggests strategy adjustments
- **Auto-queue cron retrofit**: `content-quality-eval` cron currently does raw `supabase.from('content_evolution_runs').insert()`, bypassing the action layer. Refactor to call `queueEvolutionRunAction({ promptId, strategyId, explanationId })` instead. Prompt resolved from explanation title → `article_bank_topics` match. Strategy defaults to a configured "auto-queue strategy" (predefined, selected via feature flag or config). This ensures all 8 entry points go through the same validated path.
- **Auto-queue analysis integration**: `content-quality-eval` cron can suggest "re-run prompt X with strategy Y" based on analysis findings
- **Regression detection**: Compare new run's top variant Elo against hall-of-fame entries for the same prompt; flag regressions

## Testing

### Unit Tests
All new test files follow existing colocated pattern (e.g., `src/lib/services/promptRegistryActions.test.ts` for unit tests of server actions, `src/lib/evolution/core/*.test.ts` for core logic). Integration tests go in `src/__tests__/integration/`.

- `strategyConfig.test.ts` — Existing; extend with `is_predefined`, `pipeline_type` fields. **Critical invariant**: assert that `is_predefined` and `pipeline_type` are NOT included in `hashStrategyConfig()` — two strategies with same config but different `is_predefined` must hash identically.
- `promptRegistryActions.test.ts` — New; CRUD actions for prompt metadata (difficulty_tier, domain_tags, status). Test `requireAdmin()` is called. Test interaction with `deleted_at`: archived prompts with `deleted_at = NULL` are visible in admin but not in run-queue; prompts with `deleted_at` set are fully hidden. **Delete guard**: `deletePromptAction` fails when prompt has associated runs, succeeds when no runs reference it.
- `strategyRegistryActions.test.ts` — New; full CRUD lifecycle for strategies. (a) `createStrategyAction` with valid config creates `is_predefined = true` row, (b) create with hash matching auto-created strategy promotes it to predefined (no duplicate), (c) `updateStrategyAction` fails for `is_predefined = false` strategies, (d) config update on strategy with runs creates new version row + archives old, (e) config update with hash collision returns error, (f) `cloneStrategyAction` deep-copies config with new label, (g) `archiveStrategyAction` fails for auto-created, succeeds for predefined, (h) `deleteStrategyAction` fails when `run_count > 0`, succeeds when 0, (i) `getStrategyPresetsAction` returns 3 preset templates (Economy/Balanced/Quality) with correct config values, (j) `getStrategiesAction` filters by status/isPredefined/pipelineType correctly.
- `hallOfFame.test.ts` — New; top-3 extraction, bank entry creation with rank, dedup on re-run. **Dedup tests**: (a) re-running same pipeline does not create duplicate bank entries (upsert via `evolution_run_id` + `rank` unique index), (b) upsert correctly updates content/Elo when run_id + rank already exists, (c) rank constraint (1-3) enforced at DB level, (d) runs producing fewer than 3 variants only insert as many entries as variants exist (e.g., 1 variant = rank 1 only).
- `pipelineTypeTracking.test.ts` — New; verify `executeFullPipeline` sets 'full', `executeMinimalPipeline` sets 'minimal'
- `runTriggerContract.test.ts` — New; verify `queueEvolutionRunAction` validates `promptId`/`strategyId` references exist. **Transition period tests**: verify action succeeds with `promptId`/`strategyId` omitted (nullable during Phases 2-5), fails with non-existent IDs.
- `unifiedExplorerActions.test.ts` — New; verify `getUnifiedExplorerAction` applies multi-dimensional filters correctly, returns correct result shapes for each unit of analysis, handles empty filters (returns all). Test with: mixed populated/empty filter arrays, non-existent IDs (return empty results, not error), date ranges matching zero runs.
- `explorerCrossLinks.test.ts` — New; verify cross-unit data availability: run results include agent task list data, article results include creating agent + run reference, task results include input/output variant IDs + run reference. Verify `getExplorerArticleDetailAction` returns parent content and lineage chain. Verify agent debug data extraction from checkpoint JSONB for each agent type.
- `explorerAttributeFilters.test.ts` — New; verify attribute-to-entity resolution: (a) `difficultyTiers=['hard']` resolves to correct prompt IDs, (b) `domainTags=['science']` uses array overlap to find matching prompts, (c) `models=['gpt-4.1-mini']` extracts from strategy config JSONB, (d) `budgetRange={min:1,max:3}` filters strategies by budget, (e) attribute filters compose with entity selectors (AND intersection), (f) `runIds` and `variantIds` correctly narrow results to specified entities.
- `explorerMatrixAction.test.ts` — New; verify `getExplorerMatrixAction`: (a) prompt × strategy returns correct cell values, (b) sparse cells — missing combinations return no cell (not zero), (c) all 5 metrics compute correctly (avgElo, totalCost, runCount, avgEloDollar, successRate), (d) rowDimension === colDimension returns error, (e) filters apply before aggregation, (f) empty result set returns empty rows/cols/cells arrays.
- `explorerTrendAction.test.ts` — New; verify `getExplorerTrendAction`: (a) day/week/month bucketing produces correct date grouping, (b) top-10 dimension limit with "Other" aggregation, (c) all metrics compute correctly per time bucket, (d) date range filter narrows the trend window, (e) empty time buckets included as zero-value points (no gaps), (f) single-run edge case produces one data point.
- `backfillPrompts.test.ts` — New; verify backfill script: (a) links runs via `article_bank_entries.topic_id` when available, (b) falls back to config JSONB prompt text match, (c) leaves `prompt_id = NULL` for unmatched runs (no error), (d) is idempotent (re-running produces same result), (e) handles runs with no article_bank_entries at all.

### CI Critical Path Update
The `test:integration:critical` npm script in `package.json` uses `--testPathPatterns` to filter which integration tests run on every PR to main. Update the `--testPathPatterns` argument to include `evolution-framework|prompt-registry|strategy-lifecycle|unified-explorer` alongside the existing `auth-flow|explanation-generation|streaming-api|error-handling|vector-matching`. This ensures new framework flows are validated on every PR to main.

### Integration Tests
- **Prompt → Run linkage**: Queue a run with a promptId, execute it, verify `content_evolution_runs.prompt_id` is set
- **Strategy pre-selection**: Create a strategy via `createStrategyAction`, queue a run referencing it, verify config used matches strategy config (not DEFAULT_EVOLUTION_CONFIG)
- **Strategy lifecycle**: (a) Create predefined strategy → verify `is_predefined = true`, `created_by = 'admin'`, `status = 'active'`. (b) Clone it → verify new row with same config but new label. (c) Run a pipeline with the original → verify `run_count = 1`. (d) Update config on original → verify new version created, original archived. (e) Archive the clone → verify hidden from run-queue but visible in admin. (f) Delete the clone (0 runs) → verify hard-deleted. (g) Attempt delete on original (has runs) → verify rejection.
- **Strategy hash promotion**: Create an auto-created strategy (via `linkStrategyConfig` from a run). Then call `createStrategyAction` with identical config → verify it promotes the existing row to predefined instead of creating a duplicate.
- **Top-3 bank feeding**: Run a full pipeline, verify 3 entries created in `article_bank_entries` with ranks 1-3. Verify `generation_method = 'evolution_winner'` for rank 1, `'evolution_top3'` for ranks 2-3. Verify re-running the pipeline upserts (updates, not duplicates) the same rank entries.
- **Pipeline type persistence**: Run both full and minimal pipelines, verify `pipeline_type` column values
- **Backfill migration**: Seed test runs without prompt_id: (a) run with matching article_bank_entry → linked, (b) run with config JSONB prompt → linked, (c) run with no match → stays NULL. Run backfill twice to verify idempotency.
- **Nullable FK transition period**: Execute a full pipeline without `promptId`/`strategyId` set → verify pipeline completes successfully, `finalizePipelineRun()` attempts auto-link and logs warning if no match (does not crash). Verify all existing dashboard pages continue to work with NULL FKs.
- **NOT NULL safety gate (two cases)**: (a) Seed completed run with NULL prompt_id → attempt migration → verify abort with "Backfill incomplete" error. (b) Seed running run with non-NULL FKs → attempt migration → verify abort with "Queue not drained" error. (c) Apply after backfill + drain → verify migration succeeds and columns are NOT NULL.
- **Unified explorer filters**: Seed runs with different prompt/strategy/pipeline combinations, verify multi-dimensional queries return correct intersections
- **Unit of analysis switching**: Same filter set returns correct shape for run, article, and task views
- **Attribute filter resolution**: Seed prompts with different difficulty_tier and domain_tags, strategies with different models and budgets. Verify: `difficultyTiers=['hard']` returns only hard-prompt runs, `domainTags=['science','math']` returns science OR math prompt runs, `models=['gpt-4.1-mini']` returns only runs using that model's strategy, `budgetRange={min:2,max:5}` returns only matching strategies' runs. Verify attribute + entity filters compose (AND intersection).
- **Run/variant ID direct filtering**: Seed multiple runs, filter by `runIds=[A,B]`, verify only those runs returned. Filter by `variantIds=[V1,V2]` in article view, verify only those variants returned.
- **Matrix view round-trip**: Seed runs with 3 prompts × 2 strategies. Query matrix with `rowDimension='prompt', colDimension='strategy', metric='avgElo'`. Verify 3 rows, 2 cols, up to 6 cells with correct averages. Click a cell → verify table view filters to that prompt × strategy intersection.
- **Trend view accuracy**: Seed runs across 3 weeks with 2 strategies. Query trend with `groupByDimension='strategy', metric='runCount', timeBucket='week'`. Verify 2 series, 3 points each, counts match actual run distribution.
- **Cross-unit navigation round-trip**: From Run view → expand → click agent task → verify Task view opens filtered to that agent × run with debug panel. From Task view → click output article → verify Article view opens filtered to that variant. From Article view → click run link → verify Run view opens filtered to that run. Full triangle: Run → Task → Article → Run.

### Manual Verification (Stage)
- Admin UI: Create a prompt via prompt registry page, verify it appears in run-queue dropdown
- Admin UI: Create a strategy via strategy page, verify it appears in run-queue dropdown
- Queue a run with prompt + strategy, observe it through to completion, verify:
  - Run has `prompt_id`, `strategy_config_id`, `pipeline_type` populated
  - Top 3 variants appear in article bank with rank badges
  - Unified explorer shows the run when filtering by its prompt, strategy, or pipeline type
  - Unit toggle correctly shows run view, article view (top-3 bank entries), and task view (per-agent metrics)
- Verify existing (legacy) runs still display correctly in dashboards
- Strategy creation flow: Navigate to `/admin/quality/strategies/new`. Select "Balanced" preset → verify Step 2 pre-populated with 3 iterations, $3.00 budget, full pipeline. Change budget to $5.00, verify cost estimate updates. In Step 3, enable TreeSearch agent, verify budget allocation bar updates and shows warning if over 100%. Complete Step 4 review, create strategy, verify redirect to detail page. Edit the strategy → verify 4-step form pre-populated. Clone the strategy → verify Step 2 starts with copied config and new label field.
- Strategy detail page: Navigate to strategy detail, verify config summary, performance stats, and run history. Click a run in history → verify navigation to run detail. Click "Archive" → verify confirmation dialog and strategy removed from run-queue dropdown but still visible in admin list.
- Unified explorer: Select 2 prompts + 1 strategy, switch between run/article/task views, verify correct data in each. Verify URL query params persist filters across page reloads. Verify aggregation bar updates with filter changes.
- Attribute filters: Open attribute filter panel, select difficulty_tier='hard', verify only hard-prompt runs appear. Add domain_tags='science', verify intersection. Clear and try model filter + budget range. Verify badge count on attribute filter toggle.
- Matrix view: Switch to Matrix mode, verify default prompt × strategy × avg Elo grid renders. Change metric to total cost, verify cells update. Click a cell, verify switches to Table mode with correct filters. Try all 4 dimension pairs.
- Trend view: Switch to Trend mode, verify default strategy × avg Elo × week chart renders. Change time bucket to month, verify re-bucketing. Change group-by to pipeline type, verify lines update. Hover data points for tooltips. Click a data point, verify switches to Table mode with correct time + dimension filter.
- Cross-unit navigation: From Run view, expand a run → verify agent task list appears → click an agent → verify Task view opens with that agent × run filtered and debug panel visible. From Task view, click an output article → verify Article view opens with that variant selected and lineage shown. From Article view, click run link → verify Run view opens filtered to that run. Verify agent name clicks anywhere navigate to Task view filtered by that agent across all runs. Verify browser back button works through the navigation chain. Verify URL encodes view state (unit, filters, expanded row) and is shareable.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/feature_deep_dives/evolution_pipeline.md` - Core pipeline docs will need major rewrite to reflect new primitives
- `docs/feature_deep_dives/elo_budget_optimization.md` - Budget/cost tracking may change with new strategy entity
- `docs/feature_deep_dives/comparison_infrastructure.md` - Article bank becomes hall of fame concept
- `docs/feature_deep_dives/evolution_pipeline_visualization.md` - Dashboards will need to support new dimensional slicing
- `docs/feature_deep_dives/hierarchical_decomposition_agent.md` - Agent abstraction may change
- `docs/feature_deep_dives/iterative_editing_agent.md` - Agent abstraction may change
- `docs/feature_deep_dives/tree_of_thought_revisions.md` - Agent abstraction may change
- `docs/feature_deep_dives/outline_based_generation_editing.md` - Agent abstraction may change
- `docs/feature_deep_dives/admin_panel.md` - Admin routes, sidebar, and evolution dashboard navigation updates

## Key Files Affected by Navigation Changes
See DC-3 for full before/after site map and file list.
