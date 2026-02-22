# Fix Task Agent Breakdowns Research

## Problem Statement
The evolution pipeline's explorer task view and run timeline lack agent-level execution detail. Users cannot see what individual agents did per iteration, their inputs/outputs, or agent-specific metrics (e.g., iterative editing rounds, calibration match results). This project adds structured per-agent-invocation tracking and type-specific detail views so users can drill into exactly what each agent did during each call.

## Requirements (from GH Issue #405)
1. Per-agent-invocation records within each run iteration (separate entries if called multiple times)
2. Each record captures inputs, outputs, and agent-specific metadata
3. Detailed drill-down views per agent type:
   - IterativeEditing: rounds, per-round output, Elo changes
   - Calibration/Tournament: matches run, Elo impact
   - Generation: variants produced, strategies used
   - Reflection: critique dimensions, scores
   - Debate: transcript, synthesis result
   - etc.
4. Accessible from both explorer task view and run timeline view

## Design Requirement: Full Depth Visibility

**All four data tiers must be surfaced in agent drill-down views**, including Tier 4 (ephemeral in-memory data). The goal is a detailed view of what every agent type is doing — not just summaries or counts, but the full execution trace: opponent selection logic, per-cycle edit targets and judge verdicts, creative exploration triggers, format validation issues, raw strategy outcomes, early exit decisions, etc. Every piece of structured data an agent produces during execution should be capturable and displayable in its type-specific detail panel.

This means agent code changes are required to emit structured execution detail records alongside the existing `AgentResult` return values.

---

## High Level Summary

The codebase has three existing views showing agent-level data — but none provide drill-down into what a specific agent *did* during a specific invocation. The Timeline tab (`TimelineTab.tsx`) shows per-agent-per-iteration summary metrics (cost, variants added, matches played, Elo changes) derived from checkpoint diffing, but the expandable detail panel is limited to counts and short ID badges. The Explorer task view (`TaskTable` in `page.tsx`) shows per-agent *aggregated* metrics from `evolution_run_agent_metrics` (cost, variants, avg Elo, efficiency) but with no link back to individual executions. The Logs tab provides raw structured logs filterable by agent, but these are freeform text — not structured execution records.

**The core gap**: Agents produce rich structured data during execution (edit cycles, match results, critique scores, debate transcripts, tree search paths) that is either (a) embedded in the serialized `PipelineState` checkpoint blob (not queryable), (b) logged as freeform text (not structured), or (c) discarded entirely (transient in-memory data). There is no dedicated per-agent-invocation record that captures structured inputs, outputs, and type-specific metadata in a queryable form.

---

## Current State: Three Agent Views

### 1. Timeline Tab (Run Detail Page)

**File**: `src/components/evolution/tabs/TimelineTab.tsx`
**Data source**: `getEvolutionRunTimelineAction` in `evolutionVisualizationActions.ts`

Shows per-iteration breakdown with per-agent rows. Each agent row displays:
- Agent name (color-coded, 13 agent types with hardcoded palette)
- Summary stats: `+N variants`, `N matches`, `$X.XXX cost`
- Quick-link buttons: "Logs" (cross-links to LogsTab with iteration+agent filter), "Details" (expand)

**Expandable AgentDetailPanel** (lines 32-134) shows:
| Metric | Display |
|--------|---------|
| Variants Added | Count |
| Matches Played | Count |
| Cost | `$X.XXXX` |
| Diversity After | Decimal score or `—` |
| Critiques Added | Count (if > 0) |
| Debates Added | Count (if > 0) |
| Meta Feedback | `✓ Populated` badge |
| New Variant IDs | Short ID badges (first 8 chars), max 10 shown |
| Elo Changes | Per-variant delta (`+100`, `-50`), limited to 10 |
| Error | Error message if agent failed |

**How timeline data is computed** (`evolutionVisualizationActions.ts` lines 334-490):
- Loads ALL checkpoints per iteration in execution order
- Diffs sequential checkpoints to compute per-agent metrics
- Attributes cost via LLM call tracking (time-window correlation)
- Builds per-agent Elo delta map from rating snapshots
- Counts new variants, critiques, debates via checkpoint diffing

**What's missing**: No drill-down from agent row to agent-specific detail page. No structured view of what the agent actually *did* (e.g., which edit targets were attempted, which matches were played, what the debate transcript contained).

### 2. Explorer Task View

**File**: `src/app/admin/quality/explorer/page.tsx` → TaskTable (lines 924-974)
**Data source**: `getUnifiedExplorerAction(filters, 'task')` in `unifiedExplorerActions.ts`

Shows agent-centric rows from `evolution_run_agent_metrics` table:
| Column | Source |
|--------|--------|
| Agent | `agent_name` |
| Prompt | Enriched from `evolution_hall_of_fame_topics` |
| Cost | `cost_usd` |
| Variants | `variants_generated` |
| Avg Elo | `avg_elo` |
| Elo Gain | `elo_gain` (avg_elo - 25) |
| Elo/Dollar | `elo_per_dollar` |
| Run | Link to run detail |

**What's missing**: This is an aggregate-only view. No link from agent row to per-invocation detail. No way to see *what* a specific agent did in a specific run/iteration — only the final aggregated metrics.

### 3. Logs Tab

**File**: `src/components/evolution/tabs/LogsTab.tsx`
**Data source**: `getEvolutionRunLogsAction` in `evolutionActions.ts`

Filterable by: level, agent_name, iteration. Auto-refreshes during active runs.

**Log entry structure** (from `evolution_run_logs` table):
```typescript
{ id, created_at, level, agent_name, iteration, variant_id, message, context: JSONB }
```

**What's missing**: Logs are freeform text, not structured execution records. No aggregation by agent. No variant_id filtering UI. Cannot answer "how many edit cycles ran?" without parsing log messages.

---

## Current Data Capture Per Agent

### AgentResult Interface (`types.ts` lines 117-127)

```typescript
interface AgentResult {
  agentType: string;
  success: boolean;
  costUsd: number;
  error?: string;
  variantsAdded?: number;
  matchesPlayed?: number;
  convergence?: number;
  skipped?: boolean;
  reason?: string;
}
```

This is the **only** standardized return from all agents. It captures high-level summary but none of the rich internal data.

### What Each Agent Produces Internally (but doesn't persist as structured records)

| Agent | Rich Internal Data (NOT persisted separately) |
|-------|----------------------------------------------|
| **GenerationAgent** | Which 3 strategies ran, format validation pass/fail per variant, text lengths |
| **CalibrationRanker** | Per-entrant opponent list, per-match winner/confidence, early exit decisions |
| **Tournament** | Swiss pairing computations, per-round match results, convergence tracking, tiebreaker rounds |
| **IterativeEditingAgent** | Edit cycle count (0-3), per-cycle targets attempted, per-cycle judge verdicts (ACCEPT/REJECT/UNSURE), consecutive rejection count |
| **ReflectionAgent** | Per-variant per-dimension scores (1-10), good/bad examples, improvement notes |
| **DebateAgent** | Full 4-call transcript (Advocate A, Advocate B, Judge verdict, Synthesis), judge reasoning |
| **SectionDecompositionAgent** | Sections parsed, eligible sections, per-section edit results, weakness dimension targeted |
| **EvolutionAgent** | Parent selection, creative exploration triggers, dominant strategy analysis |
| **TreeSearchAgent** | Full tree state (nodes, depths, prune decisions), revision actions per level |
| **OutlineGenerationAgent** | 6-step pipeline with per-step scores (0-1), per-step input/output text |
| **ProximityAgent** | Similarity matrix (sparse), embedding vectors |
| **MetaReviewAgent** | Strategy aggregations, parent→child ordinal deltas, stagnation detection |

### Where Agent Data Ends Up Today

1. **PipelineState (checkpoints)**: Rich data like `allCritiques`, `debateTranscripts`, `treeSearchResults`, `matchHistory` are serialized into the `evolution_checkpoints.state_snapshot` JSONB blob. This data *exists* but is buried in a large opaque JSON blob — not queryable, not indexable, not directly viewable.

2. **evolution_run_agent_metrics**: Only end-of-run aggregate per agent: cost, variants_generated, avg_elo, elo_gain, elo_per_dollar. One row per agent per run — no per-iteration breakdown.

3. **evolution_run_logs**: Freeform text logs with agent_name/iteration cross-linking. Contains useful info but as prose, not structured data.

4. **evolution_variants**: Links variant to agent via `agent_name` column. Stores elo_score, generation, parent lineage. But no record of the *process* that created the variant.

5. **Discarded**: Transient in-memory data (edit targets attempted, judge verdicts, match opponent selections, creative exploration triggers) is logged as text but not persisted structurally.

---

## Pipeline Orchestration Flow

**File**: `src/lib/evolution/core/pipeline.ts`

The main loop (`executeFullPipeline`, lines 863-1007) runs agents sequentially per iteration:

