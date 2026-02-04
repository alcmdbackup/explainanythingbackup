# Create Prompt Bank For Fair Evolution Comparisons Plan

## Background

The article bank (4 tables, 12 server actions, 4 CLI scripts, 4-tab admin UI) enables cross-method quality comparison via Elo-based pairwise matchups. The evolution pipeline (`run-evolution-local.ts`) can generate articles and add winners + baselines to the bank with `--bank`. The 1-shot generator (`generate-article.ts`) supports 10 models with `--bank`. Together, these provide all generation, storage, and comparison machinery. What's missing is the orchestration layer — a curated set of prompts and a batch runner that systematically generates articles across all methods for those prompts.

## Problem

Today, topics are created ad-hoc when users manually run scripts with arbitrary prompt text. There is no guarantee all methods are represented for each topic, no batch generation mechanism, no difficulty stratification, and slight prompt phrasing variations can create duplicate topics instead of matching existing ones. A prompt bank would provide a canonical, version-controlled set of prompts that ensures fair, apples-to-apples comparisons across generation methods. The batch runner would fill in missing entries automatically, and a batch comparison script would rank them all.

## Options Considered

### Option A: Config-File-Only Prompt Bank (Chosen)

A TypeScript config file defines the canonical prompts + method matrix. Batch scripts read the config, check existing entries via Supabase, and generate/compare what's missing. No new DB tables.

**Pros**: Simple, version-controlled, reproducible, no migration needed, prompts are code-reviewed.
**Cons**: Can't manage prompts from the UI (but this is a feature — prompts should be deliberate, not ad-hoc).

### Option B: New DB Table + Admin UI

A `prompt_bank_definitions` table stores prompts, metadata, and target methods. An admin page manages them.

**Pros**: UI-manageable, flexible at runtime.
**Cons**: Over-engineered for the initial use case (20-50 prompts), requires migration, prompt curation benefits from version control and code review, not UI edits.

### Option C: Config File + DB `is_prompt_bank` Column

Config file as source of truth, plus a boolean column on `article_bank_topics` to tag prompt-bank topics.

**Pros**: Queryable in DB, can filter in UI.
**Cons**: Two sources of truth, column adds marginal value since the batch scripts can match by prompt text.

**Decision**: Option A. The config file IS the prompt bank. Topics are identified by matching prompt text (using existing LOWER(TRIM()) normalization). No schema changes needed. The cross-topic summary action already aggregates results once entries and comparisons exist.

## Phased Execution Plan

### Phase 1: Prompt Bank Config + Shared Generation Library

**Goal**: Define the curated prompt set, method matrix, and extract reusable generation logic from `generate-article.ts`.

#### 1a. Create prompt bank config (`src/config/promptBankConfig.ts`)

**Location**: `src/config/promptBankConfig.ts` (NOT `scripts/lib/`). This file must be importable by both CLI scripts (via `../src/config/promptBankConfig`) and server actions (via `@/config/promptBankConfig`). Placing it in `src/config/` alongside `llmPricing.ts` follows existing patterns and avoids the scripts/ → src/ cross-boundary import problem. The file must have zero dependencies on dotenv, path, or any Node-only module — it exports only pure types and a const object.

Defines 5 curated prompts across 3 difficulty tiers and 5 domains (one domain per prompt), plus the method matrix with 6 comparable methods.

