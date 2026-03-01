# Evolution LLM Cost Security Research

## Problem Statement
Ensure that no bugs or compromised API keys can ever allow LLM spending beyond a pre-specified limit. Implement multiple levels of safeguards spanning provider-level hard caps, application-level global caps, per-run budget hardening, and monitoring/alerting to create defense-in-depth cost protection for the evolution pipeline and all LLM usage.

## Requirements (from GH Issue #591)

### L1 - Provider-Level Hard Caps
- Set spending limits directly at OpenAI/DeepSeek/Anthropic dashboards as ultimate backstop
- No application code can bypass these limits — even fully compromised keys are capped
- Document the current provider limit settings and recommended values

### L2 - Application Global Caps
- Daily + monthly aggregate spending limits tracked in the database
- Global kill switch that halts ALL LLM calls system-wide
- Separate caps for evolution vs non-evolution LLM usage
- Configurable limits via admin UI or environment variables

### L3 - Per-Run Caps (hardening existing infrastructure)
- Existing CostTracker per-run budget enforcement (already implemented)
- Add: max concurrent runs cap to prevent runaway parallel spending
- Add: per-batch total budget enforcement
- Add: auto-pause when global daily cap is approached

### L4 - Monitoring & Alerting
- Honeycomb/observability alerts at 50%/80%/95% of daily cap
- Anomaly detection for unusual per-minute spend rates
- Slack/email notifications when thresholds are breached

## High Level Summary

The codebase has **two distinct LLM spending paths** with very different levels of protection:

1. **Evolution pipeline** — Well-protected with per-run CostTracker, per-agent budget caps, pre-call reservation system, and BudgetExceededError pausing. Default $5/run cap. But only enforces within a single run — no global aggregate limits.

2. **Non-evolution code** (explanation generation, tag eval, summarization, links, etc.) — **ZERO budget enforcement**. 12+ call sites use `callLLM()` directly with no cost checks. A bug, infinite loop, or compromised key could generate unlimited spending.

**Critical gap**: No global daily/monthly spending cap exists anywhere. No kill switch. No alerting. Provider-level limits are not documented or verified.

## Key Findings

### Finding 1: Single LLM Gateway — All Calls Flow Through `callLLM()`
Every LLM call in the entire codebase routes through `src/lib/services/llms.ts:callLLMModelRaw()`. This is the ideal injection point for a global spending gate.

- Routes to `callOpenAIModel()` or `callAnthropicModel()` based on model prefix
- Every call already saves to `llmCallTracking` table with token counts + estimated cost
- Semaphore gating exists but only for `evolution_*` call sources

### Finding 2: Non-Evolution LLM Calls Have ZERO Budget Protection
12+ non-evolution call sites with NO spending limits:

| Service | Call Source | Model | Budget Check |
|---------|-----------|-------|--------------|
| `returnExplanation.ts` | generateTitleFromUserQuery | gpt-4.1-mini | NONE |
| `returnExplanation.ts` | returnExplanation (streaming) | gpt-4.1-mini | NONE |
| `returnExplanation.ts` | returnExplanation (new) | gpt-4.1-mini | NONE |
| `tagEvaluation.ts` | evaluateTags | gpt-4.1-mini | NONE |
| `contentQualityEval.ts` | evaluateContentQuality | gpt-4.1-nano | NONE |
| `contentQualityCompare.ts` | contentQualityCompare (x2) | gpt-4.1-mini | NONE |
| `explanationSummarizer.ts` | generateSummary | gpt-4.1-mini | NONE |
| `findMatches.ts` | findBestMatchFromList | gpt-4.1-mini | NONE |
| `links.ts` | extractLinkCandidates, enhanceContent | gpt-4.1-mini | NONE |
| `linkWhitelist.ts` | evaluateLinkCandidate | gpt-4.1-mini | NONE |
| `sourceSummarizer.ts` | summarizeSource | gpt-4.1-mini | NONE |
| `importArticle.ts` | importArticle | gpt-4.1-mini | NONE |

### Finding 3: Evolution CostTracker — Solid But With Gaps
The `CostTrackerImpl` (`evolution/src/lib/core/costTracker.ts`) implements:
- Pre-call reservation with 30% safety margin
- Per-agent caps (configurable % of total budget)
- FIFO reservation queue for precise release
- BudgetExceededError pauses run (not fail)

