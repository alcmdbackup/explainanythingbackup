# rank_individual_paragraphs_evolution_20260525 Plan

## Background
Improve evolved articles by decomposing the parent into paragraphs, rewriting each paragraph in place via M parallel LLM calls, ranking the M+1 candidates (rewrites + original) per slot via the existing Elo pairwise machinery, and recombining the per-slot winners into one variant. This adds paragraph-level granularity to a pipeline that today only ranks whole articles. Operates on ONE parent variant pulled from the pool (not the seed), inheriting the parent's heading structure unchanged so paragraphs are rewritten in place — no donors moved across heading boundaries, no heading-drift failure mode.

## Requirements (from GH Issue #NNN)
Use the Background as the requirements anchor.

## Problem
The existing pipeline operates at whole-article granularity: every variant-producing agent (`generate`, `reflect_and_generate`, `criteria_*`, `debate_and_generate`, `iterative_editing`) emits a full article variant ranked pairwise against other full articles via Elo. This conflates per-paragraph signal — a strong opening paragraph paired with a weak conclusion drags the whole article's Elo down, and there's no machinery to surface "this paragraph is better than that one" independently of the surrounding text. Decomposing → rewriting per-paragraph → ranking per-paragraph → recombining lets the pipeline pick the local optimum at each slot, which the existing whole-article ranking cannot express.

