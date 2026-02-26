---
name: add-to-sandbox-whitelist
description: "Add a domain to the sandbox network allowlist in the worktree0 template settings file. Usage: /add-to-sandbox-whitelist <domain>"
argument-hint: "[domain, e.g. fonts.googleapis.com or *.example.com]"
disable-model-invocation: true
---

# Add to Sandbox Whitelist

Adds a domain to `sandbox.network.allowedDomains` in the explainanything-worktree0 template settings file so the change persists across all worktree resets.

## Execution Steps

The domain to add is: `$ARGUMENTS`

1. **Validate input**: If `$ARGUMENTS` is empty, respond with: "Usage: /add-to-sandbox-whitelist <domain>" and stop.

2. **Read the settings file**: Read `/home/ac/Documents/ac/explainanything-worktree0/.claude/settings.json`

3. **Check for duplicates**: Look in `sandbox.network.allowedDomains` for the exact domain. If already present, respond: "Domain `<domain>` is already in the allowlist." and stop.

4. **Add the domain**: Use the Edit tool to append the domain to the `allowedDomains` array. Add it as a new line before the closing `]` of the array, matching the existing formatting (8-space indent, quoted, with trailing comma on the previous last entry).

5. **Confirm**: Respond with:
   ```
   Added `<domain>` to sandbox.network.allowedDomains in explainanything-worktree0.
   This takes effect in new Claude Code sessions (restart or open a new session).
   ```
