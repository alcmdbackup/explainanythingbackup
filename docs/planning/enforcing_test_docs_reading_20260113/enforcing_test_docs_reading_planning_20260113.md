# Plan: Add testing_overview.md Prerequisite Hook for Test Files

**Status**: ✅ Implemented (2026-01-13)
**Branch**: `fix/clean_up_junk_articles_in_production`
**Commit**: `ef4efee`

## Summary

Extend the existing workflow enforcement hooks to require reading `testing_overview.md` before editing test files. This mirrors the existing pattern for `getting_started.md` and `project_workflow.md`.

## Background

After fixing several E2E tests that were creating junk content in production (see `clean_up_junk_articles_in_production_20260112`), we identified a need to ensure Claude reads `testing_overview.md` before modifying test files. This documentation covers critical testing conventions:

- `[TEST]` prefix convention for test content filtering
- Auto-tracking cleanup system via `trackExplanationForCleanup()`
- Testing tiers and commands
- CI/CD workflow behavior (nightly uses real AI, not mocked)

## Design Decision

**Conditional enforcement**: Only require `testing_overview.md` for test file edits (not all code edits). This is targeted and avoids forcing devs to read testing docs when editing non-test code.

## Files Modified

### 1. `.claude/hooks/track-prerequisites.sh`
Added detection for `testing_overview.md` reads:

```bash
# Lines 61-68 - added new elif clause
if [[ "$FILE_PATH" == *"getting_started.md"* ]]; then
  FIELD_TO_UPDATE=".prerequisites.getting_started_read"
elif [[ "$FILE_PATH" == *"project_workflow.md"* ]]; then
  FIELD_TO_UPDATE=".prerequisites.project_workflow_read"
elif [[ "$FILE_PATH" == *"testing_overview.md"* ]]; then    # NEW
  FIELD_TO_UPDATE=".prerequisites.testing_overview_read"    # NEW
fi
```

### 2. `.claude/hooks/check-workflow-ready.sh`
Added conditional check for test files (lines 180-220):

```bash
# --- Test File Prerequisite Check ---
# Only enforce for test files

is_test_file() {
  local path="$1"
  # Test directories
  [[ "$path" == *"/__tests__/"* ]] && return 0
  [[ "$path" == *"/testing/"* ]] && return 0
  # Test file suffixes
  [[ "$path" == *.test.ts ]] && return 0
  [[ "$path" == *.test.tsx ]] && return 0
  [[ "$path" == *.spec.ts ]] && return 0
  [[ "$path" == *.spec.tsx ]] && return 0
  [[ "$path" == *.integration.test.ts ]] && return 0
  [[ "$path" == *.esm.test.ts ]] && return 0
  # Test config files
  [[ "$path" == *"jest.config"* ]] && return 0
  [[ "$path" == *"jest.setup"* ]] && return 0
  [[ "$path" == *"playwright.config"* ]] && return 0
  return 1
}

if is_test_file "$FILE_PATH"; then
  TESTING_OVERVIEW_READ=$(jq -r '.prerequisites.testing_overview_read // empty' "$STATUS_FILE" 2>/dev/null)

  if [ -z "$TESTING_OVERVIEW_READ" ]; then
    cat << 'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Test file prerequisite not met.\n\nBefore editing test files, read:\n  /docs/docs_overall/testing_overview.md\n\nThis ensures familiarity with:\n- [TEST] prefix convention\n- Auto-tracking cleanup system\n- Testing tiers and commands\n- CI/CD workflow behavior"
  }
}
EOF
    exit 0
  fi
fi
```

## Test File Patterns

| Pattern | Examples |
|---------|----------|
| `*/__tests__/**/*` | `src/__tests__/e2e/specs/auth.spec.ts` |
| `*/testing/**/*` | `src/testing/mocks/supabase.ts` |
| `*.test.ts(x)` | `SearchBar.test.tsx`, `explanations.test.ts` |
| `*.spec.ts(x)` | `auth.spec.ts`, `library.spec.ts` |
| `*.integration.test.ts` | `auth-flow.integration.test.ts` |
| `*.esm.test.ts` | `markdownASTdiff.esm.test.ts` |
| `jest.config*` | `jest.config.js`, `jest.integration.config.js` |
| `playwright.config*` | `playwright.config.ts` |

## How It Works

1. **Tracking (PostToolUse on Read)**: When Claude reads `testing_overview.md`, the hook records `prerequisites.testing_overview_read` timestamp in the project's `_status.json`

2. **Enforcement (PreToolUse on Edit/Write)**: When editing test files, the hook checks for `testing_overview_read`. If missing, blocks with denial message.

3. **Non-test code**: Unaffected - no additional prerequisite required

## Verification

1. **Test tracking**: Read `testing_overview.md`, verify `_status.json` updates with `testing_overview_read` timestamp
2. **Test enforcement**: Try editing a test file without reading `testing_overview.md`, verify denial message
3. **Test bypass**: Edit a non-test code file, verify no additional requirement
4. **Test pattern coverage**: Verify all test file patterns trigger the check

```bash
# Manual test sequence:
# 1. Create new branch with project folder
git checkout -b test_hook_verification
mkdir -p docs/planning/test_hook_verification
echo '{"project":"test","branch":"test_hook_verification","prerequisites":{}}' > docs/planning/test_hook_verification/_status.json

# 2. Try editing test file (should fail - missing all prerequisites)
# 3. Read getting_started.md, project_workflow.md, create todos
# 4. Try editing test file (should fail - missing testing_overview.md)
# 5. Read testing_overview.md
# 6. Try editing test file (should succeed)
# 7. Try editing non-test code (should succeed without testing_overview.md)
```

## Related Documentation

- `docs/docs_overall/testing_overview.md` - The documentation being enforced
- `docs/planning/clean_up_junk_articles_in_production_20260112/` - Motivation for this enforcement
- `.claude/hooks/README.md` - Hook system documentation (if exists)
