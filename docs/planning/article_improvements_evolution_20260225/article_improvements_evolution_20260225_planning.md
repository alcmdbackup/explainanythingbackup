# Article Improvements Evolution Plan

## Background
The evolution pipeline generates, competes, and refines article variants but has two gaps: (1) Elo attribution credits ranking agents instead of the creating agents, making it impossible to tell which strategies actually improve articles, and (2) there's no article-centric or variant-centric view — all existing pages are run-scoped, so users can't see the full evolution history of a single article across runs or deep-dive into a specific variant. This project addresses both gaps with creator-based Elo attribution and two new detail pages: an explanation detail page (cross-run article history) and a variant detail page (single variant deep-dive).

## Requirements (from GH Issue #571)
I want 2 things - to know how articles are tracked on revision. Is a new article created, or is old one simply updated in place? Also, I want a detailed article view the shows the article and its associated history, like when it was created, its elo, which agents operated on it, its matches, etc.

Additional: How is lineage tracked? How is Elo boost from an agent calculated — is it by looking at Elo difference between new vs. old?

## Problem
Currently, Elo changes are attributed to whichever agent happens to be running when ratings shift — so CalibrationRanker and Tournament get all the credit while the agents that actually create variants (IterativeEditing, GenerationAgent, etc.) show zero Elo change. This makes it impossible to evaluate which strategies produce better content. Additionally, every existing view is run-scoped: there's no page that aggregates all evolution runs, variants, and ratings for a single article, forcing users to manually cross-reference multiple run detail pages.

## Current State: Navigation & Terminology Gaps

### Current Navigation Graph

```
Evolution Runs (/admin/quality/evolution)
  │
  ├─ Explanation #{id} link ──→ /results?explanation_id={id}  (PUBLIC page — exits admin, dead end)
  │
  └─ Run row click ──→ Run Detail (/run/[runId])
       │
       ├─ Header: Explanation #{id} ──→ /results?explanation_id={id}  (same public dead end)
       │
       ├─ VariantsTab
       │    ├─ Row expand ──→ inline VariantDetailPanel
       │    │    ├─ Parent IDs: display only (NOT linked)
       │    │    ├─ Match opponents: ShortId → ?tab=variants&variant={id} (same page)
       │    │    └─ "Jump to agent" ──→ ?tab=timeline&iteration=N&agent=STRATEGY
       │    └─ "Full Compare" ──→ /run/[runId]/compare
       │
       ├─ TimelineTab
       │    └─ Agent expand ──→ New variant ShortIds ──→ ?tab=variants&variant={id}
       │
       ├─ LineageTab
       │    └─ DAG node click ──→ VariantCard side panel (NO outbound links)
       │
       └─ EloTab ──→ Tooltip: "click in Variants tab" (NO links)

Explorer (/admin/quality/explorer)  [unit=article]
  │
  ├─ Each row = one VARIANT (not one explanation — naming is misleading)
  ├─ Content preview: plain text (NOT clickable)
  ├─ Run ID: links to /run/[runId]
  └─ Row expand ──→ ArticleDetailPanel
       ├─ Lineage chain: display only (NOT linked)
       └─ Parent content: display only

Hall of Fame (/admin/quality/hall-of-fame/[topicId])
  │
  ├─ Leaderboard "↗ Run" ──→ /run/[runId]
  └─ "Add from Run" dialog: Explanation icon ──→ /results?explanation_id={id}

Strategies (/admin/quality/strategies)
  └─ Performance table: explanation links ──→ /results?explanation_id={id}

Prompts (/admin/quality/prompts)
  └─ Performance table: explanation links ──→ /results?explanation_id={id}
```

### Identified Gaps

| Gap | Detail |
|-----|--------|
| **No admin explanation view** | Every explanation link exits to the public `/results` page. No way to see cross-run history, agent attribution, or variant comparison from the admin dashboard. |
| **No variant detail page** | `buildVariantUrl()` is defined in `evolutionUrls.ts` but never called in production code. Variants are only viewable via inline expand panels within VariantsTab. |
| **Parent IDs not clickable** | `VariantDetailPanel` shows parent variant IDs as plain text — can't navigate parent→child lineage. |
| **LineageTab DAG is a dead end** | Clicking a node shows a `VariantCard` side panel with ID, Elo, strategy — but no outbound links. |
| **Explorer "article" is a variant** | Each row in `ArticleTable` is keyed by `variant_id` (one `evolution_variants` row), not `explanation_id`. The `ArticleDetailPanel` shows one variant's content + lineage chain. The name "article" in the Explorer context is misleading. |
| **No run→explanation admin link** | Run detail header links to public page only. No way to navigate from a run to its explanation's admin history view. |
| **EloTab has zero navigation** | Pure chart with tooltip suggesting manual tab switch. No clickable data points. |
| **Variant detail data scattered** | To see a variant's full picture (content + attribution + parents + matches + lineage), a user must navigate between VariantsTab (expand), LineageTab (DAG), and TimelineTab (agent detail) within the same run page. |

