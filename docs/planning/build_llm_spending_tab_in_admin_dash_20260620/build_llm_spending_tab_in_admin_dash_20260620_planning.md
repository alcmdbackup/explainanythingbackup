# Build LLM Spending Tab In Admin Dash Plan

## Background
Build a LLM spending dashboard. Ensure LLM cost data is tracked appropriately in tables with no nulls, surface spend split by evolution vs. non-evolution and by the entity responsible for calling, improve attribution in code where it is messy, and support viewing spend by hour, day, week, and agent type.

## Requirements (from GH Issue #1238)
- Make sure llms cost data is all tracked appropriately in tables and none are null. Make dashboard split costs by evolution vs. non-evolution, and by entity responsible for calling. if Attribution is messy add code for better attribution. Allowing viewing by hour, day, week and agent type also

## Problem
LLM spend is recorded in `llmCallTracking`, but the staging audit (see `_research.md` Key Findings) shows the real defect is **not nulls** (only ~38/80,080) — it's **empty-string `model` on ~90% of rows + test/mock pollution carrying fake, inflated costs** (mock fixtures hit the unknown-model fallback pricing of $10/$30 per 1M). Attribution is also thin: the only "who called this" signal is the free-form `call_source` string; there is no entity/agent or test discriminator. Evolution per-call rows have been largely missing since 2026-02-23, so an `llmCallTracking`-only view under-counts evolution spend. The existing `/admin/costs` page splits evolution/non_evolution at the rollup level but offers no per-entity breakdown, no hour/week granularity, and no way to separate real spend from test pollution. We need normalized, attributable cost data and a dashboard that breaks spend down by evolution vs non-evolution, by calling entity, by hour/day/week — with test/mock rows distinguishable.

## Delivery
**Single PR** — all four phases (mandatory attribution system, `is_test` flagging, granularity RPC, tabbed dashboard) ship together. The ~25 call-site migrations are mechanical and tsc-guarded; phases are sequenced for clean review but land in one branch/PR.

## Chosen Approach (locked via research Q&A, 2026-06-20)
**Code map + `is_test` column**, staging-only data basis, requirement re-scoped to "normalize empty `model` + flag test/mock pollution" (not just literal nulls), dashboard **shows everything** by default with category/entity/`is_test` filters.

## Options Considered
- [ ] **Option A: Derive everything at query time (no schema change)**: Map `call_source` → entity/category and detect test rows (userid/content heuristics) at query time only. Pros: no migration/backfill. Cons: heuristics re-implemented per query, fragile, no durable test flag. — _Not chosen._
- [ ] **Option B: Full new columns + backfill all history**: Add `agent_name` + `entity_type` + `is_test`, populate at insert, backfill every historical row. Pros: most complete. Cons: heaviest; backfills the hot path broadly. — _Not chosen (overkill)._
- [x] **Option C (CHOSEN): Canonical code map + `is_test` discriminator column**: Single-source-of-truth TS map `call_source → { entityType, category }` used at insert AND in aggregation; add an `is_test`/`environment` flag column populated at insert (one idempotent migration) + heuristic backfill (system/test userids `…000`/`…001`/`…099`, mock fingerprints). Normalize/recover `model` (keep `apiModel` fallback for live rows, backfill recoverable empties, leave irrecoverable mock rows flagged `is_test`). Evolution totals reconcile against `evolution_agent_invocations`/`evolution_metrics`. Dashboard shows all rows with filters.

## Design Decisions (rationale)

- **Attribution is made mandatory by *construction*, in layers.** `call_source` becomes a branded `CallSource` type sourced only from a closed registry/factories (Layer 0, compile-time) → an ESLint rule closes the `as`-cast escape hatch and covers `.js` (Layer 1) → a runtime guard at the chokepoint rejects/normalizes blanks with a stack-derived fallback (Layer 2) → an exhaustive entity map guarantees every known source resolves on the dashboard (Layer 3). Each layer backs up the next; no single bypass leaves a call unattributed. See Phase 2.
- **Single chokepoint for derivation.** Both LLM save paths (`callOpenAIModel` `llms.ts:743`, `callAnthropicModel` `llms.ts:870`) flow through `saveTrackingAndNotify` → `saveLlmCallTracking` (`llms.ts:243,164`). `is_test` and the entity/category are *pure functions of `call_source` + `userid` + `content`*, so derive them **inside `saveLlmCallTracking`** — no need to touch both call sites or thread anything through `CallLLMOptions`.
- **Store only `is_test`; derive category/entity at query time.** `category` (evolution/non_evolution) is already `call_source LIKE 'evolution_%'` in SQL; `entity` is `call_source` folded through the TS map after a `GROUP BY call_source`. Neither needs a column. `is_test` DOES need a column because it depends on `userid`/`content` (not cheaply expressible in the aggregation SQL) and must be filterable/indexable. → **migration adds exactly one column.** This is the literal "code map + `is_test` column" decision.
- **One granularity RPC, not three views.** A single `get_llm_spend_buckets(granularity, start, end, include_test)` using `date_trunc(granularity, created_at)` replaces adding `hourly_/weekly_` views. Keeps the surface small and the granularity dynamic.
- **Evolution totals are known-incomplete in `llmCallTracking`** (audit-gap since 2026-02-23) → surface a reconciliation number from `evolution_agent_invocations.cost_usd` rather than silently under-reporting.

