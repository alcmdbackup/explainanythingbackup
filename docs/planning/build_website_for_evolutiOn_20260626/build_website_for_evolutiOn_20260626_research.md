## Problem Statement
Help me build a user facing website for evolution.

## Requirements (from GH Issue #1293)
Build a front-end and stop experimenting.

- Choose a good URL.
- User can paste in any article.
- It can run a pipeline using a set strategy that is selectable via the UI.
- Can see final output, and a diff against the initial input side-by-side. Following the existing pattern on variant details tab for diff against parent.

## High Level Summary

A new user-facing surface that turns the evolution pipeline into a self-serve product. Four pillars need a planning decision before code:

1. **Hosting** — three real options (existing public host, new dedicated hostname, evolution admin host). Each requires a different middleware/auth/cookie story; the "Choose a good URL" requirement falls out of this. Strong lean: option A (add `/evolve/*` to the existing public host) — ~1-line `PUBLIC_PREFIXES` change vs ~5 middleware sites for a new hostname.
2. **Sync vs async execution** — `POST /api/evolution/run` is admin-gated, capped at Vercel's 300s `maxDuration` (effective `maxDurationMs=240_000`). Mock 3-iter ≈ 14.4s; real 5-iter at default settings likely exceeds the cap, so the safer model is to insert a `pending` `evolution_runs` row and let the minicomputer (`processRunQueue.ts`, polls every 60s) execute it — then the client polls a results endpoint or subscribes via SSE.
3. **Strategy whitelist** — `listStrategiesAction` already supports `status` / `is_test_content` filters; cheapest curation = add `public_visible boolean` column + a public-callable `listPublicStrategiesAction` server action. Alternative is a static allowlist constant.
4. **Cost / abuse boundary** — existing `LLMSpendingGate` is category-wide (`evolution_*` shares the $25/day envelope). `checkPerUserCap` keys on Supabase user-id (so guest auto-login users would share a single $10/day cap by default — useful but might be too tight for a hosted demo). No per-IP / per-session rate-limit primitive exists in the codebase — new infra needed.

The `SideBySideWordDiff` reuse story is clean: the component takes `parent`, `variant`, optional labels and is already used in 3 places (`VariantParentDiffTab`, Match Viewer, Prompt Editor) with no hard-coded ID/runId dependencies. We can render `<SideBySideWordDiff parent={originalInputText} variant={winnerText} leftLabel="Original input" rightLabel="Evolved" />` and match the variant-details tab visual exactly.

There's also a small admin-path gap worth fixing in this project (or flagging): `queueEvolutionRunAction` validates `promptId` against `evolution_prompts` but does NOT validate `explanationId` against `explanations`. The public-facing insert helper should validate (or insert) the underlying `evolution_explanations` row before inserting the `evolution_runs` row.

## Documents Read

### Core Workflow Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Core Operations Docs
- docs/docs_overall/environments.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/debugging.md

### Relevant Docs
- docs/docs_overall/design_style_guide.md — color tokens, typography, paper texture, button variants for the new page
- docs/feature_deep_dives/server_action_patterns.md — `withLogging` + `serverReadRequestId` + `{success,data,error}` envelope for the new actions
- docs/feature_deep_dives/markdown_ast_diffing.md — context; the public page won't need full CriticMarkup-level diffing, just `SideBySideWordDiff`
- docs/feature_deep_dives/authentication_rls.md — hostname-split semantics, guest auto-login env vars, middleware allowlist
- docs/feature_deep_dives/state_management.md — `pageLifecycleReducer` shape to mirror for the paste→running→viewing flow
- evolution/docs/README.md
- evolution/docs/architecture.md — the 4 entry points, claim/execute lifecycle, run-status state machine
- evolution/docs/data_model.md — `evolution_runs`, `evolution_explanations`, `evolution_strategies`, `evolution_prompts` schemas + RLS deny-all defaults
- evolution/docs/strategies_and_experiments.md — `listStrategiesAction` + StrategyConfig shape
- evolution/docs/visualization.md — admin variant-details tab pattern (the "diff against parent" reference)
- evolution/docs/arena.md, criteria_agents.md, editing_agents.md, paragraph_recombine.md, paragraph_recombine_with_coherence_pass.md, multi_iteration_strategies.md — agent-type catalog for the strategy whitelist decision
- evolution/docs/cost_optimization.md — `V2CostTracker` per-run + `LLMSpendingGate` global daily/monthly + 402/no-max_tokens failure mode (`EVOLUTION_MAX_OUTPUT_TOKENS`)
- evolution/docs/reference.md — file inventory; env-var catalog including the kill switches we'll reuse
- evolution/docs/variant_lineage.md — the `VariantParentDiffTab` pattern we're mirroring
- evolution/docs/agents/overview.md, evolution_metrics.md, metrics.md — cost-metric routing and how user runs will surface in the existing dashboards
- evolution/docs/logging.md — `EntityLogger` for the new public action
- evolution/docs/curriculum.md, implicit_rubric_weights.md, minicomputer_deployment.md, prompt_editor.md, rating_and_comparison.md — context; minicomputer doc confirms the async-execute path

