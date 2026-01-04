#!/bin/bash
# Hook to check for problematic test patterns in E2E files
# See docs/docs_overall/testing_rules.md for acceptable exceptions
#
# This hook runs on Edit/Write to E2E test files and warns about:
# - test.skip() patterns (Rule 8)
# - .catch(() => false) / .catch(() => {}) patterns (Rule 7)

FILE_PATH="$1"

# Only check E2E test files
if [[ ! "$FILE_PATH" =~ e2e.*\.(ts|tsx)$ ]]; then
  exit 0
fi

ERRORS=""

# Check for test.skip patterns
if grep -n "test\.skip" "$FILE_PATH" 2>/dev/null | grep -v "eslint-disable"; then
  ERRORS="${ERRORS}
⚠️  Found test.skip() - use test-data-factory.ts instead (Rule 8)
    See docs/docs_overall/testing_rules.md for acceptable exceptions"
fi

# Check for silent catch patterns: .catch(() => false) or .catch(() => {})
if grep -nE "\.catch\(\(\)\s*=>\s*(false|\{\s*\}|\(\s*\))" "$FILE_PATH" 2>/dev/null | grep -v "eslint-disable"; then
  ERRORS="${ERRORS}
⚠️  Found .catch(() => ...) - use safeIsVisible/safeWaitFor instead (Rule 7)
    See docs/docs_overall/testing_rules.md for acceptable exceptions"
fi

if [ -n "$ERRORS" ]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📋 Test Pattern Warnings in: $FILE_PATH"
  echo "$ERRORS"
  echo ""
  echo "To suppress: add // eslint-disable-next-line flakiness/no-test-skip"
  echo "             or // eslint-disable-next-line flakiness/no-silent-catch"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  # Don't fail - just warn. ESLint will catch it properly.
  exit 0
fi

exit 0
