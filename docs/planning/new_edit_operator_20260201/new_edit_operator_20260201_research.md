# New Edit Operator Research

## Problem Statement
We want to add a "self-debate" capability to the evolution pipeline (`src/lib/evolution/`) where agents argue different perspectives about variant quality and synthesize improvement suggestions. The question is whether to build a new agent or extend existing ReflectionAgent/MetaReviewAgent.

## High Level Summary

### Existing Pipeline Already Mirrors AI Co-Scientist Architecture
The paper "Towards an AI Co-Scientist" (arxiv 2502.18864, Google DeepMind, Feb 2025) describes a multi-agent system for scientific hypothesis generation using "generate, debate, and evolve." Its architecture is strikingly similar to our existing evolution pipeline:

| AI Co-Scientist Agent | Our Existing Agent | Match? |
|----------------------|-------------------|--------|
| Generation Agent | `GenerationAgent` | ✅ Nearly identical |
| Evolution Agent | `EvolutionAgent` (evolvePool.ts) | ✅ Same strategies (mutate, crossover, creative exploration) |
| Ranking Agent (Elo tournaments) | `CalibrationRanker` + `Tournament` | ✅ Same Elo + pairwise comparison |
| Reflection Agent | `ReflectionAgent` | ✅ Same dimensional critique |
| Proximity Agent | `ProximityAgent` | ✅ Same similarity/diversity role |
| Meta-review Agent | `MetaReviewAgent` | ✅ Same feedback synthesis |
| **Simulated Scientific Debate** | **MISSING** | ❌ This is what we need |
| Supervisor | `Supervisor` (supervisor.ts) | ✅ Same phase orchestration |

The primary gap is the **simulated debate** mechanism, which the Co-Scientist uses in two places:
1. **Within Generation** — debate to produce initial hypotheses
2. **Within Ranking** — debate during pairwise tournament comparisons

### Multi-Agent Debate Literature Is Mixed
The ICLR 2025 blogpost evaluating 5 MAD frameworks (MAD, Multi-Persona, Exchange-of-Thoughts, ChatEval, AgentVerse) across 9 benchmarks found:
- MAD **fails to consistently outperform** simpler baselines (Chain-of-Thought, Self-Consistency)
- Increasing debate rounds and agent counts does **not** reliably improve accuracy
- Agents are "overly aggressive" — they reverse correct answers into incorrect ones
- Combining different foundation models shows promise (heterogeneous teams)

**However**, these benchmarks test factual QA/math — not creative text improvement. The AI Co-Scientist uses debate for creative generation/evaluation (closer to our use case), where structured argumentation may be more beneficial than for factual tasks.

### Recommendation: Build New DebateAgent
Neither existing agent is suitable for extension:
- **ReflectionAgent** — Single independent LLM call per variant. No cross-variant comparison. Output format (`Critique`) wrong for debate.
- **MetaReviewAgent** — Zero LLM calls (pure statistics). Wrong abstraction entirely.

A new `DebateAgent extends AgentBase` is the cleanest path. The agent interface is well-defined (~200-300 LOC), and the Supervisor already supports optional agent toggles.

---

## Codebase Analysis

### Agent Architecture
All agents extend `AgentBase` (`agents/base.ts`):
```typescript
abstract class AgentBase {
  abstract readonly name: string;
  abstract execute(ctx: ExecutionContext): Promise<AgentResult>;
  abstract estimateCost(payload: AgentPayload): number;
  abstract canExecute(state: PipelineState): boolean;
}
```

### Pipeline Phases (Supervisor)
- **EXPANSION** — Pool building: Generation + Calibration + Proximity
- **COMPETITION** — Refinement: Generation + Evolution + Reflection + Tournament + Proximity + MetaReview
- Transition: one-way lock once `poolSize >= minPool && diversity >= threshold`

### Existing Agents Detail

**GenerationAgent** — Creates fresh variants using 3 strategies: structural_transform, lexical_simplify, grounding_enhance. Incorporates metaFeedback.priorityImprovements. No parent dependencies. ~$0.0012/run.

**EvolutionAgent** — Creates variants from top Elo parents using: mutate_clarity, mutate_structure, crossover, creative_exploration (30% chance + low diversity trigger). ~$0.0024/run.

**ReflectionAgent** — Dimensional critique of top 3 variants across clarity, structure, engagement, precision, coherence. One LLM call per variant. Stores Critique objects. ~$0.003/run. COMPETITION only.

**MetaReviewAgent** — Pure statistical analysis (no LLM). Finds successful strategies, recurring weaknesses, failure patterns. Outputs MetaFeedback consumed by Generation/Evolution. $0/run. COMPETITION only.

**CalibrationRanker** — Stratified pairwise ranking for new entrants. Position-bias mitigation (A vs B and B vs A). ~$0.015/run.

**Tournament** — Swiss-style tournament for pool-wide ranking. Multi-turn tiebreakers for close top-quartile matches. Budget-adaptive rounds. ~$0.02-0.08/run.

**ProximityAgent** — Pairwise similarity matrix, diversity scoring. ~$0.0003/run.

### Key Types
- `TextVariation` — id, text, version, parentIds, strategy, createdAt, iterationBorn
- `Critique` — variationId, dimensionScores, goodExamples, badExamples, notes, reviewer
- `MetaFeedback` — recurringWeaknesses, priorityImprovements, successfulStrategies, patternsToAvoid
- `AgentResult` — agentType, success, costUsd, variantsAdded, matchesPlayed, convergence

