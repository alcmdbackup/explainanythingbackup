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
DATE_SUFFIX=$(date +%Y%m%d)
PROJECT_PATH="docs/planning/${PROJECT_NAME}_${DATE_SUFFIX}"
```

**Validation:**
- If `$ARGUMENTS` is empty, abort with: "Error: Project name required. Usage: /initialize <project-name>"
- Check if folder exists:
  ```bash
  if [ -d "$PROJECT_PATH" ]; then
    echo "Error: Project folder already exists at $PROJECT_PATH. Choose a different name."
    exit 1
  fi
  ```

### 2. Create Folder Structure

```bash
mkdir -p "$PROJECT_PATH"
```

### 3. Create Research Document

Create `$PROJECT_PATH/${PROJECT_NAME}_research.md` with this template:

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

### 4. Create Planning Document

Create `$PROJECT_PATH/${PROJECT_NAME}_planning.md` with this template:

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

### 5. Create Progress Document

Create `$PROJECT_PATH/${PROJECT_NAME}_progress.md` with this template:

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

### 6. Ask for GitHub Issue Summary

**YOU MUST use AskUserQuestion** to get the issue summary:

Prompt: "Please provide a 3-5 sentence summary for the GitHub issue describing what this project will accomplish:"

Wait for the user's response before proceeding to step 7.

### 7. Create GitHub Issue

Using the summary from step 6, create a GitHub issue:

```bash
gh issue create \
  --title "[Project] ${PROJECT_NAME}" \
  --body "$(cat <<EOF
## Summary
[Insert user's provided summary here]

## Project Folder
\`docs/planning/${PROJECT_NAME}_${DATE_SUFFIX}/\`

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

### 8. Output Summary

Display this completion message:

```
Project initialized successfully!

Folder: docs/planning/${PROJECT_NAME}_${DATE_SUFFIX}/
Documents created:
   - ${PROJECT_NAME}_research.md
   - ${PROJECT_NAME}_planning.md
   - ${PROJECT_NAME}_progress.md
GitHub Issue: [issue URL]

Next steps:
1. Start research by populating the research doc
2. Use /plan-review after completing the planning doc
```

## Error Handling

| Error | Action |
|-------|--------|
| No project name | Abort with usage message |
| Folder exists | Abort with error message |
| gh not authenticated | Warn user, skip issue creation, continue with folder setup |
| mkdir fails | Abort with file system error |