## Code Files Read

### Public-site frontend pattern
- `src/app/page.tsx:1-93` — tabbed home with `HomeSearchPanel` + `HomeImportPanel`; navigation has no in-bar search bar
- `src/app/layout.tsx:1-75` — root theme provider + typography setup
- `src/components/Navigation.tsx:1-100` — uses `useIsGuest()` to adapt UI
- `src/components/home/HomeSearchPanel.tsx:36-71` — client-side submit pattern: stores side-car data in `sessionStorage`, `router.push('/results?q=...')`
- `src/components/home/HomeImportPanel.tsx:63-106` — alternative submit via `processImport()` server action
- `src/app/api/returnExplanation/route.ts:1-310` — SSE streaming over `ReadableStream`; 30s heartbeat; `streaming_start` / `complete` / `error` events
- `src/app/api/stream-chat/route.ts:1-118` — generic streaming endpoint; `data: {text,isComplete}` shape
- `src/app/results/page.tsx:1-150` — `ResultsPageContent` + `fetch('/api/returnExplanation')` with event listeners
- `src/reducers/pageLifecycleReducer.ts:1-481` — `idle → loading → streaming → viewing → editing → saving → error`; selectors at lines 359-481

### Evolution entry points
- `src/app/api/evolution/run/route.ts:1-93` — admin-gated POST; `maxDuration=300s`, `maxDurationMs=240_000`; categorizes errors (Unauthorized 403, KillSwitch 503, GlobalBudget 402, BudgetExceeded 402)
- `evolution/src/lib/pipeline/claimAndExecuteRun.ts:104-203` — core entry; `RunnerOptions` carries `runnerId, maxDurationMs?, targetRunId?, db?, dryRun?, signal?`
- `evolution/src/services/evolutionActions.ts:162-243` — `queueEvolutionRunAction` insert payload `{budget_cap_usd, strategy_id, explanation_id?|prompt_id?}` — **gap**: validates `promptId` but NOT `explanationId` against the underlying table
- `evolution/scripts/processRunQueue.ts:1-249` — minicomputer batch runner: claims pending rows from both staging + prod, round-robin, `Promise.allSettled`
- `evolution/scripts/run-evolution-local.ts:1-443` — local CLI; payload at lines 223-230 (`{id, explanation_id, source, status:'pending', budget_cap_usd, strategy_id}`)
- `evolution/src/services/strategyRegistryActionsV2.ts` — `listStrategiesAction` (admin-gated); already supports `status` / `is_test_content` filters
- `evolution/src/lib/pipeline/setup/buildRunContext.ts` — `resolveContent()` path: `explanation_id` → reads from `explanations.content`; `prompt_id` → seed-generates via `generateSeedArticle`; both null → `missing_seed_article` failure

