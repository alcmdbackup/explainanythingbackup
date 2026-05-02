# evaluateCriteriaThenGenerateFromPreviousArticle Plan

## Background

A new evolution-pipeline agent `EvaluateCriteriaThenGenerateFromPreviousArticleAgent` runs TWO LLM calls (evaluate parent against user-defined criteria, then extract structured fix-suggestions for the weakest criteria) BEFORE delegating to `GenerateFromPreviousArticleAgent.execute()` to produce a variant. Patterns after `ReflectAndGenerateFromPreviousArticleAgent` (Shape A: top-level `agentType: 'criteria_and_generate'` enum value).

A new top-level user-defined entity **Criteria** (`evolution_criteria` table) holds `name`, `description`, `min_rating`, `max_rating`. Criteria are first-class in `evolution_metrics` with a leaderboard page and detail tabs mirroring Tactic. Strategies select per-iteration `criteriaIds: string[]` + `weakestK: number` (1–5, default 1) via the wizard. Generation is no longer driven by tactic name — LLM-generated suggestions feed the inner GFPA via a new optional `customPrompt` override.

## Requirements (from GH Issue #NNN)

**EvaluateCriteriaThenGenerateFromPreviousArticle**

- Architecture
    - Look at how reflectAndGenerateFromPreviousArticle works
- "Criteria"
    - New top-level entity called criteria, pattern it on "tactics" of setup (including list view in evolution admin panel side nav, etc)
    - What it includes
        - Criteria name
        - Description - what it should be evaluating for specifically
        - Min rating (number)
        - Max rating (number)
- Prompt
    - Prompt 1
        - Read the existing parent
        - List of criteria to evaluate on and rating range
        - Rating for each criteria
    - Prompt 2
        - Focus on the criteria(s) that are the weakest
        - Return examples of what needs to be addressed, and suggestions of how to fix it.
        - Return this in a structured form of a list
- Strategy configuration
    - Pass in the list of criteria to evaluate
- Generation impact
    - Use evaluation and examples to generate new version
    - This replaces the "tactic" structurally
    - Figure out how to refactor to make this work

## Problem

Today, generation is tactic-driven: every variant is produced by one of 24 system tactics chosen via round-robin or weighted random (`generationGuidance`) or LLM reflection (`ReflectAndGenerateFromPreviousArticleAgent`). All three approaches ignore *what's actually weak about this specific parent article*. Researchers want a generation flow that evaluates the parent against user-configured quality dimensions, identifies weaknesses, and generates a targeted improvement — turning evolution into a goal-directed loop instead of a tactic-shuffled one.

This requires: (a) a new user-defined Criteria entity with full CRUD; (b) a wrapper agent making 2 LLM calls before delegating to GFPA; (c) refactoring GFPA to accept a custom prompt override (since suggestions replace tactic-driven prompt construction); (d) attribution + lineage surfaces that recognize criteria-driven variants as a distinct generation class.

## Resolved Decisions (from Research Phase)

1. **Weakest-K**: Configurable `weakestK: number` (1–5, default 1) per iteration. Wrapper auto-picks top-K lowest-scoring criteria as the focus for the suggestions step.
2. **Single combined LLM call** (revised — was 2 calls). One prompt asks the LLM to score all criteria AND produce structured suggestions for the K lowest-scoring (weakestK), in one response. Wrapper deterministically picks weakestK from parsed scores, drops any suggestion blocks whose `Criterion:` field doesn't match the wrapper-determined weakest set (LLM-vs-wrapper disagreement on tied scores logged as warn). Saves ~50% input cost (parent article sent once) and ~50% wall-clock latency vs. the original 2-call design. Cost metric: single `evaluation_cost` bucket via single typed agent label `'evaluate_and_suggest'`. Single execution_detail sub-object `evaluateAndSuggest` containing both `criteriaScored` array and `suggestions` array. Per-phase forensic split (evaluation vs suggestions cost/duration) is intentionally not preserved — one LLM call has no internal phase boundary to attribute against.
3. **Score range**: Per-criteria `min_rating`/`max_rating` passed verbatim to LLM. Parser validates each parsed score against its criteria's stored range; out-of-range scores logged + dropped.
4. **No kill-switch env var**. Rollback via code revert (acceptable since `criteria_and_generate` is a net-new agent type with zero existing strategies depending on it).
5. **First-class criteria entity in `evolution_metrics`**: extend CHECK constraint to include `'criteria'`; emit propagated metrics (`avg_score`, `frequency_as_weakest`, `run_count`, `total_variants_focused`, `avg_elo_delta_when_focused`); ship `/admin/evolution/criteria` leaderboard with detail tabs (Overview / Metrics / Variants / Runs / By Prompt). **Naming convention**: criteria-scoped delta metric is `avg_elo_delta_when_focused` everywhere (Decision text, METRIC_REGISTRY['criteria'] entry, STATIC_METRIC_NAMES, SQL aggregation, propagation defs, leaderboard column, E2E selectors) — disambiguates from any existing `avg_elo_delta` metric in other entity types.
6. **`criteriaIds` is iteration-level only** — no strategy-level cascade.
7. **`Variant.tactic = 'criteria_driven'` (static)** + add to `TACTIC_PALETTE`. New columns on `evolution_variants`: `criteria_set_used UUID[]` (full criteria-IDs array) and `weakest_criteria_ids UUID[]` (auto-picked focus). NULL for non-criteria variants. GIN indexes on each. Variant in-memory type + `createVariant()` factory + Zod schemas extended with these optional array fields. Lets the criteria-metrics compute function aggregate via SQL directly.
8. **Optional evaluation guidance (rubric) per criteria.** Add `evaluation_guidance JSONB NULL` column on `evolution_criteria`: array of `{score: number, description: string}` anchor pairs. User can define as few or many anchors as desired (no need to cover every integer); LLM interpolates. Each anchor `score` validated to be ∈ `[min_rating, max_rating]`. Empty array or null = no rubric (current behavior — LLM receives only `name + description + range`). When present, `buildEvaluationPrompt` injects a `Rubric:` block under each criterion's bullet listing the anchors. Detail page Overview tab renders the rubric as a sortable list. Create/Edit dialog includes a row-per-anchor table editor with `[+ Add anchor]` button. **Δ Elo Focused metric on the leaderboard** = `mean(child.elo - parent.elo)` across variants where `this_criteria.id IS IN child.weakest_criteria_ids` — answers "when this criteria drove generation, did variants reliably improve over their parents?" Identical to `eloAttrDelta:<agent>:<criteria_name>` when `weakestK = 1`; with `weakestK > 1`, multiple criteria share credit (intentional overlap — multiple weak signals jointly drove the suggestions).
9. **Sample-criteria seed via standalone opt-in script** (Option B). New script `evolution/scripts/seedSampleCriteria.ts` upserts 7 starter criteria (clarity, engagement, structure, depth, tone, point_of_view, sentence_variety — each with a 3-anchor rubric at scores 1/5/10). Idempotent via `ON CONFLICT (name) DO NOTHING`; safe to re-run; won't overwrite researcher edits. **CLI convention** (committed): env-var-based, matching `syncSystemTactics.ts` precedent. Reads `process.env.NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. Run via `NEXT_PUBLIC_SUPABASE_URL=$STAGING_URL SUPABASE_SERVICE_ROLE_KEY=$STAGING_KEY npx tsx evolution/scripts/seedSampleCriteria.ts` for staging, then re-run with prod env vars for production. NO `--target=` argv flag. Mirrors the existing `syncSystemTactics.ts` pattern. Rejected Option A (SQL seed migration) because criteria are user-content (DB-first user-defined per Decision 5/6 and research finding 6).

## Options Considered

- [x] **Option A: One PR, 10 phases, Shape A (top-level enum value `'criteria_and_generate'`)** — **chosen**. Mirrors the reflection precedent (`develop_reflection_and_generateFromParentArticle_agent_evolution_20260430`). Zero net-new patterns; everything composes off existing scaffolding (entity registry, agent template method, hash canonicalization, attribution extractor barrel).
- [ ] **Option B: Three sequential PRs (entity → wrapper → wizard)** — rejected. Wastes review cycles on tightly-coupled changes.
- [ ] **Option C: Skip the criteria entity; inline criteria into `iterationConfig.criteria: Array<{name, description, ...}>`** — rejected. Loses cross-strategy reuse, prevents the leaderboard, leaks user content into the strategy hash.

## Phased Execution Plan

### Phase 1: Criteria Entity Scaffolding

DB-first user-defined entity mirroring `evolution_prompts` (NOT code-first like `evolution_tactics`).

#### Phase 1A — Migration

**Migration ordering (committed)**: this project lands FOUR migrations with **four sequential 14-digit timestamps** to enforce apply order. Existing CI extractors (`.github/workflows/migration-reorder.yml:41,67` and `.github/workflows/supabase-migrations.yml:77,81`) use `grep -oE '^[0-9]{14}'` (strictly 14 digits); the Supabase CLI also uses 14-digit timestamps. **Do NOT use a 16-digit `<base>0001` scheme** — it would break both the CI extractors and CLI tracking.

| # | Filename pattern | Depends on | Purpose |
|---|---|---|---|
| 1 | `<TS>_create_evolution_criteria.sql` | — | Phase 1A.a — table + RLS + triggers + CHECKs |
| 2 | `<TS+1>_extend_metrics_entity_type_for_criteria.sql` | #1 | Phase 1A.b — extend `evolution_metrics` CHECK |
| 3 | `<TS+2>_evolution_variants_criteria_columns.sql` | #1 | Phase 1B — add `criteria_set_used` / `weakest_criteria_ids` cols |
| 4 | `<TS+3>_extend_mark_elo_metrics_stale_for_criteria.sql` | #2 + #3 | Phase 1G — stale-trigger cascade |

