# Clean Up Flow Agent Display Research

## Problem Statement
The flow critique agent appears in the evolution dashboard but lacks proper visual treatment. It renders with a default grey color in the Timeline tab (missing from AGENT_PALETTE) and shows confusing 0-variant/null-Elo rows in the ROI leaderboard since it's a critique-only agent that doesn't generate variants. Additionally, no agent documentation exists for the flow critique under docs/evolution/. This fix will clean up the dashboard display and add missing documentation.

## Requirements (from GH Issue #393)
1. Add flowCritique color to AGENT_PALETTE in TimelineTab.tsx
2. Fix ROI leaderboard showing confusing 0-variants/null-Elo for critique-only agents
3. Add flow critique agent documentation (no existing doc found under docs/evolution/)
4. Update visualization.md to document flow critique in Timeline agent table

## High Level Summary

The flow critique is a standalone function (`runFlowCritiques()`) in pipeline.ts — not a `PipelineAgent` class instance. It scores each variant on 5 flow dimensions (0-5 scale), stores results in `state.allCritiques` and `state.dimensionScores`, but generates zero variants. This creates three dashboard display issues:

1. **Timeline palette**: `AGENT_PALETTE` in TimelineTab.tsx has 9 entries but 13 agent names exist in checkpoint data. `flowCritique` (plus `treeSearch`, `sectionDecomposition`, `outlineGeneration`) all fall back to `var(--text-muted)` grey.
2. **ROI leaderboard**: `persistAgentMetrics()` upserts a row with `variants_generated=0, avg_elo=null, elo_per_dollar=null` because no variants have strategy mapped to `flowCritique` via `getAgentForStrategy()`. The leaderboard in `AgentROILeaderboard.tsx` queries `elo_per_dollar` — null values produce confusing rows.
3. **Budget tab**: Flow critique correctly appears as a bar in the agent cost breakdown (via `llmCallTracking` with `call_source = 'evolution_flowCritique'`). This works as expected.

## Detailed Findings

### 1. AGENT_PALETTE (TimelineTab.tsx:12-23)

```typescript
const AGENT_PALETTE: Record<string, string> = {
  generation: '#3b82f6',        // blue
  calibration: '#22c55e',       // green
  evolution: '#a855f7',         // purple
  reflection: '#f97316',        // orange
  iterativeEditing: '#ec4899',  // pink
  debate: '#14b8a6',            // teal
  proximity: '#eab308',         // yellow
  metaReview: '#6366f1',        // indigo
  tournament: '#ef4444',        // red
};
```

**Fallback behavior** (TimelineTab.tsx:224):
```typescript
style={{ backgroundColor: AGENT_PALETTE[agent.name] ?? 'var(--text-muted)' }}
```

**Missing agents** (4 of 13 checkpoint agent names lack palette entries):
- `treeSearch`
- `sectionDecomposition`
- `outlineGeneration`
- `flowCritique`

**Separate palette**: `STRATEGY_PALETTE` in VariantCard.tsx:5-19 maps generation strategies (not agents) to colors — used by EloTab, LineageGraph, VariantCard.

### 2. ROI Leaderboard

**Component**: `src/app/admin/quality/optimization/_components/AgentROILeaderboard.tsx`
- Table with columns: Agent name, avg cost/call, avg Elo gain, Elo/$, sample size
- Sorted by `avgEloPerDollar` descending
- Shows insights at bottom (top agent efficiency, low-performer warning)

**Data source**: `getAgentROILeaderboardAction()` in `src/lib/services/eloBudgetActions.ts:53-107`
- Queries `evolution_run_agent_metrics` table
- Aggregates by `agent_name`: avgCostUsd, avgEloGain, avgEloPerDollar, sampleSize
- Min sample size filter (default 1)

**Metrics persistence**: `persistAgentMetrics()` in `pipeline.ts:243-279`
- Iterates `costTracker.getAllAgentCosts()` (includes flowCritique)
- For each agent, filters pool by `getAgentForStrategy(v.strategy) === agentName`
- flowCritique → 0 matching variants → `variants_generated=0, avg_elo=null, elo_per_dollar=null`

