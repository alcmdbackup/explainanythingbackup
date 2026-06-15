# Investigate Sequential Paragraph Recombine Performance Plan

## Background
Investigate performance of most recent 4 paragraph recombine runs on stage and understand why performance is generally negative.

## Requirements (from GH Issue #1220)
Investigate performance of most recent 4 paragraph recombine runs on stage and understand why performance is generally negative.

## Problem
Per the research doc, the 4 most recent `paragraph_recombine` runs on staging all report `eloAttrDelta:paragraph_recombine:paragraph_recombine` in the −1.5 to −6.0 mu range, while every other tactic in the same runs reports +4.8 to +13.8. Two layered causes:

1. **Selection bias** — `qualityCutoff: topN-3` picks the best parents in the pool, so beating them in parent→child delta is structurally hard (deferred).
2. **Coherence loss across slot seams** — when the coordinator's plan is fixed from the parent up-front and committed to before any slot winner is known, mid-article slot rewrites face directives that don't reflect the chosen opener's voice. Generation and judging both see `priorPicks` and prefer continuity — but the **menu of directives** they have to pick from was made blind to those picks. The vivid example in the research doc (storm → mosaic → boots-on-the-ground → utility → wielding tools across 9 paragraphs) is exactly this failure mode.

This plan implements two fixes the user explicitly chose:

- **Fix 1** — strengthen the per-slot rewrite-generation prompt with an explicit continuity-emphasis block covering tone, register, metaphors, analogies, acronyms, vocabulary, cadence, and discipline. Cheap (zero added LLM calls), low-risk.
- **Fix 2** — after slot 0 finalizes, re-call the coordinator once with `priorPicks` so the remaining slots' directives can match the chosen voice. Adds one coordinator LLM call per invocation (~$0.0014 at current model). Env-gated for safe rollout.

These are orthogonal to the structural Fix 3 (`qualityCutoff` change) which is deferred to a follow-up project.

## Options Considered
- [x] **Option A (chosen): Implement Fix 1 + Fix 2, env-gate Fix 2, both rolled out together via a single PR.** Maximum signal in a single A/B (the two fixes attack different stages of the coherence problem). Risk: harder to attribute the lift to Fix 1 vs Fix 2.
- [ ] **Option B: Implement only Fix 1, defer Fix 2.** Cheapest; lower upside since Fix 1 alone can't fix the case where slot 0's plan was already "good enough" but slots 1+ were planned without slot-0 context.
- [ ] **Option C: Implement Fix 1 + Fix 2 + Fix 3 (qualityCutoff change).** Largest scope; muddies the A/B because the parent pool changes too. Deferred.

A/B isolation note: Fix 1 is unconditional (no env flag); Fix 2 is env-gated. A staging run with `EVOLUTION_PARAGRAPH_RECOMBINE_REPLAN_ENABLED=false` measures Fix 1 alone; flipping to `true` measures both together. That gives us per-fix attribution without two PRs.

## Phased Execution Plan

### Phase 1: Continuity-emphasis block in the rewrite prompt (Fix 1)

**File:** `evolution/src/lib/core/agents/paragraphRecombine/buildSequentialRewritePrompt.ts`

- [ ] Add a `CONTINUITY DIRECTIVE` block to the rewrite prompt, interpolated **only when `priorPicks.length > 0`** (slot 0 has nothing to continue). Block lists the continuity dimensions concretely, not abstractly:

  ```
  CONTINUITY DIRECTIVE — match the article already established in PRIOR CONTEXT:
  - Tone & register: read PRIOR CONTEXT's tone (formal/playful/clinical/journalistic/literary) and match it. Do not shift register.
  - Voice & POV: keep the same narrator stance (objective third person, second-person address, first-person plural, etc.).
  - Metaphors: if PRIOR CONTEXT uses an extended metaphor or sustained imagery (e.g., nautical, architectural, biological), CONTINUE it. Do NOT introduce a new metaphor system. If PRIOR CONTEXT has no metaphors, do not add one here.
  - Analogies: do not repeat an analogy already used upstream. Do not introduce a new analogy if the article already has one.
  - Acronyms: if an acronym was defined in PRIOR CONTEXT, use the bare acronym here; do NOT redefine it. If not yet introduced, only define if you must use it.
  - Vocabulary: match the Latinate-vs-Anglo-Saxon balance, level of contractions (none / some / many), and use of jargon already established.
  - Sentence cadence: match the average sentence length and rhythm of PRIOR CONTEXT (long winding sentences vs short punchy ones).
  - Discipline: match the level of factual density, hedge language, and numeric specificity already established.

  Continuity overrides novelty when they conflict: a fresh idea that breaks voice is worse than a familiar idea that lands cleanly.
  ```