```typescript
// Curated prompt bank config for fair cross-method article quality comparison.
// Defines canonical prompts and the generation methods to compare.

export type Difficulty = 'easy' | 'medium' | 'hard';
export type Domain = 'science' | 'history' | 'technology' | 'economics' | 'philosophy';

export interface PromptBankEntry {
  prompt: string;
  difficulty: Difficulty;
  domain: Domain;
}

export type GenerationMethodType = 'oneshot' | 'evolution';

export interface OneshotMethod {
  type: 'oneshot';
  model: string;
  label: string; // e.g. "oneshot_gpt-4.1-mini"
}

export interface EvolutionMethod {
  type: 'evolution';
  seedModel: string;
  evolutionModel: string;
  checkpoints: number[]; // e.g. [3, 5, 10] — runs to max, snapshots best variant at each
  mode: 'minimal' | 'full'; // minimal = 2 agents (generation + calibration), full = 7 agents
  label: string; // e.g. "evolution_deepseek"
}

export type MethodConfig = OneshotMethod | EvolutionMethod;

export interface PromptBankConfig {
  prompts: PromptBankEntry[];
  methods: MethodConfig[];
  comparison: {
    judgeModel: string;
    rounds: number;
  };
}

export const PROMPT_BANK: PromptBankConfig = {
  prompts: [
    // Easy (1) — fundamental concept
    { prompt: 'Explain photosynthesis', difficulty: 'easy', domain: 'science' },

    // Medium (2) — multi-faceted concepts, moderate depth
    { prompt: 'Explain how blockchain technology works', difficulty: 'medium', domain: 'technology' },
    { prompt: 'Explain the causes of World War I', difficulty: 'medium', domain: 'history' },

    // Hard (2) — cross-disciplinary, requires nuanced explanation
    { prompt: 'Explain the philosophical implications of Gödel\'s incompleteness theorems', difficulty: 'hard', domain: 'philosophy' },
    { prompt: 'Explain how the Federal Reserve\'s monetary policy affects global markets', difficulty: 'hard', domain: 'economics' },
  ],

  methods: [
    { type: 'oneshot', model: 'gpt-4.1-mini', label: 'oneshot_gpt-4.1-mini' },
    { type: 'oneshot', model: 'gpt-4.1', label: 'oneshot_gpt-4.1' },
    { type: 'oneshot', model: 'deepseek-chat', label: 'oneshot_deepseek-chat' },
    { type: 'evolution', seedModel: 'deepseek-chat', evolutionModel: 'deepseek-chat', checkpoints: [3, 5, 10], mode: 'minimal', label: 'evolution_deepseek' },
  ],

  comparison: {
    judgeModel: 'gpt-4.1-nano',
    rounds: 3,
  },
};
```

**Scale**: 5 prompts × 6 comparable methods (3 oneshot + 3 evolution checkpoints) = 30 entries. Each prompt gets one evolution run (to iteration 10) that produces 3 checkpoint snapshots + 1 baseline = 4 evolution entries. Estimated cost: $2–$10.

#### 1b. Extract shared generation function (`scripts/lib/oneshotGenerator.ts`)

Extract the core title + article generation logic from `generate-article.ts` into a reusable function. This avoids duplicating the multi-provider LLM call logic.

```typescript
// Shared oneshot article generation logic extracted from generate-article.ts.
// Generates a title + article for a given prompt and model using direct LLM SDK calls.

export interface OneshotResult {
  title: string;
  content: string;
  model: string;
  totalCostUsd: number;
  promptTokens: number;
  completionTokens: number;
}

/** Generate a complete article (title + content) for a prompt using the specified model. */
export async function generateOneshotArticle(
  prompt: string,
  model: string,
  supabase: SupabaseClient | null,
): Promise<OneshotResult> { ... }
```

The function encapsulates:
- `callLLM()` (multi-provider: OpenAI/DeepSeek/Anthropic — copied from generate-article.ts)
- Title generation via `createTitlePrompt()` + JSON parsing with fallback
- Article generation via `createExplanationPrompt()`
- Cost calculation via `calculateLLMCost()`
- LLM call tracking via fire-and-forget `trackLLMCall()`

#### 1c. Refactor `generate-article.ts` to use shared function

Replace the inline generation logic in `generate-article.ts:main()` with a call to `generateOneshotArticle()`. The script retains its CLI argument parsing, cost estimation/cap check, output file writing, and bank insertion. Only the LLM calls are delegated.

#### 1d. Add `--bank-checkpoints` flag to `run-evolution-local.ts`

Add a new CLI flag that snapshots the current best variant to the article bank at specified iteration milestones during a single evolution run.

```
--bank-checkpoints <list>   Comma-separated iteration numbers to snapshot (e.g., "3,5,10")
                            Requires --bank and --prompt. Runs to max checkpoint iteration.
```

**Implementation**: In the main iteration loop (around line 880 in `run-evolution-local.ts`), after each iteration completes:
1. Check if `state.iteration` is in the checkpoints list
2. If so, get current best variant via `state.getTopByElo(1)`
3. **Duplicate check**: Query `article_bank_entries` for existing entry matching (topic by prompt text, `generation_method='evolution_winner'`, `.contains('metadata', { iterations: currentIteration })`). Skip insertion if found. This prevents duplicates when a crashed run is re-spawned.
4. Call `addEntryToBank()` with `generation_method: 'evolution_winner'` and `metadata.iterations` set to the current checkpoint value
5. The final iteration's snapshot replaces the existing end-of-run bank insertion logic