**Strategy-to-agent mapping**: `STRATEGY_TO_AGENT` + `getAgentForStrategy()` in pipeline.ts:220-241
- Static map for 11 strategies → agent names
- Dynamic prefix matching for `critique_edit_*` → iterativeEditing, `section_decomposition_*` → sectionDecomposition
- No entry for flowCritique (it doesn't produce variants with any strategy)

### 3. Flow Critique Pipeline Implementation

**Entry point**: pipeline.ts:862-880
- Runs if `config.runReflection && options.featureFlags?.flowCritiqueEnabled === true`
- Executes after quality critique (reflection), before editing agents
- Checkpoint: `persistCheckpoint(runId, ctx.state, 'flowCritique', phase, logger)`

**runFlowCritiques()**: pipeline.ts:1064-1127
- Iterates all variants in pool
- Skips variants already critiqued (by checking scale === '0-5')
- For each uncritiqued variant:
  - Builds prompt via `buildFlowCritiquePrompt(variant.text)`
  - Calls LLM with agent name `'flowCritique'`
  - Parses response via `parseFlowCritiqueResponse()`
  - Creates `Critique` with `scale: '0-5'` and appends to `state.allCritiques`
  - Writes flow scores to `state.dimensionScores[variantId]['flow:${dim}']`
- Budget cap: $0.05 (5% of $5.00 default)
- Returns `{ critiqued: number, costUsd: number }`

**Feature flag**: `evolution_flow_critique_enabled` in featureFlags.ts:25,38,51 (default: false)

### 4. Flow Rubric (flowRubric.ts)

**5 Flow Dimensions** (lines 19-25):
| Dimension | What It Measures |
|-----------|-----------------|
| local_cohesion | Sentence-to-sentence glue |
| global_coherence | Paragraph arc and argument flow |
| transition_quality | Transitions between paragraphs |
| rhythm_variety | Sentence lengths and structure variation |
| redundancy | Information repetition detection |

**Key functions**:
- `buildFlowCritiquePrompt(text)` — per-variant absolute scoring prompt (lines 149-180)
- `parseFlowCritiqueResponse(response)` — returns `FlowCritiqueResult` with scores + friction sentences (lines 187-219)
- `buildFlowComparisonPrompt(textA, textB)` — pairwise A/B flow comparison (lines 29-66)
- `parseFlowComparisonResponse(response)` — returns winner, dimension scores, confidence, friction spots (lines 76-132)
- `normalizeScore(score, scale)` — normalizes quality (1-10) and flow (0-5) to [0,1] (lines 264-278)
- `getFlowCritiqueForVariant(id, critiques)` — retrieves flow critique by scale='0-5' filter (lines 280-293)
- `getWeakestDimensionAcrossCritiques(quality, flow?)` — cross-scale weakness targeting for editing agents (lines 295-335)

**Flow comparison mode**: `compareFlowWithBiasMitigation()` in pairwiseRanker.ts:265-331
- Position-bias mitigation (A→B then B→A in parallel)
- Friction spots stored on `Match.frictionSpots` (types.ts:103-104)

### 5. Data Storage

**Critique interface** (types.ts:70-79):
- `scale?: '1-10' | '0-5'` distinguishes quality (default 1-10) from flow (0-5) critiques
- Friction sentences stored in `badExamples` map
- Both quality + flow critiques coexist in `state.allCritiques` array

**Dimension scores**: `state.dimensionScores[variantId]` contains both:
- Quality keys: `clarity`, `engagement`, `precision`, `voice_fidelity`, `conciseness`
- Flow keys: `flow:local_cohesion`, `flow:global_coherence`, etc.

### 6. Agent Documentation Patterns

**Existing docs** in `docs/evolution/agents/`: overview.md, generation.md, editing.md, tree_search.md, support.md

**Template structure** for support/critique agents (closest parallel: MetaReviewAgent in support.md):
- 1-2 sentence intro
- Algorithm/workflow explanation
- What state it reads/writes
- Config + cost estimate + budget cap reference
- Phase declaration (COMPETITION only)
- Feature flag reference
- Key files table
- Related docs cross-references

**overview.md** contains an agent interaction table showing reads/writes per agent. Flow critique would need to be added there.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/evolution/visualization.md
- docs/evolution/rating_and_comparison.md

### Agent Docs (patterns research)
- docs/evolution/agents/overview.md
- docs/evolution/agents/support.md
- docs/evolution/agents/editing.md
- docs/evolution/README.md

## Code Files Read
- src/components/evolution/tabs/TimelineTab.tsx (AGENT_PALETTE, agent rendering)
- src/components/evolution/tabs/BudgetTab.tsx (agent cost breakdown)
- src/components/evolution/VariantCard.tsx (STRATEGY_PALETTE)
- src/app/admin/quality/optimization/_components/AgentROILeaderboard.tsx (ROI leaderboard)
- src/lib/services/eloBudgetActions.ts (getAgentROILeaderboardAction)
- src/lib/services/evolutionVisualizationActions.ts (timeline/budget data)
- src/lib/evolution/core/pipeline.ts (persistAgentMetrics, runFlowCritiques, STRATEGY_TO_AGENT)
- src/lib/evolution/core/featureFlags.ts (flowCritiqueEnabled)
- src/lib/evolution/flowRubric.ts (flow dimensions, prompts, parsing)
- src/lib/evolution/pairwiseRanker.ts (flow comparison with bias mitigation)
- src/lib/evolution/core/types.ts (Critique, Match interfaces)