**Gaps identified:**
- **Checkpoint resume only restores `totalSpent`** — per-agent costs lost on resume, so a resumed run's per-agent caps are not enforced
- **Budget caps sum to 1.15x** (intentionally >1.0) — if phase transition doesn't happen correctly, agents could collectively overspend
- **Cost estimation can underestimate** — if actual > estimated × 1.3, overage goes untracked
- **No cross-run aggregation** — 100 simultaneous $5 runs = $500 with no global limit

### Finding 4: API Key Management — Static, No Rotation
- Keys stored as environment variables: `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`
- Lazy-initialized singleton clients in `llms.ts`
- No key rotation mechanism
- No key scoping (same key for all calls)
- Server-side only (never exposed to client)
- Different keys per environment (dev/CI/production)

### Finding 5: Provider Limit Status — Unknown/Undocumented
- No documentation of current provider-level spending limits
- OpenAI supports monthly spending limits in dashboard
- DeepSeek supports monthly limits
- Anthropic supports monthly limits
- **None verified as configured**

### Finding 6: Cost Tracking Database — Comprehensive But Passive
The `llmCallTracking` table records every LLM call with:
- Token counts (prompt, completion, reasoning)
- Estimated cost in USD (calculated via `llmPricing.ts`)
- Call source, model, user ID
- Evolution invocation FK when applicable

**But**: This data is write-only for analytics. It's never read back to enforce limits. The admin dashboard at `/admin/costs` shows summaries but has no alerting.

### Finding 7: OpenTelemetry — Connected But No Cost Attributes
- 4 tracers configured (LLM, database, vector, application)
- Traces sent to Honeycomb
- LLM spans exist with `llm.call_source` and `llm.model`
- **Missing**: No `llm.cost_usd`, `llm.tokens` span attributes
- **No Honeycomb triggers** configured for any cost-related metric

### Finding 8: Existing Monitoring Is Insufficient
| What exists | What's missing |
|-------------|----------------|
| Per-call cost logging to DB | Global daily/monthly spending queries |
| Admin cost dashboard (5 views) | Automated alerting at any threshold |
| Per-run budget enforcement (evolution) | Cross-run spending limits |
| Semaphore for concurrent LLM calls | Kill switch for all LLM calls |
| Cost estimation before runs | Cost estimation feedback loop |
| Evolution run watchdog (stale runs) | Spending velocity anomaly detection |

### Finding 9: Maximum Theoretical Spend Scenarios

**Scenario A: Compromised OpenAI Key (no provider limit set)**
- Attacker makes unlimited API calls → **unbounded spending**
- No application-level daily cap exists

**Scenario B: Bug in non-evolution code (infinite loop)**
- `returnExplanation.ts` retrying endlessly → unlimited gpt-4.1-mini calls
- No budget check, no rate limit, no daily cap

**Scenario C: Evolution batch runaway**
- 100 parallel runs × $5/run = $500
- Batch runner has `--max-runs` flag but no aggregate budget enforcement
- Experiment system divides budget per-run but doesn't enforce total

**Scenario D: Single evolution run**
- Worst case with all gaps exploited: ~$9 (180% of $5 cap)
- Due to concurrent reservation races + estimation underestimates

### Finding 10: Feature Flags System — Reusable for Kill Switch
The `feature_flags` table and `src/lib/services/featureFlags.ts` provide an existing pattern for boolean toggles:
- Admin toggle UI at `/admin/settings` with `logAdminAction()` audit logging
- `getFeatureFlag()` does a per-request DB query (NO caching) — unacceptable for the hot path
- Pattern is directly reusable for a kill switch toggle, but needs an in-memory TTL cache (e.g., 30s) to avoid per-LLM-call DB roundtrips

### Finding 11: Unauthenticated Server Actions Can Trigger LLM Calls
**CRITICAL**: Some server actions that invoke LLM calls lack authentication checks:
- `generateAISuggestionsAction` in server actions can trigger LLM calls
- An attacker who discovers the endpoint could drive unbounded spending without authentication
- The global gate at `callLLMModelRaw()` would protect against this, but auth gaps should also be fixed independently

### Finding 12: Supabase RPCs — Atomic Patterns for Spending Enforcement
Existing RPCs demonstrate atomic DB patterns reusable for spending caps:
- `claim_evolution_run`: Uses `FOR UPDATE SKIP LOCKED` for safe concurrent claims
- `checkpoint_and_continue`: Atomic state transitions with JSON merge
- `daily_llm_costs` VIEW exists but is non-materialized (full table scan every query) — unsuitable for hot-path enforcement
- Pattern: use a materialized `daily_cost_rollups` table updated via PostgreSQL trigger

