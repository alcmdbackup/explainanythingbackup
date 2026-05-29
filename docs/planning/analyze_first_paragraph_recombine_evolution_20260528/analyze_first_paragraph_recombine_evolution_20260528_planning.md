# Analyze First Paragraph Recombine Evolution Run Plan

## Background

Analyze what happened for evolution run `d8b666a7-fbf4-4b89-98ee-6382311c1787` on the **staging** database, because the results look strange. This is the first real `paragraph_recombine` iteration run after the dispatch wiring shipped in `make_fixes_paragraph_recombine_20260528`. The goal is investigative: trace the run's variants, per-slot rankings, Elo, cost metrics, and logs to determine whether the strange results stem from a bug, a misconfiguration, or expected-but-surprising behavior — and recommend a fix only if a defect is found.

## Requirements (from GH Issue #NNN)

- Analyze what happened for run `d8b666a7-fbf4-4b89-98ee-6382311c1787` on stage as results look strange.
- (Details: same as summary.)

## Outcome: ANALYSIS + RC3 tuning fix (2026-05-29)

The bulk of this project is **analysis** — the diagnosis is the primary deliverable; findings, evidence, and root causes live in `..._research.md`. The four root causes (RC1 silent generation truncation + no completeness validation; RC2 uniform-random parent pick among top-N; RC3 rewrite length cap too strict; RC4 single-agent dispatch strands the iteration budget) are documented there with file:line evidence.

**One fix was applied this session at user request: RC3** — the rewrite length cap was widened from ±10% to **±20%** (validator + rewrite prompt), since across two staging runs the ±10% window dropped ~60% of otherwise-valid rewrites. The deeper RC1/RC2/RC4 issues are deferred to **separate future projects** (see "Recommended follow-ups" below).

## Problem

The `paragraph_recombine` agent decomposes a parent article into paragraph slots, generates M rewrites per slot, ranks per-slot via Elo, recombines slot winners into one article variant, then (post make_fixes) article-ranks that variant so it competes for the run winner. Many moving parts can produce "strange" output. **Resolved for run `4a48fcd3`:** the iteration was a near-no-op — it picked a *truncated 1-paragraph* parent at random, dropped 2 of 3 rewrites on the ±10% length cap, drew the lone (truncated) survivor against the original, and emitted a byte-identical copy of the junk parent while spending $0.000224 of its $0.045 allocation. The run winner itself is a fine complete article (`2c558d62`, Elo 1165). Root cause chain documented in the research doc.

## Options Considered

- [x] **Option A: DB-first forensic trace (CHOSEN)**: Used `npm run query:staging` (read-only) to pull the run row, invocations + `execution_detail.slots[*]`, variants (`variant_kind`), metrics, and logs; reconstructed the timeline and compared against the documented algorithm/cost envelope. Supplemented by 2 Explore agents reading the code (generation/format-validation path + paragraph_recombine internals) to confirm root causes. No code execution, no DB writes.
- [ ] **Option B: Admin-UI walkthrough**: Not needed — the DB trace + code read fully explained the behavior.
- [ ] **Option C: Local reproduction**: Out of scope (analysis-only). Would be the natural first step if a fix project later needs a failing repro of RC1 truncation.

## Phased Execution Plan

### Phase 1: Define "strange" + gather run facts
- [x] Symptom inferred from data: paragraph_recombine produced a no-op copy of a truncated parent and spent ~0.5% of its allocation.
- [x] Queried `evolution_runs` for `4a48fcd3-...` (corrected from the invocation ID `d8b666a7`): completed, prompt-based, strategy `f457885f`, experiment `92b63d83`, $0.05 cap, no error.
- [x] Read strategy `iterationConfigs[]`: generate (seed, 10%) → paragraph_recombine (pool, topN=5, 3 rewrites/para, 8 comp/para, 12 paras max, 90%).

### Phase 2: Reconstruct the paragraph_recombine invocation
- [x] Invocation `d8b666a7` `execution_detail`: 1 slot, parent `d94fa269`, `winnerSource: original`, 3 rewrites (2 dropped `length_over`, survivor truncated), recombined `formatValid:true`.
- [x] `evolution_variants`: 4 generate articles (winner `2c558d62` complete; `d94fa269` truncated 490 chars) + recombined `e33d9c80` (identical copy) + paragraph snippet `ad06a227`.
- [x] (arena/paragraph-topic deep-dive unnecessary — the invocation detail was conclusive.)

