# Project Workflow Checks - Planning

Redesign workflow enforcement to be project-centric: one branch = one project folder, with status tracked in the project directory rather than ephemeral /tmp files.

## Key Design Decisions

1. **Branch = Project**: Branch name derived from project folder (e.g., `project_workflow_checks_20260108`)
2. **Status in project**: `_status.json` lives in project folder, not `/tmp/`
3. **On-demand servers**: Preserve existing tmux pattern, don't touch in workflow enforcement
4. **Brainstorm step**: Add between Research and Plan in workflow
5. **Block internal plans**: CLAUDE.md + hook prevents writes to `.claude/plans/`

---

## 1. Project-Branch-Status Model

**Core Concept:**
Each project lives in `/docs/planning/<project_name>_<date>/` and has a 1:1 relationship with a git branch named `<project_name>_<date>`.

**Project Folder Structure:**
```
/docs/planning/project_workflow_checks_20260108/
├── _status.json          # Workflow enforcement state
├── _research.md          # Research findings
├── _planning.md          # Brainstorm results + implementation plan
└── _progress.md          # Execution tracking
```

**Status File (`_status.json`):**
```json
{
  "project": "project_workflow_checks_20260108",
  "branch": "project_workflow_checks_20260108",
  "created_at": "2026-01-08T17:00:00-08:00",
  "prerequisites": {
    "getting_started_read": "2026-01-08T17:01:00-08:00",
    "project_workflow_read": "2026-01-08T17:02:00-08:00",
    "todos_created": "2026-01-08T17:03:00-08:00"
  }
}
```

**Key Change from Previous Design:**
- Status file moves from `/tmp/claude-session-*.json` (ephemeral, session-based) to project folder (persistent, project-based)
- Status travels with the branch and is visible in git history

---

## 2. Updated Project Workflow Steps

**Updated "Starting a New Project" in `project_workflow.md`:**

```markdown
## Starting a New Project

Before starting any new project, ensure the following requirements are met:

1. **Project path required** - Path in format `/docs/planning/project_name_date`
   (e.g., `/docs/planning/fix_bug_20251225`)
2. **Folder setup** - Create a new folder at this path
3. **Branch setup** - Create and checkout a new branch from remote main, matching the project name
   (e.g., `git fetch origin && git checkout -b fix_bug_20251225 origin/main`)
4. **Doc setup** - Create documents within this folder:
   - `_status.json` (workflow enforcement state)
   - `_research.md`
   - `_planning.md`
   - `_progress.md`
5. **Create a GitHub issue** - Include a 3-5 sentence summary
6. **Provide URL** - Share the link to the project folder
```

**Updated Execution Steps:**

```
Step 1: Research        → Populate _research.md
Step 2: Brainstorm      → Explore approaches in _planning.md (NEW)
Step 3: Plan            → Formalize chosen approach in _planning.md
Step 4: Plan Review     → /plan-review on _planning.md
Step 5: Complete Plan   → Finalize _planning.md
Step 6: Execute         → Update _progress.md per phase
Step 7: Wrap Up         → Run all checks
Step 8: Push & PR       → Push branch, rebase on origin/main to resolve conflicts, create PR
```

---

## 3. Enforcement Mechanisms

**Hook Architecture:**

| Hook | Trigger | Action |
|------|---------|--------|
| PostToolUse (Read) | Claude reads a file | If file is `getting_started.md` or `project_workflow.md`, update `_status.json` in active project |
| PostToolUse (TodoWrite) | Claude creates todos | Update `todos_created` in `_status.json` |
| PreToolUse (Edit/Write) | Claude tries to edit code | Check `_status.json` - block if prerequisites missing |
| PreToolUse (Write) | Claude writes to `.claude/plans/*` | Block with message: "Use `_planning.md` in your project folder instead" |

**How Active Project is Detected:**

```bash
# Find project folder by current branch name
BRANCH=$(git branch --show-current)
PROJECT_DIR="docs/planning/${BRANCH}"

if [ -d "$PROJECT_DIR" ]; then
  STATUS_FILE="${PROJECT_DIR}/_status.json"
fi
```

**Branch Creation Enforcement (3 layers):**

| Layer | Trigger | Action |
|-------|---------|--------|
| 1. Instructions | CLAUDE.md | Tell Claude to create branch from origin/main before project folder |
| 2. Project creation | Write to `docs/planning/*/` | Block if current branch doesn't match folder name being created |
| 3. Code editing | Edit/Write to code files | Block if branch doesn't match any project folder |

