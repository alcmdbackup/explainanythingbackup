# fix_drift_editing_agent_evolution_20260503 Research

## Problem Statement

In the latest staging evolution run (`53de07e3-d7a3-4cd7-bd33-9a51ed224902`, strategy "ReflectandGenerate then edit"), every `iterative_editing` invocation that reached the drift-check phase failed. None produced an editing variant.

## Run-level Distribution

10 invocations total; failure modes:

| stopReason | recovery_outcome | count | Notes |
|---|---|---|---|
| `proposer_drift_major` | `skipped_major_drift` | 4 | Path B (overlap check) — magnitude classifier flagged drift as major; recovery LLM never called (`recovery_cost = 0`). |
| `proposer_drift_unrecoverable` | `recovered` | 4 | Recovery LLM called, classified drift as benign and patched, but recheck after patch still saw drift. |
| `no_edits_proposed` | `null` | 2 | Parser produced 0 groups AND no drift — Proposer just emitted the article unchanged. |

## Root Cause: Proposer LLM Failing the Markup Contract

`editingModel` was `null` in the strategy config, so it fell back to `generationModel = 'google/gemini-2.5-flash-lite'`. **Gemini-flash-lite cannot follow the agent's specific dialect of CriticMarkup.** It defaults to standard CriticMarkup conventions seen in training, in two distinct failure modes:

### Failure Mode 1 — Conflated insert/substitution syntax (4 `proposer_drift_major` cases)

Inv `4018e13a` first edit:
- `kind = insert`, `newText = "of influencing the cost of money. ~> of influencing the cost of money, and providing greater certainty in rate management."`

The LLM intended a substitution but emitted `{++ [#N] OLD ~> NEW ++}` instead of `{~~ [#N] OLD ~> NEW ~~}`. Parser interprets it as a pure insert (adds NEW at the markup position, contributes nothing to recoveredSource). **Critically, the LLM — believing it had performed a substitution — did NOT re-emit the OLD text in its post-markup continuation.** So `recoveredSource = parent[0:markupStart] + LLM_continuation_after_markup` is missing the OLD phrase. Drift detected at offset = markupStart.

### Failure Mode 2 — Standard CriticMarkup paired form, no `[#N]` (4 `proposer_drift_unrecoverable` cases)

Inv `020ae4dd` proposedMarkup excerpt:
```
{~~When the Fed aims for stable prices, it is targeting an inflation rate of about 2% per year, meaning your dollar should only slowly lose its purchasing power.~~} {++When the Fed aims for stable prices, it means it is targeting...++}
```

Two violations:
1. **`{~~ ~~}` used as plain delete** — the parser's `RE_REPLACE` requires `~>` inside the block, so this matches nothing.
2. **No `[#N]` group numbers** — every regex (`RE_INSERT`, `RE_DELETE`, `RE_REPLACE`) requires `\[#(\d+)\]`. Without it, all matches fail.

Result: parser returns 0 groups → recoveredSource = entire proposedMarkup verbatim. The LLM's wholesale paraphrasing of unmarked content makes recoveredSource diverge from currentText broadly. Recovery LLM patches some regions as "benign", but the recheck still sees drift everywhere.

## Why the 4 "Major" Cases Skipped the Recovery LLM

`classifyDriftMagnitude(regions, groups)` returns `'major'` if drift offset overlaps any edit's `markupRange` (recoverDrift.ts:31-37). The bug: `region.offset` is in **normalized recoveredSource** coords; `markupRange.start/end` are in **raw proposedMarkup** coords. These coordinate systems are identical up to the FIRST markup span (no markup chars stripped yet), then diverge as later markup spans add chars.

**Consequence: the overlap check fires iff drift is caused by the first edit's `oldText` being wrong.** Confirmed in data — all 4 major-drift invocations had `drift_offset === first_markup_start` (off by ≤1 due to the leading `{` char):

| invocation | drift_offset | first_markup_start | first_markup_end |
|---|---|---|---|
| `1ba0fd3b` | 2697 | 2697 | 2866 |
| `4018e13a` | 3753 | 3752 | 3887 |
| `5924684b` | 4391 | 4391 | 4412 |
| `5b645a44` | 7649 | 7649 | 7677 |

So the overlap check is doing the right thing semantically (first edit caused the drift) but for the wrong reason (numerical-coincidence rather than coord-translated overlap).

## Code Files Read

