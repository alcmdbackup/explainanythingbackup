# Analyze Cost Estimates Evolution Plan

## Background
The Cost Estimates tab for evolution run 9a49176c shows +136% estimation error, but the actual estimation accuracy is ~2.9%. The error reporting is broken due to sibling cost bleed in `execution_detail` — the same Bug B class that was fixed for `inv_cost` via `AgentCostScope.getOwnSpent()` but not for the per-phase cost breakdown inside execution_detail.

## Requirements
- Fix sibling cost bleed in GFSA execution_detail so `generation.cost` and `ranking.cost` reflect only this agent's spend
- Fix `estimationErrorPct` to use corrected actuals
- Add a push gate hook that blocks `git push` to `main` or `production` unless `/finalize` or `/mainToProd` completed successfully
- Add a Stop hook that prevents Claude from stopping while a PR targeting main/production has failing or pending CI checks

## Problem
`generateFromSeedArticle.ts` and `rankNewVariant.ts` compute per-phase costs using `ctx.costTracker.getTotalSpent()` deltas. But `ctx.costTracker` is an `AgentCostScope` (set by `Agent.run()` at Agent.ts:34-35), and `getTotalSpent()` on a scope delegates to the **shared** tracker — under parallel dispatch of 9 agents, each agent's generation/ranking cost captures sibling agents' concurrent LLM spend (2-7x inflation). The fix is to use `getOwnSpent()` which already exists on `AgentCostScope` and is already used for `inv_cost` (Agent.ts:67).

## Phased Execution Plan

### Phase 1: Fix sibling cost bleed in execution_detail

**Approach**: `AgentCostScope` already has `getOwnSpent()`. `Agent.run()` already replaces `ctx.costTracker` with an `AgentCostScope` (Agent.ts:34-35). The scope is passed through as `V2CostTracker` in `AgentContext`. We widen `AgentContext.costTracker` to `V2CostTracker & { getOwnSpent?: () => number }` (or import `AgentCostScope` type) so agents can access `getOwnSpent()` at compile time. We do NOT add `getOwnSpent()` to the `V2CostTracker` interface — that would weaken the type contract.

- [ ] In `evolution/src/lib/core/types.ts`: widen `AgentContext.costTracker` type to `V2CostTracker & { getOwnSpent?: () => number }`. This keeps the shared-tracker contract intact while exposing scope methods when available.
- [ ] In `generateFromSeedArticle.ts`: replace `ctx.costTracker.getTotalSpent()` deltas (lines 164, 195, 209) with `ctx.costTracker.getOwnSpent?.() ?? ctx.costTracker.getTotalSpent()` for `generationCost`. The fallback preserves behavior for tests that pass a plain tracker.
- [ ] In `rankNewVariant.ts`: same pattern — replace `costTracker.getTotalSpent()` deltas (lines 64, 79) with `costTracker.getOwnSpent?.() ?? costTracker.getTotalSpent()` for `rankingCost`. Update the function signature's `costTracker` type to match.
- [ ] `estimationErrorPct` computation (GFSA line 262) automatically uses corrected `actualTotalCost = generationCost + rankingCost` — no separate change needed.

### Phase 2: Push gate hook

#### Design
`/finalize` and `/mainToProd` write a gate file after all checks pass. A PreToolUse hook on Bash intercepts `git push` and blocks unless the gate file exists and matches current HEAD. This hook runs AFTER `enforce-bypass-safety.sh` (which blocks force pushes in bypass mode) — both must pass for a push to proceed (Claude Code runs all hooks, first deny wins).

#### Gate file: `.claude/push-gate.json` (gitignored, local-only)
```json
{ "commit": "<HEAD SHA>", "skill": "finalize", "timestamp": "2026-04-17T..." }
```

The gate file is written by adding a bash step in the `/finalize` and `/mainToProd` command markdown files:
```bash
echo "{\"commit\":\"$(git rev-parse HEAD)\",\"skill\":\"finalize\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > .claude/push-gate.json
```

#### Hook logic: `.claude/hooks/block-push-without-gate.sh`

