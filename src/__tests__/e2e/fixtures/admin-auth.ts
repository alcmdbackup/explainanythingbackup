/**
 * Admin authentication fixture for E2E tests.
 * Provides adminPage and adminUserId fixtures for testing admin-only functionality.
 * Follows exact cookie pattern from auth.ts for Supabase SSR compatibility.
 */

import { test as base, expect, Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { needsBypassCookie, loadBypassCookieState } from '../setup/vercel-bypass';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const MAX_AUTH_RETRIES = 5;
const AUTH_RETRY_DELAY_MS = 2000;

// Cache admin session per worker to avoid repeated auth calls
let cachedAdminSession: AdminSessionData | null = null;
let adminSessionExpiry = 0;

/**
 * Check if admin credentials are available.
 * Used to skip admin tests gracefully in CI when secrets aren't configured.
 */
export function hasAdminCredentials(): boolean {
  return !!(process.env.ADMIN_TEST_EMAIL && process.env.ADMIN_TEST_PASSWORD);
}

interface AdminSessionData {
  access_token: string;
  refresh_token: string;
  user: { id: string; email: string };
}

/**
 * Authenticates as admin user with retry logic.
 * Uses ADMIN_TEST_EMAIL/ADMIN_TEST_PASSWORD env vars.
 */
async function authenticateAdmin(retries = MAX_AUTH_RETRIES): Promise<AdminSessionData> {
  const now = Date.now();
  if (cachedAdminSession && adminSessionExpiry > now + 5 * 60 * 1000) {
    console.log('   ✓ Using cached admin session');
    return cachedAdminSession;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const adminEmail = process.env.ADMIN_TEST_EMAIL;
  const adminPassword = process.env.ADMIN_TEST_PASSWORD;

  if (!adminEmail || !adminPassword) {
    throw new Error('ADMIN_TEST_EMAIL and ADMIN_TEST_PASSWORD must be set');
  }

  console.log(`   Authenticating admin user: ${adminEmail}`);

  const supabase = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

  for (let attempt = 1; attempt <= retries; attempt++) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: adminEmail,
      password: adminPassword,
    });

    if (!error && data.session && data.user) {
      console.log(`   ✓ Admin auth succeeded: ${data.user.email}`);
      cachedAdminSession = {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        user: { id: data.user.id, email: data.user.email! },
      };
      adminSessionExpiry = now + (data.session.expires_in || 3600) * 1000;
      return cachedAdminSession;
    }

    if (attempt < retries) {
      const delay = AUTH_RETRY_DELAY_MS * Math.pow(1.5, attempt - 1);
      console.warn(`Admin auth attempt ${attempt} failed: ${error?.message}. Retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw new Error('Admin auth failed after retries');
}

type AdminFixtures = {
  adminPage: Page;
  adminUserId: string;
};

export const adminTest = base.extend<AdminFixtures>({
  adminPage: async ({ browser }, use, testInfo) => {
    // Skip admin tests if credentials aren't configured
    if (!hasAdminCredentials()) {
      testInfo.skip(true, 'ADMIN_TEST_EMAIL/ADMIN_TEST_PASSWORD not configured');
      return;
    }

    const context = await browser.newContext();
    const page = await context.newPage();
    const session = await authenticateAdmin();

    // Extract project ref from Supabase URL (matches auth.ts pattern)
    const supabaseUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    const projectRef = supabaseUrl.hostname.split('.')[0];

    // Cookie domain and secure flag from BASE_URL
    const baseUrl = process.env.BASE_URL || 'http://localhost:3008';
    const cookieDomain = new URL(baseUrl).hostname;
    const isSecure = baseUrl.startsWith('https');
    const cookieName = `sb-${projectRef}-auth-token`;

    // Create session object in Supabase SSR format
    const sessionData = {
      access_token: session.access_token,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: session.refresh_token,
      user: session.user,
    };

    // Encode as base64url with 'base64-' prefix (Supabase SSR format)
    const base64 = Buffer.from(JSON.stringify(sessionData)).toString('base64');
    const base64url = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const cookieValue = `base64-${base64url}`;

    // Set auth cookie (exact pattern from auth.ts)
    await context.addCookies([
      {
        name: cookieName,
        value: cookieValue,
        domain: cookieDomain,
        path: '/',
        httpOnly: false,
        secure: isSecure,
        sameSite: isSecure ? 'None' : 'Lax',
      },
    ]);

    // Add Vercel bypass cookie if needed
    if (needsBypassCookie()) {
      const bypassState = loadBypassCookieState();
      if (bypassState?.cookie) {
        await context.addCookies([bypassState.cookie]);
      }
    }

    // use is Playwright fixture, not React hook
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(page);
    await context.close();
  },

  // Extract user ID from cached session (no DB query needed)
  adminUserId: async ({}, use, testInfo) => {
    if (!hasAdminCredentials()) {
      testInfo.skip(true, 'ADMIN_TEST_EMAIL/ADMIN_TEST_PASSWORD not configured');
      return;
    }
    const session = await authenticateAdmin();
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(session.user.id);
  },
});

export { expect };