### Finding 13: Admin Cost Dashboard — Read-Only Analytics
The `/admin/costs` page provides:
- Summary cards (total cost, call count, avg cost, top model)
- Daily cost chart with 30-day history
- Per-model cost breakdown
- Top users by spending
- **No alerting, no enforcement, no kill switch controls** — purely passive analytics

### Finding 14: OpenTelemetry Gaps — No Cost Span Attributes
- `createLLMSpan()` in `instrumentation.ts` creates spans but missing critical attributes:
  - No `llm.cost_usd` — can't build Honeycomb cost dashboards/triggers
  - No `llm.prompt_tokens`, `llm.completion_tokens` — can't detect token anomalies
- No Honeycomb triggers configured for any metric
- No Slack/email webhook integration exists in the codebase

### Finding 15: Global Gate Design — TTL-Cached Spending Check
Recommended design for the global spending gate at `callLLMModelRaw()`:
- **Pre-flight**: Check in-memory TTL cache (30s) of daily spend total
- **If cache miss**: Query `daily_cost_rollups` table (O(1) lookup)
- **If over cap**: Throw `GlobalBudgetExceededError` (blocks the call)
- **If kill switch on**: Throw `LLMKillSwitchError` (blocks the call)
- **Post-flight**: Update cache optimistically via `onUsage` callback
- **Overhead**: ~0ms (cache hit) to ~2-5ms (cache miss DB query)

### Finding 16: Cron Jobs & Automated Spending Paths
All automated LLM spending paths identified:
- **Vercel crons** (3): `processExpiredContent`, `checkPendingContent`, `processArticle` — none trigger LLM calls directly
- **GitHub Actions** (1): `run-evolution.yml` — triggers evolution batch runner, which does LLM calls
- **Evolution batch runner**: Has `--max-runs` flag but no aggregate budget enforcement
- **Worst case**: Unbounded cron enqueue + no global cap = $150K+/month theoretical maximum

### Finding 17: SDK Retry Amplification — 8x Cost Multiplication Risk
All 3 LLM SDK clients configured with `maxRetries: 3`:
- OpenAI SDK: `new OpenAI({ maxRetries: 3 })` → up to 4 attempts per call
- DeepSeek SDK: Same configuration
- Anthropic SDK: `new Anthropic({ maxRetries: 3 })`
- Evolution pipeline adds 1 retry on top (`maxRetries=1` in `runAgent()`) with `isTransientError()` classification
- **Result**: A single logical LLM call can execute up to 8 times (4 SDK retries × 2 pipeline retries)
- `BudgetExceededError` correctly propagates immediately (not retried)

### Finding 18: Non-Evolution Cost Profile — $0.02-0.03 Per User Explanation
Per-explanation cost breakdown for `returnExplanation.ts`:
- `generateTitleFromUserQuery`: ~$0.001 (short prompt, gpt-4.1-mini)
- `returnExplanation` (streaming): ~$0.008-0.012 (main generation)
- `returnExplanation` (new article check): ~$0.005
- `evaluateTags`: ~$0.003
- `evaluateContentQuality`: ~$0.001 (gpt-4.1-nano)
- **Total per explanation: $0.020-0.027** with 5-6 LLM calls
- No per-request rate limiting — a user refreshing rapidly could multiply costs
- At 1000 users/day × 3 explanations each = ~$60-80/day normal operation

### Finding 19: Daily Cost Rollup — PostgreSQL Trigger Recommended
For O(1) spending enforcement queries, recommended approach:
- **New table**: `daily_cost_rollups` with columns: `date`, `category` (evolution/non-evolution), `total_cost_usd`, `call_count`
- **PostgreSQL AFTER INSERT trigger** on `llmCallTracking` → atomically increments `daily_cost_rollups`
- Existing pattern: `user_profiles` table already uses triggers
- **Overhead**: 2-5ms per INSERT (trigger execution)
- **Benefit**: Global cap check becomes a single-row SELECT instead of full table scan
- Alternative: Materialized view with periodic refresh — rejected because refresh lag creates enforcement gaps

## Architecture: Where Global Gate Should Go

```
Client → Server Actions → Services → callLLM() → routeLLMCall() → Provider API
                                        ↑
                                   GATE HERE
                              (global daily cap check)
                              (kill switch check)
                              (rate limit check)
```

