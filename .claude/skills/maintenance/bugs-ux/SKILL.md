---
description: "Use Playwright to test evolution admin dashboard for bugs and UX issues"
---

## Scope
- Evolution admin dashboard (local dev or staging)
- Pages under `/admin/evolution/*` and `/admin/evolution-dashboard`
- Sub-routes: experiments, prompts, strategies, runs, invocations, variants, arena, start-experiment
- Detail pages: experiments/[id], arena/[topicId], runs/[runId], invocations/[invocationId], variants/[variantId], prompts/[promptId], strategies/[strategyId]

## Protocol Override
This skill does NOT follow the shared-preamble's 4-round x 4-agent pattern.
Playwright browser actions are inherently serial (one page at a time), so use a **sequential exploratory testing** approach instead.

### Goal: Find 50 distinct issues
Test pages one at a time. For each page: snapshot, check console errors, test interactions, screenshot issues.
Keep a running tally. Stop when you reach 50 distinct findings or exhaust all pages and interactions.

## Authentication
The scheduler sources `.env.local` before launching. Authenticate using Playwright:

1. Navigate to the app's login page (e.g. `http://localhost:<PORT>/login`)
2. Use `mcp__playwright__browser_evaluate` to call the Supabase auth API from the browser context:
   - Supabase URL: read from `NEXT_PUBLIC_SUPABASE_URL` env var
   - Anon key: read from `NEXT_PUBLIC_SUPABASE_ANON_KEY` env var
   - Email: read from `TEST_USER_EMAIL` env var
   - Password: read from `TEST_USER_PASSWORD` env var
3. Build a Supabase SSR auth cookie from the returned session (base64url-encoded JSON with `base64-` prefix)
4. Set the cookie via `page.context().addCookies()` on the localhost domain
5. Navigate to the first admin page to verify auth works

If env vars are missing, report the auth failure and stop.

## Execution (sequential)
1. **Auth** — authenticate as described above
2. **List page scan** — visit each list page in order:
   - `/admin/evolution-dashboard`
   - `/admin/evolution/experiments`
   - `/admin/evolution/prompts`
   - `/admin/evolution/strategies`
   - `/admin/evolution/runs`
   - `/admin/evolution/invocations`
   - `/admin/evolution/variants`
   - `/admin/evolution/arena`
   - `/admin/evolution/start-experiment`
   For each: snapshot, check console errors, check Web Vitals (CLS/LCP/FCP), screenshot, test filters/sorting
3. **Detail page drill-down** — click into the first item on each list page to test detail views
4. **Interactive testing** — for each page with interactive elements:
   - Toggle "Hide test content" checkbox
   - Change filter dropdowns
   - Click pagination (if present)
   - Test form submission (start-experiment page — fill but don't submit)
   - Test Cancel/Delete buttons (snapshot only, don't actually trigger destructive actions)
5. **Edge cases** — test with filters that produce empty results, invalid URLs, back-navigation

## Issue Classification
- **Bug-Critical**: Page crashes, data loss, broken auth
- **Bug-Major**: Console errors, broken interactions, wrong data displayed
- **Bug-Minor**: Minor visual glitches, non-blocking issues
- **UX-Major**: Missing pagination, layout shifts (poor CLS), truncated content, confusing navigation
- **UX-Minor**: Inconsistent styling, missing empty states, poor loading indicators

## Key Questions
- Do all admin pages load without console errors?
- Are there broken interactive elements (buttons that don't respond, forms that don't submit)?
- Does the UI handle empty states and loading states gracefully?
- Are there layout shifts when data loads (check CLS in Web Vitals console logs)?
- Do detail pages show proper breadcrumbs and back-navigation?
- Is pagination present on pages with many items?
- Are there accessibility issues (missing ARIA labels, broken tab order)?