**Input parsing**: This hook uses the `matcher: "Bash"` pattern (same as `block-manual-server.sh` and `block-supabase-writes.sh`). It reads the command from the `$TOOL_INPUT` environment variable, consistent with the existing Bash-matched hooks in the project (not stdin JSON, which is used by matcher-less hooks like `enforce-bypass-safety.sh`).

```
Read command: COMMAND="$TOOL_INPUT"
Is it `git push`? → No → exit 0 (allow)

Check exceptions (all bypass the gate):
  - Branch matches ^(hotfix|fix|docs|chore)/ → ALLOW
  - Command contains "backup" as remote name (git push backup ...) → ALLOW
  - Command contains "--tags" → ALLOW
  - Push target is NOT main or production → ALLOW
    (parse remote + refspec; if no explicit refspec, check tracking branch;
     if tracking branch is not main/production, allow)

Gate check:
  - Read .claude/push-gate.json
  - Does it exist? → No → BLOCK: "Run /finalize or /mainToProd first"
  - Does .commit match `git rev-parse HEAD`? → No → BLOCK: "Code changed since checks passed, re-run /finalize"
  - Match → ALLOW
```

**Push target detection**: Parse `git push <remote> <refspec>` to extract the target branch. If no refspec is given, use `git rev-parse --abbrev-ref --symbolic-full-name @{upstream}` to find the tracking branch. If the target branch name is `main` or `production`, apply the gate. Otherwise allow. Handles: `git push origin main`, `git push -u origin HEAD` (when tracking main), `git push` (default upstream).

#### Hook interaction with enforce-bypass-safety.sh
Both hooks fire on PreToolUse/Bash. `enforce-bypass-safety.sh` runs first (listed first in settings.json). If it denies, the push is blocked regardless. If it allows, `block-push-without-gate.sh` runs next. Both must allow for the push to proceed. No conflict — they check different conditions (force-push safety vs. finalize completion).

#### Exceptions summary

| Scenario | Behavior | Rationale |
|----------|----------|-----------|
| Push to feature branch (not main/production) | ALLOW | WIP backup during development |
| Branch prefix `hotfix/`, `fix/`, `docs/`, `chore/` | ALLOW | Matches existing workflow bypass |
| `git push --tags` | ALLOW | Not a code push |
| `git push backup ...` | ALLOW | Mirror backup, used by /finalize mid-flow |
| Push to `main` or `production` | GATE | Requires /finalize or /mainToProd gate |

