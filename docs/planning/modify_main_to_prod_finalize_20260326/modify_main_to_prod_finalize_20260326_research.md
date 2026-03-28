# Modify Main To Prod Finalize Research

## Problem Statement
Modify mainToProd and finalize skills to avoid fail-fast behavior, always run tests locally before pushing, and ensure full CI runs on GitHub (never partial re-runs).

## Requirements (from GH Issue #856)
- Avoid failfast, see all things that fail and then try to fix all at once, rather than 1 by 1
- Always run integration/E2E tests locally if possible before pushing
- On any failure, fix failing tests locally, verify they pass locally
- Then proceed to create PR and do CI
- On any failure, fix failing tests locally, verify they pass locally, then resubmit to run FULL CI on GH. Never re-run only failing tests on GH.

## High Level Summary

Both `finalize.md` and `mainToProd.md` currently use sequential fail-fast patterns where checks are run one at a time and failures are fixed before proceeding to the next check. The requirements call for running ALL checks first, collecting all failures, then fixing everything at once. Additionally, E2E tests should always run locally (not be gated behind `--e2e` flag), and CI should always be triggered by pushing new commits rather than using GitHub's "Re-run failed jobs" feature.

### Key Findings

1. **finalize.md Step 4 (lines 632-640)**: Sequential "fix as you go" pattern — runs lint, if fails fix then re-run, then tsc, etc. Needs to become "run all, collect all, fix all".

2. **finalize.md Step 8b (line 824)**: Uses `gh pr checks --watch --fail-fast` — the `--fail-fast` flag makes the CLI exit on first check failure. Need to remove it. Note: this only affects CLI watching behavior, NOT what GitHub Actions runs (CI already has `fail-fast: false` for sharded E2E).

3. **mainToProd.md Step 4 (lines 82-106)**: Same sequential pattern — "Run each check. If any fails, fix the issues before proceeding." Needs same restructuring.

4. **mainToProd.md lacks CI monitoring**: After PR creation (Step 6), only checks `gh pr view --json mergeable,mergeStateStatus`. No equivalent of finalize's Step 8 monitoring loop.

5. **E2E tests are gated behind --e2e flag** in both skills. For mainToProd (production releases), E2E should always run. For finalize, at minimum E2E critical should always run locally.

6. **mainToProd.md Co-Authored-By** (line 124): Still says "Claude Opus 4.5", needs update to "Claude Opus 4.6 (1M context)".

7. **CI workflow already supports full re-runs**: `cancel-in-progress: true` cancels old runs on new pushes, and pushing new commits always triggers the full CI pipeline. No need for `gh run rerun`.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- .claude/commands/mainToProd.md — full skill definition (200 lines)
- .claude/commands/finalize.md — full skill definition (957 lines)

### Related Docs Analyzed
- docs/docs_overall/testing_overview.md — documents --e2e flag for /finalize and /mainToProd (lines 216-223)
- docs/docs_overall/environments.md — documents backup mirror syncing by /finalize and /mainToProd (lines 261-281)
- .claude/skills/git-github/SKILL.md — documents merge strategies: squash for finalize, merge commit for mainToProd
- .github/workflows/ci.yml — CI workflow with fail-fast: false for sharded E2E, cancel-in-progress: true
- .claude/doc-mapping.json — used by finalize Step 6 for doc updates

### Previous Projects Reviewed
- docs/planning/update_finalize_main_to_prod_to_run_e2e_tests_20260307/ — Added --e2e flag to mainToProd, fixed E2E test fragility
- docs/planning/modify_finalize_to_create_and_monitor_pr_20260210/ — Added Step 8 PR monitoring loop to finalize
- docs/planning/finalize_should_leave_no_uncommitted_files_20260502/ — Added Step 6.6 clean working tree verification

## Code Files Read
- .github/workflows/ci.yml — CI pipeline (523 lines, 8 jobs, 6 phases)
- playwright.config.ts — E2E test configuration, auto-starts servers via ensure-server.sh
- docs/planning/tmux_usage/ensure-server.sh — on-demand server management for E2E tests

## Detailed Change Analysis

### Changes to finalize.md

| Location | Current Behavior | Required Change |
|----------|-----------------|-----------------|
| Step 4 (lines 632-640) | Sequential: run check → fix → next check | Run ALL 5 checks, collect ALL failures, fix all at once, re-run all |
| Step 5 (lines 642-646) | E2E only with --e2e flag | Always run E2E critical locally (`npm run test:e2e -- --grep @critical`) |
| Step 8b (line 824) | `gh pr checks --watch --fail-fast` | Remove `--fail-fast`: `gh pr checks --watch` |
| Step 8d (lines 884-903) | "Re-run local checks from Step 4" | Clarify: re-run ALL local checks, not just failing ones. Add note: never use `gh run rerun` |
| New guidance (after Step 8b) | None | Add: "Never use gh run rerun. Always fix locally, push new commit to trigger FULL CI" |

### Changes to mainToProd.md

| Location | Current Behavior | Required Change |
|----------|-----------------|-----------------|
| Step 4 (lines 82-106) | "If any fails, fix the issues before proceeding" + "Re-run the failing check" | Run ALL checks, collect ALL failures, fix all, re-run all |
| Step 4.5 (lines 108-114) | E2E only with --e2e flag | Always run E2E for production releases |
| Arguments (line 13) | `--e2e` is optional | Remove --e2e flag (E2E always runs) |
| Line 124 | Co-Authored-By: Claude Opus 4.5 | Update to Claude Opus 4.6 (1M context) |
| After Step 6 (line 161) | No CI monitoring | Add CI monitoring similar to finalize Step 8 |
| Success criteria (line 189) | "E2E tests pass (if --e2e flag was provided)" | "E2E tests pass" (always) |
| PR body (line 157) | "E2E Tests: [✓ passed / skipped (no --e2e flag)]" | "E2E Tests: ✓ passed" (always) |

### Docs that need corresponding updates

| Doc | What to update |
|-----|---------------|
| docs/docs_overall/testing_overview.md | Remove references to optional --e2e flag for mainToProd; update finalize E2E behavior |
| docs/docs_overall/environments.md | No changes needed (backup mirror behavior unchanged) |

## Lessons from Previous Projects

1. **Tool constraints**: `gh pr checks --watch` and `--json` are mutually exclusive; no native timeout (use system `timeout`); `link` field requires regex for run IDs
2. **E2E infrastructure**: Idle watcher can kill servers during long runs — global setup/teardown touch idle timestamp (already fixed)
3. **Security first**: Never auto-commit sensitive files; always prompt user
4. **Iteration limits**: Max 5 PR monitoring cycles, 50-file limit for uncommitted file processing
5. **Environment guards**: Always check `!process.env.CI` for local-only code

## Open Questions
- None — requirements are clear and implementation path is well-defined
