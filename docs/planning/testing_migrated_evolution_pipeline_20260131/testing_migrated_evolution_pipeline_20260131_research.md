# Testing Migrated Evolution Pipeline Research

## Problem Statement

We need a practical way to select a piece of content and run the evolution pipeline on it — both for validating that the migrated pipeline works correctly and for iterating on sample articles with known quality issues (e.g., filler words, poor structure). The current pipeline is tightly coupled to Supabase for checkpointing and status tracking, and all entry points require a pre-existing `explanation_id` in the database.

## High Level Summary

The evolution pipeline is a multi-phase system (EXPANSION → COMPETITION) that generates text variants via LLM calls, ranks them with Elo scoring, and iteratively improves content. It stores runs in `evolution_runs`, variants in `evolution_variants`, and crash-recovery state in `evolution_checkpoints`. Three entry points exist today — an admin UI, a batch runner script, and an inline server action — but none support running on arbitrary local files without first inserting content into the database.

We identified four approaches (A–D) for building a "select content → run pipeline" workflow, ranging from a DB-free standalone script to an admin UI enhancement.

## Current Architecture

### Pipeline Entry Points

| Entry Point | File | Pipeline Mode | Trigger |
|---|---|---|---|
| Admin UI | `src/app/admin/quality/evolution/page.tsx` | Minimal (generation + calibration) | Manual: enter `explanation_id` in queue dialog |
| Batch Runner | `scripts/evolution-runner.ts` | Full (all agents, phase-aware) | CLI: `npx tsx scripts/evolution-runner.ts` |
| Inline Trigger | `src/lib/services/evolutionActions.ts` (`triggerEvolutionRunAction`) | Minimal | Server action from admin UI on pending runs |

### Database Tables

| Table | Purpose |
|---|---|
| `evolution_runs` | Run metadata: status, phase, budget, config, runner coordination |
| `evolution_variants` | Generated text variants with Elo scores and lineage |
| `evolution_checkpoints` | Crash recovery: serialized `PipelineState` JSONB snapshots |
| `content_history` (removed) | Rollback tracking when winners are applied |

### Key Coupling: Pipeline ↔ Supabase

`executeMinimalPipeline()` and `executeFullPipeline()` in `src/lib/evolution/core/pipeline.ts` call `createSupabaseServiceClient()` directly inside `persistCheckpoint()` — this is hardcoded, not injectable. The agents themselves (`GenerationAgent`, `CalibrationRanker`, etc.) do **not** depend on Supabase; only the orchestrator does.

### Environment Requirements

