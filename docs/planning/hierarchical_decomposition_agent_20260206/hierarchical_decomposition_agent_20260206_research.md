# Hierarchical Decomposition Agent Research

**Date**: 2026-02-06T12:00:00-08:00
**Git Commit**: a2c1082df487366b41accac5082a4eb2fbbf4f34
**Branch**: feat/hierarchical_decomposition_agent_20260206
**Repository**: Minddojo/explainanything

## Problem Statement

**Current approach**: Evolve the entire article as one unit. Every LLM call sees the full text.

**Alternative**: Parse the article into sections (Intro, Section 1, Section 2, Conclusion). Evolve each section independently with its own mini-pipeline. Then stitch the best section variants together and run a final coherence check.

**Key difference**: True parallelism — 5 sections can evolve simultaneously. Smaller context windows = cheaper LLM calls. You can accept improvements to Section 2 while rejecting changes to Section 3.

**Best for**: Long articles (2000+ words) where full-article context is expensive, or when you want granular human control over which improvements to accept. Leverages the iterative editing agent where needed.

## High Level Summary

The current evolution pipeline treats articles as **atomic text blobs** — every agent receives the full article string, generates complete replacement variants, and stores them as complete documents. There is zero section-level awareness in code, though the format validator enforces a structure (H1 title + H2/H3 sections + prose paragraphs) that creates natural section boundaries.

Key findings:
1. **TextVariation.text** is a single string field — the entire article
2. **No section parsing exists anywhere** in `src/lib/evolution/`
3. The **MDAST infrastructure** already parses to flat trees with heading `depth` — section extraction is a ~50 line tree walk splitting at H2 boundaries, and `fallbackStringify()` already converts nodes back to markdown
4. The **IterativeEditingAgent** already does targeted edits on the full text (critique → edit one dimension → blind judge), which is the closest existing pattern to section-level editing
5. All agents use **`Promise.allSettled`** for parallel LLM calls — section decomposition adds a second parallelism axis (same agent × N sections) that composes naturally
6. The **checkpoint system is write-only** — state saves after every agent but no code reads checkpoints to resume. Section decomposition can extend the JSONB snapshot without breaking anything
7. The **writing pipeline is fully monolithic** — articles generated as single strings, stored as TEXT. Section awareness only needed at the evolution layer; stitcher reassembles before storage
8. Prior research in `suggestions_to_improve_pipeline_agents_20260204` explicitly describes hierarchical decomposition as a "Medium-Term" improvement

---

## Detailed Findings

### 1. How Articles Are Represented

**Core type** (`src/lib/evolution/types.ts:20-30`):
```typescript
interface TextVariation {
  id: string;
  text: string;           // Complete article as markdown string
  version: number;
  parentIds: string[];
  strategy: string;
  createdAt: number;
  iterationBorn: number;
  costUsd?: number;
}
```

**Pipeline state** (`src/lib/evolution/core/state.ts:17`):
- `originalText: string` — full source article stored as single field
- `pool: TextVariation[]` — all variants as complete documents
- `addToPool()` — idempotent, initializes OpenSkill rating (μ=25, σ=8.333)

**Agent context** (`src/lib/evolution/types.ts:67-73`):
- `AgentPayload.originalText: string` — full original passed to all agents
- `ExecutionContext` gives every agent access to `payload.originalText` and `state.pool`

**Conclusion**: Articles are strings everywhere. No structured section metadata exists.

### 2. How the Pipeline Orchestrates Agents

**PoolSupervisor** (`src/lib/evolution/core/supervisor.ts`) manages a two-phase pipeline:

**EXPANSION** (iterations 0–N): Build diverse pool
- Agents: GenerationAgent, CalibrationRanker, ProximityAgent
- Transition to COMPETITION when: (pool ≥ 15 AND diversity ≥ 0.25) OR iteration ≥ 8

**COMPETITION** (iterations N+1 to max): Refine quality
- All 9 agents run: Generation → Reflection → IterativeEditing → Debate → Evolution → Tournament → Proximity → MetaReview

**Agent execution order per iteration** (`src/lib/evolution/core/pipeline.ts:470-521`):
1. GenerationAgent (3 variants, parallel strategies)
2. ReflectionAgent (critique top 3 variants)
3. IterativeEditingAgent (surgical edits on top variant)
4. DebateAgent (3-turn debate between top 2)
5. EvolutionAgent (mutation/crossover of top parents)
6. Tournament or CalibrationRanker (ranking)
7. ProximityAgent (diversity)
8. MetaReviewAgent (meta-feedback, no LLM)

