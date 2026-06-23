# sweep_evolutioN_for_bugs_20260623 Research

## Problem Statement
Find 100 bugs in the evolution codebase by reading source, re-check them to verify they are bugs, then fix all critical, high and medium bugs.

## Requirements (from GH Issue #1262)
find 100 bugs on evolution by reading codebase, re-check them to verify-they are bugs, then fix all critical, high and medium bugs

## High Level Summary

Evolution is a config-driven V2 pipeline (generate → rank → evolve) running on per-prompt strategies, with three layered budgets (run/iter/global), an Elo-based rating system (`{elo, uncertainty}` public; `{mu, sigma}` DB-internal), a cross-run arena, criteria-driven editing agents, paragraph-recombine + coherence-pass agents, and a minicomputer queue runner. The bug-hunt surface is dominated by:
- **Cost tracking** (fail-closed per-call writes; 402 still swallowed as TIE in `rankSingleVariant.ts`; paragraph_recombine projector under-projects ~50%).
- **Variant generation** (D1-D5 hardening invariants — non-thrown failures, top-up runaway, all_generations_failed, 402 cascade, max_output_tokens cap).
- **Concurrency** (per-slot `AgentCostScope` isolation, `rankNewVariant` local-map mutation, atomic `lock_stale_metrics` RPC).
- **Schema/DB** (RLS deny-all, arena FKs dropped → app-layer enforced, claim_evolution_run test-content gate).
- **Known TODOs** (diversityHistory not implemented, watchdog not wired into batch runner, dual metric registry hand-synced).

## Documents Read

### Standard docs
- `/docs/docs_overall/getting_started.md`
- `/docs/docs_overall/project_workflow.md`
- `/docs/docs_overall/architecture.md`
- `/docs/docs_overall/testing_overview.md`

### Evolution docs (28 files, summarized via research agent)
- `evolution/docs/README.md`
- `evolution/docs/architecture.md`
- `evolution/docs/arena.md`
- `evolution/docs/cost_optimization.md`
- `evolution/docs/criteria_agents.md`
- `evolution/docs/curriculum.md`
- `evolution/docs/data_model.md`
- `evolution/docs/editing_agents.md`
- `evolution/docs/entities.md`
- `evolution/docs/evolution_metrics.md`
- `evolution/docs/implicit_rubric_weights.md`
- `evolution/docs/logging.md`
- `evolution/docs/metrics.md`
- `evolution/docs/minicomputer_deployment.md`
- `evolution/docs/multi_iteration_strategies.md`
- `evolution/docs/paragraph_recombine.md`
- `evolution/docs/paragraph_recombine_with_coherence_pass.md`
- `evolution/docs/prompt_editor.md`
- `evolution/docs/rating_and_comparison.md`
- `evolution/docs/reference.md`
- `evolution/docs/strategies_and_experiments.md`
- `evolution/docs/variant_lineage.md`
- `evolution/docs/visualization.md`
- `evolution/docs/agents/overview.md`

## Code Files Read
- (Inventory in progress — see _planning.md Phase 2 fan-out plan)

## Bug-Hunt Surface Map (by subsystem)

### Variant generation
- D1 non-thrown failure path: `Agent.run()` MUST compute `isFailure = detailInvalid || output.failure !== undefined`. Regressions hide 100% failures as success.
- D2 top-up runaway: requires `MAX_CONSECUTIVE_GEN_FAILURES=3` break AND parallel-batch zero-variants guard. `parallelSuccesses` must count REAL variants, not `cost>0`.
- Format validation `reject` mode silently discards — no retry — generation may produce 0 variants.
- `evolveVariants` runs SEQUENTIALLY (no partial-results wrapping) — first-mutation-then-budget loses variants.
- `generationGuidance` percentages must sum to 100.
- `tactic === 'criteria_driven' && customPrompt===undefined` throws (wiring-bug guard).

