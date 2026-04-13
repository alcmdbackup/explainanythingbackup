# Enforce Run Fix Failing Tests Locally Before Push CI Research

## Problem Statement
We want to save on wasteful CI usage during /finalize and /mainToProd. Currently, CI failures result in repeated pushes without local verification, wasting GitHub Actions minutes. We need to add evolution E2E tests to the local /finalize run, enforce local test verification after any CI failure before resubmitting, always fix flaky test root causes rather than applying surface-level fixes, and surface previously broken tests to the user for guidance.

## Requirements (from GH Issue #962)
- We want to save on wasteful CI usage during /finalize and /mainToProd
- Add evolution E2E tests to local run for /finalize
- In both /finalize and /mainToProd, for any CI failures
    - Fix the issue
    - Run the failing tests locally to verify they pass
    - Run all tests locally and verify they pass
    - Only then can submit to CI again
- For flaky tests, always fix the root cause, never do surface-level fixes
- For previously broken tests, always surface them to the user to ask what to do

## High Level Summary

### Current State

Both `/finalize` and `/mainToProd` are implemented as `.claude/commands/` markdown files that Claude follows as instructions. They are NOT code — they are structured prompts.

**`/finalize` (.claude/commands/finalize.md, ~1002 lines):**
- Step 0: Plan-based verification gate (only tests from the Verification section of planning doc)
- Step 4: Runs all local checks (lint, tsc, build, unit, ESM, integration) in parallel phases
- Step 5: Runs `npm run test:e2e:critical` always; `npm run test:e2e:full` only with `--e2e` flag
- **Does NOT run `npm run test:e2e:evolution`** — evolution E2E tests are never run
- Step 8: CI monitoring with retry logic (max 5 iterations)
- CI retry says "Fix ALL issues locally (regardless of origin — pre-existing bugs included)" but does NOT require running specific failing tests first
- Has file change detection in Step 2a (`git diff --name-only origin/main`) but does NOT use it to decide E2E scope

**`/mainToProd` (.claude/commands/mainToProd.md, ~234 lines):**
- Step 4: Runs 5 checks (lint, tsc, build, unit, integration) without stopping on failure
- Step 4.5: Runs full E2E suite (`npm run test:e2e`) — always, no flags needed
- Step 6.2: CI monitoring with retry logic (max 5 iterations)
- CI retry says "Fix ALL issues locally" and "Re-run ALL local checks" but does NOT require running specific failing tests first
- **No mention of "previously broken" or "pre-existing" tests at all**

### Key Gaps Identified

1. **No evolution E2E in /finalize** — CI runs `test:e2e:evolution` when evolution files change, but /finalize never does
2. **No targeted local verification after CI failure** — both skills re-run ALL local checks but don't first verify the specific failing tests pass locally
3. **No flaky test root-cause guidance** — neither skill has specific instructions about diagnosing flaky tests vs applying surface-level fixes
4. **No pre-existing failure detection** — neither skill checks if failures existed on origin/main before the branch
5. **`gh pr checks` doesn't support `--json`** — both skills reference `gh pr checks --json` which doesn't exist in gh v2.45.0; must use `gh run view --json` instead

### Evolution File Detection Patterns

The CI workflow (`.github/workflows/ci.yml`) already has the exact patterns:

```bash
# Evolution-only file paths (ci.yml line 49)
EVOLUTION_ONLY_PATHS="evolution|arena|strategy-resolution|manual-experiment|src/app/admin/quality/optimization/"

# Shared/core file paths (ci.yml line 50) — trigger full suite
SHARED_PATHS="package\.json|tsconfig|next\.config|playwright\.config|jest\.config|src/lib/|src/utils/|src/types/"
```

Classification logic:
- **evolution-only**: Only evolution files changed, no shared files
- **non-evolution-only**: Only non-evolution files changed
- **full**: Shared files changed, or mixed evolution + non-evolution
- **fast**: No code files changed (docs only)

### Pre-Existing Failure Detection Approaches

**Approach A: Check main's CI status (fast, <1 min)**
```bash
gh run list --branch main --workflow ci.yml --limit 1 --json conclusion -q '.[0].conclusion'
# Returns "success" or "failure"
```
If main's CI is also failing, the failures are likely pre-existing.

