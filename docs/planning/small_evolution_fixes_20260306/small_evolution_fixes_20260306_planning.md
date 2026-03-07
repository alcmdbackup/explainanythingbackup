# Small Evolution Fixes Plan

## Background
Have a few small fixes I want to make for evolution.

## Requirements (from GH Issue #655)
- [ ]  Run detail page: prompt and experiment badges should show names (not just "Prompt"/"Experiment"), and strategy badge should be labeled "Strategy:"
- [ ]  Arena page bugs
    - [ ]  Leaderboard should show experiment and strategy for a given variant
    - [ ]  Elo sometimes sits outside confidence intervals - **1547 vs.** 1633–1956
    - [ ]  Chart on cost vs. rating tab seems buggy - should be scatter plot, don't understand it
    - [ ]  Cost on leaderboard is wrong - it disagrees with cost from run

## Problem
The evolution run detail page shows prompt and experiment as generic "Prompt" / "Experiment" link badges with no names, making it hard to know which prompt or experiment a run belongs to without clicking through. The strategy badge shows its label but has no "Strategy:" prefix for clarity. The arena leaderboard has several data display issues: Elo ratings can fall outside their own confidence intervals due to a math mismatch (ordinal uses 3-sigma vs CI using 1.96-sigma), cost values disagree with run costs because arena stores per-entry cost shares rather than full run cost, the leaderboard doesn't show which strategy or experiment produced each entry, and the scatter chart tooltip lacks entry context.

## Options Considered

### Elo/CI Fix
- **Option A (chosen)**: Display `ordinalToEloScale(mu)` as the point estimate for display; keep ordinal for sort order only. This puts the point estimate at the center of the CI, which is semantically correct.
- **Option B**: Widen CI to 3-sigma to match ordinal. Makes CI too wide (~99.7%) and less useful.
- **Option C**: Document the inconsistency. Poor UX — users expect point estimate inside its own CI.

### Arena Cost Fix
- **Option A (chosen)**: Join through `evolution_run_id` to `evolution_runs.total_cost_usd` for the leaderboard display. This shows the full run cost, matching what the run detail page shows.
- **Option B**: Keep per-entry cost but label it. Confusing since it wouldn't match the run.

### Leaderboard Strategy/Experiment
- **Option A (chosen)**: Extend `getArenaLeaderboardAction` to join `evolution_arena_entries` → `evolution_runs` to get `strategy_config_id` and `experiment_id`, then do a second batch query to `evolution_strategy_configs` and `evolution_experiments` for names. Display in the Source column alongside Run/Variant links.
- **Option B**: Only show in expanded detail view. Less discoverable.

## Phased Execution Plan

### Phase 1: Run detail page — named badges
**Files modified:**
- `src/app/admin/evolution/runs/[runId]/page.tsx`

**Changes:**
1. Add state for prompt name and experiment name:
   ```typescript
   const [promptName, setPromptName] = useState<string | null>(null);
   const [experimentName, setExperimentName] = useState<string | null>(null);
   ```

2. Add useEffects to fetch names (same pattern as existing strategy fetch at line 61-66):
   ```typescript
   // Fetch prompt title
   useEffect(() => {
     if (!run?.prompt_id) return;
     // Lightweight: query evolution_arena_topics for just the title
     getPromptTitleAction(run.prompt_id).then(res => {
       if (res.success && res.data) setPromptName(res.data);
     });
   }, [run?.prompt_id]);

   // Fetch experiment name
   useEffect(() => {
     if (!run?.experiment_id) return;
     getExperimentNameAction(run.experiment_id).then(res => {
       if (res.success && res.data) setExperimentName(res.data);
     });
   }, [run?.experiment_id]);
   ```

