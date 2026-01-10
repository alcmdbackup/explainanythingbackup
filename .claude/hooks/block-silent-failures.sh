#!/bin/bash
# Block silent failure patterns in try-catch blocks
# Allows exceptions with documented reasons via @silent-ok comment
#
# This hook prevents new silent failure patterns from being introduced,
# ensuring errors are properly propagated through the service layer.

FILE_PATH="$1"
NEW_CONTENT="$2"

# Only check TypeScript/JavaScript files in src/
if [[ ! "$FILE_PATH" =~ ^src/.*\.(ts|tsx|js|jsx)$ ]]; then
    exit 0
fi

# Skip test files
if [[ "$FILE_PATH" =~ \.test\.(ts|tsx|js|jsx)$ ]]; then
    exit 0
fi

# If the content contains @silent-ok, skip all checks
# This allows developers to opt out with a documented reason
if echo "$NEW_CONTENT" | grep -q '@silent-ok'; then
    exit 0
fi

# Create temp file for analysis
TEMP_FILE=$(mktemp)
echo "$NEW_CONTENT" > "$TEMP_FILE"

ISSUES=""

# Pattern 1: Empty catch blocks
# Matches: catch (error) { } or catch { }
# Using extended regex for macOS compatibility
if grep -E 'catch[[:space:]]*\([^)]*\)[[:space:]]*\{[[:space:]]*\}' "$TEMP_FILE" > /dev/null 2>&1; then
    ISSUES="${ISSUES}- Empty catch block detected\n"
fi

# Pattern 2: Catch block with only logging (no throw/re-throw)
# This catches patterns like: catch (e) { logger.error(e); }
# but allows: catch (e) { logger.error(e); throw e; }
if grep -E 'catch.*\{.*logger\.(error|warn)' "$TEMP_FILE" > /dev/null 2>&1; then
    if ! grep -E 'catch.*\{.*logger\.(error|warn).*throw' "$TEMP_FILE" > /dev/null 2>&1 && \
       ! grep -E 'throw.*logger\.(error|warn)' "$TEMP_FILE" > /dev/null 2>&1; then
        # Check if throw appears after logger in catch block context
        # This is a heuristic - may have false positives
        CATCH_CONTENT=$(grep -E 'catch.*\{' "$TEMP_FILE" 2>/dev/null || true)
        if [ -n "$CATCH_CONTENT" ]; then
            # Check if this file has proper throw patterns after error logging
            if ! grep -E 'throw' "$TEMP_FILE" > /dev/null 2>&1; then
                ISSUES="${ISSUES}- Catch block logs but doesn't throw - consider adding throw or @silent-ok comment\n"
            fi
        fi
    fi
fi

# Pattern 3: Catch returning empty array/object without throw
# Matches: catch { return []; } or catch { return {}; }
if grep -E 'catch.*return[[:space:]]*(\[\]|\{\})' "$TEMP_FILE" > /dev/null 2>&1; then
    if ! grep -E 'throw' "$TEMP_FILE" > /dev/null 2>&1; then
        ISSUES="${ISSUES}- Catch block returns empty value without throwing - add @silent-ok comment if intentional\n"
    fi
fi

# Cleanup
rm -f "$TEMP_FILE"

if [ -n "$ISSUES" ]; then
    echo "BLOCKED: Silent failure pattern detected"
    echo ""
    echo "Issues found:"
    echo -e "$ISSUES"
    echo ""
    echo "To fix:"
    echo "  1. Throw the error: throw new ServiceError(...)"
    echo "  2. Or add exemption comment if intentional:"
    echo "     // @silent-ok: <reason>"
    echo ""
    echo "Valid @silent-ok reasons:"
    echo "  - external API graceful degradation"
    echo "  - non-critical background task"
    echo "  - user experience preservation"
    echo "  - rate limiting fallback"
    exit 1
fi

exit 0