### Diff component + variant-details pattern
- `evolution/src/components/evolution/visualizations/SideBySideWordDiff.tsx:1-87` — props `{parent, variant, previewLength=600, leftLabel='Parent', rightLabel='This variant'}`; uses `diffWordsWithSpace`; renders inside `<pre class="whitespace-pre-wrap text-sm leading-relaxed font-mono ...">` so markdown shows as raw text; testIDs: `sxs-diff`, `sxs-parent`, `sxs-variant`, `sxs-expand-toggle`
- `evolution/src/components/evolution/variant/VariantParentDiffTab.tsx:1-94` — canonical caller; fetches via `getVariantParentDiffAction(variantId)` returning `VariantParentDiff`; testIDs `variant-parent-diff`, `variant-parent-diff-empty`, `variant-parent-diff-slot`, `variant-parent-diff-cross-run`
- `evolution/src/services/variantDetailActions.ts:203-223` — `VariantParentDiff` type shape
- `src/app/admin/evolution/matches/[comparisonId]/page.tsx:355-360` — Match Viewer uses `leftLabel="Text A · {elo}"` / `rightLabel="Text B · {elo}"`
- `src/app/admin/evolution/prompt-editor/page.tsx:437` — Prompt Editor uses defaults — exactly the shape the new public page will need

### Hostname, middleware, cost-gate boundaries
- `src/config/hostnames.ts:14-79` — `PROD_PUBLIC_HOST='explainanything.vercel.app'`, `PROD_EVOLUTION_HOST='ea-evolution.vercel.app'`, `HostTier = 'local'|'preview'|'public'|'evolution'|'unknown'`; `PUBLIC_PREFIXES`/`EVOLUTION_PREFIXES`/`ALWAYS_ALLOWED_PREFIXES` constants; **3 call sites of `classifyHost()`**: `src/middleware.ts:54`, `src/lib/utils/supabase/middleware.ts:111`, `src/lib/services/adminAuth.ts:32`
- `src/middleware.ts:54-86` — host classification → tier-based 404 / route-allow logic
- `src/lib/utils/supabase/middleware.ts:102-170` — guest auto-login block; gated on `tier ∈ {public, local, preview}` AND `GUEST_EMAIL`/`GUEST_PASSWORD` set AND not `E2E_TEST_MODE`
- `src/lib/services/llmSpendingGate.ts` — `checkBudget(callSource, est)` at line 151; `getCallCategory(callSource)` at line 51 — prefix-based (`evolution_*` → `'evolution'`, else `'non_evolution'`); `checkPerUserCap(userid, capUsd)` at line 88 (used for the guest-account $10/day cap); kill-switch + monthly cap also there. **No per-IP rate-limit primitive** in the codebase (zero hits for `upstash`/`rateLimit`)

## Key Findings

1. **Public surface entry point** — A new server action / API route is the right shape. It must: (a) NOT call `requireAdmin()` (the only auth-meaningful boundary becomes the rate limit + cost cap), (b) validate the strategy is on the public whitelist, (c) insert an `evolution_explanations` row with the pasted text, (d) insert a `pending` `evolution_runs` row linking it, (e) return `{runId}` immediately so the client can poll for completion.

2. **Async execution is the right default** — Vercel's `maxDuration=300s` is uncomfortably close to a real 5-iteration run. Inserting a pending row and letting the minicomputer's `processRunQueue.ts` (60s polling cadence) pick it up gives a reliable single execution model with no extra infrastructure. The minicomputer already runs against staging + prod and the test-content gate (`is_test_content` + `allow_test_execution`) already prevents accidental fixture executions. Client side: poll `getRunForUserAction(runId)` every few seconds until `status='completed'`, then render. Alternatively, an SSE endpoint that selects on the run row + emits when status changes — more complex, decide in planning.

3. **`SideBySideWordDiff` reuses cleanly with NO modification** — Pass `parent={pastedText}`, `variant={winnerVariantContent}`, `leftLabel="Original"`, `rightLabel="Evolved"`. The component's `<pre>` tag preserves markdown as literal text — which is exactly what the variant-details tab does — so the user's "follow existing pattern" requirement is satisfied by direct reuse. The expand toggle + 600-char preview are already handled.

4. **Hosting Option A (public host) is the cheapest by ~5×** — Adding `/evolve` to `PUBLIC_PREFIXES` is a one-constant change vs ~5 sites for a new tier (`classifyHost`, middleware tier blocks, admin-auth, guest auto-login condition, new env vars). Option A also reuses the existing guest auto-login (perfect for a try-it-without-signup flow) and the existing cookie jar. The "good URL" requirement reduces to picking the path (e.g. `/evolve`, `/improve`, `/rewrite`, `/polish`) — TBD via AskUserQuestion.

