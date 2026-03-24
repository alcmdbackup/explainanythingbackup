---
description: Summarize a project's plan file concisely — overview bullets, detailed changes, modified files, and tracked docs
argument-hint: [project-name]
allowed-tools: Bash(git:*), Read, Glob, Grep, AskUserQuestion
---

# /summarize-plan - Plan Summary

Generate a concise summary of a project's planning document.

## Usage

```
/summarize-plan [project-name]
```

- `project-name` (optional): Project name or partial match. If omitted, detect from `_status.json` branch mapping.

## Execution Steps

### 1. Find Project Folder

If argument provided, use Glob to search for matching folder:
```
Glob("docs/planning/*${ARGUMENTS}*")
```

If no argument (or whitespace-only), find the active project by matching the current branch against `_status.json` files:
```bash
BRANCH=$(git branch --show-current)
# Search all _status.json files for the one whose "branch" field matches
grep -Frl "\"branch\": \"${BRANCH}\"" docs/planning/*/_status.json
```

This returns the path to the matching `_status.json` (e.g., `docs/planning/workflow_changes_20260323/_status.json`), from which the project folder is derived by stripping the filename.

Validation:
- If no matching `_status.json` found, abort with: "Error: No project found for branch '$BRANCH'. Provide a project name or ensure /initialize was run."
- If multiple matches found, list them and use AskUserQuestion to let user pick one.

### 2. Read Project Files

Read these files from the project folder:
1. `*_planning.md` or `_planning.md` — the plan content (REQUIRED — abort if missing: "Error: No planning file found in [folder].")
2. `_status.json` — for `relevantDocs` array (if missing or no `relevantDocs` key, show "No tracked docs" in output)
3. `*_research.md` or `_research.md` — for requirements context (optional, skip if missing)

### 3. Get Changed Files

```bash
# Fetch to ensure origin/main is current
git fetch origin main 2>/dev/null || true

# Committed changes vs origin/main
git diff --name-only origin/main...HEAD
```

Also check for uncommitted changes:
```bash
git diff --name-only HEAD
git ls-files --others --exclude-standard
```

Categorize files as: modified, added, deleted, or uncommitted.

### 4. Generate Summary

Output this exact format:

```
# Plan Summary: [Project Name]

## Overview (5 bullets max)
- [bullet 1 — most important aspect of the plan]
- [bullet 2]
- [bullet 3]
- [bullet 4]
- [bullet 5]

## Detailed Changes
[More detailed description of what the plan entails, organized by phase if the plan has phases. Be concise but thorough.]

## Files Changed (vs origin/main)
### Modified
- path/to/file.ts

### Added
- path/to/new-file.ts

### Deleted
- path/to/removed-file.ts

### Uncommitted
- path/to/wip-file.ts (if any)

## Tracked Docs
[List from _status.json relevantDocs array, or "No tracked docs" if missing]
- docs/feature_deep_dives/tag_system.md
- docs/docs_overall/architecture.md
```

### 5. Conciseness Rules

- Overview bullets: max 15 words each
- Detailed changes: max 200 words total
- File lists: just paths, no descriptions
- Tracked docs: just paths, no descriptions
- No filler text, headers, or explanations beyond the template
