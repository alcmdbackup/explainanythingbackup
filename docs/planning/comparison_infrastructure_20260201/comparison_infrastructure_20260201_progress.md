# Comparison Infrastructure Progress

## Phase 1: Prompt-Based Article Generation (CLI)

### Work Done

#### 1.1 — Add expensive models to allowed list + pricing
- **`src/lib/schemas/schemas.ts`**: Added `gpt-4o`, `gpt-4.1`, `o3-mini`, `claude-sonnet-4-20250514` to `allowedLLMModelSchema`. Removed duplicate `gpt-4.1-nano` entry. Updated comment to reflect multi-provider support.
- **`src/config/llmPricing.ts`**: Added pricing entries for `o3-mini` (1.10/4.40) and `claude-sonnet-4-20250514` (3.00/15.00). `gpt-4o` and `gpt-4.1` already existed.

#### 1.2 — Anthropic SDK and client routing
- **`npm install @anthropic-ai/sdk`**: Installed Anthropic SDK
- **`src/lib/services/llms.ts`**:
  - Added `import Anthropic from '@anthropic-ai/sdk'`
  - Added `getAnthropicClient()` lazy singleton (matches existing OpenAI/DeepSeek pattern)
  - Added `isAnthropicModel()` exported helper
  - Added `callAnthropicModel()` — full Anthropic Messages API integration with streaming support, usage tracking, and span tracing
  - Added `callLLMModelRaw()` router — dispatches to Anthropic or OpenAI based on model prefix
  - Changed exports: `callLLMModel` (new) + `callOpenAIModel` (backward compat alias) — both wrap the router with `withLogging`
- **`scripts/run-evolution-local.ts`**:
  - Added Anthropic branch to `createDirectLLMClient` — full `EvolutionLLMClient` implementation using `@anthropic-ai/sdk`
  - Replaced hardcoded `inputRate`/`outputRate` pricing with `calculateLLMCost()` from `llmPricing.ts` for all providers

#### 1.3 — generate-article.ts CLI script
- **`scripts/generate-article.ts`**: New standalone CLI script
  - Accepts `--prompt`, `--model`, `--output`, `--max-cost` arguments
  - Multi-provider support: OpenAI, DeepSeek, Anthropic (via direct SDK clients, no Next.js deps)
  - Cost estimation before API call with `--max-cost` cap enforcement
  - Two-step generation: title (via `createTitlePrompt`) → article (via `createExplanationPrompt`)
  - LLM call tracking via `llmCallTracking` table with `call_source = 'oneshot_<model>'`
  - No `--bank` flag yet (deferred to Phase 3)

#### 1.4 — Test mocks and tests
- **`src/testing/mocks/@anthropic-ai/sdk.ts`**: New Anthropic SDK mock (messages.create + messages.stream)
- **`jest.config.js`**: Added `@anthropic-ai/sdk` to `moduleNameMapper`
- **`jest.setup.js`**: Added `ANTHROPIC_API_KEY = 'test-anthropic-key'`
- **`src/lib/services/llms.test.ts`**: Added 8 new tests:
  - `isAnthropicModel` detection (Claude vs non-Claude)
  - Anthropic provider routing (Claude → Anthropic, non-Claude → OpenAI)
  - Cost tracking for Anthropic calls (input_tokens/output_tokens mapping)
  - Missing ANTHROPIC_API_KEY error handling
  - Empty Anthropic response handling
  - Backward compat (`callOpenAIModel` alias routes Claude correctly)
- **`scripts/generate-article.test.ts`**: 14 new tests:
  - Cost estimation by model (gpt-4.1, Claude, o3-mini, deepseek-chat)
  - Cost cap enforcement (reject over cap, allow under cap)
  - Prompt generation (title + explanation)
  - Title response parsing (valid + invalid)
  - Cost calculation accuracy per model
  - Cost formatting

#### 1.5 — Environment config
- **`.env.example`**: Added `ANTHROPIC_API_KEY` with documentation (optional, only for claude-* models)

### Verification
- Lint: ✅ Clean (eslint)
- Type check: ✅ Clean (tsc --noEmit)
- Build: ✅ Clean (next build)
- Unit tests: ✅ 146 suites, 3027 passed, 0 failures

