# Fixes to Evolution Admin Dashboard Plan

## Background
Four small UX/data-display issues surfaced during exploratory testing of the evolution admin dashboard. Each is independently scoped, low-risk, and contained to UI + server-action layers — no database migrations or pipeline-runtime changes required. The fixes are sequenced into three commits along file-touch boundaries to minimize merge friction.

## Requirements (from GH Issue #NNN)
- Match history is empty for variants
- Run timeline tab on run details view should:
    - List invocation agent type instead of "Generate #29"
    - Should link to the invocation detail view on click
- Variant detail view should link to invocation that produced it, somewhere
- Add more detail (including examples suggested) to eval & suggest tab for agent invocation detail view for **evaluate_criteria_then_generate_from_previous_article**

## Problem
1. **Variant Matches tab is dead code.** `getVariantMatchHistoryAction` was stubbed during the V2 redesign with the assumption that match data lived only in `run_summary` JSONB; in fact `evolution_arena_comparisons` is fully populated (8,819 rows on staging). Users see empty Matches tabs even when comparisons exist.
2. **Timeline labels obscure agent identity.** The bar label reads "Generate #29" — the kind label is too coarse to distinguish e.g. `generate_from_previous_article` vs `reflect_and_generate_from_previous_article` vs `evaluate_criteria_then_generate_from_previous_article`. The label is also non-clickable; only the bar visualization links to invocation detail.
3. **Variant → invocation lineage is invisible.** Variants carry `agent_invocation_id` (since 2026-04-18), but the variant detail page doesn't surface it. Users can't drill from a variant down to the LLM call that produced it.
4. **Eval & Suggest tab is half-blank.** The parser silently drops any suggestion whose Example/Issue/Fix line was missing or whitespace-only, and even when populated the table cells have no width constraint so long passages overflow horizontally and become unreadable.

## Options Considered

### Issue 1 — Variant match history
- [x] **Option A (chosen): Implement the stub directly using `.or('entry_a.eq.X,entry_b.eq.X')` + opponent batch-fetch.** Single file change. ~50 lines. No schema/migration. Trusted Supabase pattern (used in `VariantEntity.ts` cleanup).
- [ ] **Option B: Add `idx_arena_comparisons_entry_a` and `idx_arena_comparisons_entry_b` indexes upfront.** Defer — staging row count (~9k) makes scan fast for v1; revisit if perf regresses.
- [ ] **Option C: Aggregate from `run_summary` JSONB.** Rejected — JSONB doesn't carry per-variant opponent ratings; would need a second source-of-truth that drifts.

### Issue 2 — Timeline label
- [ ] **Option A: Keep `KIND_CONFIG.label` ("Generate"), add tooltip on label.** Doesn't satisfy the literal user ask.
- [x] **Option B (chosen): Two-line label — `agent_name` truncated on top, `#{execution_order}` below; wrap row in `<Link>`.** Satisfies "show agent type" + click-through. Fits existing `w-32` column. `title=` carries full agent_name. No e2e selector breakage.
- [ ] **Option C: Pretty-mapped names (e.g., `EvalCriteria` for `evaluate_criteria_then_generate_from_previous_article`).** Adds a mapping table to maintain — not worth it for what's already snake_case-readable.

### Issue 3 — Variant → invocation link
- [x] **Option A (chosen): Add to `EntityDetailHeader.links` as "Produced by <agent_name>"** — matches the existing `Run`/`Explanation` cross-link pattern. Fetch `agent_name` via PostgREST embedded select on `evolution_agent_invocations`. Conditional spread when `agent_invocation_id` is null.
- [ ] **Option B: Extra column on `/admin/evolution/variants` list page.** Rejected per Round 1 — clutter.
- [ ] **Option C: Surface inside lineage graph node tooltip (`VariantCard.tsx`).** Rejected — adds noise to compact tooltip.

### Issue 4 — Eval & Suggest tab
- [x] **Option A (chosen): Fix BOTH root causes.** (a) Parser regex tightened — replace permissive `\s*` with `[ \t]*` (no newline-crossing) AND change capture from `(.+?)` to `(.*?)` so empty fields don't drop the suggestion; relax line-220 null-check so only `Criterion:` is hard-required. Behind `EVOLUTION_PERMISSIVE_EVAL_PARSER` env flag (default on, kill-switch). (b) Per-field `DetailFieldDef.cellClassName` to scope `max-w-md break-words whitespace-pre-wrap` to the suggestions table only.
- [ ] **Option B: Apply table cell wrapping globally to `ConfigDrivenDetailRenderer`.** Rejected — risks regressing other agents' detail tables (Round 4).
- [ ] **Option C: Only fix the parser, ignore rendering.** Insufficient — even populated long passages overflow horizontally.
- [ ] **Option D: Backfill placeholder text into DB on parse.** Rejected — pollutes the JSONB record with synthetic data; render `—` in the UI instead.

