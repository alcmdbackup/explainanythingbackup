# Fix Prod Evolution V2 Error Plan

## Background
Failed to create experiment: new row for relation "evolution_experiments" violates check constraint "evolution_experiments_status_check" in production, when trying to create an evolution experiment.

## Requirements (from GH Issue #723)
Failed to create experiment: new row for relation "evolution_experiments" violates check constraint "evolution_experiments_status_check"

## Problem
The V2 experiment code (`evolution/src/lib/v2/experiments.ts`) inserts experiments with `status: 'pending'`, but the V2 database schema defines the CHECK constraint as `('draft', 'running', 'completed', 'cancelled', 'archived')`. The V2 schema intentionally uses `'draft'` as the initial status with a column default. The TypeScript code was written using V1 vocabulary (`'pending'`) instead of the V2 vocabulary (`'draft'`), causing every `createExperiment` call to fail.

## Options Considered

### Option A: Omit status on insert, let DB default work (Recommended)
- Remove `status: 'pending'` from the INSERT — DB default `'draft'` takes over
- Change remaining `'pending'` references in `addRunToExperiment()` to `'draft'`
- **Pros**: Impossible for status to drift from DB default again; less code
- **Cons**: Slightly less explicit about what the initial status is

### Option B: Explicitly set `'draft'`
- Replace `status: 'pending'` with `status: 'draft'` in the INSERT
- Same changes to `addRunToExperiment()` references
- **Pros**: More explicit in code
- **Cons**: Could drift from DB default if schema changes again

### Decision: Option A
Relying on the DB default is safer for this use case since the status column already has `DEFAULT 'draft'`.

## Phased Execution Plan

### Phase 1: Fix experiments.ts + JSDoc in actionsV2 (2 files, 5 changes)

**File: `evolution/src/lib/v2/experiments.ts`**

1. Line 33 — Remove `status: 'pending'` from the insert object:
```typescript
// Before
.insert({ name: trimmed, prompt_id: promptId, status: 'pending' })
// After
.insert({ name: trimmed, prompt_id: promptId })
```

2. Line 41 — Update JSDoc comment:
```typescript
// Before
/** Add a run to an experiment. Auto-transitions pending→running on first run. */
// After
/** Add a run to an experiment. Auto-transitions draft→running on first run. */
```

3. Lines 55, 74 — Change status checks from `'pending'` to `'draft'`:
```typescript
// Before
if (exp.status === 'completed' || exp.status === 'cancelled') {
// (no change needed — this is correct)

// Line 74, Before
if (exp.status === 'pending') {
// After
if (exp.status === 'draft') {
```

4. Line 79 — Change Supabase filter:
```typescript
// Before
.eq('status', 'pending');
// After
.eq('status', 'draft');
```

**File: `evolution/src/services/experimentActionsV2.ts`** (flagged by all 3 review agents)

5. Line 25 — Update JSDoc comment:
```typescript
// Before
/** Add a run to an experiment (auto-transitions pending→running). */
// After
/** Add a run to an experiment (auto-transitions draft→running). */
```

**Note**: Line 66 in `experiments.ts` inserts `status: 'pending'` for `evolution_runs` (not experiments). This is correct — runs have a separate CHECK constraint that includes `'pending'`. Do NOT change this.

**Follow-up (out of scope)**: `addRunToExperiment` does not reject `'archived'` experiments. File a separate issue if needed.

### Phase 2: Fix tests (1 file, 4 changes)

**File: `evolution/src/lib/v2/experiments.test.ts`**

1. Line 34 — Default mock experiment status:
```typescript
// Before
return { data: options?.experiment ?? { id: 'exp-1', status: 'pending', prompt_id: 'p-1' }, ...
// After
return { data: options?.experiment ?? { id: 'exp-1', status: 'draft', prompt_id: 'p-1' }, ...
```

2. Line 67 — createExperiment assertion (no longer expects status in insert):
```typescript
// Before
expect(inserts[0]).toMatchObject({ name: 'Test Exp', prompt_id: 'p-1', status: 'pending' });
// After
expect(inserts[0]).toMatchObject({ name: 'Test Exp', prompt_id: 'p-1' });
expect(inserts[0]).not.toHaveProperty('status');
```

3. Lines 82-83 — addRunToExperiment test name and mock:
```typescript
// Before
it('creates run with FK and transitions pending→running', async () => {
  const { db, inserts, updates } = makeMockDb({ experiment: { id: 'exp-1', status: 'pending', prompt_id: 'p-1' } });
// After
it('creates run with FK and transitions draft→running', async () => {
  const { db, inserts, updates } = makeMockDb({ experiment: { id: 'exp-1', status: 'draft', prompt_id: 'p-1' } });
```

### Phase 3: Verify

1. Run lint: `npx eslint evolution/src/lib/v2/experiments.ts evolution/src/lib/v2/experiments.test.ts`
2. Run tsc: `npx tsc --noEmit`
3. Run unit tests: `npx jest evolution/src/lib/v2/experiments.test.ts`
4. Run full build: `npm run build`
5. Grep for any remaining `'pending'` references in V2 experiment context

## Testing

### Unit tests to modify
- `evolution/src/lib/v2/experiments.test.ts` — Update 3 test cases to use `'draft'` instead of `'pending'`

### No new tests needed
- The existing test for `createExperiment` already covers the insert path
- The existing test for `addRunToExperiment` already covers the draft→running transition
- The existing rejection tests for completed/cancelled experiments are unaffected

### Manual verification
- After deploy, create an experiment in prod admin UI and confirm no CHECK constraint error

## Documentation Updates
No documentation updates needed — this is a simple status string fix. The relevant docs listed in `_status.json` are unaffected:
- `docs/docs_overall/debugging.md` — no change
- `docs/feature_deep_dives/error_handling.md` — no change
- Other docs — no change
