# Timeline View Evolution Runs Progress

## Phase 1: TimelineTab component
### Work Done
- Created `evolution/src/components/evolution/tabs/TimelineTab.tsx` — full Gantt implementation
- Reused `listInvocationsAction` (no new server action needed)
- Agent color coding, iteration grouping, parallel annotation, linked bars, run outcome section
- 7 unit tests in `TimelineTab.test.tsx` — all passing

### Issues Encountered
- ESLint `design-system/no-arbitrary-text-sizes` rejected `text-[9px]`, `text-[10px]`, `text-[11px]` — replaced all with `text-xs`
- ESLint `design-system/enforce-heading-typography` rejected `<h3 className="text-sm ...">` — updated to `text-xl font-display` per design system

### User Clarifications
- No backfill needed: all required DB columns (`created_at`, `duration_ms`, `iteration`, `execution_order`, `agent_name`) present since V2 schema; null values degrade gracefully

## Phase 2: Wire into run detail page
### Work Done
- Updated `src/app/admin/evolution/runs/[runId]/page.tsx` to import `TimelineTab`, add as first tab
- Passes `run` prop so component has access to `completed_at` and `run_summary`