## Phased Execution Plan

### Phase 1: Timeline label + click-through (Issue 2)

Lowest-risk, fully isolated UI change. Ship first to validate the dev workflow.

- [x] Edit `evolution/src/components/evolution/tabs/TimelineTab.tsx` `InvocationBar` (lines 133-173):
  - [x] Replace single-line label `{label} #{execution_order}` with two-line block:
    ```tsx
    <span className="block text-xs font-ui text-[var(--text-secondary)] truncate" title={inv.agent_name ?? 'Agent'}>
      {inv.agent_name ?? label}
    </span>
    {inv.execution_order != null ? (
      <span className="block text-[10px] text-[var(--text-muted)]">#{inv.execution_order}</span>
    ) : null}
    ```
  - [x] Wrap the entire row `<div className="flex items-center gap-2 py-0.5">…</div>` in `<Link href={buildInvocationUrl(inv.id)} className="block hover:opacity-80">`.
  - [x] Remove the `href` prop from `<GanttBar …/>` (avoids nested anchor warning). Keep `tooltip`.
  - [x] Verify `Link` from `next/link` is already imported at the top of the file (it is per Round 1 — line 7).
- [x] Update unit test `evolution/src/components/evolution/tabs/TimelineTab.test.tsx`:
  - [x] Add assertion: rendered row has `<a href="/admin/evolution/invocations/<id>">`.
  - [x] Add assertion: rendered label text contains `inv.agent_name` (use a real-shape fixture string like `generate_from_previous_article`, not the legacy PascalCase test data).
- [x] Run `npm run lint && npm run typecheck` to confirm no regressions.
- [x] Run `npm test -- TimelineTab` to confirm unit test pass.
- [x] Manual Playwright smoke: navigate to a run with completed invocations, hover timeline row, confirm `title=` tooltip shows agent_name, click row, confirm navigation to invocation detail.
- [x] Commit: `fix(evolution-ui): timeline rows show agent_name and link to invocation detail`.

### Phase 2: Variant detail server action — match history + producing-invocation link (Issues 1 + 3)

Both edit the same file (`evolution/src/services/variantDetailActions.ts`); shipping together avoids merge friction.

#### 2a — Implement getVariantMatchHistoryAction (Issue 1)

- [x] Replace stub at `evolution/src/services/variantDetailActions.ts:216-222`:
  ```typescript
  export const getVariantMatchHistoryAction = adminAction(
    'getVariantMatchHistoryAction',
    async (variantId: string, ctx: AdminContext): Promise<VariantMatchEntry[]> => {
      if (!validateUuid(variantId)) throw new Error('Invalid variantId');
      const { supabase } = ctx;

      const { data: comparisons, error } = await supabase
        .from('evolution_arena_comparisons')
        .select('id, entry_a, entry_b, winner, confidence, created_at')
        .or(`entry_a.eq.${variantId},entry_b.eq.${variantId}`)
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) throw error;
      if (!comparisons || comparisons.length === 0) return [];

      const opponentIds = Array.from(new Set(
        comparisons.map((c) => (c.entry_a === variantId ? c.entry_b : c.entry_a))
      ));
      const { data: opponents, error: oppError } = await supabase
        .from('evolution_variants')
        .select('id, mu, sigma, elo_score')
        .in('id', opponentIds);
      if (oppError) throw oppError;
      const oppMap = new Map((opponents ?? []).map((o) => [o.id, o]));

      return comparisons.map((c) => {
        const opponentId = c.entry_a === variantId ? c.entry_b : c.entry_a;
        const opp = oppMap.get(opponentId);
        const won =
          (c.entry_a === variantId && c.winner === 'a') ||
          (c.entry_b === variantId && c.winner === 'b');
        const rating = opp ? dbToRating(opp.mu, opp.sigma) : null;
        return {
          opponentId,
          opponentElo: opp?.elo_score ?? null,
          ...(rating ? { opponentUncertainty: rating.uncertainty } : {}),
          won,
          confidence: c.confidence,
        };
      });
    },
  );
  ```
- [x] Confirm `dbToRating` import. Per the existing imports in `variantDetailActions.ts`, the helper lives at `evolution/src/lib/shared/computeRatings.ts` (NOT `rating.ts`) and is already imported via `'../lib/shared/computeRatings'` if `liftUncertainty` is in scope; reuse that import.
- [x] Add tests in `evolution/src/services/variantDetailActions.test.ts`:
  - [x] variant with matches as entry_a (some won, some lost) → returns ordered array
  - [x] variant with matches as entry_b → `won` flag inverts correctly
  - [x] variant with zero comparison rows → returns `[]`
  - [x] opponent not in `evolution_variants` (orphaned FK) → `opponentElo: null`, no uncertainty key
  - [x] draw rows (`winner === 'draw'`) → `won: false` (never wins on a draw)

#### 2b — Add producing-invocation link (Issue 3)

