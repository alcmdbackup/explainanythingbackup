# Rebuild Coherence Pass Agent Mode A/B Configurable Progress

## Phase 0: Remove the `EVOLUTION_COHERENCE_PASS_DEFAULTS_V2` kill switch
### Work Done
- Deleted `resolveCoherencePassDefaults()` helper + `LEGACY_COHERENCE_PASS_*` constants from `ParagraphRecombineWithCoherencePassAgent.ts`. Replaced two call sites with direct `?? DEFAULT_COHERENCE_PASS_*` references.
- Removed `process.env.EVOLUTION_COHERENCE_PASS_DEFAULTS_V2` save/restore + kill-switch test in `ParagraphRecombineWithCoherencePassAgent.test.ts`. Renamed surrounding describe block from "Phase 3 — coherencePassLengthCapRatio plumbing + kill switch" to "Phase 3 — coherencePassLengthCapRatio plumbing".
- Stripped `'kill_switch'` literal from the `coherencePass.skipped` enum at `evolution/src/lib/schemas.ts`.
- Deleted the kill-switch language from `src/app/admin/evolution/strategies/new/page.tsx` `COHERENCE_PASS_DEFAULTS` comment; replaced with simpler "Mirror the agent's runtime DEFAULT_COHERENCE_PASS_* constants" + the new `coherencePassEditingMode: 'mode_b'` default.
- Deleted env-var row at `evolution/docs/reference.md`.
- Updated `evolution/docs/agents/overview.md:606` — removed kill-switch line; replaced with Mode A/B configurability note.
- Updated `evolution/docs/paragraph_recombine_with_coherence_pass.md` — replaced "Kill switch" paragraph with "No env-var kill switch" + default-resolution-semantics note.
- Cross-check grep: only two remaining references to `EVOLUTION_COHERENCE_PASS_DEFAULTS_V2` are intentional historical breadcrumbs (the agent's removal comment + the doc's removal note).

### Issues Encountered
None.

### User Clarifications
None.

## Phase 1: Schema + iter-config field
### Work Done
- Added `coherencePassEditingMode: z.enum(['mode_a', 'mode_b']).optional()` to `iterationConfigSchema` at `evolution/src/lib/schemas.ts`.
- Added `.refine()` rejecting on agent types other than `paragraph_recombine_with_coherence_pass`.
- Added `coherencePassEditingMode` to `FIELD_GATES` in `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts` (agentType-gated, emit-when-set; NO `normalizeIteration` default per plan — existing strategies that omit auto-upgrade to Mode B at runtime).
- Threaded `iterCfg.coherencePassEditingMode` into both parallel + sequential dispatch sites in `evolution/src/lib/pipeline/loop/runIterationLoop.ts`.

### Issues Encountered
None.

