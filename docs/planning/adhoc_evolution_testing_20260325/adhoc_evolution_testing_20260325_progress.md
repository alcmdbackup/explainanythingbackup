# Adhoc Evolution Testing Progress

## Phase 1: Exploratory Testing via Playwright
### Pages Tested
- Dashboard (`/admin/evolution-dashboard`)
- Runs list (`/admin/evolution/runs`)
- Run detail — completed (`/admin/evolution/runs/3345a6ab-...`)
- Run detail — failed (`/admin/evolution/runs/ce267827-...`)
- Experiments list (`/admin/evolution/experiments`)
- Prompts registry (`/admin/evolution/prompts`)
- Strategies registry (`/admin/evolution/strategies`)
- Arena topics (`/admin/evolution/arena`)
- Invocations list (`/admin/evolution/invocations`)
- Start Experiment wizard (`/admin/evolution/start-experiment`)

### Issues Found

#### BUG-1: "Hide test content" filter inconsistent across pages (Medium)
- **Runs page**: Works correctly — filters out [TEST]-prefixed strategy runs, shows 0 items
- **Experiments page**: Does NOT filter — all 7 experiments (including "Test", "test" named) still visible with checkbox checked
- **Strategies page**: Does NOT filter — "Test" strategy still visible with checkbox checked
- **Prompts page**: Works correctly — only non-test prompt shown
- **Arena page**: Works correctly
- **Invocations page**: Works correctly (shows 0 items)
- **Root cause hypothesis**: Experiments and strategies don't use the `[TEST]` prefix convention in their names, or the filter join logic doesn't apply to these entity types

#### BUG-2: Prompt link on run detail shows raw UUID, links to list page (Medium)
- **Where**: Run detail header, cross-link chips
- **Shows**: `Prompt: #8f098c1f-b1af-493a-8429-9f7432e8da1c`
- **Should show**: Prompt name (e.g., "Federal reserve")
- **Links to**: `/admin/evolution/prompts` (list page)
- **Should link to**: `/admin/evolution/prompts/8f098c1f-...` (detail page — but this route may not exist)

#### BUG-3: Run detail missing cost metric (Low)
- **Where**: Run detail Metrics tab
- **Shows**: Rating (Winner/Median/P90/Max Elo), Match Stats (Matches), Counts (Variants)
- **Missing**: Cost section — no total cost, no per-phase cost breakdown
- **Expected**: Cost metric should be shown since it's written during execution per the metrics registry

#### UX-1: Table columns truncated on multiple pages (Medium)
- **Runs list**: "Budget" column cut off at right edge; Cost/Max Elo/Decisive Rate/Variants columns invisible without horizontal scroll
- **Strategies list**: "Label" column truncated (key differentiation info like model names is hidden); "Runs" count column cut off
- **Prompts list**: "Actions" column (Edit/Archive/Delete) partially cut off
- **Cause**: Tables have too many columns for the viewport width, no horizontal scroll indicator

#### UX-2: "Explanation" column header misleading on Runs list (Low)
- **Where**: Runs list table, first column
- **Shows**: Column header "Explanation" displaying truncated run IDs (e.g., "3345a6ab")
- **Should be**: "Run ID" or just "ID" — these are evolution run identifiers, not explanation IDs

#### UX-3: No item count on Prompts and Strategies registry pages (Low)
- **Where**: Prompts and Strategies list pages
- **Compared to**: Runs, Experiments, Invocations, Arena all show "N items" subtitle
- **Missing**: Item count subtitle under the page heading

#### UX-4: Stale experiments stuck in "running" status (Low/Data)
- **Where**: Experiments list
- **5 of 7 experiments** show "running" status with Cancel buttons
- **These appear to be stale** — the associated runs are all completed or failed
- **Suggestion**: Auto-completion logic may not be triggering, or these experiments have runs that never resolved

#### PERF-1: Slow initial page loads across all evolution pages (Low)
- **Observed**: TTFB 3-5 seconds on first load for most pages
- **FCP**: Consistently "poor" (3-5 seconds) on initial navigation
- **Likely cause**: Dev mode (HMR + Fast Refresh overhead), not a production issue
- **Note**: Fast Refresh rebuilding loops observed on every page (dozens of rebuilds)

### Screenshots Captured
- `dashboard-initial.png` — Dashboard with metrics cards and recent runs
- `runs-list-all.png` — Runs list with all items (test content visible)
- `runs-page.png` — Runs list with "Hide test content" showing 0 items
- `run-detail-completed.png` — Completed run detail with metrics
- `run-detail-failed.png` — Failed run detail with error banner
- `experiments-empty-cells.png` — Experiments list with data
- `prompts-page.png` — Prompts registry
- `strategies-page.png` — Strategies registry
- `arena-page.png` — Arena topics list
- `invocations-page.png` — Invocations list (empty with filter)
- `start-experiment-wizard.png` — Experiment creation wizard Step 1

### What Works Well
- Sidebar navigation is clear and well-organized (Overview/Entities/Results grouping)
- Run detail tabs (Metrics/Elo/Lineage/Variants/Logs) are well-structured
- Variants tab with strategy filter dropdown works great
- Failed run error banner is clear and informative
- Start Experiment wizard has clean 3-step flow
- Arena topics page is clean with proper item count
- Cross-link chips (Strategy, Experiment) on run detail work correctly
- Empty state messages are helpful (e.g., "No invocations found / Run an evolution experiment...")

### User Clarifications
[None yet]
