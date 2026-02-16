# More Intuitive Evolution Dashboard Research

## Problem Statement
Explore ways to make the evolution dashboard more intuitive and easy to analyze. It should always be possible to deep dive and be cross-linked from run to agent to article involved, etc. This is of paramount importance.

## Requirements (from GH Issue #437)
Explore ways to make the evolution dashboard more intuitive and easy to analyze. It should always be possible to deep dive and be cross-linked from run to agent to article involved, etc. This is of paramount importance.

## High Level Summary

The evolution dashboard spans **12 pages** with **7 run detail tabs**, **12 agent detail views**, and **56 server actions**. Cross-linking between entities is **partial**: runs are well-connected to their detail pages, and Timeline→Logs navigation works. However, **variant IDs are displayed in 10+ locations but are never clickable**, explanation IDs are orphaned (shown but not linked), and navigation is predominantly one-directional (inbound drill-down, no outbound exploration).

The data model fully supports cross-linking via foreign keys (run↔prompt, run↔strategy, run↔explanation, variant↔parent, HoF entry↔run/variant), but the UI does not surface most of these relationships as navigable links.

---

## Detailed Findings

### 1. Page Inventory (12 Pages)

| # | Route | Purpose |
|---|-------|---------|
| 1 | `/admin/evolution-dashboard` | Overview: quick links, run/spend charts, recent runs table |
| 2 | `/admin/quality/evolution` | Pipeline runs: queue runs, start card, batch dispatch, runs table |
| 3 | `/admin/quality/evolution/run/[runId]` | Run detail: 7-tab deep dive (Timeline, Elo, Lineage, Tree, Budget, Variants, Logs) |
| 4 | `/admin/quality/evolution/run/[runId]/compare` | Before/after text diff + stats summary |
| 5 | `/admin/quality/hall-of-fame` | Topic list: cross-topic summary, prompt bank coverage grid |
| 6 | `/admin/quality/hall-of-fame/[topicId]` | Topic detail: 4-tab (Leaderboard, Cost vs Elo, Match History, Compare Text) |
| 7 | `/admin/quality/explorer` | Dimensional explorer: table/matrix/trend views with multi-select filters |
| 8 | `/admin/quality/optimization` | Elo optimization: strategy/agent/cost analysis + cost accuracy |
| 9 | `/admin/quality/prompts` | Prompt registry: CRUD for prompt topics |
| 10 | `/admin/quality/strategies` | Strategy registry: CRUD with version-on-edit, clone, presets |
| 11 | `/admin/quality/page` | Content quality: article scores + eval runs |
| 12 | `/admin` | Admin dashboard: system health, stats, quick links |

### 2. Navigation / Sidebar

`EvolutionSidebar.tsx` provides 7 nav items:
- Overview → `/admin/evolution-dashboard`
- Explorer → `/admin/quality/explorer`
- Elo Optimization → `/admin/quality/optimization`
- Start Pipeline → `/admin/quality/evolution`
- Prompts → `/admin/quality/prompts`
- Strategies → `/admin/quality/strategies`
- Hall of Fame → `/admin/quality/hall-of-fame`

### 3. Cross-Linking Status

#### Working Cross-Links (✅)

| From | To | Mechanism |
|------|----|-----------|
| Run table row (all 3 tables) | Run detail page | Click row or Run ID link |
| Run detail | Compare page | "Compare" button |
| Run detail | Hall of Fame topic | "Add to Hall of Fame" dialog → navigate |
| HoF entry (evolution) | Run detail | "↗ Run" link on leaderboard row |
| HoF entry (evolution) | Compare page | "↗ Compare" link |
| Timeline agent row | Logs tab (filtered) | `?tab=logs&iteration=N&agent=X` |
| Timeline iteration | Logs tab (filtered) | `?tab=logs&iteration=N` |
| Explorer task row | Run detail Timeline tab | `?tab=timeline&agent=X` |
| Strategy badge (run detail) | Strategies page | Link to `/admin/quality/strategies` |
| Lineage graph node | Variant card (side panel) | D3 click handler |

#### Missing Cross-Links (❌)

| From | To | Gap |
|------|----|-----|
| Run detail header | Explanation/article page | `explanation_id` shown as "#N", **not clickable** |
| Run detail | Prompt detail | No link to prompt registry |
| Run detail strategy badge | Strategy detail | Links to list page, not specific strategy |
| Variant IDs (everywhere) | Variant detail | **Displayed in 10+ locations, never clickable** |
| Agent detail views | Created variants | Variant IDs shown via ShortId, not clickable |
| Prompt registry | Runs using prompt | No reverse navigation |
| Strategy registry | Runs using strategy | No reverse navigation |
| HoF entry metadata | Explanation page | `explanation_id` in metadata, not linked |
| Explorer article HoF rank | HoF detail | Shown as "#N", not clickable |

### 4. Entity ID Clickability Matrix

| Entity | Where Shown | Clickable? | Destination |
|--------|------------|-----------|-------------|
| Run ID | Dashboard/Evolution/Explorer tables | ✅ | Run detail page |
| Run ID | Run detail header | Copy only | Clipboard |
| Explanation ID | Dashboard table | ✅ | Run detail (not explanation) |
| Explanation ID | Evolution runs table | ❌ | — |
| Explanation ID | Run detail header | ❌ | — |
| Variant ID | Variants tab, Timeline, Agent details, Lineage, Elo changes | ❌ | — |
| Agent name | Explorer task table | ✅ | Run detail with timeline filter |
| Agent name | Logs tab entries | ✅ (filter) | Sets filter in LogsTab |
| Strategy label | Run detail badge | ✅ | Strategies list (not detail) |
| HoF rank | Explorer article table | ❌ | — |

### 5. Run Detail Tabs (7 Tabs)

| Tab | Key Content | Cross-Links Available |
|-----|-------------|----------------------|
| **Timeline** | Iteration-by-iteration agents, metrics, expandable execution detail | ✅ Links to Logs (per agent/iteration). ❌ Variant IDs not clickable |
| **Elo** | Rating trajectory chart, top-N filter | ❌ Variant IDs in tooltips not clickable |
| **Lineage** | D3 DAG with zoom/pan, node click→side panel | ❌ Node click shows VariantCard but no navigation |
| **Tree** | Beam search tree, node detail panel | ❌ Node IDs not clickable |
| **Budget** | Cost burn chart, agent breakdown, estimate vs actual | No entity links (data-only) |
| **Variants** | Sortable table, expandable text, sparklines, step scores | ❌ Variant IDs not clickable. ✅ "Full Compare" link |
| **Logs** | Filterable log viewer, auto-scroll | ✅ Agent/iteration filter chips. Pre-populated via URL params |

### 6. Agent Execution Detail Views (12 Types)

All 12 agent detail views use `ShortId` component (8-char truncated ID, full ID in title attribute). **None of the ShortId instances are clickable links.**

| Detail Type | Entity IDs Shown | Clickable? |
|-------------|-----------------|-----------|
| generation | Per-strategy variant IDs | ❌ |
| outlineGeneration | Step scores, variant ID | ❌ |
| calibration | Match pairs (variant IDs) | ❌ |
| tournament | Round pairs (variant IDs) | ❌ |
| evolution | Parent IDs, mutation variant IDs | ❌ |
| reflection | Critiqued variant IDs, dimension scores | ❌ |
| iterativeEditing | Edit rounds, variant IDs | ❌ |
| sectionDecomposition | Section edits, variant ID | ❌ |
| debate | Variant A/B IDs, synthesis variant ID | ❌ |
| proximity | Diversity metrics (no IDs) | — |
| metaReview | Strategy rankings (no variant IDs) | — |
| treeSearch | Root/best leaf variant IDs | ❌ |

### 7. Server Action Data Availability