3. Add two lightweight server actions following the mandatory codebase pattern (`withLogging` + `requireAdmin` + `validateUuid` + `serverReadRequestId`). Both return `ActionResult<string>`.

   **Note on `validateUuid`**: This is a local function duplicated in `arenaActions.ts` (line 36) and `evolutionVisualizationActions.ts` (line 245). For the new actions, copy the exact pattern from those files (using `UUID_REGEX` const and matching error message format):
   ```typescript
   const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
   function validateUuid(id: string, label: string): void {
     if (!UUID_REGEX.test(id)) throw new Error(`Invalid ${label} format: ${id}`);
   }
   ```

   In `promptRegistryActions.ts`:
   ```typescript
   const _getPromptTitleAction = withLogging(async (
     promptId: string,
   ): Promise<ActionResult<string>> => {
     await requireAdmin();
     validateUuid(promptId, 'prompt ID');
     const supabase = await createSupabaseServiceClient();
     const { data, error } = await supabase
       .from('evolution_arena_topics')
       .select('title')
       .eq('id', promptId)
       .is('deleted_at', null)
       .single();
     if (error) throw error;
     return { success: true, data: data.title, error: null };
   }, 'getPromptTitleAction');
   export const getPromptTitleAction = serverReadRequestId(_getPromptTitleAction);
   ```

   In `experimentActions.ts`:
   ```typescript
   const _getExperimentNameAction = withLogging(async (
     experimentId: string,
   ): Promise<ActionResult<string>> => {
     await requireAdmin();
     validateUuid(experimentId, 'experiment ID');
     const supabase = await createSupabaseServiceClient();
     const { data, error } = await supabase
       .from('evolution_experiments')
       .select('name')
       .eq('id', experimentId)
       .single();
     if (error) throw error;
     return { success: true, data: data.name, error: null };
   }, 'getExperimentNameAction');
   export const getExperimentNameAction = serverReadRequestId(_getExperimentNameAction);
   ```

   Note: These return `ActionResult<string>` (plain string), not `ActionResult<PromptMetadata>`. This is intentional — they are lightweight name-lookup actions, not full CRUD actions. The `.then()` calls on the client side silently swallow errors by design (badge falls back to truncated UUID).

4. Move all three context badges (experiment, prompt, strategy) into a group below the title, above the run ID. Order: Experiment → Prompt → Strategy. Move strategy out of the status row.
   ```tsx
   {/* Context badges — below title, above run ID */}
   <div className="flex flex-wrap items-center gap-2 mt-1">
     {run.experiment_id && (
       <Link href={buildExperimentUrl(run.experiment_id)} className="...">
         Experiment: {experimentName ?? run.experiment_id.substring(0, 8)}
       </Link>
     )}
     {run.prompt_id && (
       <Link href={buildArenaTopicUrl(run.prompt_id)} className="...">
         Prompt: {promptName ?? run.prompt_id.substring(0, 8)}
       </Link>
     )}
     {strategy && run.strategy_config_id && (
       <Link href={buildStrategyUrl(run.strategy_config_id)} className="...">
         Strategy: {strategy.label}
       </Link>
     )}
   </div>
   ```

5. Remove strategy badge from the status row (line 216-224) since it moves up.

6. Pass `promptName` and `experimentName` through `RunDetailContentProps`.

**Wireframe (post-fix):**
```
Run a1b2c3d4     Explanation #42

┌─────────────────────────────────┐ ┌───────────────────────────┐
│ Experiment: Model Comparison v2 │ │ Prompt: Quantum Computing │
└─────────────────────────────────┘ └───────────────────────────┘
┌────────────────────────────────────────────────────────────┐
│ Strategy: Gen: ds-chat | Judge: 4.1-nano | 3 iters         │
└────────────────────────────────────────────────────────────┘

a1b2c3d4-5678-9abc-def0-123456789abc  Copy

● Running   COMPETITION 8/15   ████░░░░ 62%   ~4m remaining  ↻
```