This means a single `--iterations 10 --bank-checkpoints 3,5,10` run produces:
- 3 `evolution_winner` entries (at iterations 3, 5, 10) with `metadata.iterations` = 3, 5, 10 respectively
- 1 `evolution_baseline` entry (the seed, inserted at end as before)

**Backward compatibility**: Without `--bank-checkpoints`, the existing behavior is unchanged — only the final winner + baseline are inserted.

**Early exit handling**: If the pipeline stops before reaching all checkpoints (convergence, budget_exceeded, SIGINT), snapshot whatever is available at the current iteration if it matches a checkpoint. Missing checkpoints are simply not inserted — the batch runner's resume logic will detect them as gaps on the next run.

**Deliberate design decision — `evolution_winner` for checkpoints**: Checkpoint entries use `generation_method='evolution_winner'` (the only valid value per the DB CHECK constraint) distinguished by `metadata.iterations`. This means the existing `getCrossTopicSummaryAction` and admin leaderboard will lump all evolution checkpoint entries together when grouping by `generation_method`. This is acceptable because: (1) the new `getPromptBankMethodSummaryAction` provides the 6-method breakdown; (2) the existing summary was never designed for checkpoint-level granularity; (3) adding a new `generation_method` value would require a migration and break existing views. Checkpoint entries are identifiable by the presence of `metadata.iterations` — entries without this field are final winners from the existing `--bank` flow.

**Files modified:**
- `scripts/run-evolution-local.ts` — add `--bank-checkpoints` parsing and checkpoint insertion logic
- `scripts/generate-article.ts` — refactor main() to call `generateOneshotArticle()`

**Files created:**
- `src/config/promptBankConfig.ts` — prompt bank definition + types (zero external dependencies)
- `scripts/lib/oneshotGenerator.ts` — shared oneshot generation function

**Tests:**
- `src/config/promptBankConfig.test.ts` — validate config: no duplicate prompts, all prompts non-empty, methods have valid models, difficulty distribution (1/2/2), domain coverage (5 unique), checkpoints sorted ascending
- `scripts/lib/oneshotGenerator.test.ts` — mock LLM calls, verify title parsing, cost calculation, error handling
- `scripts/run-evolution-local.test.ts` (new or extend) — test checkpoint parsing, snapshot at correct iterations, metadata.iterations set correctly, early exit partial snapshot
- Verify `scripts/generate-article.test.ts` still passes (existing 12 tests)

---

### Phase 2: Batch Generation Script (`scripts/run-prompt-bank.ts`)

**Goal**: A CLI script that reads the prompt bank config and generates all missing entries across prompts × methods.

#### 2a. Create the batch generation script

```
Usage: npx tsx scripts/run-prompt-bank.ts [options]

Options:
  --dry-run              Show what would be generated without making LLM calls
  --methods <list>       Comma-separated method labels to run (default: all)
  --prompts <list>       Comma-separated prompt indices or "easy"/"medium"/"hard" (default: all)
  --max-cost <n>         Total budget cap in USD (default: 25.00)
  --delay <ms>           Delay between API calls in ms (default: 2000)
  --skip-evolution       Skip evolution methods (oneshot only)
  --help                 Show help
```

**Core logic:**
1. Load `PROMPT_BANK` config
2. Connect to Supabase, fetch all existing topics + entries
3. Build coverage matrix: for each prompt × method, check if entry exists:
   - **Oneshot**: match by `LOWER(TRIM(prompt))` + `generation_method='oneshot'` + `model`
   - **Evolution checkpoints**: match by `LOWER(TRIM(prompt))` + `generation_method='evolution_winner'` + `metadata->iterations` for each checkpoint value