### Arena rating
- `loadArenaEntries` swallows query failures (returns empty, no throw); silent failure → run proceeds without arena calibrators.
- `dbToRating`/`ratingToDb` is the ONLY DB-boundary helper; bypassing causes mu/sigma corruption.
- `sync_to_arena` writes `parent_variant_ids` ONLY on INSERT; ON CONFLICT preserves first write — finalize-order matters.
- Arena comparisons have NO DB FK on `entry_a/b` (app-layer cleanup only via `VariantEntity.ts`).

### Criteria agents
- `validateCriteriaIds` must run before `createStrategyAction` persist (else dispatch hits missing rows).
- Propose-approve aggregator strict-binary — only `(accept, reject)` applies.
- Mirror short-circuit ONLY on forward-accepted groups.
- A' format invalid drops ALL forward-accepted groups.
- Per-purpose model routing cascade `approverModel → editingModel → generationModel` (foot-gun if all unset → same cheap model rubber-stamps).
- `disableApproverFiltering: true` valid only on `iterative_editing_rewrite`.
- `EVOLUTION_PERMISSIVE_EVAL_PARSER='false'` reverts strict null-check.

### Paragraph recombine
- Per-slot `AgentCostScope` REQUIRED (parallel sharing corrupts attribution).
- `rankNewVariant` MUTATES local maps — must NOT be called concurrently within a slot.
- Phase costs must be RUN-CUMULATIVE for `writeMetricMax` safety (Phase 12; `EVOLUTION_RUN_CUMULATIVE_PHASE_COSTS_ENABLED='false'` reverts).
- Paragraph variants `persisted=false` BY DESIGN — UI must gate on `isDiscardedGenerateVariant(persisted, variantKind)`; bare `persisted=false` misclassifies them.
- Attribution filter `.eq('variant_kind', 'article')` must remain or paragraph deltas pollute buckets.
- Lineage graph hard-filter on `variant_kind='article'` (orphan-node guard).
- Per-slot ranking uses `'paragraph_rank'` AgentName (must be forced temp 0).
- Sequential `priorPicks` MUST pass through `sanitizeForPriorContext` (REDACTS untrusted tag mirrors).
- Coordinator replan errors caught — must NEVER propagate to Phase B catch.
- Known issue: projector under-projects ~50%; per-slot ranking depth collapses 53-98% when rewrites drop.

### Coherence pass
- `slot_provenance_ratio_p25/p50` NOISY for REORDER/RESTRUCTURE (documented caveat, NOT compliance check).
- Pre-coherence budget gate 0.85×cap.
- `coherencePassEnabled=false` falls cap to $0.05.

### Prompt editor
- Pre-flight cap `$0.50` returns HTTP 402 (no LLM calls fire).
- Shares evolution daily budget category.
- Writes ZERO evolution-pipeline rows.
- Refusals return as text with `looksLikeRefusal` — NOT thrown.
- Must pass `null` (NOT undefined) for `setText`/`responseObj`/`responseObjName`.

### Cost tracking
- `reserve()` synchronous (parallel safety).
- `AgentCostScope.getOwnSpent()` authoritative; `getTotalSpent` REMOVED from scope type.
- Per-call write FAIL-CLOSED via `requireTracking` (post-2026-06-21).
- `is_test` derived from RUNTIME signals NOT userid.
- `EVOLUTION_MAX_OUTPUT_TOKENS=4096` cap applied ONLY to non-reasoning models.
- **402 in ranking still swallowed as confidence-0 TIE (`rankSingleVariant.ts`) — UNPATCHED SIBLING.**
- Spending gate fails CLOSED on DB unreachable.
- 1.3× margin can underestimate; overruns logged but NOT thrown.
- `BudgetExceededWithPartialResults` MUST be caught BEFORE `BudgetExceededError` (subclass-catch foot-gun).

