# Investigate Banner On Paragraph Rewrite Paragraph Variant Research

## Problem Statement
Variant id `af33e26d-fb87-479f-86b1-4593a9cd340a` and many other variants on invocation id `1bc65fd0-d6fa-4d13-8afb-93cc1510a82a` show this banner:

> This variant was discarded by its owning generate agent (local Elo below the top-15% cutoff at budget exhaustion). It is not included in run-level metrics.

We are investigating why this banner appears on these (paragraph-rewrite) variants and whether it is correct.

## Requirements (from GH Issue #1156)
same as summary

## High Level Summary
**Root cause (HIGH confidence, confirmed by 12 agents across 3 rounds, including an adversarial refutation pass):**

The "discarded variant" banner renders **purely on `variant.persisted === false`** and its text is **hardcoded** for the *generate-agent* discard path. Paragraph-recombine variants (`variant_kind = 'paragraph'`) are persisted through a **different code path** — the `sync_to_arena` RPC — whose `INSERT` **omits the `persisted` column**. Because the column is declared `BOOLEAN NOT NULL DEFAULT false`, every paragraph variant lands with `persisted = false`. The UI therefore shows the generate-agent "discarded" banner on **legitimately-surfaced paragraph rewrites**, which is why one paragraph-recombine invocation (`1bc65fd0…`) produces many variants that all show the banner.

This is two defects in one:
1. **Cosmetic/UX (definitely wrong):** surfaced paragraph variants display a red "Discarded variant" banner, a ✗ in the persisted column, and dimmed/dashed lineage nodes; the banner text describes a mechanism (generate-agent top-15% Elo cutoff at budget exhaustion) that does not apply to paragraph slot variants.
2. **Metrics correctness (nuanced):** several run-level metric queries filter `.eq('persisted', true)`, so paragraph variants are currently excluded. Whether they *should* be excluded is a real design question — paragraph variants carry paragraph-scale Elo and are already excluded from Elo *attribution* via `.eq('variant_kind','article')`. A naive "flip paragraph rows to persisted=true" fix risks polluting article-scale run-Elo metrics. The fix should be `variant_kind`-aware.

## Staging Confirmation (2026-05-31, read-only `npm run query:staging`)
The bug is **verified on real staging data** (it lives on staging, not prod):

- **Variant `af33e26d-fb87-479f-86b1-4593a9cd340a`:** `variant_kind = paragraph`, **`persisted = false`**, `agent_name = paragraph_rewrite`, `agent_invocation_id = NULL`. A per-slot paragraph rewrite stuck at `persisted=false` → fires the (wrong) generate-agent banner.
- **Invocation `1bc65fd0-d6fa-4d13-8afb-93cc1510a82a`:** `agent_name = paragraph_recombine`, `variant_surfaced = true`, cost ≈ $0.0105. Confirmed a paragraph-recombine invocation.
- **FK nuance:** only the recombined **article** output is linked to the invocation via `agent_invocation_id` (1 row, `article/true`). Paragraph rewrite variants have `agent_invocation_id = NULL` — they are not FK-linked to their invocation at all (a secondary attribution gap).
- **Blast radius (whole staging DB):**
  | variant_kind | persisted | count |
  |---|---|---|
  | article | true | 10843 |
  | article | false | 89 (legitimate generate-agent discards — banner correct) |
  | paragraph | false | **758** |
  | paragraph | true | **0** |
  → **100% of paragraph variants are `persisted=false`** (no `paragraph/true` rows exist anywhere). In the affected run `ae9f21d5-cb12-4625-88b1-84facbe8b9c1`: 25 paragraph/false and 11 article/true (no paragraph/true).

This confirms the root cause end-to-end: paragraph variants are written via `sync_to_arena` (which never sets `persisted`), so they all default to `false` and universally show the incorrect "discarded by generate agent" banner. **Open Question #1 is RESOLVED.**

## Documents Read

### Core Workflow Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md (Step 1: Research — "use different agents to form different perspectives, then reconcile; multiple rounds OK")

### Core Operations Docs
- docs/docs_overall/environments.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/debugging.md — `npm run query:prod` is read-only (readonly_local role) for inspecting prod rows

### Relevant Docs (evolution subsystem)
- evolution/docs/data_model.md — `evolution_variants` / `evolution_agent_invocations` schemas; `persisted`, `variant_kind`, `variant_surfaced`, `agent_invocation_id`
- evolution/docs/rating_and_comparison.md — Elo + top-15% cutoff
- evolution/docs/agents/overview.md — generate-agent surface/discard decision
- evolution/docs/paragraph_recombine.md — per-slot paragraph rewrite + failure modes
- evolution/docs/visualization.md — admin UI variant/invocation detail pages
- evolution/docs/metrics.md — run-level metrics + attribution
- evolution/docs/architecture.md — iteration loop, budget, surface/discard policy
- docs/planning/analyze_effectiveness_paragraph_recombine_20260530/findings.md — prior project; "121/121 expected variants persisted" (paragraph rewrites are persisted, not discarded)
- docs/planning/generate_rank_evolution_parallel_20260331/..._planning.md — original intent of `persisted=false` (generate iterations only)

