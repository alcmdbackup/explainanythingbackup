/**
 * Vercel Deployment Protection bypass utility for E2E tests.
 * Obtains cryptographically-signed bypass cookie from Vercel's edge.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Constants for Vercel bypass headers
const BYPASS_HEADER = 'x-vercel-protection-bypass';
const SET_BYPASS_COOKIE_HEADER = 'x-vercel-set-bypass-cookie';

// Use deterministic filename (not random per worker) to enable cross-worker sharing
const BYPASS_COOKIE_FILE = path.join(os.tmpdir(), '.vercel-bypass-cookie.json');
const BYPASS_COOKIE_LOCK = path.join(os.tmpdir(), '.vercel-bypass-cookie.lock');

// Cookie expiry constants
const COOKIE_STALE_THRESHOLD_MS = 55 * 60 * 1000; // 55 minutes (refresh before 60 min expiry)
const LOCK_TIMEOUT_MS = 5000; // 5 seconds max wait for lock
const LOCK_RETRY_MS = 100; // Retry interval for acquiring lock

interface BypassCookie {
  name: string;
  value: string;
  domain?: string; // Optional for __Host- cookies (RFC compliance)
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'None' | 'Lax' | 'Strict';
  expires?: number;
}

interface BypassCookieState {
  cookie: BypassCookie;
  timestamp: number;
}

/**
 * Check if bypass is needed (external URL + secret present)
 */
export function needsBypassCookie(): boolean {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3008';
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const isExternal = !baseUrl.includes('localhost') && !baseUrl.includes('127.0.0.1');

  if (isExternal && !secret) {
    console.warn('⚠️  Running against external URL without VERCEL_AUTOMATION_BYPASS_SECRET');
  }

  return isExternal && !!secret;
}

/**
 * Make priming request to obtain bypass cookie from Vercel (single attempt)
 */
async function obtainBypassCookieSingle(baseUrl: string): Promise<BypassCookie | null> {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!secret) return null;

  const response = await fetch(baseUrl, {
    headers: {
      [BYPASS_HEADER]: secret,
      [SET_BYPASS_COOKIE_HEADER]: 'samesitenone',
    },
    redirect: 'manual',
  });

  // Only expect 302/307 per Vercel docs (not 303)
  if (![302, 307].includes(response.status)) {
    if (response.status === 200) {
      console.log('   ℹ️  Protection may be disabled (got 200), proceeding without bypass cookie');
      return null;
    }
    throw new Error(`Unexpected status: ${response.status}`);
  }

  // Get Set-Cookie headers
  let setCookies: string[];
  if (typeof response.headers.getSetCookie === 'function') {
    setCookies = response.headers.getSetCookie();
  } else {
    // Fallback for older Node (though we require 18+)
    const header = response.headers.get('set-cookie');
    setCookies = header ? [header] : [];
  }

  // Accept ANY Set-Cookie with HttpOnly+Secure (not filter by name)
  // Vercel docs say cookie names are "system-managed, not explicitly disclosed"
  const bypassSetCookie = setCookies.find(
    (c) => c.includes('HttpOnly') && c.includes('Secure')
  );

  if (!bypassSetCookie) {
    console.warn('   ⚠️  No bypass cookie in response');
    return null;
  }

  // Parse Set-Cookie string to extract name=value
  const cookieParts = bypassSetCookie.split(';')[0].split('=');
  const cookieName = cookieParts[0].trim();
  const cookieValue = cookieParts.slice(1).join('=').trim();

  if (!cookieName || !cookieValue) {
    throw new Error(`Malformed Set-Cookie header: ${bypassSetCookie}`);
  }

  const domain = new URL(baseUrl).hostname;

  // Parse expires/max-age from header instead of hardcoding
  let expires: number | undefined;
  const maxAgeMatch = bypassSetCookie.match(/Max-Age=(\d+)/i);
  const expiresMatch = bypassSetCookie.match(/Expires=([^;]+)/i);
  if (maxAgeMatch) {
    expires = Math.floor(Date.now() / 1000) + parseInt(maxAgeMatch[1]);
  } else if (expiresMatch) {
    expires = Math.floor(new Date(expiresMatch[1]).getTime() / 1000);
  } else {
    expires = Math.floor(Date.now() / 1000) + 3600; // fallback 1 hour
  }

  // Omit domain for __Host- prefixed cookies (RFC compliance)
  const cookie: BypassCookie = {
    name: cookieName,
    value: cookieValue,
    domain: cookieName.startsWith('__Host-') ? undefined : domain,
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'None',
    expires,
  };

  console.log(`   ✓ Obtained bypass cookie: ${cookieName} for ${domain}`);
  return cookie;
}

/**
 * Retry logic with exponential backoff (similar to authenticateWithRetry)
 */
