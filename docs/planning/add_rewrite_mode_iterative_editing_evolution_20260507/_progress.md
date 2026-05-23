# Progress

## Phase 0 — Real-LLM pilot ✅ DONE
- [x] Pilot driver `evolution/scripts/pilot-mode-b.ts`
- [x] 5 stage articles run through `gemini-2.5-flash-lite`
- [x] Findings written to `_research.md`
- [x] LLM-side mechanics validated (0/5 parse failures, 1.006× max expansion, idempotent)

## Phase 1 — Diff engine fixes ✅ DONE (commit `40f9acdc`)
- [x] Bug 1: `decorateWithContainerMarkup` cases for strong/emphasis/delete/inlineCode/link
- [x] Bug 2: `diffRatioWords` undefined-input guard + alignment monotonicity
- [x] Bug 3: `fallbackStringify` ordered-list ascending (`node.start + i`)
- [x] Opt-in: `linkGranular` flag (default off)
- [x] Opt-in: `stringify` callback (already in DiffOptions)
- [x] Whitespace-hoist in `wrapDel`/`wrapIns`/`wrapUpdate` + `splitSurroundingWs`
- [x] `mergeWhitespaceBridgedRuns` in `toCriticMarkup`
- [x] Multi-letter dotted abbreviations (U.S./U.K./etc.)
- [x] 6 regression tests
- [x] 32 golden snapshots updated for new whitespace-hoist output
- [x] Pilot drift: 100% → 20% (4/5 articles drift-clean)

## Phase 2 — Mode A patch ✅ DONE (commit `fce79097`)
- [x] `proposerPrompt.ts`: HARD_CONSTRAINT (RULE 1+2), `<source>` delimiters, FAILURE_GALLERY (paired BAD/GOOD, domain-neutral), worked example, 3-edit budget, numbered self-check
- [x] `parseProposedEdits.ts`: `<output>` wrapper strip + `{ ++ }` whitespace tolerance
- [x] `IterativeEditingAgent.ts`: pre-flight `structural_rewrite` rejection (>10% length divergence + <3 groups)
- [x] Stop-reason enum extended: `structural_rewrite`, plus Phase 3 enum values
- [x] 9 new tests (5 prompt assertions + 4 parser tolerance tests)

## Phase 3 — Mode B implementation ✅ DONE
- [x] **Schema (3.1):** new `iterative_editing_rewrite` enum value, `editingProposerSoftCap` field, `EditingCycle` extended with optional Mode B fields, refines accept both editing types
- [x] **Helpers (3.2):**
  - `proposerPromptRewrite.ts` — two-section format spec
  - `splitRationaleAndRewrite.ts` — anchored regex with code-fence + tag stripping
  - `computeMarkupFromRewrite.ts` — dynamic-import diff engine + `serializeError` + typed errors + 100 KB cap
  - `coalesceAdjacentGroups.ts` — gap < 24 chars, same-kind, paragraph-aware
  - `capGroupsByMagnitude.ts` — top-K by char delta + top-1-per-section retention
  - `IterativeEditingRewriteAgent.ts` — sibling subclass overriding `name` + `isRewriteMode`
- [x] **Integration (3.3):**
  - Parent's `execute()` branches on `isRewriteMode` at the proposer step
  - `current.text` → `normalizedBefore` for Mode B (apply-step strict-equals)
  - `approverPrompt.ts` accepts optional `rationale` with red-team caveat
  - `runIterationLoop.ts:786` dispatches both editing types; per-invocation `DISABLE_ITERATIVE_EDITING_REWRITE` env-flag rollback gate
  - `estimateCosts.ts` accepts `mode` param; rewrite mode skips drift-recovery upper-bound
  - `projectDispatchPlan.ts` threads mode through; `agentType` honored in plan output
  - `strategyPreviewActions.ts` schema accepts new enum value
- [x] **UI (3.4):**
  - `new/page.tsx`: extended union, hardcoded dropdown option, payload helper threads `editingMaxCycles` for both editing types
  - `AnnotatedProposals.tsx`: new `RationaleBlock` subcomponent (plain-text rendering, no XSS surface)
  - `ConfigDrivenDetailRenderer.tsx`: threads `proposerMode`/`rationale`/`rewriteText` props
- [x] **Tests (3.5):** 28 new tests across 6 new files; 18 test suites total in `evolution/src/lib/core/agents/editing/`, 159 passing
- [x] **Jest config:** `transformIgnorePatterns` updated for ESM-only packages; `babel-jest` transform for `.m?js` files
- [x] **Pilot re-run post-Phase-3:** 4/5 drift-clean (1 sentence-boundary edge case); Mode B agent flow verified end-to-end via `npx tsx evolution/scripts/pilot-mode-b.ts`

