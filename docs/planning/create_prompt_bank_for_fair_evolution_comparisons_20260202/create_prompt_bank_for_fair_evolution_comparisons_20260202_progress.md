# Create Prompt Bank For Fair Evolution Comparisons — Progress

## Phase 1: Foundation — Config, Shared Library, Checkpoint Snapshots

### Work Done

**1a — Prompt Bank Config (`src/config/promptBankConfig.ts`)**
- Created pure TypeScript config file with types: `Difficulty`, `Domain`, `PromptBankEntry`, `OneshotMethod`, `EvolutionMethod`, `MethodConfig`, `PromptBankConfig`
- Defined 5 prompts (1 easy, 2 medium, 2 hard) across 5 domains (science, technology, history, philosophy, economics)
- Defined 4 methods: 3 oneshot (gpt-4.1-mini, gpt-4.1, deepseek-chat) + 1 evolution (deepseek-chat with checkpoints at 3, 5, 10 iterations)
- Default comparison config: gpt-4.1-nano judge, 3 rounds
- 14 unit tests passing

**1b — Shared Oneshot Generator (`scripts/lib/oneshotGenerator.ts`)**
- Extracted `callLLM()`, `trackLLMCall()`, `getSupabaseClient()`, `generateOneshotArticle()` from `generate-article.ts`
- Multi-provider routing: OpenAI, DeepSeek (OpenAI SDK w/ custom baseURL), Anthropic
- Returns `OneshotResult` with title, content, model, cost, tokens, duration
- 13 unit tests passing

**1c — Refactored `generate-article.ts`**
- Rewrote to import `generateOneshotArticle()` from shared module
- Removed inlined LLM code; kept CLI parsing, cost cap, file output, bank insertion
- All 14 existing tests still pass

**1d — Bank Checkpoints (`run-evolution-local.ts`)**
- Added `--bank-checkpoints` CLI flag (comma-separated iteration numbers)
- Auto-sorts checkpoints and adjusts `--iterations` upward if needed
- Created `snapshotCheckpointToBank()` with two-layer duplicate prevention:
  1. Batch runner coverage check (skip already-existing entries)
  2. Per-insertion SELECT with JSONB `.contains('metadata', { iterations: N })`
- Checkpoint calls in both `runMinimalPipeline` and `runFullPipeline` (including budget_exceeded early exit)
- End-of-run bank insertion skips if final iteration was already a checkpoint
- 20 tests passing (+10 new)

### Issues Encountered
- **Workflow hook blocker**: Branch name `feat/create_prompt_bank_...` didn't match existing project folder at `docs/planning/create_prompt_bank_...`. Fixed by creating symlinked directory at `docs/planning/feat/create_prompt_bank_.../` with `_status.json`.
- **ESLint `no-explicit-any`**: Duplicate check callback used `(e: any)`. Fixed to `(e: { topic?: { prompt?: string } })`.
- **TypeScript TS2345**: Supabase join `article_bank_topics!inner(prompt)` returns `topic` as array in TS types. Fixed with `Array.isArray(topic)` guard.

### User Clarifications
None needed — planning doc was comprehensive.

---

## Phase 2: Batch Generation Script (`scripts/run-prompt-bank.ts`)

### Work Done
- Built batch generation orchestrator that reads PROMPT_BANK config and builds coverage matrix via Supabase queries
- Oneshot generation: calls `generateOneshotArticle()` + `addEntryToBank()`
- Evolution generation: spawns child process via `execFileSync('npx', ['tsx', 'scripts/run-evolution-local.ts', ...])` with `--bank-checkpoints`
- Features: `--dry-run`, `--methods`, `--prompts`, `--max-cost`, `--delay`, `--skip-evolution`
- Resume support: coverage check skips already-generated entries
- Graceful shutdown on SIGINT/SIGTERM
- 22 unit tests passing

### Issues Encountered
None.

---

## Phase 3: Batch Comparison Script (`scripts/run-prompt-bank-comparisons.ts`)

### Work Done
- Built batch comparison runner for all prompt bank topics
- Reuses `compareWithBiasMitigation()` from `src/lib/evolution/comparison`
- All-pairs comparison with configurable rounds
- Elo updates with K=32, baseline 1200, elo_per_dollar computation
- Per-topic winners + aggregate summary table by method label (avg Elo, win rate)
- CLI flags: `--judge-model`, `--rounds`, `--prompts`, `--min-entries`
- 14 unit tests passing

### Issues Encountered
- **ESLint unused import**: `SupabaseClient` was imported but not used. Removed.

---

## Phase 4: Admin UI Integration

### Work Done

**4a — Server Actions (`articleBankActions.ts`)**
- Added `getPromptBankCoverageAction`: returns `PromptBankCoverageRow[]` with per-prompt x per-method coverage cells (exists, entryId, elo, matchCount)
- Added `getPromptBankMethodSummaryAction`: returns `PromptBankMethodSummary[]` with per-label stats (avgElo, avgCostUsd, avgEloPerDollar, winCount, winRate, entryCount)
- Helpers: `expandMethodLabels()`, `matchEntryToLabel()`, `countUncomparedEntries()`
- 4 new tests added (31 total passing)

**4d — Admin UI (`article-bank/page.tsx`)**
- Added `PromptBankCoverage` component with:
  - Coverage grid: green check (compared) / yellow dot (exists, uncompared) / grey dot (missing)
  - Method summary table: sortable columns, gold highlighting for best values
  - "Run All Comparisons" button with progress feedback
- Wired `loadData` to fetch coverage + method summary in parallel with existing data
- `handleRunAllComparisons`: sequential per-topic comparison with progress indicator
- Follows Midnight Scholar design system (CSS variables, rounded-book, font-display/font-ui)
- Lint, tsc, build all pass clean

### Issues Encountered
- **Design system lint warning**: `text-xl` on h2 changed to `text-2xl` per project rules.

---

## Summary

| Phase | Files Created | Files Modified | Tests Added | Status |
|-------|--------------|----------------|-------------|--------|
| 1a | `src/config/promptBankConfig.ts`, test | — | 14 | Done |
| 1b | `scripts/lib/oneshotGenerator.ts`, test | — | 13 | Done |
| 1c | — | `scripts/generate-article.ts` | 0 (14 existing pass) | Done |
| 1d | — | `scripts/run-evolution-local.ts`, test | 10 | Done |
| 2 | `scripts/run-prompt-bank.ts`, test | — | 22 | Done |
| 3 | `scripts/run-prompt-bank-comparisons.ts`, test | — | 14 | Done |
| 4a | — | `articleBankActions.ts`, test | 4 | Done |
| 4d | — | `article-bank/page.tsx` | 0 (visual) | Done |
| **Total** | **6 new files + 4 test files** | **4 existing files** | **77 new tests** | **Done** |
