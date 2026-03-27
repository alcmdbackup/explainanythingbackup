# Modify Reset Worktrees Research

## Problem Statement
I want to expand number of worktrees supported by reset_worktrees to 20.

## Requirements (from GH Issue #NNN)
I want to expand number of worktrees supported by reset_worktrees to 20.

## High Level Summary
The `reset_worktrees` script currently creates 5 worktrees (indices 1-5) via a hardcoded loop on line 126. The primary change is trivial — expand the loop range. However, scaling to 20 worktrees has resource implications (disk space, install time) and presents optimization opportunities (parallelizing npm install). All hooks and settings use relative/dynamic paths and are worktree-agnostic.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- (none selected)

## Code Files Read
- `reset_worktrees` — Main script, 217 lines. Loop on line 126: `for i in 1 2 3 4 5`
- `.worktree_counter` — Currently at 36 (incremented each reset run)
- `package.json` — 103 dependencies total
- `package-lock.json` — 21,957 lines, lockfileVersion 3
- `.npmrc` — Contains `legacy-peer-deps=true`
- `.claude/settings.json` — No hardcoded worktree paths
- `.claude/settings.local.json` — Minimal, worktree-agnostic
- `.claude/hooks/` — All hooks use dynamic/relative paths, no worktree-specific references
- `docs/planning/tmux_usage/start-dev-tmux.sh` — Port allocation 3100-3999 (900 ports), hash-based, no worktree limit
- `settings.json` (root) — References `bash reset_worktrees:*` in allow list, no count hardcoded
- `.github/workflows/ci.yml` — No worktree count references

## Key Findings

1. **Primary change is trivial**: Line 126 `for i in 1 2 3 4 5` → `for i in {1..20}` (or `$(seq 1 20)`)
2. **Disk impact**: Each worktree uses ~4.1-4.5GB (node_modules=1.2GB, .next=2.9GB). 15 additional worktrees = ~18GB more disk
3. **Install time**: Sequential npm install ~2-3 min per worktree. 20 sequential = ~50 min. Parallelized in batches of 5 = ~10 min
4. **Port allocation is safe**: 900 port range (3100-3999), 20 worktrees = 2.2% occupancy
5. **All hooks/settings are worktree-agnostic**: Use relative paths, env vars, or dynamically extracted paths
6. **No disk space pre-flight check exists**: Should consider adding one
7. **.mcp.json is NOT copied by reset_worktrees**: Gap identified but out of scope for this project
8. **doc-mapping.json is NOT copied**: Another gap, also out of scope
9. **npm ci is faster than npm install**: CI already uses it; script should switch
10. **Parallelizing npm install is safe**: lockfileVersion 3, isolated node_modules per worktree

## Open Questions
1. Should we add a configurable variable for worktree count (e.g., `NUM_WORKTREES=20`) or just hardcode 20?
2. Should we parallelize npm install (significant time savings) or keep it simple/sequential?
3. Should we add a disk space pre-flight check before creating 20 worktrees?
