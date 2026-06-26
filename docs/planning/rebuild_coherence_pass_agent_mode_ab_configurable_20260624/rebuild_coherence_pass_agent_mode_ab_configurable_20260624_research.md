# Rebuild Coherence Pass Agent Mode A/B Configurable Research

## Problem Statement
Rebuild `ParagraphRecombineWithCoherencePassAgent` to support both Mode A (CriticMarkup-in) and Mode B (rewrite-then-diff) editing paths via strategy config. Default to Mode B based on the finding from CoherencePassPerf A/B (`docs/analysis/coherence-pass-perf-ab-results-20260624/`) that the proposer LLM naturally emits Mode B-shaped output. After implementation, use the `manual_run_experiment` skill to re-run the A/B with one arm pinned to Mode B and validate the lengthCap + multi-cycle changes actually move the needle.

## Requirements (from GH Issue #1288)
Specific deliverables:

1. **Add `coherencePassEditingMode` iter-config field** with values `'mode_a' | 'mode_b'`, default `'mode_b'`.
2. **Pass `rewriteMode` argument** to `runEditingCycle` when Mode B selected (`coalesceAndCap: true, capLimit: 10` — Mode B's diff-derived markup benefits from coalescing).
3. **Author Mode B proposer prompt** (`## Rationale` + `## Rewrite` blocks, voice-restoration scope; clone `IterativeEditingRewriteAgent`'s `proposerPromptRewrite.ts` as the template).
4. **Wizard input dropdown** for the mode.
5. **Unit + boundary tests**:
   - `mode='mode_a'` uses Mode A (no `rewriteMode`)
   - `mode='mode_b'` passes `rewriteMode`
   - zod refine rejects on non-coherence-pass agent types
   - default resolution via `resolveCoherencePassDefaults` helper
6. **Doc updates**:
   - `paragraph_recombine_with_coherence_pass.md` (Algorithm + Configuration knobs)
   - `multi_iteration_strategies.md` (new field)
   - `reference.md` (env var if added)
7. **After ship**, kick off A/B via the `manual_run_experiment` skill comparing default (Mode B) vs Mode A pinned, 8 runs/arm, same `federal_reserve_2` prompt. Validate Mode B actually applies edits in >50% of invocations. Trigger `/analysis` after completion.

## High Level Summary

This project is a direct follow-up to `investigate_paragraph_recombine_coherence_pass_performance_20260623` (merged in [PR #1282](https://github.com/Minddojo/explainanything/pull/1282)). That project shipped multi-cycle + raised length cap + voice-restoration prompt, but the post-merge A/B (analysis at `docs/analysis/coherence-pass-perf-ab-results-20260624/`) revealed that the agent is effectively a no-op in 14 of 15 invocations because the proposer LLM (`google/gemini-2.5-flash-lite`) naturally emits Mode B-shaped output (clean rewritten articles) while the agent expects Mode A (inline CriticMarkup). The mode mismatch makes the pass produce 0 applied edits in 93% of cases.

The fix is to make the editing mode configurable. The IterativeEditingRewriteAgent already uses Mode B (via `rewriteMode` argument to `runEditingCycle`). The pattern works — `splitRationaleAndRewrite` + `computeMarkupFromRewrite` derive CriticMarkup from the LLM's natural output via diff. This project ports that capability to the coherence-pass agent.

## Documents Read

### Core Docs (skimmed; full context from sibling project)
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/paragraph_recombine_with_coherence_pass.md — the agent under modification
- evolution/docs/editing_agents.md — Mode A vs Mode B documentation (IterativeEditingAgent vs IterativeEditingRewriteAgent)
- evolution/docs/multi_iteration_strategies.md — where the new iter-config field belongs
- evolution/docs/reference.md — env-var conventions
- evolution/docs/architecture.md — pipeline structure
- evolution/docs/cost_optimization.md — cost-tracking expectations for the new mode
- evolution/docs/metrics.md — observability conventions

### Sibling project + analysis
- `docs/planning/investigate_paragraph_recombine_coherence_pass_performance_20260623/` — the project that shipped multi-cycle + Jaccard removal
- `docs/analysis/coherence-pass-perf-ab-results-20260624/` — the A/B that surfaced the Mode A/B mismatch

## Code Files Read

- `evolution/src/lib/core/agents/paragraphRecombineWithCoherencePass/ParagraphRecombineWithCoherencePassAgent.ts` — agent execute() body; the coherence-pass block at line ~301-377 is the modification site
- `evolution/src/lib/core/agents/editing/runEditingCycle.ts` — Mode A path (parseProposedEdits) vs Mode B path (splitRationaleAndRewrite + computeMarkupFromRewrite); confirms how `rewriteMode` argument is consumed
- `evolution/src/lib/core/agents/editing/proposerPromptRewrite.ts` — Mode B proposer prompt template (rationale + rewrite blocks)
- `evolution/src/lib/core/agents/editing/IterativeEditingRewriteAgent.ts` — reference Mode B agent (the pattern to mirror)
- `evolution/src/lib/schemas.ts` — iter-config zod schema + agentType refines (where the new field lives)
- `src/app/admin/evolution/strategies/new/page.tsx` — wizard UI (where the new dropdown lives)
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — agent-input plumbing
- `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts` — FIELD_GATES table (config_hash canonicalization)

## Key Findings

### 1. PR #1283 (merged 2026-06-24) just stripped soft caps from iterative-editing — changes our plan

The pattern this project is meant to clone from IterativeEditingAgent changed YESTERDAY in PR #1283 ("Strip soft caps + max approver granularity from iterative-editing agents"). Specifically:

- `editingProposerSoftCap` iter-config field was **removed** (FIELD_GATES + zod schema + canonicalization).
- `disableApproverFiltering` iter-config field was **removed** the same way.
- `IterativeEditingAgent.execute()` now passes `rewriteMode: { coalesceAndCap: false }` (NOT `true, capLimit: 10` — see lines 213-217 of `IterativeEditingAgent.ts`).
- The `coalesceAndCap: false` default means EVERY diff atomic the rewrite produces is sent to the approver as its own decision (**max approver granularity**).
- The new `proposerPromptRewrite.ts` includes an `AMBITIOUS_DIRECTIVE` block: *"There is no edit budget and no preference for small vs. large edits. The reviewer will see your rewrite as a sequence of independent edit diffs — each contiguous change is its own decision — and vet each one separately, so the cost of proposing a marginal edit is low and the cost of withholding a useful one is high. Aim to rewrite generously rather than sparingly."*

**This contradicts the original project spec** which said `rewriteMode: { coalesceAndCap: true, capLimit: 10 }`. The plan needs to update to `coalesceAndCap: false` (and no `capLimit` field, since the helper only consults it when `coalesceAndCap === true`).

### 2. The cleanest Mode A/B switch is a runtime variable based on `effectiveEditingMode`, NOT class inheritance

IterativeEditingAgent uses `protected get isRewriteMode(): boolean { return false; }` and the Rewrite subclass overrides it. That's class-level inheritance. The coherence-pass agent is a separate class, NOT inheriting from IterativeEditingAgent — so the same trick doesn't apply.

The right pattern for the coherence-pass agent: resolve `effectiveEditingMode` from input/kill-switch defaults at the top of execute(), then use it as a regular discriminator. No subclassing.

### 3. `splitRationaleAndRewrite` is forgiving — `## Rationale` is optional, `## Rewrite` is the load-bearing heading

From the file header comment: *"If the `## Rewrite` heading is absent we return parseFailed=true with the entire response as rewrite (the caller's `computeMarkupFromRewrite` will succeed if the body is syntactically valid markdown)."* So a proposer that emits a clean rewrite without the `## Rationale` / `## Rewrite` headings still parses — just `parseFailed: true` flag set + the whole body becomes the rewrite. Fault-tolerant for weak models.

### 4. Mode B's `workingText` is mutated by `computeMarkupFromRewrite` (gotcha for the multi-cycle loop)

`runEditingCycle.ts:267`: after the diff engine runs, `workingText = computeResult.normalizedBefore;` — the diff engine canonicalizes the source. The caller MUST reassign `current.text = result.modeBContext.normalizedSource` (from the return value) before the next cycle, otherwise cycle 2's diff is computed against the un-normalized text → likely produces spurious "edits" matching only the normalization. **The IterativeEditingAgent's multi-cycle loop handles this via `result.modeBContext.normalizedSource`.** Our coherence-pass multi-cycle loop must do the same.

### 5. Mode B failure paths exit cleanly via stopReason

`runEditingCycle.ts:248-261, 269-301` enumerate Mode B's exit paths:

| stopReason | When |
|---|---|
| `proposer_format_violation` | `splitRationaleAndRewrite` returns `parseFailed: true` AND empty rewrite body |
| `rewrite_too_large` | Rewrite body exceeds the diff engine's size budget (`RewriteTooLargeError`) |
| `rewrite_parse_failed` | Markdown structure not parseable by diff engine (`RewriteParseError`) |
| `diff_engine_failed` | Diff engine throws other (`DiffEngineError`) |

All four return a partial cycle with `proposedMarkup: '', formatValid: false` etc. + `errorMessage`. The agent's loop just continues per `stopReason` (the same termination logic from PR #1282 still works).

### 6. Mode B persisted-context fields — execution_detail forensics

The cycle annotation for Mode B (from `IterativeEditingAgent.ts:226-230`): `proposerMode: 'rewrite'` + optional `rationale`, `rewriteText`, `computedMarkup` from `result.modeBContext`. Persist all four in our coherence-pass agent for forensics — without these, debugging future failures is much harder. The opposite cycle annotation for Mode A is `proposerMode: 'markup'`.

### 7. Mode B prompt template (`proposerPromptRewrite.ts`) is a good base but needs voice-restoration scope rewrite

`buildProposerSystemPromptRewrite()` has the right STRUCTURE (FORMAT_SPEC + SCOPE_RULES + AMBITIOUS_DIRECTIVE + PRESERVATION_RULES + SELF_CHECK) but the SCOPE is generic-edits, not voice-restoration. The coherence-pass agent's Mode B prompt should:

- Keep `FORMAT_SPEC` (## Rationale + ## Rewrite output contract — load-bearing for `splitRationaleAndRewrite`).
- Keep `SCOPE_RULES`'s preservation language (headings, code fences, citations).
- Keep `AMBITIOUS_DIRECTIVE` verbatim (it's exactly what we want — "no edit budget" + "vet each diff separately").
- Replace generic-edits language in `SCOPE_RULES` with the coherence-pass voice-restoration framing (from `buildCoherencePassProposerPrompt.ts`'s SCOPE_GUIDANCE).
- Add LENGTH_HINT (~10% growth ceiling, same as Mode A's prompt).
- Keep `PRESERVATION_RULES` (3 soft rules: quotes/citations/URLs, headings, code fences).
- Keep SELF_CHECK (verify `## Rationale` heading, `## Rewrite` heading, no trailing commentary).

### 8. FIELD_GATES + canonicalization pattern for the new field

The recipe from existing `coherencePass*` fields (`findOrCreateStrategy.ts:87-94`):

```typescript
coherencePassEditingMode: (t) => t === 'paragraph_recombine_with_coherence_pass',
```

No `normalizeIteration` default added — preserves existing strategies' `config_hash`. The agent resolves the default at runtime via `resolveCoherencePassDefaults()`. This mirrors the lengthCapRatio + maxCycles pattern shipped in PR #1282.

### 9. `coherencePass.config` zod sub-schema in `schemas.ts:2747+` requires explicit shape update

The sub-schema currently lists `proposerModel`, `approverModel`, `lengthCapRatio` (per PR #1282 Phase 2a). Adding `editingMode: z.enum(['mode_a', 'mode_b'])` here is required — without it, the new agent's emitted config snapshot fails schema validation, same regression PR #1282 caught for the Jaccard removal.

## Open Questions

1. ✅ **RESOLVED (user, 2026-06-24)** — `AMBITIOUS_DIRECTIVE` adapted: PREPEND a 1-sentence voice-restoration framing to the existing directive (additively, not replacing). Concrete wording for the Mode B prompt's directive block: *"The article you're reviewing was assembled from paragraphs rewritten independently in parallel. Voice and cadence may have flattened across them; substantive structural and voice-restoration rewrites are exactly what's wanted."* + existing 4-sentence directive verbatim ("Propose whatever edits…rewrite generously rather than sparingly."). Phase 3 of the plan to incorporate.
2. ✅ **RESOLVED (user, 2026-06-24)** — Mode B prompt includes a separate "Look for in particular" hint listing the 4 concrete paragraph-level voice-loss patterns. Concrete wording for Phase 3: *"Look for in particular: (a) paragraphs that start abruptly with no transition from the previous one; (b) rhetorical hooks ('Imagine a time when…') that appear in some paragraphs but get dropped in others; (c) inconsistent voice register (formal vs. casual) across adjacent paragraphs; (d) repeated explanations of the same concept that two independent rewriters both included."* Place after `SCOPE_RULES`, before `AMBITIOUS_DIRECTIVE`. Frame as "examples to look for" not "the only acceptable edits" — preserves the directive's "any improvement" framing.
3. ✅ **RESOLVED (user, 2026-06-25, refined)** — The kill switch is removed entirely (Phase 0 of the plan). Original framing: "kill switch doesn't flip Mode B → Mode A". User then directed (2026-06-25): "Remove the kill switch, we don't need it." Final state: `resolveCoherencePassDefaults()` helper deleted; `LEGACY_*` constants deleted; `EVOLUTION_COHERENCE_PASS_DEFAULTS_V2` env-var documentation deleted; `?? DEFAULT_COHERENCE_PASS_*` resolution becomes direct everywhere. Strategies that need Mode A (or legacy lengthCap/maxCycles) pin them explicitly in iter-config. Global rollback, if ever required, is a code-revert of the original PR.
4. ✅ **RESOLVED (user, 2026-06-25)** — Extend the scaffold with a single new helper `makeModeBCycleResult(opts)` (10–20 LoC) that builds a Mode B-shaped `RunEditingCycleResult` with `modeBContext` fields populated (`rationale`, `rewriteText`, `computedMarkup`, `normalizedSource`). Add alongside the existing `makeCycleResult` (which stays Mode A-shaped). Phase 5 tests use it for: (a) Mode B branch assertions (`rewriteMode: {coalesceAndCap: false}` passed, Mode B prompt builder called); (b) per-cycle `currentText` reassignment to `modeBContext.normalizedSource` between cycles; (c) `proposerMode: 'rewrite'` annotation on the persisted cycle.
5. ✅ **RESOLVED (user, 2026-06-25)** — NO `normalizeIteration` fold. Existing strategies that omit `coherencePassEditingMode` auto-upgrade to Mode B. Matches the precedent set in PR #1282 (no fold for `lengthCapRatio` or `maxCycles`). Two-line rationale: (1) consistency with #1282 — that PR established "new defaults silently apply" as the pattern; adding a fold here would be inconsistent; (2) the structural fix is the whole point — keeping existing strategies on Mode A means they continue to no-op the coherence pass in 93% of invocations. Kill switch (`EVOLUTION_COHERENCE_PASS_DEFAULTS_V2='false'`) only covers numeric knobs per Q3; a global Mode B revert requires a code-level revert of this PR. Document explicitly in `paragraph_recombine_with_coherence_pass.md` so it's clear to anyone reading.
