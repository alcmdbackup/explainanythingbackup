# Sentry Not Catching Errors Prod Plan

## Background

Sentry is integrated into the ExplainAnything codebase with client, server, and edge configurations. The setup includes a tunnel endpoint (`/api/monitoring`) to bypass ad blockers, error boundaries for React errors, and centralized error handling via `handleError()`. The configuration uses environment variables `SENTRY_DSN` (server) and `NEXT_PUBLIC_SENTRY_DSN` (client) which should be set in Vercel production.

## Problem

Errors occurring in production are not appearing in the Sentry dashboard. This could be caused by: missing/incorrect environment variables, the tunnel endpoint silently failing, `beforeSend` filters being too aggressive, errors not being caught by error boundaries, or the Sentry dashboard filtering out production events. We need to systematically investigate each potential cause.

## Options Considered

1. **Check environment variables first** - Verify DSN is set correctly in Vercel
2. **Test with intentional error** - Trigger a known error and trace its path
3. **Add debug logging to tunnel** - Log when events are received/forwarded
4. **Check Sentry dashboard filters** - Ensure production events aren't hidden
5. **Review beforeSend logic** - Check if legitimate errors are being filtered
6. **Test client vs server separately** - Isolate which side is failing

## Phased Execution Plan

### Phase 1: Environment Variable & Config Verification
**Goal:** Confirm Sentry DSNs are configured in production AND client config has environment field

**1a. Verify Tunnel DSN (SENTRY_DSN)**
- Check Vercel dashboard for `SENTRY_DSN` env var in Production scope
- This is used by `src/app/api/monitoring/route.ts` tunnel endpoint
- **CRITICAL:** If missing, tunnel silently returns 200 and drops all client events

**1b. Verify Client DSN (NEXT_PUBLIC_SENTRY_DSN)**
- Check Vercel dashboard for `NEXT_PUBLIC_SENTRY_DSN` env var in Production scope
- This is used by `sentry.client.config.ts` for browser SDK initialization
- Must be a `NEXT_PUBLIC_` prefixed var to be available client-side

**1c. Verify DSN Values Match**
- Both DSNs should point to the same Sentry project (`minddojo/explainanything`)
- Format: `https://<key>@<org>.ingest.sentry.io/<project-id>`

**1d. Check Client Config Environment Field**
- Open `sentry.client.config.ts` and verify it has `environment` field
- **KNOWN ISSUE:** Client config is MISSING the `environment` field!
  - Server config has: `environment: process.env.NODE_ENV` (line 9)
  - Edge config has: `environment: process.env.NODE_ENV`
  - Client config does NOT have this - this is a likely root cause
- If client config is missing this, client errors won't have environment tag, causing dashboard filter issues

**1e. Verify Source Map Upload Env Vars (Optional)**
- `SENTRY_ORG` - Required for source map upload
- `SENTRY_PROJECT` - Required for source map upload
- `SENTRY_AUTH_TOKEN` - Required for source map upload

**Success Criteria:**
- Both DSNs are set and point to correct project
- Client config has `environment` field (or we identify this as a fix needed)

### Phase 2: Sentry Dashboard Check (5 min)
**Goal:** Check if events ARE reaching Sentry but not visible

1. Go to https://minddojo.sentry.io/issues/?project=explainanything
2. Remove any environment filters (check "All Environments")
3. Check "All Issues" tab (not just unresolved)
4. Look at Stats > Events to see if any events received recently
5. Check Replays tab for any session recordings

**Success Criteria:** Understand current state of Sentry event reception

### Phase 3: Client-Side Error Test
**Goal:** Test if client-side errors reach Sentry via proper SDK path

**IMPORTANT:** `throw new Error()` in console does NOT trigger Sentry SDK capture.
Uncaught console errors may not be intercepted. Use proper test methods below.

**Option A: Use Sentry.captureException (Recommended)**
1. Open production site in browser: https://explainanything.io
2. Open DevTools > Network tab, filter by "monitoring"
3. Open Console and run:
   ```javascript
   import('@sentry/nextjs').then(Sentry => {
     Sentry.captureException(new Error('Test Sentry Client Error 20260110'));
   });
   ```
   Or if Sentry is globally available:
   ```javascript
   Sentry.captureException(new Error('Test Sentry Client Error 20260110'));
   ```
4. Check if POST to `/api/monitoring` appears in Network tab
5. Verify response status is 200
6. Wait 30-60 seconds, check Sentry dashboard for the error

**Option B: Use Test Error Page (if available)**
1. Navigate to `/test-global-error` if it exists in production
2. This should trigger the error boundary and Sentry capture
3. Check Network tab for `/api/monitoring` request
4. Verify error appears in Sentry dashboard

**Option C: Trigger React Error Boundary**
1. Use React DevTools to force a component error
2. Or navigate to a route that exercises error boundary
3. Check Network tab for `/api/monitoring` request

**Expected Network Request:**
- URL: `POST /api/monitoring`
- Payload: Sentry envelope format (binary/text)
- Response: 200 OK

**Success Criteria:**
- Network request to `/api/monitoring` is made
- Response is 200 (not 4xx/5xx)
- Error appears in Sentry dashboard within 1-2 minutes

### Phase 4: Server-Side Error Test
**Goal:** Test if server-side errors reach Sentry

**Option A: Use handleError() via API (Recommended - Safest)**
1. Find an API endpoint that uses `handleError()` or `withLogging` wrapper
2. Trigger an error condition with invalid input (e.g., malformed request)
3. Example: Call an AI endpoint with invalid parameters
4. Check Vercel logs for error
5. Check Sentry dashboard for the error

**Option B: Use Test Error Endpoint (if available)**
1. Check if `/api/test-error` or similar test endpoint exists
2. Call it to trigger a controlled server error
3. Check Sentry dashboard

