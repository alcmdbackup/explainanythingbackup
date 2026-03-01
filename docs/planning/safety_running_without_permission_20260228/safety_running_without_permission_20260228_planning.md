# Safety Running Without Permission Plan

## Background
I want safeguards so when I run in --dangerously-skip-permissions, nothing is permanently lost and I have Github backup and settings are not changed.

## Requirements (from GH Issue #593)
- Safeguards when running Claude Code with --dangerously-skip-permissions
- Nothing is permanently lost (code, files, data)
- GitHub backup exists before dangerous operations
- Settings files are not changed by Claude Code in skip-permissions mode

## Problem

When running Claude Code with `--dangerously-skip-permissions`, all permission prompts are skipped — any tool call that would normally ask the user is auto-approved. While deny rules, hooks, and sandbox still enforce (verified via SDK docs), the current configuration has 18 identified threat vectors (5 CRITICAL, 9 HIGH, 4 MEDIUM). The root cause is overly broad wildcard allow rules in `settings.json` that auto-approve destructive commands like `sed -i`, `echo >`, `tee`, `git push --force`, and `gh issue create` with command substitution. Additionally, critical files (CLAUDE.md, hooks, root settings.json) have no OS-level write protection, making them modifiable via any allowed bash command.

## Design Principle: Conditional-First

Most restrictions should **only activate in bypass mode** to avoid friction in normal interactive mode where the user reviews every action. The `permission_mode` field in hook stdin JSON (`"bypassPermissions"` when flag is active) enables this.

**Split:**
- **Always-on (deny rules)**: Only for commands that are truly never wanted even interactively — docker escape, chmod/chown, rm -rf .git
- **Bypass-mode only (hooks)**: Everything else — force push, destructive git, file writes to protected paths, data exfiltration, backup push
- **Always-on (OS-level)**: chmod/chattr on critical files — zero UX impact since these files rarely change

## Options Considered

### Option A: Always-On Hardening Only
Add deny rules and chmod/chattr to all critical files regardless of mode. Tighten allow list wildcards.
- **Pros**: Simplest, protects in all modes, no conditional logic
- **Cons**: Over-restricts normal interactive mode, forces prompts for legitimate operations

### Option B: Conditional Hooks Only
Use `permission_mode` field in hook stdin JSON to detect bypass mode and enforce all extra rules.
- **Pros**: Zero friction in normal mode, all enforcement conditional
- **Cons**: Hooks can be bypassed if hook files are modified (mitigated by chmod/chattr)

### Option C: Conditional-First Layered Defense (Recommended)
Minimal always-on deny rules + comprehensive conditional hooks + OS-level file protection.
- **Pros**: Zero friction in normal mode, defense in depth, OS-level protections cover hook bypass gaps
- **Cons**: More setup, but each layer is independently valuable

**Decision: Option C — Conditional-First Layered Defense**

## Phased Execution Plan

### Phase 1: Minimal Always-On Deny Rules
**Goal**: Block the truly never-wanted commands at the deny-rule level. These are commands that even in normal interactive mode you'd never intentionally run.

Add to `permissions.deny` in `.claude/settings.json`:

```json
"deny": [
  // --- Existing deny rules (keep all) ---
  "Bash(bash:*)",
  "Bash(curl:*)",
  "Bash(node:*)",
  "Bash(gh api:*)",
  "Bash(supabase link --project-ref qbxhivoezkfbjbsctdzo:*)",
  "Bash(supabase db push:*)",
  "mcp__supabase__apply_migration",
  "mcp__supabase__execute_sql",

  // --- NEW: Docker escape (full sandbox bypass, never wanted) ---
  "Bash(docker run:*)",
  "Bash(docker exec:*)",
  "Bash(docker-compose:*)",

  // --- NEW: Permission manipulation (never wanted) ---
  "Bash(chmod:*)",
  "Bash(chown:*)",

  // --- NEW: Git internals destruction (never wanted) ---
  "Bash(rm -rf .git:*)"
]
```

**Why these and not others**: In normal mode, you might legitimately want to force-push a feature branch, `git reset --hard`, or edit CLAUDE.md. Those are blocked by the conditional hook in bypass mode only.

