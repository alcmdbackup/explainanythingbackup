# Modify Finalize To Create And Monitor PR Research

## Problem Statement
I want the /finalize command to not just create the PR, but keep monitoring it until it succeeds. If it fails, then fix all issues, resubmit, and keep monitoring. Also, /finalize should fix all bugs encountered regardless of origin. Add this specific instruction.

## Requirements (from GH Issue #394)
I want the /finalize command to not just create the PR, but keep monitoring it until it succeeds. If it fails, then fix all issues, resubmit, and keep monitoring. Also, /finalize should fix all bugs encountered regardless of origin. Add this specific instruction.

## High Level Summary

Two changes needed to `.claude/commands/finalize.md`:

1. **Add PR monitoring loop (new Step 8)** — After creating the PR, monitor CI checks via `gh pr checks`. If any check fails, read failure details, fix locally, commit, push, and re-monitor. Loop until all pass or max iterations reached.

2. **Remove "regardless of origin" exemptions** — Currently Step 3.7 (code review) explicitly tells agents to IGNORE pre-existing bugs and issues on unmodified lines. This conflicts with the requirement to fix all bugs regardless of origin. Also add explicit instruction to Step 4.

## Current State Analysis

### Finalize Skill Location
- **File**: `.claude/commands/finalize.md` (751 lines)
- **Format**: YAML frontmatter + markdown workflow steps
- **Allowed tools**: `Bash(git:*), Bash(npm:*), Bash(npx:*), Bash(gh:*), Read, Edit, Write, Grep, Glob, AskUserQuestion, Task`

### Current Workflow (Steps 1-7)
1. Agent-based plan assessment (4 parallel Explore agents)
2. Test coverage verification
3. Fetch and rebase on origin/main
3.5. Code simplification (parallel agents)
3.7. Code review (5 parallel agents + confidence scoring)
4. Run checks locally (lint, tsc, build, unit, integration) — fix-and-retry
5. E2E tests (optional, `--e2e` flag)
6. Documentation updates (via doc-mapping.json)
6.5. Commit changes
6.6. Verify clean working tree
7. Push and create PR ← **workflow ends here**

### What Happens After PR Creation (Currently)
Nothing. The skill displays the PR URL and exits. CI checks run asynchronously on GitHub but /finalize doesn't monitor them.

### CI Checks That Run on PRs to Main (from `.github/workflows/ci.yml`)

| Job | Command | Condition | Dependencies |
|-----|---------|-----------|--------------|
| detect-changes | `git diff --name-only` | Always | (root) |
| typecheck | `npx tsc --noEmit --project tsconfig.ci.json` | Always | detect-changes |
| lint | `npm run lint` | Always | detect-changes |
| unit-tests | `npm run test:ci -- --changedSince="origin/${BASE_REF}"` + `npm run test:esm` | path == 'full' | detect-changes, typecheck, lint |
| integration-critical | `npm run test:integration:critical` | path == 'full' && base == main | detect-changes, unit-tests |
| e2e-critical | `npm run test:e2e:critical` | path == 'full' && base == main | detect-changes, unit-tests |

**Check names as they appear in `gh pr checks`:**
```
CI / Detect Changes
CI / TypeScript Check
CI / Lint
CI / Unit Tests
CI / Integration Tests (Critical)
CI / E2E Tests (Critical)
```

**Estimated total CI time for PR to main: ~7-10 min** (parallel: typecheck+lint, then unit-tests, then e2e+integration in parallel)

### Key Difference: Local vs CI Checks
| Aspect | Local (Step 4) | CI |
|--------|---------------|-----|
| TypeScript config | `tsconfig.json` | `tsconfig.ci.json` |
| Unit test scope | All tests | `--changedSince` (affected only) |
| ESM tests | Not run | `npm run test:esm` |
| E2E tests | Optional (`--e2e`) | Always for code changes |
| Environment | Local env vars | GitHub secrets (staging) |

CI may catch issues local checks miss due to different tsconfig, env, concurrency, and E2E inclusion.