- [x] Update `VariantFullDetail` interface in `evolution/src/services/variantDetailActions.ts` (~line 18-43): add
  ```typescript
  /**
   * UUID of the agent invocation that produced this variant. NULL for variants
   * created before migration 20260418000003 (no backfill). Distinct from
   * `agentName` above — for wrapper agents (reflect_and_generate,
   * evaluate_criteria_then_generate), `agentName` reflects the inner GFPA
   * tactic while `agentInvocationName` reflects the wrapper.
   */
  agentInvocationId: string | null;
  agentInvocationName: string | null;
  ```
- [x] **Audit consumers of `VariantFullDetail`** before merging — grep the codebase for `VariantFullDetail` and update any consumers whose typed fixtures or destructuring assumes the old shape:
  - [x] `evolution/src/components/evolution/sections/VariantDetailPanel.tsx` (imports the type)
  - [x] `evolution/src/components/evolution/sections/VariantDetailPanel.test.tsx` — typed `mockDetail` fixture needs the new fields.
  - [x] `src/app/admin/evolution/variants/[variantId]/VariantDetailContent.test.tsx` lines ~23-42 — existing typed `mockVariant` fixture must add `agentInvocationId: null, agentInvocationName: null` (or populated values for the link-rendering test). Without this update, TypeScript will fail on `npm run typecheck`.
  - [x] `src/app/admin/evolution/variants/[variantId]/page.test.tsx` (if present) — same fixture update.
  - [x] Any other file matching `grep -rln 'VariantFullDetail' evolution/src src/`.
- [x] Update `getVariantFullDetailAction` `.select(...)`: replace `'*'` with `'*, evolution_agent_invocations(id, agent_name)'` to embed the join. PostgREST returns `null` when `agent_invocation_id` is NULL — handle that.
- [x] In the return mapping, extract:
  ```typescript
  const inv = Array.isArray(variant.evolution_agent_invocations)
    ? variant.evolution_agent_invocations[0]
    : variant.evolution_agent_invocations;
  // …
  agentInvocationId: inv?.id ?? null,
  agentInvocationName: inv?.agent_name ?? null,
  ```
- [x] Edit `src/app/admin/evolution/variants/[variantId]/VariantDetailContent.tsx` lines 62-78. Add a third conditional cross-link to `EntityDetailHeader.links`:
  ```tsx
  ...(variant.agentInvocationId
    ? [{
        prefix: 'Produced by',
        label: variant.agentInvocationName ?? variant.agentInvocationId.slice(0, 8),
        href: `/admin/evolution/invocations/${variant.agentInvocationId}`,
      }]
    : []),
  ```
- [x] Add tests:
  - [x] `evolution/src/services/variantDetailActions.test.ts`: variant with agent_invocation_id populated → response includes `agentInvocationName`; null FK → both fields `null`.
  - [x] `src/app/admin/evolution/variants/[variantId]/VariantDetailContent.test.tsx` (if present, else new): renders "Produced by" link with correct href when `agentInvocationId` set; omits link when null.
- [x] Run `npm run lint && npm run typecheck`.
- [x] Run `npm test -- variantDetail` to confirm action + component tests pass.
- [x] Manual Playwright smoke: navigate to known staging variant `1e1bee71-…` (379 matches per Round 4); confirm Matches tab populates with rows; confirm header shows "Produced by <agent_name>" link; click link to confirm navigation.
- [x] Commit: `fix(evolution-ui): populate variant Matches tab and link variant detail to producing invocation`.

### Phase 3: Eval & Suggest tab — parser fallback + cell wrapping (Issue 4)