```
FOR each iteration:
  1. state.startNewIteration()
  2. supervisor.beginIteration() — phase detection
  3. Check stopping conditions
  4. Execute agents in phase-gated order:
     Generation → Outline → Reflection → FlowCritique →
     IterativeEditing/TreeSearch → SectionDecomposition →
     Debate → Evolution → Calibration/Tournament →
     Proximity → MetaReview
  5. Checkpoint with supervisor state
```

**Agent execution handler** (`runAgent`, lines 1051-1103):
1. `agent.canExecute(state)` — precondition check
2. `agent.execute(ctx)` — returns AgentResult
3. Log result (success, cost, variants, matches)
4. `persistCheckpoint()` — full state snapshot to DB
5. OTel span with cost_usd, variants_added attributes

**End of run** (`finalizePipelineRun`, lines 377-467):
- `buildRunSummary()` → `evolution_runs.run_summary`
- `persistVariants()` → `evolution_variants`
- `persistAgentMetrics()` → `evolution_run_agent_metrics`
- `computeCostPrediction()` → `evolution_runs.cost_prediction`
- `logger.flush()` → remaining buffered logs

---

## Database Schema Summary

| Table | Agent-Relevant Data |
|-------|-------------------|
| `evolution_checkpoints` | `state_snapshot` JSONB with full serialized PipelineState (pool, ratings, matches, critiques, transcripts). Keyed by (run_id, iteration, last_agent). |
| `evolution_run_agent_metrics` | Per-agent-per-run aggregate: cost_usd, variants_generated, avg_elo, elo_gain, elo_per_dollar. Unique (run_id, agent_name). |
| `evolution_run_logs` | Structured logs: run_id, level, agent_name, iteration, variant_id, message, context JSONB. Indexed by (run_id, created_at), (run_id, iteration), (run_id, agent_name). |
| `evolution_runs` | run_summary JSONB (EvolutionRunSummary V2) with stopReason, topVariants, strategyEffectiveness, metaFeedback. |
| `evolution_variants` | agent_name TEXT, elo_score, generation, parent_variant_id, quality_scores JSONB, cost_usd. |

---

## Cross-Linking & Navigation

**Existing links**:
- Timeline "Logs" button → LogsTab with `?tab=logs&iteration=N&agent=X`
- LogsTab agent chip → filter logs by agent (in-page)
- Explorer article table → run detail via `href="/admin/quality/evolution/run/{id}"`

**Missing links**:
- Agent name → agent-specific execution detail (no such page/panel exists)
- Timeline agent row → structured view of what agent did
- Explorer task row → per-invocation breakdown
- Logs → variant or agent detail correlation

---

## Detailed Per-Agent Surfaceable Data Catalog

This section catalogs every piece of structured data each agent produces during `execute()` that could be surfaced in a per-invocation detail view. Data is categorized by persistence status:
- **Returned**: In the `AgentResult` return value
- **State-persisted**: Written to `PipelineState` (survives in checkpoint JSONB)
- **Logged**: Written via `logger.*()` (in `evolution_run_logs`)
- **Ephemeral**: In-memory only, discarded after execution

---

### 1. GenerationAgent (`generationAgent.ts`)

**Returned** (AgentResult):
| Field | Value |
|-------|-------|
| `agentType` | `'generation'` |
| `success` | boolean |
| `costUsd` | number |
| `variantsAdded` | 0–3 |
| `error` | `'No originalText in state'` or `'All strategies failed'` |

**State-persisted**:
- 1–3 `TextVariation` objects added to pool via `state.addToPool()`:
  - `id` (UUID), `text`, `version` (iteration+1), `parentIds: []`, `strategy` (`'structural_transform'`|`'lexical_simplify'`|`'grounding_enhance'`), `createdAt`, `iterationBorn`

**Logged** (per strategy):
- `debug('Generation call', { strategy, promptLength })`
- `warn('Format rejected', { strategy, issues: string[] })` — validation failures
- `info('Generated variation', { strategy, variationId, textLength })`
- `error('Generation error', { error })` — promise rejections

**Ephemeral** (could be captured):
- 3 prompts constructed by `buildPrompt(strategy, text, feedback)`
- 3 raw LLM completions (before validation)
- 3 `FormatResult` objects: `{ valid: boolean, issues: string[] }`
  - Possible issues: `'Empty text'`, `'Missing H1 title'`, `'Multiple H1 titles'`, `'No section headings'`, `'Contains bullet points'`, etc.
- `Promise.allSettled()` results array (fulfilled/rejected per strategy)
- Whether `metaFeedback.priorityImprovements` was available as input

**Detail view data model**:
```typescript
{
  strategies: Array<{
    name: 'structural_transform' | 'lexical_simplify' | 'grounding_enhance';
    promptLength: number;
    status: 'success' | 'format_rejected' | 'error';
    formatIssues?: string[];
    variantId?: string;
    textLength?: number;
    error?: string;
  }>;
  feedbackUsed: boolean;
  totalCost: number;
}
```

---

### 2. CalibrationRanker (`calibrationRanker.ts`)

**Returned** (AgentResult):
| Field | Value |
|-------|-------|
| `agentType` | `'calibration'` |
| `success` | boolean |
| `costUsd` | number |
| `matchesPlayed` | number |
| `convergence` | average confidence across all matches |

**State-persisted**:
- `Match` objects appended to `state.matchHistory`:
  - `variationA`, `variationB`, `winner`, `confidence` (0–1), `turns: 2`, `dimensionScores: {}`
- `state.ratings` updated per match (OpenSkill mu/sigma)
- `state.matchCounts` incremented per participant

**Logged**:
- `info('Calibration start', { numNewEntrants, poolSize })`
- `debug('Cache hit for calibration comparison', { idA, idB })`
- `debug('Comparison results', { idA, idB, winner, confidence })`
- `debug('Adaptive calibration: early exit after first batch', { entrantId, matchesPlayed })`
- `warn('Missing entrant', { id })`
- `info('Calibration complete', { matchesPlayed, avgConfidence })`

**Ephemeral** (could be captured):
- Per-entrant opponent selection: stratified by quartile (top 2, mid 2, bottom/new 1)
- Per-match `ComparisonResult`: `{ winner: 'A'|'B'|'TIE', confidence, turns: 2 }`
- 2 raw LLM responses per match (bias-mitigated A-vs-B + B-vs-A)
- Per-match agreement level: full (1.0), partial+TIE (0.7), disagreement (0.5), partial-fail (0.3), total-fail (0.0)
- Early exit decisions: per-entrant `allDecisive` flag after first batch
- Before/after rating pairs per match: `{ mu, sigma }` → `{ mu', sigma' }`
- Cache hit/miss status per comparison

**Detail view data model**:
```typescript
{
  entrants: Array<{
    variantId: string;
    opponents: string[];
    matches: Array<{
      opponentId: string;
      winner: string;
      confidence: number;
      cacheHit: boolean;
    }>;
    earlyExit: boolean;
    ratingBefore: { mu: number; sigma: number };
    ratingAfter: { mu: number; sigma: number };
  }>;
  avgConfidence: number;
  totalMatches: number;
  totalCost: number;
}
```

---

### 3. Tournament (`tournament.ts`)

**Returned** (AgentResult):
| Field | Value |
|-------|-------|
| `agentType` | `'tournament'` |
| `success` | boolean |
| `costUsd` | number |
| `matchesPlayed` | number |
| `convergence` | `1 - (avgSigma / (25/3))` normalized 0–1 |

**State-persisted**:
- `Match` objects appended to `state.matchHistory`:
  - Includes `dimensionScores: Record<string, string>` (per-dimension A/B/TIE winners)
  - Includes optional `frictionSpots: { a: string[]; b: string[] }` (if flowCritique enabled)
  - `turns`: 2 (standard) or 3 (with tiebreaker)
- `state.ratings` updated (winner boost / loser decrease, or draw convergence for confidence < 0.3)
- `state.matchCounts` incremented

**Logged**:
- `info('Tournament start', { poolSize, budgetPressure, maxComparisons })`
- `debug('Comparison results', { idA, idB, round1, round2Normalized })`
- `info('Tournament converged/complete', { round, comparisons, matchesPlayed, convergenceMetric })`
- `warn('Flow comparison round failed', { round, error })`

**Ephemeral** (could be captured):
- **Budget pressure tier**: low (<0.5) / medium (0.5–0.8) / high (≥0.8) with config:
  - `{ multiTurnThreshold, maxMultiTurnDebates, maxComparisons }`
- **Per-round Swiss pairings**: `Array<[TextVariation, TextVariation]>` with info-theoretic scoring:
  - `outcomeUncertainty`, `sigmaWeight`, `topKBoost` per candidate pair
- **Multi-turn decisions**: `needsMultiTurn()` for top-quartile close matches
- **Per-match tiebreaker data**: 3rd LLM call, merged dimension scores, adjusted confidence
- **Flow comparison results**: per-pair `FlowComparisonResult` with `frictionSpotsA/B`, per-dimension winners
- **Convergence tracking**: `convergenceStreak` counter, `staleRounds` counter
- **Exit reason**: budget exhausted / convergence streak / stale rounds / max rounds
- **Completed pairs set**: prevents rematches