### Key Existing Infrastructure

| Component | What It Does | Navigation Relevance |
|-----------|-------------|---------------------|
| `ShortId` (shared.tsx) | Renders 8-char ID prefix, auto-links when `runId` prop provided | Links to `?tab=variants&variant={id}` — would need to change to `/variant/{id}` |
| `buildVariantUrl(runId, variantId)` | Defined but NEVER called | Orphaned — confirms variant detail page was planned but not built |
| `buildExplanationUrl(explanationId)` | Returns `/results?explanation_id={id}` | Links to public page; needs admin equivalent via `buildArticleUrl()` |
| `EvolutionBreadcrumb` | Renders `{label, href}[]` as `/`-separated links | Passive component — will render whatever hierarchy we pass |
| `VariantDetailPanel` | Shows dimensions, matches, parents, content, "Jump to agent" | Most navigation-rich variant component; parent IDs need linking |
| `ArticleDetailPanel` (Explorer) | Shows variant content + parent content + 10-ancestor lineage chain | Lineage chain entries need linking to variant detail |

### Target Navigation Graph (After)

```
Evolution Runs
  ├─ Explanation #{id} ──→ Explanation Detail ◄──────────┐
  └─ Run row ──→ Run Detail                              │
                   ├─ Header: "Article History" ──────────┘
                   ├─ VariantsTab row ──→ Variant Detail
                   ├─ VariantsTab parents ──→ Variant Detail
                   ├─ LineageTab node ──→ Variant Detail
                   └─ TimelineTab ID ──→ Variant Detail

Explanation Detail (/article/[explanationId])
  ├─ Run cards ──→ Run Detail
  ├─ Variant rows ──→ Variant Detail
  └─ Public link ──→ /results?explanation_id={id}

Variant Detail (/variant/[variantId])
  ├─ Parent(s) ──→ Variant Detail (recursive)
  ├─ Children ──→ Variant Detail (recursive)
  ├─ Match opponents ──→ Variant Detail
  ├─ "View Run" ──→ Run Detail
  └─ "View Article" ──→ Explanation Detail

Explorer (unit=article)
  ├─ Content click ──→ Explanation Detail (via variant's explanation_id)
  └─ Lineage pills ──→ Variant Detail

Hall of Fame
  └─ "Article History" ──→ Explanation Detail
```

Every node links to every adjacent node — no dead ends.

## Decisions on Open Questions

### Elo Attribution
1. **Where to compute?** At pipeline completion (snapshot) — stored in `evolution_variants` and `evolution_agent_invocations`. Avoids recomputation on every page load and provides a stable historical record.
2. **Chained edits?** Use immediate parent only (`C.elo - B.elo`). This gives each step in the chain its own attribution, making it possible to identify which specific edit helped or hurt.

### Detail Views
1. **Explanation-centric vs variant-centric?** Both. Two separate pages serving different needs:
   - **Explanation detail** (`/admin/quality/evolution/article/[explanationId]`) — cross-run history of an article. "How has this article evolved across all runs?"
   - **Variant detail** (`/admin/quality/evolution/variant/[variantId]`) — deep-dive into one specific version. "What is this variant, who created it, how does it compare to its parent(s)?"
   - The explanation page links down to variant pages; variant pages link up to their explanation page.
2. **Revive applyWinnerAction?** No — out of scope. The append-only model is working; applying winners is a separate concern.
3. **Link vs inline?** Hybrid — show summary data inline (run cards, variant lists, Elo timeline) but link to existing run detail pages for deep dives. Avoids duplicating the 5-tab run detail UI.
4. **Hall of Fame integration?** Yes — show HoF entries for the article's variants if they exist.
5. **URL structure?**
   - `/admin/quality/evolution/article/[explanationId]` — explanation detail
   - `/admin/quality/evolution/variant/[variantId]` — variant detail
6. **Run → explanation link?** Yes — every run detail page links to its explanation's detail page in the header/breadcrumb.

## Options Considered

### Elo Attribution Approach

**Option A: Creator-based attribution at pipeline completion (chosen)**
- Compute `V.elo - parent(s).elo` for each variant at pipeline end
- Store attribution per-variant and aggregate per-agent in `execution_detail`
- Include confidence intervals using Gaussian error propagation on mu-space
- Pros: Accurate, accounts for sigma convergence, stored for historical comparison
- Cons: Only reflects final state, not intermediate evolution

