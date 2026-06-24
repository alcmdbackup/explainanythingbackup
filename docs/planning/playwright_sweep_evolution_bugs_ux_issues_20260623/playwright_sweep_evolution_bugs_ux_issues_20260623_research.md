# Playwright Sweep Evolution Bugs UX Issues Research

## Problem Statement
Use Playwright (headless, via the MCP server) to systematically explore the evolution admin UI and find 100 evolution admin UI bugs or UX issues total. The sweep should walk every admin page under `/admin/evolution/*` plus the dashboard, exercising filters, sorts, pagination, tabs, detail pages, wizards, and tools. Don't stop until 100 distinct issues are catalogued.

## Requirements (from GH Issue #1265)
- Use playwright to look for 100 evolution admin UI bugs or UX issues total. Don't stop until done.

## High Level Summary
This is a recurring exploratory-testing project type (priors: `use_playwright_find_bugs_ux_issues_20260422`, `use_playwright_find_ux_issues_bugs_20260501`, `fixes_to_evolution_admin_dashboard__20260503`). The evolution admin UI is large — ~25 routes built on Next.js server actions + shared React components, served on the evolution hostname (`requireAdmin()` + hostname assertion). Exploration runs against the local dev server (managed by tmux/`ensure-server.sh`) with admin auth.

### Admin surface to sweep (from visualization.md)
List pages: `/admin/evolution-dashboard`, `/runs`, `/experiments`, `/arena`, `/variants`, `/invocations`, `/strategies`, `/prompts`, `/tactics`, `/criteria`, `/matches`, plus Tools: `/prompt-editor`, `/judge-lab` (+ runs/pair-banks/test-sets), `/weight-inference`.
Detail pages (tabbed): `/runs/[runId]` (Timeline/Metrics/Cost Estimates/Elo/Lineage/Variants/Snapshots/Logs), `/experiments/[id]`, `/arena/[topicId]`, `/arena/entries/[entryId]`, `/variants/[id]` (incl. Matches + Diff-vs-parent), `/invocations/[id]` (agent-specific tab layouts), `/strategies/[id]`, `/tactics/[id]`, `/criteria/[id]`, `/matches/[comparisonId]`.
Wizards: `/start-experiment` (3-step), `/strategies/new` (2-step iteration builder).

### Known UX hot-spots / regression-prone areas (from docs)
- "Hide test content" filter default-on across all list pages — seeded rows hidden until reset; historically the `.not(...IN...)` path silently returned zero rows past PostgREST URL limits.
- Column-visibility picker + localStorage persistence (`ColumnPicker`, `usePersistedHiddenColumns`) — brief "all columns visible" flash on first paint.
- Pagination: sliding-window (MAX_VISIBLE_PAGES=7), jump-to-page clamp.
- Auto-refresh (15s) on dashboard + in-progress run detail; pauses on tab hidden.
- Cost columns / fallback chains (Total Cost → $0 collapse historically).
- D3 LineageGraph (zoom/pan, dynamic import, SSR-disabled).
- Tab state synced to `?tab=` query param; legacy tab map redirects.
- Empty states, loading skeletons (`loading.tsx` per route).

### Method
Drive Playwright MCP headless with admin auth, snapshot each page, interact (filters/sort/pagination/tabs/forms), capture console errors + network failures, and log each distinct bug/UX issue with route, repro, severity, and category. Accumulate to 100. Categorize (functional bug vs UX/polish) and dedupe.

## Documents Read

### Core Workflow Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Core Operations Docs
- docs/docs_overall/environments.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/debugging.md

### Relevant Docs (evolution + standard)
- evolution/docs/README.md
- evolution/docs/visualization.md (admin pages + shared components — primary map)
- evolution/docs/reference.md (file inventory, config, env flags, error classes)

## Code Files Read
- (none yet — to be populated during the exploration phase)
