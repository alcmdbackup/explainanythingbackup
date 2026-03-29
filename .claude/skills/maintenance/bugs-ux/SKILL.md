---
description: "Use Playwright to test evolution admin dashboard for bugs and UX issues"
---

## Scope
- Evolution admin dashboard at staging URL
- Pages: `/admin/quality/evolution/*`, `/admin/quality/arena/*`, `/admin/quality/experiments/*`

## Execution
1. Start browser via Playwright MCP: `mcp__playwright__browser_navigate` to staging admin URL
2. Authenticate using test credentials
3. Systematically visit each evolution admin page
4. For each page:
   - Take accessibility snapshot: `mcp__playwright__browser_snapshot`
   - Check console for errors: `mcp__playwright__browser_console_messages`
   - Test interactive elements (sorting, filtering, pagination)
   - Take screenshot of any issues: `mcp__playwright__browser_take_screenshot`
5. Classify findings as Bug-Critical/Major/Minor or UX-Major/Minor

## Agent Angles (4 per round)
1. **Functional Testing** — click every button, fill every form, verify expected behavior
2. **Visual/Layout** — look for broken layouts, overflow, alignment issues
3. **Error States** — test with missing data, invalid inputs, network errors
4. **Accessibility** — check ARIA labels, keyboard navigation, color contrast

## Key Questions
- Do all admin pages load without console errors?
- Are there broken interactive elements (buttons that don't respond, forms that don't submit)?
- Does the UI handle empty states and loading states gracefully?
- Are there accessibility violations (missing labels, broken tab order)?
