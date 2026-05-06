# User Testing - AI-Driven Exploratory Testing

AI-driven exploratory testing using Playwright MCP tools to discover UX issues and bugs through human-like exploration.

## Overview

While E2E tests verify scripted flows work correctly, they cannot discover issues in unscripted paths. The `/user-test` skill enables autonomous exploration that simulates real user behavior to find:

- Confusing UI patterns that technically "work" but frustrate users
- Edge cases through random exploration
- Missing feedback, unclear labels, or friction points
- Console errors and accessibility issues

## When to Use

- **After deploying new features** - Discover edge cases missed by scripted tests
- **Before releases** - Smoke test for unexpected regressions
- **For UX audits** - Evaluate experience from different user perspectives
- **When investigating user reports** - Reproduce issues through exploration

## Exploration Modes

### Autonomous Mode (default)

Random weighted exploration for 10 minutes:
- Navigate to random pages (20%)
- Click interactive elements (40%)
- Fill forms with test data (20%)
- Read content and check accessibility (20%)

```bash
/user-test
```

### Goal-Oriented Mode

Work toward a specific objective:

```bash
/user-test --mode=goal --goal="save an explanation"
```

The skill decomposes the goal into steps, executes each with verification, and reports success/failure.

### Persona-Based Mode

Simulate different user types:

| Persona | Behavior |
|---------|----------|
| `new-user` | Slow, methodical, reads all labels, looks for help |
| `power-user` | Fast, keyboard shortcuts, skips tutorials, tries advanced features |
| `confused-user` | Random clicks, ignores errors, submits incomplete forms |

```bash
/user-test --mode=persona --persona=confused-user
```

## Issue Detection

### Console Error Capture

Uses `mcp__playwright__browser_console_messages` to capture JavaScript errors and warnings throughout exploration.

### Accessibility Analysis

After each navigation, analyzes the accessibility tree via `mcp__playwright__browser_snapshot` to detect:
- Interactive elements without labels
- Images without alt text
- Form fields without associated labels

### Screenshot Evidence

Captures screenshots for each finding:
- Before/after major interactions
- Error states
- Visual anomalies

## Classification Schema

| Category | Severity | Criteria |
|----------|----------|----------|
| Bug-Critical | P0 | App crashes, data loss, security issues |
| Bug-Major | P1 | Feature broken, console errors, blocked flows |
| Bug-Minor | P2 | Visual glitches, minor behavior issues |
| UX-Major | P1 | Confusing flow, task blocked, missing feedback |
| UX-Minor | P2 | Friction, unclear labels, slow interactions |

## Output

### Report Location

Reports are saved to `test-results/user-testing/report_YYYYMMDD_HHMMSS.md`

### Report Structure

```markdown
# User Testing Report - [SESSION_ID]

## Session Info
- Mode: autonomous
- Duration: 10m 23s
- Server: http://localhost:3142

## Summary
- Total Findings: 5
- Bugs: 2 (Critical: 0, Major: 1, Minor: 1)
- UX Issues: 3 (Major: 2, Minor: 1)

## Detailed Findings
### Finding 1: Search submit button unclear
- Category: UX-Minor
- Location: /
- Description: Search button lacks visual affordance
...
```

### GitHub Issues

P0 and P1 findings automatically create GitHub issues (unless `--dry-run`):

```bash
# Generate report only, no issues
/user-test --dry-run
```

Issues are labeled with `bug` and `user-testing`.

## Integration with E2E Tests

| Aspect | E2E Tests | User Testing Skill |
|--------|-----------|-------------------|
| **API** | Playwright JavaScript API | Playwright MCP tools |
| **Auth** | API-based cookie injection | UI-based login form |
| **Execution** | Scripted, deterministic | Autonomous, non-deterministic |
| **Purpose** | Verify known flows work | Discover unknown issues |
| **Selectors** | Direct CSS/data-testid | Accessibility tree refs |

Both share Page Object Model selectors as reference.

## Recommended Verification Cycle: Playwright Sweep → Source-Code Audit

A two-pass workflow that proved valuable during the 2026-04-22 evolution-admin bug hunt (`use_playwright_find_bugs_ux_issues_20260422`). The Playwright sweep is fast and surfaces *apparent* issues, but roughly 20–30% of findings are false positives — the UI looked wrong but the source code revealed it was already correct, or the "bug" was the author's own misreading of the data. Always follow the sweep with a source-code audit before writing fix tickets.

**Pass 1 — Playwright sweep.** Use `/user-test` (or direct MCP calls) to navigate every admin page, capture a console-error + a11y snapshot, and enumerate candidate issues. Tag each finding with (a) page URL, (b) data-testid or accessibility-tree ref, and (c) a one-line suspected cause.

**Pass 2 — Source-code audit.** For each candidate, open the rendering component and the server action it calls. Verify the suspected cause by reading code. Common false-positive patterns:
- Visual clutter mistaken for filter bugs (the filter *was* correct; the screenshot happened before state updated).
- "Duplicate" labels that are actually config-hash-disambiguated strategies with genuinely different configs.
- "Missing" columns already intentionally dropped (e.g., arena Cost column — variant-level cost is always N/A).

Findings surviving pass 2 go into the planning doc. Rejected findings go in the research doc with the reason, so the reviewer can see the reasoning trail.

## MCP Tool Pattern

Unlike standard Playwright, MCP tools require a two-step pattern:

1. **Get refs**: `mcp__playwright__browser_snapshot` returns accessibility tree with refs
2. **Use refs**: `mcp__playwright__browser_click(element: "Button", ref: "s1e45")`

```
# Wrong - CSS selectors don't work
mcp__playwright__browser_click(ref: '[data-testid="button"]')

# Correct - use refs from snapshot
snapshot → button "Submit" [ref=s1e45]
mcp__playwright__browser_click(element: "Submit", ref: "s1e45")
```

## Server Integration

Uses the on-demand tmux dev server infrastructure:

1. Calls `./docs/planning/tmux_usage/ensure-server.sh`
2. Discovers server URL from `/tmp/claude-instance-*.json`
3. Polls `/api/health` until ready
4. MCP tool calls automatically reset idle timeout

## Security

### Input Sanitization

Goal arguments are validated to prevent XSS:
- Rejects HTML tags, event handlers, dangerous protocols
- Limits length to 200 characters

### Secret Redaction

Before creating GitHub issues:
- Scans for API keys, tokens, passwords
- Replaces with `[REDACTED]`
- Unredacted version kept only in local report

## Limitations

- **Non-deterministic**: Results vary between runs (by design)
- **10-minute limit**: Session terminates after 10 minutes
- **Local/staging only**: Not intended for production
- **Manual review needed**: Findings require human validation

## Related Documentation

- [Testing Setup](./testing_setup.md) - Overall testing strategy
- [tmux Usage Recommendations](../planning/tmux_usage/using_tmux_recommendations.md) - Server infrastructure
- [Planning Document](../planning/user_testing_20260103/user_testing_planning.md) - Original design
