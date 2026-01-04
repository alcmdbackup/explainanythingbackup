# User Testing Research

## Problem Statement
Need a way to use Claude Code for exploratory user testing on the website, collecting feedback on bugs and UX issues through open-ended exploration rather than scripted Playwright tests.

## High Level Summary
Creating a `/user-test` Claude Code skill that enables AI-driven website exploration. Unlike E2E tests which follow scripts, this feature lets Claude explore autonomously like a real user, discovering issues that scripted tests might miss.

## Documents Read
- `/docs/docs_overall/start_project.md` - Project structure requirements
- `/docs/docs_overall/project_instructions.md` - Execution guidelines
- `.claude/commands/plan-review.md` - Pattern for complex multi-step skills

## Code Files Read
- `src/__tests__/e2e/helpers/pages/LoginPage.ts` - Auth flow selectors (#email, #password)
- `src/__tests__/e2e/helpers/pages/ResultsPage.ts` - 40+ selectors for results page interactions
- `src/__tests__/e2e/fixtures/auth.ts` - Supabase auth pattern
- `playwright.config.ts` - Playwright configuration
- `settings.json` - MCP permissions (Playwright MCP enabled)

## Key Findings

### Available Browser Automation
- Playwright MCP tools: `mcp__playwright__browser_*`
- Key tools: navigate, snapshot, click, type, console_messages, take_screenshot
- All permissions pre-configured in settings.json

### Existing Test Infrastructure
- Page Object Models provide reliable selectors
- Auth pattern: Navigate to /login, fill form, wait for redirect
- Test user: abecha@gmail.com / password

### Application Pages
- `/` - Home with search
- `/login` - Authentication
- `/results` - Explanation viewing/streaming
- `/userlibrary` - Saved explanations
- `/settings` - User preferences

## Infrastructure Integration (tmux On-Demand Servers)

### Key Discovery
The user testing skill must integrate with the tmux on-demand server infrastructure. This was identified as a critical gap during planning review.

### Documents Read (Additional)
- `docs/planning/tmux_usage/using_tmux_recommendations.md` - On-demand server management
- `playwright.config.ts` - Server discovery pattern (lines 32-77)
- `src/__tests__/e2e/setup/global-setup.ts` - Health check pattern (lines 46-87)

### Key Findings

#### Server Discovery Pattern
- Servers run on dynamic ports (3100-3999)
- Instance info stored in `/tmp/claude-instance-*.json`
- Must match `project_root` field to find correct server for current worktree
- Priority chain: `BASE_URL` env > instance discovery > localhost:3008 fallback

#### Server Lifecycle
- Servers start on-demand via `ensure-server.sh` (not always running)
- First run after idle takes 10-30s for server startup
- Auto-shutdown after 5 minutes idle (conflicts with 10-min exploration sessions)
- Health check via `/api/health` endpoint before proceeding

#### Integration Points
- Call `./docs/planning/tmux_usage/ensure-server.sh` before exploration
- Poll `/api/health` before auth attempt
- Discover `frontend_url` from instance JSON file
- Handle multi-worktree scenarios via `project_root` matching