## Design Decisions (from /research + walkthrough)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Paragraph-level decomposition** | Slots = paragraphs in the parent variant (`\n\n` split via `extractParagraphsWithRanges`, headings filtered out). Matches the project's framing. Heading structure stays intact. |
| D2 | **Minimal rewrite context** — `H1 + paragraph being rewritten` only | Cheapest. Trade-off accepted: transition breakage becomes an observed risk. Add observational metric (`paragraph_first_sentence_changed_rate` or similar) to measure in v1 data. Prompt warns the LLM about preserving transition phrases even without showing neighbors. |
| D3 | **Pairwise Elo tournament per slot** via existing `rankNewVariant` | Reuses 2-pass-reversal + Bradley-Terry. Per-slot Elo + uncertainty visible in admin UI. |
| D4 | **Lineage on the recombined article:** `parent_variant_ids = [originalParent, slot1_winner_variant_id, slot2_winner_variant_id, ..., slotN_winner_variant_id]` | Original at `[0]` so `elo_delta_vs_parent` compares to "the variant we were trying to improve" (mirrors DebateAgent). The other entries point to the **paragraph variant** that won each slot (its UUID in the arena tables — see D10). Under `MAX_PARENT_IDS=10` for typical articles (~12 paragraphs); truncation warn-logs handle the long-tail. |
| D5 | **Cannot be first iteration** (`canBeFirstIteration = false`) | Agent operates on one parent variant pulled from the pool via existing `sourceMode: 'pool'` + `qualityCutoff: {mode: 'topN', value: N}`. Strategies must front-load a variant-producing iteration. Mirrors DebateAgent. |
| D6 | **Post-emit ranking always-on** (no kill-switch env var) | Recombined variant runs through `rankNewVariant` against the run's pool so it competes in arena. Per-invocation $0.40 cap is the sole operational lever. Diverges from `EDITING_RANK_ENABLED` precedent — flagged. |
| D7 | **Two-stage validation:** per-paragraph pre-validate + standard `validateFormat` post-recombination | New helper composed from existing primitives (`hasBulletPoints`, `hasNumberedLists`, `hasTables`, `stripCodeBlocks`, `countShortParagraphs`) checks each rewrite before it consumes ranking budget. Final `validateFormat` is the safety net. Per-paragraph length gate: **0.90 ≤ `len(rewrite)/len(original)` ≤ 1.10** (both bounds; tighter than the prior 1.20× cap). |
| D8 | **Paragraph parse:** regex `\n\n` split + `stripCodeBlocks` first | Pure regex helper `extractParagraphsWithRanges(text)`. No remark-parse dependency in `evolution/` tree. ~30 LOC. |
| D9 | **Default knobs:** `rewritesPerParagraph=3, maxComparisonsPerParagraph=6, maxParagraphsPerInvocation=12, perInvocationCap=$0.40` | Conservative defaults; ~$0.011/variant with nano+qwen. Per-invocation cap matches DebateAgent convention. Pre-final-ranking gate fires at 0.9× cap ($0.36). |
| D10 | **Paragraph leaderboard via existing arena infra**, with topic-per-(parent_variant_id, slot_index) | Each paragraph slot of a parent variant becomes its own `evolution_prompts` row (the "arena topic"). Paragraph rewrites + originals are stored as `evolution_variants` rows (`agent_name = 'paragraph_rewrite' \| 'paragraph_original'`, `prompt_id = <slot_topic_id>`, `variant_content = <paragraph text>`). Pairwise matches use `evolution_arena_comparisons` keyed by the slot topic. **Cross-invocation Elo accumulation:** when parent V gets reused (top-N pool winner), its slot leaderboards get richer over time. Trade-off: cross-parent comparison impossible — V1 slot 3 and V2 slot 3 are separate topics. Defer semantic alignment to v2. |
| D11 | **Subagent model: stay with I1** — ONE invocation row per paragraph_recombine call | ~324 LLM calls (M=3 × N=12 rewrites + per-slot ranking) collapse to a single `evolution_agent_invocations` row. Per-paragraph data lives in `execution_detail.paragraphs[i].{rewrites[j], ranking}`. Per-LLM-call labels (`paragraph_rewrite`/`paragraph_rank`) bucket cost. Mirrors every other wrapper agent (ProposerApprover, IterativeEditing, Debate). The rich master-detail UI in Phase 6 surfaces drill-in without DB row proliferation. |
| D12 | **Prompt guardrail (1) is content-preservation** | "Preserve the original meaning and content — do not introduce, remove, or alter facts, claims, examples, citations, or quotations. The output must be the same paragraph said differently, not different ideas." Combined with the symmetric ±10% length gate (D7), this is the primary defense against the rewrite-disaster cohort identified in `criteria_agents.md`. |
| D13 | **First-class granularity field: `variant_kind` on `evolution_variants` + `prompt_kind` on `evolution_prompts`** | New columns: `variant_kind TEXT NOT NULL DEFAULT 'article' CHECK (variant_kind IN ('article','paragraph'))` and `prompt_kind TEXT NOT NULL DEFAULT 'article' CHECK (prompt_kind IN ('article','paragraph'))`. Self-documenting, extensible (e.g. future `'sentence'`, `'section'`), and decouples granularity-distinction from `agent_name` (which stays a tactic/marker, not a scope identifier). All existing rows default to `'article'` — backward compatible. **Comparisons inherit kind from their prompt** (no separate column on `evolution_arena_comparisons` needed — `prompt_kind` is derivable via JOIN). Supersedes the earlier `is_paragraph_topic` proposal. |
| D14 | **Future-proof v1 for additional granularities (sentence, section, span) at low cost** | Four cheap-now/valuable-later tweaks adopted in v1: (a) `upsertSlotTopic(kind, parentVariantId, slotIndex, originalText)` takes `kind` as a parameter from day one (vs `upsertParagraphSlotTopic` hard-coded for paragraphs); (b) the execution-detail Zod schema is `slotRecombineExecutionDetailSchema` — a discriminated union on `detailType: 'paragraph_recombine'` with room for future `'sentence_recombine'`, `'section_recombine'`, etc. (mirrors the criteria/debate Zod-union pattern); (c) the rich slots-detail UI component is `SlotsTab.tsx` generic over granularity (takes label/formatter props), not paragraph-specific; (d) topic naming convention `[<kind>] V-${parentId.slice(0,8)} #${slot+1}` with lowercase kind prefix (e.g. `[para]`, `[sent]`, `[sect]`). ~80 LOC of additional abstraction in v1; saves ~600+ LOC when v2 adds the next granularity. Low risk because the union-discriminator + generic-component patterns are already established elsewhere in the codebase. |
| D15 | **Cap arena pool size loaded per slot per invocation: top-K by Elo (default 20 for paragraph topics) + per-topic-size warn-log** | `loadArenaEntries(promptId)` gains an optional `topK?: number` parameter and `alwaysIncludeIds?: string[]` for guaranteed inclusion of the original slot variant. v1's `paragraph_recombine` calls it with `topK: 20`. Article-level callers omit the param (unlimited; backward compatible). Bounds: per-invocation LLM-call count is already capped by D9 (`maxComparisonsPerParagraph × M × N`), so adding a pool cap doesn't change cost — it improves ranking quality by focusing the 6 binary-search opponents on the strongest 20 candidates rather than against a noisy long tail. A warn-log fires when any slot topic accumulates >50 non-archived variants ("topic_arena_growth_warn") — surfaces in the run logs so researchers can manually archive cold variants via the existing arena admin UI. Deferred to v1.5+: automatic low-Elo archival. Deferred to v2: match-record TTL. |
| D16 | **Per-slot budget split with 90% self-abort** — even split across paragraph slots within one invocation | `perSlotBudgetUsd = perInvocationCap / paragraphCount` (defaults: $0.40 / 12 ≈ $0.033 per slot). Each slot runs inside a **per-slot AgentCostScope nested under the invocation scope** (`createAgentCostScope(invocationScope)` — nests cleanly because `reserve`/`release`/`getTotalSpent` delegate to parent while `recordSpend` is intercepted; the inner scope's `getOwnSpent()` returns just this slot's contribution). The slot's rewrite + ranking phases self-abort and fall back to keeping the original paragraph when `slotScope.getOwnSpent() >= 0.9 × perSlotBudgetUsd`. Mirrors `IterativeEditingAgent` Decisions §15 pattern. Slot abort records `discardReason: { failurePoint: 'slot_budget' }` in `execution_detail.slots[i]`. Headroom in defaults: expected per-slot cost is ~$0.003, so the cap is ~10× expected — even 5× spikes won't starve other slots. The invocation-level $0.40 cap + 0.9× pre-final-ranking gate (D6/D9) remain as outer protections. |
| D17 | **Reuse the arena leaderboard table as a reusable component, embedded inside the SlotsTab** | Extract the arena topic's leaderboard table (today inlined in `src/app/admin/evolution/arena/[topicId]/page.tsx`) into a self-contained client component `ArenaLeaderboardTable` that takes a `topicId` prop, fetches via existing `getArenaTopicDetailAction` + `getArenaEntriesAction` + `getArenaComparisonsAction`, and renders the same sortable Elo leaderboard. The standalone arena page is untouched — it just composes this component inside its own page shell. v1's `SlotsTab` right pane embeds `<ArenaLeaderboardTable topicId={slot.slotTopicId} />` for the selected slot — researchers get the full per-slot leaderboard inline (Elo, ±uncertainty, 95% CI, matches, cutoff dimming, tactic chips, lineage links, comparisons sub-tab) without leaving the invocation page. Lazy data-fetch (only the selected slot's leaderboard is fetched) keeps the page light even for 12-slot articles. Same component, two surfaces — zero data-or-UI drift between the standalone arena page and the inline view. |

## Configuration

**Strategy-level (new fields on `StrategyConfig`):**
- `paragraphRewriteModel?: string` — model for per-paragraph rewrite calls. Falls back to `generationModel`.
- (Reuse `judgeModel` for per-slot ranking; no new judge field.)

**Per-iteration (new fields on `IterationConfig`):**
- `agentType: 'paragraph_recombine'` (new enum value)
- `rewritesPerParagraph?: number` — M (1–8, default 3)
- `maxComparisonsPerParagraph?: number` — cap on per-slot ranking depth (2–15, default 6)
- `maxParagraphsPerInvocation?: number` — cap on paragraphs processed (1–25, default 12); tail paragraphs use original unchanged
- `sourceMode?: 'pool'` — required (reuses existing field; first-iteration check enforces ≥1 prior variant)
- `qualityCutoff?: { mode: 'topN' | 'topPercent'; value: number }` — required, picks parent (reuses existing field)

**Env kill-switches:**
- `EVOLUTION_PARAGRAPH_RECOMBINE_ENABLED` (default `'true'`) — short-circuits the dispatch branch when `'false'`.

## Phased Execution Plan

### Phase 1: Schema + agent registration scaffolding
- [ ] Add `'paragraph_recombine'` to `iterationAgentTypeEnum` in `evolution/src/lib/schemas.ts`.
- [ ] Add superRefine branches: `canBeFirstIteration` returns false; require `sourceMode === 'pool'` + `qualityCutoff`; allow `rewritesPerParagraph` / `maxComparisonsPerParagraph` / `maxParagraphsPerInvocation` only on this agent type; mutex with `generationGuidance` / `criteriaIds` / `editingMaxCycles` / `reflectionTopN` / `lengthCapRatio` / `includesMirrorApprover` / `redundancyJaccardThreshold` / `debateJudgeReasoningEffort`.
- [ ] Add `slotRecombineExecutionDetailSchema` to `evolution/src/lib/schemas.ts` as a **Zod discriminated union** keyed on `detailType` (per D14). v1 ships one variant: `detailType: 'paragraph_recombine'` with shape `{ detailType, parentVariantId, slots: Array<{ slotIndex, originalText, originalSlotVariantId, slotTopicId, rewrites: Array<{ index, text, slotVariantId, cost, durationMs, sentenceVerbatimRatio, formatValid, dropReason? }>, ranking: { matches, ratings, winnerIndex, winnerSlotVariantId } }>, recombined: { text, formatValid, formatIssues? }, totalCost, ranking?: { cost, matches } }`. Field names use `slot*` (not `paragraph*`) so the schema and types extend naturally for `sentence_recombine`, `section_recombine`, etc. — `slots[]` works at any granularity. The `slotVariantId` fields are UUIDs of the `evolution_variants` rows inserted into the slot's arena topic (per D10).
- [ ] Register agent class in `evolution/src/lib/core/agents/index.ts` barrel (side-effect import for `ATTRIBUTION_EXTRACTORS`).
- [ ] Add `'paragraph_recombine'` marker tactic to `MARKER_TACTICS` and a `TACTIC_PALETTE` color in `evolution/src/lib/core/tactics/index.ts`. Sync via `syncSystemTactics.ts` (no code change to that script).
- [ ] **Migration: add `variant_kind` to `evolution_variants` + `prompt_kind` to `evolution_prompts`** (per D13):
  - `ALTER TABLE evolution_variants ADD COLUMN variant_kind TEXT NOT NULL DEFAULT 'article' CHECK (variant_kind IN ('article','paragraph'));`
  - `ALTER TABLE evolution_prompts ADD COLUMN prompt_kind TEXT NOT NULL DEFAULT 'article' CHECK (prompt_kind IN ('article','paragraph'));`
  - Partial indexes for the kind filters: `CREATE INDEX idx_evolution_variants_article ON evolution_variants(prompt_id, synced_to_arena) WHERE variant_kind = 'article';` and `CREATE INDEX idx_evolution_prompts_article ON evolution_prompts(status) WHERE prompt_kind = 'article';` (mirror the existing `is_test_content` partial-index pattern from `20260415000001`).
  - Backward compatibility: all existing rows default to `'article'` — zero-touch on existing data.
- [ ] **Update `database.types.ts` regen + Zod schemas** in `evolution/src/lib/schemas.ts` to include the new columns; default to `'article'` in InsertSchema for backward compat.
- [ ] **Update read paths to filter by kind** (load-bearing — preventing paragraph variants from leaking into article-level rankings):
  - `loadArenaEntries(promptId)` in `evolution/src/lib/pipeline/arena.ts`: today loads all `synced_to_arena=true` variants for a prompt; new behavior is unchanged because each call passes a prompt_id and the variants under it share its kind. **Verify no other call sites bulk-read `evolution_variants` without a `prompt_id` filter**; if any exist, add `WHERE variant_kind = 'article'`.
  - `getEvolutionVariantsAction` / `listVariantsAction` (global variants list page): add `WHERE variant_kind = 'article'` to the default query; expose a kind filter toggle.
  - `getArenaTopicsAction` (arena topic list): add `WHERE prompt_kind = 'article'` to the default; add `includeParagraphTopics?: boolean` param.
  - Strategy/run pool loading: confirm via grep that `evolution_variants` reads in `runIterationLoop.ts`, `persistRunResults.ts`, and `loadArenaEntries.ts` all flow through `prompt_id` (they should — arena entries are loaded by `prompt_id`), so no behavior change. Add assertion test that the run pool never contains a `variant_kind='paragraph'` row.

### Phase 2: Cost-tracking + calibration plumbing
- [ ] Add 2 new labels to `AGENT_NAMES`: `'paragraph_rewrite'`, `'paragraph_rank'` in `evolution/src/lib/core/agentNames.ts`.
- [ ] Map both to umbrella metric `'paragraph_recombine_cost'` in `COST_METRIC_BY_AGENT`.
- [ ] Add `OUTPUT_TOKEN_ESTIMATES` entries: `paragraph_rewrite: 1000`, `paragraph_rank: 100`.
- [ ] Add `paragraph_recombine_cost` to `RUN_METRIC_REGISTRY` in `evolution/src/lib/metrics/registry.ts` (live-write via `writeMetricMax`).
- [ ] Add propagation defs: `total_paragraph_recombine_cost` (sum) + `avg_paragraph_recombine_cost_per_run` (avg) in `SHARED_PROPAGATION_DEFS`. Both `listView: true`.
- [ ] Extend `TS_PHASES_REFRESH_CALIBRATION` + `TS_PHASES_CALIBRATION_LOADER` sets in `evolution/src/lib/core/startupAssertions.ts` with the 2 new phase strings.
- [ ] Extend `CalibrationRow['phase']` union in `evolution/src/lib/pipeline/infra/costCalibrationLoader.ts`.
- [ ] Create migration `supabase/migrations/202605XX000001_evolution_cost_calibration_paragraph_recombine_phases.sql` extending the `evolution_cost_calibration_phase_allowed` CHECK constraint.

### Phase 3: Core helpers (paragraph-aware)
- [ ] New helper `extractParagraphsWithRanges(text: string): Array<{paragraphIndex, originalText, startByte, endByte}>` in `evolution/src/lib/shared/enforceVariantFormat.ts` (or new `paragraphSlots.ts`). Walks `text` post-`stripCodeBlocks`, splits on `\n\n`, filters heading-only lines, tracks cumulative byte offsets.
- [ ] New helper `validateParagraphRewrite(rewriteText: string, originalLength: number): ParagraphValidationResult` checking: no bullets, no numbered lists, no tables, no H1, sentence count ≥ 1, **length ratio in [0.90, 1.10]** (symmetric cap per D7/D12).
- [ ] New helper `assembleRecombinedArticle(parentText: string, slotWinners: Map<number, string>, slots: ParagraphSlot[]): string` — right-to-left splice (reuses pattern from `applyAcceptedGroups`).
- [ ] New cost estimator `estimateParagraphRecombineCost(parentChars, paragraphCount, rewritesPerParagraph, maxComparisonsPerParagraph, rewriteModel, judgeModel): { expected, upperBound }` in `evolution/src/lib/pipeline/infra/estimateCosts.ts`.
- [ ] New service helper `upsertSlotTopic(db, kind, parentVariantId, slotIndex, originalSlotText): Promise<{ topicId, isNew, originalSlotVariantId }>` in `evolution/src/services/slotTopicActions.ts` (per D14 — `kind` is a parameter from day one for future granularity reuse). Idempotent: deterministic topic name = `[${kind}] V-${parentVariantId.slice(0,8)} #${slotIndex+1}` (lowercase kind prefix, e.g. `[para]`); ON CONFLICT (lower(prompt)) DO NOTHING semantics already in place for `evolution_prompts`. Inserts with `prompt_kind = kind`. Also upserts the slot's original variant (`agent_name='${kind}_original'`, `synced_to_arena=true`, `variant_kind=kind`) so it always competes. v1 only ever calls with `kind='paragraph'`.
- [ ] **Extend `loadArenaEntries` with optional cap params** (per D15): new signature `loadArenaEntries(promptId, opts?: { topK?: number; alwaysIncludeIds?: string[] }): Promise<{ variants, ratings }>` in `evolution/src/lib/pipeline/arena.ts`. When `topK` is provided, ORDER BY `mu DESC` (Elo proxy) LIMIT to `topK`, then UNION with rows matching `alwaysIncludeIds` to guarantee the original always competes. When `topK` is undefined, behavior is unchanged (article-level callers). Also emits a `topic_arena_growth_warn` log when the topic's total non-archived variant count exceeds 50 (independent of `topK` — surfaces accumulation pressure to researchers via run logs). All existing call sites remain backward-compatible (no `opts` arg).

### Phase 4: Agent implementation
- [ ] Create `evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.ts` forked from `proposerApproverCriteriaGenerate.ts`. Preserve I1/I2/I3 invariants (D11 — no nested `Agent.run()`).
- [ ] Per-paragraph rewrite prompt builder `buildParagraphRewritePrompt(parentH1, paragraphText, paragraphIndex)` with **6 guardrails** (per D12):
  - (1) **Preserve original meaning and content** — no new/removed/altered facts, claims, examples, citations, or quotations. Output is the same paragraph said differently, not different ideas.
  - (2) Sentence count within ±20% of original.
  - (3) Preserve transition phrases at paragraph start (`However,`, `Therefore,`, `In contrast,`, etc.).
  - (4) Prefer additive rewording over wholesale replacement.
  - (5) No new ideas or examples beyond what's already implied by the paragraph.
  - (6) **Keep total length within ±10% of the original character count.**
- [ ] Per-slot setup (per D10): for each paragraph slot in the parent, call `upsertSlotTopic('paragraph', parentVariant.id, slotIndex, originalParagraphText)` to get the topic ID and the original-paragraph variant ID. Call `loadArenaEntries(slotTopicId, { topK: 20, alwaysIncludeIds: [originalSlotVariantId] })` (per D15) to pull at most the top-20-Elo prior arena entries plus the original, as pre-calibrated competitors. Topic-size growth beyond 50 emits a warn-log automatically inside `loadArenaEntries`.
- [ ] **Per-slot AgentCostScope** (per D16): before each slot starts, create `slotScope = createAgentCostScope(invocationScope)` and compute `perSlotBudgetUsd = perInvocationCap / paragraphCount`. Pass `slotScope` (not the invocation scope) to all per-slot LLM clients so each call's `recordSpend` is intercepted by the slot scope. The invocation scope still sees aggregate spend (delegated reserves + recordSpends).
- [ ] Per-paragraph rewrite dispatch: for each paragraph slot, dispatch M rewrite calls in parallel via `Promise.allSettled` using AgentName label `'paragraph_rewrite'`. Each rewrite uses a per-call `EvolutionLLMClient` bound to that slot's `slotScope`. Apply `validateParagraphRewrite` immediately; drop invalid rewrites with `dropReason` (one of `'no_bullets'`, `'no_lists'`, `'no_tables'`, `'no_h1'`, `'length_under'`, `'length_over'`, `'zero_sentences'`).
- [ ] **Per-slot self-abort check**: between the rewrite and ranking phases (and before each ranking comparison), check `slotScope.getOwnSpent() >= 0.9 × perSlotBudgetUsd`. On true, abort the slot — record `discardReason: { failurePoint: 'slot_budget', spent: slotScope.getOwnSpent(), budget: perSlotBudgetUsd }` in `execution_detail.slots[i]` and fall back to keeping the original paragraph. Subsequent slots continue normally.
- [ ] Per-slot pairwise ranking: for each paragraph slot, call `rankNewVariant` per surviving rewrite candidate against the slot's pool (original-paragraph variant + arena entries + other surviving new rewrites). Pairwise comparisons use AgentName label `'paragraph_rank'`. Track winner via `selectWinner({elo, uncertainty})`.
- [ ] Per-slot arena sync: call `syncToArena(invocationId, slotTopicId, slotPool, slotRatings, slotMatches)` once per slot. New rewrites get inserted into `evolution_variants` with `synced_to_arena=true, prompt_id=<slotTopicId>, agent_name='paragraph_rewrite', variant_content=<rewrite text>, variant_kind='paragraph', parent_variant_ids=[originalParagraphVariantId]`. Match records bind to `slotTopicId` (inherits paragraph-kind via the prompt).
- [ ] Recombination: assemble winners via `assembleRecombinedArticle`. Validate via `validateFormat`; if invalid, set `surfaced=false` with `discardReason: { formatIssues: [...] }`.
- [ ] Post-emission ranking: call `rankNewVariant` on the recombined variant against the run's pool. Always-on (no kill-switch per D6).
- [ ] Recombined variant lineage (per D4): `parent_variant_ids = [parentVariant.id, ...slot.winnerParagraphVariantId for each slot]`. Truncate to `MAX_PARENT_IDS` with warn-log if articles exceed 9 slots.
- [ ] Pre-final-ranking budget gate: throw with `discardReason: { failurePoint: 'budget' }` if `scope.getOwnSpent() >= 0.9 * 0.40`.
- [ ] Register `ParagraphRecombineAgent.getAttributionDimension()` returning literal `'paragraph_recombine'`.
- [ ] Side-effect register `ATTRIBUTION_EXTRACTORS['paragraph_recombine']` at module bottom.

### Phase 5: Dispatch + projector wiring
- [ ] Add new dispatch branch for `'paragraph_recombine'` in `evolution/src/lib/pipeline/loop/runIterationLoop.ts` (after the proposer_approver branch). Honor `EVOLUTION_PARAGRAPH_RECOMBINE_ENABLED` kill-switch.
- [ ] Add `paragraphRecombine?: number` peer field to `EstPerAgentValue` in `evolution/src/lib/pipeline/loop/projectDispatchPlan.ts`.
- [ ] Add cost projection branch for `'paragraph_recombine'` in `weightedAgentCost` — uses new `estimateParagraphRecombineCost`.
- [ ] Add `paragraphRecombineEnabled?: boolean` to `DispatchPlanOptions`. Server-action boundary in `getStrategyDispatchPreviewAction` resolves env and threads it.

### Phase 6: Admin UI — Rich per-slot drill-in (per Point 3)
- [ ] Add `'paragraph_recombine'` config to `DETAIL_VIEW_CONFIGS` in `evolution/src/lib/core/detailViewConfigs.ts`. Field definitions for: slot list (paragraphIndex, originalText preview, winner badge, winner Elo ± uncertainty, match count, link to slot arena topic); per-slot rewrites (text, Elo, dropReason); recombined output (text, format-valid badge, format-issues array).
- [ ] Add 5-tab layout in `InvocationDetailContent.tsx`: **Paragraph Slots / Recombined Output / Metrics / Timeline / Logs**. Add `'paragraph_recombine'` to `TIMELINE_AGENTS`.
- [ ] **Refactor: extract `ArenaLeaderboardTable` from the arena page** (per D17). Today the arena topic detail page (`src/app/admin/evolution/arena/[topicId]/page.tsx`) inlines the leaderboard table, column definitions, data fetching, and sort/filter logic. Pull these into a self-contained client component at `evolution/src/components/evolution/arena/ArenaLeaderboardTable.tsx` that takes a `topicId` prop and internally calls `getArenaTopicDetailAction` + `getArenaEntriesAction` + `getArenaComparisonsAction`. The arena page becomes a thin shell that composes this component plus its existing page-level chrome (breadcrumbs, seed panel, comparisons subtab). Zero behavior change to the standalone arena page; ~150 LOC moved + ~30 LOC of new shell.
- [ ] Build new custom client component `SlotsTab.tsx` (per D14 — generic over granularity; takes label/formatter props rather than hardcoding 'paragraph'). Co-located at `evolution/src/components/evolution/tabs/`. Master-detail layout:
  - **Left pane:** scrollable list of N slot rows, each showing slot #, winner type (`Original` / `Rewrite #A` / `Rewrite #B`/…), winner Elo ± uncertainty, match count, and (if applicable) a red badge for slots that self-aborted via D16. Selected slot highlighted; click to expand right pane.
  - **Right pane (per D17):** embeds `<ArenaLeaderboardTable topicId={slot.slotTopicId} />` for the selected slot — researchers get the same rich per-slot leaderboard they'd see on the standalone arena page (Elo, ±uncertainty, 95% CI, matches, cutoff dimming, tactic chips, lineage links, comparisons sub-tab) inline, without leaving the invocation page. Lazy-fetch: only the currently-selected slot's data is loaded. Above the embedded leaderboard, show a slim "slot context" header: original paragraph text + drop-reason summary (X rewrites dropped pre-rank for reason Y) + budget-spent indicator + any `failurePoint: 'slot_budget'` warning.
  - **"View slot N in arena ↗"** link to `/admin/evolution/arena/${slotTopicId}` for a full-page view (mostly redundant with the embedded leaderboard but useful for sharing a deep link or focusing on one slot in isolation).
  - Component props: `{ slots: SlotData[], kindLabel: string ('paragraph' for v1), slotNoun: string ('paragraph'), slotNounPlural: string ('paragraphs') }`. Future sentence/section agents reuse the same component with different props.
- [ ] Build `RecombinedOutputTab.tsx`: render the final recombined article with paragraph-level color coding (`Original kept` = neutral gray border; `Rewrite chosen` = green border). Format-validation issues (if any) surface at the top in a red banner with the specific issues from `validateFormat`. Side-by-side toggle for "show original parent" / "show recombined".
- [ ] Add timeline phase color constants `PARAGRAPH_REWRITE_COLOR = '#06b6d4'` (cyan) and `PARAGRAPH_RANK_COLOR = '#0e7490'` (deep cyan) in `InvocationTimelineTab.tsx`. Two sub-segments per paragraph slot, rendered as parallel rows: rewrite phase (light cyan) + ranking phase (deep cyan).
- [ ] Metrics tab: surface per-slot avg Elo, decisive-rate per slot, count of slots where original-vs-rewrite winners.
- [ ] Strategy wizard `src/app/admin/evolution/strategies/new/page.tsx`: add `'paragraph_recombine'` to agent-type dropdown; new per-iteration controls (`rewritesPerParagraph` input, `maxComparisonsPerParagraph` input, `maxParagraphsPerInvocation` input, `paragraphRewriteModel` select). Conditional clear when switching agent type. Field cleanup in `updated.agentType === 'paragraph_recombine'` branch.
- [ ] Arena topic list page (`src/app/admin/evolution/arena/page.tsx`): filter default list to `WHERE prompt_kind = 'article'` (per D13). Add a "Paragraph topics" toggle/tab/checkbox to show them when needed. Update `getArenaTopicsAction` server action signature with an `includeParagraphTopics?: boolean` param (passes through as `prompt_kind` filter).
- [ ] Surface format-rejection discardReason on the Recombined Output tab so researchers see why no variant was produced when `validateFormat` rejected.
- [ ] Variants list (`src/app/admin/evolution/variants/page.tsx`): filter default to `WHERE variant_kind = 'article'` (per D13). Add a "Paragraph variants" toggle so researchers can drill into paragraph snippets when needed; when shown, variant_content gets a short-text rendering treatment instead of the article preview.

### Phase 7: Tests
- [ ] Unit: `evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.test.ts` — happy path, per-paragraph rewrite failure, format-rejection of recombined output, invocation-level budget gate, **per-slot self-abort (mid-slot budget exhaustion falls back to original; subsequent slots continue)**, **per-slot scope isolation (one slot's overrun does not show in another slot's getOwnSpent)**, partial-detail-on-throw, multi-parent emission ordering. (~45 cases)
- [ ] Unit: `evolution/src/lib/shared/extractParagraphsWithRanges.test.ts` — byte-range correctness, heading filtering, code-fence handling, `\n\n` edge cases (trailing newlines, multi-blank). (~15 cases)
- [ ] Unit: `evolution/src/lib/shared/validateParagraphRewrite.test.ts` — bullets/lists/tables/H1 rejection, length-ratio cap, sentence-count edge. (~10 cases)
- [ ] Unit: `evolution/src/lib/pipeline/infra/assembleRecombinedArticle.test.ts` — right-to-left splice correctness, mixed winners (original + rewrites). (~8 cases)
- [ ] Unit: extend `evolution/src/lib/pipeline/infra/estimateCosts.test.ts` with `estimateParagraphRecombineCost` cases. (~7 cases)
- [ ] Unit: extend `evolution/src/lib/pipeline/loop/projectDispatchPlan.test.ts` with paragraph_recombine branch + kill-switch threading. (~4 cases)
- [ ] Schema: extend `iterationConfigSchema.test.ts` with new agent-type superRefines. (~5 cases)
- [ ] Integration: extend `src/__tests__/integration/evolution-cost-attribution.integration.test.ts` to verify paragraph_rewrite + paragraph_rank labels bucket into `paragraph_recombine_cost`. (~2 cases)
- [ ] Integration: extend `src/__tests__/integration/evolution-cost-estimation.integration.test.ts` to verify dispatch projector matches runtime. (~2 cases)
- [ ] Integration: extend `src/__tests__/integration/evolution-pipeline.integration.test.ts` to seed a strategy with paragraph_recombine after a generate iteration; verify recombined variant + multi-parent lineage + post-emission ranking. (~3 cases)
- [ ] E2E: new spec `src/__tests__/e2e/specs/09-admin/admin-evolution-paragraph-recombine.spec.ts` — invocation detail tab rendering, slot-by-slot table, recombined output panel, timeline bar colors, **embedded ArenaLeaderboardTable in the SlotsTab right pane renders the slot's leaderboard correctly (Elo, matches, cutoff dimming)**. (~7 cases)
- [ ] E2E: regression coverage for `admin-evolution-arena-detail.spec.ts` — the page now composes the extracted `ArenaLeaderboardTable` (per D17). Verify no behavior change to the standalone arena page: column rendering, sorting, pagination, seed panel, comparisons sub-tab all intact. (~2 new assertions, no new file)
- [ ] E2E: extend `admin-strategy-crud.spec.ts` to cover the new wizard controls. (~2 cases)

### Phase 8: Documentation
- [ ] New deep-dive `evolution/docs/paragraph_recombine.md` mirroring `criteria_agents.md` shape: algorithm, knobs, cost stack, failure modes, kill switches.
- [ ] Update `evolution/docs/agents/overview.md` § add `ParagraphRecombineAgent` entry.
- [ ] Update `evolution/docs/architecture.md` Iteration types table.
- [ ] Update `evolution/docs/multi_iteration_strategies.md` § iterationConfigSchema enum.
- [ ] Update `evolution/docs/metrics.md` § add paragraph_recombine_cost + propagation entries + per-purpose split table.
- [ ] Update `evolution/docs/cost_optimization.md` § add knob table + cost envelope estimates.
- [ ] Update `evolution/docs/reference.md` § kill-switch table.
- [ ] Update `evolution/docs/data_model.md` § Variant section if any new variant-level metric is added.

## Testing

### Unit Tests
- [ ] `ParagraphRecombineAgent.test.ts` — ~40 cases
- [ ] `extractParagraphsWithRanges.test.ts` — ~15 cases
- [ ] `validateParagraphRewrite.test.ts` — ~10 cases
- [ ] `assembleRecombinedArticle.test.ts` — ~8 cases
- [ ] Extensions to `estimateCosts.test.ts` (~7), `projectDispatchPlan.test.ts` (~4), `iterationConfigSchema.test.ts` (~5)

### Integration Tests
- [ ] `evolution-cost-attribution.integration.test.ts` extension
- [ ] `evolution-cost-estimation.integration.test.ts` extension
- [ ] `evolution-pipeline.integration.test.ts` extension

### E2E Tests
- [ ] `admin-evolution-paragraph-recombine.spec.ts` (new)
- [ ] `admin-strategy-crud.spec.ts` extension

### Manual Verification
- [ ] Run a 2-iteration strategy (`generate` then `paragraph_recombine`) end-to-end against staging. Inspect: invocation row's execution_detail per-paragraph breakdown, multi-parent lineage on variant detail page, paragraph_recombine_cost metric on run + strategy + experiment.
- [ ] Trigger format-rejection of the recombined output (mock LLM to inject a bullet); verify discardReason surfaces in the admin UI.
- [ ] Budget-exhaustion test: tight per-invocation cap, verify pre-final-ranking gate fires.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] `admin-evolution-paragraph-recombine.spec.ts` covers: tab rendering, per-slot table, timeline colors, recombined panel.
- [ ] `admin-strategy-crud.spec.ts` covers: wizard controls visible only for `paragraph_recombine`, defaults populate correctly, validation rejects invalid values.