**PhaseConfig** (`supervisor.ts:17-29`) controls which agents run via boolean flags.

**Checkpointing**: Full `PipelineState` serialized to `evolution_checkpoints` after each agent, including `originalText`, pool, ratings, critiques, and supervisor state.

### 3. How Each Agent Consumes Article Text

#### GenerationAgent (`agents/generationAgent.ts`)
- Receives `state.originalText` (full article)
- Builds 3 prompts with different strategies: `structural_transform`, `lexical_simplify`, `grounding_enhance`
- Each prompt includes the **complete article text** + FORMAT_RULES
- Output: 3 complete replacement variants (full articles)
- **Section awareness**: None. Structural transform may reorder sections but LLM decides how.

#### EvolutionAgent (`agents/evolvePool.ts`)
- Selects top 2 parents from pool (not originalText)
- 3 strategies: `mutate_clarity`, `mutate_structure`, `crossover`
- Plus optional `creative_exploration` (30% random or diversity < 0.5)
- Crossover takes 2 full parent texts and combines
- **Section awareness**: None. Crossover is whole-article level.

#### ReflectionAgent (`agents/reflectionAgent.ts`)
- Critiques top 3 variants across 5 dimensions: clarity, structure, engagement, precision, coherence
- Each critique includes per-dimension scores (1-10), good/bad examples, notes
- Output: `Critique` objects stored in `state.allCritiques`
- **Section awareness**: Critiques may quote specific passages, but evaluation is whole-article.

#### IterativeEditingAgent (`agents/iterativeEditingAgent.ts`)
- Takes top variant by rating + its critique from ReflectionAgent
- Loop: pick weakest dimension → generate targeted edit → blind diff judge → accept/reject
- Edit prompt includes **full article text** + weakness description
- LLM returns **complete revised article** (not a section patch)
- Blind judge sees CriticMarkup diff of full texts (via `diffComparison.ts`)
- Up to 3 cycles, stops on quality threshold (all dimensions ≥ 8) or 3 rejections
- **Section awareness**: Edit prompts say "rewrite ONLY the sections exhibiting this weakness" but the agent doesn't extract sections — it relies on the LLM to target appropriately.

#### DebateAgent (`agents/debateAgent.ts`)
- 3-turn debate: Advocate A → Advocate B → Judge → Synthesis
- Both advocates see both complete variant texts
- Judge produces recommendations, synthesis LLM creates merged variant
- **Section awareness**: None. Debate compares whole articles.

### 4. Format Validation and Article Structure

**Format rules** (`agents/formatRules.ts`):
- Single H1 title on first line
- At least one `##` or `###` section heading
- Complete paragraphs (2+ sentences), separated by blank lines
- No bullets, numbered lists, or tables

**Validator** (`agents/formatValidator.ts`):
- Checks via regex: H1 count/position, heading presence, bullet/list/table rejection
- Paragraph sentence counting with 25% tolerance
- Three modes: `reject` (default), `warn`, `off`
- **Heading detection exists** (H1, H2, H3 patterns) but no section extraction

**Typical article structure** (from `docs/sample_evolution_content/filler_words.md`):
```markdown
# Article Title

Opening paragraph about the topic with context...

## Section Heading

Paragraph explaining this section. Multiple sentences required...

## Another Section

More content here...
```

### 5. Markdown AST Diff Infrastructure

**Core file**: `src/editorFiles/markdownASTdiff/markdownASTdiff.ts`

**Key function**: `RenderCriticMarkupFromMDAstDiff(beforeRoot, afterRoot, options)`
- Parses markdown to MDAST via `unified` + `remark-parse`
- Walks tree recursively comparing nodes
- Generates CriticMarkup annotations: `{--deleted--}`, `{++inserted++}`, `{~~old~>new~~}`

**Heading handling**: Headings are **atomic blocks** — any change replaces the entire heading.

**Multi-pass paragraph analysis** (3-level granularity):
1. Paragraph-level: If diff > 40%, atomic replacement
2. Sentence-level: Align sentences by similarity, pair if diff < 30%
3. Word-level: Per-sentence diff if < 15%

**Section-level capability**: The MDAST tree structure preserves document hierarchy (heading nodes with `depth` property). This infrastructure could support section extraction by splitting the tree at heading boundaries, but **no such function exists today**.

### 6. Diff-Based Comparison (Used by IterativeEditingAgent)

**File**: `src/lib/evolution/diffComparison.ts`

