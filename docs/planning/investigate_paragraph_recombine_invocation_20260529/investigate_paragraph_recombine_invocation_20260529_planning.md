# Investigate Paragraph Recombine Invocation Plan

## Background
I see that some paragraphs in invocation 83c9a188-cb83-4cd0-bdbc-3356cbc537fc have 0 matches and 0 iterations, and are also coming from seed despite strategy specifying was supposed to take from top variants of run.

## Requirements (from GH Issue #NNN)
I see that some paragraphs in invocation 83c9a188-cb83-4cd0-bdbc-3356cbc537fc have 0 matches and 0 iterations, and are also coming from seed despite strategy specifying was supposed to take from top variants of run.

## Problem
[3-5 sentences describing the problem — refine after /research]

Two distinct symptoms in `paragraph_recombine` invocation `83c9a188-cb83-4cd0-bdbc-3356cbc537fc`:
1. Some paragraph slots show 0 matches and 0 iterations (no pairwise comparisons recorded → per-slot Elo never moved off baseline).
2. The parent article was resolved from the seed even though the strategy's iteration specified `sourceMode: 'pool'` with a top-N quality cutoff.

These may be the same root cause (no eligible in-run pool → seed fallback → degenerate per-slot ranking) or two independent bugs. /research must confirm against the DB row and the `resolveParent` / per-slot ranking code paths.

## Options Considered
- [ ] **Option A: [Name]**: [Description — fill after /research]
- [ ] **Option B: [Name]**: [Description — fill after /research]
- [ ] **Option C: [Name]**: [Description — fill after /research]

## Phased Execution Plan

### Phase 1: Reproduce & Root-Cause
- [ ] Query the invocation row (`evolution_agent_invocations` id `83c9a188-cb83-4cd0-bdbc-3356cbc537fc`): read `execution_detail`, `iteration`, `run_id`, `success`, `error_message`, `created_at`.
- [ ] Identify the run + strategy: read the strategy's `iterationConfigs[]` to confirm the intended `sourceMode`/`qualityCutoff` for this iteration index.
- [ ] Inspect `resolveParent` behavior + logs for a `fallbackReason: 'no_same_run_variants'` (or `empty_pool`) warn around this invocation.
- [ ] Inspect per-slot `execution_detail.slots[*]`: match counts, drop reasons, `winnerSource`, self-abort, `paragraph_slot_match_persist_failures` metric.
- [ ] Determine whether the invocation pre-dates `investigate_matchmaking_paragraph_recombine_20260528` / `make_fixes_paragraph_recombine_20260528`.

### Phase 2: Fix
- [ ] [Actionable fix item — fill after root cause confirmed]

## Testing

### Unit Tests
- [ ] [Test file path and description — e.g. `evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.test.ts` — assert pool-mode parent selection + per-slot match recording]

### Integration Tests
- [ ] [Test file path and description — e.g. `src/__tests__/integration/evolution-*.integration.test.ts`]

### E2E Tests
- [ ] [Test file path and description, if any UI assertion is needed]

### Manual Verification
- [ ] Re-query staging/prod for the affected invocation and confirm corrected behavior on a new run with the same strategy.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] [Playwright spec or manual UI check — only if invocation/run detail UI changes]

### B) Automated Tests
- [ ] [Specific test file path/command — fill after Phase 2]

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/paragraph_recombine.md` — failure modes / parent resolution / per-slot ranking behavior if changed
- [ ] `evolution/docs/multi_iteration_strategies.md` — `sourceMode`/`qualityCutoff` semantics if seed-fallback logic changes
- [ ] `evolution/docs/architecture.md` — content/parent resolution notes if changed
- [ ] `evolution/docs/agents/overview.md` — `ParagraphRecombineAgent` algorithm if changed
- [ ] `evolution/docs/arena.md` — `loadArenaEntries` / per-slot topic loading if changed
- [ ] `evolution/docs/rating_and_comparison.md` — per-slot ranking / paragraph comparison mode if changed
- [ ] `evolution/docs/data_model.md` — schema notes if any column/metric changes
- [ ] `evolution/docs/metrics.md` — `paragraph_recombine_cost` / `paragraph_slot_match_persist_failures` if changed
- [ ] `evolution/docs/strategies_and_experiments.md` — sourceMode + qualityCutoff section if changed
- [ ] `docs/docs_overall/debugging.md` — add a paragraph_recombine diagnosis recipe if useful

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
