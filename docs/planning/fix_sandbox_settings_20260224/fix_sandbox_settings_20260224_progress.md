# Fix Sandbox Settings Progress

## Phase 1: Research (DONE)
### Work Done
- Identified root cause: Ubuntu 24.04+ AppArmor restriction (`kernel.apparmor_restrict_unprivileged_userns=1`) blocks bwrap's `RTM_NEWADDR` netlink message
- Confirmed project sandbox config is correct — not a Claude Code issue
- Documented 5 fix options ordered by security preservation
- Populated full research doc with findings, impact analysis, and sources

### Issues Encountered
- bwrap error is non-fatal — commands fall back to unsandboxed execution, but this silently disables all OS-level isolation

### User Clarifications
- User confirmed this is a fix/config project, not a feature

## Phase 2: Apply Fix (DONE)
### Work Done
- Verified bwrap at `/usr/bin/bwrap`, no existing AppArmor profile, restriction sysctl = 1
- User created AppArmor profile at `/etc/apparmor.d/bwrap` granting `userns` capability
- User reloaded AppArmor with `sudo systemctl reload apparmor`
- Verified fix: sandboxed `git status` runs without bwrap errors

### Issues Encountered
- First attempt: user pressed Ctrl+C during heredoc input — switched to `echo | sudo tee` one-liner
- Claude Code can't run `sudo` commands — user had to run fix manually in terminal

## Phase 3: Documentation (TODO)
- Update `managing_claude_settings.md` with sandbox troubleshooting section
