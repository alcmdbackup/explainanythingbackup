# Add Ranking to IterativeEditingAgent — Research

## Problem Statement

`IterativeEditingAgent` (just shipped via `bring_back_editing_agents_evolution_20260430`, PR #1020) deliberately decided in §14: *"editing emits ZERO `arena_comparisons` rows"*. The agent produces one final variant per parent but **never ranks it** against the pool. New editing variants land unranked; their first comparisons happen later (or never if editing is the terminal iteration). This project reverses §14 and adds local arena ranking, mirroring `GenerateFromPreviousArticleAgent`.

## Requirements (from user)

- Read the docs for iterative editing agent for evolution.
- Add ranking; follow the modular pattern of `generateFromPreviousArticle` and `reflectThenGenerateFromPreviousArticle`.
- Adjust all components of the agent, including invocation detail view, as needed.

## High-Level Summary

Four rounds of research (4 parallel agents per round = 16 agent investigations) confirm: **the path is mostly paved**. Almost everything we need is already a reusable free function or a one-line schema extension. The hard decisions are operational (flag rollout, cost shock, discard policy), not architectural.

Headline findings:

- **`rankNewVariant()` is reusable AS-IS** — pure-ish, no DB writes, uses the wrapper's existing `EvolutionLLMClient`. Drop it in after the cycle loop.
- **Insertion point is line 351** of `IterativeEditingAgent.ts` (after cycle loop, before final variant materialization).
- **`MergeRatingsAgent` already accepts `iterationType: 'iterative_editing'`** — widened in PR #1020. The dispatch in `runIterationLoop.ts` editing branch (~line 752–857) already calls it with empty `editingMatchBuffers: []`. Just need to populate.
- **`'ranking'` phase string is already in the cost-calibration CHECK constraint** (migration `20260501204142`). No new migration. No new TS phase enum entry. No new pre-deploy check.
- **Schema: copy `rankNewVariantDetailInnerSchema` verbatim** (it's already exported in `schemas.ts` and embedded by GFPA's detail). Add as optional/nullable for back-compat.
- **`IterativeEditInput` needs to be extended** with `initialPool`, `initialRatings`, `initialMatchCounts`, `cache`, `parentVariantId` — the agent currently has only `{ parent, perInvocationBudgetUsd }`. Mirror `GenerateFromPreviousInput`.
- **The detail-view renderer needs no changes** — it already handles `'object'` (nested children) and `'table'` (comparisons). Just add 2 new entries to `DETAIL_VIEW_CONFIGS['iterative_editing']` copying GFPA's ranking blocks.
- **Cost shock is real**: ranking adds 100–400% to per-invocation cost (judge calls dwarf nano-model edit calls). Default-OFF env flag + 50-strategy staging calibration is mandatory before prod flip.

## Documents Read

### Core docs
- `docs/docs_overall/getting_started.md`
- `docs/docs_overall/project_workflow.md`

### Auto-discovered + manually tracked
- `evolution/docs/rating_and_comparison.md` — Elo ratings, `rankSingleVariant` binary-search, two-phase orchestrator-driven ranking model
- `docs/feature_deep_dives/editing_agents.md` — current IterativeEditingAgent algorithm + Decisions §13–§18
- `evolution/docs/architecture.md` — V2 pipeline, iteration loop dispatch
- `evolution/docs/agents/overview.md` — Agent class details, `rankNewVariant()` patterns
- `evolution/docs/arena.md` — `arena_comparisons` schema and lifecycle

## Round 1 — Existing Landscape Map

### R1A1 — GFPA's ranking integration (`generateFromPreviousArticle.ts`)
- Ranking call site: line 235, after generation+format-validation succeeds.
- `rankNewVariant({ variant, localPool, localRatings, localMatchCounts, completedPairs, cache, llm, config, invocationId, logger, costTracker })` returns `{ rankingCost, rankResult, surfaced, discardReason }`.
- Cost: snapshot `costBefore = costTracker.getOwnSpent()` before, delta is `rankingCost`. Stored on `execution_detail.ranking.cost`.
- Surface/discard: `discard = rankResult.status === 'budget' && localElo < computeTop15Cutoff(localRatings)`. `surfaced` flag returned to orchestrator.
- Detail shape: full `rankNewVariantDetailInnerSchema` with `comparisons[]` array of 18-field records (round, opponentId, selectionScore, pWin, eloBefore/After, uncertaintyBefore/After, outcome, confidence, durationMs, top15CutoffAfter, eliminated, converged, eloPlusTwoUncertainty).
- Coupling: `rankNewVariant` is a free function. **REUSABLE AS-IS** — no refactor needed for new caller.

### R1A2 — Reflect-and-generate wrapper invariants
- File: `reflectAndGenerateFromPreviousArticle.ts:7–17` documents 3 LOAD-BEARING INVARIANTS: (I1) inner agent invoked via `.execute()` not `.run()`, (I2) `costBeforeReflection` snapshot before LLM call, (I3) partial detail written before re-throw.
- Inner GFPA dispatch: `await new GenerateFromPreviousArticleAgent().execute(innerInput, ctx)` at line 414 — passes through ctx for shared cost scope.
- Cost composition: wrapper recomputes `merged.totalCost = reflectionCost + gfpaDetail.totalCost` (line 446–459).
- Detail composition: copies `tactic`, `variantId`, `generation`, `ranking` from inner GFPA detail; embeds own `reflection` sub-object.
- Partial-detail-on-throw: lines 304–331 (reflection LLM throws), 415–437 (inner GFPA throws). Both write partial detail via `updateInvocation` BEFORE re-throwing.
- Test: `reflectAndGenerateFromPreviousArticle.invariants.test.ts` has 4 cost-attribution tests + 2 reservation-no-leak tests.

### R1A3 — IterativeEditingAgent current shape
- `execute()` skeleton: cycle loop lines 147–350; final variant materialization lines 352–361; **insertion point for ranking: between line 351 (loop end) and line 353 (`if (current.text !== input.parent.text)`)**.
- LOAD-BEARING INVARIANTS comment (lines 7–17): I1 use wrapper's `EvolutionLLMClient` directly, I2 capture `costBefore*Call` snapshots per LLM call, I3 write partial detail before re-throw.
- `IterativeEditInput` (types.ts:33): `{ parent: Variant, perInvocationBudgetUsd: number }`. **MISSING**: `initialPool`, `initialRatings`, `initialMatchCounts`, `cache`, `parentVariantId`.
- Execution detail today (schemas.ts:817–851): no `ranking` field; no `surfaced` field on detail (returned in `AgentOutput.result.surfaced`).
- Final-variant emit: line 375 `surfaced = finalVariant !== undefined && stopReason !== 'helper_threw'`. No discard logic exists today.
- Cost snapshots: per-cycle, per-purpose (proposeCostUsd, approveCostUsd, driftRecoveryCostUsd at cycle granularity). No top-level snapshot for the agent run.
- Invariant tests: `IterativeEditingAgent.invariants.test.ts` — 6 regex-based assertions on the source. Adding `rankNewVariant(...)` will NOT match the `\.run\s*\(/` regex (it's a free function, not a method).

### R1A4 — Shared ranking infrastructure inventory
| Item | File | Reusable? |
|---|---|---|
| `rankNewVariant` | `evolution/src/lib/pipeline/loop/rankNewVariant.ts:53` | **YES** — pure-ish, mutates input maps, no DB writes |
| `rankSingleVariant` | `evolution/src/lib/pipeline/loop/rankSingleVariant.ts:245` | **YES** — wrapped by `rankNewVariant` |
| `MergeRatingsAgent` | `evolution/src/lib/core/agents/MergeRatingsAgent.ts:93` | **YES** — already accepts `iterationType: 'iterative_editing'` (PR #1020 widening); writes `evolution_arena_comparisons` |
| `runIterationLoop.ts` editing branch | lines 752–857 | Currently `editingMatchBuffers: []` per §14; flip to populated |
| `computeRatings` API | `evolution/src/lib/shared/computeRatings.ts` | **YES** |
| `estimateRankingCost` | `evolution/src/lib/pipeline/infra/estimateCosts.ts:96` | **YES** |
| `computeTop15Cutoff` | `rankSingleVariant.ts:103` | **YES** — exported |
| `comparisonCache` threading | `runIterationLoop.ts:261` | **NEEDS REFACTOR** — editing branch doesn't currently receive it |

## Round 2 — Implementation Surfaces

### R2A1 — Schema/type edits (mechanical)
1. **`iterativeEditingExecutionDetailSchema`** (`schemas.ts:817–851`): add at end of `extend({})`:
   ```typescript
   ranking: z.preprocess(
     rankingDetailRenameKeys,
     rankNewVariantDetailInnerSchema.extend({
       cost: z.number().min(0),
       estimatedCost: z.number().min(0).optional(),
     }),
   ).nullable().optional(),
   ```
2. **`IterativeEditingExecutionDetail`** (`types.ts`): mirror with optional/nullable `ranking?` field.
3. **`iterativeEditingDetailFixture`** (`executionDetailFixtures.ts:28–145`): add realistic `ranking` block (1–2 comparisons with non-default Elo).
4. **`schemas.test.ts:1036–1082`**: extend the editing test case with the ranking block.
5. **`detailViewConfigs.ts:240–279`** (the `iterative_editing` entry): insert two new field entries (object+table) after annotated-edits, copying GFPA's `ranking` + `ranking.comparisons` blocks verbatim.

### R2A2 — Cost estimator + metric registry
1. **`estimateIterativeEditingCost`** (`estimateCosts.ts:312`): add `+ estimateRankingCost(articleChars, judgeModel, poolSize, maxComparisonsPerVariant)` to both `expected` and `upperBound`. The function already takes `judgeModel` as parameter.
2. **`estimateRankingCost`** (`estimateCosts.ts:96`): **reuse as-is**. Same `'ranking'` phase as GFPA — no new calibration rows needed.
3. **`EstPerAgentValue`** (`projectDispatchPlan.ts:91`): **add a new peer field `editingRank: number`**, mirroring how PR #1017 added `reflection` as a peer. Keeps editing cost legible: "$0.05 propose + $0.02 review + $2.16 ranking".
4. **`projectDispatchPlan.ts:367`** editing branch: populate `editingRank` from the new estimator delta.
5. **Metric registry**: add `iterative_edit_rank_cost` (live-written, mirroring `generation_cost`/`ranking_cost`/`reflection_cost`) plus 2 propagation metrics (`total_iterative_edit_rank_cost`, `avg_iterative_edit_rank_cost_per_run`).
6. **Phase enum**: NO change. Reuse `'ranking'` phase — already in CHECK constraint.

### R2A3 — Pipeline integration
1. **Extend `IterativeEditInput`** with `initialPool`, `initialRatings`, `initialMatchCounts`, `cache`, `parentVariantId`. Don't try to thread via `AgentContext` — the codebase pattern is to pass via input.
2. **Update `runIterationLoop.ts:814–817`** (editing dispatch site) to pass these fields, mirroring the generate-branch pattern (lines 513–522).
3. **Buffer collection**: change `editingMatchBuffers: []` (line 796) to collect each agent's `result.matches` and push as `MergeMatchEntry[]` (mirror generate-branch line 561).
4. **Per-iteration vs per-agent budget**: keep existing `perInvocationBudgetUsd` cap. Editing agent's pre-cycle abort check at `IterativeEditingAgent.ts:151` still works; ranking runs after cycles end, so `BudgetExceededError` from ranking will land in the existing outer try/catch and trigger I3 partial-detail-write.
5. **Variant-level uniqueness**: deferred — multiple parallel editing agents could rank against same opponents, producing duplicate `(variant_id, opponent_id, iteration)` rows. Edge case; flag for follow-up.

### R2A4 — Invocation detail UI
1. **`detailViewConfigs.ts:240–279`** (`iterative_editing` entry): insert ranking blocks BETWEEN the existing `cycles.0` annotated-edits entry and the `totalCost` field. Use literal copy of GFPA's `ranking` (object) + `ranking.comparisons` (table) entries.
2. **Renderer**: NO changes. `ConfigDrivenDetailRenderer.tsx` already handles `'object'` + `'table'` types.
3. **`IterativeEditingAgent.detailViewConfig`** field (the agent's own copy that must mirror DETAIL_VIEW_CONFIGS for the parity test): add the same ranking blocks.
4. **`buildDetail()` totalCost computation** (line 439–442): include `ranking.cost ?? 0` in the sum.
5. **UI integration test**: `evolution-iterative-editing-ui.integration.test.tsx` — add 3–4 new assertions covering the ranking object render + comparisons table headers.

## Round 3 — Test Surface

### R3A1 — Unit tests
- **GFPA test pattern**: `compareWithBiasMitigation` Jest mock with a comparison queue produces deterministic judge verdicts. Copy this mock into editing agent test.
- **`rankNewVariant.test.ts`** (11 cases): full lifecycle coverage — no need to retest, just consume.
- **`IterativeEditingAgent.test.ts`** new tests:
  - "ranking runs after cycle loop completes"
  - "ranking is skipped if all-rejected (no final variant)"
  - "rankingCost lands on top-level execution_detail.ranking.cost"
  - "discardReason populated when ranking returns surfaced=false"
- **`estimateCosts.test.ts`** new tests: editing estimator includes ranking delta; upperBound covers it.

### R3A2 — Integration tests
- **`evolution-iterative-editing-agent.integration.test.ts`**: extend mock-LLM `createV2MockLlm({ rankingResponses: ['A', 'A', 'A'] })`. Add assertion that editing-born variants have non-default Elo post-run.
- **`MergeRatingsAgent.test.ts`**: NEW test for `iterationType: 'iterative_editing'` with non-empty match buffers (currently a coverage gap).
- **`strategy-preview-dispatch.integration.test.ts`**: existing `expectedKeys.toEqual(['editing', 'gen', 'rank', 'reflection', 'total'])` will need to add `'editingRank'` (per R2A2's recommendation).
- **`evolution-startup-assertion-check.integration.test.ts`**: NO changes — `'ranking'` phase already in CHECK.

### R3A3 — E2E spec changes
- `admin-evolution-iterative-editing.spec.ts`:
  - **FLIP** the §14 assertion: "editing iteration emits ZERO arena_comparisons rows" → "emits ≥1 row per surfaced editing variant".
  - **ADD** assertions: editing-born variants have non-default Elo (mu != default), `iterative_edit_rank_cost` metric > 0.
  - Wizard tests: unaffected.
  - Timeout 360s: keep — ranking adds ~10–20s of judge calls per variant at nano speed.
- Update planning doc of `bring_back_editing_agents_evolution_20260430`: append "Decisions §14 superseded by add_ranking_iterative_editing_agent_evolution_20260502" note to keep history honest.

### R3A4 — Schema/fixture conformance
- **Fixture update**: add `ranking` block to `iterativeEditingDetailFixture` with realistic comparisons.
- **`entities.test.ts` count assertions** WILL FAIL on next run after we add `iterative_edit_rank_cost`. Bump expectations: 9→10 execution metrics, 35→36 propagation. (We surprised ourselves with similar bumps in the prior project — this is the safety net working.)
- **Agent.test.ts parity**: add a non-empty `detailViewConfig` assertion for IterativeEditingAgent (mirror existing GFPA/Swiss/MergeRatings tests).

## Round 4 — Risk & Decisions

### R4A1 — Cost & budget impact (REAL CONCERN)
- Editing-only upper-bound: ~$2.24 per invocation (3 cycles, 8K-char article, gpt-4.1-nano).
- Adding ranking: judge calls against pool=20, maxComp=15 → **+$5.48 per variant** (15×2 calls × ~$0.18 per nano-judge call).
- **Total per agent: $6.86 — a 396% bump.**
- Safety cap interaction: with `minBudgetAfterParallelAgentMultiple=2`, parallel dispatch count drops sharply. At $0.15 iter-budget today: 1 editing agent fits; with ranking: 0.
- **Recommendation**: gate behind `EDITING_RANK_ENABLED` env flag, default `'false'`. Mandatory 50-strategy staging calibration cycle before prod flip.
- **EstPerAgentValue**: add `editingRank` peer field (Option A). Mirrors how PR #1017 handled reflection. Keeps cost shock visible in dispatch UI.

### R4A2 — Surface/discard policy fit (DESIGN GAP)
- GFPA's policy: discard if `status === 'budget' && elo < top-15% cutoff`.
- Issues for editing:
  - Editing is 3× more expensive per invocation than generation; discarding wastes sunk cost.
  - First-cycle pool is tiny (often 1 parent); cutoff = parent elo, so any non-improvement gets discarded.
  - Decisions §14 in prior project is **silent** on discard policy.
- Options: (A) GFPA-like, (B) always surface, (C) discard only if Elo < parent Elo, (D) configurable.
- **For v1: Option B (always surface)**. Pool growth is bounded (~50–80 variants over 3 iterations). Add TODO to revisit Option C post-v1 when post-ranking elo is available at decision time.

### R4A3 — Invariant compatibility (ALL OK with one tweak)
| Invariant | Verdict |
|---|---|
| I1 (no nested .run()) | ✓ COMPATIBLE — `rankNewVariant(` is a free function; regex test passes |
| I2 (costBefore* snapshots) | ⚠ NEEDS schema field for `ranking.cost` at top level + `buildDetail` to include it in totalCost |
| I3 (partial-detail-on-throw) | ✓ COMPATIBLE — outer try/catch already handles |
| §13 (wrapper pattern) | ✓ |
| §14 (one-variant-per-invocation) | ✓ — still preserved; ranking doesn't change variant count |
| §15 (per-invocation budget) | ✓ — pre-cycle abort check still works; ranking errors caught by I3 |
| §16 (approverModel) | ✓ unaffected |
| §17 (size-ratio guardrail) | ✓ unaffected |
| §18 (migration order) | ✓ — reuses `'ranking'` phase, no migration |
| `*.invariants.test.ts` regex | ✓ — `rankNewVariant(` doesn't match `\.run\s*\(/` |

### R4A4 — Rollout sequencing
- **Flag design**: `EDITING_RANK_ENABLED` (default `'false'`), mirror PR #1017's `EVOLUTION_REFLECTION_ENABLED` pattern (runtime gate in `runIterationLoop.ts` AND planner gate in `projectDispatchPlan.ts`).
- **Backward compat**: schema makes `ranking` optional/nullable; old detail rows parse fine.
- **No DB migration**. No new TS phases. No new pre-deploy assertion.
- **Pre-flag-on rollout checklist** (9 steps): code review → dark-launch → 50-strategy staging cycle → calibrate `EXPECTED_RANK_COMPARISONS_RATIO` → operational baseline → verify cost alerts → E2E spec verification → CI workflow env update → prod flag flip → 48h monitor.

## Reuse-vs-New Ledger

| Surface | Reuse | New |
|---|---|---|
| `rankNewVariant`, `rankSingleVariant`, `computeTop15Cutoff` | ✓ | — |
| `MergeRatingsAgent` | ✓ (already widened) | — |
| `'ranking'` phase string + cost calibration | ✓ | — |
| `rankNewVariantDetailInnerSchema` + `rankingDetailRenameKeys` | ✓ | — |
| `estimateRankingCost` helper | ✓ | — |
| `ConfigDrivenDetailRenderer` field types | ✓ | — |
| `IterativeEditInput` shape | — | Extend with 5 fields (mirror `GenerateFromPreviousInput`) |
| `iterativeEditingExecutionDetailSchema` | extend | Add optional `ranking` field |
| `EstPerAgentValue` | extend | Add `editingRank` peer field |
| `DETAIL_VIEW_CONFIGS['iterative_editing']` | extend | 2 new entries (object+table) |
| `runIterationLoop.ts` editing branch | extend | Thread inputs + populate match buffers |
| `IterativeEditingAgent.execute()` insertion at line 351 | — | New ranking call site |
| `EDITING_RANK_ENABLED` env flag | — | New flag, default `'false'` |
| `iterative_edit_rank_cost` metric + 2 propagation metrics | — | New |
| Property tests (`parseProposedEdits`, `applyAcceptedGroups`) | ✓ unchanged | — |
| E2E spec | — | Flip §14 assertion + add ranking-cost assertion |

## Open Questions for /plan-review

1. **Surface/discard policy**: Confirm Option B (always surface) for v1, or stronger preference for Option C (discard if regressed)?
2. **Discard duplicate matches**: low risk, but parallel editing agents could produce duplicate `(variant, opponent)` arena rows. Defer or mitigate now?
3. **`editingRank` vs folded `editing`**: confirm Option A (peer field) — recommended for cost-shock visibility.
4. **Default flag value**: confirm `EDITING_RANK_ENABLED='false'` default — given the cost impact, is a 1-month staging soak appropriate?
5. **Pre-cycle abort check before ranking**: skip (rely on outer try/catch) or add explicit pre-rank budget guard?

## Predecessor Link

Direct successor to `bring_back_editing_agents_evolution_20260430` (PR #1020). Decisions §14 in that project's planning doc explicitly forbade what this project enables — append a "superseded by" note when this lands.
