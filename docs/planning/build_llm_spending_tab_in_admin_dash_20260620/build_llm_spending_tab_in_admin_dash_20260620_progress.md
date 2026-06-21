# Build LLM Spending Tab In Admin Dash Progress

## Phase 1: Audit current cost-data integrity
### Work Done
- Ran staging `llmCallTracking` audit (80,080 rows) via `npm run query:staging`. Findings in `_research.md` Key Findings.
- **Nulls negligible** (38 null cost, 1 null model). **Empty-string `model` = 72,309 rows (90%), $123.78** — dominated by integration-test mock pollution (round 100/200 token fixtures, "Unexpected call" content) whose fake cost is inflated by the unknown-model fallback pricing ($10/$30 per 1M).
- Confirmed test pollution in `has_model` bucket too: `evolution_generation_agent`/`evolution_evaluation_agent` = $53.61 on test user `…099` at impossible $0.50/call (Feb 2026 legacy).
- Confirmed `call_source` is the clean attribution dimension (~30 distinct, `evolution_` prefix splits cleanly).
- Explore agent mapped exact insertion points in `costAnalytics.ts`, `costs/page.tsx`, `llms.ts`, `schemas.ts`, and the cost views/rollups (file:line in `_research.md`).

### Issues Encountered
- **Production audit blocked** by the auto-mode classifier (`npm run query:prod` needs explicit user approval). Prod is where real spend lives (no test pollution) — flagged as Open Question #1; pending user approval.

### User Clarifications
- Pending: prod-access approval, requirement re-scoping ("none are null" → "exclude test-mock + normalize empty model"), test/mock discriminator approach, entity dimension (code map vs column), dashboard default (real-spend-only). See `_research.md` Open Questions.

## Phase 2: Mandatory attribution system + is_test — DONE
### Work Done
- `src/lib/services/llmCallSource.ts`: branded `CallSource`, `CALL_SOURCES` registry (21 sources), `evolutionSource`/`testSource` factories, `captureCallerName`. `EvolutionAgent = AgentName` via `import type`.
- `src/lib/services/llmCostAttribution.ts`: `attributeCallSource`, `isTestLlmCall`, `TEST_USER_IDS`, exhaustive `ENTITY_BY_SOURCE`.
- `llms.ts`: `call_source: string → CallSource` on all 4 signatures; Layer-2 runtime guard (throws in non-prod, `unattributed:<caller>` in prod); `is_test` derived at the `saveLlmCallTracking` chokepoint. `schemas.ts` + `database.types.ts` updated.
- Migrated ~25 call sites to `CALL_SOURCES.*`/`evolutionSource`; `importArticle` URL dropped from the key (bounded cardinality). Test files use `testSource(...)`. `oneshotGenerator.trackLLMCall` sets `is_test=true` (known-uncovered direct insert).
- Migration `20260620000001_llm_tracking_is_test.sql` (idempotent; index). Blocking ESLint rule `require-llm-call-source` + RuleTester. `scripts/backfillLlmIsTest.ts` (dry-run default, delegates to `isTestLlmCall`).
- Unit tests: `llmCallSource.test.ts`, `llmCostAttribution.test.ts` (incl. exhaustiveness).

### Issues Encountered
- Initial `CALL_SOURCE_SHAPE` regex rejected `stream-chat-api` (hyphens) — broadened to allow hyphens; caught by the unit test before it could mis-flag a real source as unattributed.

## Phase 3: Aggregation layer — DONE
### Work Done
- Migration `20260620000002_get_llm_spend_buckets.sql`: SECURITY DEFINER, `search_path=public`, REVOKE/GRANT service_role, in-function granularity whitelist; one RPC covers hour/day/week.
- `costAnalytics.ts`: `getSpendByGranularityAction`, `getCostByEntityAction`, `getEvolutionReconciliationAction`; `CostFilters` += `granularity`/`includeTest`. `database.types.ts` RPC type. +6 unit tests (incl. invalid-granularity reject, includeTest passthrough, reconciliation).

## Phase 4: Dashboard UI — DONE
### Work Done
- `costs/page.tsx`: tabbed (Overview/By Entity/By Model/Controls) + granularity toggle + include-test toggle + stacked evolution/non-evolution chart + entity table + audit-gap banner + `data-testid`s.
- `admin-llm-spending.spec.ts` (@evolution, serial, seeds known is_test rows, afterAll cleanup).
- `evolution-llm-cost-attribution.integration.test.ts` (chokepoint is_test + RPC aggregation/filter + invalid-granularity; evolution- prefix + RPC-exists skip guard).

## Final checks — DONE
- lint ✓ (new blocking rule passes codebase-wide; stale-specs clean) · tsc ✓ (0) · build ✓ · unit ✓ (7517 pass, fixed importArticle assertion) · ESM ✓ (156) · migration idempotency lint ✓ (both files).
- `migration:verify` could not run locally past the pre-existing 2025 migration (`role "anon" does not exist` — ephemeral DB lacks Supabase roles); not introduced by this work. Integration + E2E run in CI after `deploy-migrations` applies the new migrations to staging (both have skip/seed guards).
- Docs updated: `admin_panel.md`, `cost_optimization.md`, `testing_overview.md` (enforcement table).
