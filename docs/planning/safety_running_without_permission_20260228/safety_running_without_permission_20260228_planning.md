# Safety Running Without Permission Plan

## Background
I want safeguards so when I run in --dangerously-skip-permissions, nothing is permanently lost and I have Github backup and settings are not changed.

## Requirements (from GH Issue #593)
- Safeguards when running Claude Code with --dangerously-skip-permissions
- Nothing is permanently lost (code, files, data)
- GitHub backup exists before dangerous operations
- Settings files are not changed by Claude Code in skip-permissions mode

## Problem

When running Claude Code with `--dangerously-skip-permissions`, all permission prompts are skipped — any tool call that would normally ask the user is auto-approved. While deny rules, hooks, and sandbox still enforce, the current configuration has 18 identified threat vectors (5 CRITICAL, 9 HIGH, 4 MEDIUM). The root cause is overly broad wildcard allow rules in `settings.json` that auto-approve destructive commands like `sed -i`, `echo >`, `tee`, `git push --force`, and `gh issue create` with command substitution. Additionally, critical files (CLAUDE.md, hooks, root settings.json) have no OS-level write protection, making them modifiable via any allowed bash command.

## Options Considered

### Option A: Always-On Hardening Only
Add deny rules and chmod/chattr to all critical files regardless of mode. Tighten allow list wildcards.
- **Pros**: Simplest, protects in all modes, no conditional logic
- **Cons**: May over-restrict in normal interactive mode, can't add backup push without noise

### Option B: Conditional Hooks Only
Use `permission_mode` field in hook stdin JSON to detect bypass mode and enforce extra rules.
- **Pros**: Zero friction in normal mode, all enforcement conditional
- **Cons**: Hooks can be bypassed (T2, T12), relies on pattern matching which has gaps

### Option C: Layered Defense (Recommended)
Combine always-on hardening (deny rules, chmod, chattr, tightened allows) with conditional hooks (backup push, aggressive command blocking in bypass mode only).
- **Pros**: Defense in depth — OS-level protections cover hook bypass gaps, hooks catch what deny rules miss, backup ensures recovery
- **Cons**: More setup, but each layer is independently valuable

**Decision: Option C — Layered Defense**

## Phased Execution Plan

### Phase 1: Add Deny Rules to `.claude/settings.json`
**Goal**: Block the most dangerous operations at the deny-rule level (always enforced, even in skip-permissions mode).

Add these deny rules to the existing `permissions.deny` array in `.claude/settings.json`:

```json
"deny": [
  // --- Existing deny rules (keep) ---
  "Bash(bash:*)",
  "Bash(curl:*)",
  "Bash(node:*)",
  "Bash(gh api:*)",
  "Bash(supabase link --project-ref qbxhivoezkfbjbsctdzo:*)",
  "Bash(supabase db push:*)",
  "mcp__supabase__apply_migration",
  "mcp__supabase__execute_sql",

  // --- NEW: Protect critical files from Edit/Write ---
  "Edit(CLAUDE.md)",
  "Write(CLAUDE.md)",
  "Edit(.claude/hooks/**)",
  "Write(.claude/hooks/**)",
  "Edit(.claude/doc-mapping.json)",
  "Write(.claude/doc-mapping.json)",
  "Edit(settings.json)",
  "Write(settings.json)",

  // --- NEW: Block destructive git operations ---
  "Bash(git push --force:*)",
  "Bash(git push --force-with-lease:*)",
  "Bash(git push -f:*)",
  "Bash(git reset --hard:*)",
  "Bash(git branch -D:*)",
  "Bash(git clean -f:*)",
  "Bash(git checkout -- .:*)",
  "Bash(git restore -- .:*)",
  "Bash(git apply:*)",
  "Bash(git stash drop:*)",
  "Bash(git stash clear:*)",
  "Bash(git add -A:*)",
  "Bash(git add .:*)",
  "Bash(git commit --amend:*)",

  // --- NEW: Block dangerous system commands ---
  "Bash(rm -rf:*)",
  "Bash(chmod:*)",
  "Bash(chown:*)",
  "Bash(ln -s:*)",

  // --- NEW: Block docker escape ---
  "Bash(docker run:*)",
  "Bash(docker exec:*)",
  "Bash(docker-compose:*)"
]
```

