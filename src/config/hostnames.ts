/**
 * Hostname configuration for the explainanything/evolution website split.
 * Single source of truth used by middleware, requireAdmin(), and Sentry tagging.
 * See docs/planning/split_evolution_explainanythig_into_separate_websites_20260522/.
 */

/**
 * Production hostnames. Compared via exact case-insensitive equality after
 * port stripping — never `startsWith` (suffix-extension attack surface).
 *
 * `PROD_EVOLUTION_HOST` is the placeholder name until Phase 2 confirms the
 * domain choice (Path 1: `evolution.<apex>`; Path 2: `*.vercel.app` alias).
 */
export const PROD_PUBLIC_HOST = 'explainanything.vercel.app';
export const PROD_EVOLUTION_HOST = 'ea-evolution.vercel.app';

const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

export type HostTier = 'public' | 'evolution' | 'preview' | 'local' | 'unknown';

/**
 * Classify a host string into one of the routing tiers.
 *
 * - `local` (localhost / 127.0.0.1 / 0.0.0.0 — exact match): both halves
 *   reachable, no hostname-based gate. Dev convenience.
 * - `preview` (Vercel `VERCEL_ENV=preview` builds): both halves reachable.
 *   Vercel Deployment Protection gates preview URLs at the edge.
 * - `public` (exact match `PROD_PUBLIC_HOST`): production explainanything.
 * - `evolution` (exact match `PROD_EVOLUTION_HOST`): production evolution.
 * - `unknown`: anything else. Fail-closed in the middleware.
 *
 * Comparisons strip port and lowercase the hostname. Passing an empty,
 * null, or undefined host returns `'unknown'`.
 */
export function classifyHost(rawHost: string | null | undefined): HostTier {
  const host = (rawHost ?? '').toLowerCase().split(':')[0];
  if (!host) return 'unknown';
  if (LOCAL_HOSTS.has(host)) return 'local';
  if (process.env.VERCEL_ENV === 'preview') return 'preview';
  if (host === PROD_PUBLIC_HOST.toLowerCase()) return 'public';
  if (host === PROD_EVOLUTION_HOST.toLowerCase()) return 'evolution';
  return 'unknown';
}

/**
 * Path prefixes that only the public hostname should serve. Hitting any of
 * these on the evolution hostname returns 404.
 */
export const PUBLIC_PREFIXES: readonly string[] = [
  '/results',
  '/explanations',
  '/sources',
  '/userlibrary',
  '/api/returnExplanation',
  '/api/runAISuggestionsPipeline',
  '/api/stream-chat',
  '/api/fetchSourceMetadata',
];

/**
 * Path prefixes that only the evolution hostname should serve. Hitting any
 * of these on the public hostname returns 404.
 */
export const EVOLUTION_PREFIXES: readonly string[] = [
  '/admin/evolution',
  '/api/evolution',
];

/**
 * Paths that bypass the hostname gate entirely. Health checks, observability
 * tunnels, and client log ingestion must remain reachable from any host so
 * monitoring works during DNS/domain churn.
 */
export const ALWAYS_ALLOWED_PREFIXES: readonly string[] = [
  '/api/health',
  '/api/monitoring',
  '/api/traces',
  '/api/client-logs',
];