- [x] **Parser fix** in `evolution/src/lib/core/agents/evaluateCriteriaThenGenerateFromPreviousArticle.ts` (around lines 216-238):
  - [x] Tighten regex: replace permissive `\s*` (which matches newlines under the `m` flag) with `[ \t]*` so the capture group cannot span across lines. Replace `(.+?)` with `(.*?)` so empty captures match. Anchor the trailing whitespace to the EOL via `[ \t]*$`:
    ```typescript
    const criterionLine = body.match(/^Criterion:[ \t]*(.*?)[ \t]*$/m);
    const exampleLine   = body.match(/^Example:[ \t]*(.*?)[ \t]*$/m);
    const issueLine     = body.match(/^Issue:[ \t]*(.*?)[ \t]*$/m);
    const fixLine       = body.match(/^Fix:[ \t]*(.*?)[ \t]*$/m);
    ```
    Rationale: prevents degenerate inputs like `Example:\n\nIssue: foo` from capturing `examplePassage = '\n\nIssue: foo'` (i.e. the next field's content). `m` flag is preserved so `^`/`$` still anchor at line boundaries.
  - [x] **Relax the line-220 null-check** so only `Criterion:` is hard-required. Currently the existing `if (!criterionLine || !exampleLine || !issueLine || !fixLine) continue;` drops the suggestion if ANY of the four lines is completely missing — which is the dominant cause of empty-suggestions arrays on staging (per Round 4 query). Change to:
    ```typescript
    if (!criterionLine) continue;  // criterion is the only mandatory field
    ```
  - [x] Suggestion push uses `?.[1]?.trim() ?? ''` to land empty strings on missing/empty fields, never throw:
    ```typescript
    suggestions.push({
      criteriaName: criterionLine[1].trim(),
      examplePassage:       exampleLine?.[1]?.trim() ?? '',
      whatNeedsAddressing:  issueLine?.[1]?.trim()   ?? '',
      suggestedFix:         fixLine?.[1]?.trim()     ?? '',
    });
    ```
- [x] **Kill-switch** for the parser change. Add env flag `EVOLUTION_PERMISSIVE_EVAL_PARSER` (default `'true'`) at the top of the parser:
  ```typescript
  const PERMISSIVE = process.env.EVOLUTION_PERMISSIVE_EVAL_PARSER !== 'false';
  ```
  When `PERMISSIVE === false`, fall through to the original strict null-check (`!criterionLine || !exampleLine || !issueLine || !fixLine`). Document the flag in `evolution/docs/reference.md` Kill Switches section. This is a single env-flip rollback if the relaxed parser ever over-matches in production.
- [x] **Schema check** in `evolution/src/lib/schemas.ts` (around lines 1344-1349): the `suggestions` element schema already uses bare `z.string()` (no `.min(1)`) per Round 1 verification — empty strings already pass validation. **No change required**; just verify by reading the current schema and confirm. Add a comment noting why empty strings are allowed (parser fallback path).
- [x] **Add `cellClassName` to DetailFieldDef** in `evolution/src/lib/core/types.ts` (around lines 199-218):
  ```typescript
  cellClassName?: string;
  ```
- [x] **Update `renderTable`** in `src/app/admin/evolution/invocations/[invocationId]/ConfigDrivenDetailRenderer.tsx`:
  - [x] Accept third optional arg `cellClassName?: string`.
  - [x] Use it on the `<td>` element when provided; default to current `"py-1.5 px-2 text-[var(--text-primary)]"` when undefined.
  - [x] Update the `case 'table':` branch to pass `field.cellClassName` to `renderTable(value, field.columns ?? [], field.cellClassName)`.
  - [x] Add a small helper `renderCell(value)` that maps `value === '' || value === null || value === undefined` → `'—'` so empty parser fields display nicely.
- [x] **Update detailViewConfigs.ts** entry for `evaluate_criteria_then_generate_from_previous_article` (lines ~143-150). Add `cellClassName` to the suggestions table:
  ```typescript
  {
    key: 'evaluateAndSuggest.suggestions',
    label: 'Suggestions',
    type: 'table',
    cellClassName: 'max-w-md break-words whitespace-pre-wrap py-1.5 px-2 text-[var(--text-primary)] align-top',
    columns: [
      { key: 'criteriaName',          label: 'Criterion' },
      { key: 'examplePassage',        label: 'Example' },
      { key: 'whatNeedsAddressing',   label: 'Issue' },
      { key: 'suggestedFix',          label: 'Fix' },
    ],
  },
  ```
- [x] **Optional**: also add a `cellClassName: 'max-w-md break-words …'` to the existing `criteriaScored` table in the same config — long criterion descriptions may want the same treatment.
- [x] Add tests:
  - [x] Parser unit test (find/create test alongside the agent file): payload with `Example:` line empty → suggestion still emitted with `examplePassage: ''`.
  - [x] Parser unit test: payload with `Example:` line whitespace-only → emitted with empty string after trim.
  - [x] Parser unit test: payload **completely missing `Example:` line** (and `Issue:`, `Fix:`) → suggestion still emitted with empty strings for those fields (post-line-220 fix).
  - [x] Parser unit test (regex backtracking guard): payload `Criterion: clarity\nExample:\n\nIssue: real issue text\nFix: real fix text` → `examplePassage === ''` AND `whatNeedsAddressing === 'real issue text'` (NOT `'\n\nIssue: real issue text'`). This is the regression guard for the multiline backtracking risk.
  - [x] Parser unit test: payload missing `Criterion:` line → suggestion dropped (regression guard — only criterion is hard-required).
  - [x] Parser unit test: `EVOLUTION_PERMISSIVE_EVAL_PARSER=false` env → strict null-check restored; empty-line input drops suggestions (kill-switch verification).
  - [x] `ConfigDrivenDetailRenderer.test.tsx`: `<td>` with `cellClassName` prop is applied; without prop falls back to default class.
  - [x] `ConfigDrivenDetailRenderer.test.tsx`: empty-string cell value renders as `—` (note: existing `formatValue` already handles null/undefined → `—`; only empty-string is novel).
- [x] Run `npm run lint && npm run typecheck`.
- [x] Run `npm test -- ConfigDrivenDetailRenderer evaluateCriteria`.
- [x] Manual Playwright smoke: navigate to a `evaluate_criteria_then_generate_from_previous_article` invocation detail; click Eval & Suggest tab; confirm suggestions table renders with bounded column widths; confirm long passages wrap rather than horizontally overflow; confirm any rows with empty fields show `—`.
- [x] Commit: `fix(evolution-ui): preserve partial suggestions and wrap long Eval&Suggest cells`.

### Phase 4: Documentation updates

- [x] `evolution/docs/visualization.md` — Variant detail Matches tab description (around line 25): clarify the tab is now wired through `getVariantMatchHistoryAction` against `evolution_arena_comparisons` (was: stubbed).
- [x] `evolution/docs/visualization.md` — Variant detail header description: add "Produced by <agent_name>" link via `EntityDetailHeader.links` slot.
- [x] `evolution/docs/visualization.md` — Run Timeline tab section: note the row label now shows `agent_name`/`#execution_order` and the entire row is a `<Link>` to `/admin/evolution/invocations/[id]`.
- [x] `evolution/docs/visualization.md` — Invocation detail Eval & Suggest tab: note empty Example/Issue/Fix render as `—`; per-field `cellClassName` constrains the suggestions table.
- [x] `evolution/docs/agents/overview.md` — `EvaluateCriteriaThenGenerateFromPreviousArticleAgent` parser section (~lines 411-421): note the parser now tolerates empty Example/Issue/Fix lines; only `Criterion:` is hard-required.
- [x] `evolution/docs/reference.md` — Services table entry for `variantDetailActions.ts` (line 98): note `getVariantMatchHistoryAction` now implemented; note `getVariantFullDetailAction` joins `evolution_agent_invocations` for `agent_name`.
- [x] `evolution/docs/reference.md` — **Kill Switches / Feature Flags table**: add new row for `EVOLUTION_PERMISSIVE_EVAL_PARSER` (default `'true'`), describing that flipping to `'false'` reverts the parser to strict mode (drops suggestions when any of Example/Issue/Fix lines are missing) — single-env-flip rollback if the relaxed parser ever over-matches in production.
- [x] `evolution/src/lib/core/types.ts` — JSDoc on `DetailFieldDef.cellClassName` describing scope (per-field, no global cascade).
- [x] No changes needed to `evolution/docs/data_model.md` — schema is unchanged.

## Testing

### Unit Tests
- [x] `evolution/src/services/variantDetailActions.test.ts`:
  - [x] `getVariantMatchHistoryAction` — variant on entry_a, on entry_b, with no rows, with orphan opponent, with draw row
  - [x] `getVariantFullDetailAction` — agent_invocation_id populated path returns `agentInvocationName`; null path returns `null` for both fields
- [x] `evolution/src/components/evolution/tabs/TimelineTab.test.tsx`:
  - [x] Row text includes `agent_name`; row is wrapped in `<a href=…>`
- [x] `evolution/src/components/evolution/sections/EntityDetailHeader.test.tsx`:
  - [x] Renders an "Invocation" link slot when provided alongside Run + Explanation
- [x] `src/app/admin/evolution/variants/[variantId]/VariantDetailContent.test.tsx` (new file if not present):
  - [x] Header renders "Produced by <agent_name>" link when `agentInvocationId` set
  - [x] Header omits the link when `agentInvocationId === null`
- [x] `src/app/admin/evolution/invocations/[invocationId]/ConfigDrivenDetailRenderer.test.tsx`:
  - [x] `<td>` uses `field.cellClassName` when provided; default class otherwise
  - [x] Empty cell value renders as `—`
- [x] Parser test for `evaluateCriteriaThenGenerateFromPreviousArticle.ts`:
  - [x] Empty Example field → suggestion emitted with `examplePassage: ''`
  - [x] Whitespace-only Example field → emitted with empty string post-trim
  - [x] Missing Criterion field → suggestion dropped (regression guard)

### Integration Tests
- [x] `src/__tests__/integration/evolution-visualization.integration.test.ts` (extend if exists, else add):
  - [x] Seed a real run with at least 5 variants and several `evolution_arena_comparisons` rows; call `getVariantMatchHistoryAction`; assert returned array length and `won` correctness across both entry_a and entry_b sides.

### E2E Tests
- [x] Update `src/__tests__/e2e/specs/09-admin/admin-evolution-variants.spec.ts`:
  - [x] Navigate to a seeded variant detail; click Matches tab; assert at least one match row visible; assert win/loss counts in summary.
  - [x] Assert "Produced by <agent_name>" link visible in header; click → lands on `/admin/evolution/invocations/<id>`.
- [x] Update `src/__tests__/e2e/specs/09-admin/admin-evolution-run-pipeline.spec.ts`:
  - [x] After run completes and Timeline tab is visible, click an invocation row; assert navigation to `/admin/evolution/invocations/<id>`.
  - [x] Assert label text contains the agent_name (e.g. `toContain('generate_from_previous_article')`).
- [x] Update `src/__tests__/e2e/specs/09-admin/admin-evolution-invocation-detail.spec.ts`:
  - [x] Navigate to a seeded `evaluate_criteria_then_generate_from_previous_article` invocation detail; click Eval & Suggest tab; assert Suggestions table renders ≥1 row with all 4 columns; assert any empty field renders as `—`.

### Manual Verification
*Requires a human + dev server pointed at staging seeded data. Equivalent automated coverage: the new E2E specs in `admin-evolution-variants.spec.ts`, `admin-evolution-run-pipeline.spec.ts`, and `admin-evolution-invocation-detail.spec.ts` exercise the same flows against test-seeded data.*
- [ ] On staging (`npm run query:staging`-style read-only checks), pick a variant with high match count (e.g. `1e1bee71-…`, 379 matches per Round 4); confirm the new Matches tab shows ≥1 row.
- [ ] Pick an `evaluate_criteria_then_generate_from_previous_article` invocation (98 on staging per Round 4); confirm Eval & Suggest tab renders; long Example passages wrap inside the column.
- [ ] Navigate Run → Timeline; confirm row labels show full agent_name; click any row to confirm invocation drill-in.
- [ ] Variant detail → confirm "Produced by …" link appears for variants created after 2026-04-18; gracefully absent for older ones.

### Regression Guards (anti-bug-recurrence)
These are tests targeted at the *class* of bug each issue represents — designed to fail loudly if the same class returns later (e.g. via accidental stub, parser regression, schema/UI drift, or silent data dropping).

#### Guard A — "Server actions must not silently stub-out data layers" (Issue 1 class)
- [x] **Integration test** — first verify the file `src/__tests__/integration/evolution-visualization.integration.test.ts` exists. If it doesn't, **create it** in this PR (don't defer to "if exists, else add"). Skeleton:
  - Use `getEvolutionServiceClient()` + `createTestRun()`/`createTestVariant()`/`createTestArenaComparison()` from `src/__tests__/e2e/helpers/evolution-test-data-factory.ts` so rows are `[TEST_EVO]`-tagged for cleanup.
  - `afterAll` MUST call `cleanupAllTrackedEvolutionData()` (per testing_setup.md cleanup-enforcement rule).
  - Seed a run with ≥3 variants and ≥5 `evolution_arena_comparisons` rows referencing those variants (mix of `entry_a` and `entry_b` perspectives, including ≥1 draw row).
  - Call `getVariantMatchHistoryAction(variantId)` for a variant with confirmed comparisons.
  - **Assert the returned array length matches the SQL count** of comparisons where `entry_a = variantId OR entry_b = variantId`. A future refactor that re-stubs the action will fail this assertion.
  - Run via `npm run test:integration -- evolution-visualization` (NOT just `npm run test:integration`, which is the non-evolution suite per testing_setup.md).