- `compareWithDiff(textBefore, textAfter, callLLM)` → `DiffComparisonResult`
- Parses both texts to MDAST, generates CriticMarkup diff
- **Direction reversal**: Forward pass (original→edited) + reverse pass (edited→original)
- Truth table: consistent agreement = decisive, both same direction = framing bias → UNSURE
- Judge prompt is **blind** — sees only diff, no edit intent
- Operates on **full text strings**, not sections

### 7. Prior Research on Hierarchical Decomposition

**File**: `docs/planning/suggestions_to_improve_pipeline_agents_20260204/suggestions_to_improve_pipeline_agents_20260204_research.md`

Section 2.2 explicitly describes the concept:
- Treat article as tree of semantic units (intro, sections, subsections)
- Evolve each independently with specialized agents, then compose
- **Advantages**: 5x parallelism, lower cost ($1-2 vs $3-5), section-level reusability, fine-grained human control
- **Trade-offs**: Loses whole-article coherence during evolution, more complex checkpoint model
- **Classification**: Medium-Term (1-2 months)

### 8. MDAST Section Extraction Capabilities

**Core parsing** (`src/editorFiles/markdownASTdiff/markdownASTdiff.ts`):
- Uses `unified` + `remark-parse` via dynamic ESM import (`parseToMdast`)
- MDAST root node has a **flat `children` array** — headings and paragraphs are siblings, NOT nested
- Example: `root.children = [heading(1), paragraph, heading(2), paragraph, paragraph, heading(2), paragraph]`

**What exists for section extraction**:
- `heading` nodes have `depth` property (1=H1, 2=H2, 3=H3)
- `fallbackStringify()` converts MDAST nodes back to markdown strings
- `lcsIndices()` provides LCS-based child pairing for aligning tree nodes between versions

**Section extraction algorithm** (does NOT exist, but straightforward to build):
```
for each child in root.children:
  if child.type === 'heading' && child.depth === 2:
    start new section
  else:
    append to current section
```
Each "section" = `{ heading: HeadingNode, content: Node[] }`. The intro (before first H2) is a special case with no heading node.

**Key dependency**: `diffComparison.ts` already calls `parseToMdast()` — this same function can be reused for section extraction without adding any new dependencies.

**Gotcha**: MDAST trees are **flat**, not hierarchically nested. A `## Subsection` (H2) is at the same tree level as `### Sub-subsection` (H3). Section extraction must decide whether to split at H2 only (simpler) or support nested H2+H3 (more complex).

### 9. Writing Pipeline Section-Aware Patterns

**Article generation** (`src/lib/services/returnExplanation.ts`):
- Main orchestrator for creating articles
- Articles generated as a single LLM call → monolithic markdown string
- Stored in `explanations.content` TEXT field (no section columns)
- No concept of sections at the storage layer

**Only heading-aware code** (`src/lib/services/linkWhitelist.ts`):
- `generateHeadingStandaloneTitles()` uses regex `/^(#{2,3})\s+(.+)$/gm` to extract H2/H3 headings
- Purpose: Generate standalone titles for link overlay UI, NOT for section manipulation
- This regex pattern is reusable for lightweight section boundary detection

**LLM routing** (`src/lib/services/llms.ts`):
- `callLLM` routes to OpenAI/Anthropic/DeepSeek based on model prefix
- Default model: `gpt-4.1-mini`
- No section-specific LLM configuration exists

**Implication**: The entire writing pipeline is monolithic. Section-level evolution would need to introduce section awareness at the evolution layer only — the upstream generation and downstream storage can remain unchanged initially, since the stitcher will reassemble sections into a complete article string before storage.

### 10. Parallelism Patterns Across Evolution Agents

All agents use **`Promise.allSettled`** for parallel LLM calls with **sequential state mutations** after settlement. This is the consistent pattern throughout:

| Agent | Parallel Pattern | Concurrency |
|-------|-----------------|-------------|
| GenerationAgent | 3 strategy variants via `Promise.allSettled` | 3 concurrent calls |
| ReflectionAgent | Critique top 3 variants via `Promise.allSettled` | 3 concurrent calls |
| EvolutionAgent | 3 strategies via `Promise.allSettled`, creative exploration sequential after | 3+1 calls |
| Tournament | All pairs per round via `Promise.allSettled`, each pair has 2 bias calls via `Promise.all` | 2N calls for N pairs |
| CalibrationRanker | Batched opponents via `Promise.allSettled`, adaptive early exit if confidence ≥ 0.7 | 2-4 calls per batch |
| DebateAgent | **Sequential** — 4 LLM calls in strict order (Advocate A → B → Judge → Synthesis) | 1 at a time |
| IterativeEditingAgent | **Sequential** — edit→judge loop, each cycle is 1 edit + 2 judge calls | 1-3 cycles |