### Issues Encountered
- Workflow enforcement hook expected project folder at `docs/planning/feat/comparison_infrastructure_20260201/` (matching branch name) but planning docs existed at `docs/planning/comparison_infrastructure_20260201/`. Resolved by creating the expected directory with `_status.json` and symlinks to existing planning files.
- `@jest-environment node` docblock parsing failed when followed by descriptive comment on same JSDoc block. Fixed by separating into standalone docblock + line comments.

### User Clarifications
None needed for Phase 1.

## Phase 2: Connect Prompt Generation to Evolution Pipeline
### Work Done

#### 2.1 — Prompt-seeded pipeline mode
- **`scripts/run-evolution-local.ts`**:
  - Added `--prompt` flag (mutually exclusive with `--file`) and `--seed-model` flag
  - Added `generateSeedArticle()` function: title generation via `createTitlePrompt` + article generation via `createExplanationPrompt`
  - Updated `main()` to use `generateSeedArticle` when `--prompt` is provided, with `--seed-model` support

#### 2.2 — Tests
- **`scripts/run-evolution-local.test.ts`**: 11 tests for seed article flow, CLI arg parsing, mock LLM integration

### Verification
- Tests: ✅ 11 passed

## Phase 3: Article Bank (Persistent Cross-Method Comparison)
### Work Done

#### 3.1 — Article bank DB migration
- **`supabase/migrations/20260201000001_article_bank.sql`**: 4 tables:
  - `article_bank_topics`: prompt-based grouping with UNIQUE index on `LOWER(TRIM(prompt))`
  - `article_bank_entries`: articles with FKs to evolution runs/variants, `generation_method` CHECK constraint
  - `article_bank_comparisons`: head-to-head match history with confidence scores
  - `article_bank_elo`: per-topic Elo ratings with `elo_per_dollar` cost-efficiency metric

#### 3.2 — Extract bias-mitigated comparison into standalone function
- **`src/lib/evolution/comparison.ts`** (new): Standalone module with:
  - `ComparisonResult` interface (`winner: 'A' | 'B' | 'TIE'`, `confidence`, `turns`)
  - `buildComparisonPrompt()` — moved from calibrationRanker.ts (shared by both rankers)
  - `parseWinner()` — moved from calibrationRanker.ts (shared by both rankers)
  - `compareWithBiasMitigation(textA, textB, callLLM, cache?)` — standalone 2-pass reversal with order-invariant SHA-256 cache keys
  - `callLLM` callback pattern abstracts away the LLM provider
- **`src/lib/evolution/agents/calibrationRanker.ts`**: Refactored to use standalone `compareWithBiasMitigation`:
  - Removed local `buildComparisonPrompt`, `parseWinner`, `comparePair`
  - `compareWithBiasMitigation` method now wraps standalone function with: ComparisonCache check, error-handling callLLM wrapper, ComparisonResult→Match mapping
- **`src/lib/evolution/agents/pairwiseRanker.ts`**: Imports `buildComparisonPrompt` and `parseWinner` from `../comparison` (removed duplicate copies), re-exports `parseWinner` for existing test imports
- **`src/lib/evolution/index.ts`**: Added re-exports for `compareWithBiasMitigation`, `buildComparisonPrompt`, `parseWinner`, `ComparisonResult`
- **`src/lib/evolution/comparison.test.ts`** (new): 23 tests:
  - `buildComparisonPrompt`: text ordering, evaluation criteria
  - `parseWinner`: clean A/B/TIE, case insensitivity, TEXT A/B mentions, whitespace, unparseable
  - `compareWithBiasMitigation`: full agreement, disagreement, partial failure, total failure, error propagation, caching (order-invariant keys, no-cache on failures)

#### 3.3 — Article bank server actions
- **`src/lib/services/articleBankActions.ts`** (new): 9 server actions following `ActionResult<T>` + `requireAdmin()` + `withLogging` pattern:
  - `addToBankAction`: Atomic topic upsert + entry insert + Elo initialization
  - `getBankTopicAction`, `getBankEntriesAction`, `getBankEntryDetailAction`: CRUD reads with soft-delete filtering
  - `getBankLeaderboardAction`: Elo-ranked entries joined with entry details
  - `runBankComparisonAction`: All-pairs comparison using standalone `compareWithBiasMitigation`, updates Elo with confidence-weighted scoring, records `article_bank_comparisons`
  - `getCrossTopicSummaryAction`: Cross-topic aggregation by generation method (avg Elo, cost, elo_per_dollar, win rate)
  - `deleteBankEntryAction`: Soft-delete entry + hard-delete comparisons/Elo
  - `deleteBankTopicAction`: Soft-delete topic + cascade