- [ ] Position this block **immediately after the `</UNTRUSTED_PRIOR>` close tag**, before the `ORIGINAL <slot>` block, so the LLM reads PRIOR CONTEXT then is told what to do with it.

- [ ] Update the file-header docstring (lines 1-7) to note the continuity block was added in this project's date range.

- [ ] **Tests** — `buildSequentialRewritePrompt.test.ts` (new colocated test file if missing):
  - Block is **absent** when `priorPicks=[]` (slot 0 case).
  - Block is **present** when `priorPicks.length >= 1`.
  - Block survives prior-picks truncation (still present when `truncated=true`).
  - Block does not include any untrusted variable interpolation that could enable injection (`priorPicks` content stays inside `<UNTRUSTED_PRIOR>` tags — the block is pure static instruction text).

### Phase 2: Mid-sequence coordinator re-plan (Fix 2)

#### 2a. New prompt builder for replan

**File (new):** `evolution/src/lib/core/agents/paragraphRecombine/buildCoordinatorReplanPrompt.ts`

- [ ] Export `buildCoordinatorReplanPrompt(opts)` where `opts = { parentText, paragraphCount, priorPicks, firstSlot }`. The prompt explains:
  - Paragraphs `0..firstSlot-1` are already finalized (verbatim in `<UNTRUSTED_PRIOR>` block).
  - Re-plan ONLY paragraphs `firstSlot..paragraphCount-1`.
  - `paragraphPlans[].paragraphIndex` MUST start at `firstSlot` (not 0). The output is a partial plan covering the remaining slots.
  - Use the SAME plan strategies enumerated in `buildCoordinatorPrompt.ts` (DRY: import the strategies block as a shared const if practical, otherwise duplicate verbatim with a comment).
  - Add a **continuity emphasis sentence**: "Your re-planned directives MUST be consistent with the voice, metaphors, acronyms, and analogies established in PRIOR CONTEXT — directives that ignore PRIOR CONTEXT defeat the purpose of replanning."

- [ ] Keep the same JSON output format as the original coordinator prompt (just with fewer entries and shifted `paragraphIndex` values).

#### 2b. Extend the coordinator runner

**File:** `evolution/src/lib/core/agents/paragraphRecombine/coordinator.ts`

- [ ] Add optional fields to `RunCoordinatorOptions`:
  ```ts
  priorPicks?: readonly string[];
  firstSlot?: number;  // default 0
  ```

- [ ] In `runCoordinator()`, when `priorPicks !== undefined && firstSlot !== undefined && firstSlot > 0`, call `buildCoordinatorReplanPrompt(...)` instead of `buildCoordinatorPrompt(...)`.

- [ ] In `parseAndValidate()`, accept an `expectedFirstSlot: number` (default 0). Adjust:
  - Expected plan length = `expectedSlotCount - expectedFirstSlot`.
  - Each entry's `paragraphIndex` must be in `[expectedFirstSlot, expectedSlotCount)`.
  - If a returned plan has gaps or out-of-range indices, fail Zod with a clear error message.

- [ ] Return value adds nothing new — `RunCoordinatorResult.plan` is the partial plan, callers merge.

#### 2c. Orchestration: call replan once after slot 0

**File:** `evolution/src/lib/core/agents/paragraphRecombine/sequentialExecute.ts`

- [ ] After slot 0's `processSequentialRound` returns (line ~143), check the env flag `EVOLUTION_PARAGRAPH_RECOMBINE_REPLAN_ENABLED` (read via a helper `isReplanEnabled()` in `ParagraphRecombineAgent.ts` mirroring the existing `isSequentialEnabled()` pattern).