**Detail view data model**:
```typescript
{
  budgetPressure: number;
  budgetTier: 'low' | 'medium' | 'high';
  rounds: Array<{
    roundNumber: number;
    pairs: Array<{ variantA: string; variantB: string }>;
    matches: Array<Match>;
    multiTurnUsed: number;
  }>;
  exitReason: 'budget' | 'convergence' | 'stale' | 'maxRounds';
  convergenceStreak: number;
  staleRounds: number;
  totalComparisons: number;
  flowEnabled: boolean;
  totalCost: number;
}
```

---

### 4. IterativeEditingAgent (`iterativeEditingAgent.ts`)

**Returned** (AgentResult):
| Field | Value |
|-------|-------|
| `agentType` | `'iterativeEditing'` |
| `success` | boolean |
| `costUsd` | number |
| `variantsAdded` | number |

**State-persisted**:
- New `TextVariation` per accepted edit: `strategy: 'critique_edit_{dimension}'` or `'critique_edit_open'`
- Updated `allCritiques` (via inline re-critique after acceptance)

**Logged**:
- `info('Edit accepted', { cycle, target, verdict, confidence })`
- `info('Edit rejected by judge', { cycle, target, verdict, confidence })`
- `warn('Edit failed format validation', { cycle, issues })`
- `info('Quality threshold met|Max consecutive rejections reached', { cycle, consecutiveRejections })`

**Ephemeral** (could be captured):
- **Per-cycle records** (0 to maxCycles, default 3):
  - `EditTarget`: `{ dimension?, description, score?, badExamples?, notes? }`
  - Target source: step-based (OutlineVariant) / rubric-based / flow dimension / open-ended
  - Judge verdict: `{ verdict: 'ACCEPT'|'REJECT', confidence: number }`
  - Edited text (before format validation)
  - Format validation result: `{ valid: boolean, issues: string[] }`
  - Whether edit was accepted or rejected
- **Critique snapshots**: initial + after each acceptance (dimensionScores, goodExamples, badExamples, notes)
- **Flow critique**: separate flow dimension scores (0–5 scale, threshold 3/5)
- **Open review suggestions**: `string[] | null` (2–3 freeform suggestions)
- **Tracking**: `attemptedTargets` Set, `consecutiveRejections` counter
- **Stop reason**: threshold met / max rejections / max cycles / no targets remaining

**Detail view data model**:
```typescript
{
  targetVariantId: string;
  config: { maxCycles: number; maxConsecutiveRejections: number; qualityThreshold: number };
  cycles: Array<{
    cycleNumber: number;
    target: { dimension?: string; description: string; score?: number; source: string };
    verdict: 'ACCEPT' | 'REJECT';
    confidence: number;
    formatValid: boolean;
    formatIssues?: string[];
    newVariantId?: string;
  }>;
  initialCritique: { dimensionScores: Record<string, number> };
  finalCritique?: { dimensionScores: Record<string, number> };
  stopReason: 'threshold_met' | 'max_rejections' | 'max_cycles' | 'no_targets';
  consecutiveRejections: number;
  totalCost: number;
}
```

---

### 5. ReflectionAgent (`reflectionAgent.ts`)

**Returned** (AgentResult):
| Field | Value |
|-------|-------|
| `agentType` | `'reflection'` |
| `success` | boolean (true if critiques.length > 0) |
| `costUsd` | number |
| `error` | `'No variants to critique'` or `'All critiques failed'` |

**State-persisted**:
- `Critique` objects added to `state.allCritiques`:
  - `variationId`, `dimensionScores` (5 dimensions: clarity, engagement, precision, voice_fidelity, conciseness), `goodExamples`, `badExamples`, `notes`, `reviewer: 'llm'`, `scale: '1-10'`
- `state.dimensionScores` updated (flat map keyed by variantId)

**Logged**:
- `info('Reflection start', { numVariants, dimensions })`
- `debug('Critique call', { variantId })`
- `info('Critique generated', { variantId, avgScore })`
- `warn('Critique parse failed', { variantId })`
- `error('Critique error', { error })`
- `info('Reflection complete', { numCritiques })`

**Ephemeral** (could be captured):
- Top 3 variants selected (from `state.getTopByRating(3)`)
- Per-variant raw LLM response (JSON/markdown-wrapped JSON)
- Per-variant `CritiqueResponse` intermediate: `{ scores, good_examples, bad_examples, notes }`
- Per-variant average score (computed but only logged)
- Promise.allSettled results (which succeeded/failed)

**Detail view data model**:
```typescript
{
  variantsCritiqued: Array<{
    variantId: string;
    status: 'success' | 'parse_failed' | 'error';
    avgScore?: number;
    dimensionScores?: Record<string, number>;
    goodExamples?: Record<string, string[]>;
    badExamples?: Record<string, string[]>;
    notes?: Record<string, string>;
    error?: string;
  }>;
  dimensions: string[];
  totalCost: number;
}
```

---

### 6. DebateAgent (`debateAgent.ts`)

**Returned** (AgentResult):
| Field | Value |
|-------|-------|
| `agentType` | `'debate'` |
| `success` | boolean (true only if synthesis created) |
| `costUsd` | number |
| `variantsAdded` | 1 on success |
| `error` | Various: `'Need 2+ rated variants'`, `'Advocate A/B failed'`, `'Judge failed'`, `'Judge response parse failed'`, `'Format invalid: {issues}'` |

**State-persisted**:
- `DebateTranscript` added to `state.debateTranscripts`:
  - `variantAId`, `variantBId`, `turns` (3 entries: advocate_a, advocate_b, judge), `synthesisVariantId`, `iteration`
- Synthesized `TextVariation` added to pool:
  - `strategy: 'debate_synthesis'`, `parentIds: [variantAId, variantBId]`, `version: max(A.version, B.version) + 1`

**Logged**:
- `info('Debate start', { variantAId, variantBId, variantAOrdinal, variantBOrdinal })`
- `info('Judge verdict', { winner, reasoning })`
- `info('Debate synthesis complete', { variantId, textLength, winner })`
- `error/warn` on advocate/judge/synthesis failures

**Ephemeral** (could be captured):
- Parsed `JudgeVerdict`: `{ winner: 'A'|'B'|'tie', reasoning, strengths_from_a: string[], strengths_from_b: string[], improvements: string[] }`
- Format validation result for synthesis text
- Critique context used in prompts (from existing `allCritiques`)
- MetaFeedback priority improvements used in synthesis prompt
- 4 sequential LLM prompts (advocate A, advocate B, judge, synthesis)

**Detail view data model**:
```typescript
{
  variantA: { id: string; ordinal: number };
  variantB: { id: string; ordinal: number };
  transcript: Array<{ role: 'advocate_a' | 'advocate_b' | 'judge'; content: string }>;
  judgeVerdict?: {
    winner: 'A' | 'B' | 'tie';
    reasoning: string;
    strengthsFromA: string[];
    strengthsFromB: string[];
    improvements: string[];
  };
  synthesisVariantId?: string;
  synthesisTextLength?: number;
  formatValid?: boolean;
  formatIssues?: string[];
  failurePoint?: 'advocate_a' | 'advocate_b' | 'judge' | 'parse' | 'format' | 'synthesis';
  totalCost: number;
}
```

---

### 7. SectionDecompositionAgent (`sectionDecompositionAgent.ts`)

**Returned** (AgentResult):
| Field | Value |
|-------|-------|
| `agentType` | `'sectionDecomposition'` |
| `success` | boolean |
| `costUsd` | number |
| `variantsAdded` | 0 or 1 |
| `skipped` | boolean (if no critique/eligible sections/budget) |
| `reason` | `'no critique'` / `'no eligible sections'` / `'budget'` |

**State-persisted**:
- New `TextVariation` (stitched article with improved sections) added to pool
- `state.sectionState` updated with parsed sections and best variations

**Logged**:
- Section count, total sections at parse
- Sections improved, total eligible, weakness dimension at completion
- Format validation issues (warn)

**Ephemeral** (could be captured):
- `ParsedArticle`: `{ sections: ArticleSection[], sectionCount }` (H2-boundary parsing)
- Eligible sections: filtered by ≥100 chars, non-preamble
- `SectionWeakness`: `{ dimension: string, description: string }` from critique
- Per-section edit results: `Map<sectionIndex, improvedMarkdown>`
- Format validation of stitched result

**Detail view data model**:
```typescript
{
  targetVariantId: string;
  weakness: { dimension: string; description: string };
  sections: Array<{
    index: number;
    heading: string | null;
    eligible: boolean;
    improved: boolean;
    charCount: number;
  }>;
  sectionsImproved: number;
  totalEligible: number;
  formatValid: boolean;
  newVariantId?: string;
  totalCost: number;
}
```

---

### 8. EvolutionAgent (`evolvePool.ts`)

**Returned** (AgentResult):
| Field | Value |
|-------|-------|
| `agentType` | `'evolution'` |
| `success` | boolean |
| `costUsd` | number |
| `variantsAdded` | 0–4 |

**State-persisted**:
- 0–4 `TextVariation` objects added to pool with strategies: `'clarity'`, `'structure'`, `'crossover'`, `'creative_exploration'`
- Outline mutations: `OutlineVariant` with mutated outline + expanded text

