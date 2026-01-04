# /user-test - AI-Driven Exploratory Testing

Autonomous exploratory testing using Playwright MCP tools. Discovers UX issues and bugs through human-like exploration.

## Usage

```
/user-test [--mode=<mode>] [--goal="<goal>"] [--persona=<persona>] [--dry-run]
```

## Arguments

| Argument | Values | Description |
|----------|--------|-------------|
| `--mode` | `autonomous` (default), `goal`, `persona` | Exploration mode |
| `--goal` | String (max 200 chars) | Target to accomplish (goal mode only) |
| `--persona` | `new-user`, `power-user`, `confused-user` | User profile (persona mode only) |
| `--dry-run` | Flag | Generate report without creating GitHub issues |

## Execution Steps

When invoked, you MUST follow this exact process:

### 1. Initialize Session

Create session tracking:
```bash
SESSION_ID=$(date +%Y%m%d_%H%M%S)
REPORT_DIR="test-results/user-testing"
REPORT_FILE="${REPORT_DIR}/report_${SESSION_ID}.md"
mkdir -p "$REPORT_DIR"
```

Parse arguments from `$ARGUMENTS`:
- Extract `--mode` (default: autonomous)
- Extract `--goal` if mode=goal
- Extract `--persona` if mode=persona
- Check for `--dry-run` flag

### 2. Input Validation

**For --goal mode, REJECT if goal contains:**
- HTML tags: `<script>`, `<iframe>`, `<object>`, `<embed>`
- Event handlers: `onclick`, `onerror`, `onload`, `onmouseover`
- Protocols: `javascript:`, `data:`, `vbscript:`
- Length > 200 characters

If validation fails, abort and report the rejection reason.

### 3. Server Discovery

Discover the server URL for the current worktree:

```bash
# Step 1: Check for BASE_URL override (CI/staging)
if [ -n "$BASE_URL" ]; then
  SERVER_URL="$BASE_URL"
else
  # Step 2: Find instance file matching current worktree
  PROJECT_ROOT=$(pwd)
  SERVER_URL=""
  for f in /tmp/claude-instance-*.json; do
    [ -f "$f" ] || continue
    if jq -e --arg pr "$PROJECT_ROOT" '.project_root == $pr' "$f" >/dev/null 2>&1; then
      SERVER_URL=$(jq -r '.frontend_url' "$f")
      break
    fi
  done

  # Step 3: Fallback
  if [ -z "$SERVER_URL" ]; then
    SERVER_URL="http://localhost:3008"
  fi
fi
echo "Server URL: $SERVER_URL"
```

### 4. Ensure Server Running

```bash
./docs/planning/tmux_usage/ensure-server.sh
```

Then poll health check:
```bash
for i in $(seq 1 30); do
  if curl -sf --max-time 5 "${SERVER_URL}/api/health" >/dev/null 2>&1; then
    echo "Server ready"
    break
  fi
  sleep 1
done
```

### 5. Authenticate

Navigate to login page and authenticate using UI:

```
1. mcp__playwright__browser_navigate to ${SERVER_URL}/login
2. mcp__playwright__browser_snapshot to get element refs
3. Find email input ref, password input ref, submit button ref
4. mcp__playwright__browser_type with email (from CLAUDE.md: abecha@gmail.com)
5. mcp__playwright__browser_type with password (from CLAUDE.md: password)
6. mcp__playwright__browser_click on submit button
7. Wait for redirect away from /login (indicates success)
```

**Key Selectors (from Page Object Models):**
- Email input: `#email`
- Password input: `#password`
- Submit button: `button[type="submit"]`

**MCP Tool Pattern - IMPORTANT:**
1. Always call `mcp__playwright__browser_snapshot` FIRST to get accessibility tree
2. Use the `ref` values from snapshot (e.g., `ref: "s1e12"`) in click/type calls
3. Do NOT pass CSS selectors directly to click/type - use the refs

### 6. Execute Exploration

Based on mode, explore the application:

#### Autonomous Mode (default)

Randomly explore for 10 minutes with weighted actions:
- Navigate to random pages (20%)
- Click interactive elements (40%)
- Fill forms with test data (20%)
- Read content and check accessibility (20%)

**Exploration Targets:**
- Home page: `/`
- Search: `[data-testid="search-input"]`
- Results: `/results?q=...`
- Library: `/library`
- Settings: `/settings` (if exists)

#### Goal-Oriented Mode

Parse the --goal and work toward it:
1. Decompose goal into concrete steps
2. Execute each step with verification
3. Report success/failure for each step

Example: `--goal="save an explanation"`
1. Navigate to home
2. Enter a search query
3. Wait for results
4. Click "Save to Library"
5. Verify save succeeded

#### Persona-Based Mode

Adopt behavior profile:

**new-user:**
- Move slowly between elements
- Read all labels and descriptions
- Hesitate before clicking
- Look for help/tutorial content

**power-user:**
- Fast navigation
- Use keyboard shortcuts (Tab, Enter)
- Skip tutorials/onboarding
- Try advanced features first