- [ ] If enabled AND `slots.length > 1` AND slot 0 succeeded (not budget-exhausted, not a parent-fallback path that we deem uninformative):
  1. Call `runCoordinator({ ..., priorPicks, firstSlot: 1 })`.
  2. On success: merge — keep `coordinatorPlan.paragraphPlans[0]` (slot 0's plan); replace entries at indices `1..N-1` with the new plan's entries (matched by `paragraphIndex`).
  3. On failure (throw OR Zod fail): **gracefully degrade** — log a warning, keep the original plan, increment `counters.replanFailureCount`.

- [ ] Pass the (possibly mutated) plan into the subsequent loop iterations. Important: the merge must happen via a NEW `coordinatorPlan` reference, not in-place mutation, so the surrounding code's assumption of immutability holds.

- [ ] **Counters** — add to `SequentialCounters`:
  ```ts
  replanCount: number;          // 0 or 1 (once per invocation today)
  replanFailureCount: number;   // 0 or 1
  ```
  Initialize to 0 alongside the existing counters at line 73-79.

- [ ] **Cost accounting** — the replan call runs on `invocationScope` (not slotScope), so its cost lands in the same phase-cost accumulator the original coordinator call uses. **No change to budget-gate logic** needed — the gate at line 117 reads `invocationScope.getOwnSpent!()` which already includes the replan cost.

#### 2d. Env flag + low-cap auto-disable

**File:** `evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.ts`

- [ ] Add `isReplanEnabled()` helper around line 73:
  ```ts
  function isReplanEnabled(): boolean {
    return process.env.EVOLUTION_PARAGRAPH_RECOMBINE_REPLAN_ENABLED === 'true';
  }
  ```
  Default `false` for safe rollout. Mirror the existing `isSequentialEnabled()` shape but flip the default.

- [ ] Plumb the flag value as an optional parameter to `runSequentialLoop` (`SequentialLoopParams.replanEnabled: boolean`) so the orchestration in `sequentialExecute.ts` doesn't read `process.env` directly (testability).

- [ ] **Low-cap interaction** — `shouldForceLegacyForLowCap` (line 213) already disables Sequential when the per-invocation cap is too small. Add an analogous "if cap < X, skip replan even when Sequential is on" check — replan adds ~$0.0014; below e.g. $0.03 per invocation cap, it's not worth it. Make X a const (`REPLAN_MIN_CAP_USD`).

#### 2e. Schema persistence

**File:** `evolution/src/lib/core/schemas/...` (the file where `slotRecombineExecutionDetailSchema` extends `sequentialCounters`)

- [ ] Extend `sequentialCounters` Zod schema to include `replanCount` and `replanFailureCount` (both non-negative ints, default 0).
- [ ] Extend the metric registry / catalog if we want these surfaced as run-level metrics (mirroring `parent_fallback_rate` registration from commit `e5d7dbb5d`):
  - `paragraph_recombine_replan_rate` = `replanCount / pr_invocations`
  - `paragraph_recombine_replan_failure_rate` = `replanFailureCount / replanCount`
- [ ] Update `evolution/docs/paragraph_recombine.md` with a "Coordinator replan (Fix 2)" subsection.

### Phase 3: Tests

#### 3a. Unit tests
- [ ] `buildSequentialRewritePrompt.test.ts` — the 4 cases from Phase 1 above.
- [ ] `buildCoordinatorReplanPrompt.test.ts` (new) — assert prompt contains PRIOR CONTEXT, mentions `firstSlot..paragraphCount-1`, includes continuity instruction, ends with a JSON schema example whose `paragraphIndex` starts at `firstSlot`.
- [ ] `coordinator.test.ts` (extend) — replan path: passes `priorPicks` + `firstSlot=1`; receives a plan with 8 entries (for paragraphCount=9, firstSlot=1); each entry's `paragraphIndex` in `[1,9)`. Validation rejects entries with `paragraphIndex < 1` or `> 8`.
- [ ] `sequentialExecute.test.ts` (extend) — three new tests:
  1. Replan disabled (default env) → no second coordinator call.
  2. Replan enabled, slot 0 succeeds → exactly one replan call after slot 0; plan for slots 1..N-1 is replaced.
  3. Replan enabled, replan throws → original plan preserved; `replanFailureCount=1`; loop continues normally.
- [ ] `ParagraphRecombineAgent.test.ts` (extend) — assert `executionDetail.sequentialCounters` includes `replanCount` + `replanFailureCount`.

#### 3b. Integration tests
- [ ] Extend an existing evolution integration test under `src/__tests__/integration/evolution-pipeline.integration.test.ts` (or wherever paragraph_recombine is exercised) to cover the replan path with a deterministic mocked LLM that returns a known coordinator plan, a known slot-0 winner, and a known replan plan that differs from the original. Assert the replan plan landed in `execution_detail.coordinatorPlan` (post-merge).
- [ ] No new integration suite — extend existing.

#### 3c. E2E
- [ ] **Not needed.** This is a server-side agent change with no UI surface. No new admin pages or buttons. The existing `09-admin/admin-evolution-run-pipeline.spec.ts` exercises paragraph_recombine end-to-end; it should pass unchanged.

#### 3d. Manual verification (gold-standard A/B on staging)
- [ ] After landing the PR, run the same strategy `8d88a8b3` on the same prompt `a546b7e9` ("What is the Federal Reserve?") **twice** on staging:
  1. **Control:** `EVOLUTION_PARAGRAPH_RECOMBINE_REPLAN_ENABLED=false` — Fix 1 only.
  2. **Treatment:** `EVOLUTION_PARAGRAPH_RECOMBINE_REPLAN_ENABLED=true` — Fix 1 + Fix 2.
- [ ] Compare `eloAttrDelta:paragraph_recombine:paragraph_recombine` against the 4 baseline runs (range −1.5 to −6.0). Target:
  - **Fix 1 alone** moves delta to ≥ −2 (modest improvement).
  - **Fix 1 + Fix 2** moves delta to ≥ 0 (neutral or positive).
- [ ] Also compare verbatim ratios — expectation: PR variants' verbatim ratio drops from 0.34–0.54 toward 0.2 (rewrites are now bolder because they have a coherent target).
- [ ] Spot-check one merged article qualitatively. Pick the same Federal Reserve prompt; read the 9 paragraphs in sequence and confirm the metaphor systems have unified (or none, if the LLM goes plain).

## Testing

### Unit Tests
- [ ] `evolution/src/lib/core/agents/paragraphRecombine/buildSequentialRewritePrompt.test.ts` — Phase 1 continuity-block assertions (4 cases).
- [ ] `evolution/src/lib/core/agents/paragraphRecombine/buildCoordinatorReplanPrompt.test.ts` — new file, replan prompt structure + paragraphIndex range.
- [ ] `evolution/src/lib/core/agents/paragraphRecombine/coordinator.test.ts` — replan path validation.
- [ ] `evolution/src/lib/core/agents/paragraphRecombine/sequentialExecute.test.ts` — orchestration: disabled / success / failure.
- [ ] `evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.test.ts` — counters in execution_detail.

### Integration Tests
- [ ] `src/__tests__/integration/evolution-pipeline.integration.test.ts` — extend a paragraph_recombine case with mocked LLM that exercises the replan branch end-to-end.

### E2E Tests
- [ ] None required (no UI change). The existing `src/__tests__/e2e/specs/09-admin/admin-evolution-run-pipeline.spec.ts` provides ambient coverage.

### Manual Verification
- [ ] Staging A/B: Fix 1 alone vs Fix 1 + Fix 2, measured on the same prompt that produced the −5.95 baseline. See Phase 3d above for the exact comparison.
- [ ] Spot-check one merged article from the Treatment arm for qualitative coherence (no 5-metaphors-in-9-paragraphs).

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] N/A — no UI changes. The agent surfaces in the existing admin run-pipeline spec which should pass unchanged.