**Layer 2 Hook (project creation):**
```bash
# When Claude creates docs/planning/<name>/_planning.md
FOLDER_NAME=$(echo "$FILE_PATH" | sed 's|docs/planning/\([^/]*\)/.*|\1|')
CURRENT_BRANCH=$(git branch --show-current)

if [ "$FOLDER_NAME" != "$CURRENT_BRANCH" ]; then
  echo "BLOCKED: Branch mismatch"
  echo "Current branch: $CURRENT_BRANCH"
  echo "Project folder: $FOLDER_NAME"
  echo ""
  echo "Create the correct branch first:"
  echo "  git fetch origin && git checkout -b $FOLDER_NAME origin/main"
  exit 1
fi
```

**What's Removed (vs previous implementation):**
- No `/tmp/claude-session-*.json` - status lives in project folder
- No server startup in SessionStart - preserved from tmux on-demand pattern
- Simpler script set - fewer moving parts

---

## 4. CLAUDE.md Instructions

**Additions to CLAUDE.md:**

```markdown
## Project Planning Rules

1. **Never use internal plan files** - Do not write to `.claude/plans/`. All planning
   content goes in the project's `_planning.md` file.

2. **Active project detection** - Your active project is determined by the current
   git branch. If branch is `fix_bug_20260108`, your project folder is
   `/docs/planning/fix_bug_20260108/`.

3. **Before writing any code**, ensure:
   - You've read `/docs/docs_overall/getting_started.md`
   - You've read `/docs/docs_overall/project_workflow.md`
   - You've created todos using TodoWrite
   - Check `_status.json` in your project folder to verify

4. **Workflow phases** - Follow this order:
   - Research: Populate `_research.md` with findings
   - Brainstorm: Explore approaches in `_planning.md`
   - Plan: Formalize the chosen approach
   - Execute: Track in `_progress.md`
```

**Hook backup** - A PreToolUse hook on Write will also block writes to `.claude/plans/*` as a safety net, returning:
```
BLOCKED: Do not use internal plan files.
Write your plan to: docs/planning/<branch>/_planning.md
```

**Push & PR Workflow (Step 8):**
```bash
# 1. Fetch latest main
git fetch origin

# 2. Rebase on origin/main to resolve any conflicts
git rebase origin/main
# (resolve conflicts if any, then git rebase --continue)

# 3. Run all checks again after rebase
npm run build && npx tsc --noEmit && npm run lint && npm test

# 4. Push branch to remote
git push -u origin <branch_name>

# 5. Create PR to merge into main
gh pr create --base main --title "<project_name>" --body "..."
```

---

## 5. Files to Modify

| File | Change |
|------|--------|
| `docs/docs_overall/project_workflow.md` | Add branch setup step, add Brainstorm step, add `_status.json` to doc setup |
| `CLAUDE.md` | Add project planning rules section |
| `.claude/scripts/track-prerequisites.sh` | Update to write to project's `_status.json` instead of `/tmp/` |
| `.claude/scripts/check-workflow-ready.sh` | Update to read from project's `_status.json` |
| `.claude/settings.json` | Add PreToolUse hook to block writes to `.claude/plans/*` |

**Files to Create:**
- Template `_status.json` (or generate on project creation)

---

## 6. Phased Execution Plan

### Phase 1: Update Documentation
1. Update `project_workflow.md` with new workflow steps
2. Update `CLAUDE.md` with project planning rules

### Phase 2: Implement Scripts
1. Create/update `track-prerequisites.sh` to detect project from branch and write to `_status.json`
2. Create/update `check-workflow-ready.sh` to read from project's `_status.json`
3. Add PreToolUse hook to block writes to `.claude/plans/*`
4. Update `.claude/settings.json` with hook configuration

### Phase 3: Test & Verify
1. Create test project to verify enforcement works
2. Verify Claude blocked from Edit/Write before reading required docs
3. Verify Claude blocked from writing to `.claude/plans/*`
4. Verify on-demand servers still work (`npm run test:e2e`)

### Phase 4: Commit & Document
1. Commit all changes
2. Update progress doc

---

## 7. Verification Checklist

- [ ] New project creates `_status.json` in project folder
- [ ] Claude blocked from Edit/Write before reading required docs
- [ ] Claude blocked from writing to `.claude/plans/*`
- [ ] Status updates correctly in `_status.json`
- [ ] `npm run test:e2e` still triggers on-demand servers
- [ ] Branch name matches project folder name

---

## 8. Implementation Status

### Critical Issues Fixed