### Logging/observability
- All DB writes fire-and-forget (errors swallowed); silent log loss under DB pressure.
- Invocation-scoped logger routes ONLY through per-invocation LLM client.
- `subagent_name` dotted path replaced legacy `agent_name` (don't reintroduce).
- Attribution metrics propagate stale-flagged but NO runtime recompute path (eventually-consistent).
- `EVOLUTION_EMIT_ATTRIBUTION_METRICS='false'` kills attribution emission.

### Scheduling/runner
- Heartbeat 30s + 10min stale threshold.
- **Watchdog standalone, NOT WIRED into batch runner** (relies on RPC self-healing).
- Concurrent limit (default 5) checked BEFORE claim — race-tolerant via `SKIP LOCKED`.
- Clock-drift can prematurely stale-detect.
- Test-content gate (since 2026-06-21) blocks queue claims for `is_test_content=true` unless `allow_test_execution=true` or `targetRunId` provided.
- Old runner code REJECTS strategies with newer agentTypes — silent fail mode (forward-skew).
- OpenRouter credit exhaustion = arena_only/all_generations_failed fingerprint.

### DB schema/migrations
- Migrations forward-only.
- RLS deny-all default; `service_role` only write path.
- `evolution_arena_comparisons` FKs on `entry_a/b` DROPPED (app-layer integrity).
- `evolution_runs.strategy_id` NOT NULL.
- `claim_evolution_run` RPC concurrent cap server-side; test-content gate inside RPC.
- `mark_elo_metrics_stale` fires on `mu`/`sigma` change.
- `lock_stale_metrics` atomic claim-and-clear.
- `sync_to_arena` enforces 200-entry/1000-match caps.
- Strategy `config_hash` v2 prefix prevents v1/v2 collision.

### Agents (general)
- Wrapper invariants: I1 no nested `.run()`; I2 cost snapshots before each helper; I3 partial-detail-on-throw; I4 debate proxy.
- Each Agent class self-registers attribution extractor via side-effect — barrel `evolution/src/lib/core/agents/index.ts` MUST be imported.
- Detail-invalid → `success=false` + KEEPS valid detail (D1).
- Reflection uses `.execute()` not `.run()` (load-bearing for cost-scope unity).
- parseReflectionRanking NO deterministic fallback (parse failures are hard).
- Custom prompt length directive ±10% approximate.
- GFPA rejects `tactic='criteria_driven' && customPrompt===undefined`.
- IterativeEditing adjacency rule for `[#N]`-less Proposer dialect.
- Format validator can SILENTLY DISCARD outputs (no retry).

### Visualization
- Match Viewer rejudge uses PLAIN `callLLM` not evolution client (no metrics write).
- Runs-list `Spent` 4-layer fallback (rollup → 4-cost-sum → view → 0).
- `evolution_run_costs` view DROPPED (Layer 3 removed; relying on it errors silently).
- Auto-refresh polling pauses on tab hidden; pagination cap 200 (client 100).

### Minicomputer deployment
- `.env.local` + `.env.evolution-prod` MUST be `chmod 600`.
- NVM users MUST add nvm bin to systemd `Environment=PATH=`.
- After main merges affecting evolution code: manual `git pull --ff-only` required (no auto-pull).

### Known TODO / known-issue callouts
- `diversityHistory` declared but NOT implemented; `creative_exploration` NEVER FIRES (default 1.0).
- 402 in ranking still swallowed as TIE (`rankSingleVariant.ts`) — unfixed sibling of D5.
- Watchdog standalone, not wired into batch runner.
- Paragraph_recombine projector systematically under-projects ~50%.
- Dual metric registry (`METRIC_REGISTRY` + entity-class) hand-synced (parity test exists; consolidation pending).
- Coordinator replan cost NOT reflected in projector.
- LLMSpendingGate per-process cache divergence under burst load.
- V1 legacy code retained with `@ts-nocheck`.
- Historical `llmCallTracking` window 2026-02-23→2026-06-21 NOT backfillable.
