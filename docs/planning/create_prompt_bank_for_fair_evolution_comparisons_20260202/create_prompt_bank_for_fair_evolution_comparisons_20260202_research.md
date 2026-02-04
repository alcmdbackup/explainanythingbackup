# Create Prompt Bank For Fair Evolution Comparisons Research

## Problem Statement

The article bank enables cross-method quality comparison by grouping articles by topic and running Elo-based pairwise comparisons. However, "topic" grouping today is based on exact prompt matching — there is no standardized, curated set of prompts designed to ensure fair, controlled comparisons. Each article bank entry may have been generated from a slightly different prompt phrasing, and there is no mechanism to systematically generate articles across all methods for the same set of prompts. A "prompt bank" would provide a canonical set of prompts that ensure apples-to-apples comparisons.

## High Level Summary

The existing infrastructure is comprehensive. The comparison_infrastructure_20260201 project built a 4-table article bank (topics, entries, comparisons, Elo), 12 server actions, 4 CLI scripts, a 4-tab admin UI, and reusable bias-mitigated comparison logic. The testing_migrated_evolution_pipeline_20260131 project added a standalone local runner (`run-evolution-local.ts`) with `--prompt` and `--bank` flags. Together, these provide all the generation, storage, and comparison machinery needed. What's missing is the orchestration layer — a way to define a set of prompts and systematically generate articles across all methods for those prompts, ensuring each topic has entries from every method being compared.

## Documents Read

- `docs/planning/comparison_infrastructure_20260201/comparison_infrastructure_20260201_research.md` — Article bank research findings
- `docs/planning/comparison_infrastructure_20260201/comparison_infrastructure_20260201_planning.md` — Article bank 4-phase plan
- `docs/planning/comparison_infrastructure_20260201/comparison_infrastructure_20260201_progress.md` — Article bank implementation progress (all 4 phases + gap fixes complete)
- `docs/planning/testing_migrated_evolution_pipeline_20260131/testing_migrated_evolution_pipeline_20260131_research.md` — Evolution pipeline local testing research
- `docs/planning/testing_migrated_evolution_pipeline_20260131/testing_migrated_evolution_pipeline_20260131_planning.md` — Empty (planning not completed)
- `docs/planning/testing_migrated_evolution_pipeline_20260131/testing_migrated_evolution_pipeline_20260131_progress.md` — Empty (execution not started)
- `docs/docs_overall/getting_started.md` — Documentation reading order
- `docs/docs_overall/architecture.md` — System architecture (includes article bank tables)
- `docs/docs_overall/project_workflow.md` — Project workflow process
- `docs/feature_deep_dives/comparison_infrastructure.md` — Full comparison infrastructure documentation
- `docs/feature_deep_dives/evolution_pipeline.md` — Evolution pipeline with prompt-based seeding section

## Code Files Read

### Article Bank Server Actions
- `src/lib/services/articleBankActions.ts` — 12 server actions: addToBankAction, getBankTopicAction, getBankEntriesAction, getBankEntryDetailAction, getBankLeaderboardAction, runBankComparisonAction, getCrossTopicSummaryAction, deleteBankEntryAction, deleteBankTopicAction, getBankTopicsAction, getBankMatchHistoryAction, generateAndAddToBankAction. Types: BankTopic, BankEntry, BankEloEntry, BankComparison, CrossTopicMethodSummary, BankTopicWithStats, AddToBankInput, GenerateAndAddInput.

### Article Bank Database Schema
- `supabase/migrations/20260201000001_article_bank.sql` — 4 tables: article_bank_topics (with UNIQUE index on LOWER(TRIM(prompt))), article_bank_entries (generation_method CHECK: oneshot/evolution_winner/evolution_baseline), article_bank_comparisons, article_bank_elo (elo_per_dollar computed metric). No RLS. FKs to content_evolution_runs/variants with ON DELETE SET NULL.

