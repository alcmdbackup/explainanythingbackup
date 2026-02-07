# Finalize Should Leave No Uncommitted Files Plan

## Background
Two Claude Code skills manage git state during project lifecycle:
- **/finalize** - Orchestrates branch completion: rebase, checks, commit, PR creation
- **/initialize** - Creates new project: branch, folder structure, skeleton docs, GitHub issue

Both should leave the repository in a well-defined state where all files are either committed or gitignored.

## Problem
Both skills can leave uncommitted files:

1. **/finalize** - Has commit steps but no final verification. Files generated during checks or after `git add -A` can slip through.

2. **/initialize** - Creates 4 project files (_status.json, research.md, planning.md, progress.md) but **never commits them**. Also doesn't show pre-existing uncommitted files that carry over during `git checkout -b`.

The user wants explicit control: every file must be either committed or gitignored - no exceptions, no silent skipping. If there's any doubt, ask.

## Options Considered

### Option A: Strict Verification with User Prompts (Recommended)
Add a verification step that runs `git status --porcelain` and for any remaining files:
1. Validates file is within repo boundaries (security)
2. Checks for sensitive file patterns before allowing commit
3. Explains where the file likely came from
4. Prompts the user with options: commit, gitignore, delete, or abort
- **Pros**: Maximum control, no surprises, user makes informed decisions
- **Cons**: May require multiple prompts if many files remain

### Option B: Auto-commit Everything
- **Cons**: May commit secrets, temp files, etc. - rejected for security reasons

### Option C: Fail Fast
- **Cons**: Poor UX - user has to restart finalization - rejected

**Decision**: Option A - Strict Verification with User Prompts

---

## Security Considerations

### 1. Secrets Detection (CRITICAL)
Before offering to commit any file, check for sensitive patterns:

```bash
# Sensitive file patterns - NEVER auto-commit, require explicit confirmation
# Case-insensitive matching recommended
SENSITIVE_PATTERNS=(
  ".env" ".env.*" "*.pem" "*.key" "*.p12" "*.pfx"
  "*credentials*" "*secret*" "*password*" "*token*"
  "id_rsa" "id_ed25519" "*.pub"
  "service-account*.json" "firebase*.json"
  ".aws/credentials" ".ssh/*" "*.keystore"
  "config/*secret*" "config/*credential*"
)
```

If file matches sensitive pattern, change prompt to:
- "⚠️ WARNING: File `[filename]` appears to contain secrets. Are you SURE you want to commit it?"
- Options: "Yes, commit anyway", "Add to .gitignore (Recommended)", "Delete it", "Abort"

### 2. Command Injection Prevention (CRITICAL)
All file paths MUST be properly quoted and use `--` to prevent interpretation as flags:

```bash
# CORRECT - safe quoting
git add -- "$FILE_PATH"
git rm --cached -- "$FILE_PATH"
rm -- "$FILE_PATH"

# WRONG - vulnerable to injection
git add $FILE_PATH
rm -rf $FILE_PATH
```

### 3. Path Validation (CRITICAL)
Before processing any file, validate it's within the repository:

```bash
# Validate file is within repo root
REPO_ROOT=$(git rev-parse --show-toplevel)
REAL_PATH=$(realpath -- "$FILE_PATH" 2>/dev/null)
if [[ ! "$REAL_PATH" == "$REPO_ROOT"/* ]]; then
  echo "ERROR: File path outside repository - skipping"
  continue
fi
```

### 4. Delete Confirmation (CRITICAL)
For "Delete it" option, require explicit confirmation for:
- Directories (could contain many files)
- Files > 100KB (might be important)

Use double-confirmation: "Are you sure you want to permanently delete `[filename]`? This cannot be undone."

### 5. .gitignore Pattern Validation
Before appending to .gitignore, validate the pattern:
```bash
# Use grep -F for literal matching (no regex needed)
if git ls-files | grep -qF "$FILE"; then
  Display "Warning: This file is currently tracked. Adding to .gitignore won't untrack it."
fi
# For directories, append trailing /
if [[ -d "$FILE" ]]; then
  GITIGNORE_PATTERN="${FILE%/}/"
else
  GITIGNORE_PATTERN="$FILE"
fi
```
- Use `grep -F` for literal matching (no regex interpretation)
- If matches tracked files, warn user before proceeding

### 6. Symlink Handling
Before processing, resolve symlinks and validate target:
```bash
# Check if path is a symlink pointing outside repo
if [[ -L "$FILE" ]]; then
  LINK_TARGET=$(readlink -f -- "$FILE" 2>/dev/null)
  if [[ ! "$LINK_TARGET" == "$REPO_ROOT"/* ]]; then
    Display "Warning: Symlink points outside repository - skipping"
    continue
  fi
fi
```

