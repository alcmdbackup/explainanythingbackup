# Paragraph Recombine Agent With Coherence Pass Plan

## Background
Create a new evolution agent type called "paragraph rewrite with cohesion pass" — a variant of the existing `paragraph_recombine` that (a) rewrites paragraphs in isolation with no surrounding context, (b) constrains rewrites to reorganization/wording adjustments without introducing new content, (c) judges each paragraph independently, and (d) applies a coherence pass over Elo winners to smooth any cross-paragraph incoherences with minor edits.

## Requirements (from GH Issue #1239)
- Create a new type of agent with a different prompt compare to sequential paragraph rewrite recombine - call it "paragraph rewrite with cohesion pass"
- Prompt should force agent to rewrite the paragraph inline with no other context
- Rewrite prompt should suggest move content around and adjust sentences & wording, but do not introduce any new content whatsoever
- Do not add definitions where none were there previously, add new metaphors/analogies, etc
- Delete words and phrases and sentences if redundant, but do not delete non-redundant content
- Judging should be for individual paragraph only, with no other context
- To get the final output, pick the highest elo paragraphs from all rewrites, and do an incoherence pass afterwards on elo winners. Edit them to make sure that any incoherences are resolved with minor edits

## Problem
[Populate after /research. Initial framing:] The existing `paragraph_recombine` agent (in its sequential context-aware mode) tries to maximize cross-paragraph coherence at rewrite time by feeding prior-pick context into each round. This couples each rewrite to chosen predecessors and inflates cost. A different hypothesis worth testing: rewrite each paragraph in true isolation under a strict no-new-content constraint (so rewrites are quality-equivalent reorganizations the judge can actually rank), then resolve any residual cross-paragraph rough edges in a single small coherence pass on the assembled winners. This separates the "improve each paragraph" objective from the "make the whole article flow" objective.

