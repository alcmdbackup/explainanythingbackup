# Evolution Runs Not Added Arena Research

## Problem Statement
Evolution runs completed successfully but appear missing from the Arena UI. Investigation revealed the data IS present in the database — the real need is the ability to archive prompts so they are hidden from the Arena topic list and from experiment prompt selection.

## Requirements (from user)
- Archive prompts so they are hidden from arena topic list
- Archived prompts hidden as options when starting experiments
- Archived prompts should NOT break existing runs or historical data

## High Level Summary

The `evolution_arena_topics` table **already has** a `status` column with CHECK constraint `('active', 'archived')` and an `archivePromptAction` exists in `promptRegistryActions.ts`. The experiment form already filters by `status: 'active'`. The **only gap** is the Arena UI — `getArenaTopicsAction` and `getCrossTopicSummaryAction` do not filter by status.

### What Already Works
| Component | Status Filter? | File:Line |
|-----------|---------------|-----------|
| DB schema (`status` column) | EXISTS | `migrations/20260207000001_prompt_metadata.sql:7-12` |
| `archivePromptAction` | EXISTS | `promptRegistryActions.ts:188-208` |
| `getPromptsAction` (optional filter) | EXISTS | `promptRegistryActions.ts:26-59` |
| Experiment form prompt list | FILTERS `active` | `ExperimentForm.tsx:48-56` |

### What Needs Fixing
| Component | Issue | File:Line |
|-----------|-------|-----------|
| `getArenaTopicsAction` | No status filter | `arenaActions.ts:785-865` |
| `getCrossTopicSummaryAction` | Includes entries from archived topics | `arenaActions.ts:533-620` |
| Arena topic list UI | No archive/unarchive buttons, no visual indicator | `arena/page.tsx` |
| Arena topic detail page | No archive button | `arena/[topicId]/page.tsx` |

### Safe to Leave Unfiltered (by design)
| Component | Reason | File:Line |
|-----------|--------|-----------|
| `loadArenaEntries` | Existing runs must still load arena history | `arenaIntegration.ts:22-86` |
| `resolveTopicId` | Runs reference topics by FK; archived topics still valid | `arenaIntegration.ts:289-313` |
| `syncToArena` | Completed runs must still sync to archived topics | `arenaIntegration.ts:198-284` |
| `findTopicByPrompt` | Used by sync/resolve, not user-facing selection | `arenaIntegration.ts:89-100` |
| `resolvePromptId` (experiments) | Existing experiments must still reference their prompt | `experimentActions.ts:24-33` |

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/evolution/arena.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/reference.md

## Code Files Read

### Arena System
- `evolution/src/services/arenaActions.ts` — Arena CRUD actions; `getArenaTopicsAction` (line 785) and `getCrossTopicSummaryAction` (line 533) don't filter by status
- `evolution/src/lib/core/arenaIntegration.ts` — `loadArenaEntries`, `syncToArena`, `resolveTopicId`; correctly unfiltered for pipeline use
- `src/app/admin/quality/arena/page.tsx` — Arena topic list UI; no archive controls

### Prompt Registry
- `evolution/src/services/promptRegistryActions.ts` — `archivePromptAction` (line 188) already exists; `getPromptsAction` (line 26) supports optional status filter

### Strategy Registry (pattern reference)
- `evolution/src/services/strategyRegistryActions.ts` — `archiveStrategyAction` (line 307) as precedent pattern

### Experiment System
- `src/app/admin/quality/optimization/_components/ExperimentForm.tsx` — Prompt dropdown already calls `getPromptsAction({ status: 'active' })` (line 48)
- `evolution/src/services/experimentActions.ts` — `resolvePromptId` (line 24) doesn't filter by status (correct for existing experiments)

### Migrations
- `supabase/migrations/20260207000001_prompt_metadata.sql` — Added `status` column with CHECK constraint `('active', 'archived')` to `evolution_arena_topics`

## Production Data Check
Investigated runs `1a67a4ce` and `7facd4d1` in production:
- Both are `completed` with `budget_exhausted` (budget cap $0.10)
- Both linked to topic `d238f561` ("Explain how the Federal Reserve's monetary policy affects global markets")
- 64 arena entries total, all with Elo ratings (range 1337-1647)
- 65 comparisons in topic
- Data is fully present — the perceived issue was a UI/filtering concern, not a sync bug