### Phase 2: Conditional Bypass-Mode Safety Hook (PreToolUse)
**Goal**: Block dangerous operations that are only risky in bypass mode (where you're not reviewing each command).

Create `.claude/hooks/enforce-bypass-safety.sh`:

```bash
#!/bin/bash
# Conditional safety enforcer: only active in --dangerously-skip-permissions mode.
# In normal interactive mode, exits immediately with zero overhead.

INPUT=$(cat)
PERMISSION_MODE=$(echo "$INPUT" | jq -r '.permission_mode // empty')

# Fast path: do nothing in normal mode
if [ "$PERMISSION_MODE" != "bypassPermissions" ]; then
  exit 0
fi

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

# Only inspect Bash commands (Edit/Write have separate protections)
if [ "$TOOL_NAME" != "Bash" ]; then
  exit 0
fi

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

deny() {
  echo "{\"hookSpecificOutput\":{\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"[BYPASS SAFETY] $1\"}}"
  exit 0
}

# --- Protected file patterns ---
PROTECTED="CLAUDE\\.md|settings\\.json|\\.claude/hooks/|\\.claude/doc-mapping|\\.claude/commands/|\\.env"

# File writes to protected paths (via redirect, tee, sed -i, cp, mv, dd, truncate, rm)
if echo "$COMMAND" | grep -qE "(>|tee |sed -i|cp |mv |dd |truncate |rm ).*($PROTECTED)"; then
  deny "Blocked: write to protected file in bypass mode"
fi

# Echo/cat redirect to protected files
if echo "$COMMAND" | grep -qE "(echo|cat|printf).*>.*($PROTECTED)"; then
  deny "Blocked: redirect to protected file in bypass mode"
fi

# Force push (any variant)
if echo "$COMMAND" | grep -qE "git push.*(--force|--force-with-lease|-f )|git push [^ ]+ \+"; then
  deny "Blocked: force push in bypass mode"
fi

# Destructive git operations
if echo "$COMMAND" | grep -qE "git (reset --hard|clean -f|checkout -- \.|restore -- \.|stash (drop|clear)|branch -D)"; then
  deny "Blocked: destructive git operation in bypass mode"
fi

# git apply (patch content not inspectable)
if echo "$COMMAND" | grep -qE "git apply"; then
  deny "Blocked: git apply in bypass mode (patch content not inspectable)"
fi

# git add -A / git add . (bulk staging)
if echo "$COMMAND" | grep -qE "git add (-A|\\.)"; then
  deny "Blocked: bulk git staging in bypass mode"
fi

# git commit --amend (rewrites last commit)
if echo "$COMMAND" | grep -qE "git commit.*--amend"; then
  deny "Blocked: commit amend in bypass mode"
fi

# Data exfiltration via gh
if echo "$COMMAND" | grep -qE "gh (gist create|issue create.*\\$\\(|pr create.*\\$\\()"; then
  deny "Blocked: potential data exfiltration in bypass mode"
fi

# Mass process kill
if echo "$COMMAND" | grep -qE "(kill -[0-9]+ -1|pkill -f \"\\.\\*\")"; then
  deny "Blocked: mass process kill in bypass mode"
fi

# rm -rf on project directories
if echo "$COMMAND" | grep -qE "rm -rf (src|docs|\.claude|node_modules|public)"; then
  deny "Blocked: recursive delete of project directory in bypass mode"
fi

# ln -s (symlink attack vector)
if echo "$COMMAND" | grep -qE "ln -s.*($PROTECTED)"; then
  deny "Blocked: symlink to protected file in bypass mode"
fi

exit 0
```

Wire into `.claude/settings.json` as first PreToolUse hook for Bash matcher.

### Phase 3: Conditional Backup Hook (SessionStart)
**Goal**: Automatically push branch and tag state to GitHub before bypass-mode sessions, ensuring recovery is always possible.

Create `.claude/hooks/backup-on-bypass.sh`:

```bash
#!/bin/bash
# Only pushes to remote when starting in bypass permissions mode.
# In normal mode, the user can manually push when they choose.

INPUT=$(cat)
PERMISSION_MODE=$(echo "$INPUT" | jq -r '.permission_mode // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

# Only activate in bypass mode
if [ "$PERMISSION_MODE" != "bypassPermissions" ]; then
  exit 0
fi

cd "$CWD" || exit 0
BRANCH=$(git branch --show-current 2>/dev/null)
[ -z "$BRANCH" ] && exit 0
[[ "$BRANCH" == "main" || "$BRANCH" == "master" ]] && exit 0

# Push to remote for backup
REMOTE=$(git remote | head -1)
[ -z "$REMOTE" ] && exit 0

timeout 15s git push "$REMOTE" "$BRANCH" 2>/dev/null || true

# Tag the pre-session state
TAG="backup/pre-bypass-$(date -u +%Y%m%dT%H%M%SZ)"
git tag "$TAG" HEAD 2>/dev/null
timeout 10s git push "$REMOTE" "$TAG" 2>/dev/null || true

echo "[BYPASS SAFETY] Backed up $BRANCH to $REMOTE and tagged $TAG" >&2
exit 0
```

Wire as first SessionStart hook entry (before `fresh-branch-on-startup.sh`).

### Phase 4: OS-Level File Protection
**Goal**: Make critical files immutable as defense-in-depth. This catches what hooks can't — variable indirection, symlinks, subshell escapes. Zero UX impact since these files rarely change.

```bash
# Read-only permissions
chmod 444 CLAUDE.md settings.json .claude/doc-mapping.json
chmod 444 .claude/hooks/*.sh

# Directory permissions (prevent new file creation)
chmod 555 .claude/hooks .claude/commands

# Immutable flag (strongest — requires sudo chattr -i to undo)
sudo chattr +i CLAUDE.md settings.json .claude/doc-mapping.json
sudo chattr +i .claude/hooks/*.sh
```

Create convenience scripts:

**`scripts/protect-files.sh`** — applies chmod 444 + chattr +i to all critical files
**`scripts/unprotect-files.sh`** — removes chattr -i + restores chmod 644/755

These are for you to run manually when you need to make legitimate edits.

### Phase 5: Tighten Allow List in `settings.json` (root)
**Goal**: Reduce wildcard attack surface. Even though the conditional hook blocks most abuse in bypass mode, tighter allows reduce the blast radius of any bypass.

| Current Rule | Action | Replacement |
|-------------|--------|-------------|
| `Bash(sed:*)` | REMOVE | Use Edit tool instead |
| `Bash(tee:*)` | REMOVE | Use Write tool instead |
| `Bash(mv:*)` | REMOVE | Ask per-use |
| `Bash(cat:*)` | REMOVE | Use Read tool instead |
| `Bash(echo:*)` | REMOVE | Use Write tool or output directly |
| `Bash(find:*)` | SCOPE | `Bash(find .:*)` |
| `Bash(git push:*)` | SCOPE | `Bash(git push origin:*)` |
| `Bash(git checkout:*)` | SCOPE | `Bash(git checkout -b:*)`, `Bash(git checkout -t:*)`, `Bash(git checkout -:*)` |
| `Bash(git stash:*)` | SCOPE | `Bash(git stash push:*)`, `Bash(git stash pop:*)`, `Bash(git stash list:*)`, `Bash(git stash show:*)` |
| `Bash(git rebase:*)` | SCOPE | `Bash(git rebase origin/:*)` |
| `Bash(timeout:*)` | SCOPE | `Bash(timeout 60 npx playwright:*)`, `Bash(timeout 300 npm:*)` |
| `Bash(kill:*)` | SCOPE | `Bash(kill %:*)` (job control only) |
| `Bash(pkill:*)` | REMOVE | Ask per-use |
| `Bash(xargs kill:*)` | REMOVE | Ask per-use |
| `Bash(gh issue create:*)` | MOVE | Move to ask rules |

**Note**: Each change should be tested individually. If a scoped rule proves too restrictive, widen minimally. This phase is lower priority than phases 1-4 since the hook already catches most abuse.

### Phase 6: Cleanup and Hardening
**Goal**: Remove remaining vulnerabilities.

1. **Remove `skipDangerousModePermissionPrompt`** from `~/.claude/settings.json`
2. **Remove `CLAUDE_global_backup.md`** from git tracking (contains credentials)
3. **Consider removing `docker` from sandbox `excludedCommands`**
4. **Scope `npm run:*`** to specific scripts: `npm run lint:*`, `npm run build:*`, `npm run test:*`, `npm run dev:*`
5. **Add secret scanning** to `.githooks/pre-commit`

### Phase 7 (Optional): Create Managed Settings
**Goal**: System-level deny rules that cannot be overridden. Highest precedence in settings hierarchy.

Create `/etc/claude-code/managed-settings.json`:
```json
{
  "permissions": {
    "deny": [
      "Bash(docker run:*)",
      "Bash(docker exec:*)",
      "Bash(chmod:*)",
      "Bash(rm -rf .git:*)"
    ]
  }
}
```

## Testing

### Phase 1 Testing (Always-On Deny Rules)
Verify in both normal and bypass mode:
- `docker run alpine sh` → DENIED in both modes
- `chmod 777 CLAUDE.md` → DENIED in both modes
- `rm -rf .git` → DENIED in both modes
- `git push --force origin main` → ALLOWED in normal mode (user prompted), still works

### Phase 2 Testing (Conditional Hook)
Test that the hook is conditional:
1. **Normal mode**: `git push --force origin feat/test` → NOT blocked by hook (user prompted as usual)
2. **Normal mode**: `echo "x" > CLAUDE.md` → NOT blocked by hook (user prompted as usual)
3. **Bypass mode**: `git push --force origin feat/test` → BLOCKED by hook
4. **Bypass mode**: `echo "x" > CLAUDE.md` → BLOCKED by hook
5. **Bypass mode**: `git push origin HEAD` → ALLOWED (non-destructive)
6. **Bypass mode**: `npm run build` → ALLOWED (normal dev command)
7. **Bypass mode**: `gh issue create --body "$(cat .env)"` → BLOCKED by hook
8. **Bypass mode**: `rm -rf src/` → BLOCKED by hook
9. **Bypass mode**: Hook self-modification `echo "" > .claude/hooks/enforce-bypass-safety.sh` → BLOCKED by hook itself + chmod/chattr (Phase 4)

### Phase 3 Testing (Backup Hook)
1. **Normal mode**: Start session → verify NO backup tag created, NO push
2. **Bypass mode**: Start session → verify branch pushed and tag created
3. **Bypass mode**: Verify tag format: `backup/pre-bypass-YYYYMMDDTHHMMSSZ`
4. **Bypass mode on main**: Start session → verify NO push (main excluded)

### Phase 4 Testing (File Protection)
1. `ls -la CLAUDE.md settings.json .claude/hooks/` → mode 444
2. `lsattr CLAUDE.md settings.json` → immutable flag set
3. In bypass mode: `echo "x" >> CLAUDE.md` → permission denied (OS-level)
4. `scripts/unprotect-files.sh` → files writable
5. `scripts/protect-files.sh` → files read-only again

### Phase 5 Testing (Allow List)
1. Remove one rule at a time, run a dev session, note new prompts
2. If too disruptive, re-add scoped version
3. Verify Claude still has Read/Edit/Write tools as alternatives

### Manual Verification Checklist
- [ ] Normal interactive mode works with ZERO extra friction
- [ ] Bypass mode blocks all 5 CRITICAL threats
- [ ] Bypass mode blocks all 9 HIGH threats
- [ ] Backup tag + push happens only in bypass mode
- [ ] Critical files are immutable via chattr
- [ ] Hook is a no-op in normal mode (check with `time` on hook execution)
- [ ] No credentials in git-tracked files
- [ ] Convenience scripts work for protect/unprotect

## Known Limitations

These vectors cannot be fully mitigated at the hook level:
1. **Variable indirection**: `F="CLAUDE.md"; echo > "$F"` — mitigated by chmod/chattr (Phase 4)
2. **Symlink attacks**: `ln -s CLAUDE.md /tmp/x && echo > /tmp/x` — mitigated by chmod/chattr (Phase 4)
3. **git apply**: Patch content not visible in command string — blocked by hook pattern match
4. **npm script injection**: Child processes of `npm run` can run anything — mitigated by scoping npm allows (Phase 5)
5. **Subshell escapes**: `$(echo "rm -rf src")` — mitigated by chmod/chattr on critical files
6. **Deny rule pattern bugs**: Issues #18200, #11662, #15499 — mitigated by using hooks instead of deny rules for most blocking

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/docs_overall/architecture.md` - Add section on safety hooks and bypass-mode enforcement
- `docs/docs_overall/getting_started.md` - Add safety setup instructions for new developers