**Verification**: Run `claude --dangerously-skip-permissions` and attempt each denied command — should see deny messages.

### Phase 2: Tighten Allow List in `settings.json` (root)
**Goal**: Reduce wildcard attack surface by scoping broad allows to specific use cases.

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

**Note**: Each removal/scoping should be tested individually to avoid breaking normal workflows. If a scoped rule proves too restrictive, widen it minimally.

### Phase 3: Create Conditional Hooks
**Goal**: Add bypass-mode-only enforcement for patterns that deny rules can't catch, and automatic backup on session start.

#### 3a: Create `enforce-bypass-safety.sh` (PreToolUse hook)

Matches on `Bash` tool. Reads `permission_mode` from stdin JSON. In normal mode, exits 0 immediately. In bypass mode, blocks:
- File writes (via redirect, tee, sed -i, cp, mv, etc.) targeting protected files
- Force push (any variant)
- Destructive git operations (reset --hard, clean, checkout --, stash drop/clear)
- Docker commands
- Data exfiltration via `gh issue create --body "$(...)"` or `gh gist create`
- Mass process kills
- `rm -rf` on project directories (src, docs, .claude, .git)

See research doc for full script implementation.

#### 3b: Create `backup-on-bypass.sh` (SessionStart hook)

Only activates in bypass mode. Actions:
1. Push current branch to remote (non-force, 15s timeout)
2. Create timestamped backup tag `backup/pre-bypass-YYYYMMDDTHHMMSSZ`
3. Push tag to remote (10s timeout)
4. Log to stderr for audit trail
5. Never blocks session start (all failures caught with `|| true`)

Must be first in SessionStart array (runs before `fresh-branch-on-startup.sh`).

#### 3c: Wire hooks into `.claude/settings.json`

Add `backup-on-bypass.sh` as first SessionStart hook entry. Add `enforce-bypass-safety.sh` as first PreToolUse hook for Bash matcher.

### Phase 4: OS-Level File Protection
**Goal**: Make critical files immutable as defense-in-depth against hook bypass vectors (variable indirection, symlinks, git apply).

```bash
# Read-only (survives most attacks)
chmod 444 CLAUDE.md settings.json .claude/doc-mapping.json
chmod 444 .claude/hooks/*.sh

# Directory permissions (prevent new file creation)
chmod 555 .claude/hooks .claude/commands

# Immutable flag (survives even root-level tools, requires sudo to undo)
sudo chattr +i CLAUDE.md settings.json .claude/doc-mapping.json
sudo chattr +i .claude/hooks/*.sh
```

**Convenience script**: Create `scripts/protect-files.sh` and `scripts/unprotect-files.sh` for toggling protection when you need to make legitimate edits.

### Phase 5: Cleanup and Hardening
**Goal**: Remove remaining vulnerabilities and credentials.

1. **Remove `skipDangerousModePermissionPrompt`** from `~/.claude/settings.json` — this setting skips the safety warning before entering bypass mode
2. **Remove `CLAUDE_global_backup.md`** from git tracking — contains email + password
   ```bash
   git rm CLAUDE_global_backup.md
   echo "CLAUDE_global_backup.md" >> .gitignore
   ```
3. **Consider removing `docker` from sandbox `excludedCommands`** — unless Docker is actively used in dev workflow, it's a full sandbox escape vector
4. **Scope `npm run:*`** allow rule to specific scripts: `npm run lint:*`, `npm run build:*`, `npm run test:*`, `npm run dev:*`
5. **Add secret scanning** to `.githooks/pre-commit` — grep for common secret patterns before allowing commits

### Phase 6 (Optional): Create Managed Settings
**Goal**: System-level deny rules that cannot be overridden by any user/project settings.

Create `/etc/claude-code/managed-settings.json`:
```json
{
  "permissions": {
    "deny": [
      "Bash(docker run:*)",
      "Bash(docker exec:*)",
      "Bash(git push --force:*)",
      "Bash(git reset --hard:*)",
      "Bash(chmod:*)",
      "Bash(rm -rf:*)"
    ]
  }
}
```