- [x] **Unit test (anti-stub call-site guard)** in `evolution/src/services/variantDetailActions.test.ts`:
  - [x] Mock supabase to return 3 comparison rows; assert the action returns 3 entries (not 0).
  - [x] **Additionally assert the supabase chain was actually invoked** with the expected table + filter:
    ```typescript
    expect(mockSupabase.from).toHaveBeenCalledWith('evolution_arena_comparisons');
    expect(mockOrFn).toHaveBeenCalledWith(
      expect.stringMatching(/entry_a\.eq\.[0-9a-f-]+,entry_b\.eq\.[0-9a-f-]+/)
    );
    ```
    This catches the case where someone replaces the implementation with `return []` — the unit-mock-returns-3 test alone wouldn't fail (the chain isn't exercised), but the call-site assertion does.

#### Guard B — "Visible UI must reflect typed agent identity, not coarse buckets" (Issue 2 class)
- [x] **Unit test** in `evolution/src/components/evolution/tabs/TimelineTab.test.tsx`:
  - [x] Render `InvocationBar` with `agent_name = 'evaluate_criteria_then_generate_from_previous_article'`.
  - [x] Assert the rendered DOM contains the **full agent_name string** (or its truncated prefix in the `title=` attribute).
  - [x] Assert the row's wrapping `<a>` has `href` matching `/admin/evolution/invocations/<id>`.
  - [x] **Nested-anchor guard** — root the assertion on the row's `data-testid="timeline-inv-${inv.id}"` element:
    ```typescript
    const row = screen.getByTestId(`timeline-inv-${inv.id}`);
    // The row itself or its closest ancestor is the single <a>:
    expect(row.closest('a')).not.toBeNull();
    // No nested <a> within the row (would cause React hydration warning + broken click bubbling):
    expect(row.querySelectorAll('a')).toHaveLength(0);
    ```