- `evolution/src/lib/core/agents/editing/IterativeEditingAgent.ts` — orchestrator, drift-handling block lines 209-291.
- `evolution/src/lib/core/agents/editing/checkProposerDrift.ts` — always 1 region, capped 200 chars.
- `evolution/src/lib/core/agents/editing/recoverDrift.ts` — only 2 paths to `skipped_major_drift` (env line 83-85; magnitude line 87-90).
- `evolution/src/lib/core/agents/editing/parseProposedEdits.ts` — `RE_INSERT`/`RE_DELETE`/`RE_REPLACE` all require `[#(\d+)]`; recoveredSource construction; `offsetMap` is computed but not exported.
- `evolution/src/lib/core/agents/editing/proposerPrompt.ts` — current prompt describes the syntax in prose (`SYNTAX_DOCS`) but has no concrete `[#N]`-numbered example.
- `evolution/src/lib/core/agents/editing/constants.ts` — thresholds.

## Documents Read

- `docs/docs_overall/debugging.md` — drove the four-phase /debug workflow.
- `evolution/docs/agents/overview.md` — IterativeEditingAgent contract, Decisions §11/§13/§14, kill-switch list.
- `evolution/docs/reference.md` — env var defaults; confirmed `EVOLUTION_DRIFT_RECOVERY_ENABLED` defaults to `'true'`.

## Suggested Fixes (Ordered by Effort vs Impact)

### Fix 1 — Pin `editingModel` to a capable model (CONFIG-ONLY, ZERO-CODE)
**Highest leverage, immediate.** Update the "ReflectandGenerate then edit" strategy (and any others with `editingModel = null`) to set `editingModel = 'gpt-4.1-mini'` or similar. Gemini-flash-lite is too small to reliably follow the `[#N]`-numbered + inline-`~>` dialect.

Optional: add a startup warn-log when `editingModel` resolves (after fallback) to a model in a known-bad list (e.g., `gemini-flash-lite`, `qwen3-8b`).

### Fix 2 — Strengthen the Proposer prompt with concrete examples
**Low cost, broad benefit.** Current `SYNTAX_DOCS` (`evolution/src/lib/core/agents/editing/proposerPrompt.ts`) describes the syntax abstractly. Add:
- A worked example showing one of each kind (insert, delete, substitute) with `[#N]` numbers.
- A negative example: `❌ DO NOT USE: {~~ old ~~} {++ new ++}` (paired form) — `✅ USE: {~~ [#1] old ~> new ~~}` (inline `~>`).
- Explicit instruction: "After your markup span, re-emit the article body VERBATIM. Do not assume the reviewer will infer your intent — every character outside markup must match the source byte-for-byte."

### Fix 3 — Permissive parser (accept standard CriticMarkup paired form)
**Moderate cost.** Add a fallback in `parseProposedEdits.ts`: when `{~~ X ~~}` (without `~>`) is followed by `{++ Y ++}` and both have the same (or both missing) `[#N]`, treat as a substitution. This would catch the 4 `proposer_drift_unrecoverable` cases. Risk: ambiguous when `[#N]` is missing — might require a kill-switch.

### Fix 4 — Fix `classifyDriftMagnitude` overlap check
**Moderate cost, narrow benefit.** Translate `markupRange` from proposedMarkup coords to recoveredSource coords using the parser's existing `offsetMap`. Requires:
- `parseProposedEdits.ts`: export `offsetMap` from `ParseResult`.
- `IterativeEditingAgent.ts`: pass it to `recoverDrift`.
- `recoverDrift.ts`: use translated ranges in the overlap check.

After this fix, the 4 `proposer_drift_major` cases would instead get a recovery LLM attempt. They might still fail (the underlying root cause is the LLM, not the magnitude classifier), but the failure path becomes `unrecoverable_intentional` (the LLM was making real semantic edits without proper markup), which is more honest. **Note**: this fix alone does NOT solve the user's problem — Fix 1 or 2 is required.

### Fix 5 — Tighten `normalizeWhitespace` to also normalize Unicode (smart quotes, em-dashes, NBSP)
**Defensive only.** Wasn't a contributing factor in this run, but small models often auto-substitute Unicode and that would silently produce drift. Mark for follow-up.

## Recommended Action Path

**Immediate (operator action, no deploy):**
1. Update strategy `b003d8be-76b2-4cb2-9100-7285210801b9` to set `editingModel = 'gpt-4.1-mini'`. Alternatively, archive that strategy and create a new one with the model explicitly set.

**Near-term (single PR):**
2. Land Fix 2 (prompt hardening) — minimal-risk text-only change to `proposerPrompt.ts`.
3. Land Fix 4 (overlap-check coord translation) — improves diagnostic clarity even if it doesn't directly resolve the symptom.

**Optional (separate PR):**
4. Fix 3 (permissive parser) behind a kill-switch env var.
5. Fix 5 (Unicode normalization) for defense in depth.

## Open Questions

- Is the strategy "ReflectandGenerate then edit" actively used in experiments, or is it a one-off staging test? If actively used, Fix 1 is urgent.
- Are there other strategies with `editingModel = null`? Worth a follow-up query.