## Phase 2: Agent — accept new input field + Mode B branch
### Work Done
- Added `coherencePassEditingMode?: 'mode_a' | 'mode_b'` to `ParagraphRecombineWithCoherencePassInput`.
- Added `DEFAULT_COHERENCE_PASS_EDITING_MODE = 'mode_b' as const` next to other `DEFAULT_COHERENCE_PASS_*` constants.
- In `execute()`: `const effectiveEditingMode = input.coherencePassEditingMode ?? DEFAULT_COHERENCE_PASS_EDITING_MODE` + `const isRewriteMode = effectiveEditingMode === 'mode_b'`.
- Branched the per-cycle `runEditingCycle` call: Mode B passes `rewriteMode: { coalesceAndCap: false }` + new Mode B prompt builders; Mode A omits `rewriteMode` + uses original Mode A prompt builders. `driftRecovery: 'skip'` in both modes.
- Per-cycle `currentText = cycleResult.modeBContext?.normalizedSource ?? cycleResult.newText` — the multi-cycle canonicalization gotcha. Mode A falls back to `newText` (unchanged behavior).
- Mode B cycle persistence: attached `proposerMode: 'rewrite'` + `rationale` + `rewriteText` + `computedMarkup` (when present). Mirrors `IterativeEditingAgent.ts:222-231`. Mode A attaches `proposerMode: 'markup'`.
- Updated `coherencePass.config` snapshot to include `editingMode` AND `maxCycles` (the latter closes a #1282 observability gap as planned).
- Bumped `evolution/src/lib/schemas.ts:2744` zod sub-schema to require `editingMode` + `maxCycles` in `coherencePass.config`.

### Issues Encountered
None.

## Phase 3: Mode B proposer prompt
### Work Done
- Created `evolution/src/lib/core/agents/paragraphRecombineWithCoherencePass/buildCoherencePassProposerPromptModeB.ts` cloning the template from `proposerPromptRewrite.ts`.
- `FORMAT_SPEC` retains `## Rationale` (2-3 sentences) + `## Rewrite` (full article body, no CriticMarkup).
- `SCOPE_RULES` keeps heading + citation + code-fence preservation.
- `AMBITIOUS_DIRECTIVE` prepend (per Q1 user answer): "The article you're reviewing was assembled from paragraphs rewritten independently in parallel. Voice and cadence may have flattened across them; substantive structural and voice-restoration rewrites are exactly what's wanted." Before the original "Propose whatever edits…" paragraph.
- `COHERENCE_FOCUS` hint (per Q2 user answer): "Look for in particular: (a) paragraphs that start abruptly with no transition from the previous one; (b) rhetorical hooks ('Imagine a time when…') that appear in some paragraphs but get dropped in others; (c) inconsistent voice register (formal vs. casual) across adjacent paragraphs; (d) repeated explanations of the same concept that two independent rewriters both included." Inserted between `SCOPE_RULES` and `AMBITIOUS_DIRECTIVE`.
- `LENGTH_HINT` (~10% growth ceiling, same as Mode A's prompt).
- `PRESERVATION_RULES` + SELF_CHECK from the template.
- Created `evolution/src/lib/core/agents/paragraphRecombineWithCoherencePass/buildCoherencePassProposerPromptModeB.test.ts` with positive assertions for the headings, voice-restoration language, AMBITIOUS_DIRECTIVE prepend, COHERENCE_FOCUS hint, LENGTH_HINT; negative assertions for no CriticMarkup syntax tokens, no "AT MOST" / "atomic edits" / "edit budget is N" count language.

### Issues Encountered
- First negative assertion `not.toMatch(/CriticMarkup/)` failed because the prompt explicitly says "Plain markdown — no CriticMarkup, no commentary…". Relaxed to check for the actual syntax tokens (`{++`, `{--`) instead.
- `expect(prompt).toMatch(/no edit budget/i)` failed because the actual text has "no edit\n  budget" (newline). Adjusted to `/no edit\s+budget/i`.
- `expect(out).toMatch(/## Rationale.*## Rewrite/s)` triggered TS1501 (s-flag needs ES2018+). Split into two single-line matches.

## Phase 4: Wizard UI
### Work Done
- Added `coherencePassEditingMode?: 'mode_a' | 'mode_b'` to both `IterationRow` and `IterationConfigPayload` interfaces in `src/app/admin/evolution/strategies/new/page.tsx`.
- Added `coherencePassEditingMode: 'mode_b'` to `COHERENCE_PASS_DEFAULTS`.
- Added canonicalize emit clause (emit when set AND != default).
- Added dropdown UI element in the coherence-pass-only section ("· Editing mode: Mode B (rewrite-then-diff) / Mode A (CriticMarkup)") with `disabled={it.coherencePassEnabled === false}` + matching opacity-50 styling.

### Issues Encountered
None.

## Phase 5: Tests
### Work Done
- Widened `makeCycleResult` helper at `ParagraphRecombineWithCoherencePassAgent.test.ts:86-117` to spread `opts.modeBContext` when provided.
- Added parallel helper `makeModeBCycleResult(opts)` that builds a Mode-B-shaped `RunEditingCycleResult` with all `modeBContext` fields populated by default.
- Replaced the existing "Mode A invariant" test (which asserted Mode A as the default) with "Mode A pinned — runEditingCycle is called WITHOUT rewriteMode" using explicit `coherencePassEditingMode: 'mode_a'`.
- Added new describe block "Mode A / Mode B editing-mode branch" with tests for: Mode A & Mode B `runEditingCycle` arg shape, default→Mode B, `coherencePass.config.editingMode` emission, persisted Mode B cycle annotation, persisted Mode A cycle annotation, per-cycle `normalizedSource` reassignment in Mode B (the multi-cycle gotcha), Mode B failure-path stopReasons (4 parameterized cases — `proposer_format_violation`, `rewrite_too_large`, `rewrite_parse_failed`, `diff_engine_failed`).
- Added schema tests at `evolution/src/lib/schemas.test.ts` — `coherencePassEditingMode` accepts `'mode_a'` / `'mode_b'`, rejects an invalid value, rejects on non-coherence-pass agent type.
- Added `findOrCreateStrategy.test.ts` tests for `config_hash` distinctness when `coherencePassEditingMode` differs (Mode A vs Mode B → different hashes; back-compat with omitted; field stripped for non-coherence-pass agents).

### Issues Encountered
None (test failures during iteration were captured + fixed inline; final state is 7/7 suites + 427/427 tests passing).

## Phase 6: Docs
### Work Done
- `evolution/docs/paragraph_recombine_with_coherence_pass.md` — added Mode A/B rework callout under Algorithm/Phase C; replaced "Mode A only" bullet with editing-mode branching description + the Mode B canonicalization gotcha + Mode B cycle persistence notes; bumped field count from 7→8; added "Mode A / Mode B risk note" section explaining that CriticMarkup compliance is no longer load-bearing at the proposer level; added `buildCoherencePassProposerPromptModeB.ts` row in the Files table.
- `evolution/docs/multi_iteration_strategies.md` — added `coherencePassEditingMode` field row in the schema snippet; added field to the agent-type-rejection list.
- `evolution/docs/editing_agents.md` — added "Related: ParagraphRecombineWithCoherencePassAgent" section explaining the Mode A/B branching + persistence.

### Issues Encountered
None.

## Phase 7: Staging A/B + analysis
> **DEFERRED to post-merge.** Phase 7 runs the actual staging A/B via the `manual_run_experiment` skill after the Mode A/B code in this PR is deployed. Plan items in `_planning.md` reverted to unchecked.

### Local verification (pre-PR)
- `npm run lint`: warnings only (all pre-existing design-system / unused-disable nits in unrelated files).
- `npx tsc --noEmit`: clean after fixing TS1501 in the new test file.
- `npm run build`: clean.
- `jest` over touched files: 7 suites, 427 tests, all green.