### State Model (PipelineState)
Mutable shared state with: pool, eloRatings, matchHistory, dimensionScores, allCritiques, similarityMatrix, diversityScore, metaFeedback. Append-only for pool.

---

## Paper Analysis: "Towards an AI Co-Scientist" (2502.18864)

### Overview
Multi-agent system built on Gemini 2.0 for scientific hypothesis generation. Uses "generate, debate, and evolve" approach with tournament-based Elo ranking. Validated in drug repurposing, novel target discovery, and antimicrobial resistance research.

### Architecture
Six specialized agents coordinated by a Supervisor that parses goals into research plan configurations and allocates resources:
1. **Generation Agent** — Explores literature via web search, simulates scientific debates to generate initial hypotheses, iterative assumption identification
2. **Reflection Agent** — Reviews for novelty/correctness/plausibility, deep verification by breaking hypotheses into sub-assumptions, simulation review
3. **Ranking Agent** — Elo-based tournaments with pairwise scientific debate comparisons
4. **Evolution Agent** — Adds supporting literature, simplifies/restructures, generates creative variations
5. **Proximity Agent** — Groups similar hypotheses, encourages diverse directions
6. **Meta-review Agent** — Synthesizes common errors from debates, improves feedback propagation

### Debate Mechanism (Limited Detail Available)
The paper describes "self-play–based scientific debate" but provides limited implementation specifics:
- Used within Generation to produce hypotheses
- Used within Ranking during pairwise tournament comparisons
- Debate outcomes feed into Meta-review for pattern synthesis
- "Win-loss patterns are summarized and provided as feedback to other agents"

### Scaling Results
- Higher Elo ratings correlate with correct answers on benchmarks
- Performance improves with increased test-time compute
- Measured across 203 unique research goals with temporal bucketing

### Key Takeaway for Our Implementation
The Co-Scientist uses debate as a **generative mechanism** (producing hypotheses) and a **comparative mechanism** (enriching pairwise ranking). Both are relevant to our pipeline. However, the paper lacks implementation specifics about debate format, turns, or prompt structure.

---

## Literature: Multi-Agent Debate (MAD) Frameworks

### Five Frameworks Evaluated (ICLR 2025)
1. **MAD** — Agents independently generate, then iteratively review/refine across rounds
2. **Multi-Persona** — Angel/devil agents present opposing views to a judge
3. **Exchange-of-Thoughts (EoT)** — Communication with confidence scoring
4. **ChatEval** — Asynchronous responses with round-by-round summarization
5. **AgentVerse** — HR agent dynamically hires expert agents for collaborative drafting

### Key Findings
- MAD does NOT consistently outperform Chain-of-Thought or Self-Consistency on QA/math benchmarks
- Agents are "overly aggressive" — reverse correct answers at high rates
- Multi-Persona performs worst (adversarial structure prevents constructive debate)
- Heterogeneous model teams show promise (GPT-4o-mini + Llama3.1-70b)
- Fine-grained step-level debate recommended over whole-response debate

### Relevance to Our Use Case
Our use case (creative text improvement) differs from factual QA benchmarks. The adversarial/constructive debate format may work better for:
- Identifying strengths/weaknesses across perspectives
- Synthesizing improvements from multiple viewpoints
- Generating novel variants through dialectic reasoning

The Multi-Persona (angel/devil/judge) pattern maps well to our needs: Advocate for Variant A, Advocate for Variant B, Judge synthesizes.

---

## Documents Read
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md
- arxiv 2502.18864 — "Towards an AI Co-Scientist" (Google DeepMind, Feb 2025)
- ICLR 2025 Blogpost — "Multi-LLM-Agents Debate: Performance, Efficiency, and Scaling Challenges"
- Google Research blog — "Accelerating scientific breakthroughs with an AI co-scientist"

## Code Files Read
- src/lib/evolution/types.ts — All interfaces and type definitions
- src/lib/evolution/config.ts — Pipeline configuration and defaults
- src/lib/evolution/index.ts — Public API surface
- src/lib/evolution/agents/base.ts — AgentBase abstract class
- src/lib/evolution/agents/generationAgent.ts — Fresh variant generation
- src/lib/evolution/agents/evolvePool.ts — Genetic evolution operators
- src/lib/evolution/agents/reflectionAgent.ts — Dimensional critique
- src/lib/evolution/agents/metaReviewAgent.ts — Statistical meta-review
- src/lib/evolution/agents/calibrationRanker.ts — Pairwise calibration ranking
- src/lib/evolution/agents/tournament.ts — Swiss-style tournament
- src/lib/evolution/agents/pairwiseRanker.ts — Base comparison engine
- src/lib/evolution/core/pipeline.ts — Pipeline orchestration
- src/lib/evolution/core/supervisor.ts — Phase transition logic
- src/lib/evolution/core/state.ts — Mutable pipeline state
- src/lib/evolution/core/pool.ts — Parent/opponent selection
- src/lib/evolution/core/llmClient.ts — Budget-wrapped LLM client
- src/lib/evolution/core/comparisonCache.ts — Comparison deduplication
- src/lib/evolution/core/elo.ts — Elo rating calculations