**Option B: Running attribution during each ranking step**
- Update attribution dynamically after every CalibrationRanker/Tournament execution
- Pros: Shows how attribution evolves over iterations
- Cons: Much more complex, creates noise in early iterations, storage overhead

**Option C: Attribution based on match win rate instead of Elo**
- Credit agents by the win % of their variants against parent variants
- Pros: Simpler, avoids sigma issues entirely
- Cons: Ignores match quality (beating weak vs strong opponents), less nuanced

### Detail View Approach

**Option A: Two dedicated pages — explanation + variant (chosen)**
- Explanation detail at `/admin/quality/evolution/article/[explanationId]` — cross-run aggregation
- Variant detail at `/admin/quality/evolution/variant/[variantId]` — single variant deep-dive
- Explanation links down to variants; variants link up to explanation and sideways to parents/children
- Run detail links to its explanation; run's variant tabs link to variant detail
- Pros: Clean separation of concerns, each page has one clear purpose, enables full navigability across the entity hierarchy (explanation → run → variant)
- Cons: Two new pages to maintain

**Option B: Enhance Explorer with article detail**
- Expand `ArticleDetailPanel` in Explorer to show cross-run data
- Pros: Builds on existing component, no new route
- Cons: Explorer's unit model (Run/Article/Task) doesn't map well to cross-run aggregation, panel-based UI too cramped for variant deep-dive

**Option C: Add article tab to run detail page**
- New 6th tab on `/admin/quality/evolution/run/[runId]` showing article context
- Pros: Discovery from existing workflow
- Cons: Still run-scoped entry point, confusing UX (article tab on a run page), doesn't solve variant detail

**Option D: Explanation page only, variant info stays inline**
- Only build the explanation detail page; keep variant detail as inline expand panels
- Pros: Less work, fewer pages
- Cons: Inline panels are cramped, can't deep-link to a variant, can't navigate parent→child lineage

## Phased Execution Plan

### Phase 1: Creator-Based Elo Attribution (Backend)

**Goal:** Compute and persist per-variant Elo attribution with confidence intervals at pipeline completion.

**Files to create:**
- `evolution/src/lib/core/eloAttribution.ts` — Attribution computation logic

**Files to modify:**
- `evolution/src/lib/core/persistence.ts` — Call attribution computation in `persistVariants()`
- `evolution/src/lib/types.ts` — Add `EloAttribution` interface
- `evolution/src/lib/core/pipelineUtilities.ts` — Add per-agent attribution aggregation to `computeDiffMetrics()`

**Key code — `eloAttribution.ts`:**

```typescript
// Computes creator-based Elo attribution with confidence intervals for each variant.
import { type Rating } from './rating';

const ELO_SCALE = 400 / 25; // 16

export interface EloAttribution {
  gain: number;      // deltaMu * ELO_SCALE
  ci: number;        // 1.96 * sigmaDelta * ELO_SCALE (95% confidence)
  zScore: number;    // deltaMu / sigmaDelta
  deltaMu: number;   // raw mu difference
  sigmaDelta: number; // combined uncertainty
}

export function computeEloAttribution(
  variant: Rating,
  parents: Rating[],
): EloAttribution {
  let deltaMu: number;
  let sigmaDelta: number;

  if (parents.length === 0) {
    deltaMu = variant.mu - 25;
    sigmaDelta = variant.sigma;
  } else if (parents.length === 1) {
    deltaMu = variant.mu - parents[0].mu;
    sigmaDelta = Math.sqrt(variant.sigma ** 2 + parents[0].sigma ** 2);
  } else {
    const avgMu = (parents[0].mu + parents[1].mu) / 2;
    deltaMu = variant.mu - avgMu;
    sigmaDelta = Math.sqrt(
      variant.sigma ** 2 + (parents[0].sigma ** 2 + parents[1].sigma ** 2) / 4
    );
  }

  return {
    gain: deltaMu * ELO_SCALE,
    ci: 1.96 * sigmaDelta * ELO_SCALE,
    zScore: sigmaDelta > 0 ? deltaMu / sigmaDelta : 0,
    deltaMu,
    sigmaDelta,
  };
}

export type AgentAttribution = {
  agentName: string;
  variantCount: number;
  avgGain: number;
  avgCi: number;
  avgZScore: number;
  totalGain: number;
  variants: Array<{ variantId: string; attribution: EloAttribution }>;
};

export function aggregateByAgent(
  attributions: Map<string, { agentName: string; attribution: EloAttribution }>,
): AgentAttribution[] {
  const byAgent = new Map<string, AgentAttribution>();

  for (const [variantId, { agentName, attribution }] of attributions) {
    const existing = byAgent.get(agentName) ?? {
      agentName,
      variantCount: 0,
      avgGain: 0,
      avgCi: 0,
      avgZScore: 0,
      totalGain: 0,
      variants: [],
    };
    existing.variants.push({ variantId, attribution });
    existing.variantCount++;
    existing.totalGain += attribution.gain;
    byAgent.set(agentName, existing);
  }

  // Compute averages
  for (const agent of byAgent.values()) {
    agent.avgGain = agent.totalGain / agent.variantCount;
    agent.avgCi = agent.variants.reduce((s, v) => s + v.attribution.ci, 0) / agent.variantCount;
    agent.avgZScore = agent.variants.reduce((s, v) => s + v.attribution.zScore, 0) / agent.variantCount;
  }

  return [...byAgent.values()].sort((a, b) => b.avgGain - a.avgGain);
}
```