export async function obtainBypassCookieWithRetry(
  baseUrl: string,
  maxRetries = 3,
  initialDelayMs = 1000
): Promise<BypassCookie | null> {
  console.log(`   Obtaining Vercel bypass cookie for ${baseUrl}...`);

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await obtainBypassCookieSingle(baseUrl);
    } catch (error) {
      lastError = error as Error;
      const isRetryable =
        error instanceof Error &&
        (error.message.includes('ECONNREFUSED') ||
          error.message.includes('ETIMEDOUT') ||
          error.message.includes('fetch failed'));

      if (!isRetryable || attempt === maxRetries) {
        console.error(
          `   ❌ Failed to obtain bypass cookie (attempt ${attempt}/${maxRetries}):`,
          error
        );
        if (attempt === maxRetries) break;
      }

      const delay = initialDelayMs * Math.pow(2, attempt - 1);
      console.warn(
        `   ⚠️  Bypass request failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error('Failed to obtain bypass cookie after retries');
}

/**
 * Acquire file lock for safe cross-worker file access.
 * Uses exclusive file creation as a simple lock mechanism.
 */
function acquireLock(): boolean {
  const startTime = Date.now();
  while (Date.now() - startTime < LOCK_TIMEOUT_MS) {
    try {
      // O_CREAT | O_EXCL - fails if file exists (atomic lock)
      const fd = fs.openSync(BYPASS_COOKIE_LOCK, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
      fs.closeSync(fd);
      return true;
    } catch {
      // Lock held by another process, wait and retry
      const waitTime = Math.min(LOCK_RETRY_MS, LOCK_TIMEOUT_MS - (Date.now() - startTime));
      if (waitTime > 0) {
        // Synchronous sleep using Atomics.wait with SharedArrayBuffer
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitTime);
      }
    }
  }
  return false;
}

/**
 * Release file lock.
 */
function releaseLock(): void {
  try {
    fs.unlinkSync(BYPASS_COOKIE_LOCK);
  } catch {
    // Lock file doesn't exist, that's fine
  }
}

/**
 * Synchronous write with file locking to avoid race condition with workers.
 * Sets restrictive file permissions (0o600).
 */
export function saveBypassCookieState(cookie: BypassCookie): void {
  const state: BypassCookieState = {
    cookie,
    timestamp: Date.now(),
  };

  if (!acquireLock()) {
    console.warn('   ⚠️  Could not acquire lock for saving bypass cookie, proceeding anyway');
  }

  try {
    // Write synchronously to ensure file is ready before workers start
    fs.writeFileSync(BYPASS_COOKIE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
  } finally {
    releaseLock();
  }
  // Note: Removed unreliable process.on('exit') handler - cleanup relies on global-teardown
}

/**
 * Load bypass cookie state from file with file locking (synchronous for fixture initialization)
 */
export function loadBypassCookieState(): BypassCookieState | null {
  if (!acquireLock()) {
    console.warn('   ⚠️  Could not acquire lock for reading bypass cookie');
  }

  try {
    const content = fs.readFileSync(BYPASS_COOKIE_FILE, 'utf-8');
    const state = JSON.parse(content) as BypassCookieState;

    // Check if cookie is stale (>55 min old, expires at 60 min)
    if (state.timestamp && Date.now() - state.timestamp > COOKIE_STALE_THRESHOLD_MS) {
      console.warn('   ⚠️  Bypass cookie is stale (>55 min old), tests may fail');
    }

    // Validate cookie structure
    if (!state.cookie || !state.cookie.name || !state.cookie.value) {
      console.error('   ❌ Invalid bypass cookie state: missing required fields');
      return null;
    }

    return state;
  } catch (error) {
    // Log error for debugging (helps diagnose file corruption or permission issues)
    if (error instanceof Error && !error.message.includes('ENOENT')) {
      console.error(`   ❌ Failed to load bypass cookie: ${error.message}`);
    }
    return null;
  } finally {
    releaseLock();
  }
}

/**
 * Check if the current bypass cookie is stale and needs refresh
 */
export function isBypassCookieStale(): boolean {
  const state = loadBypassCookieState();
  if (!state) return true;
  return Date.now() - state.timestamp > COOKIE_STALE_THRESHOLD_MS;
}

/**
 * Cleanup bypass cookie file
 */
export async function cleanupBypassCookieFile(): Promise<void> {
  try {
    await fs.promises.unlink(BYPASS_COOKIE_FILE);
    console.log('   ✓ Cleaned up bypass cookie file');
  } catch {
    // File doesn't exist, that's fine
  }
}

/**
 * Get the current bypass cookie file path (for debugging/testing)
 */
export function getBypassCookieFilePath(): string {
  return BYPASS_COOKIE_FILE;
}

/**
 * Main setup function - call from global-setup.ts
 */
export async function setupVercelBypass(): Promise<void> {
  if (!needsBypassCookie()) {
    return;
  }

  const baseUrl = process.env.BASE_URL!;
  const cookie = await obtainBypassCookieWithRetry(baseUrl);

  if (cookie) {
    saveBypassCookieState(cookie);
  }
}