### Comparison Infrastructure
- `src/lib/evolution/comparison.ts` — Standalone `compareWithBiasMitigation()` with 2-pass A/B reversal, `buildComparisonPrompt()` (5 criteria: clarity, structure, engagement, grammar, effectiveness), `parseWinner()` with fallback parsing, order-invariant SHA-256 cache keys.
- `src/lib/evolution/core/elo.ts` — `updateEloRatings()`, `updateEloDraw()`, `updateEloWithConfidence()` (confidence-weighted), `getAdaptiveK()` (48→32→16 based on match count).
- `src/lib/evolution/config.ts` — ELO_CONSTANTS: DEFAULT_K=32, INITIAL_RATING=1200, FLOOR=800. K_SCHEDULE for adaptive K.
- `src/lib/evolution/agents/calibrationRanker.ts` — Wraps standalone comparison, stratified opponent selection, batched parallelism with early exit.
- `src/lib/evolution/agents/pairwiseRanker.ts` — Full O(N²) with optional 5-dimension structured mode.
- `src/lib/evolution/agents/tournament.ts` — Swiss pairing with info-theoretic scoring (outcome uncertainty × sigma proxy × topK boost), budget-pressure tiers (3 levels), multi-turn tiebreakers, convergence detection.

### CLI Scripts
- `scripts/generate-article.ts` — `--prompt`, `--model`, `--output`, `--max-cost`, `--bank`. Multi-provider LLM (OpenAI/DeepSeek/Anthropic). Cost estimation before call. Two-step: title (createTitlePrompt) → article (createExplanationPrompt). Tracks to llmCallTracking with call_source='oneshot_<model>'.
- `scripts/run-evolution-local.ts` — `--file`/`--prompt` (mutually exclusive), `--seed-model`, `--mock`, `--full`, `--iterations`, `--budget`, `--model`, `--bank`. Seed generation via generateSeedArticle(). Minimal vs full pipeline modes. Variant persistence to DB. Bank insertion for winner + baseline.
- `scripts/add-to-bank.ts` — `--run-id`, `--prompt`, `--include-baseline`. Fetches completed run, finds winner by highest Elo, snapshots metadata from run_summary.
- `scripts/run-bank-comparison.ts` — `--topic-id`, `--judge-model` (default gpt-4.1-nano), `--rounds`. All-pairs comparison with bias mitigation, Elo updates, leaderboard print.
- `scripts/lib/bankUtils.ts` — `addEntryToBank()`: topic upsert (case-insensitive via ilike fallback), entry insert, Elo initialization at 1200. `computeEloPerDollar()`.