---

## Phased Execution Plan

**Note on Skill Files**: `.claude/commands/*.md` files are instruction documents that Claude reads and follows. The `allowed-tools` header in these files restricts which tools Claude can use when executing the skill. Both finalize.md and initialize.md already have appropriate allowed-tools headers that include the tools needed for this implementation (Bash with git:*, AskUserQuestion, Read, Edit, Write).

### Phase 1: Add Verification Step to finalize.md
**File**: `.claude/commands/finalize.md`

Insert new Step 6.6 between Step 6.5 (Documentation Updates) and Step 7 (Push and Create PR):

```markdown
### 6.6. Verify Clean Working Tree

Before pushing, ensure all files are either committed or gitignored.

**6.6a. Check for remaining files:**
```bash
git status --porcelain
```

**6.6b. If output is empty**: Display "Working tree clean ✓" → proceed to Step 7.

**6.6c. If files remain**, process each file with the following loop:

For EACH file in the git status output:

1. **Validate path is within repo:**
   ```bash
   REPO_ROOT=$(git rev-parse --show-toplevel)
   REAL_PATH=$(realpath -- "$FILE" 2>/dev/null)
   if [[ ! "$REAL_PATH" == "$REPO_ROOT"/* ]]; then
     Display "Skipping file outside repository: $FILE"
     continue
   fi
   ```

2. **Parse status code and determine origin:**

   | Status | Meaning | Common Origins |
   |--------|---------|----------------|
   | `??` | Untracked | New file, never staged |
   | ` M` | Modified (unstaged) | Changed in working tree |
   | `M ` | Modified (staged) | Staged but not committed |
   | `MM` | Modified (both) | Staged then modified again |
   | `A ` | Added (staged) | New file, staged |
   | `AM` | Added then modified | Staged new file, then changed |
   | ` D` | Deleted (unstaged) | Deleted in working tree |
   | `D ` | Deleted (staged) | Staged for deletion |
   | `R ` | Renamed | File was renamed |
   | `C ` | Copied | File was copied |
   | `UU` | Unmerged | Merge conflict |

   Path-based origin hints:
   | Path Pattern | Likely Origin |
   |--------------|---------------|
   | `node_modules/`, `.next/`, `dist/`, `build/` | Build artifacts (gitignore) |
   | `*.log`, `*.tmp`, `*.cache`, `*.swp` | Temp files (gitignore or delete) |
   | `.env*`, `*.key`, `*.pem`, `*secret*` | Sensitive files (gitignore, DO NOT commit) |
   | `docs/planning/*/` | Project skeleton from /initialize |
   | `src/**/*.ts`, `src/**/*.tsx` | Source modified by lint --fix |
   | `package-lock.json` | Dependency changes |

3. **Check for sensitive file patterns:**
   If file matches sensitive pattern (`.env*`, `*.key`, `*.pem`, `*secret*`, `*credential*`, `*password*`):
   - Set `IS_SENSITIVE=true`
   - Prepend "⚠️ SENSITIVE FILE" to origin explanation

4. **Use AskUserQuestion** with origin explanation:
   - Question: "[SENSITIVE WARNING if applicable]\n\nFile `[filename]` is uncommitted.\n\n**Status**: [status code meaning]\n**Origin**: [path-based explanation]\n\nWhat should I do?"
   - Options:
     1. "Commit it" — stage and commit the file (show warning for sensitive files)
     2. "Add to .gitignore" — append pattern and commit .gitignore
     3. "Delete it" — permanently remove the file (requires confirmation)
     4. "Abort finalization" — stop and let user handle manually

5. **Process user choice with safe commands:**
   - For "Commit it":
     ```bash
     git add -- "$FILE"
     git commit -m "chore: include $FILE"
     ```
   - For "Add to .gitignore":
     ```bash
     # SECURITY: Validate pattern is safe (not overly broad)
     # Reject patterns that would gitignore too much
     if [[ "$FILE" == "/*" || "$FILE" == "*" || "$FILE" == "." || "$FILE" == ".." ]]; then
       Display "ERROR: Pattern '$FILE' is too broad and would gitignore critical files. Skipping."
       # Skip this action, re-prompt user
       continue
     fi

     # Validate pattern won't ignore tracked files (use -F for literal match)
     if git ls-files | grep -qF "$FILE"; then
       Display "Warning: File is currently tracked. Adding to .gitignore won't untrack it."
     fi

     # For directories, use proper glob pattern
     if [[ -d "$FILE" ]]; then
       GITIGNORE_PATTERN="${FILE%/}/"
     else
       GITIGNORE_PATTERN="$FILE"
     fi

     # Check for duplicates before appending
     GITIGNORE_EXISTS=$(grep -qxF "$GITIGNORE_PATTERN" .gitignore && echo "true" || echo "false")
     if [[ "$GITIGNORE_EXISTS" == "false" ]]; then
       echo "$GITIGNORE_PATTERN" >> .gitignore
     fi

     git add -- .gitignore
     git commit -m "chore: gitignore $GITIGNORE_PATTERN"
     ```
   - For "Delete it":
     - **Check if confirmation needed**:
       ```bash
       # Check if directory
       if [[ -d "$FILE" ]]; then
         IS_DIR="true"
         NEEDS_CONFIRM="true"  # Always confirm directory deletion
       else
         IS_DIR="false"
         # Check file size - try GNU stat first, then BSD stat
         if FILE_SIZE=$(stat -c%s "$FILE" 2>/dev/null); then
           :  # GNU stat succeeded
         elif FILE_SIZE=$(stat -f%z "$FILE" 2>/dev/null); then
           :  # BSD stat succeeded
         else
           FILE_SIZE="0"  # Unknown size - skip size-based confirmation
         fi
         # Confirm if file > 100KB
         if [[ "$FILE_SIZE" -gt 102400 ]]; then
           NEEDS_CONFIRM="true"
         else
           NEEDS_CONFIRM="false"
         fi
       fi
       ```
     - If `IS_DIR == true` OR `NEEDS_CONFIRM == true`: Use AskUserQuestion for second confirmation: "Are you sure you want to permanently delete `[filename]`? This cannot be undone."
     - Use git commands only (no `rm` - not in allowed-tools):
       - Untracked files: `git clean -f -- "$FILE"` (or `-fd` for directories)
       - Modified files: `git checkout -- "$FILE"` to discard changes
       - Staged files: `git restore --staged -- "$FILE"` then `git checkout -- "$FILE"`
   - For "Abort": Display "Finalization aborted. Working tree has uncommitted files." and exit skill

6. **Loop with exit condition**:
   - After processing one file, run `git status --porcelain` again
   - If output is empty → exit loop, proceed to step 7
   - If files remain AND iteration < 50 → repeat from step 6.6c for next file
   - If iteration >= 50 → Display "Too many files to process individually. Please handle remaining files manually." and abort
   - **Note**: Unlike /initialize, /finalize does NOT have a "Leave it" option - user must handle each file to ensure clean working tree before PR

7. **Final confirmation**: Display "All files accounted for. Working tree is clean. ✓"
```

### Phase 2: Update Success Criteria in finalize.md
Add to the "Success Criteria" section:
- Working tree is clean (verified by `git status --porcelain` returning empty)

### Phase 3: Update Output Section in finalize.md
Add to the "Output" section:
- Working tree verification result (clean / N files handled)

### Phase 4: Update initialize.md - Handle Pre-existing Files
**File**: `.claude/commands/initialize.md`

Insert new Step 2.1 after Step 2 (Create Branch from Remote Main):

```markdown
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

3. **Process choice** using same safe git commands as Phase 1.

4. After all files processed (or user chooses "Leave it" for remaining), continue to Step 2.5.
```

**Note**: Changed from multiSelect to single-select per file for clarity and to avoid conflicting actions on same file.

### Phase 5: Update initialize.md - Move Commit Prompt BEFORE GitHub Issue
**File**: `.claude/commands/initialize.md`

**IMPORTANT**: Move the commit prompt to occur BEFORE creating the GitHub issue, so the issue references already-committed files.

Insert new Step 7.5 BEFORE Step 8 (Create GitHub Issue):

```markdown
### 7.5. Offer to Commit Project Files

Use **AskUserQuestion**:
- Question: "Would you like to commit the project skeleton files now?"
- Options:
  1. "Yes, commit now (Recommended)" — run:
     ```bash
     git add -- "docs/planning/${PROJECT_NAME}"
     # Only add doc-mapping.json if it exists and was modified
     if [[ -f ".claude/doc-mapping.json" ]]; then
       git add -- ".claude/doc-mapping.json"
     fi
     git commit -m "chore: initialize ${PROJECT_NAME}"
     ```
  2. "No, I'll commit later" — continue without committing
```

### Phase 6: Update initialize.md - Show Status at End
**File**: `.claude/commands/initialize.md`

**Step Numbering Clarification**: Current initialize.md has Steps 1-9. After inserting:
- Step 2.1 (after Step 2) - no renumbering needed (uses sub-step)
- Step 7.5 (after Step 7) - no renumbering needed (uses sub-step)
- Step 9 remains Step 9

Update Step 9 (Output Summary) to include git status:

```markdown
### 9. Output Summary

Update the existing Step 9 to display:

```
Project initialized successfully!

Branch: ${BRANCH_TYPE}/${PROJECT_NAME} (based on origin/main)
Folder: ${PROJECT_PATH}/
Documents created:
   - ${PROJECT_NAME}_research.md
   - ${PROJECT_NAME}_planning.md
   - ${PROJECT_NAME}_progress.md
...

Git status:
$(git status --short)

[If files remain uncommitted:]
To commit remaining files:
  git add -A && git commit -m "chore: initialize ${PROJECT_NAME}"
```
```

---

## Rollback & Recovery Strategy

### If skill is interrupted mid-execution:

**For /finalize:**
1. No destructive operations until Step 7 (push). User can safely re-run /finalize.
2. If interrupted during file handling loop:
   - Partial commits are safe (atomic per file)
   - Re-running will re-check all files
3. Recovery: Simply run `/finalize` again

**For /initialize:**
1. If interrupted after branch creation but before commit:
   - Project files exist but are uncommitted
   - Safe to re-run on same branch (will fail "branch exists" - user deletes and retries, or manually commits)
2. If interrupted after GitHub issue creation:
   - Issue exists, files may be uncommitted
   - User manually commits or re-runs /finalize later
3. Recovery: Check `git status`, manually commit or delete unwanted files, continue

### If git operations fail:
- Display error message with specific failure
- Show current `git status`
- Suggest manual intervention
- Do NOT attempt automatic recovery (could make things worse)

---

## Testing

### Manual Verification for /finalize:
- [ ] Run /finalize on branch with uncommitted files → prompt appears
- [ ] Verify origin explanation accuracy for each status code
- [ ] Test "Commit it" option → file is committed
- [ ] Test "Add to .gitignore" option → pattern added, .gitignore committed
- [ ] Test "Delete it" option → confirmation appears, file removed
- [ ] Test "Abort" option → exits cleanly, files remain
- [ ] Test sensitive file detection (.env, *.key) → warning appears
- [ ] Test path validation → file outside repo is skipped

### Manual Verification for /initialize:
- [ ] Run /initialize with pre-existing uncommitted files → warning and prompts appear
- [ ] Verify single-select works for each file
- [ ] Test "Leave it" → file remains, initialization continues
- [ ] Verify commit prompt appears BEFORE GitHub issue creation
- [ ] Verify git status shown at end

### Edge Cases:
- [ ] Files with spaces in names: `"my file.txt"` → properly quoted
- [ ] Files with special chars: `file$name.txt` → properly escaped
- [ ] Directories: `docs/papers/` → git clean -fd works
- [ ] Nested directories: `a/b/c/file.txt` → handled correctly
- [ ] .gitignore already has pattern → no duplicate added
- [ ] Pattern matches tracked file → warning shown
- [ ] Sensitive files → warning and "gitignore recommended"
- [ ] Very large file (>100KB) delete → double confirmation
- [ ] Merge conflict files (UU status) → appropriate message
- [ ] Symlinks pointing outside repo → skipped with warning
- [ ] > 50 files remaining → max iteration guard triggers
- [ ] User repeatedly chooses "Leave it" in /initialize → files tracked, not re-prompted (Note: /finalize does NOT have "Leave it" option)

### AskUserQuestion Behavior:
- [ ] User selects option → action executes correctly
- [ ] User closes prompt/cancels → skill handles gracefully (treat as "Abort")
- [ ] Prompt displays correctly with origin explanation

### Testing Approach Note

**Skill files are instruction documents**, not executable code. They don't have traditional unit tests. Manual verification through actual skill execution is the appropriate testing approach for Claude Code skills.

The checklists above serve as acceptance criteria - verify each behavior works during manual testing before considering the implementation complete.

### Automated Tests (Future/Optional):
If desired, integration tests could be added in `src/__tests__/integration/`:
- `skill-finalize-uncommitted.integration.test.ts`
- `skill-initialize-carryover.integration.test.ts`

These would use git fixtures to simulate uncommitted file scenarios, but are NOT required for this implementation since skills are tested through manual execution.

---

## Documentation Updates

Files to modify:
- `.claude/commands/finalize.md` - Add Step 6.6, update Success Criteria and Output
- `.claude/commands/initialize.md` - Add Step 2.1, add Step 7.5, update Step 9 output
