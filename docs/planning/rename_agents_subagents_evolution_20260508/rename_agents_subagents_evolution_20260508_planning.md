# rename_agents_subagents_evolution_20260508 Plan

## Background
I want to figure out a better way to surface agent invocations between individual agents, and their groupings of "subagents". E.g. generateFroMPreviousArticle includes generation and ranking, reflection agent includes generateFromPreviousArticle, etc

## Requirements (from GH Issue #NNN)
I want to figure out a better way to surface agent invocations between individual agents, and their groupings of "subagents". E.g. generateFroMPreviousArticle includes generation and ranking, reflection agent includes generateFromPreviousArticle, etc

## Problem
Wrapper agents (Reflect+Gen, EvalCriteria+Gen, ProposerApprover, IterativeEditing) collapse 3–15+ inner LLM calls plus deterministic steps into a single `evolution_agent_invocations` row whose hierarchy is buried in `execution_detail` JSONB. Researchers see a flat list and can't tell that one Reflect+Gen invocation actually performed reflection + inner generation + N ranking comparisons. The same opacity exists for metrics (per-purpose costs aggregate by AgentName label, not by parent agent class) and logs (`phaseName` is flat). We want to expose the implicit nesting as a first-class **agent → subagent** model — recursively, with explicit levels — without breaking the load-bearing `.execute()` cost-scope invariant or migrating the JSONB column.

## Options Considered

- [x] **Option A: JSONB-derived (chosen).** Read existing `execution_detail` + `llmCallTracking` rows, build the tree at render time, write per-subagent metric rows at finalization. No DB schema change for the tree. See research doc § "Decision: Keep JSONB as the source of truth".
- [ ] **Option B: Additive `evolution_invocation_phases` table alongside JSONB.** Display-only rows; JSONB stays authoritative. Deferred — no current need beyond cross-invocation analytics; revisit if those become real demands.
- [ ] **Option C: Subagents table as authoritative; drop JSONB.** Rejected. Custom per-agent backfill, months of dual-write coexistence, velocity loss on the most-evolving area of the codebase, weakens cost-scope invariant. See research doc for full downside list.

## Decisions

- **Vocabulary**: an **agent** is one row in `evolution_agent_invocations` (one `Agent.run()`, one cost scope). A **subagent** is any sub-unit of work inside it. Recursive: a subagent can itself have subagents. Per the team decision "all agents can also be subagents", any Agent class can appear as a subagent of another invocation.
- **Levels**: derived at render time from path depth. L1 = the agent (the invocation row). L2+ = subagents. Same class can be L1 in one invocation and L2+ in another — level is relative to the tree root.
- **Subagent name** (the canonical identifier of a sub-unit): dotted-path string like `'reflection'`, `'generate_from_previous_article.ranking'`, `'cycle.1.propose'`. Stored as a single TEXT column; the API layer accepts either `string` or `string[]` for ergonomics, joining on write via the validating helper `joinSubagentPath()`.
- **Subagents tab is additive, not a replacement.** The bespoke per-wrapper tab layouts (Reflection Overview, Eval & Suggest, Edit Cycle, Apply, etc.) STAY because they contain domain-specific tables (criteriaScored, suggestions, forwardDecisions, mirrorDecisions, `annotated-edits` custom renderer for IterativeEditing) that a generic tree cannot reproduce. The Subagents tab adds the cross-cutting tree view alongside the existing detail panels.
- **Migration uses expand/contract (not RENAME COLUMN).** CI's `deploy-migrations` job blocks `RENAME COLUMN` via the destructive-DDL guardrail (`.github/workflows/ci.yml` allowlist). We therefore: (4a) ADD COLUMN `subagent_name` + dual-write trigger + view update; deploy code; (4b, follow-up project) DROP COLUMN `agent_name`. Provides natural rollback (revert code; trigger keeps `agent_name` populated).
- **`subagent:` metric prefix follows the existing dynamic-registry pattern.** Like `agentCost:` / `eloAttrDelta:` / `eloAttrDeltaHist:`, it lives in `DYNAMIC_METRIC_REGISTRY` and is handled by special code paths (`Entity.markParentMetricsStale`, `EntityMetricsTab` dynamic match, `isDynamicMetricName`) — not by adding ~84 entries to `SHARED_PROPAGATION_DEFS`. Propagation is computed on read at the strategy/experiment level.
- **`agentCost:` prefix deprecation deferred to Phase 6.** `agentCost:<agentName>.cost` is a special case of `subagent:<name>.cost` when path is single-segment. Phase 6 stops writing `agentCost:*`, points readers at `subagent:*`, hard-deletes the registry entry in a follow-up project.
- **Bundled cleanups**: soft-deprecate `iterative_edit_rank_cost` (superseded by `subagent:ranking.cost`); widen `getRunCostWithFallback.ts` Layer 2 to `SUM(subagent:*.cost)`.

## Phased Execution Plan

### Phase 1: OTel parent-span hierarchy patch

- [x] Add `withActiveSpan(name: string, attrs: Record<string, unknown>, fn: (span: Span) => Promise<T>)` helper to `instrumentation.ts` (repo root, alongside the existing `createLLMSpan`/`createDBSpan`/`createAppSpan` helpers). The codebase currently exposes only passive `tracer.startSpan` wrappers; these do NOT set the span as active so child spans don't auto-nest. The new helper wraps `tracer.startActiveSpan` and relies on `AsyncLocalStorageContextManager` (already configured by Sentry's OTel exporter) to propagate context across `await` boundaries.
- [x] **FAST_DEV branch**: when `appTracer === null` (FAST_DEV mode), `withActiveSpan` returns `fn(noopSpan)` without invoking `tracer.startActiveSpan`. Mirrors existing `if (!appTracer) return noopSpan;` pattern in `createLLMSpan`/`createDBSpan`. Without this branch, every test running under FAST_DEV=true would throw at the first wrapper invocation.
- [x] In `evolution/src/lib/core/Agent.ts`, wrap the `execute()` call inside `Agent.run()` with `withActiveSpan('agent.<name>', { 'subagent.path': '<name>' }, async () => execute(...))`.
- [x] In `createEvolutionLLMClient.ts`, switch each `complete()` call from passive `createLLMSpan` to a child of the currently-active span: open a span named `subagent.<label>` with attribute `subagent.path: '<parentPath>.<label>'`. Children auto-nest under the agent's active span via `AsyncLocalStorage`.
- [x] Document the parallel-context invariant in a comment near the new helper: under `Promise.allSettled` with multiple sibling agents, each callback gets its own `AsyncLocalStorage` slot and sibling spans do NOT pollute each other. Span context is per-microtask-chain.
- [x] Add invariant test in the existing wrapper-invariant test files (e.g. `reflectAndGenerateFromPreviousArticle.invariants.test.ts`) asserting that `costScope.getOwnSpent()` is unchanged whether `withActiveSpan` is enabled or not — guards a future regression where someone moves cost recording into the span lifecycle.
- [x] Verify in Honeycomb: a wrapper invocation now shows nested spans (Reflect+Gen → reflection LLM, GFPA → generation LLM, GFPA → ranking → N comparisons), and span filter `subagent.path:cycle.*` returns IterativeEditing cycle work.
- [x] Check Sentry-OTel daily span budget against the projected span volume (IterativeEditing × 5 cycles × ~5 LLM calls = 25–50 spans/invocation). Add sampling config if needed.