**Integration in `persistence.ts`:**

In `persistVariants()`, after writing variants to DB but before returning, compute attribution for each variant using `state.ratings` and `state.pool` (which has `parentIds`), then store the attribution JSON in a new `elo_attribution` JSONB column on `evolution_variants`.

**Migration:**
- Add `elo_attribution JSONB` column to `evolution_variants` table
- Add `agent_attribution JSONB` column to `evolution_agent_invocations` table (aggregated per-agent stats)

**Tests:**
- Unit tests for `computeEloAttribution()` — 0 parents, 1 parent, 2 parents, edge cases (sigma=0)
- Unit tests for `aggregateByAgent()` — multiple agents, single variant per agent, empty input
- Integration test: mock pipeline run verifying attribution is persisted correctly

---

### Phase 2: Elo Attribution UI (Timeline + Variants Tabs)

**Goal:** Surface attribution data in existing evolution UI tabs.

**Files to modify:**
- `evolution/src/components/evolution/tabs/TimelineTab.tsx` — Replace current misleading Elo changes with creator-based attribution per agent
- `evolution/src/components/evolution/tabs/VariantsTab.tsx` — Add attribution column to variant table, show gain ± CI with z-score coloring in `VariantDetailPanel`
- `evolution/src/services/evolutionVisualizationActions.ts` — Extend `getEvolutionRunTimelineAction` to include agent attribution from `evolution_agent_invocations.agent_attribution`

**Key UI pattern — z-score colored attribution:**

```tsx
function AttributionBadge({ attribution }: { attribution: EloAttribution }) {
  const absZ = Math.abs(attribution.zScore);
  const color = absZ < 1.0
    ? 'text-muted-foreground'           // grey — noise
    : absZ < 2.0
      ? 'text-yellow-500'               // amber — likely real
      : attribution.gain >= 0
        ? 'text-green-500'              // green — significant positive
        : 'text-red-500';              // red — significant negative

  return (
    <span className={color}>
      {attribution.gain >= 0 ? '+' : ''}{Math.round(attribution.gain)}
      {' ± '}{Math.round(attribution.ci)}
    </span>
  );
}
```

**Tests:**
- Unit tests for `AttributionBadge` — color thresholds at z=0.9, 1.0, 1.5, 2.0, negative values
- Snapshot tests for TimelineTab and VariantsTab with attribution data

---

### Phase 3: Detail View Server Actions

**Goal:** Create server actions for both explanation-level aggregation and variant-level deep-dive.

**Files to create:**
- `evolution/src/services/articleDetailActions.ts` — Explanation-centric server actions
- `evolution/src/services/variantDetailActions.ts` — Variant-centric server actions

**Explanation-level actions (`articleDetailActions.ts`):**

```typescript
// Aggregates evolution data across all runs for a single explanation.

export async function getArticleOverviewAction(explanationId: string) {
  // Returns: explanation metadata, total runs, best variant info, current HoF standing
}

export async function getArticleRunsAction(explanationId: string) {
  // Returns: all evolution_runs for this explanation_id, with winner variant + final Elo per run
  // Uses existing getEvolutionRunsAction({ explanationId }) internally
}

export async function getArticleEloTimelineAction(explanationId: string) {
  // Returns: cross-run Elo progression — best variant Elo per run, ordered by run date
  // Combines evolution_variants (is_winner=true) from all runs
}

export async function getArticleAgentAttributionAction(explanationId: string) {
  // Returns: aggregated agent attribution across all runs
  // Sums agent_attribution from evolution_agent_invocations across all runs for this explanation
}

export async function getArticleVariantsAction(explanationId: string) {
  // Returns: all variants across all runs, with attribution, grouped by run
  // Each variant includes link data: variantId (for variant detail page) + runId (for run detail page)
}

export async function getArticleHallOfFameAction(explanationId: string) {
  // Returns: HoF entries for variants from this explanation's runs
  // Joins evolution_hall_of_fame_entries with evolution_variants on variant content match or run_id
}
```

**Variant-level actions (`variantDetailActions.ts`):**