**Bias mitigation parallelism**:
- `comparison.ts` (`compareWithBiasMitigation`): 2 **sequential** LLM calls (forward + reverse)
- `pairwiseRanker.ts`: 2 **parallel** calls via `Promise.all` for same comparison

**Key insight for decomposition**: The existing parallelism is *within* agents (multiple LLM calls per agent). Hierarchical decomposition adds a *second axis* of parallelism — the same agent running on N sections simultaneously. These compose: GenerationAgent on 5 sections = 5 × 3 = 15 concurrent LLM calls.

**Budget implications**: `costTracker.ts` enforces per-agent caps. Section-level parallelism would multiply cost per agent by N (number of sections). The budget system needs section-aware caps or a shared budget pool across section pipelines.

### 11. Checkpoint/Resume System

**Database schema** (`supabase/migrations/20260131000003_evolution_checkpoints.sql`):
```sql
CREATE TABLE evolution_checkpoints (
  id UUID PRIMARY KEY,
  run_id TEXT NOT NULL,
  iteration INTEGER NOT NULL,
  phase TEXT NOT NULL,
  last_agent TEXT NOT NULL,
  state_snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
-- Unique index on (run_id, iteration, last_agent)
```

**Write path** (`src/lib/evolution/core/pipeline.ts`):
- `persistCheckpoint()` upserts to `evolution_checkpoints` after each agent completes
- 3-attempt retry with exponential backoff (100ms, 200ms, 400ms)
- `persistCheckpointWithSupervisor()` includes `supervisorState` in the snapshot
- State snapshot contains: `originalText`, `pool` (all variants), `ratings`, `matchHistory`, `allCritiques`, `diversityScores`, and supervisor resume data

**Serialization** (`src/lib/evolution/core/state.ts`):
- `serializeState()`: Converts PipelineStateImpl → SerializedPipelineState (plain JSON)
- `deserializeState()`: Reconstructs PipelineStateImpl from JSON with Elo→OpenSkill migration for backward compatibility
- `SerializedPipelineState` includes backward-compat `eloRatings` field alongside `openSkillRatings`

**Resume path** (`pipeline.ts`):
- `options.supervisorResume: SupervisorResumeState` can restore `{ phase, strategyRotationIndex, ordinalHistory, diversityHistory }`
- **CRITICAL FINDING**: The checkpoint system is **write-only** — code saves checkpoints after every agent, but **no code path reads them back to resume a run**. The `supervisorResume` option exists but is never populated from a checkpoint read.

**Implications for section-level checkpoints**:
- The JSONB `state_snapshot` can store arbitrary structure — extending it to include per-section state is straightforward
- The write-only nature means we don't need to worry about breaking existing resume logic (there is none)
- A section-aware checkpoint would store: `{ sections: { [sectionId]: { pool, ratings, matchHistory } }, globalState: { ... } }`
- Resume becomes more valuable with section decomposition — you can resume mid-section-pipeline without restarting all sections

---

## What Exists vs What's Missing

### Exists Today
| Component | Location | Relevance |
|-----------|----------|-----------|
| Agent framework (`AgentBase`) | `agents/base.ts` | Reusable for section-level agents |
| OpenSkill rating system | `core/rating.ts` | Could rate section variants |
| Bias-mitigated comparison | `comparison.ts` | Reusable for section comparison |
| Diff-based blind judge | `diffComparison.ts` | Reusable for section diffs |
| MDAST parsing + `parseToMdast()` | `markdownASTdiff.ts`, `diffComparison.ts` | Ready to use for section extraction |
| `fallbackStringify()` | `markdownASTdiff.ts` | Converts MDAST nodes → markdown strings |
| Heading regex extraction | `linkWhitelist.ts` | `/^(#{2,3})\s+(.+)$/gm` for lightweight boundary detection |
| Format validation | `formatValidator.ts` | Detects H1/H2/H3, could identify sections |
| Checkpoint writes | `core/pipeline.ts` | Write-only; JSONB can store section state |
| IterativeEditingAgent | `agents/iterativeEditingAgent.ts` | Closest existing pattern to section editing |
| Budget enforcement | `core/costTracker.ts` | Per-agent caps, reusable |
| PoolSupervisor | `core/supervisor.ts` | Phase management, could wrap section pools |
| `Promise.allSettled` pattern | All agents | Consistent parallelism pattern to replicate for section-level |