### Phase 2: Subagents tab on invocation detail

- [x] Add shared parser module `evolution/src/lib/shared/subagentTreeParser.ts`. Exports one parser per `detailType`: `parseGenerateFromPreviousArticleTree`, `parseReflectAndGenerateTree`, `parseEvaluateCriteriaThenGenerateTree`, `parseSinglePassEvaluateCriteriaTree`, `parseProposerApproverCriteriaTree`, `parseIterativeEditingTree`, `parseSwissRankingTree`, `parseMergeRatingsTree`, `parseCreateSeedArticleTree`. Each takes `(invocation, llmCalls)` → `SubagentNode[]`. **Single source of truth**: consumed by BOTH the UI tree builder (Phase 2) AND the backfill script (Phase 3) to prevent drift.
- [x] Add tree-builder façade `evolution/src/lib/shared/buildSubagentTree.ts` (file lives in `shared/`, NOT `metrics/` — reads schema + DB layer, consumed by UI). Dispatches by `agent_name` to the appropriate parser. Returns `SubagentNode[]`.
- [x] Define `SubagentNode` type: `{ name: string; path: string[]; level: number; kind: 'LLM' | 'Composite' | 'Deterministic'; durationMs: number; costUsd: number; llmCallCount: number; summary?: string; children: SubagentNode[]; bespokeDetail?: { configKey: string; data: unknown } }`. The `bespokeDetail` field carries the existing per-agent `DETAIL_VIEW_CONFIGS` slice + data (e.g. `tacticRanking` table for reflection, `forwardDecisions` for proposer-approver).
- [x] Add `<SubagentNode>` recursive React component (chevron, level pill, name, kind tag, duration, cost, summary line). When the row's `bespokeDetail` is present, expanding the row reveals the existing `ConfigDrivenDetailRenderer` slice — preserves criteriaScored / suggestions / forwardDecisions / mirrorDecisions / `annotated-edits` rendering exactly as today.
- [x] Add new `Subagents` tab to `InvocationDetailContent.tsx`. Show as default tab. **Keep the existing bespoke per-wrapper tabs** (Reflection Overview, Generation Overview, Eval & Suggest, Edit Cycle, Apply, etc.) — they remain available alongside the tree.
- [x] Add a per-subagent log affordance in the Subagents tab (e.g. `[↳ N logs]` link on each subagent row) that opens the Logs tab pre-filtered by that subagent's path prefix.
- [x] Implement render-time validation hook: an L1 row's totals = recursive sum of its children, with float tolerance ε = 0.0001 USD / 1 ms. On mismatch, log `console.warn` in dev only (not production); never block render.

### Phase 3: Subagent metrics (dynamic prefix `subagent:`)

**Architectural note:** `subagent:*` metrics need rows at three entity levels — run, strategy, experiment — to support the cross-strategy analytics promised in the wireframes ("Cost per subagent name, per strategy"). Three relevant facts about the existing codebase:

1. There is NO automatic invocation→run, run→strategy, or run→experiment propagation for dynamic-prefix metrics. `InvocationEntity.atPropagation = []`. `propagateMetrics()` only handles static `atPropagation` defs in `SHARED_PROPAGATION_DEFS`. `aggregateMetrics()` in `experimentMetrics.ts` is an in-memory bootstrap-CI helper with NO production callers (only test files import it).
2. `EntityMetricsTab.tsx:dynamicMatch()` resolves formatter/label/category for dynamic prefixes — it does NOT aggregate across entity levels.
3. The only working multi-level dynamic-prefix metric (`eloAttrDelta:*`) achieves run+strategy+experiment writes by EXPLICITLY calling `writeMetric()` three times inside `computeEloAttributionMetrics`, keyed by `opts.strategyId` / `opts.experimentId`.

We mirror `eloAttrDelta:*`'s **per-level write structure** (3 explicit `writeMetric*` calls keyed on `opts.strategyId` / `opts.experimentId`), but we **substitute `writeMetricMax` for `writeMetric`**. Rationale: `eloAttrDelta:*` values are signed Elo deltas where re-finalization should overwrite (a recomputed delta is the new truth); `subagent:*` values are monotone-up cost/duration/count where backfill and live finalization can race, and GREATEST guarantees the larger value wins so a partial backfill never zeros out a real number. The per-level call structure is identical to `computeEloAttributionMetrics` at `experimentMetrics.ts:554-559` and `:587-593`; only the primitive differs.

`subagent:*` values are scalar (cost, duration, count) with no uncertainty / CI / aggregation_method — `writeMetricMax`'s 6-param signature `(db, entityType, entityId, metricName, value, timing)` matches exactly. The 7th `opts` argument used by `writeMetric` for `eloAttrDelta:*` (uncertainty/CI/n) is not needed here and should not be passed.

`writeMetricMax`'s GREATEST-on-conflict semantics correctly handle: (a) repeated finalizations of the same run; (b) multiple runs in the same strategy/experiment writing concurrently (later runs overwrite if their value is larger; smaller values are preserved). `writeMetricMax` also hard-throws on non-finite values via its `Number.isFinite` gate — parsers MUST filter NaN/Infinity values before calling, never rely on `writeMetricMax` to "tolerate" them.

- [x] Register `subagent:` prefix in `DYNAMIC_METRIC_REGISTRY` (`evolution/src/lib/metrics/types.ts`) with formatter / category / labelSuffix conventions. Same registration shape as existing `agentCost:`, `eloAttrDelta:`, `eloAttrDeltaHist:` prefixes.
- [x] Extend the `DynamicMetricName` TS union at `evolution/src/lib/metrics/types.ts:109-114` with `` | `subagent:${string}` ``. Without this, every call site to `writeMetricMax(... 'subagent:reflection.cost' ...)` needs an `as MetricName` cast or fails typecheck.
- [x] At run finalization, in `evolution/src/lib/metrics/experimentMetrics.ts` alongside the existing `agentCost:*` block at line 352-368, add a new block that:
  - Reads all `evolution_agent_invocations` rows for the run + their `execution_detail` JSONB.
  - Dispatches each invocation through the appropriate parser from `evolution/src/lib/shared/subagentTreeParser.ts`.
  - Sums per-subagent across all invocations of the run.
  - Writes `subagent:<name>.cost`, `subagent:<name>.duration_ms`, `subagent:<name>.count` to `evolution_metrics` via **three** `writeMetricMax` calls each: one at `entity_type='run'`, one at `entity_type='strategy'` (when `opts.strategyId` set), one at `entity_type='experiment'` (when `opts.experimentId` set). Mirrors the per-level writes inside `computeEloAttributionMetrics` (currently at `experimentMetrics.ts:554-559` and `:587-593`).
