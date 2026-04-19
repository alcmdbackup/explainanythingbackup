# /initialize - Project Initialization

Initialize a new project folder with standard documentation structure per project_workflow.md.

## Usage

```
/initialize <project-name>
```

## Execution Steps

When invoked, you MUST follow this exact process:

### 1. Parse Input, Detect Branch Type

```bash
PROJECT_NAME="$ARGUMENTS"
```

**Date Suffix Logic:**
- If PROJECT_NAME already ends with `_YYYYMMDD` (8-digit date), use as-is.
- Otherwise, append today's date: `DATE_SUFFIX=$(date +%Y%m%d)`.

```bash
if [[ "$PROJECT_NAME" =~ _[0-9]{8}$ ]]; then
  PROJECT_PATH="docs/planning/${PROJECT_NAME}"
else
  DATE_SUFFIX=$(date +%Y%m%d)
  PROJECT_PATH="docs/planning/${PROJECT_NAME}_${DATE_SUFFIX}"
  PROJECT_NAME="${PROJECT_NAME}_${DATE_SUFFIX}"
fi
```

**Branch Type Detection (auto, no prompt):**

```bash
if [[ "$PROJECT_NAME" =~ ^fix_ ]]; then BRANCH_TYPE="fix"
elif [[ "$PROJECT_NAME" =~ ^hotfix_ ]]; then BRANCH_TYPE="hotfix"
elif [[ "$PROJECT_NAME" =~ ^chore_ ]]; then BRANCH_TYPE="chore"
elif [[ "$PROJECT_NAME" =~ ^docs_ ]]; then BRANCH_TYPE="docs"
else BRANCH_TYPE="feat"
fi
BRANCH_NAME="${BRANCH_TYPE}/${PROJECT_NAME}"
```

**Validation:**
- If `$ARGUMENTS` is empty, abort: "Error: Project name required. Usage: /initialize <project-name>"
- If folder exists (`[ -d "$PROJECT_PATH" ]`), abort: "Error: Folder $PROJECT_PATH already exists."

### 2. Create Branch from Remote Main

```bash
git fetch origin main
git checkout -b "$BRANCH_NAME" origin/main
```

If branch exists, abort. If fetch fails, warn but continue.

### 3. Handle Carryover Files

```bash
git status --porcelain
```

If empty, continue silently.

If files exist, **group by suggested action** and present ONE batched `AskUserQuestion` (multiSelect):
- Untracked directories → suggest "Add to .gitignore"
- Modified tracked files → suggest "Commit now"
- Other → suggest "Leave it"

Process each group's selected action. Do NOT loop per-file — batch by action.

### 4. Read Core Documentation

Read these core docs (always, regardless of branch type):

1. `docs/docs_overall/getting_started.md`
2. `docs/docs_overall/architecture.md`
3. `docs/docs_overall/project_workflow.md`
4. **All evolution docs** — Glob for `evolution/docs/**/*.md` and read every match. This ensures new docs added later are automatically included.

### 5. Discover and Confirm Relevant Docs

#### 5a. Manual Doc Tags (plain chat — `feat/`, `fix/`, `docs/` only; skip for `chore/` and `hotfix/`)

**PLAIN-CHAT PROMPT — DO NOT use `AskUserQuestion`.** Emit the following message as your assistant reply, then **end the turn immediately with zero tool calls**. Do not call Read, Write, Bash, Glob, Grep, Agent, or any other tool in the same turn. Do not continue to the next step. Wait for the user's next message.

> Optional: type any docs you want to track for this project (comma-separated names or paths), or reply 'skip' to skip.

When the user replies, treat the entire message body as the answer. If empty or `skip`, set `MANUAL_DOCS=[]`. Otherwise, fuzzy-match each entry against `docs/docs_overall/`, `docs/feature_deep_dives/`, `evolution/docs/`. Full path → use directly. Partial name → glob. Multiple matches → emit another plain-chat disambiguation message. Feed resolved paths into `MANUAL_DOCS`.

#### 5b. Auto-Discover Docs (`feat/` only; skip for `fix/`, `chore/`, `docs/`, `hotfix/`)

Spawn an Explore agent to rank relevant docs (up to 10) based on project name and context. Merge with `MANUAL_DOCS`, dedup. Auto-accept the top **2**; present docs 3-5 pre-checked in a single `AskUserQuestion` (multiSelect). This is the **one guaranteed `AskUserQuestion`** in the flow.

For non-`feat/` branches, `RELEVANT_DOCS = MANUAL_DOCS` (no Explore agent, no multi-select).

#### 5c. Read Confirmed Docs

Read all docs in the final `RELEVANT_DOCS` list.

### 6. Create Folder and Status File

```bash
mkdir -p "$PROJECT_PATH"
```

Write `$PROJECT_PATH/_status.json` via the Write tool:

```json
{
  "branch": "${BRANCH_NAME}",
  "created_at": "[ISO timestamp]",
  "prerequisites": {},
  "relevantDocs": ["...confirmed docs from step 5..."]
}
```

