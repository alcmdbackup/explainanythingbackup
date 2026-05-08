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
| 20 | Agent-level dispatch | **Sibling class** `IterativeEditingRewriteAgent extends IterativeEditingAgent` with `readonly name = 'iterative_editing_rewrite'` and `protected isRewriteMode = true`. Parent `IterativeEditingAgent` keeps `readonly name = 'iterative_editing'`. Shared cycle/validate/approve/apply logic in parent's protected helpers; the rewrite branch lives in an overridable `runProposerCycle()` method. `Agent.run()` writes `agent_name` from `this.name` (`Agent.ts:54`), so analytics partition correctly without any base-class change | `Agent.name` is `abstract readonly` (`evolution/src/lib/core/Agent.ts:14`); we MUST use a subclass to write a different `agent_name`. Sibling pattern reuses ~95% of code; mode-specific divergence isolated to `runProposerCycle` |
| 21 | Env-flag read semantics | **Per-invocation read** at agent instantiation in `runIterationLoop.ts:786`. If `DISABLE_ITERATIVE_EDITING_REWRITE='true'`, instantiate the parent `IterativeEditingAgent` (Mode A) regardless of `iterCfg.agentType`. Existing pods running mid-cycle finish in their pre-flip mode (atomic per invocation); subsequent invocations see fresh env. Multi-pod rollout: cooperative graceful drain expected for full rollback | Atomic-per-invocation rollback semantics. Documented as a non-preemptive flag (mid-cycle invocations don't abort) |
| 22 | Cross-tree import policy | `evolution/src/lib/core/agents/editing/computeMarkupFromRewrite.ts` imports from `src/editorFiles/markdownASTdiff/`. **Verified:** no `eslint-plugin-import` boundary rule rejects this; existing tree resolves via tsconfig `paths`. Document as a sanctioned exception in this plan; do not generalize | Avoids relocating 1,091-LOC engine; keeps the existing `aiSuggestion.ts:498` consumer's import path stable |
| 23 | A/B statistical test | One-tailed binomial test on cycle-success-rate delta. α = 0.05. Required N derived from observed Mode A baseline; sample-size table in Phase 4. If observed Mode A baseline approaches 0% (today's reality), the absolute threshold of "+30 pp" is achievable; if Mode A baseline rises with the prompt strengthening to e.g. 60%, threshold becomes 90% (capped at realistic ceiling). | Specific decision rule; avoids Phase 5 ambiguity |

## `runProposerCycle` contract

The seam between parent and Mode B subclass is a single protected method. Contract:

```ts
type ProposerCycleResult =
  | {
      kind: 'success';
      proposedMarkup: string;            // CriticMarkup string fed into parseProposedEdits
      parseResult: ParseResult;          // groups + dropped + recoveredSource
      // Mode B only:
      proposerMode?: 'rewrite';
      rationale?: string;
      rewriteText?: string;              // TRUNCATED to 8 KB if longer
      computedMarkup?: string;           // identical to proposedMarkup; persisted for forensics
      normalizedBefore?: string;         // (Mode B only) the canonical-form source the diff was computed against; the parent's getCurrentTextForParse seam returns this in lieu of current.text
      // Mode A only:
      driftRecoveryDetails?: EditingCycle['driftRecovery'];
      droppedPreApprover?: EditingDroppedGroup[];
    }
  | {
      kind: 'aborted';
      stopReason: IterativeEditingStopReason;  // 'proposer_format_violation' | 'rewrite_parse_failed' | 'rewrite_too_large' | 'proposer_drift_unrecoverable' | etc.
      proposerMode?: 'markup' | 'rewrite';
      // Forensic fields (populated based on stopReason):
      proposedMarkup?: string;
      rewriteText?: string;
      errorMessage?: string;
      errorContext?: { type: string; message: string; line?: number; col?: number };  // serialized originalError
    };

protected async runProposerCycle(
  current: { text: string },
  ctx: AgentContext,
  cycleNumber: number,
): Promise<ProposerCycleResult>;
```

The parent's `execute()` loop calls this method, then converges:

```text
const result = await this.runProposerCycle(current, ctx, cycleNumber);
if (result.kind === 'aborted') {
  cycles.push(buildCycle({ ..., ...result, approverGroups: [], reviewDecisions: [], appliedGroups: [] }));
  break; // exit cycle loop with stopReason
}
// On success: parent runs validate → approver → apply against the proposer's output:
const sourceForParse = this.getCurrentTextForParse(current.text, result);
const parseResult = result.parseResult; // already computed inside runProposerCycle (Mode B did the diff itself)
const validation = validateEditGroups(parseResult.groups, sourceForParse);
const approverGroups = validation.approverGroups;
const reviewDecisions = await callApproverLLM(...); // Mode B passes result.rationale into approver prompt
const accepted = filterAccepted(approverGroups, reviewDecisions);
const applyResult = applyAcceptedGroups(accepted, sourceForParse);
cycles.push(buildCycle({ ..., ...result, approverGroups, reviewDecisions, appliedGroups: accepted }));
current.text = applyResult.newText;
```

**Field-population responsibility table:**

| Field | Mode A populates | Mode B populates | Parent fills in |
|---|---|---|---|
| `proposedMarkup` | yes (LLM output) | yes (computed markup from diff) | — |
| `parseResult` | yes (post-drift-recovery) | yes (post-coalesce-cap) | — |
| `rationale`, `rewriteText`, `computedMarkup` | n/a | yes | — |
| `proposerMode` | `'markup'` | `'rewrite'` | — |
| `driftRecoveryDetails`, `droppedPreApprover` | yes | n/a (not used) | — |
| `approverGroups`, `reviewDecisions`, `appliedGroups` | — | — | yes |
| `stopReason` (on abort) | yes | yes | — |
| `cycleNumber` | — | — | yes |

**`current.text` mutation contract (single source of truth):**
- The parent's `execute()` loop owns `current.text` and is the *only* place that ever assigns to it. The assignment happens AFTER `applyAcceptedGroups` succeeds in the loop iteration (existing behavior, unchanged).
- Neither `runProposerCycle` (Mode A or Mode B) mutates `current.text`. Mode B's helper `computeMarkupFromRewrite` returns `{ markup, normalizedBefore }`; the subclass attaches `normalizedBefore` to the `ProposerCycleResult` it returns.
- The parent's loop reads `current.text` at the top of each iteration, passes it to `runProposerCycle`, gets back `ProposerCycleResult`, and then calls `parseProposedEdits(result.proposedMarkup, this.getCurrentTextForParse(current.text, result))`. The seam method receives both `current.text` and the result so it can return `result.normalizedBefore` in Mode B and `current.text` in Mode A.
- The seam is invoked at exactly two sites in the parent's loop: at `IterativeEditingAgent.ts:207` (the initial parse) and at `:241` (the re-parse after drift recovery; Mode B never reaches this site since it has no drift recovery, so the seam doesn't fire there for Mode B).
- After `applyAcceptedGroups`, the parent updates `current.text = applyResult.newText` (existing behavior). For Mode B, `applyResult.newText` is computed against `normalizedBefore + accepted edits`, so it's already in canonical form going into cycle 2. Cycle-2 invariance test (#19) verifies this.

**Earlier draft of this section had a contradiction (line 131 said "Mode B does NOT mutate" while a code sketch showed `current.text = computed.normalizedBefore`). The contradiction is resolved as above: Mode B never mutates the parent's `current.text`; it threads `normalizedBefore` through the `ProposerCycleResult` and the parent uses the seam to consume it.**

`originalError` serialization: when persisting `errorContext`, run a defensive sanitizer:

```ts
function serializeError(e: unknown): { type: string; message: string; line?: number; col?: number } {
  try {
    if (!e || typeof e !== 'object') return { type: 'Unknown', message: String(e).slice(0, 500) };
    const err = e as { name?: string; message?: string; line?: number; column?: number; position?: { start?: { line?: number; column?: number } } };
    // Read each field through its own try/catch in case it's a getter that throws
    let type = 'Error';
    try { type = String(err.name ?? 'Error').slice(0, 100); } catch { /* getter threw */ }
    let message = '';
    try { message = String(err.message ?? '').slice(0, 500); } catch { /* getter threw */ }
    let line: number | undefined;
    try { const l = err.line ?? err.position?.start?.line; if (typeof l === 'number' && Number.isFinite(l)) line = l; } catch { /* ignore */ }
    let col: number | undefined;
    try { const c = err.column ?? err.position?.start?.column; if (typeof c === 'number' && Number.isFinite(c)) col = c; } catch { /* ignore */ }
    return {
      type,
      message,
      ...(line !== undefined ? { line } : {}),
      ...(col !== undefined ? { col } : {}),
    };
  } catch {
    // Catastrophic failure (e.g. Proxy that throws on every access) — last-resort fallback
    return { type: 'Error', message: 'Serialization failed' };
  }
}
```

This avoids leaking file paths, stack traces, or cyclic-reference content to the run-detail UI; cap at 500 chars per message; cyclic and getter-throw resistant.

## Architecture: Sibling-class dispatch

Per Decision #20, Mode B is a subclass that reuses the parent's cycle machinery:

```text
class IterativeEditingAgent extends Agent<...> {
  readonly name = 'iterative_editing';
  protected get isRewriteMode(): boolean { return false; }

  async execute(input, ctx) {
    // ... existing per-cycle setup (budget, model resolution, snapshots) ...
    for (let cycleNumber = 1; cycleNumber <= maxCycles; cycleNumber++) {
      const cycle = await this.runProposerCycle(current, ctx, cycleNumber);
      // ... validate → approver → apply (shared) ...
    }
  }

  protected async runProposerCycle(current, ctx, cycleNumber): Promise<EditingCycle> {
    // Mode A: existing markup-emit path (proposerPrompt → parse → drift recovery)
  }
}

class IterativeEditingRewriteAgent extends IterativeEditingAgent {
  readonly name = 'iterative_editing_rewrite';
  protected get isRewriteMode(): boolean { return true; }

  protected async runProposerCycle(current, ctx, cycleNumber): Promise<EditingCycle> {
    // Mode B: rewrite + rationale + diff
    const proposerSys = buildProposerSystemPromptRewrite();
    const proposerUser = buildProposerUserPromptRewrite(current.text, this.softCap);
    const raw = await llm.complete(...);
    const { rationale, rewrite, parseFailed } = splitRationaleAndRewrite(raw);
    if (parseFailed && !rewrite) {
      return { cycleNumber, stopReason: 'proposer_format_violation', proposerMode: 'rewrite', ... };
    }
    let computed;
    try {
      computed = computeMarkupFromRewrite(current.text, rewrite, options);
    } catch (e) {
      // RewriteParseError preserves originalError; persist for forensics
      return { cycleNumber, stopReason: 'rewrite_parse_failed', errorMessage: e.message, originalError: e.originalError, ... };
    }
    // The subclass does NOT mutate current.text. It threads normalizedBefore through
    // the result; the parent's loop calls this.getCurrentTextForParse(current.text, result)
    // to obtain the canonical anchor for parseProposedEdits + applyAcceptedGroups.
    const parseResult = parseProposedEdits(computed.markup, computed.normalizedBefore);
    // Skip checkProposerDrift / recoverDrift entirely
    let groups = coalesceAdjacentGroups(parseResult.groups, computed.normalizedBefore);
    groups = capGroupsByMagnitude(groups, 10);
    return {
      kind: 'success',
      cycleNumber,
      proposerMode: 'rewrite',
      proposedMarkup: computed.markup,
      parseResult,
      normalizedBefore: computed.normalizedBefore,  // threaded for the parent's seam to consume
      rationale,
      rewriteText: truncate(rewrite, 8192),
      computedMarkup: computed.markup,
    };
  }
}
```

`runIterationLoop.ts:786` instantiates one or the other:

```text
} else if (iterType === 'iterative_editing' || iterType === 'iterative_editing_rewrite') {
  const disableRewrite = process.env.DISABLE_ITERATIVE_EDITING_REWRITE === 'true';
  const useRewrite = iterType === 'iterative_editing_rewrite' && !disableRewrite;
  const { IterativeEditingAgent, IterativeEditingRewriteAgent } = await import('../../core/agents/editing/...');
  const agent = useRewrite ? new IterativeEditingRewriteAgent() : new IterativeEditingAgent();
  // agent.name is automatically the correct literal; agent_name in DB is correct.
}
```

Both branches re-converge at the parent's `validate → approver → applyAcceptedGroups`. Approver receives `rationale` as priming context with the red-team caveat (Decision #11) when `cycle.proposerMode === 'rewrite'`.

## Error handling contract

| Helper | Failure mode | Behavior |
|---|---|---|
| `splitRationaleAndRewrite` | `## Rewrite` header missing | Return `{ rationale: '', rewrite: response, parseFailed: true }`. `parseFailed=true` signals the caller to be cautious; downstream `computeMarkupFromRewrite` will succeed if `response` happens to parse as markdown, or fail with a typed error otherwise |
| `splitRationaleAndRewrite` | Both headers missing AND `response` is an LLM refusal (e.g. `"I cannot help with that"`, `"I'm unable to..."`) | Same return shape as above. **Disambiguation happens via `cycle.rewriteText` persistence** — operators can read the persisted text to distinguish refusal from genuine parse error. We do *not* heuristically classify refusals (false positives risk hiding real LLM bugs). All such cases persist `stopReason='rewrite_parse_failed'` with `cycle.rewriteText` containing the refusal text |
| `computeMarkupFromRewrite` | `unified().use(remarkParse).parse()` throws on either text | Wrap in try/catch; rethrow as `class RewriteParseError extends Error { constructor(message, public readonly originalError: unknown, public readonly side: 'before'\|'after') }`. Agent catches at the call site, sets `stopReason='rewrite_parse_failed'`, persists `cycle.rewriteText`, `cycle.errorMessage = err.message`, `cycle.errorContext = serializeOriginalError(err.originalError)` for forensics. The `originalError` preserves the original parser's line/col detail |
| `computeMarkupFromRewrite` | Diff engine throws | Same handling — `class DiffEngineError extends Error { ... originalError: unknown ... }`; agent sets `stopReason='diff_engine_failed'` |
| `computeMarkupFromRewrite` | Diff produces empty markup (no groups; rewrite ≡ source after normalization) | Return `{ markup: '', groups: [], normalizedBefore }`; agent treats as a no-edit cycle (no error). Track a `rewrite_no_change_cycles` metric to surface trivial-rewrite behavior |
| `coalesceAdjacentGroups`, `capGroupsByMagnitude` | Invariants violated (overlap, duplicate IDs) | Throw assertion; bug-bug. Tests cover happy-path + boundary cases |
| Long rewrite text | `rewriteText` > 8 KB | Truncate at the agent's cycle-construction step before persistence (`cycle.rewriteText = rewrite.slice(0, 8192)`). The full rewrite is still used for the diff (in-memory only). Test #29 verifies truncation |
| Adversarial rewrite (potential ReDoS, very large input) | `rewrite.length` > 100 KB OR contains pathological regex-trigger sequences | Reject before parsing: agent sets `stopReason='rewrite_too_large'`. 100 KB ≫ any realistic article (largest seen on stage was 15 KB) |

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

**Decision gate:** Phase 1 proceeds only if **all four** thresholds are met:
1. **Drift rate ≤ 3%** — fraction of cycles where `parseProposedEdits(computedMarkup, normalizedBefore).recoveredSource !== normalizedBefore`
2. **Cap-fire-rate ≤ 40%** — fraction of cycles where the magnitude cap drops ≥ 1 group
3. **Idempotency proof on the 5 stage articles AND a synthetic markdown-feature checklist:** `normalize(normalize(x)) === normalize(x)` must hold on (a) all 5 stage articles and (b) the following synthetic constructs each in their own fixture:
   - Bold + italic only (`**word**`, `*word*`)
   - Triple-nested formatting (`***word***`, `**_word_**`, `*__word__*`)
   - Ordered list with explicit `start: 5`
   - Mixed ordered + unordered list at the same nesting level
   - Inline code (`` `word` ``) and code fence (` ```ts ... ``` `)
   - Link with title (`[t](/u "title")`) and link without (`[t](/u)`)
   - Citation-shape link (`[term](/standalone-title?t=Term)`)
   - Blockquote (`> line`)
   - Heading depths h1–h6
   - Trailing/no-trailing newline at end of doc
4. **Cycle-2 invariance**: pick 1–2 articles, simulate cycle 1 fully (proposer → split → diff → coalesce → cap → mock approver accepts all → applyAcceptedGroups), then run cycle 2 against the applied output. Assert `parseProposedEdits(diff, current).recoveredSource === current` on cycle 2's input.

If any threshold fails, log the offending markdown construct or article and redesign coalescer/cap/prompt/normalizer before touching production code. The synthetic checklist must be the floor of supported constructs — production articles are required to be a subset.

**Empirical measurement (capture for `_research.md`):**
5. **Max rewrite expansion ratio (recalibration step, NOT a gate threshold).** For each of the 5 stage articles, run a real Mode B prototype on stage with the **production-locked configuration**: model `google/gemini-2.5-flash-lite`, temperature matching the original strategy config, the actual Mode B system prompt that ships in Phase 3, no temperature overrides. Record `rewrite.length / source.length` per article. Report `max ratio` and `p95` in `_research.md`. **Recalibration rule** (applied in Phase 1, not Phase 0 gate): if `max ratio > 3.0`, raise the 100 KB rewrite hard cap (Decision #21 / Error contract) to `2× max-observed-rewrite-bytes`; otherwise keep 100 KB. Justification: the cap exists to short-circuit pathological inputs (potential ReDoS or accidental memory blowup), not to constrain legitimate edits.
6. **`remark-stringify` normalization audit.** Run before/after pairs through `remark-parse → remark-stringify` and document any observed normalizations (line endings, list-marker form, escape conventions, trailing newlines). Capture in `_research.md` as a "what changes" table; if any normalization affects content semantics (rare), reconsider Option A vs alternatives.

**Production article markdown-feature audit:** in addition to the synthetic checklist above (10 constructs), Phase 0 must scan the 5 stage articles for any markdown features used in production but absent from the checklist (e.g. footnotes `[^1]`, definition lists, MDX, inline HTML, math blocks). For each missing feature found in production, add a fixture and re-test idempotency. The synthetic checklist is the **floor** of supported constructs; any production article using more features than the floor is flagged for either (a) a checklist extension + idempotency rerun, or (b) explicit "not supported in v1; falls back to Mode A" handling.

**Artifacts:**
- `evolution/scripts/pilot-mode-b.ts` — driver script (gates Phase 1)
- `docs/planning/add_rewrite_mode_iterative_editing_evolution_20260507/_research.md` — pilot results captured for posterity

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
| `evolution/scripts/verifyCrossImport.ts` | NEW | Smoke test: import `RenderCriticMarkupFromMDAstDiff` from the cross-tree path inside the `evolution/` package context; instantiate with sample input; assert no `MODULE_NOT_FOUND` at runtime in Node + Next.js build output. Run as part of Phase 1 PR checklist |
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
| `evolution/src/lib/schemas.ts:478` | Modify | Add `'iterative_editing_rewrite'` to `iterationAgentTypeEnum.values` array (literal addition; one line) |
| `evolution/src/lib/schemas.ts` | Modify | Update helpers `canBeFirstIteration()`, `isVariantProducingAgentType()`, `producesNewVariants()` so the new value behaves identically to `'iterative_editing'` (cannot be first; produces variants). Add unit assertions for each helper |
| `evolution/src/lib/schemas.ts` | Modify | Extend `iterationConfigSchema`: add optional `editingProposerSoftCap: z.number().int().min(1).max(5).default(3).optional()`. Add a Zod refine matching the existing pattern (mirror the editingMaxCycles refine at `:567`): `(c) => c.agentType === 'iterative_editing_rewrite' || c.editingProposerSoftCap === undefined` with error message *"editingProposerSoftCap is only valid for iterative_editing_rewrite iterations"*. Logic: if the new field is present, the agent type MUST be the rewrite type; otherwise the field must be absent |
| `evolution/src/lib/schemas.ts:567,571` | Modify | Existing refines for `editingMaxCycles` and `editingEligibilityCutoff` currently allow only `agentType === 'iterative_editing'`. **Extend both** to also allow `'iterative_editing_rewrite'`: `(c) => (c.agentType === 'iterative_editing' \|\| c.agentType === 'iterative_editing_rewrite') || c.editingMaxCycles === undefined` (and the same for `editingEligibilityCutoff`). Without this, Mode B strategies that set `editingMaxCycles` will fail validation |
| `evolution/src/lib/schemas.ts` | Modify | Extend `editingCycleSchema`: add optional `proposerMode: z.enum(['markup','rewrite']).optional()`, `rationale: z.string().optional()`, `rewriteText: z.string().optional()`, `computedMarkup: z.string().optional()` |
| `evolution/src/lib/types.ts` | Modify | Mirror the four optional fields on `EditingCycle` interface; mirror `editingProposerSoftCap` on the iteration-config TypeScript type; verify `IterativeEditingExecutionDetail` discriminator stays correct (no breaking change to the `IterativeEditingExecutionDetail` shape — additions only) |
| `evolution/src/lib/types.ts` | Verify | Existing `iterationAgentTypeEnum` consumers in switch statements / refines are exhaustive — add the new value to all of them (grep for `'iterative_editing'` AND `iterationAgentTypeEnum` in `evolution/src/lib/`) |

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
| `evolution/src/lib/core/agents/editing/IterativeEditingAgent.ts` | Refactor | Extract the per-cycle proposer logic from `execute()` into a `protected async runProposerCycle(current, ctx, cycleNumber): Promise<EditingCycle>` method. Body unchanged; just relocated. This is the seam Mode B will override. Sets `cycle.proposerMode = 'markup'` for traceability |
| `evolution/src/lib/core/agents/editing/IterativeEditingAgent.ts` | Verify | Size-explosion guard (>1.5×) still applies in both modes (Decision #18 doesn't change it) |
| `evolution/src/lib/core/agents/editing/IterativeEditingRewriteAgent.ts` | NEW | Subclass extends `IterativeEditingAgent`. Sets `readonly name = 'iterative_editing_rewrite'`. Overrides `runProposerCycle` to run the rewrite + diff pipeline (split → diff → coalesce → cap). Skips `checkProposerDrift`/`recoverDrift` entirely. Sets `cycle.proposerMode = 'rewrite'` plus `rationale`, `rewriteText` (truncated to 8 KB), `computedMarkup`. Reads `iterCfg.editingProposerSoftCap` for the prompt's edit budget |
| `evolution/src/lib/pipeline/loop/runIterationLoop.ts:95` | Modify | Extend `iterationType` union literal to include `'iterative_editing_rewrite'` |
| `evolution/src/lib/pipeline/loop/runIterationLoop.ts:786` | Modify | Change branch from `else if (iterType === 'iterative_editing')` to `else if (iterType === 'iterative_editing' \|\| iterType === 'iterative_editing_rewrite')`. Inside: read env flag per-invocation; instantiate the appropriate subclass: `const useRewrite = iterType === 'iterative_editing_rewrite' && process.env.DISABLE_ITERATIVE_EDITING_REWRITE !== 'true'; const agent = useRewrite ? new IterativeEditingRewriteAgent() : new IterativeEditingAgent();`. `agent.name` is the source of truth for `agent_name` in `evolution_agent_invocations` (`Agent.run()` writes from `this.name` at `Agent.ts:54`); this means rolled-back Mode B invocations correctly record as `'iterative_editing'` |
| `evolution/src/lib/pipeline/loop/runIterationLoop.ts:917,930` | Verify | `recordSnapshot(iteration, agent.name, ...)` — pass `agent.name` (from the instantiated subclass) so snapshots match the actual agent used. No need for an `effectiveType` variable; the class name handles it |
| `evolution/src/lib/pipeline/loop/editingDispatch.ts` | Verify only | Eligibility cutoff is type-agnostic — no change |
| `evolution/src/lib/pipeline/infra/estimateCosts.ts:368` | Modify | Add optional second param `mode?: 'markup' \| 'rewrite'` to `estimateIterativeEditingCost()`. When `mode === 'rewrite'`: keep proposer-output size estimate (full article + rationale ~5% overhead), zero out drift-recovery cost component. Otherwise behaves as today (default behavior preserves Mode A semantics) |
| All callers of `estimateIterativeEditingCost` | Audit + Modify | **Implementation step:** before changes land, `grep -rn 'estimateIterativeEditingCost(' evolution/src/` to enumerate every caller. Known: `projectDispatchPlan.ts` (strategy preview); confirm no others. Each caller must be updated to pass `mode` derived from `iterCfg.agentType`. Add a regression test asserting the param is threaded through every call site. Default-omitted `mode` is safe (legacy behavior = Mode A cost) but accuracy-degrades silently for Mode B rows if a caller is missed |
| `evolution/src/lib/pipeline/loop/projectDispatchPlan.ts` | Modify | At the call site that resolves cost for editing iterations, pass `mode: iterCfg.agentType === 'iterative_editing_rewrite' ? 'rewrite' : 'markup'`. Find by grep `estimateIterativeEditingCost` |
| `evolution/src/lib/services/strategyPreviewActions.ts` | Verify | Strategy preview action threads through `projectDispatchPlan`; should pick up the new cost projection automatically. Spot-check |
| `evolution/src/lib/metrics/attributionExtractors.ts` | Verify | Mode B uses the same `execution_detail.strategy` shape as Mode A; the existing extractor for `'iterative_editing'` should also handle `'iterative_editing_rewrite'`. Add the new agent_name to any extractor's matcher list. Spot-check |
| `evolution/src/lib/metrics/registry.ts` | Modify | Register new Mode B metrics in `METRIC_REGISTRY`: `coalescing_fire_rate`, `non_trivial_edit_count`, `group_count_p50`, `group_count_p95`, `group_count_max`, `proposer_format_violation_rate`, `rewrite_parse_failure_rate`. Choose entity-type ('invocation' or 'run') and aggregation per existing convention. Plus dynamic prefix `editing_stop_reason:*` if not already present |

#### 3.4 UI (~4h)

| File | Change | Detail |
|---|---|---|
| `src/app/admin/evolution/strategies/new/page.tsx:37,96` | Modify | Extend `IterationRow.agentType` and `IterationConfigPayload.agentType` unions to include `'iterative_editing_rewrite'`. **Also add `editingProposerSoftCap?: number` field to both interfaces** so the UI form state and payload can carry the new value |
| `src/app/admin/evolution/strategies/new/page.tsx:981-985` | Modify | **Dropdown is hardcoded** — add a new `<option value="iterative_editing_rewrite">Iterative Editing (Rewrite Mode)</option>` element. (Enum addition alone is insufficient.) Disable the option when `idx === 0` like the existing `iterative_editing` does |
| `src/app/admin/evolution/strategies/new/page.tsx:150-160` | Modify | `toIterationConfigsPayload()`: thread `editingProposerSoftCap` when `it.agentType === 'iterative_editing_rewrite'`; also thread the existing editing fields (`editingMaxCycles`, `editingCutoffMode/Value`) since rewrite mode shares them |
| `evolution/src/components/evolution/editing/AnnotatedProposals.tsx` | Modify | Detect `cycle.proposerMode === 'rewrite'` and prepend a new `<RationaleBlock>` displaying `cycle.rationale` and a collapsible `cycle.rewriteText`. **HTML-escaping policy**: render both fields as plain text via React's default text-child escaping (`<pre>{cycle.rationale}</pre>` rather than `dangerouslySetInnerHTML` or markdown parsing). LLM output is treated as untrusted and never injected as HTML. If we later want markdown rendering, route through a sanitizer (DOMPurify or similar) — DEFERRED to v2; v1 ships with plain-text only. Falls back to existing render path when undefined (Mode A unchanged). This is the surface visible from the run-detail page → invocation timeline tab → editing-cycle viewer |
| `src/app/admin/evolution/runs/[runId]/page.tsx` | Verify | The run-detail page already routes editing cycles through `AnnotatedProposals`; spot-check that the prop chain passes through `cycle.rationale`/`cycle.rewriteText` (no top-level page change expected) |

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

**Mode B wins** if **both** hold under a one-tailed binomial test (α = 0.05):
- `cycleSuccessRate(B) − cycleSuccessRate(A) ≥ 0.30` AND lower bound of 95% CI on the delta is > 0
- `parentToChildEloDelta(B) ≥ parentToChildEloDelta(A) − 5` (no material quality regression)

If observed Mode A baseline rises with the prompt strengthening to ≥70%, the +30 pp absolute threshold becomes infeasible (capped at 100%); in that case use a relative criterion `cycleSuccessRate(B) / cycleSuccessRate(A) ≥ 1.4` (40% relative gain) with the same CI requirement. Document the post-Phase-2 Mode A baseline before launching Phase 4 to choose threshold mode.

Required N for power=0.80 to detect a 30 pp absolute delta on a baseline of 5%: ≈ 30 invocations per arm. For a 30 pp delta on baseline of 30%: ≈ 50 per arm. Plan minimum: **N = 50 per arm**, scale to 100 if observed Mode A baseline is in the 30–60% range.

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
22. `estimateIterativeEditingCost({ mode: 'markup' })` matches existing behavior; `mode: 'rewrite'` produces a projection that excludes the drift-recovery LLM cost component (Mode B skips it).

### Phase 3 — rollback + dispatch + structural-rejection + paragraph-atomic (4 critical tests)

`runIterationLoop.test.ts` or new `IterativeEditingAgent.dispatch.test.ts`:
23. **Rollback flag short-circuits Mode B → Mode A.** Set `process.env.DISABLE_ITERATIVE_EDITING_REWRITE='true'`; instantiate run with `agentType: 'iterative_editing_rewrite'`; assert dispatched agent's persisted `agent_name === 'iterative_editing'` AND the proposer prompt builder used was `buildProposerSystemPrompt` (not the rewrite variant). Mitigates R-22.
24. **Mode A pre-flight structural rejection.** Mock proposer to return a full free-form rewrite (no markup); assert agent sets `stopReason='structural_rewrite'` AND no `recoverDrift` LLM call is made. Mitigates R-3.
25. **Paragraph-atomic collapses to single replace.** Construct a markdown pair where one paragraph is heavily rewritten beyond `paragraphAtomicDiffIfDiffAbove`; assert the resulting `EditingGroup[]` contains exactly one group with `atomicEdits.length === 1` (a single `replace` covering the whole paragraph), NOT N per-sentence atomic edits. Mitigates R-2.
26. **Real-AST diff-engine regression.** Run `RenderCriticMarkupFromMDAstDiff` against a true `unified().use(remarkParse).parse()` AST containing `strong`, `emphasis`, `link`, `inlineCode` nodes (not the existing regex-AST mock at `aiSuggestion.golden.test.ts:29-77`). Assert no `****` corruption appears for unchanged spans. Catches future regression of the bold/emphasis/link wrapper fixes.

### Phase 3 — E2E (2 tests)

`src/__tests__/e2e/specs/09-admin/admin-evolution-iterative-editing.spec.ts`:
27. Wizard exposes `iterative_editing_rewrite` as a selectable agent type.
28. Strategy created with the new agent type successfully runs one cycle on stage. Re-uses the existing 360s `setTimeout`; cleanup via existing `trackEvolutionId` pattern.

### Phase 3 — error-context preservation + truncation + adversarial input (4 tests)

`computeMarkupFromRewrite.test.ts` (or new file):
29. **`rewriteText` truncation.** Mock proposer to return a 50 KB rewrite; assert `cycle.rewriteText.length === 8192` AND the diff was computed against the full untruncated text (in-memory).
30. **`RewriteParseError` preserves `originalError`.** Feed `computeMarkupFromRewrite` a syntactically broken markdown rewrite that causes `remark-parse` to throw; catch the resulting `RewriteParseError`; assert `err.originalError` is the original parser exception with line/col detail intact AND `serializeError(err.originalError)` returns a sanitized object with `{type, message, line?, col?}` and message length ≤ 500.
31. **100 KB rewrite hard reject.** Feed the agent a mocked proposer output containing a 150 KB rewrite; assert agent sets `stopReason='rewrite_too_large'` and does NOT invoke `unified.parse()` (verifiable via spy). Mitigates regex ReDoS surface.
32. **`serializeError` defensive cases.** Feed `serializeError` (a) a cyclic error object (`e.cause = e`), (b) an error whose `.message` getter throws, (c) `undefined`, (d) a string. Assert no test throws; in each case, `serializeError` returns a valid sanitized object (worst case `{ type: 'Error', message: 'Serialization failed' }`).

### Phase 3 — `getCurrentTextForParse` seam (1 test)

`IterativeEditingAgent.dispatch.test.ts` (or new):
33. **Seam returns mode-specific text.** Instantiate `IterativeEditingAgent` (Mode A); call `getCurrentTextForParse('original-text', successResult)` → returns `'original-text'`. Instantiate `IterativeEditingRewriteAgent` (Mode B); call same → returns `result.normalizedBefore`. Mocking the `result` object's `normalizedBefore` field is sufficient; no LLM calls needed.

### Slow-suite designation

Idempotency sweep over 100 stage articles (R4.B F15 mitigation) is a slow test (~10s). Jest does not have an `it.slow(...)` marker (that's Mocha); the Jest pattern is to keep slow tests in dedicated files and run them only in a separate npm script. **Phase 3.5 deliverables:**

1. **New file** `evolution/src/lib/core/agents/editing/computeMarkupFromRewrite.idempotency.test.ts` containing the 100-article sweep. At file top: `jest.setTimeout(30000);`
2. **`package.json` script:** add `"test:nightly": "jest --testPathPattern=\\.idempotency\\.test\\.ts$ --runInBand"` (verified: this script does not yet exist).
3. **`test:ci` exclusion:** add `"test:ci": "jest --ci --coverage --maxWorkers=2 --testPathIgnorePatterns=idempotency\\.test\\.ts"` — exclude idempotency tests from the default merge gate so they don't slow PRs. (Adjust the existing `test:ci` invocation to merge with current flags.)
4. **CI job:** the idempotency sweep is **not a merge blocker**; it runs nightly via `gh workflow` triggered cron. If it fails, an issue is auto-opened in `Minddojo/explainanything`. Phase 3.5 adds the workflow file `.github/workflows/nightly-idempotency.yml`.

This way: regular merges aren't slowed, but a regression that breaks idempotency is caught within 24 hours and self-reports.

### Build verification cadence

Per `CLAUDE.md` ("After every code block you write, always run lint, tsc, and build"), each phase's deliverable PR must pass:
1. `npx eslint <touched files>`
2. `npx tsc --noEmit`
3. `npm run build`
4. `npm run test:ci`

Phase 0 pilot is exempt (script-only, no production code merged). Phases 1–3 are gated; Phase 4 has no new code (operational); Phase 5 is decision-only.

## Risk Register (top 12)

| ID | Mode | Description | P | I | Mitigation | Owner / Test |
|---|---|---|---|---|---|---|
| R-1 | B | Pre-normalization vs apply-step strict-equals mismatch (silent zero-edit cycle) | High | High | Phase 0 idempotency proof gate + test #20 | `computeMarkupFromRewrite.ts` |
| R-2 | B | Paragraph-atomic produces group exceeding `AGENT_MAX_ATOMIC_EDITS_PER_GROUP` → group dropped → wasted cycle | High | High | Diff engine collapse-to-single-replace; test #25 | `markdownASTdiff.ts` Phase 1 |
| R-3 | A | Free-form rewrite despite HARD_CONSTRAINT | High | High | Pre-flight structural rejection (Decision #9) + new prompt; test #24 | `IterativeEditingAgent.ts` + `proposerPrompt.ts` |
| R-4 | A | Cosmetic null-edits inflate `cycleSuccessRate` (Decision #8: no filter) | Med | High | Track `nonTrivialEditCount` metric; revisit if A/B shows inflation | metric registry |
| R-5 | B | Coalescer over-merges unrelated edits | High | Med | Gap=24 chars; same-kind only; paragraph-boundary aware; tests #6–9 | `coalesceAdjacentGroups.ts` |
| R-6 | B | Magnitude cap drops most-valuable edit | High | Med | Top-1-per-heading-section retention; test #11 | `capGroupsByMagnitude.ts` |
| R-7 | A | "Preserve voice" soft rule conflicts with HARD_CONSTRAINT (kept) | Med | Med | Track per-cycle drift rate; revisit Mode A v2 if not improved | Phase 4 dashboard |
| R-8 | B | Cycle-2 normalization drift compounds | Med | High | Multi-cycle invariance test #19 + idempotency proof in Phase 0 | `computeMarkupFromRewrite.ts` |
| R-9 | B | Approver rubber-stamps from rationale priming | Med | Med | Red-team caveat (Decision #11); track approverAcceptRate per arm | `approverPrompt.ts` |
| R-10 | B | `execution_detail` JSONB bloat from persisted `rewriteText` | Med | Med | Truncate `rewriteText` to first 8 KB on persist (Phase 3 implementation) | `IterativeEditingAgent.ts` |
| R-11 | B | `splitRationaleAndRewrite` fail-open on malformed/non-markdown rewrite (e.g. LLM refusal) | Med | High | Typed `RewriteParseError` from `computeMarkupFromRewrite`; agent sets `stopReason='rewrite_parse_failed'`; test for "I cannot help" output | `splitRationaleAndRewrite.ts`, `computeMarkupFromRewrite.ts` |
| R-12 | B | Untested rollback (env-flag short-circuit) | High | High | Test #23 verifies `DISABLE_ITERATIVE_EDITING_REWRITE` falls Mode B → Mode A | `runIterationLoop.ts` |

15 lower-priority risks tracked in R4 outputs (UI-render coverage, peer-dep transitive issues, slow-test handling, parser injection of CriticMarkup-like literals in rewrites, etc.); not enumerated here. These are tracked as minor issues in the implementation PRs.

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
