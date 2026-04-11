# Hook Enforce Reading Testing Docs Before Modifying Test Files 20260409 Research

## Problem Statement
Add Claude hooks which enforce that testing_overview.md, testing_setup.md, and environments.md docs must all be read prior to modifying any files related to tests or CI.

## Requirements (from GH Issue #944)
Add Claude hooks which enforce that test_overview, test_setup, and environment.md docs must all be read prior to modifying any files related to tests or CI.

## High Level Summary

The existing hook system (`check-workflow-ready.sh` + `track-prerequisites.sh`) already enforces `testing_overview.md` as a prerequisite for test files. This project extends that system to require **all three** testing docs before modifying test or CI files.

**Changes needed:**
1. **`track-prerequisites.sh`** — add tracking for `testing_setup_read` and `environments_read` when those docs are read
2. **`check-workflow-ready.sh`** — extend `is_test_file()` to also catch CI files and missing patterns (`jest.integration-setup.js`, `jest.shims.js`, `eslint-rules/`), and require all three docs

The infrastructure for state management (atomic JSON updates, locking, bypass logic) is already in place and proven — no new patterns needed.

## Key Findings

### Finding 1: Current State — Only testing_overview.md Is Enforced

`check-workflow-ready.sh` already has `is_test_file()` (lines 191–208) and enforces `testing_overview_read`. But **`testing_setup_read` and `environments_read` are never tracked or checked** — they don't exist in the hook system at all.

```bash
# Current — only one doc required for test files
TESTING_OVERVIEW_READ=$(jq -r '.prerequisites.testing_overview_read // empty' "$STATUS_FILE")
if [ -z "$TESTING_OVERVIEW_READ" ]; then
  # deny
fi
```

### Finding 2: Two Files Need Changes

**`track-prerequisites.sh`** (lines 70–78, the elif chain) — needs two new elif blocks:
```bash
elif [[ "$FILE_PATH" == *"testing_setup.md"* ]]; then
  FIELD_TO_UPDATE=".prerequisites.testing_setup_read"
elif [[ "$FILE_PATH" == *"environments.md"* ]]; then
  FIELD_TO_UPDATE=".prerequisites.environments_read"
```

**`check-workflow-ready.sh`** (lines 191–232, the test file section) — needs:
- `is_test_file()` extended with CI files and missed patterns
- The prerequisite check updated to require all three docs

### Finding 3: Current `is_test_file()` Misses These Patterns

| File | Pattern that should catch it | Currently caught? |
|------|------------------------------|-------------------|
| `jest.integration-setup.js` | `*"jest.setup"*` | ❌ No — "jest.integration-**setup**" ≠ "jest.setup" |
| `jest.shims.js` | Neither | ❌ No |
| `jest.integration.config.js` | `*"jest.config"*` | ✅ Yes — contains "config" |
| `.github/workflows/ci.yml` | Not present | ❌ No |
| `eslint-rules/*.js` | Not present | ❌ No |
| `src/__tests__/` | `*"/__tests__/"*` | ✅ Yes |
| `src/testing/` | `*"/testing/"*` | ✅ Yes |

**Missed files to add:**
- `[[ "$path" == *"jest.shims"* ]]` — catches jest.shims.js
- `[[ "$path" == *"jest.integration-setup"* ]]` — catches jest.integration-setup.js  
- `[[ "$path" == *".github/workflows/"* ]]` — CI workflow files
- `[[ "$path" == *"eslint-rules/"* ]]` — custom ESLint flakiness rules

### Finding 4: CI Files (.github/workflows/) Should Be Included

All 5 workflow files were analyzed:
- `ci.yml` — runs full test suite, references staging/prod environments → needs ALL THREE docs
- `e2e-nightly.yml` — runs E2E against production → needs ALL THREE docs
- `post-deploy-smoke.yml` — smoke tests, environment config → needs ALL THREE docs
- `supabase-migrations.yml` — pure DB infra, no test code → still covered by the rule (safer to over-enforce)
- `migration-reorder.yml` — migration timestamps → still covered (safer to over-enforce)

Decision: Apply a single rule to ALL `.github/workflows/` files. Simpler than selective enforcement.

### Finding 5: eslint-rules/ Should Be Included

