# Evolution Runs Not Added Arena Plan

## Background
The Arena UI shows all topics regardless of status. We need to wire up the existing `status` column and `archivePromptAction` so archived prompts are hidden from the Arena topic list and cross-topic summary. The experiment form already filters correctly.

## Requirements
- Archived prompts hidden from Arena topic list by default
- Archived prompts excluded from cross-topic summary stats
- Archive/unarchive toggle in Arena UI (topic list + topic detail)
- Visual indicator for archived topics when shown
- Optional "show archived" toggle in Arena UI
- No changes to pipeline internals (loadArenaEntries, syncToArena, resolveTopicId)

## Problem
`getArenaTopicsAction` and `getCrossTopicSummaryAction` don't filter by `status`. The Arena UI has no archive controls. All infrastructure (DB column, archive action, prompt registry filtering) already exists — just needs wiring.

## Phased Execution Plan

### Phase 1: Backend — Filter arena actions by status

**Files modified:**
- `evolution/src/services/arenaActions.ts`

**Changes:**
1. `getArenaTopicsAction` (line 785): Add optional `includeArchived?: boolean` param. Default `false`. Add `.eq('status', 'active')` unless `includeArchived` is true. Include `status` in select.
2. `getCrossTopicSummaryAction` (line 533): Filter entries to only include those from active topics. Join or pre-filter topic IDs by `status = 'active'`.
3. Update `ArenaTopicWithStats` type (line 776) to include `status` field.

### Phase 2: Frontend — Arena topic list archive controls

**Files modified:**
- `src/app/admin/quality/arena/page.tsx`

**Changes:**
1. Add "Show archived" toggle checkbox to topic list header
2. Pass `includeArchived` to `getArenaTopicsAction` based on toggle
3. Add archive/unarchive button per topic row (calls existing `archivePromptAction` / new `unarchivePromptAction`)
4. Visual indicator: dim row + "Archived" badge for archived topics
5. Refresh topic list after archive/unarchive

### Phase 3: Frontend — Arena topic detail archive button

**Files modified:**
- `src/app/admin/quality/arena/[topicId]/page.tsx`

**Changes:**
1. Add archive/unarchive button in topic detail header
2. Fetch topic status and display badge if archived

### Phase 4: Backend — Add unarchive action

**Files modified:**
- `evolution/src/services/promptRegistryActions.ts`

**Changes:**
1. Add `unarchivePromptAction` — sets `status = 'active'` (mirror of `archivePromptAction`)

## Testing
- Unit test: `getArenaTopicsAction` filters archived topics by default
- Unit test: `getArenaTopicsAction` includes archived topics when `includeArchived: true`
- Unit test: `getCrossTopicSummaryAction` excludes entries from archived topics
- Unit test: `unarchivePromptAction` sets status back to active
- Manual: verify Arena UI hides archived topics, toggle works, archive/unarchive buttons work

## Documentation Updates
- `evolution/docs/evolution/arena.md` — Note that archived topics are hidden from Arena UI but still accessible for existing runs