4. Print coverage summary table (showing gaps)
5. If `--dry-run`, print estimated costs and exit
6. For each missing entry (sequential):
   - **Oneshot**: call `generateOneshotArticle()`, then `addEntryToBank()`
   - **Evolution**: for each prompt with any missing checkpoints, spawn a single run:
     `npx tsx scripts/run-evolution-local.ts --prompt <prompt> --model <evoModel> --seed-model <seedModel> --iterations <maxCheckpoint> --bank --bank-checkpoints <missing_checkpoints>`
     One run per prompt produces all missing checkpoint snapshots. If checkpoint 3 exists but 5 and 10 don't, spawn with `--iterations 10 --bank-checkpoints 5,10`.
   - Track running cost total, abort if `--max-cost` exceeded
   - Print progress: `[3/30] ✓ "Explain photosynthesis" × oneshot_gpt-4.1-mini ($0.03)`
   - Print progress: `[16/30] ✓ "Explain photosynthesis" × evolution_deepseek [3,5,10] ($0.35)`
7. Graceful shutdown on SIGTERM/SIGINT (finish current generation, skip remaining)
8. Print final summary: entries generated, entries skipped (already existed), total cost, elapsed time

**Key design decisions:**
- **Sequential execution**: Matches existing script patterns (Finding 12). Simplifies cost tracking, avoids rate limits, and makes errors easy to diagnose.
- **Evolution via child process with checkpoints**: The evolution pipeline has complex internal state. Spawning as a subprocess with `--bank-checkpoints` is cleanest — one 10-iteration run produces 3 bank entries (at iterations 3, 5, 10) plus the baseline. This avoids running 3 separate evolution runs per prompt.
- **Resume support**: Built-in via coverage check — re-running the script after a partial failure skips already-generated entries.
- **Delay between calls**: Configurable `--delay` (default 2s) prevents rate limiting across providers.
- **Coverage matching filters soft-deleted entries**: All coverage queries include `.is('deleted_at', null)` to avoid counting deleted entries as existing, matching the pattern in `articleBankActions.ts`.

**Child process spawning specification:**

Evolution runs use `child_process.execFileSync()` (not `spawn` or `exec`) to keep it synchronous and blocking:

```typescript
import { execFileSync } from 'child_process';

const args = [
  'tsx', 'scripts/run-evolution-local.ts',
  '--prompt', prompt,
  '--model', method.evolutionModel,
  '--seed-model', method.seedModel,
  '--iterations', String(Math.max(...missingCheckpoints)),
  '--bank',
  '--bank-checkpoints', missingCheckpoints.join(','),
  ...(method.mode === 'full' ? ['--full'] : []),
];

execFileSync('npx', args, {
  cwd: projectRoot,
  env: process.env,        // inherits all env vars (API keys, Supabase keys)
  stdio: ['ignore', 'pipe', 'pipe'],  // capture stdout/stderr
  timeout: method.mode === 'full' ? 1_200_000 : 600_000, // 20min full, 10min minimal
  maxBuffer: 10 * 1024 * 1024,  // 10MB buffer for verbose output
});
```