```typescript
// Deep-dive data for a single variant.

export async function getVariantDetailAction(variantId: string) {
  // Returns: full variant record from evolution_variants
  //   - id, run_id, explanation_id, variant_content, elo_score, generation
  //   - agent_name (strategy), match_count, is_winner, created_at
  //   - elo_attribution (JSONB — gain, ci, zScore)
  // Also resolves: run metadata (status, date), explanation title
}

export async function getVariantParentsAction(variantId: string) {
  // Returns: parent variant(s) with their own metadata + Elo
  // Primary: parent_variant_id from evolution_variants (first parent)
  // Extended: full parentIds[] from checkpoint state_snapshot if available
  // Each parent includes variantId for linking to its own variant detail page
}

export async function getVariantChildrenAction(variantId: string) {
  // Returns: all variants that list this variant as parent_variant_id
  // Enables "what was derived from this variant?" navigation
  // Each child includes variantId for linking to its variant detail page
}

export async function getVariantMatchHistoryAction(variantId: string) {
  // Returns: all pairwise match results involving this variant
  // Source: checkpoint state_snapshot match records or reconstruction from Elo trajectory
  // Each opponent includes variantId for linking
}

export async function getVariantLineageChainAction(variantId: string) {
  // Returns: full ancestor chain (variant → parent → grandparent → ... → root)
  // Reuses logic from getExplorerArticleDetailAction (10-ancestor chain)
  // Each ancestor includes variantId for linking
}
```

**Files to modify:**
- `evolution/src/lib/utils/evolutionUrls.ts` — Add `buildArticleUrl(explanationId)` and `buildVariantDetailUrl(variantId)` URL builders

```typescript
// In evolutionUrls.ts
export function buildArticleUrl(explanationId: string): string {
  return `/admin/quality/evolution/article/${explanationId}`;
}

export function buildVariantDetailUrl(variantId: string): string {
  return `/admin/quality/evolution/variant/${variantId}`;
}
```

**Note on Explorer integration:** The Explorer's `unit=article` mode returns rows keyed by `variant_id`, not `explanation_id`. Each `ExplorerArticleRow` has `id` (variant UUID), `run_id`, and `variant_content_preview`. To link from Explorer to the explanation detail page, we need to resolve `variant → run → explanation_id`. The existing `getExplorerArticleDetailAction` already fetches per-variant data including lineage — we can extend it to also return `explanation_id` from the run.

**Tests:**
- Unit tests for each action (both files) with mocked Supabase responses
- Integration test with seeded test data (2+ runs for same explanation, variants with parent chains)

---

### Phase 4: Explanation Detail Page + Variant Detail Page

**Goal:** Two new pages — explanation detail (cross-run article history) and variant detail (single variant deep-dive).

#### 4A: Explanation Detail Page

**Files to create:**
- `src/app/admin/quality/evolution/article/[explanationId]/page.tsx` — Explanation detail page
- `evolution/src/components/evolution/article/ArticleOverviewCard.tsx` — Header card with article metadata
- `evolution/src/components/evolution/article/ArticleRunsTimeline.tsx` — Visual timeline of runs with Elo progression
- `evolution/src/components/evolution/article/ArticleAgentAttribution.tsx` — Agent performance table with z-score coloring
- `evolution/src/components/evolution/article/ArticleVariantsList.tsx` — Grouped variant list with links to variant detail

**Page layout:**

```
┌──────────────────────────────────────────────┐
│ Breadcrumb: Evolution > Article > {title}    │
├──────────────────────────────────────────────┤
│ ArticleOverviewCard                          │
│  Title | Created | Runs: N | Best Elo: XXXX  │
│  Current content link | HoF rank (if any)    │
├──────────────────────────────────────────────┤
│ Tabs: [Runs] [Attribution] [Variants]        │
├──────────────────────────────────────────────┤
│ Runs tab (default):                          │
│  ArticleRunsTimeline                         │
│   - Timeline cards per run (date, status,    │
│     winner Elo, cost, iterations)            │
│   - Cross-run Elo line chart                 │
│   - Click card → /run/[runId]                │
├──────────────────────────────────────────────┤
│ Attribution tab:                             │
│  ArticleAgentAttribution                     │
│   - Table: Agent | Variants | Avg Gain±CI   │
│   - Z-score color coding per row             │
│   - Expandable: per-variant links            │
│     → /variant/[variantId] for each          │
├──────────────────────────────────────────────┤
│ Variants tab:                                │
│  ArticleVariantsList                         │
│   - Grouped by run, sorted by Elo desc       │
│   - Each: shortId, Elo, agent, generation,   │
│     attribution badge, is_winner indicator    │
│   - Click variant → /variant/[variantId]     │
│   - Click run group header → /run/[runId]    │
└──────────────────────────────────────────────┘
```

