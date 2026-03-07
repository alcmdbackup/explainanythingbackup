# Git & GitHub Reference Skill
<!-- Quick reference for git workflows, GitHub Actions, and backup remote management in this project. -->

## 1. Credential Locations

- **Origin PAT**: Stored in system keyring (HTTPS protocol). Never log or expose.
- **Backup PAT**: Fine-grained PAT stored in system keyring via backup account.
- **Git config**: `~/.gitconfig` (global), `.git/config` (local remotes)
- **GitHub CLI auth**: `gh auth status` to check; tokens in `~/.config/gh/`

> **Security**: Never run `git remote -v` in logs or tool output — it can expose PAT URLs if credentials are inline.

## 2. GitHub Actions Monitoring

```bash
# List recent workflow runs
gh run list --limit 10

# Watch a specific run
gh run watch <run-id>

# View failed run logs
gh run view <run-id> --log-failed

# Re-run failed jobs
gh run rerun <run-id> --failed
```

## 3. Git Workflow Patterns

### Branching
- Feature branches: `<type>/<description>_<YYYYMMDD>` (e.g., `fix/backup_push_20260306`)
- Hotfix branches: `hotfix/<description>` (bypasses workflow enforcement)
- Production: `production` branch, merged from `main` via `/mainToProd`

### Commits
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
- Co-author line: `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`

### Merges
- Feature -> main: Squash merge via PR (`/finalize`)
- Main -> production: Merge commit via PR (`/mainToProd`)

## 4. Backup Remote

### How It Works
- Remote name: `backup`
- Mirrors `origin` to a separate GitHub account/repo for redundancy
- Pushes happen in `/finalize` (Steps 3.1, 7.1) and `/mainToProd` (Step 6.1)
- Each backup push is isolated in its own block, marked "YOU MUST run", non-fatal

### Manual Sync
```bash
# Sync main branch
git fetch origin main
git push backup origin/main:refs/heads/main

# Sync current branch
git push backup HEAD --force-with-lease

# Sync production
git push backup origin/production:refs/heads/production
```

### Verify Sync
```bash
# Check if backup is behind origin (should return empty if in sync)
git fetch backup
git log backup/main..origin/main --oneline
```

### PAT Rotation
1. Generate new fine-grained PAT on backup account
2. Update credential in system keyring
3. Test: `git push backup origin/main:refs/heads/main --dry-run`

## 5. Troubleshooting

| Issue | Fix |
|-------|-----|
| `remote: Permission denied` | PAT expired or insufficient scope — rotate PAT |
| `failed to push some refs` | Remote has diverged — use `--force-with-lease` |
| `backup` remote not found | `git remote add backup <url>` (get URL from project docs) |
| GH Actions stuck | `gh run cancel <run-id>` then re-trigger |
| `http.postBuffer` errors | Already set via `-c http.postBuffer=524288000` in push commands |

> **Security reminder**: Do not run `git remote -v` in shared output — it may expose credential URLs. Use `git remote` (without `-v`) to list remote names safely.