| Issue | Fix Applied |
|-------|-------------|
| **Sed command broken** | Used bash parameter expansion instead: `${FILE_PATH#*docs/planning/}` then `${temp%%/*}` |
| **Hook matcher misconception** | Configured hooks to match tool names (`Edit`, `Write`, `Read`), filtering done inside scripts |
| **Wrong hook JSON output** | Using correct format: `hookSpecificOutput.permissionDecision: "deny"` with `exit 0` |
| **_status.json tampering** | Block direct Write to `_status.json` via PreToolUse hook |
| **Bash bypasses Edit/Write** | Extended `block-manual-server.sh` to block file write patterns (`> src/`, etc.) |
| **No PreToolUse for Edit/Write** | Added to `.claude/settings.json` |

### Major Issues Fixed

| Issue | Fix Applied |
|-------|-------------|
| **Detached HEAD crashes** | Check for empty branch, `.git/rebase-merge`, `.git/rebase-apply` - allow with warning |
| **No migration path** | Legacy projects without `_status.json` are exempt; main/master branches exempt |
| **Branch switch undetected** | Store branch in `_status.json`, verify on each operation |
| **Race conditions** | Atomic mkdir locking pattern from `ensure-server.sh` |
| **Command injection** | Validate branch names with regex `^[a-zA-Z0-9/_-]+$` |
| **No override mechanism** | `WORKFLOW_BYPASS=true` env var + branch prefix exceptions (`hotfix/`, `fix/`, etc.) |

### Files Created

| File | Purpose |
|------|---------|
| `.claude/hooks/check-workflow-ready.sh` | PreToolUse for Edit/Write - checks prerequisites, blocks code edits until ready |
| `.claude/hooks/track-prerequisites.sh` | PostToolUse for Read/TodoWrite - tracks doc reads and todo creation |

### Files Modified

| File | Changes |
|------|---------|
| `.claude/settings.json` | Added PreToolUse hooks for Edit/Write, PostToolUse for Read/TodoWrite |
| `.claude/hooks/block-manual-server.sh` | Added file write blocking patterns |
| `docs/docs_overall/project_workflow.md` | Added branch setup, Brainstorm step, bypass documentation |
| `CLAUDE.md` | Added Project Planning Rules section |

### Bypass Usage

**Environment Variable:**
```bash
WORKFLOW_BYPASS=true claude
```

**Branch Prefix Exceptions:**
- `hotfix/` - Emergency production fixes
- `fix/` - Quick bug fixes
- `docs/` - Documentation changes
- `chore/` - Maintenance tasks

---

## 9. Getting Started Guide

**Q: How do I start a new project without being blocked?**

The workflow enforcement blocks code edits on branches without a matching project folder. But you can always create the project folder first because documentation files are exempt from blocking.

### Bootstrap Flow

**Step 1: Create the branch first**
```bash
git fetch origin
git checkout -b my_feature_20260108 origin/main
```
This is a Bash command (not Edit/Write), so it's never blocked.

**Step 2: Create the project folder and files**
```
docs/planning/my_feature_20260108/
├── _status.json
├── _research.md
├── _planning.md
└── _progress.md
```
These files are in `docs/planning/*`, which is **always allowed** by the file type exceptions (evaluated before project detection).

**Step 3: Complete prerequisites**
1. Read `/docs/docs_overall/getting_started.md`
2. Read `/docs/docs_overall/project_workflow.md`
3. Create todos with `TodoWrite`

**Step 4: Now code edits work!**
The project folder exists and prerequisites are tracked in `_status.json`.

### Why This Works

The `check-workflow-ready.sh` hook evaluates checks in this order:

1. **Bypass checks** - env var, detached HEAD, branch prefixes, main/master
2. **File type exceptions** - `docs/planning/*`, `docs/*`, `*.md`, config files → **exit early, always allowed**
3. **Project detection** - only reached for code files
4. **Prerequisite checks** - only if project folder exists

Because file type exceptions (step 2) are checked **before** project detection (step 3), you can always create documentation files even if no project folder exists yet.

### Quick Reference

| Action | Blocked? | Why |
|--------|----------|-----|
| `git checkout -b new_branch` | No | Bash command, not Edit/Write |
| Create `docs/planning/new_branch/_planning.md` | No | Matches `docs/planning/*` exception |
| Create `docs/planning/new_branch/_status.json` | No | Matches `docs/planning/*` exception |
| Edit `src/components/Button.tsx` (no project folder) | **Yes** | Code file, no matching project folder |
| Edit `src/components/Button.tsx` (with project folder) | Depends | Allowed if prerequisites met |
| Edit `README.md` | No | Matches `*.md` exception |
| Edit `.claude/settings.json` | No | Matches `*.json` exception (non-critical config) |
| Edit `package.json` | **Yes** | Critical config, requires project folder |