## Phase 4 — A/B run on stage ⏳ READY FOR USER LAUNCH

Phase 4 requires real LLM cycles on stage with N≥50 invocations per arm. **Steps for the user:**

1. **Create the two strategies on stage** (admin UI: `/admin/evolution/strategies/new`):
   - **Strategy A — Mode A baseline:** name "[A/B] Mode A baseline", iterations: `gen → iterative_editing → iterative_editing`, agentType `iterative_editing` for both editing iterations, model `google/gemini-2.5-flash-lite`, judge `qwen-2.5-7b-instruct`, budgetUsd $0.05.
   - **Strategy B — Mode B rewrite:** name "[A/B] Mode B rewrite", same iterations + budget but with `agentType: 'iterative_editing_rewrite'` for both editing iterations.

2. **Launch each run** with the same seed corpus. Aim for 50+ runs per arm (≈$2.50–5 per arm at the strategy's $0.05/run budget).

3. **Watch the dashboard** (admin UI: `/admin/evolution/runs/`). Per-cycle metrics surface in the run-detail page; Mode B cycles will show the new `<RationaleBlock>`.

4. **Rollback gate:** if Mode B misbehaves mid-run, set `DISABLE_ITERATIVE_EDITING_REWRITE=true` in stage env vars. New Mode B invocations fall back to Mode A at runtime; in-flight cycles complete in their pre-flip mode (atomic-per-invocation).

## Phase 5 — Decision ⏳ AWAITS PHASE 4 DATA

Once N ≥ 50 invocations per arm are complete, query stage for the metrics:

```sql
-- Per-arm summary (run by user; results land in _progress.md)
SELECT inv.agent_name,
  COUNT(*) AS invocations,
  AVG(CASE WHEN c->>'appliedCount' = '0' THEN 0 ELSE 1 END) AS cycle_success_rate,
  AVG((c->>'appliedCount')::int) AS edits_per_cycle,
  SUM(inv.cost_usd) AS total_cost
FROM evolution_agent_invocations inv,
     jsonb_array_elements(inv.execution_detail->'cycles') AS c
WHERE inv.agent_name IN ('iterative_editing', 'iterative_editing_rewrite')
  AND inv.run_id IN (<phase-4 run ids>)
GROUP BY inv.agent_name;
```

**Decision rule (one-tailed binomial, α=0.05, CI lower bound > 0):**
- Mode B wins if `cycleSuccessRate(B) − cycleSuccessRate(A) ≥ 0.30` AND `parentToChildEloDelta(B) ≥ parentToChildEloDelta(A) − 5`
- If Mode A baseline rises ≥70%, switch to relative criterion: `cycleSuccessRate(B) / cycleSuccessRate(A) ≥ 1.4`

**Sample size:** ≈30 per arm at 5% baseline; ≈50 per arm at 30% baseline.

## Files modified across all phases

**Diff engine (Phase 1):**
- `src/editorFiles/markdownASTdiff/markdownASTdiff.ts` — 7 distinct fixes
- `src/editorFiles/markdownASTdiff/markdownASTdiff.test.ts` — 6 regression tests
- `src/editorFiles/__snapshots__/aiSuggestion.golden.test.ts.snap` — 32 snapshots updated
- `package.json` — `remark-stringify ^11`

**Mode A (Phase 2):**
- `evolution/src/lib/core/agents/editing/proposerPrompt.ts` — full rebuild
- `evolution/src/lib/core/agents/editing/proposerPrompt.test.ts` — 5 new assertions
- `evolution/src/lib/core/agents/editing/parseProposedEdits.ts` — wrapper strip + ws tolerance
- `evolution/src/lib/core/agents/editing/parseProposedEdits.test.ts` — 4 new tests
- `evolution/src/lib/core/agents/editing/IterativeEditingAgent.ts` — pre-flight rejection
- `evolution/src/lib/core/agents/editing/IterativeEditingAgent.test.ts` — 1 new test
- `evolution/src/lib/types.ts` — stop-reason enum extended
- `evolution/src/lib/schemas.ts` — stop-reason enum extended

**Mode B (Phase 3):** see commit message for the full file list (25 files modified/added across schema, helpers, agent, dispatch, UI, tests).

## Plan-review state

Consensus reached at iter 6/8 (Security 5/5, Architecture 5/5, Testing 5/5).

## Pilot scripts (evolution/scripts/)
- `pilot-mode-b.ts` — re-runnable Phase 0 driver
- `debug-drift.ts` — focused single-article drift inspector
