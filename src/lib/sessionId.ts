/**
 * Session ID Management Module
 *
 * Provides session tracking that spans multiple requests, complementing
 * the per-request requestId tracking.
 *
 * Session Types:
 * - Anonymous: `sess-{uuid}` - localStorage-based, 30-min sliding timeout
 * - Authenticated: `auth-{hash}` - SHA-256 hash of userId (deterministic)
 */

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes (fixed)
const SESSION_KEY = 'ea_session';

interface StoredSession {
  id: string;
  lastActivity: number;
}

/**
 * SYNCHRONOUS session ID for anonymous users.
 * Called immediately on render - no useEffect delay.
 *
 * SSR Safety: Returns 'ssr-pending' during server rendering.
 */
export function getOrCreateAnonymousSessionId(): string {
  if (typeof window === 'undefined') {
    return 'ssr-pending';
  }

  try {
    const stored = localStorage.getItem(SESSION_KEY);
    const now = Date.now();

    if (stored) {
      const { id, lastActivity } = JSON.parse(stored) as StoredSession;
      if (now - lastActivity < SESSION_TIMEOUT_MS) {
        // Refresh sliding window
        localStorage.setItem(SESSION_KEY, JSON.stringify({ id, lastActivity: now }));
        return id;
      }
    }

    // Create new session
    const newId = `sess-${generateUUID()}`;
    localStorage.setItem(SESSION_KEY, JSON.stringify({ id: newId, lastActivity: now }));
    return newId;
  } catch {
    // localStorage unavailable (Safari private mode, quota exceeded, etc.)
    return `sess-fallback-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

/**
 * Derive deterministic session ID from authenticated user using SHA-256.
 * Called AFTER auth resolves - takes userId directly (not session object).
 *
 * Why userId only (not full session):
 * - userId is constant for the entire auth session
 * - Avoids extra getSession() call - we already have userId from getUser()
 * - expires_at changes on token refresh (~hourly), would break continuity
 *
 * Why SHA-256 (not btoa):
 * - btoa is reversible base64 encoding, not a hash
 * - SHA-256 is a true one-way cryptographic hash
 * - Prevents userId exposure if logs are shared externally
 *
 * Fallback: Uses sync hash if crypto.subtle unavailable (non-HTTPS localhost, older browsers)
 */
export async function deriveAuthSessionId(userId: string): Promise<string> {
  // Try Web Crypto API first (async, secure)
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(userId);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      return `auth-${hashHex.slice(0, 12)}`;
    } catch {
      // crypto.subtle may throw in insecure contexts, fall through to fallback
    }
  }

  // Fallback: Simple sync hash (djb2 algorithm)
  // Less secure but deterministic - acceptable for session correlation (not security)
  return `auth-${syncHash(userId).slice(0, 12)}`;
}

/**
 * Synchronous hash fallback using djb2 algorithm.
 * Used when crypto.subtle is unavailable (HTTP localhost, old browsers).
 * NOT cryptographically secure - only for session correlation.
 */
function syncHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  // Convert to hex string, ensure positive
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Cross-browser UUID generation with fallback.
 */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/**
 * Handle session transition from anonymous to authenticated.
 * Called in useAuthenticatedRequestId's useEffect after getUser() resolves.
 *
 * @param userId - The authenticated user's ID from getUser()
 * @returns The new auth session ID and optionally the previous anonymous session ID
 */
export async function handleAuthTransition(userId: string): Promise<{
  sessionId: string;
  previousSessionId?: string;
}> {
  const anonSession = typeof window !== 'undefined' ? localStorage.getItem(SESSION_KEY) : null;
  const anonSessionId = anonSession ? JSON.parse(anonSession).id : null;
  const authSessionId = await deriveAuthSessionId(userId);

  if (anonSessionId && anonSessionId !== authSessionId) {
    // Send linking event to server for proper log correlation
    // Fire-and-forget: don't block auth flow on this
    sendSessionLinkingEvent(anonSessionId, authSessionId, userId).catch(() => {
      // Silently fail - session linking is best-effort
    });

    if (typeof window !== 'undefined') {
      localStorage.removeItem(SESSION_KEY);
    }
    return { sessionId: authSessionId, previousSessionId: anonSessionId };
  }

  return { sessionId: authSessionId };
}

/**
 * Send session linking event to server for log correlation.
 * Uses existing client-logs API endpoint.
 * Fire-and-forget: failures are silently ignored.
 */
async function sendSessionLinkingEvent(
  previousSessionId: string,
  newSessionId: string,
  userId: string
): Promise<void> {
  await fetch('/api/client-logs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      level: 'info',
      message: 'Session transition: anonymous → authenticated',
      data: {
        previousSessionId,
        sessionId: newSessionId,
        userId,
        eventType: 'session_linking'
      }
    })
  });
}

/**
 * OPTIONAL: Get tab-specific ID for per-tab debugging.
 *
 * NOT included in core implementation - add only if needed for:
 * - Debugging multi-tab race conditions
 * - Distinguishing requests from different tabs in same session
 *
 * Usage: Add to __requestId payload if needed:
 *   __requestId: { requestId, userId, sessionId, tabId: getTabId() }
 */
export function getTabId(): string {
  if (typeof window === 'undefined') return 'ssr';

  try {
    let tabId = sessionStorage.getItem('ea_tabId');
    if (!tabId) {
      tabId = generateUUID().slice(0, 8);
      sessionStorage.setItem('ea_tabId', tabId);
    }
    return tabId;
  } catch {
    return `tab-${Date.now()}`;
  }
}

/**
 * Clear session on logout for privacy.
 */
export function clearSession(): void {
  try {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(SESSION_KEY);
    }
  } catch {
    // Ignore errors
  }
}
