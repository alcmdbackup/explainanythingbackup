# Hook Enforce Reading Testing Docs Before Modifying Test Files 20260409 Plan

## Background
Add Claude hooks which enforce that testing_overview.md, testing_setup.md, and environments.md docs must all be read prior to modifying any files related to tests or CI.

## Requirements (from GH Issue #944)
Add Claude hooks which enforce that test_overview, test_setup, and environment.md docs must all be read prior to modifying any files related to tests or CI.

## Problem
The existing hook system already requires `testing_overview.md` before editing test files, but `testing_setup.md` and `environments.md` are never tracked or enforced. Additionally, the current `is_test_file()` function misses several test/CI-related files: `jest.integration-setup.js`, `jest.shims.js`, and `.github/workflows/` workflow files. The project needs to extend both the tracking hook (to record when the two new docs are read) and the enforcement hook (to require all three docs and cover the missing file patterns).

**Key constraint:** `check-workflow-ready.sh` has an early-exit bypass for `.yml`/`.yaml` files (around line 57) that runs before `is_test_file()`. Adding `.github/workflows/` to `is_test_file()` alone is dead code — the yml bypass must also be patched to exclude `.github/workflows/` paths (similar to how `package.json` and `tsconfig` are already excluded from the json bypass).

## Options Considered
- [ ] **Option A: Extend existing hooks**: Add `testing_setup_read` and `environments_read` fields to the existing prerequisite system — minimal code, consistent with current architecture, re-uses proven atomic update logic
- [ ] **Option B: New separate hook script**: Create a dedicated hook just for test/CI file doc enforcement — more isolated but duplicates all the bypass logic, locking, and branch detection from existing hooks
- [ ] **Option C: Single combined prerequisite**: Require all three docs for ALL code edits (not just test files) — simpler logic but too aggressive; frontend devs shouldn't need environments.md to edit UI components

**Chosen: Option A** — extend existing hooks. Zero new infrastructure needed; just new elif branches and pattern additions.

## Phased Execution Plan

### Phase 1: Extend track-prerequisites.sh
- [x] Add `testing_setup_read` tracking: detect when `docs/feature_deep_dives/testing_setup.md` is read and write `.prerequisites.testing_setup_read` timestamp to `_status.json`
- [x] Add `environments_read` tracking: detect when `docs/docs_overall/environments.md` is read and write `.prerequisites.environments_read` timestamp

**Exact change** — insert after line 75 in `track-prerequisites.sh`:
```bash
  elif [[ "$FILE_PATH" == *"testing_setup.md"* ]]; then
    FIELD_TO_UPDATE=".prerequisites.testing_setup_read"
  elif [[ "$FILE_PATH" == *"docs/docs_overall/environments.md"* ]]; then
    FIELD_TO_UPDATE=".prerequisites.environments_read"
```

Note: `environments.md` is anchored to `docs/docs_overall/environments.md` to avoid false positives from hypothetical files like `test_environments.md`.

### Phase 2: Extend check-workflow-ready.sh

**Step 2a** — Patch the `.yml` early-exit bypass (around line 57) to exclude `.github/workflows/` paths, so they fall through to `is_test_file()`:
```bash
# Before (current):
if [[ "$FILE_PATH" == *".json" ]] || [[ "$FILE_PATH" == *".yaml" ]] || [[ "$FILE_PATH" == *".yml" ]] || [[ "$FILE_PATH" == *".toml" ]]; then
  if [[ "$FILE_PATH" != *"package.json"* ]] && [[ "$FILE_PATH" != *"tsconfig"* ]]; then
    exit 0
  fi
fi

# After (patched):
if [[ "$FILE_PATH" == *".json" ]] || [[ "$FILE_PATH" == *".yaml" ]] || [[ "$FILE_PATH" == *".yml" ]] || [[ "$FILE_PATH" == *".toml" ]]; then
  if [[ "$FILE_PATH" != *"package.json"* ]] && [[ "$FILE_PATH" != *"tsconfig"* ]] && [[ "$FILE_PATH" != *".github/workflows/"* ]]; then
    exit 0
  fi
fi
```

**Step 2b** — Add missing file patterns to `is_test_file()`:
- [x] `[[ "$path" == *"jest.shims"* ]]` — catches `jest.shims.js`
- [x] `[[ "$path" == *"jest.integration-setup"* ]]` — catches `jest.integration-setup.js`
- [x] `[[ "$path" == *".github/workflows/"* ]]` — CI workflow files (now reachable after Step 2a)
- [x] Remove `eslint-rules/` — that directory also contains design-system rules; adding it would incorrectly require testing docs for non-test rule edits

