# Analyze Cost Estimates Evolution Plan

## Background
The Cost Estimates tab for evolution run 9a49176c shows +136% estimation error, but the actual estimation accuracy is ~2.9%. The error reporting is broken due to sibling cost bleed in `execution_detail` — the same Bug B class that was fixed for `inv_cost` via `AgentCostScope.getOwnSpent()` but not for the per-phase cost breakdown inside execution_detail.

## Requirements
- Fix sibling cost bleed in GFSA execution_detail so `generation.cost` and `ranking.cost` reflect only this agent's spend
- Fix `estimationErrorPct` to use corrected actuals
- Add a push gate hook that blocks `git push` to `main` or `production` unless `/finalize` or `/mainToProd` completed successfully
- Add a Stop hook that prevents Claude from stopping while a PR targeting main/production has failing or pending CI checks

## Problem
`generateFromSeedArticle.ts` and `rankNewVariant.ts` compute per-phase costs using `ctx.costTracker.getTotalSpent()` deltas. But `getTotalSpent()` on an `AgentCostScope` delegates to the **shared** tracker — under parallel dispatch of 9 agents, each agent's generation/ranking cost captures sibling agents' concurrent LLM spend (2-7x inflation). The resulting `estimationErrorPct` in execution_detail is wildly inaccurate, and this propagates to the `cost_estimation_error_pct` run metric and up to strategy/experiment aggregates.

## Phased Execution Plan

### Phase 1: Fix sibling cost bleed in execution_detail
- [ ] Add `getOwnSpent(): number` to `V2CostTracker` interface (default: returns `getTotalSpent()`) so agents can call it without knowing whether they have a scope. In `trackBudget.ts`.
- [ ] In `generateFromSeedArticle.ts`: replace `ctx.costTracker.getTotalSpent()` deltas (lines 164, 195, 209) with `ctx.costTracker.getOwnSpent()` deltas for `generationCost`.
- [ ] In `rankNewVariant.ts`: replace `costTracker.getTotalSpent()` deltas (lines 64, 79) with `costTracker.getOwnSpent()` deltas for `rankingCost`.
- [ ] Verify `estimationErrorPct` computation (line 262 of GFSA) now uses the corrected `actualTotalCost`.

### Phase 2: Push gate hook

#### Design
`/finalize` and `/mainToProd` write a gate file after all checks pass. A PreToolUse hook on Bash intercepts `git push` and blocks unless the gate file exists and matches current HEAD.

#### Gate file: `.claude/push-gate.json` (gitignored, local-only)
```json
{ "commit": "<HEAD SHA>", "skill": "finalize", "timestamp": "2026-04-17T..." }
```

#### Hook logic: `.claude/hooks/block-push-without-gate.sh`
```
Parse command from stdin JSON
Is it `git push`? → No → exit 0 (allow)

Check exceptions (all bypass the gate):
  - Branch is hotfix/*, fix/*, docs/*, chore/* → ALLOW
  - Push target is NOT main or production (feature branch push) → ALLOW
  - Push is tags-only (--tags) → ALLOW
  - Push target is backup mirror (git push backup ...) → ALLOW

Gate check:
  - Read .claude/push-gate.json
  - Does it exist? → No → BLOCK: "Run /finalize or /mainToProd first"
  - Does .commit match current HEAD? → No → BLOCK: "Code changed since checks passed, re-run /finalize"
  - Match → ALLOW
```

#### Exceptions summary

| Scenario | Behavior | Rationale |
|----------|----------|-----------|
| Push to feature branch (not main/production) | ALLOW | WIP backup during development |
| Branch prefix `hotfix/`, `fix/`, `docs/`, `chore/` | ALLOW | Matches existing workflow bypass |
| `git push --tags` | ALLOW | Not a code push |
| `git push backup ...` | ALLOW | Mirror backup, used by /finalize mid-flow |
| Push to `main` or `production` | GATE | Requires /finalize or /mainToProd gate |

#### Files to modify
- [ ] New: `.claude/hooks/block-push-without-gate.sh` — PreToolUse hook script
- [ ] Modify: `.claude/settings.json` — add hook to Bash PreToolUse list
- [ ] Modify: `.claude/commands/finalize.md` — write gate file after all checks pass, before `git push`
- [ ] Modify: `.claude/commands/mainToProd.md` — write gate file after all checks pass, before `git push`
- [ ] Modify: `.gitignore` — add `.claude/push-gate.json`
- [ ] Modify: `.claude/hooks/enforce-bypass-safety.sh` — block edits to `push-gate.json`