- `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — required for checkpoint persistence
- `OPENAI_API_KEY` — required for LLM calls (defaults to DeepSeek `deepseek-chat` for cost efficiency)
- Feature flags in `feature_flags` DB table: `evolution_tournament_enabled`, `evolution_evolve_pool_enabled`, `evolution_dry_run_only`

### Sample Content

- `docs/sample_evolution_content/filler_words.md` — article deliberately stuffed with hedge words and filler ("basically", "actually", "honestly") as a quality-improvement test case
- `src/testing/utils/evolution-test-helpers.ts` — `VALID_VARIANT_TEXT` constant (~300 chars) used by integration tests

## Options for "Select Content → Run Pipeline"

### Option A: Standalone CLI Script (no DB required)

Create `scripts/run-evolution-local.ts` that bypasses Supabase entirely.

**How it works:**
- Reads a markdown file from disk
- Constructs `PipelineStateImpl` with file content as `originalText`
- Calls `GenerationAgent.execute()` → `CalibrationRanker.execute()` directly (thin loop, no `executeMinimalPipeline`)
- Outputs variants to stdout or JSON file in `docs/sample_evolution_content/`

**Pros:**
- Zero DB dependency, works offline
- Fast iteration loop for sample files
- Great for development/debugging agents in isolation

**Cons:**
- Requires writing a lightweight orchestration loop (can't reuse `executeMinimalPipeline` as-is due to Supabase coupling)
- No checkpoint/resume capability
- Doesn't validate the full DB-integrated flow

### Option B: Seed-and-Queue Script (file → DB → batch runner)

Create `scripts/queue-evolution-file.ts` that inserts content into the DB then runs the existing pipeline.

**How it works:**
1. Reads file from disk
2. Inserts a `[TEST]` explanation row into Supabase
3. Inserts a pending `evolution_runs` row
4. Optionally runs the batch runner inline (`--execute` flag)
5. Reports results, cleans up test data

**Pros:**
- Uses the full existing pipeline unmodified
- Tests the real DB flow end-to-end (checkpointing, status transitions, variant persistence)
- Closest to production behavior

**Cons:**
- Requires Supabase connection + API keys
- Creates throwaway DB rows (needs cleanup)
- Slower iteration cycle

### Option C: Integration Test Harness with Sample File Loader

Parameterized Jest integration test that loads files from `docs/sample_evolution_content/`.

**How it works:**
- Test reads all `.md` files from sample directory
- Seeds a test explanation per file using existing `seedTestData()` helpers
- Runs `executeMinimalPipeline()` with mock or real LLM
- Reports results; DB cleanup handled by test teardown

**Pros:**
- Existing infrastructure handles module resolution (`@/` aliases), DB setup/teardown, mocking
- Can toggle mock LLM (pipeline mechanics) vs real LLM (content improvement)
- CI-friendly

**Cons:**
- Tied to Jest runtime
- Heavier startup than a simple script
- Mock LLM mode doesn't test actual content improvement

### Option D: Admin UI Enhancement — "Paste Content" Mode

Add a second input mode to the evolution admin queue dialog: paste or upload raw markdown instead of entering an `explanation_id`.

**How it works:**
- New tab in queue dialog: "Paste Content" alongside existing "By Explanation ID"
- Server action creates a temporary explanation row, queues the run, links to results
- Results visible in existing admin dashboard

**Pros:**
- Non-technical users can test content
- Visual results in the existing Elo/variant dashboard
- Reusable beyond this testing project

**Cons:**
- Most UI work of all options
- Scope creep for a testing-focused project
- Still requires full environment (DB + API keys)

## Recommendation

**Option A** is the best fit for this testing project. The agents don't depend on Supabase — only the pipeline orchestrator does. A thin loop that calls agents directly gives us the fastest feedback cycle for validating pipeline behavior against sample files. Option B serves as a follow-up for end-to-end validation once the agents are confirmed working.

## Documents Read

- `docs/docs_overall/getting_started.md` — documentation structure and reading order
- `docs/docs_overall/architecture.md` — system design, data flow, tech stack
- `docs/docs_overall/project_workflow.md` — project execution workflow
- `docs/sample_evolution_content/filler_words.md` — sample article for testing

## Code Files Read

- `src/lib/evolution/index.ts` — public API exports
- `src/lib/evolution/types.ts` — core interfaces (TextVariation, PipelineState, ExecutionContext, etc.)
- `src/lib/evolution/config.ts` — DEFAULT_EVOLUTION_CONFIG, ELO_CONSTANTS, K_SCHEDULE
- `src/lib/evolution/core/pipeline.ts` — executeMinimalPipeline, executeFullPipeline orchestrators
- `src/lib/evolution/core/state.ts` — PipelineStateImpl, serialize/deserialize
- `src/lib/evolution/core/costTracker.ts` — CostTrackerImpl with per-agent budget enforcement
- `src/lib/evolution/core/llmClient.ts` — createEvolutionLLMClient wrapping callOpenAIModel
- `src/lib/evolution/core/logger.ts` — createEvolutionLogger factory
- `src/lib/evolution/agents/generationAgent.ts` — 3-strategy variant generation
- `src/lib/evolution/agents/calibrationRanker.ts` — pairwise Elo ranking
- `src/lib/services/evolutionActions.ts` — server actions (queue, trigger, apply winner, etc.)
- `src/app/admin/quality/evolution/page.tsx` — admin evolution dashboard
- `scripts/evolution-runner.ts` — batch runner CLI
- `src/testing/utils/evolution-test-helpers.ts` — mock LLM, mock logger, test factories
- `src/testing/utils/integration-helpers.ts` — DB setup/teardown, seed data
- `src/__tests__/integration/evolution-pipeline.integration.test.ts` — pipeline integration tests
- `supabase/migrations/20260131000001_evolution_runs.sql` — runs table DDL
- `supabase/migrations/20260131000002_evolution_variants.sql` — variants table DDL
- `supabase/migrations/20260131000003_evolution_checkpoints.sql` — checkpoints table DDL