Where `<TS>` is the next-available 14-digit timestamp (mirrors `migration-reorder.yml`'s `NEXT_TS=$((LATEST_ON_MAIN + 1))` increment). Each subsequent migration is `<TS+1>`, `<TS+2>`, `<TS+3>` — four consecutive integers. Lexicographic sort preserves apply order. **CI safety net**: `.github/workflows/supabase-migrations.yml`'s `db push` job applies all migrations from a clean DB on every PR that touches `supabase/migrations/`, catching ordering bugs before merge.

- [ ] Create `supabase/migrations/<TS>_create_evolution_criteria.sql`:
  - Columns: `id UUID PK default gen_random_uuid()`, `name TEXT NOT NULL UNIQUE`, `description TEXT`, `min_rating NUMERIC NOT NULL`, `max_rating NUMERIC NOT NULL`, `evaluation_guidance JSONB NULL` (rubric: array of `{score, description}` anchor pairs; null/empty = no rubric), `status TEXT NOT NULL CHECK ('active','archived') default 'active'`, `is_test_content BOOLEAN NOT NULL default FALSE`, `archived_at TIMESTAMPTZ`, **`deleted_at TIMESTAMPTZ NULL`** (soft-delete per Phase 1F decision), `created_at TIMESTAMPTZ NOT NULL default now()`, `updated_at TIMESTAMPTZ NOT NULL default now()`.
  - Constraints:
    - `CHECK (max_rating > min_rating)`
    - **`CHECK (name ~ '^[A-Za-z][a-zA-Z0-9_-]{0,128}$')`** — must match the score-line parser regex `/^([A-Za-z][\w_-]*)\s*:\s*.../m` AT THE DB LEVEL. Without this, a criteria name containing `:` / newlines / control chars would be UNPARSEABLE → every score for that criteria silently dropped → entire dispatch fails. Max length 128 also keeps `metric_name = 'eloAttrDelta:evaluate_criteria_then_generate_from_previous_article:<name>'` safely under the 200-char `MetricRowSchema` limit (prefix is 67 chars; 128+67=195).
  - Per-table BEFORE trigger function `evolution_criteria_set_is_test_content()` (parallel to `evolution_strategies_set_is_test_content()` at `supabase/migrations/20260415000001_evolution_is_test_content.sql`): `NEW.is_test_content := evolution_is_test_name(NEW.name); RETURN NEW;`. Then `CREATE TRIGGER ... BEFORE INSERT OR UPDATE OF name ON evolution_criteria EXECUTE FUNCTION evolution_criteria_set_is_test_content();`.
  - **DB-level rubric integrity**: add a CHECK constraint via IMMUTABLE function `evolution_criteria_rubric_anchors_in_range(min_rating NUMERIC, max_rating NUMERIC, evaluation_guidance JSONB) RETURNS BOOLEAN` that validates every `(elem->>'score')::NUMERIC` is in `[min_rating, max_rating]` when `evaluation_guidance IS NOT NULL`. This catches direct `service_role` inserts (e.g., the seed script) that bypass Zod. Pattern: `CHECK (evolution_criteria_rubric_anchors_in_range(min_rating, max_rating, evaluation_guidance))`.
  - Indexes: `idx_evolution_criteria_status` (partial on `status='active'`), `idx_evolution_criteria_non_test` (partial on `is_test_content=FALSE`), `idx_evolution_criteria_name`.
  - RLS: `deny_all`, `service_role_all`, `readonly_select` (conditional on `readonly_local` role).
  - BEFORE INSERT/UPDATE-OF-name trigger calling `evolution_is_test_name(NEW.name)` (reuse function from `20260415000001_evolution_is_test_content.sql`).
- [ ] Extend `evolution_metrics.entity_type` CHECK constraint to include `'criteria'`. New migration: `<TS+1>_extend_metrics_entity_type_for_criteria.sql` (must apply AFTER `<TS>`, before any `entity_type='criteria'` row insert).

#### Phase 1B — Variant column extensions
- [ ] Migration `<TS+2>_evolution_variants_criteria_columns.sql`:
  - `ALTER TABLE evolution_variants ADD COLUMN criteria_set_used UUID[]` (nullable).
  - `ALTER TABLE evolution_variants ADD COLUMN weakest_criteria_ids UUID[]` (nullable).
  - GIN indexes: `idx_evolution_variants_criteria_set_used` and `idx_evolution_variants_weakest_criteria_ids`.

#### Phase 1C — Zod schemas
- [ ] Add `evolutionCriteriaInsertSchema` and `evolutionCriteriaFullDbSchema` in `evolution/src/lib/schemas.ts`. Fields: name (string min 1 max 200), description (string optional), min_rating (number finite), max_rating (number finite), evaluation_guidance (`z.array(z.object({score: z.number(), description: z.string().min(1).max(500)})).optional().nullable()`), status (enum), archived_at + created_at + updated_at (nullable strings).
- [ ] Add `criteriaStatusEnum`.
- [ ] Add `evaluationGuidanceSchema = z.array(z.object({score: z.number().refine(Number.isFinite), description: z.string().min(1).max(500)}))` (re-used by insert + full + server action validators).
- [ ] Extend `evolutionVariantInsertSchema` and `evolutionVariantFullDbSchema` with `criteria_set_used: z.array(z.string().uuid()).optional().nullable()` and `weakest_criteria_ids: z.array(z.string().uuid()).optional().nullable()`.
- [ ] Refine `evolutionCriteriaInsertSchema` with two refinements:
  - `.refine((c) => c.max_rating > c.min_rating, { message: 'max_rating must exceed min_rating' })`
  - `.refine((c) => !c.evaluation_guidance || c.evaluation_guidance.every(a => a.score >= c.min_rating && a.score <= c.max_rating), { message: 'every rubric anchor score must be in [min_rating, max_rating]' })`

#### Phase 1D — Variant Zod schema + factory + entity-type extension
- [ ] **`Variant` is a Zod-derived type alias**, not an interface. Extend the underlying schema first.
- [ ] Extend `variantSchema` in `evolution/src/lib/schemas.ts` (search for `export const variantSchema = z.object({`) with `criteriaSetUsed: z.array(z.string().uuid()).optional()` and `weakestCriteriaIds: z.array(z.string().uuid()).optional()`. The `Variant` type alias picks up the new fields automatically.
- [ ] Extend `createVariant()` factory at `evolution/src/lib/types.ts:56-68` to accept `criteriaSetUsed?: ReadonlyArray<string>` and `weakestCriteriaIds?: ReadonlyArray<string>` and include them in the returned variant when provided.
- [ ] **Naming convention — camelCase in-memory, snake_case in DB**: `Variant.criteriaSetUsed` (TS) ↔ `evolution_variants.criteria_set_used` (Postgres). The variant-insert path in `persistRunResults.ts` MUST convert at the boundary. Add a round-trip unit test: in-memory `{criteriaSetUsed: [...]}` → DB row with `criteria_set_used` populated → SELECT → schema parser produces `criteriaSetUsed`.
- [ ] Update `persistRunResults.ts` insert to thread `criteriaSetUsed → criteria_set_used` and `weakestCriteriaIds → weakest_criteria_ids`.
- [ ] Update `createTestVariant` in `evolution/src/testing/evolution-test-helpers.ts:256` to accept and forward the two new optional fields, with explicit factory test for the round-trip.
- [ ] **HARD PREREQUISITE**: extend `CORE_ENTITY_TYPES` at `evolution/src/lib/core/types.ts:14` to include `'criteria'`. Without this, Phase 1E (CriteriaEntity sets `type: 'criteria'`), Phase 1G (METRIC_REGISTRY['criteria']), and `getEntity('criteria')` calls will all fail TypeScript compile. This is a one-line array addition that must land before Phase 1E.

#### Phase 1E — Entity class
- [ ] Create `evolution/src/lib/core/entities/CriteriaEntity.ts` mirroring `PromptEntity.ts`:
  - `type: 'criteria'`, `table: 'evolution_criteria'`, `renameField: 'name'`.
  - `createConfig`: fields = name (text required), description (textarea), min_rating + max_rating (number required), evaluation_guidance (custom field type `'rubric'` rendered by a row-per-anchor table editor — see Phase 1H).
  - `listColumns`: name, description (truncated), min_rating, max_rating, status.
  - `listFilters`: status, hide-test-content checkbox.
  - `actions`: rename, edit, delete (danger; cascade warning).
  - `detailTabs`: overview, metrics, variants, runs, by-prompt.
  - `metrics` registry (mirror `TacticEntity.metrics` shape; populated in Phase 1G).
  - `insertSchema: evolutionCriteriaInsertSchema`.
- [ ] Register in `evolution/src/lib/core/entityRegistry.ts` `initRegistry()`: `criteria: new CriteriaEntity()`.

#### Phase 1F — Server actions
- [ ] Create `evolution/src/services/criteriaActions.ts`:
  - `listCriteriaAction({ status, filterTestContent, name, limit, offset })` — paginated, with metric attachment via `getMetricsForEntities(db, 'criteria', ids, listViewMetricNames)`.
  - `getCriteriaDetailAction(criteriaId)` — single row.
  - `createCriteriaAction({ name, description?, min_rating, max_rating, evaluation_guidance? })` — Zod-validated (range refinement + per-anchor in-range refinement), INSERT.
  - `updateCriteriaAction({ id, name?, description?, min_rating?, max_rating?, evaluation_guidance? })` — Zod-validated, UPDATE. When updating `min_rating`/`max_rating`, re-validate any existing anchors against the new range; reject the update if anchors fall out of range (force the user to fix the rubric first).
  - `archiveCriteriaAction(criteriaId)` — sets `status='archived'`, `archived_at=now()`. Archived criteria are excluded from `getCriteriaForEvaluation` (which filters `status='active'`) and from the strategy wizard's multi-select picker (Phase 9C). Existing `criteria_set_used` UUID arrays in `evolution_variants` continue to reference the archived criteria; the leaderboard / detail page remain functional and label the criteria with an "Archived" pill in the UI.
  - `deleteCriteriaAction(criteriaId)` — **soft-delete** via `deleted_at TIMESTAMPTZ` column (matches `evolution_prompts.deleted_at` pattern from `arenaActions.deletePromptAction`). Sets `deleted_at=now()`. Soft-deleted criteria are excluded from ALL admin surfaces (list, detail, picker). Existing `criteria_set_used` references in `evolution_variants` continue to point to the row (which still exists in the DB), so historical leaderboard / detail data remains coherent. **Decision rationale**: hard delete would leave dangling UUIDs in `criteria_set_used` / `weakest_criteria_ids` UUID arrays — Postgres can't FK-enforce array elements, so historical aggregations would silently break. Soft delete preserves referential integrity at the application layer at the cost of one extra column + one extra `WHERE deleted_at IS NULL` clause in every read query.
  - **Phase 1A migration update**: add `deleted_at TIMESTAMPTZ NULL` to the column list above; add a partial index `idx_evolution_criteria_active ON evolution_criteria(id) WHERE deleted_at IS NULL AND status='active'` to keep the hot-path filter cheap.
  - `getCriteriaVariantsAction(criteriaId)` — variants where `criteria_set_used @> ARRAY[criteriaId]`.
  - `getCriteriaRunsAction(criteriaId)` — runs that used this criteria via invocations.
  - All wrapped in `adminAction`.
- [ ] Add cross-strategy validation helper `validateCriteriaIds(criteriaIds, db)` in same file: query `evolution_criteria.id IN ?` AND `status='active'`; throw if any missing/archived. Called by `createStrategyAction` before `upsertStrategy`.

#### Phase 1G — Metric registration
- [ ] Add `'criteria'` entity type entry to `METRIC_REGISTRY` in `evolution/src/lib/metrics/registry.ts`. Define 5 metrics:
  - `avg_score` (avg of LLM scores across runs that included this criteria) — `listView: true`
  - `frequency_as_weakest` (fraction of variants where this criteria was in `weakest_criteria_ids`) — `listView: true`
  - `total_variants_focused` (count of variants where `weakest_criteria_ids @> ARRAY[criteriaId]`) — `listView: true`
  - `avg_elo_delta_when_focused` (mean child.elo - parent.elo for focused variants) — `listView: true`
  - `run_count` (distinct runs that used this criteria) — `listView: true`
- [ ] Add to `STATIC_METRIC_NAMES` in `evolution/src/lib/metrics/types.ts`: `avg_score`, `frequency_as_weakest`, `total_variants_focused`, `avg_elo_delta_when_focused` (criteria-scoped to disambiguate from existing `avg_elo_delta`).
- [ ] Add propagation defs to `SHARED_PROPAGATION_DEFS` in `evolution/src/lib/metrics/registry.ts` if cross-entity rollup is desired (likely not for v1 — criteria metrics aggregate from variants directly, no run→strategy propagation needed).
- [ ] Create `evolution/src/lib/metrics/computations/criteriaMetrics.ts`:
  - `computeCriteriaMetricsForRun(runId, db)` — for each criteria mentioned in any variant's `criteria_set_used` for this run, compute the 5 metrics via SQL:
    ```sql
    -- avg_score: from execution_detail.evaluation.criteriaScored aggregated per criteria
    -- frequency_as_weakest: COUNT WHERE weakest_criteria_ids @> ARRAY[criteriaId] / COUNT total
    -- total_variants_focused: COUNT WHERE weakest_criteria_ids @> ARRAY[criteriaId]
    -- avg_elo_delta_when_focused: AVG(elo_score - parent.elo_score) for focused variants
    -- run_count: 1 (per-run; aggregated cross-run when read)
    ```
  - Wire call into `persistRunResults.ts` finalize path alongside `computeTacticMetricsForRun`.
- [ ] Extend `mark_elo_metrics_stale()` trigger function (new migration) to cascade staleness to `entity_type='criteria'` rows when a variant's `mu`/`sigma` changes.

#### Phase 1H — Admin pages
- [ ] Create `src/app/admin/evolution/criteria/page.tsx`. Use `EntityListPage` self-managed mode:
  - Columns: name (link), description (truncated), min_rating, max_rating, status, plus `createMetricColumns<EvolutionCriteriaRow>('criteria')` (5 metric columns with CI suffix where applicable).
  - Filters: status (active/archived), name search (ilike), filter-test-content checkbox.
  - `loadData` calls `listCriteriaAction`.
  - Header action: "New Criteria" → opens `FormDialog`.
  - Row actions: edit, delete (with cascade-warning ConfirmDialog).
- [ ] Create `src/app/admin/evolution/criteria/RubricEditor.tsx` — row-per-anchor table editor used inside the create/edit `FormDialog`:
  - Props: `value: Array<{score, description}> | null`, `onChange`, `minRating`, `maxRating`.
  - Renders a sortable table (sorted by score asc) with score (number input, validated against min/max) and description (text input, max 500 chars). `[+ Add anchor]` button appends a row; `✕` per row removes it.
  - Inline error states: red border + tooltip when score is out of range or description empty.
  - Empty-state: "No rubric defined — LLM will receive only `name + description + range`." Researchers can leave it empty and ship.
  - Collapsed-by-default panel under the description field; click to expand.
- [ ] Create `src/app/admin/evolution/criteria/[criteriaId]/page.tsx` (server component) and `CriteriaDetailContent.tsx` (client component) with tabs:
  - Overview (description + min/max + status + Evaluation Guidance section showing the rubric as a sortable list when present, "No rubric defined" placeholder when empty)
  - Metrics (`EntityMetricsTab` with `entityType='criteria'`)
  - Variants (paginated table from `getCriteriaVariantsAction`)
  - Runs (paginated table from `getCriteriaRunsAction`)
  - By Prompt (mirror `TacticPromptPerformanceTable` — new `CriteriaPromptPerformanceTable` querying variants grouped by prompt)
- [ ] Add sidebar nav entry in `src/components/admin/EvolutionSidebar.tsx`:
  ```typescript
  { href: '/admin/evolution/criteria', label: 'Criteria', icon: '🎯', testId: 'evolution-sidebar-nav-criteria', description: 'Quality evaluation criteria' }
  ```
  Place in "Entities" group near Tactics.

#### Phase 1I — Sample criteria seed script (Decision 9)

- [ ] Create `evolution/scripts/seedSampleCriteria.ts`. **CLI convention (committed per Decision 9): env-var-based, no `--target=` flag.** Reads `process.env.NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` directly (matches `evolution/scripts/syncSystemTactics.ts:48-66` precedent). Researchers override via shell:
  ```
  NEXT_PUBLIC_SUPABASE_URL=$STAGING_URL SUPABASE_SERVICE_ROLE_KEY=$STAGING_KEY \
    npx tsx evolution/scripts/seedSampleCriteria.ts
  # then re-run with prod env vars
  NEXT_PUBLIC_SUPABASE_URL=$PROD_URL SUPABASE_SERVICE_ROLE_KEY=$PROD_KEY \
    npx tsx evolution/scripts/seedSampleCriteria.ts
  ```
  Document this run pattern verbatim in the script's header comment.
- [ ] Build a `service_role` Supabase client; INSERT each sample with `ON CONFLICT (name) DO NOTHING`. Print summary `[seedSampleCriteria] inserted N rows; skipped M (already present)`.
- [ ] Inline the 7 sample criteria as a `SAMPLE_CRITERIA` const at the top of the script:
  ```typescript
  const SAMPLE_CRITERIA: ReadonlyArray<{
    name: string;
    description: string;
    min_rating: number;
    max_rating: number;
    evaluation_guidance: ReadonlyArray<{ score: number; description: string }>;
  }> = [
    {
      name: 'clarity',
      description: 'How easy the article is to read for the target audience.',
      min_rating: 1, max_rating: 10,
      evaluation_guidance: [
        { score: 1,  description: 'Unreadable; sentences fragment, jargon undefined, ideas buried.' },
        { score: 5,  description: 'Average reading difficulty; some passages dense or jargon-heavy.' },
        { score: 10, description: 'Effortless to read; ideas surface immediately, no friction.' },
      ],
    },
    {
      name: 'engagement',
      description: 'How well the article holds reader attention from start to finish.',
      min_rating: 1, max_rating: 10,
      evaluation_guidance: [
        { score: 1,  description: 'No hook; reader bounces in the first paragraph.' },
        { score: 5,  description: 'Mild interest; pacing flat or uneven.' },
        { score: 10, description: 'Compelling throughout; reader can\'t stop until the end.' },
      ],
    },
    {
      name: 'structure',
      description: 'Logical flow between sections, paragraph organization, and transitions.',
      min_rating: 1, max_rating: 10,
      evaluation_guidance: [
        { score: 1,  description: 'Random ordering; ideas don\'t connect; transitions absent.' },
        { score: 5,  description: 'Mostly logical with a few abrupt jumps or weak transitions.' },
        { score: 10, description: 'Each section follows necessarily from the last; transitions feel inevitable.' },
      ],
    },
    {
      name: 'depth',
      description: 'Quality of detail, technical accuracy, and explanation of mechanisms.',
      min_rating: 1, max_rating: 10,
      evaluation_guidance: [
        { score: 1,  description: 'Surface-level only; key concepts asserted without explanation.' },
        { score: 5,  description: 'Some mechanisms explained; gaps where details would clarify.' },
        { score: 10, description: 'Mechanisms fully explained; every claim grounded in detail.' },
      ],
    },
    {
      name: 'tone',
      description: 'Voice and register; consistency with the article\'s intent (educational, persuasive, etc.).',
      min_rating: 1, max_rating: 10,
      evaluation_guidance: [
        { score: 1,  description: 'Wildly inconsistent voice; register clashes with intent.' },
        { score: 5,  description: 'Generally consistent voice with a few off-key passages.' },
        { score: 10, description: 'Distinctive, consistent voice perfectly matched to intent.' },
      ],
    },
    {
      name: 'point_of_view',
      description: 'Whether the article takes a clear stance or perspective rather than enumerating facts neutrally.',
      min_rating: 1, max_rating: 10,
      evaluation_guidance: [
        { score: 1,  description: 'Pure enumeration; no perspective; reads like a Wikipedia summary.' },
        { score: 5,  description: 'Implicit perspective; takes occasional positions but mostly neutral.' },
        { score: 10, description: 'Clear thesis or perspective; the article argues for something specific.' },
      ],
    },
    {
      name: 'sentence_variety',
      description: 'Variation in sentence length and structure across paragraphs to maintain rhythm.',
      min_rating: 1, max_rating: 10,
      evaluation_guidance: [
        { score: 1,  description: 'All sentences nearly identical length; monotonous rhythm.' },
        { score: 5,  description: 'Some variation but most sentences cluster in one length range.' },
        { score: 10, description: 'Strong rhythm — short sentences punch, long sentences develop, balanced throughout.' },
      ],
    },
  ];
  ```
- [ ] Script CLI:
  - `--dry-run` — list what would be inserted without writing.
  - Exit 0 on success; non-zero on any DB error.
  - Environment selection via `process.env.NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (see Option (i) above).
- [ ] Print summary: `[seedSampleCriteria] supabase_url=<host> inserted=7 skipped=0` (first run) or `inserted=0 skipped=7` (re-run). Echo the URL host (NOT the key) so researchers can confirm they ran against the intended environment.
- [ ] **Documentation note in the script header**: "Run once after merging this PR — once on staging, once on production. Sample criteria are intentionally generic; researchers can edit/archive/delete them through the admin UI without re-running this script."
- [ ] **Local dev convenience**: add `npm run seed:criteria` to root `package.json` mapping to `npx tsx evolution/scripts/seedSampleCriteria.ts`. The script picks up `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from the developer's `.env.local` (loaded by Next.js convention; verify the script either calls `dotenv.config({ path: '.env.local' })` or relies on the runner's existing dotenv loading).

