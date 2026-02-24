# Fix Sandbox Settings Plan

## Background
Getting `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted` errors when Claude Code runs bash commands in sandbox mode. Commands fail with exit code 1 even for simple operations like `git status` and `mkdir`. Need to understand what causes this error and how to fix the sandbox configuration.

## Requirements (from GH Issue #547)
- Understand the `bwrap` (bubblewrap) loopback error and what triggers it
- Fix the sandbox settings so commands run reliably without needing `dangerouslyDisableSandbox`

## Problem
Ubuntu 24.04+ enables `kernel.apparmor_restrict_unprivileged_userns=1` by default, which blocks bubblewrap from configuring a loopback interface inside network namespaces. This causes every sandboxed bash command in Claude Code to fail, falling back to unsandboxed execution — effectively disabling all OS-level isolation (filesystem write restrictions, network domain filtering) while producing spurious errors.

## Options Considered
1. **AppArmor profile for bwrap (CHOSEN)** — Create `/etc/apparmor.d/bwrap` granting `userns` capability. Most targeted fix, preserves security for all other apps.
2. **AppArmor SRU from PPA** — Install updated AppArmor with built-in bwrap profiles. Depends on external PPA.
3. **Disable kernel restriction** — `sysctl kernel.apparmor_restrict_unprivileged_userns=0`. System-wide, reduces security.
4. **`enableWeakerNestedSandbox`** — Only appropriate for Docker environments.
5. **Disable sandbox entirely** — Eliminates all protection. Not acceptable.

## Phased Execution Plan

### Phase 1: Research (DONE)
- Identified root cause: Ubuntu AppArmor restricting unprivileged user namespaces
- Confirmed project sandbox config is correct — issue is at OS level
- Documented 5 fix options with security trade-offs

### Phase 2: Apply Fix (DONE)
Applied Fix 1 — created AppArmor profile for bwrap:

```bash
# 1. Create the profile
echo 'abi <abi/4.0>,
include <tunables/global>

profile bwrap /usr/bin/bwrap flags=(unconfined) {
  userns,
  include if exists <local/bwrap>
}' | sudo tee /etc/apparmor.d/bwrap

# 2. Reload AppArmor
sudo systemctl reload apparmor
```

Verified: sandboxed `git status` runs without bwrap errors.

### Phase 3: Documentation
- Update `docs/docs_overall/managing_claude_settings.md` with sandbox troubleshooting section
- Document the AppArmor fix for other developers on the team

## Testing
- Ran `git status --short` in sandbox mode (no `dangerouslyDisableSandbox`) — confirmed no bwrap error
- Commands now execute inside the sandbox as intended

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/docs_overall/managing_claude_settings.md` - Add sandbox troubleshooting section with the AppArmor fix
