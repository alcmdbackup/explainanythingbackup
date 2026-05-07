# Project Plan: Add Rewrite Mode to Iterative Editing Agent

## TL;DR

A/B test two approaches to LLM-driven iterative editing on weak models (`google/gemini-2.5-flash-lite`):

- **Mode A** (existing, hardened): proposer LLM emits article + inline CriticMarkup edits. Strengthen the prompt with HARD CONSTRAINT framing + worked example + numbered self-check.
- **Mode B** (new): proposer LLM emits a short rationale + a clean rewritten article. We mechanically diff source vs rewrite via existing `RenderCriticMarkupFromMDAstDiff`, coalesce + cap groups, then feed into the existing approve/apply flow.

Same model both arms. Two distinct agent types in `iterationAgentTypeEnum` so analytics partition cleanly. Rollback via `DISABLE_ITERATIVE_EDITING_REWRITE` env flag (no schema/DB revert).

Effort: ~64 hours across 5 phases. Phase 0 (real-LLM pilot) gates Phases 1+. Decision criteria: Mode B wins if `cycleSuccessRate ≥ Mode A + 30 pts AND parent→child eloDelta ≥ 0`.

## Background

### Diagnosis from stage run `f94ea23c-3701-42cc-b8c7-f7e8d7a99824` (2026-05-06)

Strategy "Editing strategy" with config `gen → iterative_editing → iterative_editing` and proposer model `google/gemini-2.5-flash-lite`. Ran 21 editing cycles across iterations 2 + 3.

| Outcome | Cycles | Notes |
|---|---|---|
| No edits (markup ≡ source, drift_outcome=null) | 4 (19%) | Model output exact copy |
| Drift recovery fired (edits outside markup) | 16 (76%) | RULE 1 violations: paraphrase outside spans; RULE 2 violations: paraphrased `~~old~~` side |
| One applied edit | 1 (5%) | Only successful cycle |

**Failure modes observed:**

1. **Pattern A — paraphrase outside markup.** Model wraps a small change in `{++..++}` but silently rewords surrounding prose. Drift detector rejects.
2. **Pattern B — `~~old~~` side rephrased.** Model emits `{~~ rephrased version of source ~> improved version ~~}`. The "old" side doesn't match source verbatim. Parser can't locate it; drift fires.

The agent "succeeded" 100% (no errors), spent ~$0.019 on iter 2 + 3, but produced exactly 1 applied edit across 21 cycles. Top-5 final variants were all from the gen iteration; editing iterations contributed nothing to the pool.

### Why two modes

- **Mode A** keeps the architecture; we test whether a stronger prompt + structural failure-gallery + self-check can recover format compliance on weak models.
- **Mode B** removes the format burden from the LLM: it just rewrites; we compute the markup. This is the proven Cursor/Aider pattern (frontier draft + cheap apply) ported to article text.

OSS evidence (R1.C): Cursor's "frontier-draft + apply-model" cascade and Aider's edit-format history both converge on rewrite-then-diff for weak models. Aider documents Gemini-2.5-Pro requiring 3 retries on SEARCH/REPLACE; weaker variants fail more.

### Codebase already has the diff engine

`src/editorFiles/markdownASTdiff/markdownASTdiff.ts` exports `RenderCriticMarkupFromMDAstDiff(beforeAST, afterAST, options)` (1,091 LOC, ~63 tests). It produces standard CriticMarkup that's parser-compatible with `evolution/src/lib/core/agents/editing/parseProposedEdits.ts`. `unified` + `remark-parse` are already in `package.json`. We add `remark-stringify ^11` for canonicalization.

**Bugs to fix concurrently** (R2.C confirmed; R3.A re-validated):
1. `decorateWithContainerMarkup` strips `strong`/`emphasis`/`link`/`inlineCode` containers (defaults to `****` for unchanged bold). Universal corruption.
2. `diffRatioWords` crashes on sentence reorder (`TypeError` on `undefined.split` — false non-null assertion at `~line 451`).
3. `fallbackStringify` ordered-list numbering always emits `1. … 1. … 1.` instead of `1. 2. 3.`.
4. Any link change → whole-paragraph atomic blast (because `link ∈ ATOMIC_INLINE` and `containsAtomicDescendant` short-circuits paragraph-multipass). New opt-in `linkGranular` flag.