- [x] Call site: this new block runs from the same orchestration path as `computeEloAttributionMetrics` — the `computeRunMetrics` function called from `evolution/src/lib/pipeline/finalize/persistRunResults.ts:491` (NOT `services/` — earlier wording was wrong). Pass `{ strategyId: run.strategy_id, experimentId: run.experiment_id ?? null }` per the existing convention.
- [x] Use `writeMetricMax` (the GREATEST-on-conflict primitive in `evolution/src/lib/metrics/writeMetrics.ts`), NOT plain `writeMetric` UPSERT. Reason: backfill and live finalization can race; GREATEST guarantees the larger value wins, mirroring how `generation_cost` / `ranking_cost` are written today.
- [x] Maintain explicit subagent-name allowlist (TS union, similar to `AgentName`) to prevent ghost metric rows from typos. Allowlist starts with: `reflection`, `generation`, `ranking`, `comparison`, `evaluate_and_suggest`, `cycle.propose`, `cycle.review`, `cycle.apply`, `drift_recovery`, `approve_forward`, `approve_mirror`, `seed_title`, `seed_article`.
- [x] Stale cascade: `mark_elo_metrics_stale()` and `Entity.markParentMetricsStale` iterate `DYNAMIC_METRIC_PREFIXES` to mark dynamic-prefix rows stale — adding `subagent:` to the registry auto-extends this cascade. No additional code needed for the cascade itself.
- [x] **`recomputeMetrics.ts:58` and `:73` REQUIRE a new arm** (verified by code inspection — the branches hard-code `n.startsWith('eloAttrDelta:') || n.startsWith('eloAttrDeltaHist:') || n.startsWith('agentCost:')` and do NOT iterate `DYNAMIC_METRIC_PREFIXES`). Add `|| n.startsWith('subagent:')` to both arms in this Phase 3, NOT deferred to Phase 6. Without this arm, stale `subagent:*` rows would never be recomputed after rating changes.
- [x] **Add a parallel kill-switch env var** `EVOLUTION_EMIT_SUBAGENT_METRICS` (default `'true'`). Gate the new write block at the same point that `EVOLUTION_EMIT_ATTRIBUTION_METRICS` gates `computeEloAttributionMetrics` in `persistRunResults.ts:489`. Reason: the new block lives inside `computeRunMetrics` alongside the existing `agentCost:` block and runs on the main metrics path BEFORE the attribution-metrics gate is consulted — without its own gate, ops cannot disable the new emission without code revert if it misbehaves.
- [x] Backfill script `evolution/scripts/backfillSubagentMetrics.ts`: imports parsers from `evolution/src/lib/shared/subagentTreeParser.ts` (same module the UI and finalize path use). Iterates every existing `evolution_runs` row (NOT every invocation — we write at run level), reads its invocations + JSONB, writes run-level `subagent:*` rows via `writeMetricMax` (idempotent + race-safe).
  - [x] Default `--dry-run` mode (prints what would be written without writing).
  - [x] Tolerates malformed JSONB rows: missing/null fields → metric not emitted (not zero); non-finite values (NaN/Infinity from legacy rows) → parser filters BEFORE calling `writeMetricMax` (which hard-throws on non-finite via `Number.isFinite` gate at `writeMetrics.ts:153`); parser failures → row skipped + log + continue (never block the whole backfill).
  - [x] Idempotency unit test: run the script twice on the same fixture; assert metric row counts unchanged after second run.
  - [ ] **Partial-failure recovery test**: pre-seed half the expected `subagent:*` rows for a run (simulating a previous interrupted backfill); run the script; assert all expected rows are now present AND pre-existing rows are not corrupted (writeMetricMax preserves max; backfill values match).
  - [ ] Parsers must handle every KNOWN historic JSONB shape variant — not just current shape. Add unit tests fixturing each historic shape (per the wrapper-evolution churn documented in research) so the backfill doesn't silently drop legacy rows.
  - [x] Backfill writes at all three entity levels (run + strategy + experiment) per run, mirroring the live finalization write path. Strategy/experiment-level rows are MAX-aggregated across runs — re-running backfill cannot regress a value that was correct.
  - [x] **Monotonic-up caveat**: GREATEST means once a too-high value is written, subsequent corrections with smaller values won't take effect. The contract: backfill is for filling missing rows, not for correcting prior values. If parser bugs are found post-backfill, a separate one-shot repair script using `writeMetric` (plain UPSERT) is required — explicitly out of scope for the backfill.
- [x] Run backfill on staging first; verify Subagent Costs view (Phase 2) is populated for historical runs; then run on prod. **Golden spot-check protocol** (catches silent parser drift):
  1. Pick one historic run per wrapper class: GFPA (leaf), Reflect+Gen (single inner agent), IterativeEditing (multi-cycle), ProposerApprover (mirror short-circuit edge case). Four runs total.
  2. For each: read `evolution_agent_invocations.execution_detail` JSONB + `llmCallTracking` rows joined by `evolution_invocation_id`.
  3. Hand-compute per-subagent cost sums by walking the parser's expected dispatch shape (e.g. for ReflectAndGenerate: `reflection.cost` = `execution_detail.reflection.cost`; `generation.cost` = `execution_detail.generation.cost`; `ranking.cost` = `execution_detail.ranking.cost`; `comparison.cost` = sum of comparison-labeled `llmCallTracking.estimated_cost_usd`).
  4. Compare with `|actual - expected| ≤ 1e-4 USD` (matches the L1 sum-up tolerance).
  5. Sanity-bound assertion: `SUM(subagent:*.cost)` for the run ≤ `SUM(invocation.cost_usd)` + 1e-4. If exceeded, the parser is double-attributing.

### Phase 4: Logger rename — expand phase (`subagent_name` column added)

This is **Phase 4a** of an expand/contract migration. Phase 4b (DROP COLUMN `agent_name`) is a follow-up project, NOT bundled here.