### Phase 2: Fix Elo/CI math bug
**Files modified:**
- `evolution/src/services/arenaActions.ts` — `getArenaLeaderboardAction` (line 328)
- `evolution/src/services/arenaActions.ts` — `ArenaEloEntry` interface (add `display_elo` field)
- `src/app/admin/evolution/arena/[topicId]/page.tsx` — leaderboard Rating column (line 798)

**Changes:**
1. In `getArenaLeaderboardAction` (line 322-337), add a `display_elo` field computed from `mu`:
   ```typescript
   display_elo: ordinalToEloScale(r.mu),
   ```
   Keep `elo_rating` unchanged (backward compat, used for DB/sort).

2. Add `display_elo: number` to `ArenaEloEntry` interface with doc comment:
   ```typescript
   /** Point estimate for display: ordinalToEloScale(mu). Always inside CI bounds. */
   display_elo: number;
   ```

3. In the leaderboard UI (line 798), display `display_elo` instead of `elo_rating`:
   ```tsx
   <div className="font-semibold">{entry.display_elo.toFixed(0)}</div>
   ```

4. Update scatter chart data (line ~655) to use `display_elo` for the Y axis.

5. Keep leaderboard sort order unchanged (server sorts by `ordinal DESC`).

### Phase 3: Fix arena cost — show run cost
**Files modified:**
- `evolution/src/services/arenaActions.ts` — `getArenaLeaderboardAction`
- `evolution/src/services/arenaActions.ts` — `ArenaEloEntry` interface

**Changes:**
0. In `getArenaLeaderboardAction`, update the entries select clause (line 310) to include `evolution_run_id`:
   ```typescript
   // Before: 'id, generation_method, model, total_cost_usd, created_at'
   // After:
   'id, generation_method, model, total_cost_usd, created_at, evolution_run_id'
   ```

1. In `getArenaLeaderboardAction`, after fetching entries, batch-fetch linked runs:
   ```typescript
   // Collect evolution_run_ids from entries
   const runIds = [...new Set(
     (entries ?? []).filter(e => e.evolution_run_id).map(e => e.evolution_run_id!)
   )];
   const runMap = new Map<string, { total_cost_usd: number; strategy_config_id: string | null; experiment_id: string | null }>();
   if (runIds.length > 0) {
     const { data: runs, error: runsError } = await supabase
       .from('evolution_runs')
       .select('id, total_cost_usd, strategy_config_id, experiment_id')
       .in('id', runIds);
     if (runsError) throw runsError;
     (runs ?? []).forEach(r => runMap.set(r.id, r));
   }
   ```

2. Add `run_cost_usd` to the returned leaderboard entry:
   ```typescript
   run_cost_usd: fullEntry?.evolution_run_id
     ? runMap.get(fullEntry.evolution_run_id)?.total_cost_usd ?? null
     : null,
   ```

3. Add `run_cost_usd: number | null` to `ArenaEloEntry` interface.

4. In leaderboard UI Cost column, show `run_cost_usd` when available (with a tooltip showing "Run cost" vs "Entry cost"):
   ```tsx
   {entry.run_cost_usd !== null ? formatCost(entry.run_cost_usd) : formatCost(entry.total_cost_usd)}
   ```

### Phase 4: Leaderboard — show strategy/experiment
**Files modified:**
- `evolution/src/services/arenaActions.ts` — `getArenaLeaderboardAction`, `ArenaEloEntry`
- `src/app/admin/evolution/arena/[topicId]/page.tsx` — leaderboard Source column

**Changes:**
1. Reuse the `runMap` from Phase 3 (already has `strategy_config_id` and `experiment_id`).

