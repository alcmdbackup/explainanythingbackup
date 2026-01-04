# User Testing Skill - Planning Document

## 1. Background
The codebase has comprehensive Playwright E2E tests (52+ tests) that follow scripted scenarios. However, scripted tests only catch issues in predefined paths. Real users explore unpredictably, discovering edge cases and UX friction that scripts miss. Claude Code has access to Playwright MCP tools that enable browser automation, making it possible to create an AI-driven exploratory testing capability.

## 2. Problem
There is no mechanism to perform open-ended, human-like exploration of the website to discover UX issues and bugs. Scripted E2E tests verify known flows work correctly, but they cannot:
- Discover confusing UI patterns that technically "work" but frustrate users
- Find edge cases through random exploration
- Evaluate the experience from different user personas (new user, power user, confused user)
- Identify missing feedback, unclear labels, or friction points

## 3. Options Considered

### Option A: Extend Existing E2E Tests
Add more scripted test scenarios to cover edge cases.
- **Pros**: Uses existing infrastructure, deterministic
- **Cons**: Still scripted, can't discover unknown issues, high maintenance

### Option B: Claude Code Skill with Playwright MCP (Selected)
Create a `/user-test` skill that instructs Claude to explore the site using Playwright MCP tools.
- **Pros**: Autonomous exploration, discovers unknown issues, multiple exploration modes
- **Cons**: Non-deterministic, requires well-structured skill prompt

### Option C: External Testing Tool
Use a third-party AI testing tool like Testim or Mabl.
- **Pros**: Purpose-built for AI testing
- **Cons**: Additional cost, doesn't integrate with Claude Code workflow

**Decision**: Option B - Leverages existing Playwright MCP infrastructure and integrates naturally with the Claude Code development workflow.

## 3.1 MCP Tool Usage Pattern for Skills

This is the first skill to use Playwright MCP tools. The pattern established here will serve as reference for future browser-automation skills.

**Available Playwright MCP Tools:**
```
mcp__playwright__browser_navigate    - Navigate to URL
mcp__playwright__browser_snapshot    - Get accessibility tree (preferred for state)
mcp__playwright__browser_click       - Click element by ref
mcp__playwright__browser_type        - Type text into element
mcp__playwright__browser_fill_form   - Fill multiple form fields
mcp__playwright__browser_console_messages - Get console logs (error/warning/info)
mcp__playwright__browser_take_screenshot - Capture visual evidence
mcp__playwright__browser_wait_for    - Wait for text/element
mcp__playwright__browser_close       - Close browser
```

**MCP vs Standard Playwright:**
- E2E tests use standard Playwright API via `@playwright/test`
- Skills use Playwright MCP tools via `mcp__playwright__*` function calls
- Selectors work the same way (CSS, data-testid, etc.)
- MCP tools are synchronous from skill perspective (no async/await)

**Integration with Existing Infrastructure:**
- Page Object Model selectors from `src/__tests__/e2e/helpers/pages/*.ts` can be referenced
- Auth flow mirrors `LoginPage.ts` pattern but uses MCP tools
- Screenshot storage follows `test-results/` conventions

**Error Handling & Timeouts:**
The skill will include robust error handling:
1. **Session timeout**: 10 minutes max exploration time, warn at 8 minutes
2. **Action timeout**: 30 seconds per MCP tool call before retry
3. **Retry strategy**: 3 retries with exponential backoff (1s, 2s, 4s) for transient failures
4. **Network failures**: Log error, capture screenshot, continue to next action
5. **Element not found**: Record as potential finding, continue exploration
6. **Browser crash**: Attempt restart, if failed terminate with partial report
7. **gh CLI auth check**: Verify `gh auth status` before issue creation, warn if not authenticated
8. **Server not found**: Check `/tmp/claude-instance-*.json` exists, call `ensure-server.sh`
9. **Connection refused**: Server may have hit idle timeout, restart via `ensure-server.sh`
10. **Health check timeout**: Check tmux logs via `tmux capture-pane -t claude-<id>-backend -p -S -100`