5. **Strategy whitelist mechanism** — Cheapest path: add `public_visible BOOLEAN NOT NULL DEFAULT false` column to `evolution_strategies` via a migration, seed `true` on a curated set, expose via `listPublicStrategiesAction` (or extend the existing list action with a `publicOnly: boolean` filter). The list action returns `{name, label, generationModel, judgeModel, iterationConfigs.length, budgetUsd}` so the UI can render a friendly picker with an estimated cost hint.

6. **Cost discipline must combine 3 layers** — (a) per-run budget on the inserted `evolution_runs.budget_cap_usd` (e.g. cap at $0.10 for public runs), (b) `evolution_daily_cap_usd` envelope shared with all evolution spend (currently $25/day — may need bump), (c) per-IP rate limit (NEW infra). For (c), since `LLMSpendingGate.checkPerUserCap` already exists and keys on Supabase user-id, and guest auto-login produces a single shared user-id, the per-user cap becomes a per-demo-user-account cap automatically. For real per-IP isolation we either need Upstash KV (new infra) or a DB-table-based token bucket (e.g. `public_evolve_rate_limit(ip TEXT PRIMARY KEY, window_start TIMESTAMPTZ, count INT)`). DB path is zero new infra.

7. **Admin-path gap worth fixing in-PR** — `queueEvolutionRunAction` (line 178-189) validates `promptId` exists in `evolution_prompts` but skips the symmetric validation for `explanationId`. The public-side insert helper must validate or insert the `evolution_explanations` row; the same helper / shared validator could be applied to the admin action.

8. **The pattern is reusable, the missing pieces are small** — Almost every system the public flow needs already exists: claim/execute, cost gate, strategy registry, diff component, hostname middleware, guest auto-login, server action pattern, page lifecycle reducer. The new surface is roughly: 1 migration (whitelist + maybe rate-limit table) + 3 server actions (list public strategies, submit, get run status) + 2 page components (paste form, results-with-diff) + middleware allowlist tweak + tests.

## Open Questions

1. **Hosting choice** — Option A (path `/evolve` on `explainanything.vercel.app`), B (new hostname `evolve.explainanything.app`), or C (path on `ea-evolution.vercel.app`)? Recommend A. Need user decision.

2. **URL path under Option A** — `/evolve`, `/improve`, `/rewrite`, `/polish`, `/refine`, or something else? Need user opinion + product-name awareness.

3. **Sync vs async execution** — Async via existing minicomputer queue (recommended) or sync via the existing `/api/evolution/run` route adapted? Async is more reliable; sync gives instant feedback but risks timeouts. Async + polling is the simplest robust path.

4. **Strategy whitelist mechanism** — `public_visible BOOLEAN` column on `evolution_strategies` (recommended) or static allowlist constant in code? Column gives ops the lever to add/remove without a deploy.

5. **Rate-limit primitive** — DB-table token bucket (zero new infra) or Upstash KV (Vercel-native, new env var + new dependency)? Recommend DB-table — fits the codebase pattern.

6. **Cost guardrail** — what's the right per-run cap for public users? Current `evolution_daily_cap_usd=$25` shared envelope, suggested per-run cap $0.10 = 250 runs/day at the cap. Need user opinion.

7. **Guest auto-login vs explicit account** — Reuse the existing guest-auto-login pattern (anyone hitting the page is auto-signed-in as the demo guest) or require Supabase sign-up before running? Guest is friction-free; sign-up makes per-user caps meaningful.

8. **Should we backfill the admin-path `explanationId` validation** in the same PR, or leave the gap for a follow-up?

9. **Visible cost / runtime preview** — Should the strategy picker show estimated cost + expected runtime per strategy, so users understand the trade-off? Existing `estimateAgentCost` / `projectDispatchPlan` already produce this for admin wizard previews — could reuse for the public UI.

10. **What happens to user runs after they finish** — kept in DB forever (rich dataset), purged on a TTL, or deleted on demand via a "delete this run" link? Privacy stance TBD.