- **Env propagation**: `env: process.env` is passed explicitly (Node.js `execFileSync` inherits parent env by default when `env` is omitted, but we pass it explicitly for clarity and testability). This passes all API keys (OPENAI_API_KEY, DEEPSEEK_API_KEY, ANTHROPIC_API_KEY, SUPABASE_SERVICE_ROLE_KEY) without exposing them on the command line.
- **Signal handling**: On SIGINT/SIGTERM, the parent sets `shuttingDown = true`. Since `execFileSync` is synchronous and blocking, the parent cannot interrupt a running child — it waits for the current child to finish, then skips remaining prompts in the next loop iteration. The child has its own SIGINT handler that finishes the current iteration.
- **Error handling**: If the child exits with non-zero code, `execFileSync` throws. The batch runner catches this, logs the error, and continues to the next prompt (partial failure tolerance). Any checkpoints the child inserted before failing are preserved in the DB.
- **Cost tracking**: The parent cannot observe the child's spend in real-time. After the child exits, the parent queries the DB for newly inserted entries to tally cost. The `--max-cost` cap is a best-effort pre-flight check based on estimated per-prompt costs.
- **Required API keys**: The batch runner validates on startup that all required API keys are present: `OPENAI_API_KEY` (for oneshot gpt-4.1-mini/gpt-4.1 and judge), `DEEPSEEK_API_KEY` (for oneshot deepseek-chat and evolution), `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- **Evolution pipeline mode**: Controlled by the `mode` field on `EvolutionMethod`. The config defaults to `'minimal'` (2 agents: generation + calibration, faster and cheaper). The batch runner conditionally appends `--full` when `mode === 'full'`. Timeout is mode-dependent: 10 minutes for minimal, 20 minutes for full.
- **Checkpoint cost semantics**: Each checkpoint entry's `total_cost_usd` is the **cumulative cost at snapshot time** (i.e., `costTracker.getTotalSpent()` at the iteration the snapshot occurs). This means the iteration-3 entry has a lower cost than the iteration-10 entry, reflecting the actual investment to reach that quality level. The Method Summary Table's "Avg Cost" column shows these cumulative costs, making cost-quality tradeoffs visible (e.g., "iteration 3 costs $0.15 for Elo 1225 vs iteration 10 costs $0.38 for Elo 1260").
- **Duplicate checkpoint prevention**: Two-layer defense. (1) The batch runner's coverage check skips prompts with existing checkpoint entries. (2) The checkpoint insertion logic in `run-evolution-local.ts` does a SELECT before INSERT using `.contains('metadata', { iterations: N })` to check for existing entries — skips insertion if found. This handles the edge case where a crashed run is re-spawned and the batch runner passes checkpoints that were partially inserted by the prior run.

**Files created:**
- `scripts/run-prompt-bank.ts` — batch generation orchestrator

**Tests:**
- `scripts/run-prompt-bank.test.ts` — test coverage matrix building, dry-run mode, method/prompt filtering, cost cap logic, parseArgs

---

### Phase 3: Batch Comparison Script (`scripts/run-prompt-bank-comparisons.ts`)

**Goal**: Run pairwise comparisons for all prompt bank topics with multiple rounds.

```
Usage: npx tsx scripts/run-prompt-bank-comparisons.ts [options]

Options:
  --judge-model <name>   Judge model (default: gpt-4.1-nano)
  --rounds <n>           Comparison rounds per topic (default: 3)
  --prompts <list>       Filter prompts by index or difficulty tier
  --min-entries <n>      Skip topics with fewer than N entries (default: 2)
  --help                 Show help