### Missing (Needs Building)
| Component | Purpose | Complexity |
|-----------|---------|------------|
| Section parser | Split MDAST flat children at H2 boundaries into section objects | Low — ~50 lines, straightforward tree walk |
| Section variant type | `SectionVariation` with section ID, heading, content, position metadata | Low — type definition |
| Section pool state | Per-section pools, ratings, and match histories | Medium — extends PipelineStateImpl |
| Section-level supervisor | Coordinate N parallel section pipelines via `Promise.allSettled` | Medium — wraps existing supervisor |
| Section stitcher | Reassemble best section variants into complete article string | Low — concatenation with heading re-insertion |
| Coherence check agent | Post-stitch LLM pass to fix cross-section inconsistencies | Medium — new agent, reuses AgentBase |
| Checkpoint resume reader | Read checkpoints from DB (currently write-only) | Medium — new code path, needed independently |
| Section-aware checkpoint | Extend state_snapshot JSONB with per-section state | Low — extends existing serialization |
| Section-aware budget | Shared budget pool or per-section caps (N× cost multiplier) | Low — extends costTracker |
| Section-level admin UI | View/control section evolution independently | High — new UI components |

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Feature Deep Dives
- docs/feature_deep_dives/evolution_pipeline.md
- docs/feature_deep_dives/iterative_editing_agent.md
- docs/feature_deep_dives/comparison_infrastructure.md
- docs/feature_deep_dives/elo_budget_optimization.md
- docs/feature_deep_dives/evolution_pipeline_visualization.md
- docs/feature_deep_dives/markdown_ast_diffing.md
- docs/feature_deep_dives/hierarchical_decomposition_agent.md (template stub)

### Prior Planning
- docs/planning/suggestions_to_improve_pipeline_agents_20260204/suggestions_to_improve_pipeline_agents_20260204_research.md

## Code Files Read

### Core Pipeline
- `src/lib/evolution/types.ts` — TextVariation, PipelineState, ExecutionContext, AgentPayload
- `src/lib/evolution/core/state.ts` — PipelineStateImpl, addToPool, serializeState/deserializeState
- `src/lib/evolution/core/supervisor.ts` — PoolSupervisor, PhaseConfig, phase transitions
- `src/lib/evolution/core/pipeline.ts` — executeFullPipeline, persistCheckpoint, checkpoint retry logic
- `src/lib/evolution/core/costTracker.ts` — per-agent budget caps

### Agents
- `src/lib/evolution/agents/generationAgent.ts` — 3-strategy variant generation, Promise.allSettled
- `src/lib/evolution/agents/evolvePool.ts` — mutation/crossover/creative exploration
- `src/lib/evolution/agents/reflectionAgent.ts` — 5-dimension critique, parallel via Promise.allSettled
- `src/lib/evolution/agents/iterativeEditingAgent.ts` — critique→edit→judge loop (sequential)
- `src/lib/evolution/agents/debateAgent.ts` — 3-turn structured debate (sequential)
- `src/lib/evolution/agents/tournament.ts` — Swiss-style pairing, 2N parallel bias calls per round
- `src/lib/evolution/agents/calibrationRanker.ts` — batched parallelism with adaptive early exit

### Format & Diff
- `src/lib/evolution/agents/formatRules.ts` — FORMAT_RULES constant
- `src/lib/evolution/agents/formatValidator.ts` — validateFormat function
- `src/lib/evolution/diffComparison.ts` — diff-based blind judge, parseToMdast
- `src/lib/evolution/comparison.ts` — sequential bias mitigation (forward + reverse)
- `src/lib/evolution/pairwiseRanker.ts` — parallel bias mitigation via Promise.all
- `src/editorFiles/markdownASTdiff/markdownASTdiff.ts` — MDAST diff engine, fallbackStringify, lcsIndices

### Writing Pipeline
- `src/lib/services/returnExplanation.ts` — article generation orchestrator, monolithic markdown output
- `src/lib/services/llms.ts` — LLM routing (OpenAI/Anthropic/DeepSeek)
- `src/lib/services/linkWhitelist.ts` — generateHeadingStandaloneTitles, heading regex extraction

### Database
- `supabase/migrations/20260131000003_evolution_checkpoints.sql` — checkpoint table schema, JSONB state

### Integration
- `src/lib/services/evolutionActions.ts` — server actions
- `docs/sample_evolution_content/filler_words.md` — sample article structure