### Phase 3: Metrics + cost sanity
- [x] Metrics: total cost $0.005006 / $0.05; paragraph_recombine_cost $0.000224; generation $0.002458; ranking $0.002324; seed $0; no `paragraph_slot_match_persist_failures`; winner_elo 1165.4.
- [x] `evolution_logs`: no warn/error rows; no invocation-level logs — chain executed silently.

### Phase 4: Diagnosis + recommendation
- [x] Classified: chain of 1 expected-but-surprising design behavior (RC4) + 1 design weakness (RC2) + 1 tuning issue (RC3) + 1 genuine gap (RC1, broad). Full writeup in research doc.
- [x] Decision: **analysis only** — no code changes this project. Follow-up fixes listed below as out-of-scope.

## Recommended follow-ups (out of scope — separate projects)
- [ ] **RC1**: reject/retry truncated completions — check `finish_reason==='length'` in the LLM client, and add a min-length / sentence-completeness guard to `validateFormat` so truncated articles don't enter the pool/arena. (Broadest impact; affects all agents.)
- [ ] **RC2**: make `resolveParent` for paragraph_recombine bias toward higher Elo and/or skip degenerate (very short / 1-paragraph) parents.
- [x] **RC3 (APPLIED 2026-05-29)**: widened the rewrite length cap from ±10% to **±20%** in `validateParagraphRewrite` (`paragraphSlots.ts` 0.9/1.1 → 0.8/1.2) AND the rewrite-prompt guardrail (`buildParagraphRewritePrompt.ts` ±10% → ±20%) so the model aims for the same window the validator enforces. Updated comments, the failure-modes table in `paragraph_recombine.md`, and unit tests (new ±20% boundary + regression-guard cases). All checks pass (tests/tsc/lint/build). NOTE: this is a tuning change; the deeper RC1/RC2 issues remain.
- [ ] **RC4**: reconcile single-agent dispatch with `budgetPercent` — either iterate paragraph_recombine to use the allocation or document that its budget% is advisory.
- [ ] **Minor**: investigate `seed_cost = 0` attribution on prompt-based runs.

## Testing

### Unit Tests
- [x] `evolution/src/lib/shared/paragraphSlots.test.ts` — updated the length descriptions (80%/120%) and added 4 boundary cases pinning the ±20% window (rewrites at ~85%/~115% now accepted; ~75%/~125% still rejected). 46/46 pass.
- [x] `evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.test.ts` — updated stale ±10%/<90% comments to ±20%/<80%; all-rewrites-dropped fallback case still valid.

### Integration / E2E Tests
- [x] None added — RC3 is a pure-function tuning change to `validateParagraphRewrite` + a prompt string; no DB/service/UI surface. Full integration + E2E-critical suites still run via /finalize as a regression guard.

### Manual Verification
- [x] Conclusions cross-checked against the live staging rows via read-only `query:staging` (run, invocation, variants, metrics, logs) and against the code via Explore agents.

## Verification

### A) Playwright Verification (required for UI changes)
- [x] N/A — no UI changes (validator + prompt string only).

### B) Automated Tests
- [x] `npx jest evolution/src/lib/shared/paragraphSlots.test.ts evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.test.ts` → 46/46 pass. Plus full lint + tsc + build all green pre-finalize; full unit/ESM/integration/E2E-critical run via /finalize.

## Documentation Updates
**No doc updates required** for analysis-only — the findings live in `..._research.md`. Optional, deferred to follow-up fix projects:
- [ ] `evolution/docs/paragraph_recombine.md` — add the observed failure modes (random parent pick landing on a degenerate variant; ±10% cap admitting truncated rewrites; budget% stranded by single-agent dispatch) to the Failure-modes table, if/when fixed.
- [ ] `docs/docs_overall/debugging.md` — a "Debugging paragraph_recombine runs" recipe (the queries used here) could be added if it proves broadly useful.

## Review & Discussion
_Populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration._
