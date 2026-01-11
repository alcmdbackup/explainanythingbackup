# Sentry Not Catching Errors Prod Progress

## Phase 1: Environment Variable & Config Verification

### Work Done

**1d. Client Config Environment Field - CONFIRMED & FIXED**
- Verified `sentry.client.config.ts` was missing the `environment` field
- Server config (line 9) has: `environment: process.env.NODE_ENV`
- Edge config (line 9) has: `environment: process.env.NODE_ENV`
- Client config did NOT have this field - **ROOT CAUSE CONFIRMED**
- **FIX APPLIED**: Added `environment: process.env.NODE_ENV` to line 9 of `sentry.client.config.ts`
- Lint, tsc, and build all pass

**1a-1c, 1e. Environment Variables - CONFIRMED & ADDED**
- User verified env vars were missing in Vercel Production
- User added both env vars to Vercel:
  - `SENTRY_DSN` - Server/tunnel DSN (Production scope) ✅
  - `NEXT_PUBLIC_SENTRY_DSN` - Client DSN (Production scope) ✅

### Issues Encountered
- Client config was missing `environment` field, causing client errors to not be tagged with environment
- Env vars were missing from Vercel Production - **this was likely the main cause of silent failures**

### User Clarifications
- User confirmed env vars have been added to Vercel

## Phase 2: Sentry Dashboard Check
### Work Done
[Awaiting user action]

## Phase 3: Client-Side Error Test
### Work Done
[Awaiting user action]

## Phase 4: Server-Side Error Test
### Work Done
[Awaiting user action]

## Phase 5: Tunnel Endpoint Verification
### Work Done
[Not yet started]

## Phase 6: Fix Identified Issues
### Work Done
- Fixed: Added `environment` field to `sentry.client.config.ts`
- [Other fixes pending investigation results]

## Phase 7: Verification
### Work Done
[Not yet started]