### Phase 2: Schema & Cost-Stack Foundation

#### Phase 2A — Strategy/iteration schema
- [ ] Extend `iterationAgentTypeEnum` in `evolution/src/lib/schemas.ts:394`: add `'criteria_and_generate'`.
- [ ] Update `isVariantProducingAgentType` (`schemas.ts:400-402`): add `t === 'criteria_and_generate'`.
- [ ] Add fields to `iterationConfigSchema` (`schemas.ts:416-447`):
  ```typescript
  criteriaIds: z.array(z.string().uuid()).optional(),
  weakestK: z.number().int().min(1).max(5).optional(),
  ```
- [ ] Append refinements:
  - `criteriaIds` only valid when `agentType === 'criteria_and_generate'`
  - `criteriaIds` non-empty when present (min 1 entry)
  - `criteriaIds` mutually exclusive with `generationGuidance`
  - `weakestK` only valid when `agentType === 'criteria_and_generate'`
  - When `agentType === 'criteria_and_generate'`, `criteriaIds` is required (refine instead of `.required()` for cleaner error message)
  - **Cross-field refinement: `weakestK <= criteriaIds.length`** — when both fields are present, the weakest count cannot exceed the number of selected criteria. Catches normal user submissions (e.g., 2 criteria + weakestK=5) at validation time so the runtime clamp in Phase 7 only fires for genuine configuration drift (criteria archived between configure and run). Error message: `"weakestK (${c.weakestK}) cannot exceed the number of selected criteria (${c.criteriaIds.length})"`.
- [ ] Update strategy-level refinement messages to mention all three variant-producing agent types.

#### Phase 2B — Hash canonicalization
- [ ] Update `canonicalizeIterationConfig` in `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts:30-46`:
  ```typescript
  if (iterCfg.criteriaIds !== undefined && iterCfg.criteriaIds.length > 0
      && iterCfg.agentType === 'criteria_and_generate') {
    // **Decision (committed): SORT criteriaIds before hashing.**
    // Two strategies that reference the same set of criteria in different
    // orders are semantically equivalent — the wrapper agent evaluates ALL
    // configured criteria (order-independent) and the weakest-K selection
    // is deterministic on score, not on order. Sorting canonicalizes the
    // hash so equivalent configs dedupe to the same strategy row, avoiding
    // strategy-table fragmentation.
    out.criteriaIds = [...iterCfg.criteriaIds].sort();
  }
  if (iterCfg.weakestK !== undefined && iterCfg.agentType === 'criteria_and_generate') {
    out.weakestK = iterCfg.weakestK;
  }
  ```
  Stripping falsy values keeps existing strategy hashes stable.
- [ ] Add backward-compat hash regression tests in `findOrCreateStrategy.test.ts`:
  - Snapshot test: legacy config without criteriaIds keeps prior hash.
  - Distinct-hash test: two configs differing only by `criteriaIds` (different UUID set) produce different hashes.
  - Distinct-hash test: two configs differing only by `weakestK` produce different hashes.
  - Canonicalization test: undefined `criteriaIds` and empty array hash identically.
  - **Sort-canonicalization test**: two configs with same UUIDs in different orders (`[a,b,c]` vs `[c,b,a]`) hash IDENTICALLY (proves sort step works).

#### Phase 2C — Cost-stack labels
- [ ] Add single label `'evaluate_and_suggest'` to `AGENT_NAMES` in `evolution/src/lib/core/agentNames.ts`.
- [ ] Map in `COST_METRIC_BY_AGENT` to `'evaluation_cost'` (single bucket per Decision 2).
- [ ] Add `'evaluation_cost'`, `'total_evaluation_cost'`, `'avg_evaluation_cost_per_run'` to `STATIC_METRIC_NAMES` in `evolution/src/lib/metrics/types.ts`.
- [ ] Add `OUTPUT_TOKEN_ESTIMATES.evaluate_and_suggest = 2300` in `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts:33-38`. Reasoning: ~150 chars score lines (criteriaCount × 30 chars × 4 chars/token) + ~600 tokens × weakestK suggestion blocks ≈ 2300 typical at criteriaCount=5, weakestK=1.
- [ ] Extend phase enum in `evolution/src/lib/pipeline/infra/costCalibrationLoader.ts:24` to include `'evaluate_and_suggest'`.
- [ ] Extend calibration ladder in `createEvolutionLLMClient.ts:91-95` to map the new label to its phase string for `getCalibrationRow()`.
- [ ] Add propagation defs in `evolution/src/lib/metrics/registry.ts` `SHARED_PROPAGATION_DEFS`:
  ```typescript
  { name: 'total_evaluation_cost', sourceMetric: 'evaluation_cost', sourceEntity: 'run', aggregate: aggregateSum, listView: true, ... },
  { name: 'avg_evaluation_cost_per_run', sourceMetric: 'evaluation_cost', sourceEntity: 'run', aggregate: aggregateAvg, listView: false, ... },
  ```