- [x] **Update existing fixtures** in `TimelineTab.test.tsx` that use PascalCase agent_name (`'GenerateFromPreviousArticleAgent'`, `'MergeRatingsAgent'`) — replace with snake_case real values (`'generate_from_previous_article'`, `'merge_ratings'`) so label assertions don't pattern-mismatch silently.

#### Guard C — "Parsers must preserve count under partial input" (Issue 4a class)
- [x] **Unit test** for `parseEvaluateAndSuggest` (next to the agent file):
  - [x] Build a fixture with 3 suggestion blocks where block 2 has an **empty** `Example:` line and block 3 has a **whitespace-only** `Example:` line.
  - [x] Assert the parser returns **3 suggestions** (not 1). The bug shipped because the regex `(.+?)` silently dropped suggestions to 1; this test fails if `(.+?)` ever returns.
  - [x] Assert empty fields land as `''` (not omitted, not `undefined`) so the schema still parses.
  - [x] Negative case: missing `Criterion:` line still drops the suggestion (we don't want to over-correct and accept criterion-less suggestions).

#### Guard D — "Schema fields surfaced to users must be wired to the UI" (Issue 4b class)
*Deferred per plan — best-effort, follow-up project. Not blocking.*
- [ ] **Static parity test** in `evolution/src/lib/core/detailViewConfigs.test.ts` (new file if not present):
  - [ ] For each `'table'`-type `DetailFieldDef` in `DETAIL_VIEW_CONFIGS`, assert every `column.key` references a real field in the corresponding Zod schema (e.g. `evaluateAndSuggest.suggestions[]` schema must define `criteriaName`, `examplePassage`, `whatNeedsAddressing`, `suggestedFix`).
  - [ ] Conversely (best-effort): warn if a Zod schema field is NOT referenced by any UI config — flags new schema fields silently invisible to operators.
  - [ ] This protects against the next "we extended the LLM output but forgot the renderer" silent-data-loss bug.

#### Guard E — "Detail page lineage cross-links must round-trip" (Issue 3 class)
- [x] **E2E test** in `src/__tests__/e2e/specs/09-admin/admin-evolution-variants.spec.ts`:
  - [x] After landing on a seeded variant detail page, locate the "Produced by" link.
  - [x] Click → assert URL becomes `/admin/evolution/invocations/<expected-id>` AND the loaded invocation detail's variants list includes the original variant. This verifies the round-trip integrity (variant→invocation→variant) — protects against a future refactor that puts a wrong ID into the link.
  - [x] Use `evolution-test-data-factory` (`createTestVariant` with `agent_invocation_id` set) — do NOT hand-roll inline `sb.from('evolution_variants').insert(...)` so rows get `[TEST_EVO]` cleanup tracking.
- [x] **Unit test** in `evolution/src/services/variantDetailActions.test.ts`:
  - [x] Assert `getVariantFullDetailAction` ALWAYS includes `agentInvocationId` and `agentInvocationName` keys in its response (with `null` value when absent). Defensive against future field-removal that would silently break the conditional spread in `VariantDetailContent.tsx`.

#### Guard F — "Code comments and docs must not lie about data layer state" (Issue 1 class — root cause was a stale comment)
The original Issue 1 root cause was a stale code comment in `getVariantMatchHistoryAction` claiming "match history not persisted per-variant — aggregated in run_summary JSONB" — when in fact `evolution_arena_comparisons` was the source of truth. Defend against this class:
- [x] **Lint-style grep test** in `evolution/src/services/variantDetailActions.test.ts` (or a new `evolution/src/services/variantDetailActions.docparity.test.ts`):
  - [x] Read the source of `variantDetailActions.ts` as a string at test time (`fs.readFileSync`).
  - [x] Assert it does NOT contain the stale-claim substrings: `"match history not persisted"` or `"aggregated in run_summary"`. A future refactor that re-introduces the stub-with-stale-comment fails this test loudly.
- [x] **Doc-parity smoke** in `evolution/docs/visualization.md` — after Phase 4 doc updates land, no automated test, but pre-merge checklist: grep visualization.md for `"stub"`, `"not yet implemented"`, or `"placeholder"` near the Variant detail section; resolve any hits.

## Verification

### A) Playwright Verification (required for UI changes)
- [x] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-variants.spec.ts` — passes including new Matches tab + Produced by assertions
- [x] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-run-pipeline.spec.ts` — passes including new Timeline label + click assertions
- [x] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-invocation-detail.spec.ts` — passes including new Eval & Suggest assertions
- [ ] Headed Playwright MCP smoke run against local dev server, single pass through each affected page (manual; equivalent automated coverage in the new E2E specs above)

### B) Automated Tests
- [x] `npm run lint` — clean
- [x] `npm run typecheck` — clean (note: `VariantFullDetail` shape change may surface stale type imports in any out-of-tree consumers)
- [x] `npm run build` — clean
- [x] `npm test -- variantDetailActions TimelineTab EntityDetailHeader ConfigDrivenDetailRenderer evaluateCriteria` — all pass
- [x] `npm run test:integration -- evolution-visualization` — passes (evolution-specific integration suite per testing_setup.md; NOT the non-evolution suite)
- [x] `npm run check:stale-specs` — clean (per testing_overview.md Rule 19; verifies E2E spec testid usage matches DOM after TimelineTab/EntityDetailHeader changes)
- [x] Grep `evolution/src/services/variantDetailActions.ts` for `"not persisted"` or `"run_summary JSONB"` — no hits (Guard F regression check; ensures the stale stub comment didn't survive the rewrite)

## Documentation Updates
- [x] `evolution/docs/visualization.md` — Matches tab now populated; Variant header has Produced-by link; Timeline row labels + click target; Eval & Suggest empty-cell rendering
- [x] `evolution/docs/agents/overview.md` — `evaluate_criteria_then_generate_from_previous_article` parser tolerates empty Example/Issue/Fix
- [x] `evolution/docs/reference.md` — `getVariantMatchHistoryAction` implemented; `getVariantFullDetailAction` JOIN noted
- [x] `evolution/src/lib/core/types.ts` — `DetailFieldDef.cellClassName` JSDoc

## Review & Discussion

### Iteration 1 (Security 4/5, Architecture 4/5, Testing 3/5 — 8 critical gaps)
- **Security**: parser regex `(.+?)` → `(.*?)` does NOT prevent multiline backtracking under `\s*$/m` — degenerate inputs like `Example:\n\nIssue: foo` could capture `examplePassage = '\n\nIssue: foo'`. Need `[ \t]*` and explicit fixture.
- **Architecture**: (a) `VariantDetailPanel.tsx` is a second consumer of `VariantFullDetail` not listed in the consumers audit. (b) Parser fix is incomplete — line-220 null-check `if (!criterionLine || !exampleLine || !issueLine || !fixLine) continue;` still drops suggestions whose lines are *completely missing* (the dominant staging failure mode); regex change alone only rescues "present-but-empty" lines.
- **Testing**: (a) Existing typed `VariantFullDetail` fixture in `VariantDetailContent.test.tsx` will fail TypeScript when interface widens — plan didn't list updating it. (b) Original Issue-1 root cause was a stale code comment claiming match data wasn't persisted; no automated check exists to prevent recurrence. (c) Guard A's "mock returns 3 → assert returns 3" doesn't catch a re-stub regression — the chain isn't exercised. (d) Integration test file referenced is treated as runnable but may not exist on disk. (e) Parser regex change is a runtime behavior shift in production-ingest with no kill-switch.

### Iteration 2 (Security 5/5, Architecture 5/5, Testing 5/5 — CONSENSUS)
All 8 critical gaps resolved:
- Parser regex tightened to `[ \t]*` (intra-line only), trailing whitespace anchored to `[ \t]*$`. Backtracking-prevention fixture added.
- Line-220 null-check relaxed to `if (!criterionLine) continue;`. Suggestion push uses `?.[1]?.trim() ?? ''`.
- `EVOLUTION_PERMISSIVE_EVAL_PARSER` env flag (default `'true'`) added as kill-switch; documented in `evolution/docs/reference.md`; dedicated unit test verifies the strict-mode rollback path.
- Phase 2b "Audit consumers" sub-checklist names every typed-fixture consumer (`VariantDetailPanel.tsx`, `VariantDetailPanel.test.tsx`, `VariantDetailContent.test.tsx`, `page.test.tsx`) plus a `grep` catch-all.
- Guard A unit test now asserts `mockSupabase.from('evolution_arena_comparisons')` was called AND `.or(...)` chain was invoked with regex-matched filter pattern — true bug-class guard.
- Guard A integration test file is mandatory-create-in-this-PR; uses `evolution-test-data-factory` (`createTestRun`, `createTestVariant`, `createTestArenaComparison`) with required `cleanupAllTrackedEvolutionData` afterAll.
- Guard F (new): lint-style grep test in `variantDetailActions.test.ts` reads source at runtime and asserts absence of stale-claim substrings (`"match history not persisted"`, `"aggregated in run_summary"`).
- TimelineTab fixtures explicitly migrate from PascalCase to snake_case agent_name strings.
- Verification adds `npm run check:stale-specs` and the evolution-specific integration command (`npm run test:integration -- evolution-visualization`).

### Remaining Minor Polish (non-blocking; address during execution)
- CRLF defensive char-class `[ \t\r]*` for Windows-origin LLM outputs (defense-in-depth).
- Kill-switch unit test should use `vi.stubEnv` to avoid `process.env` mutation pollution between tests.
- Guard D static-parity test inverse direction is "best-effort" — accept as warn-only for v1, harden later.
- Embedded-select unit test should assert the JOIN actually populates on a known-good fixture (FK-discovery smoke).
- One-line UUID-injection-safe comment in the `.or()` call site for future maintainers.