The `callLLMModelRaw()` function at `src/lib/services/llms.ts:503` is the single chokepoint. A pre-flight check here catches 100% of LLM calls regardless of source.

## Detailed Gate Architecture

```
callLLMModelRaw()
  │
  ├── 1. Kill switch check (in-memory TTL cache, 30s)
  │     └── If ON → throw LLMKillSwitchError
  │
  ├── 2. Global daily cap check (in-memory TTL cache, 30s)
  │     ├── Cache hit → compare cached daily total vs cap
  │     └── Cache miss → SELECT from daily_cost_rollups → cache result
  │           └── If over cap → throw GlobalBudgetExceededError
  │
  ├── 3. Category cap check (evolution vs non-evolution)
  │     └── Based on call_source.startsWith('evolution_')
  │
  ├── 4. Execute LLM call (existing routeLLMCall)
  │
  └── 5. Post-call: update cache optimistically with actual cost
        └── Fire-and-forget: saveLlmCallTracking (already exists)
              └── Trigger: daily_cost_rollups increment (new)
```

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/strategy_experiments.md
- evolution/docs/evolution/visualization.md
- evolution/docs/evolution/README.md

## Code Files Read
- `src/lib/services/llms.ts` — Central LLM gateway, routing, semaphore gating, cost tracking
- `src/config/llmPricing.ts` — Model pricing table (75+ models)
- `src/lib/services/llmSemaphore.ts` — Counting semaphore (20 default, evolution only)
- `src/lib/schemas/schemas.ts` — llmCallTracking Zod schema
- `evolution/src/lib/core/costTracker.ts` — CostTrackerImpl with reservation system
- `evolution/src/lib/core/llmClient.ts` — Evolution LLM wrapper with budget enforcement
- `evolution/src/lib/core/costEstimator.ts` — Pre-run cost estimation
- `evolution/src/lib/core/budgetRedistribution.ts` — Budget cap redistribution
- `evolution/src/lib/core/metricsWriter.ts` — Cost prediction persistence
- `evolution/src/lib/core/pipeline.ts` — Pipeline execution with budget stopping
- `evolution/src/lib/core/supervisor.ts` — Phase management with budget awareness
- `evolution/src/services/costAnalyticsActions.ts` — Cost analytics actions
- `evolution/src/services/experimentActions.ts` — Experiment budget enforcement
- `src/lib/services/returnExplanation.ts` — Non-evolution LLM caller (no budget)
- `src/lib/services/tagEvaluation.ts` — Non-evolution LLM caller (no budget)
- `src/lib/services/contentQualityEval.ts` — Non-evolution LLM caller (no budget)
- `src/lib/services/contentQualityCompare.ts` — Non-evolution LLM caller (no budget)
- `src/lib/services/explanationSummarizer.ts` — Non-evolution LLM caller (no budget)
- `src/lib/services/findMatches.ts` — Non-evolution LLM caller (no budget)
- `src/lib/services/links.ts` — Non-evolution LLM caller (no budget)
- `src/lib/services/linkWhitelist.ts` — Non-evolution LLM caller (no budget)
- `src/lib/services/sourceSummarizer.ts` — Non-evolution LLM caller (no budget)
- `src/lib/services/importArticle.ts` — Non-evolution LLM caller (no budget)
- `src/app/admin/costs/page.tsx` — Admin cost analytics dashboard
- `instrumentation.ts` — OpenTelemetry setup (4 tracers)
- `src/lib/services/featureFlags.ts` — Feature flag service (no caching, per-request DB query)
- `src/app/admin/settings/page.tsx` — Feature flag toggle UI with audit logging
- `supabase/migrations/20260116061036_add_llm_cost_tracking.sql` — llmCallTracking table + daily_llm_costs VIEW
- `evolution/src/lib/core/pipeline.ts` — Pipeline execution with budget stopping, maxRetries=1

## Open Questions
1. What are the current provider-level spending limits set on OpenAI/DeepSeek/Anthropic dashboards?
2. What daily/monthly spending level is acceptable as a hard cap?
3. Should the global kill switch be a feature flag in the DB or an environment variable? → **Recommendation: DB-backed feature flag with in-memory TTL cache (30s)**
4. Do we want Slack webhook integration for cost alerts, or just Honeycomb triggers? → **Recommendation: Honeycomb triggers first, Slack optional later**
5. Should non-evolution calls have per-request cost caps, or just contribute to the global daily cap? → **Recommendation: Global daily cap only; per-request caps add complexity with little benefit for $0.02 calls**