**Logged**:
- `numParents`, `parentIds` at start
- Per-mutation: `strategy`, `promptLength`
- Format validation issues (warn)
- Strategy-specific errors

**Ephemeral** (could be captured):
- Parent selection: 1–2 high-rated variants
- MetaFeedback `priorityImprovements` used as prompt input
- Creative exploration trigger: 30% random OR low diversity + overrepresented strategies
- `overrepresented`: strategies with count >1.5× average
- Per-mutation `Promise.allSettled` results
- Format validation per mutation

**Detail view data model**:
```typescript
{
  parents: Array<{ id: string; ordinal: number }>;
  mutations: Array<{
    strategy: string;
    status: 'success' | 'format_rejected' | 'error';
    variantId?: string;
    textLength?: number;
    error?: string;
  }>;
  creativeExploration: boolean;
  creativeReason?: 'random' | 'low_diversity';
  overrepresentedStrategies?: string[];
  feedbackUsed: boolean;
  totalCost: number;
}
```

---

### 9. TreeSearchAgent (`treeSearchAgent.ts`)

**Returned** (AgentResult):
| Field | Value |
|-------|-------|
| `agentType` | `'treeSearch'` |
| `success` | boolean |
| `costUsd` | number |
| `variantsAdded` | 0 or 1 |
| `skipped` | boolean |
| `reason` | `'no_suitable_root'` / `'no_critique'` |

**State-persisted**:
- `TreeSearchResult` added to `state.treeSearchResults`:
  - `bestVariantId`, `bestLeafNodeId`, `treeSize`, `maxDepth`, `prunedBranches`, `revisionPath: RevisionAction[]`
- `TreeState` added to `state.treeSearchStates`:
  - `nodes: Record<nodeId, TreeNode>`, `rootNodeId`
  - Each `TreeNode`: `{ id, variantId, parentNodeId, childNodeIds, depth, revisionAction, value, pruned }`
- Best leaf `TextVariation` added to pool (if improved over root)

**Logged**:
- `rootId`, critique availability
- `treeSize`, `maxDepth`, `prunedBranches`, `revisionPath.types`, `variantsAdded`

**Ephemeral** (could be captured):
- Root selection: highest mu among underexplored (sigma ≥ threshold) variants
- `BeamSearchConfig`: `{ beamWidth, branchingFactor, maxDepth }` (defaults: 3, 3, 3)
- Per-level beam candidates with scores
- Pruning decisions per node

**Detail view data model**:
```typescript
{
  rootVariantId: string;
  config: { beamWidth: number; branchingFactor: number; maxDepth: number };
  result: {
    treeSize: number;
    maxDepth: number;
    prunedBranches: number;
    revisionPath: Array<{ type: string; dimension?: string; description: string }>;
  };
  bestLeafVariantId?: string;
  addedToPool: boolean;
  totalCost: number;
}
```

---

### 10. OutlineGenerationAgent (`outlineGenerationAgent.ts`)

**Returned** (AgentResult):
| Field | Value |
|-------|-------|
| `agentType` | `'outlineGeneration'` |
| `success` | boolean |
| `costUsd` | number |
| `variantsAdded` | 1 |

**State-persisted**:
- `OutlineVariant` added to pool (extends TextVariation):
  - `steps: GenerationStep[]`, `outline: string`, `weakestStep: GenerationStepName | null`
  - `strategy: 'outline_generation'`

**Logged**:
- Step-by-step progress: `outline step generating`, `expand step expanding`
- `outlineLength`, `expandLength`
- Final: `variantId`, `weakestStep`, `stepScores` (e.g. `"outline:0.85, expand:0.72"`), `textLength`
- Format validation issues (warn)

**Ephemeral** (could be captured):
- 4 `GenerationStep` objects with per-step input/output/score/cost:
  - `outline` → generate outline
  - `expand` → expand to prose
  - `polish` → polish text
  - `verify` → format validation (score: 1.0 pass, 0.3 fail)
- Weakest step computation (minimum score)
- Fallback behavior (partial variant from last successful step)

**Detail view data model**:
```typescript
{
  steps: Array<{
    name: 'outline' | 'expand' | 'polish' | 'verify';
    score: number;
    costUsd: number;
    inputLength: number;
    outputLength: number;
  }>;
  weakestStep: string | null;
  variantId: string;
  totalCost: number;
}
```

---

### 11. ProximityAgent (`proximityAgent.ts`)

**Returned** (AgentResult):
| Field | Value |
|-------|-------|
| `agentType` | `'proximity'` |
| `success` | boolean |
| `costUsd` | 0 (always — no LLM calls) |

**State-persisted**:
- `state.similarityMatrix`: sparse `Record<variantId, Record<variantId, number>>` (cosine similarities)
- `state.diversityScore`: `1 - mean(top-10 pairwise cosine similarities)` (0–1)

**Logged**:
- `newEntrants` count
- `diversityScore` (3 decimal places)

**Ephemeral** (could be captured):
- Embedding vectors per variant (MD5-based in test mode, char-based in prod)
- New vs existing variant partition
- Top-10 most-similar pairs used for diversity computation

**Detail view data model**:
```typescript
{
  newEntrants: number;
  existingVariants: number;
  diversityScore: number;
  totalPairsComputed: number;
}
```

---

### 12. MetaReviewAgent (`metaReviewAgent.ts`)

**Returned** (AgentResult):
| Field | Value |
|-------|-------|
| `agentType` | `'meta_review'` |
| `success` | boolean |
| `costUsd` | 0 (always — no LLM calls) |

**State-persisted**:
- `state.metaFeedback: MetaFeedback`:
  - `successfulStrategies: string[]` — strategies with above-average ordinal
  - `recurringWeaknesses: string[]` — patterns in bottom-quartile variants
  - `patternsToAvoid: string[]` — strategies with consistent negative parent→child delta (<-3)
  - `priorityImprovements: string[]` — pool gap analysis

**Logged**:
- Count of strategies, weaknesses, failures, priorities

**Ephemeral** (could be captured):
- Per-strategy ordinal averages
- Bottom-quartile variant IDs and their overrepresented strategies
- Per-strategy parent→child ordinal deltas
- Priority triggers: low diversity (<0.3), narrow range (<6), wide range (>30), stagnation (top 3 old), low coverage (<3 strategies)

**Detail view data model**:
```typescript
{
  successfulStrategies: string[];
  recurringWeaknesses: string[];
  patternsToAvoid: string[];
  priorityImprovements: string[];
  analysis: {
    strategyOrdinals: Record<string, number>;
    bottomQuartileCount: number;
    poolDiversity: number;
    ordinalRange: number;
    activeStrategies: number;
    topVariantAge: number;
  };
}
```

---

### 13. Shared Comparison Infrastructure

**Module**: `comparison.ts` + `flowRubric.ts` + `comparisonCache.ts`

Used by: CalibrationRanker, Tournament, IterativeEditingAgent

**Key types**:
- `ComparisonResult`: `{ winner: 'A'|'B'|'TIE', confidence: number, turns: 2 }`
- `FlowComparisonResult`: `{ winner, dimensionScores: Record<string, string>, confidence, frictionSpotsA: string[], frictionSpotsB: string[] }`
- `FlowCritiqueResult`: `{ scores: Record<string, number>, frictionSentences: Record<string, string[]> }` (0–5 scale)
- `CachedMatch`: `{ winnerId, loserId, confidence, isDraw }`

**Quality dimensions** (1–10 scale): clarity, engagement, precision, voice_fidelity, conciseness
**Flow dimensions** (0–5 scale): local_cohesion, global_coherence, transition_quality, rhythm_variety, redundancy

**Cross-scale normalization**: `normalizeScore(score, scale)` maps both to [0, 1] for fair comparison via `getWeakestDimensionAcrossCritiques()`.

---

### Summary: Data Capture Tiers

| Tier | Description | Agents | Capture Effort |
|------|-------------|--------|----------------|
| **Tier 1: Already in state** | Data already persisted in checkpoints — needs extraction, not capture | Matches (Cal/Tourn), Critiques (Reflect), Transcripts (Debate), TreeSearchResults, SectionState | Low — query checkpoint diffs |
| **Tier 2: In AgentResult** | Returned but only partially persisted via `persistAgentMetrics` | All agents (success, cost, variantsAdded, matchesPlayed, convergence) | Low — capture return value |
| **Tier 3: Logged as text** | Available in `evolution_run_logs` but needs parsing | Edit cycles, format rejections, strategy selections, judge verdicts | Medium — structured logging or parse |
| **Tier 4: Ephemeral** | In-memory only, must add capture code | Opponent selection, prompt lengths, raw LLM outputs, early exit decisions, creative triggers | High — code changes in agents |

---

## Capture Mechanism Analysis

### How AgentResult Is Consumed Today

`AgentResult` is consumed in exactly one place — `runAgent()` in `pipeline.ts` (lines 1050–1103):