#### 4B: Variant Detail Page

**Files to create:**
- `src/app/admin/quality/evolution/variant/[variantId]/page.tsx` — Variant detail page
- `evolution/src/components/evolution/variant/VariantOverviewCard.tsx` — Header with variant metadata + attribution
- `evolution/src/components/evolution/variant/VariantContentSection.tsx` — Full variant text with diff against parent
- `evolution/src/components/evolution/variant/VariantLineageSection.tsx` — Parent/child navigation with lineage chain
- `evolution/src/components/evolution/variant/VariantMatchHistory.tsx` — Match results table

**Page layout:**

```
┌──────────────────────────────────────────────┐
│ Breadcrumb: Evolution > Article > {title}    │
│             > Run #{shortRunId} > Variant    │
│             #{shortId}                       │
├──────────────────────────────────────────────┤
│ VariantOverviewCard                          │
│  ShortId | Elo: XXXX | Agent: {name}        │
│  Generation: N | Iteration Born: N           │
│  Attribution: +45 ± 111 (z=0.4, grey)       │
│  🏆 Winner (if is_winner)                    │
│  Links: [View Run] [View Article]            │
├──────────────────────────────────────────────┤
│ VariantContentSection                        │
│  Full variant text (scrollable)              │
│  [Toggle: Show diff against parent]          │
│   - Side-by-side or unified diff view        │
├──────────────────────────────────────────────┤
│ VariantLineageSection                        │
│  Parents:                                    │
│   - Parent A: #{shortId} Elo=XXXX → link     │
│   - Parent B: #{shortId} Elo=XXXX → link     │
│  Children (derived from this variant):       │
│   - Child X: #{shortId} Elo=XXXX → link      │
│   - Child Y: #{shortId} Elo=XXXX → link      │
│  Ancestor chain: pill trail                  │
│   [root] → [gen1] → [gen2] → [this]         │
│   Each pill links to /variant/[id]           │
├──────────────────────────────────────────────┤
│ VariantMatchHistory                          │
│  Table: Opponent | Result | Confidence %     │
│  Each opponent links to /variant/[id]        │
└──────────────────────────────────────────────┘
```

**Tests:**
- Unit tests for each component (both pages) with mocked data
- E2E test: navigate from runs table → article detail → variant detail, verify all sections render
- E2E test: variant detail parent/child links navigate correctly

---

### Phase 5: Navigation Links (Bidirectional)

**Goal:** Wire up navigation so users can move between explanation, run, and variant views from all relevant entry points. Two directions: links TO explanation detail, and links TO variant detail.

#### Links TO Explanation Detail (`/admin/quality/evolution/article/[explanationId]`)

| Source | Component | Current Behavior | Change |
|--------|-----------|-----------------|--------|
| **RunsTable** explanation column | `RunsTable.tsx` (base column, ~line 62) | `buildExplanationUrl()` → public `/results?explanation_id={id}` | Add second link icon: `buildArticleUrl()` → explanation detail |
| **Run detail** header | `run/[runId]/page.tsx` (~line 299) | Gold link via `buildExplanationUrl()` → public page | Add "Article History" link via `buildArticleUrl()` alongside existing public link |
| **Explorer ArticleTable** content | `explorer/page.tsx` (~line 1010) | `variant_content_preview` as plain text, 60-char truncated | Make clickable → explanation detail (requires joining variant → run → explanation_id) |
| **HoF detail** leaderboard | `hall-of-fame/[topicId]/page.tsx` (~line 752) | "↗ Run" link → `/run/[runId]` for evolution entries | Add "↗ Article" link → explanation detail |
| **HoF "Add from Run"** dialog | `hall-of-fame/[topicId]/page.tsx` (~line 458) | Explanation icon → public `/results` page | Also link to explanation detail |
| **Variant detail** page (new) | `VariantOverviewCard.tsx` | N/A | "View Article" link in overview card |
| **Strategies** perf table | `strategies/page.tsx` (~line 659) | `buildExplanationUrl()` → public page | Add explanation detail link alongside |
| **Prompts** perf table | `prompts/page.tsx` (~line 599) | `buildExplanationUrl()` → public page | Add explanation detail link alongside |

#### Links TO Variant Detail (`/admin/quality/evolution/variant/[variantId]`)