**Step 2c** — Replace single `testing_overview_read` check (lines 210–232) with a three-doc check that builds a dynamic list of only the missing docs:
```bash
if is_test_file "$FILE_PATH"; then
  TESTING_OVERVIEW_READ=$(jq -r '.prerequisites.testing_overview_read // empty' "$STATUS_FILE" 2>/dev/null)
  TESTING_SETUP_READ=$(jq -r '.prerequisites.testing_setup_read // empty' "$STATUS_FILE" 2>/dev/null)
  ENVIRONMENTS_READ=$(jq -r '.prerequisites.environments_read // empty' "$STATUS_FILE" 2>/dev/null)

  MISSING_TEST_REQS=()
  [ -z "$TESTING_OVERVIEW_READ" ] && MISSING_TEST_REQS+=("docs/docs_overall/testing_overview.md")
  [ -z "$TESTING_SETUP_READ" ] && MISSING_TEST_REQS+=("docs/feature_deep_dives/testing_setup.md")
  [ -z "$ENVIRONMENTS_READ" ] && MISSING_TEST_REQS+=("docs/docs_overall/environments.md")

  if [ ${#MISSING_TEST_REQS[@]} -gt 0 ]; then
    MISSING_LIST=$(printf '%s\n' "${MISSING_TEST_REQS[@]}" | sed 's/^/  - /')
    cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Test/CI file prerequisites not met.\n\nBefore editing test or CI files, read:\n${MISSING_LIST}\n\nThis ensures familiarity with:\n- Testing tiers, rules, and CI workflows\n- Test infrastructure setup and configuration\n- Environment configuration and secrets"
  }
}
EOF
    exit 0
  fi
fi
```

Note: `printf '%s\n'` (single backslash) produces real newlines; the prior draft erroneously used `\\n`. The `cat << EOF` heredoc (unquoted delimiter) is consistent with the existing deny block patterns in `check-workflow-ready.sh` — variable interpolation of `$MISSING_LIST` is safe since the array values are all hardcoded doc path strings.

### Phase 3: Update testing_overview.md enforcement table
- [x] Add two new rows to the "Enforcement Summary" table (lines 41–62) for the new prerequisites:

```markdown
| Test/CI file edits require testing_setup_read  | Claude PreToolUse hook (`check-workflow-ready.sh`) | Edit-time |
| Test/CI file edits require environments_read   | Claude PreToolUse hook (`check-workflow-ready.sh`) | Edit-time |
```

## Testing

### Unit Tests
- N/A — hooks are shell scripts, not TypeScript

### Integration Tests
- N/A — no database changes

### E2E Tests
- N/A — hook behavior is not testable via Playwright

### Manual Verification
- [x] On a fresh `feat/` branch with empty `_status.json` prerequisites, attempt to edit `jest.config.js` — should be denied with all three docs listed as missing
- [x] Attempt to edit a `*.test.ts` file directly (e.g. `src/lib/services/foo.test.ts`) — should also be denied (canonical test file extension)
- [x] Read `testing_overview.md` only, then retry edit — should be denied showing only the two remaining docs
- [x] Read `testing_setup.md`, retry — should be denied showing only `environments.md`
- [x] Read `environments.md`, retry — should succeed
- [x] Attempt to edit `.github/workflows/ci.yml` — should trigger the same three-doc check (new CI file pattern)
- [x] Attempt to edit `jest.integration-setup.js` — should trigger (new pattern)
- [x] Attempt to edit `jest.shims.js` — should trigger (new pattern)
- [x] **Regression:** attempt to edit `src/lib/utils.ts` (a non-test, non-frontend file) without reading any testing docs — should be allowed (no regression)
- [x] Confirm bypass works: on a `chore/` branch, edit any test file without reading any docs — should be allowed
- [x] Confirm `WORKFLOW_BYPASS=true` still bypasses
- [x] Confirm branch with no `_status.json` at all (legacy project) still allows edits

## Verification

### A) Playwright Verification (required for UI changes)
- N/A — no UI changes

### B) Automated Tests
- [x] Manual shell testing per the steps above — run each scenario by actually triggering the hook via `claude` CLI on the branch

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [x] `docs/docs_overall/testing_overview.md` — add two rows to the Enforcement Summary table documenting the new hook-enforced prerequisites
- [x] `docs/feature_deep_dives/testing_setup.md` — no changes needed
- [x] `docs/docs_overall/debugging.md` — no changes needed
- [x] `docs/docs_overall/environments.md` — no changes needed

## Review & Discussion

### Iteration 3 — CONSENSUS REACHED (2026-04-10)
All reviewers voted consensus: true. Plan is ready for execution.

| Perspective | Agent 1 | Agent 2 |
|-------------|---------|---------|
| Security & Technical | 5/5 | 4/5 |
| Architecture & Integration | 5/5 | 4/5 |
| Testing & CI/CD | 4/5 | 4/5 |

Remaining minor notes (non-blocking):
- `is_test_file()` name is semantically imprecise (now covers CI files) — acceptable as-is
- No automated shell test harness — consistent with all other hooks in the codebase
- `.yaml` arm of bypass is also patched by the same inner `if` block (not a gap)

---

### Iteration 1 (2026-04-10)
| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 5/5* | .yml bypass dead code; printf \\n bug |
| Architecture & Integration | 3/5 | .yml bypass; environments.md false positives; eslint-rules/ over-scoped |
| Testing & CI/CD | 3/5 | .yml bypass test false positive; missing regression test; missing no-status.json test |

*Security agent scored 5 but described two blockers — treated as gaps.

**Gaps resolved:**
1. ✅ `.yml` early-exit bypass — added Step 2a to patch the bypass block to exclude `.github/workflows/`
2. ✅ `printf '%s\\n'` bug — corrected to `printf '%s\n'` (real newlines)
3. ✅ `environments.md` false positives — anchored pattern to `*"docs/docs_overall/environments.md"*`
4. ✅ `eslint-rules/` over-scoped — removed from `is_test_file()` patterns
5. ✅ Missing regression test — added test for `src/components/Foo.tsx` remaining editable
6. ✅ Missing no-status.json test — added legacy project test case
