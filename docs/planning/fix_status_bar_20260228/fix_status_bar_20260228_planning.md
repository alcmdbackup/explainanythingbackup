# Fix Status Bar Plan

## Background
The Claude Code status bar remains visible but certain items within it disappear on session disconnect/reconnect or on context compaction. Individual fields (project name, branch, context %, cost) lose their values or show fallback/empty content, while the bar itself stays rendered.

## Requirements (from GH Issue #592)
The status bar stays visible but certain items within it disappear on session disconnect/reconnect or on context compaction. Investigate why specific fields lose their values and fix the script to maintain field persistence.

## Problem
The statusline script (`~/.claude/statusline.sh`) is fully stateless — each invocation reads fresh JSON from stdin and outputs fresh results. When Claude Code sends JSON with null or reset fields (which happens during disconnect/reconnect and context compaction), the script outputs degraded content: `0%` context, `$0.00` cost, `-` project, or the `[no workspace]` fallback. There is no mechanism to preserve previously-displayed valid values across invocations.

## Options Considered

### Option A: Cache last-known-good state file (Chosen)
Add a per-session state file (`~/.claude/cache/statusline-state-<session_id>`) that persists all displayed fields. On each invocation, write current valid values to the file. When a field arrives as null/empty/zero, fall back to the cached value. This approach:
- Is simple to implement (extend existing cache pattern)
- Handles both compaction and reconnect scenarios
- Preserves the atomic write pattern already used for git branch cache
- Session-scoped so stale data from old sessions doesn't leak

### Option B: Use environment/PWD fallback for workspace only
Fall back to `$PWD` when `workspace.current_dir` is null. Simpler but only fixes one field — doesn't help with context % or cost resetting on compaction.

### Option C: Retry/delay on null fields
Add a short sleep+retry when fields are null. Bad approach — adds latency, the 300ms debounce means a new invocation could cancel this one anyway.

## Phased Execution Plan

### Phase 1: Add state persistence to statusline.sh

Extend the script to maintain a per-session state file with last-known-good values for all displayed fields.

**Changes to `~/.claude/statusline.sh`:**

```bash
#!/bin/bash
# Status line for Claude Code: shows project, worktree, branch, context %, cost
# Persists last-known-good values to survive compaction and reconnect.

if ! command -v jq &>/dev/null; then
    echo "[statusline: jq not found]"
    exit 0
fi

input=$(cat)

CACHE_DIR="$HOME/.claude/cache"
mkdir -p "$CACHE_DIR"

# --- Extract fields from JSON ---
DIR="$(echo "$input" | jq -r '.workspace.current_dir // empty')"
PCT="$(echo "$input" | jq -r '.context_window.used_percentage // empty')"
COST="$(echo "$input" | jq -r '.cost.total_cost_usd // empty')"
SESSION_ID="$(echo "$input" | jq -r '.session_id // empty')"

# --- State file for last-known-good values (per-session) ---
# Sanitize session_id to prevent path traversal (only allow alphanumeric, dash, underscore)
STATE_KEY="${SESSION_ID:-default}"
STATE_KEY="${STATE_KEY//[^a-zA-Z0-9_-]/}"
STATE_FILE="$CACHE_DIR/statusline-state-${STATE_KEY}"

# Load previous state if it exists
if [ -f "$STATE_FILE" ]; then
    PREV_DIR="$(sed -n '1p' "$STATE_FILE")"
    PREV_PCT="$(sed -n '2p' "$STATE_FILE")"
    PREV_COST="$(sed -n '3p' "$STATE_FILE")"
    PREV_BRANCH="$(sed -n '4p' "$STATE_FILE")"
fi

# Fall back to previous values when current values are null/empty
[ -z "$DIR" ] && DIR="$PREV_DIR"
[ -z "$PCT" ] && PCT="$PREV_PCT"
[ -z "$COST" ] && COST="$PREV_COST"

# Default fallbacks if still empty (first invocation)
[ -z "$PCT" ] && PCT="0"
[ -z "$COST" ] && COST="0"
# Ensure numeric values (guard against corrupt state file)
[[ "$PCT" =~ ^[0-9.]+$ ]] || PCT="0"
[[ "$COST" =~ ^[0-9.]+$ ]] || COST="0"
# Floor PCT
PCT="$(echo "$PCT" | cut -d. -f1)"

if [ -z "$DIR" ] || [ ! -d "$DIR" ]; then
    echo "[no workspace]"
    exit 0
fi

WORKTREE="$(basename "$DIR")"

# --- Git branch (cached per-worktree, 5s TTL) ---
BRANCH_CACHE="$CACHE_DIR/statusline-git-${WORKTREE}"
CACHE_MAX_AGE=5

cache_is_stale() {
    [ ! -f "$BRANCH_CACHE" ] || \
    [ $(($(date +%s) - $(stat -c %Y "$BRANCH_CACHE" 2>/dev/null || echo 0))) -gt "$CACHE_MAX_AGE" ]
}

if cache_is_stale; then
    if git -C "$DIR" rev-parse --git-dir &>/dev/null; then
        BRANCH="$(git -C "$DIR" branch --show-current 2>/dev/null)"
        [ -z "$BRANCH" ] && BRANCH="detached"
    else
        BRANCH="no-repo"
    fi
    echo "$BRANCH" > "$BRANCH_CACHE.tmp" && mv "$BRANCH_CACHE.tmp" "$BRANCH_CACHE"
else
    BRANCH="$(cat "$BRANCH_CACHE")"
fi

# Fall back to previous branch if empty
[ -z "$BRANCH" ] && BRANCH="${PREV_BRANCH:-unknown}"

case "$BRANCH" in
    */*)  PROJECT="${BRANCH#*/}" ;;
    *)    PROJECT="-" ;;
esac

# --- Save current state for next invocation ---
printf '%s\n%s\n%s\n%s\n' "$DIR" "$PCT" "$COST" "$BRANCH" > "$STATE_FILE.tmp" \
    && mv "$STATE_FILE.tmp" "$STATE_FILE"

# --- Output ---
CYAN='\033[36m'; GREEN='\033[32m'; YELLOW='\033[33m'; DIM='\033[2m'; RESET='\033[0m'
COST_FMT="$(printf '$%.2f' "$COST")"

# Line 1: project + context % + cost
printf '%b%s%b | Context: %s%% | Cost: %b%s%b\n' "${GREEN}" "$PROJECT" "${RESET}" "$PCT" "${YELLOW}" "$COST_FMT" "${RESET}"
# Line 2: WD + branch
printf 'WD: %b%s%b | Branch: %b%s%b\n' "${DIM}" "$WORKTREE" "${RESET}" "${CYAN}" "$BRANCH" "${RESET}"
```