### B) Automated Tests
- [ ] `npm test -- evolution/src/lib/core/agents/paragraphRecombine` — all PR agent unit tests.
- [ ] `npm run test:integration -- --testPathPattern=evolution-pipeline` — integration coverage of the replan path.
- [ ] `npm run lint && npm run typecheck && npm run build` — gate for the PR.
- [ ] `npm run test:e2e:critical` — ensure no regression in the admin run-pipeline E2E.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/paragraph_recombine.md` — add "Coordinator replan (Fix 2)" section + a "Continuity directive (Fix 1)" subsection under the rewrite-prompt block.
- [ ] `docs/docs_overall/debugging.md` — extend the "paragraph_recombine slot leaderboard" / "cost-undershoot" entries with a new "negative eloAttrDelta" triage block citing this project's findings + the new sequentialCounters fields (`replanCount`, `replanFailureCount`).
- [ ] `evolution/docs/cost_optimization.md` — note the additional ~$0.0014 per invocation when replan is enabled; add to the Paragraph-Recombine Cost section's Options list as "Option L: coordinator mid-sequence replan."
- [ ] `evolution/docs/reference.md` — add `EVOLUTION_PARAGRAPH_RECOMBINE_REPLAN_ENABLED` to the env-flag reference.
- [ ] `evolution/docs/evolution_metrics.md` — add definitions for `paragraph_recombine_replan_rate` and `paragraph_recombine_replan_failure_rate`.
- [ ] Other docs from `_status.json relevantDocs` — verified to not need updates: judge_evaluation.md (judge unchanged), metrics_analytics.md, admin_panel.md (no new admin surface), search_generation_pipeline.md, request_tracing_observability.md, error_handling.md, testing_pipeline.md, debugging_skill.md, rating_and_comparison.md, arena.md, architecture.md, data_model.md, metrics.md, criteria_agents.md, editing_agents.md, multi_iteration_strategies.md, variant_lineage.md, strategies_and_experiments.md, logging.md.

## Review & Discussion
_This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration._
