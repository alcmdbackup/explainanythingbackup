# Update Finalize Command Review Plan Research

## Problem Statement
The `/finalize` command creates PRs without verifying that the project's planning file has been fully implemented. This means phases, tests, or documentation updates listed in the plan could be missed with no automated check.

## High Level Summary
Research identified the finalize command structure, the initialize command's naming conventions, and all planning file variations across the codebase. Two naming conventions coexist (legacy full-name and modern underscore-prefix), requiring a multi-path lookup strategy.

## Documents Read
- `.claude/commands/finalize.md` — current finalize workflow (6 steps)
- `.claude/commands/initialize.md` — project initialization, branch/folder naming logic
- `docs/docs_overall/project_workflow.md` — official workflow with `_planning.md` convention
- `docs/docs_overall/getting_started.md` — documentation structure
- `docs/docs_overall/architecture.md` — system design

## Code Files Read
- `docs/planning/consolidate_llm_infrastructure_20260201/consolidate_llm_infrastructure_20260201_planning.md` — example legacy-named planning file with phases, tests, docs, out-of-scope sections
- `docs/planning/feat/consolidate_llm_infrastructure_20260201/_status.json` — workflow state tracking
- `docs/planning/feat/improve_designs_20260123/_planning.md` — example modern-named planning file
- Glob survey of all `docs/planning/` subdirectories to catalog naming conventions

## Key Findings

### Planning File Naming Conventions
| Convention | Path Pattern | Era |
|---|---|---|
| **Modern** (official per project_workflow.md) | `docs/planning/{type}/{project}/_planning.md` | Newer projects |
| **Legacy** (from initialize.md) | `docs/planning/{project}/{project}_planning.md` | Older projects |
| **Modern flat** | `docs/planning/{project}/_planning.md` | Some intermediate projects |

### Lookup Order (branch → plan file)
Given branch `feat/my_project_20260201`:
1. `docs/planning/feat/my_project_20260201/_planning.md`
2. `docs/planning/my_project_20260201/_planning.md`
3. `docs/planning/my_project_20260201/my_project_20260201_planning.md`

### Plan File Structure (sections to verify)
- **Phased Execution Plan** — phases with "Files modified", changes, tests
- **Testing** — test files and specific test names
- **Documentation Updates** — doc files to update
- **Out of Scope** — items explicitly excluded (must NOT be flagged as gaps)