#### Phase 2D — Execution detail schema
- [ ] Add `evaluateCriteriaThenGenerateFromPreviousArticleExecutionDetailSchema` in `evolution/src/lib/schemas.ts`:
  ```typescript
  detailType: z.literal('evaluate_criteria_then_generate_from_previous_article')
  variantId: z.string().nullable().optional()
  weakestCriteriaIds: z.array(z.string().uuid())   // UUIDs picked as weakest (wrapper-determined, deterministic)
  weakestCriteriaNames: z.array(z.string())        // resolved names for chart labels
  evaluateAndSuggest?: {                            // single sub-object — sourced from one LLM call
    criteriaScored: Array<{ criteriaId, criteriaName, score, minRating, maxRating }>
    suggestions: Array<{ examplePassage, whatNeedsAddressing, suggestedFix, criteriaName }>
    droppedSuggestions?: Array<{ criteriaName, reason }>   // suggestions for non-weakest criteria, dropped with warn
    rawResponse?, parseError?, durationMs?, cost?
  }
  generation?: <reuse GFPA's generation sub-shape>
  ranking?: <reuse GFPA's ranking sub-shape>.nullable()
  tactic: z.literal('criteria_driven')             // static per Decision 7
  totalCost: z.number().min(0).optional()
  estimatedTotalCost?, estimationErrorPct?
  surfaced: z.boolean()
  discardReason?: object
  ```
- [ ] Register variant in `agentExecutionDetailSchema` discriminated union (`schemas.ts:1197-1214`).

#### Phase 2E — TACTIC_PALETTE + marker-tactic registration
- [ ] Add `criteria_driven: '#6366f1'` (indigo) to `TACTIC_PALETTE` in `evolution/src/lib/core/tactics/index.ts`. Keeps lineage-graph nodes color-consistent and gives the arena leaderboard's Tactic column a recognizable color.
- [ ] Add `MARKER_TACTICS` const in `evolution/src/lib/core/tactics/index.ts`:
  ```typescript
  // Marker tactics: registered in evolution_tactics so leaderboards and the arena
  // Tactic column can resolve them to UUIDs and link to the tactic detail page.
  // NOT used for prompt construction. Variants tagged with these names route
  // through specialized agents (e.g., the criteria-driven wrapper) that build
  // their own customPrompt. getTacticDef() intentionally does NOT include these
  // — keeping buildPromptForTactic() returning null on a marker name preserves
  // vanilla-GFPA's existing early-exit safety.
  export const MARKER_TACTICS: ReadonlyArray<{
    name: string;
    label: string;
    agent_type: string;
    category: string;
  }> = [
    {
      name: 'criteria_driven',
      label: 'Criteria-Driven',
      agent_type: 'evaluate_criteria_then_generate_from_previous_article',
      category: 'meta',
    },
  ];
  ```
- [ ] Update `evolution/scripts/syncSystemTactics.ts` to union `ALL_SYSTEM_TACTICS` (existing prompt-driving registry) and `MARKER_TACTICS` (new) when upserting. **Schema reality check**: `evolution_tactics` table (`supabase/migrations/20260417000001_evolution_tactics.sql:5-14`) has columns `id, name, label, agent_type, category, is_predefined, status, created_at` — NO `preamble` or `instructions` columns. Marker upsert payload is therefore `{name, label, agent_type, category, is_predefined: true, status: 'active'}` — same shape the existing system-tactic upsert uses. Both registries are upsert-by-name idempotent (`ON CONFLICT (name) DO UPDATE`); safe to re-run.
- [ ] **Critical invariant — `getTacticDef('criteria_driven')` returns `undefined`.** Add a unit test asserting this. Reasoning: `buildPromptForTactic` (`generateFromPreviousArticle.ts:27-31`) returns `null` when `getTacticDef` is undefined, and GFPA's `execute()` early-exits with `status: 'generation_failed'`. Without this safety net, a misconfigured iteration that dispatches vanilla GFPA with `tactic: 'criteria_driven'` (and no `customPrompt`) would silently produce a no-op LLM prompt. The wrapper agent (Phase 5) always passes `customPrompt`, so this is defense-in-depth.
- [ ] Tactic detail page at `/admin/evolution/tactics/criteria_driven` works for free: existing `getTacticDetailAction` reads the row from `evolution_tactics`. **Note**: `getTacticDetailAction` enriches the response with `preamble` and `instructions` from `getTacticDef(row.name)` — for marker tactics, this returns `undefined` and the detail page Overview tab simply omits those sections. Verify the existing detail page handles missing preamble/instructions gracefully during execution; if not, add a null-check to `TacticDetailContent.tsx`.
- [ ] **Run-once command after merge** (alongside the seed-criteria script in Phase 1I rollout):
  ```
  NEXT_PUBLIC_SUPABASE_URL=$STAGING_URL SUPABASE_SERVICE_ROLE_KEY=$STAGING_KEY \
    npx tsx evolution/scripts/syncSystemTactics.ts
  NEXT_PUBLIC_SUPABASE_URL=$PROD_URL SUPABASE_SERVICE_ROLE_KEY=$PROD_KEY \
    npx tsx evolution/scripts/syncSystemTactics.ts
  ```
  Idempotent. (`syncSystemTactics.ts` reads URL + service-role key from `process.env`, no `--target=` flag exists — verified at `evolution/scripts/syncSystemTactics.ts:48-66`.)

#### Phase 2F — Fixture migration
- [ ] **Run grep first** to find every file that references `iterationConfigs` or `iterationAgentTypeEnum`: `grep -rn "iterationConfigs\|iterationAgentTypeEnum" evolution/ src/__tests__/ | cut -d: -f1 | sort -u`. Audit each hit; the list below is the known-required minimum (~5 files) but the actual count is ~25-30 once exhaustive type-narrowing switches are factored in.
- [ ] Update test-helper fixtures and any iterationConfigs-referencing test files to include the new optional fields (default to absent) and to handle the new `'criteria_and_generate'` enum value in any exhaustive switch:
  - `evolution/src/testing/evolution-test-helpers.ts` — `createTestStrategyConfig()`, `createTestVariant()` (must accept `criteriaSetUsed`/`weakestCriteriaIds`). `createMockExecutionContext()` requires NO change (Phase 7 committed to Option A — wrapper gets `criteria` via input, not via `AgentContext`).
  - `evolution/src/testing/executionDetailFixtures.ts` — add `evaluateCriteriaThenGenerateFromPreviousArticleDetailFixture`.
  - `evolution/src/lib/pipeline/loop/runIterationLoop.test.ts` — `makeConfig()` and any agentType-narrowing switches.
  - `evolution/src/lib/pipeline/loop/runIterationLoop-topup.integration.test.ts` — same.
  - `evolution/src/lib/pipeline/loop/projectDispatchPlan.test.ts` — agentType-narrowing exhaustiveness.
  - `evolution/src/lib/pipeline/setup/buildRunContext.test.ts` and `buildRunContext.ts` — strategy-config fixtures + helpers.
  - `evolution/src/lib/pipeline/setup/findOrCreateStrategy.test.ts` — hash regression (new positive cases for criteria-and-generate variants per Phase 2B).
  - `evolution/src/lib/pipeline/claimAndExecuteRun.test.ts` — strategy fixtures.
  - `evolution/src/lib/iterationConfigSchema.test.ts` — refinement matrix (new criteria-related cases).
  - `evolution/src/lib/schemas.test.ts` — full refinement matrix (per Unit Tests section).
  - `evolution/src/services/strategyRegistryActions.test.ts` — create/update mocks (validateCriteriaIds wire-in).
  - `evolution/src/services/experimentActions.test.ts` — strategy mocks.
  - `evolution/src/lib/pipeline/infra/types.test.ts` — type tests if exhaustive switches.
  - `src/app/admin/evolution/_components/ExperimentForm.test.tsx` — STRATEGIES array fixtures.
  - E2E seed-data scripts — search `src/__tests__/e2e/fixtures/` and `evolution/src/__tests__/integration/` for strategy-config seed JSON.
  - Any other hits from the grep above — audit each.
- [ ] Run `npm run lint && npm run tsc && npm run build && npm run test:unit` after each schema change to keep the tree green. TypeScript-strict exhaustiveness errors on switches over `iterationAgentTypeEnum` will surface every site that needs updating.

### Phase 3: Cost Estimation Integration

- [ ] Add single helper in `evolution/src/lib/pipeline/infra/estimateCosts.ts`:
  - `estimateEvaluateAndSuggestCost(parentChars, generationModel, judgeModel, criteriaCount, weakestK, avgRubricChars)` — single LLM call that scores all criteria AND writes suggestions for the K weakest in one response.
    - Input chars: `parentChars + EVALUATE_AND_SUGGEST_PROMPT_OVERHEAD + criteriaCount * (CRITERIA_DESC_CHARS_PER_ITEM + avgRubricChars)`.
    - Output chars: `criteriaCount * 150` (score lines) + `weakestK * 800` (suggestion blocks). Combined output budget ≈ 2300 chars at typical sizing.
    - New constants: `CRITERIA_DESC_CHARS_PER_ITEM = 200`, `EVALUATION_RUBRIC_CHARS_PER_CRITERION = 500` (typical 4 anchors × ~100 chars + headers — refine via calibration), `EVALUATE_AND_SUGGEST_PROMPT_OVERHEAD = 1200`.
  - Consults calibration via `getCalibrationRow('__unspecified__', model, judge, 'evaluate_and_suggest')` with fallback to constants.
  - **Preview-time `avgRubricChars`**: assume `EVALUATION_RUBRIC_CHARS_PER_CRITERION` constant. Wizard can't know the actual rubric chars without fetching criteria rows (defeats the no-DB-fetch decision); 1.3x reserve margin in the cost-tracker absorbs estimate drift.
  - **Runtime `avgRubricChars`**: Phase 4's `getCriteriaForEvaluation` returns the rubric, so the agent computes actual avg chars from fetched rows and passes that to `estimateEvaluateAndSuggestCost` for accurate per-call reservation. Documented as known wizard-vs-runtime estimate skew.
- [ ] Extend `EstPerAgentValue` type in `evolution/src/lib/pipeline/loop/projectDispatchPlan.ts:69-75`: add `evaluation: number` field (single combined bucket; rollup of evaluate+suggest at projection time).
- [ ] Extend `weightedAgentCost` (`projectDispatchPlan.ts:185-207`): accept `useCriteria: boolean`, `criteriaCount: number`, `weakestK: number`. When `useCriteria=true`, add `estimateEvaluateAndSuggestCost(...)` (single combined helper per Decision 2) to the running total.
- [ ] Extend `estimateAgentCost` in `estimateCosts.ts:122-134`: signature gets `useCriteria: boolean = false`, `criteriaCount?: number`, `weakestK?: number`.
- [ ] Update `projectDispatchPlan` (`projectDispatchPlan.ts:223-336`):
  - Resolve `useCriteria = iterCfg.agentType === 'criteria_and_generate'`.
  - Resolve `criteriaCount = iterCfg.criteriaIds?.length ?? 0`.
  - Resolve `weakestK = iterCfg.weakestK ?? 1`.
  - Pass to `weightedAgentCost`.
- [ ] Extend `dispatchPreviewInputSchema` in `evolution/src/services/strategyPreviewActions.ts` to thread `criteriaIds` and `weakestK`.
- [ ] Update `getStrategyDispatchPreviewAction` (`strategyPreviewActions.ts:222-266`): pass `criteriaCount` (just the array length — no DB fetch needed; matches `reflectionTopN` pattern of using user-set value verbatim) into `projectDispatchPlan`.
- [ ] Update `IterationPlanEntryClient` type (`strategyPreviewActions.ts:198-215`) to include `criteriaCount?: number` for UI display.

### Phase 4: Mid-Run Criteria Fetch

- [ ] Add `getCriteriaForEvaluation(db, criteriaIds, logger?)` in `evolution/src/services/criteriaActions.ts`:
  - Query: `SELECT id, name, description, min_rating, max_rating, evaluation_guidance FROM evolution_criteria WHERE id = ANY(criteriaIds) AND status = 'active'`.
  - Return: `Map<string, EvolutionCriterionRow>` (keyed by id). `EvolutionCriterionRow` includes `evaluation_guidance: Array<{score, description}> | null`.
  - Error fallback: try/catch returning empty Map + warn-log.