**56 total server actions** across 6 files. The data model supports full cross-referencing:

**Given a Run ID, the server can return:**
- Run metadata with `explanation_id`, `prompt_id`, `strategy_config_id`
- All variants with parent lineage (`parent_variant_id`)
- Timeline with per-agent `newVariantIds[]`
- Elo history per variant
- Lineage graph (nodes + edges)
- Budget breakdown per agent
- Agent invocation details
- Logs filtered by agent/iteration/variant

**Given an Explanation ID:**
- All runs for that article
- Content change history with `evolution_run_id`

**Given a Strategy/Prompt ID:**
- Strategy/prompt detail
- (No action to fetch runs-by-strategy or runs-by-prompt directly)

### 8. Database Foreign Key Relationships

```
content_evolution_runs
  ├─ explanation_id → explanations.id (nullable)
  ├─ prompt_id → hall_of_fame_topics.id (nullable)
  └─ strategy_config_id → strategy_configs.id (nullable)

content_evolution_variants
  ├─ run_id → content_evolution_runs.id
  ├─ explanation_id → explanations.id
  └─ parent_variant_id → content_evolution_variants.id (self-join)

evolution_agent_invocations
  └─ run_id → content_evolution_runs.id

hall_of_fame_entries
  ├─ topic_id → hall_of_fame_topics.id
  ├─ evolution_run_id → content_evolution_runs.id (nullable)
  └─ evolution_variant_id → content_evolution_variants.id (nullable)
```

### 9. Auto-Refresh Behavior

| Component | Interval | Condition |
|-----------|----------|-----------|
| Dashboard overview | 15s | Always (pauses on tab hide) |
| Run detail metadata | 5s | Active runs only |
| BudgetTab | 5s | Active runs only |
| LogsTab | 5s + auto-scroll | Active runs only |
| ElapsedTime | 1s tick | Active runs only |

---

## Round 2: Deep Dive Findings

### 10. Variant Data Model (What a Detail View Could Show)

#### Database Schema (`content_evolution_variants`)

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `run_id` | UUID | FK to parent run |
| `explanation_id` | INT | FK to source article (nullable for prompt-based) |
| `variant_content` | TEXT | **Full text content** |
| `elo_score` | NUMERIC | Rating (0-3000, default 1200) |
| `generation` | INT | Mutation depth |
| `parent_variant_id` | UUID | FK to parent variant (self-join, nullable) |
| `agent_name` | TEXT | Strategy/agent that created it |
| `quality_scores` | JSONB | Dimension scores |
| `match_count` | INT | Pairwise comparisons played |
| `is_winner` | BOOLEAN | Top-rated variant flag |
| `created_at` | TIMESTAMP | Creation time |

#### In-Memory Representation (`TextVariation`)

```typescript
interface TextVariation {
  id: string;
  text: string;              // full content
  version: number;           // generation depth
  parentIds: string[];       // multi-parent support
  strategy: string;
  createdAt: number;
  iterationBorn: number;
  costUsd?: number;          // per-variant cost
}
```

#### Checkpoint State Per Variant

Beyond the DB/type fields, checkpoint state tracks:
- **Ratings**: OpenSkill mu/sigma per variant → mapped to Elo for display
- **Match history**: All pairwise comparisons with opponent, winner, confidence, dimension scores
- **Dimension scores**: Critique scores by dimension (clarity, depth, accuracy, etc.)
- **Full critiques**: `Critique` objects with dimension scores, good/bad examples, notes, reviewer
- **Debate transcripts**: variantAId, variantBId, synthesisVariantId
- **Similarity matrix**: Pairwise embedding distances
- **Tree search metadata**: treeDepth, revisionAction (if from TreeSearchAgent)

#### Outline Variant Extension

```typescript
interface OutlineVariant extends TextVariation {
  steps: GenerationStep[];          // per-step scoring
  outline: string;                  // intermediate outline
  weakestStep: GenerationStepName;  // cached for mutation targeting
}
```

### 11. Explanation Page & URL Pattern

**Canonical route**: `/results?explanation_id={id}`

- Located at `src/app/results/page.tsx` (client component)
- Full article viewer with: title, rich text editor, tags, sources, AI editing, quality scores
- No dedicated `/explanation/[id]` route exists
- No URL builder utility — all links are inline string templates