1. **Line 1071**: `const result = await agent.execute(ctx);`
2. **Lines 1072–1076**: OTel span attributes: `success`, `costUsd`, `variantsAdded`
3. **Lines 1077–1083**: Log: `agent.name`, `success`, `costUsd`, `variantsAdded`, `matchesPlayed`
4. **Line 1084**: `persistCheckpoint()` — saves `ctx.state`, NOT AgentResult
5. **Line 1085**: Returns `result`

**Key finding**: `AgentResult` is used for logging/tracing only. `persistAgentMetrics()` doesn't use it — it derives metrics from `costTracker` and pool state at run finalization. The Timeline also doesn't use it — it rebuilds everything from checkpoint diffs. Adding an optional `executionDetail` field is **safe and backward-compatible**.

**Data loss**: Tournament's `convergence` field and all agents' `skipped`/`reason` fields are logged but never persisted or queryable.

### Proven State Mutation Pattern

Two agents already store rich execution data by mutating `PipelineState` during `execute()`:

1. **DebateAgent** → `state.debateTranscripts.push(transcript)` (full debate turns + judge verdict + synthesis ID)
2. **TreeSearchAgent** → `state.treeSearchResults.push(result)` + `state.treeSearchStates.push(treeState)` (full tree + revision path)

Both are serialized in checkpoints and available for timeline diffing without any pipeline code changes.

### Checkpoint Diffing: Tier 1 Extraction

The Timeline's `diffCheckpoints()` function (`evolutionVisualizationActions.ts:303–323`) already diffs sequential checkpoints per iteration. It currently returns **counts only**:

```typescript
{ variantsAdded, matchesPlayed, eloChanges, critiquesAdded, debatesAdded, diversityScoreAfter, metaFeedbackPopulated }
```

To extract full Tier 1 records, extend with **array slicing**:

```typescript
newMatchDetails: (after.matchHistory ?? []).slice(before?.matchHistory?.length ?? 0),
newCritiqueDetails: (after.allCritiques ?? []).slice(before?.allCritiques?.length ?? 0),
newDebateDetails: (after.debateTranscripts ?? []).slice(before?.debateTranscripts?.length ?? 0),
newTreeSearchResults: (after.treeSearchResults ?? []).slice(before?.treeSearchResults?.length ?? 0),
```

**No agent code changes needed** for Tier 1 data.

### Database Storage Options

**`evolution_run_agent_metrics`** — NOT suitable for per-invocation detail. Has `UNIQUE (run_id, agent_name)` constraint — one row per agent per entire run.

**`evolution_checkpoints`** — Already per-invocation (`UNIQUE (run_id, iteration, last_agent)`). Contains full state but as opaque JSONB. Detail data could be extracted from checkpoint diffs on-demand.

**New table option** — `evolution_agent_invocations`:
- Key: `(run_id, iteration, agent_name)`
- `execution_detail JSONB` — agent-type-specific structured data
- Populated during `runAgent()` after `agent.execute()` returns
- Indexed for drill-down queries

**Existing log approach** — `evolution_run_logs` already has `context JSONB`. Could write a single structured log entry per invocation with the full detail. Downside: mixed with freeform logs, harder to query as first-class records.

### Recommended Capture Strategy

**Two-pronged approach**:
1. **Extend AgentResult** with optional `executionDetail?: Record<string, unknown>` — each agent populates its type-specific detail during execute()
2. **Pipeline captures it** in `runAgent()` after execute() — either persists to new table or stores in state for checkpoint serialization

This avoids the pattern of each agent knowing about state fields for execution tracking (unlike Debate/TreeSearch which store domain data in state).

---

## Tier 4 Ephemeral Data: Exact Capture Points

Exact line numbers where ephemeral data is created in each agent. These are the code locations that need modification to capture Tier 4 data.

### GenerationAgent (`generationAgent.ts`)

| Data | Line(s) | Variable | Capture Strategy |
|------|---------|----------|-----------------|
| Promise.allSettled results (per-strategy success/fail) | 76–88 | `results: PromiseSettledResult[]` | Build detail array after line 88 |
| Format validation per strategy | 81 | `fmtResult: FormatResult` | Capture in inner function, return with result |
| MetaFeedback availability | 71–73 | `feedback: string \| null` | Check `!!feedback` |

### CalibrationRanker (`calibrationRanker.ts`)

| Data | Line(s) | Variable | Capture Strategy |
|------|---------|----------|-----------------|
| Opponent selection (stratified) | 122–132 | `opponentIds`, `validOpponents` | Record per-entrant opponent list |
| Early exit decision | 157–163 | `allDecisive: boolean` | Record per-entrant flag |
| Before/after ratings | 76–98 | `entrantRating`, `newE/newW` | Snapshot before + after in `applyRatingUpdate()` |
| First batch vs remaining batch split | 135–136 | `firstBatch`, `remainingBatch` | Record batch sizes |

### Tournament (`tournament.ts`)

| Data | Line(s) | Variable | Capture Strategy |
|------|---------|----------|-----------------|
| Budget pressure + tier | 203–204 | `budgetPressure`, `budgetCfg` | Capture once at start |
| Swiss pairings per round | 230 | `pairs` | Record pairs array per round |
| Multi-turn decisions | 247–253 | `pairConfigs[].useMultiTurn` | Count per round |
| Exit reason | 225–227, 232–239, 340–351 | Loop break conditions | Set reason flag at each break |
| Convergence/stale tracking | 221–222 | `convergenceStreak`, `staleRounds` | Capture at exit |

### IterativeEditingAgent (`iterativeEditingAgent.ts`)

| Data | Line(s) | Variable | Capture Strategy |
|------|---------|----------|-----------------|
| Edit target selection | 83, 212–275 | `editTarget: EditTarget` | Record per-cycle target |
| Target source (step/rubric/flow/open) | 216–267 | Priority-ordered branches | Tag source type |
| Judge verdict + confidence | 99–102 | `result.verdict`, `result.confidence` | Record per-cycle |
| Stop reason | 71–80 | Threshold/rejection/max checks | Set reason flag |
| Consecutive rejections | 61 | `consecutiveRejections` | Record at exit |
| Attempted targets set | 63 | `attemptedTargets: Set<string>` | Convert to array at exit |

### EvolutionAgent (`evolvePool.ts`)

| Data | Line(s) | Variable | Capture Strategy |
|------|---------|----------|-----------------|
| Parent selection | 195 | `parents: TextVariation[]` | Record parent IDs + ordinals |
| Creative exploration trigger | 265–266 | `shouldTriggerCreativeExploration()` result | Record boolean + reason |
| Overrepresented strategies | 269, 125–141 | `overrepresented: string[]` | Record array |
| Per-mutation success/fail | Promise.allSettled results | `results` | Build detail array |
| Stagnation detection | 144–166 | `isRatingStagnant()` | Record boolean |

### ReflectionAgent (`reflectionAgent.ts`)

| Data | Line(s) | Variable | Capture Strategy |
|------|---------|----------|-----------------|
| Top 3 variant selection | `state.getTopByRating(3)` | Variant IDs | Record selected IDs |
| Per-variant parse success/failure | 141, 144 | Parse/error status | Record per-variant status + avgScore |
| Promise.allSettled results | Line 120 | Individual promise outcomes | Track fulfilled vs rejected count |

### SectionDecompositionAgent (`sectionDecompositionAgent.ts`)

| Data | Line(s) | Variable | Capture Strategy |
|------|---------|----------|-----------------|
| Parsed sections with eligibility | Parse step | `eligible: TextVariation[]` | Record section count + eligible count |
| Weakness dimension selected | From critique | `weakness: SectionWeakness` | Record dimension + description |
| Per-section edit results | Parallel edits | `replacements: Map<index, markdown>` | Record which sections improved |
| Format validation of stitched result | Post-stitch | `fmtResult` | Record valid + issues |

### OutlineGenerationAgent (`outlineGenerationAgent.ts`)

| Data | Line(s) | Variable | Capture Strategy |
|------|---------|----------|-----------------|
| Per-step score/cost | Steps loop | `GenerationStep[]` | Already structured — capture `steps` array |
| Weakest step | Computation | `weakestStep` | Record step name |
| Fallback behavior | Error handling | Whether partial variant used | Record boolean |

### ProximityAgent (`proximityAgent.ts`)

| Data | Line(s) | Variable | Capture Strategy |
|------|---------|----------|-----------------|
| New vs existing partition | Early in execute | `newIds`, `existingIds` | Record counts |
| Total pairs computed | Matrix computation | Pair count | Record count |

### MetaReviewAgent (`metaReviewAgent.ts`)

| Data | Line(s) | Variable | Capture Strategy |
|------|---------|----------|-----------------|
| Per-strategy ordinal averages | `_analyzeStrategies` | `strategyScores: Map` | Record map |
| Bottom-quartile analysis | `_findWeaknesses` | Quartile variant IDs | Record count + overrepresented strategies |
| Parent→child deltas | `_findFailures` | `strategyDeltas: Map` | Record per-strategy avg delta |
| Priority triggers | `_prioritize` | Condition checks | Record which triggers fired |

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/evolution/agents/overview.md
- docs/evolution/architecture.md
- docs/evolution/agents/support.md
- docs/evolution/reference.md
- docs/evolution/agents/generation.md
- docs/evolution/agents/editing.md
- docs/evolution/rating_and_comparison.md
- docs/evolution/agents/tree_search.md
- docs/evolution/data_model.md