The `eslint-rules/` directory contains custom test flakiness prevention rules:
- `no-wait-for-timeout.js`, `max-test-timeout.js`, `no-test-skip.js`, `require-test-cleanup.js`, etc.
- These ARE test infrastructure — modifying them changes what test patterns are enforced
- They reference testing_overview.md in their comments
- Should require the same three docs

### Finding 6: Proven Hook Architecture to Follow

The new implementation must follow the existing pattern:

**check-workflow-ready.sh blocking pattern:**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "..."
  }
}
```

**track-prerequisites.sh tracking pattern:**
- Uses `read -r input` to get stdin JSON
- Extracts `tool_name` and `file_path`
- Matches FILE_PATH with `*"filename.md"*`
- Sets jq field path like `.prerequisites.testing_setup_read`
- Updates `_status.json` atomically (lock + jq + tmp file + mv)
- Never overwrites existing timestamps

**bypass conditions** (both hooks must respect these):
- `WORKFLOW_BYPASS=true` env var
- Branch prefixes: `hotfix/`, `docs/`, `chore/`, `fix/`
- `main`/`master` branch
- Detached HEAD

### Finding 7: Multi-prerequisite Error Message Pattern

For multiple missing docs, build a dynamic list:
```bash
MISSING_TEST_REQS=()
[ -z "$TESTING_OVERVIEW_READ" ] && MISSING_TEST_REQS+=("docs/docs_overall/testing_overview.md")
[ -z "$TESTING_SETUP_READ" ] && MISSING_TEST_REQS+=("docs/feature_deep_dives/testing_setup.md")
[ -z "$ENVIRONMENTS_READ" ] && MISSING_TEST_REQS+=("docs/docs_overall/environments.md")

if [ ${#MISSING_TEST_REQS[@]} -gt 0 ]; then
  MISSING_LIST=$(printf '%s\\n' "${MISSING_TEST_REQS[@]}" | sed 's/^/  - /')
  # ... deny with dynamic list
fi
```

This only shows what's actually missing, not all three every time.

## Implementation Plan (Phased)

### Phase 1: Extend track-prerequisites.sh
- Add `testing_setup_read` tracking (when `testing_setup.md` is read)
- Add `environments_read` tracking (when `environments.md` is read)

### Phase 2: Extend check-workflow-ready.sh
- Rename `is_test_file()` to `is_test_or_ci_file()` (or keep name, extend body)
- Add missing patterns: `jest.shims`, `jest.integration-setup`, `.github/workflows/`, `eslint-rules/`
- Replace single `testing_overview_read` check with a multi-doc check (all three)
- Show dynamic list of only the missing docs in the deny message

### Phase 3: Update documentation
- Update testing_overview.md enforcement summary table to include the new rules
- Add entry for `testing_setup_read` and `environments_read`

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/debugging.md
- docs/docs_overall/environments.md

## Code Files Read
- .claude/hooks/check-workflow-ready.sh — full content (269 lines); `is_test_file()` at lines 191-208; test check at lines 210-232
- .claude/hooks/track-prerequisites.sh — full content (149 lines); elif chain at lines 70-78
- .claude/settings.json — full content; hooks config at lines 82-225
- .claude/hooks/check-test-patterns.sh — full content; uses `e2e.*\.(ts|tsx)$` pattern
- jest.integration.config.js — full content (87 lines)
- jest.shims.js — 6 lines (OpenAI SDK polyfills)
- jest.integration-setup.js — first 30 lines
- eslint-rules/index.js — full content (exports 13 flakiness rules)
- eslint.config.mjs — first 60 lines
- .github/workflows/ci.yml — first 50 lines (staging environment, test suite orchestration)
- .github/workflows/e2e-nightly.yml — first 50 lines (production E2E, @skip-prod audit)
- .github/workflows/post-deploy-smoke.yml — first 30 lines
- .github/workflows/supabase-migrations.yml — first 30 lines

## Open Questions

1. **`jest.shims.js` scope**: Should `jest.shims.js` require all three docs or just `testing_setup.md`? It's a 6-line polyfill file — probably fine to apply the full three-doc requirement since it's rare to edit.

2. **`eslint.config.mjs` scope**: The main ESLint config applies flakiness rules to spec files. Should it be included? Recommendation: NO — it also configures non-test rules and is too broad.

3. **`tsconfig.ci.json` scope**: This is CI-specific TypeScript config. Recommendation: NO — it's a compilation config, not test logic.