#### Emergency recovery
If the hook is buggy and blocks all pushes, edit `.claude/settings.json` to remove the hook entry. This file is editable (it's in the `ask` permission list, not `deny`).

#### Files to modify
- [ ] New: `.claude/hooks/block-push-without-gate.sh` — PreToolUse hook script
- [ ] Modify: `.claude/settings.json` — add hook to Bash PreToolUse list (after existing entries)
- [ ] Modify: `.claude/commands/finalize.md` — add gate file write step before `git push` in Step 7
- [ ] Modify: `.claude/commands/mainToProd.md` — add gate file write step before push
- [ ] Modify: `.gitignore` — add `.claude/push-gate.json`
- [ ] Modify: `.claude/hooks/enforce-bypass-safety.sh` — add `push-gate.json` to blocked write targets

### Phase 3: Stop hook for CI monitoring enforcement

#### Design
A Stop hook that prevents Claude from ending its response while a PR targeting `main` or `production` exists with failing or pending CI checks. Uses the Claude Code `Stop` hook event type with `"decision": "block"` output to force continuation.

**Runtime dependency**: Requires `gh` CLI authenticated. The hook checks `command -v gh` and fails open if gh is missing.

#### Hook logic: `.claude/hooks/enforce-ci-monitoring.sh`
```bash
#!/usr/bin/env bash
# Stop hook: block Claude from stopping while PR targeting main/prod has failing CI.

set -euo pipefail

# Quick exit: bypass branches
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [[ "$BRANCH" =~ ^(hotfix|fix|docs|chore)/ ]]; then exit 0; fi

# Quick exit: gh not available
if ! command -v gh &>/dev/null; then exit 0; fi

# Quick exit: no PR for current branch
PR_JSON=$(gh pr view --json number,baseRefName,statusCheckRollup 2>/dev/null || echo "")
if [[ -z "$PR_JSON" || "$PR_JSON" == "" ]]; then exit 0; fi

BASE=$(echo "$PR_JSON" | jq -r '.baseRefName // ""')
PR_NUM=$(echo "$PR_JSON" | jq -r '.number // ""')

# Only gate PRs targeting main or production
if [[ "$BASE" != "main" && "$BASE" != "production" ]]; then exit 0; fi

# Check CI status via statusCheckRollup (gh pr checks does not support --json)
PENDING=$(echo "$PR_JSON" | jq '[.statusCheckRollup[]? | select(.status != "COMPLETED")] | length' 2>/dev/null || echo "0")
FAILED=$(echo "$PR_JSON" | jq '[.statusCheckRollup[]? | select(.conclusion == "FAILURE")] | length' 2>/dev/null || echo "0")

if [[ "$PENDING" -gt 0 || "$FAILED" -gt 0 ]]; then
  cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "Stop",
    "decision": "block",
    "reason": "PR #${PR_NUM} targeting ${BASE} has ${FAILED} failed and ${PENDING} pending CI checks. Continue monitoring and fixing until all checks pass."
  }
}
EOF
  exit 0
fi

# All checks passed — allow stop
exit 0
```

#### Timeout and fail-open
- Hook timeout: 30 seconds (configurable in settings.json)
- If `gh` is missing, not authenticated, or API times out → exit 0 (allow stop)
- The push gate (Phase 2) is the hard backstop — even if this hook fails open, code can't be pushed without the gate file

#### Files to modify
- [ ] New: `.claude/hooks/enforce-ci-monitoring.sh` — Stop hook script
- [ ] Modify: `.claude/settings.json` — add Stop hook entry:
  ```json
  "Stop": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "bash .claude/hooks/enforce-ci-monitoring.sh",
          "timeout": 30000
        }
      ]
    }
  ]
  ```

## Testing

### Unit Tests (Phase 1)
- [ ] `generateFromSeedArticle.test.ts` — add test: create two GFSA agents sharing a cost tracker, run them concurrently, verify each agent's `execution_detail.generation.cost` reflects only its own LLM spend (no sibling bleed). Use mock LLM with known costs.
- [ ] `rankNewVariant.test.ts` — add test: pass an `AgentCostScope` as costTracker, verify `rankingCost` return equals `scope.getOwnSpent()` delta, not shared total delta.
- [ ] `trackBudget.test.ts` — existing tests for `AgentCostScope.getOwnSpent()` already cover the scope behavior (8 existing tests). No new tests needed for the scope itself.

### Hook Tests (Phases 2-3, manual)
Bash hooks in this project are not unit-tested (no test framework for hooks exists). These are verified manually:

**Push gate (`block-push-without-gate.sh`):**
- [ ] Feature branch push without gate file → allowed
- [ ] `git push origin main` without gate file → blocked
- [ ] Push with stale gate file (commit mismatch) → blocked
- [ ] Push with valid gate file → allowed
- [ ] `hotfix/`, `fix/`, `docs/`, `chore/` branches → allowed regardless
- [ ] `git push backup ...` → allowed
- [ ] `git push --tags` → allowed

**Stop hook (`enforce-ci-monitoring.sh`):**
- [ ] No PR exists → stop allowed
- [ ] PR targets non-main branch → stop allowed
- [ ] PR targeting main with pending checks → stop blocked
- [ ] PR targeting main with failed checks → stop blocked
- [ ] PR targeting main with all checks passed → stop allowed
- [ ] `hotfix/fix/docs/chore` branches → stop allowed regardless

### Integration Tests
- [ ] Existing integration tests pass unchanged (Phase 1 narrows per-invocation attribution, doesn't affect run-level totals).

### Manual Verification
- [ ] Run a new evolution experiment, verify Cost Estimates tab shows reasonable error % (should be < ~30%, not +100-300%).
- [ ] Attempt `git push origin main` without running /finalize → verify blocked.
- [ ] Run /finalize, then push → verify allowed.
- [ ] Make a commit after /finalize, try push → verify blocked.
- [ ] After /finalize creates PR, verify Claude cannot stop responding until CI is green.

## Verification

### A) Playwright Verification
- [ ] Navigate to a completed run's Cost Estimates tab, verify error % values are finite numbers and generation error is < 50%.

### B) Automated Tests
- [ ] `npm run test` — all pass
- [ ] `npm run lint && npx tsc --noEmit` — clean
- [ ] `npm run build` — succeeds

## Rollback Plan
- **Phase 1**: Revert the type widening in `AgentContext` and the `getOwnSpent` calls in GFSA/rankNewVariant. The old `getTotalSpent()` delta behavior is restored. No data migration needed.
- **Phase 2**: Remove the `block-push-without-gate.sh` entry from `.claude/settings.json`. Delete the hook script. Remove the gate-write step from finalize.md/mainToProd.md.
- **Phase 3**: Remove the Stop hook entry from `.claude/settings.json`. Delete the hook script. Claude will resume normal stop behavior.
- **Emergency**: If hooks lock out all pushes, edit `.claude/settings.json` directly (it's in the `ask` list, not `deny`).

## Documentation Updates
- [ ] Update `evolution/docs/cost_optimization.md` — note that execution_detail per-phase costs now use scope-isolated `getOwnSpent()` deltas instead of shared `getTotalSpent()` deltas.
- [ ] Update `docs/docs_overall/debugging.md` — Bug B section: note the fix was extended to cover execution_detail's generation.cost and ranking.cost.
- [ ] Update `docs/docs_overall/project_workflow.md` — document the push gate and CI monitoring enforcement hooks.

## Review & Discussion
### Iteration 1
| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 3/5 | 5 gaps — gate file gitignore, push refspec parsing, hook interaction, dual fail-open, V2CostTracker type pollution |
| Architecture & Integration | 2/5 | 3 gaps — getOwnSpent already exists on scope (don't add to V2CostTracker), Stop hook type unverified, hook interaction unspecified |
| Testing & CI/CD | 3/5 | 4 gaps — no hook test framework, rankNewVariant mock needs update, no rollback plan, CI unaware of hooks |

**Fixes applied:**
- Phase 1: Changed approach from adding `getOwnSpent()` to `V2CostTracker` → widening `AgentContext.costTracker` type with optional `getOwnSpent`. Uses `getOwnSpent?.() ?? getTotalSpent()` fallback pattern.
- Phase 2: Added push target detection logic, hook interaction clarification (both must pass, first deny wins), emergency recovery procedure, gate file write mechanism (bash in skill markdown).
- Phase 3: Added full hook script with fail-open semantics, gh dependency check, Stop hook JSON format with `decision: block`.
- Added rollback plan for all three phases.
- Fixed test script name (`npm run test` not `npm run test:unit`).
- Clarified estimationErrorPct fix is automatic (no separate step).

### Iteration 2
| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 4/5 | 2 gaps — `gh pr checks --json` doesn't exist (must use `gh pr view --json statusCheckRollup`); gate file forgery risk in normal mode |
| Architecture & Integration | 4/5 | 1 gap — push gate hook input parsing method unspecified (stdin JSON vs $TOOL_INPUT) |
| Testing & CI/CD | 4/5 | 0 gaps |

**Fixes applied:**
- Phase 3: Replaced `gh pr checks --json` with `gh pr view --json statusCheckRollup` and adjusted jq queries. Added `2>/dev/null || echo "0"` fallbacks to jq assignments to prevent set -e exits on malformed JSON.
- Phase 2: Specified hook input parsing method: uses `matcher: "Bash"` pattern, reads command via `$TOOL_INPUT` env var (same as block-manual-server.sh and block-supabase-writes.sh).
- Gate file forgery: accepted risk — in interactive mode the user can see what Claude does. enforce-bypass-safety.sh blocks it in bypass mode.

### Iteration 3-4
| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 5/5 | 0 gaps |
| Architecture & Integration | 4→5/5 | Fixed: push gate hook uses `$TOOL_INPUT` env var (matching block-manual-server.sh) |
| Testing & CI/CD | 5/5 | 0 gaps |

**CONSENSUS REACHED — iteration 4. All reviewers 5/5. Plan ready for execution.**
