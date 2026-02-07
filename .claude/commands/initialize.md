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
# BRANCH_NAME will be set after asking user for branch type
```

**Validation:**
- If `$ARGUMENTS` is empty, abort with: "Error: Project name required. Usage: /initialize <project-name>"
- Check if folder exists using this exact command format:
  ```bash
  [ -d docs/planning/PROJECT_NAME_DATE ] && echo EXISTS || echo NOT_EXISTS
  ```

### 1.5. Ask for Branch Type

**YOU MUST use AskUserQuestion** to get the branch type prefix:

Present the following options:
- `feat` - New feature or enhancement (Recommended for most projects)
- `fix` - Bug fix or correction
- `chore` - Maintenance, refactoring, or tooling
- `docs` - Documentation only changes

Store the selected type and construct the branch name:

```bash
BRANCH_TYPE="[user's selection]"  # e.g., "feat", "fix", "chore", "docs"
BRANCH_NAME="${BRANCH_TYPE}/${PROJECT_NAME}"
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

### 2.1. Handle Pre-existing Uncommitted Files

After branch creation, check for files that carried over from the previous branch:

```bash
git status --porcelain
```

If output is empty, continue silently to Step 2.5.

If files exist:

1. **Display warning with file list and origins:**
   ```
   Pre-existing uncommitted files detected:
   ```

   For each file, show status and origin explanation:
   ```
   ?? docs/papers/           <- Untracked directory (created on previous branch)
    M src/lib/utils.ts      <- Modified file (changes from previous branch)
   ```

2. **For EACH file, use AskUserQuestion** (single-select, one file at a time):
   - Question: "File `[filename]` carried over from previous branch.\n\n**Status**: [explanation]\n\nWhat should I do?"
   - Options:
     1. "Leave it" — keep file as-is, handle during /finalize later
     2. "Commit it now" — stage and commit immediately
     3. "Add to .gitignore" — gitignore and commit
     4. "Delete it" — remove using git clean/checkout

3. **Process choice** using safe git commands:
   - For "Leave it": Continue to next file (no action)
   - For "Commit it now":
     ```bash
     git add -- "$FILE"
     git commit -m "chore: include $FILE from previous branch"
     ```
   - For "Add to .gitignore":
     ```bash
     # For directories, use proper glob pattern
     if [[ -d "$FILE" ]]; then
       GITIGNORE_PATTERN="${FILE%/}/"
     else
       GITIGNORE_PATTERN="$FILE"
     fi

     # Avoid duplicates
     if ! grep -qxF "$GITIGNORE_PATTERN" .gitignore 2>/dev/null; then
       echo "$GITIGNORE_PATTERN" >> .gitignore
     fi

     git add -- .gitignore
     git commit -m "chore: gitignore $GITIGNORE_PATTERN"
     ```
   - For "Delete it":
     - Untracked files: `git clean -f -- "$FILE"` (or `-fd` for directories)
     - Modified files: `git checkout -- "$FILE"` to discard changes
     - Staged files: `git restore --staged -- "$FILE"` then `git checkout -- "$FILE"`

4. After all files processed (or user chooses "Leave it" for remaining), continue to Step 2.5.

### 2.5. Read Core Documentation

Before creating project files, read these three core documents to understand the codebase context:

1. **Read** `docs/docs_overall/getting_started.md` - Documentation structure and reading order
2. **Read** `docs/docs_overall/architecture.md` - System design, data flow, and tech stack
3. **Read** `docs/docs_overall/project_workflow.md` - Complete workflow for projects

These provide essential context for the project initialization.

### 2.7. Discover Relevant Project Documentation

After reading core docs, discover which additional docs in `docs/docs_overall/` and `docs/feature_deep_dives/` are relevant to this project. Do NOT include any files from `docs/planning/`.

1. **Spawn an Explore agent** using the Task tool with `subagent_type=Explore`:

   Prompt:
   ```
   Search through all markdown files in docs/docs_overall/ and docs/feature_deep_dives/
   to find documentation relevant to the project "[PROJECT_NAME]" (branch type: [BRANCH_TYPE]).

   For each file, read the first 30 lines to understand what it covers.
   Return a ranked list of the most relevant files (up to 10) with a one-line reason for each.

   Rules:
   - Only include files from docs/docs_overall/ and docs/feature_deep_dives/
   - Do NOT include any files from docs/planning/
   - Exclude the 3 core docs already read: getting_started.md, architecture.md, project_workflow.md
   ```

2. **Present results to user** via AskUserQuestion (multiSelect):

   "These docs appear relevant to your project. Select which to read now and track for updates during /finalize:"
   - [List each doc from Explore agent results with its one-line reason as the description]

3. **Read all confirmed docs** using the Read tool.

4. **Store the confirmed list** as `RELEVANT_DOCS` for use in later steps (written to `_status.json` in step 3.5, and used to pre-populate templates in steps 4 and 5).

### 3. Create Folder Structure

Use this exact command format:
```bash
mkdir -p docs/planning/PROJECT_NAME_DATE
```

### 3.5. Write Status File with Relevant Docs

Create `$PROJECT_PATH/_status.json` using the **Write tool**. Include the `relevantDocs` array so `/finalize` and other skills can identify which docs to update:

```json
{
  "branch": "${BRANCH_NAME}",
  "created_at": "[ISO timestamp]",
  "prerequisites": {},
  "relevantDocs": [
    "docs/feature_deep_dives/tag_system.md",
    "docs/docs_overall/architecture.md"
  ]
}
```