### "Regardless of Origin" — Current False Positive Guidance (Step 3.7b, lines 472-481)
```
Issues to IGNORE:
- Pre-existing issues not introduced by this branch    ← CONFLICTS with requirement
- Issues a linter, typechecker, or compiler would catch
- Pedantic nitpicks a senior engineer wouldn't call out
- General quality issues unless explicitly required in CLAUDE.md
- Issues silenced by lint-ignore comments
- Intentional functionality changes related to the broader change
- Issues on lines not modified in this branch           ← CONFLICTS with requirement
```

Two bullet points directly conflict with the "fix all bugs regardless of origin" requirement.

### Current Step 4 Instruction (line 485)
```
Run each check. If it fails, fix the issues and re-run until it passes:
```
No explicit mention of fixing pre-existing issues — the instruction is ambiguous about origin.

### Confidence Scoring Rubric (Step 3.7c, lines 433-437)
```
  0: False positive, doesn't stand up to scrutiny, or pre-existing issue  ← CONFLICTS
 25: Might be real, may also be false positive
 50: Verified real but may be a nitpick
 75: Verified, important, will directly impact functionality
100: Definitely real, will happen frequently
```
Score 0 includes "pre-existing issue" which conflicts with the requirement.

### Existing Retry/Loop Patterns in Codebase
| Pattern | Location | Max Iterations |
|---------|----------|----------------|
| Plan review voting | `/plan-review` | 5 |
| Code review fix-retry | `/finalize` Step 3.7 | 2 |
| Working tree cleanup | `/finalize` Step 6.6 | 50 |
| Health check retry | `e2e-nightly.yml` | 3 (10s delay) |

## `gh pr checks` Deep Dive

### Key Commands
| Command | Purpose |
|---------|---------|
| `gh pr checks` | List check runs and status |
| `gh pr checks --watch` | Block until all checks complete |
| `gh pr checks --watch --fail-fast` | Block until first failure |
| `gh pr checks --json name,state,bucket,link` | Structured output |
| `gh run view <run-id> --log-failed` | Failure logs for a run |
| `gh run list --branch <branch> --status failure` | Failed runs for branch |

### Exit Codes
| Code | Meaning |
|------|---------|
| 0 | All checks passed |
| 1 | One or more checks failed |
| 8 | Checks still pending |
| 124 | Timeout (when used with `timeout` command) |

### Critical Constraints
1. **`--watch` and `--json` are mutually exclusive** — cannot get structured output while watching
2. **No native timeout for `--watch`** — must use system `timeout` command
3. **`link` field contains job URLs, not run URLs** — must regex-extract run ID from URL path
4. **`--log-failed` was broken for PR-triggered runs** until April 2025 fix (gh >= ~2.60). Local version is 2.55.0 (Aug 2024) — may need upgrade

### Extracting Failed Run IDs
```bash
# Get unique run IDs for failed checks
gh pr checks --json link,bucket \
  --jq 'map(select(.bucket == "fail") | .link | capture("runs/(?<id>[0-9]+)") | .id) | unique | .[]'
```

### Alternative: `gh run list` (simpler for run IDs)
```bash
gh run list --branch <branch> --status failure --json databaseId,name,conclusion
```

### JSON Fields Available
`bucket`, `completedAt`, `description`, `event`, `link`, `name`, `startedAt`, `state`, `workflow`

The `bucket` field normalizes state into: `pass`, `fail`, `pending`, `skipping`, `cancel`.

## Configuration Files Relevant to /finalize

### `.claude/settings.local.json` — Permissions
Already allows:
- `Bash(gh run watch:*)` — for watching runs
- `Bash(gh pr view:*)` — for PR status
- `Bash(gh pr close:*)` — for closing PRs

No permission changes needed for PR monitoring.

### `.claude/doc-mapping.json` — Doc Automation
72 mappings from code patterns → documentation. Used by Step 6.
The mapping `.claude/**` → `docs/docs_overall/managing_claude_settings.md` means changes to finalize.md itself will trigger a doc update check.

### `.claude/hooks/check-workflow-ready.sh` — Prereq Enforcement
Blocks code edits until:
- `getting_started.md` read
- `project_workflow.md` read
- TodoWrite called
Bypassed for `hotfix/`, `fix/`, `docs/`, `chore/` branches.

## Approaches Considered