### B) Automated Tests
- [ ] All unit tests in Phase 7 (~89 cases) pass.
- [ ] All integration extensions (~7 cases) pass against real staging DB.
- [ ] `npm run lint && npm run typecheck && npm run build` clean.
- [ ] `npm run test:e2e -- --grep="@evolution"` passes critical evolution specs.

## Documentation Updates
- [ ] `evolution/docs/paragraph_recombine.md` — new deep-dive (per criteria_agents.md template)
- [ ] `evolution/docs/agents/overview.md` — agent registration entry
- [ ] `evolution/docs/architecture.md` — iteration types table + dispatch flow
- [ ] `evolution/docs/multi_iteration_strategies.md` — `iterationConfigSchema` enum + first-iteration rules
- [ ] `evolution/docs/metrics.md` — paragraph_recombine_cost + observational metrics
- [ ] `evolution/docs/cost_optimization.md` — knob table + cost envelope (~$0.014/variant nano+qwen)
- [ ] `evolution/docs/reference.md` — kill-switch + scripts table
- [ ] `evolution/docs/data_model.md` — if any new variant-level metric is added

## Review & Discussion
[Populated by /plan-review with agent scores, reasoning, and gap resolutions]

## Open items deferred (not blocking v1)
- **Automatic low-Elo archival** (v1.5+): when a slot topic exceeds N variants, set `archived_at` on rewrites with `elo < median - 1×stddev` AND `match_count >= 5` (only archive variants we're confident are durably worse). Researchers manually archive in v1 via the existing arena admin UI.
- **`evolution_arena_comparisons` TTL/pruning for paragraph topics** (v2): 90-day TTL on match records; Elos remain frozen at their cumulative state. Reclaims significant DB space if paragraph_recombine sees high reuse.
- Observational metric for transition breakage (`paragraph_first_sentence_changed_rate` or similar). Add in v1.5 after first data.
- Sentence-verbatim-ratio drop gate (active gate dropping rewrites with `paragraphSentenceVerbatimRatio < 0.30`). Recommend ship observational-only in v1 first.
- Cross-paragraph coherence check post-recombination. Pure LLM-call cost; defer until v1 data shows it's needed.
- `MAX_PARENT_IDS=10` may need to bump if articles with ≥10 paragraphs become common. Current behavior: warn-truncate. Acceptable for v1.
- **Cross-parent paragraph-topic alignment (semantic grouping)** — V1 slot 3 and V2 slot 3 are separate topics under D10's per-(parent, slot) identity. Future project could add semantic labeling (LLM call or embedding cluster) to aggregate Elo across parents. Defer to v2.
- **Paragraph-topic table-size growth** — every paragraph rewrite + every original paragraph becomes a row in `evolution_variants` with `synced_to_arena=true`. ~13–16 paragraph variants per invocation. Over thousands of invocations the row count grows fast. Need to monitor; consider an archive policy for unused paragraph topics in v2.
- **Subagent introduction in v2** — D11 keeps the I1 single-invocation-row pattern. If `execution_detail` JSONB grows unwieldy (>100KB cap is the current limit on `execution_detail`) or per-rewrite drill-down becomes a research bottleneck, a follow-up project could introduce a parallel `evolution_subagent_invocations` table just for paragraph_recombine + future high-fan-out wrappers.