## Code Files Read
- `src/components/evolution/tabs/TimelineTab.tsx` — Timeline visualization
- `src/components/evolution/tabs/LogsTab.tsx` — Logs visualization
- `src/app/admin/quality/explorer/page.tsx` — Unified explorer (RunTable, ArticleTable, TaskTable)
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` — Run detail page shell
- `src/lib/services/unifiedExplorerActions.ts` — Explorer server actions
- `src/lib/services/evolutionVisualizationActions.ts` — Timeline/dashboard actions
- `src/lib/services/evolutionActions.ts` — Core evolution actions
- `src/lib/evolution/types.ts` — AgentResult, PipelineState, ExecutionContext, EvolutionRunSummary
- `src/lib/evolution/core/pipeline.ts` — Pipeline orchestrator, finalizePipelineRun, persistAgentMetrics
- `src/lib/evolution/core/state.ts` — PipelineState serialization/deserialization
- `src/lib/evolution/core/supervisor.ts` — Phase management, stopping conditions
- `src/lib/evolution/core/logger.ts` — LogBuffer, DB logging
- `src/lib/evolution/core/costTracker.ts` — Per-agent budget enforcement
- `src/lib/evolution/core/costEstimator.ts` — Cost estimation baselines
- `src/lib/evolution/core/adaptiveBudget.ts` — Adaptive budget allocation, AgentROI
- `src/lib/evolution/agents/base.ts` — AgentBase abstract class
- `src/lib/evolution/agents/generationAgent.ts` — 3-strategy generation
- `src/lib/evolution/agents/calibrationRanker.ts` — Pairwise calibration
- `src/lib/evolution/agents/tournament.ts` — Swiss tournament
- `src/lib/evolution/agents/iterativeEditingAgent.ts` — Edit cycles
- `src/lib/evolution/agents/reflectionAgent.ts` — Dimensional critiques
- `src/lib/evolution/agents/debateAgent.ts` — Structured debate
- `src/lib/evolution/agents/sectionDecompositionAgent.ts` — Section-level edits
- `src/lib/evolution/agents/evolvePool.ts` — Genetic evolution
- `src/lib/evolution/agents/treeSearchAgent.ts` — Beam search
- `src/lib/evolution/agents/outlineGenerationAgent.ts` — 6-call pipeline
- `src/lib/evolution/agents/proximityAgent.ts` — Diversity scoring
- `src/lib/evolution/agents/metaReviewAgent.ts` — Meta analysis
- `supabase/migrations/20260131000001_evolution_runs.sql`
- `supabase/migrations/20260131000002_evolution_variants.sql`
- `supabase/migrations/20260131000003_evolution_checkpoints.sql`
- `supabase/migrations/20260205000001_add_evolution_run_agent_metrics.sql`
- `supabase/migrations/20260211000001_evolution_run_logs.sql`
- `src/lib/evolution/agents/comparison.ts` — Bias-mitigated pairwise comparison
- `src/lib/evolution/agents/flowRubric.ts` — Flow/quality dimensions, prompts, parsers
- `src/lib/evolution/agents/comparisonCache.ts` — In-memory match cache
- `src/lib/evolution/core/rating.ts` — OpenSkill rating helpers
- `src/lib/evolution/treeOfThought/types.ts` — TreeNode, RevisionAction, BeamSearchConfig
- `src/lib/evolution/section/types.ts` — ArticleSection, ParsedArticle, SectionVariation

---

## Verified Per-Agent Source Analysis

Line-by-line source verification of all 12 agents. Corrects inaccuracies in the catalog above and adds exact method locations, LLM call sites, and undocumented ephemeral data.

### Corrections to Catalog Above

1. **IterativeEditingAgent (§4)**: Catalog says "Updated `allCritiques` (via inline re-critique after acceptance)". **INCORRECT.** `runInlineCritique()` at line 122 returns a Critique object assigned to local `currentCritique` for next cycle targeting — it does NOT mutate `state.allCritiques`. Only ReflectionAgent populates that state field.

2. **SectionDecompositionAgent (§7)**: Catalog says "`state.sectionState` updated with parsed sections". **INCORRECT.** There is no `state.sectionState` mutation in this file. Only `state.addToPool()` at line 142.

3. **OutlineGenerationAgent (§10)**: Catalog says "6-step pipeline" and "4 `GenerationStep` objects". Agent creates **4 steps** (outline, expand, polish, verify) but makes **6 LLM calls** (3 generation + 3 scoring). The verify step is local format validation with zero LLM cost.

4. **ProximityAgent (§11)**: Catalog mentions "MD5-based in test mode, char-based in prod". Cost estimator comment references "OpenAI text-embedding-3-small" pricing but **no OpenAI embeddings are used** in current code. Both modes produce 16-dimensional vectors from local computation.

5. **DebateAgent (§6)**: Catalog says "Full 4-call transcript". Agent pushes **partial transcripts** to state on every failure point (lines 234, 247, 261, 267, 284, 292), not only on success. Failed debates are fully traceable.

---

### 1. GenerationAgent — Verified Source Map

**File**: `src/lib/evolution/agents/generationAgent.ts`

| Method | Lines |
|--------|-------|
| `execute()` | 63–123 |
| `canExecute()` | 134–136 |
| `estimateCost()` | 125–132 |
| `buildPrompt()` | 14–58 (module helper) |

**LLM calls**: Line 80 — `llmClient.complete(prompt, this.name)` per strategy (3 parallel via `Promise.allSettled`)

**State mutations**: Line 111 — `state.addToPool(variation)` per successful strategy

**Key ephemeral data**:
| Line | Variable | Type | Notes |
|------|----------|------|-------|
| 71–73 | `feedback` | `string \| null` | metaFeedback.priorityImprovements joined |
| 76 | `results` | `PromiseSettledResult[]` | 3 parallel strategy outcomes |
| 81 | `fmtResult` | `FormatResult` | `{ valid, issues }` per strategy |
| 98 | `variations` | `TextVariation[]` | Local accumulator before state mutation |

**Exit conditions**: Line 67 (no originalText) → error; Line 82 (format invalid) → strategy null; Line 91 (BudgetExceededError) → re-throw; Line 118 (all failed) → error return.

---

### 2. CalibrationRanker — Verified Source Map

**File**: `src/lib/evolution/agents/calibrationRanker.ts`

| Method | Lines |
|--------|-------|
| `execute()` | 100–198 |
| `canExecute()` | 212–214 |
| `estimateCost()` | 200–210 |
| `compareWithBiasMitigation()` | 14–73 (private) |
| `applyRatingUpdate()` | 76–98 (private) |

**LLM calls**: Line 38 — `llmClient.complete()` inside `callLLM`, called 2× per comparison (A-vs-B + B-vs-A bias mitigation)

**State mutations**: Line 152 — `state.matchHistory.push(match)`; Lines 85–93 — `state.ratings.set()` via `applyRatingUpdate()`; Lines 96–97 — `state.matchCounts.set()`.

**Key ephemeral data**:
| Line | Variable | Type | Notes |
|------|----------|------|-------|
| 122–125 | `opponentIds` | `string[]` | Stratified by quartile (top 2, mid 2, bottom/new 1) |
| 135–136 | `firstBatch`, `remainingBatch` | `string[]` | Split for adaptive early exit |
| 157–158 | `allDecisive` | `boolean` | All first-batch confidence ≥ 0.7 → early exit |
| 23–32 | `cached` | `CachedMatch \| null` | Order-invariant cache check |
| 85–93 | before/after ratings | `{ mu, sigma }` | Snapshots in applyRatingUpdate |

**Exit conditions**: Line 103 (no new entrants) → error; Line 117 (missing entrant) → skip + warn; Line 157 (allDecisive + enough matches) → early exit after first batch; Line 42 (BudgetExceededError) → re-throw.

---

### 3. Tournament — Verified Source Map

**File**: `src/lib/evolution/agents/tournament.ts`

| Method | Lines |
|--------|-------|
| `execute()` | 196–372 |
| `canExecute()` | 386–388 |
| `estimateCost()` | 374–384 |
| `runComparison()` | 160–194 (private) |
| `needsMultiTurn()` | 137–157 (private) |
| `swissPairing()` | 55–113 (exported helper) |
| `budgetPressureConfig()` | 20–28 (exported helper) |

**LLM calls**: Line 167 — 2 calls per comparison (bias mitigated); Line 173 — 1 tiebreaker call (multi-turn); Lines 305–309 — 2 flow comparison calls (if feature flag).

**State mutations**: Line 213 — `state.ratings.set()` init; Line 270 — `state.matchHistory.push(match)` with dimensionScores + optional frictionSpots; Lines 280–285 — rating updates (draw if confidence < 0.3); Lines 288–289 — `state.matchCounts.set()`.

**Key ephemeral data**:
| Line | Variable | Type | Notes |
|------|----------|------|-------|
| 203 | `budgetPressure` | `number` | `1 - (available / cap)` |
| 204 | `budgetCfg` | `BudgetPressureConfig` | 3-tier: low/medium/high |
| 217 | `completedPairs` | `Set<string>` | Prevents rematches |
| 221–222 | `convergenceStreak`, `staleRounds` | `number` | Exit condition counters |
| 230 | `pairs` | `[TextVariation, TextVariation][]` | Swiss pairing per round |
| 247–253 | `pairConfigs` | `Array<{..., useMultiTurn}>` | Pre-computed multi-turn flags |
| 355–361 | `convergenceMetric` | `number` | `1 - avgSigma / (25/3)` |

**Exit conditions**: Line 198 (< 2 variants) → error; Line 225 (maxComparisons reached) → break; Line 232 (no pairs + staleRounds ≥ 3) → break; Line 340 (convergenceStreak ≥ 5) → break; Line 296 (BudgetExceededError) → re-throw after processing fulfilled.

**Swiss pairing algorithm** (lines 55–113): Info-theoretic scoring with `outcomeUncertainty`, `sigmaWeight`, `topKBoost` per candidate pair. Greedy selection.

---

### 4. IterativeEditingAgent — Verified Source Map

**File**: `src/lib/evolution/agents/iterativeEditingAgent.ts`

| Method | Lines |
|--------|-------|
| `execute()` | 58–136 |
| `canExecute()` | 50–56 |
| `estimateCost()` | 138–145 |
| `pickEditTarget()` | 209–275 (private) |
| `runOpenReview()` | 147–164 (private) |
| `runInlineCritique()` | 166–207 (private) |
| `qualityThresholdMet()` | 277–283 (private) |

**LLM calls**: Line 69 — open review; Line 88 — edit generation; Line 100 — judge comparison (2 calls: forward + reverse diff); Line 122 — re-critique; Line 123 — re-open-review.

**State mutations**: Line 114 — `state.addToPool(editedVariant)`. **NO mutation to `state.allCritiques`** (inline critique is local only).

**Key ephemeral data**:
| Line | Variable | Type | Notes |
|------|----------|------|-------|
| 61 | `consecutiveRejections` | `number` | Stop condition counter |
| 43 | `attemptedTargets` | `Set<string>` | Prevents re-attempting same targets (instance-level, resets across iterations) |
| 66 | `currentCritique` | `Critique \| null` | Updated after each acceptance — NOT persisted |
| 69 | `openReview` | `string[] \| null` | 2–3 freeform suggestions, re-run after each acceptance |
| 83 | `editTarget` | `EditTarget` | `{ dimension?, description, score?, source }` |
| 100 | `result` | `DiffComparisonResult` | `{ verdict, confidence, changesFound }` |

**Target priority order** (pickEditTarget, lines 209–275): (1) Step-based (OutlineVariant weakest step) → (2) Rubric quality dimensions < 8 → (3) Flow dimensions < 3 → (4) Open review suggestions.

**Stop conditions**: Line 73 (quality threshold met + no review findings); Line 77 (consecutive rejections ≥ 3); Line 84 (no targets remaining); Line 71 (max cycles, default 3).

**Undocumented**: Judge sees only CriticMarkup diff notation, NOT the edit target description (prevents prompt leakage).

---

### 5. ReflectionAgent — Verified Source Map

**File**: `src/lib/evolution/agents/reflectionAgent.ts`

| Method | Lines |
|--------|-------|
| `execute()` | 101–165 |
| `canExecute()` | 176–178 |
| `estimateCost()` | 167–174 |
| `buildCritiquePrompt()` | 16–52 (module function) |
| `parseCritiqueResponse()` | 62–90 (module function) |
| `getCritiqueForVariant()` | 182–185 (exported helper) |
| `getWeakestDimension()` | 188–192 (exported helper) |
| `getImprovementSuggestions()` | 195–208 (exported helper) |

**LLM calls**: Line 117 — `llmClient.complete()` per variant (3 parallel via `Promise.allSettled`).

**State mutations**: Line 149 — `state.allCritiques = []` (init if null); Line 150 — `state.allCritiques.push(...critiques)`; Line 152 — `state.dimensionScores = {}` (init); Line 154 — `state.dimensionScores[id] = scores` (denormalized index).

**Key ephemeral data**:
| Line | Variable | Type | Notes |
|------|----------|------|-------|
| 105 | `topVariants` | `TextVariation[]` | Top 3 by rating |
| 113 | `results` | `PromiseSettledResult[]` | Parallel critique outcomes |
| 137–138 | `avgScore` | `number` | Per-variant average (logged, not persisted) |
| 64 | `data` | `CritiqueResponse \| null` | Intermediate parsed JSON |
| 68–77 | `toArrayRecord()` | closure | Normalizes string\|string[] to string[] (handles LLM variance) |

**Exit conditions**: Line 106 (no variants) → error; Lines 123–126 (BudgetExceededError scan in allSettled results) → re-throw; Line 159 (all critiques failed) → error.

**Dual storage**: dimensionScores stored in both `allCritiques` (full Critique objects) and `state.dimensionScores` (flat map for fast lookup).

---

### 6. DebateAgent — Verified Source Map

**File**: `src/lib/evolution/agents/debateAgent.ts`

| Method | Lines |
|--------|-------|
| `execute()` | 191–320 |
| `canExecute()` | 332–334 |
| `estimateCost()` | 322–330 |
| `buildAdvocateAPrompt()` | 24–44 |
| `buildAdvocateBPrompt()` | 46–68 |
| `buildJudgePrompt()` | 70–98 |
| `buildSynthesisPrompt()` | 124–161 |
| `parseJudgeResponse()` | 108–122 |
| `formatCritiqueContext()` | 163–184 |

**LLM calls**: Line 230 — Advocate A; Line 243 — Advocate B; Line 256 — Judge; Line 281 — Synthesis. (4 sequential calls.)

**State mutations**: Lines 234/247/261/267/284/292/311 — `state.debateTranscripts.push(transcript)` at **every exit point** (partial on failure, complete on success). Line 309 — `state.addToPool(newVariant)` on success only.

**Key ephemeral data**:
| Line | Variable | Type | Notes |
|------|----------|------|-------|
| 206–207 | `variantA`, `variantB` | `TextVariation` | Top 2 non-baseline by rating |
| 224 | `critiqueContext` | `string` | Formatted existing critiques for both variants |
| 253 | `verdict` | `JudgeVerdict \| null` | `{ winner, reasoning, strengths_from_a, strengths_from_b, improvements }` |
| 277–279 | `metaFeedback` | `string \| null` | MetaReview priorities injected into synthesis prompt |
| 290 | `fmtResult` | `FormatResult` | Format validation of synthesis |

**Partial transcript pattern**: Every try-catch distinguishes BudgetExceededError (re-throw immediately, no transcript) from other errors (push partial transcript showing failure point, return error). Failed debates are fully traceable via `debateTranscripts`.

**Version computation**: Line 298 — `max(parentA.version, parentB.version) + 1` (merge semantics, not generation semantics).

---

### 7. SectionDecompositionAgent — Verified Source Map

**File**: `src/lib/evolution/agents/sectionDecompositionAgent.ts`

| Method | Lines |
|--------|-------|
| `canExecute()` | 24–38 |
| `execute()` | 40–159 |
| `estimateCost()` | 161–170 |

**LLM calls**: Delegated to `sectionEditRunner.ts` — per eligible section: 1 edit generation + 2 judge calls per cycle.

**State mutations**: Line 142 — `state.addToPool(variant)`. **NO** `state.sectionState` mutation (contrary to catalog §7).

**Key ephemeral data**:
| Line | Variable | Type | Notes |
|------|----------|------|-------|
| 50 | `parsed` | `ParsedArticle` | `{ sectionCount, sections, originalText }` |
| 57–59 | `eligible` | `ArticleSection[]` | Sections ≥ 100 chars, non-preamble |
| 66–76 | `weakness` | `SectionWeakness` | `{ dimension, description }` from weakest critique dimension |
| 105 | `replacements` | `Map<number, string>` | Section index → improved markdown |
| 106 | `budgetError` | `BudgetExceededError \| null` | Captured from parallel edits |
| 123 | `stitchedText` | `string` | Full article with improved sections |
| 126 | `formatResult` | `FormatResult` | Full-article validation |

**Strategy naming**: Line 138 — `section_decomposition_{dimension}` (includes weakness dimension).

**Budget error deferral**: Line 106 captures BudgetExceededError from parallel edits. Line 118 throws if no sections improved. Line 151 throws **after** successful variant creation if some sections improved (dual path).

**canExecute preconditions** (lines 24–38): Requires allCritiques non-empty, ratings exist, top variant found with critique, and sectionCount ≥ 2 (MIN_H2_SECTIONS).

---

### 8. EvolutionAgent — Verified Source Map

**File**: `src/lib/evolution/agents/evolvePool.ts`

| Method | Lines |
|--------|-------|
| `execute()` | 187–358 |
| `canExecute()` | 376–378 |
| `estimateCost()` | 360–374 |
| `getDominantStrategies()` | 125–141 (exported) |
| `isRatingStagnant()` | 144–166 (exported) |
| `shouldTriggerCreativeExploration()` | 169–180 (exported) |

**Constants**: `EVOLUTION_STRATEGIES = ['mutate_clarity', 'mutate_structure', 'crossover']` (line 15); `CREATIVE_RANDOM_CHANCE = 0.3` (line 20); `CREATIVE_DIVERSITY_THRESHOLD = 0.5` (line 21).

**LLM calls**: Line 223 — mutation/crossover (3 parallel); Line 277 — creative exploration (conditional); Lines 312, 316–318 — outline mutation + expansion (sequential).

**State mutations**: Line 257 — `state.addToPool()` per successful mutation; Line 294 — creative variant; Line 344 — outline variant.

**Key ephemeral data**:
| Line | Variable | Type | Notes |
|------|----------|------|-------|
| 195 | `parents` | `TextVariation[]` | 1–2 top-rated from `getEvolutionParents(2)` |
| 201–203 | `feedback` | `string \| null` | metaFeedback priorities |
| 265 | `randomValue` | `number` | Creative trigger random (0–1) |
| 269 | `overrepresented` | `string[]` | Strategies with > 1.5× average count |
| 307 | `outlineParent` | `OutlineVariant \| undefined` | Found via `isOutlineVariant()` |

**Creative trigger logic** (lines 169–180): Random 30% **OR** diversity < 0.5. Stagnation helper exists (`isRatingStagnant()`) but is **not used** in creative trigger.

**Crossover fallback**: Line 217 — if crossover selected but only 1 parent → falls back to `mutate_clarity`.

**Outline mutation**: Lines 312–318 — sequential (mutation output feeds expansion). Steps get hardcoded `score: 0.5`, `costUsd: 0`.

---

### 9. TreeSearchAgent — Verified Source Map

**File**: `src/lib/evolution/agents/treeSearchAgent.ts`

| Method | Lines |
|--------|-------|
| `execute()` | 31–111 |
| `canExecute()` | 23–29 |
| `estimateCost()` | 113–132 |
| `selectRoot()` | 134–155 (private) |
| `storeResults()` | 157–163 (private) |

**LLM calls**: **None in this file** — all delegated to `beamSearch()` from `../treeOfThought/beamSearch`.

**State mutations**: Line 88 — `state.addToPool(bestVariant)` (conditional: different from root, different text, not already in pool); Line 160 — `state.treeSearchResults = [...existing, result]`; Line 162 — `state.treeSearchStates = [...existing, treeState]`.

**Key ephemeral data**:
| Line | Variable | Type | Notes |
|------|----------|------|-------|
| 16 | `config` | `BeamSearchConfig` | `{ beamWidth: 3, branchingFactor: 3, maxDepth: 3 }` defaults |
| 36 | `root` | `TextVariation \| null` | Selected via selectRoot() |
| 59–66 | `searchResult`, `treeState`, `bestLeafText` | from `beamSearch()` | Full tree output |
| 75 | `bestNode` | `TreeNode` | Best leaf from treeState |

**Root selection** (lines 134–155): Top 10 by rating → filter underexplored (sigma ≥ threshold) → fallback to full top 10 → sort by **mu** (optimistic, not ordinal) → return first with available critique.

**Version computation**: Line 80 — `root.version + searchResult.maxDepth` (adds depth, not just +1).

**Strategy naming**: Line 82 — `tree_search_{revisionAction.type}`.

**Immutable state pattern**: Lines 157–163 use spread operator to create new arrays (doesn't mutate existing).

**Success criterion**: Line 107 — `maxDepth > 0` (tree must have expanded beyond root).

---

### 10. OutlineGenerationAgent — Verified Source Map

**File**: `src/lib/evolution/agents/outlineGenerationAgent.ts`

| Method | Lines |
|--------|-------|
| `execute()` | 134–267 |
| `canExecute()` | 279–281 |
| `estimateCost()` | 269–277 |
| `buildVariant()` | 283–303 (private) |
| `computeWeakestStep()` | 121–129 (helper) |

**LLM calls** (6 total): Line 151 — outline gen; Line 159 — outline score; Line 175 — expand gen; Line 187 — expand score; Line 203 — polish gen; Line 209 — polish score. Generation uses `generationModel`, scoring uses `judgeModel`.

**State mutations**: Line 181 — partial variant (expand failed); Line 238 — complete variant; Line 260 — error recovery variant.

**Key ephemeral data**:
| Line | Variable | Type | Notes |
|------|----------|------|-------|
| 143 | `steps` | `GenerationStep[]` | 4 steps: outline, expand, polish, verify |
| 160 | `outlineScore` | `number` | Defaults to 0.5 on parse failure |
| 222 | `fmtResult` | `FormatResult` | **Never blocks pool addition** (score 0.3 penalty, not rejection) |

**Cascading fallback**: Empty expand → outline becomes final; Empty polish → expanded becomes final; Error with partial steps → last step output becomes final.

**Verify step**: Line 222 — local format validation, zero cost. Score 1.0 (pass) or 0.3 (fail).

---

### 11. ProximityAgent — Verified Source Map

**File**: `src/lib/evolution/agents/proximityAgent.ts`

| Method | Lines |
|--------|-------|
| `execute()` | 18–80 |
| `canExecute()` | 89–91 |
| `estimateCost()` | 82–87 |
| `_computePoolDiversity()` | 93–118 (private) |
| `_embed()` | 120–136 (private) |
| `clearCache()` | 138–141 |
| `cosineSimilarity()` | 144–158 (exported function) |

**LLM calls**: **NONE**. Zero cost always.

**State mutations**: Line 25 — `state.similarityMatrix = {}`; Lines 62, 67 — sparse matrix population (symmetric, both directions); Line 72 — `state.diversityScore = 1 - mean(topSims)`.

**Key ephemeral data**:
| Line | Variable | Type | Notes |
|------|----------|------|-------|
| 11 | `embeddingCache` | `Map<string, number[]>` | **Instance-level**, persists across iterations within run |
| 20 | `newIds` | `Set<string>` | New entrants this iteration |
| 21 | `existingIds` | `string[]` | Pre-existing pool variants |

**Only new×existing pairs computed** (lines 49–69) — never new×new or existing×existing in single iteration.

**Diversity**: Top-10 rated variants only (line 95). Defaults to 1.0 if pool < 2 or no valid pairs.

**Embedding dimensions**: 16-dim in both test (MD5-based) and prod (charCode-based). **Not** OpenAI embeddings.

---

### 12. MetaReviewAgent — Verified Source Map

**File**: `src/lib/evolution/agents/metaReviewAgent.ts`

| Method | Lines |
|--------|-------|
| `execute()` | 18–47 |
| `canExecute()` | 54–56 |
| `estimateCost()` | 49–52 |
| `_analyzeStrategies()` | 58–90 |
| `_findWeaknesses()` | 92–138 |
| `_findFailures()` | 140–180 |
| `_prioritize()` | 182–221 |

**LLM calls**: **NONE**. Zero cost. All synchronous analysis.

**State mutations**: Line 37 — `state.metaFeedback = { successfulStrategies, recurringWeaknesses, patternsToAvoid, priorityImprovements }`.

**Hardcoded thresholds**:
| Threshold | Value | Location | Purpose |
|-----------|-------|----------|---------|
| Overrepresentation | ≥ 50% of bottom quartile | Line 116 | Weakness trigger |
| Generated vs evolved | 2× ratio | Lines 131, 133 | Weakness trigger |
| Strategy failure delta | < -3 ordinal | Line 173 | Patterns-to-avoid trigger |
| Min failure samples | ≥ 2 | Line 171 | Required before computing avgDelta |
| Low diversity | < 0.3 | Line 188 | Priority trigger |
| Narrow ordinal range | < 6 | Line 196 | Priority trigger |
| Wide ordinal range | > 30 | Line 199 | Priority trigger |
| Stagnation gate | iteration > 3 | Line 204 | Priority check enabled |
| Stale top-3 age | > 2 iterations | Line 209 | Priority trigger |
| Low strategy coverage | < 3 strategies | Line 216 | Priority trigger |

**Successful strategies sorted descending** by avg ordinal (lines 83–87).

---

### Cross-Agent Patterns

**BudgetExceededError handling**: All 12 agents re-throw BudgetExceededError immediately. Agents using `Promise.allSettled` (Generation, Calibration, Tournament, Evolution, SectionDecomposition) explicitly scan settled results for budget errors after processing fulfilled results.

**Format validation**: Generation, IterativeEditing, SectionDecomposition, Evolution reject variants on format failure. DebateAgent rejects on format failure. **OutlineGeneration is the exception** — always adds to pool regardless (uses score penalty 0.3 instead).

**State mutation timing**: All agents mutate state sequentially after parallel LLM calls complete. No concurrent state mutations.

**Cost tracking**: All agents return `ctx.costTracker.getAgentCost(this.name)` — a read of the per-agent accumulator updated by LLM client during calls.