### Approach A: Add Step 8 to finalize.md (PR Monitor Loop)

After Step 7 (PR creation), add a new step:

```
Step 8: Monitor PR Checks
  1. Wait 30s for CI to start
  2. Run `gh pr checks --watch` or poll `gh pr checks --json`
  3. If all pass → display success, done
  4. If any fail:
     a. Read failure logs via `gh run view <run-id> --log-failed`
     b. Fix issues locally
     c. Commit and push
     d. Go to step 1 (max 5 iterations)
  5. If max iterations → ask user to continue or abort
```

**Pros**: Single command does everything end-to-end. User runs `/finalize` and walks away.
**Cons**: Makes an already-long skill (751 lines) even longer. Long-running process (CI can take 10+ min).

### Approach B: Separate /pr-monitor Command

Create a new `.claude/commands/pr-monitor.md` that can be called independently or chained after `/finalize`.

**Pros**: Reusable independently. Keeps /finalize focused. Can be used for any PR, not just /finalize-created ones.
**Cons**: Extra step for user. Two commands instead of one.

### Approach C: Inline with `--watch` + max iterations + user escape (RECOMMENDED)

Add Step 8 directly in finalize.md with two-phase monitoring:

**Phase 1: Watch** — Use `timeout 900 gh pr checks --watch` (15 min timeout) to block until CI completes.

**Phase 2: Handle failure** — If exit code != 0:
1. Get structured failure details: `gh pr checks --json name,bucket,link`
2. Extract failed run IDs from `link` field
3. Get failure logs: `gh run view <run-id> --log-failed` (or `gh run list --branch` if `--log-failed` is broken)
4. Fix issues locally, run local checks (Step 4 re-run), commit, push
5. Re-enter Phase 1 (max 5 cycles)
6. After each failure: ask user "Fix and retry" / "Abort monitoring"

**Why preferred**: Matches user's request ("keep monitoring until it succeeds"). Uses `gh pr checks --watch` for native polling. Clear escape hatch. Adds ~80-100 lines.

### Change 2: Remove Origin Exemptions (3 locations)

**Location 1 — Step 3.7b false positive guidance (lines 474-481):**
Remove:
```
- Pre-existing issues not introduced by this branch
- Issues on lines not modified in this branch
```
Add:
```
- Fix ALL bugs encountered regardless of whether they were introduced by this branch
```

**Location 2 — Step 3.7c confidence scoring rubric (line 433):**
Change:
```
  0: False positive, doesn't stand up to scrutiny, or pre-existing issue
```
To:
```
  0: False positive, doesn't stand up to scrutiny
```

**Location 3 — Step 4 instruction (line 485):**
Change:
```
Run each check. If it fails, fix the issues and re-run until it passes:
```
To:
```
Run each check. If it fails, fix the issues and re-run until it passes. Fix ALL bugs encountered regardless of whether they originated from this branch or pre-existed:
```

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- (none selected)

## Code Files Read
- `.claude/commands/finalize.md` (full, 751 lines) — current finalize skill definition
- `.claude/commands/initialize.md` — skill structure reference
- `.claude/commands/mainToProd.md` (full) — `gh pr view` usage pattern, conflict resolution
- `.claude/settings.json` (full) — hook infrastructure
- `.claude/settings.local.json` (full) — permission overrides incl. `gh pr` commands
- `.claude/doc-mapping.json` (full) — 72 code→doc mappings for Step 6
- `.claude/hooks/check-workflow-ready.sh` — prereq enforcement
- `.claude/hooks/track-prerequisites.sh` — automatic prereq tracking
- `.claude/hooks/block-silent-failures.sh` — code quality enforcement
- `.claude/hooks/check-test-patterns.sh` — test quality enforcement
- `.github/workflows/ci.yml` (full) — CI pipeline for PRs (6 jobs, cost-optimized)
- `.github/workflows/e2e-nightly.yml` (full) — retry/health-check patterns
- `.github/workflows/post-deploy-smoke.yml` — post-deploy monitoring pattern
- `.claude/skills/plan-review/SKILL.md` — iterative loop pattern reference
- `.claude/skills/debug/SKILL.md` — error handling pattern reference
- `package.json` (scripts section) — all test commands available