### Prompt Templates & Generation
- `src/lib/prompts.ts` — 8 prompt templates: createExplanationPrompt (modular paragraphs, ## sections, bold terms), createTitlePrompt (Wikipedia-style), createStandaloneTitlePrompt, createLinkCandidatesPrompt, createMatchSelectionPrompt, createTagEvaluationPrompt, createExplanationWithSourcesPrompt (inline [n] citations), editExplanationPrompt.
- `src/lib/services/returnExplanation.ts` — generateNewExplanation() uses prompt selection → LLM call → postprocessing (heading titles, tag eval, link candidates parallel). returnExplanationLogic() orchestrates full pipeline.
- `src/lib/services/llms.ts` — callLLMModel (router), callOpenAIModel, callAnthropicModel. Provider routing by model prefix (claude-* → Anthropic, deepseek-* → DeepSeek, else → OpenAI). saveLlmCallTracking for per-call DB tracking. onUsage callback for cost accumulation.
- `src/lib/schemas/schemas.ts` — AllowedLLMModelType: gpt-4o-mini, gpt-4o, gpt-4.1-nano, gpt-4.1-mini, gpt-4.1, gpt-5-mini, gpt-5-nano, o3-mini, deepseek-chat, claude-sonnet-4-20250514.
- `src/config/llmPricing.ts` — Per-model pricing. Cheapest: gpt-5-nano ($0.05/$0.40). Most expensive: claude-sonnet-4 ($3.00/$15.00). calculateLLMCost() with prefix matching fallback.

### Admin UI
- `src/app/admin/quality/article-bank/page.tsx` — Topic list with CrossTopicSummary cards, topics table, GenerateArticleDialog (model dropdown, prompt input), NewTopicDialog. MethodBadge color coding.
- `src/app/admin/quality/article-bank/[topicId]/page.tsx` — 4-tab: Leaderboard (Elo-ranked, expandable EntryDetail with metadata/evolution links), Cost vs Elo (Recharts ScatterChart), Match History, Compare Text (diffWordsWithSpace). RunComparisonDialog (judge model + rounds). AddFromRunDialog (list completed runs, preview winner).
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` — "Add to Bank" button for completed runs. AddToBankDialog with prompt input, include baseline checkbox, winner preview.

### Tests
- `src/lib/evolution/comparison.test.ts` — 31 tests: buildComparisonPrompt, parseWinner, compareWithBiasMitigation (agreement/disagreement/partial/caching).
- `src/lib/services/articleBankActions.test.ts` — 24 tests: CRUD, Elo updates, topic upsert retry, soft-delete cascade, cross-topic aggregation, generateAndAddToBankAction.
- `scripts/lib/bankUtils.test.ts` — 5 tests: addEntryToBank (success, fallback, error, zero cost, evolution IDs).
- `scripts/generate-article.test.ts` — 12 tests: cost estimation, cap enforcement, prompt generation, title parsing, cost calculation.
- `scripts/run-bank-comparison.test.ts` — 10 tests: computeEloUpdate, computeEloPerDollar, parseArgs, round counting.
- `src/__tests__/integration/article-bank-actions.integration.test.ts` — 6 tests: real Supabase CRUD cycle.
- `src/__tests__/e2e/specs/09-admin/admin-article-bank.spec.ts` — 11 E2E tests (skipped until migration deployed).

## Detailed Findings

### Finding 1: Current Topic/Prompt Handling

Topics in `article_bank_topics` are created ad-hoc — whenever a user or script adds an entry with a prompt, the topic is upserted via case-insensitive LOWER(TRIM(prompt)) matching. There is no concept of a curated prompt set. The current workflow is:

1. User runs `generate-article.ts --prompt "Explain X" --bank` → topic created
2. User runs `run-evolution-local.ts --prompt "Explain X" --bank` → same topic matched
3. User clicks "Run Comparison" on the topic → entries compared

The **problem** is that this is manual and uncontrolled:
- No guarantee all methods are represented for each topic
- No batch mechanism to generate across all methods at once
- Prompt phrasing may vary slightly between runs (e.g., "Explain X" vs "Explain x in detail")
- No difficulty stratification (easy vs hard topics)

### Finding 2: Existing Batch Infrastructure

The closest thing to batch generation is `scripts/evolution-runner.ts` — a batch runner that claims pending evolution runs from the DB. But this operates on pre-queued runs, not on a prompt bank.

For 1-shot generation, `scripts/generate-article.ts` handles one prompt at a time. There is no batch 1-shot script.

For bank comparisons, `scripts/run-bank-comparison.ts` operates on one topic at a time.

**No existing script iterates over multiple prompts to generate articles across methods.**

### Finding 3: Generation Method Configuration

The article bank tracks three `generation_method` values:
- `oneshot`: Single LLM call via `createExplanationPrompt()`
- `evolution_winner`: Top Elo variant from a completed evolution run
- `evolution_baseline`: Seed article before evolution (generation 0)

For fair comparison, each topic needs at minimum:
- 1 oneshot entry per model being compared (e.g., gpt-4.1, claude-sonnet-4, deepseek-chat)
- 1 evolution_winner per pipeline config (e.g., deepseek-chat with 5 iterations, gpt-4.1-nano with 3 iterations)
- 1 evolution_baseline per pipeline run (the starting point)

The `generate-article.ts` script already supports all 10 models. The `run-evolution-local.ts` script supports all models for both seed and evolution.

### Finding 4: Cost-Efficiency Analysis Readiness

The `getCrossTopicSummaryAction` already aggregates across all topics:
- Avg Elo by generation_method
- Avg cost by generation_method
- Avg elo_per_dollar by generation_method
- Win rate by generation_method (% of topics where method has highest Elo)

This is sufficient for prompt bank analysis — once a curated set of prompts is populated with entries from each method, the cross-topic summary immediately answers "which method is best?"

### Finding 5: Swiss Pairing for Bank Comparisons

The bank uses a simpler Swiss pairing than the evolution tournament:
- Sort by Elo, pair adjacent entries (O(N/2) per round)
- No info-theoretic scoring, no multi-turn tiebreakers
- Fixed K=32 (no adaptive schedule)
- Rounds configurable (1-5 in UI, unlimited in CLI)

For a prompt bank with ~3-5 entries per topic, this is adequate — with 5 entries, each round produces ~2 matches, and 3-5 rounds covers most combinations.

### Finding 6: Missing Infrastructure for Prompt Bank

What doesn't exist yet:
1. **Prompt bank definition** — No table/file/config for a curated set of prompts with metadata (difficulty, domain, expected length)
2. **Batch generation script** — No script that takes a prompt bank and generates entries across all specified methods
3. **Batch comparison script** — No script that runs comparisons across all topics in a prompt bank
4. **Prompt bank UI** — No admin page to manage the prompt bank (create, import, tag prompts)
5. **Method matrix** — No concept of "which methods should be compared" as a configuration; it's currently implicit in what entries exist
6. **Progress tracking** — No way to see "Topic X has 3/5 methods completed" at a glance

### Finding 7: Evolution Pipeline Timing and Cost

From the comparison_infrastructure research, typical costs:
- 1-shot with gpt-4.1-mini: ~$0.01-0.03 per article
- 1-shot with gpt-4.1: ~$0.10-0.30 per article
- 1-shot with claude-sonnet-4: ~$0.20-0.50 per article
- Evolution with deepseek-chat (5 iterations): ~$0.10-0.50 per run (full pipeline)
- Evolution with gpt-4.1-nano (3 iterations): ~$0.05-0.20 per run

For a prompt bank of 20 topics × 5 methods = 100 generations, estimated total cost: $5-$25.

### Finding 8: Article Bank Table Sizes

The article bank tables have no row count limits or partitioning. For a prompt bank, expected data volumes:
- Topics: 20-50 curated prompts
- Entries: 100-250 articles (5 methods × 20-50 topics)
- Comparisons: 500-2,500 match records (3-5 rounds × ~50-100 pairs)
- Elo: 100-250 records (one per entry per topic)

These are small volumes — no performance concerns.

### Finding 9: Existing Prompt Quality Considerations

The `createExplanationPrompt()` template produces standardized articles with:
- Modular paragraphs of 5-10 sentences
- ## section headers
- Bold key terms
- Math formatting support

All methods use the same prompt template, which means **prompt format is already controlled**. The variable is the model and the generation approach (single call vs iterative evolution), not the prompt template itself.

However, the **topic prompt** (e.g., "Explain quantum entanglement") is what varies between topics. A prompt bank should standardize these at a higher level — ensuring prompts are:
- Clear and unambiguous
- Varied in difficulty (basic → advanced)
- Varied in domain (science, history, technology, arts)
- Varied in expected article length (short concept vs long overview)

### Finding 10: Topic Matching Behavior

The UNIQUE index on LOWER(TRIM(prompt)) ensures that:
- "Explain quantum entanglement" and "explain quantum entanglement" → same topic
- "Explain quantum entanglement " (trailing space) → same topic
- "Explain quantum entanglement in simple terms" → DIFFERENT topic

This is important for a prompt bank: prompts must be exactly specified (after trim/lowercase normalization) to ensure all methods generate for the same topic. The prompt bank should store the canonical prompt text.

### Finding 11: Generation Dependencies

For the evolution pipeline to work from a prompt, it needs:
1. A seed article generated from the prompt (via `generateSeedArticle()`)
2. The seed becomes the `original_baseline` variant
3. The pipeline iterates on this seed

This means evolution entries inherently depend on a 1-shot seed. The `--bank` flag on `run-evolution-local.ts` already handles this: it adds both the winner AND the baseline as separate bank entries.

For fair comparison, the evolution baseline should use the SAME model as the cheapest 1-shot comparison (typically deepseek-chat or gpt-4.1-nano) to establish a consistent baseline.

## Deep Dive Findings (Round 2)

### Finding 12: Batch Orchestration Patterns in Existing Scripts

All CLI scripts follow consistent patterns that a batch prompt bank runner should reuse:

**Argument parsing**: Manual `getValue(name)`/`getFlag(name)` helpers from `process.argv.slice(2)`. No external CLI libraries. Validation with `process.exit(1)` on failure.

**Supabase client**: Direct `createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })` using `SUPABASE_SERVICE_ROLE_KEY`. Returns `null` gracefully if env vars missing.

**Error handling**: Two-tier — fatal errors (config, validation) throw and exit; graceful errors (tracking, non-critical DB writes) are caught silently with `void Promise.resolve(...).catch(...)`.

**Execution model**: All scripts run **sequentially** — no `Promise.all()`, no worker pools, no concurrency controls. This simplifies cost tracking and error handling. For a batch runner, this means prompts would be processed one at a time by default.

**LLM client**: Direct SDK instantiation with `maxRetries: 3` and `timeout: 60000` (60s). Provider detection via `model.startsWith('claude-')` / `model.startsWith('deepseek-')`.

**Cost tracking**: Fire-and-forget inserts to `llmCallTracking` table. Pre-flight estimation via `estimateCost()` (prompt chars / 4 = input tokens, × 3 for output estimate). Budget validation against `--max-cost`.

**Rate limiting**: No external rate limiter libraries. Only manual `setTimeout()` delays in batch scripts (e.g., `backfill-summaries.ts` uses 5s between batches of 50). The prompt bank runner would need to add delays between API calls to avoid rate limits.

**Graceful shutdown**: `process.on('SIGTERM'/'SIGINT')` sets `shuttingDown = true`, main loop checks flag and finishes current work before exiting. Only `evolution-runner.ts` implements this.

**Output**: Box-drawing banners (`┌─── ... ───┐`), left-aligned labels, `toFixed()` for numbers, summary table at end.

### Finding 13: Topic Creation Race Conditions and Soft-Delete Edge Case

**Two distinct race condition strategies**:

1. **Server actions** (`upsertTopicByPrompt()`): SELECT → INSERT → retry on `23505` error code (max 2 retries). Uses `.ilike()` for case-insensitive matching. Only matches non-deleted topics (`.is('deleted_at', null)`).

2. **CLI scripts** (`addEntryToBank()`): Supabase `.upsert()` with `onConflict: 'idx_article_bank_topics_prompt_unique'`. Falls back to `.ilike()` if upsert fails. Single-pass at database level.

Both approaches handle concurrent creation correctly — tested and verified in `articleBankActions.test.ts` and `bankUtils.test.ts`.

**Critical soft-delete edge case**: The UNIQUE index `idx_article_bank_topics_prompt_unique` is defined on `LOWER(TRIM(prompt))` **WITHOUT** a `WHERE deleted_at IS NULL` clause. This means:
- You CANNOT recreate a soft-deleted topic with the same prompt
- The unique constraint slot is held by the soft-deleted row forever
- To reuse a prompt, you must hard-delete the topic or restore it

**Impact on prompt bank**: If a topic is accidentally soft-deleted, the prompt bank cannot reinsert it. A migration to add `WHERE deleted_at IS NULL` to the unique index would fix this.

**No standalone topic creation action**: The UI creates topics by inserting a placeholder entry with `model: 'placeholder'` and zero cost. A prompt bank would benefit from a `createTopicOnlyAction()` that doesn't create a throwaway entry.

### Finding 14: Cross-Topic Summary Aggregation Details

`getCrossTopicSummaryAction()` computes 5 metrics per generation method:

1. **avg_elo**: Mean Elo across ALL entries for the method (not just winners). Includes entries with match_count=0 at initial Elo 1200.
2. **avg_cost**: Mean `total_cost_usd` — only entries with non-null cost are included in the average. Null-cost entries (baselines) are excluded from cost averaging.
3. **avg_elo_per_dollar**: Mean Elo/$ — only entries with non-null `elo_per_dollar` included.
4. **win_rate**: `wins / totalTopics` where `totalTopics` = number of topics with at least one Elo entry. Winner = method with highest Elo in that topic. **No weighting** by topic difficulty, entry count, or Elo margin.
5. **entry_count**: Total entries across all topics for this method.

**Limitations for prompt bank analysis**:
- No weighting by topic difficulty — a method that wins easy topics counts the same as winning hard ones
- Topics with only 1 entry always "win" for that method, skewing win_rate
- No minimum match threshold — entries with match_count=0 (no comparisons run) are included in avg_elo at 1200
- No confidence intervals — high variance in small sample sizes is invisible

**What works well**:
- The framework is functional for comparing 3-5 methods across 20+ topics once comparisons are run
- Elo/$ naturally penalizes expensive methods that don't provide proportional quality
- Win rate gives a clear "which method is best most often" signal

### Finding 15: Elo Stability and Round Requirements

**Bank Elo uses fixed K=32** (not adaptive like the evolution pipeline's 48→32→16 schedule). This means:
- New entries and established entries update at the same rate
- With K=32 and standard Elo math, a single decisive win changes ratings by ~16 points each
- A single decisive loss also changes by ~16 points

**Rounds needed for stability** (Elo changes <10 points between rounds):

| Entries/topic | Swiss rounds | All-pairs comparisons | Matches/entry |
|---|---|---|---|
| 2-3 | 1-2 | 1-3 | 1-2 |
| 5 | 3-4 | 10 | 4-5 |
| 10 | 5-7 | 45 | 9-10 |

For a prompt bank with 3-5 entries per topic (typical: 1 oneshot + 1 evolution winner + 1 baseline), **2-3 rounds of Swiss pairing** (producing 3-6 comparisons) is sufficient for stable rankings.

**Judge model impact**: The comparison uses `buildComparisonPrompt()` which evaluates on 5 criteria (clarity, structure, engagement, grammar, effectiveness). Using `gpt-4.1-nano` (cheapest judge at $0.10/$0.40 per 1M tokens) vs `gpt-4.1-mini` ($0.40/$1.60) trades accuracy for cost. For a prompt bank of 20 topics × 3 rounds × 2.5 pairs/round = 150 comparisons × 2 passes (bias mitigation) = 300 judge calls. At ~300 tokens per call: gpt-4.1-nano ≈ $0.01, gpt-4.1-mini ≈ $0.04.

### Finding 16: Bank Insertion Flow for Evolution Pipeline

The `--bank` flag on `run-evolution-local.ts` follows this exact flow (lines 926-963):

1. **Requires `--prompt`** — bank insertion is skipped with a warning if only `--file` is used
2. **Gets top variant** by Elo from final pool state
3. **Inserts winner** via `addEntryToBank()` with:
   - `generation_method: 'evolution_winner'`
   - `total_cost_usd: costTracker.getTotalSpent()` (full run cost)
   - metadata: `{ iterations, duration_seconds, stop_reason, seed_model, winning_strategy }`
4. **Finds baseline** by `strategy === 'original_baseline'` OR `iterationBorn === 0`
5. **Inserts baseline** (if different from winner) with:
   - `generation_method: 'evolution_baseline'`
   - `total_cost_usd: null` (baseline cost not tracked separately)
   - metadata: `{ seed_model }`
6. Both entries go to the same topic (matched by the `--prompt` text)

**Key detail**: The evolution pipeline's `createDirectLLMClient()` (lines 293-442) duplicates LLM client logic from `llms.ts` to avoid Next.js dependencies. This means cost tracking in CLI scripts writes to `llmCallTracking` via direct Supabase inserts, not through the `saveLlmCallTracking()` function.

### Finding 17: Comparison Cache Architecture Differences

Two cache implementations exist:

1. **Pipeline `ComparisonCache` class** (`src/lib/evolution/core/comparisonCache.ts`): Stores `{ winnerId, loserId, confidence, isDraw }` with separate namespaces for structured vs simple comparisons. Lives in `ExecutionContext`, scoped per-run.

2. **Bank comparison `Map<string, ComparisonResult>`**: Simple `Map` created per `runBankComparisonAction()` call. Stores `{ winner: 'A'|'B'|'TIE', confidence, turns }`. Not persisted across calls.

Both use the same order-invariant SHA-256 cache key from `comparison.ts`. For a batch prompt bank runner that compares across multiple topics, each topic's comparisons would get a fresh cache (matching current behavior).
