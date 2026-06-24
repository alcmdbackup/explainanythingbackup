# Playwright Sweep Evolution Bugs UX Issues Progress

## Phase 1: Environment + auth setup
### Work Done
- Dev server up at http://localhost:3500 (tmux, instance f4cc3ca70637307c).
- Admin auth: logged in via UI as abecha@gmail.com; `/admin/evolution/*` reachable (localhost = `local` host tier → no hostname gate).
- Findings logged to `..._findings.md` (numbered table, severity-tagged).

### Issues Encountered
- **Server kept dying every ~5 min**: idle-watcher kills it because Playwright **MCP** navigations don't refresh `/tmp/claude-idle-<id>.timestamp` (only ensure-server.sh / PW global-setup do). Fixed with a background keepalive touching the timestamp every 50s. Saved as memory `project_idle_watcher_kills_server_during_mcp_sweep`.
- Recurring `/api/client-logs` ERR_CONNECTION_REFUSED in console = transient server drops, environmental (not counted as findings).

### User Clarifications
[none yet]

## Execution after /plan-review consensus (Phases 3–8 + Phase-1 cleanup)
All implemented, unit-tested, lint+tsc clean (112 unit tests across 6 touched suites), and **live-verified via Playwright**:
- **T1** — `categorizeError` ZodError branch (`src/lib/errorHandling.ts`, inserted first) → criteria Min>Max now shows "max_rating must exceed min_rating" (not raw JSON). +2 unit tests.
- **T4** — RubricEditor: moved `onChange` out of the `setAnchors` updater (`criteria/RubricEditor.tsx`) → add-anchor no longer logs "Cannot update a component while rendering". +composition test.
- **T8** — `judge-rubrics/page.tsx:52` `filterTestContent: false→true` → dimension picker no longer lists `TESTEVO-criterion-*`.
- **T16** — extracted pure `nextConfigId` (`prompt-editor/configId.ts`), removed the in-updater ref mutation → config labels are 1,2,3 (not 1,3,5). +4 unit tests.
- **T21** — extracted pure `hydrateDimensionWeights` sum-heuristic (`judge-rubrics/rubricWeights.ts`) → editing "Inferred result 1" shows 17/30/53=100, "✓ 100%", Save enabled. +6 unit tests.
- **Phase-1 cleanup** — migration `evolution_wi_sessions`→`evolution_weight_inference_sessions` (verified all 7 backfills in isolated Postgres); backfill integration test extended 3→7 tables + new-predicate mirror + `[TESTEVO]`/trailing-timestamp fixtures; 2 stale comments fixed.
- **Deferred:** T30 + the systemic UX/a11y cluster (documented in findings, not this PR).

## Fixes (user: "quality over count, then fix")
Stopped accumulating at 24 findings; pivoted to fixing the highest-severity functional bugs.

1. **#1/#9 test-content classifier leak — FIXED.** `evolution/src/services/shared.ts` `isTestContentName` + `evolution_is_test_name` Postgres fn (migration `20260623000001_evolution_is_test_name_broaden_patterns.sql`, re-flags strategies/prompts/experiments). Added `[testevo]` + regex `(^|[-_ ])\d{10,13}([-_ ]|$)` to catch bracket-no-underscore + trailing/space/underscore-delimited timestamps. Verified: 44 unit tests, isolated-Postgres regex check (`t|t|t|t|f|f|f`), migration idempotency lint, lint, typecheck. `TEST_NAME_FIXTURES` anti-drift updated.
2. **#13/#14 dead variant-list sort — FIXED.** `src/app/admin/evolution/variants/page.tsx` Rating column was `sortable:true` but `onSort` never wired (EntityTable only attaches onClick when both present) and `listVariantsAction` has no sort param → ▲ + pointer affordance with a dead click. Removed the false flag. Verified live (header now plain "Rating", not clickable) + 13 page tests pass.
3. **#10 corrected (integrity):** qwen-2.5-7b-instruct is OpenRouter (deployable), not local — retracted the "non-functional off-Vercel" claim; downgraded S2→S4 (intended consistent default).
4. **#2 corrected:** "Nightly smoke fixture" is intentionally visible per its seed migration — retracted that sub-claim.

Not fixed (intentionally): **#6** (Runs/Experiments/Strategies non-sortable) is a server-side-sort *feature* (add ORDER BY param to list actions + wire onSort), larger than a bug-fix — flagged for a follow-up. Remaining UX/A11y items (#15 dialog aria-describedby, #16/#21 FormDialog validation, #23 silent create no-op, #18/#24 metric labels) are contained future fixes.

## Sweep checkpoint #2 (24 findings)
Added since #1: prompts registry (clean) + confirmed FormDialog validation inconsistency & aria-describedby are systemic (#15/#21); start-experiment wizard (budget clamps OK, validation OK, redundant `[para]` labels #22); Judge Lab launcher (qwen default-judge #10 broadened); Weight Inference (generic title #11, breadcrumb #20, silent Create-session no-op #23); run-detail Logs/Cost-Estimates/Elo/Variants tabs (Cost-Estimates ERROR% inconsistency #24); variant detail (generic title #11, Diff-vs-parent empty-state OK); match detail (clean).
Coverage now: all 11 list pages, both wizards, all 4 tools, 7/8 run-detail tabs, variant detail, match detail, 2 FormDialogs.
Calibration: this is a heavily-swept mature UI; generic per-page audits are clean, so remaining yield is increasingly S4 polish + edge-cases (responsive/keyboard/pagination-clamp/malformed-URL, remaining detail pages: invocation/strategy/experiment/arena-topic, Judge-Lab subroutes, Snapshots tab).

## Sweep checkpoint (19 findings so far)
Pages swept: dashboard, runs, experiments, strategies, strategies/new (wizard step 1), tactics, criteria, variants, style-fingerprints (+ New dialog), judge-rubrics, arena, runs/[id] (Timeline/Metrics/Lineage tabs).
Systemic issues (counted once): #4 heading no-space before count (all EntityListPage lists), #6/#12 entity-list tables non-sortable (leaderboards are), #1/#2/#9 "Hide test content" classifier misses `[TESTEVO]`/`Gate … real`/`Nightly smoke fixture`.
Candidates to confirm: criteria list missing the 5 documented metric columns; arena `[TEST]` topic visible under default filter; "Data validation failed" generic message likely shared by all FormDialogs.
Still to sweep: invocations, prompts, matches (Match Viewer + re-judge), prompt-editor, judge-lab (+subroutes), weight-inference, start-experiment wizard, run detail Cost-Estimates/Elo/Variants/Snapshots/Logs tabs, variant/invocation/strategy/experiment/arena-topic detail pages, pagination clamp, column-picker persistence, responsive/keyboard passes.

## Phase 2: List-page sweep
### Work Done
[Pending]

## Phase 3: Detail-page + tab sweep
### Work Done
[Pending]

## Phase 4: Wizards + Tools sweep
### Work Done
[Pending]

## Phase 5: Consolidate to 100
### Work Done
[Pending]