**Approach B: Compare CI logs (medium, ~5 min)**
After CI failure, get the specific failing test names from logs:
```bash
gh run view <run-id> --log-failed
```
Then check if main's last CI run had the same failures.

**Approach C: Run baseline locally (slow, ~30 min)**
```bash
git stash && git checkout origin/main
npm run test:ci
git checkout - && git stash pop
```
Compare results to identify which failures are new vs pre-existing.

**Recommended**: Approach A first (quick check), then Approach B if failures found.

### Flaky Test Patterns in the Codebase

The project has 19 testing rules in `testing_overview.md` with ESLint enforcement. Common flakiness causes:
- Point-in-time checks instead of auto-waiting assertions (Rule 4)
- Fixed sleeps instead of observable conditions (Rule 2)
- Missing hydration waits (Rule 18)
- Stacked route mocks between tests (Rule 10)
- Shared mutable state without serial mode (Rule 13)

CI uses 2 retries (`retries: 2`), local uses 0. This means flaky tests may pass in CI via retry but fail locally — or vice versa.

### gh CLI Capabilities (v2.45.0)

| Command | --json support | Use for |
|---------|---------------|---------|
| `gh pr checks` | NO | Watch only (`--watch`), no structured output |
| `gh run view` | YES | Get job details, conclusion, `--log-failed` |
| `gh run list` | YES | List runs by branch/status/workflow |

The finalize.md reference to `gh pr checks --json name,bucket,link,state` is incorrect — this flag doesn't exist. The fallback approach using `gh run list` + `gh run view` is the correct path.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/docs_overall/testing_overview.md — 19 testing rules, enforcement mechanisms, CI workflow details
- docs/feature_deep_dives/testing_setup.md — four-tier testing, config files, test commands, CI caching
- docs/docs_overall/environments.md — environment matrix, CI workflows, GitHub secrets
- docs/docs_overall/debugging.md — /debug skill, tmux logs, cross-system correlation
- docs/feature_deep_dives/debugging_skill.md — four-phase debugging methodology

## Code Files Read
- `.claude/commands/finalize.md` — complete /finalize workflow (~1002 lines)
- `.claude/commands/mainToProd.md` — complete /mainToProd workflow (~234 lines)
- `.github/workflows/ci.yml` — CI pipeline with change detection, test jobs, sharding
- `.github/workflows/e2e-nightly.yml` — nightly E2E against production
- `playwright.config.ts` — Playwright projects, tags, timeouts, base URL resolution
- `package.json` — all test-related npm scripts

## Key Findings

1. **Both skills are markdown instruction files** — changes are text edits to `.claude/commands/finalize.md` and `.claude/commands/mainToProd.md`, not code changes
2. **Evolution E2E gap in /finalize** — `npm run test:e2e:evolution` exists and CI uses it, but /finalize never calls it. The evolution detection pattern from ci.yml can be reused.
3. **CI retry flow needs 3 additions**: (a) run specific failing tests locally first, (b) add flaky test root-cause guidance, (c) detect and surface pre-existing failures
4. **`gh pr checks --json` doesn't work** — need to fix the diagnostic commands in both skills to use `gh run view --json` instead
5. **No new code files needed** — all changes are edits to two `.claude/commands/` markdown files
6. **Test commands already exist**: `test:e2e:evolution`, `test:e2e:non-evolution`, `test:integration:evolution` are all defined in package.json
7. **Pre-existing detection via CI status check** is the most practical approach — `gh run list --branch main --workflow ci.yml --limit 1 --json conclusion`

## Open Questions

1. Should `/finalize` always run evolution E2E when evolution files changed, or only conditionally (like `--e2e` flag)?
   - **Recommendation**: Always run when evolution files detected (matches CI behavior)
2. Should pre-existing failure detection block finalization, or just inform the user?
   - **Recommendation**: Surface to user via AskUserQuestion with options: "Fix it anyway", "Skip and note in PR", "Abort"
3. For `/mainToProd`, should the full E2E suite include evolution tests separately, or is `npm run test:e2e` sufficient?
   - **Answer**: `npm run test:e2e` already includes evolution-tagged tests (no grep filter), so current behavior is correct
4. Should we add a `--log-failed` parsing step to extract specific test file paths from CI output?
   - **Recommendation**: Yes — parse test file paths so we can run `npx playwright test <specific-file>` or `jest <specific-file>` locally
