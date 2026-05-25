# fixes_explainanything_for_public_demo_20260523 Plan

## Background

Prepare the ExplainAnything public-facing site (not the evolution pipeline) for a public demo. Smooth out user-visible rough edges — link generation, streaming-completion UX, demo guest access — and rotate the admin password. Also audit the paid services so we know what credits we need.

## Requirements (from GH Issue #NNN)

1. **Scope**: All changes target the ExplainAnything public site only, NOT the evolution pipeline / `/admin/evolution/*` routes.
2. **Links — bypass whitelist for the demo**: Make sure inline links get generated in the article body. Bypass the `link_whitelist` requirement entirely for now (link any AI-suggested term), but **keep the whitelist + candidate-approval code in place** so we can re-enable it later without re-implementing.
3. **Post-streaming hand-off UX — floating status pill** (decisions locked):
   - **Component**: new `<GenerationStatusPill />`, rendered at page root, `position: fixed; bottom: 1.5rem; left: 50%; transform: translateX(-50%)`, `max-w-md`, `rounded-full`, `paper-texture` + `backdrop-blur-sm` + `shadow-warm-lg`, 2px left accent stripe (gold during A, success during B/C).
   - **States** driven by `pageLifecycleReducer` phase:
     - **A — Streaming**: `Drafting your article — hang tight…` (gold accent, animated dots, `aria-live="polite"`)
     - **B — Transition** (~800ms after stream complete): `All set! Bringing the editor in…` (success-green tick)
     - **C — One-time hint** (auto-dismiss 3s or ✕): `Try: "explain it like I'm 12" — AI editor →` (concrete prompt that points users to `AIEditorPanel`)
   - **Motion**: slide-up + fade-in entrance, cross-fade between states, slide-down + fade-out exit. Respect `prefers-reduced-motion`.
   - **Z-index**: `50` (above article, won't conflict with Sonner toasts at `bottom-right`).
4. **Rotate admin password**: One-time ops task — change the prod admin user's Supabase Auth password.
5. **Demo guest account + auto-login** (decisions locked):
   - **Mechanism**: middleware-driven in-place sign-in in `src/middleware.ts`. On every public-hostname request where `await supabase.auth.getUser()` returns null, call `supabase.auth.signInWithPassword({ email: GUEST_EMAIL, password: GUEST_PASSWORD })` server-side; the Supabase SSR client writes the session cookies onto the outgoing `NextResponse`. No redirect, no second round-trip.
   - **Scope guard**: gate the auto-login branch on `classifyHost()` returning `'public'` (or `'local'`/`'preview'` for dev). Never fire on the evolution hostname — `requireAdmin()`'s existing hostname assertion is the second wall.
   - **Identity**: ONE shared Supabase Auth user (not anonymous-per-visitor). Commingling of saves/userQueries across demo viewers is **explicitly accepted** — the demo is read-mostly + AI-editing-heavy, and a single shared library actually helps showcase saved content.
   - **`/login` behavior**: when the guest session is already active, redirect `/login` back to `/` (no need to expose a sign-in form when everyone's already signed in as the same user).
   - **Sign-out button**: hide it on the public site for the demo (clicking it would instantly re-trigger auto-login on the next request — confusing UX).
   - **Pre-seeded library content**: add `scripts/seed-guest-library.ts` that **freshly generates** 5-10 explanations via the normal `returnExplanationLogic` pipeline pre-demo (not hand-picked or copied from prod), then saves them to the guest's `userLibrary`. **Topic area: semiconductors & GPUs** — evergreen, technically meaty, and aligned with current public interest (AI hardware moment). Specific query list to be finalized as part of the plan (starter list in `_research.md`).
   - **No cleanup**: do NOT add a CRON to wipe guest's data. Accept that the guest's `userLibrary` and `userQueries` will accumulate across the demo's lifetime. Revisit if it becomes a problem.
   - **LLM cost protection**: add the guest `user_id` to `llmSpendingGate` with a **$10/day** per-user cap so a single rogue viewer hammering "regenerate" can't burn through the global LLM budget mid-demo. (Global non-evolution daily cap is $50; the per-guest sub-cap is the tighter inner ring.)
   - **Credentials storage**: `GUEST_EMAIL=guest@explainanything.app` and `GUEST_PASSWORD` (random, generated when creating the user) in Vercel env vars (prod + preview) and `.env.local` (dev). Never committed.
   - **Race conditions**: parallel cold requests (e.g., browser opens 5 tabs) may each trigger their own sign-in call. Supabase Auth has a ~30/min IP rate limit but for a single demo viewer this is well within bounds. Optional follow-up: in-process Promise cache. Not blocking for v1.
6. **Paid-services inventory**: Audit and list every external service we pay for via credits (OpenAI, Anthropic, DeepSeek, OpenRouter, Pinecone, Supabase, Sentry, Honeycomb, Resend, Vercel, etc.) so we know what to top up before the demo. Research deliverable, not code.

7. **Demo-hygiene cleanup** (added 2026-05-24 from R3E findings — not in original list but blocks the demo):
   - **`FILE_DEBUG = true`** in `src/app/results/page.tsx:45` — flip to `false` so verbose client-side debug logging doesn't appear in demo viewers' browser devtools.
   - **`[E2E DEBUG]` console statements** in `src/app/results/page.tsx` (around `'Complete event received'`, `'Redirecting to'`) — strip or gate behind `process.env.NODE_ENV === 'development'`.
   - **10 ungated `(debug)` routes** under `src/app/(debug)/`: `/diffTest`, `/editorTest`, `/streaming-test`, `/latex-test`, `/mdASTdiff_demo`, `/resultsTest`, `/test-client-logging`, `/test-global-error`, `/tailwind-test`, `/typography-test`. URL-hackable on the public hostname. Gate via `src/middleware.ts`: return 404 when `classifyHost() === 'public'` AND path starts with one of these. Keep accessible on `local`/`preview`/`evolution` tiers for dev work.
   - **`/editorTest` is linked from `AIEditorPanel.tsx`** — either remove the link from the public-facing AI editor panel, or whitelist `/editorTest` only (leaving the other 9 gated). Recommend removing the link since the panel is the demo's hero feature.

## Problem

The public-facing ExplainAnything site has several visible rough edges that would undermine an upcoming live demo: inline links rarely render (blocked by an empty `link_whitelist`), no UX signal communicates when the streaming generation has handed off to the editable article, every visitor must sign up before seeing anything, the production admin password is overdue for rotation, and we don't have a clean inventory of paid services to top up. On top of that, the research pass surfaced two demo-blocking hygiene issues — verbose `[E2E DEBUG]` console logs visible in browser devtools and 10 ungated `(debug)` routes URL-hackable on the public hostname. The work is bounded but spans 7 requirements across UI, middleware, scripts, and ops.

## Options Considered

The major architectural decisions were already chosen during research/discussion (captured in the locked Requirements section above). Briefly:

- [x] **Req 2 link bypass — merge candidates vs delete-the-gate**: chose merge `(snapshot ∪ approved-status candidates with non-null standalone_title)` over deleting the gate, so re-enabling whitelist is a one-line revert.
- [x] **Req 3 pill placement — top-of-article vs floating bottom-center**: chose floating bottom-center, fixed-position, z-40, paper-texture + warm shadow. Copy locked (Voice 2 + Option 42).
- [x] **Req 5 guest mechanism — shared user vs anon-per-visitor vs custom JWT**: chose shared user with middleware in-place sign-in (Option 1 from the auth discussion). Anon-per-visitor (Option 3) considered and rejected; commingling accepted.
- [x] **Req 5 LLM cap — hardcoded check vs schema change**: chose hardcoded check in `callLLMModelRaw()` for v1; defer per-user schema work.
- [x] **Req 7 debug-route gating — middleware 404 vs `NODE_ENV` check vs delete**: chose middleware 404 when `classifyHost() === 'public'` so the routes stay accessible for dev/preview/evolution-tier work.

## Phased Execution Plan

Phases are ordered to land low-risk wins first and isolate the highest-risk change (Req 5 middleware sign-in) into its own phase so we can revert it cleanly if anything goes sideways.

### Phase 1 — Demo-hygiene cleanup (Req 7)

Low-risk, high-impact. Done first so subsequent demo testing is on a clean baseline.

- [x] Flip `FILE_DEBUG = true` → `false` at `src/app/results/page.tsx:45`.
- [x] Remove or `NODE_ENV === 'development'`-gate every `console.log('[E2E DEBUG] ...')` in `src/app/results/page.tsx`.
- [x] Add public-hostname debug-route 404 in `src/middleware.ts`. Insert after the `tier === 'public'` block (around line 53):
  ```typescript
  const DEBUG_ROUTE_PREFIXES = [
    '/diffTest', '/streaming-test', '/latex-test', '/mdASTdiff_demo',
    '/resultsTest', '/test-client-logging', '/test-global-error',
    '/tailwind-test', '/typography-test',
    // '/editorTest' intentionally NOT gated — link removed in next step
  ];
  if (DEBUG_ROUTE_PREFIXES.some((p) => path.startsWith(p))) {
    return new NextResponse(null, { status: 404 });
  }
  ```
- [x] Remove the "Debug in EditorTest" link from `src/components/AIEditorPanel.tsx` (or gate it `NODE_ENV === 'development'`-only).
- [x] Add `DEBUG_ROUTE_PREFIXES` to `src/middleware.test.ts` cases: assert public host returns 404 for one of the listed paths, local host returns 200.
- [x] Run lint + tsc + unit tests; commit `chore(public): demo-hygiene cleanup (FILE_DEBUG, console logs, debug-route gate)`.

### Phase 2 — Link whitelist bypass (Req 2)

Display-path-only. No code deletions; reversible by flipping one env var. (Fixed gap #14 — env var renamed from `EVOLUTION_LINKS_BYPASS_WHITELIST` since this project explicitly excludes evolution.)

- [x] Add `LINKS_BYPASS_WHITELIST` env var (default `'false'`) to `.env.example` with a comment explaining demo-mode usage.
- [x] In `src/lib/services/linkResolver.ts` `resolveLinksForArticleImpl()` (around lines 239-254), wrap the existing `snapshot.data` map build with a flag check **and a module-scoped TTL cache** (fixes gap #9 — without the cache this is a per-render DB hit that bypasses the snapshot architecture the system was designed around):
  ```typescript
  // Module-scope cache. The system already caches the whitelist in
  // `link_whitelist_snapshot`; this mirror cache covers the bypass branch.
  let bypassMergedCache: { value: Map<string, WhitelistCacheEntryType>; expires: number } | null = null;
  const BYPASS_CACHE_TTL_MS = 5 * 60 * 1000;

  const snapshot = await getSnapshot();
  let whitelistMap = new Map<string, WhitelistCacheEntryType>(Object.entries(snapshot.data));

  if (process.env.LINKS_BYPASS_WHITELIST === 'true') {
    if (bypassMergedCache && bypassMergedCache.expires > Date.now()) {
      whitelistMap = bypassMergedCache.value;
    } else {
      const supabase = await createSupabaseServerClient();
      const { data: approvedCandidates } = await supabase
        .from('link_candidates')
        .select('term, term_lower, standalone_title')
        .eq('status', 'approved')
        .not('standalone_title', 'is', null)
        .limit(2000); // safety cap
      for (const c of approvedCandidates ?? []) {
        if (!whitelistMap.has(c.term_lower)) {
          whitelistMap.set(c.term_lower, { canonical_term: c.term, standalone_title: c.standalone_title });
        }
      }
      bypassMergedCache = { value: whitelistMap, expires: Date.now() + BYPASS_CACHE_TTL_MS };
    }
  }
  const whitelist = whitelistMap;
  ```
- [x] Leave `_getLinkDataForLexicalOverlayAction` (editor overlay) untouched — bypass affects DISPLAY only.
- [x] Add the env var to Vercel project: `LINKS_BYPASS_WHITELIST=true` in Production env vars (Preview optional).
- [x] Add unit test `linkResolver.bypass.test.ts`: mock candidates table, set env var, assert non-whitelisted approved-candidate terms link in the rendered output; flip env var off and assert they don't. **Use `originalEnv = process.env; afterEach(() => { process.env = originalEnv; });` pattern** (mirrors `llms.test.ts:50-93`) to prevent env-var leakage across tests. Also reset `bypassMergedCache` between tests (export a `__resetBypassCacheForTests` helper).
- [x] Add manual verification step: load an existing public article in prod (post-deploy), confirm inline links render on terms that were previously unlinked.
- [x] **Follow-up tracked separately** (not in this PR): consider extending `link_whitelist_snapshot` to include approved candidates so the bypass branch piggybacks the existing snapshot infrastructure.
- [x] Commit `feat(links): env-gated bypass of whitelist requirement (demo mode)`.

### Phase 3 — Status pill (Req 3)

UI-only, no middleware impact.

- [x] Create `src/components/results/GenerationStatusPill.tsx` — subscribes to `useReducer` state from `pageLifecycleReducer` via context (pass `lifecycleState` as a prop from `src/app/results/page.tsx`).
- [x] States the component renders:
  - `phase === 'streaming'` → State A copy + gold accent + animated dots
  - `phase === 'viewing'` AND `wasStreaming` (track via local `useRef` flag) → State B copy + green tick for 800ms
  - `phase === 'viewing'` AND `wasStreaming` (after 800ms) → State C copy + dismiss `✕` + 3s auto-fade
  - `phase === 'error'` → "Generation failed — try again" with red accent (NEW state surfaced by R2B; not in original spec)
  - all other phases → hidden
- [x] Styling: `fixed bottom-6 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-full paper-texture shadow-warm-lg backdrop-blur-sm`. 2px left accent stripe via `::before`. `animate-fade-up` for entrance, custom keyframe for exit (slide down + fade).
- [x] `role="status"` `aria-live="polite"`. `@media (prefers-reduced-motion: reduce)` strips animations.
- [x] Heroicons: `PencilSquareIcon` (A), `CheckCircleIcon` (B/C), `ExclamationTriangleIcon` (error).
- [x] Mount: in `src/app/results/page.tsx` near line 1024, AT page root (sibling to `<main>`), NOT inside the article container.
- [x] Hide or remove the inline "Writing…" indicator at `page.tsx:1397-1401` (the pill replaces it).
- [x] Unit tests `GenerationStatusPill.test.tsx`: each phase renders the correct copy + icon + accent color; dismiss button hides the pill; auto-timeout fires after 3s (use `jest.useFakeTimers()`).
- [x] Commit `feat(results): floating GenerationStatusPill for post-stream hand-off`.

### Phase 4 — Guest user provisioning + LLM cap (Req 5 — data + config)

Provision the guest account and protective config BEFORE wiring up middleware sign-in.

- [x] Add `scripts/seed-guest-user.ts`: idempotently creates the `auth.users` row for `guest@explainanything.app` with a generated password (output to stdout once for one-time copy), via Supabase Admin API.
- [x] Document in `_progress.md`: developer runs the script against staging, then against prod (preferred: `op run --env-file=.env.prod.write -- npx tsx scripts/seed-guest-user.ts` via 1Password CLI; fallback: temporary `.env.local` swap WITH explicit revert checkpoint), captures the password, sets it in Vercel env vars + GitHub secrets.
- [x] Add `GUEST_EMAIL` + `GUEST_PASSWORD` + (constant) `GUEST_USER_ID` (the UUID returned by seed script) + `NEXT_PUBLIC_GUEST_EMAIL` to `.env.example` (with placeholder values, no secrets).
- [x] Set these vars in **every environment that needs them** (fixes gap #10 — CI secrets gap):
  - Vercel Production env vars (all 4 vars)
  - Vercel Preview env vars (all 4 vars — without these, every preview deploy breaks middleware auto-login)
  - **GitHub Actions `staging` environment secrets** (`GUEST_EMAIL`, `GUEST_PASSWORD`, `GUEST_USER_ID`, `NEXT_PUBLIC_GUEST_EMAIL`) — required for new `guest-auto-login.spec.ts @critical` test
  - **GitHub Actions `Production` environment secrets** (same 4 vars) — required for `e2e-nightly` + `post-deploy-smoke`
  - `.github/workflows/ci.yml` — add the 4 vars to the `env:` blocks of `e2e-critical`, `e2e-evolution`, `integration-critical`, `integration-non-evolution` jobs
  - Local `.env.local` for dev
- [x] **LLM cap data-source decision** (fixes gap #2 + SEC-CRIT-3 — `daily_cost_rollups` has no `user_id` column today AND widening its PK would force RLS rewrites):
  - **Chosen for v1**: NEW SIBLING TABLE `per_user_daily_cost_rollups`, leaves the existing global aggregate untouched. Migration `add_per_user_daily_cost_rollups.sql`:
    ```sql
    CREATE TABLE per_user_daily_cost_rollups (
      date DATE NOT NULL,
      user_id UUID NOT NULL,
      category TEXT NOT NULL,
      total_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
      call_count INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (date, user_id, category)
    );

    -- Deny-all default + service_role bypass (matches evolution table pattern).
    ALTER TABLE per_user_daily_cost_rollups ENABLE ROW LEVEL SECURITY;
    CREATE POLICY deny_all ON per_user_daily_cost_rollups FOR ALL USING (false) WITH CHECK (false);
    CREATE POLICY service_role_all ON per_user_daily_cost_rollups FOR ALL TO service_role USING (true) WITH CHECK (true);

    -- Index for the hot-path read.
    CREATE INDEX idx_per_user_rollup_date_user ON per_user_daily_cost_rollups (user_id, date);
    ```
  - **Trigger source of `user_id`**: extend the existing trigger (or add a sibling trigger) on `llmCallTracking` (which already has a `userid` column per request_tracing_observability.md). Pseudo:
    ```sql
    CREATE OR REPLACE FUNCTION update_per_user_daily_cost_rollup() RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.userid IS NOT NULL THEN
        INSERT INTO per_user_daily_cost_rollups (date, user_id, category, total_cost_usd, call_count)
        VALUES (current_date, NEW.userid::UUID, COALESCE(NEW.call_category, 'unknown'), NEW.estimated_cost_usd, 1)
        ON CONFLICT (date, user_id, category) DO UPDATE
          SET total_cost_usd = per_user_daily_cost_rollups.total_cost_usd + EXCLUDED.total_cost_usd,
              call_count = per_user_daily_cost_rollups.call_count + 1,
              updated_at = now();
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER;

    CREATE TRIGGER trg_per_user_daily_cost_rollup
      AFTER INSERT ON "llmCallTracking"
      FOR EACH ROW EXECUTE FUNCTION update_per_user_daily_cost_rollup();
    ```
  - **Backfill**: NONE. Per-user tracking starts the moment the migration deploys. Guest data accumulates from day 1.
- [x] Extend `LlmSpendingGate` (NOT `callLLMModelRaw` directly) with a per-user gate that uses a **SEPARATE TTL-cached read** (fixes ARCH-M7 — existing `spendingCache` is keyed by category; per-user needs its own keyspace to avoid pollution):
  - Add `checkPerUserCap(userid: string, capUsd: number): Promise<void>` method on `LlmSpendingGate`.
  - Add a separate cache `userSpendingCache: Map<string, { spent: number; expiresAt: number }>` keyed by `${userid}:${dateISO}` with the same `SPENDING_CACHE_TTL_MS` value (don't piggyback the existing global cache).
  - On cache miss, `SELECT SUM(total_cost_usd) FROM per_user_daily_cost_rollups WHERE user_id = $1 AND date = current_date`.
  - Throw `GlobalBudgetExceededError` with category `'per_user_guest'` and a friendly message.
  - **Migration test**: `src/__tests__/integration/per-user-cost-rollups.integration.test.ts` — assert trigger correctly populates per-user rows on INSERT into `llmCallTracking`; assert RLS denies non-service-role reads.
- [x] In `callLLMModelRaw()` (`src/lib/services/llms.ts:~828`), call `checkPerUserCap(userid, 10)` only when `userid === process.env.GUEST_USER_ID`. Single hardcoded user-id check; everything else lives in the gate.
- [x] Unit tests:
  - `src/lib/services/llms.test.ts` (UPDATE) — mock `checkPerUserCap` returning normally for non-guest, throwing for guest over-cap. Use `jest.useFakeTimers().setSystemTime(new Date('2026-05-25T12:00:00Z'))` to pin date (avoids midnight-UTC flake).
  - `src/lib/services/llmSpendingGate.test.ts` (UPDATE) — direct unit tests for `checkPerUserCap` including cache hit behavior. Also assert `SEED_BYPASS_USER_CAP='true'` causes `checkPerUserCap` to return immediately without throwing even when spend > cap (safety contract for seed script).
- [x] Commit `chore(guest): provision guest user + $10/day per-user LLM cap`.

### Phase 5 — Middleware auto-login + auth UI gating (Req 5 — runtime)

The riskiest change. Isolated in one phase so it can be reverted independently.

**Deploy gate (fixes gap #8 — Phase 4 must land in prod BEFORE Phase 5 merges)**:
- Phase 4 prod script run + all GUEST_* env vars set in Vercel Production **MUST** be verified before this PR's `Ready for review` toggle.
- Auto-login block also includes a soft env-var truthy check (`if (process.env.GUEST_EMAIL && process.env.GUEST_PASSWORD)`) so a missing env var is a no-op, not a noisy failure path.

**Middleware change** — In `src/lib/utils/supabase/middleware.ts`, modify the existing flow. Refactor `const user` → `let user` first (fixes gap #7 — explicit, not hand-wavy), then insert auto-login **AFTER `getUser()` but BEFORE the existing line 41-52 redirect block** (load-bearing ordering — must run first or the redirect fires and auto-login is unreachable):

```typescript
// Existing line 37-39 — change destructure to a rebindable let:
let currentUser: User | null = null;
{
  const { data } = await supabase.auth.getUser();
  currentUser = data.user;
}

// NEW: Auto-guest-login on public-tier hosts when no session present.
// MUST run BEFORE the line 41-52 unauth-redirect block below; otherwise that
// redirect fires first and this code is unreachable for unauthenticated visitors.
//
// The setAll() callback in createServerClient (lines 18-26) writes the new
// session cookies onto `supabaseResponse` automatically when signInWithPassword
// succeeds (same mechanism getUser() uses to refresh near-expiry tokens).
if (
  !currentUser &&
  process.env.E2E_TEST_MODE !== 'true' &&
  process.env.GUEST_EMAIL &&
  process.env.GUEST_PASSWORD
) {
  const tier = classifyHost(request.headers.get('host'));
  if (tier === 'public' || tier === 'local' || tier === 'preview') {
    // Module-scope in-flight dedupe so parallel cold requests don't each fire
    // their own signInWithPassword (fixes gap #3 — link-preview crawlers / multi-tab).
    // Dedup is per-Node-instance (Vercel cold-start churn = best-effort, NOT global).
    // Acceptable given low expected concurrency from demo viewers + Supabase's
    // 30/min IP rate limit as the real backstop.
    //
    // SEC-CRIT-1 fix: wrap the in-flight Promise in a timeout via Promise.race so a
    // stalled signInWithPassword can't poison the dedupe slot site-wide. 10s is well
    // under our middleware budget and double the configured Supabase per-call timeout.
    const dedupeKey = `${tier}:${request.headers.get('host')}`;
    if (!inFlightGuestLogin.has(dedupeKey)) {
      const loginPromise = Promise.race([
        supabase.auth.signInWithPassword({
          email: process.env.GUEST_EMAIL,
          password: process.env.GUEST_PASSWORD,
        }),
        new Promise<{ error: AuthError }>((resolve) =>
          setTimeout(
            () => resolve({ error: { name: 'TimeoutError', message: 'guest auto-login timed out after 10s' } as AuthError }),
            10_000,
          ),
        ),
      ]).finally(() => inFlightGuestLogin.delete(dedupeKey));
      inFlightGuestLogin.set(dedupeKey, loginPromise);
    }
    const { error: guestErr } = await inFlightGuestLogin.get(dedupeKey)!;
    if (guestErr) {
      console.warn('[middleware] guest-auto-login failed', {
        error: guestErr.message,
        host: request.headers.get('host'),
        path: request.nextUrl.pathname,
      });
      // Fall through to existing unauth redirect — but `/login` page itself
      // shows a "service temporarily unavailable" notice instead of the form
      // when GUEST_AUTOLOGIN_FAILED_RECENTLY cookie is set (see /login page change below).
      // This avoids the redirect loop (gap #5).
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      const fallback = NextResponse.redirect(url);
      // SEC-CRIT-2 fix: httpOnly + explicit path. Only middleware + /login server
      // component read this cookie; client JS has no need (and being client-spoofable
      // would let any visitor with devtools DoS the /login page via the
      // 'service unavailable' notice).
      fallback.cookies.set('GUEST_AUTOLOGIN_FAILED_RECENTLY', '1', {
        maxAge: 60,
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
      });
      return fallback;
    } else {
      // Re-read user so downstream user-disabled check (lines 55-77) sees the session.
      const { data } = await supabase.auth.getUser();
      currentUser = data.user;
      console.info('[middleware] guest-auto-login fired', {
        host: request.headers.get('host'),
        path: request.nextUrl.pathname,
      });
    }
  }
}

// Then the existing line 41-52 redirect block, reading from `currentUser` not `user`:
if (
  !currentUser &&
  !request.nextUrl.pathname.startsWith('/login') &&
  /* ...existing exemptions... */
) {
  /* existing redirect to /login */
}
```

Plus add at module top:
```typescript
// Module-scope in-flight cache to dedupe parallel cold-request sign-ins.
const inFlightGuestLogin = new Map<string, Promise<{ error: AuthError | null }>>();
```

- [x] Apply the middleware refactor above. **Manually verify** by reading the diff that auto-login block is positioned BEFORE the existing line 41-52 redirect block.
- [x] Add `User`, `AuthError` type imports.
- [x] Extend `useUserAuth` (`src/hooks/useUserAuth.ts`) to expose `email` in addition to `userid` (fixes architecture-minor: hook currently only exposes `userid`). Then add `useIsGuest()` hook in the same file: returns `email === process.env.NEXT_PUBLIC_GUEST_EMAIL`.
- [x] In `src/components/Navigation.tsx`, wrap the sign-out button (lines 170-180) with `{!useIsGuest() && (<button …>Sign out</button>)}`.
- [x] **`/login` page changes (fixes gaps #5 and #6 + ARCH-M3 — redirect loop + cold-load flash + server/client split)**:
  - Current `src/app/login/page.tsx` is `'use client'` and uses interactive form state — can't directly mix `await supabase.auth.getUser()` at module top. **Refactor into server-shell + client-child**:
    - Convert `src/app/login/page.tsx` to a server component (remove `'use client'`). It performs: (a) `await supabase.auth.getUser()` → `redirect('/')` if `user?.email === process.env.NEXT_PUBLIC_GUEST_EMAIL`; (b) read `GUEST_AUTOLOGIN_FAILED_RECENTLY` cookie via `cookies()` from `next/headers` — if present, render `<ServiceUnavailableNotice />` server component; (c) else render `<LoginForm />` client child.
    - Extract the existing interactive form into `src/app/login/LoginForm.tsx` with `'use client'` — preserves all `useState`/`useForm`/`useEffect` plus the existing submit handlers untouched.
    - Add `src/app/login/ServiceUnavailableNotice.tsx` as a server component (static markup, no JS) — "Service temporarily unavailable. Please refresh in a moment."
- [x] **Rollback procedure (fixes gap #13 + CT5 — must be validated on staging before merge)**:
  - **Instant** (no code change): set `E2E_TEST_MODE=true` in Vercel Production env vars and redeploy — auto-login no-ops, site reverts to its pre-Phase-5 unauthenticated-redirect behavior.
  - **Faster instant**: remove `GUEST_EMAIL` or `GUEST_PASSWORD` from Vercel Production env vars — the soft env check makes auto-login a no-op.
  - **Permanent**: `git revert <Phase 5 commit>` + Vercel redeploy.
  - **Severity-1 escalation**: if auto-login is taking site down, the env-var removal above is the fastest mitigation. Document in PR description.
- [x] **Rollback dry-run on staging BEFORE PR merge** (fixes CT5):
  - Deploy Phase 5 to staging.
  - Confirm auto-login fires (visit staging public hostname incognito, observe landed-as-guest).
  - Remove `GUEST_PASSWORD` from staging Vercel env vars.
  - Redeploy / wait for env propagation.
  - Confirm site reverts to `/login` redirect (soft env check kicks in).
  - Re-set `GUEST_PASSWORD`, redeploy, confirm auto-login resumed.
  - Document dry-run timestamps + screenshots in `_progress.md`.
- [x] **Audit `@smoke`-tagged specs** (fixes gap #11) — review `src/__tests__/e2e/specs/**/*.spec.ts` for `tag: '@smoke'` annotations. The 3 @smoke tests in `smoke.spec.ts` use the `authenticatedPage` fixture which expects `TEST_USER_*` login — that explicit login will collide with in-flight guest auto-login.
- [x] **Edit `.github/workflows/post-deploy-smoke.yml`** (fixes CT3 — explicit checkbox, no longer just a "decision"): add `E2E_TEST_MODE: 'true'` to the `env:` block of the "Run Smoke Tests" step. This makes the smoke run skip auto-login and lets the existing `TEST_USER_*` login proceed normally. The new `guest-auto-login.spec.ts` is verified separately (see Playwright config below).
- [x] **Add a dedicated Playwright project + webServer for `guest-auto-login.spec.ts`** (fixes CT1 + MT4 + MT6 — every existing webServer hardcodes `E2E_TEST_MODE=true` so the new spec can't actually exercise the auto-login code path under any existing project):
  ```typescript
  // playwright.config.ts — add a SECOND webServer block alongside the existing 3008 one.
  webServer: [
    { /* existing port 3008 with E2E_TEST_MODE=true — unchanged */ },
    {
      // CRITICAL: Playwright's webServer `env:` option MERGES with process.env by
      // default; an `env: {}` would NOT scrub an exported E2E_TEST_MODE. Use
      // `env -u E2E_TEST_MODE` wrapper to explicitly unset it for this process.
      command: process.env.CI
        ? 'env -u E2E_TEST_MODE bash -c "npm run build && npm start -- -p 3009"'
        : 'env -u E2E_TEST_MODE npm run dev -- -p 3009',
      port: 3009,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  // And a new project:
  projects: [
    /* existing chromium-critical / chromium-unauth / firefox / setup — unchanged */
    {
      name: 'chromium-guest-auto',
      testMatch: '**/guest-auto-login.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:3009',
        storageState: { cookies: [], origins: [] },  // ensure unauth start
      },
    },
  ],
  ```
- [x] **Edit `.github/workflows/ci.yml`**: in the `e2e-critical` job, change the Playwright invocation to `npx playwright test --project=chromium-critical --project=chromium-guest-auto --grep @critical` (explicit project flags, no hedge). Add `GUEST_EMAIL`, `GUEST_PASSWORD`, `GUEST_USER_ID`, `NEXT_PUBLIC_GUEST_EMAIL` to the job's `env:` block from `staging` environment secrets.
- [x] Document the design tradeoff (fixes CT2 — `chromium-unauth` integrity): the `chromium-unauth` project keeps using the existing E2E_TEST_MODE webServer. Its assertions (e.g., "unauth user → /login redirect") now verify the **rollback-state behavior** (`E2E_TEST_MODE=true` is one of the rollback levers per the rollback procedure above), not the production behavior. This is acceptable because the production behavior is covered by `chromium-guest-auto`.
- [x] Update `src/__tests__/e2e/specs/auth.unauth.spec.ts`: verify `E2E_TEST_MODE=true` is already set via the existing 3008 webServer command. The existing pattern is correct; just need to confirm middleware respects it. Add a comment in the spec explaining it now verifies the rollback-state path.
- [x] Remove the "fix sign-out test" bullet — `auth.spec.ts:38-56` is already `test.skip`'d for an unrelated bug; no action needed.
- [x] Run E2E `@critical` suite locally on the 3008 webServer (E2E_TEST_MODE=true) AND `chromium-guest-auto` project on the 3009 webServer (no E2E_TEST_MODE) before pushing.
- [x] Commit `feat(auth): public-tier guest auto-login via middleware with race dedupe`.

### Phase 6 — Seed guest library (Req 5 — content)

- [x] Create `scripts/seed-guest-library.ts` modeled on `scripts/backfill-summaries.ts`:
  - Load `.env.local`, create service-role Supabase client.
  - Idempotency: query `userLibrary WHERE userid = GUEST_USER_ID` AND dedupe per-query by matching `userQueries.userInput` — skip individual queries whose title is already in guest's library. (Fixes Architecture-minor: count-only check would duplicate on partial-failure re-runs.)
  - Add `--force` flag to override idempotency entirely.
  - For each query in the curated list, call `returnExplanationLogic(query, null, MatchMode.SkipMatch, GUEST_USER_ID, UserInputType.Query, [], undefined, undefined, null, null, [])`. Captures the new explanation ID from result.
  - Call `saveExplanationToLibrary(explanationId, GUEST_USER_ID)` for each.
  - Log cost per generation + total to stdout. Add `--dry-run` flag that prints queries without invoking the pipeline.
  - **Acceptance criteria per generation** (objective, not subjective): completes without `ServiceError`, body content ≥ 500 chars, **at least 1 H2/H3 heading OR at least 1 inline link** (fixes MT3 — pre-Phase-2 staging without `LINKS_BYPASS_WHITELIST=true` may have no whitelist entries for GPU/semiconductor terms, so headings alone satisfy). Script reports per-query pass/fail.
  - **Seed-script LLM cost exemption**: bypass the per-user $10/day cap when running the seed script (script is a controlled ops action; running the seed AS guest could consume the entire day's budget pre-demo). Implementation: seed script sets a flag (e.g., env var `SEED_BYPASS_USER_CAP=true`) that the `LlmSpendingGate.checkPerUserCap` honors. Run seed at least 24h before demo so cap window resets.
- [x] Seed query list (locked, from research doc):
  1. How does a transistor work?
  2. What's the difference between a CPU and a GPU?
  3. How does CUDA enable parallel computing?
  4. What is EUV lithography and why does it matter?
  5. Why are chip fabs so expensive to build?
  6. What is Moore's Law and is it still true?
  7. How does High Bandwidth Memory (HBM) work?
  8. How do tensor cores accelerate AI workloads?
  9. What is chiplet architecture and why is everyone moving to it?
  10. Why has Nvidia become dominant in AI hardware?
- [x] **Prod-write credential handling (fixes gap #4)** — `.env.local` swap is an anti-pattern. Preferred → fallback order:
  - **Preferred**: `op run --env-file=./scripts/.env.prod.write -- npx tsx scripts/seed-guest-library.ts` via 1Password CLI. `.env.prod.write` references 1Password vault items via `op://` URIs; the file is git-tracked safely because it contains no secret values, just references.
  - **Fallback if 1Password CLI not available**: temporary `.env.local` swap with **explicit revert step in the ops checklist below** + post-script `git status` check showing `.env.local` unchanged (or that the swap was reverted).
- [x] Pre-demo run order: (a) staging first (verify content quality, edit/redo as needed), (b) prod via the credential mechanism above.
- [x] **Ops checklist** for the seed-prod run, attach to `_progress.md`:
  1. Confirm `GUEST_USER_ID` env var matches the prod guest user
  2. Run `scripts/seed-guest-library.ts --dry-run` first (no cost)
  3. Run for real
  4. Verify in Supabase prod: `SELECT count(*) FROM userLibrary WHERE userid = '<GUEST_USER_ID>'`
  5. If using `.env.local` fallback: REVERT `.env.local` and run `git status` to confirm clean
  6. Document run timestamp + cost in `_progress.md`
- [x] Commit `feat(seed): seed-guest-library.ts for demo content`.

### Phase 7 — Rotate prod admin password (Req 4)

Pure ops; no code change.

**Important conflation discovered (fixes gap #1)**: `abecha@gmail.com` is **BOTH** the prod admin (per `supabase/seed-admin.sql`) **AND** the E2E `TEST_USER_EMAIL` referenced by `ci.yml`. Rotating the password breaks:
- (a) the human admin's manual evolution-hostname login flow (their password manager entry goes stale)
- (b) every E2E workflow until the GitHub secret is updated in sync

**Pre-rotation decision** — Choose one:

- **Option A (recommended, decouples concerns)**: Before rotation, split the test user from the admin user. Create a new test-only user `e2e-admin@explainanything.app`, add to `admin_users` table, update `TEST_USER_EMAIL` in GitHub secrets. Then `abecha@gmail.com` rotation only affects the human. Adds ~30 min ops work but eliminates the dual-purpose risk going forward.
- **Option B (faster, accepts coupling)**: Keep them conflated. Coordinate rotation so password-manager update + GitHub-secret update happen in the same change window.

- [x] **Decide A vs B** with project owner before starting.
- [x] If Option A: full provisioning checklist (fixes SEC-CRIT-4):
  - Create `e2e-admin@explainanything.app` in Supabase dashboard (Auth → Users → Add user). **Capture the auto-generated user UUID immediately.**
  - INSERT INTO `admin_users` via SQL editor or migration: `INSERT INTO admin_users (user_id, role) VALUES ('<captured-uuid>', 'admin');`
  - Update `supabase/seed-admin.sql` to include both `abecha@gmail.com` AND `e2e-admin@explainanything.app` (so a fresh DB reset doesn't lose the test admin).
  - Verify RLS: `SELECT 1 FROM admin_users WHERE user_id = '<captured-uuid>'` returns 1 row when queried via service-role client (RLS doesn't apply); query via authenticated client to confirm policy still passes for the new user.
  - Update GitHub Production env secrets: `TEST_USER_EMAIL` → `e2e-admin@explainanything.app`, `TEST_USER_PASSWORD` → new generated password, `TEST_USER_ID` → captured UUID.
  - Update GitHub Staging env secrets similarly if staging tests reference the same user.
  - Kick a `workflow_dispatch` of `e2e-nightly` and `post-deploy-smoke` to verify; if any spec hardcodes `abecha@gmail.com` (grep for it across `src/__tests__/`), update.
- [x] Generate new strong password for `abecha@gmail.com` (`openssl rand -base64 32`).
- [x] Rotate `abecha@gmail.com` via Supabase dashboard: prod project (`qbxhivoezkfbjbsctdzo`) → Authentication → Users → Reset password.
- [x] **Invalidate any leaked refresh tokens for `abecha@gmail.com`** (fixes SEC-CRIT-5 — Supabase does NOT auto-revoke existing JWTs on password change). Run via service-role client or Supabase dashboard:
  ```typescript
  // scripts/revoke-admin-sessions.ts
  await supabase.auth.admin.signOut(ADMIN_USER_ID, { scope: 'global' });
  ```
- [x] **Update the human admin's password manager** (1Password / Bitwarden / etc.) — easy to forget; explicit checklist item.
- [x] If Option B (admin/E2E user stay coupled): update GitHub Production env secrets: `TEST_USER_PASSWORD` (used by `e2e-nightly.yml` + `post-deploy-smoke.yml`).
- [x] Update Vercel Production env vars if `TEST_USER_PASSWORD` is set there (verify with `vercel env ls --environment=production`).
- [x] Check developer `.env.local` files used for staging admin testing — flag in team chat that anyone with a stale entry needs to update.
- [x] Note rotation date + actor + Option (A or B) in `_progress.md` (audit log doesn't capture password changes by design).
- [x] Manually trigger `e2e-nightly` workflow via `workflow_dispatch` to verify admin login still passes; if it fails, the secret wasn't updated in the right environment.

### Phase 8 — Paid-services inventory deliverable (Req 6)

- [x] Write `docs/planning/fixes_explainanything_for_public_demo_20260523/paid_services_inventory.md` from R2E's table; for each service include: dashboard URL, current usage estimate, action item (top up vs no action), responsible person.
- [x] Decide on demo-day quota changes (e.g., bump OpenAI cap before demo).
- [x] Action item: set `OTEL_SEND_ALL_LOG_LEVELS=false` in Vercel demo env (Honeycomb 20M/mo quota protection).

## Testing

### Unit Tests
- [x] `src/lib/services/linkResolver.bypass.test.ts` — env-gated bypass merges approved candidates; off-state preserves whitelist-only behavior. Uses env-restore pattern. Reset bypass cache between tests via exported helper.
- [x] `src/components/results/GenerationStatusPill.test.tsx` — phase→copy mapping, auto-dismiss timer, dismiss button, reduced-motion behavior, **error phase rendering**. Use `jest.useFakeTimers()` and `expect.poll` per testing rule 4 (avoid exact-ms boundary reads).
- [x] `src/lib/services/llms.test.ts` (UPDATE) — guest hardcoded cap throws when daily spend > $10; non-guest user unaffected. Pin date via `jest.useFakeTimers().setSystemTime()` to avoid midnight-UTC flake.
- [x] `src/lib/services/llmSpendingGate.test.ts` (UPDATE) — direct test of new `checkPerUserCap` method including TTL cache hit/miss.
- [x] `src/hooks/useUserAuth.test.ts` — `useIsGuest()` returns true for guest email, false otherwise. **Explicit SSR/CSR parity check (fixes MT5)**: render with `renderToString()` → mount with `hydrateRoot()` → assert no `console.error` hydration warning emitted (use `jest.spyOn(console, 'error')`). Also update `src/testing/utils/page-test-helpers.ts` `mockUseUserAuth` factory to include the new `email` field.
- [x] `src/middleware.test.ts` (UPDATE) — public host returns 404 for each `DEBUG_ROUTE_PREFIXES` entry; local host returns 200.
- [x] **`src/lib/utils/supabase/middleware.test.ts`** (UPDATE — fixes CT4; the file already exists with ~428 lines / ~30 cases, including 'Authentication Flow Integrity', 'Session Management', 'Cookie Handling', 'Redirect URL Construction'). NEW cases to add for Phase 5:
  - (a) no-op when user already present (existing session)
  - (b) `signInWithPassword` called when no user + public host + `E2E_TEST_MODE` unset + GUEST_* env vars set
  - (c) NOT called when `E2E_TEST_MODE='true'`
  - (d) NOT called when host classifies to `'evolution'` or `'unknown'`
  - (e) NOT called when `GUEST_EMAIL` or `GUEST_PASSWORD` env var missing (soft no-op for deploy-ordering safety)
  - (f) Graceful redirect-with-cookie when `signInWithPassword` fails (sets `GUEST_AUTOLOGIN_FAILED_RECENTLY` cookie with `httpOnly: true`, `maxAge: 60`)
  - (g) Module-scope dedupe: 5 parallel calls with same host fire ONE `signInWithPassword`
  - (h) Dedupe timeout: stalled `signInWithPassword` (delayed > 10s) resolves with TimeoutError and clears slot
  - (i) NEW request with `GUEST_AUTOLOGIN_FAILED_RECENTLY` cookie present DOES NOT re-attempt signIn (avoids the redirect-loop second-hop)
  - (j) `E2E_TEST_MODE = ''` (empty string) triggers auto-login (empty string is falsy, doesn't equal 'true' — confirms strict equality check)
  - (k) `GUEST_PASSWORD = 'false'` (literal string) IS treated as truthy by the env-var-presence check — confirm desired behavior, or harden the check to `.length > 0`
  - **Existing cases that may need env-setup updates** (~5 tests in 'Authentication Flow Integrity' and 'Redirect URL Construction' sections that assert unauth → redirect): each must explicitly set `E2E_TEST_MODE='true'` in its `beforeEach`, or delete `GUEST_EMAIL`/`GUEST_PASSWORD` from `process.env`, to preserve their unauth-redirect assertion. Use the `originalEnv` save/restore pattern.

### Integration Tests
- [x] `src/__tests__/integration/auth-flow.integration.test.ts` (UPDATE or new) — middleware `signInWithPassword` writes cookies that survive a follow-up request (simulates the cookie round-trip).
- [x] `src/__tests__/integration/auth-flow.integration.test.ts` (UPDATE — fixes MT7) — THREE-request round-trip test for the redirect-loop fallback + cookie-expiry recovery: (1) Request A with no session + simulated `signInWithPassword` failure → response carries `GUEST_AUTOLOGIN_FAILED_RECENTLY` cookie. (2) Request B carries that cookie → `/login` server component renders `<ServiceUnavailableNotice />` (asserted on rendered HTML), no second `signInWithPassword` call. (3) Request C 61 seconds later (cookie expired) → middleware DOES re-attempt `signInWithPassword`, preventing permanent service-unavailable lock-in after a transient auth-provider hiccup.
- [x] `src/__tests__/integration/links-bypass.integration.test.ts` (NEW) — with env var set, query an explanation, confirm `applyLinksToContent` output contains anchor tags for approved-candidate terms.
- [x] `src/__tests__/integration/per-user-cost-rollups.integration.test.ts` (NEW — fixes MT8) — assert the new trigger correctly populates `per_user_daily_cost_rollups` on INSERT into `llmCallTracking`. Cover: trigger handles NULL `userid`, increments existing date+user+category row, RLS denies anon/authenticated SELECT.

### E2E Tests
- [x] `src/__tests__/e2e/specs/01-auth/guest-auto-login.spec.ts` (NEW) — unauthenticated visitor hits `/` on public host (without `E2E_TEST_MODE`), expects to land in a logged-in state without seeing `/login`. Tag `@critical`.
- [x] `src/__tests__/e2e/specs/02-search-generate/status-pill.spec.ts` (NEW) — submit a query, verify pill renders State A while streaming, State B + C after completion, dismiss button hides it. **For error state simulation**: use `page.route('**/api/returnExplanation', ...)` interception to send `event: error\ndata: {"error":"..."}\n\n` SSE frames (mirrors the existing `api-mocks.ts mockReturnExplanationAPI` pattern). Assert via `expect.poll(() => pill.textContent())` rather than point-in-time read.
- [x] `src/__tests__/e2e/specs/auth.unauth.spec.ts` (UPDATE) — wrap with `E2E_TEST_MODE=true` env injection so the existing unauth-redirect assertion still passes.
- [x] `src/__tests__/e2e/specs/01-auth/auth.spec.ts` sign-out test (UPDATE) — same `E2E_TEST_MODE` gating.

### Manual Verification
- [x] Run `scripts/seed-guest-library.ts --dry-run` against staging — review query list output.
- [x] Run seed script against staging — verify all 10 explanations generate successfully, log into staging public site as guest, browse Library.
- [x] Visit each of the 9 gated debug routes on the public hostname — confirm 404. Same routes on local — confirm 200.
- [x] Visit `/editorTest` directly from `AIEditorPanel.tsx` — confirm link removed.
- [x] Visit staging public site in incognito — confirm auto-login fires, no `/login` redirect, no `/login` form visible. Confirm sign-out button is hidden.
- [x] Visit evolution hostname in incognito — confirm NO auto-login (redirects to `/login`), admin can still sign in manually.
- [x] Inspect browser devtools console on demo flow — confirm no `[E2E DEBUG]` lines.
- [x] Submit ≥10 LLM calls as guest in rapid succession — confirm $10/day cap throws `GlobalBudgetExceededError` with a friendly message. Use `for i in {1..15}; do curl -X POST https://<staging>/api/returnExplanation -d '{"prompt":"test"}'; done` or a similar repeatable scriptlet.
- [x] **Browser-based redirect-loop verification**: on staging, temporarily blank `GUEST_PASSWORD` env var, visit public hostname incognito → confirm `<ServiceUnavailableNotice />` renders on `/login` (not the login form), confirm cookie is set, refresh after 60s and confirm a fresh auto-login attempt fires (cookie expired).

## Verification

### A) Playwright Verification (required for UI changes)
- [x] `guest-auto-login.spec.ts` — green
- [x] `status-pill.spec.ts` — green
- [x] `auth.unauth.spec.ts` (post-update) — green
- [x] `auth.spec.ts` sign-out test (post-update) — green
- [x] Manual: open staging public hostname in browser, walk the demo path end-to-end (incognito → auto-logged-in → submit semiconductor query → watch pill A→B→C → use AI editor with `"explain it like I'm 12"` prompt → save to library → reload → library shows seeded + saved items).

### B) Automated Tests
- [x] `npm run lint` — clean
- [x] `npm run typecheck` — clean
- [x] `npm run test` — full unit pass
- [x] `npm run test:esm` — clean
- [x] `npm run test:integration` — full integration pass (requires staging DB)
- [x] `npm run test:e2e:critical` — green
- [x] `npm run test:e2e -- --grep guest-auto-login` — green

## Documentation Updates
- [x] `docs/feature_deep_dives/authentication_rls.md` — add "Guest auto-login (demo mode)" section describing the public-hostname middleware behavior, `E2E_TEST_MODE` escape hatch, and `useIsGuest()` hook.
- [x] `docs/feature_deep_dives/link_whitelist_system.md` — add "Demo-mode bypass" section describing `LINKS_BYPASS_WHITELIST` env var.
- [x] `docs/feature_deep_dives/search_generation_pipeline.md` — note the floating `GenerationStatusPill` in the post-streaming UX section.
- [x] `docs/docs_overall/environments.md` — list new env vars (`GUEST_EMAIL`, `GUEST_PASSWORD`, `NEXT_PUBLIC_GUEST_EMAIL`, `GUEST_USER_ID`, `LINKS_BYPASS_WHITELIST`, `E2E_TEST_MODE`) in the environment variables table.
- [x] `docs/feature_deep_dives/error_handling.md` — note that `GlobalBudgetExceededError` is now also thrown by the per-user guest cap.
- [x] `docs/planning/fixes_explainanything_for_public_demo_20260523/paid_services_inventory.md` — new deliverable per Phase 8.

## Review & Discussion

`/plan-review` ran 4 iterations across Security & Technical / Architecture & Integration / Testing & CI/CD agents until 5/5 consensus.

| Iteration | Security | Architecture | Testing | Critical Gaps |
|---|---|---|---|---|
| 1 | 3/5 | 3/5 | 3/5 | 14 |
| 2 | 3/5 | 4/5 | 3/5 | 10 |
| 3 | 5/5 | 5/5 | 4/5 | 0 (6 minor polish) |
| 4 | 5/5 | 5/5 | 5/5 | **CONSENSUS** |

### Iter-1 critical gaps resolved
Admin/E2E test user conflation · LLM cap caching regression + data-source unclear · Middleware race conditions · Prod seed credential anti-pattern · Failed signIn redirect loop · `useIsGuest()` cold-load flash · Middleware refactor under-specified · Phase 4→5 deploy ordering · Link bypass per-render DB hit · CI staging GitHub secrets gap · Post-deploy-smoke `@smoke` audit · Middleware auto-login unit test missing · Phase 5 rollback procedure · `EVOLUTION_LINKS_BYPASS_WHITELIST` misnamed.

### Iter-2 critical gaps resolved
`inFlightGuestLogin` Map stall-poisoning (added `Promise.race` 10s timeout) · `GUEST_AUTOLOGIN_FAILED_RECENTLY` cookie spoofable (now `httpOnly: true`) · `per_user_daily_cost_rollups` migration spec (sibling table with explicit PK/RLS/trigger source/no-backfill) · Phase 7 admin_users INSERT + seed-admin.sql drift (full provisioning checklist) · Password rotation session invalidation (`auth.admin.signOut(scope: 'global'`)) · Playwright config can't exercise auto-login (new `chromium-guest-auto` project + 3009 webServer with `env -u E2E_TEST_MODE` wrapper) · post-deploy-smoke YAML edit (now explicit checkbox) · `middleware.test.ts` already exists (correctly framed as UPDATE with 9 new + ~5 modified cases) · Rollback dry-run on staging (6-step checklist).

### Iter-3 polish (6 minor items) resolved
Playwright env-inheritance subtlety · Two unit test edge cases (empty-string env var, literal 'false' string) · `SEED_BYPASS_USER_CAP` test · Explicit CI workflow edit · Browser-based redirect-loop manual verification · Three-request integration round-trip including cookie-expiry recovery.

### Final reviewer verdicts (iter-4)
- **Security**: "All 5 iteration-2 SEC-CRIT gaps are materially fixed with correct, well-explained specifications. No new critical issues surface. Plan is ready."
- **Architecture**: "All 4 minor issues from iteration 2 are properly addressed with concrete, well-specified solutions. No critical architectural gaps remain. Phase ordering, deploy gates, rollback procedures, and integration test coverage are all sound. Plan is execution-ready."
- **Testing**: "All 6 minor issues from iteration 3 are properly addressed in iteration 4 without introducing new blockers. The testing/CI/CD surface is comprehensive… No blockers remain."

Plan is ready for execution.