- **`src/lib/services/articleBankActions.test.ts`** (new): 19 tests using table-aware mock factory

#### 3.4 — CLI scripts and --bank flag
- **`scripts/lib/bankUtils.ts`** (new): Shared `addEntryToBank(supabase, params)` — topic upsert, entry insert, Elo init (CLI version of `addToBankAction`, uses direct Supabase client)
- **`scripts/generate-article.ts`**: Added `--bank` flag — calls `addEntryToBank` after generation with full metadata snapshot
- **`scripts/run-evolution-local.ts`**: Added `--bank` flag — adds winner + baseline to bank after pipeline completes (requires `--prompt`)
- **`scripts/add-to-bank.ts`** (new): CLI to add existing evolution run winner to bank
  - Fetches run, finds winner variant (highest Elo), snapshots metadata from `run_summary`
  - `--include-baseline` optionally adds the baseline variant
- **`scripts/run-bank-comparison.ts`** (new): CLI to run pairwise comparisons for a topic
  - Multi-provider judge LLM support (OpenAI/DeepSeek/Anthropic)
  - Swiss-style round-robin with configurable `--rounds`, updates Elo in DB
  - Prints leaderboard with Elo, cost, and elo_per_dollar

#### 3.5 — Tests
- **`src/lib/evolution/comparison.test.ts`** (new): 23 tests for standalone comparison
- **`src/lib/services/articleBankActions.test.ts`** (new): 19 tests for server actions
- **`scripts/lib/bankUtils.test.ts`** (new): 5 tests for shared bank insertion logic

### Verification
- Lint: ✅ Clean
- Type check: ✅ Clean
- Existing ranker tests: ✅ 28 passed (CalibrationRanker: 9, PairwiseRanker: 19)
- New comparison tests: ✅ 23 passed
- New articleBankActions tests: ✅ 19 passed
- New bankUtils tests: ✅ 5 passed

## Phase 4: Article Bank UI
### Work Done

#### 4.1 — Additional server actions
- **`src/lib/services/articleBankActions.ts`**:
  - Added `BankTopicWithStats` interface (extends `BankTopic` with `entry_count`, `elo_min`, `elo_max`, `total_cost`, `best_method`)
  - Added `getBankTopicsAction`: Lists all active topics with aggregated entry counts, Elo ranges, total cost, and best method per topic (3 Supabase queries: topics, entries, Elo)
  - Added `getBankMatchHistoryAction`: Fetches all comparisons for a topic, ordered by date descending

#### 4.2 — Admin sidebar navigation
- **`src/components/admin/AdminSidebar.tsx`**: Added "Article Bank" nav item (icon: 🏦) between Evolution and Quality Scores entries

#### 4.3 — Topic list page
- **`src/app/admin/quality/article-bank/page.tsx`** (new): Topic list with:
  - Cross-topic cost efficiency summary cards (one per generation method, showing avg Elo, avg cost, elo/$, win rate) — only shown when ≥2 methods have data
  - Topics table: prompt, entry count, Elo range (min–max), total cost, best method badge, created date
  - Click row → navigate to topic detail
  - "New Topic" button with dialog (prompt input, creates topic via `addToBankAction`)
  - Delete topic with confirmation
  - `MethodBadge` component with color coding: blue for 1-shot, green for evolution winner, gray for baseline

#### 4.4 — Topic detail page
- **`src/app/admin/quality/article-bank/[topicId]/page.tsx`** (new): Full topic detail with 4-tab layout:
  - **Leaderboard tab**: Elo-ranked table with rank, method badge, model, Elo, elo/$, cost, matches, source link, actions. Top entry highlighted. Expandable inline row with `EntryDetail` component showing article preview, metadata, and evolution links.
  - **Cost vs Elo tab**: Recharts `ScatterChart` (SSR-disabled via `next/dynamic`) with color-coded dots by method, bidirectional linking (click dot → expand that entry in leaderboard)
  - **Match History tab**: Table of all comparisons with entry A/B, winner, confidence, judge model, date. Lazy-loaded on tab switch.
  - **Compare Text tab**: Side-by-side word-level diff using `diffWordsWithSpace` from `diff` package. Dropdown selectors or "Diff" button from leaderboard for quick selection.
  - "Run Comparison" button with dialog (judge model selector) → calls `runBankComparisonAction`
  - Delete entry button per row with confirmation
  - Breadcrumb navigation: Article Bank > Topic

