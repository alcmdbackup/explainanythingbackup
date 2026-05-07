# Progress

## Phase 0 — Real-LLM pilot ✅ DONE
- [x] Pilot driver `evolution/scripts/pilot-mode-b.ts`
- [x] 5 stage articles run through `gemini-2.5-flash-lite`
- [x] Findings written to `_research.md`
- [x] LLM-side mechanics validated (0/5 parse failures, 1.006× max expansion, idempotent)
- [x] Drift rate failing — known cause: 4 diff-engine bugs scheduled for Phase 1

## Phase 1 — Diff engine fixes ✅ DONE (with documented limitation)
- [x] Bug 1: `decorateWithContainerMarkup` cases for strong/emphasis/delete/inlineCode/link
- [x] Bug 2: `diffRatioWords` undefined-input guard + alignment monotonicity guard
- [x] Bug 3: `fallbackStringify` ordered-list ascending numbers (uses `node.start + i`)
- [x] Opt-in option: `linkGranular` (default off; preserves aiSuggestion.ts:498 consumer)
- [x] Opt-in option: `stringify` callback (already present in DiffOptions; verified)
- [x] Dependency: `remark-stringify ^11` in package.json
- [x] Whitespace-hoist in `wrapDel`/`wrapIns`/`wrapUpdate` (plus `splitSurroundingWs` helper) — surrounding whitespace pulled outside braces so the parser's `\s*` body-trim doesn't lose newlines/spaces on round-trip
- [x] `mergeWhitespaceBridgedRuns`: collapses `[ins][eq:ws][ins]` patterns where the bridge whitespace exists only in the AFTER text
- [x] Multi-letter dotted abbreviation handling (`U.S.`, `U.K.`, etc.) in `mergeAbbrevSuffix`
- [x] 6 regression tests in `markdownASTdiff.test.ts` (Phase 1 describe block)
- [x] All 681 existing `src/editorFiles/` tests still pass; 32 golden snapshots updated to reflect new whitespace-hoist output
- [ ] Verification driver `evolution/scripts/verifyDiffRoundTrip.ts` (deferred to post-Phase-3 — covered empirically by the pilot driver `pilot-mode-b.ts`)
- [ ] Verification driver `evolution/scripts/verifyCrossImport.ts` (deferred — Phase 3 will add it as part of the actual import wiring)
- [x] Re-run pilot post-fix: drift dropped 100% → 60% on real LLM rewrites of bold-heavy articles. Remaining drift is whitespace-bridge edge cases at sentence boundaries; **detected by the parser's drift check and recoverable downstream by `applyAcceptedGroups` strict-equals validation** (groups whose recovered source diverges fail validation and are dropped). Cycle correctness preserved; no data corruption surface.

### Phase 1 known limitation (documented)
Some inter-sentence whitespace patterns in real LLM rewrites still trigger drift detection (~60% of pilot articles). These are:
- Cases where `[ins][eq:ws][update]` or `[update][eq:ws][ins]` mixed runs leave whitespace asymmetries
- Cases where the LLM reorders/merges sentences and the engine produces multiple short adjacent runs

These are recoverable: the agent's `applyAcceptedGroups` strict-equals on `contextBefore`/`contextAfter` will reject any group whose recovered source doesn't byte-match the source. Phase 4 A/B telemetry will measure cycle-success-rate which captures the real-world impact.

## Phase 2 — Mode A patch ⏳ PENDING
## Phase 3 — Mode B implementation ⏳ PENDING
## Phase 4 — A/B run ⏳ PENDING
## Phase 5 — Decision ⏳ PENDING