- `relevantDocs` must only contain paths under `docs/docs_overall/` or `docs/feature_deep_dives/`
- Never include paths under `docs/planning/`
- Populate from the user-confirmed list in step 2.7

### 3.8. Ask for GitHub Issue Summary (used in docs + issue)

**YOU MUST use AskUserQuestion** to get the issue summary **before** creating project documents:

Prompt: "Please provide a 3-5 sentence summary for the GitHub issue describing what this project will accomplish:"

Wait for the user's response. Store this as `ISSUE_SUMMARY` — it will be:
1. Inserted as the Problem Statement in the research doc (step 4)
2. Inserted as the Background in the planning doc (step 5)
3. Used as the body of the GitHub issue (step 8)

### 4. Create Research Document

Create `$PROJECT_PATH/${PROJECT_NAME}_research.md` using the **Write tool** with this template:

```markdown
# [Project Name] Research

## Problem Statement
[Insert ISSUE_SUMMARY from step 3.8 here — the user's 3-5 sentence project description]

## High Level Summary
[Summary of findings]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- [list each confirmed doc from step 2.7, e.g. docs/feature_deep_dives/tag_system.md]

## Code Files Read
- [list of code files reviewed]
```

Replace `[Project Name]` with the actual project name in title case.
Pre-populate the "Relevant Docs" section with the actual paths from `RELEVANT_DOCS`.

### 5. Create Planning Document

Create `$PROJECT_PATH/${PROJECT_NAME}_planning.md` using the **Write tool** with this template:

```markdown
# [Project Name] Plan

## Background
[Insert ISSUE_SUMMARY from step 3.8 here — the user's 3-5 sentence project description]

## Problem
[3-5 sentences describing the problem — refine after /research]

## Options Considered
[Concise but thorough list of options]

## Phased Execution Plan
[Incrementally executable milestones]

## Testing
[Tests to write or modify, plus manual verification on stage]

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [list each path from RELEVANT_DOCS, e.g. `docs/feature_deep_dives/tag_system.md` - brief note on what may change]
```

Pre-populate the "Documentation Updates" section with the actual paths from `RELEVANT_DOCS`.

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

### 6.5. Documentation Mapping

Set up code-to-doc mappings for any **new** documentation created by this project:

1. **Ask if new feature deep dive needed:**

   "Will this project require a new feature deep dive document?"
   - If **Yes**:
     - Prompt for doc name (e.g., `user_preferences.md`)
     - Create template in `docs/feature_deep_dives/[name].md`:
       ```markdown
       # [Feature Name]

       ## Overview
       [To be filled during implementation]

       ## Key Files
       - `src/lib/services/[service].ts` - [description]

       ## Implementation
       [To be filled during implementation]
       ```
     - Add the new doc to `relevantDocs` in `_status.json`
     - Add mapping entry to `.claude/doc-mapping.json`
   - If **No** → continue

2. **For any new deep dive doc, ask for code patterns:**

   "What code patterns will map to [new doc]?"

   Suggest based on project name, e.g.:
   - Project "add_user_preferences" → suggest `src/lib/services/preferences*.ts`

3. **Update `.claude/doc-mapping.json`:**
   - Read current mappings
   - Add new mapping entries for the new doc's patterns only
   - Validate patterns are valid globs
   - Write updated config

**Note:** Existing docs to update were already identified in step 2.7 and stored in `_status.json`. This step only handles new documentation and its code pattern mappings.

### 7. Offer to Commit Project Files

(GitHub issue summary was already collected in step 3.8.)

Use **AskUserQuestion**:
- Question: "Would you like to commit the project skeleton files now?"
- Options:
  1. "Yes, commit now (Recommended)" — run:
     ```bash
     git add -- "docs/planning/${PROJECT_NAME}"
     # Only add doc-mapping.json if it exists and was modified
     if [[ -f ".claude/doc-mapping.json" ]] && git diff --name-only | grep -q ".claude/doc-mapping.json"; then
       git add -- ".claude/doc-mapping.json"
     fi
     git commit -m "chore: initialize ${PROJECT_NAME}"
     ```
  2. "No, I'll commit later" — continue without committing

### 8. Create GitHub Issue

Using the `ISSUE_SUMMARY` from step 3.8, create a GitHub issue:

```bash
gh issue create \
  --title "[Project] ${PROJECT_NAME}" \
  --body "$(cat <<EOF
## Summary
[Insert ISSUE_SUMMARY here]

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

Run `git status --short` to capture current state.

Display this completion message:

```
Project initialized successfully!

Branch: ${BRANCH_TYPE}/${PROJECT_NAME} (based on origin/main)
Folder: ${PROJECT_PATH}/
Documents created:
   - ${PROJECT_NAME}_research.md
   - ${PROJECT_NAME}_planning.md
   - ${PROJECT_NAME}_progress.md
Relevant docs discovered and read: [count]
   - [list each path from RELEVANT_DOCS]
Documentation mappings: [list any new mappings added to .claude/doc-mapping.json]
GitHub Issue: [issue URL]

Git status:
$(git status --short)
```

If files remain uncommitted, add:
```
To commit remaining files:
  git add -A && git commit -m "chore: initialize ${PROJECT_NAME}"
```

```
Next steps:
1. Run /research to conduct research and populate the research doc
2. Use /plan-review after completing the planning doc
3. During /finalize, docs in relevantDocs (stored in _status.json) will be checked for needed updates
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