**confused-user:**
- Click randomly without reading
- Ignore error messages
- Submit incomplete forms
- Navigate away mid-action

### 7. Continuous Monitoring

Throughout exploration, monitor for issues:

#### Console Errors
```
mcp__playwright__browser_console_messages with level="error"
```
Capture and classify any errors.

#### Accessibility Issues
After each major navigation:
```
mcp__playwright__browser_snapshot
```
Check for:
- Interactive elements without labels
- Images without alt text
- Form fields without associated labels

#### Screenshot Evidence
On each finding:
```
mcp__playwright__browser_take_screenshot with filename="finding_N.png"
```

### 8. Classify Findings

Use this classification schema:

| Category | Severity | Criteria |
|----------|----------|----------|
| Bug-Critical | P0 | App crashes, data loss, security issues |
| Bug-Major | P1 | Feature broken, console errors, blocked flows |
| Bug-Minor | P2 | Visual glitches, minor behavior issues |
| UX-Major | P1 | Confusing flow, task blocked, missing feedback |
| UX-Minor | P2 | Friction, unclear labels, slow interactions |

### 9. Generate Report

Create markdown report at `$REPORT_FILE`:

```markdown
# User Testing Report - [SESSION_ID]

## Session Info
- Mode: [mode]
- Goal/Persona: [if applicable]
- Duration: [time]
- Server: [SERVER_URL]
- Started: [timestamp]

## Summary
- Total Findings: [N]
- Bugs: [count] (Critical: X, Major: Y, Minor: Z)
- UX Issues: [count] (Major: X, Minor: Y)

## Detailed Findings

### Finding 1: [Title]
- **Category**: Bug-Major / UX-Minor / etc.
- **Location**: /page/path
- **Description**: [detailed description]
- **Steps to Reproduce**:
  1. Navigate to...
  2. Click on...
  3. Observe...
- **Expected**: [what should happen]
- **Actual**: [what happened]
- **Evidence**: ![screenshot](finding_1.png)
- **Console Logs**: [if applicable]

### Finding 2: ...

## Pages Visited
- / (home)
- /login
- /results?q=test
- ...

## Actions Taken
1. [action 1]
2. [action 2]
...
```

### 10. Create GitHub Issues (unless --dry-run)

**Secret Sanitization - BEFORE creating issues:**
Scan report content for patterns:
- `(api[_-]?key|token|password|secret)[=:]\s*\S+`
- `[A-Z_]+_KEY`, `[A-Z_]+_SECRET`
- Replace matches with `[REDACTED]`

**Check gh auth:**
```bash
if ! gh auth status >/dev/null 2>&1; then
  echo "WARNING: Not authenticated with GitHub. Skipping issue creation."
  exit 0
fi
```

**Create issues:**
For each P0 or P1 finding:
```bash
gh issue create \
  --title "[User Testing] [Category]: [Short Title]" \
  --body "$(cat <<'EOF'
## Description
[Finding description]

## Steps to Reproduce
1. ...

## Evidence
[Screenshot or logs]

## Session
- Mode: [mode]
- Report: [link to report file]

---
*Found by AI-driven exploratory testing*
EOF
)" \
  --label "bug,user-testing"
```

### 11. Cleanup

Close browser:
```
mcp__playwright__browser_close
```

Report location:
```
echo "Report saved to: $REPORT_FILE"
```

## Error Handling

| Error | Action |
|-------|--------|
| Server not found | Call `ensure-server.sh`, retry |
| Connection refused | Server may have timed out, restart via `ensure-server.sh` |
| Auth failed | Take screenshot, report as critical finding |
| Element not found | Record as potential finding, continue |
| Browser crash | Attempt restart, terminate with partial report if fails |
| Session timeout (10 min) | Complete report with current findings |

## Key Reference

**Selectors from Page Object Models:**

```typescript
// LoginPage.ts
emailInput = '#email'
passwordInput = '#password'
submitButton = 'button[type="submit"]'

// SearchPage.ts
searchInput = '[data-testid="search-input"]'
searchButton = '[data-testid="search-submit"]'

// ResultsPage.ts
explanationTitle = '[data-testid="explanation-title"]'
explanationContent = '[data-testid="explanation-content"]'
saveToLibraryButton = '[data-testid="save-to-library"]'
streamCompleteIndicator = '[data-testid="stream-complete"]'
tagItem = '[data-testid="tag-item"]'
errorMessage = '[data-testid="error-message"]'
```

**MCP Tools Available:**
- `mcp__playwright__browser_navigate` - Go to URL
- `mcp__playwright__browser_snapshot` - Get accessibility tree with refs
- `mcp__playwright__browser_click` - Click element by ref
- `mcp__playwright__browser_type` - Type into element by ref
- `mcp__playwright__browser_fill_form` - Fill multiple fields
- `mcp__playwright__browser_console_messages` - Get console logs
- `mcp__playwright__browser_take_screenshot` - Capture screenshot
- `mcp__playwright__browser_wait_for` - Wait for text/element
- `mcp__playwright__browser_close` - Close browser
