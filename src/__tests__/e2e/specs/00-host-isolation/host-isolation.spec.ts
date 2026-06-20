/**
 * Host-isolation E2E spec for the explainanything/evolution website split.
 *
 * Runs against the local dev server (BASE_URL). Spoofs the `Host` request
 * header via Playwright's APIRequestContext so we can exercise the middleware's
 * hostname-based routing without needing two real production hostnames. The
 * Next.js middleware reads `request.headers.get('host')` regardless of who
 * set it, so this exercises the same code path that runs in production.
 *
 * One caveat: `VERCEL_ENV=preview` is in the bypass tier of `classifyHost()`.
 * If this spec runs with `VERCEL_ENV=preview` set, the bypass kicks in and
 * the assertions about cross-host 404s will fail. Local `npm run dev` does
 * NOT set `VERCEL_ENV`, so this is safe locally and in `ci.yml`. We assert
 * the env is unset at the top of the spec to catch misconfiguration.
 */

import { test, expect, request as playwrightRequest, APIRequestContext } from '@playwright/test';
import { PROD_PUBLIC_HOST, PROD_EVOLUTION_HOST } from '@/config/hostnames';

const PUBLIC_HOST = PROD_PUBLIC_HOST;
const EVOLUTION_HOST = PROD_EVOLUTION_HOST;

async function ctxWithHost(host: string, baseURL: string): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: { host },
    // Don't follow redirects automatically — we want to assert the redirect status itself.
    maxRedirects: 0,
  });
}

test.describe('Host isolation', { tag: ['@critical', '@skip-prod'] }, () => {
  // Serial mode: each inner describe shares an APIRequestContext via beforeAll.
  // Per testing_overview.md Rule 13, beforeAll-driven shared state requires serial.
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(() => {
    if (process.env.VERCEL_ENV === 'preview') {
      throw new Error(
        'host-isolation.spec.ts requires VERCEL_ENV to be unset (preview tier bypasses the gate). ' +
          'Run with `unset VERCEL_ENV` or omit the variable.',
      );
    }
  });

  test.describe('Public host', () => {
    test.describe.configure({ mode: 'serial' });
    let ctx: APIRequestContext;

    test.beforeAll(async ({ baseURL }) => {
      ctx = await ctxWithHost(PUBLIC_HOST, baseURL!);
    });
    test.afterAll(async () => {
      await ctx.dispose();
    });

    test('blocks /admin/evolution/runs with 404', async () => {
      const res = await ctx.get('/admin/evolution/runs');
      expect(res.status()).toBe(404);
    });

    test('blocks /api/evolution/run with 404', async () => {
      const res = await ctx.get('/api/evolution/run');
      expect(res.status()).toBe(404);
    });

    test('blocks /admin/evolution-dashboard with 404', async () => {
      const res = await ctx.get('/admin/evolution-dashboard');
      expect(res.status()).toBe(404);
    });

    test('blocks /admin/evolution/prompt-editor with 404', async () => {
      const res = await ctx.get('/admin/evolution/prompt-editor');
      expect(res.status()).toBe(404);
    });

    test('blocks /api/evolution/prompt-editor with 404', async () => {
      const res = await ctx.post('/api/evolution/prompt-editor', { data: {} });
      expect(res.status()).toBe(404);
    });

    test('blocks /api/evolution/weight-inference/auto-run with 404', async () => {
      const res = await ctx.post('/api/evolution/weight-inference/auto-run', { data: {} });
      expect(res.status()).toBe(404);
    });

    test('serves /api/health (always-allowed)', async () => {
      const res = await ctx.get('/api/health');
      expect(res.status()).toBe(200);
    });

    test('does NOT 404 /results (public route)', async () => {
      const res = await ctx.get('/results');
      // /results may 200, 307 redirect to login, or 500 if no query — anything except 404.
      expect(res.status()).not.toBe(404);
    });
  });

  test.describe('Evolution host', () => {
    test.describe.configure({ mode: 'serial' });
    let ctx: APIRequestContext;

    test.beforeAll(async ({ baseURL }) => {
      ctx = await ctxWithHost(EVOLUTION_HOST, baseURL!);
    });
    test.afterAll(async () => {
      await ctx.dispose();
    });

    test('redirects / to /admin/evolution-dashboard with 307', async () => {
      const res = await ctx.get('/');
      expect(res.status()).toBe(307);
      const location = res.headers()['location'] ?? '';
      expect(location).toContain('/admin/evolution-dashboard');
    });

    test('blocks /results with 404', async () => {
      const res = await ctx.get('/results');
      expect(res.status()).toBe(404);
    });

    test('blocks /explanations with 404', async () => {
      const res = await ctx.get('/explanations');
      expect(res.status()).toBe(404);
    });

    test('blocks /api/returnExplanation with 404', async () => {
      const res = await ctx.get('/api/returnExplanation');
      expect(res.status()).toBe(404);
    });

    test('blocks /api/stream-chat with 404', async () => {
      const res = await ctx.get('/api/stream-chat');
      expect(res.status()).toBe(404);
    });

    test('serves /api/health (always-allowed)', async () => {
      const res = await ctx.get('/api/health');
      expect(res.status()).toBe(200);
    });

    test('does NOT 404 /admin/evolution/runs (evolution route)', async () => {
      const res = await ctx.get('/admin/evolution/runs');
      // Could be 200, 307 redirect to /login, or 500 if no admin session — anything except 404.
      expect(res.status()).not.toBe(404);
    });
  });

  test.describe('Unknown host (fail-closed)', () => {
    test.describe.configure({ mode: 'serial' });
    let ctx: APIRequestContext;

    test.beforeAll(async ({ baseURL }) => {
      ctx = await ctxWithHost('attacker.com', baseURL!);
    });
    test.afterAll(async () => {
      await ctx.dispose();
    });

    test('returns 404 for /', async () => {
      const res = await ctx.get('/');
      expect(res.status()).toBe(404);
    });

    test('returns 404 for /admin/evolution/runs', async () => {
      const res = await ctx.get('/admin/evolution/runs');
      expect(res.status()).toBe(404);
    });

    test('returns 404 for /results', async () => {
      const res = await ctx.get('/results');
      expect(res.status()).toBe(404);
    });

    test('still serves /api/health (always-allowed bypass)', async () => {
      const res = await ctx.get('/api/health');
      expect(res.status()).toBe(200);
    });
  });

  test.describe('Suffix-extension attack', () => {
    test('host that suffix-extends evolution returns 404 (treated as unknown)', async ({ baseURL }) => {
      const ctx = await ctxWithHost(`${EVOLUTION_HOST}.attacker.com`, baseURL!);
      try {
        const res = await ctx.get('/admin/evolution/runs');
        expect(res.status()).toBe(404);
      } finally {
        await ctx.dispose();
      }
    });

    test('host that suffix-extends public returns 404 (treated as unknown)', async ({ baseURL }) => {
      const ctx = await ctxWithHost(`${PUBLIC_HOST}.attacker.com`, baseURL!);
      try {
        const res = await ctx.get('/results');
        expect(res.status()).toBe(404);
      } finally {
        await ctx.dispose();
      }
    });
  });
});