**Admin links use broken legacy pattern**: `/explanations?id={id}` (the `/explanations` page doesn't handle `id` param)

**Evolution dashboard** has `explanation_id` available on every run but never constructs a link to `/results?explanation_id={id}`.

### 12. Inline Expansion Patterns (Existing UI Precedents)

#### Explorer Article Detail (most complex)
- **Trigger**: Click row → `ArticleDetailPanel`
- **Shows**: full content (256px scroll), parent content (192px), lineage chain (up to 10 ancestors with agent names + content previews)
- **Lineage chain is NOT clickable** — display-only

#### Variants Tab Expansion
- **Trigger**: "View" button
- **Shows**: step scores (StepScoreBar), full text (256px scroll)
- **No parent content or lineage shown**

#### Hall of Fame Leaderboard Expansion
- **Trigger**: Click row
- **Shows**: article preview (collapsible >500 chars), model/cost/date
- **Evolution entries additionally show**: iterations, duration, stop reason, winning strategy, match stats, agent cost breakdown, strategy effectiveness, meta-feedback
- **Cross-links**: "Open Run Detail →" and "Compare →" links (✅ clickable)

#### Variant Panel Modal (Runs Page)
- **Trigger**: "Variants" button
- **Shows**: 700px overlay with variants table, preview/apply actions, cost breakdown chart
- **Preview**: raw text in pre block, 256px

#### Common Patterns
- Single `expandedId` state (string | null)
- Click same row toggles off
- 256px max-height for content, scrollable
- `var(--surface-elevated)` or `var(--surface-secondary)` backgrounds

### 13. Reverse Navigation Support

#### Database Indexes (all present ✅)
- `idx_evolution_runs_prompt` on `prompt_id`
- `idx_evolution_runs_strategy` on `strategy_config_id`
- `idx_evolution_runs_explorer` composite on `(prompt_id, pipeline_type, strategy_config_id)`
- `idx_variants_run_elo` on `(run_id, elo_score DESC)`

#### Action Gaps
- ❌ `getEvolutionRunsAction` does NOT accept `promptId` or `strategyId` as filters
- ✅ `getUnifiedExplorerAction` (Explorer) DOES support `promptIds[]` and `strategyIds[]` filters
- ❌ No dedicated "get runs by prompt" or "get runs by strategy" actions

#### Detail Page Gaps
- ❌ No `/admin/quality/prompts/[promptId]` route (only list page)
- ❌ No `/admin/quality/strategies/[strategyId]` route (only list page with expandable rows)
- Strategies expandable rows show: config JSON, performance stats, cost accuracy — but **no "runs using this strategy" list**
- Prompts page shows: title, prompt, difficulty, tags — but **no "runs using this prompt" list**

#### Explorer Limitations
- Filter state is local React state only — **no URL parameters**
- Cannot link directly to "Explorer filtered by strategy X"
- Would need URL-based filter state to enable cross-linking

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/evolution/visualization.md
- docs/evolution/README.md
- docs/evolution/data_model.md
- docs/evolution/rating_and_comparison.md
- docs/evolution/architecture.md
- docs/evolution/hall_of_fame.md

## Code Files Read
- src/components/admin/EvolutionSidebar.tsx
- src/components/admin/AdminSidebar.tsx
- src/app/admin/evolution-dashboard/page.tsx
- src/app/admin/quality/evolution/page.tsx
- src/app/admin/quality/evolution/run/[runId]/page.tsx
- src/app/admin/quality/evolution/run/[runId]/compare/page.tsx
- src/app/admin/quality/hall-of-fame/page.tsx
- src/app/admin/quality/hall-of-fame/[topicId]/page.tsx
- src/app/admin/quality/explorer/page.tsx
- src/app/admin/quality/optimization/page.tsx
- src/app/admin/quality/prompts/page.tsx
- src/app/admin/quality/strategies/page.tsx
- src/app/admin/quality/page.tsx
- src/app/admin/page.tsx
- src/components/evolution/tabs/TimelineTab.tsx
- src/components/evolution/tabs/VariantsTab.tsx
- src/components/evolution/tabs/EloTab.tsx
- src/components/evolution/tabs/LineageTab.tsx
- src/components/evolution/tabs/TreeTab.tsx
- src/components/evolution/tabs/BudgetTab.tsx
- src/components/evolution/tabs/LogsTab.tsx (inferred)
- src/components/evolution/VariantCard.tsx
- src/components/evolution/LineageGraph.tsx
- src/components/evolution/EloSparkline.tsx
- src/components/evolution/StepScoreBar.tsx
- src/components/evolution/PhaseIndicator.tsx
- src/components/evolution/EvolutionStatusBadge.tsx
- src/components/evolution/ElapsedTime.tsx
- src/components/evolution/AutoRefreshProvider.tsx
- src/components/evolution/agentDetails/AgentExecutionDetailView.tsx
- src/components/evolution/agentDetails/shared.tsx
- src/components/evolution/agentDetails/GenerationDetail.tsx
- src/components/evolution/agentDetails/TournamentDetail.tsx
- src/components/evolution/agentDetails/EvolutionDetail.tsx
- src/components/evolution/agentDetails/TreeSearchDetail.tsx
- src/components/evolution/agentDetails/DebateDetail.tsx
- src/components/evolution/agentDetails/ReflectionDetail.tsx
- src/lib/services/evolutionVisualizationActions.ts
- src/lib/services/evolutionActions.ts
- src/lib/services/hallOfFameActions.ts
- src/lib/services/promptRegistryActions.ts
- src/lib/services/strategyRegistryActions.ts
- src/lib/services/costAnalyticsActions.ts
- src/lib/services/unifiedExplorerActions.ts
- src/lib/evolution/types.ts
- src/lib/evolution/core/pipeline.ts
- src/app/results/page.tsx
- src/app/explanations/page.tsx
- supabase/migrations/ (evolution-related table definitions)
- supabase/migrations/20260207000002 (prompt_id FK + index)
- supabase/migrations/20260205000005 (strategy index)
- supabase/migrations/20260207000006 (explorer composite indexes)

---

## Round 3: Agent-Parallel Deep Dive

### 14. Variant ID Complete Location Inventory (24 Locations)

All variant IDs are displayed via `ShortId` component (`src/components/evolution/agentDetails/shared.tsx:53-54`) — an 8-char truncated span with monospace font, gold color, and full ID in `title` attribute. **None are clickable.**

| # | File | Line(s) | Context | Data Available | Ideal Target |
|---|------|---------|---------|----------------|-------------|
| 1 | `agentDetails/shared.tsx` | 53-54 | `ShortId` component definition | Full ID string | N/A (component) |
| 2 | `tabs/VariantsTab.tsx` | 140 | Variants table ID column | Full variant object | Variant detail panel |
| 3 | `tabs/VariantsTab.tsx` | 143 | Sparkline data lookup | Full variant object | Same as #2 |
| 4 | `tabs/TimelineTab.tsx` | 84-96 | Agent detail - New Variants badges | `newVariantIds[]` (string[]) | `?tab=variants&variant={id}` |
| 5 | `tabs/TreeTab.tsx` | 288 | Tree node detail panel | Full tree node object | `?tab=variants&variant={id}` |
| 6 | `agentDetails/GenerationDetail.tsx` | 21 | Strategy results table | `EvolutionVariant` data | Variant detail |
| 7 | `agentDetails/CalibrationDetail.tsx` | 15 | Match entrant row | `CalibrationExecutionDetail` | Variant detail |
| 8 | `agentDetails/TournamentDetail.tsx` | 29 | Round pair - variant A | `TournamentExecutionDetail` | Variant detail |
| 9 | `agentDetails/TournamentDetail.tsx` | 31 | Round pair - variant B | `TournamentExecutionDetail` | Variant detail |
| 10 | `agentDetails/EvolutionDetail.tsx` | 19 | Parent variants list | `EvolutionDetail` data | Variant detail |
| 11 | `agentDetails/EvolutionDetail.tsx` | 37 | Mutation results table | `EvolutionDetail` data | Variant detail |
| 12 | `agentDetails/ReflectionDetail.tsx` | 15 | Critiqued variants row | `ReflectionDetail` data | Variant detail |
| 13 | `agentDetails/IterativeEditingDetail.tsx` | 23 | Target variant header | `IterativeEditingDetail` | Variant detail |
| 14 | `agentDetails/IterativeEditingDetail.tsx` | 40 | Edit cycle result | `c.newVariantId` (nullable) | Variant detail |
| 15 | `agentDetails/SectionDecompositionDetail.tsx` | 11 | Target variant header | `SectionDecompositionDetail` | Variant detail |
| 16 | `agentDetails/SectionDecompositionDetail.tsx` | 41 | Improved metric display | `detail.newVariantId` (nullable) | Variant detail |
| 17 | `agentDetails/DebateDetail.tsx` | 12 | Debate variant A header | `DebateDetail` data | Variant detail |
| 18 | `agentDetails/DebateDetail.tsx` | 18 | Debate variant B header | `DebateDetail` data | Variant detail |
| 19 | `agentDetails/DebateDetail.tsx` | 58 | Synthesis result | `detail.synthesisVariantId` (nullable) | Variant detail |
| 20 | `agentDetails/TreeSearchDetail.tsx` | 11 | Root variant header | `TreeSearchDetail` data | Variant detail |
| 21 | `agentDetails/TreeSearchDetail.tsx` | 16 | Best leaf variant header | `TreeSearchDetail` data | Variant detail |
| 22 | `agentDetails/OutlineGenerationDetail.tsx` | 11 | Outline variant header | `OutlineGenerationDetail` | Variant detail |
| 23 | `VariantCard.tsx` | 50 | Card title display | `shortId` prop (8-char) | N/A (already in panel) |
| 24 | `LineageGraph.tsx` | 161-162 | Lineage detail panel (via VariantCard) | Full node data | Variant detail |

**Non-variant views** (no gap): `MetaReviewDetail.tsx` (aggregate metrics only), `ProximityDetail.tsx` (diversity stats only).

**EloTab.tsx:48** — Variant ID in Recharts tooltip (not clickable due to Recharts limitation).

#### ShortId Enhancement Path

Current implementation:
```typescript
// shared.tsx:53-54
export function ShortId({ id }: { id: string }): JSX.Element {
  return <span className="font-mono text-xs text-[var(--accent-gold)]" title={id}>{id.substring(0, 8)}</span>;
}
```

Could accept optional `onClick` or `href` + `runId` to become a clickable link. All 24 call sites have `runId` available in their component tree (passed from parent run detail page).

---

### 15. Explanation ID Complete Cross-Linking Analysis (11 Locations)

**Target URL**: `/results?explanation_id={id}` — already works end-to-end (used by ShareButton in results page).

| # | File | Line(s) | Current Display | Link Feasibility | Notes |
|---|------|---------|-----------------|------------------|-------|
| 1 | `evolution-dashboard/page.tsx` | 206-211 | `<Link>` to **run page** (not article) | ⚠️ Nested Link | Currently wraps `#{explanation_id}` in Link to run detail |
| 2 | `quality/evolution/page.tsx` | 867-874 | Plain `<span>` text `#{id}` | ✅ Easy | Replace span with Link |
| 3 | `quality/evolution/run/[runId]/page.tsx` | 241 | Heading text `Explanation #{id}` | ✅ Easy | Add link/button next to heading |
| 4 | `quality/hall-of-fame/[topicId]/page.tsx` | 457 | Plain text in dropdown | ⚠️ Complex | Inside dropdown menu context |
| 5 | `quality/evolution/page.tsx` | 549 | Plain text in modal header | ✅ Easy | Variants panel modal header |
| 6 | `quality/evolution/run/[runId]/page.tsx` | 54-59, 88 | Hidden (metadata only) | ⚠️ If shown | Stored but not rendered |

**Tabs (7-13)**: `explanation_id` is NOT passed as prop to any tab component. Tabs receive only `runId`. Would need prop threading or refetch.

#### Key Validation

- `/results?explanation_id={id}` works: parses param (line 773), validates as number (line 866), calls `loadExplanation()` (line 870)
- ShareButton already uses this pattern at `src/app/results/page.tsx`
- No centralized URL builder exists — all links are inline template literals
- `/explanations` page is a gallery browser, does NOT handle individual `?id=` params

---

### 16. Reverse Navigation: Server Actions & UI Gaps

#### Prompt Registry (`src/lib/services/promptRegistryActions.ts`)

**Available actions**: `getPromptsAction`, `createPromptAction`, `updatePromptAction`, `archivePromptAction`, `deletePromptAction`, `resolvePromptByText`

**Key finding**: `deletePromptAction` (lines 220-224) already queries `content_evolution_runs` by `prompt_id` internally to guard against deleting prompts with associated runs — but this result is not exposed as a reusable action.

**UI** (`src/app/admin/quality/prompts/page.tsx`):
- Simple table: Title, Prompt text (truncated), Difficulty, Domain tags, Status, Created date, Actions
- No expandable rows, no detail view
- No reverse navigation to runs

#### Strategy Registry (`src/lib/services/strategyRegistryActions.ts`)

**Available actions**: `getStrategiesAction`, `getStrategyDetailAction`, `createStrategyAction`, `updateStrategyAction`, `cloneStrategyAction`, `archiveStrategyAction`, `deleteStrategyAction`, `getStrategyPresetsAction`

**UI** (`src/app/admin/quality/strategies/page.tsx`):
- Table with: Name, Label, Pipeline type, Runs (count), Avg Elo, Elo/Dollar, Status, Actions
- **Has expandable rows** (lines 545-596 `StrategyDetailRow`): config JSON, performance stats, cost accuracy
- Shows `run_count` as aggregate number but **no list of individual runs**

#### Explorer URL State (`src/app/admin/quality/explorer/page.tsx`)

**Filter state** (lines 400-420): Pure React state — `useState` for `promptFilter`, `strategyFilter`, `pipelineFilter`, `datePreset`, `dateFrom`, `dateTo`. No `useSearchParams()`.

**Filter types supported by server** (`ExplorerFilters` in `unifiedExplorerActions.ts:16-29`):
```typescript
interface ExplorerFilters {
  promptIds?: string[];
  strategyIds?: string[];
  pipelineTypes?: PipelineType[];
  agentNames?: string[];
  runIds?: string[];
  variantIds?: string[];
  difficultyTiers?: string[];
  domainTags?: string[];
  models?: string[];
  budgetRange?: { min?: number; max?: number };
  dateRange?: { from: string; to: string };
}
```

**Gap**: Server supports rich filtering but UI state is ephemeral — cannot deep-link to `?prompt=X&strategy=Y`.

#### Missing Server Actions

| Action Needed | Query Pattern | Index Exists? |
|---------------|---------------|--------------|
| `getRunsByPromptAction(promptId)` | `WHERE prompt_id = ?` | ✅ `idx_evolution_runs_prompt` |
| `getRunsByStrategyAction(strategyId)` | `WHERE strategy_config_id = ?` | ✅ `idx_evolution_runs_strategy` |

---

### 17. Existing Cross-Link Pattern Catalog

#### Pattern A: Next.js `<Link>` (Preferred)
```typescript
// Gold-colored clickable ID
<Link
  href={`/admin/quality/evolution/run/${run.id}`}
  className="font-mono text-xs text-[var(--accent-gold)] hover:underline"
  title={run.id}
>
  {run.id.substring(0, 8)}
</Link>
```
**Used in**: Dashboard runs table, Evolution runs table, Explorer run/article tables, HoF entries

#### Pattern B: `router.push()` on Row Click
```typescript
<tr
  onClick={() => router.push(`/admin/quality/evolution/run/${run.id}`)}
  className="cursor-pointer hover:bg-[var(--surface-secondary)]"
>
```
**Used in**: HoF topic rows, clickable table rows throughout

#### Pattern C: Tab + Filter URL Params
```typescript
// Timeline → Logs with iteration + agent filter
<Link
  href={`/admin/quality/evolution/run/${runId}?tab=logs&iteration=${iter.iteration}&agent=${agent.name}`}
  className="text-[var(--accent-gold)] hover:underline ml-1"
  onClick={(e) => e.stopPropagation()}
>
  Logs
</Link>
```
**Received by LogsTab**: `initialAgent`, `initialIteration`, `initialVariant` props extracted from `searchParams`

#### Pattern D: Badge/Pill Link
```typescript
<Link
  href="/admin/quality/strategies"
  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium
             bg-[var(--surface-elevated)] text-[var(--accent-gold)]
             border border-[var(--border-default)] hover:bg-[var(--surface-secondary)]"
>
  {strategy.label}
</Link>
```
**Used in**: Strategy badge on run detail header

#### Pattern E: D3 Click → React State Panel
```typescript
// LineageGraph.tsx — SVG node click toggles side panel
.on('click', (_event, d) => {
  setSelectedNode(prev => prev?.id === d.id ? null : d);
})
// Panel renders conditionally:
{selectedNode && <VariantCard shortId={selectedNode.shortId} ... />}
```

#### Pattern F: Breadcrumb Navigation
```typescript
<div className="text-xs text-[var(--text-muted)]">
  <Link href="/admin/quality/evolution" className="hover:text-[var(--accent-gold)]">Evolution</Link>
  <span className="mx-1">/</span>
  <span>Run {runId.substring(0, 8)}</span>
</div>
```

#### Pattern G: Dialog Success → Navigate
```typescript
toast.success('Added to Hall of Fame', {
  action: { label: 'View Topic', onClick: () => onClose(result.data!.topic_id) },
});
// Parent navigates: router.push(`/admin/quality/hall-of-fame/${topicId}`)
```

#### CSS Variables for Interactive Elements
| Variable | Usage |
|----------|-------|
| `--accent-gold` | Primary interactive/link color |
| `--text-muted` | Secondary text, breadcrumb links |
| `--surface-secondary` | Row hover background |
| `--surface-elevated` | Badge/pill backgrounds |
| `--border-default` | Badge borders |

#### Testing Convention
All clickable elements use `data-testid` attributes:
```typescript
data-testid={`run-row-${run.id}`}
data-testid={`topic-row-${topic.id}`}
data-testid={`open-run-${entry.id}`}
```

#### No Shared URL Builder
All URLs are constructed via inline template literals. No centralized utility exists.

---

### Additional Code Files Read (Round 3)

- src/components/evolution/agentDetails/CalibrationDetail.tsx
- src/components/evolution/agentDetails/IterativeEditingDetail.tsx
- src/components/evolution/agentDetails/SectionDecompositionDetail.tsx
- src/components/evolution/agentDetails/OutlineGenerationDetail.tsx
- src/components/evolution/agentDetails/ProximityDetail.tsx
- src/components/evolution/agentDetails/MetaReviewDetail.tsx

---

## Round 4: Agent-Parallel Deep Dive

### 18. Variant Detail Data Availability

#### Existing Server Actions for Variant Data

**`getEvolutionVariantsAction(runId)`** (`evolutionActions.ts:390-419`):
```typescript
interface EvolutionVariant {
  id: string;
  run_id: string;
  explanation_id: number | null;
  variant_content: string;           // Full text (NOT truncated)
  elo_score: number;
  generation: number;
  agent_name: string;
  match_count: number;
  is_winner: boolean;
  created_at: string;
}
```
Returns all variants for a run sorted by Elo DESC. Falls back to checkpoint reconstruction if DB is empty (running/failed runs). **Does NOT include** `parent_variant_id` or `quality_scores` — they exist in DB but aren't fetched.

**`getEvolutionLineageAction(runId)`** (`evolutionVisualizationActions.ts:509-598`):
```typescript
interface LineageData {
  nodes: { id, shortId, strategy, elo, iterationBorn, isWinner, treeDepth?, revisionAction? }[];
  edges: { source: string; target: string }[];
  treeSearchPath?: string[];
}
```
Returns graph structure from checkpoint deserialization. Parent-child via edges array.

**`getEvolutionEloHistoryAction(runId)`** (`evolutionVisualizationActions.ts:454-505`):
Returns per-iteration Elo ratings for all variants as time-series. Iterates all checkpoints, converts OpenSkill mu/sigma to Elo.

**No `getVariantByIdAction` exists.** Would need to be created.

#### Parent Chain Traversal — Already Implemented

`getExplorerArticleDetailAction()` in `unifiedExplorerActions.ts:718-789` walks up `parent_variant_id` chain:
```typescript
let currentParentId = variant.parent_variant_id;
const visited = new Set<string>();
while (currentParentId && !visited.has(currentParentId) && lineage.length < 10) {
  // fetch ancestor, push to lineage, walk up
}
```
Cycle-safe, limit 10 ancestors, uses `idx_variants_parent` index.

#### Match History & Critiques — Checkpoint Only

Matches and critiques are stored in checkpoint `state_snapshot` JSON, NOT separate tables:
```typescript
// Match (from SerializedPipelineState)
interface Match {
  variationA: string; variationB: string; winner: string;
  confidence: number; turns: number;
  dimensionScores: Record<string, string>;
  frictionSpots?: { a: string[]; b: string[] };
}
// Critique (from SerializedPipelineState)
interface Critique {
  variationId: string;
  dimensionScores: Record<string, number>;
  goodExamples: Record<string, string[]>;
  badExamples: Record<string, string[]>;
  notes: Record<string, string>;
  reviewer: string; scale?: '1-10' | '0-5';
}
```
Must deserialize latest checkpoint and filter by variant ID.

#### Run Detail Page Data Flow

- **Page load**: Only `getEvolutionRunByIdAction(runId)` (lightweight metadata)
- **Strategy**: Lazy-fetched via `getStrategyDetailAction(run.strategy_config_id)` if available
- **Each tab loads independently**: Tabs receive only `runId` as prop, fetch their own data on activation
- Variant data is NOT pre-loaded — fetched when Variants tab activates

#### DB Columns Available But Not Fetched

| Column | In DB | In `EvolutionVariant` | Notes |
|--------|-------|----------------------|-------|
| `parent_variant_id` | ✅ UUID (self-join) | ❌ Not selected | Index: `idx_variants_parent` |
| `quality_scores` | ✅ JSONB | ❌ Not selected | Default `{}`, mostly unused |

#### Recommended `getVariantDetailAction` Shape

```typescript
interface VariantDetailData {
  id: string; variantContent: string; eloScore: number;
  generation: number; agentName: string; matchCount: number;
  isWinner: boolean; createdAt: string;
  parentVariantId: string | null;
  parentContent: string | null;
  lineage: Array<{ id: string; agentName: string; generation: number; preview: string }>;
  matches: Array<{ opponent: string; winner: string; confidence: number; dimensionScores: Record<string, string> }>;
  critiques: Array<{ dimensionScores: Record<string, number>; reviewer: string; scale: string }>;
  treeDepth?: number | null;
  revisionAction?: string | null;
}
```
Would compose: DB variant query + parent chain traversal + checkpoint deserialization + match/critique filtering.

---

### 19. Run Detail Header Complete Inventory

#### Header Layout (Lines 230-294)

**Section A: Title & Metadata** (lines 238-275):
- Breadcrumb: `Evolution / Run {id.substring(0,8)}` — Evolution is `<Link>`, Run is plain text
- Heading: `Explanation #{run.explanation_id}` or `Evolution Run` — **NOT clickable**
- Run ID: `{id.substring(0,8)}...` with Copy button → `navigator.clipboard.writeText(runId)` + toast
- Status row: `EvolutionStatusBadge` + `PhaseIndicator` + Cost `${total_cost_usd.toFixed(2)} / ${budget_cap_usd.toFixed(2)}` + Strategy badge `<Link>` to `/admin/quality/strategies`
- Error: `run.error_message` in red (if present)

**Section B: Actions** (lines 276-293):
- "Add to Hall of Fame" button — only if `run.status === 'completed'`, opens `AddToHallOfFameDialog`
- "Compare" `<Link>` → `/admin/quality/evolution/run/{runId}/compare`

#### `EvolutionRun` Interface (`evolutionActions.ts:17-35`)

```typescript
interface EvolutionRun {
  id: string; explanation_id: number | null;
  status: EvolutionRunStatus; phase: PipelinePhase;
  total_variants: number; total_cost_usd: number;
  estimated_cost_usd: number | null; budget_cap_usd: number;
  current_iteration: number; variants_generated: number;
  error_message: string | null;
  started_at: string | null; completed_at: string | null; created_at: string;
  prompt_id: string | null;           // ❌ Available but NEVER shown
  pipeline_type: PipelineType | null; // ❌ Available but NEVER shown
  strategy_config_id: string | null;  // Used to fetch strategy label only
}
```

#### Field Clickability Matrix

| Field | Displayed | Clickable | Should Link To |
|-------|-----------|-----------|----------------|
| Explanation ID | ✅ In heading | ❌ | `/results?explanation_id={id}` |
| Run ID | ✅ Truncated | Copy only | N/A (keep copy) |
| Strategy label | ✅ Badge | ✅ → list page | Should → specific strategy detail |
| Prompt ID | ❌ Hidden | ❌ | Prompt registry or explorer with filter |
| Pipeline type | ❌ Hidden | ❌ | Could display as badge |
| started_at / completed_at | ❌ Hidden | ❌ | Could show elapsed time |
| estimated_cost_usd | ❌ Hidden | ❌ | Could show estimate vs actual |
| total_variants | ❌ Hidden | ❌ | Quick stat |

#### Tab Mechanism

- URL params: `?tab=X`, `?agent=X`, `?iteration=N`, `?variant=X` — parsed via `useSearchParams()`
- Tab switching does NOT update URL (client state only)
- Tabs: `timeline | elo | lineage | tree | budget | variants | logs`
- All tabs receive only `runId` as prop; LogsTab additionally gets `initialAgent`, `initialIteration`, `initialVariant`

#### Add to Hall of Fame Dialog (Lines 34-162)

- Fetches variants via `getEvolutionVariantsAction(run.id)` on mount
- Selects winner (`is_winner` flag) and baseline (`agent_name === 'original_baseline'`)
- Stores `explanation_id` in metadata but does not display/link it
- On success: toast with "View Topic" action → navigates to HoF topic page

---

### 20. HoF Topic Detail & Optimization Page Cross-Linking Gaps

#### HoF Topic Detail — 4 Tabs

**Leaderboard Tab** (lines 686-805):
- Ranked entries by Elo with expandable rows
- ✅ Evolution Run link: `Open Run Detail →` links to `/evolution/run/{evolution_run_id}`
- ✅ Compare link: `Compare →` links to `/evolution/run/{evolution_run_id}/compare`
- ❌ Variant ID: `evolution_variant_id` stored but NOT displayed/linked
- ❌ Explanation ID: stored in metadata, NOT displayed/linked

**Cost vs Elo Tab** (lines 807-831):
- Recharts scatter chart; dots clickable → scroll to leaderboard row + expand
- ❌ No direct link to run from chart dots

**Match History Tab** (lines 833-898):
- Shows Swiss-pairing comparison results: Entry A, Entry B, Winner, Confidence, Judge, Date
- ❌ Entry IDs shown as model names, NOT clickable
- ❌ No run/variant links from match records

**Compare Text Tab** (lines 901-966):
- Side-by-side word diff (`diffWordsWithSpace`)
- Entry selection via dual dropdowns
- ❌ No links to entries or their evolution runs from diff view

#### HallOfFameEntry Data Structure

```typescript
{
  id: string; topic_id: string; content: string;
  generation_method: 'oneshot' | 'evolution_winner' | 'evolution_baseline';
  model: string; total_cost_usd: number | null;
  evolution_run_id: string | null;      // ✅ Used in "Open Run Detail" link
  evolution_variant_id: string | null;  // ❌ Never displayed or linked
  metadata: Record<string, unknown>;    // Contains explanation_id, NOT linked
  created_at: string;
}
```

#### Optimization Page — 4 Tabs

**Strategy Analysis**: Strategy Leaderboard + Pareto Chart
**Agent Analysis**: Agent ROI Leaderboard
**Cost Analysis**: Summary cards + Cost Breakdown + Agent ROI
**Cost Accuracy**: CostAccuracyPanel

**Critical gap**: `StrategyDetail` modal (lines 54-222) shows run history table (Date, Topic, Status, Elo, Cost, Iters, Duration) from `getStrategyRunsAction(strategyId)` but:
- ❌ `runId` fetched but NOT displayed or linked
- ❌ `explanationTitle` shown as plain text, NOT linked
- ❌ Table rows are read-only, no click handlers

`StrategyRunEntry` type:
```typescript
{ runId: string; explanationId: number; explanationTitle: string;
  status: string; finalElo: number | null; totalCostUsd: number;
  iterations: number; duration: number | null; }
```

**Agent ROI Leaderboard**: Shows agent metrics (Avg Cost, Avg Elo Gain, Elo/$, Sample Size). No entity IDs, no clickable elements.

**Pareto Chart**: Hover shows tooltip, no click navigation.

#### Content Quality Page — 2 Tabs

**Article Scores**: Shows per-article quality scores. `explanation_id` displayed as text, NOT clickable.
**Eval Runs**: Run history. No entity IDs displayed, no links.

#### Combined Entity Clickability Matrix

| Page | Entity | Displayed | Clickable | Gap |
|------|--------|-----------|-----------|-----|
| HoF Topic | evolution_run_id | ✅ | ✅ → run detail | — |
| HoF Topic | evolution_variant_id | ❌ | ❌ | Should show + link |
| HoF Topic | explanation_id (metadata) | ❌ | ❌ | Should show + link to `/results` |
| HoF Match History | entry_a/b_id | As model name | ❌ | Should link to entry detail |
| Optimization | runId (in strategy runs) | ❌ | ❌ | Should link to run detail |
| Optimization | explanationTitle | ✅ text only | ❌ | Should link to `/results` |
| Optimization | agent names | ✅ | ❌ | Could link to explorer filtered by agent |
| Content Quality | explanation_id | ✅ text | ❌ | Should link to `/results` |

---

### 21. Expansion & Modal Pattern Catalog

#### Pattern Comparison Matrix

| Pattern | Trigger | Data Source | Layout | Max Height | Z-Index | Close |
|---------|---------|-------------|--------|-----------|---------|-------|
| **ArticleDetailPanel** (Explorer) | Row click | Server fetch on expand | Inline `<tr colSpan>` | `max-h-64` | Default | Toggle row |
| **VariantsTab Expansion** | "View" button | Pre-loaded | Inline `<tr colSpan>` | `max-h-64` | Default | Toggle button |
| **StrategyDetailRow** | Row click | Pre-loaded | Inline `<tr colSpan>` + 2-col grid | `max-h-48` | Default | Toggle row |
| **VariantPanel Modal** | "Variants" button | Server fetch | Fixed overlay portal | `max-h-[80vh]` | `z-50` | X button |
| **LineageGraph Panel** | D3 node click | Pre-loaded (graph data) | Absolute side panel | None | Default | "Close" button |
| **AgentDetailPanel** | Agent row click | Server fetch | Nested `<div>` | None | Default | Toggle row |
| **Strategy/Clone/Queue Dialogs** | Button click | Form state (local) | Fixed overlay portal | `max-h-[85vh]` | `z-50` | Cancel button |

#### CSS Patterns

| Purpose | CSS Classes |
|---------|-------------|
| Inline expansion background | `bg-[var(--surface-secondary)]` or `bg-[var(--surface-elevated)]` |
| Modal backdrop | `fixed inset-0 bg-black/50 flex items-center justify-center z-50` |
| Modal container | `bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-6` |
| Scrollable content | `max-h-64 overflow-y-auto` (inline) or `max-h-[80vh] overflow-y-auto` (modal) |
| Side panel position | `absolute top-4 right-4 w-64` |
| Content text | `whitespace-pre-wrap text-xs text-[var(--text-secondary)]` |

#### Key Consistency Rules

1. **No animations** — All expansions are instant (no fade/slide)
2. **Z-index**: Only modals use `z-50`; inline/side panels use default stacking
3. **State**: Simple `expandedId: string | null` toggle pattern
4. **Close**: Inline = toggle same element; Modal = dedicated close button; NO click-outside dismissal
5. **Data**: Pre-fetched when possible; async-fetch only for expensive data (show skeleton `h-32 animate-pulse`)
6. **Surface layering**: `--surface-secondary` for expansions, `--surface-elevated` for modals/panels

#### Recommended Pattern for Variant Detail

- **Within run detail tabs** (Timeline, Elo, Lineage agent details): Use **inline expansion** pattern — consistent with existing table expansions
- **From admin tables** (Evolution runs, Explorer): Use **fixed overlay modal** — consistent with VariantPanel
- **From graphs** (Lineage, Tree): Use **absolute side panel** — consistent with LineageGraph VariantCard, but enhanced with more data

---

### Additional Code Files Read (Round 4)

- src/lib/services/evolutionActions.ts (full read for variant types)
- src/lib/services/evolutionVisualizationActions.ts (lineage/elo/checkpoint helpers)
- src/lib/services/unifiedExplorerActions.ts (article detail lineage traversal)
- src/app/admin/quality/evolution/run/[runId]/page.tsx (full header + tab mechanism)
- src/app/admin/quality/hall-of-fame/[topicId]/page.tsx (4 tabs + entry detail)
- src/app/admin/quality/optimization/page.tsx (4 tabs + strategy detail modal)
- src/app/admin/quality/page.tsx (content quality scores + eval runs)
- src/lib/services/hallOfFameActions.ts (HoF server actions)
- src/lib/services/eloBudgetActions.ts (optimization server actions)
- supabase/migrations/20260131000002_content_evolution_variants.sql (DB schema)

---

## Round 5: Simplification & Intuitiveness Deep Dive (4 Parallel Agents)

### 22. UI Redundancy & Simplification Opportunities

#### 22.1 Duplicate Run Tables (CRITICAL)

**Two separate run tables exist** with overlapping purpose:
- `/admin/evolution-dashboard/page.tsx` (lines 181-225): "Recent Runs" — 7 columns
- `/admin/quality/evolution/page.tsx` (lines 822-940): "Runs" — 11 columns

Both use `getEvolutionRunsAction`, identical styling, same status badges, same row click → run detail. The dashboard table is a subset of the evolution page table.

**Recommendation:** Extract shared `RunsTable` component. Dashboard shows top 10 read-only, evolution page shows full management table.

#### 22.2 Overlapping Page Purposes (CRITICAL)

3 pages serve overlapping "view runs" functions:

| Page | Purpose | Unique Value |
|------|---------|-------------|
| Dashboard (`/admin/evolution-dashboard`) | Quick overview | Charts (30d runs/spend), quick links |
| Evolution (`/admin/quality/evolution`) | Operations | Start runs, batch dispatch, apply winners |
| Explorer (`/admin/quality/explorer`) | Analytics | Multi-dimensional filtering, matrix/trend views |

All 3 have prompt/strategy filters, cost displays, date filtering, and Elo metrics. Users must visit multiple pages for a complete picture.

**Recommendation:** Differentiate clearly:
- Dashboard = aggregate metrics only (remove runs table, add summary cards)
- Evolution = operational hub (start, manage, monitor runs)
- Explorer = pure analytics (advanced filtering and slicing)

#### 22.3 Duplicate Cost Visualizations (MEDIUM-HIGH)

Cost breakdowns appear in 4+ locations with inconsistent presentation:
- Evolution page: horizontal bar chart (`AgentCostChart`, lines 126-150)
- Optimization page: pie chart (`CostBreakdownPie`)
- Optimization page: ROI table (`AgentROILeaderboard`)
- BudgetTab: per-agent breakdown bars + cumulative burn chart

Same data, 3 different chart types. Should standardize on ONE reusable cost visualization component.

#### 22.4 Run Detail Tab Overlap (MEDIUM-HIGH)

7 tabs have overlapping data presentations:

| Data | Shown In |
|------|----------|
| Variants | Variants tab, Elo tab (sparklines), Lineage (nodes), Tree (nodes) |
| Relationships | Lineage (full DAG), Tree (pruned hierarchy) |
| Costs | Timeline (per-agent), Budget (aggregate) |

**Recommendation:**
- Merge Timeline + Budget → unified view with cost overlay
- Merge Lineage + Tree → single visualization with toggle
- Result: 5 tabs instead of 7

#### 22.5 Variant Selection Fragmentation (MEDIUM)

Variants viewable in 5 places: Variants tab, Variant Panel Modal (evolution page), Elo tab, Lineage tab, Tree tab. No canonical "variant management" location.

**Recommendation:** Variants tab = canonical. Remove the variant panel modal from evolution page; link to run detail instead.

#### 22.6 Over-Engineered Explorer (MEDIUM)

Explorer has too many controls for typical usage:
- 3 view modes (Table/Matrix/Trend)
- 3 units of analysis (Run/Article/Task)
- 5 metrics, 4 dimensions, 3 time buckets, 4 date presets + custom

**Recommendation:** Default to Table view, collapse Matrix/Trend into secondary tabs, simplify date picker.

#### 22.7 Unused/Rarely Useful Features (LOW)

- Batch Dispatch Card (lines 347-432): Complex UI for niche use case
- Queue Dialog (lines 436-509): Parallel to Start New Pipeline card
- Prompt Bank Coverage Matrix (HoF): Dense visual, could be text summary

---

### 23. Debug Experience & Observability Gaps

#### 23.1 Silent Timeout Failures (CRITICAL)

When Vercel serverless timeout kills the process, **no error is logged**. The run stays in `running` status with `error_message: null` forever. No graceful shutdown or error capture exists.

**Evidence:** Run 50140d27 was killed mid-calibration at 4 minutes with no trace (documented in prod debugging research).

**Recommendation:**
- Wrap `executeFullPipeline()` in try/catch with explicit error persistence
- Store structured errors: `{ iteration, agent, step, message, timestamp, context }`
- Implement SIGTERM handler for graceful shutdown
- Add "stale run" detection (mark runs as failed if no checkpoint update in 10 minutes)

#### 23.2 Errors Hidden in Tooltips (HIGH)

Across all 12 agent detail views, errors are displayed via `title` attribute tooltips only:
- `GenerationDetail` line 23: `{s.error && <span title={s.error}>error</span>}`
- Format issues shown as count with tooltip
- No error context (what was being processed, retry count, cost before failure)

**Recommendation:**
- Move errors from tooltips to visible error blocks
- Add error categorization: API error (fatal) vs format rejection (recoverable)
- Show remediation attempted + final outcome

#### 23.3 Log Viewing Limitations (HIGH)

LogsTab has 500-entry limit with no pagination UI. Additional gaps:
- No full-text search within logs
- No cost visibility inline (buried in expandable context JSON)
- Context JSON displayed as raw dump, not structured tree view
- No time-delta column (can't spot hanging iterations)
- No log export capability

**Recommendation:**
- Add pagination: "1-500 of 2,341 entries" with navigation
- Add search box in filter bar
- Inline cost per log entry when available
- Parse context JSON into collapsible tree view
- Add "Export logs" button (CSV/JSON)

#### 23.4 Run State Ambiguity (MEDIUM)

- "claimed" status is opaque (queued? preparing? executing?)
- "running" shows no progress (iteration 3/15 or 15/15?)
- No budget health indicator on main status display
- No time estimate for completion

**Recommendation:**
- Show progress: "running (iteration 3/15)"
- Add budget health: "$2.50 / $5.00 (50%)" with color coding
- Add estimated time remaining based on iteration pace

#### 23.5 TimelineTab Staleness (MEDIUM)

TimelineTab loads data **once** and never auto-refreshes, while LogsTab and BudgetTab refresh every 5s. For active runs, new iterations don't appear without manual page refresh.

**Recommendation:** Add auto-refresh to TimelineTab matching other tabs (5s interval for active runs).

#### 23.6 Variant Debugging Path Missing (HIGH)

No way to trace why a variant scored poorly:
- Can't see match history (who did it compete against? what were verdicts?)
- Can't see parent lineage from variant view
- Can't jump from variant → creating agent
- No quality dimension scores visible

**Recommendation:** Add variant detail view showing: creation agent, match history, parent chain, dimension scores, text diff to parent.

#### 23.7 Budget Alert Gap (HIGH)

No warning before budget is exceeded. Cost display refreshes every 5s, but there's no:
- Pre-overspend warning at 70-80% usage
- Cost burn rate display
- Per-phase estimate vs actual tracking
- "Kill run" confirmation when approaching limit

#### 23.8 No Distributed Tracing (MEDIUM)

No `request_id` tracking across async operations. Can't correlate LLM API calls to evolution run logs. If an LLM call fails, impossible to trace which variant generation triggered it.

---

### 24. Navigation & Information Architecture

#### 24.1 Sidebar Organization (HIGH)

Current 7 flat items with no visual hierarchy:
```
Overview → Explorer → Elo Optimization → Start Pipeline → Prompts → Strategies → Hall of Fame
```

**Issues:**
- No grouping (analytics vs operations vs registries)
- "Start Pipeline" naming misleading (page is really "Run Management")
- Prompts & Strategies are registries sitting alongside analytics pages

**Recommended restructure (4-5 groups):**
```
Overview
├─ Dashboard

Runs
├─ Pipeline Runs (renamed from "Start Pipeline")

Analysis
├─ Explorer
├─ Elo Optimization

Reference
├─ Prompts
├─ Strategies
├─ Hall of Fame
```

#### 24.2 Dead Ends — Variant IDs (CRITICAL)

24 locations display variant IDs via `ShortId` component. **None are clickable.** This is the single biggest navigation gap.

All 24 call sites have `runId` available in their component tree. The `ShortId` component could accept optional `onClick` or `href` + `runId` to become clickable.

**Recommendation:** Enhance `ShortId` to support click → variant detail panel. Implementation is straightforward since all parent components already have `runId`.

#### 24.3 Dead Ends — Explanation IDs (HIGH)

11 locations display explanation IDs. Most are not clickable. The canonical link pattern `/results?explanation_id={id}` works end-to-end but is never used in the evolution dashboard.

**Recommendation:** Create utility `buildExplanationUrl(id)` and add `<Link>` to all 11 locations.

#### 24.4 Dead Ends — Strategy/Prompt Reverse Navigation (HIGH)

- Strategies page shows `run_count` as number but no list of individual runs
- Prompts page has no indication of which runs used each prompt
- No `getRunsByStrategyAction` or `getRunsByPromptAction` server actions (despite DB indexes existing)

**Recommendation:**
- Add "Runs using this strategy/prompt" section to expandable rows
- Create `getRunsByStrategyAction(strategyId)` and `getRunsByPromptAction(promptId)` server actions
- Or: Add "View in Explorer" button → Explorer pre-filtered by strategy/prompt

#### 24.5 Context Loss on Navigation (MEDIUM)

- Explorer filter state is ephemeral (pure `useState`, no URL params)
- Run detail tab switching doesn't update URL
- Scroll position not preserved when returning from run detail to runs list

**Recommendation:**
- Sync Explorer filters to URL params (`?prompts=X&strategies=Y`)
- Update URL on tab switch in run detail
- Use browser history scroll restoration

#### 24.6 Breadcrumb Inconsistency (MEDIUM)

Only run detail page has breadcrumbs. Explorer, Optimization, Hall of Fame, Strategies, Prompts have none.

**Recommendation:** Add breadcrumbs to all pages. Include active tab in run detail breadcrumb.

#### 24.7 Page Title Clarity (LOW-MEDIUM)

- "Content Evolution" is jargon → should be "Pipeline Runs"
- Run detail shows "Explanation #42" which confuses run with article
- Compare page has no explicit heading
- Explorer has no subtitle explaining what's available

---

### 25. Data Density & Readability

#### 25.1 Table Column Overload

| Table | Columns | Recommendation |
|-------|---------|---------------|
| Evolution runs | 11 | Hide Run ID, combine Cost+Est into single column |
| Variants | 8 | Move ID to tooltip, expand sparkline |
| Explorer (run) | 7 | OK |
| Explorer (article) | 7 | Improve content truncation |
| Explorer (task) | 8 | Too many derived metrics competing |
| HoF leaderboard | 10 | Stack Method+Model, reduce cost decimals |

#### 25.2 Number Formatting Inconsistencies (HIGH)

| Location | Cost Format | Issue |
|----------|------------|-------|
| Dashboard runs | `$0.12` | Good |
| Evolution runs | `$0.12` | Good |
| Variants modal | `$0.123` | 3 decimals |
| Budget breakdown | `$0.000` | 4 decimals |
| HoF leaderboard | `$0.0000` | 4 decimals |
| Explorer tasks | `$0.0000` | 4 decimals |

**Recommendation:** Standardize: `$0.00` for all UI displays, `$0.000` only for agent-level breakdowns, never 4 decimals. Elo always as integer. Create shared formatters: `formatCost(usd)`, `formatElo(score)`.

#### 25.3 Visual Hierarchy Flattened (MEDIUM)

Run detail header gives equal visual weight to status, phase, cost, and variants. No clear primary KPI.

**Recommendation:** Make current phase + iteration PROMINENT. Status badge visible always. Cost secondary (smaller, muted).

#### 25.4 Chart Readability Gaps (MEDIUM)

- **EloTab:** No labels on lines, Y-axis hardcoded at 800 (misleading if variants cluster), tooltip missing variant ID
- **BudgetTab burn chart:** No predicted spend trend, no label on cap line
- **Explorer trend chart:** Becomes spaghetti with many dimensions selected
- **HoF scatter:** No quadrant lines or Pareto frontier

**Recommendation:**
- Add reference lines (1200 Elo baseline, budget cap labels)
- Add "Top N of M" context on Elo chart
- Add axis labels to all charts
- Add Pareto frontier to HoF scatter

#### 25.5 Loading/Empty States Inconsistent (LOW-MEDIUM)

Loading patterns vary: `animate-pulse` divs (BudgetTab), "Loading..." text (Explorer), full skeletons (TimelineTab). Some don't match final layout, causing layout shift.

Empty states are generally good ("No runs found. Adjust filters.") but lack suggested actions.

#### 25.6 Status Indicator Proliferation (MEDIUM)

6+ different patterns for showing status/progress: badges, phase indicators, sparklines, progress bars, method badges, step score bars. Users must learn visual language for each table.

**Recommendation:** Standardize:
- Status: color badge + icon (✓, ✗, ▶, ⏳)
- Progress: horizontal bar with percentage
- Trending: sparkline or delta badge (↑ green, ↓ red)

---

### 26. Combined Priority Matrix

#### P0 — Critical (Foundation)

| # | Finding | Section | Impact |
|---|---------|---------|--------|
| 1 | Fix silent timeout failures — runs stuck in "running" forever | 23.1 | Debugging |
| 2 | Make variant IDs clickable (24 locations) | 24.2 | Navigation |
| 3 | Consolidate duplicate run tables → shared component | 22.1 | Simplification |
| 4 | Differentiate overlapping page purposes | 22.2 | Simplification |

#### P1 — High Impact

| # | Finding | Section | Impact |
|---|---------|---------|--------|
| 5 | Make explanation IDs clickable (11 locations) | 24.3 | Navigation |
| 6 | Move errors from tooltips to visible blocks | 23.2 | Debugging |
| 7 | Add log pagination + search | 23.3 | Debugging |
| 8 | Add variant debugging path (match history, lineage, agent link) | 23.6 | Debugging |
| 9 | Add budget health alerts (70-80% warning) | 23.7 | Debugging |
| 10 | Add reverse navigation (strategy/prompt → runs) | 24.4 | Navigation |
| 11 | Standardize number formatting | 25.2 | Readability |
| 12 | Merge redundant run detail tabs (7→5) | 22.4 | Simplification |

#### P2 — Medium

| # | Finding | Section | Impact |
|---|---------|---------|--------|
| 13 | Reorganize sidebar with grouping | 24.1 | Navigation |
| 14 | Fix TimelineTab staleness (add auto-refresh) | 23.5 | Debugging |
| 15 | Sync Explorer filters to URL | 24.5 | Navigation |
| 16 | Add breadcrumbs to all pages | 24.6 | Navigation |
| 17 | Improve chart readability (labels, reference lines) | 25.4 | Readability |
| 18 | Reduce table columns (hide non-essential by default) | 25.1 | Readability |
| 19 | Standardize status indicators | 25.6 | Readability |
| 20 | Add run progress display (iteration N/M + time estimate) | 23.4 | Debugging |

#### P3 — Low Priority / Polish

| # | Finding | Section | Impact |
|---|---------|---------|--------|
| 21 | Simplify Explorer controls | 22.6 | Simplification |
| 22 | Remove unused features (batch dispatch, queue dialog) | 22.7 | Simplification |
| 23 | Page title/naming clarity | 24.7 | Navigation |
| 24 | Loading/empty state consistency | 25.5 | Readability |
| 25 | Add distributed tracing (request IDs) | 23.8 | Debugging |
| 26 | Log export capability | 23.3 | Debugging |

---

### Additional Code Files Read (Round 5)

All files from Rounds 1-4, plus thorough re-examination of:
- All 12 agent detail views in `src/components/evolution/agentDetails/`
- `src/components/evolution/AutoRefreshProvider.tsx`
- `src/components/evolution/RefreshIndicator.tsx`
- `src/lib/services/errorHandling.ts`
- All optimization sub-components in `src/app/admin/quality/optimization/_components/`
- `src/app/admin/quality/explorer/page.tsx` (full filter/view mechanism)