2. Batch-fetch strategy names and experiment names:
   ```typescript
   const strategyIds = [...new Set([...runMap.values()].filter(r => r.strategy_config_id).map(r => r.strategy_config_id!))];
   const experimentIds = [...new Set([...runMap.values()].filter(r => r.experiment_id).map(r => r.experiment_id!))];

   const strategyMap = new Map<string, string>();
   if (strategyIds.length > 0) {
     const { data, error: stratError } = await supabase.from('evolution_strategy_configs').select('id, label').in('id', strategyIds);
     if (stratError) throw stratError;
     (data ?? []).forEach(s => strategyMap.set(s.id, s.label));
   }

   const experimentMap = new Map<string, string>();
   if (experimentIds.length > 0) {
     const { data, error: expError } = await supabase.from('evolution_experiments').select('id, name').in('id', experimentIds);
     if (expError) throw expError;
     (data ?? []).forEach(e => experimentMap.set(e.id, e.name));
   }
   ```

3. Add fields to `ArenaEloEntry`:
   ```typescript
   strategy_label: string | null;
   experiment_name: string | null;
   evolution_run_id: string | null;
   ```

4. Populate from maps in the leaderboard builder.

5. In the Source column UI (lines 808-837), add strategy/experiment labels below the Run/Variant links:
   ```tsx
   {entry.strategy_label && (
     <span className="text-xs text-[var(--text-muted)] block truncate max-w-[120px]" title={entry.strategy_label}>
       {entry.strategy_label}
     </span>
   )}
   {entry.experiment_name && (
     <span className="text-xs text-[var(--text-muted)] block truncate max-w-[120px]" title={entry.experiment_name}>
       Exp: {entry.experiment_name}
     </span>
   )}
   ```

### Phase 5: Scatter chart improvements
**Files modified:**
- `src/app/admin/evolution/arena/[topicId]/page.tsx` — CostEloScatter component

**Changes:**
1. Enhanced tooltip — show method and model alongside cost/rating:
   ```tsx
   <Tooltip
     content={({ payload }) => {
       if (!payload?.length) return null;
       const d = payload[0].payload;
       return (
         <div style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border-default)', borderRadius: 6, padding: '6px 10px', fontSize: 12 }}>
           <div style={{ fontWeight: 600 }}>{d.method} · {d.model}</div>
           <div>Cost: ${d.cost.toFixed(4)}</div>
           <div>Rating: {d.elo.toFixed(0)}</div>
         </div>
       );
     }}
   />
   ```

2. Add subtitle below chart title explaining quadrants:
   ```tsx
   <div className="text-xs text-[var(--text-muted)] mb-2">
     Green area = high rating at low cost (optimal)
   </div>
   ```

3. Update scatter data to use `display_elo` (from Phase 2).

## Testing

### Unit Tests — Existing Test Migration

**`evolution/src/services/arenaActions.test.ts`** (existing tests will break):

**Mock structure migration** — `createTableAwareMock` uses sequential call indexing. Current leaderboard tests use 2 `.from()` calls (elo rows, entry details). After changes, the action makes up to 5 `.from()` calls in order:
1. `evolution_arena_elo` — existing (elo ratings)
2. `evolution_arena_entries` — existing (entry details, now includes `evolution_run_id`)
3. `evolution_runs` — **NEW** (batch fetch run cost/strategy/experiment IDs)
4. `evolution_strategy_configs` — **NEW** (batch fetch strategy labels)
5. `evolution_experiments` — **NEW** (batch fetch experiment names)

All existing leaderboard test setups must expand their `createTableAwareMock` arrays. The number of callbacks depends on which queries actually fire (guarded by `if (length > 0)` checks):
- **Entries with `evolution_run_id` set**: 2→5 callbacks (all 3 new queries fire)
- **Entries with `evolution_run_id: null`**: 2→2 callbacks (no new queries fire — `runIds` is empty, skips all 3 lookups)
- **Mixed entries**: Callbacks for queries that fire; count depends on whether `runIds`, `strategyIds`, `experimentIds` are non-empty