**Auth Approach Note:**
The skill uses **UI-based login via Playwright MCP** (navigate to /login, fill form, submit), which differs from E2E test fixtures that use **API-based auth with cookie injection**. This is intentional:
- UI-based auth tests the actual login flow
- Matches real user behavior for exploratory testing
- Does not require Supabase API access from skill context

## 3.2 Infrastructure Integration (tmux On-Demand Servers)

This skill integrates with the on-demand tmux dev server infrastructure. Understanding this is critical for reliable operation.

**Reference:** `docs/planning/tmux_usage/using_tmux_recommendations.md`

### Server Discovery

The skill must discover the server URL at runtime since servers use dynamic ports (3100-3999).

**Since skills are markdown-based (not TypeScript), the skill instructs Claude to use Bash for discovery:**

```bash
# Discovery via Bash (skill instructs Claude to run this)
# Step 1: Check for BASE_URL override
if [ -n "$BASE_URL" ]; then
  echo "$BASE_URL"
  exit 0
fi

# Step 2: Find instance file matching current worktree
PROJECT_ROOT=$(pwd)
for f in /tmp/claude-instance-*.json; do
  [ -f "$f" ] || continue
  if jq -e --arg pr "$PROJECT_ROOT" '.project_root == $pr' "$f" >/dev/null 2>&1; then
    jq -r '.frontend_url' "$f"
    exit 0
  fi
done

# Step 3: Fallback
echo "http://localhost:3008"
```

**Skill Instruction Pattern:**
The skill will instruct Claude: "Before navigating, run the server discovery script via Bash tool to get the correct URL."

**URL Priority Chain:**
1. `BASE_URL` environment variable (explicit override for staging/production)
2. Instance file discovery (match `project_root` to current working directory)
3. Fallback: `http://localhost:3008`

### Server Lifecycle

Before any browser navigation, the skill must ensure the server is running:
1. Call `./docs/planning/tmux_usage/ensure-server.sh`
2. Wait for server startup (10-30s on cold start, instant if already running)
3. Poll `/api/health` endpoint until ready (30 retries, 1s interval)

**Health Check Pattern (Bash for skill):**
```bash
# Health check via Bash (skill instructs Claude to run this after discovery)
SERVER_URL="${1:-http://localhost:3008}"
for i in $(seq 1 30); do
  if curl -sf --max-time 5 "${SERVER_URL}/api/health" >/dev/null 2>&1; then
    echo "Server ready at ${SERVER_URL}"
    exit 0
  fi
  sleep 1
done
echo "Health check failed after 30 attempts" >&2
exit 1
```

**Reference:** TypeScript equivalent in `global-setup.ts` uses `fetch` with `AbortSignal.timeout`.

### Idle Timeout Management

**Conflict:** Skill allows 10-minute exploration sessions, but infrastructure auto-kills servers after 5 minutes idle.

**Resolution:** MCP tool calls trigger HTTP activity that resets the idle timer automatically. No explicit handling needed as long as exploration remains active. For long waits (e.g., during streaming), the server activity from the app itself keeps the timer reset.

**If exploration stalls for >5 minutes:**
- Server will be killed by `idle-watcher.sh`
- Next MCP tool call will fail with "connection refused"
- Skill should detect this and call `ensure-server.sh` to restart

## 4. Phased Execution Plan

### Phase 1: Core Skill File
Create `.claude/commands/user-test.md` with:
- YAML frontmatter (name, description)
- Argument parsing (--mode, --goal, --persona, --dry-run)
- Authentication using existing pattern from `src/__tests__/e2e/fixtures/auth.ts`
- Basic autonomous exploration logic

**Authentication Strategy:**
The skill will use the same auth pattern as E2E tests. Credentials are read from CLAUDE.md which is gitignored. The skill will:
1. Reference credentials indirectly: "Use credentials from CLAUDE.md (email/password)"
2. NOT embed actual credential values in the skill file
3. Follow the LoginPage.ts pattern for UI-based auth via Playwright MCP