Key changes from current script:
1. Extract `session_id` from JSON to key the state file
2. Sanitize `session_id` to prevent path traversal (strip non-alphanumeric chars)
3. Use `// empty` instead of `// 0` for PCT and COST so we can detect null vs actual zero
4. Load previous state from `STATE_FILE` on each invocation
5. Fall back to previous values when current JSON field is null/empty
6. Numeric guards on PCT and COST to handle corrupt state files
7. Save current valid state atomically after each successful run
8. Rename `CACHE_FILE` → `BRANCH_CACHE` for clarity

### Phase 2: Clean up stale state files

Add cleanup of old state files (>24h) to prevent accumulation. Add to the top of the script after `mkdir -p`:

```bash
# Clean state files older than 24 hours (run at most once per hour via sentinel file)
CLEANUP_SENTINEL="$CACHE_DIR/.statusline-last-cleanup"
if [ ! -f "$CLEANUP_SENTINEL" ] || [ $(($(date +%s) - $(stat -c %Y "$CLEANUP_SENTINEL" 2>/dev/null || echo 0))) -gt 3600 ]; then
    find "$CACHE_DIR" -name 'statusline-state-*' -mmin +1440 -delete 2>/dev/null
    touch "$CLEANUP_SENTINEL"
fi
```

### Phase 3: Update documentation

Update `docs/docs_overall/managing_claude_settings.md` Status Line Configuration section to document:
- State persistence behavior
- State file location (`~/.claude/cache/statusline-state-<session_id>`)
- Cleanup of stale state files

## Testing

### Manual Verification
1. **Normal operation**: Confirm status bar shows all fields correctly during normal usage
2. **Simulate null fields**: Test with mock JSON missing fields:
   ```bash
   echo '{"workspace":{"current_dir":"/tmp"},"context_window":{},"cost":{},"session_id":"test1"}' | ~/.claude/statusline.sh
   # Should show fallback values, not 0%/$0.00
   ```
3. **State persistence**: Run twice — first with full data, second with null fields — verify second run preserves first run's values:
   ```bash
   echo '{"workspace":{"current_dir":"'$PWD'"},"context_window":{"used_percentage":42},"cost":{"total_cost_usd":1.23},"session_id":"test2"}' | ~/.claude/statusline.sh
   echo '{"workspace":{"current_dir":"'$PWD'"},"context_window":{},"cost":{},"session_id":"test2"}' | ~/.claude/statusline.sh
   # Second run should still show 42% and $1.23
   ```
4. **Compaction**: Use Claude Code until context compaction triggers, verify fields persist
5. **Session disconnect/reconnect**: Resume a session after disconnect, verify fields persist

### No Unit Tests
This is a standalone bash script outside the app codebase — no Jest/Playwright tests apply. Manual verification with mock input is the appropriate testing strategy.

## Documentation Updates
- `docs/docs_overall/managing_claude_settings.md` — Update "Status Line Configuration" section to document state persistence, caching behavior, and stale file cleanup
