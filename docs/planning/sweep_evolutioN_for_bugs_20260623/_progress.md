# sweep_evolutioN_for_bugs_20260623 Progress

## Phase 1: Research & Scope
### Work Done
- Read 28 evolution docs + 4 standard docs (architecture, project_workflow, testing_overview, getting_started)
- Built bug-hunt surface map by subsystem (variant generation, arena rating, criteria agents, paragraph recombine, coherence pass, prompt editor, cost tracking, logging/observability, scheduling/runner, DB schema/migrations, agents, visualization, minicomputer deployment)
- Inventoried 317 source files across `evolution/{scripts,src,services,components,testing,lib}`

### Issues Encountered
None.

## Phase 2: Bug Discovery
### Work Done
- Fan-out workflow: 10 finder dimensions (correctness-pipeline-loop, cost-tracking, error-handling, concurrency, schema-db, prompt-correctness, logging-observability, security, type-safety, correctness-agents), each agent reading a slice of the code surface with the bug-hunt map as priors.
- 103 raw candidates → 100 deduped by `(file, line, category)`.
- Severity distribution from finder guesses: 3 critical, 19 high, 38 medium, 40 low.
- Persisted to `_candidates.json`.

### Issues Encountered
None.

## Phase 3: Adversarial Verification
### Work Done
- 100 verifiers, default-refute framing. Each read the cited file at the cited line, applied a strict severity rubric, and returned a structured verdict.
- Result: **30 real bugs survived** (70 refuted as not-bugs / stylistic / theoretical).
- Final severity (from rubric, not finder guess): **0 critical, 12 high, 14 medium, 4 low.**
- Persisted to `_survivors_full.json` (verdicts + fix sketches) and `_refuted.json` (the not-bugs, useful for telling future sweeps what to skip).

### Issues Encountered
None.

## Phase 4: Fix Critical / High / Medium
### Work Done — 26 bugs fixed across 5 batches

**Batch 1: Elo-tie tiebreaks (4 bugs)** — added `id`-lexicographic tiebreak to every Elo sort that fed a shuffle or top-N slice, restoring reproducibility per Decision §12.
- `evolution/src/lib/pipeline/loop/editingDispatch.ts:64`
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts:152, 1378, 1678`

**Batch 2: rankSingleVariant error handling (3 bugs, one root)** — the sibling of D5 (D5 patched cost-tracking 402 cascades; ranking still swallowed them as fake TIEs). The inner catch now distinguishes permanent errors (402 payment-required, parse, auth) from transient (timeout, 5xx, rate-limit). Permanent errors re-throw so the variant ranking fails loudly. Transient errors skip the opponent without polluting `matchBuffer` / `completedPairs`, leaving the comparison slot available for a real signal.
- `evolution/src/lib/pipeline/loop/rankSingleVariant.ts:375-393`
- + 2 unit tests for the new catch branches.

**Batch 3: proposerApproverCriteriaGenerate I3 violations (5 bugs)** — wrapper invariant I3 requires partial `execution_detail` write before re-throwing on any helper failure. Added `updateInvocation()` calls in the eval+suggest, proposer, and forward-approver catch blocks; moved mirror-approver cost computation into a `finally` so partial provider charges are always captured.
- `evolution/src/lib/core/agents/proposerApproverCriteriaGenerate.ts:291, 337, 369, 290, 331`

**Batch 4: Cost tracking (6 bugs)**
- `estimateCosts.ts:389` — `expectedRanking` now uses post-cycle `articleChars`, not undersized `seedChars` (HIGH; under-projects ranking cost ~50%).
- `trackBudget.ts:168` — `recordSpend()` now validates `actualCost >= 0` and finite, mirroring `reserve()`.
- `trackBudget.ts:329` — `EVOLUTION_RUN_CUMULATIVE_PHASE_COSTS_ENABLED='false'` is deprecated; first invocation logs a loud warning so operators notice the silent metric breakage.
- `generateFromPreviousArticle.ts:171` — removed `getOwnSpent?.() ?? getTotalSpent()` fallback; now falls back to `0` to prevent sibling agents' costs from bleeding into the per-agent delta under parallel execution.
- `createEvolutionLLMClient.ts:252` — cost-write failure log now includes `runId`, `totalSpent`, `phaseCost`, `costMetricName` for debuggability.
- `costEstimationActions.ts:429` — added `costCoverage: 'complete' | 'sparse' | null` to `CostSummary`, flagged when invocation-cost sum diverges from run-metric total by >5% or when invocations are missing `cost_usd`.

**Batch 5: Remaining mediums + highs (8 bugs)**
- `arenaActions.ts:303` — added `.eq('variant_kind', 'article')` to `getArenaEntries` so article leaderboards never surface paragraph rewrites.
- `persistRunResults.ts:600` — added `.order('completed_at', desc).limit(10_000)` to the propagateMetrics child-run query so long-lived experiments don't OOM.
- `runEditingCycle.ts:472` — `modeBRationale` (LLM-generated proposer output) is now sanitized via `sanitizeForPriorContext` before injection into the approver prompt, mirroring the paragraph_recombine defense.
- `projectDispatchPlan.ts:593` — added `EffectiveCap='config_limit'` so `maxDispatchesK` is no longer mislabeled as `safety_cap` in the wizard preview; updated `DispatchPlanView.tsx` + `strategyPreviewActions.ts` to display the new badge ("maxDispatches").
- `findOrCreateStrategy.ts:277` — strategy-upsert error rethrow now uses `Error.cause` to preserve the original Supabase error code/details.
- `criteriaMetrics.ts:104` — replaced `(p.mu ?? 25) as number` with `Number(p.mu ?? 25)` so Postgres NUMERIC values that deserialize as strings get coerced cleanly.
- `approverPrompt.ts:38` — documented the rationale-sanitization requirement on the parameter doc-comment.
- `proposerPrompt.ts:81` — clarified `[#N]` group-number syntax: N must be a positive integer; invalid tags are silently dropped.

### Issues Encountered
- Test-mock chains for `arenaActions.test.ts` didn't accept the original two-query fix (pre-fetch prompt_kind, then filter variant). Restructured to a single-query default-filter on `variant_kind='article'` since paragraph topics are already excluded from the topic list by D13+D20 — same correctness outcome, no test rewrites needed.
- `estimateCosts.test.ts` "upperBoundRanking covers larger article (post-cycle growth)" implicitly validated the broken behavior (expected was undersized). Updated the assertion to assert the correct post-fix ratio (just the 1.3× safety margin).
- `persistRunResults.test.ts` "propagateMetrics passes uncertainty through" needed the mock chain extended with `.order().limit()`.
- Type union additions for `EffectiveCap='config_limit'` cascaded to `strategyPreviewActions.ts`, `DispatchPlanView.tsx`, and `CostEstimatesTab.test.tsx`; all updated to match.

### User Clarifications
- Asked: scope of fix phase (all 26 vs high-only vs no-doc-mediums). User chose **all 26**.

## Phase 5: Wrap-up
### Work Done
- `npm run typecheck` → clean
- `npm run lint` → clean (only pre-existing warnings in unrelated `llms.test.ts`)
- 415/415 touched-area unit tests pass.