- **Update mock entry data**: All mock `evolution_arena_entries` rows must add `evolution_run_id` field (matching a mock run ID or `null` for non-evolution entries).
- **Update `ArenaEloEntry` assertions**: Every existing test asserting on leaderboard entry shape must include the new fields: `display_elo`, `run_cost_usd`, `strategy_label`, `experiment_name`, `evolution_run_id`.
- **Note on CI tests**: Existing tests check `ci_upper > ci_lower` and CI width comparisons, but do NOT check that `elo_rating` falls inside CI bounds. No existing CI-bounds tests need migration — only new tests are needed (see below).

**New tests in `arenaActions.test.ts`:**
- `display_elo` equals `ordinalToEloScale(mu)` for each entry
- `display_elo` is always >= `ci_lower` and <= `ci_upper`
- `run_cost_usd` populated from joined run when `evolution_run_id` is set
- `run_cost_usd` is `null` when `evolution_run_id` is `null`
- `strategy_label` and `experiment_name` populated from batch lookups
- Empty-array-early-return test (line ~374): no changes needed — function returns at `eloRows.length === 0` before any new queries execute

**`evolution/src/lib/core/rating.test.ts`:**
- Add test: for various mu/sigma values, verify `ordinalToEloScale(mu)` falls within `[ordinalToEloScale(mu - 1.96*sigma), ordinalToEloScale(mu + 1.96*sigma)]` (i.e., display_elo always inside CI)

**`evolution/src/services/promptRegistryActions.test.ts`** (new tests):
- Uses Proxy-based `createQueryChain` mock pattern (matching existing file conventions)
- `getPromptTitleAction` returns title for valid prompt ID
- `getPromptTitleAction` throws on invalid UUID format
- `getPromptTitleAction` throws when prompt not found (Supabase `.single()` error)
- Mock: `requireAdmin`, `createSupabaseServiceClient` returning `evolution_arena_topics` query mock

**`evolution/src/services/experimentActions.test.ts`** (new tests):
- Uses manual chain mock pattern (matching existing file conventions)
- `getExperimentNameAction` returns name for valid experiment ID
- `getExperimentNameAction` throws on invalid UUID format
- `getExperimentNameAction` throws when experiment not found
- Mock: `requireAdmin`, `createSupabaseServiceClient` returning `evolution_experiments` query mock

### E2E Test Impact

**`src/__tests__/e2e/specs/09-admin/admin-arena.spec.ts`:**
- Most E2E assertions will NOT break: existing tests use regex patterns (e.g., `/\\d+[–-]\\d+/` for CI range), check href attributes (not text content), and don't assert on specific Elo numeric values or cost column values.
- Source column test only checks href attributes — adding strategy/experiment text won't break it.
- Scatter chart tooltip has no content assertions — enhanced tooltip won't break tests.
- **Strategy**: Run E2E tests after each phase; fix any unexpected assertion mismatches.

### Rollback Plan
Each phase is independently deployable and revertible:
- **Phase 1**: New server actions + badge changes are UI-only; revert the page component and remove unused actions.
- **Phases 2-5**: `ArenaEloEntry` interface changes are additive (new fields). Revert by removing new fields and reverting `getArenaLeaderboardAction` + UI consumers. `elo_rating` (ordinal-based) is preserved throughout — never removed.
- **Database**: No schema migrations. All changes are read-only query changes. No data is modified.

### Manual Verification
- Check run detail page with a run that has prompt_id, experiment_id, and strategy_config_id — all three badges should show names
- Check run detail page with a run that has null prompt_id / experiment_id — badges should not render
- Check arena leaderboard — Elo values should always be within CI range
- Check arena leaderboard — cost should match run detail cost
- Check arena leaderboard — strategy/experiment names should appear in Source column
- Check scatter chart — tooltip should show method and model on hover

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/visualization.md` - Run detail badge changes, leaderboard new columns
- `evolution/docs/evolution/arena.md` - Elo display change (mu-based vs ordinal-based), cost source change, leaderboard strategy/experiment
- `evolution/docs/evolution/data_model.md` - ArenaEloEntry interface changes