| Source | Component | Current Behavior | Change |
|--------|-----------|-----------------|--------|
| **VariantsTab** row | `VariantsTab.tsx` (~line 176) | Row click toggles inline expand; "Why this score?" opens `VariantDetailPanel` | Add "Full View" icon/link → variant detail page |
| **VariantDetailPanel** parent IDs | `VariantDetailPanel.tsx` (~line 136) | Parent IDs shown as text with "show diff" toggle | Make parent IDs use `ShortId` with link → variant detail |
| **VariantDetailPanel** match opponents | `VariantDetailPanel.tsx` (~line 115) | Opponent `ShortId` → `?tab=variants&variant={id}` (same-page scroll) | Change to `buildVariantDetailUrl()` → variant detail page |
| **ShortId** component | `shared.tsx` (~line 75) | When `runId` prop set, links to `buildVariantUrl(runId, id)` → `?tab=variants&variant={id}` | Add `variantDetailLink` prop that uses `buildVariantDetailUrl()` instead |
| **LineageTab** DAG nodes | `LineageTab.tsx` (~line 160) | Click shows `VariantCard` side panel with ID, Elo, strategy — no outbound links | Add "View Details" link in `VariantCard` → variant detail |
| **TimelineTab** new variant IDs | `TimelineTab.tsx` (AgentDetailPanel ~line 378) | `ShortId` links to `?tab=variants&variant={id}` | Update to use variant detail page link |
| **Explorer ArticleDetailPanel** lineage | `explorer/page.tsx` (~line 1228) | Ancestor chain as gen/agent/preview pills — display only | Make each pill clickable → variant detail |
| **Explanation detail** variants tab (new) | `ArticleVariantsList.tsx` | N/A | Each variant row → variant detail |
| **Explanation detail** attribution tab (new) | `ArticleAgentAttribution.tsx` | N/A | Per-variant breakdown → variant detail |
| **Variant detail** parents/children (new) | `VariantLineageSection.tsx` | N/A | Each parent/child → variant detail (recursive) |
| **Variant detail** match opponents (new) | `VariantMatchHistory.tsx` | N/A | Each opponent → variant detail |

#### Run ↔ Explanation Link

| Source | Component | Change |
|--------|-----------|--------|
| **Run detail** header/breadcrumb | `run/[runId]/page.tsx` (~line 297) | Add explanation detail link for `run.explanation_id` alongside existing public link |
| **Explanation detail** runs tab | `ArticleRunsTimeline.tsx` | Each run card links to `buildRunUrl(runId)` — already planned in Phase 4 |
| **Evolution Runs** page variant modal | `evolution/page.tsx` (variant panel ~line 557) | Modal shows run explanation link to public page; add explanation detail link |

#### `ShortId` Component Update

The `ShortId` shared component (used throughout the codebase) currently auto-links to `?tab=variants&variant={id}` when a `runId` prop is provided. For Phase 5, add a `useVariantDetailLink` boolean prop:

```tsx
// In shared.tsx ShortId component
// When useVariantDetailLink=true: link to /variant/[id]
// When false (default): preserve existing ?tab=variants&variant={id} behavior
```

This avoids a breaking change while enabling the new navigation pattern where desired.

#### URL Builder Updates

```typescript
// In evolutionUrls.ts — add alongside existing builders

// Replaces the orphaned buildVariantUrl(runId, variantId) for new navigation
export function buildVariantDetailUrl(variantId: string): string {
  return `/admin/quality/evolution/variant/${variantId}`;
}

export function buildArticleUrl(explanationId: string | number): string {
  return `/admin/quality/evolution/article/${explanationId}`;
}
```

Note: The existing `buildVariantUrl(runId, variantId)` (which returns `?tab=variants&variant={id}`) should be kept for backward compatibility but is effectively superseded by `buildVariantDetailUrl()`.