- [ ] **Do NOT extend `AgentContext`** for `evaluationCriteria` — per Phase 7's wiring decision (Option A), the fetched criteria are passed via `EvaluateCriteriaInput.criteria`, not via context. Keep the runIterationLoop closure variable local; the wrapper agent reads from input. (If Phase 7 reverses to Option B, add `evaluationCriteria?: ReadonlyMap<...>` here and update `createMockExecutionContext` in `evolution/src/testing/evolution-test-helpers.ts` accordingly.)
- [ ] Wire fetch into `runIterationLoop.ts` iteration body (after `reflectionEnabled` resolution at line 343, before `dispatchOneAgent` is defined):
  ```typescript
  let evaluationCriteria: ReadonlyMap<string, EvolutionCriterionRow> = new Map();
  if (iterCfg.agentType === 'criteria_and_generate' && iterCfg.criteriaIds) {
    try {
      evaluationCriteria = await getCriteriaForEvaluation(db, iterCfg.criteriaIds, logger);
    } catch (err) {
      logger.warn('Phase 4 criteria fetch failed; iteration cannot run', {
        phaseName: 'criteria_prep',
        error: err instanceof Error ? err.message : String(err),
      });
      // Empty map: agent will throw at validation; iteration ends with all dispatches failed.
    }
  }
  ```

### Phase 5: Wrapper Agent Class — `EvaluateCriteriaThenGenerateFromPreviousArticleAgent`

- [ ] Create `evolution/src/lib/core/agents/evaluateCriteriaThenGenerateFromPreviousArticle.ts`. File order mirrors `reflectAndGenerateFromPreviousArticle.ts`:
  1. **Custom error types**:
     ```typescript
     class EvaluateAndSuggestLLMError extends Error {}
     class EvaluateAndSuggestParseError extends Error {
       constructor(message: string, readonly rawResponse: string) { super(message); }
     }
     ```
  2. **Input/output types**:
     ```typescript
     interface EvaluateCriteriaInput {
       parentText: string;
       parentVariantId: string;
       criteria: ReadonlyArray<EvolutionCriterionRow>;     // active rows fetched in Phase 4
       criteriaIds: ReadonlyArray<string>;                  // canonical UUIDs from iterCfg
       weakestK: number;                                    // 1-5
       initialPool: ReadonlyArray<Variant>;
       initialRatings: ReadonlyMap<string, Rating>;
       initialMatchCounts: ReadonlyMap<string, number>;
       cache: Map<string, ComparisonResult>;
       llm?: EvolutionLLMClient;
     }
     type EvaluateCriteriaOutput = GenerateFromPreviousOutput;
     type EvaluateCriteriaExecutionDetail = z.infer<typeof evaluateCriteriaThenGenerateFromPreviousArticleExecutionDetailSchema>;
     ```
  3. **Combined prompt builder** (single LLM call per Decision 2):
     - `buildEvaluateAndSuggestPrompt(parentText, criteria, effectiveWeakestK)`:
       - Preamble: "You are an expert article evaluator and writing coach. Score each criterion against the article, then write fix-suggestions for the K lowest-scoring."
       - Parent text labeled `## Article`.
       - `## Criteria` block — one numbered entry per criterion:
         ```
         ${i + 1}. ${name} (${min_rating}-${max_rating}): ${description}
            Rubric:                                              ◀── only when evaluation_guidance non-empty
              ${anchor.score} = ${anchor.description}            ◀── one line per anchor, sorted by score asc
         ```
         Rubric block omitted when `evaluation_guidance` is null/empty.
       - Structured ask (two output sections in one response):
         ```
         ## Output Format
         First, score each criterion using <name>: <score> per line. Use each criterion's
         stated range; rubric anchors (when provided) define key scores to interpolate between.
         
         Then identify the ${effectiveWeakestK} lowest-scoring criteria and provide 2-3 suggestions for
         each in this exact format:
         
         ### Suggestion <number>
         Criterion: <criterion name from above>
         Example: <verbatim passage from the article>
         Issue: <one sentence on why this passage is weak for this criterion>
         Fix: <one sentence on how to address it>
         
         Output the score lines first, then a blank line, then the suggestion blocks. No other text.
         ```
  4. **Parser** (single combined parser):
     - `parseEvaluateAndSuggest(response, criteria, weakestCriteriaIds): { criteriaScored, suggestions, droppedSuggestions }`:
       - Split response on the first `### Suggestion` occurrence: pre = score section, post = suggestions section.
       - **Score section**: regex `/^([A-Za-z][\w_-]*)\s*:\s*(-?\d+(?:\.\d+)?)\s*$/m` per line. Lookup criteria by name (case-insensitive); drop unknowns; validate score ∈ `[min_rating, max_rating]`; drop out-of-range with warn-log. Throw `EvaluateAndSuggestParseError` (raw response preserved) if zero valid scores.
       - **Suggestion section**: block regex `/^###\s+Suggestion\s+\d+\s*$([\s\S]*?)(?=^###|\Z)/m`. Per-block extract `Criterion:`, `Example:`, `Issue:`, `Fix:` lines. Drop blocks with missing fields. Drop blocks whose `Criterion:` name is NOT in `weakestCriteriaIds` (the wrapper-determined weakest set), capturing them in `droppedSuggestions` for forensic display. Throw `EvaluateAndSuggestParseError` if zero valid suggestions remain after weakest-filter.
       - LLM-vs-wrapper disagreement on weakest: when the LLM writes suggestions for criteria the wrapper didn't pick (e.g., on tied/close scores), those blocks land in `droppedSuggestions` with a warn-log; the surviving suggestions for wrapper-determined weakest still drive generation. If LLM picked completely different weakest (zero overlap with wrapper), `droppedSuggestions` is full and `suggestions` is empty → throw `EvaluateAndSuggestParseError`. Edge case is rare and indicates either prompt drift or genuinely tied scores; surfacing it as a hard failure forces operator attention.
  5. **Class**:
     ```typescript
     export class EvaluateCriteriaThenGenerateFromPreviousArticleAgent extends Agent<EvaluateCriteriaInput, EvaluateCriteriaOutput, EvaluateCriteriaExecutionDetail> {
       readonly name = 'evaluate_criteria_then_generate_from_previous_article';
       readonly usesLLM = true;
       getAttributionDimension(detail: EvaluateCriteriaExecutionDetail): string | null {
         return detail?.weakestCriteriaNames?.[0] ?? null;  // primary weakest drives the dimension
       }
       readonly detailViewConfig = [...];                    // see Phase 8
       readonly invocationMetrics = [METRIC_CATALOG.format_rejection_rate, ...];
       async execute(input, ctx) { ... }                     // see below
     }
     ```
  6. **`execute()` flow** (sequential bullets — order matters; two try/catch blocks: combined LLM call + inner GFPA):
     - **(a) Validate input** (also documented in Phase 7): assert `input.criteria.length > 0` else throw `Error('No active criteria resolved for iteration')` after writing partial detail; compute `effectiveWeakestK = Math.min(input.weakestK, input.criteria.length)`. Emit warn-log when clamping fires.
     - **(b) Build the combined prompt** via `buildEvaluateAndSuggestPrompt(input.parentText, input.criteria, effectiveWeakestK)` — passes the clamped K so the LLM is asked for the same number of suggestion blocks the wrapper will keep (avoids spurious `droppedSuggestions` population when the clamp fires).
     - **(c) Capture cost + start time**: `costBeforeCombined = ctx.costTracker.getOwnSpent?.() ?? 0`; `combinedStart = Date.now()`.
     - **(d) Try 1: combined evaluate-and-suggest LLM call** via `input.llm.complete(prompt, 'evaluate_and_suggest', { model: ctx.config.generationModel, invocationId: ctx.invocationId })`. On throw, persist partial detail `{ evaluateAndSuggest: { rawResponse?: undefined, parseError: undefined, durationMs, cost } }` via `updateInvocation(...)`; re-throw `EvaluateAndSuggestLLMError`.
     - **(e) Compute** `combinedCost = (ctx.costTracker.getOwnSpent?.() ?? 0) - costBeforeCombined`; `combinedDurationMs = Date.now() - combinedStart`.
     - **(f) First-pass parse: scores only.** On parse error, persist `{ evaluateAndSuggest: { rawResponse: response, parseError: <msg>, durationMs, cost } }`; throw `EvaluateAndSuggestParseError`.
     - **(g) Identify `weakestKEntries`**: sort scored entries by normalized score asc (`(score - min) / (max - min)`), take first `effectiveWeakestK`. Resolve `weakestCriteriaIds` and `weakestCriteriaNames`.
     - **(h) Second-pass parse: suggestions filtered by `weakestCriteriaIds`.** On parse error, persist full evaluation + rawResponse + parseError; throw `EvaluateAndSuggestParseError`. (Same custom error type — keeps error handling uniform.)
     - Build the `customPrompt` for inner GFPA from filtered suggestions. Preamble: "You are an expert article reviser focusing on these specific issues: ...". Instructions: enumerated suggestions verbatim + "Rewrite the article addressing each issue."
     - **Try 2: inner GFPA**:
       ```typescript
       // LOAD-BEARING INVARIANTS:
       // (1) Must call .execute() directly, NOT .run().
       //     .run() would create a NESTED Agent.run() scope (separate AgentCostScope),
       //     splitting cost attribution between this wrapper and the inner GFPA.
       // (2) The partial-detail-preserving updateInvocation() calls in our error
       //     paths above rely on trackInvocations.ts:81's conditional-spread for
       //     execution_detail (Phase 2 fix). Agent.run()'s catch handler (Agent.ts:179)
       //     subsequently writes cost_usd + success: false + error_message WITHOUT
       //     execution_detail, and the conditional spread preserves whatever we wrote
       //     pre-throw. If trackInvocations.updateInvocation ever changes to
       //     unconditionally write null on omitted fields, every partial-failure
       //     execution_detail in this agent gets clobbered. Cite both files when
       //     reading this code; do not refactor either in isolation.
       // See evaluateCriteriaThenGenerateFromPreviousArticle_20260501_planning.md Phase 5.
       const innerInput: GenerateFromPreviousInput = {
         parentText: input.parentText,
         tactic: 'criteria_driven',  // static marker — Decision 7
         parentVariantId: input.parentVariantId,
         initialPool: input.initialPool,
         initialRatings: input.initialRatings,
         initialMatchCounts: input.initialMatchCounts,
         cache: input.cache,
         llm: input.llm,
         criteriaSetUsed: input.criteriaIds,           // explicit pass-through to GFPA's
         weakestCriteriaIds,                            // createVariant() — NULL DB cols otherwise
         customPrompt: { preamble, instructions },         // Phase 6
       };
       try {
         const gfpaResult = await new GenerateFromPreviousArticleAgent().execute(innerInput, ctx);
       } catch (err) {
         // preserve evaluation + suggestions detail before rethrow
         await updateInvocation(ctx.db, ctx.invocationId, { cost_usd, success: false, execution_detail: partialDetail });
         throw err;
       }
       ```
     - On the inner variant, set `criteriaSetUsed: input.criteriaIds` and `weakestCriteriaIds` (the agent has authority over these fields; threaded via `createVariant()` extension from Phase 1D). Inner GFPA writes them into `Variant` before persistence.
     - **Merge step**: build merged `execution_detail` with explicit `totalCost` recompute:
       ```typescript
       totalCost: combinedCost + (gfpaDetail.totalCost ?? 0)
       ```
       Set `evaluateAndSuggest = { criteriaScored, suggestions, droppedSuggestions, durationMs: combinedDurationMs, cost: combinedCost }`. Spread `gfpaDetail.generation` and `gfpaDetail.ranking`. Set `tactic: 'criteria_driven'`.
     - Return `AgentOutput<EvaluateCriteriaOutput, EvaluateCriteriaExecutionDetail>`.
  7. **Registration** at bottom of file:
     ```typescript
     registerAttributionExtractor(
       'evaluate_criteria_then_generate_from_previous_article',
       (detail: unknown) => {
         const weakest = (detail as { weakestCriteriaNames?: unknown })?.weakestCriteriaNames;
         if (!Array.isArray(weakest) || weakest.length === 0) return null;
         const primary = weakest[0];
         return typeof primary === 'string' && primary.length > 0 && !primary.includes(':') ? primary : null;
       },
     );
     ```
- [ ] Add the new agent class to `evolution/src/lib/core/agentRegistry.ts` `_agents` array.
- [ ] Add to `evolution/src/lib/core/agents/index.ts` barrel for side-effect registration of attribution extractor (load-bearing for `experimentMetrics.computeEloAttributionMetrics`).