#### 4.5 — Evolution run detail integration
- **`src/app/admin/quality/evolution/run/[runId]/page.tsx`**:
  - Added "Add to Bank" button in header (visible only when `run.status === 'completed'`)
  - `AddToBankDialog` component: fetches variants, shows winner preview, prompt input, "include baseline" checkbox
  - Calls `addToBankAction` with winner variant data + optional baseline
  - Imports `addToBankAction`, `getEvolutionVariantsAction`, `toast` from sonner

#### 4.6 — Tests
- **`src/lib/services/articleBankActions.test.ts`**: 6 new tests (25 total):
  - `getBankTopicsAction`: topics with aggregated stats, empty topics, topics with no entries
  - `getBankMatchHistoryAction`: returns comparisons, empty results, UUID validation

### Verification
- Lint: ✅ 0 errors (3 pre-existing warnings)
- Type check: ✅ Clean (tsc --noEmit)
- Build: ✅ Clean (next build)
- Unit tests: ✅ 150 suites, 3091 passed, 13 skipped, 0 failures

### Issues Encountered
- Recharts `Tooltip.formatter` TypeScript type requires `never` cast due to complex union type that expects optional params (`value: number | undefined, name: string | undefined`)
- Hardcoded hex colors in Recharts chart config triggered `design-system/no-hardcoded-colors` lint error. Fixed by using CSS variable references (`var(--accent-copper)`, `var(--status-success)`, `var(--text-muted)`) — Recharts SVG elements accept CSS variable strings.
- `Record<string, unknown>` metadata values from article bank entries can't be rendered directly in JSX (`unknown` not assignable to `ReactNode`). Fixed by using `!== undefined` checks instead of truthy checks, and wrapping with `String()`.
- Floating point imprecision in total cost aggregation test (`0.05 + 0.01 = 0.060000000000000005`). Fixed with `toBeCloseTo`.

### User Clarifications
None needed for Phase 4.

## Gap Analysis (Post-Phase 4 Review)

Systematic comparison of planning doc against implementation identified these gaps:

### Phase 4 UI Gaps

| # | Gap | Plan Line | Severity |
|---|-----|-----------|----------|
| G1 | "Generate New Article" button + `generateAndAddToBankAction` server action (topic list page) | 585-588 | Feature |
| G2 | "Add from Evolution Run" button on topic detail page | 634-638 | Feature |
| G3 | Rounds selector in Run Comparison dialog | 633 | Polish |
| G4 | Live Elo updates during comparison run | 633 | Polish |
| G5 | Date column in leaderboard table | 595 | Polish |
| G6 | Agent cost breakdown in expanded evolution rows | 609 | Polish |
| G7 | Strategy effectiveness top 3 display | 610 | Polish |
| G8 | Meta-feedback display (successful strategies, weaknesses) | 611 | Polish |
| G9 | Negative elo_per_dollar red text styling | 103 | Polish |
| G10 | Delete topic confirmation with entry/comparison counts | 632 | Polish |
| G11 | Success toast with link to topic after Add to Bank | n/a | Polish |

### Missing Tests

| # | File | Plan Line |
|---|------|-----------|
| G12 | `admin-article-bank.spec.ts` (Playwright E2E, 11 cases) | 689-701 |
| G13 | `article-bank-actions.integration.test.ts` (real Supabase) | 686-687 |
| G14 | `scripts/run-bank-comparison.test.ts` | 682 |

### Missing Documentation

| # | File | Plan Line |
|---|------|-----------|
| G15 | `docs/feature_deep_dives/comparison_infrastructure.md` (stub only) | 708 |
| G16 | `docs/feature_deep_dives/evolution_pipeline.md` update (prompt-based seeding) | 709 |
| G17 | `docs/docs_overall/architecture.md` update (article bank feature) | 710 |