**Files Modified:**
- `.claude/commands/user-test.md` (create)

**Verification:**
- Invoke `/user-test` and confirm it authenticates and navigates

**Infrastructure Verification (from 3.2):**
- [ ] Skill calls `ensure-server.sh` before exploration
- [ ] Skill discovers server URL from `/tmp/claude-instance-*.json`
- [ ] Skill handles server startup latency (up to 60s timeout)
- [ ] Health check (`/api/health`) passes before auth attempt

### Phase 2: Exploration Modes
Implement three exploration modes:
- Autonomous: Random weighted exploration
- Goal-oriented: Parse --goal and find path to accomplish
- Persona-based: Behavior profiles for new-user, power-user, confused-user

**Input Sanitization for --goal:**
The skill will validate and sanitize the --goal argument:
1. Reject goals containing script-like patterns:
   - HTML tags: `<script>`, `<iframe>`, `<object>`, `<embed>`
   - Event handlers: `onclick`, `onerror`, `onload`, `onmouseover`
   - Protocols: `javascript:`, `data:`, `vbscript:`
2. Limit goal length to 200 characters
3. Escape special characters before using in browser interactions
4. Log rejected goals for security auditing

**Files Modified:**
- `.claude/commands/user-test.md` (update)

**Verification:**
- Test `/user-test --mode=goal --goal="save an explanation"`
- Test `/user-test --mode=persona --persona=new-user`
- Test that malicious --goal input is rejected

### Phase 3: Issue Detection & Classification
Add continuous monitoring:
- Console error capture via `browser_console_messages`
- Accessibility analysis via `browser_snapshot`
- Screenshot capture for evidence
- Finding classification (Bug/UX, severity levels)

**Files Modified:**
- `.claude/commands/user-test.md` (update)

**Verification:**
- Intentionally trigger a console error and verify it's captured
- Verify findings are classified correctly

### Phase 4: Output Generation
Implement report and issue creation:
- Markdown report in `test-results/user-testing/` (aligns with existing test artifact patterns)
- GitHub issue creation via `gh issue create`
- `--dry-run` flag to skip issue creation

**Secret Sanitization for GitHub Issues:**
Before creating GitHub issues, the skill will sanitize content:
1. Scan console logs for patterns matching secrets (API keys, tokens, passwords)
   - Regex patterns: `(api[_-]?key|token|password|secret|auth)[=:]\s*[^\s]+`
   - Environment variable patterns: `[A-Z_]+_KEY`, `[A-Z_]+_SECRET`
2. Redact detected secrets with `[REDACTED]`
3. Review screenshot content description for sensitive data mentions
4. Warn user before issue creation if potential secrets detected
5. Store unredacted version only in local report (not GitHub)

**Files Modified:**
- `.claude/commands/user-test.md` (update)
- `test-results/user-testing/.gitkeep` (create)
- `.gitignore` (add `test-results/user-testing/*.md` to prevent committing reports)

**Verification:**
- Run with `--dry-run` and verify report is generated
- Run without `--dry-run` and verify issues are created
- Verify that console logs with secrets are redacted in GitHub issues

### Phase 5: Documentation
Create feature documentation:
- `docs/feature_deep_dives/user_testing.md`
- Update any relevant docs

**Files Modified:**
- `docs/feature_deep_dives/user_testing.md` (create)

**Verification:**
- Documentation accurately describes the feature

## 5. Testing

### Manual Testing
- [ ] `/user-test` (autonomous mode) completes without errors
- [ ] `/user-test --mode=goal --goal="search for something"` accomplishes goal
- [ ] `/user-test --mode=persona --persona=confused-user` exhibits confused behavior
- [ ] `/user-test --dry-run` generates report without creating issues
- [ ] Console errors are captured and classified as bugs
- [ ] UX issues are identified and classified appropriately
- [ ] GitHub issues are created with correct labels and format
- [ ] Markdown report contains all findings with evidence

### Staging Verification
- [ ] Run `/user-test` against staging environment (explainanything.vercel.app)
- [ ] Verify authentication works
- [ ] Verify all pages are accessible
- [ ] Confirm findings are actionable

