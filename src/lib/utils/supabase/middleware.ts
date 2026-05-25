import { createServerClient, type CookieMethodsServer } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { User, AuthError } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'
import { classifyHost } from '@/config/hostnames'

// Module-scope in-flight cache to dedupe parallel cold-request guest sign-ins.
// Dedup is per-Node-instance (Vercel cold-start churn = best-effort, NOT global).
// Acceptable given low concurrency expected from a single demo viewer + Supabase's
// 30/min IP rate limit as the real backstop. Promise.race timeout (10s) prevents
// a stalled signInWithPassword from poisoning the slot site-wide.
const inFlightGuestLogin = new Map<string, Promise<{ error: AuthError | null }>>()
const GUEST_LOGIN_TIMEOUT_MS = 10_000

// Test-only: reset the in-flight cache between tests.
export function __resetGuestLoginCacheForTests(): void {
  inFlightGuestLogin.clear()
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      } as CookieMethodsServer,
    }
  )

  // Do not run code between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  // IMPORTANT: DO NOT REMOVE auth.getUser()

  let currentUser: User | null = null
  {
    const { data } = await supabase.auth.getUser()
    currentUser = data.user
  }

  // Auto-guest-login on public-tier hosts when no session present.
  // MUST run BEFORE the unauth-redirect block below; otherwise that redirect
  // fires first and this code is unreachable for unauthenticated visitors.
  //
  // The setAll() callback above writes the new session cookies onto
  // supabaseResponse automatically when signInWithPassword succeeds —
  // same mechanism getUser() uses to refresh near-expiry tokens.
  //
  // Soft env-var truthy check: missing GUEST_EMAIL/GUEST_PASSWORD is a no-op
  // (NOT a noisy failure) so Phase 4→5 deploy ordering bugs degrade gracefully.
  // Avoid skip-on-failed-recent cookie loop: when GUEST_AUTOLOGIN_FAILED_RECENTLY
  // cookie is present, skip the sign-in attempt for its 60s lifetime.
  const failedRecently = request.cookies.get('GUEST_AUTOLOGIN_FAILED_RECENTLY')?.value === '1'
  // Skip guest auto-login on the password-recovery flow paths. Without this,
  // an unauthenticated visitor hitting any of these routes gets signed in as
  // the guest BEFORE the recovery session lands, which swaps the session and
  // breaks the flow. Closes the cookie-propagation race after /auth/confirm
  // redirects to /reset-password.
  const onRecoveryPath =
    request.nextUrl.pathname.startsWith('/reset-password') ||
    request.nextUrl.pathname.startsWith('/forgot-password') ||
    request.nextUrl.pathname.startsWith('/auth/confirm')
  if (
    !currentUser &&
    process.env.E2E_TEST_MODE !== 'true' &&
    process.env.GUEST_EMAIL &&
    process.env.GUEST_PASSWORD &&
    !failedRecently &&
    !onRecoveryPath
  ) {
    const host = request.headers.get('host')
    const tier = classifyHost(host)
    if (tier === 'public' || tier === 'local' || tier === 'preview') {
      const dedupeKey = `${tier}:${host ?? 'no-host'}`
      if (!inFlightGuestLogin.has(dedupeKey)) {
        const loginPromise = Promise.race<{ error: AuthError | null }>([
          supabase.auth.signInWithPassword({
            email: process.env.GUEST_EMAIL,
            password: process.env.GUEST_PASSWORD,
          }),
          new Promise<{ error: AuthError | null }>((resolve) =>
            setTimeout(
              () =>
                resolve({
                  error: {
                    name: 'TimeoutError',
                    message: 'guest auto-login timed out after 10s',
                  } as AuthError,
                }),
              GUEST_LOGIN_TIMEOUT_MS,
            ),
          ),
        ]).finally(() => inFlightGuestLogin.delete(dedupeKey))
        inFlightGuestLogin.set(dedupeKey, loginPromise)
      }
      const { error: guestErr } = await inFlightGuestLogin.get(dedupeKey)!
      if (guestErr) {
        console.warn('[middleware] guest-auto-login failed', {
          error: guestErr.message,
          host,
          path: request.nextUrl.pathname,
        })
        // Set a 60s cookie so subsequent requests skip the sign-in attempt
        // and the /login page renders a service-unavailable notice instead
        // of re-redirecting back through auto-login (redirect-loop avoidance).
        //
        // Respect the file's "must return supabaseResponse object as-is"
        // invariant (see warning block below): copy over any cookies the
        // SDK wrote during the failed signInWithPassword (e.g. PKCE state
        // clears) before returning the new response.
        const url = request.nextUrl.clone()
        url.pathname = '/login'
        const fallback = NextResponse.redirect(url)
        // Defensive: in test mocks supabaseResponse.cookies may be a plain Map
        // rather than the rich NextResponse cookies API. The real API has .getAll().
        if (typeof supabaseResponse.cookies.getAll === 'function') {
          for (const cookie of supabaseResponse.cookies.getAll()) {
            fallback.cookies.set(cookie.name, cookie.value, cookie)
          }
        }
        fallback.cookies.set('GUEST_AUTOLOGIN_FAILED_RECENTLY', '1', {
          maxAge: 60,
          httpOnly: true,
          path: '/',
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
        })
        return fallback
      }
      // Re-read user so the downstream user-disabled check sees the new session.
      const { data } = await supabase.auth.getUser()
      currentUser = data.user
      console.info('[middleware] guest-auto-login fired', {
        host,
        path: request.nextUrl.pathname,
      })
    }
  }

  if (
    !currentUser &&
    !request.nextUrl.pathname.startsWith('/login') &&
    !request.nextUrl.pathname.startsWith('/auth') &&
    !request.nextUrl.pathname.startsWith('/forgot-password') &&
    !request.nextUrl.pathname.startsWith('/reset-password') &&
    !(process.env.NODE_ENV !== 'production' && request.nextUrl.pathname.startsWith('/debug-critic')) &&
    !(process.env.NODE_ENV !== 'production' && request.nextUrl.pathname.startsWith('/test-global-error'))
  ) {
    // no user, potentially respond by redirecting the user to the login page
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Check if user is disabled (skip for auth routes and error page).
  // /reset-password is allowlisted so a user holding a pre-disable recovery
  // session can still complete the password change; they get bounced on the
  // next non-auth route they hit. See planning doc Risk #6.
  if (
    currentUser &&
    !request.nextUrl.pathname.startsWith('/login') &&
    !request.nextUrl.pathname.startsWith('/auth') &&
    !request.nextUrl.pathname.startsWith('/error') &&
    !request.nextUrl.pathname.startsWith('/account-disabled') &&
    !request.nextUrl.pathname.startsWith('/reset-password')
  ) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('is_disabled, disabled_reason')
      .eq('user_id', currentUser.id)
      .single()

    if (profile?.is_disabled) {
      // User is disabled, redirect to account disabled page
      const url = request.nextUrl.clone()
      url.pathname = '/account-disabled'
      if (profile.disabled_reason) {
        url.searchParams.set('reason', profile.disabled_reason)
      }
      return NextResponse.redirect(url)
    }
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is.
  // If you're creating a new response object with NextResponse.next() make sure to:
  // 1. Pass the request in it, like so:
  //    const myNewResponse = NextResponse.next({ request })
  // 2. Copy over the cookies, like so:
  //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  // 3. Change the myNewResponse object to fit your needs, but avoid changing
  //    the cookies!
  // 4. Finally:
  //    return myNewResponse
  // If this is not done, you may be causing the browser and server to go out
  // of sync and terminate the user's session prematurely!

  return supabaseResponse
}