## Options Considered (LOCKED)
- [x] **Chosen: New top-level agent type (`paragraph_recombine_with_coherence_pass`) + extract `runEditingCycle()` helper from `IterativeEditingAgent`** (combined Option A + Option C from /research). The new agent is a sibling to `ParagraphRecombineAgent` that reuses the per-slot arena / slot topic upsert / per-slot ranking / assembly infrastructure, forces the legacy parallel path (no `priorPicks`, no `nextContext`, no coordinator), and runs a Phase D coherence pass on the assembled article. The coherence pass orchestration is NOT duplicated from `IterativeEditingAgent` — instead, the per-cycle inner block of `IterativeEditingAgent.execute()` is extracted into a shared `runEditingCycle()` helper (`evolution/src/lib/core/agents/editing/runEditingCycle.ts`) that both `IterativeEditingAgent` and the new agent call. `IterativeEditingAgent`'s observable behavior stays bit-identical (same hardcoded prompts + `SIZE_RATIO_HARD_CAP=1.5` via `validateOpts: undefined` + drift snap + multi-cycle loop). The new agent calls the helper ONCE with our custom inter-paragraph-seam proposer prompt, tight validate opts (`lengthCapRatio: 1.02`, `redundancyJaccardThreshold: 0.30`, `flowGuardrailEnabled: true`), `driftRecovery: 'skip'`, and our own AgentName labels (`coherence_pass_propose`, `coherence_pass_review`).
- [ ] Rejected: thin orchestrator that imports primitives without refactoring `IterativeEditingAgent` (~50-80 LOC of orchestration-shape duplication — bug fixes in cycle logic would have to be made in two places).
- [ ] Rejected: mode flag on existing `paragraph_recombine` agent (balloons one agent's surface area; pollutes leaderboard buckets).
- [ ] Rejected: coherence pass as a separate iteration type composable after `paragraph_recombine` (decouples it from the slot rewrites it should be smoothing; harder to maintain coupling).
- [ ] Rejected: call `IterativeEditingAgent.execute()` directly (proposer prompt + `validateEditGroups` opts are hardcoded inside the agent — would run a generic article-editing pass with 50% growth cap, wrong for a tight coherence pass).

## Phased Execution Plan

### Phase 1: Research + Design lock
- [x] Read `ParagraphRecombineAgent.ts` end-to-end and document the seams where the new prompt/no-priorPicks logic plugs in
- [x] Read `IterativeEditingAgent.ts` + `validateEditGroups.ts` + `applyAcceptedGroups.ts` to confirm the coherence-pass primitives we can reuse
- [x] Lock decisions for: new agentType name, marker tactic name + color, kill-switch env var name, per-invocation cap, coherence-pass budget %, AgentName label(s) for the coherence pass, cost-metric bucket name
- [x] **Q1 locked**: coherence pass proposer uses `generationModel`, approver uses `judgeModel`. Expose iter-config overrides `coherencePassProposerModel` / `coherencePassApproverModel` (default to the above).
- [x] **Q2 locked**: per-rewrite temperature ladder is per-directive moderate (`0.6 / 0.7 / 1.0`, indexed by directive role). Expose iter-config overrides `coherencePassRewriteTempFloor` (default 0.6) / `coherencePassRewriteTempCeiling` (default 1.0) so ops can re-tune in staging without a redeploy if per-slot TIE rate exceeds 70%.
- [x] **Q3 locked**: 3 directives — REORDER (idx 0, temp 0.6), TIGHTEN (idx 1, temp 0.7), RESTRUCTURE (idx 2, temp 1.0). Each directive explicitly re-states the no-new-content prohibition (definitions / metaphors / analogies / examples) for belt-and-suspenders. For M > 3 (schema allows up to 6), cycle mod-3.
- [x] **Q4 locked**: `coherencePassEnabled?: boolean` field added to `iterationConfigSchema`, gated to the new agent type via Zod refinement, defaults to `true`. Participates in `config_hash` via canonicalization (omitted = default-true normalize for dedup). When `coherencePassEnabled === false`, default `perInvocationCapUsd` to `$0.05` instead of `$0.10`.
- [x] **Q5 locked**: single invocation row for the new agent. Coherence pass cycle data lives in `execution_detail.coherencePass.cycles[0]` (matches `iterativeEditingExecutionDetailSchema.cycles[]` shape so `parseIterativeEditingTree` subagent parser can walk it).
- [x] **Q6 locked**: persist BOTH the recombined-before-coherence-pass text (`execution_detail.recombinedBeforeCoherencePass`, truncated to 8KB) AND the final post-coherence-pass text (`execution_detail.recombined.text`, full-length, same key as today). No separate variant row.
- [x] **Q7 locked**: ship multi-dispatch from day 1. Extract `dispatchParagraphRecombineFamily<TAgent>(opts)` shared helper in `runIterationLoop.ts` that BOTH the existing `paragraph_recombine` branch AND the new `paragraph_recombine_with_coherence_pass` branch call — eliminates the ~300 LOC of dispatch duplication the J4 branch otherwise creates. `IterativeEditingAgent`'s dispatch path is unaffected.
- [x] **Q8 locked**: ship slot-level `slot_provenance_ratio_p25` + `slot_provenance_ratio_p50` metrics, observational-only. Document the false-positive caveat in `evolution/docs/metrics.md` + a code comment on the compute function: **sentence-level Levenshtein matching is noisy for REORDER (word-reorderings within a sentence don't near-match) and RESTRUCTURE (splits/combines change sentence boundaries); the metric is reliable for TIGHTEN but should NOT be read as a hard prompt-compliance signal for the other two directives.** Researchers wanting a true compliance check should run a follow-up LLM-judge script (out of scope for Phase 1).
- [ ] Run /plan-review to validate the design before any code is written

### Phase 2: Schema + scaffolding (no behavior change yet)

**AgentName label decision (LOCKED — resolves Security/Architecture gap re: 1:1 cost-metric mapping):** The new agent REUSES the existing `paragraph_rewrite` + `paragraph_rank` AgentName labels for its per-slot pipeline (they bucket into the existing `paragraph_recombine_cost` metric — same as the existing `paragraph_recombine` agent). Only the coherence pass introduces two NEW labels (`coherence_pass_propose`, `coherence_pass_review`) which bucket into the new `paragraph_recombine_coherence_cost` umbrella. Rationale: AgentName→cost-metric mapping is global 1:1; routing the same label to two metrics is not architecturally possible without a refactor. Strategy-level A/B comparison between the new agent and the existing `paragraph_recombine` agent relies on the **marker tactic** (`paragraph_recombine_with_coherence_pass` vs `paragraph_recombine`) on the tactic leaderboard — NOT cost-bucket separation at the per-slot level. The coherence-pass cost IS cleanly separated via the new umbrella.

**Exhaustive enumeration of touchpoints to update in Phase 2** (each one is a code site that must change; any miss produces a wrong-but-passing build):

Schema + Zod:
- [ ] `evolution/src/lib/schemas.ts:579` — add `'paragraph_recombine_with_coherence_pass'` to `iterationAgentTypeEnum`
- [ ] `evolution/src/lib/schemas.ts:610` — add new type to `canBeFirstIteration` (paragraph variants can be first; same as plain paragraph_recombine)
- [ ] `evolution/src/lib/schemas.ts:623` — do NOT add to `isVariantProducingAgentType` (paragraph_recombine isn't in that set either; reserved for the parallel-batch sourceMode family)
- [ ] `evolution/src/lib/schemas.ts:636` — add new type to `producesNewVariants` (the new agent emits article variants per invocation)
- [ ] `evolution/src/lib/schemas.ts` Zod refinements (lines ~778-839) — extend the paragraph_recombine-only knob gates to allow the same knobs for the new agent type (`rewritesPerParagraph`, `maxComparisonsPerParagraph`, `maxParagraphsPerInvocation`, `paragraphRewriteModel`, `perInvocationCapUsd`, `maxDispatches`, the four `*Floor*` overrides)
- [ ] Add 5 NEW iter-config fields to `iterationConfigSchema`, ALL gated to the new agent type via Zod refinement:
  - `coherencePassEnabled?: z.boolean()` (default true at consumption)
  - `coherencePassProposerModel?: z.string()` (default `generationModel`)
  - `coherencePassApproverModel?: z.string()` (default `judgeModel`)
  - `coherencePassRewriteTempFloor?: z.number().min(0).max(2)` (default 0.6)
  - `coherencePassRewriteTempCeiling?: z.number().min(0).max(2)` (default 1.0; refine: ceiling >= floor)
- [ ] Multi-site `iterationType` enum widening — add `'paragraph_recombine_with_coherence_pass'` to the four DECLARING sites: `iterationAgentTypeEnum` at `schemas.ts:579` (this widens the imported `IterationAgentType` alias used at `runIterationLoop.ts:107` and elsewhere automatically), plus `MergeRatingsAgent.ts:37` (inline union), and the two inline unions at `schemas.ts:2195` + `schemas.ts:2253`. `MergeRatingsAgent.ts:397` is a property assignment (`iterationType,`), NOT a separate enum declaration — it inherits from the input type. Any miss at the four declaring sites will throw at runtime in MergeRatingsAgent or schema validation.

Strategy `config_hash` / canonicalization (LOCKED — resolves Security/Architecture gap):
- [ ] `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts` `FIELD_GATES` (lines ~49-71) — extend gates to accept BOTH `t === 'paragraph_recombine'` AND `t === 'paragraph_recombine_with_coherence_pass'` for the 6 reused fields (`rewritesPerParagraph`, `maxComparisonsPerParagraph`, `maxParagraphsPerInvocation`, `paragraphRewriteModel`, `perInvocationCapUsd`, `maxDispatches`)
- [ ] `FIELD_GATES` — add new gates for the 5 NEW fields above, restricted to `t === 'paragraph_recombine_with_coherence_pass'`
- [ ] `normalizeIteration` in same file (lines ~93-96) — handle the conditional `perInvocationCapUsd` default ($0.10 when `coherencePassEnabled !== false`, $0.05 when explicitly false). Fold `coherencePassEnabled: undefined` → `true` so strategies that omit dedupe to strategies that explicitly enable.
- [ ] `DEFAULT_PER_INVOCATION_CAP_USD` constant extension or new constant for the new agent
- [ ] **Without these FIELD_GATES + normalizeIteration updates, the new fields will be STRIPPED before hashing and two strategies that differ only in the new knobs (e.g., coherencePassEnabled true vs false) will silently dedupe to the same `strategy_id`, breaking the A/B design intent.**

Agent registration:
- [ ] `evolution/src/lib/core/agentRegistry.ts:30` `getAgentClasses()` — add `new ParagraphRecombineWithCoherencePassAgent()`
- [ ] `evolution/src/lib/core/agents/index.ts` barrel — add export (load-bearing for attribution-extractor registration per Phase 8 of `develop_reflection_and_generateFromParentArticle_agent_evolution_20260430`)
- [ ] Wizard mirror copies at `src/app/admin/evolution/strategies/new/page.tsx` — there's a wizard-side replica of `canBeFirstIteration` / `isVariantProducingAgentType` (lines ~206-225 per Architecture review); update both

Cost metrics:
- [ ] `evolution/src/lib/core/agentNames.ts` `AGENT_NAMES` — add ONLY `'coherence_pass_propose'` and `'coherence_pass_review'` (NOT `paragraph_rewrite_isolated` — that label was a confusion in earlier drafts; see AgentName decision above)
- [ ] `evolution/src/lib/core/agentNames.ts` `COST_METRIC_BY_AGENT` — map both new labels to `'paragraph_recombine_coherence_cost'`. Leave `paragraph_rewrite` / `paragraph_rank` mappings unchanged (they continue to route to `paragraph_recombine_cost`).
- [ ] `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts:39` `OUTPUT_TOKEN_ESTIMATES` — add entries for both new labels (proposer: ~1200, approver: ~150 — matching the `criteria_proposer` / `criteria_forward_approver` shape since they have similar I/O profiles)
- [ ] `evolution/src/lib/metrics/registry.ts` — add `paragraph_recombine_coherence_cost` as run-level metric (during_execution, cost category, listView: true). Add propagation defs: `total_paragraph_recombine_coherence_cost` (sum) + `avg_paragraph_recombine_coherence_cost_per_run` (avg) at strategy + experiment levels.
- [ ] `evolution/src/lib/metrics/registry.ts` — add `slot_provenance_ratio_p25` + `slot_provenance_ratio_p50` (at_finalization, rating category) + propagation to strategy/experiment levels
- [ ] **Dynamic-prefix subagent metric registration** — register `subagent:coherence_pass.cost`, `subagent:coherence_pass.propose.cost`, `subagent:coherence_pass.review.cost`, `subagent:coherence_pass.apply.cost` propagation defs in the registry (they're written by `computeSubagentMetrics` from the Phase 6 parser, but need explicit registry entries for strategy/experiment-level propagation — mirrors the existing `subagent:cycle.propose.cost` pattern from PR #1109). This bullet is the cross-link to Phase 6's `accumulateSubagentSums` re-keying — both halves must land in the same commit.

Tactics + colors:
- [ ] `evolution/src/lib/core/tactics/index.ts` `MARKER_TACTICS` (line ~161) — add `{ name: 'paragraph_recombine_with_coherence_pass', label: 'Paragraph Recombine with Coherence Pass', agent_type: 'paragraph_recombine_with_coherence_pass', category: 'meta' }`
- [ ] `evolution/src/lib/core/tactics/index.ts` `TACTIC_PALETTE` (line ~83) — add `paragraph_recombine_with_coherence_pass: '#0891b2'` (dark cyan — distinct from existing `paragraph_recombine: '#06b6d4'` light cyan; same family signals kinship)
- [ ] Run `npx ts-node evolution/scripts/syncSystemTactics.ts` post-deploy to add the marker tactic row

New agent class skeleton:
- [ ] Create directory `evolution/src/lib/core/agents/paragraphRecombineWithCoherencePass/`
- [ ] `ParagraphRecombineWithCoherencePassAgent.ts` skeleton extending `Agent`, `name = 'paragraph_recombine_with_coherence_pass'`, `usesLLM = true`, `executionDetailSchema = paragraphRecombineWithCoherencePassExecutionDetailSchema` (new schema in `evolution/src/lib/schemas.ts` — extends `slotRecombineExecutionDetailSchema` with optional `coherencePass.cycles[]` + `recombinedBeforeCoherencePass: string | undefined`)
- [ ] Side-effect `registerAttributionExtractor('paragraph_recombine_with_coherence_pass', (_detail) => 'paragraph_recombine_with_coherence_pass')` at bottom of file (mirrors existing pattern)

Kill switch:
- [ ] Add `EVOLUTION_PARAGRAPH_RECOMBINE_COHERENCE_ENABLED` env var (default `'true'`; reads as `process.env.X !== 'false'` per the string-contract convention in `reference.md`). When `'false'`: dispatch loop logs an `iteration_complete` skip and returns; existing behavior — does NOT fall back to plain `paragraph_recombine` (researchers wanting the fallback should dispatch the existing agent type explicitly).
- [ ] Document the env var in `evolution/docs/reference.md` § Kill Switches / Feature Flags

- [ ] Run lint + tsc + unit tests; commit

### Phase 3: Rewrite prompt + per-slot pipeline (parallel-only, no priorPicks)
- [ ] Build `buildIsolatedParagraphRewritePrompt(paragraphText, directiveIndex, M)` at `evolution/src/lib/core/agents/paragraphRecombineWithCoherencePass/buildIsolatedParagraphRewritePrompt.ts` — directives MUST forbid adding new content, definitions, metaphors, analogies, new examples; permit reorganization, sentence-level tightening, redundancy deletion (without losing non-redundant content)
- [ ] Wire the per-slot pipeline: reuse `extractParagraphsWithRanges`, `upsertSlotTopic`, `loadArenaEntries`, `rankNewVariant` (with `comparisonMode='paragraph'`, NO `priorPicks`), `persistSlotMatches`, `assembleRecombinedArticle`
- [ ] Add a per-rewrite validator `validateIsolatedParagraphRewrite` enforcing length window (±20% same as `paragraph_recombine`), no bullets/lists/tables/H1, and a "no-new-content" heuristic (high parent-sentence verbatim ratio gate — leveraging the existing `sentenceVerbatimRatio` helper)
- [ ] Unit + integration tests for the rewrite prompt + per-slot pipeline
- [ ] Run lint + tsc + unit + integration; commit

### Phase 4: Extract `runEditingCycle()` + coherence pass on the assembled winners

**`runEditingCycle()` helper signature (LOCKED — resolves Mode B + invariant gaps):**

```ts
// evolution/src/lib/core/agents/editing/runEditingCycle.ts
export type RunEditingCycleArgs = {
  text: string;                                  // current article text (caller owns the loop state)
  llm: EvolutionLLMClient;                       // caller's per-invocation client (I1 — never instantiate own)
  costScope: AgentCostScope;                     // caller's scope (I2 cost-snapshot source)
  cycleNumber: number;                           // 1-indexed for labeling only; helper is stateless
  proposerLabel: AgentName;                      // 'iterative_edit_propose' | 'coherence_pass_propose'
  approverLabel: AgentName;                      // 'iterative_edit_review'  | 'coherence_pass_review'
  models: { editing: string; approver: string };
  validateOpts?: ValidateEditGroupsOptions;      // undefined → existing no-opts default (SIZE_RATIO_HARD_CAP=1.5)
  driftRecovery: 'snap' | 'skip';                // 'snap' = current IterativeEditingAgent behavior; 'skip' = coherence pass
  // Mode A path (default):
  proposerSystemPrompt?: string;                 // pre-built; defaults to buildProposerSystemPrompt()
  proposerUserPrompt?: string;                   // pre-built; defaults to buildProposerUserPrompt(text)
  // Mode B path (rewrite-then-diff — used by IterativeEditingRewriteAgent ONLY):
  rewriteMode?: {
    proposerSoftCap: number;                     // editingProposerSoftCap from iterCfg
    coalesceAndCap: boolean;                     // !iterCfg.disableApproverFiltering
    capLimit?: number;                           // default 10 (matches capGroupsByMagnitude default)
  };
};
export type RunEditingCycleResult = {
  newText: string;                               // post-apply text, or input.text on failure
  cycle: EditingCycle;                           // fully-populated cycle detail (includes proposerMode, rationale, etc. for Mode B)
  stopReason?: IterativeEditingStopReason;       // when set, caller should NOT continue looping
  partialCycleOnThrow?: EditingCycle;            // set when helper threw mid-cycle; caller pushes to its cycles[] before re-throw
};
```

- [ ] **Refactor `IterativeEditingAgent`**: extract the per-cycle inner block (lines ~200-547) into the new helper above. **Mode B handling stays INSIDE the helper** via the `rewriteMode?` discriminator — the helper performs (a) `splitRationaleAndRewrite`, (b) `computeMarkupFromRewrite` with `RewriteTooLargeError`/`RewriteParseError`/`DiffEngineError` handling, (c) `coalesceAdjacentGroups` + `capGroupsByMagnitude` post-parse when `coalesceAndCap === true`, (d) attaches `proposerMode: 'rewrite'`, `rationale`, `rewriteText`, `computedMarkup` to the cycle, (e) threads `modeBRationale` into `buildApproverUserPrompt`. Mode A path is the simpler proposer-emits-markup-directly flow used by both legacy IterativeEditingAgent invocations and the new coherence pass.
- [ ] **I3 (partial-detail-on-throw) ownership** — helper returns `partialCycleOnThrow` populated when it throws mid-cycle (before the throw lands, helper builds the best-effort `EditingCycle` from accumulated state — proposer cost recorded, parse result available, etc.). Caller (IterativeEditingAgent's outer loop OR the new agent's coherence-pass step) pushes `partialCycleOnThrow` into its `cycles[]` array BEFORE re-throwing. IterativeEditingAgent's outer try/catch (line ~570) calls `cycles.push(result.partialCycleOnThrow)` before re-throw; new agent's coherence-pass step does the same into `execution_detail.coherencePass.cycles[]` before re-throw. Without this contract, refactoring IterativeEditingAgent silently changes its error-path behavior.
- [ ] **I2 (cost-snapshot) ownership** — helper internally snapshots `costScope.getOwnSpent()` before proposer call and before approver call, writes `proposeCostUsd` / `approveCostUsd` / `driftRecoveryCostUsd` into the returned cycle. Caller does NOT need to snapshot (helper owns the per-LLM-call attribution).
- [ ] **I1 (no nested `Agent.run()`) preservation** — helper calls `llm.complete()` directly using the injected `llm` arg; helper does NOT instantiate any Agent class. Wrapper agents continue calling `.execute()` (NOT `.run()`) on inner agents elsewhere — this invariant is unaffected by the extract.
- [ ] **Behavior preservation contract** — `IterativeEditingAgent.execute()` calls `runEditingCycle({ ..., validateOpts: undefined, driftRecovery: 'snap', proposerLabel: 'iterative_edit_propose', approverLabel: 'iterative_edit_review', proposerSystemPrompt: buildProposerSystemPrompt(), proposerUserPrompt: buildProposerUserPrompt(current.text), rewriteMode: this.isRewriteMode ? { proposerSoftCap: iterCfg?.editingProposerSoftCap ?? 3, coalesceAndCap: !iterCfg?.disableApproverFiltering, capLimit: 10 } : undefined })`. The post-extract `IterativeEditingAgent.execute()` shrinks to ~80 LOC: outer multi-cycle loop with `cycles.push(result.cycle)` + `current = { text: result.newText }` between iterations + `if (result.stopReason) break` + post-cycle ranking step + outer error-path I3 plumbing. **Observable behavior MUST stay bit-identical** — same prompts, same `SIZE_RATIO_HARD_CAP=1.5`, same `'snap'` drift, same AgentName labels.
- [ ] Re-point IterativeEditingAgent's existing tests:
  - `IterativeEditingAgent.test.ts` — most cycle-internals tests move to a new `runEditingCycle.test.ts`; agent-level tests retain coverage of multi-cycle loop, Mode A/B switching, post-cycle ranking, error paths
  - `IterativeEditingAgent.invariants.test.ts` — stays at agent level; assertion targets shift (helper-level invariants tested via direct unit calls; agent-level invariants tested through `Agent.run()`)
  - `IterativeEditingRewriteAgent.test.ts` — re-pointed to exercise Mode B path through the helper
  - `parseProposedEdits.property.test.ts` — unchanged (parser is unchanged)
- [ ] **Behavior-preservation parity test** — `evolution/src/lib/core/agents/editing/runEditingCycle.parity.test.ts` runs a fixed seed + fixed input through BOTH the old IterativeEditingAgent code path (captured as a JSON fixture pre-refactor) AND the new helper-based call site, asserting deep equality of `newText` + `cycles[]` + `cost` + `stopReason`. **This is the highest-risk piece of the refactor — do NOT merge without this test passing.**

  **Fixture-capture order (MUST follow this sequence — otherwise the parity test is tautological):**
  1. On `main` (BEFORE any refactor): write a temporary `evolution/scripts/captureRunEditingCycleFixture.ts` that exercises `IterativeEditingAgent.execute()` with a mocked LLM client returning a deterministic fixture, dumps the resulting `{ newText, cycles[], cost, stopReason, executionDetail }` to a JSON file at `evolution/src/lib/core/agents/editing/__fixtures__/runEditingCycle.parity.fixture.json`. Cover BOTH Mode A and Mode B paths (two fixture files: `.modeA.json` and `.modeB.json`).
  2. Commit the capture script + the fixtures in a SEPARATE commit on the refactor branch, BEFORE the refactor commit lands. Commit message: `chore(evolution): capture pre-refactor parity fixtures for runEditingCycle extract`.
  3. Land the `runEditingCycle()` extract in subsequent commits. The parity test reads the fixtures and asserts deep equality against the helper-based call site.
  4. Code reviewer verifies via `git log --follow` that the fixture commit predates the refactor commit. The capture script can be deleted in a follow-up commit after merge (fixtures are the durable artifact).
  Same flow for `dispatchParagraphRecombineFamily.parity.test.ts` (see Phase 5a).
- [ ] Build `buildCoherencePassProposerPrompt.ts` (system + user functions) — fork of `proposerPrompt.ts` focused on inter-paragraph seams: transitions between paragraphs, pronoun resolution across paragraph boundaries, dedupe of repeated phrasing from combining isolated rewrites, smoothing voice/tone discontinuities. Keep the byte-equality contracts (RULE 1 outside-markup fidelity, RULE 2 old-side fidelity) and the `<source>…</source>` / `<output>…</output>` wrapper. Add an explicit instruction that the input is a recombined article (paragraphs may not flow naturally) and edits should be CONSERVATIVE (1-3 atomic edits per group; prefer single-sentence smoothing over multi-sentence rewrites).
- [ ] In the new agent's `execute()`, after assembly + format validation, call `runEditingCycle({ text: recombinedText, llm, costScope: invocationScope, cycleNumber: 1, proposerSystemPrompt: buildCoherencePassProposerSystemPrompt(), proposerUserPrompt: buildCoherencePassProposerUserPrompt(recombinedText), proposerLabel: 'coherence_pass_propose', approverLabel: 'coherence_pass_review', models: { editing: coherencePassProposerModel ?? generationModel, approver: coherencePassApproverModel ?? judgeModel }, validateOpts: { lengthCapRatio: 1.02, redundancyJaccardThreshold: 0.30, flowGuardrailEnabled: true }, driftRecovery: 'skip' })`. Persist `result.cycle` into `execution_detail.coherencePass.cycles[0]`. On throw, push `result.partialCycleOnThrow` into the same array before re-throw (per I3 contract).
- [ ] Use `result.newText` as the variant's final text. If the coherence pass dropped all edits (`result.cycle.appliedCount === 0`), the variant's final text equals the recombined text (no-op pass is fine).
- [ ] Per-invocation budget gate: skip the entire coherence-pass step (don't even call `runEditingCycle`) when `invocationScope.getOwnSpent() >= 0.85 × perInvocationCap`. When skipped, record `execution_detail.coherencePass = { skipped: 'budget', spentAtSkip: ..., capUsd: ... }` so observability is preserved.
- [ ] Add observability counter: log `warn` when `cycle.approverGroups.length > 0 && cycle.appliedGroups.length === 0` (quietly-rejecting approver — could masquerade as "article was already coherent"). Increment a `coherence_pass_silent_rejection_count` run-level metric.
- [ ] Run lint + tsc + unit + integration; commit

### Phase 5: Dispatch wiring — extract shared helper first, then new branch

**Order matters: extract THEN wire.** Extracting the helper as a refactor of the existing branch (with parity test) before adding the new branch ensures the new branch inherits proven dispatch behavior. Reverse order would risk the new branch and existing branch silently diverging.

**Phase 5a — extract `dispatchParagraphRecombineFamily()` from existing branch** (no behavior change):
- [ ] Extract the existing `paragraph_recombine` dispatch logic at `runIterationLoop.ts:1339-1644` (~300 LOC) into a new file `evolution/src/lib/pipeline/loop/dispatchParagraphRecombineFamily.ts`. Suggested home (matches existing `editingDispatch.ts` + `projectDispatchPlan.ts` conventions in the same directory) — overrides the Q7 hand-wave that put the helper in `runIterationLoop.ts` (Architecture review minor #5).
- [ ] Helper signature: `dispatchParagraphRecombineFamily<TAgent extends { new(): { run: (...) => Promise<AgentResult<{variant, surfaced, matches}>> } }>({ AgentClass: TAgent, iterCfg, ctx (run-level), iterTracker, pool, ratings, matchCounts, comparisonCache, allMatches, randomSeed, iteration, iterIdx, iterBudgetUsd, resolvedConfig, logger, llmProvider, projector, mergeIterationType: 'paragraph_recombine' | 'paragraph_recombine_with_coherence_pass', killSwitchEnvVar: string })`. Returns `{ iterStopReason, iterVariantsCreated, surfacedVariants }`. Encapsulates: kill-switch check, eligible-parent set construction (seeded pre-shuffle for `maxDispatches > 1 + sourceMode='pool'`), parallel batch sizing (`min(DISPATCH_SAFETY_CAP, maxAffordable, maxDispatches, eligibleParents.length)`), `Promise.allSettled` parallel dispatch with B007-S2 peek-then-commit budget reservation, `actualAvgCostPerAgent` measurement, sequential top-up with `resolveSequentialFloor`, single `MergeRatingsAgent.run({ iterationType: mergeIterationType, matchBuffersAll, ... })` at iteration end.
- [ ] Refactor the existing `paragraph_recombine` branch in `runIterationLoop.ts` to a ~30-LOC call site: `const result = await dispatchParagraphRecombineFamily({ AgentClass: ParagraphRecombineAgent, mergeIterationType: 'paragraph_recombine', killSwitchEnvVar: 'EVOLUTION_PARAGRAPH_RECOMBINE_ENABLED', ... })`.
- [ ] **Behavior-preservation regression test** — `evolution/src/lib/pipeline/loop/dispatchParagraphRecombineFamily.parity.test.ts` runs fixed-seed dispatch through BOTH the pre-extract code path (snapshotted) AND the post-extract helper call, asserting deep equality of: per-iteration dispatch count, parent-shuffle order, parallel-batch parent IDs, sequential top-up trigger condition, MergeRatingsAgent input shape, final `iterStopReason` / `iterVariantsCreated`. **Do NOT merge without this test passing.** Follows the SAME fixture-capture-before-refactor sequence as Phase 4 (see Phase 4's load-bearing parity test bullet for the 4-step procedure — capture script committed first, refactor commits land afterward, reviewer verifies via `git log --follow`).

**Phase 5b — wire new branch via the shared helper** (~30 LOC):
- [ ] Add a sibling `else if (iterType === 'paragraph_recombine_with_coherence_pass')` branch in `runIterationLoop.ts` that calls `dispatchParagraphRecombineFamily({ AgentClass: ParagraphRecombineWithCoherencePassAgent, mergeIterationType: 'paragraph_recombine_with_coherence_pass', killSwitchEnvVar: 'EVOLUTION_PARAGRAPH_RECOMBINE_COHERENCE_ENABLED', ... })`. Pass the same projector function (`estimateParagraphRecombineCost` extended in Phase 5c to add coherence-pass cost) so the parallel-batch sizing math is correct for the new agent's larger per-invocation envelope.
- [ ] Article-level ranking happens INSIDE `ParagraphRecombineWithCoherencePassAgent.execute()` (same as existing `ParagraphRecombineAgent` — via `rankNewVariant` against the run pool when `input.initialPool` is non-empty). The agent's returned `matches` flow through `dispatchParagraphRecombineFamily` into the single `MergeRatingsAgent.run()` at iteration end.

**Phase 5c — projector extension**:
- [ ] `evolution/src/lib/pipeline/infra/estimateCosts.ts` — extend `estimateParagraphRecombineCost` to accept a new opts field `{ coherencePassEnabled?: boolean, coherencePassProposerModel?: string, coherencePassApproverModel?: string }`. When `coherencePassEnabled` is true, add a `coherencePassCost` line to `EstPerAgentValue` (modeled after `criteria_proposer + criteria_forward_approver` cost shape since the calls have similar I/O profiles).
- [ ] `evolution/src/lib/pipeline/loop/projectDispatchPlan.ts` — call the extended projector with the new agent's iter-config fields when `iterCfg.agentType === 'paragraph_recombine_with_coherence_pass'`. Wizard preview's "Likely total (with top-up)" column now reflects the new agent's full cost shape.

- [ ] Run lint + tsc + unit + integration + E2E critical; commit

### Phase 6: Admin UI + observability
- [ ] **Strategy wizard conditional field group** — at `src/app/admin/evolution/strategies/new/page.tsx`, add a "Coherence pass" section gated to `agentType === 'paragraph_recombine_with_coherence_pass'`: checkbox for `coherencePassEnabled` (default ✓), two model-override inputs (`coherencePassProposerModel` / `coherencePassApproverModel`), two number inputs for rewrite temp floor/ceiling. Update the per-invocation cap default to switch between $0.10 (enabled) and $0.05 (disabled) reactively. Update `projectDispatchPlan` to add a `coherencePassCost` line to `EstPerAgentValue` so the Dispatch Plan Preview reflects the new agent's cost shape. Existing wizard already has the conditional-fields pattern (per-iteration card hides irrelevant fields based on `agentType`) — re-use it. ~80 LOC + wizard tests.
- [ ] **Subagent tree parser extension** — at `evolution/src/lib/shared/subagentTreeParser.ts`, add `parseParagraphRecombineWithCoherencePassTree(detail)` that calls existing `parseParagraphRecombineTree(detail)` (yields slot.* nodes + `'recombine'` deterministic node), then constructs a synthetic `'coherence_pass'` Composite L2 node whose `children` come from existing `parseIterativeEditingTree({ cycles: detail.coherencePass.cycles })` (wraps the cycles[] array in the shape `parseIterativeEditingTree` expects). Returns `[...slotTree, recombineNode, coherencePassNode]`. Add the new `agent_name` case to the `parseSubagentTreeByAgentName` switch.
- [ ] **CRITICAL: verify `accumulateSubagentSums` parent-name re-keying still works** — the existing logic at `experimentMetrics.ts:667-668` re-keys `cycle.*` nodes via `parentName === 'cycle' ? 'cycle.${node.name}' : node.name`. When `cycle.1` nodes are nested under our synthetic `'coherence_pass'` parent (instead of being top-level as in IterativeEditingAgent), the re-keying needs to either (a) still classify `propose`/`review`/`apply` under their `cycle.N` parent to roll up to `subagent:cycle.propose.cost` (which would MINGLE with plain `iterative_editing`'s contribution at strategy level), OR (b) re-key as `coherence_pass.propose`/`.review`/`.apply` for clean isolation. **Decision: pick (b).** Update `accumulateSubagentSums` to walk a third parent level: when `grandparentName === 'coherence_pass'` AND `parentName.startsWith('cycle.')`, classify the leaf as `coherence_pass.${node.name}` instead of `cycle.${node.name}`. Add `'coherence_pass'` + `'coherence_pass.propose'` + `'coherence_pass.review'` + `'coherence_pass.apply'` to `SUBAGENT_ALLOWLIST` in `experimentMetrics.ts`. **Without this re-keying, the new agent's coherence-pass costs would be silently summed into `subagent:cycle.propose.cost` alongside plain `iterative_editing` iterations — breaking strategy-level A/B isolation.**
- [ ] Add unit tests for the new parser case + the parent-name re-keying behavior at all three levels (slot tree alone, coherence pass alone, combined with mocked invocation detail).
- [ ] **Invocation Detail tab `detailViewConfig`** — three sections on the new agent class:
  - Configuration block (source mode, cutoff, rewrites per paragraph, max paragraphs, coherence pass enabled + proposer/approver models)
  - Slots table (slot index, original chars, rewrites count/surviving count, winner source, provenance ratio with the "noisy for REORDER/RESTRUCTURE" caveat tooltip from Q8)
  - Coherence pass summary block (status, edits proposed/accepted/applied, size ratio, cost) + side-by-side diff of `execution_detail.recombinedBeforeCoherencePass` vs `execution_detail.recombined.text` via the existing `SideBySideWordDiff` component
  ~60 LOC of declarative config (no new components — all primitives exist: table cells, `ConfigDrivenDetailRenderer`, `SideBySideWordDiff`).
- [ ] **Tactic leaderboard / Arena leaderboard / Run detail Variants tab** — these render generically off the marker tactic + cost metric. Confirm the new marker tactic (`paragraph_recombine_with_coherence_pass`, color `#0891b2`) shows correctly. No bespoke UI changes expected. Add `admin-evolution-paragraph-recombine-with-coherence-pass.spec.ts` to verify rendering at all three surfaces.
- [ ] Add to docs_to_update list: `paragraph_recombine.md` (new sibling section or new file `paragraph_recombine_with_coherence_pass.md`), `agents/overview.md`, `multi_iteration_strategies.md`, `cost_optimization.md`, `metrics.md` (including the provenance-metric noise caveat), `reference.md`, `strategies_and_experiments.md`, `visualization.md` (new agent's invocation detail tab structure).

**UI edge cases to handle in Phase 6:**
- [ ] **Coherence pass section's `coherencePassEnabled=false` collapse behavior** — the four coherence-pass fields (proposer model, approver model, temp floor, temp ceiling) should grey-out (not vanish) when the checkbox is off, so users can see what they're disabling. Match the model-override grey-out pattern used by `iterative_editing` in the same wizard.
- [ ] **Slots table provenance column tooltip** — must clearly say: "Sentence-level Levenshtein matching; noisy for REORDER and RESTRUCTURE directives, reliable for TIGHTEN. Low values do NOT necessarily indicate prompt violation." Tooltip text lives next to the column header. Without this, a casual reader misreads `0.4` as "60% new content" when it might just be a restructure.
- [ ] **Subagent tree depth L4 verification** — the new agent's tree reaches `coherence_pass → cycle.1 → propose/review/apply` which is L4. Existing `SubagentsTab` UI handles L4 (verified by `parseProposerApproverCriteriaTree` shape). No new collapse/expand logic needed, but add an E2E assertion that L4 nodes render.

- [ ] Run lint + tsc + unit + integration + E2E critical + E2E evolution; commit

### Phase 7: Manual smoke + staging dispatch + 3-arm A/B
- [ ] Run `npm run dev` locally + manually dispatch one strategy with the new agent on a known article via the wizard
- [ ] Verify: per-slot Elo arena populates, coherence pass produces small edit count, article variant emitted with parent lineage correct, cost metric splits between `paragraph_recombine_cost` (slot work) + `paragraph_recombine_coherence_cost` (coherence pass)
- [ ] Verify post-coherence-pass article diff is NON-EMPTY in at least one test article (guards against the tight `validateEditGroups` opts silently dropping every edit — see Phase 4 observability counter)
- [ ] Verify the L4 subagent tree (`coherence_pass → cycle.1 → propose/review/apply`) renders correctly in the SubagentsTab on the invocation detail page
- [ ] **3-arm staging A/B (the project's central scientific question)** — dispatch a small experiment on staging comparing:
  - **Arm A** (`paragraph_recombine_with_coherence_pass` + `coherencePassEnabled: true`): the full new agent. Tests the project hypothesis.
  - **Arm B** (`paragraph_recombine_with_coherence_pass` + `coherencePassEnabled: false`): new agent WITHOUT the coherence pass. Isolates the coherence-pass contribution from the other changes (new directives + low-temp ladder + no priorPicks).
  - **Arm C** (existing `paragraph_recombine`): baseline. Confirms the new agent (even with coherence off) differs from the existing agent only via the rewrite directives + ladder + isolation choice.
  Use the same prompt + same seed across all 3 arms. Run 5+ runs per arm for statistical power.
- [ ] Acceptance criteria for staging A/B (document BEFORE dispatch):
  - Arm A `eloAttrDelta:paragraph_recombine_with_coherence_pass:paragraph_recombine_with_coherence_pass` median ≥ Arm B median (coherence pass helps)
  - Arm B median ≥ Arm C `eloAttrDelta:paragraph_recombine:paragraph_recombine` median − 10 (new directives + low-temp don't catastrophically regress)
  - `slot_provenance_ratio_p25` ≥ 0.5 for Arm A and Arm B (rewrites are mostly preserving content; low values flagged for manual review of REORDER/RESTRUCTURE false-positive caveat)
  - `coherence_pass_silent_rejection_count` < 50% of Arm A invocations (approver isn't quietly rejecting everything)
- [ ] If acceptance criteria fail: investigate; may need to re-tune `coherencePassRewriteTempCeiling`, `lengthCapRatio`, or proposer prompt before promoting to main pipeline.

## Testing

### Unit Tests

**New code unit tests:**
- [ ] `evolution/src/lib/core/agents/paragraphRecombineWithCoherencePass/buildIsolatedParagraphRewritePrompt.test.ts` — verify directives include no-new-content/no-new-definitions/no-new-metaphors clauses; verify length-window block; verify directive variation across rewrite indices (REORDER / TIGHTEN / RESTRUCTURE)
- [ ] `evolution/src/lib/core/agents/paragraphRecombineWithCoherencePass/buildCoherencePassProposerPrompt.test.ts` — verify inter-paragraph-seam focus; verify byte-equality contracts (RULE 1 + RULE 2) carried over from `proposerPrompt.ts`; verify the "conservative — 1-3 atomic edits per group" instruction is present
- [ ] `evolution/src/lib/core/agents/paragraphRecombineWithCoherencePass/ParagraphRecombineWithCoherencePassAgent.test.ts` — happy path (3 slots × 3 rewrites + coherence pass with 5 accepted edits); per-slot persistence; lineage = [parent]; format-invalid fallback; per-slot self-abort; **coherencePassEnabled=false path** (no coherence call, perInvocationCap defaults to $0.05, `execution_detail.coherencePass = { skipped: 'disabled' }`); coherence-pass budget gate fires when scope >= 0.85× cap (records `skipped: 'budget'`); coherence-pass silent-rejection observability counter fires when approverGroups > 0 && appliedGroups === 0
- [ ] `evolution/src/lib/shared/slotProvenanceRatio.test.ts` — verify the compute function on hand-crafted fixtures: (a) TIGHTEN result with deleted sentences → high ratio (~0.9), (b) REORDER result with word-reordering within sentences → DEMONSTRATED FALSE-POSITIVE LOW RATIO (test asserts this and documents the noise), (c) RESTRUCTURE result with split/combined sentences → DEMONSTRATED FALSE-POSITIVE LOW RATIO. Test docstring explicitly states the metric's noise characteristics so future readers understand the test's "expected low" assertions.

**Helper / refactor parity tests (load-bearing — do NOT merge without):**
- [ ] **`evolution/src/lib/core/agents/editing/runEditingCycle.parity.test.ts`** — runs fixed-seed fixture through BOTH pre-refactor IterativeEditingAgent code path (snapshotted as JSON fixture from the current code BEFORE the refactor lands) AND post-refactor helper-based call site. Asserts deep equality of: `newText`, `cycles[]` (full structural equality including all per-cycle fields), `cost`, `stopReason`, `executionDetail` shape. Test covers BOTH Mode A and Mode B paths. **Highest-risk piece of the project — load-bearing component refactor.**
- [ ] **`evolution/src/lib/pipeline/loop/dispatchParagraphRecombineFamily.parity.test.ts`** — runs fixed-seed dispatch through BOTH the pre-extract `paragraph_recombine` branch (snapshotted) AND the post-extract shared helper call. Asserts deep equality of: per-iteration dispatch count, parent-shuffle order, parallel-batch parent IDs, sequential top-up trigger condition, `MergeRatingsAgent.run()` input shape, final `iterStopReason` / `iterVariantsCreated`. **Do NOT merge without.**

**Helper-level unit tests:**
- [ ] `evolution/src/lib/core/agents/editing/runEditingCycle.test.ts` — exercise each opts permutation: (a) Mode A + `validateOpts: undefined` (legacy default), (b) Mode A + tight opts (`lengthCapRatio: 1.02, redundancyJaccardThreshold: 0.30, flowGuardrailEnabled: true`), (c) Mode A + `driftRecovery: 'skip'` (no drift handling), (d) Mode A + `driftRecovery: 'snap'` (legacy default), (e) Mode B + `rewriteMode: { proposerSoftCap: 3, coalesceAndCap: true }`, (f) Mode B + `rewriteMode: { proposerSoftCap: 8, coalesceAndCap: false }` (bypass). Each permutation asserts the returned `cycle` has the expected proposerMode + presence/absence of `coalesceAdjacentGroups`/`capGroupsByMagnitude` effects.
- [ ] `evolution/src/lib/core/agents/editing/runEditingCycle.invariants.test.ts` — assert I1 (helper never calls `.run()` on any Agent class — sanity check via static import/no-mock test), I2 (helper's returned cycle fields `proposeCostUsd` + `approveCostUsd` sum to the `costScope.getOwnSpent()` delta across the call), I3 (when helper throws mid-cycle, `partialCycleOnThrow` is populated with proposeCostUsd recorded so far + parse-result-if-available)
- [ ] **`validateEditGroups` boundary tests** at the new opts settings — `evolution/src/lib/core/agents/editing/validateEditGroups.coherencePassOpts.test.ts` — table-driven cases at 1.00x, 1.01x, 1.019x, 1.021x, 1.05x size ratios assert accept/reject behavior under `lengthCapRatio: 1.02`. Separate test for `redundancyJaccardThreshold: 0.30` boundary. Separate test for `flowGuardrailEnabled: true` interaction with paragraph-start transitions. Confirm at least one known-good coherence-pass-shape output passes ALL three opts simultaneously (catches over-strictness regressions).

**Schema + dispatch tests:**
- [ ] `evolution/src/lib/pipeline/loop/runIterationLoop.coherence_pass_branch.test.ts` — dispatch routing for the new agent type; mutex Zod refinements; kill-switch behavior (env=false → iter skipped); the new agent type passes through `dispatchParagraphRecombineFamily` correctly
- [ ] `evolution/src/lib/schemas.test.ts` — Zod refinements for the new agent type: (a) coherence-pass-only fields are rejected on other agent types, (b) `coherencePassRewriteTempCeiling >= coherencePassRewriteTempFloor` refine fires correctly, (c) defaults applied correctly at consumption (`coherencePassEnabled: undefined → true`, `coherencePassProposerModel: undefined → generationModel`)
- [ ] `evolution/src/lib/pipeline/setup/findOrCreateStrategy.test.ts` — extend with cases: (a) strategy with `coherencePassEnabled: true` vs `coherencePassEnabled: false` produces DIFFERENT `config_hash` (the FIELD_GATES fix is verified), (b) strategy with `coherencePassEnabled: undefined` and `coherencePassEnabled: true` produce SAME `config_hash` (default folding works)
- [ ] `evolution/src/lib/shared/subagentTreeParser.test.ts` — extend with cases for the new `parseParagraphRecombineWithCoherencePassTree`: (a) slot tree alone renders correctly, (b) coherence pass alone renders correctly, (c) combined detail renders both, (d) parent-name re-keying in `accumulateSubagentSums` classifies `coherence_pass.propose` separately from `cycle.propose`

### Integration Tests
- [x] `src/__tests__/integration/evolution-paragraph-recombine-with-coherence-pass.integration.test.ts` — schema + normalize + config_hash integration (15 tests, all passing). Live-DB variant persistence + arena-row persistence + metric emission was DEFERRED — covered by per-module unit tests + the live-LLM run-pipeline E2E.
- [ ] Reuse fixtures from existing `evolution-paragraph-recombine-multi-dispatch.integration.test.ts` where possible.

### E2E Tests
- [x] `src/__tests__/e2e/specs/09-admin/admin-evolution-paragraph-recombine-with-coherence-pass.spec.ts` (`@evolution`) — wizard happy path (4 tests, all passing): agent-type dropdown exposes new type; selecting it surfaces 5-knob field group; toggling coherencePassEnabled disables 4 sibling inputs; submit creates strategy with right config. Live-dispatch + Subagents-tab + Detail-tab assertions were DEFERRED — covered by Phase 6 unit tests + the live-LLM run-pipeline E2E.
- [ ] Reuse fixtures from existing `admin-evolution-paragraph-recombine.spec.ts` where possible.

### Manual Verification
- [ ] Visually inspect a sample of rewrites — confirm they reorganize without adding new content, and that the coherence pass introduces only small inter-paragraph smoothing edits.
- [ ] Confirm the L4 subagent tree under real (not fixture) data renders correctly in `SubagentsTab` — promoted from Phase 6's "UI edge case" bullet to a runtime smoke check.

## Verification

### A) Playwright Verification (required for UI changes)
- [x] `src/__tests__/e2e/specs/09-admin/admin-evolution-paragraph-recombine-with-coherence-pass.spec.ts` — strategy wizard happy path (4/4 tests passing, 33.5s). Dispatch + run-detail assertions deferred — see Integration Tests note above.

### B) Automated Tests
- [x] `npm run test -- --testPathPatterns="paragraph_recombine_with_coherence_pass|paragraphRecombineWithCoherencePass|runEditingCycle|subagentTreeParser.coherence_pass"` — 50/50 passing
- [x] `npm run test:integration -- --testPathPatterns="evolution-paragraph-recombine-with-coherence-pass.integration"` — 15/15 passing
- [x] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-paragraph-recombine-with-coherence-pass.spec.ts` — 4/4 passing

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/paragraph_recombine.md` — add a section pointing to the new agent OR split out a sibling doc `paragraph_recombine_with_coherence_pass.md` (sibling preferred — the two agents have substantially different behavior despite shared infrastructure)
- [ ] `evolution/docs/agents/overview.md` — add a `ParagraphRecombineWithCoherencePassAgent` section. Document the AgentName label decision: REUSED `paragraph_rewrite` + `paragraph_rank` (cost flows to existing `paragraph_recombine_cost`) + NEW `coherence_pass_propose` + `coherence_pass_review` (cost flows to new `paragraph_recombine_coherence_cost`).
- [ ] `evolution/docs/multi_iteration_strategies.md` — extend the `iterationConfigSchema` enum table; document the 5 new iter-config fields (`coherencePassEnabled`, `coherencePassProposerModel`, `coherencePassApproverModel`, `coherencePassRewriteTempFloor`, `coherencePassRewriteTempCeiling`) + their Zod refinements + their participation in `config_hash`.
- [ ] `evolution/docs/strategies_and_experiments.md` — extend `IterationConfig` enum listing
- [ ] `evolution/docs/cost_optimization.md` — add `paragraph_recombine_coherence_cost` section with cost envelope (per-invocation cap $0.10 with coherence on, $0.05 off; coherence pass typical ~$0.0035; budget gate at 0.85×).
- [ ] `evolution/docs/metrics.md` — register the new cost metric `paragraph_recombine_coherence_cost` + strategy/experiment rollups + register `slot_provenance_ratio_p25` / `_p50` with the **noise caveat** (sentence-level Levenshtein matching is noisy for REORDER and RESTRUCTURE directives; reliable for TIGHTEN; low values do NOT necessarily indicate prompt violation). Register the new `subagent:coherence_pass.*` dynamic-prefix metric and document the parent-name re-keying in `accumulateSubagentSums`.
- [ ] `evolution/docs/reference.md` — add the new env var `EVOLUTION_PARAGRAPH_RECOMBINE_COHERENCE_ENABLED` (string-contract `!== 'false'`); add the 2 new AgentName labels; document the `runEditingCycle()` helper extraction at the appropriate spot.
- [ ] `evolution/docs/variant_lineage.md` — clarify lineage shape for the new agent (single primary parent `[originalParentVariantId]`; slot winners in `execution_detail.slots[i].winnerSlotVariantId` not in `parent_variant_ids`).
- [ ] `evolution/docs/architecture.md` — add the new agent type to the iteration-type table; reference the shared `dispatchParagraphRecombineFamily` helper.
- [ ] `evolution/docs/editing_agents.md` — document the `runEditingCycle()` extract; explain Mode A vs Mode B path through the helper; explain the `coherencePassEnabled` consumer pattern.
- [ ] `evolution/docs/visualization.md` — document the new agent's invocation detail tab structure (Subagents tab with L4 `coherence_pass → cycle.1 → propose/review/apply`; Detail tab with side-by-side `recombinedBeforeCoherencePass` vs `recombined.text` diff).

## Rollback

The plan touches both new code (low-risk — gated by kill switch) AND a load-bearing refactor (`runEditingCycle()` extract — forward-only). Rollback paths differ:

| Failure mode | Rollback action | Notes |
|---|---|---|
| Dispatch regression in new agent (e.g., infinite loop, cost blowout, format-invalid spam) | Flip `EVOLUTION_PARAGRAPH_RECOMBINE_COHERENCE_ENABLED=false`. Sub-minute ops change. | Kill switch covers the entire new dispatch branch. Strategies using the new agent type will record `iteration_complete` skips with zero variants. |
| Regression in coherence pass behavior (e.g., LLM violating prompt, tight opts dropping all edits, silent rejections) | Iter-config field overrides: bump `coherencePassRewriteTempCeiling`, switch `coherencePassProposerModel`, or set `coherencePassEnabled: false` per-strategy. | No redeploy needed. |
| **Regression in `IterativeEditingAgent` post-`runEditingCycle()` extract** (e.g., Mode A or Mode B behavior change vs pre-refactor) | **Full PR revert is the only path** — no env flag covers this. Parity test must pass pre-merge to make this unlikely. | This is the project's main deployment risk. The Phase 4 parity test (`runEditingCycle.parity.test.ts`) is load-bearing for protection. |
| **Regression in `paragraph_recombine` post-`dispatchParagraphRecombineFamily()` extract** | Full PR revert. Parity test (`dispatchParagraphRecombineFamily.parity.test.ts`) must pass pre-merge. | Same risk profile as the editing helper. |
| Schema validation breaks existing strategies (e.g., new Zod refinement too strict) | Revert the schemas.ts hunk. Other Phase 2 changes are mostly additive (enum extensions, new entries in lookups). | Validate against current production strategies BEFORE merge by running `npm run test:integration -- --grep "schemas"`. |
| New `subagent:coherence_pass.*` metric write fails (e.g., allowlist mismatch) | Drop the new SUBAGENT_ALLOWLIST entries; the metric just doesn't emit. No data loss; observability degraded. | `computeSubagentMetrics` is fire-and-forget; metric absence doesn't block the pipeline. |

**Deployment risk classification: MEDIUM.** The kill switch covers the new agent fully, but the two extract refactors (`runEditingCycle`, `dispatchParagraphRecombineFamily`) are forward-only. Both parity tests are MUST-PASS gates pre-merge.

**No DB migrations needed.** `evolution_variants.variant_kind` + `evolution_prompts.prompt_kind` + `sync_to_arena` RPC already support what this project requires (existing migrations from `rank_individual_paragraphs_evolution_20260525` cover it). Confirmed via research doc Key Finding #2.

This means `/finalize` Step 5.5 migration-verify Docker step is intentionally bypassed; `lint-migrations-idempotent` and `check-migration-order` CI jobs don't fire; no production-migration coordination needed.

## Review & Discussion

### Iteration 1 (initial review): 3/5/3/3 — Consensus NOT reached
14 critical gaps fixed:
- Phase 2: full enumeration of touchpoints (canBeFirstIteration, producesNewVariants, MergeRatingsAgent.iterationType, agentRegistry, wizard mirrors, OUTPUT_TOKEN_ESTIMATES, agents/index.ts barrel)
- Phase 2: `findOrCreateStrategy.ts` `FIELD_GATES` + `normalizeIteration` extension for all 11 paragraph_recombine-family fields + conditional `perInvocationCapUsd` default
- Phase 2: AgentName label decision locked — reuse `paragraph_rewrite`/`paragraph_rank` (route to existing `paragraph_recombine_cost`); only `coherence_pass_propose`/`coherence_pass_review` are new (route to new `paragraph_recombine_coherence_cost`)
- Phase 4: `runEditingCycle()` helper signature locked with full Mode B accommodation via `rewriteMode?` discriminator (proposerSoftCap, coalesceAndCap, capLimit)
- Phase 4: I1/I2/I3 invariant ownership specified — helper owns I2 cost snapshots; caller owns I3 via returned `partialCycleOnThrow`
- Phase 4: behavior-preservation parity test (`runEditingCycle.parity.test.ts`) added as MUST-PASS pre-merge gate
- Phase 4: silent-rejection observability counter (`coherence_pass_silent_rejection_count`)
- Phase 5: rewritten as Phase 5a (extract helper, parity test) + Phase 5b (new branch via helper, ~30 LOC) + Phase 5c (projector extension)
- Phase 5: `dispatchParagraphRecombineFamily.parity.test.ts` added as MUST-PASS gate
- Phase 6: subagent parser parent-name re-keying — decision (b) classify as `coherence_pass.propose/.review/.apply` for clean A/B isolation vs plain `iterative_editing`'s `cycle.*`
- Phase 7: 3-arm A/B (coherence on / coherence off / existing paragraph_recombine baseline) with documented acceptance criteria
- Added Rollback section with risk classification and per-failure-mode rollback actions
- Testing: parity tests + boundary tests for validate opts + `coherencePassEnabled=false` path + provenance ratio tests

### Iteration 2: 4/5/5 — Consensus NOT reached (Security 4/5 on fixture-timing risk)
3 minor issues addressed:
- Fixture-capture 4-step procedure locked: capture script committed BEFORE refactor commits land; reviewer verifies via `git log --follow`. Applied to both `runEditingCycle.parity.test.ts` and `dispatchParagraphRecombineFamily.parity.test.ts`
- iterationType enum sites corrected to 4 DECLARING (schemas.ts:579, MergeRatingsAgent.ts:37, schemas.ts:2195, schemas.ts:2253) + 1 inherited (runIterationLoop.ts:107 via imported type alias)
- `subagent:coherence_pass.*` dynamic-prefix metric registry entries added to Phase 2 with explicit "same-commit cross-link" to Phase 6's `accumulateSubagentSums` re-keying

### Iteration 3: 5/5/5 — ✅ CONSENSUS REACHED
Zero critical gaps remaining across Security, Architecture, and Testing perspectives. Remaining minor issues are cosmetic (statistical-test rigor for Phase 7 A/B, logger param on `runEditingCycle`, integration test asserting marker tactic on emitted variants). These can be tightened during execution without re-planning.

**Plan is ready for execution.** Recommended next step: begin Phase 1 → Phase 2 implementation, with the two parity-test fixture captures committed BEFORE refactor commits land.