### Infrastructure Integration Tests
- [ ] Skill correctly discovers dynamic server URL from `/tmp/claude-instance-*.json`
- [ ] Skill handles cold start (no server running) - calls `ensure-server.sh`
- [ ] Skill handles warm start (server already running) - skips startup, proceeds immediately
- [ ] Long exploration (>5 min) completes without idle timeout killing server
- [ ] Skill recovers from server crash by restarting via `ensure-server.sh`
- [ ] Multi-worktree scenario: skill finds correct server by matching `project_root`

## 6. Documentation Updates

| Document | Update Needed |
|----------|---------------|
| `docs/feature_deep_dives/user_testing.md` | Create - Full feature documentation |
| `docs/docs_overall/testing_rules.md` | Add reference to exploratory testing |
| `docs/feature_deep_dives/testing_setup.md` | Add section on AI-driven testing |

## 7. Page Object Model Integration

The skill will reference existing Page Object Models for reliable selectors. These POMs are the source of truth for UI element targeting.

**POM Files to Reference:**
| File | Purpose | Key Methods |
|------|---------|-------------|
| `src/__tests__/e2e/helpers/pages/LoginPage.ts` | Authentication | `login()`, `fillEmail()`, `fillPassword()` |
| `src/__tests__/e2e/helpers/pages/SearchPage.ts` | Search functionality | `search()`, `submitSearch()` |
| `src/__tests__/e2e/helpers/pages/ResultsPage.ts` | Results viewing | `waitForStreamingComplete()`, `getTags()`, `clickSaveToLibrary()` |
| `src/__tests__/e2e/helpers/pages/UserLibraryPage.ts` | Library management | Table navigation, sorting |
| `src/__tests__/e2e/helpers/pages/BasePage.ts` | Common navigation | `navigate()`, base URL handling |

**Key Selectors (from POMs):**

```typescript
// LoginPage.ts
private emailInput = '#email';
private passwordInput = '#password';
private submitButton = 'button[type="submit"]';

// SearchPage.ts
private searchInput = '[data-testid="search-input"]';
private searchSubmit = '[data-testid="search-submit"]';

// ResultsPage.ts
private explanationTitle = '[data-testid="explanation-title"]';
private explanationContent = '[data-testid="explanation-content"]';
private saveToLibraryButton = '[data-testid="save-to-library"]';
private streamCompleteIndicator = '[data-testid="stream-complete"]';
private tagItem = '[data-testid="tag-item"]';
private rewriteButton = '[data-testid="rewrite-button"]';
private editButton = '[data-testid="edit-button"]';
private errorMessage = '[data-testid="error-message"]';
private aiSuggestionsPanel = '[data-testid="ai-suggestions-panel"]';
```

**Usage in Skill:**
The skill will instruct Claude to use these selectors with Playwright MCP tools.

**IMPORTANT: MCP Tool Workflow (Two-Step Pattern)**

Playwright MCP tools use accessibility tree refs from `browser_snapshot`, NOT CSS selectors directly:

```
Step 1: Get page state via browser_snapshot
  → Returns accessibility tree with refs like:
    - button "Save to Library" [ref=s1e45]
    - textbox "Search..." [ref=s1e12]
    - link "Home" [ref=s1e3]

Step 2: Use the ref from snapshot in tool calls
  mcp__playwright__browser_click:
    element: "Save to Library button"
    ref: "s1e45"  ← ref from snapshot, NOT CSS selector

  mcp__playwright__browser_type:
    element: "Search input"
    ref: "s1e12"  ← ref from snapshot
    text: "quantum computing"
```

**CSS Selectors as Fallback:**
If `browser_snapshot` doesn't provide a ref for an element, use `browser_click` with a CSS selector description:
```
mcp__playwright__browser_click:
  element: "save button with data-testid"
  ref: "[data-testid='save-to-library']"
```

**Key Difference from E2E Tests:**
- E2E tests: Use CSS selectors directly via Playwright API
- MCP tools: First call `browser_snapshot`, then use returned refs

