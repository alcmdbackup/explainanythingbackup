import { test as base, expect, Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from .env.local
// This is needed because Playwright tests run in Node.js workers, not through Next.js
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const MAX_AUTH_RETRIES = 5;
const AUTH_RETRY_DELAY_MS = 2000; // Increased to handle Supabase rate limits

// Cache session per worker to avoid repeated auth calls
let cachedSession: SessionData | null = null;
let sessionExpiry = 0;

interface SessionData {
  access_token: string;
  refresh_token: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user: any;
}

/**
 * Authenticates with Supabase using the test user credentials.
 * Includes retry logic to handle transient network issues and rate limits.
 * Caches session per worker to avoid repeated auth calls.
 */
async function authenticateWithRetry(retries = MAX_AUTH_RETRIES): Promise<SessionData> {
  // Return cached session if still valid (with 5 minute buffer)
  const now = Date.now();
  if (cachedSession && sessionExpiry > now + 5 * 60 * 1000) {
    return cachedSession;
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  for (let attempt = 1; attempt <= retries; attempt++) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: process.env.TEST_USER_EMAIL || 'abecha@gmail.com',
      password: process.env.TEST_USER_PASSWORD || 'password',
    });

    if (!error && data.session && data.user) {
      cachedSession = {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        user: data.user,
      };
      // Set expiry based on session (default 1 hour)
      sessionExpiry = now + (data.session.expires_in || 3600) * 1000;
      return cachedSession;
    }

    if (attempt < retries) {
      // Exponential backoff for rate limiting
      const delay = AUTH_RETRY_DELAY_MS * Math.pow(1.5, attempt - 1);
      console.warn(`Auth attempt ${attempt} failed: ${error?.message}. Retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    } else {
      throw new Error(`Auth failed after ${retries} attempts: ${error?.message}`);
    }
  }

  throw new Error('Auth failed: unexpected code path');
}

/**
 * Custom test fixture that provides per-worker API-based authentication.
 * Each worker gets its own fresh auth session, avoiding shared state issues.
 */
export const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ page, context }, use) => {
    const session = await authenticateWithRetry();

    const supabaseUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    const projectRef = supabaseUrl.hostname.split('.')[0];

    // Create the session object in the format Supabase SSR expects
    const sessionData = {
      access_token: session.access_token,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: session.refresh_token,
      user: session.user,
    };

    // Encode as base64url with 'base64-' prefix (Supabase SSR format)
    // Note: Supabase SSR expects base64url encoding (- instead of +, _ instead of /, no padding)
    // Regular base64 uses +/= which causes decoding failures
    const base64 = Buffer.from(JSON.stringify(sessionData)).toString('base64');
    const base64url = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const cookieValue = `base64-${base64url}`;

    // Determine domain from BASE_URL (localhost for local dev, vercel.app for production)
    const baseUrl = process.env.BASE_URL || 'http://localhost:3008';
    const baseUrlHost = new URL(baseUrl).hostname;
    const isLocalhost = baseUrlHost === 'localhost' || baseUrlHost === '127.0.0.1';

    // Build cookies array
    type Cookie = Parameters<typeof context.addCookies>[0][number];
    const cookies: Cookie[] = [
      // Supabase auth cookie
      {
        name: `sb-${projectRef}-auth-token`,
        value: cookieValue,
        domain: baseUrlHost,
        path: '/',
        httpOnly: false,
        secure: !isLocalhost,
        sameSite: 'Lax',
      },
    ];

    // Add Vercel bypass cookie for production deployments
    // This is required because extraHTTPHeaders only works for API requests,
    // not browser navigation. The cookie bypasses Vercel Deployment Protection.
    if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET && !isLocalhost) {
      cookies.push({
        name: 'x-vercel-protection-bypass',
        value: process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
        domain: baseUrlHost,
        path: '/',
        httpOnly: false,
        secure: true,
        sameSite: 'None',
      });
    }

    // Inject cookies into browser context
    await context.addCookies(cookies);

    // use is Playwright fixture, not React hook
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(page);
  },
});

export { expect };
