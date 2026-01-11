# /initialize - Project Initialization

Initialize a new project folder with standard documentation structure per project_workflow.md.

## Usage

```
/initialize <project-name>
```

## Execution Steps

When invoked, you MUST follow this exact process:

### 1. Parse and Validate Input

```bash
PROJECT_NAME="$ARGUMENTS"
```

**Date Suffix Logic:**
- Check if PROJECT_NAME already ends with an 8-digit date pattern (YYYYMMDD)
- If YES: Use PROJECT_NAME as-is (e.g., `my_project_20260115` → `my_project_20260115`)
- If NO: Append today's date (e.g., `my_project` → `my_project_20260110`)

```bash
# Check if project name already has date suffix
if [[ "$PROJECT_NAME" =~ _[0-9]{8}$ ]]; then
  PROJECT_PATH="docs/planning/${PROJECT_NAME}"
else
  DATE_SUFFIX=$(date +%Y%m%d)
  PROJECT_PATH="docs/planning/${PROJECT_NAME}_${DATE_SUFFIX}"
fi
BRANCH_NAME="fix/${PROJECT_NAME}"
```

**Validation:**
- If `$ARGUMENTS` is empty, abort with: "Error: Project name required. Usage: /initialize <project-name>"
- Check if folder exists using this exact command format:
  ```bash
  [ -d docs/planning/PROJECT_NAME_DATE ] && echo EXISTS || echo NOT_EXISTS
  ```

### 2. Create Branch from Remote Main

Fetch the latest from remote and create a new branch based exactly off `origin/main`:

```bash
# Fetch latest from remote
git fetch origin main

# Create and switch to new branch based on origin/main
git checkout -b "$BRANCH_NAME" origin/main
```

**Error Handling:**
- If branch already exists, abort with: "Error: Branch $BRANCH_NAME already exists. Choose a different project name or delete the existing branch."
- If fetch fails, warn user but continue (they may be offline)

### 2.5. Read Core Documentation

Before creating project files, read these three core documents to understand the codebase context:

1. **Read** `docs/docs_overall/getting_started.md` - Documentation structure and reading order
2. **Read** `docs/docs_overall/architecture.md` - System design, data flow, and tech stack
3. **Read** `docs/docs_overall/project_workflow.md` - Complete workflow for projects

These provide essential context for the project initialization.

### 3. Create Folder Structure

Use this exact command format:
```bash
mkdir -p docs/planning/PROJECT_NAME_DATE
```

### 4. Create Research Document

Create `$PROJECT_PATH/${PROJECT_NAME}_research.md` using the **Write tool** with this template:

```markdown
# [Project Name] Research

## Problem Statement
[Description of the problem]

## High Level Summary
[Summary of findings]

## Documents Read
- [list of docs reviewed]

## Code Files Read
- [list of code files reviewed]
```

Replace `[Project Name]` with the actual project name in title case.

### 5. Create Planning Document

Create `$PROJECT_PATH/${PROJECT_NAME}_planning.md` using the **Write tool** with this template:

```markdown
# [Project Name] Plan

## Background
[3-5 sentences of context]

## Problem
[3-5 sentences describing the problem]

## Options Considered
[Concise but thorough list of options]

## Phased Execution Plan
[Incrementally executable milestones]

## Testing
[Tests to write or modify, plus manual verification on stage]

## Documentation Updates
[Files in docs/docs_overall and docs/feature_deep_dives to update]
```

### 6. Create Progress Document

Create `$PROJECT_PATH/${PROJECT_NAME}_progress.md` using the **Write tool** with this template:

```markdown
# [Project Name] Progress

## Phase 1: [Phase Name]
### Work Done
[Description]

### Issues Encountered
[Problems and solutions]

### User Clarifications
[Questions asked and answers received]

## Phase 2: [Phase Name]
...
```

### 7. Ask for GitHub Issue Summary

**YOU MUST use AskUserQuestion** to get the issue summary:

Prompt: "Please provide a 3-5 sentence summary for the GitHub issue describing what this project will accomplish:"

Wait for the user's response before proceeding to step 8.

### 8. Create GitHub Issue

Using the summary from step 7, create a GitHub issue:

```bash
gh issue create \
  --title "[Project] ${PROJECT_NAME}" \
  --body "$(cat <<EOF
## Summary
[Insert user's provided summary here]

## Project Folder
\`${PROJECT_PATH}/\`

## Documents
- Research: \`${PROJECT_NAME}_research.md\`
- Planning: \`${PROJECT_NAME}_planning.md\`
- Progress: \`${PROJECT_NAME}_progress.md\`

---
*Created via /initialize command*
EOF
)"
```

Capture the issue URL from the output.

### 9. Output Summary

Display this completion message:

```
Project initialized successfully!

Branch: fix/${PROJECT_NAME} (based on origin/main)
Folder: ${PROJECT_PATH}/
Documents created:
   - ${PROJECT_NAME}_research.md
   - ${PROJECT_NAME}_planning.md
   - ${PROJECT_NAME}_progress.md
GitHub Issue: [issue URL]

Next steps:
1. Run /research to conduct research and populate the research doc
2. Use /plan-review after completing the planning doc
```

## Error Handling

| Error | Action |
|-------|--------|
| No project name | Abort with usage message |
| Branch exists | Abort with error message |
| Folder exists | Abort with error message |
| git fetch fails | Warn user but continue (may be offline) |
| gh not authenticated | Warn user, skip issue creation, continue with folder setup |
| mkdir fails | Abort with file system error |