### 7. Collect Project Description (plain chat)

#### 7a. Summary

**PLAIN-CHAT PROMPT — DO NOT use `AskUserQuestion`.** Emit this message, then **end the turn with zero tool calls**. Wait for the user's reply.

> Please type a 3-5 sentence summary describing what this project will accomplish.

Store the reply as `ISSUE_SUMMARY`.

#### 7b. Detailed Requirements (`feat/` only; skip for `fix/`, `chore/`, `docs/`, `hotfix/`)

**PLAIN-CHAT PROMPT — DO NOT use `AskUserQuestion`.** Emit this message, then **end the turn with zero tool calls**. Wait for the user's reply.

> Please type the detailed requirements / task list (bullets, numbered lists, multi-line all fine).

Store the reply as `ISSUE_REQUIREMENTS`. For non-`feat/` branches, set `ISSUE_REQUIREMENTS = ""`.

#### Sanitization (applies to both 7a and 7b before writing to docs)

Before writing the user's free-text replies into any file via the Write tool:
- If the text contains any `---` on its own line, wrap the entire block inside a ````text` fenced code block to prevent frontmatter collisions.
- Do not shell-interpolate the captured string anywhere (use the Write tool directly, never `echo "$VAR"` in a heredoc).
- Apply the same sanitization to `AskUserQuestion` `Other` field content if the fallback is active.

### 8. Create Project Documents and Auto-Commit

#### 8a. Research doc (conditional)

- **`feat/`**: Write `$PROJECT_PATH/${PROJECT_NAME}_research.md` with the template (Problem Statement = `ISSUE_SUMMARY`, Requirements = `ISSUE_REQUIREMENTS`).
- **`fix/`**: Skip — lazy-created by `/research` if needed later via `bash .claude/lib/scaffold_research.sh`.
- **`chore/`, `docs/`, `hotfix/`**: Skip.

#### 8b. Planning doc (always)

Write `$PROJECT_PATH/${PROJECT_NAME}_planning.md` with the standard template. For non-`feat/` branches, use a slimmed-down template (Background = `ISSUE_SUMMARY`, skip Options Considered / Phased Execution / Testing / Verification / Documentation Updates / Review & Discussion sections). Include Requirements section only for `feat/`.

#### 8c. Progress doc (conditional)

- **`feat/`**: Write `$PROJECT_PATH/${PROJECT_NAME}_progress.md` with the standard template.
- **`fix/`**: Skip — lazy-created by `/research` if needed later via `bash .claude/lib/scaffold_progress.sh`.
- **`chore/`, `docs/`, `hotfix/`**: Skip.

#### 8d. Doc Mapping (conditional, `feat/` only, default No)

Only for `feat/` branches where the project name signals a new feature deep dive (contains `add_`, `new_`, or `create_`): use `AskUserQuestion` to ask if a new deep dive doc is needed. Default to No. If Yes, create the template and update `.claude/doc-mapping.json`. Otherwise skip entirely.

#### 8e. Auto-Commit (always, no prompt)

```bash
git add -- "$PROJECT_PATH"
git commit -m "chore: initialize ${PROJECT_NAME}"
```

### 9. Output Summary

Print completion message:

```
Project initialized!

Type:   ${BRANCH_TYPE}
Branch: ${BRANCH_NAME}
Folder: ${PROJECT_PATH}/
Docs:   [list files created]
Tracked docs: [list from RELEVANT_DOCS, or "none"]
```

**Next-step hints by branch type:**

```bash
case "$BRANCH_TYPE" in
  feat)   echo "Next: /research to populate research doc, then /plan-review" ;;
  fix)    echo "Next: /debug to investigate, or /research if scope grows" ;;
  chore)  echo "Next: start implementing" ;;
  docs)   echo "Next: start writing" ;;
  hotfix) echo "Next: ship fast" ;;
esac
```

## Branch-Type Reference

| Step | `feat/` | `fix/` | `chore/` | `docs/` | `hotfix/` |
|---|---|---|---|---|---|
| 3 Carryover | yes | yes | yes | yes | yes |
| 4 Core docs | yes | yes | yes | yes | yes |
| 5a Manual tags | yes | yes | skip | yes | skip |
| 5b Auto-discover | yes | skip | skip | skip | skip |
| 7a Summary | yes | yes | yes | yes | yes |
| 7b Requirements | yes | skip | skip | skip | skip |
| 8a Research doc | yes | lazy | skip | skip | skip |
| 8b Planning doc | full | slim | slim | slim | slim |
| 8c Progress doc | yes | lazy | skip | skip | skip |
| 8d Doc mapping | conditional | skip | skip | skip | skip |
| 8e Auto-commit | yes | yes | yes | yes | yes |

## Error Handling

| Error | Action |
|-------|--------|
| No project name | Abort with usage message |
| Branch exists | Abort with error message |
| Folder exists | Abort with error message |
| git fetch fails | Warn user but continue (may be offline) |