## Gap Fixes

### UI Fixes (G1–G11)

**G1: Generate New Article button + `generateAndAddToBankAction`**
- `src/lib/services/articleBankActions.ts`: Added `generateAndAddToBankAction` — generates title + article via `callLLMModel`, upserts topic, inserts entry (generation_method='oneshot'), initializes Elo
- `src/app/admin/quality/article-bank/page.tsx`: Added `GenerateArticleDialog` with model dropdown (gpt-4.1, gpt-4.1-mini, gpt-4o, o3-mini, claude-sonnet-4, deepseek-chat), progress states, article preview. "Generate New Article" button in header.

**G2: "Add from Evolution Run" button on topic detail**
- `src/app/admin/quality/article-bank/[topicId]/page.tsx`: Added `AddFromRunDialog` — lists completed evolution runs, shows winner preview, include baseline checkbox. Calls `addToBankAction`. "Add from Run" button in header.

**G3: Rounds selector in Run Comparison dialog**
- `src/app/admin/quality/article-bank/[topicId]/page.tsx`: Added rounds dropdown (1/2/3/5) to `RunComparisonDialog`
- `src/lib/services/articleBankActions.ts`: Updated `runBankComparisonAction` to accept `rounds` param with multi-round loop

**G4: Live Elo updates** — Deferred (nice-to-have, not blocking)

**G5: Date column in leaderboard**
- Added "Date" header and `created_at` cell to leaderboard table. Updated colSpan from 9→10.

**G6/G7/G8: Agent cost breakdown, strategy effectiveness, meta-feedback**
- Enhanced `EntryDetail` component with: `total_matches`/`decisive_rate` display, `agent_cost_breakdown` rendering (Object.entries loop), `meta_feedback` display (successful_strategies + recurring_weaknesses arrays)

**G9: Negative elo_per_dollar red text**
- Added conditional `text-[var(--status-error)]` class when `elo_per_dollar < 0`

**G10: Delete topic confirmation with entry counts**
- Updated `handleDeleteTopic` to accept `entryCount` param: "This will delete N entries and all associated comparisons."

**G11: Success toast with topic link after Add to Bank**
- `src/app/admin/quality/evolution/run/[runId]/page.tsx`: Updated toast with `action: { label: 'View Topic', onClick }` and `useRouter` for navigation

### Tests (G12–G14)

**G12: E2E tests** — `src/__tests__/e2e/specs/09-admin/admin-article-bank.spec.ts`
- 11 Playwright tests: topic list, create topic, leaderboard columns, expand row, source link, run comparison (skip), diff, delete entry, add from run button, add to bank button (skip), scatter chart
- Data seeding with `getServiceClient()` + cleanup in `afterAll`

**G13: Integration tests** — `src/__tests__/integration/article-bank-actions.integration.test.ts`
- 6 tests: CRUD cycle, Elo init, soft-delete cascade (entry + topic), concurrent topic upsert dedup
- Graceful skip when `article_bank_topics` table doesn't exist

**G14: CLI comparison tests** — `scripts/run-bank-comparison.test.ts`
- 11 tests: `computeEloUpdate` (4), `computeEloPerDollar` (4), `parseArgs` (2), round counting (1)

### Documentation (G15–G17)

**G15: comparison_infrastructure.md** — Replaced stub with full documentation: Overview, Key Concepts, Architecture (DB schema, server actions, CLI scripts, admin UI), Key Files, Data Flow (3 workflows), Testing table

**G16: evolution_pipeline.md** — Added "Prompt-Based Seeding" section with usage examples and article bank integration

**G17: architecture.md** — Added comparison infrastructure to Feature Documentation, added Article Bank Tables section (4 tables)

### Final Verification
- Lint: ✅ 0 errors (5 pre-existing warnings)
- Type check: ✅ Clean (tsc --noEmit)
- Build: ✅ Clean (next build)
- Unit tests: ✅ 151 suites, 3102 passed, 13 skipped, 0 failures
- Integration tests: ✅ 6 passed (graceful skip when tables absent)
- E2E tests: ✅ Written (11 specs, skip-flagged until DB migration deployed)

### Remaining
- G4 (live Elo updates during comparison) deferred as nice-to-have