### Phase 3: Stop hook for CI monitoring enforcement

#### Design
A Stop hook that prevents Claude from ending its response while a PR targeting `main` or `production` exists with failing or pending CI checks. This is a safety net — even if `/finalize` or `/mainToProd` skill logic has escape hatches, Claude physically cannot stop until CI is green.

#### Hook logic: `.claude/hooks/enforce-ci-monitoring.sh`
```
Stop hook fires (Claude tries to finish responding)

Quick exit checks:
  - Branch is hotfix/*, fix/*, docs/*, chore/* → ALLOW stop
  - No PR exists for current branch → ALLOW stop

PR target check:
  - Get PR base branch: gh pr view --json baseRefName -q '.baseRefName'
  - Base is NOT main or production → ALLOW stop

CI status check:
  - Run: gh pr checks --json name,state,conclusion
  - All checks conclusion=success → ALLOW stop
  - Any check state=pending or conclusion=failure →
      BLOCK: "PR #N targeting <base> has <N> failing/<N> pending CI checks: <list>.
              Continue monitoring and fixing until all checks pass."
  - No checks found yet (PR just created) →
      BLOCK: "PR #N targeting <base> — CI checks haven't started yet. Wait and re-check."
```

#### Timeout handling
- Hook timeout: 30 seconds (enough for `gh pr checks` API call)
- If hook times out (e.g., GitHub API slow), Claude is allowed to stop (fail-open). The push gate is the hard backstop.

#### Files to modify
- [ ] New: `.claude/hooks/enforce-ci-monitoring.sh` — Stop hook script
- [ ] Modify: `.claude/settings.json` — add Stop hook

## Testing

### Unit Tests
- [ ] `generateFromSeedArticle.test.ts` — verify `generation.cost` in execution_detail matches scope's own spend, not shared total. Mock two parallel agents and assert no cross-contamination.
- [ ] `rankNewVariant.test.ts` — verify `rankingCost` return uses own spend.
- [ ] `trackBudget.test.ts` — test `getOwnSpent()` on base `V2CostTracker` returns `getTotalSpent()` (backward compat).

### Push Gate Hook Tests
- [ ] Test hook allows feature branch pushes without gate file.
- [ ] Test hook blocks `git push origin main` without gate file.
- [ ] Test hook blocks push when gate file commit doesn't match HEAD.
- [ ] Test hook allows push when gate file commit matches HEAD.
- [ ] Test hook allows `hotfix/`, `fix/`, `docs/`, `chore/` branches.
- [ ] Test hook allows `git push backup ...`.
- [ ] Test hook allows `git push --tags`.

### Stop Hook Tests
- [ ] Test hook allows stop when no PR exists.
- [ ] Test hook allows stop when PR targets a non-main/production branch.
- [ ] Test hook blocks stop when PR targeting main has pending checks.
- [ ] Test hook blocks stop when PR targeting main has failed checks.
- [ ] Test hook allows stop when all PR checks pass.
- [ ] Test hook allows stop on hotfix/fix/docs/chore branches regardless of PR state.

### Integration Tests
- [ ] Existing integration tests should pass unchanged.

### Manual Verification
- [ ] Run a new evolution experiment with the fix, verify Cost Estimates tab shows single-digit error %.
- [ ] Attempt `git push origin main` without running /finalize — verify blocked.
- [ ] Run /finalize, then push — verify allowed.
- [ ] Make a commit after /finalize, try push — verify blocked.
- [ ] After /finalize creates PR, verify Claude cannot stop responding until CI is green.

## Verification

### A) Playwright Verification
- [ ] Navigate to a completed run's Cost Estimates tab, verify error % values are reasonable.

### B) Automated Tests
- [ ] `npm run test:unit` — all pass
- [ ] `npm run lint && npx tsc --noEmit` — clean
- [ ] `npm run build` — succeeds

## Documentation Updates
- [ ] Update `evolution/docs/cost_optimization.md` — note that execution_detail per-phase costs now use scope-isolated attribution.
- [ ] Update `docs/docs_overall/debugging.md` — Bug B section: note the fix was extended to cover execution_detail.
- [ ] Update `docs/docs_overall/project_workflow.md` — document the push gate and CI monitoring enforcement.

## Review & Discussion
[Populated by /plan-review with agent scores, reasoning, and gap resolutions]