The other production consumer (`src/editorFiles/aiSuggestion.ts:373,498`) is insulated: bug-fix #1 is additive (default branch was strictly broken); #4 is opt-in. Lexical editor doesn't import the diff engine.

## Decisions Locked

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | A/B mechanism | Two distinct agent types in `iterationAgentTypeEnum`: `iterative_editing` (Mode A, existing) + `iterative_editing_rewrite` (Mode B, new) | Persists `agent_name` literally for clean analytics partition |
| 2 | Models | Same model both arms: `google/gemini-2.5-flash-lite` (proposer + approver per current strategy); approver `qwen-2.5-7b-instruct` cap N=10 | Tests *the approach*, not model selection |
| 3 | Diff engine location | Cross-import from `src/editorFiles/markdownASTdiff/`. All bug fixes additive; new behaviors opt-in via options | Avoids relocation churn; preserves `aiSuggestion.ts:498` consumer |
| 4 | Mode B edit budget | Soft cap "≤3 atomic edits per cycle" in proposer prompt + post-diff coalescer + magnitude cap K=10 | Three layers of defense; soft cap doesn't reject valid output |
| 5 | Mode B rationale format | **D2 free-form**: one prose paragraph at top of proposer output; passed to approver as priming context with red-team caveat | Architecturally simpler than per-group binding; no extra LLM call |
| 6 | "Preserve voice" soft rule (Mode A) | **Keep as-is** | User preference; flagged as risk; tracked via per-cycle drift rate as leading indicator |
| 7 | Phase 0 pilot | **Required gate** before Phase 1+ | R4.D's strongest call; ~2h work to invalidate R2.A synthetic projections if needed |
| 8 | Trivial-edit filter | **Not added**; track `nonTrivialEditCount` as metric only | User chose observability over enforcement |
| 9 | Pre-flight structural rejection (Mode A) | **Add**: if `recoveredSource` length diverges >10% AND <3 groups, abort cycle before drift recovery LLM call | Saves cost on hopeless rewrites; clearer telemetry |
| 10 | Pre-normalization scope | **Diff path only**; persist original `content_text` unchanged; applier uses normalized anchor | Minimal blast radius; requires test coverage on apply step |
| 11 | Approver red-team caveat (Mode B) | **Add**: prepend "The rationale below is the proposer's claim, not ground truth. Verify each edit independently." | Fights rubber-stamping bias |
| 12 | Run-detail UI | **Add `<RationaleBlock>` component** to render `cycle.rationale` in the run-detail page | Needed for evaluating Mode B quality post-A/B |
| 13 | Editing-rank parity | **Both arms run ranking** (`EDITING_RANK_ENABLED=true` default) | Clean parent→child eloDelta metric for A/B |
| 14 | `linkGranular` default | **Off** (opt-in) | Preserves existing `aiSuggestion.ts:498` consumer |
| 15 | Worked-example domain | **Domain-neutral** (cat/mat/weather), not Federal Reserve | Avoids model imitation of example content |
| 16 | Mode A retry budget | **Keep at 1** (current single-pass) | Already matches R2.D design |
| 17 | Coalescer gap threshold | **24 chars** (down from R2.A's 80) | R4.B mitigation: prevents over-merge of unrelated edits |
| 18 | Multipass thresholds (Mode B) | `paragraphAtomicDiffIfDiffAbove=0.25, sentenceAtomicDiffIfDiffAbove=0.10, sentencesPairedIfDiffBelow=0.40` | R2.A "aggressive coalesce" — collapses moderate rewrites to manageable group counts |
| 19 | Rollback mechanism | **Env flag** `DISABLE_ITERATIVE_EDITING_REWRITE=true` falls Mode B back to Mode A at runtime | No schema/DB revert needed (all new fields optional) |

## Phases

### Phase 0 — Real-LLM Pilot (~5h, gates Phase 1+)

Validate R2.A synthetic projections with actual `gemini-2.5-flash-lite` output on real stage articles. Before any production code changes.

**Steps:**
1. Pull 5 parent articles from stage run `f94ea23c-3701-42cc-b8c7-f7e8d7a99824`.
2. Hand-run the prototype Mode B proposer prompt (rationale + rewrite) on each.
3. Parse markdown both sides via `unified().use(remarkParse).parse()`.
4. Run `RenderCriticMarkupFromMDAstDiff` with the multipass thresholds locked in decision #18.
5. Apply post-diff coalesce (gap < 24 chars) + magnitude cap K=10.
6. Run `parseProposedEdits` against the result.
7. Measure: actual rewrite size ratio, group count post-coalesce-cap, drift rate (`recoveredSource === normalizedSource`?), success rate (any groups parse cleanly?).

**Decision gate:** Phase 1 proceeds only if pilot drift rate ≤ 3% AND group-cap fire rate ≤ 40% of cycles. If either threshold fails, redesign coalescer/cap/prompt before touching production code.

**Artifacts:**
- `evolution/scripts/pilot-mode-b.ts` — driver script
- `docs/planning/add_rewrite_mode_iterative_editing_evolution_20260507/_research.md` — pilot results

### Phase 1 — Diff engine fixes & pre-normalization (~9h)

Land the four bug fixes + new options + new dep + verification driver. All additive; default behaviors unchanged for `aiSuggestion.ts:498`.

| File | Change | Detail |
|---|---|---|
| `src/editorFiles/markdownASTdiff/markdownASTdiff.ts` | Modify `decorateWithContainerMarkup` (~line 830) | Add cases for `strong` → `**${inner}**`, `emphasis` → `*${inner}*`, `delete` → `~~${inner}~~`, `inlineCode` → `\`${inner}\``, `link` → `[${inner}](${node.url||''}${title?})` |
| `src/editorFiles/markdownASTdiff/markdownASTdiff.ts` | Modify `alignSentencesBySimilarity` (~line 287) + `buildParagraphMultiPassRuns` (~line 587, 594, 599) | Defense in depth: filter to strictly-increasing-j subsequence; guard `diffRatioWords` against undefined inputs; remove false non-null assertions |
| `src/editorFiles/markdownASTdiff/markdownASTdiff.ts` | Modify `fallbackStringify` ordered-list (~line 1035) | Use `${start + i}.` instead of always `1.`; respect `node.start` field |
| `src/editorFiles/markdownASTdiff/markdownASTdiff.ts` | Add `linkGranular?: boolean` opt-in to `MultiPassOptions` | When true, exclude `link` from atomic-descendant gate; LCS pairing handles URL-only changes via existing keyer |
| `src/editorFiles/markdownASTdiff/markdownASTdiff.ts` | Add `stringify?: (node) => string` opt-in callback to `DiffOptions` | Lets Mode B inject `remark-stringify` for canonicalization |
| `package.json` | Add `remark-stringify ^11` to dependencies | Peers cleanly with existing `remark-parse ^11.0.0` |
| `evolution/scripts/verifyDiffRoundTrip.ts` | NEW | 3–5 stage articles → normalize → diff → assert `parseProposedEdits.recoveredSource === normalized` |
| `src/editorFiles/markdownASTdiff/markdownASTdiff.test.ts` | Add 6 regression tests | bold no-op, sentence reorder no-throw, ordered-list ascending, linkGranular toggle, citation insertion granular, paragraph-with-link granular when flag on |

**Editor-safety check:** R3.A confirmed `lexicalEditor/` doesn't import the diff engine; the existing golden test (`aiSuggestion.golden.test.ts`) uses a hand-rolled regex AST without `strong`/`emphasis`/`link` nodes, so bug-fix #1 isn't reflected in existing snapshots — but isn't broken by them either. Add a new real-AST regression test (Phase 3 test plan) so `aiSuggestion.ts:498` regressions get caught.

### Phase 2 — Mode A patch (~6h)

Strengthen the existing proposer; harden the parser.

| File | Change | Detail |
|---|---|---|
| `evolution/src/lib/core/agents/editing/proposerPrompt.ts` | Rewrite | Lead with `HARD_CONSTRAINT` block stating two RULES (RULE 1: outside-markup byte-for-byte fidelity; RULE 2: `~~old~~` side copied verbatim from source). `<source>...</source>` delimiters in user prompt. `FAILURE_GALLERY` with paired BAD/GOOD micro-examples (domain-neutral content per decision #15). 3-sentence `WORKED_EXAMPLE`. `EDIT_BUDGET: ≤3 atomic edits per cycle`. Existing soft rules retained (decision #6). Numbered concrete `SELF_CHECK`. |
| `evolution/src/lib/core/agents/editing/parseProposedEdits.ts` | Modify | (a) Optional `<output>...</output>` wrapper strip (delimiter leakage). (b) Whitespace tolerance for `{ ++` / `++ }` / `~~ }` (gemini-flash-lite quirks). |
| `evolution/src/lib/core/agents/editing/IterativeEditingAgent.ts` | Modify (~line 207) | Add pre-flight structural rejection: if post-parse `recoveredSource.length` diverges from `currentText.length` by >10% AND `proposedGroupsRaw.length < 3`, set `stopReason='structural_rewrite'` and skip the drift-recovery LLM call. |
| `evolution/src/lib/core/agents/editing/proposerPrompt.test.ts` | Update | 5 new assertions: HARD_CONSTRAINT present, two RULE labels, `<source>`/`<output>` delimiters, worked example, numbered self-check, 3-edit cap mentioned, BAD/GOOD pairs |
| `evolution/src/lib/core/agents/editing/parseProposedEdits.test.ts` | Update | 2 new tests: `<output>` wrapper strip; whitespace tolerance |

No changes to `recoverDrift.ts` / `checkProposerDrift.ts` (existing single-pass retry already matches the design per R3.C / decision #16).

### Phase 3 — Mode B implementation (~29h)

New agent type; full integration; UI; tests.

#### 3.1 Schema & types (~2h)

| File | Change | Detail |
|---|---|---|
| `evolution/src/lib/schemas.ts` | Modify (~line 478) | Add `'iterative_editing_rewrite'` to `iterationAgentTypeEnum`. Update helper functions (`canBeFirstIteration`, `isVariantProducingAgentType`, `producesNewVariants`) to treat it like `iterative_editing` |
| `evolution/src/lib/schemas.ts` | Modify | Extend `iterationConfigSchema` with optional `editingProposerSoftCap?: z.number().int().min(1).max(5).default(3)`. Refine: only valid when `agentType === 'iterative_editing_rewrite'` |
| `evolution/src/lib/schemas.ts` | Modify | Extend `editingCycleSchema` with optional `proposerMode`, `rationale`, `rewriteText`, `computedMarkup` |
| `evolution/src/lib/types.ts` | Modify | Mirror schema additions on `EditingCycle` and `IterativeEditingExecutionDetail` interfaces |

All new fields optional. No DB migration; lives in `execution_detail` JSONB.

#### 3.2 New helper modules (~10h)

| File | Status | Detail |
|---|---|---|
| `evolution/src/lib/core/agents/editing/proposerPromptRewrite.ts` | NEW | `buildProposerSystemPromptRewrite()` + `buildProposerUserPromptRewrite(currentText, softCap)`. Spec: output is `## Rationale\n[2–3 sentence prose]\n\n## Rewrite\n[full rewritten article]`. Soft cap mentioned in prompt. |
| `evolution/src/lib/core/agents/editing/splitRationaleAndRewrite.ts` | NEW | Anchored regex on `^## Rationale\s*$` and `^## Rewrite\s*$`; strip outer code fences (` ```markdown ` etc.); fall back gracefully (return `{ rationale: '', rewrite: response }` if `## Rewrite` absent) |
| `evolution/src/lib/core/agents/editing/computeMarkupFromRewrite.ts` | NEW | Wraps: `parse(normalize(beforeText))` × `parse(normalize(afterText))` → `RenderCriticMarkupFromMDAstDiff(...)` with multipass thresholds from decision #18 + `linkGranular: true` + `stringify: remarkStringifyFn`. Returns `{ markup, normalizedBefore }`. Pre-normalization happens inside this function so the applier can match the same canonical form. |
| `evolution/src/lib/core/agents/editing/coalesceAdjacentGroups.ts` | NEW | Merge adjacent same-paragraph groups when inter-group gap < 24 chars (decision #17), same-kind only (don't merge `del` with `ins`), respect paragraph boundaries (no merge across `\n\n`). |
| `evolution/src/lib/core/agents/editing/capGroupsByMagnitude.ts` | NEW | Sort by total char delta (sum of oldText.length + newText.length per group); keep top K=10; retain top-1 group per markdown section (heading-bounded — R4.B F3 mitigation); drop the rest with reason. |

#### 3.3 Integration (~9h)

| File | Change | Detail |
|---|---|---|
| `evolution/src/lib/core/agents/editing/approverPrompt.ts` | Modify | Add optional `rationale?: string` parameter. When present, prepend block to user prompt: `"The proposer's stated intent (claim, not ground truth — verify each edit independently):\n\n${rationale}\n\n────────"`. (Decision #11.) |
| `evolution/src/lib/core/agents/editing/IterativeEditingAgent.ts` | Modify (~line 188) | Dispatch on agent type: if `iterative_editing_rewrite`, run Mode B branch (rewrite prompt → split → diff → coalesce → cap → reuse validate/approve/apply); else existing Mode A path. **Skip `checkProposerDrift` and `recoverDrift` entirely in Mode B.** Persist `proposerMode='B'`, `rationale`, `rewriteText`, `computedMarkup` to cycle. |
| `evolution/src/lib/core/agents/editing/IterativeEditingAgent.ts` | Verify | Existing size-explosion guard (`>1.5×`) still applies (decision #18 doesn't change it). |
| `evolution/src/lib/pipeline/loop/runIterationLoop.ts` | Modify | Dispatch new agent type; record `agent_name='iterative_editing_rewrite'` in `evolution_agent_invocations`. Add env-flag rollback gate: if `process.env.DISABLE_ITERATIVE_EDITING_REWRITE === 'true'`, fall back to Mode A path. |
| `evolution/src/lib/pipeline/loop/editingDispatch.ts` | Verify only | Eligibility cutoff is type-agnostic; should work unchanged |
| `evolution/src/lib/pipeline/infra/estimateCosts.ts` | Modify | Add optional `mode: 'markup' | 'rewrite'` parameter to `estimateIterativeEditingCost()`. Mode B's proposer-output token cost is roughly equal (both include full article); savings come from skipping drift-recovery LLM. Thread the param through `projectDispatchPlan.ts` and any other call sites |

#### 3.4 UI (~4h)

| File | Change | Detail |
|---|---|---|
| `src/app/admin/evolution/strategies/new/page.tsx` | Modify | Extend `IterationRow.agentType` and `IterationConfigPayload.agentType` unions to include `'iterative_editing_rewrite'`. Verify the dropdown source is auto-derived from the enum (R3.B uncertain — confirm during impl); if hardcoded, add new option. Conditionally show `editingProposerSoftCap` field for the new type. |
| `src/app/admin/evolution/strategies/new/page.tsx` | Modify | `toIterationConfigsPayload()`: thread `editingProposerSoftCap` for rewrite mode |
| Run-detail UI (TBD path; search `src/app/admin/evolution/runs/`) | Modify or NEW component | Add `<RationaleBlock>` rendering `cycle.rationale` and (collapsible) `cycle.rewriteText` when `cycle.proposerMode === 'B'` |

#### 3.5 Tests (~4h)

See Test Plan section below; ~30 new tests across unit, integration, and golden-snapshot layers.

### Phase 4 — A/B run on stage (~12h, observed)

Two strategies on stage, identical except `agentType`:

- **Strategy A:** seed config matching the failing stage run; `agentType: 'iterative_editing'` (Mode A hardened)
- **Strategy B:** same; `agentType: 'iterative_editing_rewrite'` (Mode B)

Same seed corpus, iteration count, budget per invocation, models. N ≥ 50 invocations per arm (rough significance threshold for binomial test on 30-pp delta).

**Metrics tracked (per arm):**

Primary:
- `cycleSuccessRate` = cycles_with_applied_edits / total_cycles
- `editsAppliedPerSuccessfulCycle` (mean)
- `costUsdPerAppliedEdit`
- `parentToChildEloDelta` (mean, where final variant was ranked)

Secondary / diagnostic:
- `driftRate` (Mode A only; should converge near 0)
- `approverAcceptRate`
- `groupCountDistribution` (p50, p95, max — pre-cap and post-cap)
- `coalescingFireRate` (Mode B only — fraction of cycles where coalescer/cap drops ≥1 group)
- `recoverySuccessRate` (Mode A only)
- `nonTrivialEditCount` (Mode A only — sentinel for cosmetic-edit inflation per decision #8)
- `editingRankCost` (both arms)

### Phase 5 — Decision (~3h)

**Mode B wins** if:
- `cycleSuccessRate(B) ≥ cycleSuccessRate(A) + 30 pp` AND
- `parentToChildEloDelta(B) ≥ 0` (no quality regression).

**Mixed-result playbook:**

| Result | Action |
|---|---|
| B success ≥ +30pp, eloDelta neutral/positive | Ship B; deprecate A (or keep as fallback) |
| B success much higher, but eloDelta significantly negative | Investigate. Possibly add D3 (post-hoc rationale binding) or tune coalescer; rerun |
| B drift rate non-zero | Halt; root-cause diff-engine bug we missed; re-test |
| Both similar | Keep A (existing); don't ship more code; document Mode B as future option |
| B per-edit cost much higher than A | Profile coalescer overhead; tune K cap |

## Test Plan

Total: ~30 new tests across phases. Existing tests must continue to pass (Mode A regression).

### Phase 1 — diff engine regression (6 tests)

In `src/editorFiles/markdownASTdiff/markdownASTdiff.test.ts`:

1. `preserves wrapper markup when only inner text changes` — `paragraph[strong["before"]]` vs `paragraph[strong["after"]]` produces output containing `**` exactly twice, never `****`.
2. `does not crash on reordered sentences` — `'A. B.'` → `'B. A.'` returns defined output.
3. `fallbackStringify ordered list ascends` — input ordered list with 3 items produces `1. … 2. … 3.`.
4. `respects ordered-list start field` — list with `start: 5` produces `5. 6. 7.`.
5. `linkGranular default (off): link URL change → paragraph atomic` (regression for existing behavior).
6. `linkGranular=true: link URL change → granular link-scoped markup`, surrounding paragraph text byte-identical.

### Phase 1 — round-trip integration (1 driver + 5 articles)

`evolution/scripts/verifyDiffRoundTrip.ts` tests for each of 5 stage articles:
- Normalize source via `remark-stringify` → `parse` → produce small synthetic edit → diff → strip markup → assert `recoveredSource === normalizedSource`.

### Phase 2 — Mode A unit + integration (5 + 2 tests)

`proposerPrompt.test.ts`:
1. Embeds HARD_CONSTRAINT with both RULE 1 and RULE 2 labels.
2. User prompt wraps source in `<source>...</source>` delimiters.
3. Includes a worked example with `<output>` shown.
4. Mentions "at most 3 atomic edits".
5. Self-check is numbered with concrete steps (mentally delete additions, mentally keep deletions, compare to source).

`parseProposedEdits.test.ts`:
6. Strips `<output>...</output>` wrapper before parsing.
7. Tolerates `{ ++`, `++ }`, `~~ }` whitespace variants.

### Phase 3 — Mode B unit (4 new test files, ~14 tests)

`splitRationaleAndRewrite.test.ts`:
1. Happy path — both blocks extracted.
2. Missing `## Rationale` — returns empty rationale + full content as rewrite.
3. Missing `## Rewrite` — falls back to `{ rationale: '', rewrite: response }`.
4. Malformed headers (lowercase, extra whitespace) — handled.
5. Code-fenced response (` ```markdown ` wrap) — fence stripped before split.

`coalesceAdjacentGroups.test.ts`:
6. Two adjacent same-paragraph same-kind groups within 24 chars — merge to one.
7. Same setup but separated by 30 chars — stay separate.
8. Adjacent del + ins (different kinds) — don't merge.
9. Adjacent groups across paragraph boundary — don't merge.

`capGroupsByMagnitude.test.ts`:
10. 15 groups → top-10 by char delta retained, 5 dropped with reasons.
11. Top-1-per-section retention — even if section's top group is small char-delta, it survives the cap.

`proposerPromptRewrite.test.ts`:
12. Includes `## Rationale` and `## Rewrite` headers.
13. Mentions soft cap "at most 3 changes".
14. User prompt embeds source in `<source>` delimiters.

### Phase 3 — Mode B integration (5 tests)

`IterativeEditingAgent.modeB.test.ts`:
15. Full Mode B cycle: synthetic small markdown, mocked LLM returning rationale+rewrite, agent produces a finalVariant with ≥1 applied group.
16. Proposer output missing rationale → empty rationale field, rewrite still flows through.
17. Proposer output missing rewrite → bail with `stopReason='proposer_format_violation'`.
18. Diff produces 20 groups → coalesce + cap fires → exactly 10 groups reach approver.
19. Multi-cycle invariance — after cycle 1 applies, cycle 2's normalize-then-diff round-trips against cycle-1's applied output (no compounding drift).

### Phase 3 — applyAcceptedGroups context-match (1 critical test)

`applyAcceptedGroups.test.ts`:
20. **Pre-normalization vs apply-step strict-equals.** `parseProposedEdits(generatedMarkup, normalized).recoveredSource === normalized` byte-for-byte; AND `applyAcceptedGroups` strict-equals checks against the normalized text succeed. (R4.B F1 — load-bearing risk.)

### Phase 3 — schema refine + cost estimator (2 tests)

`schemas.test.ts` (or relevant):
21. Config with `agentType='iterative_editing_rewrite' AND editingProposerSoftCap=3` validates; with `agentType='iterative_editing' AND editingProposerSoftCap=3` rejects.

`estimateCosts.test.ts`:
22. `estimateIterativeEditingCost({ mode: 'markup' })` matches existing behavior; `mode: 'rewrite'` produces a similar but distinct projection (saves drift-recovery LLM cost).

### Phase 3 — E2E (2 tests)

`src/__tests__/e2e/specs/09-admin/admin-evolution-iterative-editing.spec.ts`:
23. Wizard exposes `iterative_editing_rewrite` as a selectable agent type.
24. Strategy created with the new agent type successfully runs one cycle on stage.

### Slow-suite designation

Idempotency sweep over 100 stage articles (R4.B F15 mitigation): designate `>5s`. Place in a separate `it.slow(…)` block or under a `nightly:test` script.

## Risk Register (top 10)

| ID | Mode | Description | P | I | Mitigation | Owner |
|---|---|---|---|---|---|---|
| R1 | B | Pre-normalization vs apply-step strict-equals mismatch (silent zero-edit cycle) | High | High | Test #20 above; gate Phase 3 on it | `computeMarkupFromRewrite.ts` + `applyAcceptedGroups.ts` |
| R2 | B | Paragraph-atomic produces group with > `AGENT_MAX_ATOMIC_EDITS_PER_GROUP` atomic edits → validator drops whole group → wasted cycle | High | High | Diff engine: when `paragraphAtomic=true`, collapse to single `replace` covering whole paragraph (per R4.B F4) | `markdownASTdiff.ts` Phase 1 |
| R3 | A | Free-form rewrite despite HARD_CONSTRAINT (existing failure mode) | High | High | Pre-flight structural rejection (decision #9) + new prompt (Phase 2) + observable `nonTrivialEditCount` | `IterativeEditingAgent.ts` + `proposerPrompt.ts` |
| R4 | A | Cosmetic null-edits inflate `cycleSuccessRate` (per decision #8 we don't filter) | Med | High | Track `nonTrivialEditCount`; A/B dashboard surfaces it; revisit decision #8 if signal poor | `parseProposedEdits.ts` (metric only) |
| R5 | B | Coalescer over-merges unrelated edits | High | Med | Gap = 24 chars (down from 80); same-kind only; paragraph-boundary aware | `coalesceAdjacentGroups.ts` test #7–9 |
| R6 | B | Magnitude cap drops most-valuable edit | High | Med | Top-1-per-heading-section retention (R4.B F3) | `capGroupsByMagnitude.ts` test #11 |
| R7 | A | Soft rule "preserve voice" conflicts with HARD_CONSTRAINT (kept per decision #6) | Med | Med | Track per-cycle drift rate; revisit if Mode A drift doesn't improve materially | Phase 4 dashboard |
| R8 | B | Cycle-2 normalization drift compounds | Med | High | Multi-cycle invariance test #19 + idempotency property test on production corpus | `computeMarkupFromRewrite.ts` |
| R9 | B | Approver rubber-stamps from positive-priming bias on rationale | Med | Med | Red-team caveat in approver prompt (decision #11); track approverAcceptRate per arm | `approverPrompt.ts` Phase 3 |
| R10 | B | `execution_detail` JSONB bloat from persisted rationale + rewriteText | Med | Med | Truncate rewriteText to first 8 KB on persist if needed (revisit if seen in stage) | `IterativeEditingAgent.ts` Phase 3 |

(15 lower-priority risks tracked in R4 outputs; not enumerated here.)

## Rollback Plan

**Decision criteria for rollback during Phase 4:**
- Mode B `cycleSuccessRate` drops below baseline run on stage by >15 pp within first hour
- Any production strategy fails to launch with `iterStopReason ∉ {'completed', 'iteration_converged'}` for >20% of runs
- HARD_CONSTRAINT violation detected in >5% of Mode A edits (regression of Mode A hardening)
- Approver acceptance rate >95% sustained for 3+ hours (rubber-stamping in either arm)

**Soft rollback (default; ~2 min):**
1. Set `DISABLE_ITERATIVE_EDITING_REWRITE=true` in stage/prod env vars.
2. Restart affected pods.
3. All Mode B invocations short-circuit to Mode A (R-gate at `runIterationLoop.ts` dispatch); existing strategies and pool unaffected.
4. Mode B cycles already persisted remain in DB; analytics joins still work.

**Hard rollback (~10 min) — only if soft fails:**
1. `git revert` the Phase 3 commits.
2. Existing data with `agent_name='iterative_editing_rewrite'` still readable (schema fields are optional and Zod tolerates absence).
3. `evolution_agent_invocations.agent_name='iterative_editing_rewrite'` rows: filter out from analytics until next Mode B attempt.

**Communication template (operators):**
```
ROLLBACK: Mode B iterative editing disabled (env flag). Existing Mode A
strategies unaffected. Mode B data already collected remains queryable.
Investigation in [link]. Re-enable target: TBD.
```

## Open Issues / Future Work (deferred to v2)

- **D3 rationale binding** — second LLM call to map rationale points to mechanical groups. Add if Mode B's approver-decision quality is poor.
- **Per-cycle timeline UI visualization** of edit cycles (already deferred from `bring_back_editing_agents` plan).
- **Trivial-edit filter** (decision #8 deferred). Revisit if `nonTrivialEditCount` metric shows substantial inflation.
- **Domain-anchored worked examples** — inject the article topic into Mode A prompt each cycle (R4.A #4) to fight content imitation in domain-specific runs.
- **Gemini context caching** for the static system prompt block (R2.D). Requires `LLMCompletionOptions` extension; deferred.
- **Mode A v2 prompt** — if Mode A drift rate doesn't improve materially in Phase 4, revisit decision #6 (the "preserve voice" soft rule).

## Effort Summary

| Phase | Effort (h) | Critical path? |
|---|---|---|
| 0 — Real-LLM pilot | 5 | Yes — gates Phase 1+ |
| 1 — Diff engine fixes | 9 | Yes |
| 2 — Mode A patch | 6 | Parallelizable with Phase 1 |
| 3 — Mode B implementation | 29 | Depends on Phases 1 + 2 |
| 4 — A/B run on stage | 12 (observed) | Depends on Phase 3 |
| 5 — Decision | 3 | Depends on Phase 4 |
| **Total** | **~64** | ~2 weeks at sustained 30h/wk |

## Next Steps

1. Approve plan (or request edits).
2. Kick off Phase 0 pilot. ~5h to drift-rate decision gate.
3. If pilot passes, Phases 1 + 2 in parallel (separate PRs); Phase 3 once both land.