**Note**: Requires sudo. Managed settings have highest precedence in Claude Code's settings hierarchy — nothing can override them.

## Testing

### Phase 1 Testing (Deny Rules)
For each new deny rule, verify in both modes:
1. Start Claude in normal mode → attempt denied command → should see deny message
2. Start Claude with `--dangerously-skip-permissions` → attempt denied command → should see deny message
3. Verify existing allowed commands still work (git push, git commit, npm run, etc.)

Key test cases:
- `git push --force origin main` → DENIED
- `git push origin HEAD` → ALLOWED
- `git reset --hard HEAD~1` → DENIED
- `rm -rf src/` → DENIED
- `docker run alpine sh` → DENIED
- `Edit(CLAUDE.md)` → DENIED
- `Write(settings.json)` → DENIED

### Phase 2 Testing (Allow List Changes)
For each modified/removed allow rule:
1. Verify the common use case still works (e.g., Read tool replaces `cat`, Edit replaces `sed`)
2. Run a typical development session and note any new prompts
3. If too many prompts appear, re-add scoped version

### Phase 3 Testing (Hooks)
1. **Normal mode**: Start session → verify `backup-on-bypass.sh` does NOT run (check no new tags)
2. **Bypass mode**: Start session → verify branch pushed and tag created
3. **Bypass mode**: Run `echo "test" | tee CLAUDE.md` → should be blocked by hook
4. **Bypass mode**: Run `git push --force origin feat/test` → should be blocked by hook
5. **Normal mode**: Run same commands → should NOT be blocked by hook (deny rules may still block)
6. **Hook self-modification test**: In bypass mode, try `echo "" > .claude/hooks/enforce-bypass-safety.sh` → should be blocked by deny rule (Phase 1) AND hook itself

### Phase 4 Testing (File Protection)
1. Verify `chmod 444` applied: `ls -la CLAUDE.md settings.json .claude/hooks/`
2. Verify `chattr +i` applied: `lsattr CLAUDE.md settings.json`
3. In bypass mode: attempt `echo "x" >> CLAUDE.md` → should fail with permission denied
4. Run `scripts/unprotect-files.sh` → verify files become writable
5. Run `scripts/protect-files.sh` → verify files become read-only again

### Phase 5 Testing
1. Verify `skipDangerousModePermissionPrompt` removed: `cat ~/.claude/settings.json | jq .skipDangerousModePermissionPrompt` → null
2. Verify `CLAUDE_global_backup.md` no longer tracked: `git ls-files CLAUDE_global_backup.md` → empty
3. Run a full development workflow to ensure nothing is broken

### Manual Verification Checklist
- [ ] Normal interactive mode works without extra friction
- [ ] Bypass mode blocks all 5 CRITICAL threats
- [ ] Bypass mode blocks all 9 HIGH threats
- [ ] GitHub backup tag created on bypass session start
- [ ] Branch pushed to remote on bypass session start
- [ ] Critical files are immutable (chattr test)
- [ ] No credentials in git-tracked files
- [ ] Convenience scripts work for protect/unprotect

## Known Limitations

These vectors cannot be fully mitigated at the hook/deny-rule level:
1. **Variable indirection**: `F="CLAUDE.md"; echo > "$F"` — mitigated by chmod/chattr only
2. **Symlink attacks**: `ln -s CLAUDE.md /tmp/x && echo > /tmp/x` — mitigated by chmod/chattr only
3. **git apply**: Patch content not visible in command string — mitigated by deny rule on `git apply`
4. **npm script injection**: Child processes of `npm run` can run anything — mitigated by scoping npm allows
5. **Subshell escapes**: `$(echo "rm -rf src")` — mitigated by chmod/chattr on critical files
6. **Deny rule pattern bugs**: Issues #18200, #11662, #15499 in Claude Code — mitigated by layered defense

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/docs_overall/architecture.md` - Add section on safety hooks and bypass-mode enforcement
- `docs/docs_overall/getting_started.md` - Add safety setup instructions for new developers