### Phase 6: GFPA `customPrompt` Override

Smallest blast-radius refactor. Lets the wrapper drive generation off suggestions instead of a tactic def.

- [ ] Extend `GenerateFromPreviousInput` interface in `evolution/src/lib/core/agents/generateFromPreviousArticle.ts:35-51`:
  ```typescript
  customPrompt?: { preamble: string; instructions: string };
  ```
- [ ] Update `execute()` (`generateFromPreviousArticle.ts:175-181`) to branch on `customPrompt` AND add an explicit misconfiguration guard:
  ```typescript
  // Guard: tactic='criteria_driven' is a marker — only the wrapper agent
  // should dispatch GFPA with this tactic, and ONLY with customPrompt set.
  // If a strategy is misconfigured (agentType='generate' with tactic='criteria_driven'),
  // throw rather than silently produce a no-op invocation via buildPromptForTactic
  // returning null (which would early-exit with 'generation_failed' and burn budget).
  if (tactic === 'criteria_driven' && input.customPrompt === undefined) {
    throw new Error(
      "GFPA dispatched with tactic='criteria_driven' but no customPrompt — " +
      "this tactic is reserved for the EvaluateCriteriaThenGenerateFromPreviousArticleAgent " +
      "wrapper, which always passes customPrompt. Strategy configuration error."
    );
  }
  const prompt = input.customPrompt
    ? buildEvolutionPrompt(input.customPrompt.preamble, 'Original Text', parentText, input.customPrompt.instructions)
    : buildPromptForTactic(parentText, tactic);
  if (prompt === null) {
    return { result: { variant: null, status: 'generation_failed', surfaced: false, matches: [] }, ... };
  }
  ```