## Code Files Read
- `src/app/admin/evolution/variants/[variantId]/VariantDetailContent.tsx:111-124` — the banner (hardcoded text, gated solely on `variant.persisted === false`, `data-testid="variant-discarded-banner"`)
- `src/app/admin/evolution/variants/[variantId]/VariantDetailContent.test.tsx` — mocks all use `persisted:true`; no banner assertion yet
- `src/app/admin/evolution/invocations/[invocationId]/InvocationDetailContent.tsx` — invocation page renders ONE produced variant, not a list; paragraph_recombine invocations get a bespoke Slots/Recombined/Metrics/Timeline/Logs layout
- `evolution/src/services/variantDetailActions.ts:173` — `persisted: variant.persisted ?? true` (JS `?? true` only catches null/undefined; a stored `false` passes through → banner)
- `evolution/src/lib/pipeline/loop/rankNewVariant.ts:96-109` — generate-agent discard: `discard = rankResult.status === 'budget' && localVariantElo < localCutoff` (B119 in-run-only cutoff fix)
- `evolution/src/lib/pipeline/loop/rankSingleVariant.ts:35,102-115` — `TOP_PERCENTILE = 0.15`; `computeTop15Cutoff` (B121 ceil/clamp fix)
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts:259-324` — ARTICLE variants explicitly upserted with `persisted:true` (284, surfaced) / `persisted:false` (318, discarded)
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts:628-656,692-698` — `syncToArena` builds `newEntries` (no `persisted` field) and calls `supabase.rpc('sync_to_arena', …)`
- `evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.ts:~387-401,812-824` — article-level recombined variant ranked via `rankNewVariant`; per-slot rewrites synced via `syncToArena` with `variant_kind:'paragraph'`; slot discards use `discardReason.failurePoint ∈ {slot_budget,no_valid_rewrites,sync_failed}`
- `evolution/src/lib/schemas.ts` — `discardReason` shapes (generate: `{localElo,localTop15Cutoff}`; slot: `{failurePoint,…}`); `persisted: z.boolean().optional().default(false)`
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — non-surfaced paragraph variants are NOT pushed to `discardedVariants` (so they don't go through the persistRunResults discard upsert)
- Migrations:
  - `supabase/migrations/20260331000001_evolution_parallel_pipeline_schema.sql:19-27` — `ADD COLUMN … persisted BOOLEAN NOT NULL DEFAULT false;` + one-time backfill of pre-existing rows to true
  - `supabase/migrations/20260418000003_variants_add_agent_invocation_id.sql` — `agent_invocation_id` FK
  - `supabase/migrations/20260423081159_add_variant_surfaced_to_evolution_agent_invocations.sql` — `variant_surfaced`
  - `supabase/migrations/20260527000003_extend_sync_to_arena_for_paragraph_kind.sql` — sync_to_arena INSERT (no `persisted`)
  - `supabase/migrations/20260529000001_sync_to_arena_persist_parent_and_match_count.sql:55-92` — current sync_to_arena INSERT + ON CONFLICT (no `persisted` in either)
- Metrics filters that exclude `persisted=false`:
  - `evolution/src/lib/metrics/experimentMetrics.ts:340-346` (run Elo, `.eq('persisted',true)`), `:452-461` (attribution also `.eq('variant_kind','article')`)
  - `evolution/src/lib/metrics/recomputeMetrics.ts:152-157,278`
  - `evolution/src/lib/metrics/computations/tacticMetrics.ts:106,122` (`.not('variant_surfaced','is',false)`)
- UI surfaces keyed on `persisted`:
  - `evolution/src/components/evolution/tabs/VariantsTab.tsx:56,63,145-153,248-254` — "Include discarded variants" toggle (default off → hides paragraph variants), ✗/✓ persisted column
  - `evolution/src/components/evolution/visualizations/LineageGraph.tsx:144-152` — persisted=false → opacity 0.4 + dashed red border
  - `evolution/src/components/evolution/tabs/SnapshotsTab.tsx:19-44,81-87,190-231` — persisted column + "Discarded during iteration" table (assumes localElo/top15Cutoff)

## Key Findings
1. **The banner is gated only by `persisted === false`** and the text is hardcoded for the generate-agent path — it does not branch on `variant_kind`, `agent_name`, or the real `discardReason`. (`VariantDetailContent.tsx:111-124`)
2. **`evolution_variants.persisted` is `NOT NULL DEFAULT false`.** (`20260331000001_…:20`) New inserts that omit the column get `false`, not NULL.
3. **`sync_to_arena` (the paragraph-variant persistence path) never sets `persisted`** — not in the INSERT column list and not in `ON CONFLICT DO UPDATE` — across all three RPC migrations. (`20260527000003`, `20260529000001`)
4. **Therefore every paragraph variant lands `persisted=false`** → all show the (incorrect) "discarded by its owning generate agent" banner. This matches "variant af33e26d AND many other [variants] on invocation 1bc65fd0 have this banner" — `1bc65fd0` is almost certainly a `paragraph_recombine` invocation producing many slot variants.
5. **Article variants are unaffected** because they are written via the explicit `persistRunResults` upsert that sets `persisted` true/false correctly; the generate-agent discard banner is accurate for them.
6. **Metrics impact:** run-level Elo / recompute / tactic-cost queries filter on `persisted=true` / `variant_surfaced≠false`, so paragraph variants are currently excluded. Attribution additionally filters `variant_kind='article'`. Excluding paragraph-scale Elo from article run-metrics may be *desirable*; a fix must avoid regressing this.
7. **History:** banner added in commit `0a5be596` (Apr 8 2026, "finish parallel pipeline UI"), text "mu"→"Elo" in `17b8eeed` (Apr 13). The `persisted=false` flag and banner predate paragraph variants (`variant_kind` migration `20260527`), so paragraph variants later reused the flag with mismatched semantics — a latent regression made live once paragraph_recombine started persisting via sync_to_arena.
8. **Refutation failed:** an agent tasked to disprove the hypothesis found no trigger/backfill/ON-CONFLICT/CREATE-default that would set paragraph `persisted=true`; verdict NOT REFUTED, HIGH confidence.

## Candidate Fix Directions (to be decided in /planning — NOT yet chosen)
- **A. RPC + payload:** extend `sync_to_arena` to read `persisted` from the JSONB entry (`COALESCE((entry->>'persisted')::bool, true)`) and add `persisted: true` to `newEntries` in `persistRunResults.ts:628-656`. Risk: must reconcile with metrics filters (see F).
- **B. Banner `variant_kind`-aware:** in `VariantDetailContent.tsx:111`, suppress the generate-agent banner for `variant_kind === 'paragraph'` and/or render text from the actual `discardReason` (article vs slot failurePoint). Lowest-risk cosmetic fix; does not touch metrics.
- **C. Backfill:** one migration to correct existing rows once the intended semantics for paragraph `persisted` are decided (e.g. `UPDATE evolution_variants SET persisted=true WHERE variant_kind='paragraph' AND persisted=false`) — only if option A is chosen.
- **D. Other UI surfaces:** VariantsTab toggle/column, LineageGraph node styling, SnapshotsTab discarded section all assume `persisted=false ⇒ discarded generate variant`; update for paragraph kind.
- **E. Tests:** add `VariantDetailContent` cases for persisted=false article (banner shown) vs paragraph (banner hidden / kind-specific); confirm metrics behavior for paragraph variants.
- **F. Decide metrics intent:** should paragraph variants count in any run-level metric? Reconcile before flipping `persisted`.

## Open Questions (need confirmation before planning is final)
1. **[RESOLVED 2026-05-31 — see Staging Confirmation above]** ~~Confirm the specific data.~~ Verified on staging: variant=paragraph/persisted=false; invocation=paragraph_recombine; 758/758 paragraph variants are persisted=false (0 are true). Queries used (read-only) to verify the hypothesis on the actual rows:
   - URLs: `/admin/evolution/variants/af33e26d-fb87-479f-86b1-4593a9cd340a` and `/admin/evolution/invocations/1bc65fd0-d6fa-4d13-8afb-93cc1510a82a`
   - `npm run query:prod`:
     ```sql
     SELECT id, variant_kind, persisted, agent_name, agent_invocation_id
     FROM evolution_variants WHERE id = 'af33e26d-fb87-479f-86b1-4593a9cd340a';
     SELECT agent_name, variant_surfaced FROM evolution_agent_invocations
       WHERE id = '1bc65fd0-d6fa-4d13-8afb-93cc1510a82a';
     SELECT variant_kind, persisted, count(*) FROM evolution_variants
       WHERE agent_invocation_id = '1bc65fd0-d6fa-4d13-8afb-93cc1510a82a'
       GROUP BY 1,2;
     ```
   Expected if hypothesis holds: variant `variant_kind='paragraph'`, `persisted=false`; invocation `agent_name='paragraph_recombine'`; siblings all `paragraph/false`.
2. **Desired semantics:** what *should* `persisted` mean for paragraph variants — always true (surfaced), or a real surfaced/discarded distinction at slot level? This determines fix A vs B.
3. **Metrics:** should paragraph variants ever enter run-level metrics? If never, prefer the UI-only fix (B) and leave `persisted` semantics for paragraph as "n/a".

## Completeness Assessment
- [x] Problem clearly understood
- [x] Relevant code areas identified (banner, persistence paths, RPC, metrics, UI surfaces, migrations)
- [x] Current implementation + root cause documented with file:line evidence
- [x] Hypothesis adversarially verified (NOT REFUTED, high confidence)
- [x] Gaps catalogued (specific-row confirmation + semantics/metrics decisions)
- [x] Enough context to begin brainstorming solutions in _planning.md