**Option C: Check instrumentation.ts RSC Error Path**
1. The `instrumentation.ts` file exports `onRequestError = Sentry.captureRequestError`
2. This captures React Server Component errors
3. Trigger an RSC error by navigating to a page with server-side data fetching issues

**⚠️ AVOID: Breaking Production Env Vars**
- Do NOT remove `OPENAI_API_KEY` or other env vars in production
- This could break real user sessions during test window
- There's no guarantee the error path leads to Sentry capture
- Use controlled test methods above instead

**Success Criteria:**
- Server error is triggered via controlled method
- Error appears in Sentry dashboard with server context
- Error includes `requestId` and other server tags

### Phase 5: Tunnel Endpoint Verification (10 min)
**Goal:** Verify tunnel endpoint is receiving and forwarding events

1. Check Vercel production logs for `/api/monitoring` requests
2. Look for any error messages in the logs
3. Verify the DSN is being parsed correctly
4. Check if events are being forwarded to Sentry ingest URL

**If tunnel is the issue:**
- The tunnel returns 200 even when DSN is missing (silent failure)
- Need to verify `SENTRY_DSN` is available to the API route

**Success Criteria:** Tunnel logs show events being forwarded to Sentry

### Phase 6: Fix Identified Issues
**Goal:** Implement fixes based on findings from Phases 1-5

**Potential fixes depending on findings:**
- **Missing env vars:** Add them to Vercel Production
- **Wrong DSN:** Correct the DSN values
- **Tunnel not working:** Debug/fix the tunnel endpoint
- **beforeSend too aggressive:** Adjust filter logic
- **Client config missing environment:** Add `environment` field to `sentry.client.config.ts`

**For code changes:**
1. Create fix in feature branch
2. Run lint, tsc, build locally
3. Run `npm run test:unit` to verify no regressions
4. Run `npm run test:e2e` if tunnel logic changes
5. Create PR for review before merging

## Rollback Plan

**If fixes cause production issues:**

**For Environment Variable Changes:**
1. Go to Vercel Dashboard > Project > Settings > Environment Variables
2. Revert to previous value or remove the new variable
3. Trigger redeploy: `vercel --prod` or via dashboard

**For Code Changes:**
1. Revert the commit: `git revert <commit-sha>`
2. Push to main: `git push origin main`
3. Vercel will auto-deploy the revert
4. Verify production is stable

**For Sentry SDK/Config Changes:**
1. If Sentry breaks the app, the SDK is designed to fail silently
2. Check for console errors in production DevTools
3. If blocking, revert the sentry.*.config.ts changes
4. As last resort, temporarily remove Sentry initialization

**Emergency Contacts:**
- Vercel status: https://www.vercel-status.com/
- Sentry status: https://status.sentry.io/

### Phase 7: Verification
**Goal:** Confirm errors now appear in Sentry

1. Repeat Phase 3 (client-side test)
2. Repeat Phase 4 (server-side test)
3. Verify both errors appear in Sentry dashboard
4. Check error details have correct tags (requestId, sessionId, etc.)

## Testing

### Manual Verification
1. Trigger client-side error via browser console
2. Trigger server-side error via API call or env var removal
3. Verify errors appear in Sentry with correct metadata

### Automated Tests (if fixes are made)
- `src/app/api/monitoring/route.test.ts` - Update tests if tunnel logic changes
- Consider adding integration test that verifies Sentry initialization

## Documentation Updates

After investigation completes:
- `docs/planning/sentry_not_catching_errors_prod_20260110/sentry_not_catching_errors_prod_20260110_progress.md` - Document findings from each phase
- `docs/docs_overall/environments.md` - Update if env var configuration changes
- `docs/planning/sentry_integration_plan/` - Update if Sentry setup changes

## Quick Reference

**Sentry Dashboard:** https://minddojo.sentry.io/issues/?project=explainanything

**Key Files:**
- `sentry.client.config.ts` - Client Sentry init (check for `environment` field!)
- `sentry.server.config.ts` - Server Sentry init
- `sentry.edge.config.ts` - Edge runtime Sentry init
- `instrumentation.ts` - RSC error capture via `onRequestError = Sentry.captureRequestError`
- `src/app/api/monitoring/route.ts` - Tunnel endpoint (uses `SENTRY_DSN`)
- `src/lib/handleError.ts` - Centralized error handler with Sentry.captureException
- `next.config.ts` - Conditional Sentry wrapping (check if DSN exists)

**Key Env Vars:**
- `SENTRY_DSN` - Server/Edge/Tunnel DSN (required for tunnel to work!)
- `NEXT_PUBLIC_SENTRY_DSN` - Client DSN (required for browser SDK)
- `SENTRY_ORG` - Organization for source map upload
- `SENTRY_PROJECT` - Project for source map upload
- `SENTRY_AUTH_TOKEN` - Auth for source map upload
- `SENTRY_TRACES_SAMPLE_RATE` - Override default 20% trace sampling (optional)

## Note: Sampling Does NOT Affect Errors

**The 20% `tracesSampleRate` only affects performance traces, NOT error capture.**

| Setting | Value | Affects |
|---------|-------|---------|
| `tracesSampleRate` | 0.2 (20%) | Performance traces only |
| `sampleRate` | Not set (defaults to 1.0) | Error events - **100% captured** |

From [Sentry Docs](https://docs.sentry.io/concepts/key-terms/sample-rates/):
> "The error sample rate defaults to 1.0, meaning all errors are sent to Sentry."

**Conclusion:** Sampling is NOT causing missing errors. Root causes are likely:
1. Missing `environment` field in client config (CONFIRMED)
2. Missing `SENTRY_DSN` env var causing tunnel silent failure