## Phased Execution Plan

### Phase 1: Audit current cost-data integrity — ✅ DONE (research)
- [x] Audited staging `llmCallTracking` (80,080 rows): nulls negligible (38 cost, 1 model); empty `model` = 90% ($123.78), driven by integration-test mock pollution with fake costs; `call_source` clean (~30 values, `evolution_` prefix splits cleanly); test pollution also on user `…099`. Full findings in `_research.md`.
- [x] Locked approach via user Q&A: Option C (code map + `is_test` column), staging-only, reframed scope, show-everything dashboard.

### Phase 2: Mandatory layered attribution system + `is_test` flag

**Goal:** make a clean, bounded `call_source` *mandatory by construction*, not by convention. Today `call_source: string` is required but unconstrained — a blank string, a typo (`evaluate_tags` vs `evaluateTags`), or an unbounded template (`` `importArticle:${url}` ``) all compile. Four enforcement layers, strongest first, each backing up the next.

#### Layer 0 — Compile-time: branded `CallSource` type + registry (the core)
- [ ] **New module `src/lib/services/llmCallSource.ts`** — the single source of truth for *what a source may be*:
  ```ts
  // A raw string is NOT assignable to CallSource — callers must use the registry/factories.
  export type CallSource = string & { readonly __brand: 'CallSource' };
  const brand = (s: string): CallSource => s as CallSource;

  /** Closed registry of every non-evolution source (1:1 with a feature). */
  export const CALL_SOURCES = Object.freeze({
    evaluateTags:                  brand('evaluateTags'),
    generateTitleFromUserQuery:    brand('generateTitleFromUserQuery'),
    generateNewExplanation:        brand('generateNewExplanation'),
    generateHeadingStandaloneTitles: brand('generateHeadingStandaloneTitles'),
    extractLinkCandidates:         brand('extractLinkCandidates'),
    explanationSummarization:      brand('explanation_summarization'),
    sourceSummarization:           brand('source_summarization'),
    findBestMatchFromList:         brand('findBestMatchFromList'),
    enhanceContentWithInlineLinks: brand('enhanceContentWithInlineLinks'),
    enhanceContentWithHeadingLinks:brand('enhanceContentWithHeadingLinks'),
    enhanceContentWithKeyTermLinks:brand('enhanceContentWithKeyTermLinks'),
    contentQualityEval:            brand('content_quality_eval'),
    contentQualityCompare:         brand('contentQualityCompare'),
    editorAiSuggestions:           brand('editor_ai_suggestions'),
    editorApplySuggestions:        brand('editor_apply_suggestions'),
    streamChatApi:                 brand('stream-chat-api'),
    linkWhitelist:                 brand('linkWhitelist'),
    importArticle:                 brand('importArticle'),   // ← no URL suffix (normalized)
    matchViewerRejudge:            brand('match_viewer_rejudge'),
    // evolution_* sources whose suffix is NOT an AgentName need explicit registry entries:
    evolutionJudgeEval:            brand('evolution_judge_eval'),     // runJudgeEval.ts:301
    evolutionPromptEditor:         brand('evolution_prompt_editor'),  // runPromptEditorConfig.ts (PROMPT_EDITOR_CALL_SOURCE)
    // …complete from the audit's ~30 distinct values…
  } as const);

  /** Bounded factory for pipeline calls: `callLLM(prompt, `evolution_${label}`, …)` where
   *  label is the AgentName (claimAndExecuteRun.ts:204). MUST reuse the real union, not a copy. */
  import type { AgentName } from '@evolution/lib/core/agentNames';
  export type EvolutionAgent = AgentName;            // single source of truth — no hand-copied list
  export const evolutionSource = (agent: EvolutionAgent): CallSource => brand(`evolution_${agent}`);

  /** Test-only escape hatch — lets unit/integration tests use arbitrary sources without
   *  weakening the production registry. The ESLint rule (Layer 1) ALLOWS `testSource(...)`
   *  only in `*.test.ts`/`*.integration.test.ts`/e2e files. */
  export const testSource = (s: string): CallSource => brand(s);
  ```
  > **Scope note (oneshot) — corrected & a known-uncovered path.** `evolution/scripts/lib/oneshotGenerator.ts` uses its OWN local `callLLM` (provider SDK direct) and writes `llmCallTracking` through a **separate `trackLLMCall()` that calls `supabase.from('llmCallTracking').insert(...)` directly** (`oneshotGenerator.ts:47-63`), with `oneshot_${model}` / `oneshot_outline_${model}` (`:147,:220`). It therefore **bypasses `saveLlmCallTracking` and all four enforcement layers**, and reproduces the same unbounded-model-in-key cardinality we kill for `importArticle`. `pilot-mode-b.ts` writes no tracking at all.
  > - **Conclusion:** these are NOT branded-`callLLM` migration targets (the branded type can't reach a private SDK call), so there is **no `oneshotSource` factory**.
  > - **But don't leave it silently uncovered:** patch `trackLLMCall()` to set **`is_test = true`** on its inserts (these are offline CLI/experiment runs, not production user spend) so the dashboard classifies them correctly, and add a one-line `// known-uncovered: bypasses callLLM layers` marker. Normalizing the `oneshot_${model}` key (drop model from the key) is a noted follow-up, not required here.
- [ ] **Change the signature** `call_source: string` → `call_source: CallSource` on `callLLMModelRaw`, `routeLLMCall`, `callOpenAIModel`, `callAnthropicModel`, and the exported `callLLM`/`callLLMModel`/`callOpenAIModel` (`llms.ts:440,913,79,...`). After this, `callLLM(prompt, '', ...)` and `callLLM(prompt, 'typo', ...)` **fail tsc** — the only way to produce a `CallSource` is via the registry or a factory.
- [ ] **Migrate all production call sites** to the registry/factories (mechanical; tsc proves completeness — the build won't pass until every literal is migrated):
  - literals → `CALL_SOURCES.*` (e.g. `'evaluateTags'` → `CALL_SOURCES.evaluateTags`)
  - `` `importArticle:${source}` `` → `CALL_SOURCES.importArticle` (drop the URL from the key — **kills the unbounded-cardinality leak**; the URL stays in the prompt/logs)
  - `` `evolution_${label}` `` (claimAndExecuteRun.ts:204) → `evolutionSource(label)` — `label` is already `AgentName`, so it typechecks once `EvolutionAgent = AgentName`
  - `'evolution_judge_eval'` / `PROMPT_EDITOR_CALL_SOURCE` → `CALL_SOURCES.evolutionJudgeEval` / `.evolutionPromptEditor`
  - **Indirect-typed param sites:** `src/editorFiles/aiSuggestion.ts:685` declares a local `callLLM` param typed `call_source: string` — change that param type to `CallSource` too, or Layer 0 won't bite the literal at `:699`. Audit `computeRatings.ts` `config.callLLM` wrappers similarly (the real source is bound at the pairwise/comparison construction sites — include those).
- [ ] **Migrate test call sites + add `testSource`:** the existing test suite (`src/lib/services/llms.test.ts` and others) passes literals like `'test_source'` that aren't in the registry — the signature change breaks tsc on them. Convert those to `testSource('test_source')`. The Layer-1 ESLint rule whitelists `testSource(...)` in test files only.

#### Layer 1 — Lint: `require-llm-call-source` ESLint rule (closes the `as` escape hatch)
- [ ] **New rule `eslint-rules/require-llm-call-source.js`** (+ co-located `.test.js` RuleTester, register in `eslint.config.mjs` and `eslint-rules/index.js`, add to docs). The 2nd argument to `callLLM`/`callLLMModel`/`callOpenAIModel` must be a `CALL_SOURCES.*` member access or a whitelisted factory call (`evolutionSource(...)`; `testSource(...)` in test files only). Bans: string literals, template literals, and `as CallSource` / `as unknown as CallSource` casts on that arg.
- [ ] **Coverage reality (corrected):** `npm run lint` = `next lint`, which lints `src/`/`app/` but **does NOT lint the `evolution/` package** (verified — like the existing `flakiness/no-duplicate-column-labels` rule, its evolution scope is effectively dead under `next lint`). So **Layer 1 protects the main app; the evolution `.ts` call sites (`claimAndExecuteRun.ts`, `arenaActions.ts`, `runJudgeEval.ts`, `runPromptEditorConfig.ts`) are protected by Layer 0 (the branded type via `tsconfig.ci.json`)** — not by this rule. Either (a) accept that split and document it, or (b) add a second `eslint ./evolution --rulesdir eslint-rules` invocation to `npm run lint`. **Decision: (a)** — Layer 0 already type-covers evolution; don't expand lint scope.
- [ ] **Register at `'error'` severity (BLOCKING, not `'warn'`)** in `eslint.config.mjs` — same as the other `flakiness/*` enforcement rules. `npm run lint` (local `/finalize` + CI `lint` job) fails the build on any violation. Verify the migrated call sites pass at `error` before opening the PR.

#### Layer 2 — Runtime guard at the chokepoint (catches non-TS callers + cast escapes)
- [ ] In `callLLMModelRaw` (`llms.ts:913`), validate before the budget gate:
  ```ts
  const SOURCE_SHAPE = /^[a-z0-9_]+(:[a-z0-9-]+)?$/i;
  if (!call_source || !SOURCE_SHAPE.test(call_source)) {
    const caller = captureCallerName();           // parse new Error().stack, top non-llms.ts frame
    if (process.env.NODE_ENV !== 'production') {
      throw new Error(`callLLM: invalid/blank call_source (caller: ${caller})`);
    }
    logger.error('callLLM: unattributed call_source — using stack fallback', { caller });
    call_source = `unattributed:${caller}` as CallSource;   // never silently blank; greppable
  }
  ```
  - **New helper `captureCallerName()`** in `llmCallSource.ts` — derives the caller fn/file from the stack; returns `'anonymous'` when unavailable. This is the literal "function name if none provided" net — an *alarm + last resort*, never the primary key.

#### Layer 3 — Data/exhaustiveness: canonical entity map (guarantees dashboard attribution)
- [ ] **New module `src/lib/services/llmCostAttribution.ts`** — maps a source to its dashboard dimensions:
  ```ts
  export type CostCategory = 'evolution' | 'non_evolution';
  export interface CallAttribution { entity: string; category: CostCategory; }

  const ENTITY_BY_SOURCE: Record<string, string> = {
    [CALL_SOURCES.evaluateTags]: 'Tag evaluation',
    [CALL_SOURCES.generateTitleFromUserQuery]: 'Title generation',
    [CALL_SOURCES.generateNewExplanation]: 'Explanation generation',
    // …one entry per CALL_SOURCES member…
  };

  export function attributeCallSource(callSource: string): CallAttribution {
    const category: CostCategory = callSource.startsWith('evolution_') ? 'evolution' : 'non_evolution';
    const entity = callSource.startsWith('unattributed:')
      ? 'Unattributed'
      : category === 'evolution'
        ? `Evolution: ${callSource.replace(/^evolution_/, '')}`
        : (ENTITY_BY_SOURCE[callSource] ?? callSource);
    return { entity, category };
  }
  ```
- [ ] **Exhaustiveness unit test** asserts every `Object.values(CALL_SOURCES)` member resolves to a *mapped* (non-fallback) entity — adding a source without an entity mapping fails CI. So the dashboard can never show a known source as "unknown."

#### `is_test` flag + tracking-path write (depends on Layers 0–3)
- [ ] **`isTestLlmCall`** in `llmCostAttribution.ts`:
  ```ts
  const TEST_USER_IDS = new Set([
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000000001',  // system const
    '00000000-0000-4000-8000-000000000099',  // test pollution (research finding)
  ]);
  export function isTestLlmCall(a: { userid: string; callSource: string; content: string }): boolean {
    return TEST_USER_IDS.has(a.userid)
      || process.env.E2E_TEST_MODE === 'true'
      || process.env.NODE_ENV === 'test'
      || a.callSource === 'integration_test'
      || a.callSource === 'generation'           // E2E factory literal (evolution-test-data-factory)
      || a.content === 'Unexpected call';        // mock fixture fingerprint
  }
  ```
- [ ] **Migration `<ts>_llm_tracking_is_test.sql`** (idempotent):
  ```sql
  ALTER TABLE "llmCallTracking" ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;
  CREATE INDEX IF NOT EXISTS idx_llmtracking_is_test_created ON "llmCallTracking" (is_test, created_at);
  ```
- [ ] **Populate at the chokepoint** `saveLlmCallTracking` (`llms.ts:164`): set `is_test = isTestLlmCall({ userid, callSource: trackingData.call_source, content: trackingData.content })`. (Both save paths flow through here.)
- [ ] **Extend `llmCallTrackingSchema`** (`schemas.ts:508`): `is_test: z.boolean().optional()`.
- [ ] **Backfill script `scripts/backfillLlmIsTest.ts`** (`--dry-run` default, `--apply`): set `is_test=true` for historical rows. **Delegates to `isTestLlmCall`** (DRY — one tested heuristic, no duplicated logic), reading `userid`/`call_source`/`content` per row. Log counts.
- [ ] **Best-effort caveat:** the `content === 'Unexpected call'` fingerprint is an exact-match on free-form model output — a backfill heuristic, not a correctness guarantee (a real response equal to that string is a false positive; a differently-worded mock is missed). Insert-time `is_test` correctness rests on `TEST_USER_IDS` + env (`E2E_TEST_MODE`/`NODE_ENV=test`), which are deterministic; the content check only sharpens the historical backfill. Document this in the module.

### Phase 3: Aggregation layer (granularity + dimensions)
- [ ] **Migration `<ts>_get_llm_spend_buckets.sql`** — `CREATE OR REPLACE FUNCTION`, SECURITY DEFINER. **Must match the secure pattern of the sibling RPCs in `20260228000001_add_llm_cost_security.sql`**: pin `search_path`, `REVOKE FROM PUBLIC`, explicit `GRANT EXECUTE TO service_role`, and whitelist `p_granularity` *inside* the function (it's a `date_trunc` argument, not concatenated SQL — so this is input-validation for a clean error, not injection defense):
  ```sql
  CREATE OR REPLACE FUNCTION get_llm_spend_buckets(
    p_granularity text,           -- 'hour' | 'day' | 'week'
    p_start timestamptz,
    p_end   timestamptz,
    p_include_test boolean DEFAULT true
  ) RETURNS TABLE (bucket timestamptz, call_source text, model text, is_test boolean,
                   call_count bigint, total_tokens bigint, total_cost numeric)
  LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT date_trunc(
             CASE WHEN p_granularity IN ('hour','day','week') THEN p_granularity
                  ELSE NULL END,                              -- bad value → clean NULL error
             created_at) AS bucket,
           call_source, COALESCE(NULLIF(model,''),'unknown') AS model, is_test,
           count(*), COALESCE(SUM(total_tokens),0), COALESCE(SUM(estimated_cost_usd),0)
    FROM "llmCallTracking"
    WHERE created_at >= p_start AND created_at < p_end
      AND (p_include_test OR is_test = false)
    GROUP BY 1,2,3,4;
  $$;
  REVOKE ALL ON FUNCTION get_llm_spend_buckets(text,timestamptz,timestamptz,boolean) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION get_llm_spend_buckets(text,timestamptz,timestamptz,boolean) TO service_role;
  ```
  The action ALSO validates `granularity` against the typed enum before calling (defense in depth + clean app-layer error), and `requireAdmin()` runs BEFORE `.rpc()` so the definer function is never reachable without the admin check.
- [ ] **New server actions in `costAnalytics.ts`** (mirror existing `requireAdmin()` + `withLogging` + `serverReadRequestId` pattern):
  - `getSpendByGranularityAction({ granularity, startDate, endDate, includeTest })` → calls the RPC; folds `call_source → { entity, category }` via `attributeCallSource`; returns buckets + per-bucket category/entity/model splits. Extend `CostFilters` with `granularity?: 'hour'|'day'|'week'` and `includeTest?: boolean`.
  - `getCostByEntityAction(filters)` → groups RPC rows by `entity` (and by `category`).
  - `getEvolutionReconciliationAction(filters)` → returns `{ trackingCost, invocationCost }` where `invocationCost = SUM(cost_usd)` from `evolution_agent_invocations` in range, to expose the audit-gap delta.
- [ ] Reuse `attributeCallSource` for the *category* split so the dashboard's evolution/non_evolution is consistent with the rollup trigger.

### Phase 4: Dashboard UI (`src/app/admin/costs/page.tsx`) — TABBED layout (chosen)
Wireframe approved 2026-06-20: **tabbed sections** with shared controls + data-quality banner pinned on top; **stacked bars** for the category split.
- [ ] **Shared header (always visible, above tabs):** date-range selector, **granularity toggle** (`'hour'|'day'|'week'`, default `'day'`, `data-testid="admin-costs-granularity"`), **`include test` toggle** (default checked = show everything, `data-testid="admin-costs-include-test"`), Backfill button, and the **data-quality banner**.
- [ ] **Data-quality banner** — null/empty-model counts (`getCostSummaryAction.nullCostCount` + new empty-model count), `is_test` share, and an **evolution audit-gap notice** when `getEvolutionReconciliationAction` shows `invocationCost` materially exceeds `trackingCost` (reuse existing missing-cost warning pattern). `data-testid="admin-costs-quality"`.
- [ ] **Tab bar** — `Overview · By Entity · By Model · Controls`. Client-side `activeTab` state, no reload; `data-testid="admin-costs-tab-<name>"`. (Mirror the evolution `EntityDetailTabs`/`useTabState` pattern if cleanly reusable on the public admin host; otherwise a thin local tab bar.)
- [ ] **Overview tab** — summary cards with the evolution/non_evolution split rows + the **stacked-bar** time chart (`■ evolution` on top of `■ non-evolution` per bucket), sourced from `getSpendByGranularityAction`.
- [ ] **By Entity tab** — "Spend by Entity" table (entity, category badge, calls, tokens, cost), sorted by cost desc, `evo|non|all` sub-filter; `data-testid="admin-costs-entity-row-<entity>"`. `⚠` marker on rows with a high `is_test`/empty-model share.
- [ ] **By Model tab** — existing model bars/table, with empty model coalesced to `unknown` and a `⚠` test-pollution hint.
- [ ] **Controls tab** — existing spending controls (caps, kill switch) moved here unchanged.
- [ ] Add `data-testid`s across the page (none exist today) for the E2E spec.

## Files Modified / Added
| File | Change |
|---|---|
| `src/lib/services/llmCallSource.ts` | **NEW** — branded `CallSource`, `CALL_SOURCES` registry, `evolutionSource`/`testSource` factories, `captureCallerName` (Layer 0/2) |
| `src/lib/services/llmCallSource.test.ts` | **NEW** — registry/factory shape + `captureCallerName` |
| `evolution/scripts/lib/oneshotGenerator.ts` | Set `is_test=true` in `trackLLMCall()` insert (known-uncovered path; NOT a branded-callLLM migration) |
| `eslint-rules/require-llm-call-source.js` (+ `.test.js`) | **NEW** — Layer 1 lint rule; register in `eslint.config.mjs` + `eslint-rules/index.js` |
| `src/lib/services/llmCostAttribution.ts` | **NEW** — `attributeCallSource`, `isTestLlmCall`, `TEST_USER_IDS`, `ENTITY_BY_SOURCE` (Layer 3) |
| `src/lib/services/llmCostAttribution.test.ts` | **NEW** — map + exhaustiveness + test heuristic |
| `src/lib/services/llms.ts` | `call_source: string` → `CallSource` (signatures); runtime guard (Layer 2); set `is_test` in `saveLlmCallTracking` |
| `src/lib/schemas/schemas.ts` | `is_test` on `llmCallTrackingSchema` (`:508`) |
| **~25 call sites** (`returnExplanation.ts`, `tagEvaluation.ts`, `links.ts`, `findMatches.ts`, `explanationSummarizer.ts`, `sourceSummarizer.ts`, `importArticle.ts`, `contentQuality*.ts`, `linkWhitelist.ts`, `stream-chat/route.ts`, `editorFiles/**` incl. `aiSuggestion.ts` local param, `actions/actions.ts`, evolution `claimAndExecuteRun.ts`, `runPromptEditorConfig.ts`, `arenaActions.ts`, `runJudgeEval.ts`) | literals → `CALL_SOURCES.*` / `evolutionSource`; drop URL from `importArticle` key. (`oneshotGenerator.ts` is NOT here — see its own row.) |
| `supabase/migrations/<ts>_llm_tracking_is_test.sql` | **NEW** — `is_test` column + index (idempotent) |
| `supabase/migrations/<ts>_get_llm_spend_buckets.sql` | **NEW** — granularity RPC |
| `evolution/src/services/costAnalytics.ts` | New actions + `CostFilters` fields |
| `evolution/src/services/costAnalytics.test.ts` | **EXTEND existing** — new-action cases |
| `src/lib/services/llms.test.ts` (+ other test files) | Migrate literal `call_source` args → `testSource(...)` |
| `scripts/backfillLlmIsTest.ts` | **NEW** — historical `is_test` backfill (`--dry-run` default; delegates to `isTestLlmCall`) |
| `src/app/admin/costs/page.tsx` | Tabbed layout, granularity toggle, stacked category split, entity table, `is_test` toggle, data-quality panel, `data-testid`s |
| `src/__tests__/integration/evolution-llm-cost-attribution.integration.test.ts` | **NEW** — insert + RPC + reconciliation (evolution- prefix + skip guard) |
| `src/__tests__/e2e/specs/09-admin/admin-llm-spending.spec.ts` | **NEW** — dashboard E2E (`@evolution`, admin host) |

## Testing

### Unit Tests
- [ ] `src/lib/services/llmCallSource.test.ts` — every `CALL_SOURCES` member matches the shape regex; `evolutionSource(agent)` produces `evolution_<agent>`; `testSource` round-trips; `captureCallerName` returns a non-empty caller from a synthetic stack and `'anonymous'` when the stack is missing/unparseable.
- [ ] `eslint-rules/require-llm-call-source.test.js` — RuleTester: valid (`CALL_SOURCES.x`, `evolutionSource('generation')`), invalid (string literal, template literal, `x as CallSource`).
- [ ] `src/lib/services/llmCostAttribution.test.ts` — `attributeCallSource`: `evolution_*` → category=evolution + `Evolution: <agent>`; known non-evo → mapped label; `unattributed:*` → `'Unattributed'`. **Exhaustiveness:** every `Object.values(CALL_SOURCES)` resolves to a non-fallback entity. `isTestLlmCall`: each test-userid / `E2E_TEST_MODE` / `NODE_ENV=test` / `integration_test` / `generation` / `"Unexpected call"` → true; a real prod-shaped row → false.
- [ ] `src/lib/services/llms.*test.ts` — runtime guard: blank/invalid `call_source` throws outside production and yields `unattributed:<caller>` (not blank) in production.
- [ ] `evolution/src/services/costAnalytics.test.ts` (**extend the existing file**, not new) — new actions with a mocked Supabase RPC: hour/day/week bucketing passthrough, **invalid granularity rejected at the action boundary** (before `.rpc()`), `includeTest` filter wired to RPC arg, `call_source`→entity folding, evolution/non_evolution split, empty-model→`unknown` coalesce, reconciliation delta math.

### Integration Tests
- [ ] **`src/__tests__/integration/evolution-llm-cost-attribution.integration.test.ts`** (note the **`evolution-` prefix**): CI's prod-path split routes integration tests by `--testPathPatterns="evolution-|arena-actions|manual-experiment|strategy-resolution"`. A `llm-cost-attribution` name lands in the WRONG (`:non-evolution`) bucket yet depends on the new RPC + seeds `evolution_agent_invocations` for the reconciliation assertion. Use the `evolution-` prefix so it lands in the evolution bucket, and **add an `evolutionTablesExist()` + RPC-exists skip guard** (mirroring the existing `evolution-cost-attribution` test) so it auto-skips when the migration/tables aren't present rather than hard-failing.
- [ ] Test body: insert tracking rows (real + test-userid `…099` + mock-content) → assert `is_test` set correctly at insert; call `get_llm_spend_buckets` and assert bucket sums equal raw `SUM(estimated_cost_usd)`; assert `includeTest=false` excludes the seeded test rows; assert an invalid `p_granularity` errors cleanly; assert `getEvolutionReconciliationAction` returns the `evolution_agent_invocations` SUM. Cleanup all seeded rows in `afterAll`.

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-llm-spending.spec.ts` (`{ tag: '@evolution' }`, admin host via `adminTest` — consistent with existing non-evolution admin specs like `admin-content`/`admin-reports`, which a single `baseURL` serves). Load `/admin/costs`; switch tabs (Overview/By Entity/By Model/Controls) and assert each renders; toggle granularity hour/day/week and assert the stacked chart re-renders; assert the category split + audit-gap banner render.
- [ ] **Seed known rows (don't rely on ambient pollution):** the dev DB already carries ~72k mock rows, so a bare "row count changes" assertion is non-deterministic. In `beforeAll`, seed a small set of known `is_test=true` and `is_test=false` `llmCallTracking` rows (via service client, like `admin-evolution-cost-split.spec.ts`); assert the `include-test` toggle hides/shows exactly those seeded rows. `afterAll` deletes them (required by `flakiness/require-test-cleanup`).
- [ ] **Lint-rule compliance for the new admin spec:** because it seeds shared state in `beforeAll`, declare `test.describe.configure({ mode: 'serial' })` (Rule 13 / `flakiness/require-serial-with-beforeall`). Provide a `resetFilters()` on the page POM and call it after navigation before asserting on seeded rows (Rule 1 / `flakiness/require-reset-filters` for `09-admin/**` specs) — here it resets the granularity/category/`include-test` controls to defaults.

### Manual Verification
- [ ] Seed mixed evolution + non-evolution + test-userid tracking rows on dev DB; verify dashboard totals reconcile with `npm run query:staging` SUMs across granularity, category, entity, and `is_test` groupings.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-llm-spending.spec.ts` against the local server (via ensure-server.sh); screenshot the hour/day/week toggle + evolution-split + entity table.

### B) Automated Tests
- [ ] `npm run test:unit -- llmCallSource llmCostAttribution costAnalytics`
- [ ] ESLint rule self-test (RuleTester) + `npm run lint` (proves `require-llm-call-source` passes on the migrated call sites)
- [ ] `npm run test:integration -- --grep "cost attribution"`
- [ ] `npm run migration:verify` (two new migrations in Phases 2–3 — Docker postgres harness)
- [ ] Full `/finalize` local check trio (lint + tsc + build + unit + ESM + integration + E2E critical) before PR

## Rollback Plan
Single PR, but the pieces revert independently:
- **Type change + call-site migration + ESLint rule:** mechanical `git revert` of the PR restores `call_source: string`. No data implications. The blocking lint rule disappears with the revert.
- **`is_test` column** (`<ts>_llm_tracking_is_test.sql`): forward migration is metadata-only — `ADD COLUMN … NOT NULL DEFAULT false` is a catalog-only change on Postgres 11+ (no table rewrite, no long lock on the 80k-row hot `llmCallTracking`). Down migration: `ALTER TABLE "llmCallTracking" DROP COLUMN IF EXISTS is_test; DROP INDEX IF EXISTS idx_llmtracking_is_test_created;` (write as a Rollback comment header in the migration, per the `20260116061036` precedent).
- **RPC** (`<ts>_get_llm_spend_buckets.sql`): down = `DROP FUNCTION IF EXISTS get_llm_spend_buckets(text,timestamptz,timestamptz,boolean);`. The dashboard actions degrade gracefully (action returns `{ success:false }` → page shows the existing error state) if the function is absent.
- **Sequencing:** the RPC migration timestamp MUST sort after the `is_test` column migration (it reads `is_test`); `migration:verify` (ephemeral Docker pg) catches an inversion. Migrations deploy to staging on merge to `main` and to prod only via `/mainToProd` — so a same-day revert PR is the rollback path post-merge, not an in-place edit (append-only rule).

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `docs/feature_deep_dives/admin_panel.md` — document the new spending tab, entity/agent breakdown, granularity toggle.
- [ ] `evolution/docs/cost_optimization.md` — update attribution/null-handling notes; reconcile audit-gap caveat with new reconciliation behavior.
- [ ] `evolution/docs/data_model.md` — new/changed `llmCallTracking` columns or aggregation view/RPC.
- [ ] `evolution/docs/entities.md` — entity/agent attribution mapping.
- [ ] `evolution/docs/visualization.md` — new dashboard tab/charts.
- [ ] `docs/feature_deep_dives/metrics_analytics.md` — spend metrics surfaced.
- [ ] `evolution/docs/logging.md`, `evolution/docs/reference.md`, `docs/feature_deep_dives/request_tracing_observability.md` — if attribution touches request/entity tracing.
- [ ] `docs/docs_overall/testing_overview.md` — add `require-llm-call-source` to the ESLint Enforcement Summary table (and `scripts/check-skill-sections.sh`/CI lint registry if applicable).

## Review & Discussion

`/plan-review` — 3-agent loop (Security / Architecture / Testing), reached 5/5/5 consensus in 3 iterations (2026-06-20).

| Iteration | Security | Architecture | Testing |
|---|---|---|---|
| 1 | 3/5 | 3/5 | 4/5 |
| 2 | 5/5 | 4/5 | 5/5 |
| 3 | **5/5** | **5/5** | **5/5** |

**Iteration 1 — critical gaps fixed:**
- *Security:* `get_llm_spend_buckets` RPC was missing `SET search_path = public` (SECURITY DEFINER privilege-escalation vector) and `REVOKE FROM PUBLIC` / `GRANT EXECUTE TO service_role` → added both, matching the sibling RPCs in `20260228000001_add_llm_cost_security.sql`. Added an in-function granularity whitelist.
- *Security:* branded `CallSource` change would break the existing test suite's literal `call_source` args (`llms.test.ts` ×~28 `'test_source'`) with the ESLint rule banning the `as` workaround → added a `testSource()` factory (whitelisted in test files) + explicit test-migration step.
- *Architecture:* `EvolutionAgent` union diverged from the real `AgentName` (would fail tsc on `claimAndExecuteRun`'s `evolution_${label}`) → `export type EvolutionAgent = AgentName` via `import type`. Added registry entries for `evolution_judge_eval` / `evolution_prompt_editor` (evolution sources whose suffix isn't an `AgentName`).
- *Architecture:* Layer-1 ESLint rule falsely claimed to cover `evolution/` (`next lint` doesn't) → corrected; evolution `.ts` relies on Layer 0/tsc.
- *Testing:* integration test would land in the wrong CI bucket and lacked a skip guard → renamed `evolution-llm-cost-attribution.integration.test.ts` + `evolutionTablesExist()`/RPC-exists guard. Added a **Rollback Plan** section (down-migrations + type-change revert + sequencing).

**Iteration 2 — fixed (Architecture held at 4/5):**
- Corrected a factual error: `oneshotGenerator.ts` *does* write `llmCallTracking` directly via its own `trackLLMCall()` insert (`:47-63`) with unbounded `oneshot_${model}`, bypassing all four layers. Reframed as a **known-uncovered path**, patched to set `is_test=true`; removed the dead `oneshotSource` factory and the stale migration-target references. Added serial-mode + `resetFilters()` for the new admin E2E spec.

**Iteration 3:** all three reviewers 5/5, no critical gaps. Remaining notes are cosmetic (a tight line-number citation; a dead `:suffix` regex branch). **Plan approved for execution.**