```

**Core logic:**
1. Load `PROMPT_BANK` config
2. Fetch all topics, match prompt bank prompts to existing topic IDs
3. For each matched topic with ≥ `min-entries` entries:
   - Fetch entries + current Elo ratings
   - Run `runBankComparisonAction()`-equivalent logic (Swiss pairing, bias-mitigated comparison, Elo updates) — reuse `compareWithBiasMitigation()` from `comparison.ts` and Elo update functions from `elo.ts`
   - Print per-topic leaderboard
4. Print cross-topic summary (reuse `getCrossTopicSummaryAction` logic or call it directly)
5. Print final aggregate: avg Elo by method, win rate by method, avg Elo/$ by method

**Note**: This script reuses the same comparison logic as `run-bank-comparison.ts` but operates on all prompt bank topics in a loop instead of a single topic. The comparison logic (Swiss pairing, bias mitigation, Elo updates) is imported from the existing shared modules.

**Files created:**
- `scripts/run-prompt-bank-comparisons.ts` — batch comparison runner

**Tests:**
- `scripts/run-prompt-bank-comparisons.test.ts` — test topic matching, min-entries filter, prompt filtering, summary aggregation

---

### Phase 4: Coverage Matrix, Cost Monitoring & Batch Comparison UI

**Goal**: Show prompt bank coverage status, per-method cost/quality breakdown, and a "Run All Comparisons" button in the admin article bank page.

#### 4a. Add `getPromptBankCoverageAction` server action

New server action (with `requireAdmin()` guard, matching all existing actions) that:
1. Imports `PROMPT_BANK` config from `@/config/promptBankConfig`
2. Fetches all topics matching prompt bank prompts (by LOWER(TRIM()) match)
3. For each prompt, queries entries (`.is('deleted_at', null)`) and groups by `generation_method + model + metadata->iterations`. **JSONB query pattern**: Use Supabase `.contains('metadata', { iterations: 3 })` for matching evolution checkpoint entries. This calls the PostgREST `cs` (contains) operator — confirmed available on `PostgrestFilterBuilder` in `@supabase/postgrest-js`. The value is serialized via `JSON.stringify({ iterations: 3 })`. This is the first JSONB containment query in the codebase (no existing `metadata->` or `.contains()` usage); integration tests must validate this round-trip. **Standardized pattern**: all code (server actions, CLI scripts, tests) must use `.contains('metadata', { iterations: N })` — never raw `metadata->>` or `.filter()` with manual operators.
4. Returns a coverage matrix: `Array<{ prompt, difficulty, domain, methods: Record<label, { exists, entryId?, elo?, costUsd? }> }>` where evolution methods are expanded into one column per checkpoint (e.g., `evolution_deepseek_3iter`, `evolution_deepseek_5iter`, `evolution_deepseek_10iter`)

#### 4b. Add `getPromptBankMethodSummaryAction` server action

New server action (with `requireAdmin()` guard) that computes per-method-label stats across all prompt bank topics. Unlike the existing `getCrossTopicSummaryAction` (which groups by `generation_method` — lumping all oneshot models together), this groups by the 6 method labels from the config.

```typescript
export interface PromptBankMethodSummary {
  label: string;           // e.g. "oneshot_gpt-4.1-mini", "evolution_deepseek_3iter"
  type: 'oneshot' | 'evolution';
  avgElo: number;          // mean Elo across prompt bank topics
  avgCostUsd: number;      // mean cost per entry
  avgEloPerDollar: number | null; // mean Elo/$ (null if no cost data)
  winCount: number;        // topics where this method has highest Elo
  winRate: number;         // winCount / topics with comparisons
  entryCount: number;      // how many entries exist (out of 5 prompts)
}
```

**Logic**:
1. Import `PROMPT_BANK` config
2. Fetch all prompt bank topics + entries + Elo ratings
3. For each method label, compute:
   - **Matching rule**: oneshot entries match by `generation_method='oneshot' + model`. Evolution checkpoint entries match by `generation_method='evolution_winner' + metadata->iterations`.
   - **avgElo**: Mean Elo of matched entries (only entries with `match_count > 0` to exclude uncompared entries at default 1200)
   - **avgCostUsd**: Mean `total_cost_usd` of matched entries
   - **avgEloPerDollar**: Mean `elo_per_dollar` of matched entries
   - **winCount/winRate**: Number of topics where this method's entry has the highest Elo among all entries for that topic
4. Return sorted by avgElo descending

#### 4c. Add per-topic comparison action (reuse existing `runBankComparisonAction`)

Rather than a single long-running server action for all topics, the UI calls the existing `runBankComparisonAction(topicId, judgeModel, rounds)` **per topic** in a client-side loop. This avoids timeout issues entirely:

```typescript
// In the React component (client-side):
async function runAllComparisons() {
  setRunning(true);
  const coverage = await getPromptBankCoverageAction();
  const topicIds = coverage.filter(c => c.topicId && c.entryCount >= 2).map(c => c.topicId);

  for (const topicId of topicIds) {
    setCurrentTopic(topicId);
    await runBankComparisonAction(topicId, 'gpt-4.1-nano', 3);
    setCompletedCount(prev => prev + 1);
  }

  setRunning(false);
  // Refresh coverage + method summary
}
```

**Why this approach**:
- Each `runBankComparisonAction` call handles one topic (~3-15 seconds depending on entry count). With 5 topics × ~7 entries each, Swiss pairing with 3 rounds produces ~9 matches per topic × 2 passes (bias mitigation) = ~18 judge calls. At ~1-2s each, worst case is ~30s per topic — within server action limits.
- Progress is visible to the user: "Comparing topic 3/5..."
- If one topic fails, the others still complete.
- No new server action needed — reuses the existing `runBankComparisonAction`.
- **Concurrency guard**: The button is disabled while running (`setRunning(true)`), preventing double-clicks. No server-side mutex needed since each call is a separate short-lived action.

#### 4d. Add coverage matrix + method summary + comparison button to admin UI

On the existing article bank page (`src/app/admin/quality/article-bank/page.tsx`):

**Coverage Matrix** (top section):
- "Prompt Bank" tab/section above the existing topics table
- Matrix grid: rows = 5 prompts (grouped by difficulty), columns = 6 methods (3 oneshot + 3 evolution checkpoints)
- Each cell: green check (entry exists + has matches), yellow dot (entry exists, no matches), empty (missing)
- Show totals: "25/30 entries generated, 20/30 compared"

**"Run All Comparisons" Button**:
- Below the coverage matrix, a button: "Run All Comparisons (gpt-4.1-nano, 3 rounds)"
- Calls `runPromptBankComparisonsAction()`, shows loading spinner during execution
- On completion, refreshes the coverage matrix and method summary
- Disabled state when all entries already have `match_count > 0`

**Method Summary Table** (below coverage matrix):
- 6-row table showing each method's performance:

```
Method                    | Avg Elo | Avg Cost | Elo/$ | Win Rate | Entries
─────────────────────────────────────────────────────────────────────────
oneshot_gpt-4.1-mini      | 1215    | $0.03    | 500   | 20%      | 5/5
oneshot_gpt-4.1           | 1248    | $0.25    | 192   | 40%      | 5/5
oneshot_deepseek-chat      | 1190    | $0.02    | -500  | 0%       | 5/5
evolution_deepseek @3iter  | 1225    | $0.15    | 167   | 20%      | 5/5
evolution_deepseek @5iter  | 1240    | $0.22    | 182   | 10%      | 5/5
evolution_deepseek @10iter | 1260    | $0.38    | 158   | 10%      | 5/5
```

- Sortable by any column
- Highlight the best value in each column (highest Elo, lowest cost, highest Elo/$, highest win rate)
- Color-coded rows: oneshot methods in blue, evolution checkpoints in green

**Files modified:**
- `src/lib/services/articleBankActions.ts` — add `getPromptBankCoverageAction`, `getPromptBankMethodSummaryAction`
- `src/app/admin/quality/article-bank/page.tsx` — add PromptBankCoverage component, MethodSummaryTable component, RunAllComparisonsButton component (client-side loop calling existing `runBankComparisonAction`)

**Tests:**
- Add tests for `getPromptBankCoverageAction` in `src/lib/services/articleBankActions.test.ts` (~4 tests: prompt matching, entry grouping, evolution checkpoint matching via metadata->iterations, soft-delete filtering)
- Add tests for `getPromptBankMethodSummaryAction` in `src/lib/services/articleBankActions.test.ts` (~6 tests: per-label grouping, win rate calc, Elo/$, exclusion of uncompared entries, evolution checkpoint matching, JSONB round-trip for metadata.iterations)

---

## Testing

### Unit Tests (New)

| File | Tests | What's Covered |
|------|-------|----------------|
| `src/config/promptBankConfig.test.ts` | ~10 | Config validation: no duplicate prompts, non-empty text, valid models, difficulty distribution (1/2/2), all 5 domains covered, checkpoints sorted ascending. **Note**: use `/** @jest-environment node */` pragma. |
| `scripts/lib/oneshotGenerator.test.ts` | ~10 | LLM call mocking, title JSON parsing + fallback, cost calculation, error propagation, tracking call. `/** @jest-environment node */` pragma. |
| `scripts/run-prompt-bank.test.ts` | ~14 | Coverage matrix building (oneshot + evolution checkpoint matching via `.contains()`), dry-run output, method/prompt filtering, cost cap abort, resume (skip existing), parseArgs validation, checkpoint gap detection, API key validation on startup. **Mock `child_process.execFileSync`** via `jest.mock('child_process')` — assert: (1) correct args array with `--bank-checkpoints`, (2) `env: process.env` is passed, (3) `timeout: 600_000` is set, (4) non-zero exit code throws and is caught. |
| `scripts/run-prompt-bank-comparisons.test.ts` | ~8 | Topic matching by prompt text, min-entries filtering, prompt difficulty filtering, summary aggregation |
| `scripts/run-evolution-local.test.ts` (extend existing ~10) | ~8 additive | Checkpoint flag parsing, snapshot insertion at correct iterations, metadata.iterations set correctly, backward compat without flag, early exit partial snapshot, **duplicate prevention** (SELECT before INSERT skips existing checkpoint), checkpoint cost is cumulative at snapshot time |

### Integration Tests (New)

| File | Tests | What's Covered |
|------|-------|----------------|
| `src/__tests__/integration/article-bank-actions.integration.test.ts` (extend) | ~6 additive | Real Supabase CRUD for: `getPromptBankCoverageAction` (insert test entries, verify coverage matrix), `getPromptBankMethodSummaryAction` (insert entries with known Elo/cost, verify aggregation), JSONB round-trip for `metadata.iterations` (insert with number 3, query with `metadata->>'iterations'::int = 3`) |

### E2E Tests (New)

| File | Tests | What's Covered |
|------|-------|----------------|
| `src/__tests__/e2e/specs/09-admin/admin-article-bank.spec.ts` (extend) | ~5 additive | Coverage matrix renders with correct columns, method summary table renders, "Run All Comparisons" button triggers and shows progress, coverage cells update after comparison. **Note**: existing spec is `describe.skip` — add new tests in a separate `adminTest.describe.skip` block (matching existing pattern). Un-skip when prompt bank data is seeded on staging. |

### Existing Tests (Must Still Pass)

| File | Count | Status |
|------|-------|--------|
| `scripts/generate-article.test.ts` | 12 | Must pass after refactor to use `generateOneshotArticle()` |
| `scripts/lib/bankUtils.test.ts` | 5 | No changes expected |
| `scripts/run-bank-comparison.test.ts` | 10 | No changes expected |
| `src/lib/services/articleBankActions.test.ts` | 24 | Add ~10 tests: coverage action (~4), method summary action (~6) |
| `src/lib/evolution/comparison.test.ts` | 31 | No changes expected |

### Manual Verification

1. **Dry run**: `npx tsx scripts/run-prompt-bank.ts --dry-run` — verify coverage matrix shows 6 columns (3 oneshot + 3 evolution checkpoints) and cost estimate
2. **Single oneshot**: `npx tsx scripts/run-prompt-bank.ts --methods oneshot_gpt-4.1-mini --prompts 0` — generate one entry, verify in DB
3. **Single evolution with checkpoints**: `npx tsx scripts/run-evolution-local.ts --prompt "Explain photosynthesis" --model deepseek-chat --iterations 10 --bank --bank-checkpoints 3,5,10` — verify 3 `evolution_winner` entries + 1 `evolution_baseline` in DB, each with correct `metadata.iterations`
4. **Resume**: Run batch again after step 2-3 — verify it skips already-generated entries and checkpoints
5. **CLI Comparison**: `npx tsx scripts/run-prompt-bank-comparisons.ts --rounds 1 --min-entries 2` — verify leaderboard output
6. **Admin UI — Coverage matrix**: Navigate to `/admin/quality/article-bank`, verify 6-column grid with checkpoint columns, green/yellow/empty cells
7. **Admin UI — Run All Comparisons**: Click the "Run All Comparisons" button, verify per-topic progress ("Comparing topic 3/5..."), coverage matrix refreshes with green checks after completion
8. **Admin UI — Method Summary**: Verify 6-row method summary table shows Elo, cost, Elo/$, win rate; verify best-in-column highlighting; verify sortable columns

## Rollback Plan

This feature is additive — no existing tables, columns, or constraints are modified. Rollback strategy:

1. **generate-article.ts refactor** (Phase 1c): The refactored script delegates to `generateOneshotArticle()` which contains the same logic. If a regression is found, revert the single file to inline the logic again. The shared function can remain unused.
2. **--bank-checkpoints flag** (Phase 1d): Additive. Without the flag, existing `--bank` behavior is unchanged. Revert = remove the checkpoint conditional from the iteration loop.
3. **Batch scripts** (Phase 2-3): New files only. Revert = delete the files. No existing code depends on them.
4. **Server actions + UI** (Phase 4): New actions + new UI components. Revert = remove the components and actions. Existing article bank page is unaffected since the prompt bank section is an additive tab/section.
5. **Orphaned data**: If rollback is needed after a partial batch run, prompt bank entries remain in the article bank tables. They are valid data (real articles with real Elo ratings) and do not need to be cleaned up. They simply aren't grouped/displayed as a "prompt bank" anymore.

**No CI/CD changes required**: All new test files are auto-discovered by the existing Jest config (`testMatch: ['**/*.test.ts']`). No new environment variables or secrets needed beyond the existing API keys.

## Documentation Updates

| File | Update |
|------|--------|
| `docs/feature_deep_dives/comparison_infrastructure.md` | Add "Prompt Bank" section: config format, batch generation, batch comparison CLI usage |
| `docs/docs_overall/architecture.md` | Add prompt bank to the article bank section, reference new scripts |
