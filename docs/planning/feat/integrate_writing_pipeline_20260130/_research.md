# Integrate Writing Pipeline Research

## Problem Statement
Determine if/how to integrate the standalone Writing Pipeline (Python) with ExplainAnything (TypeScript/Next.js). The two projects solve related but distinct problems using completely different tech stacks.

## High Level Summary

### Writing Pipeline (`/Users/abel/Documents/writing_pipeline`)
Standalone **Python 3.11+** project with two modules:

**Evals Module** — Writing quality evaluation
- Evaluates across 4 core metrics (clarity, structure, engagement, overall_score) or 10 detailed dimensions
- Uses DeepEval library with OpenAI's GEval metrics
- Position-bias-free article comparison (runs both orderings)
- Cost: ~$0.01 per 4-metric evaluation
- Entry points: `quickstart.py`, `evaluate_full.py`, `scripts/iterative_improve.py`

**Evolution Module** — Pool-based iterative text improvement
- Two-phase pipeline: EXPANSION (build diverse variant pool) → COMPETITION (rank and refine)
- 11 specialized agents: generation, evolve_pool, calibration_ranker, pairwise_ranker, tournament, reflection, meta_review, proximity, supervisor, plus base and diversity tracker
- Elo rating system for variant ranking
- Append-only pool with stratified sampling
- Cost tracking per agent with budget caps
- Diversity tracking via sentence-transformers embeddings
- ~20 pytest test files

**Tech stack**: deepeval, openai, pydantic, tenacity, structlog, sentence-transformers, numpy

**Key directory structure**:
```
writing_pipeline/
├── src/
│   ├── evals/
│   │   ├── lib/          (config, llm_client, compare, iteration)
│   │   ├── metrics/      (factory for 10 DeepEval metrics)
│   │   ├── schemas/      (Pydantic WritingQualityEval)
│   │   └── scripts/      (iterative_improve, collect_ground_truth)
│   └── evolution/
│       ├── core/         (state, pool, pipeline, cost_tracker, diversity_tracker, elo)
│       ├── agents/       (11 agent implementations, ~4100 LOC)
│       ├── fixtures/     (test data)
│       └── scripts/      (CLI entry points)
├── articles/             (sample articles)
├── tests/                (~20 test files)
└── pyproject.toml
```

---

### ExplainAnything (this project)
**TypeScript/Next.js** AI-powered publishing platform.

**Content Generation Pipeline** (`src/lib/services/returnExplanation.ts`)
- `returnExplanationLogic()`: Query → Title Generation → Vector Search (Pinecone) → Match Selection → Generate New (GPT-4 streaming) → Post-process (tags, links, summaries) → Save (Supabase)
- Supports input types: Query, EditWithTags, Rewrite, RewriteWithTags, TitleFromLink, TitleFromRegenerate

**AI Suggestion Pipeline** (`src/editorFiles/aiSuggestion.ts`, 4-step)
1. `generateAISuggestionsAction()` — LLM generates structured edit suggestions as JSON
2. `applyAISuggestionsAction()` — LLM merges edits into original content
3. `RenderCriticMarkupFromMDAstDiff()` — AST diff → CriticMarkup annotations
4. `preprocessCriticMarkup()` — Normalize for Lexical editor import

**Editor Infrastructure**
- Lexical rich text editor with CriticMarkup diff visualization (inline insert/delete/update nodes)
- Raw markdown (plaintext) editor as alternative mode
- AIEditorPanel: quick actions (Simplify, Expand, Fix Grammar, Make Formal), tag-based rewriting, source-grounded editing

**State Management** (`src/reducers/pageLifecycleReducer.ts`)
- Lifecycle phases: idle → loading → streaming → viewing → editing → saving → error
- Tracks originalContent/originalTitle for change detection
- Discriminated union type for mutual exclusivity

**Publishing** (`src/actions/actions.ts`)
- Draft articles: update in place
- Published articles: create new version (original preserved)
- Embedding regeneration on content change

**Tech stack**: Next.js 15.2.8, React 19, TypeScript strict, Lexical 0.34, Supabase, Pinecone, OpenAI, Zod, Jest 30, Playwright 1.56

---

## Key Differences

| Dimension | Writing Pipeline | ExplainAnything |
|-----------|-----------------|-----------------|
| Language | Python 3.11+ | TypeScript (strict) |
| Runtime | CLI / batch | Web server (Next.js) |
| LLM usage | Evaluation + evolution (many calls) | Generation + editing (streaming) |
| Cost profile | Expensive per run (evolution uses 11 agents) | Moderate per request (1-3 LLM calls) |
| User interaction | Offline / human-in-the-loop | Real-time web UI |
| Content model | Raw text variants with Elo scores | Markdown in Supabase with embeddings |
| Validation | Pydantic | Zod |
| Testing | pytest (~20 files) | Jest + Playwright (80+ unit, 10 integration, 9 E2E) |

## Potential Integration Points

1. **Quality evaluation** — Use evals module to score ExplainAnything content before/after AI editing
2. **Iterative improvement** — Use evolution pipeline to improve generated explanations through multiple rounds
3. **Content comparison** — Use position-bias-free comparison to evaluate AI suggestions vs originals
4. **Metrics dashboard** — Surface writing quality scores (clarity, structure, engagement) in the admin panel
5. **Batch quality audit** — Run evals across all published content to identify low-quality articles

## Open Questions

- Should the writing pipeline run as a Python microservice, be rewritten in TypeScript, or stay as a CLI tool?
- Is the evolution pipeline's cost acceptable for real-time use, or is it batch-only?
- Which specific features from writing_pipeline are highest priority to bring into ExplainAnything?
- Should integration be bidirectional (ExplainAnything content flows into writing_pipeline for evaluation)?

## Documents Read
- `docs/docs_overall/getting_started.md`
- `docs/docs_overall/architecture.md`
- `docs/docs_overall/project_workflow.md`
- `.claude/doc-mapping.json`

## Code Files Read

### Writing Pipeline
- `/Users/abel/Documents/writing_pipeline/pyproject.toml`
- `/Users/abel/Documents/writing_pipeline/src/evals/lib/config.py`
- `/Users/abel/Documents/writing_pipeline/src/evals/lib/llm_client.py`
- `/Users/abel/Documents/writing_pipeline/src/evals/lib/compare.py`
- `/Users/abel/Documents/writing_pipeline/src/evals/lib/iteration.py`
- `/Users/abel/Documents/writing_pipeline/src/evals/metrics/criteria.py`
- `/Users/abel/Documents/writing_pipeline/src/evals/metrics/factory.py`
- `/Users/abel/Documents/writing_pipeline/src/evals/schemas/writing_quality.py`
- `/Users/abel/Documents/writing_pipeline/src/evolution/core/state.py`
- `/Users/abel/Documents/writing_pipeline/src/evolution/core/pool.py`
- `/Users/abel/Documents/writing_pipeline/src/evolution/core/pipeline.py`
- `/Users/abel/Documents/writing_pipeline/src/evolution/agents/*.py` (11 agent files)

### ExplainAnything
- `src/lib/services/returnExplanation.ts`
- `src/editorFiles/aiSuggestion.ts`
- `src/editorFiles/actions/actions.ts`
- `src/editorFiles/lexicalEditor/LexicalEditor.tsx`
- `src/components/RawMarkdownEditor.tsx`
- `src/components/AIEditorPanel.tsx`
- `src/reducers/pageLifecycleReducer.ts`
- `src/actions/actions.ts`
- `src/app/results/page.tsx`
