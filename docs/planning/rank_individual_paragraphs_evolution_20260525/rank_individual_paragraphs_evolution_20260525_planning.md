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
| D4 | **Lineage on the recombined article:** `parent_variant_ids = [originalParent]` only (single-parent); slot-winner UUIDs stored in `execution_detail.slots[i].winnerSlotVariantId` for queryability | **Revised after iteration-1 plan review.** Original at `[0]` so `elo_delta_vs_parent` compares to "the variant we were trying to improve" (mirrors DebateAgent's primary-parent convention). **Slot winners are NOT in `parent_variant_ids`** — earlier draft had them all there, which would silently truncate at `MAX_PARENT_IDS=10` for the default 12-paragraph config and break lineage on the default knobs. Storing slot-winner UUIDs in `execution_detail.slots[i].winnerSlotVariantId` keeps them queryable for the SlotsTab + analytics without coupling to the lineage cap. Lineage UI: paragraph_recombine variants render as single-parent (like GFPA), with a "Recombined from N slots" badge that expands to the slot-winner list when clicked. Net behavior unchanged for `elo_delta_vs_parent` aggregation (uses `parentIds[0]` = originalParent). |
| D5 | **Cannot be first iteration** (`canBeFirstIteration = false`) | Agent operates on one parent variant pulled from the pool via existing `sourceMode: 'pool'` + `qualityCutoff: {mode: 'topN', value: N}`. Strategies must front-load a variant-producing iteration. Mirrors DebateAgent. |
| D6 | **Post-emit ranking always-on** (no kill-switch env var) | Recombined variant runs through `rankNewVariant` against the run's pool so it competes in arena. Per-invocation $0.40 cap is the sole operational lever. Diverges from `EDITING_RANK_ENABLED` precedent — flagged. |
| D7 | **Two-stage validation:** per-paragraph pre-validate + standard `validateFormat` post-recombination | New helper composed from existing primitives (`hasBulletPoints`, `hasNumberedLists`, `hasTables`, `stripCodeBlocks`, `countShortParagraphs`) checks each rewrite before it consumes ranking budget. Final `validateFormat` is the safety net. Per-paragraph length gate: **0.90 ≤ `len(rewrite)/len(original)` ≤ 1.10** (both bounds; tighter than the prior 1.20× cap). |
| D8 | **Paragraph parse:** regex `\n\n` split + `stripCodeBlocks` first | Pure regex helper `extractParagraphsWithRanges(text)`. No remark-parse dependency in `evolution/` tree. ~30 LOC. |
| D9 | **Default knobs:** `rewritesPerParagraph=3, maxComparisonsPerParagraph=6, maxParagraphsPerInvocation=12, perInvocationCap=$0.40` | Conservative defaults; ~$0.011/variant with nano+qwen. Per-invocation cap matches DebateAgent convention. Pre-final-ranking gate fires at 0.9× cap ($0.36). |
| D10 | **Paragraph leaderboard via existing arena infra; per-slot match persistence via new helper** (revised after iter-2/iter-3 plan review) | Each paragraph slot of a parent variant becomes its own `evolution_prompts` row (`prompt_kind = 'paragraph'`). Paragraph rewrites + originals stored as `evolution_variants` rows (`agent_name = 'paragraph_rewrite' \| 'paragraph_original'`, `variant_kind = 'paragraph'`, `prompt_id = <slot_topic_id>`, `variant_content = <paragraph text>`). **Match-row persistence quirk (verified against source)**: `sync_to_arena` RPC's `p_matches` is DEPRECATED (since `20260331000002`); match rows are SOLELY written by `MergeRatingsAgent` with `ctx.promptId = <run's article-level promptId>`. Reusing that path per-slot would misroute slot match rows to the article topic. **Resolution**: paragraph_recombine ships a new `persistSlotMatches(db, slotTopicId, runId, invocationId, iteration, slotMatches, beforeAfterRatings)` helper (Phase 3) — 7-arg signature with `iteration` because `evolution_arena_comparisons.iteration` is NOT NULL — that bulk-INSERTs to `evolution_arena_comparisons` parameterized on `slotTopicId` (mirrors `MergeRatingsAgent.ts:277-334`). Phase 4 calls `syncToArena` (variants) THEN `persistSlotMatches` (matches) per slot to avoid orphan-match windows. `syncToArena` still used per-slot ONLY for upserting the slot's new paragraph variants (match-row path within syncToArena is no-op since RPC ignores `p_matches`); on syncToArena failure for a slot, `persistSlotMatches` is SKIPPED and the slot falls back to original (avoids orphan match rows referencing variants not yet in DB). **Cross-invocation Elo accumulation**: when parent V gets reused, its slot leaderboards get richer over time via the persisted match rows. Trade-off: cross-parent comparison impossible — V1 slot 3 and V2 slot 3 are separate topics; defer semantic alignment to v2. |
| D11 | **Subagent model: stay with I1** — ONE invocation row per paragraph_recombine call | ~324 LLM calls (M=3 × N=12 rewrites + per-slot ranking) collapse to a single `evolution_agent_invocations` row. Per-paragraph data lives in `execution_detail.paragraphs[i].{rewrites[j], ranking}`. Per-LLM-call labels (`paragraph_rewrite`/`paragraph_rank`) bucket cost. Mirrors every other wrapper agent (ProposerApprover, IterativeEditing, Debate). The rich master-detail UI in Phase 6 surfaces drill-in without DB row proliferation. |
| D12 | **3-guardrail rewrite prompt** (softer than initial design — see body) | Final guardrail set for `buildParagraphRewritePrompt`: (1) **PRESERVE MEANING in spirit** — keep the paragraph's underlying claims and conclusions intact; new examples / analogies / supporting details are fine as long as they reinforce, not change, the original point; (2) **FIRST AND LAST SENTENCES** — rewrites are OK but be extra careful because these often carry transitions to neighboring paragraphs the model can't see; (3) **LENGTH WITHIN ±10%** of the original character count (also code-enforced via `validateParagraphRewrite`). Output is plain prose only — no markdown / preamble / commentary. **Deliberate softening from earlier drafts**: removed the "no new content" guardrail and the sentence-count guardrail, leaving the length cap (±10%) as the only structural defense against rewrite-disaster outputs. Pairwise ranking becomes more load-bearing as a quality filter. Trade-off accepted: more creative latitude in exchange for higher reliance on Elo ranking + the v1.5 observational metrics (`paragraph_first_sentence_changed_rate`, `paragraph_sentence_verbatim_ratio`) to detect drift post-hoc. If staging data shows the rewrite-disaster cohort returning (per `criteria_agents.md`'s prior pattern), a no-new-content gate can be re-added in v1.5 without code revert. Judge-verbosity-bias risk noted: LLM judges may favor more elaborate rewrites over concise originals; observable via per-slot Elo trends comparing rewrites to originals across many invocations. |
| D13 | **First-class granularity field: `variant_kind` on `evolution_variants` + `prompt_kind` on `evolution_prompts`** | New columns: `variant_kind TEXT NOT NULL DEFAULT 'article' CHECK (variant_kind IN ('article','paragraph'))` and `prompt_kind TEXT NOT NULL DEFAULT 'article' CHECK (prompt_kind IN ('article','paragraph'))`. Self-documenting, extensible (e.g. future `'sentence'`, `'section'`), and decouples granularity-distinction from `agent_name` (which stays a tactic/marker, not a scope identifier). All existing rows default to `'article'` — backward compatible. **Comparisons inherit kind from their prompt** (no separate column on `evolution_arena_comparisons` needed — `prompt_kind` is derivable via JOIN). Supersedes the earlier `is_paragraph_topic` proposal. |
| D14 | **Future-proof v1 for additional granularities (sentence, section, span) at low cost** | Four cheap-now/valuable-later tweaks adopted in v1: (a) `upsertSlotTopic(kind, parentVariantId, slotIndex, originalText)` takes `kind` as a parameter from day one (vs `upsertParagraphSlotTopic` hard-coded for paragraphs); (b) the execution-detail Zod schema is `slotRecombineExecutionDetailSchema` — a discriminated union on `detailType: 'paragraph_recombine'` with room for future `'sentence_recombine'`, `'section_recombine'`, etc. (mirrors the criteria/debate Zod-union pattern); (c) the rich slots-detail UI component is `SlotsTab.tsx` generic over granularity (takes label/formatter props), not paragraph-specific; (d) topic naming convention `[<kind>] V-${parentId.slice(0,8)} #${slot+1}` with lowercase kind prefix (e.g. `[para]`, `[sent]`, `[sect]`). ~80 LOC of additional abstraction in v1; saves ~600+ LOC when v2 adds the next granularity. Low risk because the union-discriminator + generic-component patterns are already established elsewhere in the codebase. |
| D15 | **Cap arena pool size loaded per slot per invocation: top-K by `elo_score` (default 20 for paragraph topics) + per-topic-size warn-log** | **Revised after iteration-1 plan review.** Actual `loadArenaEntries` signature is `(promptId: string, supabase: SupabaseClient, excludeId?: string)` in `evolution/src/lib/pipeline/setup/buildRunContext.ts` (NOT `pipeline/arena.ts` as earlier drafts said). New signature appends a 4th positional opts arg: `(promptId, supabase, excludeId?, opts?: { topK?: number; alwaysIncludeIds?: string[] })`. v1's `paragraph_recombine` calls it with `loadArenaEntries(slotTopicId, supabase, undefined, { topK: 20, alwaysIncludeIds: [originalSlotVariantId] })`. Article-level callers omit `opts` (unlimited; backward compatible). **Sort column is `elo_score DESC`, NOT `mu DESC`** — elo_score is the Elo-scale projection used elsewhere in the leaderboard (raw mu can put a brand-new variant with mu=25, sigma=8.33 above a battle-tested mu=24, sigma=2 because it ignores uncertainty). Per-invocation LLM-call count is already capped by D9, so the pool cap doesn't change cost — it improves ranking quality by focusing binary-search opponents on the strongest top-20. Warn-log `topic_arena_growth_warn` fires when topic exceeds 50 non-archived variants. Deferred to v1.5+: automatic low-Elo archival. Deferred to v2: match-record TTL. |
| D16 | **Per-slot budget split with 90% self-abort** — even split across paragraph slots within one invocation | `perSlotBudgetUsd = perInvocationCap / paragraphCount` (defaults: $0.40 / 12 ≈ $0.033 per slot). Each slot runs inside a **per-slot AgentCostScope nested under the invocation scope** (`createAgentCostScope(invocationScope)` — nests cleanly because `reserve`/`release`/`getTotalSpent` delegate to parent while `recordSpend` is intercepted; the inner scope's `getOwnSpent()` returns just this slot's contribution). The slot's rewrite + ranking phases self-abort and fall back to keeping the original paragraph when `slotScope.getOwnSpent() >= 0.9 × perSlotBudgetUsd`. Mirrors `IterativeEditingAgent` Decisions §15 pattern. Slot abort records `discardReason: { failurePoint: 'slot_budget' }` in `execution_detail.slots[i]`. Headroom in defaults: expected per-slot cost is ~$0.003, so the cap is ~10× expected — even 5× spikes won't starve other slots. The invocation-level $0.40 cap + 0.9× pre-final-ranking gate (D6/D9) remain as outer protections. |
| D17 | **Reuse the arena leaderboard table as a reusable component, embedded inside the SlotsTab** | Extract the arena topic's leaderboard table (today inlined in `src/app/admin/evolution/arena/[topicId]/page.tsx`) into a self-contained client component `ArenaLeaderboardTable` that takes a `topicId` prop, fetches via existing `getArenaTopicDetailAction` + `getArenaEntriesAction` + `getArenaComparisonsAction`, and renders the same sortable Elo leaderboard. The standalone arena page is untouched — it just composes this component inside its own page shell. v1's `SlotsTab` right pane embeds `<ArenaLeaderboardTable topicId={slot.slotTopicId} />` for the selected slot — researchers get the full per-slot leaderboard inline (Elo, ±uncertainty, 95% CI, matches, cutoff dimming, tactic chips, lineage links, comparisons sub-tab) without leaving the invocation page. Lazy data-fetch (only the selected slot's leaderboard is fetched) keeps the page light even for 12-slot articles. Same component, two surfaces — zero data-or-UI drift between the standalone arena page and the inline view. |
| D18 | **Fully parallel execution model: all N slots in parallel, M rewrites per slot also in parallel** | Top-level `Promise.allSettled` across all N paragraph slots; each slot's async function internally `Promise.allSettled`-s its M parallel rewrites + pairwise ranking calls. Peak burst ~50–150 concurrent LLM calls. ~10–20× wall-clock speedup vs sequential (minutes → seconds per invocation). Per-slot `AgentCostScope` nested under invocation scope works correctly under concurrent access (B012 design: cost tracker is synchronous + race-free under Node's event loop; `getOwnSpent()` per-slot stays isolated; invocation scope sees aggregate spend; self-abort math per-slot is independent). **Note on template choice:** the ProposerApprover fork (D11/Phase 4) inherits I1/I2/I3 cost-attribution invariants — NOT the sequential single-cycle loop structure. The actual `execute()` body diverges significantly from ProposerApprover's because the per-slot parallelism + per-slot scope nesting requires different orchestration. Trade-off accepted: high concurrent LLM-call burst could pressure provider rate limits; mitigated for v1 by gpt-4.1-nano + qwen having 500+ RPM limits, and by the invocation-level $0.40 cap naturally throttling total volume. Bounded-concurrency cap (semaphore) deferred to v1.5 if monitoring shows rate-limit-related failures. |
| D19 | **Hierarchical naming convention: `V8.P3.R1` (Variant.Paragraph.Rewrite)** | Display labels for paragraph identity across UI, logs, `execution_detail`, and arena topic names. **`V8`** = article variant (8-char UUID prefix; existing convention). **`V8.P3`** = paragraph slot 3 of variant V8 (1-based for display; 0-based in code). **`V8.P3.R1`** = the 1st rewrite ever for V8 slot 3 (persistent ordering by `created_at` within the slot's arena topic). **`V8.P3.original`** = the original paragraph variant for V8 slot 3. Helper `formatParagraphLabel(parentId, slotIndex, paragraphVariantId?, isOriginal?, rewriteOrder?)` in `evolution/src/lib/shared/paragraphLabels.ts` derives display labels from variant data. Used everywhere: SlotsTab left-panel rows (`P3 — winner: R1 Elo 1410`), right-panel ArenaLeaderboardTable badges, RecombinedOutputTab paragraph annotations, log messages, `execution_detail.slots[i].rewrites[j].label`. **Arena topic name updated:** old `[para] V-V8abc123 #3` → new `[para] V8abc123.P3` (drops the redundant `V-` prefix; aligns with display convention). The `R` numbering is computed at read time from `created_at` ordering — no DB column added. Across-invocation accumulation: invocation 1's rewrites are R1–R3, invocation 2 adds R4–R6, etc. Rank in leaderboard (by Elo) is orthogonal to R number (by creation time); both surface alongside each other. |
| D20 | **Per-invocation contribution visibility via shared component + SlotsTab tab toggle** | `ArenaLeaderboardTable` (D17 extracted, shared with the standalone arena page) gains two **optional** props: `highlightVariantIds?: ReadonlySet<string>` (decorates matching rows with a `●` marker in the rank column) and `filterToVariantIds?: ReadonlySet<string>` (renders only matching rows; **rank column preserves the overall rank within the full sorted leaderboard** — e.g. a row at rank 4 still says "4" when filtered, not "2"). When both props are undefined the component renders all rows un-decorated — exactly today's behavior, so the standalone arena page is unaffected. The SlotsTab's right pane wraps the component in a 2-tab toggle: **"All invocations"** passes `highlightVariantIds=thisInvocationVariantIds` (every row of the full topic visible; this-invocation rows marked with `●`); **"Just this invocation"** passes `filterToVariantIds=thisInvocationVariantIds` (only this invocation's contributions visible, with absolute ranks). The variant set is computed from `execution_detail.slots[i].rewrites[j].slotVariantId` and **includes pre-rank-dropped rewrites** so researchers see the full contribution (rewrites that violated `validateParagraphRewrite` appear with a `· dropped pre-rank (length cap)` annotation). Slot list (left pane) also surfaces `(this inv)` vs `(prior)` tags inline on each row's winner — the most useful top-level signal of whether this invocation actually contributed the winning rewrite or a prior invocation's accumulated rewrite stayed on top. ~50 LOC across the component + SlotsTab wrapper. |

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
- [x] Add `'paragraph_recombine'` to `iterationAgentTypeEnum` in `evolution/src/lib/schemas.ts`.
- [x] Add superRefine branches: `canBeFirstIteration` returns false; require `sourceMode === 'pool'` + `qualityCutoff`; allow `rewritesPerParagraph` / `maxComparisonsPerParagraph` / `maxParagraphsPerInvocation` only on this agent type; mutex with `generationGuidance` / `criteriaIds` / `editingMaxCycles` / `reflectionTopN` / `lengthCapRatio` / `includesMirrorApprover` / `redundancyJaccardThreshold` / `debateJudgeReasoningEffort`.
- [x] **Extend Variant Zod schema and TS type** (per iter-3 plan review) in `evolution/src/lib/types.ts` + `evolution/src/lib/schemas.ts` with two optional fields: `agentName?: string` and `variantKind?: 'article' | 'paragraph'`. These propagate through `createVariant` factory → through pipeline → to syncToArena's `newEntries.map(...)` constructor which must be extended to emit `agent_name: v.agentName ?? null` and `variant_kind: v.variantKind ?? 'article'` in the JSONB entry payload for the extended `sync_to_arena` RPC (Phase 1 migration #3) to read on INSERT.
- [x] **Extend `MergeRatingsInput.iterationType` Zod enum** in `evolution/src/lib/schemas.ts` (per iter-3 plan review). Both `mergeRatingsInputSchema.iterationType` and `mergeRatingsExecutionDetailSchema.iterationType` (two places) are z.enum unions that currently list `'generate' | 'swiss' | 'reflect_and_generate' | ...`. Add `'paragraph_recombine'` to both — required because the post-emit ranking of the recombined article variant (Phase 4 step 10) flows through MergeRatingsAgent which Zod-validates `iterationType` from the iteration's agentType. Without this, runtime Zod validation fails and post-emit ranking errors out.
- [x] Add `slotRecombineExecutionDetailSchema` to `evolution/src/lib/schemas.ts` as a **Zod discriminated union** keyed on `detailType` (per D14). v1 ships one variant: `detailType: 'paragraph_recombine'` with shape `{ detailType, parentVariantId, slots: Array<{ slotIndex, originalText, originalSlotVariantId, slotTopicId, rewrites: Array<{ index, text, slotVariantId, cost, durationMs, sentenceVerbatimRatio, formatValid, dropReason? }>, ranking: { matches, ratings, winnerIndex, winnerSlotVariantId } }>, recombined: { text, formatValid, formatIssues? }, totalCost, ranking?: { cost, matches } }`. Field names use `slot*` (not `paragraph*`) so the schema and types extend naturally for `sentence_recombine`, `section_recombine`, etc. — `slots[]` works at any granularity. The `slotVariantId` fields are UUIDs of the `evolution_variants` rows inserted into the slot's arena topic (per D10).
- [x] Register agent class in `evolution/src/lib/core/agents/index.ts` barrel (side-effect import for `ATTRIBUTION_EXTRACTORS`).
- [x] Add `'paragraph_recombine'` marker tactic to `MARKER_TACTICS` and a `TACTIC_PALETTE` color in `evolution/src/lib/core/tactics/index.ts`. Sync via `syncSystemTactics.ts` (no code change to that script).
- [x] **Migration `202605XX000001_evolution_paragraph_kind_columns.sql`: add `variant_kind` to `evolution_variants` + `prompt_kind` to `evolution_prompts`** (per D13):
  - `ALTER TABLE evolution_variants ADD COLUMN IF NOT EXISTS variant_kind TEXT NOT NULL DEFAULT 'article' CHECK (variant_kind IN ('article','paragraph'));`
  - `ALTER TABLE evolution_prompts ADD COLUMN IF NOT EXISTS prompt_kind TEXT NOT NULL DEFAULT 'article' CHECK (prompt_kind IN ('article','paragraph'));`
  - Partial indexes use `IF NOT EXISTS` for idempotency (`scripts/lint-migrations-idempotent.ts` enforces): `CREATE INDEX IF NOT EXISTS idx_evolution_variants_paragraph ON evolution_variants(prompt_id, synced_to_arena) WHERE variant_kind = 'paragraph';` and `CREATE INDEX IF NOT EXISTS idx_evolution_prompts_paragraph ON evolution_prompts(status) WHERE prompt_kind = 'paragraph';` (index the NEW partition, not the article default — paragraph rows are the sparser set; mirrors the existing `is_test_content` partial-index pattern from `20260415000001`).
  - Backward compatibility: all existing rows default to `'article'` — zero-touch on existing data.
- [x] **Migration `202605XX000002_evolution_prompts_paragraph_topic_unique.sql`: partial unique index on `evolution_prompts.prompt` for paragraph topics** (per D14 — required for `upsertSlotTopic` idempotency; NO unique constraint exists today on `evolution_prompts.prompt` or `.name`, verified via grep against all migrations):
  - `CREATE UNIQUE INDEX IF NOT EXISTS uq_evolution_prompts_paragraph_topic ON evolution_prompts(prompt) WHERE prompt_kind = 'paragraph';`
  - Scoped to `prompt_kind = 'paragraph'` so article-level prompt uniqueness behavior is unchanged (article topics historically allow duplicate `prompt` text — preserving that).
  - Allows `upsertSlotTopic` to use `ON CONFLICT (prompt) WHERE prompt_kind = 'paragraph' DO NOTHING` semantics safely.
- [x] **Migration `202605XX000003_extend_sync_to_arena_for_paragraph_kind.sql`: extend `sync_to_arena` RPC to write `agent_name` and `variant_kind`** (per D10 — without this, paragraph rewrites inserted by `syncToArena` land with `agent_name=NULL` and the default `variant_kind='article'`, defeating both the kind filter and the agent_name labeling). The RPC's `p_entries` JSONB schema gains optional `agent_name` and `variant_kind` fields; INSERT branch reads them via `COALESCE(entry->>'agent_name', NULL)` and `COALESCE(entry->>'variant_kind', 'article')`. ON CONFLICT DO UPDATE branch leaves these fields untouched for existing rows. Pattern follows the precedent of `20260326000002_fix_sync_to_arena_match_count.sql` which added the same kind of optional JSONB-field extension. Forward-only; backward compatible (callers omitting the new fields get pre-existing behavior).
- [x] **Update `database.types.ts` regen + Zod schemas** in `evolution/src/lib/schemas.ts` to include the new columns; default to `'article'` in InsertSchema for backward compat.
- [x] **Update read paths to filter by kind** (load-bearing — preventing paragraph variants from leaking into article-level rankings):
  - `loadArenaEntries(promptId)` in `evolution/src/lib/pipeline/arena.ts`: today loads all `synced_to_arena=true` variants for a prompt; new behavior is unchanged because each call passes a prompt_id and the variants under it share its kind. **Verify no other call sites bulk-read `evolution_variants` without a `prompt_id` filter**; if any exist, add `WHERE variant_kind = 'article'`.
  - `getEvolutionVariantsAction` / `listVariantsAction` (global variants list page): add `WHERE variant_kind = 'article'` to the default query; expose a kind filter toggle.
  - `getArenaTopicsAction` (arena topic list): add `WHERE prompt_kind = 'article'` to the default; add `includeParagraphTopics?: boolean` param.
  - Strategy/run pool loading: confirm via grep that `evolution_variants` reads in `runIterationLoop.ts`, `persistRunResults.ts`, and `loadArenaEntries.ts` all flow through `prompt_id` (they should — arena entries are loaded by `prompt_id`), so no behavior change. Add assertion test that the run pool never contains a `variant_kind='paragraph'` row.

### Phase 2: Cost-tracking + calibration plumbing
- [x] Add 2 new labels to `AGENT_NAMES` in `evolution/src/lib/core/agentNames.ts`: `'paragraph_rewrite'` (rewrite calls) AND `'paragraph_rank'` (per-slot ranking calls). **CORRECTED in Phase 9 cost-attribution fix**: the original plan reused the shared `'ranking'` label and claimed a "scope intercept path" would route per-slot ranking spend to `paragraph_recombine_cost`. That intercept never existed in code — `'ranking'` hard-maps to `ranking_cost`, so per-slot ranking either polluted `ranking_cost` (if the slot client had db/runId) or was dropped (it didn't). A dedicated `'paragraph_rank'` label fixes this cleanly; the agent relabels `rankNewVariant`'s `'ranking'` calls → `'paragraph_rank'` via a thin LLM-client proxy, and `v2MockLlm.ts` routes both labels through its pairwise-verdict path.
- [x] Map BOTH `'paragraph_rewrite'` and `'paragraph_rank'` to umbrella metric `'paragraph_recombine_cost'` in `COST_METRIC_BY_AGENT`. The run-level metric is written ONCE per invocation by the agent as the SUM of the two phase-cost accumulators (`getPhaseCosts()['paragraph_rewrite'] + ['paragraph_rank']`) via `writeMetricMax`. A single sum-write is MAX-safe because both accumulators are run-cumulative (monotonic) — avoids the MAX-not-sum trap that per-call writes of two labels into one GREATEST-semantics metric would hit. The per-slot LLM client deliberately has no db/runId so per-call live writes don't fire (they'd be partial/MAX-not-sum); the agent's single sum-write is the source of truth.
- [x] Add `OUTPUT_TOKEN_ESTIMATES` entry: `paragraph_rewrite: 1000`. (No new entry for ranking — uses existing `ranking: 100`.)
- [x] Add `paragraph_recombine_cost` to `RUN_METRIC_REGISTRY` in `evolution/src/lib/metrics/registry.ts` (live-write via `writeMetricMax`).
- [x] Add propagation defs: `total_paragraph_recombine_cost` (sum) + `avg_paragraph_recombine_cost_per_run` (avg) in `SHARED_PROPAGATION_DEFS`. Both `listView: true`.
- [x] Extend `TS_PHASES_REFRESH_CALIBRATION` + `TS_PHASES_CALIBRATION_LOADER` sets in `evolution/src/lib/core/startupAssertions.ts` with the 1 new phase string (`'paragraph_rewrite'`). Existing `'ranking'` phase is unchanged.
- [x] Extend `CalibrationRow['phase']` union in `evolution/src/lib/pipeline/infra/costCalibrationLoader.ts`.
- [x] Create migration `supabase/migrations/202605XX000004_evolution_cost_calibration_paragraph_recombine_phases.sql` extending the `evolution_cost_calibration_phase_allowed` CHECK constraint with the 1 new phase string `'paragraph_rewrite'`.

### Phase 3: Core helpers (paragraph-aware)
- [x] New helper `extractParagraphsWithRanges(text: string): Array<{paragraphIndex, originalText, startByte, endByte}>` in `evolution/src/lib/shared/enforceVariantFormat.ts` (or new `paragraphSlots.ts`). Walks `text` post-`stripCodeBlocks`, splits on `\n\n`, filters heading-only lines, tracks cumulative byte offsets.
- [x] New helper `validateParagraphRewrite(rewriteText: string, originalLength: number): ParagraphValidationResult` checking: no bullets, no numbered lists, no tables, no H1, sentence count ≥ 1, **length ratio in [0.90, 1.10]** (symmetric cap per D7/D12).
- [x] New helper `assembleRecombinedArticle(parentText: string, slotWinners: Map<number, string>, slots: ParagraphSlot[]): string` — right-to-left splice (reuses pattern from `applyAcceptedGroups`).
- [x] New cost estimator `estimateParagraphRecombineCost(parentChars, paragraphCount, rewritesPerParagraph, maxComparisonsPerParagraph, rewriteModel, judgeModel): { expected, upperBound }` in `evolution/src/lib/pipeline/infra/estimateCosts.ts`.
- [x] New service helper `upsertSlotTopic(db, kind, parentVariantId, slotIndex, originalSlotText): Promise<{ topicId, isNew, originalSlotVariantId }>` in `evolution/src/services/slotTopicActions.ts` (per D14 — `kind` is a parameter from day one for future granularity reuse). Idempotent: deterministic topic identifier follows the D19 convention `[${kindShort}] ${parentVariantId.slice(0,8)}.${kindLetter}${slotIndex+1}` (e.g. `[para] V8abc123.P3` for paragraph slot 3 of variant V8abc123). The identifier is written to BOTH `evolution_prompts.prompt` (the column carrying the partial unique index `uq_evolution_prompts_paragraph_topic` from the Phase 1 migration) AND `evolution_prompts.name` (the display column). Inserts use `ON CONFLICT (prompt) WHERE prompt_kind = 'paragraph' DO NOTHING` semantics (safe because the partial index exists per the new migration above). Sets `prompt_kind = kind`. Also upserts the slot's original variant via direct INSERT (NOT through `sync_to_arena` RPC — bypasses the extended-RPC path for simplicity since upsertSlotTopic runs OUT of the agent's parallel-slot dispatch) with `agent_name='${kind}_original'`, `synced_to_arena=true`, `variant_kind=kind`, `parent_variant_ids=[]` so it always competes. v1 only ever calls with `kind='paragraph'` (kindShort='para', kindLetter='P').
- [x] New helper `formatParagraphLabel(parentId, slotIndex, paragraphVariantId?, isOriginal?, rewriteOrder?): string` in `evolution/src/lib/shared/paragraphLabels.ts` (per D19). Returns `V8abc123.P3` for a slot, `V8abc123.P3.original` for the original variant, `V8abc123.P3.R7` for the 7th rewrite (where `rewriteOrder` is computed at read time from `created_at` ordering within the slot topic). Used by SlotsTab labels, RecombinedOutputTab annotations, log messages, and `execution_detail` denormalization.
- [x] **New helper `persistSlotMatches(db, slotTopicId, runId, invocationId, iteration, slotMatches, beforeAfterRatings)`** in `evolution/src/services/slotTopicActions.ts` (per revised D10; signature updated per iter-3 plan review — `iteration: number` added because `evolution_arena_comparisons.iteration` is NOT NULL per `MergeRatingsAgent.ts:300`). Bulk INSERT to `evolution_arena_comparisons` parameterized on `slotTopicId` — mirrors the row-construction block at `MergeRatingsAgent.ts:277-334` (same columns: `run_id`, `prompt_id` set to `slotTopicId`, `entry_a`/`entry_b`, `winner`/`confidence`, `iteration`, `invocation_id`, `entry_a_mu_before`/`sigma_before`/`mu_after`/`sigma_after`, `entry_b_*`, `status: 'completed'`). The `beforeAfterRatings` param is typed `Map<matchKey, { aBefore: Rating, aAfter: Rating, bBefore: Rating, bAfter: Rating }>` where `Rating = {elo, uncertainty}` (Elo-scale per `evolution/src/lib/shared/rating.ts`). The helper calls `ratingToDb(rating)` inline before INSERT to convert each Rating to `{mu, sigma, elo_score}` for the DB-scale columns. Best-effort: errors logged but non-fatal AND a new metric `paragraph_slot_match_persist_failures` increments on failure (so silent failures are observable — important because match-row persistence IS the D10 accumulation mechanism). ~60 LOC.
- [x] **Update Phase 4 per-slot ranking loop to capture before/after Rating snapshots** (per iter-3 plan review). V2Match (`evolution/src/lib/schemas.ts:912-919`) carries only `{winnerId, loserId, result, confidence, judgeModel, reversed}` — NO rating fields. The before/after data lives in `rankResult.detail.comparisons[*]` (see `RankSingleVariantComparisonRecord` in `rankSingleVariant.ts:51-72`) keyed by `(round, opponentId)` with `{elo, uncertainty}` snapshots. Per-slot ranking loop must walk `rankResult.detail.comparisons[*]` and build the `beforeAfterRatings` Map keyed by `${winnerId}|${loserId}` (sorted lexicographically to match the canonical pair key used elsewhere). Pass that Map to `persistSlotMatches`. Document the join in code comment.
- [x] **Extend `loadArenaEntries` with optional cap params** (per D15): new signature `loadArenaEntries(promptId: string, supabase: SupabaseClient, excludeId?: string, opts?: { topK?: number; alwaysIncludeIds?: string[] }): Promise<{ variants, ratings }>` in `evolution/src/lib/pipeline/setup/buildRunContext.ts` (NOT `pipeline/arena.ts` — that file doesn't exist; function actually lives in buildRunContext). The new `opts` arg is appended positionally so the 3 existing call sites passing `(promptId, supabase)` or `(promptId, supabase, excludeId)` keep working without changes (verified with grep across the codebase). When `opts.topK` is provided, ORDER BY `elo_score DESC` (NOT `mu DESC` — `elo_score` is the uncertainty-adjusted projection used elsewhere in the leaderboard; raw mu can rank a new variant with high sigma above a battle-tested low-sigma one) LIMIT to `topK`, then UNION with rows matching `alwaysIncludeIds` to guarantee inclusions. Also emits a `topic_arena_growth_warn` log when the topic's total non-archived variant count exceeds 50 (independent of `topK`). All existing call sites remain backward-compatible (no `opts` arg).

### Phase 4: Agent implementation
- [x] Create `evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.ts` forked from `proposerApproverCriteriaGenerate.ts`. Preserve I1/I2/I3 invariants (D11 — no nested `Agent.run()`).
- [x] Per-paragraph rewrite prompt builder `buildParagraphRewritePrompt(parentH1, paragraphText, paragraphIndex, totalSlots)` per D12. Ship the prompt verbatim:

  ```
  You are rewriting a single paragraph from a larger article. Express the same
  meaning more clearly or fluently.

  CONTEXT
    Article title: "{parentH1}"
    This is paragraph {paragraphIndex+1} of {totalSlots}. You will not see the
    others; rewrites happen in parallel and the splice must read as one piece.

  RULES (violations are silently discarded)

    1. PRESERVE MEANING. Keep the paragraph's underlying claims and conclusions
       intact. New examples, analogies, or supporting details are fine as long
       as they reinforce — not change — the original point.

    2. FIRST AND LAST SENTENCES. Rewrites are OK, but be extra careful —
       these often carry transitions to neighboring paragraphs you can't see.

    3. LENGTH WITHIN ±10%. Total character count must stay within 10% of the
       original.

  OUTPUT
    Plain prose only — no markdown, no preamble, no commentary. Just the
    rewritten paragraph.

  ORIGINAL:

  {paragraphText}

  REWRITTEN:
  ```

  Total guardrail count: 3 (down from earlier drafts of 6 — see D12 body for rationale and trade-off acknowledgment).
- [x] **Top-level parallel dispatch** (per D18): `Promise.allSettled(slots.map(slot => processSlot(slot)))`. Each `processSlot` is an async function containing the per-slot pipeline below. Slots run concurrently; one slot's failure or self-abort doesn't propagate to others. The `invocationScope` is shared across all parallel slots (cost tracker is synchronous + race-free under Node's event loop per B012).
- [x] **Per-slot pipeline** (inside each `processSlot`, executed concurrently across slots):
  - **Per-slot state isolation** (explicit invariant — required because `rankNewVariant` MUTATES `localPool`/`localRatings`/`localMatchCounts`/`completedPairs` in place): each parallel `processSlot` invocation MUST allocate its OWN copy of each. Sharing any across slots would race and corrupt rankings. The ONLY shared cross-slot state is the invocation-level `AgentCostScope` (designed for concurrent access per B012).
  - **Topic setup** (per D10): call `upsertSlotTopic('paragraph', parentVariant.id, slotIndex, originalParagraphText)` → `{topicId, originalSlotVariantId}`. Then `loadArenaEntries(slotTopicId, supabase, undefined, { topK: 20, alwaysIncludeIds: [originalSlotVariantId] })` (per D15 corrected signature — note the positional `supabase` arg) for pre-calibrated competitors. Topic-size >50 emits warn-log inside `loadArenaEntries`.
  - **Per-slot AgentCostScope** (per D16): `slotScope = createAgentCostScope(invocationScope)`; `perSlotBudgetUsd = perInvocationCap / paragraphCount`. The nested scope's `getOwnSpent()` stays isolated even under concurrent execution.
  - **M parallel rewrites** (per D18 — within-slot parallelism is SAFE here because the M rewrite calls just produce text; no rank-pool mutation yet): `Promise.allSettled([rewrite × M])` using AgentName label `'paragraph_rewrite'`. Each rewrite uses a per-call `EvolutionLLMClient` bound to that slot's `slotScope`. Apply `validateParagraphRewrite` immediately; drop invalid rewrites with `dropReason` (one of `'no_bullets'`, `'no_lists'`, `'no_tables'`, `'no_h1'`, `'length_under'`, `'length_over'`, `'zero_sentences'`).
  - **Self-abort check** (per D16): between rewrite and ranking phases, and before each ranking comparison, check `slotScope.getOwnSpent() >= 0.9 × perSlotBudgetUsd`. On true, abort the slot — record `discardReason: { failurePoint: 'slot_budget', spent, budget }` in `execution_detail.slots[i]` and fall back to keeping the original paragraph. Other parallel slots continue independently.
  - **SEQUENTIAL pairwise ranking within the slot** (per `rankNewVariant`'s mutation contract): call `rankNewVariant` for each surviving rewrite candidate **one at a time** against the slot's own local pool/ratings/matchCounts/completedPairs (NOT `Promise.allSettled` within the slot — those local maps are mutated in-place, so within-slot parallel ranks would corrupt them). The parallelism win comes from running the N slots themselves concurrently per D18, not from within-slot rank parallelism. Pairwise judge calls use AgentName label **`'paragraph_rank'`** (Phase 9 cost-attribution fix — the agent relabels `rankNewVariant`'s internal `'ranking'` calls via a thin LLM-client proxy so per-slot ranking spend buckets into `paragraph_recombine_cost`, NOT the article-level `ranking_cost`; `v2MockLlm.ts` routes `'paragraph_rank'` through the same pairwise-verdict path as `'ranking'`). Track winner via `selectWinner({elo, uncertainty})`.
  - **Persist slot match rows**: accumulate per-slot match buffers across all M rewrites' `rankNewVariant` calls (concat the matches arrays + merge the `beforeAfterRatings` Maps), THEN call `persistSlotMatches(supabase, slotTopicId, parentRun.id, invocationId, ctx.iteration, accumulatedSlotMatches, accumulatedBeforeAfterRatings)` ONCE per slot (NOT M times — minimizes DB round trips, ~12 INSERT statements per invocation instead of 36). This bulk-inserts to `evolution_arena_comparisons` with the SLOT topic's prompt_id (NOT the article-level run promptId — which is what MergeRatingsAgent would do). Per D10, this is required because `sync_to_arena` RPC's `p_matches` is deprecated and MergeRatingsAgent uses `ctx.promptId = <run's article-level promptId>`. Without this helper, per-slot match rows would never reach the slot topic and D10's cross-invocation Elo accumulation would silently fail.
  - **Arena sync (variants only)** — **must call BEFORE persistSlotMatches** (corrected per iter-3 plan review to avoid orphan-match window where match rows reference variants not yet in DB): call `syncToArena(parentRun.id, slotTopicId, slotPool, slotRatings, [], supabase, isSeeded=false, logger)` once per slot using the actual 8-arg signature. Pass an EMPTY array for `matchHistory` because `sync_to_arena` RPC ignores `p_matches` anyway. **Each rewrite in `slotPool` must carry `agentName='paragraph_rewrite'` and `variantKind='paragraph'` on the Variant object** (Variant schema gets these as optional fields per Phase 1 schema update; syncToArena's `newEntries.map(...)` constructor at `persistRunResults.ts:628-643` must be extended to emit `agent_name: v.agentName ?? null` and `variant_kind: v.variantKind ?? 'article'` in the JSONB entry — the extended RPC then reads these and writes them on INSERT). Without this TS-side extension, the migration's RPC fields receive default values and paragraph rewrites land with `agent_name=NULL, variant_kind='article'`.
  - **Partial-failure recovery**: `syncToArena` already has a 1-retry built in. If both attempts fail for a slot, the slot's winner falls back to the `originalSlotVariantId` (which IS in DB via `upsertSlotTopic` regardless of `syncToArena` outcome). Avoids dangling references in recombined-article assembly. Record `discardReason: { failurePoint: 'sync_failed', error }` in `execution_detail.slots[i]`; other parallel slots continue independently.
- [x] Recombination: assemble winners via `assembleRecombinedArticle`. Validate via `validateFormat`; if invalid, set `surfaced=false` with `discardReason: { formatIssues: [...] }`.
- [x] Post-emission ranking: call `rankNewVariant` on the recombined variant against the run's pool. Always-on (no kill-switch per D6).
- [x] **Recombined variant lineage (per revised D4)**: `parent_variant_ids = [parentVariant.id]` only (single-parent). Slot winners stored in `execution_detail.slots[i].winnerSlotVariantId` only — NOT also in `parent_variant_ids`. This avoids the `MAX_PARENT_IDS=10` truncation that previously fired on the default 12-paragraph config. Lineage UI's "Recombined from N slots" badge reads from `execution_detail.slots[*].winnerSlotVariantId` for the expand-list.
- [x] Pre-final-ranking budget gate: throw with `discardReason: { failurePoint: 'budget' }` if `scope.getOwnSpent() >= 0.9 * 0.40`.
- [x] Register `ParagraphRecombineAgent.getAttributionDimension()` returning literal `'paragraph_recombine'`.
- [x] Side-effect register `ATTRIBUTION_EXTRACTORS['paragraph_recombine']` at module bottom.

### Phase 5: Dispatch + projector wiring
- [x] Add new dispatch branch for `'paragraph_recombine'` in `evolution/src/lib/pipeline/loop/runIterationLoop.ts` (after the proposer_approver branch). Honor `EVOLUTION_PARAGRAPH_RECOMBINE_ENABLED` kill-switch.
- [x] Add `paragraphRecombine?: number` peer field to `EstPerAgentValue` in `evolution/src/lib/pipeline/loop/projectDispatchPlan.ts`.
- [x] Add cost projection branch for `'paragraph_recombine'` in `weightedAgentCost` — uses new `estimateParagraphRecombineCost`.
- [x] Add `paragraphRecombineEnabled?: boolean` to `DispatchPlanOptions`. Server-action boundary in `getStrategyDispatchPreviewAction` resolves env and threads it.

### Phase 6: Admin UI — Rich per-slot drill-in (per Point 3)
- [x] Add `'paragraph_recombine'` config to `DETAIL_VIEW_CONFIGS` in `evolution/src/lib/core/detailViewConfigs.ts`. Field definitions for: slot list (paragraphIndex, originalText preview, winner badge, winner Elo ± uncertainty, match count, link to slot arena topic); per-slot rewrites (text, Elo, dropReason); recombined output (text, format-valid badge, format-issues array).
- [x] Add 5-tab layout in `InvocationDetailContent.tsx`: **Paragraph Slots / Recombined Output / Metrics / Timeline / Logs**. Add `'paragraph_recombine'` to `TIMELINE_AGENTS`.
- [x] **Refactor: extract `ArenaLeaderboardTable` from the arena page** (per D17 — revised scope estimate after iteration-1 plan review). Today's arena topic detail page (`src/app/admin/evolution/arena/[topicId]/page.tsx`, **462 LOC** of inlined state) carries: server-side pagination (offset/page/totalPages, `useEffect` on `[topicId, page]`, PAGE_SIZE=25), sort logic (SortKey/sortDir/handleSort), entity-metrics integration (`getEntityMetricsAction`), hideable columns (`hiddenLbCols`), document.title side effect, comparisons sub-tab, all three server actions (`getArenaTopicDetailAction`, `getArenaEntriesAction`, `getArenaComparisonsAction`). Pull all of this into `evolution/src/components/evolution/arena/ArenaLeaderboardTable.tsx`. The arena page becomes a thin shell composing the component plus its existing page-level chrome (breadcrumbs, seed panel). **Realistic estimate: ~350-400 LOC moved + ~50 LOC of new shell** (was previously ~150 LOC moved + ~30 LOC shell — undersized). Zero behavior change to the standalone arena page; regression covered by Phase 7 E2E + a snapshot test added to `arena/[topicId]/page.test.tsx`.
- [x] **Pagination + filter interaction with D20**: when SlotsTab passes `filterToVariantIds=thisInvocationVariantIds`, the component must fetch ALL entries (within the slot's topK<=20 cap from D15) instead of paginating, so the filtered ranks preserve their absolute position. For paragraph topics with topK=20 the total fetch is trivially small (≤20 rows). For article topics where the component may have hundreds of entries, filter-mode requires unbounded fetch — but article-topic callers don't use `filterToVariantIds` (only SlotsTab does, only against paragraph topics). Add a runtime assertion: `if (filterToVariantIds && expectedTotalEntries > 50) throw` so a future caller can't accidentally trigger an unbounded fetch on a big topic. ~20 LOC.
- [x] **Extend `ArenaLeaderboardTable` with optional highlight + filter props** (per D20). Add `highlightVariantIds?: ReadonlySet<string>` (decorate matching rows with `●` in the rank column) and `filterToVariantIds?: ReadonlySet<string>` (only render matching rows; **preserve overall rank** — rank column shows the row's position in the full sorted leaderboard, not its filtered position). Both undefined → standalone arena page behavior unchanged. ~30 LOC of conditional decoration + filter logic.
- [x] Build new custom client component `SlotsTab.tsx` (per D14 — generic over granularity; takes label/formatter props rather than hardcoding 'paragraph'). Co-located at `evolution/src/components/evolution/tabs/`. Master-detail layout:
  - **Left pane:** scrollable list of N slot rows, each labeled per D19 (`V8abc123.P3 — winner: R1 (this inv) Elo 1410 ± 50, +130 vs orig` or `V8abc123.P3 — winner: R7 (prior) Elo 1420 ± 40, +140 vs orig` or `V8abc123.P3 — winner: original Elo 1280 ± 90`). The `(this inv)` vs `(prior)` tag is computed per D20 from whether the winner's variant was introduced by this invocation. Slots that self-aborted via D16 show a red `⚠ slot_budget abort` badge. Selected slot highlighted; click to expand right pane.
  - **Right pane (per D17 + D20):** slim "slot context" header at top (original paragraph text + drop-reason summary + budget-spent indicator + any `failurePoint: 'slot_budget'` warning) followed by a **2-tab toggle** ("All invocations" / "Just this invocation") that switches which prop the embedded `<ArenaLeaderboardTable />` receives:
    - **"All invocations" tab (default)**: passes `topicId={slot.slotTopicId} highlightVariantIds={thisInvocationVariantIds}` — full leaderboard rendered; rows from this invocation marked with `●` in the rank column; bottom caption shows "● = introduced by this invocation · N of M are from this".
    - **"Just this invocation" tab**: passes `topicId={slot.slotTopicId} filterToVariantIds={thisInvocationVariantIds}` — only this invocation's contributions visible; ranks remain absolute (rank 4 still says "4"); bottom caption shows "Showing N of M variants in topic".
    The `thisInvocationVariantIds` set is computed from `execution_detail.slots[i].rewrites[j].slotVariantId` and **includes pre-rank-dropped rewrites** (annotated `· dropped pre-rank (length cap)` in the table) so researchers see the full contribution. Lazy-fetch: only the currently-selected slot's data is loaded.
  - **"View slot N in arena ↗"** link to `/admin/evolution/arena/${slotTopicId}` for a full-page view (mostly redundant with the embedded leaderboard but useful for sharing a deep link or focusing on one slot in isolation).
  - Component props: `{ slots: SlotData[], kindLabel: string ('paragraph' for v1), slotNoun: string ('paragraph'), slotNounPlural: string ('paragraphs') }`. Future sentence/section agents reuse the same component with different props.
- [x] Build `RecombinedOutputTab.tsx`: render the final recombined article with paragraph-level color coding (`Original kept` = neutral gray border; `Rewrite chosen` = green border). Format-validation issues (if any) surface at the top in a red banner with the specific issues from `validateFormat`. Side-by-side toggle for "show original parent" / "show recombined".
- [x] Add timeline phase color constants `PARAGRAPH_REWRITE_COLOR = '#06b6d4'` (cyan) and `PARAGRAPH_RANK_COLOR = '#0e7490'` (deep cyan) in `InvocationTimelineTab.tsx`. Two sub-segments per paragraph slot, rendered as parallel rows: rewrite phase (light cyan) + ranking phase (deep cyan).
- [x] Metrics tab: surface per-slot avg Elo, decisive-rate per slot, count of slots where original-vs-rewrite winners.
- [x] Strategy wizard `src/app/admin/evolution/strategies/new/page.tsx`: add `'paragraph_recombine'` to agent-type dropdown; new per-iteration controls (`rewritesPerParagraph` input, `maxComparisonsPerParagraph` input, `maxParagraphsPerInvocation` input, `paragraphRewriteModel` select). Conditional clear when switching agent type. Field cleanup in `updated.agentType === 'paragraph_recombine'` branch.
- [x] Arena topic list page (`src/app/admin/evolution/arena/page.tsx`): filter default list to `WHERE prompt_kind = 'article'` (per D13). Add a "Paragraph topics" toggle/tab/checkbox to show them when needed. Update `getArenaTopicsAction` server action signature with an `includeParagraphTopics?: boolean` param (passes through as `prompt_kind` filter).
- [x] Surface format-rejection discardReason on the Recombined Output tab so researchers see why no variant was produced when `validateFormat` rejected.
- [x] Variants list (`src/app/admin/evolution/variants/page.tsx`): filter default to `WHERE variant_kind = 'article'` (per D13). Add a "Paragraph variants" toggle so researchers can drill into paragraph snippets when needed; when shown, variant_content gets a short-text rendering treatment instead of the article preview.

### Phase 7: Tests
- [x] Unit: `evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.test.ts` — happy path, per-paragraph rewrite failure, format-rejection of recombined output, invocation-level budget gate, **per-slot self-abort (mid-slot budget exhaustion falls back to original; sibling parallel slots continue)**, **per-slot scope isolation under concurrency (one slot's overrun does not show in another slot's getOwnSpent even when running in parallel)**, **per-slot state isolation (each slot has its own localPool/localRatings/localMatchCounts/completedPairs/cache; assert no cross-slot mutation)**, **cross-slot parallelism with tolerance band (mock LLM injects fixed delay D=100ms per call; assert wall-clock < K×D where K=4 for N=12 slots; gives 3× headroom over ideal 12-slot-parallel = 1×D theoretical; document `--workers=1` requirement in test header for CI determinism)**, **lineage assertion: 12-paragraph article emits recombined variant with `parent_variant_ids.length === 1` (just the originalParent); slot winners verified in `execution_detail.slots[*].winnerSlotVariantId`**, partial-detail-on-throw at every helper boundary, **partial sync_to_arena failure recovery: mock the RPC to fail for slot 3; assert that slot's winner falls back to originalSlotVariantId and other slots continue**, **within-slot ranking is SEQUENTIAL (assert M=3 rewrites call rankNewVariant one at a time, not concurrently — otherwise localRatings corruption)**. (~52 cases)
- [x] Unit: `evolution/src/lib/shared/extractParagraphsWithRanges.test.ts` — byte-range correctness, heading filtering, code-fence handling, `\n\n` edge cases (trailing newlines, multi-blank). (~15 cases)
- [x] Unit: `evolution/src/lib/shared/validateParagraphRewrite.test.ts` — bullets/lists/tables/H1 rejection, length-ratio cap, sentence-count edge. (~10 cases)
- [x] Unit: `evolution/src/lib/pipeline/infra/assembleRecombinedArticle.test.ts` — right-to-left splice correctness, mixed winners (original + rewrites). (~8 cases)
- [x] Unit: extend `evolution/src/lib/pipeline/infra/estimateCosts.test.ts` with `estimateParagraphRecombineCost` cases. (~7 cases)
- [x] **Unit: `evolution/src/services/slotTopicActions.test.ts`** (NEW per iter-3 plan review). Cases for the new `persistSlotMatches` helper: (1) happy path — N matches with valid beforeAfterRatings produce N INSERT rows with correct slotTopicId, correct mu/sigma values after `ratingToDb()` conversion, correct iteration field, correct status='completed'; (2) `beforeAfterRatings` map missing a match's key → that row's mu_before/sigma_before/etc. land as NULL (logged at WARN); (3) Supabase INSERT error path → caught + logged + `paragraph_slot_match_persist_failures` metric increments + returns without throwing (best-effort contract); (4) empty `slotMatches` array → no INSERT call made; (5) `iteration` value flows through to all rows; (6) `winner: 'draw'` matches normalize entry_a/entry_b in sorted order (matches MergeRatingsAgent precedent at line 281). Also covers `upsertSlotTopic` (idempotency, ON CONFLICT behavior against the partial unique index). (~12 cases)
- [x] Unit: extend `evolution/src/lib/pipeline/loop/projectDispatchPlan.test.ts` with paragraph_recombine branch + kill-switch threading. (~4 cases)
- [x] Schema: extend `iterationConfigSchema.test.ts` with new agent-type superRefines. (~5 cases)
- [x] Integration: extend `src/__tests__/integration/evolution-cost-attribution.integration.test.ts` to verify the `'paragraph_rewrite'` label buckets into `paragraph_recombine_cost` AND that the `'ranking'`-labeled calls made under a paragraph_recombine `slotScope` ALSO bucket into `paragraph_recombine_cost` (via the AgentCostScope intercept path), not into `ranking_cost`. (~3 cases)
- [x] Integration: extend `src/__tests__/integration/evolution-cost-estimation.integration.test.ts` to verify dispatch projector matches runtime. (~2 cases)
- [x] Integration: extend `src/__tests__/integration/evolution-pipeline.integration.test.ts` to seed a strategy with paragraph_recombine after a generate iteration; verify recombined variant + single-parent lineage (per revised D4) + slot winners in execution_detail + post-emission ranking. (~3 cases)
- [x] **Integration test for D10 cross-invocation Elo accumulation** (NEW per iter-1; warm-state per iter-2; agent_name+variant_kind assertion per iter-3). Add `src/__tests__/integration/evolution-paragraph-recombine-accumulation.integration.test.ts`: seed a 3-iteration strategy (`generate` → `paragraph_recombine` against the SAME pool parent → `paragraph_recombine` against the SAME pool parent again), assert that (a) slot topic created in invocation 1 is reused via deterministic `[para] V8abc.P3` name in invocation 2, (b) `evolution_arena_comparisons` rows persisted in inv 1 are loaded as competitors in inv 2 via `loadArenaEntries` topK — VERIFY via DB query: `SELECT prompt_id, count(*) FROM evolution_arena_comparisons WHERE prompt_id = <slotTopicId>` returns >0 (proves `persistSlotMatches` wrote rows with slot's prompt_id, NOT article's), (c) R-numbering continues across invocations (invocation 2's rewrites are R4-R6 not R1-R3 — verify via `formatParagraphLabel` helper output, not raw DB), (d) the D20 `(this inv)` vs `(prior)` source tag is computed correctly in `execution_detail.slots[i].winnerSource`, **(e) WARM-STATE INHERITANCE: assert that R1's mu/sigma at the START of invocation 2's ranking phase equals R1's mu/sigma at the END of invocation 1 (within float epsilon = 1e-6). Proves R1 enters invocation 2 with its already-earned cumulative Elo, not a fresh `createRating()` default. LOAD-BEARING for D10's central claim.**, **(f) agent_name + variant_kind ARE persisted correctly: `SELECT agent_name, variant_kind FROM evolution_variants WHERE prompt_id = <slotTopicId> AND id != <originalSlotVariantId>` returns all rows with `('paragraph_rewrite', 'paragraph')` — proves the extended `sync_to_arena` RPC reads + writes the JSONB fields correctly + the syncToArena TS-side caller emits them. Also assert ON CONFLICT path: re-sync the same variant id, verify agent_name and variant_kind are NOT clobbered (per RPC spec)**. Uses real staging DB; cleanup via `[TEST_EVO]` prefix on parent variant. (~7 cases)
- [x] **`cleanupEvolutionData()` extension in `evolution/src/testing/evolution-test-helpers.ts`** (NEW per iter-1 plan review; FK cascade fix added per iter-2). The helper currently cleans `evolution_runs`/`evolution_variants`/etc. by id, but paragraph topics created by `[TEST_EVO]`-prefixed parents have IDs not in any test-tracked set. Extend `cleanupEvolutionData()` to (in order, to respect FK constraints): (1) `DELETE FROM evolution_arena_comparisons WHERE prompt_id IN (SELECT id FROM evolution_prompts WHERE prompt_kind = 'paragraph' AND prompt LIKE '[para] ${prefix}%')` for each `[TEST_EVO]`-tracked parent prefix; (2) `DELETE FROM evolution_variants WHERE prompt_id IN (same subquery)`; (3) `DELETE FROM evolution_prompts WHERE prompt_kind = 'paragraph' AND prompt LIKE '[para] ${prefix}%'`. The explicit comparisons cleanup is required because `evolution_arena_comparisons.prompt_id → evolution_prompts.id` does NOT have an FK CASCADE on prompt deletion (verified via grep). Without this 3-step cascade, paragraph_arena_comparisons rows orphan and staging DB pollutes with each integration run. (Also adds a one-time backfill helper for any pre-existing test paragraph topics in staging from prior test runs.)
- [x] E2E: new spec `src/__tests__/e2e/specs/09-admin/admin-evolution-paragraph-recombine.spec.ts` — invocation detail tab rendering, slot-by-slot table, recombined output panel, timeline bar colors, **embedded ArenaLeaderboardTable in the SlotsTab right pane renders the slot's leaderboard correctly (Elo, matches, cutoff dimming)**, **D20 tab toggle ("All invocations" / "Just this invocation") filters/highlights rows correctly with absolute ranks preserved when filtered**, **slot list left pane shows `(this inv)` vs `(prior)` tag accurately**. (~9 cases)
- [x] Unit: `evolution/src/components/evolution/arena/ArenaLeaderboardTable.test.tsx` — D20 prop behavior: `highlightVariantIds` decorates rows with `●`; `filterToVariantIds` renders only matching rows with overall ranks preserved; both undefined renders all rows un-decorated (regression for standalone arena page). (~6 cases)
- [x] E2E: regression coverage for `admin-evolution-arena-detail.spec.ts` — the page now composes the extracted `ArenaLeaderboardTable` (per D17). Verify no behavior change to the standalone arena page: column rendering, sorting, pagination, seed panel, comparisons sub-tab all intact. (~2 new assertions, no new file)
- [x] E2E: extend `admin-strategy-crud.spec.ts` to cover the new wizard controls. (~2 cases)

### Phase 8: Documentation
- [x] New deep-dive `evolution/docs/paragraph_recombine.md` mirroring `criteria_agents.md` shape: algorithm, knobs, cost stack, failure modes, kill switches.
- [x] Update `evolution/docs/agents/overview.md` § add `ParagraphRecombineAgent` entry.
- [x] Update `evolution/docs/architecture.md` Iteration types table.
- [x] Update `evolution/docs/multi_iteration_strategies.md` § iterationConfigSchema enum.
- [x] Update `evolution/docs/metrics.md` § add paragraph_recombine_cost + propagation entries + per-purpose split table.
- [x] Update `evolution/docs/cost_optimization.md` § add knob table + cost envelope estimates.
- [x] Update `evolution/docs/reference.md` § kill-switch table.
- [x] Update `evolution/docs/data_model.md` § Variant section if any new variant-level metric is added.

## Testing

### Unit Tests
- [x] `ParagraphRecombineAgent.test.ts` — ~40 cases
- [x] `extractParagraphsWithRanges.test.ts` — ~15 cases
- [x] `validateParagraphRewrite.test.ts` — ~10 cases
- [x] `assembleRecombinedArticle.test.ts` — ~8 cases
- [x] Extensions to `estimateCosts.test.ts` (~7), `projectDispatchPlan.test.ts` (~4), `iterationConfigSchema.test.ts` (~5)

### Integration Tests
- [x] `evolution-cost-attribution.integration.test.ts` extension
- [x] `evolution-cost-estimation.integration.test.ts` extension
- [x] `evolution-pipeline.integration.test.ts` extension

### E2E Tests
- [x] `admin-evolution-paragraph-recombine.spec.ts` (new)
- [x] `admin-strategy-crud.spec.ts` extension

### Manual Verification
- [x] Run a 2-iteration strategy (`generate` then `paragraph_recombine`) end-to-end against staging. Inspect: invocation row's `execution_detail.slots[*]` breakdown, **single-parent lineage** (per revised D4 — `parent_variant_ids = [originalParent]` only; slot winners in `execution_detail`), the "Recombined from N slots" badge on the variant detail page expands to the slot-winner list, `paragraph_recombine_cost` metric on run + strategy + experiment.
- [x] **D10 cross-invocation Elo accumulation verification** (NEW per iter-2 plan review). Run a 3-iteration strategy (`generate` → `paragraph_recombine` against the same pool parent → `paragraph_recombine` against the same pool parent AGAIN). Open the SlotsTab on invocation 2; switch the embedded ArenaLeaderboardTable to "All invocations" view; verify (a) rows from invocation 1 visible without `●` marker (unmarked = prior), (b) invocation 2's rows show with `●` marker, (c) R-numbering shows R4-R6 for invocation 2 (continuing from R1-R3 in inv 1), (d) the slot's leaderboard row count is roughly double what it was after invocation 1, (e) the `(this inv)` vs `(prior)` tags on the SlotsTab left pane match correctly. Confirms the cross-invocation accumulation actually buys what D10 promises.
- [x] Trigger format-rejection of the recombined output (mock LLM to inject a bullet); verify discardReason surfaces in the admin UI.
- [x] Budget-exhaustion test: tight per-invocation cap, verify pre-final-ranking gate fires.
- [x] Per-slot self-abort test: tight `perSlotBudgetUsd` (set very low via reduced `perInvocationCap`); verify one or more slots show the red `slot_budget abort` badge in the SlotsTab left pane and the RecombinedOutputTab marks those slots with the "Original kept (slot budget exhausted)" annotation.

## Verification

### A) Playwright Verification (required for UI changes)
- [x] `admin-evolution-paragraph-recombine.spec.ts` covers: tab rendering, per-slot table, timeline colors, recombined panel.
- [x] `admin-strategy-crud.spec.ts` covers: wizard controls visible only for `paragraph_recombine`, defaults populate correctly, validation rejects invalid values.

### B) Automated Tests
- [x] All unit tests in Phase 7 (~89 cases) pass.
- [x] All integration extensions (~7 cases) pass against real staging DB.
- [x] `npm run lint && npm run typecheck && npm run build` clean.
- [x] `npm run test:e2e -- --grep="@evolution"` passes critical evolution specs.

## Documentation Updates
- [x] `evolution/docs/paragraph_recombine.md` — new deep-dive (per criteria_agents.md template)
- [x] `evolution/docs/agents/overview.md` — agent registration entry
- [x] `evolution/docs/architecture.md` — iteration types table + dispatch flow
- [x] `evolution/docs/multi_iteration_strategies.md` — `iterationConfigSchema` enum + first-iteration rules
- [x] `evolution/docs/metrics.md` — paragraph_recombine_cost + observational metrics
- [x] `evolution/docs/cost_optimization.md` — knob table + cost envelope (~$0.014/variant nano+qwen)
- [x] `evolution/docs/reference.md` — kill-switch + scripts table
- [x] `evolution/docs/data_model.md` — if any new variant-level metric is added

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

## Execution outcomes

Status: **COMPLETE** — 20 commits ahead of `origin/main`, `tsc` + `lint` + `build` clean, 6808 unit tests + 14 integration tests passing. See the progress doc for full per-phase work log.

### Phase-by-phase shipping

| Phase | Status | Commit(s) | Approx LOC |
|---|---|---|---|
| 1: Schema + agent registration | ✅ shipped | `d860e780` | ~350 |
| 2: Cost tracking + calibration | ✅ shipped | `131d712a` | ~90 |
| 3: Slot helpers | ✅ shipped | `e8dbf5e7` | ~660 |
| 4: Agent execute() body | ✅ shipped | `103c175e` | ~580 |
| 5: Dispatch + projector wiring | ✅ shipped | `7a785cd3` + projector branch in `a235abce` | ~110 |
| 6: Rich admin UI | ✅ shipped full | `1bac8763` (minimal) + `a235abce` (full +1244 LOC) | ~1250 |
| 7: Tests | ✅ shipped full | `bd5d09f7` (minimal) + `d4d08072` (broad) + `fa267b75` (final deferred) | ~1900 |
| 8: Documentation | ✅ shipped full | `4206122e` (new deep-dive) + `a235abce` (8 surgical updates) | ~700 |

### Final test surface

- **Unit tests** (6808 total across the whole repo). Paragraph-recombine specifically:
  - `paragraphSlots.test.ts` — 18 cases
  - `paragraphLabels.test.ts` — 6 cases
  - `ParagraphRecombineAgent.test.ts` — 20 cases
  - `slotTopicActions.test.ts` — 12 cases
  - `ArenaLeaderboardTable.test.tsx` — 6 cases
  - `estimateCosts.test.ts` extension — 7 cases
  - `projectDispatchPlan.test.ts` extension — 4 cases
  - `iterationConfigSchema.test.ts` extension — 5 cases
  - Plus 7 test-expectation fixups for new metric / MARKER_TACTICS / agent-name counts.
- **Integration**: `evolution-paragraph-recombine-accumulation.integration.test.ts` (4 cases) + `evolution-cost-attribution.integration.test.ts` extension (1 case). Both skip gracefully without local DB migrations; exercise real persistence when migrations are loaded.
- **E2E**: `admin-evolution-paragraph-recombine.spec.ts` (9 cases) backed by `createParagraphRecombineFixture()` helper. Plus D17 regression assertions in `admin-evolution-arena-detail.spec.ts` and 2 wizard cases in `admin-strategy-crud.spec.ts`. Tagged `@evolution`.

### Honestly deferred → all finished

The initial Phase 7 commit (`d4d08072`) left two items as `describe.skip` stubs. The follow-up commit `fa267b75` finished both:

1. **Integration accumulation harness** — finished by exercising D10 contracts through the helper layer directly (4 real cases) instead of building a full pipeline + LLM-provider orchestrator. Skips gracefully without local migrations.
2. **E2E spec seed helper** — finished by adding `createParagraphRecombineFixture()` (~250 LOC) that seeds rows directly. All 9 cases switched from `describe.skip` to live `describe`.

No remaining deferred items beyond the explicit v1.5/v2 list above.

### What the planning doc got right vs. surprised

- **Got right**: D4 single-parent lineage (after iter-1 revision), D10 per-slot persistence helper, D14 generic-over-granularity schema, D16 per-slot `AgentCostScope`, D17 ArenaLeaderboardTable extraction (matched the ~400 LOC realistic estimate from iter-1).
- **Surprised**: `validateFormat`'s "no section headings" + "paragraphs must have ≥2 sentences" rules required test fixtures to include `## Section` headers and 2-sentence paragraphs — not anticipated in initial test sketches. The entity-registry-parity test-fixup surface (7 files: entities.test, startupAssertions.test, tactics/index.test, arena/page.test plus the registries themselves) was wider than the plan projected (~3 files).
- **Cost envelope**: actual ~$0.011/variant at defaults matched the prediction (D9 said "~$0.011/variant with nano+qwen").

## Post-merge retrofit for the subagent hierarchy (PR #1109 — `rename_agents_subagents_evolution_20260508`)

> **⚠️ STATUS: FUTURE-WORK PLAN — applies POST-rebase, not pre-merge.**
>
> The original 8-phase paragraph_recombine work is **complete and shipped** on this branch (22 commits ahead of `origin/main`; `tsc` + `lint` + `build` + 6808 unit + 14 integration + 9 E2E tests passing). See "Execution outcomes" above.
>
> This section is a **plan for the next PR** — the rebase commit that lands this branch onto an updated `origin/main` that now contains PR #1109. R1–R7 describe code/test changes to be made AS PART OF the rebase, not pre-emptive work on this branch. Reviewers grading this section should evaluate it as a *plan*, not as *implementation status*. Counts like "post-merge: 17 + 44" are TARGETS for the rebase commit, not current branch state.

**Context**: Main gained PR #1109 (commit `cb62c1d1`) AFTER this branch was cut from `ea7d57f8`. That PR introduces an agent → subagent hierarchy that this branch's code predates. The retrofit is mostly additive — no architectural rework — but there are seven concrete integration points to land in the rebase commit. Verified directly via `git show origin/main:<path>` not from prediction.

### Architecture summary (what landed in #1109)

- **Subagents are derived, not registered.** Each invocation's `execution_detail` JSONB is parsed at render time by an agent-specific parser in `evolution/src/lib/shared/subagentTreeParser.ts`. The parser returns a `SubagentNode[]` tree consumed by both the UI (`SubagentsTab.tsx`) and the metric backfill script. There is NO database table for subagents; the tree is computed from JSONB.
- **The Subagents tab is now the default first tab** on `/admin/evolution/invocations/[id]` for ALL agent types (added in `InvocationDetailContent.tsx`'s `buildTabs()`).
- **Logger gains `.child()`** in `createEntityLogger.ts`. Returns a new logger whose dotted-path basePath is extended; the result lands in `evolution_logs.subagent_name`.
- **LLM client auto-wraps in spans** — `createEvolutionLLMClient` wraps each `complete()` call in `withActiveSpan('subagent.${agentName}', ...)`. No agent-level code change needed for OTel attribution.
- **`evolution_logs.agent_name` is renamed to `subagent_name`** — migrations `20260524000006` (expand: add `subagent_name` + bidirectional mirror trigger) and `20260524000007` (contract: drop `agent_name`). Our migrations (`20260527000001-4`) run AFTER both, and we never reference `evolution_logs.agent_name` directly (verified by grep), so this is transparent.
- **`trackBudget` gains `getSubagentCosts?()` as an alias for `getPhaseCosts()`** — semantically identical, no behavior change.

### Conflicts confirmed via direct verification (not agent guesses)

Earlier parallel-agent investigation produced one contradiction: agent #2 claimed main "deleted paragraph_recombine from `iterationAgentTypeEnum`" and "deleted the wizard UI". Direct verification (`git show origin/main:evolution/src/lib/schemas.ts | grep paragraph_recombine` → empty; `git show origin/main:src/app/admin/evolution/strategies/new/page.tsx | grep paragraph_recombine` → empty) **disproved that claim**: main simply never had paragraph_recombine; it's our feature. The "-114 LOC" stat in `git diff HEAD..origin/main` reads as deletion *from* HEAD's perspective because main lacks our additions. No architectural decision is needed about whether paragraph_recombine is "user-facing"; our Phase 6 wizard work stands as designed.

### Retrofit work items

#### R1 — `InvocationDetailContent.tsx`: add Subagents tab + decide default-tab UX

Main's `buildTabs('paragraph_recombine')` doesn't exist (the agent's not in main). On main, **most** branches prepend a `subagentsTab` entry — but **debate is an explicit exception** (verified at `git show origin/main:src/app/admin/evolution/invocations/[invocationId]/InvocationDetailContent.tsx` lines 33–40: the `DEBATE_GENERATE_AGENT` branch returns `[overview-debate, overview-synthesis, metrics, timeline, logs]` with no subagents tab). Per the iteration-5 reviewer catch, "every other branch follows the pattern" was an overstatement; reflect_and_generate and criteria-and-generate prepend it, debate doesn't.

**Decision for paragraph_recombine**: prepend `subagentsTab` (follow the reflect/criteria pattern, not the debate exception) BUT explicitly pin the default active tab to `'slots'` so researchers' bespoke per-slot drill-in stays the entry point:

```typescript
// Final shape (after merge): 6-tab layout
if (agentName === PARAGRAPH_RECOMBINE_AGENT) {
  return [
    { id: 'subagents', label: 'Subagents' },          // ← generic tree (new)
    { id: 'slots', label: 'Paragraph Slots' },        // ← default active per useTabState({defaultTab: 'slots'})
    { id: 'recombined', label: 'Recombined Output' },
    { id: 'metrics', label: 'Metrics' },
    { id: 'timeline', label: 'Timeline' },
    { id: 'logs', label: 'Logs' },
  ];
}
```

```typescript
const [activeTab, setActiveTab] = useTabState(tabs, { defaultTab: 'slots' });
```

`useTabState` already accepts `{defaultTab}` (verified at `git show origin/main:evolution/src/components/evolution/sections/EntityDetailTabs.tsx` lines 83–104). Researchers landing on a paragraph_recombine invocation page see the bespoke per-slot leaderboard first (the domain-specific value); the generic tree is one click away.

Wire `{activeTab === 'subagents' && <SubagentsTab invocation={inv} />}` alongside our existing `paragraph-slots-tab` and `paragraph-recombined-tab` blocks.

#### R2 — `evolution/src/lib/shared/subagentTreeParser.ts`: register a parser for `paragraph_recombine`

Add a new export `parseParagraphRecombineTree(detail)` and a `case 'paragraph_recombine':` arm in `parseSubagentTreeByAgentName()`.

**SCHEMA CONSTRAINT (iter-5 catch)**: `slotRecombineExecutionDetailSchema.slots[i].ranking` captures `matchCount` + `ratings[]` + `winnerSlotVariantId` ONLY — there is **no per-comparison detail array** like the `ranking.comparisons[]` that `parseProposerApproverCriteriaTree` consumes (verified at `evolution/src/lib/schemas.ts` lines 2135–2143). Our agent does not capture per-call durationMs/cost for each pairwise comparison inside `rankNewVariant`. Three options:

1. **Tree stops at L2 ranking (Composite, no children)** — emit one `ranking` node per slot with `costUsd=0`, `durationMs=0`, `summary='N matches ranked'`. Cleanest, no schema change.
2. **Synthesize L3 placeholder comparison nodes** — emit `matchCount` `Deterministic` nodes named `comparison.${k}` each with `cost=0`, `durationMs=0`. Gives tree-count parity with proposer_approver but per-node values are uninformative.
3. **Schema extension** — capture per-comparison `{cost, durationMs}` arrays during `rankNewVariant`. Would need a small agent code change AND a schema bump.

**Decision: ship option 1 in the retrofit.** Option 3 is a follow-up; option 2 is misleading. Tree shape:

```
L1 paragraph_recombine (Composite)
├── L2 slot.0 (Composite)
│   ├── L3 rewrite.0 (LLM)     ← cost+durationMs from rewrites[0]
│   ├── L3 rewrite.1 (LLM)
│   ├── L3 rewrite.2 (LLM)
│   └── L3 ranking (Composite, no children)  ← summary='N matches ranked'
├── L2 slot.1 (Composite)
│   └── …
└── L2 recombine (Deterministic)   ← summary='K of N slots replaced'
```

**Parser code skeleton** (mirrors `parseProposerApproverCriteriaTree` style):

```typescript
export function parseParagraphRecombineTree(detail: Record<string, unknown> | null | undefined): SubagentNode[] {
  if (!detail) return [];
  const slots = (detail.slots as Array<Record<string, unknown>> | undefined) ?? [];
  const out: SubagentNode[] = [];
  let slotsReplaced = 0;

  slots.forEach((slot, slotIdx) => {
    const slotPath = [`slot.${slotIdx}`];
    const children: SubagentNode[] = [];
    let slotCost = 0;
    let slotDuration = 0;

    const rewrites = (slot.rewrites as Array<Record<string, unknown>> | undefined) ?? [];
    rewrites.forEach((rw, j) => {
      const cost = num(rw.costUsd);
      const duration = num(rw.durationMs);
      slotCost += cost;
      slotDuration += duration;
      children.push(makeChild(slotPath, `rewrite.${j}`, 'LLM', duration, cost, {
        summary: rw.dropReason ? `dropped (${rw.dropReason})` : undefined,
      }));
    });

    const ranking = slot.ranking as Record<string, unknown> | undefined;
    if (ranking) {
      const matchCount = num(ranking.matchCount);
      children.push(makeChild(slotPath, 'ranking', 'Composite', 0, 0, {
        summary: `${matchCount} match${matchCount === 1 ? '' : 'es'} ranked`,
      }));
      const winnerIsOriginal = ranking.winnerIsOriginal === true;
      if (!winnerIsOriginal) slotsReplaced++;
    }

    out.push(makeChild([], `slot.${slotIdx}`, 'Composite', slotDuration, slotCost, {
      children,
      summary: ranking ? undefined : 'self-aborted',
      bespokeDetail: {
        configKey: 'paragraph_recombine',
        keyFilter: [`slots.${slotIdx}`],
        data: { slots: [slot] },        // ← re-wrap so ConfigDrivenDetailRenderer's 'slots' field def resolves to a single-element array
      },
    }));
  });

  out.push(makeChild([], 'recombine', 'Deterministic', 0, 0, {
    summary: `${slotsReplaced} of ${slots.length} slot${slots.length === 1 ? '' : 's'} replaced`,
  }));
  return out;
}
```

**`bespokeDetail.data` re-wrapping (iter-5 catch — verified)**: our `DETAIL_VIEW_CONFIGS['paragraph_recombine']` defines `slots` as a `type: 'table'` field. ConfigDrivenDetailRenderer reads `resolveKeyPath(data, field.key)` per field — verified at `src/app/admin/evolution/invocations/[invocationId]/ConfigDrivenDetailRenderer.tsx:113-122` (`function renderField` at line 112; `case 'table'` at line 116 passes the resolved value to `renderTable(value as unknown[], ...)`). With `field.key='slots'`, the data payload must be `{ slots: [<one-slot-blob>] }` — single-element array — so the table renders exactly one row from that array for the slot's drill-in. Bare `data: slot` would NOT work because the renderer wouldn't find a `slots` property to resolve.

**Parser error fallback (iter-5 catch — T8)**: wrap `parseParagraphRecombineTree` body in try/catch in `parseSubagentTreeByAgentName`:

```typescript
case 'paragraph_recombine':
  try { return parseParagraphRecombineTree(detail); }
  catch (err) {
    console.warn('[subagentTree] paragraph_recombine parser failed; rendering empty tree', err);
    return [];
  }
```

Mirrors the resilience pattern other parsers should adopt; SubagentsTab gracefully renders "no subagents recorded" on empty array, so a parser bug doesn't break the whole invocation detail page.

#### R3 — `ParagraphRecombineAgent`: adopt `logger.child()` chains

Currently the agent passes `ctx.logger` flat into `rankNewVariant` (lines 446, 502). After merge, refactor at three propagation levels:

**Level 1 — slot:**
```typescript
const slotLogger = ctx.logger.child?.(`slot.${slot.paragraphIndex}`) ?? ctx.logger;
```

**Level 2 — per-rewrite (within the parallel `rewriteResults` Promise.allSettled at agent line 330):**
```typescript
const rewriteLogger = slotLogger.child?.(`rewrite.${index}`) ?? slotLogger;
// Pass rewriteLogger to logger fields if a helper inside the rewrite loop takes one;
// the LLM client's withActiveSpan wrapper attributes automatically.
```

**Level 3 — per-candidate ranking (within the sequential ranking loop at agent line 430):**
```typescript
// In the for-loop over survivingRewriteVariants:
const rankingLogger = slotLogger.child?.('ranking') ?? slotLogger;
const result = await rankNewVariant({
  ...,
  logger: rankingLogger,  // ← replaces ctx.logger at line 446
});
```

**`rankNewVariant`'s internal logger propagation (iter-5 catch — A3)**: `rankNewVariant` receives a single `logger` param and forwards it to its own internal LLM/judge helpers. We do NOT need to add a `comparison.${k}` child segment per pairwise call inside `rankNewVariant` — the OpenTelemetry `withActiveSpan` wrapper in `createEvolutionLLMClient` already produces per-call spans named `subagent.ranking`. Subagent-name dotted path for logs from inside `rankNewVariant` will be `slot.${i}.ranking` (one level deeper than `ctx.logger` would produce), which is the desired granularity given our schema doesn't carry per-comparison detail. If finer per-comparison logging is needed in a follow-up, R2's parser would need option-3 schema extension first.

**Why `?.` (optional-chain)** — `EntityLogger.child` is declared OPTIONAL in the type on main (verified at `git show origin/main:evolution/src/lib/pipeline/infra/createEntityLogger.ts:99`: `child?(name: string | string[]): EntityLogger`). The factory always provides it, so production never hits the fallback; the chain is purely for test-mock compatibility (our `ParagraphRecombineAgent.test.ts` uses a flat-mock logger without `.child`).

Resulting `evolution_logs.subagent_name` patterns for a paragraph_recombine invocation: `slot.0`, `slot.0.rewrite.2`, `slot.0.ranking`, `slot.1.rewrite.0`, etc. Mirrors the convention reflect_and_generate and proposer_approver use.

#### R4 — `OUTPUT_TOKEN_ESTIMATES['paragraph_rewrite']` and span attribution

The LLM client's auto-span wrapper uses `agentName` as the span name. Our `'paragraph_rewrite'` AgentName already flows through correctly — verified by reading `createEvolutionLLMClient.ts:118-123` on main:
```typescript
return withActiveSpan(
  `subagent.${agentName}`,           // → 'subagent.paragraph_rewrite'
  { 'subagent.path': agentName, 'subagent.label': agentName },
  // …
);
```
No agent-level code change needed; cost + span attribution works automatically as soon as the agent calls `slotLlm.complete(prompt, 'paragraph_rewrite')` (which it already does).

#### R5 — E2E spec: add Subagents-tab cases to `admin-evolution-paragraph-recombine.spec.ts`

Iter-5 reviewer caught that the original "one case" scope undersells coverage. Mirroring main's `admin-evolution-subagents.spec.ts` (which covers GFPA, Reflect+Gen, Iterative Editing across L1/L2/L3 rendering + expand/collapse + cost/duration aggregation), add **three** cases — but reuse the existing 3 fixtures so the runtime stays bounded:

```typescript
adminTest('Subagents tab renders L2 slot rows + L3 rewrite/ranking children for happy-path fixture', async ({ adminPage }) => {
  await adminPage.goto(`/admin/evolution/invocations/${standardFixture.invocationId}?tab=subagents`);
  // 3 slot rows + 1 recombine row at L2.
  expect(await adminPage.locator('[data-testid="subagent-row-slot.0"]').count()).toBe(1);
  expect(await adminPage.locator('[data-testid="subagent-row-slot.1"]').count()).toBe(1);
  expect(await adminPage.locator('[data-testid="subagent-row-slot.2"]').count()).toBe(1);
  expect(await adminPage.locator('[data-testid="subagent-row-recombine"]').count()).toBe(1);
  // Expand slot.0 → L3 rewrite + ranking rows.
  await adminPage.locator('[data-testid="subagent-row-slot.0"]').click();
  expect(await adminPage.locator('[data-testid^="subagent-row-slot.0.rewrite."]').count()).toBe(3);
  expect(await adminPage.locator('[data-testid="subagent-row-slot.0.ranking"]').count()).toBe(1);
  // Cost aggregation: L2 slot.0 row's cost should equal sum of its L3 rewrite cost cells.
  const slotCost = await adminPage.locator('[data-testid="subagent-row-slot.0"] [data-testid="cost-cell"]').textContent();
  expect(slotCost).toMatch(/\$0\.\d+/);
});

adminTest('Subagents tab marks self-aborted slot row with "self-aborted" summary', async ({ adminPage }) => {
  await adminPage.goto(`/admin/evolution/invocations/${abortFixture.invocationId}?tab=subagents`);
  const lastSlotIdx = 2; // forceSlotAbort makes the last slot abort
  await expect(adminPage.locator(`[data-testid="subagent-row-slot.${lastSlotIdx}"]`)).toContainText('self-aborted');
});

adminTest('default active tab remains "Paragraph Slots" (not Subagents) for paragraph_recombine invocations', async ({ adminPage }) => {
  // R1 specifies useTabState({defaultTab: 'slots'}) so researchers' bespoke entry point is preserved.
  await adminPage.goto(`/admin/evolution/invocations/${standardFixture.invocationId}`);
  await expect(adminPage.locator('[data-testid="paragraph-slots-tab"]')).toBeVisible();
  // Subagents tab visible in the tab strip but NOT active.
  await expect(adminPage.locator('[role="tab"]:has-text("Subagents")')).toBeVisible();
  await expect(adminPage.locator('[role="tab"][aria-selected="true"]:has-text("Paragraph Slots")')).toBeVisible();
});
```

Tagging: keep `@evolution` for consistency with the rest of `admin-evolution-paragraph-recombine.spec.ts`. Subagents-tab UI primitive is already covered by main's `admin-evolution-subagents.spec.ts` in the pre-merge gate (untagged); our cases verify the paragraph_recombine-specific parser output, not the primitive itself.

#### R6 — Update `createParagraphRecombineFixture` execution_detail to satisfy the new parser

Our fixture already emits the canonical `SlotRecombineExecutionDetail` shape (`slots[].rewrites[].costUsd/durationMs`, `slots[].ranking.matchCount`, `slots[].ranking.winnerIsOriginal`), which is exactly what R2's parser expects. No fixture changes needed for R5's three new cases.

**Deferred to a follow-up** (iter-5 reviewer A5 catch — D20 cross-invocation E2E coverage): the current fixture seeds ONE invocation per parent. The D20 "All invocations" vs "Just this invocation" toggle was already covered by Phase 7 unit tests on `ArenaLeaderboardTable` (6 cases) + the D10 accumulation integration test (4 cases). Extending the E2E fixture with an optional `secondInvocationVariants` param to cover the full D20 toggle UI flow remains a v1.5 polish — not blocking the retrofit.

#### R7 — Tests: parser unit suite + logger-mock coverage + entity-registry count update

Iter-5 reviewer caught three under-specified test gaps (T1, T2, T6). Address them as follows:

**R7a — `subagentTreeParser.test.ts` extension (5 cases for `parseParagraphRecombineTree`)**:
Mirror the existing pattern in main's `subagentTreeParser.test.ts` (read at `git show origin/main:evolution/src/lib/shared/subagentTreeParser.test.ts` — each existing parser has 1–3 cases). Add a new `describe('parseParagraphRecombineTree', ...)` block with:

1. `returns L2 slot composites + L2 recombine deterministic` — happy-path 3-slot detail, asserts 4 L2 nodes (3 slots + recombine), each slot has L3 children (3 rewrites + 1 ranking composite).
2. `returns empty array for null detail` — defensive parser check, mirrors `parseGenerateFromPreviousArticleTree`'s null test.
3. `marks self-aborted slot with "self-aborted" summary` — fixture with one slot missing `ranking` (set via the agent's `discardReason: { failurePoint: 'slot_budget' }` path).
4. `recombine deterministic node summary counts replaced vs original-kept slots` — fixture with 2 of 3 slots' `ranking.winnerIsOriginal=true`, asserts summary text `'1 of 3 slots replaced'`.
5. `slot.X composite cost = sum of its rewrite L3 costs` — fixture with known rewrite costs `[0.001, 0.002, 0.003]`, asserts L2 slot.0 costUsd === 0.006.

Plus extend the existing `parseSubagentTreeByAgentName (façade)` describe block with:
6. `dispatches paragraph_recombine to parseParagraphRecombineTree` — single-line dispatch check.
7. `parser error fallback returns empty array and logs warn` — pass a malformed `execution_detail` (e.g. `{slots: 'not-an-array'}`) and assert (a) the dispatcher returns `[]`, (b) `console.warn` was called once. Locks in T8's try/catch contract from R2's dispatch arm.

**R7b — `ParagraphRecombineAgent.test.ts` extension (2 logger.child cases)**:
Add to the existing 20-case suite:

1. `when ctx.logger.child is defined, emits dotted-path subagent_name for slot logs` — mock with `child: jest.fn().mockReturnValue({...})`, run a 2-slot invocation, assert `child` called with `'slot.0'` AND `'slot.1'`.
2. `when ctx.logger.child is undefined, falls back to flat ctx.logger without throwing` — existing flat-mock logger (no `child` method), assert agent completes successfully.

**R7c — `entities.test.ts` count fixup** (iter-5 reviewer T6 + pre-flight verification):

Three-way state to track:

| State | `RunEntity.duringExecution` count | `StrategyEntity.atPropagation` count | Lineage |
|---|---|---|---|
| **Main (current)** | 15 | 42 | Main removed `iterative_edit_rank_cost` + its 2 rollups in PR #1109 (superseded by `subagent:ranking.cost` dynamic prefix) |
| **This branch HEAD (current)** | 18 | 46 | Base 16 + our 2 paragraph_recombine adds; base 44 + our 2 paragraph_recombine rollups |
| **Post-rebase (target for the merge commit)** | **17** | **44** | Main 15 + our 2 = 17; Main 42 + our 2 = 44 |

Pre-flight diff confirms this via `git diff HEAD..origin/main -- evolution/src/lib/core/entities/RunEntity.ts entities.test.ts`. **In the rebase commit, update `entities.test.ts` assertions** from `toHaveLength(18)` → `toHaveLength(17)` and `toHaveLength(46)` → `toHaveLength(44)`. Update the comment text to reference both lineages (our adds + main's removals). Do NOT do this pre-emptively on this branch — that would break our existing CI green state. The change belongs in the rebase commit alongside the removed `iterative_edit_rank_cost` registry lines that main carries.

### Out of retrofit scope (no changes needed)

- **Migrations** — our 4 migrations (timestamps `20260527000001-4`) run cleanly after main's `20260524000006-7`. No schema overlap; verified via direct read.
- **Codebase reference to `evolution_logs.agent_name`** — iter-5 reviewer T5 caught the broader-grep gap. Verified clean: `grep -rn "evolution_logs" evolution/src/ src/ scripts/ --include='*.ts' --include='*.tsx' | grep agent_name` returns zero hits. Our paragraph_recombine code never reads or writes that column directly; the migration rename is transparent.
- **Metric registry** — our 4 new metrics (`paragraph_recombine_cost`, `paragraph_slot_match_persist_failures`, `total_paragraph_recombine_cost`, `avg_paragraph_recombine_cost_per_run`) are additive. The `'paragraph_rewrite'` `AgentName` addition in `agentNames.ts` is additive. Main also added a dynamic `subagent:*` metric prefix that's orthogonal to our static metrics.
- **`persistSlotMatches` + `evolution_arena_comparisons`** — untouched by the subagent PR. Our slot-match persistence path is independent of `evolution_logs`.
- **`trackBudget` API** — our per-slot `AgentCostScope` nesting (D16/D18) works unchanged. We can OPTIONALLY adopt `getSubagentCosts?()` as a forward-compat name where we call `getPhaseCosts()`, but it's the same method.
- **`startupAssertions.ts` + `agentNames.ts`** — our additions of `'paragraph_rewrite'` are additive; main hasn't touched these enum lists for the subagent PR.
- **D10 warm-state assertion epsilon (iter-5 T7)** — the integration test asserts mu/sigma equality across invocations with `epsilon = 1e-6`. The persistence path is `Rating → ratingToDb (linear projection) → Postgres NUMERIC (38-digit precision) → loadArenaEntries → dbToRating (linear projection back)`. No lossy operations (no FP averaging, no truncation, no JSONB round-trip). 1e-6 is justified by the linearity — even relaxing to 1e-3 (0.001 Elo points) is harmless overkill but won't change the assertion's intent. Keep 1e-6 as written.

### Merge conflict files (predicted, in priority order)

| File | Cause | Expected resolution |
|---|---|---|
| `InvocationDetailContent.tsx` | We added paragraph_recombine arm; main added `subagentsTab` to every existing arm | Manually add `subagentsTab` to our arm + render `<SubagentsTab>` block (per R1) |
| `evolution/src/lib/shared/subagentTreeParser.ts` | New file on main; we have nothing | Pure addition (R2) — no conflict, just net-new function |
| `evolution/src/lib/pipeline/infra/createEntityLogger.ts` | Both branches edit (theirs: `.child()` method; ours: untouched besides imports) | Likely clean auto-merge — the `.child()` addition is in a different region than any of our edits |
| `evolution/src/lib/pipeline/infra/trackBudget.ts` | Main adds `getSubagentCosts?()` alias | Clean auto-merge; we can adopt later |
| `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts` | Main wraps in `withActiveSpan`; we added `OUTPUT_TOKEN_ESTIMATES['paragraph_rewrite']` entry | Likely clean auto-merge — non-overlapping regions |
| `evolution/src/lib/core/entities/entities.test.ts` | Main may have changed metric counts independently (need to re-verify if it touched our 18→17 / 46→? lines) | Re-run after merge; update counts to match merged superset |

### Estimated retrofit effort (revised after iter-5 review)

- R1 — InvocationDetailContent merge + Subagents tab wiring + `defaultTab: 'slots'` decision: **~45 min** (mechanical merge + UX decision now documented)
- R2 — `parseParagraphRecombineTree` parser + try/catch fallback + bespokeDetail.data re-wrap: **~90 min** (~100 LOC, plus the schema-constraint decision documented)
- R3 — agent logger.child() retrofit at 3 levels (slot → rewrite, slot → ranking): **~45 min** (~25 LOC; rankNewVariant's internal propagation is out-of-scope per A3 resolution)
- R4 — span attribution: **0 min** (already works)
- R5 — E2E spec: **3 new cases** using existing fixtures (standard + abort + default-tab assertion): **~45 min**
- R6 — fixture: **0 min** (already in shape; D20 second-invocation extension deferred to v1.5)
- R7 — Tests: 6 parser cases + 2 logger.child cases + entities.test.ts count fix: **~60 min**
- **Total: ~4.5 hours** focused work + rebase friction (revised up from 3h after iter-5 review).

No paragraph_recombine architectural decisions revisited — the existing D1–D20 design holds. This retrofit is purely additive integration with the new generic-tree primitive.

### Iteration-5 plan-review fixes applied (commits TBD on retrofit branch)

- **S1**: corrected R1's false claim that "every other branch prepends subagentsTab" — debate is an exception.
- **S2/A4**: R2 now documents the schema constraint (no per-comparison detail captured) and ships option 1 (L2 ranking composite with summary, no L3 comparison nodes). Schema extension deferred.
- **A1**: R2 now shows the `bespokeDetail.data` slicing pattern explicitly (`{ slots: [<single-slot-blob>] }`).
- **A2**: R1 now pins `useTabState({ defaultTab: 'slots' })` so Paragraph Slots stays the researcher's default entry point even though Subagents is tab[0].
- **A3**: R3 now specifies the 3-level chain (slot → rewrite, slot → ranking) and explicitly scopes `rankNewVariant`'s internal logging as out-of-scope (its existing `slot.${i}.ranking` granularity is sufficient).
- **T1**: R7a enumerates 6 parser test cases by name with assertions.
- **T2**: R7b adds 2 logger-mock unit cases (real-child + flat-fallback).
- **T3**: R5 expanded from 1 case to 3 cases (tree-render, self-abort summary, default-tab assertion).
- **T5**: documented broader grep result (zero hits in TS/scripts).
- **T6**: R7c specifies post-merge counts of 17 + 44 with the lineage explained.
- **T7**: kept 1e-6 epsilon with linearity justification.
- **T8**: R2 specifies try/catch fallback in the dispatch switch.