- [ ] When `customPrompt` is set, GFPA sets `Variant.tactic = tactic` (still passed in by caller; for criteria-driven it's `'criteria_driven'`). No other behavior change.
- [ ] **Snapshot regression test for the customPrompt branch**: assert that `customPrompt: undefined` produces byte-identical prompts to the pre-refactor `buildPromptForTactic(parentText, tactic)` output. Without this, the Phase 6 refactor risks silently regressing all 24 vanilla tactic-driven generations — and Decision 4's "no kill-switch" rollback story isn't honest because GFPA touches every existing strategy, not just `criteria_and_generate` ones. Add a snapshot test to `generateFromPreviousArticle.test.ts` covering all 24 tactics.
- [ ] Variant-creation site (`generateFromPreviousArticle.ts:223-232`): thread `criteriaSetUsed` and `weakestCriteriaIds` into `createVariant({...})` when present on input. Add optional fields to `GenerateFromPreviousInput`:
  ```typescript
  criteriaSetUsed?: ReadonlyArray<string>;
  weakestCriteriaIds?: ReadonlyArray<string>;
  ```
  (Wrapper passes these through; vanilla GFPA callers leave them undefined.)
- [ ] Unit-test the override path: when `customPrompt` is set, `buildPromptForTactic` is NOT called; the prompt contains the override preamble + instructions verbatim.

### Phase 7: Orchestrator Integration

- [ ] **Widen the outer iteration-type conditional FIRST.** `runIterationLoop.ts` currently gates dispatch on `if (iterType === 'generate' || iterType === 'reflect_and_generate')` (line ~326). Without admitting `'criteria_and_generate'` to this conditional, the new agent is unreachable regardless of the closure changes below. Replace with a call to the existing `isVariantProducingAgentType(iterType)` helper (which Phase 2A extends to include the new type), OR add `|| iterType === 'criteria_and_generate'` to the `||` chain. The helper is preferred — single source of truth for "this iteration produces variants".
- [ ] In `runIterationLoop.ts` `dispatchOneAgent` closure, add a third agent-instantiation branch:
  ```typescript
  if (iterCfg.agentType === 'criteria_and_generate') {
    const wrapper = new EvaluateCriteriaThenGenerateFromPreviousArticleAgent();
    return wrapper.run({
      parentText: resolved.text,
      parentVariantId: resolved.variantId,
      criteria: Array.from(evaluationCriteria.values()),
      criteriaIds: iterCfg.criteriaIds!,
      weakestK: iterCfg.weakestK ?? 1,
      initialPool, initialRatings, initialMatchCounts, cache,
    }, ctxForAgent);
  } else if (reflectionEnabled) {
    // existing reflection branch
  } else {
    // existing vanilla GFPA branch
  }
  ```
  Both parallel batch and top-up loop pick this up automatically.
- [ ] **AgentContext field disposition: COMMITTED to Option A (pass via input).** Wrapper agent input receives `criteria: Array.from(evaluationCriteria.values())` directly inside `dispatchOneAgent`. `AgentContext` is NOT extended with `evaluationCriteria` (Phase 4 already reflects this commitment). Rationale: smaller context surface; agent input is already explicit and per-call; avoids dead state on every other agent's context. Phase 2F's fixture-list bullet about `createMockExecutionContext` no longer needs to add `evaluationCriteria` (already removed from the must-update column).
- [ ] Validate at wrapper agent's `execute()` entry:
  - `input.criteria.length > 0` — if empty (Phase 4 fetch failed; all criteria archived/deleted between strategy creation and run), write partial detail `{ evaluateAndSuggest: undefined, weakestCriteriaIds: [], weakestCriteriaNames: [] }` then throw `Error('No active criteria resolved for iteration')`. Iteration ends with failed dispatches; iteration result records `'iteration_complete'` with 0 variants produced; run continues.
  - **`input.weakestK <= input.criteria.length`** — if not (e.g., user configured weakestK=3 but 1 of 3 criteria was archived between configure and run, leaving 2 fetched), **clamp**: `effectiveWeakestK = Math.min(input.weakestK, input.criteria.length)` and emit a warn-log via the invocation logger: `{phaseName: 'criteria_validation', message: 'weakestK > fetched criteria count; clamping', requested: input.weakestK, fetched: input.criteria.length, effective: effectiveWeakestK}`. Iteration continues with the smaller K. Documented as preferable to throwing because the configuration drift is observable in logs but doesn't kill the run.
- [ ] Wire `iterCfg.criteriaIds.length` + `iterCfg.weakestK` into `estimateAgentCost` call site (line ~334) so dispatch sizing includes evaluation cost. **Use `iterCfg.criteriaIds.length` (not `evaluationCriteria.size`)** — the estimate runs BEFORE Phase 4's iteration-scoped fetch resolves; matching reflection's pre-fetch precedent (`iterCfg.reflectionTopN ?? 3`). Runtime per-call cost reservations inside the wrapper use the actual fetched-rows count for accuracy.
- [ ] Update `EvolutionConfig` validation in `runIterationLoop.ts` entry point: when any iteration has `agentType: 'criteria_and_generate'`, ensure that iteration has non-empty `criteriaIds` (already enforced at Zod layer; runtime double-check is defense-in-depth).

### Phase 8: UI — Invocation Detail + Timeline

#### Phase 8A — Tab dispatcher
- [ ] Update `src/app/admin/evolution/invocations/[invocationId]/InvocationDetailContent.tsx`:
  - Add `'evaluate_criteria_then_generate_from_previous_article'` to `TIMELINE_AGENTS`.
  - Extend `buildTabs(agentName, executionDetail)` to return 5 tabs for the new agent:
    ```
    'overview-evaluate-suggest' | 'overview-gfpa' | 'metrics' | 'timeline' | 'logs'
    ```
    (Single combined "Eval & Suggest" tab — both score table and suggestion blocks come from one LLM response and share cost/duration. UX clarity > forensic split.)
  - Tab dispatcher: `'overview-evaluate-suggest'` renders `ConfigDrivenDetailRenderer` with key-filter on `evaluateAndSuggest.*` + `weakestCriteriaIds` + `weakestCriteriaNames`; `'overview-gfpa'` filters on `generation.*` + `ranking.*` + `tactic`.
- [ ] Add data-testid attributes for E2E specs: `tab-overview-evaluate-suggest`, `tab-overview-gfpa`, `tab-metrics`, `tab-timeline`, `tab-logs`.

#### Phase 8B — `DETAIL_VIEW_CONFIGS` entries
- [ ] Add to `evolution/src/lib/core/detailViewConfigs.ts`:
  - `'evaluate_criteria_then_generate_from_previous_article'`: full union of evaluateAndSuggest + generation + ranking fields.
  - `'evaluate_and_suggest_only'` (sliced via keyFilter): `weakestCriteriaNames` (badge list), `evaluateAndSuggest.criteriaScored` (table), `evaluateAndSuggest.suggestions` (block list with Criterion/Example/Issue/Fix per block), `evaluateAndSuggest.droppedSuggestions` (collapsed-by-default forensic block), `evaluateAndSuggest.cost`, `evaluateAndSuggest.durationMs`.
- [ ] Add data-testids: `evaluate-criteria-scored`, `weakest-criteria-list`, `suggestions-entries-list`, `dropped-suggestions-list`.

#### Phase 8C — Timeline 3-phase bar
- [ ] Update `evolution/src/components/evolution/tabs/InvocationTimelineTab.tsx`:
  - Add color constant: `EVALUATE_AND_SUGGEST_COLOR = '#10b981'` (emerald). Single color for the combined phase.
  - Read `execution_detail.evaluateAndSuggest?.durationMs`.
  - Compute `phaseTotalMs` to include the new phase.
  - Render 3-phase bar: evaluate-and-suggest (emerald) → generation (blue) → ranking (purple). Comparison sub-bars inside ranking unchanged.
  - Historic-row fallback: if `evaluateAndSuggest.durationMs` missing, skip that segment (proportional-share fallback for very old rows).
- [ ] Add data-testid attribute: `timeline-evaluate-and-suggest-bar` (alongside existing `timeline-generation-bar`, `timeline-ranking-bar`).
- [ ] The bar's `aria-label` includes phase name + duration (e.g., "Eval & Suggest 5.6s").

#### Phase 8D — `InvocationParentBlock`
- [ ] Widen agent-name gate to include `'evaluate_criteria_then_generate_from_previous_article'` so the GFPA Overview tab shows parent variant + ELO delta + diff (same as reflection).

### Phase 9: Strategy Wizard

#### Phase 9A — Schema-side preconditions
- [ ] Verify Phase 2A is complete (agentType enum + iterationConfigSchema refinements). Wizard implementation depends on it.

#### Phase 9B — `IterationRow` interface + state
- [ ] Update `IterationRow` interface in `src/app/admin/evolution/strategies/new/page.tsx` (lines 34-49):
  ```typescript
  agentType: 'generate' | 'reflect_and_generate' | 'criteria_and_generate' | 'swiss';
  // existing fields...
  criteriaIds?: string[];
  weakestK?: number;
  ```
- [ ] Update agentType `<select>` (line 848): add `<option value="criteria_and_generate">Evaluate Criteria + Generate</option>`.
- [ ] Update `updateIteration` mutual-exclusivity logic (lines 415-455):
  - When agentType changes to `criteria_and_generate`: clear `tacticGuidance`, `reflectionTopN`. Initialize `criteriaIds: []`, `weakestK: 1`. Reset `sourceMode: 'seed'`.
  - When agentType changes away from `criteria_and_generate`: clear `criteriaIds`, `weakestK`.

#### Phase 9C — Criteria multi-select control
- [ ] Create `src/app/admin/evolution/strategies/new/CriteriaMultiSelect.tsx`:
  - Props: `selected: string[]`, `onChange: (ids: string[]) => void`.
  - Server-side fetch via `listCriteriaAction({ status: 'active', filterTestContent: true })` (call from a server-component wrapper or `useEffect`).
  - Render as a popover button trigger (mirrors `TacticGuidanceEditor` button at line 943) showing "Criteria: 3 selected" or chip summary.
  - Popover content: searchable checkbox list, "Select all" toggle, "Clear" button.
  - Empty-state: "No active criteria — Create one →" link to `/admin/evolution/criteria` (or inline-create dialog later — defer).
  - Renders only when `agentType === 'criteria_and_generate'`.
- [ ] Render `weakestK` number input next to the criteria multi-select, gated on the same agentType.
  - Static range: `min=1, max=5, default=1`.
  - **Dynamic upper bound**: when `criteriaIds.length < 5`, narrow the input's effective max to `criteriaIds.length` (clamp on selection-change). Prevents normal user submissions from triggering the runtime clamp. Mirrors the Zod cross-field refinement added in Phase 2A; the wizard validation also surfaces an inline error if the user tries to submit `weakestK > criteriaIds.length` (defense-in-depth alongside the schema check).
- [ ] Hide `TacticGuidanceEditor` button + `reflectionTopN` input + `sourceMode` controls when `agentType === 'criteria_and_generate'`.

#### Phase 9D — Payload conversion
- [ ] Update `toIterationConfigsPayload` (lines 99-120) to conditionally emit:
  ```typescript
  ...(it.agentType === 'criteria_and_generate' && it.criteriaIds && it.criteriaIds.length > 0
    ? { criteriaIds: it.criteriaIds }
    : {}),
  ...(it.agentType === 'criteria_and_generate' && it.weakestK
    ? { weakestK: it.weakestK }
    : {}),
  ```

#### Phase 9E — DispatchPlanView indicator
- [ ] Update `evolution/src/components/evolution/DispatchPlanView.tsx`:
  - Add inline sub-line under agentType badge when iteration is `criteria_and_generate`: `Criteria: ${entry.criteriaCount} | Weakest: ${entry.weakestK}`.
  - Add `criteriaCount?: number` and `weakestK?: number` to `IterationPlanEntryClient` (already added in Phase 3).

#### Phase 9F — Inline-create criteria dialog (optional, can defer to v2)
- [ ] If user feedback requests it, mirror the prompt-creation inline dialog from `ExperimentForm.tsx` lines 67-318. Out of scope for v1 if scope is tight.

### Phase 10: Documentation Updates

- [ ] `evolution/docs/agents/overview.md` — describe `EvaluateCriteriaThenGenerateFromPreviousArticleAgent`: 1-LLM-call flow (combined evaluate + suggest), custom error types, `customPrompt` GFPA override, `criteria_driven` static marker tactic (registered in `MARKER_TACTICS` for DB visibility but not in `ALL_SYSTEM_TACTICS` so `buildPromptForTactic` safely returns null), attribution dimension = primary weakest criteria name.
- [ ] `evolution/docs/architecture.md` — add to agent type table: third Shape A enum value alongside `generate` / `reflect_and_generate` / `swiss`. Update iteration loop diagram.
- [ ] `evolution/docs/strategies_and_experiments.md` — IterationConfig schema gains `criteriaIds + weakestK`. Strategy Tactics tab caveat: criteria-driven iterations contribute to attribution dimension `<weakest_name>`, not tactic name.
- [ ] `evolution/docs/data_model.md` — new `evolution_criteria` table schema (incl. `evaluation_guidance JSONB` rubric column with anchor-validation refinement); new columns on `evolution_variants` (`criteria_set_used`, `weakest_criteria_ids`); new metric_name entries; extended `entity_type` CHECK constraint.
- [ ] `evolution/docs/metrics.md` — new `evaluation_cost` cost metric; new `criteria` entity type with 5 criteria-level metrics.
- [ ] `evolution/docs/cost_optimization.md` — single `evaluate_and_suggest` typed agent label; `OUTPUT_TOKEN_ESTIMATES.evaluate_and_suggest = 2300` entry.
- [ ] `evolution/docs/visualization.md` — new `/admin/evolution/criteria` leaderboard page; new criteria detail tabs (Overview shows rubric / Metrics / Variants / Runs / By Prompt); RubricEditor component; strategy wizard's criteria multi-select; invocation detail 5-tab layout for `evaluate_criteria_then_generate_from_previous_article`; Timeline 3-phase bar with combined `evaluate_and_suggest` emerald color.
- [ ] `evolution/docs/entities.md` — new Criteria entity row; metric registry sync between `CriteriaEntity.metrics` and `METRIC_REGISTRY['criteria']`.
- [ ] `evolution/docs/reference.md` — new file index entries for `criteriaActions.ts`, `evaluateCriteriaThenGenerateFromPreviousArticle.ts`, `CriteriaEntity.ts`, `CriteriaMultiSelect.tsx`, `seedSampleCriteria.ts`. Add a "Sample criteria seed" subsection documenting the 7 starter criteria (names + ranges) and the run-once instruction. Update env-vars table (no new env var per Decision 4 — note rollback is via code revert).
- [ ] `evolution/docs/curriculum.md` — add Criteria to glossary; mention the new agent in Week 2.
- [ ] `docs/feature_deep_dives/multi_iteration_strategies.md` — refresh to mention the third agentType option.

## Testing

### Unit Tests

#### Schema + entity layer
- [ ] `evolution/src/lib/schemas.test.ts` — extend with refinement matrix:
  - `criteriaIds` only valid when `agentType === 'criteria_and_generate'`.
  - `criteriaIds` non-empty when present.
  - `criteriaIds` mutually exclusive with `generationGuidance`.
  - `weakestK` only valid when `agentType === 'criteria_and_generate'`; range 1-5.
  - **Cross-field**: `weakestK > criteriaIds.length` is rejected with the specified error message containing both numbers (e.g., test fixture with 2 criteria + weakestK=5 produces error `"weakestK (5) cannot exceed the number of selected criteria (2)"`).
  - `evolutionCriteriaInsertSchema.refine`: `max_rating > min_rating`.
  - `evolutionCriteriaInsertSchema.refine`: every rubric anchor's `score` ∈ `[min_rating, max_rating]` (rejects with clear message when out of range).
  - `evolutionCriteriaInsertSchema`: `evaluation_guidance` optional + nullable; null + undefined + empty array all accepted as "no rubric"; populated array round-trips correctly.
  - Variant schema accepts new optional `criteria_set_used` / `weakest_criteria_ids` arrays.
  - `evaluateCriteriaThenGenerateFromPreviousArticleExecutionDetailSchema` validates a representative fixture.
- [ ] `evolution/src/lib/pipeline/setup/findOrCreateStrategy.test.ts` — extend hash regression suite per Phase 2B.
- [ ] `evolution/src/lib/core/entities/CriteriaEntity.test.ts` (new) — assert 5 metrics registered with correct `listView` flags; insertSchema present; actions = rename/edit/delete; detailTabs match Tactic.

#### Agent layer
- [ ] `evolution/src/lib/core/agents/evaluateCriteriaThenGenerateFromPreviousArticle.test.ts` (new):
  - `buildEvaluateAndSuggestPrompt` snapshot tests:
    - 3 criteria, no rubrics, weakestK=1 → omits all Rubric: blocks; ask section instructs scoring + 1-suggestion-set.
    - 3 criteria with rubrics + weakestK=2 → includes Rubric: lines sorted by score asc; ask instructs 2-suggestion-sets.
    - mixed-rubric fixture: some criteria have rubric, others don't — only the ones with rubric get the Rubric: block.
  - `parseEvaluateAndSuggest` (combined parser):
    - Happy path: full response with score lines + 2 valid suggestion blocks → returns populated `criteriaScored` + `suggestions`.
    - Score section only (no `### Suggestion`): throws `EvaluateAndSuggestParseError` (suggestions zero-valid).
    - LLM-vs-wrapper disagreement: LLM writes suggestions for non-weakest criteria → those land in `droppedSuggestions`, not `suggestions`. Wrapper-determined weakest unaffected.
    - Complete LLM-vs-wrapper miss (zero overlap): all suggestions in `droppedSuggestions`, `suggestions` empty → throws.
    - Score-section parse fail: throws `EvaluateAndSuggestParseError` BEFORE attempting suggestions parse (regression: ensures we don't waste cycles on the second pass).
    - Drop-unknowns + drop-out-of-range scores work as before.
  - `getAttributionDimension(detail)` returns first weakest name; null when array empty.
  - Custom error types: `EvaluateAndSuggestLLMError` (no rawResponse), `EvaluateAndSuggestParseError` (rawResponse field present).
  - Execute: happy path with mock LLM (2 calls total: combined→GFPA inner) — verify single `AgentCostScope`, totalCost = combinedCost + gfpaCost (no separate eval/suggest split), partial detail preserved on each error path (3 paths: combined LLM throw, combined parser throw, inner GFPA throw).
  - LOAD-BEARING comment present at inner-`.execute()` site.
- [ ] `evolution/src/lib/metrics/attributionExtractors.test.ts` — extend to cover the new agent: extractor registered after barrel import; returns first weakest name; rejects names containing `:`.

#### GFPA refactor
- [ ] `evolution/src/lib/core/agents/generateFromPreviousArticle.test.ts` — extend:
  - `customPrompt` override path: when set, `buildPromptForTactic` is bypassed; prompt contains override.preamble + instructions; FORMAT_RULES still appended.
  - `criteriaSetUsed` + `weakestCriteriaIds` propagate from input → `Variant`.
  - Vanilla path (no `customPrompt`) unchanged.

#### Cost stack
- [ ] `evolution/src/lib/pipeline/infra/estimateCosts.test.ts` — extend:
  - `estimateEvaluateAndSuggestCost` returns expected USD given fixture (input scales with criteriaCount × avgRubricChars; output scales with criteriaCount + weakestK × 800).
  - `estimateAgentCost` with `useCriteria=true` adds the combined cost to the total.
- [ ] `evolution/src/lib/pipeline/loop/projectDispatchPlan.test.ts` — extend:
  - `weightedAgentCost` with `useCriteria=true` produces `evaluation` field on `EstPerAgentValue`.
  - `projectDispatchPlan` for a `criteria_and_generate` iteration projects expected dispatch count.

#### Server actions
- [ ] `evolution/src/lib/core/tactics/index.test.ts` — extend (or create):
  - `getTacticDef('criteria_driven')` returns `undefined` (defense-in-depth — keeps vanilla-GFPA's `buildPromptForTactic` early-exit working).
  - `MARKER_TACTICS` array length === 1; entry has `name='criteria_driven'`, `label='Criteria-Driven'`, `agent_type='evaluate_criteria_then_generate_from_previous_article'`, `category='meta'`.
  - `TACTIC_PALETTE['criteria_driven']` is defined and is a valid hex color.
- [ ] `evolution/scripts/syncSystemTactics.test.ts` — extend if it exists; otherwise add coverage in `tactics/index.test.ts`:
  - Sync upserts `ALL_SYSTEM_TACTICS` + `MARKER_TACTICS` rows. Mock the Supabase client; assert one upsert call per tactic+marker (24 system + 1 marker = 25 upserts at the time of writing).
- [ ] `evolution/scripts/seedSampleCriteria.test.ts` (new):
  - All 7 sample criteria pass `evolutionCriteriaInsertSchema.parse()` (catches typos in the inline data structure at test time).
  - Every anchor's `score` is within `[min_rating, max_rating]` for its parent criterion.
  - `--dry-run` flag prevents any DB write.
  - Re-running after success inserts 0 rows (idempotency check).
  - `SAMPLE_CRITERIA` array length === 7 (regression: prevents accidentally dropping or duplicating entries).
- [ ] `evolution/src/services/criteriaActions.test.ts` (new):
  - `listCriteriaAction` filters by status + name + test-content; attaches metric rows.
  - `createCriteriaAction` Zod-validates and inserts; rejects `evaluation_guidance` with out-of-range anchor; accepts null/undefined/empty rubric.
  - `updateCriteriaAction` partial-updates; updating `min_rating`/`max_rating` to a new range that excludes existing anchors throws (forces user to fix rubric first).
  - `archiveCriteriaAction` flips status + archived_at.
  - `deleteCriteriaAction` (or soft-delete).
  - `getCriteriaForEvaluation(db, ids)` returns Map with `evaluation_guidance` field populated; null when no rubric set.
  - `validateCriteriaIds` throws on missing/archived.

#### Metric computation
- [ ] `evolution/src/lib/metrics/computations/criteriaMetrics.test.ts` (new):
  - `computeCriteriaMetricsForRun` aggregates 5 metrics correctly from seeded variants.
  - Stale-cascade: when a variant's `mu`/`sigma` changes, criteria metrics flip to `stale=true`.

#### UI components
- [ ] `evolution/src/components/evolution/tabs/InvocationTimelineTab.test.tsx` — extend: 3-phase bar renders with single new `EVALUATE_AND_SUGGEST_COLOR` (emerald) plus existing GENERATION + RANKING colors; historic-row fallback skips missing phase when `evaluateAndSuggest.durationMs` is absent.
- [ ] `src/app/admin/evolution/strategies/new/CriteriaMultiSelect.test.tsx` (new) — popover opens; search filters; select-all toggles; renders only when agentType matches.
- [ ] `src/app/admin/evolution/criteria/RubricEditor.test.tsx` (new):
  - Empty state renders "No rubric defined" placeholder.
  - `[+ Add anchor]` appends a row; `✕` removes a specific row.
  - Score input validates against `[minRating, maxRating]` props; out-of-range scores flag red border.
  - Description input enforces max 500 chars.
  - Anchors sorted by score asc on render (regardless of insertion order).
  - `onChange` fires with cleaned-up array (removes empty-description rows on submit).

### Integration Tests

**Test discovery requirement** (verified against `jest.integration.config.js:31-34` testMatch + `package.json:31` `test:integration:evolution` regex `evolution-|arena-actions|manual-experiment|strategy-resolution`): all integration test files MUST live under `evolution/src/__tests__/integration/` AND have filenames matching the `evolution-` prefix to be picked up by `npm run test:integration:evolution`. Colocated `*.integration.test.ts` outside that directory are silently routed to the unit runner.

- [ ] `evolution/src/__tests__/integration/evolution-criteria-pipeline.integration.test.ts` (new):
  - Seed: 3 criteria + a strategy with one `criteria_and_generate` iteration referencing all 3 + `weakestK: 2`.
  - Run a full pipeline (mock LLM with deterministic responses) end-to-end.
  - Assert: variants persisted with `criteria_set_used = [3 ids]` and `weakest_criteria_ids = [2 ids]`; `execution_detail` validates against schema; `evolution_metrics` rows for `entity_type='criteria'` populated for all 3 criteria with correct `frequency_as_weakest`, `total_variants_focused`, `avg_score`, `avg_elo_delta_when_focused`.
- [ ] `evolution/src/__tests__/integration/evolution-criteria-schema-validation.integration.test.ts` (new): seed an invocation with the new execution_detail variant; round-trip through Zod validation; assert no schema-loss.
- [ ] `evolution/src/__tests__/integration/evolution-criteria-strategy-hash.integration.test.ts` (new): legacy strategy hash unchanged after migration; `criteria_and_generate` strategy stored with `criteriaIds + weakestK` in canonical hash; **`criteriaIds` UUID order is canonicalized via sort** (per Phase 2B Decision) — assert that `[a,b,c]` and `[c,b,a]` produce the same `config_hash` row when upserted.
- [ ] `evolution/src/__tests__/integration/evolution-criteria-actions.integration.test.ts` (new): full CRUD round-trip against real DB; validate is_test_content auto-classification on insert; round-trip a populated `evaluation_guidance` JSONB through INSERT → SELECT and assert byte-equal; verify the DB-level `evolution_criteria_rubric_anchors_in_range` CHECK constraint rejects an INSERT with an anchor score outside `[min_rating, max_rating]`; verify the `name ~ '^[A-Za-z][a-zA-Z0-9_-]{0,128}$'` CHECK rejects names with `:` / newlines / control chars.
- [ ] `evolution/src/__tests__/integration/evolution-variant-criteria-roundtrip.integration.test.ts` (new): in-memory `Variant` with `criteriaSetUsed: [...]`, `weakestCriteriaIds: [...]` → INSERT → SELECT → schema parser produces same field values back. Asserts the camelCase ↔ snake_case naming convention boundary is correct in `persistRunResults.ts`.

### E2E Tests (under `src/__tests__/e2e/specs/09-admin/`)

**Tag requirement**: every new spec MUST be annotated with `@evolution @critical` tags via Playwright's `test.describe.configure({ tag: ['@evolution', '@critical'] })` block (matching `admin-evolution-strategy-effectiveness-chart.spec.ts:9`). Without `@evolution`, the spec runs only via `test:e2e:non-evolution` (which excludes `@evolution`), and per `.github/workflows/ci.yml:443-507`, evolution-only-path PRs run `e2e-evolution` (grep `@evolution`) but skip `e2e-non-evolution` — net result: untagged specs DON'T RUN in PRs that touch only evolution files.

- [ ] `admin-evolution-criteria-leaderboard.spec.ts` (new, tagged `@evolution @critical`): visit `/admin/evolution/criteria`; assert metric columns render; sort by `avg_elo_delta_when_focused` desc; click a criteria → lands on detail page.
- [ ] `admin-evolution-criteria-pipeline.spec.ts` (new, tagged `@evolution @critical`): create 3 criteria via admin UI → create a strategy with `criteria_and_generate` iteration → run an experiment via UI → wait for completion → open invocation detail → assert 5 tabs render → assert Timeline shows 3-phase bar (single emerald `evaluate-and-suggest` segment + existing blue generation + purple ranking) → assert Eval & Suggest tab shows both criteriaScored table AND suggestions list in the same view.
- [ ] `admin-evolution-criteria-wizard.spec.ts` (new, tagged `@evolution @critical`): open strategy wizard → set agentType to `criteria_and_generate` → assert tactic-guidance hidden, reflectionTopN hidden, criteria multi-select visible, weakestK input visible → select 3 criteria → submit; verify created strategy has correct payload. **Plus dynamic-clamp sub-test**: select only 2 criteria → assert weakestK input's effective `max` attribute === `2` (per Phase 9C) AND attempting to type `5` either clamps to `2` or surfaces the inline submit-time error from the Zod cross-field refinement.
- [ ] `admin-evolution-criteria-rubric-editor.spec.ts` (new, tagged `@evolution @critical`): open Edit Criteria dialog for a seeded criteria → expand rubric editor → add anchor at score 3 with description → save → reload page → verify anchor persisted; attempt to change max_rating from 10 to 5 with anchors at 8 and 10 still present → expect save-error toast listing the out-of-range anchors.
- [ ] Regression: existing `admin-evolution-strategy-effectiveness-chart.spec.ts` still passes; bar labels include `evaluate_criteria_then_generate_from_previous_article / <criteria_name>` rows when criteria-driven runs are present.

### Manual Verification

- [ ] Run the seed script in dry-run first against staging:
  ```
  NEXT_PUBLIC_SUPABASE_URL=$STAGING_URL SUPABASE_SERVICE_ROLE_KEY=$STAGING_KEY \
    npx tsx evolution/scripts/seedSampleCriteria.ts --dry-run
  ```
  Verify it lists the 7 expected criteria. Then run without `--dry-run`; assert all 7 inserted (or skipped if re-run). Sanity-check the rows in the admin UI.
- [ ] Open `/admin/evolution/criteria`: leaderboard shows the 7 seeded criteria (or however many — researcher may have added more); click "New Criteria"; create one custom real-world criteria.
- [ ] Edit one of the criteria via the rubric editor; add/remove anchors; change min/max range and verify out-of-range anchors block the save with a clear error.
- [ ] Open strategy wizard: configure a 3-iteration strategy with iter 2 = `criteria_and_generate` referencing the new criteria + `weakestK: 1`. Confirm dispatch preview shows criteria badge.
- [ ] Run the strategy via experiment wizard. Watch run detail page Timeline tab: iteration 2 shows new agent type.
- [ ] Open one of iter 2's invocations: 5 tabs visible; Eval & Suggest tab shows BOTH criteria-scored table AND structured suggestion blocks (sourced from a single LLM response); Timeline 3-phase bar renders correctly with single emerald evaluate-and-suggest segment + blue generation + purple ranking.
- [ ] Lineage graph: criteria-driven variants render with the new indigo `'criteria_driven'` palette color.
- [ ] Open a criteria detail page: Variants tab shows all variants where this criteria was in `weakest_criteria_ids`; By Prompt tab aggregates per prompt.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] `admin-evolution-criteria-leaderboard.spec.ts` passes locally and in CI.
- [ ] `admin-evolution-criteria-pipeline.spec.ts` passes — full end-to-end UI flow.
- [ ] `admin-evolution-criteria-wizard.spec.ts` passes.
- [ ] Regression: `admin-evolution-strategy-effectiveness-chart.spec.ts`, `admin-arena.spec.ts`, `admin-evolution-experiment-wizard-e2e.spec.ts` still pass.

### B) Automated Tests
- [ ] `npm run test:unit` — all pass (extended unit suites + new agent test + entity test + metric computation test).
- [ ] `npm run test:integration:evolution -- --testPathPattern="evolution-criteria-(pipeline|schema-validation|strategy-hash|actions)|evolution-variant-criteria-roundtrip"` — all pass. (Pattern matches the new files placed under `evolution/src/__tests__/integration/` per the testMatch glob.)
- [ ] `npm run test:integration:evolution` — all evolution-tier integration tests pass.
- [ ] `npm run test:esm` — no regressions from shared-helper changes.
- [ ] `npm run lint && npm run tsc && npm run build` — clean.
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-criteria-*.spec.ts` — 3 new specs pass.

### C) Staging Validation Gate
- [ ] Deploy branch to staging (Vercel preview).
- [ ] Trigger 2-3 real evolution runs via admin UI on `criteria_and_generate` strategies.
- [ ] Confirm with specific verifiable assertions:
  - (a) Zero rows in `evolution_logs` with `level='error'` AND `agent_name='evaluate_criteria_then_generate_from_previous_article'`.
  - (b) `evolution_metrics WHERE entity_type='criteria' AND name IN ('avg_score','frequency_as_weakest','total_variants_focused','avg_elo_delta_when_focused','run_count')` populated for each seeded criteria with non-NULL value.
  - (c) Every variant from a `criteria_and_generate` iteration has non-NULL `criteria_set_used` (length === count of criteria active at run time, ≤ `iterCfg.criteriaIds.length`) AND non-NULL `weakest_criteria_ids` (length === `min(iterCfg.weakestK, criteria_set_used.length)` — accommodates the runtime clamp from Phase 7 when criteria were archived between strategy creation and run execution).
  - (d) Invocation detail UI renders all **5 tabs** (Eval & Suggest / Generation / Metrics / Timeline / Logs); Timeline 3-phase bar visible with single emerald segment; no console errors.
- [ ] Open PR only after staging validation passes.

### D) Rollback Plan
- [ ] No env-var kill-switch (per Decision 4). Rollback path is `git revert <merge_sha>` followed by re-deploy. Acceptable since `criteria_and_generate` is opt-in and has zero existing strategies in production at merge time.
- [ ] **In-flight runs — drain procedure (required before revert)**:
  1. Stop the systemd timer for the batch runner: `sudo systemctl stop evolution-runner.timer` on the minicomputer.
  2. Disable Vercel cron entry for `/api/evolution/run` if active.
  3. Wait for any currently-claimed runs to finish (max ~10 min per the stale-heartbeat watchdog window). Confirm via SQL: `SELECT count(*) FROM evolution_runs WHERE status IN ('claimed','running')` returns 0.
  4. Execute `git revert <merge_sha>` and redeploy.
  5. Re-enable the runner: `sudo systemctl start evolution-runner.timer`.
  6. Any pending runs whose strategies use `agentType: 'criteria_and_generate'` will fail at iteration entry (the orchestrator can't dispatch the unknown agent type) — `cancel_experiment` or admin-update those runs to `cancelled`.
- [ ] **Orphaned-invocation cleanup**: post-revert, run a one-off SQL cleanup to mark any `evolution_agent_invocations` rows with `agent_name='evaluate_criteria_then_generate_from_previous_article'` AND `success IS NULL` as failed: `UPDATE evolution_agent_invocations SET success=false, error_message='Agent removed during rollback' WHERE agent_name='evaluate_criteria_then_generate_from_previous_article' AND success IS NULL;`. This prevents stuck rows from blocking dashboards.
- [ ] DB migration rollback: `evolution_criteria` table can be dropped (no FKs depend on it). New columns on `evolution_variants` (`criteria_set_used`, `weakest_criteria_ids`) are nullable; can be left in place after revert with no impact (or dropped if desired — destructive DDL guard requires explicit allowlist).
- [ ] Compensating migrations script (if needed): kept in this project folder, not auto-run.

## Documentation Updates

(See Phase 10 above for the full list — all 10 evolution doc files plus 1 feature deep dive.)

## Review & Discussion

_Populated by `/plan-review` with agent scores, reasoning, and gap resolutions._