**Files to modify:**
- `evolution/src/lib/utils/evolutionUrls.ts` — Add `buildArticleUrl`, `buildVariantDetailUrl`
- `evolution/src/components/evolution/shared.tsx` — Update `ShortId` to support variant detail linking
- `evolution/src/components/evolution/RunsTable.tsx` — Add explanation detail link in explanation column
- `src/app/admin/quality/evolution/page.tsx` — Add explanation detail link in variant modal
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` — Add explanation detail link in header
- `src/app/admin/quality/explorer/page.tsx` — Make content preview clickable → explanation detail; make lineage pills → variant detail
- `evolution/src/components/evolution/tabs/VariantsTab.tsx` — Add variant detail "Full View" link; update parent ID linking
- `evolution/src/components/evolution/tabs/LineageTab.tsx` — Add "View Details" link in VariantCard side panel
- `evolution/src/components/evolution/tabs/TimelineTab.tsx` — Update variant ShortId links to use variant detail
- `evolution/src/components/evolution/VariantDetailPanel.tsx` — Update parent IDs and match opponent links
- `src/app/admin/quality/hall-of-fame/[topicId]/page.tsx` — Add explanation detail link
- `evolution/src/components/evolution/EvolutionBreadcrumb.tsx` — Support article-level breadcrumb segment

**Tests:**
- E2E tests: click from runs table, run detail, explorer, variants tab, lineage DAG, timeline, and HoF
- E2E test: variant detail parent/child/opponent links navigate correctly
- E2E test: breadcrumb navigation works at all levels (evolution → article → run → variant)
- Unit test: `ShortId` renders correct link type based on `useVariantDetailLink` prop

---

### Phase 6: Polish & Documentation

**Goal:** Final polish, edge cases, documentation updates.

**Work:**
- Handle edge cases: articles with 0 runs, runs with 0 variants, missing parent ratings
- Loading states and error boundaries for all new components
- Empty state messages (e.g., "No evolution runs for this article yet")
- Update all relevant docs (see Documentation Updates section)

## Testing

### Unit Tests
| Test File | What It Tests |
|-----------|--------------|
| `evolution/src/lib/core/__tests__/eloAttribution.test.ts` | `computeEloAttribution` (0/1/2 parents, sigma edge cases), `aggregateByAgent` |
| `evolution/src/components/evolution/__tests__/AttributionBadge.test.tsx` | Z-score color thresholds, display format |
| `evolution/src/components/evolution/article/__tests__/ArticleOverviewCard.test.tsx` | Metadata rendering, HoF badge |
| `evolution/src/components/evolution/article/__tests__/ArticleRunsTimeline.test.tsx` | Run cards, Elo chart data |
| `evolution/src/components/evolution/article/__tests__/ArticleAgentAttribution.test.tsx` | Agent table, z-score coloring, expand/collapse, variant links |
| `evolution/src/components/evolution/article/__tests__/ArticleVariantsList.test.tsx` | Grouping by run, sorting, attribution badge, variant detail links |
| `evolution/src/components/evolution/variant/__tests__/VariantOverviewCard.test.tsx` | Metadata rendering, attribution badge, run/article links |
| `evolution/src/components/evolution/variant/__tests__/VariantContentSection.test.tsx` | Content display, diff toggle, parent diff rendering |
| `evolution/src/components/evolution/variant/__tests__/VariantLineageSection.test.tsx` | Parent/child links, ancestor chain pills, navigation |
| `evolution/src/components/evolution/variant/__tests__/VariantMatchHistory.test.tsx` | Match table, opponent links, W/L display |
| `evolution/src/services/__tests__/articleDetailActions.test.ts` | All 6 explanation-level actions with mocked DB |
| `evolution/src/services/__tests__/variantDetailActions.test.ts` | All 5 variant-level actions with mocked DB |

### Integration Tests
| Test | What It Tests |
|------|--------------|
| Attribution persistence | Pipeline run → variants have `elo_attribution` populated |
| Cross-run aggregation | 2 runs for same explanation → explanation detail shows both |
| Variant parent/child links | Variant with known parent → parent/child actions return correct data |

### E2E Tests
| Test | What It Tests |
|------|--------------|
| Explanation detail navigation | Runs table → article link → page loads with correct data |
| Explanation detail tabs | All 3 tabs render and show appropriate content |
| Variant detail navigation | Explanation detail → variant link → variant detail loads |
| Variant detail sections | Content, lineage, match history all render |
| Variant lineage navigation | Variant detail → parent link → parent variant detail loads |
| Attribution display | TimelineTab and VariantsTab show z-score colored attribution |
| Navigation links (to explanation) | runs table, run detail, explorer, HoF, variant detail → explanation detail |
| Navigation links (to variant) | VariantsTab, LineageTab, TimelineTab, explanation detail → variant detail |
| Breadcrumb navigation | Evolution → Article → Run → Variant breadcrumbs work at all levels |

### Manual Verification (staging)
- Run evolution pipeline on staging for an article with 2+ existing runs
- Verify attribution numbers are reasonable (creating agents get credit, ranking agents show N/A)
- Verify explanation detail page aggregates all runs correctly
- Verify variant detail page shows content, parents, children, matches
- Navigate the full loop: runs table → explanation → variant → parent variant → back to explanation
- Verify z-score coloring matches expectations (grey for uncertain, green/red for significant)

## Documentation Updates
The following docs were identified as relevant and will need updates:
- `evolution/docs/evolution/visualization.md` — Add article detail view section, update navigation map
- `evolution/docs/evolution/data_model.md` — Document `elo_attribution` column, `EloAttribution` interface (already updated with Explanation vs Variant terminology section)
- `evolution/docs/evolution/rating_and_comparison.md` — Add creator-based attribution section, confidence intervals explanation
- `evolution/docs/evolution/reference.md` — Add new server actions, new page route, new URL builder
- `evolution/docs/evolution/README.md` — Add link to article detail view docs
- `evolution/docs/evolution/architecture.md` — Mention article-centric view in visualization layer
- `docs/feature_deep_dives/article_detail_view.md` — New feature deep dive doc (create)