- [x] Migration: `ALTER TABLE evolution_logs ADD COLUMN subagent_name TEXT`. (CI's destructive-DDL guardrail blocks RENAME COLUMN; ADD COLUMN is allowed.)
- [x] Migration: `BEFORE INSERT OR UPDATE OF agent_name, subagent_name` trigger on `evolution_logs` that:
  - mirrors `NEW.agent_name → NEW.subagent_name` when `NEW.subagent_name IS NULL` (covers historical INSERT path + UPDATEs that touch only `agent_name`)
  - mirrors `NEW.subagent_name → NEW.agent_name` when `NEW.agent_name IS NULL` (covers new code path + UPDATEs that touch only `subagent_name`)
  - The `INSERT OR UPDATE OF` clause matters: bare `BEFORE INSERT` would let UPDATE statements that touch one column desync the pair (operational tools, manual data corrections, future backfills). Pattern matches `20260415000001_evolution_is_test_content.sql:52`.
  - **Inline SQL comment** on the trigger body: `-- IS NULL gate: mirror only when target is NULL. UPDATEs that set both columns to non-null but DIFFERENT values intentionally leave them desynced — this is a NULL-mirroring trigger, not an equality enforcer. If equality is required after Phase 4b drops agent_name, that's a future CHECK constraint concern.` Future operators reading the migration in psql see the intent without cross-referencing the doc.
- [x] Migration: refresh the legacy `evolution_run_logs` view using DROP + CREATE (not `CREATE OR REPLACE VIEW ... SELECT *`). Postgres freezes the view's column list at creation time; recreating with `SELECT *` post-ADD-COLUMN can fail with `cannot change name of view column` or produce duplicate columns when combined with explicit aliases. Use:
  ```sql
  DROP VIEW IF EXISTS evolution_run_logs CASCADE;
  CREATE VIEW evolution_run_logs AS
    SELECT id, entity_type, entity_id, run_id, experiment_id, strategy_id,
           created_at, level, agent_name, subagent_name, iteration, variant_id,
           message, context
    FROM evolution_logs;
  ```
  Explicit column list documents the schema and avoids `*`-expansion surprises.
- [x] Backfill existing rows: `UPDATE evolution_logs SET subagent_name = agent_name WHERE subagent_name IS NULL`. One-shot batch UPDATE; no rollover concerns since the trigger covers new writes from this point.
- [x] Regenerate `src/lib/database.types.ts` (CI auto-handles via `generate-types` job after migration applies).
- [x] Add `joinSubagentPath(name: string | string[]): string | null` helper in `evolution/src/lib/pipeline/infra/createEntityLogger.ts`:
  - Empty array or empty string → return `null` (don't write garbage).
  - Non-string segments → coerce with `String(seg)` and emit `console.warn` (one-time per process, deduped by message).
  - Segments containing `.` → reject with warn-log (would corrupt prefix-LIKE queries).
  - Total joined length cap 200 chars; truncate with warn-log if exceeded.
- [x] Rename `EntityLogContext.phaseName` → `EntityLogContext.subagentName` (accepts `string | string[]`). At write time, normalize via `joinSubagentPath()` and write to BOTH `agent_name` and `subagent_name` columns explicitly during Phase 4a transition (belt + suspenders alongside the trigger).
- [x] Add `logger.child(name: string | string[])` ergonomic primitive. **Semantics**: returns a NEW `EntityLogger` instance with the path argument appended to the parent's path. **Pure in-memory**: does NOT write a DB row at construction. Safe inside hot loops (e.g. `for (const cmp of comparisons) { logger.child(['comparison', String(i)]).info(...) }` is just N object allocations, not N DB inserts).
- [x] Ship `logger.child` with `autoLifecycle: false` as the default; do not expose the option in this phase. Defer auto START/END event emission (one row at scope open, one at scope close) to a follow-up PR if post-Phase 2 usage feedback shows demand. Keeps log-row volume from doubling on day one.
- [x] Update `Agent.run()` to thread the per-agent subagent path via `ctx.logger.child(<agent.name>)` before passing context to inner `.execute()` calls. Add a one-line comment near the existing LOAD-BEARING INVARIANT comments stating: "tracer.startActiveSpan + logger.child wrap but do NOT replace the .execute() contract; cost scope is unaffected."
- [x] Update `createEvolutionLLMClient.ts` per-call logging to use `logger.child(<agentName label>)`.
- [x] Rename `V2CostTracker.getPhaseCosts()` → `getSubagentCosts()` and the internal `phaseCosts` field → `subagentCosts` (consistency; same semantic).
- [x] LogsTab UI: filter label "phase/agent name" → "subagent"; new path-prefix filter dropdown built from distinct `subagent_name` values. Dropdown values are deduped distinct prefixes (so `reflection` shown once even if both flat and dotted rows exist post-rollover).
- [x] Rename `getEntityLogsAction` filter param (`phaseName` / `agentName`) → `subagentName` for symmetry with the LogsTab UI rename. Server action and UI must stay in sync.
- [x] Add a "Subagent" column to LogsTab at run / experiment / strategy detail levels (not only invocation detail), displaying the dotted `subagent_name` path next to each row's message.
- [x] No log row backfill required: the one-shot `UPDATE` populates `subagent_name` for historical rows by mirroring `agent_name`. UI treats single-segment values as flat paths; dotted values as deeper paths. (Distinct from the Phase 3 metric backfill, which IS required.)
- [x] **Test fixture rename strategy**: simple flat values (`{ phaseName: 'reflection' }`) become `{ subagentName: 'reflection' }` (single-segment path, value unchanged). Wrapper-test fixtures designed to exercise the tree (e.g. testing that ReflectAndGenerate's logs contain reflection AND generation entries) should adopt dotted paths (`'reflect_and_generate.reflection'`, `'reflect_and_generate.generation'`) to validate Phase 1's path threading.
- [x] Update ~10 affected test files (per R4D inventory) following the strategy above.
- [x] Leave error-classification's `phase?: 'setup' | 'finalize' | ...` alone (different concept: pipeline-lifecycle phase, not log-emitter subagent).
- [x] Leave `evolution_agent_invocations.agent_name` and `evolution_variants.agent_name` alone (name the L1 agent class, already correct). Document this explicitly in the doc updates so readers don't mis-rename.
- [x] Leave `iterationConfig.agentType` alone (names the L1 dispatch type, already correct).

### Phase 5 (optional, deferred): Run Timeline multi-segment expand-rows
- [x] Pending Phase 2 reception: extend `TimelineTab.tsx` invocation rows so wrapper agents render multi-segment bars with chevron-to-reveal sub-rows. Same data source as Phase 2 (`buildSubagentTree`).

### Phase 6: Bundled metric cleanups (soft-deprecate, never hard delete in this project)

- [x] Soft-deprecate `iterative_edit_rank_cost`: stop writing it (search write sites in `IterativeEditingAgent` cost-tracking code), point readers at `subagent:ranking.cost` instead.
  - [x] Update `RunEntity.ts:55` reference.
  - [x] Update `ExperimentEntity.ts:68-72` references.
  - [x] Update `StrategyEntity.ts:84-88` references.
  - [x] Update `src/__tests__/e2e/specs/09-admin/admin-evolution-iterative-editing.spec.ts:292-299` to assert on `subagent:ranking.cost` instead of `iterative_edit_rank_cost`.
  - [ ] Leave the registry entry intact for one release; hard-delete from `registry.ts` / `metricCatalog.ts` / `types.ts` deferred to follow-up project.
- [x] Soft-deprecate `agentCost:` dynamic prefix in favor of `subagent:<name>.cost` (single-segment paths). Enumerated consumers:
  - [x] **Write site removal**: `evolution/src/lib/metrics/experimentMetrics.ts:366` — stop emitting `agentCost:<agentName>` rows. The new Phase 3 write at the same point emits `subagent:<name>.cost` instead.
  - [x] **Recompute branches**: `evolution/src/lib/metrics/recomputeMetrics.ts:58` and `:73` — both branches keyed on the `agentCost:` prefix; either drop them (if no surviving readers) or extend to also handle `subagent:<name>.cost` during the transition.
  - [x] **Read-side fallback**: `EntityMetricsTab.tsx:157` filters out `agentCost:*` from UI display today. Generalize the filter to also exclude `subagent:*` row at single-segment paths if they would be UI-noisy duplicates of `total_*_cost`. Or accept the duplication and note in metrics.md.
  - [ ] **Registry entry**: leave intact in `DYNAMIC_METRIC_REGISTRY` for one release; hard-delete deferred to follow-up project (alongside `iterative_edit_rank_cost`).
  - [x] **Read-side overlap window**: during the rollover, old runs have only `agentCost:*` rows; new runs have only `subagent:*` rows. Tighten the wording: `recomputeMetrics.ts:58` and `:73` must accept BOTH prefixes during the rollover (extend the existing branch arms, don't add new branches); the cascade in `Entity.ts:218-224` auto-extends to any registered prefix and needs no change.
  - [x] **Test files referencing `agentCost:*`**: enumerate updates required:
    - `evolution/src/lib/metrics/__tests__/registry.test.ts:69-70`
    - `evolution/src/lib/metrics/__tests__/dynamicMetricPrefix.test.ts:7-9`
    - `evolution/src/lib/metrics/__tests__/writeMetrics.test.ts:118-121`
    - `evolution/src/lib/metrics/__tests__/experimentMetrics.test.ts:204-205, 331-339`
    - `evolution/src/components/evolution/tabs/__tests__/EntityMetricsTab.test.tsx:177-195` (existing "filters out agentCost:* metrics" test)
- [x] Widen `getRunCostWithFallback.ts` Layer 2 fallback to `SUM(subagent:*.cost)` — single query, always correct, replaces the current 4-of-9-metric hand-written sum. **Sequencing:** ship Phase 3 + run backfill on prod + verify no run is missing `subagent:*` rows BEFORE shipping this Layer 2 widening. During the gap, a read on a pre-backfill run would yield a Layer-2 zero where it previously had `agentCost:*` rows. Layer 3 (`evolution_run_costs` view) correctly handles old runs and remains as a final fallback.

## Testing

### Unit Tests

**Phase 1 (OTel)**
- [x] `src/__tests__/instrumentation.test.ts` — assert `withActiveSpan` calls `tracer.startActiveSpan` with the correct name and attributes; assert FAST_DEV branch returns `fn(noopSpan)` without invoking the tracer when `appTracer === null`.
- [x] `src/__tests__/instrumentation.parallel.test.ts` — **parallel-context invariant**: run two `withActiveSpan` calls concurrently inside `Promise.allSettled`; spy `trace.getActiveSpan()` from inside each branch; assert each branch sees its own span context (sibling spans don't pollute each other via AsyncLocalStorage).
- [x] **Extend** existing `evolution/src/lib/core/agents/reflectAndGenerateFromPreviousArticle.invariants.test.ts`: `costScope.getOwnSpent()` unchanged when `withActiveSpan` is wrapped around `.execute()`.
- [x] **Extend** existing `evolution/src/lib/core/agents/editing/IterativeEditingAgent.invariants.test.ts` similarly.
- [x] **CREATE** new invariant test files (these don't exist on disk today):
  - [x] `evolution/src/lib/core/agents/evaluateCriteriaThenGenerateFromPreviousArticle.invariants.test.ts`
  - [x] `evolution/src/lib/core/agents/singlePassEvaluateCriteriaAndGenerate.invariants.test.ts`
  - [x] `evolution/src/lib/core/agents/proposerApproverCriteriaGenerate.invariants.test.ts`
  
  Each new file mirrors the existing two: assert `.execute()` not `.run()` invariant; assert cost-scope authority via `getOwnSpent()`; assert OTel span wrapping is observationally pure (cost unchanged with/without span).

**Phase 2 (tree builder + UI)**
- [x] `evolution/src/lib/shared/__tests__/subagentTreeParser.test.ts` — one test block per parser; covers each wrapper shape (GFPA leaf, ReflectAndGenerate, EvalCriteria+Gen, SinglePass, ProposerApprover with mirror short-circuit, ProposerApprover full mirror cycle, IterativeEditing 1-cycle, IterativeEditing 5-cycle, SwissRanking, MergeRatings, CreateSeedArticle). Snapshot-style assertions on the resulting `SubagentNode[]` tree shape.
- [x] `evolution/src/components/evolution/tabs/__tests__/SubagentsTab.test.tsx` — React Testing Library: render with depth-1 tree, depth-3 tree, depth-5 tree (IterativeEditing). Assert chevron expand/collapse, level pill rendering, sum-up validation hook.
- [x] `evolution/src/components/evolution/tabs/__tests__/SubagentNode.test.tsx` — `bespokeDetail` slot renders the existing `ConfigDrivenDetailRenderer` slice when present.

**Phase 3 (metrics)**
- [x] `evolution/src/lib/metrics/__tests__/dynamicPrefix.subagent.test.ts` — assert `subagent:` registered in `DYNAMIC_METRIC_REGISTRY`; assert formatter / category / labelSuffix correct; `isDynamicMetricName` matches `subagent:reflection.cost`. Add a TypeScript-level assertion that `DynamicMetricName` union accepts `subagent:` strings: `const _: DynamicMetricName = 'subagent:reflection.cost'` (locks in the union extension at types.ts:109-114).
- [x] **Allowlist enforcement at write path** (not just backfill): add a test in this same file (or a new `evolution/src/lib/metrics/__tests__/subagentAllowlist.test.ts`) asserting that the FINALIZE-time write path also rejects typo'd subagent names with a warn-log. Both backfill and live finalize use the same parsers + allowlist; both must enforce.
- [x] `evolution/scripts/__tests__/backfillSubagentMetrics.test.ts` — idempotency (run twice → same row count); malformed JSONB tolerance (NaN/Infinity in legacy rows); dry-run prints without writing; allowlist enforcement (typo'd subagent names rejected with warn).
- [x] `evolution/src/lib/metrics/__tests__/subagentPropagation.test.ts` — propagation-on-read at run / strategy / experiment level: `subagent:reflection.cost` invocation rows aggregate to a run-level total when read via `EntityMetricsTab` dynamic match.

**Phase 4 (logger / column)**
- [x] `evolution/src/lib/pipeline/infra/__tests__/joinSubagentPath.test.ts` — empty array → null; null/undefined elements rejected (NOT String()-coerced — would write literal `'null'`); non-flat / nested arrays rejected with warn; segments with `.` rejected with warn; whitespace-only segments rejected; length cap (200 chars) truncates with warn; warn-dedup behavior (calling 100x with same bad input emits exactly 1 `console.warn`); happy-path single-string and multi-segment join.
- [x] `evolution/src/lib/pipeline/infra/__tests__/createEntityLogger.test.ts` — `logger.child` extends path; child is a NEW instance; child does NOT write a DB row; chained children compose correctly.
- [x] `evolution/src/lib/pipeline/infra/__tests__/trackBudget.test.ts` — `getSubagentCosts()` returns same shape `getPhaseCosts()` did; field `subagentCosts` accumulates per-AgentName.
- [x] Update each of ~10 R4D-inventory test files following the fixture rename strategy.

**Phase 6 (cleanup)**
- [x] `evolution/src/lib/metrics/__tests__/iterativeEditRankCost.deprecation.test.ts` — assert no write sites remain; assert read sites point to `subagent:ranking.cost`.

### Integration Tests
- [x] `evolution/src/__tests__/integration/migration.expandColumn.integration.test.ts` — apply Phase 4a migration to a clean DB; assert:
  - ADD COLUMN succeeds.
  - View `evolution_run_logs` is dropped + recreated cleanly with the explicit column list (no duplicate-column error).
  - Trigger fires on INSERT: insert with only `agent_name` set → `subagent_name` mirrored. Insert with only `subagent_name` set → `agent_name` mirrored. Insert with both set (different values) → values preserved as-given (the `IS NULL` gate prevents overwriting either).
  - Trigger fires on UPDATE: insert with both set, then UPDATE only `agent_name` → `subagent_name` STAYS at original value (because the new `subagent_name` is not null, so the trigger does not mirror). Document this behavior; the test pins it.
  - Trigger fires on UPDATE clearing one column: insert with both set, then UPDATE setting `agent_name = NULL` → trigger mirrors `subagent_name → agent_name`. Symmetric for `subagent_name = NULL`.
  - One-shot backfill UPDATE populates `subagent_name` for pre-trigger rows.
  - View query `SELECT * FROM evolution_run_logs LIMIT 1` returns no error and includes both columns.
- [x] `evolution/src/__tests__/integration/runIterationLoop.subagentTree.integration.test.ts` — run a full evolution cycle for each wrapper (Reflect+Gen, EvalCriteria, ProposerApprover, IterativeEditing); after finalization, build the tree from the persisted invocation; assert structure matches expected shape.
- [x] `evolution/src/__tests__/integration/evolution-subagent-metrics-finalization.integration.test.ts` (kebab-case to match existing convention) — **end-to-end run-level write assertion**. Run a full evolution cycle through `claimAndExecuteRun` (NOT synthetic data setup); after finalization, query `evolution_metrics WHERE entity_type='run' AND metric_name LIKE 'subagent:%'`; assert the rows match the parser's per-subagent sums; assert `SUM(subagent:*.cost) ≤ invocation.cost_usd summed across the run's invocations + 1e-4 USD tolerance` (sanity bound). Parameterized per wrapper type.
- [x] `evolution/src/__tests__/integration/evolution-subagent-metrics-propagation.integration.test.ts` — assert the explicit 3-level write pattern from `experimentMetrics.ts`. Four cases:
  - **All opts set**: `computeRunMetrics(runId, db, { strategyId, experimentId })` → assert `subagent:reflection.cost` rows exist at run + strategy + experiment with matching values.
  - **No opts**: `computeRunMetrics(runId, db, {})` → assert ONLY the run-level row is written (no strategy/experiment rows).
  - **Partial opts (strategyId only)**: `computeRunMetrics(runId, db, { strategyId })` → assert run + strategy rows are written, NO experiment row.
  - **Partial opts (experimentId only)**: `computeRunMetrics(runId, db, { experimentId })` → assert run + experiment rows are written, NO strategy row.
  
  Catches bugs like flipping the per-level `if` conditions, AND-ing the gates, or duplicating one branch's payload to the other — none of which the all-set / none-set cases would catch.
- [x] `evolution/src/__tests__/integration/evolution-subagent-metrics-recompute.integration.test.ts` — locks in the `recomputeMetrics.ts:58/73` arm extension. Cases:
  - Cascade with `subagent:reflection.cost` in `claimedNames` → triggers `computeRunMetrics`.
  - Rollover case: cascade with both `agentCost:gfpa` AND `subagent:reflection.cost` → triggers exactly ONE `computeRunMetrics` call (no double-fire).
  - Post-Phase-6 case: cascade with only `subagent:reflection.cost` (after `agentCost:` removed) → still triggers `computeRunMetrics`.

### E2E Tests
- [x] `src/__tests__/e2e/specs/09-admin/admin-evolution-subagents.spec.ts` — new spec, `@evolution` tag. Scenarios:
  - [ ] Open invocation detail page for a `generate_from_previous_article` invocation → Subagents tab is default → tree shows L1 (GFPA) + L2 (generation, ranking) → expand ranking reveals L3 comparisons.
  - [ ] Open invocation detail for `reflect_and_generate_from_previous_article` → tree depth 4 (Reflect+Gen → reflection LLM, GFPA → generation, GFPA → ranking → N comparisons).
  - [ ] Open invocation detail for `iterative_editing` → tree shows multiple cycles as L2 children, each with propose/review/apply L3.
  - [ ] Open invocation detail for `proposer_approver_criteria_generate` with mirror short-circuit → tree shows aggregate decision.
  - [ ] Click `[↳ N logs]` on a subagent → Logs tab opens pre-filtered.
  - [ ] Bespoke per-wrapper tabs (Reflection Overview, Eval & Suggest, etc.) still present alongside Subagents tab.
- [x] Update `src/__tests__/e2e/specs/09-admin/admin-evolution-iterative-editing.spec.ts:292-299` — assert on `subagent:ranking.cost`. **Pin a non-zero numeric assertion**, not just a name swap. The risk: a Phase 6 PR that wires up readers to `subagent:ranking.cost` but the prefix isn't being written for IterativeEditing runs (parser bug, allowlist typo, missing write call) would pass a name-only swap but produce zero/null values in the UI. Assert: `expect(metric.value).toBeGreaterThan(0)` AND that the value matches the expected per-cycle ranking cost from the test fixture's IterativeEditing run.

### Manual Verification
- [x] After Phase 1 deploy: open Honeycomb, find a recent wrapper invocation, confirm nested span tree is visible.
- [x] After Phase 2 deploy: open `/admin/evolution/invocations/[id]` for one of each wrapper type; verify Subagents tab default; verify cost/duration sums match the L1 row's `cost_usd` and `duration_ms` columns.
- [x] After Phase 3 backfill: open `/admin/evolution/runs/[id]` Subagent Costs section; verify historical run shows non-zero `subagent:*` rows (proving backfill worked).
- [x] After Phase 4a deploy: query `SELECT agent_name, subagent_name FROM evolution_logs LIMIT 10` and confirm both columns populated; insert a row with only `subagent_name` set; verify trigger mirrors to `agent_name` (and vice versa).
- [x] After Phase 6 cleanup: confirm `iterative_edit_rank_cost` writes have stopped (`SELECT * FROM evolution_metrics WHERE metric_name = 'iterative_edit_rank_cost' AND created_at > NOW() - INTERVAL '1 hour'` returns empty); confirm `subagent:ranking.cost` populated for new IterativeEditing runs.

## Verification

### A) Playwright Verification (required for UI changes)
- [x] Run new spec: `npm run test:e2e -- src/__tests__/e2e/specs/09-admin/admin-evolution-subagents.spec.ts`
- [x] Run updated spec: `npm run test:e2e -- src/__tests__/e2e/specs/09-admin/admin-evolution-iterative-editing.spec.ts`
- [x] Critical-path screenshot regression on `/admin/evolution/invocations/[id]` for each wrapper type.

### B) Automated Tests
- [x] `npm run lint && npm run tsc && npm run build` — typecheck must pass after every phase (especially Phase 4 rename will touch many call sites).
- [x] `npm run test` — unit suites green.
- [x] `npm run test:integration` — local Supabase migrations applied; integration tests green.
- [x] `npm run test:e2e -- --grep '@evolution'` — all evolution E2E specs pass.
- [x] `evolution-startup-assertion-check` (per `ci.yml:352-353`) — registry / DB consistency check passes after Phase 6 deprecation.
- [x] CI's destructive-DDL guardrail: confirm Phase 4a migration uses `ADD COLUMN` (allowed) and not `RENAME COLUMN` (blocked).
- [x] Grep for residual `phaseName` / `agent_name` literal-string references in client code, URL query parsing, JSONB key access — block-list any remaining hits before Phase 4 ships.

### C) Coordinated deploy ordering
- [x] Phase 4a is one PR: migration + code rename + tests. Order in CI: `deploy-migrations` → `generate-types` → `typecheck`. CI auto-regenerates and auto-commits `database.types.ts`.
- [x] **Developer must NOT pre-regenerate types locally.** Commit only source changes (migration SQL + code rename + tests). Push to the PR branch. CI's `generate-types` job auto-commits `database.types.ts` to the PR branch. **Before any subsequent local push, `git fetch && git rebase origin/<branch>`** to incorporate CI's auto-commit. Without this rule, every iteration on Phase 4a triggers a non-fast-forward push (or worse, a force-push that overwrites CI's commit).
- [x] If your local `tsc` errors because the new column references don't exist in the auto-generated types yet, verify: (a) the migration SQL is in your push, (b) CI's `deploy-migrations` job ran successfully on your branch (not just staging), (c) `generate-types` ran after. The local `tsc` will pass once the auto-commit lands; do NOT manually edit `database.types.ts` to make local `tsc` happy.
- [x] Rollback plan: if Phase 4a fails on staging post-merge, revert the PR. The trigger keeps `agent_name` populated, so old code reading `agent_name` continues to work; new code writing `subagent_name` is the rolled-back portion. The `subagent_name` column itself stays (DROP COLUMN is a Phase 4b concern); idle column has near-zero cost.

## Documentation Updates

- [x] `evolution/docs/logging.md` — replace `phaseName` references with `subagentName`; document the dotted-path convention; document `logger.child()` ergonomic primitive (pure in-memory, returns new instance, no DB write at construction); reaffirm the existing "per-comparison detail goes in `execution_detail`, not in log rows" guideline (still applies at L4); document the column add `evolution_logs.subagent_name`; document the bidirectional dual-write trigger; flag that `evolution_logs.agent_name` is deprecated and slated for removal in a follow-up project (Phase 4b).
- [x] `evolution/docs/agents/overview.md` — where prose says "phase" referring to a log-emitter or per-LLM-call sub-unit, replace with "subagent". Leave alone where prose says "phase" referring to pipeline lifecycle stages (`'setup'`, `'finalize'`, etc.) — that's a different concept. Update wrapper-agent descriptions ("delegates to GFPA.execute()") to call out that delegated work appears as a subagent in the new tree view.
- [x] `evolution/docs/metrics.md` — document the new `subagent:*` dynamic prefix; document propagation-on-read at strategy/experiment level via the existing dynamic-prefix code path (NOT new SHARED_PROPAGATION_DEFS entries); note that `agentCost:*` is deprecated in favor of `subagent:<name>.cost`; note removal of dead `iterative_edit_rank_cost` and that `subagent:ranking.cost` supersedes it.
- [x] `evolution/docs/data_model.md` — document the column add `evolution_logs.subagent_name`; clarify that this column carries the dotted subagent path; document the bidirectional dual-write trigger; explicitly call out that `evolution_agent_invocations.agent_name` and `evolution_variants.agent_name` are intentionally kept as the L1 agent class name.
- [x] `evolution/docs/visualization.md` — document the new generic Subagents tab on invocation detail; explicitly note that bespoke per-wrapper tabs (Reflection Overview / Generation Overview / Eval & Suggest / Edit Cycle / Apply / etc.) are PRESERVED alongside the tree view (NOT replaced); document the per-subagent log affordance and the LogsTab subagent column / filter additions.
- [x] `evolution/docs/architecture.md` — add a paragraph in the agents section introducing the agent / subagent / level vocabulary and pointing to the new tree visualization.
- [x] `evolution/docs/curriculum.md` glossary — add entries for "Agent" (one invocation row, one cost scope), "Subagent" (recursive sub-unit of work), "Level" (depth in the tree relative to the L1 agent).

## Review & Discussion

### Iteration 1 (2026-05-09)

| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 3/5 | 5 |
| Architecture & Integration | 3/5 | 6 |
| Testing & CI/CD | 2/5 | 5 |

Critical gaps addressed in this revision:

- **CI blocks `RENAME COLUMN`** (T1, S2) → Phase 4 restructured as expand/contract migration: ADD COLUMN + bidirectional trigger + view update; DROP COLUMN deferred to follow-up project.
- **`tracer.startActiveSpan` not in codebase** (S4) → Phase 1 first bullet now adds `withActiveSpan` helper to `instrumentation.ts`.
- **`subagentName` shape unvalidated** (S5) → `joinSubagentPath()` helper added with explicit validation rules.
- **`iterative_edit_rank_cost` deletion misses 4 consumers** (S3) → Phase 6 restructured as soft-deprecate with explicit consumer updates; hard-delete deferred.
- **`evolution_run_logs` view will desync** (S1) → Phase 4 explicitly updates the view in the same migration.
- **Subagents tab can't replace bespoke layouts** (A1) → Decision documented; tab is additive; bespoke detail panels embed via `bespokeDetail` slot on each tree node.
- **Phase 3 propagation pattern wrong** (A2, A3) → Use existing `DYNAMIC_METRIC_REGISTRY` propagation-on-read path (matches `agentCost:` / `eloAttrDelta:`); reconcile with `agentCost:` via Phase 6 deprecation.
- **`logger.child()` semantics undefined** (A4) → Explicit semantics documented: pure in-memory, new instance, no DB write at construction, safe in hot loops.
- **Test fixture rename strategy missing** (A5) → Explicit strategy added in Phase 4.
- **Tree builder placement wrong + parser drift risk** (A6) → Tree builder moved to `lib/shared/`; shared parser module `subagentTreeParser.ts` consumed by both UI and backfill.
- **Testing / Verification sections empty** (T2, T3) → Populated with concrete test files per phase, including invariant tests, integration tests, E2E spec.
- **No rollback plan** (T4) → Verification § C documents expand/contract rollback path.
- **Coordinated deploy ordering unclear** (T5) → Verification § C documents PR ordering and CI sequencing.

### Iteration 2 (2026-05-09)

| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 3/5 | 3 |
| Architecture & Integration | 3/5 | 2 |
| Testing & CI/CD | 4/5 | 5 |

Critical gaps addressed in this revision:

- **`withActiveSpan` doesn't handle FAST_DEV** (S2.1) → Phase 1 adds explicit FAST_DEV branch returning `fn(noopSpan)`; mirrors existing `if (!appTracer)` no-op pattern.
- **Trigger only handles INSERT** (S2.2) → Phase 4a switches to `BEFORE INSERT OR UPDATE OF agent_name, subagent_name` — UPDATE statements no longer desync the pair.
- **`CREATE OR REPLACE VIEW ... SELECT *` will fail** (S2.3, T2.1) → Phase 4a uses `DROP VIEW IF EXISTS ... CASCADE; CREATE VIEW ...` with explicit column list.
- **Phase 3 propagation pattern architecturally unsound** (A2.1) → Restructured: `subagent:*` rows written at `entity_type='run'` (NOT invocation), matching the existing `agentCost:*` pattern in `experimentMetrics.ts:352-368`. Strategy/experiment rollups use existing `aggregateMetrics()` bootstrap path.
- **Phase 6 `agentCost:` deprecation underspecified** (A2.2) → Enumerated write site (`experimentMetrics.ts:366`), recompute branches (`recomputeMetrics.ts:58/73`), UI filter (`EntityMetricsTab.tsx:157`), registry entry, and read-side fallback during transition.
- **Invariant test files don't all exist** (T2.2) → Testing list now distinguishes "extend existing" (Reflect+Gen, IterativeEditing) from "CREATE new" (EvalCriteria, SinglePass, ProposerApprover) with explicit file paths.
- **Parallel-context test missing** (T2.3) → Added `instrumentation.parallel.test.ts` with `Promise.allSettled` + `trace.getActiveSpan()` spy.
- **Backfill partial-failure test missing** (T2.4) → Added pre-seed-half-then-converge test to backfill spec.
- **`generate-types` auto-commit race** (T2.5) → Verification § C now mandates "do NOT pre-regenerate types locally"; rebase after auto-commit lands.
- **`writeMetric` vs `writeMetricMax`** (minor) → Phase 3 explicitly uses `writeMetricMax` (GREATEST-on-conflict); race-safe with live finalization.
- **`joinSubagentPath()` edge cases** (minor) → Test list extended: null/undefined elements, nested arrays, whitespace-only, warn-dedup.
- **Historic JSONB shape variants in backfill** (minor) → Parsers must include unit tests covering each historic shape variant; test list updated.

### Iteration 3 (2026-05-09)

| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 3/5 | 1 |
| Architecture & Integration | 4/5 | 0 (minor only) |
| Testing & CI/CD | 4/5 | 2 |

Critical gaps addressed in this revision:

- **Phase 3 propagation reasoning factually wrong** (S3.1 / A3-minor) → Restructured: `aggregateMetrics()` is test-only and does NOT auto-propagate. Phase 3 now mirrors `eloAttrDelta:*` exactly — three explicit `writeMetricMax` calls per metric, one each at `entity_type='run'`, `'strategy'`, `'experiment'`, keyed on `opts.strategyId` / `opts.experimentId`. Propagation claim removed; explicit per-level write pattern documented with file:line citations to the existing `computeEloAttributionMetrics` analogue.
- **Missing run-level subagent metric integration test** (T3.1) → Added `runFinalization.subagentMetrics.integration.test.ts` — end-to-end run through `claimAndExecuteRun`, asserts run-level rows match parser sums and bound by invocation `cost_usd`. Updated `subagentMetrics.propagation.integration.test.ts` to assert the explicit 3-level write pattern + counter-test for opts gating.
- **`iterative_edit_rank_cost` E2E deprecation test structural-only** (T3.2) → Pinned to non-zero numeric assertion + value match against fixture expectation, not just metric-name swap.
- **Missing `DynamicMetricName` TS union extension** (A3-minor) → Phase 3 now explicitly extends the union at `types.ts:109-114` with `` `subagent:${string}` ``.
- **Wrong file path for finalize call site** (A3-minor) → Corrected to `evolution/src/lib/pipeline/finalize/persistRunResults.ts:491` (was `services/`).
- **`agentCost:` test files unenumerated** (A3-minor) → Phase 6 now lists 5 specific test files that reference `agentCost:*` and need updates.
- **Backfill monotonic-up caveat** (S3-minor) → Documented: GREATEST means too-high values can't be corrected by re-running backfill; corrections require a separate one-shot `writeMetric` repair script.
- **Backfill golden spot-check** (T3-minor) → Added: pick 3 historic runs, hand-compute, compare to backfill output.
- **Trigger UPDATE-both-set behavior documentation** (S3-minor) → Note added for `evolution/docs/data_model.md` to call out the IS NULL gate's mirroring-only semantics (not equality enforcement).

### Iteration 4 (2026-05-09)

| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 4/5 | 1 |
| Architecture & Integration | 5/5 | 0 |
| Testing & CI/CD | 4/5 | 0 (minor only) |

Critical / minor gaps addressed:

- **`writeMetricMax` vs `writeMetric` framing inconsistency** (S4.1) → "Mirror eloAttrDelta:* exactly" rephrased to "mirror per-level write structure, substituting `writeMetricMax` for `writeMetric`"; rationale documented (signed Elo deltas overwrite; monotone-up cost values use GREATEST). Explicit note that `subagent:*` values are scalar with no opts arg.
- **`EVOLUTION_EMIT_ATTRIBUTION_METRICS` doesn't cover new path** (S4-M1) → Added parallel `EVOLUTION_EMIT_SUBAGENT_METRICS` env-var kill switch.
- **`writeMetricMax` throws on non-finite** (S4-M2) → Wording tightened: parsers must filter NaN/Infinity BEFORE calling, never rely on `writeMetricMax` to "tolerate" them.
- **`recomputeMetrics.ts` arm REQUIRED, not "may need"** (S4-M3) → Made mandatory in Phase 3, not deferred.
- **Phase 6 fallback widening creates ordering dependency** (S4-M4) → Explicit sequencing note: ship Phase 3 + run backfill + verify before widening Layer 2.
- **SQL trigger comment** (S4-M5) → Added inline comment in trigger body explaining IS NULL gate semantics.
- **Integration test naming convention** (A4-M2) → Renamed `runFinalization.subagentMetrics.integration.test.ts` → `evolution-subagent-metrics-finalization.integration.test.ts` (kebab-case to match existing).
- **Propagation counter-test gap** (T4-M1) → Added partial-opts test cases ({strategyId only}, {experimentId only}) to lock in each per-level `if` gate independently.
- **Backfill golden spot-check non-actionable** (T4-M2) → Tightened to 5-step protocol with per-wrapper enumeration and `1e-4 USD` tolerance.
- **`recomputeMetrics` dual-prefix arm test missing** (T4-M3) → Added `evolution-subagent-metrics-recompute.integration.test.ts` covering cascade with subagent:, rollover with both prefixes (no double-fire), and post-Phase-6 cleanup case.
- **`DynamicMetricName` type-assert** (T4-M4) → Added explicit TS-level assertion in `dynamicPrefix.subagent.test.ts`.
- **Allowlist enforcement test scope** (T4-M5) → Clarified: enforced at BOTH write path (finalize) and backfill; both tested.

### Iteration 5 (2026-05-09) — CONSENSUS REACHED ✅

| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 5/5 | 0 |
| Architecture & Integration | 5/5 | 0 |
| Testing & CI/CD | 5/5 | 0 |

All three reviewers voted 5/5 with no critical gaps. Plan is ready for execution.

Minor polish items (not blocking; fold into the implementation PRs as caught):

- Kill-switch placement wording: tighten Phase 3 to "gate inside `computeRunMetrics` around the new write block" (covers both `persistRunResults.ts:489` AND `recomputeMetrics.ts:68` cascade call sites).
- Note that cascade marking (auto-extends via `DYNAMIC_METRIC_PREFIXES`) is independent from recompute reading (`recomputeMetrics.ts:58/73` arm).
- Consider shipping `EVOLUTION_EMIT_SUBAGENT_METRICS` default `'false'` for one release window for staging soak before flipping to `'true'`.
- Optionally rename `migration.expandColumn.integration.test.ts` and `runIterationLoop.subagentTree.integration.test.ts` to kebab-case for full naming consistency.
- Add one more worked example to the backfill golden spot-check protocol — ProposerApprover mirror short-circuit edge case.
- Specify the observation mechanism for the "exactly ONE computeRunMetrics call" assertion in the recompute rollover test (e.g. `vi.spyOn`).
- Add an explicit kill-switch test pinning `EVOLUTION_EMIT_SUBAGENT_METRICS=false` skips the write block.
- Resolve the allowlist write-path test location ambiguity (pick `dynamicPrefix.subagent.test.ts` OR new `subagentAllowlist.test.ts`).