The skill will instruct Claude: "Always call browser_snapshot first to get element refs before clicking or typing."

## 8. CI/CD Integration

### 8.1 Scope Clarification

This skill is **designed for interactive, exploratory testing** - not deterministic CI runs. The non-deterministic nature of AI exploration means:
- Results vary between runs (by design)
- 10-minute exploration sessions exceed typical CI timeouts
- Human review of findings is expected

**CI/CD is NOT a primary use case**, but basic integration is provided for:
- Scheduled smoke tests against staging
- Manual trigger for regression testing

### 8.2 GitHub Actions Workflow (Optional)

Add `.github/workflows/user-testing.yml` for scheduled/manual runs:

```yaml
name: AI User Testing (Manual)

on:
  workflow_dispatch:
    inputs:
      mode:
        description: 'Exploration mode'
        type: choice
        options: [autonomous, goal, persona]
        default: autonomous
      environment:
        description: 'Target environment'
        type: choice
        options: [staging, local]
        default: staging
  schedule:
    # Weekly smoke test on staging (Sundays 3am UTC)
    - cron: '0 3 * * 0'

jobs:
  user-test:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Playwright
        run: npx playwright install chromium

      - name: Install Claude Code CLI
        run: npm install -g @anthropic-ai/claude-code

      - name: Run User Testing Skill
        env:
          BASE_URL: ${{ inputs.environment == 'staging' && 'https://explainanything.vercel.app' || 'http://localhost:3008' }}
          TEST_EMAIL: ${{ secrets.TEST_EMAIL }}
          TEST_PASSWORD: ${{ secrets.TEST_PASSWORD }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          # Invoke user-test skill via Claude Code CLI
          # Note: Actual CLI syntax may differ - verify against current docs
          # See: https://docs.anthropic.com/claude-code/cli
          claude /user-test --mode=${{ inputs.mode }} --dry-run

      - name: Upload Report
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: user-testing-report
          path: |
            test-results/user-testing/*.md
            test-results/user-testing/*.png
          retention-days: 30
```

### 8.3 Environment Variables

| Variable | Purpose | Required In |
|----------|---------|-------------|
| `BASE_URL` | Target URL (staging/production) | CI only |
| `TEST_EMAIL` | Test account email | CI only (local uses CLAUDE.md) |
| `TEST_PASSWORD` | Test account password | CI only (local uses CLAUDE.md) |
| `GH_TOKEN` | GitHub token for issue creation | CI only (local uses `gh auth`) |

**Local Development:**
- Credentials read from `CLAUDE.md` (gitignored)
- GitHub auth via `gh auth login`
- Server URL discovered from `/tmp/claude-instance-*.json`

### 8.4 Secrets Management

**GitHub Secrets Required:**
1. `TEST_EMAIL` - Dedicated test account email (not production user)
2. `TEST_PASSWORD` - Test account password
3. `ANTHROPIC_API_KEY` - API key for Claude Code CLI
4. `GITHUB_TOKEN` - Provided automatically by Actions

**Security Notes:**
- Never use production user credentials in CI
- Create dedicated test account in staging environment
- `--dry-run` flag recommended for CI to prevent auto-issue creation
- Reports uploaded as artifacts, not committed to repo

### 8.5 CI Limitations

| Aspect | Limitation | Mitigation |
|--------|------------|------------|
| Session length | 15min timeout | Use `--mode=goal` for focused tests |
| Non-deterministic | Results vary | Human review of reports required |
| Browser context | Fresh each run | Can't test session persistence |
| Rate limits | GitHub issue limits | Use `--dry-run` in CI |

## 9. Rollback Plan

Since this is a new skill file with no production dependencies:
1. Delete `.claude/commands/user-test.md`
2. Delete `test-results/user-testing/` directory
3. Delete `docs/feature_deep_dives/user_testing.md`
4. Revert `.gitignore` additions
5. Revert any documentation updates

No database changes, no API changes, no risk to existing functionality.
